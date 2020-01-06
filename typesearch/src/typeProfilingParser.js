const fs = require( 'fs' );
const path = require( 'path' );
const glob = require( 'glob' );
const tsmorph = require( 'ts-morph' );
const getSource = require( 'get-source' );
const stringify = require( 'json-stable-stringify' );
const linesAndCols = require( 'lines-and-columns' );
const signale = require( 'signale' );

const config = require( 'rc' )( 'tasks' );

/*

	Takes a collection of typeProfiles and turns them into
	a JSON with correct references to the functions and parameters
	in src/ files.
	Showing that e.g. in 'example_foo' the function 'Vector3.add'
	was called with parameters of type Vector3, undefined and number.

	This is the data generator behind the 'TypeSearch' function.

*/


function TypeManager() {

	this.cache = new Map();

	this.addType = function ( name ) {

		if ( this.cache.has( name ) === false )
			this.cache.set( name, this.cache.size );

		return this.cache.get( name );

	};

	this.listTypes = function () {

		return [ ...this.cache.keys() ];

	};

}


class ParameterManager {

	constructor( typeManager ) {

		this.paramCache = new Map();
		this.scopedCache = {};

		this.typeManager = typeManager;

	}

	/**
	 * @param {string} scopeName Filename where this was found (i.e. typeProfile-example_webgl_...)
	 * @param {(tsmorph.FunctionDeclaration|tsmorph.FunctionExpression)} functionNode
	 * @param {{ index: number, name: string, pos: object, types: string[] }} parameterObj
	 */
	addParameter( scopeName, functionNode, parameterObj ) {

		// clone it since we need to cut out types
		const paramWithoutTypes = Object.assign( {}, parameterObj );
		delete paramWithoutTypes.types;

		// global cache for all params without their types
		// stringify is an ugly solution, but creating objects dynamically kinda renders Map's advantage null
		const stringifiedParamWithoutTypes = stringify( paramWithoutTypes ); // no need to call 'stringify' thrice
		if ( this.paramCache.has( stringifiedParamWithoutTypes ) === false )
			this.paramCache.set( stringifiedParamWithoutTypes, this.paramCache.size );

		const paramId = this.paramCache.get( stringifiedParamWithoutTypes );


		// handle types seperately
		const types = parameterObj.types.map( type => this.typeManager.addType( type ) );


		// init a new scoped cache if necessary
		if ( typeof this.scopedCache[ scopeName ] === 'undefined' )
			this.scopedCache[ scopeName ] = new Map();

		// by scoping it, every profile/example can have its own types while still
		// sharing the parameters themselves with other runs (and hopefully save space)
		if ( this.scopedCache[ scopeName ].has( functionNode ) === false ) {

			// now merge the globally cached parameters with its local types
			const finalObj = { p: paramId, t: types };

			const newParamList = new Array( parameterObj.index + 1 );
			newParamList[ parameterObj.index ] = finalObj;

			this.scopedCache[ scopeName ].set( functionNode, newParamList );

			// console.log( 'Added to new functionNode:', newParamList );

		} else {

			const preExistingParams = this.scopedCache[ scopeName ].get( functionNode );

			// console.log( 'Already existing params:', preExistingParams );

			if ( typeof preExistingParams[ parameterObj.index ] !== 'undefined' ) {

				// our parameter already exists, just add new types
				const newTypes = types.filter( t => preExistingParams[ parameterObj.index ].t.indexOf( t ) === - 1 );
				preExistingParams[ parameterObj.index ].t.push( ...newTypes );

			} else {

				// the functionNode is already known, but this particular parameter is still missing
				const finalObj = { p: paramId, t: types };

				// insert into preExisting
				preExistingParams[ parameterObj.index ] = finalObj;

			}

			// console.log( 'All done:', preExistingParams );

			this.scopedCache[ scopeName ].set( functionNode, preExistingParams );

		}

	}

	/**
	 * @param {string} scopeName
	 * @param {(tsmorph.FunctionDeclaration|tsmorph.FunctionExpression)} functionNode
	 * @param {number} index
	 * @param {string} type
	 * @returns {boolean}
	 */
	addTypeToIndex( scopeName, functionNode, index, type ) {

		if ( typeof this.scopedCache[ scopeName ] === 'undefined' )
			return false;

		if ( this.scopedCache[ scopeName ].has( functionNode ) === false )
			return false;

		const params = this.scopedCache[ scopeName ].get( functionNode );

		if ( typeof params[ index ] === 'undefined' )
			return false;

		const typeId = this.typeManager.addType( type );

		if ( params[ index ].t.indexOf( typeId ) === - 1 )
			params[ index ].t.push( typeId );

		this.scopedCache[ scopeName ].set( functionNode, params );

		return true;

	}

	listTypes() {

		return this.typeManager.listTypes();

	}

	listScopedParameters( scopeName, functionNode ) {

		if ( typeof this.scopedCache[ scopeName ] === 'undefined' )
			return;

		return this.scopedCache[ scopeName ].get( functionNode );

	}

	listGlobalParameter( paramId ) {

		return this.listGlobalParameters()[ paramId ];

	}

	listGlobalParameters() {

		return [ ...this.paramCache.keys() ].map( p => JSON.parse( p ) );

	}

}


class TypeProfilingParser {

	constructor( threejsRepository, inputBasePath, outputBasePath ) {

		this.threejsRepository = threejsRepository;
		this.inputBasePath = inputBasePath;
		this.outputBasePath = outputBasePath;

		this.logger = signale.scope( 'Parser' );
		this.cacheLogger = signale.scope( 'Cache' );

		this.project = new tsmorph.Project( { compilerOptions: { removeComments: false, allowJs: true } } );

		/**
		 * @type {Object.<string,string>}
		 */
		this.contentCache = {};

		/**
		 * @type {Object.<string, tsmorph.SourceFile>}
		*/
		this.objectCache = {};

		/**
		 * @type {Object.<string, Object.<number,tsmorph.Node>>}
		*/
		this.nodeCache = {};

		/**
		 * @type {Map.<any, string>}
		 */
		this.nameCache = new Map();

		this.functionsCache = new Map();

		this.startLineNumberCache = new Map();
		this.startLineNumberCache2 = new Map(); // for includeJsDoc === true // TODO: necessary?
		this.linesAndColsCache = new Map();
		this.getSourceCache = new Map();

		/**
		 * @type {Object.<string, (tsmorph.FunctionDeclaration|tsmorph.FunctionExpression)[]>}
		 */
		this.exampleCalls = {};

		this.typeMngr = new TypeManager();
		this.paramMngr = new ParameterManager( this.typeMngr );
		this.retvalMngr = new ParameterManager( this.typeMngr );

	}


	work( filenameGlob = 'examples_*.json' ) {

		for ( const profileFile of glob.sync( path.join( this.inputBasePath, filenameGlob ) ) ) {

			console.log( { profileFile } );

			this.exampleCalls[ profileFile ] = [];

			const profile = JSON.parse( fs.readFileSync( profileFile, 'utf8' ) );

			const ignores = config.typesearch.ignoredNamePatterns;
			const files = profile.results.result
				.filter( r => /^https?:\/\/(localhost|127.0.0.1):?[0-9]*/i.test( r.url ) === true )			// only local scripts
				.filter( r => r.url.endsWith( '.html' ) === false )								// no html files
				.filter( r => ignores.every( pattern => r.url.indexOf( pattern ) === - 1 ) );	// all ignores are missing from the url


			for ( const results of files ) {

				const sourceFile = results.url.replace( /^https?:\/\/(localhost|127.0.0.1):?[0-9]*/i, this.threejsRepository );

				console.log( { sourceFile } );

				const sourceCode = this.contentCache[ sourceFile ] || fs.readFileSync( sourceFile, 'utf8' );
				if ( this.contentCache[ sourceFile ] )
					this.cacheLogger.debug( 'contentCache hit' );
				else
					this.contentCache[ sourceFile ] = sourceCode;

				const source = this.objectCache[ sourceFile ] || this.project.createSourceFile( sourceFile, sourceCode, { overwrite: true } );
				if ( this.objectCache[ sourceFile ] )
					this.cacheLogger.debug( 'objectCache hit' );
				else
					this.objectCache[ sourceFile ] = source;

				const nodeCacheForThisFile = this.nodeCache[ sourceFile ] || {};
				if ( this.nodeCache[ sourceFile ] )
					this.cacheLogger.debug( 'nodeCache hit' );
				else
					this.nodeCache[ sourceFile ] = nodeCacheForThisFile;


				for ( const entry of results.entries ) {

					this.logger.debug( { entry } );

					//
					// get the node this entry references
					//
					const node = nodeCacheForThisFile[ entry.offset ] || source.getDescendantAtPos( entry.offset );
					if ( nodeCacheForThisFile[ entry.offset ] )
						this.cacheLogger.debug( 'nodeCacheForThisFile hit', entry.offset );
					else
						nodeCacheForThisFile[ entry.offset ] = node;

					if ( ! node ) {

						console.error( 'Node not found:', sourceFile, entry.offset, entry.types.map( x => x.name ).join( ' | ' ) );
						continue;

					}


					//
					// test if it's a node we can use
					// (sometimes they refer to useless ones like commas or semicolons)
					//
					const nodeKind = node.getKind();

					if ( nodeKind !== tsmorph.SyntaxKind.CloseBraceToken && nodeKind !== tsmorph.SyntaxKind.Identifier ) {

						console.error( 'Node neither Identifier nor CloseBraceToken, rather:', node.getKindName() );
						continue;

					}


					/**
					 * @type {tsmorph.FunctionDeclaration|tsmorph.FunctionExpression}
					 */
					const parentparent = node.getParent().getParent();
					const parentparentKind = parentparent.getKind();


					//
					// type profile for a function parameter
					//
					if ( node.getKind() === tsmorph.SyntaxKind.Identifier ) {

						// check to see if we've already encountered this FunctionNode
						const existingParams = this.paramMngr.listScopedParameters( profileFile, parentparent );
						const sigParams = parentparent.getSignature().getParameters();

						if ( ! existingParams || sigParams.length !== existingParams.length ) {

							// either we haven't or we have a different number of parameters saved for it
							const params = sigParams.map( ( param, idx ) => ( {
								name: param.getEscapedName(),
								types: [],
								index: idx,
								pos: param.getDeclarations().map( decl => ( {
									pos: decl.getPos()
								} ) )
							} ) );

							// add them
							params.forEach( p => this.paramMngr.addParameter( profileFile, parentparent, p ) );

						}

						const match = sigParams.findIndex( x => x.getEscapedName() === node.getText() );
						if ( match !== - 1 ) {

							entry.types.forEach( ( { name } ) => {

								const success = this.paramMngr.addTypeToIndex( profileFile, parentparent, match, name );

								if ( ! success )
									this.logger.error( 'added type to index', match, 'named', name, '---->', success );
								else
									this.logger.debug( 'added type to index', match, 'named', name, '---->', success );

							} );

						} else {

							this.logger.error( node.getText(), 'failed:', match );

						}

					}


					//
					// type profile for a return value
					//
					if ( node.getKind() === tsmorph.SyntaxKind.CloseBraceToken ) {

						if ( entry.types.length > 0 ) {

							// a bit hacky maybe
							this.retvalMngr.addParameter( profileFile, parentparent, {
								index: 0,
								name: 'return',
								pos: null,
								types: entry.types.map( type => type.name )
							} );

						}

					}


					//
					// early bailout
					//
					if ( this.functionsCache.has( parentparent ) ) {

						const func = this.functionsCache.get( parentparent );

						if ( func.name ) {

							this.cacheLogger.debug( `Cache hit: ${func.name}` );

							if ( this.exampleCalls[ profileFile ].indexOf( parentparent ) === - 1 ) {

								this.exampleCalls[ profileFile ].push( parentparent );
								this.logger.debug( `Added ${func.name} hit to ${profileFile}'s functions: ${this.exampleCalls[ profileFile ].length}` );

							}

							continue;

						} else {

							console.error( 'functionsCache has a hit but no name?' );

							process.exit( - 3 );

						}

					}


					//
					// more bailout
					//
					if ( node.getKind() === tsmorph.SyntaxKind.CloseBraceToken )
						continue;


					if ( parentparentKind === tsmorph.SyntaxKind.FunctionDeclaration ) {

						/**
						 * @type {tsmorph.FunctionDeclaration}
						 */
						const func = parentparent;

						const name = this.nameCache.get( func ) || func.getName();
						this.nameCache.set( func, name );

						this.logger.debug( `function declaration: function ${name} -> <RETURN VALUE>` );

						if ( this.startLineNumberCache.has( func ) === false )
							this.startLineNumberCache.set( func, func.getStartLineNumber( false ) );
						const startLineNumber = this.startLineNumberCache.get( func );

						const funcObj = this.functionsCache.get( func ) || {
							name, sourceFile,
							start: func.getPos(),
							startRaw: func.getStart( false ),
							startLineNumber
						};

						this.functionsCache.set( func, funcObj );

						this.exampleCalls[ profileFile ].push( func );

						this.logger.debug( `Added ${funcObj.name} to ${profileFile}'s functions: ${this.exampleCalls[ profileFile ].length}` );

					} else if ( parentparentKind === tsmorph.SyntaxKind.FunctionExpression ) {

						/**
						 * @type {tsmorph.FunctionExpression}
						 */
						const func = parentparent;

						const name = this.getNameFromFuncExpr( func );

						let funcObj = this.functionsCache.get( func );

						if ( funcObj === undefined ) {

							this.logger.debug( `Creating funcObj for ${name}-${sourceFile}` );

							if ( this.startLineNumberCache2.has( func ) === false )
								this.startLineNumberCache2.set( func, func.getStartLineNumber( true ) );
							const startLineNumber = this.startLineNumberCache2.get( func );

							funcObj = {
								name, sourceFile,
								start: func.getPos(),
								startRaw: func.getStart(),
								startLineNumber
							};

						}

						this.functionsCache.set( func, funcObj );

						this.exampleCalls[ profileFile ].push( func );

						this.logger.debug( `Added ${funcObj.name} Node to ${profileFile}'s functions: ${this.exampleCalls[ profileFile ].length}` );

					}

				}

			}

		}


		// -----------------------------------------------------




		const collection = {
			functions: new Map(),
			files: [],
			lines: [],
			originals: new Map()
		};


		const resultsNewDict = { results: [] };

		for ( const profileFile of Object.keys( this.exampleCalls ) ) {

			for ( const funcNode of this.exampleCalls[ profileFile ] ) {

				const funcObj = this.functionsCache.get( funcNode );

				if ( ! funcObj )
					throw new Error( 'No cache hit for funcNode' );

				const { startRaw, sourceFile, startLineNumber } = funcObj;


				const params = this.paramMngr.listScopedParameters( profileFile, funcNode );
				const retvals = this.retvalMngr.listScopedParameters( profileFile, funcNode )[ 0 ].t;


				if ( typeof this.contentCache[ sourceFile + '-split' ] === 'undefined' )
					this.contentCache[ sourceFile + '-split' ] = this.contentCache[ sourceFile ].split( /\n/g );

				const line = this.contentCache[ sourceFile + '-split' ][ startLineNumber - 1 ];
				if ( collection.lines.indexOf( line ) === - 1 )
					collection.lines.push( line );


				if ( this.linesAndColsCache.has( sourceFile ) === false )
					this.linesAndColsCache.set( sourceFile, new linesAndCols.default( this.contentCache[ sourceFile ] ) );
				const lcf = this.linesAndColsCache.get( sourceFile );


				if ( this.getSourceCache.has( sourceFile ) === false )
					this.getSourceCache.set( sourceFile, getSource( sourceFile ) );
				const sourceMapped = this.getSourceCache.get( sourceFile );


				const location = lcf.locationForIndex( startRaw );
				const mapResult = sourceMapped.resolve( { line: location.line + 1, column: location.column } );

				const pathRelative = path.relative( this.threejsRepository, mapResult.sourceFile.path );
				if ( collection.files.indexOf( pathRelative ) === - 1 )
					collection.files.push( pathRelative );

				const original = {
					line: mapResult.line,
					column: mapResult.column,
					file: collection.files.indexOf( pathRelative )
				};

				const stringifiedOriginal = stringify( original );
				if ( collection.originals.has( stringifiedOriginal ) === false )
					collection.originals.set( stringifiedOriginal, collection.originals.size );


				const newFuncObj = {
					name: funcObj.name,
					start: funcObj.start,
					startLineNumber
				};

				const stringifiedNewFuncObj = stringify( newFuncObj );
				if ( collection.functions.has( stringifiedNewFuncObj ) === false )
					collection.functions.set( stringifiedNewFuncObj, collection.functions.size );


				// logger.debug( `In ${profileFile} we call ${newFuncObj.name || '-anonymous-'} with...` );
				// logger.debug( `ScopedParams for '${funcObj.name}': ${JSON.stringify( ParamMngr.listScopedParameters( profileFile, funcNode ) )}` );
				// logger.debug( `Retval for '${funcObj.name}': ${RetvalMngr.listScopedParameters( profileFile, funcNode )[ 0 ].t.join( '|' )}` );

				// sort param types, cosmetics only
				// params.sort( ( a, b ) => Math.min( a.t ) - Math.min( b.t ) );
				params.forEach( ( p ) => p.t.sort() );

				const obj = {
					file: profileFile.replace( /^.*?examples_(.*?)\.json$/, "$1" ),
					func: collection.functions.get( stringifiedNewFuncObj ),
					params: params,
					retval: retvals,
					line: collection.lines.indexOf( line ),
					original: collection.originals.get( stringifiedOriginal )
				};

				const existingEntry = resultsNewDict.results.find( result => {

					return result.func === obj.func &&
						stringify( result.params ) === stringify( obj.params ) &&
						stringify( result.retval ) === stringify( obj.retval ) &&
						result.line === obj.line &&
						result.original === obj.original;

				} );
				if ( existingEntry ) {

					// console.log( 'appending' );
					if ( Array.isArray( existingEntry.file ) )
						existingEntry.file.push( obj.file );
					else
						existingEntry.file = [ existingEntry.file, obj.file ];

				} else {

					resultsNewDict.results.push( obj );

				}

			}

		}


		resultsNewDict[ '_lines' ] = collection.lines;
		resultsNewDict[ '_files' ] = collection.files;
		resultsNewDict[ '_originals' ] = [ ...collection.originals.keys() ].map( o => JSON.parse( o ) );
		resultsNewDict[ '_functions' ] = [ ...collection.functions.keys() ].map( f => JSON.parse( f ) );
		resultsNewDict[ '_params' ] = this.paramMngr.listGlobalParameters();
		resultsNewDict[ '_types' ] = this.typeMngr.listTypes();

		fs.writeFileSync( path.join( this.outputBasePath, 'results.json' ), stringify( resultsNewDict ), 'utf8' );

	}


	getNameFromFuncExpr( func ) {

		const ANONYMOUS_FUNCTIONNAME = '-anonymous-';

		const parentparentparentKind = func.getParent().getKind();

		func.p = func.getParent();
		func.pp = func.p.getParent();
		func.ppp = func.pp.getParent();

		let name, description, identifierNode = func;

		if ( func.getName() ) {

			name = this.nameCache.get( func ) || func.getName();

			description = 'function expression';

		} else if ( parentparentparentKind === tsmorph.SyntaxKind.VariableDeclaration ) {

			/**
			 * @type {tsmorph.VariableDeclaration}
			 */
			identifierNode = func.p;

			name = this.nameCache.get( identifierNode ) || ( ( typeof identifierNode[ 'getName' ] !== 'undefined' ) ? identifierNode.getName() : '-unknown name-' );

			description = 'function expression with variable declaration';

		} else if ( parentparentparentKind === tsmorph.SyntaxKind.BinaryExpression ) {

			// https://astexplorer.net/#/gist/a3e7a83e1bf992ce610792760f34cfea/43452418abc4fa049f483881824dd921f8a51a19

			/**
			 * @type {tsmorph.BinaryExpression}
			 */
			identifierNode = func.p;

			name = this.nameCache.get( identifierNode ) || identifierNode.getLeft().getText();

			description = 'function expression with binary expression';

		} else if ( parentparentparentKind === tsmorph.SyntaxKind.PropertyAssignment ) {

			// https://astexplorer.net/#/gist/274fdfc14ae3c475a939bbc00ae69ab7/c1183492f5303176d213e132297a6a955b832ace

			/**
			 * @type {tsmorph.PropertyAssignment}
			 */
			identifierNode = func.p;

			name = this.nameCache.get( identifierNode ) || identifierNode.getName();

			description = 'function expression with property assignment';

		} else if ( parentparentparentKind === tsmorph.SyntaxKind.ReturnStatement ) {

			name = this.nameCache.get( func ) || func.getName() || ANONYMOUS_FUNCTIONNAME;

			description = 'function expression after return statement';

		} else if ( parentparentparentKind === tsmorph.SyntaxKind.NewExpression ) {

			/**
			 * @type {tsmorph.NewExpression}
			 */
			identifierNode = func.p;

			name = this.nameCache.get( identifierNode ) || identifierNode.getExpression().getText();

			description = 'function expression after new expression';

		} else if ( parentparentparentKind === tsmorph.SyntaxKind.CallExpression ) {

			if ( func.pp.getKind() === tsmorph.SyntaxKind.BinaryExpression ) {

				/**
				 * @type {tsmorph.BinaryExpression}
				 */
				identifierNode = func.pp;

				name = this.nameCache.get( identifierNode ) || identifierNode.getLeft().getText();

				description = 'function expression with call expression and binary expression';

			} else if ( func.pp.getKind() === tsmorph.SyntaxKind.VariableDeclaration ) {

				/**
				 * @type {tsmorph.VariableDeclaration}
				 */
				identifierNode = func.pp;

				name = this.nameCache.get( identifierNode ) || identifierNode.getName();

				description = 'function expression with call expression and variable declaration';

			} else if ( func.ppp.getKind() === tsmorph.SyntaxKind.VariableDeclaration ) {

				/**
				 * @type {tsmorph.VariableDeclaration}
				 */
				identifierNode = func.ppp;

				name = this.nameCache.get( identifierNode ) || identifierNode.getName();

				description = 'function expression with call expression and distant variable declaration';

			} else if ( func.p.getKind() === tsmorph.SyntaxKind.CallExpression ) {

				/**
				 * @type {tsmorph.CallExpression}
				 */
				identifierNode = func.p;

				if ( identifierNode.getExpression() === func ) {

					name = ANONYMOUS_FUNCTIONNAME;

					description = 'function expression with call expression and no-name function';

				} else {

					name = this.nameCache.get( func ) || func.getName() || ANONYMOUS_FUNCTIONNAME;

					description = 'function expression with call expression and expression';

				}

			} else {

				console.log( 'Nothing:', func.p.getKindName() );

			}

		} else if ( parentparentparentKind === tsmorph.SyntaxKind.ParenthesizedExpression ) {

			identifierNode = func;

			name = this.nameCache.get( identifierNode ) || identifierNode.getName() || ANONYMOUS_FUNCTIONNAME;

			description = 'function expression with parenthesized expression';

		} else if ( parentparentparentKind === tsmorph.SyntaxKind.PropertyAccessExpression ) {

			identifierNode = func;

			name = this.nameCache.get( identifierNode ) || identifierNode.getName() || ANONYMOUS_FUNCTIONNAME;

			description = 'function expression with property access expression';

		} else {

			console.log( '? >', func.p.getKindName() );

		}


		if ( name !== undefined ) {

			name = name.replace( 'this.', '' );
			this.nameCache.set( identifierNode, name );
			this.logger.debug( `${description}: function ${name}` );

			return name;

		} else {

			throw new Error( 'name not found' );

		}

	}

}



// simple CLI-fication
if ( require.main === module ) {

	if ( process.argv.length < 5 ) {

		console.error( 'Invalid number of arguments' );

		console.log( `Usage: ${path.basename( process.argv[ 0 ] )} ${path.relative( process.cwd(), process.argv[ 1 ] )} <3js Repo> <Input path> <Output path> [Input glob]` );

		process.exit( - 1 );

	}

	// eslint-disable-next-line no-unused-vars
	let [ node, script, threejsRepository, input, output, inputGlob ] = process.argv;

	try {

		console.log( 'Init...' );
		const parser = new TypeProfilingParser( threejsRepository, input, output );

		console.log( 'Work...' );
		parser.work( inputGlob || 'examples_*.json' );

		console.log( 'Done' );

	} catch ( err ) {

		console.error( 'The big one >', err );
		process.exit( - 1 );

	}

}


module.exports = TypeProfilingParser;

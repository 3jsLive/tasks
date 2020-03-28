/*

	1) Use tsmorph to fish out all *.d.ts definitions
	2) Check chrome-type-profiles for parameter types (reality) that clash with *.d.ts (law)

	// TODO: this whole logic is begging for unit tests

	// TODO: return types as part of CallSignature?

	__        __         _      ___         ____
	\ \      / /__  _ __| | __ |_ _|_ __   |  _ \ _ __ ___   __ _ _ __ ___  ___ ___
     \ \ /\ / / _ \| '__| |/ /  | || '_ \  | |_) | '__/ _ \ / _` | '__/ _ \/ __/ __|
	  \ V  V / (_) | |  |   <   | || | | | |  __/| | | (_) | (_| | | |  __/\__ \__ \
	   \_/\_/ \___/|_|  |_|\_\ |___|_| |_| |_|   |_|  \___/ \__, |_|  \___||___/___/
                                                            |___/

*/

const tsmorph = require( 'ts-morph' );
const fs = require( 'fs' );
const path = require( 'path' );
const chalk = require( 'chalk' ).default;


const derivedClassesCache = new Map();



const regexBufferAttributes = /^(Uint|Int|Float)\d+\w*BufferAttribute$/;
const regexBufferGeometry = /^[A-Z]\w+BufferGeometry$/;

const BaseCheck = require( './BaseCheck' );


/**
 * @typedef {{
 * 	file: string[],
 * 	func: number,
 * 	line: number,
 * 	original: number,
 * 	params: { p: number, t: number[] }[],
 * 	retval: number[]
 * }} NormalisedProfile
 */

/**
 * @typedef {{
 * 	func: {name: string, start: number, startLineNumber: number},
 * 	params: { index: number, name: string, pos: {pos: number}[], types: string[] }[],
 * 	retval: string[],
 * 	line: string,
 * 	original: { column: number, file: string, line: number },
 * 	examples: (string|string[])
 * }} DenormalisedProfile
 */

class ErrorAndWarnings {

	constructor() {

		/**
		 * @type {string[]}
		 */
		this.errors = [];

		/**
		 * @type {string[]}
		 */
		// this.warnings = [];

	}

	/**
	 * @param {string} msg
	 */
	addError( msg ) {

		if ( ! this.errors.includes( msg ) )
			this.errors.push( msg );

	}

	/**
	 * @param {string} msg
	 */
	// addWarning( msg ) {

	// 	if ( ! this.warnings.includes( msg ) )
	// 		this.warnings.push( msg );

	// }

}

class Type {

	/**
	 * @param {string} name
	 * @param {boolean?} array
	 * @throws {Error} If name is empty or missing
	 */
	constructor( name, array = false ) {

		if ( ! name || name.length === 0 )
			throw new Error( 'empty name' );

		this.name = name;
		this.array = array;

	}

}

class Parameter {

	/**
	 * @param {string} lawName
	 * @param {string} realName
	 * @param {number?} index
	 * @param {boolean?} optional
	 * @param {boolean?} rest
	 * @throws {Error} If lawName or realName is empty
	 */
	constructor( lawName, realName, index = 0, optional = false, rest = false ) {

		if ( ! lawName || ! realName || lawName.length === 0 || realName.length === 0 )
			throw new Error( 'empty name' );

		this.lawName = lawName;
		this.realName = realName;
		this.index = index;
		this.optional = optional;
		this.rest = rest;

		/**
		 * @type {Type[]}
		 */
		this.lawTypes = [];

		/**
		 * @type {Type[]}
		 */
		this.realityTypes = [];

		/**
		 * @type {Type[]}
		 */
		this._typeMatches = null;

	}


	toJSON() {

		return {
			index: this.index,
			lawTypes: {
				correct: this.correctLawTypes().map( type => type.name ),
				missing: this.missingLawTypes().map( type => type.name )
			},
			realityTypes: {
				correct: this.typeMatches().filter( result => result.success ).map( result => result.reality.name ),
				wrong: this.typeMatches().filter( result => ! result.success ).map( result => result.reality.name )
			},
			degree: this.matchDegree(),
			lawName: this.lawName + ( this.optional ? '?' : '' ),
			realityName: this.realName
		};

	}


	/**
	 * Compare "law" types with actually encountered "reality" types
	 * @param {import('ts-morph').Project} project
	 * @returns {Type[]}
	 */
	typeMatches( project ) {

		if ( this._typeMatches === null )
			this._typeMatches = this._compatibleTypes( project );

		return this._typeMatches;

	}


	/**
	 * Returns "law" types that haven't been used in the wild
	 * @returns {Type[]}
	 */
	missingLawTypes() {

		return this.lawTypes.filter( type => ! this._typeMatches.some( match => match.law && match.law.name === type.name ) );

	}


	/**
	 * @returns {Type[]}
	 */
	correctLawTypes() {

		return this._typeMatches.reduce( ( all, result ) => {

			if ( result.success && result.law ) {

				if ( all.findIndex( r => r.name === result.law.name ) === - 1 )
					all.push( result.law );

			}

			return all;

		}, [] );

	}


	/**
	 * @param {Type} type
	 */
	addLawType( type ) {

		if ( type instanceof Type === false )
			throw new Error( 'type not a Type' );

		this.lawTypes.push( type );

		this._typeMatches = null;

	}


	/**
	 * @param {Type} type
	 */
	addRealityType( type ) {

		if ( type instanceof Type === false )
			throw new Error( 'type not a Type' );

		this.realityTypes.push( type );

		this._typeMatches = null;

	}


	/**
	 * Crude name similarity comparison
	 */
	matchDegree() {

		let degree = '';

		if ( this.lawName !== this.realName ) {

			// retry with case-insensitive
			if ( this.lawName.toLowerCase() !== this.realName.toLowerCase() )
				degree = 'red';
			else
				degree = 'yellow';

		} else {

			degree = 'green';

		}

		return degree;

	}


	/**
	 * @param {import('ts-morph').Project} project
	 */
	_compatibleTypes( project ) {

		// FIXME: there shouldn't be any dupes in the first place
		const lawTypes = this.lawTypes.filter( ( type, i, a ) => a.findIndex( x => x.name === type.name ) === i );
		const realTypes = this.realityTypes.filter( ( type, i ) => this.realityTypes.indexOf( type ) === i );

		const allResults = new Array( realTypes.length );

		// FIXME: again: fix type generation instead of hacking like this
		lawTypes.forEach( ( type, idx ) => lawTypes[ idx ].name = lawTypes[ idx ].name.replace( 'THREE.', '' ) );

		// count rest parameters( ...foo[] ) as normal ones
		// TODO: correct?
		if ( lawTypes[ lawTypes.length - 1 ].array === true && this.rest === true ) {

			lawTypes[ lawTypes.length - 1 ].array = false;
			lawTypes[ lawTypes.length - 1 ].name = lawTypes[ lawTypes.length - 1 ].name.replace( '[]', '' );

		}


		realTypes.forEach( ( realType, index ) => {

			const result = { success: false, law: null, reality: realType };
			allResults[ index ] = result;

			// this could be sped up quite a bit by not repeating findIndex() all the time

			// NOTE:
			// We intentionally don't compare lowerCase<>lowerCase (i.e. case-insensitive) because
			// the official TypeScript docs recommend using 'number' instead of 'Number', 'string'
			// instead of 'String', etc. so UpperCase declarations are considered bugs

			// baby steps, are they identical?
			let lawMatch = lawTypes.findIndex( t => t.name === realType.name );
			if ( lawMatch !== - 1 ) {

				result.law = lawTypes[ lawMatch ];
				result.success = true;
				return;

			}

			// simple, is there any declared type that's got the same name as this real one
			lawMatch = lawTypes.findIndex( t => t.name.replace( 'THREE.', '' ) === realType.name );
			if ( lawMatch !== - 1 ) {

				result.law = lawTypes[ lawMatch ];
				result.success = true;
				return;

			}

			// maybe the other way?
			lawMatch = lawTypes.findIndex( t => t.name === realType.name.replace( 'THREE.', '' ) );
			if ( lawMatch !== - 1 ) {

				result.law = lawTypes[ lawMatch ];
				result.success = true;
				return;

			}

			// array?
			lawMatch = lawTypes.findIndex( t => t.array || t.name.startsWith( 'ArrayLike<' ) );
			if ( /^([A-Z][a-z0-9]+)?Array$/.test( realType.name ) && lawMatch !== - 1 ) {

				result.law = lawTypes[ lawMatch ];
				result.success = true;
				return;

			}

			// function?
			lawMatch = lawTypes.findIndex( t => /^\((\w+: \w+,?\s*)+\) => \w+$/.test( t.name ) );
			if ( realType.name === 'Function' && lawMatch !== - 1 ) {

				result.law = lawTypes[ lawMatch ];
				result.success = true;
				return;

			}

			// boolean equals false|true
			lawMatch = lawTypes.findIndex( t => t.name === 'false' || t.name === 'true' );
			if ( realType.name === 'boolean' && lawMatch !== - 1 ) {

				result.law = lawTypes[ lawMatch ];
				result.success = true;
				return;

			}

			// void equals undefined
			lawMatch = lawTypes.findIndex( t => t.name === 'void' );
			if ( realType.name === 'undefined' && lawMatch !== - 1 ) {

				result.law = lawTypes[ lawMatch ];
				result.success = true;
				return;

			}

			// literal object notation "{ foo: bar }"
			lawMatch = lawTypes.findIndex( t => /^\{.*?\}$/.test( t.name ) );
			if ( /^object$/i.test( realType.name ) && lawMatch !== - 1 ) {

				result.law = lawTypes[ lawMatch ];
				result.success = true;
				return;

			}

			// ...BufferAttribute?
			lawMatch = lawTypes.findIndex( t => t.name.endsWith( 'BufferAttribute' ) );
			if ( regexBufferAttributes.test( realType.name ) && lawMatch !== - 1 ) {

				result.law = lawTypes[ lawMatch ];
				result.success = true;
				return;

			}

			// ...BufferGeometry?
			lawMatch = lawTypes.findIndex( t => t.name.endsWith( 'BufferGeometry' ) );
			if ( regexBufferGeometry.test( realType.name ) && lawMatch !== - 1 ) {

				result.law = lawTypes[ lawMatch ];
				result.success = true;
				return;

			}

			// any?
			lawMatch = lawTypes.findIndex( t => t.name === 'any' && ( t.array === realType.array ) );
			if ( lawMatch !== - 1 ) {

				result.law = lawTypes[ lawMatch ];
				result.success = true;
				return;

			}

			if ( project ) {

				// check if realType is a descendant of any lawType
				// TODO: more caching?
				const realTypeSource = project.getSourceFile( realType.name + '.d.ts' );
				const lawTypeSources = lawTypes.map( lt => project.getSourceFile( lt.name.replace( 'THREE.', '' ) + '.d.ts' ) ).filter( s => s !== undefined );

				if ( realTypeSource && lawTypeSources.length > 0 ) {

					const realTypeClass = realTypeSource.getClass( realType.name );
					const lawTypeClasses = lawTypeSources.reduce( ( /** @type {tsmorph.ClassDeclaration[]} */ all, s ) => {

						all.push( ...s.getClasses() );
						return all;

					}, [] );

					if ( realTypeClass && lawTypeClasses.length > 0 ) {

						const match = lawTypeClasses.findIndex( ( /** @type {tsmorph.ClassDeclaration} */ c ) => {

							if ( ! derivedClassesCache.has( c ) )
								derivedClassesCache.set( c, c.getDerivedClasses() );

							return derivedClassesCache.get( c ).indexOf( realTypeClass ) !== - 1;

						} );

						if ( match !== - 1 ) {

							result.law = { name: lawTypeClasses[ match ].getName() };
							result.reality = { name: realTypeClass.getName() };
							result.success = true;
							return;

						}

					}

				}

			}

			// last resort, undefined and optional?
			if ( this.optional && realType.name === 'undefined' ) {

				result.success = true;
				return;

			}


		} );

		return allResults;

	}

}

class CallSignature extends ErrorAndWarnings {

	/**
	 * @param {number?} index
	 */
	constructor( index = 0 ) {

		super();

		this.index = index;

		/**
		 * @type {Parameter[]}
		 */
		this.parameters = [];

	}


	toJSON() {

		return {
			errors: this.errors,
			index: this.index,
			results: this.parameters
		};

	}


	/**
	 * @param {Parameter} param
	 */
	addParameter( param ) {

		if ( param instanceof Parameter === false )
			throw new Error( 'param not a Parameter' );

		this.parameters.push( param );

	}

}

class Func extends ErrorAndWarnings {

	constructor( name, origin ) {

		if ( name.length === 0 )
			throw new Error( 'empty name' );

		super();

		/**
		 * @type {string}
		 */
		this.name = name;
		this.origin = origin;

		/**
		 * @type {CallSignature[]}
		 */
		this.callSignatures = [];
		this.returns = [];

	}


	toJSON() {

		return {
			errors: this.errors,
			examples: this.origin.examples,
			original: this.origin.original,
			name: this.name,
			returns: this.returns,
			callSignatures: this.callSignatures
		};

	}


	/**
	 * @param {CallSignature} sig
	 */
	addCallSignature( sig ) {

		if ( sig instanceof CallSignature === false )
			throw new Error( 'sig not a CallSignature' );

		this.callSignatures.push( sig );

	}

	/**
	 * @param {Parameter} param
	 */
	addReturnParam( param ) {

		if ( param instanceof Parameter === false )
			throw new Error( 'param not a Parameter' );

		this.returns.push( param );

	}

}


class CodeFile extends ErrorAndWarnings {

	constructor( original ) {

		super();

		this.original = original;

		/**
		 * @type {Func[]}
		 */
		this.functions = [];

	}


	toJSON() {

		const functions = this.functions.reduce( ( all, fn ) => {

			const callSignatures = fn.callSignatures.filter( cs => {

				if ( cs.errors.length > 0 ) {

					return true;

				} else if ( cs.parameters.some( p => {

					const data = p.toJSON();

					return data.lawTypes.missing.length > 0 || data.realityTypes.wrong.length > 0;

				} ) ) {

					return true;

				}

				return false;

			} );

			const returns = fn.returns.filter( ret => {

				const data = ret.toJSON();

				if ( data.lawTypes.missing.length > 0 || data.realityTypes.wrong.length > 0 )
					return true;
				else
					return false;

			} );

			const totalHits = callSignatures.length + returns.length;

			if ( totalHits > 0 ) {

				all.hits += totalHits;
				all.functions.push( fn );

			}

			return all;

		}, { functions: [], hits: 0 } );

		return {
			errors: this.errors,
			results: functions.functions,
			hits: functions.hits
		};

	}

	toFullJSON() {

		return {
			errors: this.errors,
			results: this.functions
		};

	}

	/**
	 * @param {Func} func
	 */
	addFunction( func ) {

		if ( func instanceof Func === false )
			throw new Error( 'func not a Func' );

		this.functions.push( func );

	}

}


class CheckLawVsReality extends BaseCheck {

	/**
	 * @param {string} basePath
	 * @param {string} profilePath
	 * @param {WritableStream} outputStream
	 */
	constructor( basePath, profilePath, outputStream ) {

		super( basePath, outputStream );

		this.project = new tsmorph.Project();
		this.project.addExistingSourceFiles( path.join( basePath, 'src/**/*.d.ts' ) );
		this.project.addExistingSourceFiles( path.join( basePath, 'examples/jsm/**/*.d.ts' ) );

		const profiles = JSON.parse( fs.readFileSync( profilePath, 'utf8' ) );

		this.filledProfiles = CheckLawVsReality._denormaliseTypeProfiles( profiles );
		this.files = this.filledProfiles;

	}


	/**
	 * @returns {object[]}
	 */
	generateListOfFiles() {

		if ( ! this.files || this.files.length === 0 )
			throw new Error( 'No files found' );

		return this.files;

	}


	async worker() {

		// glob all relevant files
		this.generateListOfFiles();

		this.logger.debug( `Analyzing ${this.files.length} files...` );

		/**
		 * @type {Object.<string, CodeFile>}
		 */
		const results = {};

		for ( const prof of this.files ) {

			const codeFile = ( prof.original.file in results ) ? results[ prof.original.file ] : new CodeFile( prof.original.file );
			results[ prof.original.file ] = codeFile;

			this.logger.note( 'next...\n' );

			const defFile = path.join( this.basePath, prof.original.file.replace( '.js', '.d.ts' ) );
			const basename = path.basename( prof.original.file, '.js' );

			this.logger.debug( 'Get source object for', defFile );
			const sourceFile = this.project.getSourceFile( defFile );

			if ( sourceFile === undefined ) {

				codeFile.addError( 'no source file found?' );

				this.logger.error( 'no source file found?' );

				continue;

			}

			const target = CheckLawVsReality._getClassOrNamespaceOrFunctionsOrVariables( sourceFile, basename );
			if ( target === undefined ) {

				codeFile.addError( 'Failed to detect a viable target class, namespace or functions, skipping...' );

				this.logger.error( 'Failed to detect a viable target class, namespace or functions, skipping...' );

				continue;

			}

			this.logger.debug( 'prof.func.name:', prof.func.name );

			const func = new Func( prof.func.name, prof );
			codeFile.addFunction( func );

			if ( func.name === '-anonymous-' ) {

				func.addError( 'Anonymous function, skipping for now...' );

				continue;

			}

			const allParams = [];
			const retvals = [];

			// check if we might be dealing with a constructor
			if (
				Array.isArray( target ) === false &&
				tsmorph.TypeGuards.isClassDeclaration( target ) &&
				(
					func.name === basename ||					// constructor
					regexBufferAttributes.test( func.name ) ||	// One of the BufferAttributes
					regexBufferGeometry.test( func.name )		// One of the BufferGeometries
				)
			) {

				this.logger.debug( 'Constructor entry? %j %j', prof.func, prof.original );

				const constructors = target.getConstructors();

				// did we find any constructors?
				if ( constructors.length === 0 ) {

					func.addError( 'Possible constructor result, but no constructors found, skipping...' );

					this.logger.error( 'no constructors found, skipping...' );

					continue;

				} else {

					// for all detected constructors
					for ( const cst of constructors ) {

						// get all possible parameters of all constructor signatures
						allParams.push( cst.getParameters() );

						// get all return types
						const returnType = cst.getReturnType().getApparentType();

						// some light processing to check for arrays, etc.
						const types = CheckLawVsReality._processReturnType( returnType );

						// add to the pile
						retvals.push( ...types );

					}

				}

			} else {

				// not a constructor, so collect all functions we can find
				let funcs = [];

				if ( Array.isArray( target ) ) {

					if ( target.every( t => tsmorph.TypeGuards.isFunctionDeclaration( t ) ) ) {

						// simple function declaration
						funcs = target;

					} else if ( target.every( t => tsmorph.TypeGuards.isVariableDeclaration( t ) ) ) {

						// var foo = { bar: function() { } }
						funcs = target.reduce( ( all, v ) => {

							all.push( ...v.getDescendantsOfKind( tsmorph.SyntaxKind.MethodSignature ) );

							return all;

						}, [] );

					}

				} else if ( tsmorph.TypeGuards.isClassDeclaration( target ) ) {

					// class foo { bar() { } }
					funcs = target.getMethods();

				} else if ( tsmorph.TypeGuards.isNamespaceDeclaration( target ) ) {

					funcs = target.getFunctions();

				}

				// select all function declarations that match our current one
				const allFuncs = funcs.filter( f => f.getName() === prof.func.name );

				// none found? -> add warning and skip this one
				if ( allFuncs.length === 0 ) {

					func.addError( `Couldn't find a suitable method or function, skipping...` );

					this.logger.warn( `Couldn't find method/function for "${prof.func.name}", next...` );

					continue;

				} else {

					// for all detected functions
					for ( const f of allFuncs ) {

						// collect all possible parameters of all matching functions
						allParams.push( f.getParameters() );

						// get the return types
						const returnType = f.getReturnType().getApparentType();

						// some light processing to check for arrays, etc.
						const types = CheckLawVsReality._processReturnType( returnType );

						// add
						retvals.push( ...types );

					}

				}

			}


			//
			// extract the actually valid parameters
			//
			const lawParams = allParams.map( ps => CheckLawVsReality._extractLawParameters( ps ) );


			//
			// drop 'args' parameter, it messes with ( ...foo[] ) in *.d.ts and the special 'arguments' variable in *.js
			//
			const realityParams = prof.params.reduce( ( all, p ) => {

				if ( p.name === 'args' && p.types.length === 0 )
					return all;

				const types = p.types.map( t => new Type( t ) );

				all.push( { name: p.name, types, index: p.index } );

				return all;

			}, [] );


			this.logger.log( 'Params check:' );

			let fullMatchName;
			lawParams.forEach( ( params, sigIndex ) => { // for every CallSignature with parameters "params"

				if ( fullMatchName === true )
					return;

				this.logger.debug( 'Call signature:', sigIndex );

				const callSignature = new CallSignature( sigIndex );
				func.addCallSignature( callSignature );

				if ( params.length !== realityParams.length ) {

					callSignature.addError( `Number of parameters according to code doesn't match the number in reality: ${params.length} vs. ${realityParams.length}, skipping for now...` );

					this.logger.error( 'no compromise: params.length !== realityParams.length', params.length, realityParams.length, 'skipping...' );

					const paramsL = params.map( p => p.types.map( t => t.name ) );
					const paramsR = realityParams.map( p => p.types.map( t => t.name ) );

					this.logger.debug( '%j %j', paramsL, paramsR );

					return; // different lengths can never be 100%

				}

				for ( const realP of realityParams ) {

					const lawP = params[ realP.index ];

					const Param = new Parameter( lawP.name, realP.name, realP.index, lawP.optional, lawP.rest );

					lawP.types.forEach( t => Param.addLawType( t ) );
					realP.types.forEach( t => Param.addRealityType( t ) );

					callSignature.addParameter( Param );


					//
					// name check
					//
					const degree = Param.matchDegree();
					fullMatchName = ( degree === 'green' );


					//
					// type check
					//
					const typeMatches = Param.typeMatches( this.project );
					const missingLawTypes = Param.missingLawTypes(); // now collect every lawType that's not being used anywhere in typeMatches
					const correctLawTypes = Param.correctLawTypes(); // and all correct ones


					//
					// debug
					//

					// color output
					const nameColor = fullMatchName ? chalk.greenBright.bold : chalk[ degree ]; // hack

					// and merge them together in their respective colors
					const lawTypeString = [
						...correctLawTypes.map( type => chalk.greenBright.bold( type.name ) ),
						...missingLawTypes.map( type => chalk.yellow( type.name ) )
					].join( ',' );

					// realityTypeString is easier, all realityTypes have been used and only need coloring
					const realityTypeString = typeMatches.map( result => result.success ? chalk.greenBright.bold( result.reality.name ) : chalk.red( result.reality.name ) ).join( ',' );

					const lawPString = nameColor( Param.lawName + ( Param.optional ? '?' : '' ) );
					const realityPString = nameColor( Param.realName );

					this.logger.debug( `${Param.index}: LAW: "<${lawTypeString}>${lawPString}"\tREALITY: "<${realityTypeString}>${realityPString}" ${typeMatches.some( m => ! m.success ) ? `ERR ${prof.examples}` : ''}` );

				}

				if ( fullMatchName === false )
					fullMatchName = undefined; // reset

			} );

			//
			// return values comparison
			//
			const RetParam = new Parameter( '-return-', '-return-', 0, false, false ); // placeholder values

			retvals.forEach( r => RetParam.addLawType( new Type( r.text, r.array ) ) );
			prof.retval.forEach( r => RetParam.addRealityType( new Type( r ) ) );

			func.addReturnParam( RetParam );


			// compare them all
			const retvalMatches = RetParam.typeMatches( this.project );
			const missingLawRetvals = RetParam.missingLawTypes(); // just like for the types above, collect every unused return type
			const correctLawRetvals = RetParam.correctLawTypes(); // continue


			// and merge them together in their respective colors
			const lawRetvalString = [
				...correctLawRetvals.map( type => chalk.greenBright.bold( type.name ) ),
				...missingLawRetvals.map( type => chalk.yellow( type.name ) )
			].join( ',' );

			const realityRetvalString = retvalMatches.map( result => result.success ? chalk.greenBright.bold( result.reality.name ) : chalk.red( result.reality.name ) ).join( ',' );

			this.logger.log( `Retval: ${lawRetvalString} vs ${realityRetvalString} ${retvalMatches.some( m => ! m.success ) ? `ERR ${prof.examples}` : ''}` );

		}

		return results;

	}


	/**
	 * @param {{
	 * 	_types: string[],
	 * 	_params: { index: number, name: string, pos: { pos: number }[] }[],
	 *  _originals: { column: number, file: number, line: number }[],
	 *  _lines: string[],
	 *  _functions: { name: string, start: number, startLineNumber: number }[],
	 *  _files: string[],
	 * 	results: NormalisedProfile[]
	 * }} profiles
	 * @returns {DenormalisedProfile[]}
	 */
	static _denormaliseTypeProfiles( profiles ) {

		return profiles.results.map( result => {

			const retval = JSON.parse( JSON.stringify( {
				func: profiles[ "_functions" ][ result.func ],
				params: result.params.map( p => ( { ...profiles[ '_params' ][ p.p ], types: p.t.map( t => profiles[ '_types' ][ t ] ) } ) ),
				retval: result.retval.map( r => profiles[ "_types" ][ r ] ),
				line: profiles[ "_lines" ][ result.line ],
				original: profiles[ "_originals" ][ result.original ],
				// example: result.file.replace( /^.*?typeProfile-examples_(.+?)\.html\.json$/, '$1' ),
				examples: result.file
			} ) );

			retval.original.file = profiles[ '_files' ][ retval.original.file ].slice( 0 );

			return retval;

		} );

	}


	/**
	 * @param {tsmorph.SourceFile} source
	 * @param {string} basename
	 * @returns {tsmorph.ClassDeclaration|tsmorph.NamespaceDeclaration|tsmorph.FunctionDeclaration[]|tsmorph.VariableDeclaration[]|void}
	 */
	static _getClassOrNamespaceOrFunctionsOrVariables( source, basename ) {

		// HACK: i swear it started out little
		const replacements = [
			[ 'CurveExtras', 'Curves' ],
			[ 'Water2', 'Water' ],
			[ 'TessellateModifier', 'SubdivisionModifier' ],
			[ '3MFLoader', 'ThreeMFLoader' ]
		];
		// END HACK, part 1


		let target = source.getClasses().find( klass => klass.getName() === basename );

		if ( target === undefined ) {

			console.log( 'no class found, namespace maybe? there are:', source.getNamespaces().map( space => space.getName() ).join( ', ' ) );

			target = source.getNamespaces().find( space => space.getName() === basename );

			if ( target === undefined ) {

				const entries = [];
				source.getExportedDeclarations().forEach( decls => entries.push( ...decls ) );

				const functions = entries.filter( e => tsmorph.TypeGuards.isFunctionDeclaration( e ) );
				if ( functions.length > 0 ) {

					console.log(
						'not a namespace either, maybe just exported functions? there are:',
						functions.map( decl => decl.getName() ).join( ', ' )
					);

					return functions;

				}

				const variables = entries.filter( e => tsmorph.TypeGuards.isVariableDeclaration( e ) );
				if ( variables.length > 0 ) {

					console.log( 'no class, no namespace, no functions - just variables apparently:', variables.map( v => v.getName() ).join( ', ' ) );

					return variables;

				}


				// HACK: part 2, try it with an alternative basename
				const hit = replacements.findIndex( e => e[ 0 ] === basename );
				if ( hit > - 1 ) {

					basename = replacements[ hit ][ 1 ];

					return CheckLawVsReality._getClassOrNamespaceOrFunctionsOrVariables( source, basename );

				} else {

					console.log( 'i surrender' );
					console.log( entries );
					process.exit();

				}

			}

			console.log( 'namespace it is' );

		}

		return target;

	}


	/**
	 * @param {tsmorph.ParameterDeclaration[]} parameters
	 * @returns {{name: string, optional: boolean, rest: boolean, types: Type[] }[]}
	 */
	static _extractLawParameters( parameters ) {

		return parameters.reduce( ( all, p ) => {

			const pT = p.getType();

			const types = ( pT.isUnion() ) ?
				pT.getUnionTypes().map( t => new Type( t.getText( null, tsmorph.TypeFormatFlags.None ), t.isArray() ) )
				:
				[ new Type( pT.getText( null, tsmorph.TypeFormatFlags.None ), pT.isArray() ) ];

			all.push( {
				name: p.getName(),
				optional: !! p.getQuestionTokenNode(),
				rest: p.isRestParameter(),
				types
			} );

			return all;

		}, [] );

	}



	/**
	 * @param {tsmorph.Type} returnType
	 * @returns {{ text: string, array: boolean, tsType: null }[]}
	 */
	static _processReturnType( returnType ) {

		let types;

		if ( returnType.isUnion() ) {

			types = returnType.getUnionTypes().map( t => ( {
				text: t.getText( null, tsmorph.TypeFormatFlags.None ),
				array: t.isArray(),
				tsType: null
			} ) );

		} else {

			types = [ {
				text: returnType.getText( null, tsmorph.TypeFormatFlags.None ),
				array: returnType.isArray(),
				tsType: null
			} ];

		}

		return types;

	}

}


// simple CLI-fication
if ( require.main === module ) {

	( async() => {

		if ( process.argv.length != 5 ) {

			console.error( 'Invalid number of arguments' );

			console.log( `Usage: ${path.basename( process.argv[ 0 ] )} ${process.argv[ 1 ]} <basePath> <profilePath> <outputFilename>` );

			process.exit( - 1 );

		}


		// setup
		// eslint-disable-next-line no-unused-vars
		const [ node, script, basePath, profilePath, outputFilename ] = process.argv;
		const outputStream = fs.createWriteStream( outputFilename, { flags: 'w', encoding: 'utf8' } );


		// analyze
		const check = new CheckLawVsReality( basePath, profilePath, outputStream );
		const result = await check.run( basePath, outputStream );


		// done
		const util = require( 'util' );
		console.log( "RESULT:", util.inspect( result, false, 9, true ) );
		// console.log( "RESULT:", result );

	} )();

}


module.exports = {
	Type,
	Parameter,
	CheckLawVsReality
};

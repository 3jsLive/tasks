/*

	Compare what's written in the source files
	with what's in the *.d.ts files for that class

	For now we're only checking ShaderLib/-Chunks and UniformLib.

	Type: Static
	Needs build: No
	Needs docs: No
	Needs examples: No
	Needs source: Yes

	TODO: Investigate whether we should check more source files,
			possibly all of them, or if the TypeScript compiler is
			better suited for this
			Maybe the number of parameters and their names? A bit
			too simple possibly.

*/

const fs = require( 'fs' );
const path = require( 'path' );
const acorn = require( 'acorn' );
const esquery = require( 'esquery' );
const tsmorph = require( 'ts-morph' );


const PATH_SHADER_CHUNK = 'src/renderers/shaders/ShaderChunk.js';
const PATH_SHADER_LIB = 'src/renderers/shaders/ShaderLib.js';
const PATH_UNIFORMS_LIB = 'src/renderers/shaders/UniformsLib.js';


const BaseCheck = require( './BaseCheck' );


class CompareDeclarationsWithSource extends BaseCheck {

	async worker() {

		// create typescript project and add declaration files
		let project;
		try {

			project = new tsmorph.Project();
			project.addExistingSourceFiles( path.join( this.basePath, 'src/**/*.d.ts' ) );

		} catch ( err ) {

			this.logger.fatal( 'Failed creating TS project:', err );

			throw err;

		}


		// run the tests
		const shaderChunk = this._checkShaderChunk( project );
		const shaderLib = this._checkShaderLib( project );
		const uniformsLib = this._checkUniformsLib( project );

		return {
			errors: [],
			hits: shaderChunk.hits + shaderLib.hits + uniformsLib.hits,
			results: {
				[ PATH_SHADER_CHUNK ]: shaderChunk,
				[ PATH_SHADER_LIB ]: shaderLib,
				[ PATH_UNIFORMS_LIB ]: uniformsLib
			}
		};

	}


	/**
	 * Verifies that imports === exports and compares the .d.ts with exports in the .js
	 * @param {tsmorph.Project} project TypeScript project
	 */
	_checkShaderChunk( project ) {

		const logger = this.logger.scope( 'checkShaderChunk' );

		const retval = {
			onlySource: { methods: [], properties: [] },
			onlyDecl: { methods: [], properties: [] }
		};

		const result = { errors: [], results: [], hits: 0 };

		try {

			//
			// Query the JavaScript AST
			//
			const ast = acorn.parse(
				fs.readFileSync( path.join( this.basePath, PATH_SHADER_CHUNK ), 'utf8' ),
				{ sourceType: "module", ecmaVersion: 9 }
			);

			const imports = esquery( ast, 'ImportDeclaration Identifier' );
			const exportNodes = esquery( ast, 'ExportNamedDeclaration VariableDeclarator[id.name="ShaderChunk"] .properties .key' );

			const importNames = imports.map( imp => imp.name );
			const exportNames = exportNodes.map( exp => exp.name );

			logger.debug( 'imports %o', imports.map( node => node.name ) );
			logger.debug( 'exports %o', exportNodes.map( node => node.name ) );


			//
			// Load and query the TypeScript AST
			//
			const shaderChunkTs = project.getSourceFileOrThrow( 'ShaderChunk.d.ts' );
			const shaderChunkExports = shaderChunkTs.getVariableDeclarationOrThrow( 'ShaderChunk' );
			const props = shaderChunkExports.getDescendantsOfKind( tsmorph.SyntaxKind.PropertySignature );
			const propNames = props.map( prop => prop.getName() );
			logger.debug( 'decl props %o', propNames );

			// Go crazy diff-ing
			const consistencyCheck = [ ...this._difference( importNames, exportNames ) ];
			const diffSourceDecl = [ ...this._difference( importNames, propNames ) ];
			const diffDeclSource = [ ...this._difference( propNames, importNames ) ];

			// Debug
			logger.debug( 'Diff imports - exports:', consistencyCheck.join( ', ' ) );
			logger.debug( 'Diff imports - declEntries:', diffSourceDecl.join( ', ' ) );
			logger.debug( 'Diff declEntries - imports:', diffDeclSource.join( ', ' ) );

			// Quick check
			if ( consistencyCheck.length > 0 )
				throw new Error( `Different imports vs exports: ${consistencyCheck.join( ', ' )}` );

			retval.onlyDecl.properties = diffDeclSource;
			retval.onlySource.properties = diffSourceDecl;

		} catch ( err ) {

			this.logger.error( err );

			result.errors.push( { message: err.message.replace( this.basePath, '' ), code: err.code, location: err.location ? err.location : null } );

			return result;

		}

		// Done
		result.results.push( retval );
		result.hits = retval.onlyDecl.properties.length + retval.onlySource.properties.length;

		return result;

	}


	/**
	 * Compares .d.ts with exports in .js
	 * @param {tsmorph.Project} project TypeScript project
	 */
	_checkUniformsLib( project ) {

		const logger = this.logger.scope( 'checkUniformsLib' );

		const retval = {
			onlySource: { methods: [], properties: [] },
			onlyDecl: { methods: [], properties: [] }
		};

		const result = { errors: [], results: [], hits: 0 };

		// very elegant indeed
		try {

			//
			// Query the JavaScript AST
			//
			const ast = acorn.parse(
				fs.readFileSync( path.join( this.basePath, PATH_UNIFORMS_LIB ), 'utf8' ),
				{ sourceType: "module", ecmaVersion: 9 }
			);

			const uniformslib = esquery( ast, 'VariableDeclarator > ObjectExpression' );
			const tree = uniformslib[ 0 ].properties.reduce( this._reducer.bind( this ), {} );
			logger.debug( 'tree %o', tree );

			//
			// Query the TypeScript AST
			//
			const uniformsLibTs = project.getSourceFileOrThrow( 'UniformsLib.d.ts' );
			const uniformsLibExports = uniformsLibTs.getVariableDeclarationOrThrow( 'UniformsLib' );
			const props = uniformsLibExports.getDescendantsOfKind( tsmorph.SyntaxKind.PropertySignature );
			const propNames = props.map( prop => prop.getName() );
			logger.debug( 'propNames %o', propNames );


			//
			// Build export tree
			//
			const exportTree = uniformsLibExports.getTypeNode().getMembers().reduce( this._reducerTS.bind( this ), {} );


			//
			// Flatten everything for comparison
			//
			const flattenedTree = this._flattenObject( tree );
			const flattenedExportTree = this._flattenObject( exportTree );
			logger.debug( 'flattened tree %o', flattenedTree );
			logger.debug( 'flattened exportTree %o', flattenedExportTree );

			// Diff the two
			retval.onlySource.properties = [ ...this._difference( Object.keys( flattenedTree ), Object.keys( flattenedExportTree ) ) ];
			retval.onlyDecl.properties = [ ...this._difference( Object.keys( flattenedExportTree ), Object.keys( flattenedTree ) ) ];

			// Debug
			logger.debug( 'diff source decl', retval.onlySource.properties.join( ', ' ) );
			logger.debug( 'diff decl source', retval.onlyDecl.properties.join( ', ' ) );

		} catch ( err ) {

			this.logger.error( err );

			result.errors.push( { message: err.message.replace( this.basePath, '' ), code: err.code, location: err.location ? err.location : null } );

			return result;

		}

		// Done
		result.results.push( retval );
		result.hits = retval.onlySource.properties.length + retval.onlyDecl.properties.length;

		return result;

	}


	/**
	 * Compare .d.ts with exports in .js
	 * @param {tsmorph.Project} project TypeScript project
	 */
	_checkShaderLib( project ) {

		const logger = this.logger.scope( 'checkShaderLib' );

		const retval = {
			onlySource: { methods: [], properties: [] },
			onlyDecl: { methods: [], properties: [] }
		};

		const result = { errors: [], results: [], hits: 0 };

		// very elegant indeed
		try {

			//
			// Query the JavaScript AST
			//
			const ast = acorn.parse(
				fs.readFileSync( path.join( this.basePath, PATH_SHADER_LIB ), 'utf8' ),
				{ sourceType: "module", ecmaVersion: 9 }
			);

			// there's an extra 'ShaderLib.physical' tucked away at the end of the file
			// hence the second selector
			const exportNodes = esquery( ast, ':matches(VariableDeclarator[id.name="ShaderLib"] > ObjectExpression > Property > .key, AssignmentExpression > MemberExpression[object.name="ShaderLib"] .property )' );
			const exportNames = exportNodes.map( exp => exp.name );
			logger.debug( 'exportNames %o', exportNames );


			//
			// Query the TypeScript AST
			//
			const shaderLibTs = project.getSourceFileOrThrow( 'ShaderLib.d.ts' );
			const shaderLibExports = shaderLibTs.getVariableDeclarationOrThrow( 'ShaderLib' );
			const props = shaderLibExports.getDescendantsOfKind( tsmorph.SyntaxKind.PropertySignature );
			const propNames = props.map( prop => prop.getName() );
			logger.debug( 'propNames %o', propNames );


			//
			// Finish up
			//
			retval.onlyDecl.properties = [ ...this._difference( propNames, exportNames ) ];
			retval.onlySource.properties = [ ...this._difference( exportNames, propNames ) ];

			// Debug
			logger.debug( 'Diff declEntries - exports:', retval.onlyDecl.properties.join( ', ' ) );
			logger.debug( 'Diff exports - declEntries:', retval.onlySource.properties.join( ', ' ) );

		} catch ( err ) {

			this.logger.error( err );

			result.errors.push( { message: err.message.replace( this.basePath, '' ), code: err.code, location: err.location ? err.location : null } );

			return result;

		}

		// Done
		result.results.push( retval );
		result.hits = retval.onlyDecl.properties.length + retval.onlySource.properties.length;

		return result;

	}


	_difference( iterableA, iterableB ) {

		let difference = new Set( iterableA );

		for ( const elem of iterableB ) {

			difference.delete( elem );

		}

		return difference;

	}


	_reducer( all, cur ) {

		if ( cur.value && cur.value.type === 'ObjectExpression' )
			all[ cur.key.name ] = cur.value.properties.reduce( this._reducer.bind( this ), {} );
		else
			all[ cur.key.name ] = cur.value.type;
		return all;

	}


	/**
	 * @param {any[]} all
	 * @param {tsmorph.Node} cur
	 */
	_reducerTS( all, cur ) {

		const logger = this.logger.scope( 'reducerTS' );

		if ( cur.getType().getText() === 'THREE.IUniform' ) {

			all[ cur.getName() ] = { value: cur.getType().getText() };

			return all;

		}

		if ( cur.getKind() === tsmorph.SyntaxKind.ArrayType ) {

			all[ 'value' ] = null;

			return all;

		}

		if ( [ 'Identifier', 'ColonToken', 'SemicolonToken' ].includes( cur.getKindName() ) )
			return all;

		if ( cur.getKind() === tsmorph.SyntaxKind.PropertySignature && cur.getChildren().length > 0 ) {

			const child = cur.getChildren().reduce( this._reducerTS.bind( this ), {} );

			all[ cur.getName() ] = { ...child[ cur.getName() ] };

		} else if ( cur.getKindName() === 'TypeLiteral' ) {

			const members = cur.getMembers().reduce( this._reducerTS.bind( this ), {} );

			all[ cur.getParent().getName() ] = members;

		} else {

			logger.debug(
				'Kind',	cur.getKindName(),
				'Value Type:', cur
					.getChildrenOfKind( tsmorph.SyntaxKind.PropertySignature )
					.map( child => `${child.getName()}(${child.getType().getText()})` )
					.join( ', ' )
			);

		}

		return all;

	}


	/**
	 * Flatten an object by hierarchically appending its keys
	 * @param {object} obj
	 * @param {string} prefix
	 * @returns {object.<string, any>}
	 */
	_flattenObject( obj, prefix = '' ) {

		return Object.keys( obj ).reduce( ( acc, k ) => {

			const pre = prefix.length ? prefix + '.' : '';

			if ( typeof obj[ k ] === 'object' && obj[ k ] !== null && Object.keys( obj[ k ] ).length > 0 )
				Object.assign( acc, this._flattenObject( obj[ k ], pre + k ) );
			else
				acc[ pre + k ] = obj[ k ];

			return acc;

		}, {} );

	}

}



// simple CLI-fication
if ( require.main === module ) {

	( async() => {

		if ( process.argv.length != 4 ) {

			console.error( 'Invalid number of arguments' );

			console.log( `Usage: ${path.basename( process.argv[ 0 ] )} ${process.argv[ 1 ]} <basePath> <outputFilename>` );

			process.exit( - 1 );

		}


		// setup
		// eslint-disable-next-line no-unused-vars
		const [ node, script, basePath, outputFilename ] = process.argv;
		const outputStream = fs.createWriteStream( outputFilename, { flags: 'w', encoding: 'utf8' } );
		const check = new CompareDeclarationsWithSource( basePath, outputStream );

		// analyze
		const result = await check.run( basePath, outputStream );


		// done
		console.log( "RESULT:", result );

	} )();

}

module.exports = CompareDeclarationsWithSource;

/*

	Start the TypeScript compiler once for both JavaScript and TypeScript
	and once for TypeScript-only

*/

const Promise = require( 'bluebird' );
const ts = require( 'typescript' );
const fs = require( 'fs' );
const glob = Promise.promisifyAll( require( 'glob' ) );
const path = require( 'path' );

const { Project } = require( 'ts-morph' );

const BaseCheck = require( './BaseCheck' );

// reverse-modularize basically, turn every
// 		"import foo from three.module.js"
// into
// 		"import foo from ../src/bar/Foo"
// so we can use the full type declarations
// because there is no connection between three.module.js line (e.g.) 220 and the
// cameras/Camera.d.ts that would add types to it






// CURRENTLY BORKED, line numbers are off I think
// update: still?
// TODO: check line numbers











class CheckWithTSCompiler extends BaseCheck {

	async generateListOfFiles() {

		try {

			const allFiles = glob.globAsync( path.join( this.basePath, 'src/**/*.d.ts' ) );

			this.files = await Promise.map( allFiles, ( file ) => ( { absolute: file, relative: path.relative( this.basePath, file ) } ) );

		} catch ( err ) {

			this.logger.fatal( 'Listing files failed:', err );

			throw err;

		}

		if ( ! this.files || this.files.length === 0 )
			throw new Error( 'No files found' );

		return this.files;

	}


	async worker() {

		await this.generateListOfFiles();
		await this.createClass2File();

		const filesJs = [
			...glob.sync( path.join( this.basePath, '/src/**/*.js' ) ),
			...glob.sync( path.join( this.basePath, '/examples/jsm/**/*.js' ) )
		];

		const filesDts = [
			...glob.sync( path.join( this.basePath, '/src/**/*.d.ts' ) ),
			...glob.sync( path.join( this.basePath, '/examples/jsm/**/*.d.ts' ) )
		];

		return {
			js: this._compile( COMPILER_OPTIONS_JS, filesJs ),
			dts: this._compile( COMPILER_OPTIONS_TS, filesDts )
		};

	}


	async createClass2File() {

		const regex = /export class (.*?) /gm;
		// const regex = /export (const|class) (.*?)(:.*?)? /gm; // TODO: test this

		this.class2file = {};

		for ( const file of this.files ) {

			const content = await fs.promises.readFile( file.absolute, 'utf8' );

			let m = regex.exec( content );
			while ( m !== null ) {

				m.forEach( ( match, groupIndex ) => {

					if ( groupIndex > 0 )
						this.class2file[ match ] = file.relative.replace( /\.d\.ts$/, '' );

				} );

				m = regex.exec( content );

			}

		}

		return this.class2file;

	}


	// TODO: include <script> tags from HTML?
	createCustomCompilerHost( settings ) {

		const project = new Project( { compilerOptions: { removeComments: false } } );

		let host = ts.createCompilerHost( settings.options );

		host.getSourceFile = ( filename, languageVersion ) => {

			try {

				const content = fs.readFileSync( filename, 'utf8' );

				const source = project.createSourceFile( filename, content, { overwrite: true } );

				if ( filename.includes( 'examples/jsm/' ) ) {

					// the proper way to do this would probably be to CodeWriter' a whole new file
					source.getImportDeclarations().forEach( decl => {

						// console.log( 'decl.getText()', decl.getText(), decl.getText().split( /\n/g ).length );

						if ( decl.getModuleSpecifier().getLiteralText().includes( 'build/three' ) ) {

							// console.log( filename );
							// console.log( 'IMP LINES END POSSIBLY', decl.getNamedImports().slice( - 1 )[ 0 ].getEndLineNumber() );
							// console.log( 'DECL NEXT SIBLING AT', decl.getNextSibling().getStartLineNumber(), 'OF KIND', decl.getNextSibling().getKindName() );

							const imports = decl.getNamedImports().map( imp => {

								return {
									name: imp.getName(),
									alias: ( imp.getAliasNode() ) ? imp.getAliasNode().getText() : false
								};

							} );

							const decls = imports.map( ( { name, alias } ) => {

								// console.log( "0", decl.getStructure() );
								// console.log( "1", decl.getText() );
								if ( this.class2file[ name ] )
									decl.setModuleSpecifier( '../../../' + this.class2file[ name ] );
								else
									decl.setModuleSpecifier( '../../../build/three.module.js' );
								// console.log( "2", decl.getText() );
								decl.removeNamedImports();
								// console.log( "3", decl.getText() );
								const impSpec = decl.addNamedImport( name );
								if ( alias )
									impSpec.setAlias( alias );
								// console.log( "4", decl.getText() );
								const structure = decl.getStructure();

								return structure;

							} );

							// const triv = decl.getLeadingCommentRanges().map( range => range.getText() ).join( '\n' );
							// const triv = decl.getLeadingCommentRanges().map( range => range.getText() ).join( '\n' );
							const trivEnd = decl.getTrailingCommentRanges().map( range => range.getText() ).join( '\n' );
							const declFullTextLength = decl.getFullText().split( /\n/g ).length;
							// console.log( 'DECL', decl.getText() );
							// console.log( 'TRIV', triv );
							// console.log( 'TRIV END', trivEnd );
							// console.log( 'DECL FULLTEXT LINES', declFullTextLength );
							// console.log( 'DECLS', { decls } );
							// console.log( 'PRE', source.getFullText().slice( 0, 1000 ) );

							// FIXME: wtf does this not break something but the 'triv' replacement does?
							// decl.replaceWithText( [ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20 ].map( num => num.toString() ).join( '\n' ) );
							// decl.replaceWithText( triv );

							// decl.remove();
							decls[ 0 ].leadingTrivia = '// buffer line //\n'.repeat( declFullTextLength );
							decls.slice( - 1 )[ 0 ].trailingTrivia = '\n' + trivEnd;
							source.addImportDeclarations( decls );

						}

						decl.replaceWithText( '// buffer line //' );

						console.log( 'POST', source.getFullText().split( /\n/g ).slice( 0, 40 ).map( ( line, index ) => `${index + 1} ${line}` ).join( '\n' ) );

					} );

				}

				return ts.createSourceFile( filename, source.getFullText(), languageVersion );

			} catch ( err ) {

				this.logger.error( 'getSourceFile failed for', filename, err );

				throw err;

			}

		};

		host.writeFile = () => {};

		host.getCanonicalFileName = ( name ) => name;

		host.useCaseSensitiveFileNames = () => true;

		host.getNewLine = () => '\n';

		return host;

	}


	/**
	 * @param {object} compilerOptionsJson
	 * @param {string} basePath
	 * @param {string[]} files
	 */
	_compile( compilerOptionsJson, files ) {

		const settings = ts.convertCompilerOptionsFromJson( compilerOptionsJson, this.basePath );
		if ( ! settings.options ) {

			for ( const err of settings.errors )
				this.logger.fatal( err );

			throw new Error( 'Error in compiler options' );

		}


		let allDiagnostics;

		const host = this.createCustomCompilerHost( settings );

		try {

			const program = ts.createProgram( files, settings.options, host );

			const emitResult = program.emit();

			allDiagnostics = ts.getPreEmitDiagnostics( program ).concat( emitResult.diagnostics );

		} catch ( err ) {

			this.logger.fatal( 'create/emit program failed:', err );

			throw err;

		}

		const results = allDiagnostics.reduce( ( all, diagnostic ) => {

			if ( ! diagnostic.file )
				return all;

			// skip those
			if ( diagnostic.file.fileName.includes( 'build/three.module.js' ) )
				return all;

			const fileRelative = path.relative( this.basePath, diagnostic.file.fileName );

			try {

				const { line, character } = diagnostic.file.getLineAndCharacterOfPosition( diagnostic.start );
				const message = ts.flattenDiagnosticMessageText( diagnostic.messageText, '\n' );

				this.logger.debug( `${diagnostic.file.fileName} (${line + 1},${character + 1}) TS${diagnostic.code}: ${message}` );

				all[ fileRelative ] = all[ fileRelative ] || { errors: [], results: [] };
				all[ fileRelative ].results.push( {
					line: line + 1,
					character: character + 1,
					message,
					start: diagnostic.start,
					length: diagnostic.length,
					code: diagnostic.code
				} );

			} catch ( err ) {

				this.logger.error( 'diagnostics failed for', fileRelative, err );

				all[ fileRelative ] = { errors: [ err ], results: [] };

			}

			return all;

		}, {} );

		return { errors: [], results };

	}


}


const COMPILER_OPTIONS_JS = {
	/* Basic Options */
	"target": "es5", /* Specify ECMAScript target version: 'ES3' (default), 'ES5', 'ES2015', 'ES2016', 'ES2017', 'ES2018', 'ES2019' or 'ESNEXT'. */
	"module": "amd", /* Specify module code generation: 'none', 'commonjs', 'amd', 'system', 'umd', 'es2015', or 'ESNext'. */
	// "lib": [ "es2015", "dom" ], /* Specify library files to be included in the compilation. */
	"allowJs": true, /* Allow javascript files to be compiled. */
	"checkJs": true, /* Report errors in .js files. */
	// "jsx": "preserve",                     /* Specify JSX code generation: 'preserve', 'react-native', or 'react'. */
	// "declaration": true,                   /* Generates corresponding '.d.ts' file. */
	// "declarationMap": true,                /* Generates a sourcemap for each corresponding '.d.ts' file. */
	// "sourceMap": true,                     /* Generates corresponding '.map' file. */
	// "outFile": "./",                       /* Concatenate and emit output to single file. */
	"outDir": "./out", /* Redirect output structure to the directory. */
	"rootDir": "./src", /* Specify the root directory of input files. Use to control the output directory structure with --outDir. */
	// "composite": true,                     /* Enable project compilation */
	// "incremental": true,                   /* Enable incremental compilation */
	// "tsBuildInfoFile": "./",               /* Specify file to store incremental compilation information */
	// "removeComments": true,                /* Do not emit comments to output. */
	// "noEmit": true,                        /* Do not emit outputs. */
	// "importHelpers": true,                 /* Import emit helpers from 'tslib'. */
	// "downlevelIteration": true,            /* Provide full support for iterables in 'for-of', spread, and destructuring when targeting 'ES5' or 'ES3'. */
	// "isolatedModules": true,               /* Transpile each file as a separate module (similar to 'ts.transpileModule'). */

	/* Strict Type-Checking Options */
	"strict": true, /* Enable all strict type-checking options. */
	// "noImplicitAny": true,                 /* Raise error on expressions and declarations with an implied 'any' type. */
	// "strictNullChecks": true,              /* Enable strict null checks. */
	// "strictFunctionTypes": true,           /* Enable strict checking of function types. */
	// "strictBindCallApply": true,           /* Enable strict 'bind', 'call', and 'apply' methods on functions. */
	// "strictPropertyInitialization": true,  /* Enable strict checking of property initialization in classes. */
	// "noImplicitThis": true,                /* Raise error on 'this' expressions with an implied 'any' type. */
	// "alwaysStrict": true,                  /* Parse in strict mode and emit "use strict" for each source file. */

	/* Additional Checks */
	"noUnusedLocals": true, /* Report errors on unused locals. */
	"noUnusedParameters": true, /* Report errors on unused parameters. */
	"noImplicitReturns": true, /* Report error when not all code paths in function return a value. */
	"noFallthroughCasesInSwitch": true, /* Report errors for fallthrough cases in switch statement. */

	/* Module Resolution Options */
	// "moduleResolution": "node",            /* Specify module resolution strategy: 'node' (Node.js) or 'classic' (TypeScript pre-1.6). */
	// "baseUrl": "./",                       /* Base directory to resolve non-absolute module names. */
	// "paths": {},                           /* A series of entries which re-map imports to lookup locations relative to the 'baseUrl'. */
	"rootDirs": [ "src" ], /* List of root folders whose combined content represents the structure of the project at runtime. */
	"typeRoots": [ "src" ], /* List of folders to include type definitions from. */
	// "types": [],                           /* Type declaration files to be included in compilation. */
	// "allowSyntheticDefaultImports": true,  /* Allow default imports from modules with no default export. This does not affect code emit, just typechecking. */
	"esModuleInterop": true /* Enables emit interoperability between CommonJS and ES Modules via creation of namespace objects for all imports. Implies 'allowSyntheticDefaultImports'. */
	// "preserveSymlinks": true,              /* Do not resolve the real path of symlinks. */

	/* Source Map Options */
	// "sourceRoot": "",                      /* Specify the location where debugger should locate TypeScript files instead of source locations. */
	// "mapRoot": "",                         /* Specify the location where debugger should locate map files instead of generated locations. */
	// "inlineSourceMap": true,               /* Emit a single file with source maps instead of having a separate file. */
	// "inlineSources": true,                 /* Emit the source alongside the sourcemaps within a single file; requires '--inlineSourceMap' or '--sourceMap' to be set. */

	/* Experimental Options */
	// "experimentalDecorators": true,        /* Enables experimental support for ES7 decorators. */
	// "emitDecoratorMetadata": true,         /* Enables experimental support for emitting type metadata for decorators. */
};


const COMPILER_OPTIONS_TS = {
	"target": "ESNEXT",
	"module": "amd",
	"outDir": "./out",
	"rootDir": "./src",
	"strict": true,
	"rootDirs": [ "src" ],
	"typeRoots": [ "src" ],
	"esModuleInterop": true
};


// simple CLI-fication
if ( require.main === module ) {

	if ( process.argv.length != 4 ) {

		console.error( 'Invalid number of arguments' );

		console.log( `Usage: ${path.basename( process.argv[ 0 ] )} ${process.argv[ 1 ]} <basePath> <outputFilename>` );

		process.exit( - 1 );

	}


	// setup
	// eslint-disable-next-line no-unused-vars
	const [ node, script, basePath, outputFilename ] = process.argv;
	const outputStream = fs.createWriteStream( outputFilename, { flags: 'w', encoding: 'utf8' } );


	// analyze
	const check = new CheckWithTSCompiler( basePath, outputStream );
	const result = check.run( basePath, outputStream );


	// done
	console.log( "RESULT:", result );

}


module.exports = CheckWithTSCompiler;

const fs = require( 'fs' );
const path = require( 'path' );
const tsmorph = require( 'ts-morph' );
const esquery = require( 'esquery' );
const acorn = require( 'acorn' );


const BaseCheck = require( './BaseCheck' );


/*

	Very hacky, probably lots of false pos/neg, but essentially:
		1) instantiate a new object of class $foo
		2) look at its properties and functions
		3) does it have any that are missing in $foo.d.ts and vice versa?
		4) safety-check: is it referenced in Three.Legacy.js?

	Type: Dynamic
	Needs build: Yes
	Needs docs: No
	Needs examples: No
	Needs source: Yes

	TODO: Declaration files can have @deprecated modifiers, how to incorporate them?
		// const util = require( 'util' );
		// console.log( util.inspect( project
		// 	.getTypeChecker()
		// 	.getPropertiesOfType( declType )
		// 	.map( prop => prop.getDeclarations().map( decl => decl.getNodeProperty( 'jsDoc' ) ) ), true, 4, true ) );
		// continue;

	TODO: sort into properties and methods?

	TODO: examples/ js + jsm

*/

class CompareDeclarationsWithInstancedObjects extends BaseCheck {

	async worker() {

		try {

			this.three = require( this.basePath );

		} catch ( err ) {

			this.logger.fatal( `Failed to load THREE: ${err.message}` );

			throw new Error( `Failed to load THREE from ${this.basePath}` );

		}

		//
		// Create the typescript project and add declaration files
		//
		try {

			this.project = new tsmorph.Project();
			this.project.addExistingSourceFiles( path.join( this.basePath, 'src/**/*.d.ts' ) );

		} catch ( err ) {

			this.logger.fatal( `Failed to add source files to project: ${err.message}` );

			throw new Error( `Failed to add source files: ${err.message.replace( this.basePath, '' )}` );

		}


		//
		// Create our AST for Three.Legacy.js sanity checks
		// We could use the typescript parser, but esquery is very nifty
		//
		try {

			this.ast = acorn.parse(
				fs.readFileSync( path.join( this.basePath, 'src/Three.Legacy.js' ), 'utf8' ),
				{ sourceType: "module", ecmaVersion: 9 }
			);

		} catch ( err ) {

			this.logger.fatal( `Failed to load AST for Three.Legacy: ${err.message}` );

			throw new Error( `Failed to load Three.Legacy: ${err.message.replace( this.basePath, '' )}` );

		}


		//
		// Get all classes from all source files and start looping over them
		//
		let totalHits = 0;
		const results = this.project.getSourceFiles().reduce( ( all, file ) => {

			this.logger.debug( 'File', file.getFilePath() );


			// all classes in one of those files, if there are any
			const classes = file.getClasses();

			if ( classes.length === 0 )
				return all;


			// normalize and start working
			const relativeFilePath = path.relative( this.basePath, file.getFilePath() );

			try {

				const work = classes.reduce( ( all, cur ) => this.reduceClassCollection( all, cur ), { errors: [], hits: 0, results: [] } );

				if ( ( work.errors && work.errors.length > 0 ) || ( work.results && work.results.length > 0 ) )
					all[ relativeFilePath ] = work;

				totalHits += work.hits;

			} catch ( err ) {

				this.logger.error( relativeFilePath, 'failure:', err );

				all[ relativeFilePath ] = { errors: [ { message: err.message.replace( this.basePath, '' ) } ], hits: 0, results: [] };

			}

			return all;

		}, {} );

		return { errors: [], hits: totalHits, results: results };

	}

	/**
	 * @param {object} allClasses
	 * @param {tsmorph.Node} singleClass
	 */
	reduceClassCollection( allClasses, singleClass ) {

		const declType = singleClass.getType();	// TS type for this class
		const name = singleClass.getName();		// convenience


		// skip if not "officially" exported
		if ( typeof this.three[ name ] === 'undefined' )
			return allClasses;


		try {

			// try and create an instance
			const klass = new this.three[ name ]();
			if ( ! klass ) {

				// logger.debug( 'BAIL', name );
				return allClasses;

			}


			// collect all properties TypeScript knows about
			const declProps = this.project.getTypeChecker().getPropertiesOfType( declType ).map( prop => prop.getName() );

			// collect all properties JavaScript has "access" to, all up the prototype chain
			const jsProps = this._getOwnAndPrototypeEnumerablesAndNonenumerables( klass )
				.filter( ( x, i, a ) => a.indexOf( x ) === i )
				.sort();


			// restrict to props missing from *.d.ts
			const inJsAndNotTs = jsProps.filter( x => declProps.indexOf( x ) === - 1 );

			// and vice versa
			const inTsAndNotJs = declProps.filter( x => jsProps.indexOf( x ) === - 1 );


			//
			// Three.Legacy checks
			//
			let referencesInLegacy = [];		// collect properties that are referenced in Three.Legacy.js
			let referencedClass = singleClass;	// current class being investigated

			while ( referencesInLegacy.length === 0 ) {

				referencesInLegacy = esquery( this.ast, `MemberExpression[object.name="${referencedClass.getName()}"] + ObjectExpression > Property > !Identifier` );

				// logger.debug( referencedClass.getName(), 'mentions in legacy:', referencesInLegacy.length );

				referencedClass = referencedClass.getBaseClass();

				if ( ! referencedClass )
					break;

			}

			const legacySource = this._checkForLegacy( inJsAndNotTs, referencesInLegacy );
			const legacyDecl = this._checkForLegacy( inTsAndNotJs, referencesInLegacy );

			allClasses.results.push( {
				name,
				onlySource: {
					methods: [],
					properties: legacySource
				},
				onlyDecl: {
					methods: [],
					properties: legacyDecl
				}
			} );

			allClasses.hits += legacySource.length + legacyDecl.length;

		} catch ( err ) {

			this.logger.error( name, 'failed:', err.message );

			allClasses.errors.push( { message: err.message.replace( this.basePath, '' ) } );

		}

		return allClasses;

	}


	_checkForLegacy( names, legacyReferences ) {

		return names
			.filter( name => ! name.startsWith( '_' ) && name !== 'constructor' )
			.map( name => {

				return {
					name,
					legacy: legacyReferences.findIndex( identifier => identifier.name === name ) !== - 1
				};

			} );

	}


	// MDN
	_getOwnAndPrototypeEnumerablesAndNonenumerables( obj ) {

		let props = [];

		do {

			// *** don't enumerate stuff on the JS basics
			if ( obj.constructor.name === 'Object' )
				break;

			Object.getOwnPropertyNames( obj ).forEach( prop => {

				if ( ! props.includes( prop ) )
					props.push( prop );

			} );

		} while ( obj = Object.getPrototypeOf( obj ) );

		return props;

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
		const check = new CompareDeclarationsWithInstancedObjects( basePath, outputStream );

		// analyze
		const result = await check.run( basePath, outputStream );


		// done
		console.log( "RESULT:", result );

	} )();

}

module.exports = CompareDeclarationsWithInstancedObjects;

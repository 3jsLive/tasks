/*

	Compare what's written in the docs (/en/ only for now)
	with what's in the *.d.ts files for that class

	Some hacks required because not everything maps neatly
	from foo.html -> foo.d.ts -> class 'foo'

	Type: Static
	Needs build: No
	Needs docs: Yes
	Needs examples: No
	Needs source: Yes

	TODO: extend to examples/

	TODO: check function parameters as well

	TODO: hardcode warnings for files that are skipped, plug into GUI (warning instead of error or something)

	TODO: zh docs?

	TODO: in serious need of some refactoring-love

*/

const fs = require( 'fs' );
const path = require( 'path' );
const dochandler = require( 'dochandler' );
const tsmorph = require( 'ts-morph' );
const glob = require( 'glob' );

const BaseCheck = require( './BaseCheck' );


class CompareDeclarationsWithDocs extends BaseCheck {

	generateListOfFiles() {

		// list files
		try {

			this.files = glob.sync( path.join( this.basePath, 'docs', 'api', 'en', '**', '*.html' ) ).map( file => {

				const basename = path.basename( file, '.html' );

				// overrides
				let topology = file.replace( path.join( this.basePath, 'docs', 'api', 'en' ), '' ).replace( '.html', '' );

				if ( /\/(?!Instanced)\w+BufferGeometry$/i.test( topology ) === true )
					topology = topology.replace( 'BufferGeometry', 'Geometry' );
				else if ( topology.startsWith( '/lights/shadows/' ) === true )
					topology = topology.replace( '/lights/shadows/', '/lights/' );
				else if ( topology.includes( 'loaders/managers/' ) === true )
					topology = topology.replace( 'loaders/managers/', 'loaders/' );
				else if ( topology === '/Polyfills' )
					topology = '/polyfills';

				return {
					topology: topology,
					basename: ( basename === 'Math' ) ? '_Math' : basename, // more override
					relative: path.relative( this.basePath, file )
				};

			} );

		} catch ( err ) {

			this.logger.fatal( 'Listing files failed:', err );

			throw err;

		}

		if ( ! this.files || this.files.length === 0 )
			throw new Error( 'No files found' );

		return this.files;

	}

	async worker() {

		// create typescript project and add declaration files
		const project = new tsmorph.Project();
		project.addExistingSourceFiles( path.join( this.basePath, 'src/**/*.d.ts' ) );

		// results
		let results = {};
		let totalHits = 0;

		// cleanup
		const importStripper = new RegExp( `^import\\("${this.basePath}.+?"\\)\.(\\w+)$` );

		await this.generateListOfFiles();

		for ( const file of this.files ) {

			let result = {
				onlyDocs: { properties: [], methods: [] },
				onlyDecl: { properties: [], methods: [] },
				diff: { properties: [], methods: [] }
			};

			let doc;
			const absolutePath = path.join( this.basePath, file.relative );

			try {

				doc = dochandler.parseDoc.parseFile( absolutePath );

			} catch ( err ) {

				this.logger.error( absolutePath + ':', err );

				results[ file.relative ] = { errors: [ { message: ( err.message ) ? err.message.replace( this.basePath, '' ) : err, code: null, location: null } ], hits: 0, results: [] };

				continue;

			}


			// more special cases
			if (
				file.topology.startsWith( '/constants/' ) === true ||
				file.topology.startsWith( '/deprecated/DeprecatedList' ) === true ||
				file.topology.startsWith( '/core/bufferAttributeTypes/' ) === true ||
				file.topology.startsWith( '/polyfills' ) === true ||
				file.topology.startsWith( '/loaders/DefaultLoadingManager' ) === true
			) {

				this.logger.log( `Skipping ${file.relative} because of topology: ${file.topology}` );

				results[ file.relative ] = { errors: [ { message: `File skipped according to blacklist`, location: null, code: null } ], hits: 0, results: [] };

				continue;

			}

			this.logger.log( file.relative );

			try {

				const declFile = project.getSourceFileOrThrow( path.join( this.basePath, 'src', file.topology + '.d.ts' ) );

				// some files have no class in them but just a namespace (e.g. Math)
				const declClassOrNamespace = declFile.getClass( file.basename ) || declFile.getNamespaceOrThrow( file.basename );

				// if we have a constructor -> use that
				// if no constructor, but a base class -> use their constructor
				// else give up
				const declConstructorOrBaseOrEmpty = this._getConstructorOrBaseOrEmpty( declClassOrNamespace );

				// either get properties or gracefully implode
				const declPropertiesOrEmpty = ( declClassOrNamespace.getProperties ) ? declClassOrNamespace.getProperties() : [];

				// classes have methods, namespaces have functions(?)
				const declMethodsOrFunctions = ( declClassOrNamespace.getMethods ) ? declClassOrNamespace.getMethods() : declClassOrNamespace.getFunctions();


				// does this really have to be done with Set()s? kinda complicates everything
				const declProps = new Set( declPropertiesOrEmpty.map( p => p.getName() ) );
				const declMethods = new Set( declMethodsOrFunctions.map( m => m.getName() ) );

				const htmlProps = new Set( doc.filter( tag => tag.type === 'PropertyTag' ).map( tag => tag.name ) );
				const htmlMethods = new Set( doc.filter( tag => tag.type === 'MethodTag' ).map( tag => tag.name ) );

				const declPropsFull = [ ...new Set( declPropertiesOrEmpty.map( p => ( { name: p.getName(), type: p.getType() } ) ) ) ].sort( ( a, b ) => a.name.localeCompare( b.name ) );
				const declMethodsFull = [ ...new Set( declMethodsOrFunctions.map( m => ( { name: m.getName(), type: m.getReturnType() } ) ) ) ].sort( ( a, b ) => a.name.localeCompare( b.name ) );

				const htmlPropsFull = [ ...new Set( doc.filter( tag => tag.type === 'PropertyTag' ).map( tag => ( { name: tag.name, type: tag.retval } ) ) ) ].sort( ( a, b ) => a.name.localeCompare( b.name ) );
				const htmlMethodsFull = [ ...new Set( doc.filter( tag => tag.type === 'MethodTag' ).map( tag => ( { name: tag.name, type: tag.retval } ) ) ) ].sort( ( a, b ) => a.name.localeCompare( b.name ) );


				//
				// results for this API page
				//
				result.onlyDecl.properties = [ ...this._differentNames( declProps, htmlProps ) ];
				result.onlyDecl.methods = [ ...this._differentNames( declMethods, htmlMethods ) ];
				result.onlyDocs.properties = [ ...this._differentNames( htmlProps, declProps ) ];
				result.onlyDocs.methods = [ ...this._differentNames( htmlMethods, declMethods ) ];

				result.diff.properties = declPropsFull.reduce( ( all, prop ) => {

					const diff = this._sameNameDifferentType( prop, [ ...htmlPropsFull ], file.basename );

					if ( diff )
						all.push( { decl: { name: prop.name, type: prop.type.getText().replace( importStripper, '$1' ) }, docs: diff } );

					return all;

				}, [] );

				result.diff.methods = declMethodsFull.reduce( ( all, method ) => {

					const diff = this._sameNameDifferentType( method, [ ...htmlMethodsFull ], file.basename );

					if ( diff )
						all.push( { decl: { name: method.name, type: method.type.getText().replace( importStripper, '$1' ) }, docs: diff } );

					return all;

				}, [] );


				// debugging
				if ( result.onlyDocs.properties.length > 0 )
					this.logger.debug( `These properties appear only in the docs: ${result.onlyDocs.properties.join( ', ' )}` );

				if ( result.onlyDecl.properties.length > 0 )
					this.logger.debug( `These properties appear only in the .d.ts: ${result.onlyDecl.properties.join( ', ' )}` );

				if ( result.onlyDocs.methods.length > 0 )
					this.logger.debug( `These methods appear only in the docs: ${result.onlyDocs.methods.join( ', ' )}` );

				if ( result.onlyDecl.methods.length > 0 )
					this.logger.debug( `These methods appear only in the .d.ts: ${result.onlyDecl.methods.join( ', ' )}` );

				if ( result.diff.properties.length > 0 )
					this.logger.debug( `These properties' types are different: ${result.diff.properties.map( x => this._stringifyDiff( x ) ).join( ', ' )}` );

				if ( result.diff.methods.length > 0 )
					this.logger.debug( `These methods' types are different: ${result.diff.methods.map( x => this._stringifyDiff( x ) ).join( ', ' )}` );

				for ( const cst of declConstructorOrBaseOrEmpty ) {

					this.logger.debug( 'DECL Constructor:',
						( cst.getParameters().length > 0 ) ?
							cst.getParameters().map( p => `${p.getName()}: ${p.getType().getText().replace( importStripper, '$1' )}` ).join( ', ' ) :
							'-- no params --'
					);

				}

				for ( const cst of doc.filter( tag => tag.type === 'Constructor' ) ) {

					this.logger.debug( 'HTML Constructor:',
						( cst.params && cst.params.length > 0 ) ?
							cst.params.map( p => `${p.name}: ${p.retval}` ).join( ', ' ) :
							'-- no params --'
					);

				}

			} catch ( err ) {

				this.logger.error( err );

				results[ file.relative ] = { errors: [ { message: ( err.message ) ? err.message.replace( this.basePath, '' ) : err, code: null, location: null } ], hits: 0, results: [] };

				continue;

			}


			// count it
			const hits = result.onlyDecl.properties.length + result.onlyDecl.methods.length +
						 result.onlyDocs.properties.length + result.onlyDocs.methods.length +
						 result.diff.properties.length + result.diff.methods.length;
			totalHits += hits;

			//
			// done
			//
			if ( hits > 0 )
				results[ file.relative ] = { errors: [], hits: hits, results: [ result ] };

		}

		return { errors: [], hits: totalHits, results };

	}


	/**
	 * @param {string} typeA the type in the docs
	 * @param {tsmorph.Type} typeB the type in the decl file
	 * @param {string} basename the name of the current class
	 */
	_typeEquality( typeA, typeB, basename ) {

		if ( typeof typeA !== 'string' || typeB instanceof tsmorph.Type !== true )
			throw new Error( `Wrong types: ${typeof typeA}, ${typeB instanceof tsmorph.Type}` );

		const aText = typeA;
		const bText = typeB.getText();

		const aTextLowercase = aText.toLowerCase();
		const bTextLowercase = bText.toLowerCase();

		const aPureText = aText.replace( 'THREE.', '' );
		const bPureText = bText.replace( 'THREE.', '' );

		const aNormalized = aPureText.toLowerCase();
		const bNormalized = bPureText.toLowerCase();

		const aNoBrackets = aNormalized.replace( '[]', '' );
		const bNoBrackets = bNormalized.replace( '[]', '' );

		// Number ~ number
		if ( aText.toLowerCase() === bText.toLowerCase() )
			return true;


		// null ~ void
		const rxNullVoid = /^(null|void)$/i;
		if ( rxNullVoid.test( aText ) && rxNullVoid.test( bText ) )
			return true;


		// float ~ number
		// integer ~ number
		const rxFloatNumber = /^(float|integer|number)$/i;
		if ( rxFloatNumber.test( aText ) && rxFloatNumber.test( bText ) )
			return true;


		// object ~ { foo: bar }
		const rxCurliesOrObject = /^({.*?}|object)$/i;
		if ( rxCurliesOrObject.test( aText ) && rxCurliesOrObject.test( bText ) )
			return true;


		// look up constants in constants.d.ts
		// if ( aTextLowercase === 'constant' ) {

		// scratch that, we're not looking up constant names for validity
		// either the docs say what type of constant, like in the .d.ts, or it's a diff error

		// }

		// ArrayLike<number> ~ Array
		// ArrayLike<number> ~ TypedArray
		const rxArrayLike = /^Array(Like<.*?>)?$/i;
		const rxTypedArray = /^(Typed)?Array$/i;
		if ( rxArrayLike.test( aText ) && rxTypedArray.test( bText ) )
			return true;
		else if ( rxTypedArray.test( aText ) && rxArrayLike.test( bText ) )
			return true;


		// this ~ basename
		// this ~ THREE.basename
		if ( aText === 'this' && bPureText === basename )
			return true;
		else if ( aPureText === basename && bText === 'this' )
			return true;


		// THREE.Face3 ~ Face3
		if ( aNormalized === bNormalized )
			return true;


		// Array ~ THREE.Vector3[]
		if ( aTextLowercase === 'array' && bTextLowercase.endsWith( '[]' ) )
			return true;
		else if ( aTextLowercase.endsWith( '[]' ) && bTextLowercase === 'array' )
			return true;


		// any ~ *
		if ( aNormalized === 'any' || bNormalized === 'any' && ( ! aTextLowercase.endsWith( '[]' ) && ! bTextLowercase.endsWith( '[]' ) ) )
			return true;


		// any[] ~ number[]
		if ( aNormalized.endsWith( '[]' ) && bNormalized.endsWith( '[]' ) ) {

			if ( aNoBrackets === 'any' || bNoBrackets === 'any' )
				return true;

		}


		// Float32Array ~ any[]
		// ...32Array ~ number[]
		const rxNumericTypedArray = /.*?[0-9]+Array$/;
		if ( ( rxNumericTypedArray.test( aText ) || rxNumericTypedArray.test( bText ) ) ) {

			if ( [ 'any[]', 'number[]' ].includes( bNormalized ) )
				return true;
			else if ( [ 'any[]', 'number[]' ].includes( aNormalized ) )
				return true;

		}


		this.logger.debug( `---TYPES "${aText}" "${bText}"` );

		return false;

	}


	_differentNames( setA, setB ) {

		let _difference = new Set( setA );

		for ( const elem of setB ) {

			_difference.delete( elem );

		}

		return _difference;

	}


	_sameNameDifferentType( needle, haystack, basename ) {

		if ( ! needle || ! needle.name || ! needle.type || ! haystack || ! Array.isArray( haystack ) )
			return false;

		return haystack.find( val => val.name === needle.name && this._typeEquality( val.type, needle.type, basename ) === false );

	}


	_getConstructorOrBaseOrEmpty( declClassOrNamespace ) {

		if ( declClassOrNamespace.getConstructors &&
			declClassOrNamespace.getConstructors().length > 0 ) {

			return declClassOrNamespace.getConstructors();

		} else if ( declClassOrNamespace.getBaseClass &&
			declClassOrNamespace.getBaseClass() !== undefined &&
			declClassOrNamespace.getBaseClass().getConstructors().length > 0 ) {

			return declClassOrNamespace.getBaseClass().getConstructors();

		} else {

			return [];

		}

	}


	_stringifyDiff( diff ) {

		return `[DECL] ${diff.decl.name}: ${diff.decl.type} vs. ${diff.docs.name}: ${diff.docs.type} [DOCS]`;

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


		// analyze
		const check = new CompareDeclarationsWithDocs( basePath, outputStream );
		const result = await check.run( basePath, outputStream );


		// done
		console.log( "RESULT:", result );

	} )();

}


module.exports = CompareDeclarationsWithDocs;

/*

	Compare what's written in the docs (/en/ only for now)
	with what's in the *.d.ts files for that class

	Some hacks required because not everything maps neatly
	from foo.html -> foo.d.ts -> class 'foo'

	TODO: extend to examples/

	TODO: check function parameters as well

	TODO: hardcode warnings for files that are skipped, plug into GUI (warning instead of error or something)

	TODO: zh docs?

*/

const fs = require( 'fs' );
const path = require( 'path' );
const dochandler = require( 'dochandler' );
const tsmorph = require( 'ts-morph' );
const lister = require( 'listfiles' );

const BaseCheck = require( './BaseCheck' );


class CompareDeclarationsWithDocs extends BaseCheck {

	async generateListOfFiles() {

		// load docs
		try {

			const docs = lister.docs( { basePath: this.basePath } );
			this.apiSlugs = Object.keys( docs.pages )
				.filter( url => url.startsWith( 'api/en/' ) )
				.map( slug => {

					const basename = path.basename( slug );

					// overrides
					let topology = slug.replace( 'api/en', '' );
					if ( /\/(?!Instanced)\w+BufferGeometry$/i.test( topology ) === true )
						topology = topology.replace( 'BufferGeometry', 'Geometry' );
					else if ( topology.startsWith( 'lights/shadows/' ) === true )
						topology = topology.replace( 'lights/shadows/', 'lights/' );
					else if ( topology.includes( 'loaders/managers/' ) === true )
						topology = topology.replace( 'loaders/managers/', 'loaders/' );
					else if ( topology === 'Polyfills' )
						topology = 'polyfills';

					return {
						topology: topology,
						basename: ( basename === 'Math' ) ? '_Math' : basename, // more override
						relative: path.join( 'docs', slug + '.html' ),
						absolute: path.join( this.basePath, 'docs', slug + '.html' )
					};

				} );

		} catch ( err ) {

			this.logger.fatal( 'Listing docs failed:', err );

			throw err;

		}

		if ( ! this.apiSlugs || this.apiSlugs.length === 0 )
			throw new Error( 'No doc files found' );

	}


	async worker() {

		// create typescript project and add declaration files
		const project = new tsmorph.Project();
		project.addExistingSourceFiles( path.join( this.basePath, 'src/**/*.d.ts' ) );


		// results
		let results = {};


		await this.generateListOfFiles();


		for ( const slug of this.apiSlugs ) {

			let result = {
				onlyDocs: { properties: [], methods: [] },
				onlyDecl: { properties: [], methods: [] },
				diff: { properties: [], methods: [] }/* ,
				error: false,
				warning: false */
			};

			let doc;

			try {

				doc = dochandler.parseDoc.parseFile( slug.absolute );

			} catch ( err ) {

				this.logger.error( slug.absolute + ':', err );

				results[ slug.relative ] = { errors: [ ( err.message ) ? err.message.replace( this.basePath, '' ) : err ], results: [] };

				continue;

			}


			// more special cases
			if (
				slug.topology.startsWith( 'constants/' ) === true ||
				slug.topology.startsWith( 'deprecated/DeprecatedList' ) === true ||
				slug.topology.startsWith( 'core/bufferAttributeTypes/' ) === true
			) {

				this.logger.debug( `Skipping ${slug.relative} because of topology: ${slug.topology}` );

				results[ slug.relative ] = { errors: [ 'File skipped because of marked topology' ], results: [] };

				continue;

			}


			// this.logger.note( { slug } );


			try {

				const declFile = project.getSourceFileOrThrow( path.join( this.basePath, 'src', slug.topology + '.d.ts' ) );

				// some files have no class in them but just a namespace (e.g. Math)
				const declClassOrNamespace = declFile.getClass( slug.basename ) || declFile.getNamespaceOrThrow( slug.basename );

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

					const diff = this._sameNameDifferentType( prop, [ ...htmlPropsFull ], slug.basename );

					if ( diff )
						all.push( { decl: { name: prop.name, type: prop.type.getText() }, docs: diff } );

					return all;

				}, [] );

				result.diff.methods = declMethodsFull.reduce( ( all, method ) => {

					const diff = this._sameNameDifferentType( method, [ ...htmlMethodsFull ], slug.basename );

					if ( diff )
						all.push( { decl: { name: method.name, type: method.type.getText() }, docs: diff } );

					return all;

				}, [] );


				// debugging
				if ( result.onlyDocs.properties.length > 0 )
					this.logger.info( `These properties appear only in the docs: ${result.onlyDocs.properties.join( ', ' )}` );

				if ( result.onlyDecl.properties.length > 0 )
					this.logger.info( `These properties appear only in the .d.ts: ${result.onlyDecl.properties.join( ', ' )}` );

				if ( result.onlyDocs.methods.length > 0 )
					this.logger.info( `These methods appear only in the docs: ${result.onlyDocs.methods.join( ', ' )}` );

				if ( result.onlyDecl.methods.length > 0 )
					this.logger.info( `These methods appear only in the .d.ts: ${result.onlyDecl.methods.join( ', ' )}` );

				this.logger.log( '=================' );

				if ( result.diff.properties.length > 0 )
					this.logger.info( `These properties' types are different: ${result.diff.properties.map( x => this._stringifyDiff( x ) ).join( ', ' )}` );

				if ( result.diff.methods.length > 0 )
					this.logger.info( `These methods' types are different: ${result.diff.methods.map( x => this._stringifyDiff( x ) ).join( ', ' )}` );

				this.logger.log( '=================' );

				for ( const cst of declConstructorOrBaseOrEmpty ) {

					this.logger.debug( 'DECL Constructor:',
						( cst.getParameters().length > 0 ) ?
							cst.getParameters().map( p => `${p.getName()}: ${p.getType().getText()}` ).join( ', ' ) :
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

				// console.log( '=================' );

				// logger.debug( `DECL props: %o`, declPropsFull.map( x => `${x.name}: ${x.type.getText()}` ).join( ', ' ) );
				// logger.debug( `HTML props: %o`, htmlPropsFull.map( x => `${x.name}: ${x.type}` ).join( ', ' ) );
				// logger.debug( `DECL methods: %o`, declMethodsFull.map( x => `${x.name}: ${x.type.getText()}` ).join( ', ' ) );
				// logger.debug( `HTML methods: %o`, htmlMethodsFull.map( x => `${x.name}: ${x.type}` ).join( ', ' ) );

				// console.log( '=================' );

				/*
				console.log( '  DECL Props diff:', [ ...differencesByName.properties.onlyInDecl ].join( ', ' ) );
				console.log( '  HTML Props diff:', [ ...differencesByName.properties.onlyInDocs ].join( ', ' ) );
				console.log( 'DECL Methods diff:', [ ...differencesByName.methods.onlyInDecl ].join( ', ' ) );
				console.log( 'HTML Methods diff:', [ ...differencesByName.methods.onlyInDocs ].join( ', ' ) );

				console.log( '=================' );

				console.log( '  Props same name:', declPropsFull.filter( p => _sameNameSameType( p, [ ...htmlPropsFull ] ) ).map( p => p.name ).join( ', ' ) );
				console.log( 'Methods same name:', declMethodsFull.filter( m => _sameNameSameType( m, [ ...htmlMethodsFull ] ) ).map( m => m.name ).join( ', ' ) );

				console.log( '=================' );

				console.log( '  Props same name, wrong type:', differencesByType.properties.map( p => `${p.name}: ${p.type.getText()}` ).join( ', ' ) );
				console.log( 'Methods same name, wrong type:', differencesByType.methods.map( m => `${m.name}: ${m.type.getText()}` ).join( ', ' ) );
				*/

				// console.log( '############' );

			} catch ( err ) {

				this.logger.error( '\t\t\t\t\t\t\t\t\t\tFailed', err.message.replace( 'Expected to find namespace', 'Expected to find class or namespace' ), '\n' );
				// console.log( util.inspect( err, true ) );
				this.logger.error( err );
				this.logger.error( '############' );

				// result[ 'error' ] = err.message.replace( basePath, '' );

				results[ slug.relative ] = { errors: [ ( err.message ) ? err.message.replace( this.basePath, '' ) : err ], results: [] };

				continue;

			}


			//
			// done
			//
			results[ slug.relative ] = { errors: [], results: [ result ] };

		}

		return { errors: [], results };

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


		this.logger.star( `---TYPES "${aText}" "${bText}"` );

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

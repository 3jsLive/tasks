const fs = require( 'fs' );
const path = require( 'path' );
const collector = require( './collectPrototypes' );
const logger = require( 'signale' ).scope( 'DocsDocsDeps' );
const stringify = require( 'json-stable-stringify' );

const pageTagProc = require( './processors/PageTag' );

/*

	Process results from parseDocs

	FIXME: unify capitalization
	FIXME: multiple identical tags per document are ignored (0dedbc.. audio/Audio.html [page:Audio.hasPlayback ...])

*/

/**
 * @typedef {object} SourceLocation
 * @prop {{line: number, column: number, offset: number}} start
 * @prop {{line: number, column: number, offset: number}} end
 */

/**
 * @typedef {object} commonInfo
 * @property {string} codeFilename
 * @property {string} codeFilenameRelative
 * @property {string} docFilename
 * @property {string} docFilenameRelative
 * @property {string} basename
 * @property {string} basePath
 * @property {string} codeFilecontent
 * @property {string} revision
 * @property {Object} methodsAndProperties
 * @property {Map.<RegExp, SourceLocation[]>} tagCache
 */


/**
 * @param {string} basePath
 * @param {string} input
 */
function run( basePath, input, outputStream ) {

	if ( typeof basePath === 'undefined' )
		throw new Error( 'Missing base path to three.js directory' );


	let parseDocsResults;
	try {

		parseDocsResults = JSON.parse( input );

	} catch ( err ) {

		console.log( input, err );
		process.exit();

	}

	// early bailout
	if ( Object.keys( parseDocsResults ).length === 0 ) {

		logger.fatal( `parseDocs results file is broken` );

		return { errors: [ `parseDocs results file is broken` ], results: {} };

	}


	//
	// Preload methods and properties
	//
	const methodsAndProperties = collector( basePath );


	//
	// cache those find*.js results
	//
	let tagCache = new Map();


	//
	// results
	//
	let allResults = {};
	let allErrors = [];

	for ( const [ docFilename, { errors, results } ] of Object.entries( parseDocsResults ) ) {

		let retval = { errors: [], results: [] };

		if ( errors.length > 0 ) {

			logger.error( `Errors for '${docFilename}'! Aborting...` );

			retval.errors.push( ...errors );

			allResults[ docFilename ] = retval;

			continue;

		}

		const basename = path.basename( docFilename, '.html' );

		const codeFilename = path.join( basePath, docFilename.replace( new RegExp( '.*?\\/?docs\\/api\\/en\\/(.*?)\\.html', 'i' ), `src/$1.js` ) )
			.replace( /src\/Polyfills\.js$/, 'src/polyfills.js' )	// overrides
			.replace( /src\/geometries\/(\w+)BufferGeometry\.js/i, 'src/geometries/$1Geometry.js' ); // CircleBufferGeometry -> CircleGeometry

		const codeFilenameRelative = path.relative( basePath, codeFilename );
		const docFilenameRelative = /* path.relative( basePath, */ docFilename; /* ) */

		if ( fs.existsSync( codeFilename ) !== true ) {

			logger.error( `Source file '${codeFilenameRelative}' not found! Skipping...` );

			retval.errors.push( { file: docFilename, message: `Source file '${codeFilenameRelative}' not found` } );

			allResults[ docFilenameRelative ] = retval;

			continue;

		}

		const codeFilecontent = fs.readFileSync( codeFilename, 'utf8' );

		logger.debug( '\n', docFilenameRelative, '		', codeFilenameRelative );


		// general file paths for the processing function
		const commonInfo = {
			codeFilename, codeFilenameRelative,
			docFilename, docFilenameRelative,
			basename, basePath, // FIXME: capitalization
			codeFilecontent,
			methodsAndProperties, tagCache
		};
		Object.freeze( commonInfo );


		//
		// Actual processing
		//
		const pages = ( results[ 0 ].PageTag ) ? pageTagProc( results[ 0 ].PageTag, commonInfo ) : null;

		if ( pages ) {

			const filteredErrors = pages.errors;
			const filteredPages = pages.results.filter( tag => ! tag.reason );

			if ( ! filteredErrors && ! filteredPages )
				continue;

			retval.errors.push( ...filteredErrors );
			retval.results.push( ...filteredPages );

		}

		if ( retval.errors.length > 0 || retval.results.length > 0 )
			allResults[ docFilenameRelative ] = retval;

	}

	outputStream.write( stringify( { errors: allErrors, results: allResults } ) );

	return { errors: allErrors, results: allResults };

}


// simple CLI-fication
if ( require.main === module ) {

	if ( process.argv.length != 5 ) {

		console.error( 'Invalid number of arguments' );

		console.log( `Usage: ${path.basename( process.argv[ 0 ] )} ${process.argv[ 1 ]} <basePath> <inputFilename> <outputFilename>` );

		process.exit( - 1 );

	}


	// setup
	// eslint-disable-next-line no-unused-vars
	const [ node, script, basePath, inputFilename, outputFilename ] = process.argv;
	const outputStream = fs.createWriteStream( outputFilename, { flags: 'w', encoding: 'utf8' } );

	let inputData;
	try {

		inputData = fs.readFileSync( inputFilename );

	} catch ( err ) {

		logger.fatal( `Couldn't read ${inputFilename}` );
		process.exit( - 1 );

	}


	// analyze
	const result = run( basePath, inputData, outputStream );


	// save
	outputStream.write( stringify( result ) );


	// done
	console.log( "RESULT:", result );

}


module.exports = { run }; // TODO: _worker

const fs = require( 'fs' );
const path = require( 'path' );

const stringify = require( 'json-stable-stringify' );
const parser = require( 'dochandler' );
const lister = require( 'listfiles' );

const logger = require( 'signale' ).scope( 'parseDocs' );

/*

	Formerly 'referencedCode.js'

	Same as v1, but with PEGjs and different keys

	Status: works, English API only for now thou

*/


/**
 * @param {string} basePath
 */
function _worker( basePath ) {

	// load and parse docs
	let filesToParse;
	try {

		const docs = lister.docs( { basePath, baseUrl: basePath + '/docs/' } );
		filesToParse = docs.urls.filter( url => /api\/en\//.test( url ) && /(index\.html|-browser|Template\.html)/g.test( url ) === false );

	} catch ( err ) {

		logger.fatal( 'Listing docs failed:', err );

		throw err;

	}

	if ( ! filesToParse || filesToParse.length === 0 )
		throw new Error( 'No doc files found' );


	// all results
	let results = {};


	for ( const file of filesToParse ) {

		const fileRelative = path.relative( basePath, file );

		let parsed;
		try {

			const strippedContent = fs.readFileSync( file, 'utf8' ).replace( /<!--.*?-->/gsm, '' );
			// parsed = parser.parseDoc.parseFile( file, 'utf8' );
			parsed = parser.parseDoc.parseString( strippedContent );

		} catch ( err ) {

			logger.error( fileRelative, 'failed parsing', err );

			results[ fileRelative ] = { errors: [ ( err.message ) ? err.message.replace( basePath, '' ) : err ], results: [] };

			continue;

		}


		// Sort nodes into bins, dropping 'Text' nodes first
		logger.debug( 'Sorting nodes' );
		const nodes = parsed
			.filter( node => node.type !== 'Text' )
			.reduce( ( all, current ) => {

				all[ current.type ] = all[ current.type ] || [];
				all[ current.type ].push( current );

				return all;

			}, {} );


		// DEBUG
		// for ( const type in nodes ) {
		// 	logger.debug( `Type: ${type}, Count: ${nodes[ type ].length}` );
		// 	for ( const tag of nodes[ type ] )
		// 		logger.debug( util.inspect( tag, { breakLength: Infinity, colors: true } ) );
		// }


		//
		// references to THREE.* classes in <code> tags
		//
		logger.debug( 'Extracting code references' );
		nodes.codeReferences = [];
		if ( nodes.CodeTag && nodes.CodeTag.length > 0 ) {

			for ( const codeTag of nodes.CodeTag ) {

				const refs = codeTag.code.match( /THREE\.\w+/g ) || [];

				nodes.codeReferences.push( refs.map( x => x.replace( /THREE\./, '' ) ) );

			}

		}


		//
		// THREE.* classes used as text in PageTags
		//
		logger.debug( 'Extracting direct mentions' );
		nodes.directMentions = [];
		if ( nodes.PageTag && nodes.PageTag.length > 0 ) {

			for ( const pageTag of nodes.PageTag ) {

				if ( /THREE\.\w+/.test( pageTag.text ) === true )
					nodes.directMentions.push( pageTag.text.replace( /THREE\./, '' ) );

			}

		}

		results[ fileRelative ] = { errors: [], results: [ nodes ] };

	}

	return results;

}


/**
 * @param {string} basePath Path to three.js main directory
 * @param {WritableStream} outputStream Output stream for temporary results
 */
function run( basePath, outputStream ) {

	// all used docs by default
	if ( typeof basePath === 'undefined' )
		throw new Error( 'Missing base path to three.js directory' );


	// log to temp file by default
	if ( typeof outputStream === 'undefined' )
		throw new Error( 'Missing WriteableStream for results' );


	// analyze
	let results;
	try {

		results = _worker( basePath );

	} catch ( err ) {

		logger.fatal( '_worker failed:', err );

		results = { results: [], errors: [ ( err.message ) ? err.message.replace( basePath, '' ) : err ] };

	}


	// save
	outputStream.write( stringify( results ) );


	return results;

}


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
	const result = run( basePath, outputStream );


	// done
	console.log( "RESULT:", result );

}


module.exports = { run, _worker };

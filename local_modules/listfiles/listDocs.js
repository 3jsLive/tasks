const fs = require( 'fs' );
const path = require( 'path' );
const signale = require( 'signale' );
const conf = require( 'rc' )( 'dependenciesTracker', {
	listDocs: {
		basePath: '/home/max/dev/_projects/3js-clean/',
		checkExistance: false
	}
} );


/** @typedef {{ basePath?: string, fullPath?: string, baseUrl?: string, checkExistance?: boolean }} loadOptions */

/**
 * Read docs/list.js and return a list of currently available documentation pages
 * with optional full URL
 *
 * @param {loadOptions?} opts
 * @returns {{pages: {string, string}, existance?: boolean[], urls?: string[]}}
 */
function load( opts ) {

	const logger = signale.scope( 'listDocs' );

	const options = opts || {};

	const basePath = options.basePath || conf.listDocs.basePath;
	const fullPath = options.fullPath;
	const baseUrl = options.baseUrl;
	const checkExistance = ( typeof options.checkExistance === 'boolean' ) ? options.checkExistance : conf.listDocs.checkExistance;

	// we either have a direct path to the file or we're taking a reasonable guess from the base path
	if ( ! fullPath && ! basePath ) {

		logger.fatal( 'Missing path info' );
		return null;

	}

	const filePath = fullPath || path.join( basePath, 'docs', 'list.js' );

	if ( fs.existsSync( filePath ) !== true ) {

		logger.fatal( `Given path '${filePath}' does not exist` );
		return null;

	}

	const content = fs.readFileSync( filePath, 'utf8' );


	// read file, split into individual lines, select all interesting ones and regex them
	const pages = content
		.split( /(\r\n|\n)+/g )
		.reduce( ( ret, line ) => {

			const match = line.match( /^\s*"(.+?)": "(.+?)",?$/i );

			if ( match !== null && match.length === 3 ) {

				const title = match[ 1 ];
				const filename = match[ 2 ];

				if ( typeof ret[ filename ] === 'undefined' )
					ret[ filename ] = title;
				else
					logger.debug( `Skipping duplicate entry: ${filename} = "${title}" and "${ret[ filename ]}"` );

			}

			return ret;

		}, {} );


	// default return value
	let result = { pages: { ...pages } };


	// check if there are actual files corresponding to those names
	if ( checkExistance === true || checkExistance === 'true' ) {

		if ( fs.existsSync( basePath ) !== true )
			logger.error( `Can't use checkExistance without a valid base path: '${basePath}'` );
		else
			result[ 'existance' ] = Object.keys( pages ).map( slug => fs.existsSync( path.join( basePath, 'docs', slug + '.html' ) ) );

	}

	// crudely form the final URLs
	if ( baseUrl )
		result[ 'urls' ] = Object.keys( pages ).map( slug => baseUrl + slug + '.html' );


	// done
	return result;

}


module.exports = load;

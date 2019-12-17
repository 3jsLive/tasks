const fs = require( 'fs' );
const path = require( 'path' );
const signale = require( 'signale' );
const conf = require( 'rc' )( 'dependenciesTracker', {
	listExamples: {
		basePath: '/home/max/dev/_projects/3js-clean/',
		checkExistance: false
	}
} );


/** @typedef {{ basePath?: string, fullPath?: string, baseUrl?: string, checkExistance?: boolean }} loadOptions */

/**
 * Read examples/files.js and return a list of currently available examples
 * with optional full URL
 *
 * @param {loadOptions?} opts
 * @returns {{pages: {string, string}, existance?: boolean[], urls?: string[]}}
 */
function load( opts ) {

	const logger = signale.scope( 'listExamples' );

	const options = opts || {};

	const basePath = options.basePath || conf.listExamples.basePath;
	const fullPath = options.fullPath;
	const baseUrl = options.baseUrl;
	const checkExistance = ( typeof options.checkExistance === 'boolean' ) ? options.checkExistance : conf.listExamples.checkExistance;

	// we either have a direct path to the file or we're taking a reasonable guess from the base path
	if ( ! fullPath && ! basePath ) {

		logger.fatal( 'Missing path info' );
		return null;

	}

	const filePath = fullPath || path.join( basePath, 'examples', 'files.js' );

	if ( fs.existsSync( filePath ) !== true ) {

		logger.fatal( `Given path '${filePath}' does not exist` );
		return null;

	}

	const content = fs.readFileSync( filePath, 'utf8' );


	// read file, split into lines, select interesting ones and parse with a simple regex
	const exampleNames = content
		.split( /(\r\n|\n)+/g )
		.reduce( ( all, line ) => {

			const match = line.match( /^\s*"([a-z0-9_]+)",?$/i );

			if ( match !== null && typeof match[ 1 ] === 'string' ) {

				if ( all.includes( match[ 1 ] ) === false )
					all.push( match[ 1 ] );
				else
					logger.debug( `Skipping duplicate example: "${match[ 1 ]}"` );

			}

			return all;

		}, [] );


	// default return value
	let result = { names: exampleNames };


	// check if there are actual files corresponding to those names
	if ( checkExistance === true || checkExistance === 'true' ) {

		if ( fs.existsSync( basePath ) !== true )
			logger.error( `Can't use checkExistance without a valid base path: '${basePath}'` );
		else
			result[ 'existance' ] = exampleNames.map( name => fs.existsSync( path.join( basePath, 'examples', name + '.html' ) ) );

	}


	// crudely form the final Urls
	if ( baseUrl )
		result[ 'urls' ] = exampleNames.map( name => baseUrl + name + '.html' );


	// done
	return result;

}


module.exports = load;

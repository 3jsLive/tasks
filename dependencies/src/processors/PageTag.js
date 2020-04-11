const fDT = require( '../findDocTags' );
const util = require( 'util' );
const lister = require( 'listfiles' );

const logger = require( 'signale' ).scope( 'processPageTags' );
const cacheLogger = require( 'signale' ).scope( 'searchAndCache' );

/**
 * @typedef { import("../DocsDocsDeps").SourceLocation} SourceLocation
 * @typedef { import("../DocsDocsDeps").commonInfo} commonInfo
 */


const ignoredTypesRx = /^(null|this|Boolean|Object|Array|Number|String|Integer|Float|TypedArray|ArrayBuffer)$/i;


function _log( obj ) {

	const tmp = JSON.parse( JSON.stringify( obj ) );
	if ( typeof tmp[ 'location' ] !== "undefined" )
		tmp.location = '...';
	return util.inspect( tmp, { /* sorted: true, */ colors: true, breakLength: Infinity, depth: 4 } );

}


/**
 * @param {{page: string, anchor: string, location: SourceLocation, name: string, text: string}[]} list
 * @param {commonInfo} commonInfo
 */
module.exports = function processPageTags( list, { docFilename, docFilenameRelative, basename, basePath, /* revision, */ tagCache } ) {

	const docsList = lister.docs( { basePath, baseUrl: 'docs/' } );


	/**
	 * Pre-storing all possible foreignPage candidates for faster lookup has been tested: 0.7 glorious seconds improvement
	 * @param {string} foreignPage
	 * @returns {string|null}
	 * @throws {Error}
	 */
	function findDocFilename( foreignPage ) {

		const apiSlugs = Object.keys( docsList.pages ).filter( page => new RegExp( 'api/en/.*?/' + foreignPage + '$' ).test( page ) );

		if ( apiSlugs.length === 0 )
			return null;
		else if ( apiSlugs.length === 1 )
			return 'docs/' + apiSlugs[ 0 ] + '.html';
		else
			throw new Error( `More than one doc page found: ${foreignPage} -> ${apiSlugs.join( ', ' )}` );

	}


	/**
	 * @param {string} filepath
	 * @param {{type: string, search: any, regexDefault: boolean}} query
	 * @param {Object.<string, SourceLocation[]>} cache
	 * @returns {SourceLocation[]}
	 */
	function searchAndCache( filepath, query ) {

		// cache saves about 30% of processing time

		cacheLogger.debug( 'searchAndCache: %s %o', filepath, query );

		const loc = tagCache.get( { filepath, query } ) || fDT.findDocTag( filepath, query.type, query.search, { regexDefault: query.regexDefault } );
		tagCache.set( { filepath, query }, loc );

		cacheLogger.debug( '= %o', loc );

		return loc;

	}


	let results = [];
	let errors = [];

	for ( const p of list ) {

		// [page:Foo.bar Baz]
		// fp.name = Foo
		// fp.anchor = bar
		// fp.text = baz

		const page = ( ! p.name || p.name === '<documentName>' ) ? basename : p.name;

		if ( ignoredTypesRx.test( page ) )
			continue;

		if ( p.anchor !== '' ) {

			// TODO: unify with below
			let filepath;
			try {

				filepath = ( page === docFilename ) ? page : findDocFilename( page );

			} catch ( err ) {

				logger.error( page, 'failed findDocFilename:', err );

				errors.push( { tag: p, err } );

				continue;

			}

			if ( filepath === null ) {

				logger.error( `PageTag ${_log( p )} > File not found in docs!` );

				results.push( { tag: p, err: { message: 'File not found in docs' } } );

				continue;

			}

			filepath = filepath.replace( /\/Polyfills\./, '/polyfills.' ); // override
			const filepathRelative = filepath;
 			filepath = basePath + filepath;

			const query = { regexDefault: false, type: 'property', search: { name: new RegExp( '^' + p.anchor + '$' ) } };

			let loc;

			try {

				loc = searchAndCache( filepath, query );

			} catch ( err ) {

				logger.error( `Error in file '${filepathRelative}':`, err );

				errors.push( { tag: p, err: { message: err.message, location: err.location } } );

				continue;

			}

			if ( ! Array.isArray( loc ) ) {

				logger.error( `PageTag ${_log( p )} return an invalid location! ${_log( loc )} in ${filepathRelative}` );

				results.push( { tag: p, message: `Invalid location returned in ${filepathRelative}: ${loc}` } );

			} else if ( loc.length > 1 ) {

				logger.error( `PageTag ${_log( p )} returned more than one result(property)!\n${loc.map( x => _log( x ) ).join( "\n" )}\nin ${filepathRelative}` );

				results.push( { tag: p, message: `More than one property-result returned in ${filepathRelative}` } );

			} else if ( loc.length === 1 ) {

				logger.debug( `PageTag ${_log( p )} exists (a property), set locatedDependency from ${JSON.stringify( p.location )} to ${loc[ 0 ].location}, from ${docFilenameRelative} to ${filepathRelative}` );

				results.push( { tag: p, reason: 'property', sourceFile: docFilenameRelative, dependentFile: filepathRelative, target: loc } );

				/* sqlFullyInsertLocatedCodeDependency.run( {
					code: loc[ 0 ].name, revision: revision,
					sourceStartLine: p.location.start.line, sourceStartColumn: p.location.start.column,
					sourceEndLine: p.location.end.line, sourceEndColumn: p.location.end.column,
					dependentStartLine: loc[ 0 ].location.start.line, dependentStartColumn: loc[ 0 ].location.start.column,
					dependentEndLine: loc[ 0 ].location.end.line, dependentEndColumn: loc[ 0 ].location.end.column,
					sourceFilename: docFilenameRelative, dependentFilename: path.relative( basePath, filepath )
				} ); */

			} else if ( loc.length === 0 ) {

				query.type = 'method';

				const loc2 = searchAndCache( filepath, query );

				if ( ! Array.isArray( loc2 ) || loc2.length === 0 ) {

					logger.error( `PageTag ${_log( { anchor: p.anchor, name: p.name, text: p.text, source: p.source } )} not found!` );

					results.push( { tag: p, message: `Not found` } );

				} else if ( loc2.length > 1 ) {

					logger.error( `PageTag ${_log( p )} returned more than one result(method)!\n${loc2.map( x => _log( x ) ).join( "\n" )}\nin ${filepathRelative}` );

					results.push( { tag: p, message: `More than one method-result returned in ${filepathRelative}` } );

				} else {

					// loc2.length === 1

					logger.debug( `PageTag ${_log( p )} exists (a method), set locatedDependency from ${JSON.stringify( p.location )} to ${loc2[ 0 ].location} in ${filepathRelative}` );

					results.push( { tag: p, reason: 'method', sourceFile: docFilenameRelative, dependentFile: filepathRelative, target: loc2 } );

					/* sqlFullyInsertLocatedCodeDependency.run( {
						code: loc2[ 0 ].name, revision: revision,
						sourceStartLine: p.location.start.line, sourceStartColumn: p.location.start.column,
						sourceEndLine: p.location.end.line, sourceEndColumn: p.location.end.column,
						dependentStartLine: loc2[ 0 ].location.start.line, dependentStartColumn: loc2[ 0 ].location.start.column,
						dependentEndLine: loc2[ 0 ].location.end.line, dependentEndColumn: loc2[ 0 ].location.end.column,
						sourceFilename: docFilenameRelative, dependentFilename: path.relative( basePath, filepath )
					} ); */

				}

			}

		} else {

			let filepath;

			try {

				filepath = findDocFilename( page );

			} catch ( err ) {

				logger.error( page, 'failed findDocFilename:', err );

				errors.push( { tag: p, err } );

				continue;

			}

			if ( ! filepath ) {

				logger.error( `PageTag ${_log( p )} > File for '${page}' not found in docs!` );

				results.push( { tag: p, err: { message: `File for '${page}' not found in docs` } } );

				continue;

			}

			logger.debug( `PageTag ${_log( p )} exists (a file), set fileDependency from ${JSON.stringify( p.location )}, ${docFilenameRelative} to ${filepath}` );

			results.push( { tag: p, reason: 'file', sourceFile: docFilenameRelative, dependentFile: filepath } );

			/* sqlInsertFile.run( filepath );
			sqlInsertLocation.run( p.location.start.line, p.location.start.column );
			sqlInsertLocation.run( p.location.end.line, p.location.end.column );
			sqlInsertFileDependency.run( { revision: revision, sourceFile: docFilenameRelative, dependentFile: filepath, reason: 'page' } ); */

		}

	}

	// console.log( util.inspect( { errors, results }, false, 4, true ) );

	return { errors, results };

};

/*

	Check for broken external links
		i.e. <a href="http... or just http://...

*/

const Promise = require( 'bluebird' );
const fs = require( 'fs' );
const path = require( 'path' );
const urlExists = require( 'url-exists-deep' );
const glob = Promise.promisifyAll( require( 'glob' ) );

const BaseCheck = require( './BaseCheck' );
const CacheMixin = require( './CacheMixin' );


class CheckNonDocsForBrokenExternalLinks extends CacheMixin( '__cache_dump_NonDocs.json', BaseCheck ) {

	async generateListOfFiles() {

		try {

			const allFiles = glob.globAsync( path.join( this.basePath, '{examples/**/*.js,examples/**/*.d.ts,examples/*.html,src/**/*.js,src/**/*.d.ts}' ) );

			this.files = await Promise.map( allFiles, ( file ) => ( { absolute: file, relative: path.relative( this.basePath, file ) } ) );

		} catch ( err ) {

			this.logger.fatal( 'Listing files failed:', err );

			throw err;

		}

		if ( ! this.files || this.files.length === 0 )
			throw new Error( 'No files found' );

		return this.files;

	}


	checkUrl( url ) {

		if ( this.cacheEnabled === true && this.cache.get( url ) !== undefined )
			return this.cache.get( url );

		const result = urlExists( url, {
			"accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
			"accept-encoding": "gzip, deflate, br",
			"accept-language": "en-US,en;q=0.9",
			"cache-control": "no-cache",
			"dnt": 1,
			"pragma": "no-cache",
			"upgrade-insecure-requests": 1,
			"user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.80 Safari/537.36"
		}, 'GET', 30000 )
			.then( resp => {

				if ( resp )
					this.logger.debug( 'URL', url, 'exists' );
				else
					this.logger.debug( 'URL', url, 'does not exist' );

				return resp;

			} )
			.catch( err => {

				this.logger.error( 'URL check for', url, 'failed:', err );
				return false;

			} );

		if ( this.cacheEnabled === true )
			this.cache.put( url, result );

		return result;

	}


	async worker() {

		// file errors
		const errors = {};

		await this.generateListOfFiles();

		const hrefRx = new RegExp( "(?<=<a href=(.))(https?.*?)(?=\\1)", "gi" );
		const inlineRx = new RegExp( "(?<=[ '\"])(https?:\/\/[^,].+?)(?=([\\\\ '\",\|]|$))", "gi" ); // crude

		//
		// loop over all files and extract candidates for links
		//
		const links = this.files.reduce( ( all, file ) => {

			try {

				const content = fs.readFileSync( file.absolute, 'utf8' );
				const hrefs = content.match( hrefRx ) || [];
				const inlines = content.match( inlineRx ) || [];

				if ( hrefs.length === 0 && inlines.length === 0 )
					return all;

				new Set( [ ...hrefs, ...inlines ] ).forEach( url => {

					all.push( { file, url } );

				} );

			} catch ( err ) {

				this.logger.error( 'File', file.absolute, 'could not be read:', err );

				errors[ file.relative ] = err;

			}

			return all;

		}, [] );

		this.logger.debug( 'Detected links:', links.length );

		const checkedLinks = Promise.map( links, linkObj => {

			return this.checkUrl( linkObj.url )
				.then( resp => {

					if ( resp ) {

						this.logger.debug( `      ${linkObj.url} (${linkObj.file.absolute}): ${!! resp}` );

						return { file: linkObj.file.relative, url: linkObj.url, response: !! resp };

					} else {

						this.logger.debug( `ERR > ${linkObj.url} (${linkObj.file.absolute}): ${!! resp}` );

						return { file: linkObj.file.relative, url: linkObj.url, response: false };

					}

				} )
				.catch( err => {

					this.logger.error( `File '${linkObj.file.absolute}' with URL '${linkObj.url}':`, err );

					return { file: linkObj.file.relative, url: linkObj.url, response: false };

				} );

		}, { concurrency: 4 } )
			.catch( err => {

				this.logger.fatal( 'Promise.map failed:', err );

				throw err;

			} );


		return Promise.all( checkedLinks )
			.then( final => {

				const cacheDump = final.reduce( ( all, entry ) => {

					all.push( { url: entry.url, value: entry.response } );

					return all;

				}, [] );

				this.replaceCache( cacheDump );

				return final;

			} )
			.then( flattened => {

				// filter out any results with online URLs or no errors
				const broken = flattened.filter( x => x.response !== true );

				// reduce to object
				const results = broken.reduce( ( all, val ) => {

					// create it if it doesn't exist yet
					if ( typeof all[ val.file ] === 'undefined' )
						all[ val.file ] = { errors: [], results: [] };

					// add the failed URL
					all[ val.file ].results.push( val.url );

					return all;

				}, {} );

				// add files left-out because of an earlier error
				for ( const filename in errors )
					results[ filename ] = { errors: [ errors[ filename ] ], results: [] };

				this.logger.debug( "results", results );

				return { errors: [], results };

			} )
			.catch( err => {

				this.logger.fatal( 'Promise.all failed:', err );

				throw err;

			} );

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
		const check = new CheckNonDocsForBrokenExternalLinks( basePath, outputStream );
		const result = await check.run( basePath, outputStream );


		// done
		console.log( "RESULT:", result );

	} )();

}


module.exports = CheckNonDocsForBrokenExternalLinks;

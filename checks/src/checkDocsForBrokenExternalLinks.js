/*

	Check for broken external links
		i.e. [link:http...]

	Type: Static
	Needs build: No
	Needs docs: Yes
	Needs examples: No
	Needs source: No

*/

const Promise = require( 'bluebird' );
const fs = require( 'fs' );
const path = require( 'path' );
const urlExists = require( 'url-exists-deep' );
const dochandler = require( 'dochandler' );
const glob = require( 'glob' );

const BaseCheck = require( './BaseCheck' );
const CacheMixin = require( './CacheMixin' );


class CheckDocsForBrokenExternalLinks extends CacheMixin( '__cache_dump_Docs.json', BaseCheck ) {

	generateListOfFiles() {

		try {

			// all docs, everywhere
			this.files = glob.sync( path.join( this.basePath, 'docs', '{api,examples,manual,scenes}', '**', '*.html' ) ).map( file =>
				( { absolute: file, relative: path.relative( this.basePath, file ) } )
			);

		} catch ( err ) {

			this.logger.fatal( 'Listing docs failed:', err );

			throw err;

		}

		if ( ! this.files || this.files.length === 0 )
			throw new Error( 'No files found' );

		return this.files;

	}


	checkUrl( url ) {

		if ( this.cacheEnabled === true && this.cache.get( url ) !== undefined ) {

			this.logger.debug( 'Found', url, 'in cache:', this.cache.get( url ) );

			return this.cache.get( url );

		}

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

				if ( resp ) {

					this.logger.debug( 'URL', url, 'exists' );

				} else {

					this.logger.debug( 'URL', url, 'does not exist' );

				}

				if ( this.cacheEnabled === true )
					this.cache.put( url, resp );

				return resp;

			} )
			.catch( err => {

				this.logger.error( 'URL check for', url, 'failed:', err );
				return false;

			} );

		return result;

	}


	async worker() {

		// file errors
		const errors = {};

		this.generateListOfFiles();

		//
		// loop over all files and extract candidates for links
		//
		const links = this.files.reduce( ( all, file ) => {

			try {

				const tags = dochandler.parseDoc.parseFile( file.absolute )
					.filter( tag => tag.type === 'LinkTag' );

				if ( tags.length === 0 )
					return all;

				tags.forEach( ( { url } ) => {

					all.push( { "file": file, "url": url } );

				} );

			} catch ( err ) {

				this.logger.error( 'File', file.absolute, 'could not be parsed:', err );

				errors[ file.relative ] = { message: err.message.replace( this.basePath, '' ), location: err.location, name: err.name };

			}

			return all;

		}, [] );


		this.logger.debug( 'Detected links:', links.length );


		// turns a doc-page filepath into a valid doc-www category
		const toBeReplaced = new RegExp( '.*?docs/(api/(en|zh)|examples)/', 'ig' );


		const checkedLinks = Promise.map( links, linkObj => {

			const pathPlaceholder = linkObj.file.absolute.replace( toBeReplaced, '' ).replace( '.html', '' );
			const namePlaceholder = path.basename( linkObj.file.relative, '.html' );

			const url = linkObj.url.replace( /\[path\]/ig, pathPlaceholder ).replace( /\[name\]/ig, namePlaceholder );

			// shortcut
			if ( url.startsWith( '#' ) === true )
				return { file: linkObj.file.relative, url, response: true };

			// return this.checkUrl( url )
			return Promise.resolve( this.checkUrl( url ) )
				.then( resp => {

					if ( resp ) {

						this.logger.debug( `      ${url} (${linkObj.file.absolute}): ${!! resp}` );

						return { file: linkObj.file.relative, url: url, response: !! resp };

					} else {

						this.logger.debug( `ERR > ${url} (${linkObj.file.absolute}): ${!! resp}` );
						this.logger.info( resp );

						return { file: linkObj.file.relative, url: url, response: false };

					}

				} )
				.catch( err => {

					this.logger.error( `File '${linkObj.file.absolute}' with URL '${url}':`, err );

					return { file: linkObj.file.relative, url: url, response: false };

				} );

		}, { concurrency: 1 } )
			.catch( err => {

				this.logger.fatal( 'checkedLinks Promise.map failed:', err );

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

				// total number of hits over all entries
				let totalHits = 0;

				// reduce to object
				const results = broken.reduce( ( all, val ) => {

					// create it if it doesn't exist yet
					if ( typeof all[ val.file ] === 'undefined' )
						all[ val.file ] = { errors: [], results: [], hits: 0 };

					// add the failed URL
					all[ val.file ].results.push( val.url );

					// increment counters
					all[ val.file ].hits ++;
					totalHits ++;

					return all;

				}, {} );

				// add files left-out because of an earlier error
				for ( const filename in errors )
					results[ filename ] = { errors: [ errors[ filename ] ], hits: 0, results: [] };

				this.logger.debug( "results", results );

				return { errors: [], results, hits: totalHits };

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
		const check = new CheckDocsForBrokenExternalLinks( basePath, outputStream );
		const result = await check.run( basePath, outputStream );


		// done
		console.log( "RESULT:", result );

	} )();

}


module.exports = CheckDocsForBrokenExternalLinks;

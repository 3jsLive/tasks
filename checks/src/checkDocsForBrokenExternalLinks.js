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
const axios = require( 'axios' ).default;
const dochandler = require( 'dochandler' );
const glob = require( 'glob' );

const BaseCheck = require( './BaseCheck' );


class CheckDocsForBrokenExternalLinks extends BaseCheck {

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


	async checkUrl( url ) {

		if ( typeof this.cache[ url ] !== 'undefined' )
			return this.cache[ url ];

		try {

			const response = await axios.post( `${process.env.LINKCHECK_URL}/check`, {
				token: process.env.LINKCHECK_TOKEN,
				url: url
			} );

			this.logger.log( `URL ${url}: ${response.data.result}` );

			this.cache[ url ] = response.data.result;

			return response.data.result;

		} catch ( err ) {

			this.logger.error( `URL check for ${url} failed: ${err}` );

			this.cache[ url ] = false;

			return false;

		}

	}


	async worker() {

		// file errors
		const errors = {};

		// simple cache
		this.cache = {};

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
			return this.checkUrl( url )
				.then( resp => {

					if ( resp ) {

						this.logger.debug( `      ${url} (${linkObj.file.absolute}): ${!! resp}` );

						return { file: linkObj.file.relative, url: url, response: !! resp };

					} else {

						this.logger.debug( `ERR > ${url} (${linkObj.file.absolute}): ${!! resp}` );

						return { file: linkObj.file.relative, url: url, response: false };

					}

				} )
				.catch( err => {

					this.logger.error( `File '${linkObj.file.absolute}' with URL '${url}':`, err );

					return { file: linkObj.file.relative, url: url, response: false };

				} );

		}, { concurrency: 8 } )
			.catch( err => {

				this.logger.fatal( 'checkedLinks Promise.map failed:', err );

				throw err;

			} );


		return Promise.all( checkedLinks )
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

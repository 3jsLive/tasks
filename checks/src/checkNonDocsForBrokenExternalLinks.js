/*

	Check for broken external links
		i.e. <a href="http... or just http://...

	Type: Static
	Needs build: No
	Needs docs: No
	Needs examples: Yes
	Needs source: Yes

*/

const Promise = require( 'bluebird' );
const fs = require( 'fs' );
const path = require( 'path' );
const axios = require( 'axios' ).default;
const glob = require( 'glob' );

const BaseCheck = require( './BaseCheck' );


class CheckNonDocsForBrokenExternalLinks extends BaseCheck {

	async generateListOfFiles() {

		try {

			this.files = glob.sync( path.join( this.basePath, '{examples/**/*.js,examples/**/*.d.ts,examples/*.html,src/**/*.js,src/**/*.d.ts}' ) ).map( file =>
				( { absolute: file, relative: path.relative( this.basePath, file ) } )
			);

		} catch ( err ) {

			this.logger.fatal( 'Listing files failed:', err );

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

		// crude cache
		this.cache = {};

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

		}, { concurrency: 8 } )
			.catch( err => {

				this.logger.fatal( 'Promise.map failed:', err );

				throw err;

			} );


		return Promise.all( checkedLinks )
			.then( flattened => {

				// filter out any results with online URLs or no errors
				const broken = flattened.filter( x => x.response !== true );

				// total hits over all files
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
		const check = new CheckNonDocsForBrokenExternalLinks( basePath, outputStream );
		const result = await check.run( basePath, outputStream );


		// done
		console.log( "RESULT:", result );

	} )();

}


module.exports = CheckNonDocsForBrokenExternalLinks;

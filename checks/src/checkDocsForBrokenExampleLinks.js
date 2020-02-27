/*

	Check for broken links to examples
		i.e. [example:...]

*/

const Promise = require( 'bluebird' );
const fs = require( 'fs' );
const path = require( 'path' );
const dochandler = require( 'dochandler' );
const glob = Promise.promisifyAll( require( 'glob' ) );

const BaseCheck = require( './BaseCheck' );


class CheckDocsForBrokenExampleLinks extends BaseCheck {

	async generateListOfFiles() {

		this.files = await Promise.map(
			glob.globAsync( path.join( this.basePath, 'docs', '{api,examples,manual,scenes}', '**', '*.html' ) ),
			( file ) => ( { absolute: file, relative: path.relative( this.basePath, file ) } )
		);

		if ( ! this.files || this.files.length === 0 )
			throw new Error( 'No files found' );

		return this.files;

	}


	async worker() {

		// glob all relevant doc files
		await this.generateListOfFiles();

		this.logger.debug( `Analyzing ${this.files.length} files...` );

		return Promise.mapSeries( this.files, async file => {

			const retval = { errors: [], results: [] };

			this.logger.debug( `File: ${file}, Relative: ${file.relative}` );

			let parsed;
			try {

				const content = await fs.promises.readFile( file.absolute, 'utf8' );
				parsed = dochandler.parseDoc.parseString( content );

			} catch ( err ) {

				this.logger.error( 'Parsing Error with', file.absolute, ':', err );

				retval.errors.push( { message: err.message.replace( this.basePath, '' ), location: err.location, name: err.name } );
				return retval;

			}

			const exampleTags = parsed.filter( node => node.type === 'ExampleTag' );

			this.logger.debug( `Found ${exampleTags.length} ExampleTags` );

			if ( exampleTags.length === 0 )
				return retval;

			const _checkTagExistance = ( tag ) => {

				if ( ! tag.link ) {

					this.logger.error( 'ExampleTag without a link?', file.absolute, tag );

					retval.errors.push( `ExampleTag without a link: ${tag}` );

					return;

				}

				const checkFilepath = path.join( this.basePath, 'examples', tag.link + '.html' );

				const existance = fs.existsSync( checkFilepath );

				if ( existance === true ) {

					this.logger.debug( tag.link, 'found' );

					retval.results.push( { file: file.relative, example: tag.link, exists: true } );

				} else {

					this.logger.warn( tag.link, 'NOT found' );

					retval.results.push( { file: file.relative, example: tag.link, exists: false } );

				}

			};

			exampleTags.forEach( _checkTagExistance );

			return retval;

		} )
			.then( results => {

				// zip with files array and drop empty or positive results (positive = tags with non-missing examples)
				const final = this.files.reduce( ( all, file, index ) => {

					// errors or any results are interesting, for starters
					if ( results[ index ].errors.length > 0 || results[ index ].results.length > 0 ) {

						// filter down to relevant results (i.e. those with missing examples)
						const relevant = results[ index ].results.filter( res => res.exists === false );

						// only save if there are some relevant exampletags or any errors
						if ( relevant.length > 0 || results[ index ].errors.length > 0 )
							all[ file.relative ] = { errors: results[ index ].errors, hits: relevant.length, results: relevant };

					}

					return all;

				}, {} );

				this.logger.debug( 'Broken example links or errors:', final );

				this.logger.info( `Found ${Object.keys( final ).length} files with interesting ExampleTags` );

				return { errors: [], results: final };

			} )
			.catch( err => {

				this.logger.fatal( err );

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
		const check = new CheckDocsForBrokenExampleLinks( basePath, outputStream );
		const result = await check.run();


		// done
		console.log( "RESULT: %o", result );

	} )();

}


module.exports = CheckDocsForBrokenExampleLinks;

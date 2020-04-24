/*

	Check for broken links to examples
		i.e. [example:...]

	Type: Static
	Needs build: No
	Needs docs: Yes
	Needs examples: No
	Needs source: No

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


	static _blankLines( lines, start, end ) {

		if ( Number.isSafeInteger( start ) === false || Number.isSafeInteger( end ) === false )
			throw new Error( `Start and end have to be valid numbers: ${start} ${end}` );

		if ( start <= 0 )
			throw new Error( `Can't blank lines < 0: ${start}` );

		const tmp = lines.slice();

		if ( start - 1 > lines.length || end - 1 > lines.length )
			throw new Error( `Start or end outside range: ${start} ${end} ${tmp.length}` );

		for ( let i = start; i <= end; i ++ ) {

			tmp[ i - 1 ] = '_'.repeat( tmp[ i - 1 ].length );

		}

		return tmp;

	}

	_readChunk( content ) {

		const parsed = [];
		const errors = [];

		try {

			parsed.push( ...dochandler.parseDoc.parseString( content ) );

		} catch ( err ) {

			errors.push( { message: err.message.replace( this.basePath, '' ), location: err.location ? err.location : null, name: err.name } );

			this.logger.error( `_readChunk Error:`, err );

			if ( ! err.location || err.location === null )
				throw new Error( `Invalid location: ${err.location}` ); // can't do anything, give up

			this.logger.debug( `Blanking ${err.location.start.line} - ${err.location.end.line}` );

			const lines = CheckDocsForBrokenExampleLinks._blankLines( content.split( /\n/g ), err.location.start.line, err.location.end.line );

			// TODO: check for recursion error
			const tmp = this._readChunk( lines.join( '\n' ) );

			parsed.push( ...tmp.parsed );
			errors.push( ...tmp.errors );

		}

		return { parsed, errors };

	}

	async _readFile( file ) {

		let content;

		try {

			content = await fs.promises.readFile( file.absolute, 'utf8' );

		} catch ( err ) {

			this.logger.error( `IO Error with ${file.absolute}: ${err}` );

			return {
				parsed: [],
				errors: [
					{ message: err.message.replace( this.basePath, '' ), location: null, name: err.name }
				]
			};

		}

		try {

			return this._readChunk( content );

		} catch ( err ) {

			this.logger.error( `Parsing Error with ${file.absolute}: ${err}` );

			return {
				parsed: [],
				errors: [
					{ message: err.message.replace( this.basePath, '' ), location: err.location ? err.location : null, name: err.name }
				]
			};

		}

	}

	_checkTagExistance( tag ) {

		const errors = [];
		const results = [];

		if ( ! tag.link ) {

			this.logger.error( 'ExampleTag without a link?', tag );

			errors.push( { message: `ExampleTag without a link: ${tag.title}`, location: tag.location, name: 'Invalid tag' } );

			return { errors, results };

		} else {

			const checkFilepath = path.join( this.basePath, 'examples', tag.link + '.html' );

			const existance = fs.existsSync( checkFilepath );

			if ( existance === true ) {

				this.logger.debug( tag.link, 'found' );

				// results.push( { file: file.relative, example: tag.link, exists: true } );

			} else {

				this.logger.warn( tag.link, 'NOT found' );

				results.push( tag.link );

			}

		}

		return { errors, results };

	}

	async worker() {

		// glob all relevant doc files
		await this.generateListOfFiles();

		this.logger.debug( `Analyzing ${this.files.length} files...` );

		return Promise.mapSeries( this.files, async file => {

			const retval = { errors: [], results: [] };

			this.logger.debug( `File: ${file.absolute}, Relative: ${file.relative}` );

			const { parsed, errors } = await this._readFile( file );

			if ( errors.length > 0 ) {

				retval.errors.push( ...errors );

			}

			const exampleTags = parsed.filter( node => node.type === 'ExampleTag' );

			this.logger.debug( `Found ${exampleTags.length} ExampleTags` );

			if ( exampleTags.length === 0 )
				return retval;

			exampleTags.forEach( tag => {

				const { errors, results } = this._checkTagExistance( tag );

				retval.errors.push( ...errors );

				retval.results.push( ...results );

			} );

			return retval;

		} )
			.then( results => {

				let totalHits = 0;

				// zip with files array and drop empty or positive results (positive = tags with non-missing examples)
				const final = this.files.reduce( ( all, file, index ) => {

					const errors = results[ index ].errors;
					const relevant = results[ index ].results;

					// only save if there are some relevant exampletags or any errors
					if ( relevant.length > 0 || errors.length > 0 ) {

						all[ file.relative ] = { errors: errors, hits: relevant.length, results: relevant };
						totalHits += relevant.length;

					}

					return all;

				}, {} );

				this.logger.debug( 'Broken example links or errors:', final );

				this.logger.info( `Found ${Object.keys( final ).length} files with interesting ExampleTags` );

				return { errors: [], hits: totalHits, results: final };

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

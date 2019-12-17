/*

	Lint the HTML files in examples/ and docs/

	NOTE: no special doobsian style rules so far

*/

const fs = require( 'fs' );
const path = require( 'path' );
const HTMLHint = require( 'htmlhint' ).default;
const glob = require( 'glob' );


const rules = { ...HTMLHint.defaultRuleset, 'attr-value-double-quotes': false, 'title-require': false };


const BaseLinter = require( './BaseLinter' );


class HTMLLint extends BaseLinter {


	async generateListOfFiles() {

		try {

			this.files = glob.sync( '{docs,examples}/**/*.html', { absolute: true, cwd: this.basePath } )
				.map( file => ( { absolute: file, relative: path.relative( this.basePath, file ) } ) );

			if ( ! this.files || this.files.length === 0 )
				throw new Error( 'No files found' );

		} catch ( err ) {

			this.logger.fatal( 'Listing docs failed:', err );

			throw err;

		}

	}


	/**
	 * @returns {{ errors: any[], results: Object.<string, { errors: any[], results: { line: number, col: number, evidence: string, message: string, raw: string, type: string, rule: { description: string, id: string, link: string } }[] }> } }
	 */
	async worker() {

		let final = {};

		this.files.forEach( file => {

			if ( ! fs.existsSync( file.absolute ) ) {

				this.logger.error( `File not found: ${file.relative}` );

				final[ file.relative ] = { errors: [ 'File not found' ], results: [] };

				return;

			}

			let content;

			try {

				content = fs.readFileSync( file.absolute, 'utf8' );

			} catch ( err ) {

				this.logger.error( `Error reading: ${err}` );

				final[ file.relative ] = { errors: [ `Error reading: ${err}` ], results: [] };

				return;

			}

			const results = HTMLHint.verify( content, rules );

			results.forEach( report => {

				this.logger.debug( `${file.relative}: ${report.type} ${report.message} ${report.line} ${report.rule.id}` );

			} );

			if ( results.length > 0 )
				final[ file.relative ] = { errors: [], results };

		} );

		return { errors: [], results: final };

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
		const linter = new HTMLLint( basePath, outputStream );
		const result = await linter.run();


		// done
		console.log( "RESULT:", result );

	} )();

}


module.exports = HTMLLint;

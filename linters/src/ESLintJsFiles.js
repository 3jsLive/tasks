/*

	Lint the JavaScript files in examples/{js,jsm}/ and src/

*/

const fs = require( 'fs' );
const path = require( 'path' );
const CLIEngine = require( 'eslint' ).CLIEngine;
const glob = require( 'glob' );

const BaseLinter = require( './BaseLinter' );


class ESLintJsFiles extends BaseLinter {

	async generateListOfFiles() {

		try {

			this.files = glob.sync( '{src,examples/{js,jsm}}/**/*.js', { absolute: true, cwd: this.basePath } )
				.map( file => ( { absolute: file, relative: path.relative( this.basePath, file ) } ) );

			if ( ! this.files || this.files.length === 0 )
				throw new Error( 'No files found' );

		} catch ( err ) {

			this.logger.fatal( 'Listing docs failed:', err );

			throw err;

		}

	}


	/**
	 * @returns {{ errors: any[], hits: number, results: Object.<string, { errors: any[], hits: number, results: { line: number, ruleId: string, severity: number, message: string }[] }> } }
	 */
	async worker() {

		const cli = new CLIEngine( {
			baseConfig: {
				extends: [ 'mdcs' ]
			},
			parser: 'espree',
			plugins: [],
			useEslintrc: false,
			ignorePattern: [ '**/examples/js/libs/**/*.js', '*.min.js', 'draco' ] // those just eat RAM like crazy
		} );

		let final = {};
		let totalHits = 0;

		this.files.forEach( file => {

			if ( ! fs.existsSync( file.absolute ) ) {

				this.logger.error( `File not found: ${file.relative}` );

				final[ file.relative ] = { errors: [ { message: 'File not found' } ], hits: 0, results: [] };

				return;

			}

			cli.executeOnFiles( [ file.absolute ] ).results.forEach( report => {

				if ( report.errorCount > 0 || report.warningCount > 0 ) {

					this.logger.debug( `Found ${report.errorCount} Errors and ${report.warningCount} Warnings in ${file.relative}` );

					const results = report.messages.map( m => {

						this.logger.debug( `${m.line} ${m.message} (${m.ruleId})` );

						return { line: m.line, message: m.message, ruleId: m.ruleId, severity: m.severity };

					} );

					if ( results.length > 0 ) {

						final[ file.relative ] = { errors: [], results, hits: results.length };
						totalHits += results.length;

					} else {

						this.logger.error( `Errors/Warnings were found but no results? ${report.errorCount} & ${report.warningCount}` );

						final[ file.relative ] = { errors: [ { message: `Errors/Warnings were found but no results?` } ], hits: 0, results: [] };

					}

				} else {

					this.logger.debug( "No Errors or Warnings in", file.relative );

				}

			} );

		} );

		return { errors: [], results: final, hits: totalHits };

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
		const linter = new ESLintJsFiles( basePath, outputStream );
		const result = await linter.run();


		// done
		console.log( "RESULT:", result );

	} )();

}


module.exports = ESLintJsFiles;

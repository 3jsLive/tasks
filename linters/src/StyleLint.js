/*

	Lint the CSS files and styles embedded in HTML files in examples/ and docs/

	NOTE: no special doobsian style rules so far

*/

const fs = require( 'fs' );
const path = require( 'path' );
const stylelint = require( 'stylelint' );


const BaseLinter = require( './BaseLinter' );


class StyleLint extends BaseLinter {


	async generateListOfFiles() {

		// slightly off-track, but I'll allow it
		this.files = path.join( this.basePath, "**/{*.html, *.css}" );

	}


	/**
	 * @returns {{ errors: any[], results: Object.<string, { errors: any[], results: { line: number, ruleId: any, severity: any, message: string }[] }> } }
	 */
	async worker() {

		try {

			const results = await stylelint.lint( {
				config: {
					extends: 'stylelint-config-recommended'
				},
				files: this.files
			} );

			const final = results.results.filter( result => result.errored || result.ignored ).reduce( ( all, result ) => {

				const relPath = path.relative( this.basePath, result.source );

				const warnings = result.warnings.map( warn => {

					return { line: warn.line, ruleId: warn.rule, severity: warn.severity, message: warn.text };

				} );

				if ( result.parseErrors.length > 0 ) {

					this.logger.error( 'result.parseErrors', result.parseErrors );
					all[ relPath ] = { errors: result.parseErrors, results: warnings };

				} else {

					all[ relPath ] = { errors: [], results: warnings };

				}

				return all;

			}, {} );

			return { errors: [], results: final };

		} catch ( err ) {

			this.logger.fatal( err );

			throw err;

		}

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
		const linter = new StyleLint( basePath, outputStream );
		const result = await linter.run();


		// done
		console.log( "RESULT:", result );

	} )();

}


module.exports = StyleLint;

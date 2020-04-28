/*

	Lint JavaScript code in <code> tags in the docs/

	Also adds THREE, 'renderer' 'scene' as global, so the linter
	won't complain about un-def variables and turns off
	linter warnings about indent.

*/

const fs = require( 'fs' );
const path = require( 'path' );
const htmlparser = require( 'htmlparser2' );
const CLIEngine = require( 'eslint' ).CLIEngine;
const lister = require( 'listfiles' );


const BaseLinter = require( './BaseLinter' );


class ESLintCodeTags extends BaseLinter {

	async generateListOfFiles() {

		try {

			this.files = lister
				.docs( { basePath: this.basePath, baseUrl: path.join( this.basePath, 'docs/' ) } )
				.urls
				.filter( path => ! path.includes( '/zh/' ) )
				// .filter( path => ! path.includes( 'examples/quickhull/' ) ); // FIXME: hack because the zh docs are out-of-date and lister doesn't support languages
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
			envs: [ "browser", "es6" ],
			parser: 'espree',
			plugins: [],
			useEslintrc: false
		} );

		let final = {};
		let totalHits = 0;

		this.files.forEach( file => {

			if ( ! fs.existsSync( file.absolute ) ) {

				this.logger.error( `File not found: ${file.absolute}` );

				final[ file.relative ] = { errors: [ { message: 'File not found' } ], hits: 0, results: [] };

				return;

			}

			let content;

			try {

			 content = fs.readFileSync( file.absolute, 'utf8' );

			} catch ( err ) {

				this.logger.error( file.absolute, 'Error reading:', err );

				final[ file.relative ] = { errors: [ { message: `Error reading: ${err}` } ], hits: 0, results: [] };

				return;

			}

			let inScript = false;
			let rawScript = "";

			try {

				const parser = new htmlparser.Parser( {
					onopentag: function ( name ) {

						if ( name === "code" ) {

							inScript = true;

						}

					},
					ontext: function ( text ) {

						if ( inScript )
							rawScript += text;

					},
					onclosetag: function ( tagname ) {

						if ( tagname === "code" && inScript ) {

							inScript = false;

						}

					}
				}, { decodeEntities: true } );

				parser.parseComplete( content );
				parser.end();

			} catch ( err ) {

				this.logger.error( 'Error parsing:', err );

				final[ file.relative ] = { errors: [ { message: `Error parsing: ${err}` } ], hits: 0, results: [] };

				return;

			}

			// calc proper line and index offsets for better errors
			const firstLine = rawScript.trim().split( "\n", 1 );
			const firstLineIndexInHtml = content.indexOf( firstLine );
			const firstLineOffsetInHtml = content.substring( 0, firstLineIndexInHtml ).split( "\n" ).length;
			const firstLineIndexInCode = rawScript.indexOf( firstLine );
			const firstLineOffsetInCode = rawScript.substring( 0, firstLineIndexInCode ).split( "\n" ).length;

			// replace placeholders
			rawScript = rawScript.trim() + "\n";
			rawScript = rawScript.replace( /\[name\]/g, 'namePlaceholder' );
			rawScript = rawScript.replace( /\[path\]/g, 'pathPlaceholder' );

			// assorted globals to ignore
			let globals = [ ];
			if ( rawScript.includes( 'THREE' ) )
				globals.push( 'THREE' );
			if ( rawScript.includes( 'scene' ) )
				globals.push( 'scene' );
			if ( rawScript.includes( 'renderer' ) )
				globals.push( 'renderer' );

			// lint it
			let report;
			try {

				report = cli.executeOnText( [
					"/* eslint-disable indent, no-unused-vars */",
					"/* global " + globals.join( ", " ) + " */",
					rawScript
				].join( "\n" ), file.absolute + '.js' );

			} catch ( err ) {

				this.logger.error( file.absolute, 'Error parsing:', err );

				final[ file.relative ] = { errors: [ { message: `Error parsing: ${err}` } ], hits: 0, results: [] };

				return;

			}

			const results = report.results[ 0 ].messages.map( msg => {

				const location = msg.line + ( firstLineOffsetInHtml - firstLineOffsetInCode );

				this.logger.debug( `${location}\t${msg.message}\t${msg.ruleId}` );

				return {
					line: location,
					message: msg.message,
					severity: msg.severity,
					ruleId: msg.ruleId
				};

			} );

			if ( results.length > 0 ) {

				final[ file.relative ] = { results, errors: [], hits: results.length };
				totalHits += results.length;

			}

			this.logger.debug( `Err: ${report.results[ 0 ].errorCount}  Warn: ${report.results[ 0 ].warningCount}  File: ${file.absolute} (${file.relative})` );

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
		const linter = new ESLintCodeTags( basePath, outputStream );
		const result = await linter.run();


		// done
		console.log( "RESULT:", result );

	} )();

}


module.exports = ESLintCodeTags;

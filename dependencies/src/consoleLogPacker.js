const fs = require( 'fs' );
const path = require( 'path' );
const signale = require( 'signale' );
const stringify = require( 'json-stable-stringify' );
const glob = require( 'glob' );


/*

	Mushes all `*_consoleLog-$sha.json` files into one, to confirm
	to our default results-file-structure and -naming

*/


class ConsoleLogPacker {

	/**
	 * @param {string} inputPath
	 * @param {string} outputPath
	 * @param {string} inputGlob
	 */
	constructor( inputPath, outputPath, inputGlob ) {

		this.inputPath = inputPath;
		this.outputPath = outputPath;
		this.inputGlob = inputGlob;

		this.logger = signale.scope( 'ConsoleLogPacker' );
		this.logger.config( { displayTimestamp: true, displayDate: true } );

		// result
		this.consoleLogs = { errors: [], hits: 0, results: {} };

	}


	run() {

		let outputFile;

		for ( const inputFile of glob.sync( this.inputGlob, { cwd: this.inputPath } ) ) {

			const data = JSON.parse( fs.readFileSync( path.join( this.inputPath, inputFile ), 'utf8' ) );

			const demangledExample = path.basename( inputFile ).replace( 'examples_', 'examples/' ).replace( /_consoleLog.+$/, '.html' );

			if ( data.length > 0 ) {

				this.consoleLogs.results[ demangledExample ] = { errors: [], hits: data.length, results: data };
				this.consoleLogs.hits += data.length;

			}

			// TODO: we could/should deduplicate the log entries

			// FIXME: hardcoded
			outputFile = inputFile.replace( /^.+consoleLog-([a-f0-9]{40})\.json$/, 'ProfConsole-$1.json' );

		}

		this.logger.debug( `Saving '${outputFile}'...` );
		fs.writeFileSync( path.join( this.outputPath, outputFile ), stringify( this.consoleLogs ), 'utf8' );

		this.logger.debug( 'Done' );

	}

}


module.exports = ConsoleLogPacker;


// simple CLI-fication
if ( require.main === module ) {

	if ( process.argv.length < 4 ) {

		console.error( 'Invalid number of arguments' );

		console.log( `Usage: ${path.basename( process.argv[ 0 ] )} ${path.relative( process.cwd(), process.argv[ 1 ] )} <Input path> <Output path> [Input glob]` );

		process.exit( - 1 );

	}

	// eslint-disable-next-line no-unused-vars
	let [ node, script, inputPath, outputPath, inputGlob ] = process.argv;

	try {

		inputGlob = ( inputGlob ) ? inputGlob : 'examples_*consoleLog-*.json';

		console.log( 'Init...' );
		const packer = new ConsoleLogPacker( inputPath, outputPath, inputGlob );

		console.log( 'Work...' );
		packer.run();

		console.log( 'Done' );

	} catch ( err ) {

		console.error( 'The big one >', err );
		process.exit( - 1 );

	}

}

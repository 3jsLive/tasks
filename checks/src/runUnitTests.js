const puppeteer = require( 'puppeteer' );
const fs = require( 'fs' );
const path = require( 'path' );
const HTTPServer = require( 'http-server' );


// TODO: refactor

const BaseCheck = require( './BaseCheck' );


const TESTS_URL = 'http://127.0.0.1:8823/test/unit/UnitTests.html';


class RunUnitTests extends BaseCheck {

	/**
	 * @param {number} port
	 * @param {string} ip
	 */
	async _prepare( port, ip ) {

		// start dev server and puppeteer
		this.server = HTTPServer.createServer( { cache: - 1, root: this.basePath } );
		this.server.listen( port, ip );
		this.browser = await puppeteer.launch( {
			headless: true,
			dumpio: true
		} );


		// always kill browser and server on exit (too much maaaybe)
		[ 'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
			'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
		].forEach( signal => {

			process.on( signal, async () => {

				try {

					this.server.close();

				} catch ( err ) {

					this.logger.error( `Server closing failed: ${err}` );

				}

				try {

					await this.browser.close();

				} catch ( err ) {

					this.logger.error( `Browser closing failed: ${err}` );

				}

				process.exit( 1 );

			} );

		} );

	}

	async worker() {

		await this._prepare( 8823, '127.0.0.1' );

		const page = await this.browser.newPage();

		const events = [];

		page.on( 'console', msg => {

			events.push( { type: 'console', payload: { text: msg.text(), type: msg.type() } } );

		} );

		page.on( 'error', err => {

			events.push( { type: 'error', payload: { text: err.message } } );

		} );

		page.on( 'pageerror', err => {

			events.push( { type: 'pageerror', payload: { text: err.text, type: err.type } } );

		} );

		await page.goto( TESTS_URL, { timeout: 120 * 1000 } );


		// Give QUnit some time to setup its UI
		this.logger.debug( "Waiting for UI" );
		await page.waitFor( () => document.querySelector( "#qunit-abort-tests-button" ) );


		// Abort button gone -> Tests done
		this.logger.debug( "Waiting for button to be removed" );
		await page.waitFor( () => ! document.querySelector( "#qunit-abort-tests-button" ) );


		// Scrape the final verdict
		this.logger.debug( "Button gone, scraping results" );
		const resultsLine = await page.evaluate( () => {

			let el = document.getElementById( 'qunit-testresult-display' );

			return el.textContent;

		} );

		let results = { tests: 'error', time: - 1, failed: - 1, skipped: - 1, todo: - 1, events: false };

		const rx = /(\d+) tests.*?in (\d+).*?(\d+) failed.*?(\d+) skipped.*?(\d+) todo/gi;
		const m = rx.exec( resultsLine );
		if ( m !== null ) {

			results.tests = parseInt( m[ 1 ] );
			results.time = parseInt( m[ 2 ] );
			results.failed = parseInt( m[ 3 ] );
			results.skipped = parseInt( m[ 4 ] );
			results.todo = parseInt( m[ 5 ] );

		}

		this.logger.info( `Results: ${results.failed} of ${results.tests} tests failed with ${results.todo} tests todo and ${results.skipped} skipped. Total time: ${results.time}` );

		await page.close();

		results.events = events;

		// shutdown dev server and browser
		this.server.close();
		await this.browser.close();

		return results;

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
		const check = new RunUnitTests( basePath, outputStream );

		// analyze
		const result = await check.run( basePath, outputStream );


		// done
		console.log( "RESULT:", result );

		// hard exit
		process.kill( process.pid );

	} )();

}

module.exports = RunUnitTests;

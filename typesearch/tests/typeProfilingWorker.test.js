const fs = require( 'fs' );

const assert = require( 'assert' );

const runnerClass = require( `../src/typeProfilingRunner` );
const HTTPServer = require( 'http-server' );

const globalConfig = require( 'rc' )( '3jsdev' );
const servicesConfig = require( 'rc' )( 'services', globalConfig );
const config = require( 'rc' )( 'typesearch', servicesConfig );

const Xvfb = require( '@cypress/xvfb' );
const Promise = require( 'bluebird' );

const xvfb = Promise.promisifyAll(
	new Xvfb( {
		xvfb_args: '-screen 0 1024x768x24 -ac -nolisten tcp -dpi 96 +extension GLX +extension RENDER +extension RANDR'.split( / /g ),
		timeout: 10000
	} )
);

const retryStop = ( i = 0 ) => {

	return xvfb.stopAsync().catch( { timedOut: true }, ( e ) => {

		console.log( 'Timed out stopping', e.message );
		if ( i < 5 ) {

			return retryStop( i + 1 );

		}
		throw e;

	} );

};

const testBasePath = `${__dirname}/data/typeProfilingWorker/`;
const gold = JSON.parse( fs.readFileSync( `${__dirname}/data/typeProfilingWorker/gold.json`, 'utf8' ) );


describe( `typeProfilingWorker`, function () {

	let server;

	before( 'start xvfb', async function () {

		return await xvfb.startAsync();

	} );

	before( 'start server', function () {

		// start dev server
		server = HTTPServer.createServer( { cache: - 1, root: testBasePath } );
		server.listen( config.typesearch.baseUrl.port, config.typesearch.baseUrl.host );

		// always kill server on exit (too much maaaybe)
		[ 'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
			'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
		].forEach( signal => {

			process.on( signal, async () => {

				try {

					server.close();

					await retryStop();
					await xvfb.stopAsync();

				} catch ( err ) {

					console.error( `Server closing failed: ${err}` );

				}

				// process.exit( 1 );

			} );

		} );

	} );

	after( 'kill server', function () {

		server.close();

	} );

	after( 'kill xvfb', async function () {

		await retryStop();
		return await xvfb.stopAsync();

	} );

	after( 'clean up', function () {

		// fs.unlinkSync( `${__dirname}/data/typeProfilingWorker/examples_css3d_sprites.json` );

	} );


	it( 'basics', async function () {

		// timeout due to the additional workload
		this.timeout( 240000 );

		// analyze
		const profiler = new runnerClass(
			testBasePath,
			testBasePath,
			'build/three.module.js',
			`http://${config.typesearch.baseUrl.host}:${config.typesearch.baseUrl.port}/`
		);
		profiler.loadUrls( [ `http://${config.typesearch.baseUrl.host}:${config.typesearch.baseUrl.port}/examples/css3d_sprites.html` ] );
		await profiler.run();

		// hacky
		const profile = JSON.parse( fs.readFileSync( `${__dirname}/data/typeProfilingWorker/examples_css3d_sprites.json`, 'utf8' ) );

		// even hackier
		gold.results.result.sort( ( scriptA, scriptB ) => scriptA.url.localeCompare( scriptB.url ) );
		gold.results.result.forEach( script => script.entries.sort( ( a, b ) => a.offset - b.offset ) );
		profile[ 0 ].results.result.sort( ( scriptA, scriptB ) => scriptA.url.localeCompare( scriptB.url ) );
		profile[ 0 ].results.result.forEach( script => script.entries.sort( ( a, b ) => a.offset - b.offset ) );

		assert.deepStrictEqual( profile[ 0 ], gold );

	} );

} );

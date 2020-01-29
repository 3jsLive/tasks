const fs = require( 'fs' );
const Promise = require( 'bluebird' );
const signale = require( 'signale' );


/*

	Type profiling
	A special mode in Google Chrome where the JS engine logs
	which types functions and arguments were using

*/


class TypeProfilingWorker {

	/**
	 * @param {puppeteer.Page} page
	 * @param {string} url
	 * @param {string} threejsBuildFile
	 * @param {string} modifiedThree
	 */
	constructor( page, url, threejsBuildFile, modifiedThree ) {

		this.page = page;
		this.url = url;
		this.threejsBuildFile = threejsBuildFile;
		this.modifiedThree = modifiedThree;

		// trip-wire
		this.noMainScriptFileInterceptedYet = true;

		this.client = null;
		this.profilerRunning = false;

		this.maxInflightRequests = 0;
		this.timeout = 4000;

		this.logger = signale.scope( 'Worker' );

		/*
			About that...
			If a page hard crashed, it happened in the page.on( 'error' ) listener and outside
			the then/catch line, causing the whole program to crash (usually with a SEGV_MAPPER)
			'skipper' serves as the canary and is used in the Promise.any( [ page.goto, skipper ] )
			instruction.
			If we crash in the 'error' listener, skipper is fulfilled and not page.goto
			If we don't crash, it's page.goto as usual

			A bit hacky admittedly, but it works and I'm tired :)
		*/
		this.skipper = null;
		this.skipperFulFill = null;

	}

	async tearDownPage() {

		// riveting
		return this.page.close();

	}

	async setupPage() {

		this.logger.debug( 'Basic setup...' );

		const seedRandom = await fs.promises.readFile( __dirname + '/seedrandom.min.js', 'utf8' );
		const timekeeper = await fs.promises.readFile( __dirname + '/timekeeper.min.js', 'utf8' );

		await this.page.setViewport( { width: 320, height: 240 } ); // basics
		await this.page.evaluateOnNewDocument( seedRandom + timekeeper ); // consistency
		await this.page.setRequestInterception( true ); // network interception and modification


		this.logger.debug( 'Starting listeners...' );

		this.page.on( 'console', msg => this.logger.debug( `Console ${msg.text()}` ) );
		this.page.on( 'request', req => this.logger.debug( `Request ${req.method()} ${req.url()}` ) );
		this.page.on( 'pageerror', msg => this.logger.debug( `PageError ${msg}` ) );
		this.page.on( 'error', e => {

			this.logger.error( 'Crash error:', e );

			this.skipperFulFill( { url: this.url, status: 'failed' } );

			// throw e;

		} );

		this.logger.debug( 'Starting debugger trap...' );

		this.client = await this.page.target().createCDPSession();
		await this.client.send( 'Runtime.enable' );
		await this.client.send( 'Debugger.enable' );
		await this.client.send( 'Performance.enable' );
		this.client.addListener( 'Debugger.paused', async ( /* event */ ) => {

			if ( this.profilerRunning === false ) {

				this.profilerRunning = true;

				await this.client.send( 'Profiler.enable' );
				await this.client.send( 'Profiler.startTypeProfile' );
				await this.client.send( 'Profiler.startPreciseCoverage', { callCount: true } );
				this.logger.debug( 'Started profiler' );

			}

			await this.client.send( 'Debugger.resume' );

		} );

		return true;

	}


	/**
	 * As the name implies, waits for a radio silence of at least `this.timeout` milliseconds
	 * We can't just go by `Loaded` or `DOMContentLoaded` events firing since our tests
	 * frequently load external assets after the page itself has already finished loading.
	 * And Puppeteer's inbuilt `networkidle0/2` events are not far-reaching enough.
	 *
	 * from https://github.com/GoogleChrome/puppeteer/issues/1353#issuecomment-356561654
	 */
	waitForNetworkIdle( ) {

		// time's up, cut everything off and stop profiling
		const onTimeoutDone = () => {

			if ( ! promise.isFulfilled() ) {

				return fullyLoaded.then( () => {

					this.logger.debug( `${this.timeout}ms since last request -> working...` );

					this.page.removeListener( 'request', onRequestStarted );
					this.page.removeListener( 'requestfinished', onRequestFinished );
					this.page.removeListener( 'requestfailed', onRequestFinished );

					this.logger.debug( 'Network listeners removed' );

					fulfill();

					return true;

				} );

			}

		};

		const onRequestStarted = async ( interceptedRequest ) => {

			inflight ++;

			if ( inflight > this.maxInflightRequests )
				clearTimeout( timeoutId );

			// if we intercept a request for our main script
			if ( interceptedRequest.url().endsWith( this.threejsBuildFile ) ) {

				// we answer instead with our modified version
				await interceptedRequest.respond( {
					status: 200,
					contentType: 'text/javascript',
					body: this.modifiedThree
				} );

				this.noMainScriptFileInterceptedYet = false;

				this.logger.debug( `${this.threejsBuildFile} intercepted` );

			} else {

				// console.log( 'NOPE:', interceptedRequest.url() );
				// otherwise continue as normal, only slightly delayed to allow for
				// the main script to be fully parsed
				// setTimeout( () => interceptedRequest.continue(), 500 );
				interceptedRequest.continue();

			}

		};

		const onRequestFinished = () => {

			if ( inflight === 0 )
				return;

			if ( inflight < 0 )
				this.logger.warn( 'inflight < 0 ?' );

			inflight --;

			// not done yet, extend our timeout
			if ( inflight === this.maxInflightRequests || ! fullyLoaded )
				timeoutId = setTimeout( onTimeoutDone, this.timeout );

		};

		const pageLoaded = () => {

			loadedEvent();

		};

		this.page.on( 'request', onRequestStarted );
		this.page.on( 'requestfinished', onRequestFinished );
		this.page.on( 'requestfailed', onRequestFinished );
		this.page.on( 'load', pageLoaded );

		let inflight = 0;
		let loadedEvent;
		let fullyLoaded = new Promise( x => loadedEvent = x );
		let fulfill;
		let promise = new Promise( x => fulfill = x );
		let timeoutId = setTimeout( onTimeoutDone, this.timeout );

		return promise;

	}


	/**
	 * @returns {{ url: string, status: string, results: any[], errors: any[] }}
	 */
	run() {

		this.logger.debug( `Requesting ${this.url}...` );

		const promiseNetworkHasBeenIdle = this.waitForNetworkIdle();

		this.skipper = new Promise( x => this.skipperFulFill = x );

		// goto url, wait for network idle, collect profile data, report success
		return Promise.any( [
			this.page.goto( this.url, { timeout: 120000, waitUntil: 'load' } ),
			this.skipper
		] )
			.then( ret => {

				this.logger.debug( 'Arrived' );

				if ( ret.status === 'failed' )
					return { errors: [ 'Page crashed' ] };
				else
					this.logger.debug( 'ret.status', ret.status );

				return promiseNetworkHasBeenIdle
					.then( () => {

						if ( this.noMainScriptFileInterceptedYet === true )
							throw new Error( `No ${this.threejsBuildFile} intercepted yet, aborting...` );
						else
							return true;

					} )
					.then( () => {

						this.logger.debug( 'Network has been idle for long enough, working...' );

						this.profilerRunning = false;

						this.logger.debug( 'Removing listeners...' );
						return this.page.removeAllListeners( 'request' );

					} )
					.then( () => {

						this.logger.debug( 'Profiler.takeTypeProfile' );

						return Promise.any( [
							this.client.send( 'Profiler.takeTypeProfile' ),
							new Promise( x => x ).delay( 60000, false )
						] )
							.then( result => {

								if ( ! result ) {

									this.logger.error( 'Promise.delay triggered' );

									throw new Error( 'takeTypeProfile timed out' );

								}

								return this.client.send( 'Profiler.stopTypeProfile' )
									.then( () => this.logger.debug( 'TypeProfiler stopped' ) )
									.then( () => ( { result } ) );

							} )
							.catch( err => {

								this.logger.error( `takeTypeProfile failed: ${err}\nURL: ${this.url}` );

								throw err;

							} );

					} )
					.catch( err => {

						this.logger.fatal( 'Fatal error in Profiler.takeTypeProfile >', err );

						return { errors: [ err ] };

					} );

			} )
			.catch( err => {

				this.logger.error( `page.goto failed: ${err}\nSTACK:${err.stack}\nURL: ${this.url}` );

				throw err;

			} )
			.then( result => {

				if ( typeof result[ 'result' ] !== 'undefined' )
					return { url: this.url, status: 'success', results: result.result, errors: [] };
				else
					return { url: this.url, status: 'failure', results: [], errors: result.errors };

			} )
			.catch( err => this.logger.fatal( 'Unknown error:', err ) );

	}

}


module.exports = TypeProfilingWorker;

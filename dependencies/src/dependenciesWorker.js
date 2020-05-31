const fs = require( 'fs' );
const linesAndCols = require( 'lines-and-columns' );
const Promise = require( 'bluebird' );
const signale = require( 'signale' );

const config = require( 'rc' )( 'tasks' );

/*

	Function-level dependency tracking for 3js examples
		+ stats collection
		+ console logging

*/

process.on( 'unhandledRejection', ( reason/* , p */ ) => {

	console.error( 'unhandledRejection' );
	throw reason;

} );

process.on( 'uncaughtException', error => {

	console.error( 'uncaughtException' );
	console.error( error );

} );


class DependenciesWorker {

	/**
	 * @param {import("puppeteer").Page} page
	 * @param {string} url
	 * @param {string} buildFile
	 * @param {string} modifiedThree
	 * @param {Object} shaderLibs
	 * @param {Object} shaderChunks
	 */
	constructor( page, url, buildFile, modifiedThree, shaderLibs, shaderChunks ) {

		this.page = page;
		this.url = url;
		this.client = null;

		this.logger = signale.scope( 'Worker' );
		this.logger.config( { displayTimestamp: true } );

		// trip-wire
		this.noMainScriptFileInterceptedYet = true;

		// tracked stuff
		this.loggedRequests = [];
		this.consoleLog = [];
		this.trackedShaders = { ShaderChunk: [], ShaderLib: {}, UniformsLib: [] };

		this.shaderLibs = shaderLibs;
		this.shaderChunks = shaderChunks;

		// profiling
		this.profilerRunning = false;
		this.profilerResults = null;

		// stats
		this.metricsStart = 0;
		this.metricsTimer = null;
		this.metrics = [];

		// results
		this.stats = null;
		this.dependencies = null;

		// FIXME: move from worker to runner? Or at least use modifiedThree?
		this.source = fs.readFileSync( buildFile, 'utf8' );
		this.lines = new linesAndCols.default( this.source );

		this.modifiedTHREE = modifiedThree;

	}


	async tearDownPage() {

		// dead as disco
		return this.page.close();

	}


	async setupPage() {

		this.logger.log( 'Setting up page...' );

		// basics
		await this.page.setViewport( { width: 320, height: 240 } ); // TODO: config


		//
		// exposed functions
		//
		await this.page.exposeFunction( 'trackShaderChunk', /* istanbul ignore next */shader => {

			// console.log( `Pushing chunk ${shader}` );
			this.trackedShaders.ShaderChunk.push( this.shaderChunks[ shader ] );

		} );

		await this.page.exposeFunction( 'trackShaderLib', /* istanbul ignore next */( propertyName, shaderName ) => {

			// console.log( `Pushing lib ${shaderName}.${propertyName}` );
			this.trackedShaders.ShaderLib[ shaderName ] = this.shaderLibs[ shaderName ];

			// console.log( `Pushing uniforms for ${shaderName}` );
			this.trackedShaders.UniformsLib.push( ...this.shaderLibs[ shaderName ].uniformsRefs );

		} );

		this.logger.debug( 'intial setup done, setting listeners...' );


		//
		// Listeners
		//
		const scrub = text => text.replace ? text.replace( new RegExp( config.dependencies.baseUrl, 'g' ), 'HOST/' ) : text;

		this.page.on( 'console', msg => {

			this.logger.debug( `Console ${msg.text()}` );

			this.consoleLog.push( {
				type: 'console',
				msg: {
					type: msg.type(),
					text: scrub( msg.text() ),
					location: scrub( `${msg.location().url}:${msg.location().lineNumber || 0}:${msg.location().columnNumber || 0}` ),
					args: scrub( msg.args().join( ' ' ) )
				}
			} );

		} );

		this.page.on( 'pageerror', msg => {

			this.logger.debug( `PageError ${msg}` );

			this.consoleLog.push( {
				type: 'pageerror',
				msg: {
					name: scrub( msg.name ),
					text: scrub( msg.message )
				}
			} );

		} );

		this.page.on( 'request', req => {

			this.logger.debug( `Request ${req.method()} ${req.url()}` );

			this.loggedRequests.push( req.url() );

		} );

		this.logger.debug( 'listeners done' );

		return true;

	}


	run() {

		//
		// goto url, wait for network idle, collect tracked data, return
		//
		this.logger.debug( `Goto ${this.url}` );

		return this.page.goto( this.url, { timeout: 120000, waitUntil: 'load' } )
			.then( () => {

				this.logger.debug( 'Arrived' );

				const pageStart = Date.now();

				return this.promiseNetworkHasBeenIdle
					.then( () => {

						if ( this.noMainScriptFileInterceptedYet === true )
							throw new Error( `No ${config.dependencies.mainScriptFilename} intercepted yet, aborting...` );
						else
							return true;

					} )
					.then( async () => {

						this.logger.debug( 'Network has been idle for long enough, working...' );

						clearInterval( this.metricsTimer );

						await this.page.removeAllListeners( 'request' );

						this.logger.debug( 'All listeners removed' );

						try {

							// abort once we've either sniffed enough frames or reached our time limit
							await this.page.waitFor( /* istanbul ignore next */ ( fpsLimit, dynamicWaitLimit ) =>
								window._sniffed_frames >= fpsLimit ||
									window._sniff_started + dynamicWaitLimit <= performance.now(),
							{ timeout: 120000 }, config.dependencies.fpsLimit, 15 * 1000 /* dynamicWaitLimit */
							);

							// emergency shut-off valve, otherwise we're collecting stats till page.close() worst-case
							await this.page.evaluate( /* istanbul ignore next */ () => {

								window._emergency_shutoff = true;

							} );

						} catch ( e ) {

							this.logger.error( `Stats timed out` );

							await this._logStats();

							process.exit( - 1 ); // FIXME:

						}

						await this._logStats();

						return true;

					} )
					.then( async () => {

						this.profilerRunning = false;

						const [ sniffed_duration, sniffed_frames, sniff_started, stats ] = await this._getStats();

						/*
							turn `metricArray = [ { name: foo, value: bar }, ... ]` into `metricsHashed = { foo: bar, ... }`
						*/
						const metricsHashed = this.metrics.map( metricArray => {

							const hashed = {};
							for ( const metric of metricArray )
								hashed[ metric.name ] = metric.value;

							return hashed;

						} );

						this.stats = {
							file: this.url,
							results: stats,
							pageStart: pageStart,
							now: Date.now(),
							nowHr: process.hrtime(),
							sniff: {
								duration: sniffed_duration,
								frames: sniffed_frames,
								started: sniff_started
							},
							metrics: metricsHashed,
							metricsStart: this.metricsStart
						};

						return true;

					} )
					.then( () => {

						this.logger.debug( 'Profiler.takePreciseCoverage' );

						return Promise.any( [
							this.client.send( 'Profiler.takePreciseCoverage' ),
							new Promise( x => x ).delay( config.dependencies.profilerTimeout, false )
						] )
							.then( result => {

								if ( ! result ) {

									this.logger.error( 'Promise.delay triggered' );

								} else {

									this.logger.debug( `result.result.length: ${result.result.length}` );

									this.profilerResults = result.result;

								}

								return this.client.send( 'Profiler.stopPreciseCoverage' );

							} )
							.catch( err => this.logger.error( `takePreciseCoverage failed: ${err}` ) );

					} )
					.then( () => {

						this.logger.debug( `Collecting tracked data...` );
						this.dependencies = {
							file: this.url,
							deps: {
								external: this.loggedRequests.filter( ( name, index ) => this.loggedRequests.indexOf( name ) === index ), // remove dupes
								shaderChunks: this.trackedShaders.ShaderChunk,
								shaderLibs: this.trackedShaders.ShaderLib,
								uniforms: this.trackedShaders.UniformsLib
							}
						};

						// simply ignore everything after the ?
						this.dependencies.deps[ 'local' ] = this.dependencies.deps.external
							.reduce( this._stripQueryString(), [] )
							.filter( ( file, index, arr ) => arr.indexOf( file ) === index );

					} )
					.catch( err => {

						this.logger.error( 'ERR final collection failed >', err );

						throw new Error( 'final collection failed' );

					} );

			} )
			.then( () => {

				return {
					profiler: this.profilerResults,
					dependencies: this.dependencies,
					consoleLog: this.consoleLog,
					stats: this.stats
				};

			} )
			.catch( err => {

				this.logger.error( `> Page.goto failed: ${err}\nSTACK:${err.stack}\nURL: ${this.url}` );

				fs.writeFileSync( `${new Date().getTime()}.err`, this.url, 'utf8' );

				return false;

			} );

	}


	/**
	 * from https://github.com/GoogleChrome/puppeteer/issues/1353#issuecomment-356561654
 	*/
	waitForNetworkIdle( maxInflightRequests, timeout ) {

		this.page.on( 'request', onRequestStarted );
		this.page.on( 'requestfinished', onRequestFinished );
		this.page.on( 'requestfailed', onRequestFinished );
		this.page.on( 'load', pageLoaded );

		let inflight = 0;
		let loadedEvent;
		let fullyLoaded = new Promise( x => loadedEvent = x );
		let fulfill;
		let promise = new Promise( x => fulfill = x );
		let timeoutId = setTimeout( onTimeoutDone, timeout );
		const self = this; // hax

		return promise;

		function onTimeoutDone() {

			if ( ! promise.isFulfilled() ) {

				return fullyLoaded.then( () => {

					self.logger.debug( `${timeout}ms since last request -> working...` );

					self.page.removeListener( 'request', onRequestStarted );
					self.page.removeListener( 'requestfinished', onRequestFinished );
					self.page.removeListener( 'requestfailed', onRequestFinished );

					self.logger.debug( 'Network listeners removed' );

					fulfill();

					return true;

				} );

			}

		}

		async function onRequestStarted( interceptedRequest ) {

			inflight ++;

			if ( inflight > maxInflightRequests )
				clearTimeout( timeoutId );

			// if we intercept a request for our main script
			if ( interceptedRequest.url().endsWith( config.dependencies.mainScriptFilename ) ) {

				// we answer instead with our modified version
				await interceptedRequest.respond( {
					status: 200,
					contentType: 'text/javascript',
					body: self.modifiedTHREE
				} );

				self.logger.debug( '3js INTERCEPTED' );

				self.noMainScriptFileInterceptedYet = false;

				// TODO: new RegExp( config.dependencies.examplesFilenameRegex ) cachen

			} else if ( new RegExp( config.dependencies.examplesFilenameRegex ).test( interceptedRequest.url() ) ) {

				// or maybe our example file, again we answer with a modified version

				const match = interceptedRequest.url().match( new RegExp( config.dependencies.examplesFilenameRegex ) );
				const content = fs.readFileSync( config.dependencies.fileBase + match[ 0 ], 'utf8' );

				await interceptedRequest.respond( {
					status: 200,
					contentType: 'text/html',
					body: content.replace( '</head>', '<script lang="text/javascript">' + trackStats( config.dependencies.fpsLimit, true ) + '</script></head>' )
				} );

				self.logger.debug( 'EXAMPLE INTERCEPTED' );

			} else {

				// console.log( 'NOPE:', interceptedRequest.url() );
				// otherwise continue as normal, only slightly delayed to allow for
				// the main script to be fully parsed
				// setTimeout( () => interceptedRequest.continue(), 500 );
				interceptedRequest.continue();

			}

		}

		function onRequestFinished() {

			if ( inflight === 0 )
				return;

			if ( inflight < 0 )
				self.logger.warn( 'inflight < 0 ?' );

			inflight --;

			if ( inflight === maxInflightRequests || ! fullyLoaded )
				timeoutId = setTimeout( onTimeoutDone, timeout );

		}

		function pageLoaded() {

			loadedEvent();

		}

	}


	async setupCDPClient() {

		this.logger.debug( 'Setting up CDP client and debugger...' );

		//
		// setup our debugging starter
		//
		let rendererDone = false;
		this.client = await this.page.target().createCDPSession();
		await this.client.send( 'Runtime.enable' );
		await this.client.send( 'Debugger.enable' );
		await this.client.send( 'Performance.enable' );
		this.client.addListener( 'Debugger.paused', async ( event ) => {

			if ( this.profilerRunning === false ) {

				this.profilerRunning = true;

				await this.client.send( 'Profiler.enable' );
				await this.client.send( 'Profiler.startTypeProfile' );
				await this.client.send( 'Profiler.startPreciseCoverage', { callCount: true } );
				this.logger.debug( 'Started profiler' );

				// client.removeAllListeners( 'Debugger.paused' );

				// probably only one callFrame to begin with, but better save than sorry
				const callFrame = event.callFrames.find( cf => cf.url.endsWith( config.dependencies.mainScriptPath ) );
				const threeScriptId = callFrame.location.scriptId;

				const threeLocation = this.lines.locationForIndex( this.source.indexOf( 'function WebGLRenderer( parameters ) {' ) );

				await this.client.send( 'Debugger.continueToLocation', { location: { scriptId: threeScriptId, lineNumber: threeLocation.line + 1 } } );
				// await client.send( 'Debugger.setBreakpoint', { location: { scriptId: threeScriptId, lineNumber: threeLocation.line + 1 } } );

				// await client.send( 'Debugger.resume' );

			} else if ( rendererDone === false ) {

				rendererDone = true;

				this.logger.debug( 'Profiler is already running, time to handle WebGLRenderer' );

				// usually there are multiple frames:
				// first WebGLRenderer@three.js
				// then maybe an `init` or similar in the example script
				// and finally the global part of the example's script
				const callFrame = event.callFrames.find( cf => cf.functionName === 'WebGLRenderer' || cf.url === `${config.dependencies.baseUrl}${config.dependencies.mainScriptPath}` );
				const threeCallFrameId = callFrame.callFrameId;

				await this.client.send( 'Debugger.evaluateOnCallFrame', { callFrameId: threeCallFrameId, expression: 'window.RENDERERInstance = this;' } );

				await this.client.send( 'Debugger.resume' );

			}

		} );


		this.metricsStart = process.hrtime();
		this.metricsTimer = setInterval( async () => {

			this.metrics.push( ( await this.client.send( 'Performance.getMetrics' ) ).metrics );

		}, 250 );


		//
		// network interception and modification
		//
		await this.page.setRequestInterception( true );
		this.promiseNetworkHasBeenIdle = this.waitForNetworkIdle(
			config.dependencies.networkidle.maxInflightRequests,
			config.dependencies.networkidle.timeout
		);

		this.logger.debug( 'CDP/Debugger done' );

	}

	/**
	 * @returns {[number, number, number, any]}
	 */
	async _getStats() {

		return await Promise.all( [
			this.page.evaluate( /* istanbul ignore next */ () => performance.now() - window._sniff_started ),
			this.page.evaluate( /* istanbul ignore next */ () => window._sniffed_frames ),
			this.page.evaluate( /* istanbul ignore next */ () => window._sniff_started ),
			this.page.evaluate( /* istanbul ignore next */ () => window._sniff )
		] );

	}

	async _logStats() {

		const [ sniffed_duration, sniffed_frames, sniff_started ] = await this._getStats();

		this.logger.log(
			'Stats "%s" > Sniffed frames: %i%s   Sniff started: %f   Sniffed duration: %f',
			this.url, sniffed_frames,
			( sniffed_frames > config.dependencies.fpsLimit ) ? `(=${sniffed_frames - config.dependencies.fpsLimit})` : '',
			( sniff_started / 1000 ).toFixed( 4 ), ( sniffed_duration / 1000 ).toFixed( 4 )
		);

	}

	_stripQueryString() {

		const stripQueryStringRx = new RegExp( `^${config.dependencies.baseUrl}(.+?)(\\?.+)?$`, 'i' );

		return ( all, cur ) => {

			if ( cur.startsWith( config.dependencies.baseUrl ) === true )
				all.push( cur.replace( stripQueryStringRx, '$1' ) );

			return all;

		};

	}

}


// TODO: move to runner?
function trackStats( fpsLimit, hijackDrawFunctions = true ) {

	// adapted from rStats.js

	const preamble = `window._sniffed_frames = 0;
	window._sniff_started = 0;
	window._emergency_shutoff = false;

	window._sniff = {
		three: {
			memoryInfo: [],
			renderInfo: [],
			programs: []
		},
		webgl: {
			drawElements: [], drawArrays: [], bindTexture: [], useProgram: [],
			glFaces: [], glVertices: [], glPoints: [],
			shaders: { code: [], type: [] }
		}
	};`;


	const drawFunctions = ( hijackDrawFunctions !== true ) ? '' : `
	function hijack( func, callback ) {

			return function () {

				callback.apply( this, arguments );
				return func.apply( this, arguments );

			};

		}

		WebGLRenderingContext.prototype.drawArrays = hijack( WebGLRenderingContext.prototype.drawArrays, function () {

			if ( window._sniffed_frames < ${fpsLimit} && ! window._emergency_shutoff ) {

				const ts = performance.now();

				window._sniff.webgl.drawArrays.push( ts );

				if ( arguments[ 0 ] == this.POINTS )
					window._sniff.webgl.glPoints.push( { ts: ts, v: arguments[ 2 ] } );
				else
					window._sniff.webgl.glVertices.push( { ts: ts, v: arguments[ 2 ] } );

			}

		} );

		WebGLRenderingContext.prototype.drawElements = hijack( WebGLRenderingContext.prototype.drawElements, function () {

			if ( window._sniffed_frames < ${fpsLimit} && ! window._emergency_shutoff ) {

				const ts = performance.now();

				window._sniff.webgl.drawElements.push( ts );

				window._sniff.webgl.glFaces.push( { ts: ts, v: arguments[ 1 ] / 3 } );
				window._sniff.webgl.glVertices.push( { ts: ts, v: arguments[ 1 ] } );

			}

		} );

		WebGLRenderingContext.prototype.useProgram = hijack( WebGLRenderingContext.prototype.useProgram, function () {

			if ( window._sniffed_frames < ${fpsLimit} && ! window._emergency_shutoff ) {

				const ts = performance.now();

				window._sniff.webgl.useProgram.push( ts );

			}

		} );

		WebGLRenderingContext.prototype.bindTexture = hijack( WebGLRenderingContext.prototype.bindTexture, function () {

			if ( window._sniffed_frames < ${fpsLimit} && ! window._emergency_shutoff ) {

				const ts = performance.now();

				window._sniff.webgl.bindTexture.push( ts );

			}

		} );

		WebGLRenderingContext.prototype.shaderSource = hijack( WebGLRenderingContext.prototype.shaderSource, function ( ) {

			window._sniff.webgl.shaders.code.push( arguments[ 1 ] );

		} );

		WebGLRenderingContext.prototype.createShader = hijack( WebGLRenderingContext.prototype.createShader, function ( ) {

			window._sniff.webgl.shaders.type.push( arguments[ 0 ] );

		} );`;

	const loop = `
	requestAnimationFrame( function loop2( ) {

		if ( window._sniff_started === 0 )
			window._sniff_started = performance.now();

		if ( window._sniffed_frames < ${fpsLimit} && ! window._emergency_shutoff ) {

			if ( typeof window.RENDERERInstance !== 'undefined' && typeof window.RENDERERInstance.info !== 'undefined' ) {

				const now = performance.now();

				window._sniff.three.memoryInfo.push( { ts: now, v: JSON.stringify( window.RENDERERInstance.info.memory ) } );
				window._sniff.three.renderInfo.push( { ts: now, v: JSON.stringify( window.RENDERERInstance.info.render ) } );
				window._sniff.three.programs.push( { ts: now, v: window.RENDERERInstance.info.programs.length } );

			}

			window._sniffed_frames ++;

			requestAnimationFrame( loop2 );

		}

	} );`;

	return preamble + drawFunctions + loop;

}


module.exports = DependenciesWorker;

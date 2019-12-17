const fs = require( 'fs' );
const path = require( 'path' );
const Promise = require( 'bluebird' );
const puppeteer = require( 'puppeteer' );
const stringify = require( 'json-stable-stringify' );
const signale = require( 'signale' );

const globalConfig = require( 'rc' )( '3jsdev' );
const servicesConfig = require( 'rc' )( 'services', globalConfig );
const config = require( 'rc' )( 'typesearch', servicesConfig );

const TypeProfilingWorker = require( './typeProfilingWorker' );


class TypeProfilingRunner {

	/**
	 * @param {string} targetBase Where to save the profiles
	 * @param {string} threejsBase Path to threejs git repository
	 * @param {string} threejsBuildFile Path of the used threejs build file, relative to threejsBase
	 * @param {string} urlBase Host and port of all URLs
	 * @param {string[]} puppeteerOptions Array of additional options for puppeteer
	 */
	constructor( targetBase, threejsBase, threejsBuildFile, urlBase, puppeteerOptions = [] ) {

		this.targetBase = targetBase;
		this.threejsBase = threejsBase;
		this.threejsBuildFile = threejsBuildFile;
		this.urlBase = urlBase;
		this.puppeteerOptions = [ ...config.typesearch.puppeteerOptions, ...puppeteerOptions ];

		this.timeout = 4000;
		this.maxInflightRequests = 0;

		this.workload = [];
		this.currentIndex = 0;

		this.browser = null;
		this.worker = null;

		this.logger = signale.scope( 'Runner' );

	}


	loadUrls( workload ) {

		this.workload = workload.slice();

	}


	run() {

		return this.startBrowser()
			.then( () => this.launch() );

	}


	get currentUrl() {

		return this.workload[ this.currentIndex ];

	}


	get crudelyEscapedUrl() {

		return this.currentUrl.replace( this.urlBase, '' ).replace( /\/+/g, '_' ).replace( '.html', '.json' );

	}


	async prepareThree() {

		const threeFile = path.join( this.threejsBase, this.threejsBuildFile );

		this.logger.debug( `Preparing script at ${threeFile}` );

		return ( await fs.promises.readFile( threeFile, 'utf8' ) ) + ';debugger;'; // trigger a Debugger.paused event right after parsing

	}


	async startBrowser() {

		this.logger.debug( 'Starting browser...' );

		this.browser = await puppeteer.launch(
			{
				headless: false,
				devtools: false,
				dumpio: true,
				args: this.puppeteerOptions
			}
		);

	}


	async createPage() {

		this.logger.debug( 'Creating page...' );

		return await this.browser.newPage();

	}


	launch() {

		this.logger.debug( 'Launching...' );

		return this.prepareThree()
			.then( modifiedThree => {

				return Promise.mapSeries( this.workload, ( url, index ) => {

					this.logger.info( `${index + 1}/${this.workload.length} ${url}` );

					this.currentIndex = index;

					return this.createPage()
						.then( page => {

							this.worker = new TypeProfilingWorker( page, url, this.threejsBuildFile, modifiedThree );

							return this.worker.setupPage()
								.then( () => this.worker.run() )
								.catch( err => this.logger.error( 'Worker failed to start', err ) );

						} )
						.then( result => {

							return this.worker.tearDownPage()
								.catch( err => this.logger.error( 'page.close failed:', err ) )
								.then( () => delete this.worker )
								.then( () => result );

						} );

				} ).then( status => {

					this.logger.debug( [ 'No more URLs left. Status report:', ...status.map( s => `${s.status}: ${s.url}` ) ].join( '\n' ) );

					this.logger.info( 'Saving...' );

					return fs.promises.writeFile( path.join( this.targetBase, this.crudelyEscapedUrl ), stringify( status ), 'utf-8' )
						.then( () => {

							this.logger.debug( 'Closing browser...' );

							return this.browser.close();

						} )
						.catch( err => this.logger.fatal( err ) );

				} ).then( () => {

					this.logger.info( 'Done' );

					return true;

				} );

			} )

			.catch( err => this.logger.error( "Launch error >", err ) );

	}

}

module.exports = TypeProfilingRunner;

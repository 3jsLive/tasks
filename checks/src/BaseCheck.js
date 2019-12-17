const fs = require( 'fs' );
const signale = require( 'signale' );
const stringify = require( 'json-stable-stringify' );

class BaseCheck {

	/**
	 * @param {string} basePath Path to three.js main directory
	 * @param {WriteStream} outputStream Output stream for temporary results
	 */
	constructor( basePath, outputStream ) {

		if ( typeof basePath === 'undefined' )
			throw new Error( 'Missing base path to three.js directory' );

		if ( fs.existsSync( basePath ) === false )
			throw new Error( `Can't access basePath: ${basePath}` );

		if ( typeof outputStream === 'undefined' )
			throw new Error( 'Missing WriteStream for results' );


		this.basePath = basePath;
		this.outputStream = outputStream;

		this.files = [];
		this.results = {};
		this.logger = signale.scope( this.constructor.name );

	}

	async generateListOfFiles() {

		throw new Error( 'listOfFiles not implemented' );

	}

	async run() {

		// analyze
		try {

			this.results = await this.worker();

		} catch ( err ) {

			this.logger.fatal( 'worker failed:', err );

			this.results = { results: [], errors: [ { message: err.message.replace( this.basePath, '' ), location: err.location, name: err.name } ] };

		}

		// save
		this.outputStream.write( stringify( this.results ) );

		return this.results;

	}


	async worker() {

		throw new Error( 'Worker not yet implemented' );

	}

}

module.exports = BaseCheck;

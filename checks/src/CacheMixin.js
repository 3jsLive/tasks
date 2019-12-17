const fs = require( 'fs' );
const Cache = require( 'timed-cache' );

const CacheMixin = ( cacheFilename, Base ) => class CacheMixin extends Base {

	constructor( basePath, stream ) {

		super( basePath, stream );

		this.enabled = true;
		this.filename = cacheFilename; // FIXME: cache name derived from class name

		this.attrition = 0.1;
		this.cache = new Cache( { defaultTtl: 180 * 1000 } ); // 3 min

		this.loadCache();

	}

	cacheClear() {

		this.cache.clear();

	}

	cacheEnable() {

		this.enabled = true;

	}

	cacheDisable() {

		this.enabled = false;

	}

	get cacheEnabled() {

		return !! this.enabled;

	}

	get cacheFile( ) {

		return this.filename;

	}

	set cacheFile( value ) {

		if ( typeof value !== 'string' || value.length === 0 )
			throw new Error( 'Invalid cache filename' );

		this.filename = value;

	}

	loadCache() {

		if ( fs.existsSync( this.filename ) ) {

			const json = JSON.parse( fs.readFileSync( this.filename, 'utf8' ) );
			json.forEach( data => {

				if ( /* data.value === true */ Math.random() > this.attrition )
					this.cache.put( data.url, Promise.resolve( data.value ) );

			} );

			return this.cache.size();

		}

	}

	replaceCache( replacement ) {

		// nope.
		if ( this.enabled !== true )
			return;

		this.cacheClear();

		fs.writeFileSync( this.filename, JSON.stringify( replacement ), 'utf8' );

	}

};

module.exports = CacheMixin;

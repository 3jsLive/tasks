const fs = require( 'fs' );
const stream = require( 'stream' );

const assert = require( 'assert' );

const checkClass = require( `../src/compareSourceExports` );

const testBasePath = `${__dirname}/data/compareSourceExports/`;
const goldData = JSON.parse( fs.readFileSync( `${__dirname}/data/compareSourceExports/gold.json`, 'utf8' ) );


describe( `compareSourceExports`, function () {

	it( 'basics', async function () {

		// safety margin
		this.timeout( 10000 );

		// ignore debug output
		const tempOut = new stream.PassThrough( { defaultEncoding: 'utf8' } );

		// analyze
		const check = new checkClass( testBasePath, tempOut );
		const result = await check.run();

		// done
		assert.deepStrictEqual( result, goldData );

	} );

} );

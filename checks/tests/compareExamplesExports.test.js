const fs = require( 'fs' );
const stream = require( 'stream' );

const assert = require( 'assert' );

const checkClass = require( `../src/compareExamplesExports` );

const testBasePath = `${__dirname}/data/compareExamplesExports/`;
const goldData = JSON.parse( fs.readFileSync( `${__dirname}/data/compareExamplesExports/gold.json`, 'utf8' ) );


describe( `compareExamplesExports`, function () {

	it( 'basics', async function () {

		// ignore debug output
		const tempOut = new stream.PassThrough( { defaultEncoding: 'utf8' } );

		// analyze
		const check = new checkClass( testBasePath, tempOut );
		const result = await check.run();

		// done
		assert.deepStrictEqual( result, goldData );

	} );

} );

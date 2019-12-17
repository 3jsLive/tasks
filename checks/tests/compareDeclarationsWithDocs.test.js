const fs = require( 'fs' );
const stream = require( 'stream' );

const assert = require( 'assert' );

const checkClass = require( `../src/compareDeclarationsWithDocs` );

const testBasePath = `${__dirname}/data/compareDeclarationsWithDocs/`;
const goldData = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithDocs/gold.json`, 'utf8' ) );


describe( `compareDeclarationsWithDocs`, function () {

	it( 'basics', async function () {

		this.timeout( 5000 );

		// ignore debug output
		const tempOut = new stream.PassThrough( { defaultEncoding: 'utf8' } );

		// analyze
		const check = new checkClass( testBasePath, tempOut );
		const result = await check.run();

		// done
		assert.deepStrictEqual( result, goldData );

	} );

} );

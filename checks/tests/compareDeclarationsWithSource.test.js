const fs = require( 'fs' );
const stream = require( 'stream' );

const assert = require( 'assert' );

const checkClass = require( `../src/compareDeclarationsWithSource` );

const testBasePath = `${__dirname}/data/compareDeclarationsWithSource/`;
const goldData = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithSource/gold.json`, 'utf8' ) );


describe( `compareDeclarationsWithSource`, function () {

	it( 'basics', async function () {

		// safety increase from the default 2000
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

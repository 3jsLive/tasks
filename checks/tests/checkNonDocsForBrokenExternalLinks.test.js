const fs = require( 'fs' );
const stream = require( 'stream' );

const assert = require( 'assert' );

const checkClass = require( `../src/checkNonDocsForBrokenExternalLinks` );

const testBasePath = `${__dirname}/data/checkNonDocsForBrokenExternalLinks`;
const goldData = JSON.parse( fs.readFileSync( `${__dirname}/data/checkNonDocsForBrokenExternalLinks/gold.json`, 'utf8' ) );


describe( `checkNonDocsForBrokenExternalLinks`, function () {

	it( 'basics', async function () {

		this.timeout( 40000 );

		// ignore debug output
		const tempOut = new stream.PassThrough( { defaultEncoding: 'utf8' } );

		// analyze
		const check = new checkClass( testBasePath, tempOut );
		check.cacheDisable();
		const result = await check.run();

		// done
		assert.deepStrictEqual( result, goldData );

	} );

} );

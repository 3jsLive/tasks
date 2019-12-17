const fs = require( 'fs' );
const stream = require( 'stream' );

const assert = require( 'assert' );

const checkClass = require( `../src/checkDocsForBrokenExampleLinks` );

const testBasePath = `${__dirname}/data/checkDocsForBrokenExampleLinks/`;
const goldData = JSON.parse( fs.readFileSync( `${__dirname}/data/checkDocsForBrokenExampleLinks/gold.json`, 'utf8' ) );


describe( `checkDocsForBrokenExampleLinks`, function () {

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

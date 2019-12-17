const fs = require( 'fs' );
const stream = require( 'stream' );

const assert = require( 'assert' );

const linterClass = require( `../src/ESLintTsFiles` );

const testBasePath = `${__dirname}/data/ESLintTsFiles`;
const goldData = JSON.parse( fs.readFileSync( `${__dirname}/data/ESLintTsFiles/gold.json`, 'utf8' ) );


describe( `ESLintTsFiles`, function () {

	it( 'basics', async function () {

		// ignore debug output
		const tempOut = new stream.PassThrough( { defaultEncoding: 'utf8' } );

		// analyze
		const linter = new linterClass( testBasePath, tempOut );
		const result = await linter.run();

		// done
		assert.deepStrictEqual( result, goldData );

	} );

} );

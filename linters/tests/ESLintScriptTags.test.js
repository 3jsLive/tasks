const fs = require( 'fs' );
const stream = require( 'stream' );

const assert = require( 'assert' );

const linterClass = require( `../src/ESLintScriptTags` );

const testBasePath = `${__dirname}/data/ESLintScriptTags`;
const goldData = JSON.parse( fs.readFileSync( `${__dirname}/data/ESLintScriptTags/gold.json`, 'utf8' ) );


describe( `ESLintScriptTags`, function () {

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

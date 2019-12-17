const fs = require( 'fs' );
const stream = require( 'stream' );

const assert = require( 'assert' );

const checkClass = require( `../src/compareDeclarationsWithInstancedObjects` );

const testBasePath = `${__dirname}/data/compareDeclarationsWithInstancedObjects/`;
const goldData = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithInstancedObjects/gold.json`, 'utf8' ) );


describe( `compareDeclarationsWithInstancedObjects`, function () {

	it( 'basics', async function () {

		// FIXME: currently needs a full three.js checkout
		// plus this timeout due to the additional workload
		this.timeout( 30000 );

		// ignore debug output
		const tempOut = new stream.PassThrough( { defaultEncoding: 'utf8' } );

		// analyze
		const check = new checkClass( testBasePath, tempOut );
		const result = await check.run();

		// done (hacky)
		assert.deepStrictEqual( result.results[ 'src/cameras/Camera.d.ts' ], goldData.results[ 'src/cameras/Camera.d.ts' ] );

		return result;

	} );

} );

const fs = require( 'fs' );
const stream = require( 'stream' );

const assert = require( 'assert' );
const sinon = require( 'sinon' );

const checkClass = require( `../src/compareExamplesExports` );
const collectedExports = require( '../src/collectExports' );

const testBasePath = `${__dirname}/data/compareExamplesExports/`;
const testWrongPath = `${__dirname}/data/compareExamplesExports/examples/`;
const goldData = JSON.parse( fs.readFileSync( `${__dirname}/data/compareExamplesExports/gold.json`, 'utf8' ) );
const goldNotFound = JSON.parse( fs.readFileSync( `${__dirname}/data/compareExamplesExports/gold-NotFound.json`, 'utf8' ) );
const goldEmptyResults = JSON.parse( fs.readFileSync( `${__dirname}/data/compareExamplesExports/gold-EmptyResults.json`, 'utf8' ) );
const goldTsThrows = JSON.parse( fs.readFileSync( `${__dirname}/data/compareExamplesExports/gold-TsThrows.json`, 'utf8' ) );


describe( `compareExamplesExports`, function () {

	beforeEach( function () {

		// ignore debug output
		this.tempOut = new stream.PassThrough( { defaultEncoding: 'utf8' } );

	} );

	afterEach( function () {

		this.tempOut.destroy();

	} );

	it( 'basics', async function () {

		// safety margin
		this.timeout( 10000 );

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );
		const result = await check.run();

		// done
		assert.deepStrictEqual( result, goldData );

	} );

	it( 'worker error: no files found', function ( ) {

		// analyze
		const check = new checkClass( testWrongPath, this.tempOut );
		return check.run()
			.then( result => assert.deepStrictEqual( result, goldNotFound ) );

	} );

	it( 'getExamplesModulesJs/Ts return empty objects', async function ( ) {

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );

		sinon.stub( collectedExports, 'getExamplesModulesTs' )
			.returns( {} );
		sinon.stub( collectedExports, 'getExamplesModulesJs' )
			.returns( {} );

		const result = await check.run();

		collectedExports.getExamplesModulesTs.restore();
		collectedExports.getExamplesModulesJs.restore();

		assert.deepStrictEqual( result, goldEmptyResults );

	} );

	it( 'worker error: getExamplesModulesTs throws', async function ( ) {

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );

		sinon.stub( collectedExports, 'getExamplesModulesTs' )
			.throws( 'getExamplesModulesTsFakeException' );

		const result = await check.run();

		collectedExports.getExamplesModulesTs.restore();

		assert.deepStrictEqual( result, goldTsThrows );

	} );

} );

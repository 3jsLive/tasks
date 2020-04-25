const fs = require( 'fs' );
const stream = require( 'stream' );

const assert = require( 'assert' );
const sinon = require( 'sinon' );

const checkClass = require( `../src/compareSourceExports` );
const collectedExports = require( '../src/collectExports' );

const testBasePath = `${__dirname}/data/compareSourceExports/`;
const testWrongPath = `${__dirname}/data/compareSourceExports/src/`;
const goldData = JSON.parse( fs.readFileSync( `${__dirname}/data/compareSourceExports/gold.json`, 'utf8' ) );
const goldNotFound = JSON.parse( fs.readFileSync( `${__dirname}/data/compareSourceExports/gold-NotFound.json`, 'utf8' ) );
const goldEmptyResults = JSON.parse( fs.readFileSync( `${__dirname}/data/compareSourceExports/gold-EmptyResults.json`, 'utf8' ) );
const goldTsThrows = JSON.parse( fs.readFileSync( `${__dirname}/data/compareSourceExports/gold-TsThrows.json`, 'utf8' ) );


describe( `compareSourceExports`, function () {

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

	it( 'getModulesJs/Ts return empty objects', async function ( ) {

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );

		sinon.stub( collectedExports, 'getModulesTs' )
			.returns( {} );
		sinon.stub( collectedExports, 'getModulesJs' )
			.returns( {} );

		const result = await check.run();

		collectedExports.getModulesTs.restore();
		collectedExports.getModulesJs.restore();

		assert.deepStrictEqual( result, goldEmptyResults );

	} );

	it( 'getModulesTs throws', async function ( ) {

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );

		sinon.stub( collectedExports, 'getModulesTs' )
			.throws( 'getModulesTsFakeException' );

		const result = await check.run();

		collectedExports.getModulesTs.restore();

		assert.deepStrictEqual( result, goldTsThrows );

	} );

} );

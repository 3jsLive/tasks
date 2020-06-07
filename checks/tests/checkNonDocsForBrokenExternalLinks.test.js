const fs = require( 'fs' );
const stream = require( 'stream' );

const assert = require( 'assert' );
const sinon = require( 'sinon' );
const bluebird = require( 'bluebird' );

const checkClass = require( `../src/checkNonDocsForBrokenExternalLinks` );

const testBasePath = `${__dirname}/data/checkNonDocsForBrokenExternalLinks`;
const testWrongPath = `${__dirname}/data/checkNonDocsForBrokenExternalLinks/examples/`;
const goldData = JSON.parse( fs.readFileSync( `${__dirname}/data/checkNonDocsForBrokenExternalLinks/gold.json`, 'utf8' ) );
const goldNotFound = JSON.parse( fs.readFileSync( `${__dirname}/data/checkNonDocsForBrokenExternalLinks/gold-NotFound.json`, 'utf8' ) );
const goldCheckUrlThrows = JSON.parse( fs.readFileSync( `${__dirname}/data/checkNonDocsForBrokenExternalLinks/gold-CheckUrlThrows.json`, 'utf8' ) );
const goldPromiseMap = JSON.parse( fs.readFileSync( `${__dirname}/data/checkNonDocsForBrokenExternalLinks/gold-PromiseMap.json`, 'utf8' ) );


describe( `checkNonDocsForBrokenExternalLinks`, function () {

	beforeEach( function () {

		// ignore debug output
		this.tempOut = new stream.PassThrough( { defaultEncoding: 'utf8' } );

	} );

	afterEach( function () {

		this.tempOut.destroy();

	} );

	it( 'basics', async function () {

		this.timeout( 40000 );

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

	it( 'error: checkUrl throws', async function ( ) {

		this.timeout( 40000 );

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );

		sinon.stub( check, 'checkUrl' )
			.usingPromise( bluebird.Promise )
			.rejects( 'checkUrlException' );

		const result = await check.run();

		check.checkUrl.restore();

		assert.deepStrictEqual( result, goldCheckUrlThrows );

	} );

	it( 'worker error: Promise.map throws', async function ( ) {

		this.timeout( 40000 );

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );

		sinon.stub( bluebird, 'map' )
			.rejects( 'PromiseMapRejection' );

		const result = await check.run();

		bluebird.map.restore();

		assert.deepStrictEqual( result, goldPromiseMap );

	} );

} );

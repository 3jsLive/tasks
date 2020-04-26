const fs = require( 'fs' );
const stream = require( 'stream' );

const assert = require( 'assert' );
const sinon = require( 'sinon' );

const checkClass = require( `../src/compareDeclarationsWithDocs` );
const glob = require( 'glob' );
const tsmorph = require( 'ts-morph' );

const testBasePath = `${__dirname}/data/compareDeclarationsWithDocs/`;
const testWrongPath = `${__dirname}/data/compareDeclarationsWithDocs/src/`;
const goldData = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithDocs/gold.json`, 'utf8' ) );
const goldNoFilesFound = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithDocs/gold-NoFilesFound.json`, 'utf8' ) );
const goldListOfFiles = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithDocs/gold-ListOfFiles.json`, 'utf8' ) );
const goldGlobFails = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithDocs/gold-GlobFails.json`, 'utf8' ) );
const goldGetSourceFileFails = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithDocs/gold-GetSourceFileFails.json`, 'utf8' ) );


// TODO: the various helper functions like _typeEquality could do with some tests


describe( `compareDeclarationsWithDocs`, function () {

	beforeEach( function () {

		// ignore debug output
		this.tempOut = new stream.PassThrough( { defaultEncoding: 'utf8' } );

	} );

	afterEach( function () {

		this.tempOut.destroy();

	} );

	it( 'basics', async function () {

		this.timeout( 5000 );

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );
		const result = await check.run();

		// done
		assert.deepStrictEqual( result, goldData );

	} );

	it( 'generateListOfFiles', async function () {

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );

		const result = await check.generateListOfFiles();

		// done
		assert.deepStrictEqual( result, goldListOfFiles );

	} );

	it( 'worker error: no files found', function ( ) {

		// analyze
		const check = new checkClass( testWrongPath, this.tempOut );
		return check.run()
			.then( result => assert.deepStrictEqual( result, goldNoFilesFound ) );

	} );

	it( 'worker error: glob fails', async function ( ) {

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );

		// stub
		sinon.stub( glob, 'sync' )
			.onFirstCall()
			.throws( 'FakeException', 'Foo' );

		glob.sync.callThrough();

		const result = await check.run();

		// done
		assert.deepStrictEqual( result, goldGlobFails );

		glob.sync.restore();

	} );

	it( 'worker error: getSourceFileOrThrow throws', async function ( ) {

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );

		// stub
		sinon.stub( tsmorph.Project.prototype, 'getSourceFileOrThrow' )
			.onThirdCall()
			.throws( 'FakeException', 'Foo' );

		tsmorph.Project.prototype.getSourceFileOrThrow.callThrough();

		const result = await check.run();

		assert.deepStrictEqual( result, goldGetSourceFileFails );

		tsmorph.Project.prototype.getSourceFileOrThrow.restore();

	} );

} );

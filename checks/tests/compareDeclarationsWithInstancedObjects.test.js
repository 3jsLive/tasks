const fs = require( 'fs' );
const stream = require( 'stream' );

const assert = require( 'assert' );
const sinon = require( 'sinon' );

const checkClass = require( `../src/compareDeclarationsWithInstancedObjects` );
const tsmorph = require( 'ts-morph' );

const testBasePath = `${__dirname}/data/compareDeclarationsWithInstancedObjects/`;
const testWrongPath = `${__dirname}/data/compareDeclarationsWithInstancedObjects/src/`;
const goldData = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithInstancedObjects/gold.json`, 'utf8' ) );
const goldNoFilesFound = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithInstancedObjects/gold-NoFilesFound.json`, 'utf8' ) );
const goldSourceFiles = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithInstancedObjects/gold-SourceFiles.json`, 'utf8' ) );
const goldReduceFailure = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithInstancedObjects/gold-ReduceFailure.json`, 'utf8' ) );
const goldCheckLegacy = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithInstancedObjects/gold-CheckLegacy.json`, 'utf8' ) );
const goldAcornThrows = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithInstancedObjects/gold-AcornThrows.json`, 'utf8' ) );


describe( `compareDeclarationsWithInstancedObjects`, function () {

	beforeEach( function () {

		// ignore debug output
		this.tempOut = new stream.PassThrough( { defaultEncoding: 'utf8' } );

	} );

	afterEach( function () {

		this.tempOut.destroy();

	} );

	it( 'basics', async function () {

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
			.then( result => assert.deepStrictEqual( result, goldNoFilesFound ) );

	} );

	it( 'worker error: addExistingSourceFiles throws', async function ( ) {

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );

		// stub
		sinon.stub( tsmorph.Project.prototype, 'addExistingSourceFiles' )
			.onFirstCall()
			.throws( 'FakeException', 'Foo' );

		tsmorph.Project.prototype.addExistingSourceFiles.callThrough();

		const result = await check.run();

		assert.deepStrictEqual( result, goldSourceFiles );

		tsmorph.Project.prototype.addExistingSourceFiles.restore();

	} );

	it( 'worker error: reduceClassCollection throws', async function ( ) {

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );

		// stub
		sinon.stub( check, 'reduceClassCollection' )
			.onSecondCall()
			.throws( 'FakeException', 'Foo' );

		check.reduceClassCollection.callThrough();

		const result = await check.run();

		assert.deepStrictEqual( result, goldReduceFailure );

		check.reduceClassCollection.restore();

	} );

	it( 'worker error: _checkForLegacy throws', async function ( ) {

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );

		// stub
		sinon.stub( check, '_checkForLegacy' )
			.onFirstCall()
			.throws( 'FakeException', 'Foo' );

		check._checkForLegacy.callThrough();

		const result = await check.run();
		assert.deepStrictEqual( result, goldCheckLegacy );

		check._checkForLegacy.restore();

	} );

	it( 'worker error: read fails, acorn barfs', async function ( ) {

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );

		// stub
		sinon.stub( fs, 'readFileSync' )
			.throws( { code: "ENOENT", message: "ENOENT: no such file or directory, open 'foo'" } );

		const result = await check.run();

		assert.deepStrictEqual( result, goldAcornThrows );

		fs.readFileSync.restore();

	} );


} );

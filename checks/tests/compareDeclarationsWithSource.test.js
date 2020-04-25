const fs = require( 'fs' );
const stream = require( 'stream' );

const assert = require( 'assert' );
const sinon = require( 'sinon' );

const checkClass = require( `../src/compareDeclarationsWithSource` );
const tsmorph = require( 'ts-morph' );
const acorn = require( 'acorn' );

const testBasePath = `${__dirname}/data/compareDeclarationsWithSource/`;
const testWrongPath = `${__dirname}/data/compareDeclarationsWithSource/src/`;
const goldData = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithSource/gold.json`, 'utf8' ) );
const goldSourceFiles = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithSource/gold-SourceFiles.json`, 'utf8' ) );
const goldNoFilesFound = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithSource/gold-NoFilesFound.json`, 'utf8' ) );
const goldAcornThrows = JSON.parse( fs.readFileSync( `${__dirname}/data/compareDeclarationsWithSource/gold-AcornThrows.json`, 'utf8' ) );


describe( `compareDeclarationsWithSource`, function () {

	beforeEach( function () {

		// ignore debug output
		this.tempOut = new stream.PassThrough( { defaultEncoding: 'utf8' } );

	} );

	afterEach( function () {

		this.tempOut.destroy();

	} );

	it( 'basics', async function () {

		// safety increase from the default 2000
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

	it( 'error: read fails, acorn barfs', async function ( ) {

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

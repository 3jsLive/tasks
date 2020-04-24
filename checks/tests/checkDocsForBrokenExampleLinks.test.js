const fs = require( 'fs' );
const stream = require( 'stream' );

const assert = require( 'assert' );
const sinon = require( 'sinon' );

const checkClass = require( `../src/checkDocsForBrokenExampleLinks` );
const dochandler = require( 'dochandler' );

const testBasePath = `${__dirname}/data/checkDocsForBrokenExampleLinks/`;
const testWrongPath = `${__dirname}/data/checkDocsForBrokenExampleLinks/examples/`;
const goldData = JSON.parse( fs.readFileSync( `${__dirname}/data/checkDocsForBrokenExampleLinks/gold.json`, 'utf8' ) );
const goldNotFound = JSON.parse( fs.readFileSync( `${__dirname}/data/checkDocsForBrokenExampleLinks/gold-NotFound.json`, 'utf8' ) );
const goldFileError = JSON.parse( fs.readFileSync( `${__dirname}/data/checkDocsForBrokenExampleLinks/gold-FileError.json`, 'utf8' ) );
const goldInvalidLocation = JSON.parse( fs.readFileSync( `${__dirname}/data/checkDocsForBrokenExampleLinks/gold-InvalidLocation.json`, 'utf8' ) );
const goldMissingLink = JSON.parse( fs.readFileSync( `${__dirname}/data/checkDocsForBrokenExampleLinks/gold-MissingLink.json`, 'utf8' ) );
const goldMainLoopError = JSON.parse( fs.readFileSync( `${__dirname}/data/checkDocsForBrokenExampleLinks/gold-MainLoopError.json`, 'utf8' ) );


describe( `checkDocsForBrokenExampleLinks`, function () {

	beforeEach( function () {

		// ignore debug output
		this.tempOut = new stream.PassThrough( { defaultEncoding: 'utf8' } );

	} );

	it( 'basics', function ( ) {

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );
		return check.run()
			.then( result => assert.deepStrictEqual( result, goldData ) );

	} );

	it( 'worker error: no files found', function ( ) {

		// analyze
		const check = new checkClass( testWrongPath, this.tempOut );
		return check.run()
			.then( result => assert.deepStrictEqual( result, goldNotFound ) );

	} );

	it( 'worker error: file read error', function ( ) {

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );

		// stub for one specific file
		sinon
			.stub( fs.promises, 'readFile' )
			.withArgs( sinon.match( /^.+test\.html$/ ) )
			.throws( 'FileReadError', 'File could not be read' );

		// everything else -> business as usual
		fs.promises.readFile
			.callThrough();

		return check.run()
			.then( result => assert.deepStrictEqual( result, goldFileError ) )
			.then( () => fs.promises.readFile.restore() );

	} );

	it( 'worker error: _readChunk invalid location', async function ( ) {

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );

		// stub for one specific file
		sinon.stub( dochandler.parseDoc, 'parseString' )
			.withArgs( sinon.match( /.+________.+/ ) )
			.onFirstCall()
			.throws( 'ThisError', 'Lacks location' );

		// everything else -> business as usual
		dochandler.parseDoc.parseString
			.callThrough();

		const result = await check.run();

		assert.deepStrictEqual( result, goldInvalidLocation );

		dochandler.parseDoc.parseString.restore();

	} );

	it( 'worker error: Exception in main loop', async function ( ) {

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );

		// stub for one specific file
		sinon.stub( check, '_checkTagExistance' )
			.onFirstCall()
			.throws( 'FakeException', 'Foo' );

		// everything else -> business as usual
		check._checkTagExistance
			.callThrough();

		const result = await check.run();

		assert.deepStrictEqual( result, goldMainLoopError );

		check._checkTagExistance.restore();

	} );

	it( 'error: ExampleTag without a link', async function ( ) {

		// analyze
		const check = new checkClass( testBasePath, this.tempOut );

		const tag = {
			type: 'ExampleTag',
			// link: 'webgl_fake', // intentionally left out
			title: 'replaced / tag / example',
			location: null,
			source: '[example:webgl_fake replaced / tag / example]'
		};

		sinon.stub( check, '_checkTagExistance' )
			.onFirstCall()
			.callsFake( function fakeFn() {

				return check._checkTagExistance( tag );

			} );

		check._checkTagExistance.callThrough();

		const result = await check.run();

		assert.deepStrictEqual( result, goldMissingLink );

		check._checkTagExistance.restore();

	} );

} );

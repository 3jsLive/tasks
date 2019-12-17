'use strict';

const fs = require( 'fs' );
const glob = require( 'glob' );
const path = require( 'path' );

const docHandler = require( '../' );
const parseDoc = docHandler.parseDoc;

// testing
const assert = require( 'assert' );
const mocha = require( 'mocha' );
const describe = mocha.describe;
const it = mocha.it;

const baseTests = __dirname;
const docs = glob.sync( baseTests + '/fixtures/*.html' );


docs.forEach( ( docFile, docIndex ) => {

	const testname = path.basename( docFile, '.html' );

	describe( `Doc ${docIndex + 1} / ${docs.length}: ${testname}`, function () {

		const ast = parseDoc.parseFile( docFile );

		it( 'Doc parsed successfully', function () {

			assert.ok( ast !== undefined );
			assert.ok( Array.isArray( ast ) === true );
			assert.ok( ast.length > 0 );

		} );


		it( 'Compare complete collected tags with gold data', function () {

			const goldAST = JSON.parse( fs.readFileSync( `${baseTests}/fixtures/${testname}_AST.json`, 'utf8' ) );

			assert.deepStrictEqual( ast, goldAST );

		} );


		describe( 'Individual tags', function () {

			// 'Text' got dropped
			const tagFiles = glob.sync( `${baseTests}/fixtures/${testname}_*Tag.json` );
			const parsed = parseDoc.parseFile( `${baseTests}/fixtures/${testname}.html` );

			tagFiles.forEach( ( tagFile, tagIndex ) => {

				const tagName = tagFile.match( /.+_(\w+Tag)\.json/ )[ 1 ]; // bold assumptions always work

				it( `Tag ${tagIndex + 1} / ${tagFiles.length}: ${testname} - ${tagName}`, function () {

					const matches = parsed.filter( x => x.type === tagName );
					const gold = JSON.parse( fs.readFileSync( tagFile, 'utf8' ) );

					assert.deepStrictEqual( matches, gold );

				} );

			} );

		} );

	} );

} );

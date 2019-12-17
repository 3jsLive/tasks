const fs = require( 'fs' );
const stream = require( 'stream' );
const path = require( 'path' );
const glob = require( 'glob' );

const assert = require( 'assert' );

const DoobDoc = require( `../src/doobDoc` );

const testBasePath = `${__dirname}/data/doobDoc/`;


describe( `doobDoc`, function () {

	// ignore debug output
	const tempOut = new stream.PassThrough( { defaultEncoding: 'utf8' } );

	// test-files
	const files = glob.sync( path.join( testBasePath, '*.json' ) );

	const doobDoc = new DoobDoc( testBasePath, tempOut );

	for ( const file of files ) {

		const rule = path.basename( file, '.json' );

		describe( rule, function () {

			const test = JSON.parse( fs.readFileSync( file, 'utf8' ) );

			for ( const testHit of test.hit ) {

				it( `Hit: ${testHit}`, async function () {

					const result = await doobDoc.testString( testHit, rule );

					assert.ok( result.length === 1 );
					assert.ok( result[ 0 ].ruleId === rule );

				} );

			}

			for ( const testMiss of test.miss ) {

				it( `Miss: ${testMiss}`, async function () {

					const result = await doobDoc.testString( testMiss, rule );

					assert.ok( result.length === 0 );

				} );

			}

		} );

	}

} );

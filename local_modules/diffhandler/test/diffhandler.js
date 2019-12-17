'use strict';

const fs = require( 'fs' );
const glob = require( 'glob' );
const path = require( 'path' );

const diffHandler = require( '../' );
const parseDiff = diffHandler.parseDiff;

// testing
const assert = require( 'assert' );
const mocha = require( 'mocha' );
const describe = mocha.describe;
const it = mocha.it;


const baseTests = __dirname;

const diffs = glob.sync( baseTests + '/diffs/*.diff' );


// FIXME: this is ugly
diffs.forEach( ( diffFile, diffIndex ) => {

	const testname = path.basename( diffFile, '.diff' );
	const goldLines = JSON.parse( fs.readFileSync( `${baseTests}/diffs/${testname}.json`, 'utf8' ) );

	describe( `Diff ${diffIndex + 1} / ${diffs.length}: ${testname}`, function () {

		const actions = parseDiff.parseFile( diffFile );

		it( 'Diff parsed successfully', function () {

			assert.ok( actions !== undefined );
			assert.ok( Array.isArray( actions ) === true );

		} );

		actions.forEach( ( action, index ) => {

			it( 'Correct amount of actions', () => {

				assert.deepStrictEqual( actions.length, goldLines.length );

			} );

			if ( action.action === 'modify' ) {

				it( `Hunk #${index + 1} - Gets the line numbers right`, function () {

					assert.deepStrictEqual( action.lines, goldLines[ index ] );

				} );

			} else {

				it( `Unhandled action: ${action.action}` );

			}

		} );

	} );

} );

'use strict';

const fs = require( 'fs' );

const parserName = [ './parser', 'diffs', 'no', 'trace' ].join( '-' ); // including it directly kills autocomplete (Wtf)
const parser = require( parserName );

const debug = require( 'debug' )( 'parseDiff' );
const verbose = debug.extend( 'verbose' );


/**
 * @param {string} filename
 */
function parseFile( filename ) {

	debug( `Reading ${filename}` );
	const content = fs.readFileSync( filename, 'utf8' );

	const actions = parseString( content );

	debug( `Done with ${filename}` );
	return actions;

}


/**
 * @param {string} source
 * @returns {Array.<{action: string, lines?: number[], fileA?: string, fileB?: string}>}
 */
function parseString( source ) {

	let actions = [];

	debug( `Parsing` );
	const diff = parser.parse( source );

	debug( `Found ${diff.length} diffs` );
	diff.forEach( ( diffEntry, diffIndex ) => {

		debug( `DiffEntry ${diffIndex + 1} / ${diff.length}...` );

		verbose( 'command: %O', diffEntry.command );
		verbose( 'meta: %O', diffEntry.meta );

		// is this an entry for a completely new file?
		if ( diffEntry.meta.findIndex( e => e.type && e.type === 'FileNew' ) !== - 1 ) {

			debug( `FileNew found, trigger whole file` );

			actions.push( { action: "new", fileA: diffEntry.command.fileA } );

			return;

		}

		// is this an entry for a deleted file?
		if ( diffEntry.meta.findIndex( e => e.type && e.type === 'FileDeleted' ) !== - 1 ) {

			debug( `FileDeleted found, trigger whole file` );

			actions.push( { action: "delete", fileA: diffEntry.command.fileA } );

			return;

		}

		if ( diffEntry.hunks === undefined || diffEntry.length === 0 ) {

			debug( `DiffEntry has no hunks, skipping` );

			actions.push( { action: "skip" } );

			return;

		}

		let totalLineNumbers = [];

		diffEntry.hunks.forEach( ( hunkEntry, hunkIndex ) => {

			debug( `HunkEntry ${hunkIndex + 1} / ${diffEntry.hunks.length}...` );

			let lineNumbers = [];

			let pre = Number.parseInt( hunkEntry.linePre ) - 1;

			// counting which lines are affected:
			for ( const change of hunkEntry.changes ) {

				if ( change.type === ' ' ) {

					pre ++;

				} else if ( change.type === '+' ) {

					lineNumbers.push( pre );

				} else if ( change.type === '-' ) {

					pre ++;

					lineNumbers.push( pre );

				} else {

					debug( `changeEntry has an unknown type: ${change.type}` );

				}

			}

			// drop dupes
			lineNumbers = lineNumbers.filter( ( x, idx, arr ) => arr.indexOf( x ) === idx );

			totalLineNumbers.push( lineNumbers );

			debug( `lineNumbers for this diffEntry: ${ ( lineNumbers.length > 0 ) ? lineNumbers.join( ', ' ) : "none"}` );

		} );

		actions.push( { action: "modify", lines: totalLineNumbers, fileA: diffEntry.command.fileA, fileB: diffEntry.command.fileB } );

	} );

	return actions;

}


module.exports = { parseFile, parseString };

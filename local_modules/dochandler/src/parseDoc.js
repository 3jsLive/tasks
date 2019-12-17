'use strict';

const fs = require( 'fs' );
const util = require( 'util' );

const parserName = [ './parser', 'doobdoc', 'no', 'trace' ].join( '-' ); // including it directly kills autocomplete (Wtf)
const parser = require( parserName );

const debug = require( 'debug' )( 'parseDoc' );
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
 */
function parseString( source ) {

	debug( `Parsing` );
	const ast = parser.parse( source );

	debug( `Found ${ast.length} nodes` );
	ast.forEach( ( node, nodeIndex ) => {

		verbose( `${nodeIndex + 1}/${ast.length}: ${util.inspect( node, false, 4, true )}` );

	} );

	return ast;

}


module.exports = { parseFile, parseString };

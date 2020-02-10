const parser = require( 'dochandler' );

const logger = require( 'signale' ).scope( 'findDocTags' );
const util = require( 'util' );

/*

	Search for doc tags in a doc file
	Necessary so we can make locatedCodeDependencies from one doc
	file to the other. E.g. [page:Vector3.x xVec] has to link to the
	line and column of Vector3.js where the 'x' property is defined.

	Status: works

*/


const typeTranslator = {
	'example': 'ExampleTag',
	'page': 'PageTag',
	'link': 'LinkTag',
	'property': 'PropertyTag',
	'method': 'MethodTag',
	'param': 'ParamTag',
	'code': 'CodeTag'
};

const validRegex = {
	'example': { url: /[\w_]+/, name: /[\w:\/\.\-_ \s]*?/ },
	'page': { name: /[\w\.]*?/, anchor: /(\.[\w\.]+)*?/, text: /[\w\.\s]*?/ },
	'link': { url: /[\[\]\w:\/\.\-_\(\)#=]+/, text: /([\w:\/\.\-_\s\]\[]*\.js|[\w:\/\.\-_\s\]\[]*?)/ },
	'property': { name: /[\w\.\s]*?/, retval: /[\w]+/ },
	'method': { name: /[\w\.\s]*?/, retval: /[\w]+/ },
	'param': { name: /[\w\.\s]*?/, retval: /[\w\.]+/ },
	'code': { text: /.*?/ }
};


/**
 * Find a [doobsDocTag] in the given file
 * @param {string} file path
 * @param {string} type The node type to search for
 * @param {Object} [query] Regexes to search for
 * @param {RegExp} [query.anchor] Used by [page]
 * @param {RegExp} [query.name]
 * @param {RegExp} [query.retval]
 * @param {RegExp} [query.text]
 * @param {RegExp} [query.url]
 * @param {Object} [options]
 * @param {boolean} [options.regexDefault=true] Use a fitting regular expression if no search value is given for an attribute. Defaults to true.
 */
function findDocTag( file, type, query, options ) {

	const ast = parser.parseDoc.parseFile( file );

	// query optional
	if ( query === undefined )
		query = {};

	// whether to use placeholders for missing parts
	if ( options === undefined || typeof options.regexDefault === 'undefined' )
		options = { regexDefault: true, ...options };

	// silently convert to boolean
	if ( typeof options.regexDefault !== 'boolean' )
		options.regexDefault = !! options.regexDefault;

	// we need a type, searching for attributes only is not supported (yet?)
	if ( type === undefined )
		throw new Error( `Please enter a type to search for` );

	// simple check
	if ( Object.keys( typeTranslator ).includes( type ) === false )
		throw new Error( 'Unknown type entered' );

	// set defaults
	query = Object.assign( {
		anchor: ( options.regexDefault === true ) ? validRegex[ type ].anchor : undefined,
		name: ( options.regexDefault === true ) ? validRegex[ type ].name : undefined,
		retval: ( options.regexDefault === true ) ? validRegex[ type ].retval : undefined,
		text: ( options.regexDefault === true ) ? validRegex[ type ].text : undefined,
		url: ( options.regexDefault === true ) ? validRegex[ type ].url : undefined
	}, query );

	// first filter by type
	const allCandidates = ast.filter( node => node.type === typeTranslator[ type ] );

	// then search for attribute
	const finalCandidates = allCandidates.filter( node => search( type, query, node ) );

	logger.debug( "FINAL:", util.inspect( finalCandidates, false, 4, true ) );

	return finalCandidates;

}


/**
 * @param {string} type The node type to search for
 * @param {Object} [query] Regexes to search for
 * @param {RegExp} [query.anchor] Used by [page]
 * @param {RegExp} [query.name]
 * @param {RegExp} [query.retval]
 * @param {RegExp} [query.text]
 * @param {RegExp} [query.url]
 * @param {Object} [node]
 */
function search( type, query, node ) {

	let valid = true;

	for ( const [ attribute, value ] of Object.entries( query ) ) {

		if ( valid === false )
			continue;

		if ( value === undefined )
			continue;

		logger.debug( `Testing ${value} on ${util.inspect( node, { breakLength: 180, colors: true, depth: 1 } )}, attribute: ${attribute}` );

		if ( validRegex[ type ] !== undefined )
			if ( Object.keys( validRegex[ type ] ).includes( attribute ) === false )
				continue;

		if ( typeof node[ attribute ] === 'undefined' || node[ attribute ] === undefined ) {

			valid = false;
			continue;

		}

		if ( value instanceof RegExp === true && value.test( node[ attribute ] ) === true ) {

			continue;

		} else {

			valid = false;
			continue;

		}

	}

	if ( valid ) logger.debug( 'VALID' );

	return valid;

}


module.exports = { findDocTag, "_search": search };

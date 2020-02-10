const fs = require( 'fs' );
const path = require( 'path' );
const glob = require( 'glob' );
const esquery = require( 'esquery' );


/*

	Note: oooold code

	TODO: Three.Legacy.js needs special treatment probably

	FIXME: BoxBufferGeometry/BoxGeometry both in one .js needs an ugly hack

*/


// parsing
const acorn = require( 'acorn' );

// debugging output
const logger = require( 'signale' ).scope( 'collectPrototypes' );

// convenience
const getNameFromIdentifierOrLiteral = ( node ) => node.name || node.value;

// node processing
function saveLocation( node, stateObject ) {

	const name = getNameFromIdentifierOrLiteral( node.key );

	if ( name === 'constructor' )
		stateObject.constructor = node.value.loc;
	else
		stateObject.thises[ name ] = stateObject.thises[ name ] || node.value.loc;

	return name;

}


function processFile( classname, code, fileRelative ) {

	// holds the state during traversing
	const stateObject = { classname, code: code, constructor: false, thises: {}, parent: false, file: fileRelative };

	logger.debug( `Creating AST for ${classname}` );
	const ast = acorn.parse( code, { locations: true, sourceType: "module", ecmaVersion: 9 } );

	// Class1.js
	let props = esquery( ast, `CallExpression[callee.object.name="Object"][callee.property.name="assign"] > MemberExpression[object.name="${classname}"][property.name="prototype"] + ObjectExpression > .properties` );
	props.forEach( node => saveLocation( node, stateObject ) );

	// Class1.js
	props = esquery( ast, `AssignmentExpression[left.object.name="${classname}"][left.property.name="prototype"] > ObjectExpression > .properties` );
	props.forEach( node => saveLocation( node, stateObject ) );

	// Class3.js
	props = esquery( ast, `ExpressionStatement > CallExpression[callee.object.name="Object"][callee.property.name="defineProperties"] :matches(ThisExpression,MemberExpression[object.name="${classname}"][property.name="prototype"]) ~ ObjectExpression > .properties` );
	props.forEach( node => saveLocation( node, stateObject ) );

	// Class1.js Class2.js
	props = esquery( ast, `AssignmentExpression[left.object.object.name="${classname}"][left.object.property.name="prototype"]` );
	props.forEach( node => {

		const name = getNameFromIdentifierOrLiteral( node.left.property );

		if ( name === 'constructor' )
			stateObject.constructor = node.right.loc;
		else
			stateObject.thises[ name ] = stateObject.thises[ name ] || node.right.loc;

	} );

	// Class3.js
	const literals = esquery( ast, `ExpressionStatement > CallExpression[callee.object.name="Object"][callee.property.name="defineProperty"] :matches(ThisExpression + Literal, MemberExpression[object.name="${classname}"][property.name="prototype"] + Literal)` );
	const objects = esquery( ast, `ExpressionStatement > CallExpression[callee.object.name="Object"][callee.property.name="defineProperty"] :matches(ThisExpression,MemberExpression[object.name="${classname}"][property.name="prototype"]) + Literal + ObjectExpression` );
	literals.forEach( ( node, index ) => {

		const obj = objects[ index ];

		const name = getNameFromIdentifierOrLiteral( node );

		if ( name === 'constructor' )
			stateObject.constructor = obj.loc;
		else
			stateObject.thises[ name ] = stateObject.thises[ name ] || obj.loc;

	} );

	// Class3.js
	let callExprs = esquery( ast, `AssignmentExpression[left.object.name="${classname}"][left.property.name="prototype"] > !.right[callee.object.name="Object"][callee.property.name="assign"] > CallExpression[callee.object.name="Object"][callee.property.name="create"] > :matches(MemberExpression[property.name="prototype"], ObjectExpression)` );
	callExprs.forEach( callExpr => {

		const parent = getNameFromIdentifierOrLiteral( callExpr.arguments[ 0 ].arguments[ 0 ].object );
		if ( stateObject.parent !== false )
			console.error( 'Already got a parent?', stateObject.parent, parent );
		stateObject.parent = parent;

		props = callExpr.arguments[ 1 ].properties;
		props.forEach( node => {

			const name = getNameFromIdentifierOrLiteral( node.key );

			if ( name === 'constructor' )
				stateObject.constructor = node.value.loc;
			else
				stateObject.thises[ name ] = stateObject.thises[ name ] || node.value.loc;

		} );

	} );

	// Class2.js
	let parents = esquery( ast, `AssignmentExpression[left.object.name="${classname}"][left.property.name="prototype"] > CallExpression[callee.object.name="Object"][callee.property.name="create"] > MemberExpression[property.name="prototype"] .object` );

	if ( parents.length > 1 )
		console.error( 'Multiple parents?', parents );

	parents.forEach( baseClass => {

		const name = getNameFromIdentifierOrLiteral( baseClass );

		stateObject.parent = name;

	} );

	// Class4.js
	let mains = esquery( ast, `Program > FunctionDeclaration[id.name="${classname}"]` );

	if ( mains.length > 1 )
		console.error( 'Multiple constructors?', mains );

	mains.forEach( main => {

		stateObject.constructor = main.loc;

	} );

	// Class4.js
	let setters = esquery( ast, `!AssignmentExpression[left.object.type="ThisExpression"]` );
	setters.forEach( node => {

		const name = getNameFromIdentifierOrLiteral( node.left.property );

		if ( name === 'constructor' )
			stateObject.constructor = node.right.loc;
		else
			stateObject.thises[ name ] = stateObject.thises[ name ] || node.right.loc;

	} );

	// Class5.js (the underscore is because of Math.js declaring "_Math" to avoid conflicting with inbuilt "Math")
	props = esquery( ast, `Program > VariableDeclaration > VariableDeclarator[id.name=/_?${classname}/] > ObjectExpression > .properties` );
	props.forEach( node => saveLocation( node, stateObject ) );

	// Class6.js static methods
	props = esquery( ast, `Program > ExpressionStatement > CallExpression[callee.object.name="Object"][callee.property.name="assign"] > Identifier[name="${classname}"] ~ ObjectExpression .properties` );
	props.forEach( node => saveLocation( node, stateObject ) );

	// Class6.js static assignment
	let staticAssign = esquery( ast, `Program > ExpressionStatement > !AssignmentExpression > MemberExpression[object.name="${classname}"][property.name!="prototype"]` );
	staticAssign.forEach( node => {

		const name = getNameFromIdentifierOrLiteral( node.left.property );

		if ( name === 'constructor' )
			stateObject.constructor = node.right.loc;
		else
			stateObject.thises[ name ] = stateObject.thises[ name ] || node.right.loc;

	} );

	// special case: It's just a file full of functions, no global object or anything
	if ( classname === 'Interpolations' ) {

		const funcs = esquery( ast, `Program > FunctionDeclaration` );
		funcs.forEach( f => {

			const name = getNameFromIdentifierOrLiteral( f.id );

			stateObject.thises[ name ] = f.loc;

		} );

	}


	// otherwise we run into trouble with locations technically being SourceLocations instead of mere dictionaries
	return JSON.parse( JSON.stringify( stateObject ) );

}


/**
 * @typedef {object} SourceLocation
 * @prop {{line: number, column: number, offset: number}} start
 * @prop {{line: number, column: number, offset: number}} end
 */


function collect( basepath ) {

	// check basepath validity
	if ( fs.existsSync( basepath ) !== true ) {

		logger.error( `Basepath '${basepath}' does not exist, aborting...` );

		return false;

	}


	//
	// search all files
	//
	const sourceGlob = path.join( basepath, 'src', '**', '*.js' ); // TODO: example files?
	const files = glob.sync( sourceGlob );

	if ( files.length === 0 ) {

		logger.error( `No files found in '${sourceGlob}, aborting...` );

		return false;

	}


	//
	// process them
	//
	const results = {};
	for ( let index = 0, len = files.length; index < len; index ++ ) {

		const file = files[ index ];
		const fileRelative = file.replace( basepath, '' );
		const classname = path.basename( file, '.js' );

		logger.debug( `${index + 1} / ${ len }: ${file} ${fileRelative} ${classname}` );

		let code;
		try {

			code = fs.readFileSync( file, 'utf8' );

		} catch ( err ) {

			logger.error( `Couldn't open '${file}', aborting...` );

			return false;

		}

		const list = processFile( classname, code, fileRelative );

		if ( list === false ) {

			logger.error( `Failed processing '${file}', aborting...` );

			return false;

		}

		results[ classname ] = list;


		// FIXME: nasty hack
		if ( /geometries\/[A-Za-z]+Geometry\.js/.test( file ) === true ) {

			const fakename = classname.replace( 'Geometry', 'BufferGeometry' );
			const list = processFile( fakename, code, fileRelative );

			if ( list === false ) {

				logger.error( `Failed processing "the other" '${file}', aborting...` );

				return false;

			}

			results[ fakename ] = list;

		}

	}


	//
	// Done.
	//
	return results;

}

module.exports = collect;

const fs = require( 'fs' );
const path = require( 'path' );
const acorn = require( 'acorn' );
const walk = require( 'acorn-walk' );
const signale = require( 'signale' );
const getSource = require( 'get-source' );
const linesAndCols = require( 'lines-and-columns' );
const stringify = require( 'json-stable-stringify' );
const glob = require( 'glob' );

const config = require( 'rc' )( 'tasks' );


/*

	Take the results from a DependenciesWorker run
	and find the origins of the code lines the
	profiler logged

*/

// TODO: remove config.* as much as possible

// TODO: rename Folder -> something more appropriate


class DependenciesParser {

	/**
	 * @param {string} inputFolder
	 * @param {string} outputFolder
	 * @param {string} inputGlob
	 */
	constructor( inputFolder, outputFolder, inputGlob ) {

		this.inputFolder = inputFolder;
		this.outputFolder = outputFolder;
		this.inputGlob = inputGlob;

		this.logger = signale.scope( 'Parser' );
		this.logger.config( { displayTimestamp: true, displayDate: true } );

		// this is used to skip minified js libs
		// TODO: drop and replace with config as in typeprofile worker
		this.acceptableScriptUrlsRx = new RegExp( config.dependencies.baseUrl + '.+?(?<!min)\\.js$' );

		this.source = fs.readFileSync( path.join( config.dependencies.fileBase, config.dependencies.mainScriptPath ), 'utf8' );
		this.lines = new linesAndCols.default( this.source );
		this.sourceMapped = getSource( path.join( config.dependencies.fileBase, config.dependencies.mainScriptPath ) );

		this.astCache = {};

		// result
		this.dependencies = {};

	}


	run() {

		for ( const inputFile of glob.sync( this.inputGlob, { cwd: this.inputFolder } ) ) {

			this.dependencies = {
				uniq: [],
				lines: {},
			};

			const result = JSON.parse( fs.readFileSync( path.join( this.inputFolder, inputFile ), 'utf8' ) );

			const mainScriptRx = new RegExp( config.dependencies.mainScriptFilename + '$' );

			// Go thru all coverage-processed scripts
			for ( const script of result ) {

				this.logger.debug( 'Script:', script.url );

				// Either the main threejs file
				if ( mainScriptRx.test( script.url ) === true ) {

					this.logger.debug( `threejs script.functions.length: ${script.functions.length}` );

					for ( const func of script.functions )
						this.processThreeJsCoverage( func );

				} else if ( this.acceptableScriptUrlsRx.test( script.url ) === true ) {

					// or all *.js files from baseUrl, except those ending in *.min.js
					this.logger.debug( `other script.functions.length: ${script.functions.length} in ${script.url}` );

					for ( const func of script.functions )
						this.processOtherCoverage( func, script );

				}

			}

			this.logger.debug( 'Cleaning...' );
			const clean = this.cleanupDependencies();

			// FIXME: hardcoded
			const outputFile = path.join( this.outputFolder, inputFile.replace( '_profiler', '_parsed' ) );
			this.logger.debug( `Saving '${outputFile}'...` );
			fs.writeFileSync( outputFile, stringify( clean ), 'utf8' );

			this.logger.debug( 'Done' );

		}

	}


	processThreeJsCoverage( func ) {

		if ( func.functionName === '' )
			return;

		for ( const range of func.ranges ) {

			//
			// First: sort out the non-visited ones
			//
			if ( range.count === 0 )
				continue;

			//
			// Second: Translate the character-based offset to a line-based one
			//
			const start = this.lines.locationForIndex( range.startOffset );
			if ( start === null ) {

				this.logger.debug( 'start === null?', range.startOffset, range.count, func.functionName );
				continue;

			}

			//
			// Finally: Query the source map for the calculated line
			//
			const mapResult = this.sourceMapped.resolve( { line: start.line + 1, column: start.column } );

			// We found something
			if ( mapResult.sourceFile ) {

				if ( typeof this.astCache[ mapResult.sourceFile.path ] === 'undefined' ) {

					this.astCache[ mapResult.sourceFile.path ] = acorn.parse(
						fs.readFileSync( mapResult.sourceFile.path, 'utf8' ),
						{ locations: true, sourceType: "module", ecmaVersion: 9 }
					);

				}

				this.logger.debug( 'Found file:', mapResult.sourceFile.path );
				this.logger.debug( 'Looking for:', mapResult.sourceLine );
				this.logger.debug( 'Looking at index:', mapResult.sourceFile.text.indexOf( mapResult.sourceLine ) + mapResult.column );
				this.logger.debug( 'Originally:', range.startOffset );
				const vrAST = this.astCache[ mapResult.sourceFile.path ];

				// findNodeAt rarely causes issues, but findNodeAfter just works - maybe some extensive testing could settle it
				// let vrNode = walk.findNodeAt( vrAST, mapResult.sourceFile.text.indexOf( mapResult.sourceLine ) + mapResult.column );
				const vrNode = walk.findNodeAfter( vrAST, mapResult.sourceFile.text.indexOf( mapResult.sourceLine ) + mapResult.column );

				if ( vrNode === undefined )
					this.logger.warn( 'vrNode === undefined' );

				this.addToDeps( {
					code: mapResult.sourceLine.trim(),
					location: vrNode.node.loc,
					name: func.functionName,
					path: mapResult.sourceFile.path.replace( config.dependencies.fileBase, '' ), // Get the normalized path
					count: range.count
				} );

			} else {

				this.logger.debug( 'sourceMap missing?', mapResult );

			}

		}

	}


	processOtherCoverage( func, script ) {

		if ( func.functionName === '' )
			return;

		for ( const range of func.ranges ) {

			//
			// First: sort out the non-visited ones
			//
			if ( range.count === 0 )
				continue;

			//
			// Second: Most likely something interesting -> get an AST
			//
			const filePath = script.url.replace( config.dependencies.baseUrl, config.dependencies.fileBase );

			if ( typeof this.astCache[ filePath ] === 'undefined' ) {

				this.astCache[ filePath ] = acorn.parse(
					fs.readFileSync( filePath, 'utf8' ),
					{ locations: true, sourceType: "module", ecmaVersion: 9 }
				);

			}

			//
			// Third: Grab a matching node for its location
			//
			let node = walk.findNodeAt( this.astCache[ filePath ], range.startOffset, null, 'FunctionExpression' ) ||
					walk.findNodeAt( this.astCache[ filePath ], range.startOffset, null, 'FunctionDeclaration' ) ||
					walk.findNodeAt( this.astCache[ filePath ], range.startOffset, null );

			// TODO: remove test
			if ( node === undefined ) {

				this.logger.warn( 'node === undefined' );
				node = walk.findNodeAfter( this.astCache[ filePath ], range.startOffset );

			}

			//
			// Finally: Add the calculated line
			//
			this.addToDeps( {
				code: "-",
				location: node.node.loc,
				name: func.functionName,
				path: filePath.replace( config.dependencies.fileBase, '' ), // Get the normalized path
				count: range.count
			} );

		}

	}


	addToDeps( { path, location, code, name, count } ) {

		if ( this.dependencies.uniq.includes( path ) === false )
			this.dependencies.uniq.push( path );

		if ( typeof this.dependencies.lines[ path ] === 'undefined' )
			this.dependencies.lines[ path ] = [];

		this.dependencies.lines[ path ].push( { location, code, name, count } );

	}


	cleanupDependencies() {

		// dirty, I know
		let deps = JSON.parse( JSON.stringify( this.dependencies ) );

		// filter duplicate code lines
		this.logger.debug( `Filtering duplicate code lines... ${Object.keys( deps.lines ).length} total` );
		for ( const path in deps.lines )
			deps.lines[ path ] = deps.lines[ path ].filter( isUniqueLine );

		// everything as deterministic as possible ( also see use of custom stringify )
		this.logger.debug( `Sorting code lines...` );
		for ( const key in deps.lines )
			deps.lines[ key ].sort( sortByName );

		this.logger.debug( `Sorting other stuff...` );
		this.logger.debug( `deps.uniq: ${deps.uniq.length}` );
		this.logger.debug( deps.uniq );
		deps.uniq.sort();

		return deps;

	}

}


function isUniqueLine( lineEntry, idx, array ) {

	return idx === array.findIndex( lE =>
		lE.location.start.line === lineEntry.location.start.line &&
		lE.location.start.column === lineEntry.location.start.column &&
		lE.location.end.line === lineEntry.location.end.line &&
		lE.location.end.column === lineEntry.location.end.column &&
		lE.column === lineEntry.column &&
		lE.code === lineEntry.code &&
		lE.name === lineEntry.name
	);

}

function sortByName( a, b ) {

	return a.name.localeCompare( b.name );

}


module.exports = DependenciesParser;


// simple CLI-fication
if ( require.main === module ) {

	if ( process.argv.length < 4 ) {

		console.error( 'Invalid number of arguments' );

		console.log( `Usage: ${path.basename( process.argv[ 0 ] )} ${path.relative( process.cwd(), process.argv[ 1 ] )} <Input path> <Output path> [Input glob]` );

		process.exit( - 1 );

	}

	// eslint-disable-next-line no-unused-vars
	let [ node, script, inputPath, outputPath, inputGlob ] = process.argv;

	try {

		inputGlob = ( inputGlob ) ? inputGlob : 'examples_*_profiler.json';

		console.log( 'Init...' );
		const parser = new DependenciesParser( inputPath, outputPath, inputGlob );

		console.log( 'Work...' );
		parser.run();

		console.log( 'Done' );

	} catch ( err ) {

		console.error( 'The big one >', err );
		process.exit( - 1 );

	}

}

const fs = require( 'fs' );
const path = require( 'path' );
const signale = require( 'signale' );
const stringify = require( 'json-stable-stringify' );
const glob = require( 'glob' );


/*

	The `*_dependencies.json` files can get excessively large
	because of duplicate entries. This crude packer aims to fix that.

*/


// TODO: merge this with the parser

class DependenciesPacker {

	/**
	 * @param {string} inputPath
	 * @param {string} outputPath
	 * @param {string} inputGlob
	 */
	constructor( inputPath, outputPath, inputGlob ) {

		this.inputPath = inputPath;
		this.outputPath = outputPath;
		this.inputGlob = inputGlob;

		this.logger = signale.scope( 'DependenciesPacker' );
		this.logger.config( { displayTimestamp: true, displayDate: true } );

		// result
		this.dependencies = {};

	}


	run() {

		for ( const inputFile of glob.sync( this.inputGlob, { cwd: this.inputPath } ) ) {

			const data = JSON.parse( fs.readFileSync( path.join( this.inputPath, inputFile ), 'utf8' ) );
			this.dependencies = data.deps;

			this.logger.debug( 'Cleaning...' );
			const clean = this.cleanupDependencies();

			// FIXME: hardcoded
			const outputFile = path.join( this.outputPath, inputFile.replace( '_dependencies', '_packed' ) );
			this.logger.debug( `Saving '${outputFile}'...` );
			fs.writeFileSync( outputFile, stringify( clean ), 'utf8' );

			this.logger.debug( 'Done' );

		}

	}


	cleanupDependencies() {

		// dirty, I know
		let deps = JSON.parse( JSON.stringify( this.dependencies ) );

		// filter duplicate uniforms
		this.logger.debug( `Filtering duplicate uniforms...` );
		deps.uniforms = deps.uniforms.filter( isUniqueUniform );
		this.logger.debug( `Uniforms: ${deps.uniforms.map( u => u.name ).join( ', ' )}` );

		// filter duplicate shader chunks
		this.logger.debug( `Filtering duplicate shader chunks...` );
		deps.shaderChunks = deps.shaderChunks.filter( isUniqueShaderChunk );
		this.logger.debug( `Shader chunks: ${deps.shaderChunks.map( sc => sc.name ).join( ', ' )}` );

		this.logger.debug( `Sorting other stuff...` );
		this.logger.debug( `deps.external: ${deps.external.length}` );
		this.logger.debug( deps.external );
		deps.external.sort();

		this.logger.debug( `Sorting other stuff...` );
		this.logger.debug( `deps.local: ${deps.local.length}` );
		this.logger.debug( deps.local );
		deps.local.sort();

		this.logger.debug( `deps.shaderChunks: ${deps.shaderChunks.length}` );
		deps.shaderChunks.sort( sortBySource );

		return deps;

	}

}


function isUniqueUniform( uni, idx, uniforms ) {

	return idx === uniforms.findIndex( u =>
		u.name === uni.name &&
		u.start.line === uni.start.line &&
		u.start.column === uni.start.column &&
		u.end.line === uni.end.line &&
		u.end.column === uni.end.column
	);

}


function isUniqueShaderChunk( chunk, idx, chunks ) {

	return idx === chunks.findIndex( u =>
		u.name === chunk.name &&
		u.source === chunk.source &&
		u.start.line === chunk.start.line &&
		u.start.column === chunk.start.column &&
		u.end.line === chunk.end.line &&
		u.end.column === chunk.end.column
	);

}


function sortBySource( a, b ) {

	return a.source.localeCompare( b.source );

}


module.exports = DependenciesPacker;


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

		inputGlob = ( inputGlob ) ? inputGlob : 'examples_*_dependencies-*.json';

		console.log( 'Init...' );
		const packer = new DependenciesPacker( inputPath, outputPath, inputGlob );

		console.log( 'Work...' );
		packer.run();

		console.log( 'Done' );

	} catch ( err ) {

		console.error( 'The big one >', err );
		process.exit( - 1 );

	}

}

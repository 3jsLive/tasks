/*

	Type: Static
	Needs build: No
	Needs docs: No
	Needs examples: No
	Needs source: Yes

*/

const collectedExports = require( './collectExports' );
const fs = require( 'fs' );
const path = require( 'path' );


const BaseCheck = require( './BaseCheck' );


class CompareSourceExports extends BaseCheck {

	async worker() {

		this.logger.time( 'Get source TS modules' );
		const class2fileTs = collectedExports.getModulesTs( this.basePath, false );
		this.logger.timeEnd( 'Get source TS modules' );

		this.logger.time( 'Get source JS modules' );
		const class2fileJs = collectedExports.getModulesJs( this.basePath, false );
		this.logger.timeEnd( 'Get source JS modules' );


		//
		// Compare the class names
		//
		const sortedTsNames = Object.keys( class2fileTs ).sort();
		const sortedJsNames = Object.keys( class2fileJs ).sort();

		this.logger.debug( `${sortedTsNames.length} sorted TS names, ${sortedJsNames.length} sorted JS names` );

		const uniqueTsNames = sortedTsNames.filter( name => sortedJsNames.indexOf( name ) === - 1 );
		const uniqueJsNames = sortedJsNames.filter( name => sortedTsNames.indexOf( name ) === - 1 );

		this.logger.debug( `${uniqueTsNames.length} unique TS names, ${uniqueJsNames.length} unique JS names` );

		const uniqueTsEntries = { errors: [], hits: 0, results: uniqueTsNames.map( name => ( { name, file: class2fileTs[ name ] } ) ) };
		const uniqueJsEntries = { errors: [], hits: 0, results: uniqueJsNames.map( name => ( { name, file: class2fileJs[ name ] } ) ) };

		// counter
		uniqueTsEntries.hits = uniqueTsEntries.results.length;
		uniqueJsEntries.hits = uniqueJsEntries.results.length;

		// total hits
		const totalHits = uniqueJsEntries.hits + uniqueTsEntries.hits;

		return { errors: [], hits: totalHits, results: { TypeScript: uniqueTsEntries, JavaScript: uniqueJsEntries } };

	}

}


// simple CLI-fication
if ( require.main === module ) {

	( async() => {

		if ( process.argv.length != 4 ) {

			console.error( 'Invalid number of arguments' );

			console.log( `Usage: ${path.basename( process.argv[ 0 ] )} ${process.argv[ 1 ]} <basePath> <outputFilename>` );

			process.exit( - 1 );

		}


		// setup
		// eslint-disable-next-line no-unused-vars
		const [ node, script, basePath, outputFilename ] = process.argv;
		const outputStream = fs.createWriteStream( outputFilename, { flags: 'w', encoding: 'utf8' } );
		const check = new CompareSourceExports( basePath, outputStream );

		// analyze
		const result = await check.run( basePath, outputStream );


		// done
		console.log( "RESULT:", result );

	} )();

}

module.exports = CompareSourceExports;

const path = require( 'path' );
const lf = require( 'listfiles' );
const config = require( 'rc' )( 'tasks' );

const DependenciesRunner = require( './dependenciesRunner' );


process.on( 'unhandledRejection', reason => {

	console.error( 'unhandledRejection' );
	console.error( reason );

	throw reason;

} );

process.on( 'uncaughtException', error => {

	console.error( 'uncaughtException' );
	console.error( error );

	throw error;

} );


if ( process.argv.length < 4 ) {

	console.error( 'Invalid number of arguments' );

	console.log( `Usage: ${process.argv[ 0 ]} ${process.argv[ 1 ]} <3jsRepository> <URL1> <URL2> ... or '-' for all examples` );

	process.exit( - 1 );

}

// eslint-disable-next-line no-unused-vars
let [ node, script, threejsRepository, ...urls ] = process.argv;

const filterFn = url => config.dependencies.bannedExamples.every( part => url.includes( part ) === false ) &&
	config.dependencies.validExamplePrefixes.some( prefix => url.includes( `/${prefix}_` ) === true );

try {

	let workloadUrls;

	// wildcard mode
	if ( urls.length === 1 && urls[ 0 ] === '-' ) {

		workloadUrls = lf.examples( {
			basePath: threejsRepository,
			baseUrl: `${config.dependencies.baseUrl}/examples/`
		} ).urls.filter( filterFn );

	} else {

		workloadUrls = urls.filter( filterFn );

	}

	console.log( 'Init...' );

	const runner = new DependenciesRunner(
		path.join( config.root, config.dependencies.resultsBase ),
		config.dependencies.fileBase,
		config.dependencies.mainScriptPath,
		config.dependencies.baseUrl,
		config.dependencies.puppeteerOptions
	);

	runner.loadUrls( workloadUrls );

	console.log( `Working ${workloadUrls.length} URLs...` );

	runner.run();

} catch ( err ) {

	console.error( 'The big one >', err );
	process.exit( - 1 );

}

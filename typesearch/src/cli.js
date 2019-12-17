const lf = require( 'listfiles' );
const globalConfig = require( 'rc' )( '3jsdev' );
const servicesConfig = require( 'rc' )( 'services', globalConfig );
const config = require( 'rc' )( 'typesearch', servicesConfig );
const path = require( 'path' );

const TypeProfilingRunner = require( './typeProfilingRunner' );


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

try {

	let workloadUrls;

	// wildcard mode
	if ( urls.length === 1 && urls[ 0 ] === '-' ) {

		workloadUrls = lf.examples( {
			basePath: threejsRepository,
			baseUrl: `http://${config.typesearch.baseUrl.host}:${config.typesearch.baseUrl.port}`
		} ).urls.filter( url =>
			config.typesearch.bannedExamples.every( part => url.includes( part ) === false ) &&
				config.typesearch.validExamplePrefixes.some( prefix => url.includes( `/${prefix}_` ) === true )
		);

	} else {

		workloadUrls = urls.slice();

	}

	console.log( 'Init...' );

	const worker = new TypeProfilingRunner(
		config.typesearch.dataPath,
		threejsRepository,
		'build/three.module.js',
		`http://${config.typesearch.baseUrl.host}:${config.typesearch.baseUrl.port}`
	);

	worker.loadUrls( workloadUrls );

	console.log( `Working ${workloadUrls.length} URLs...` );

	worker.run();

} catch ( err ) {

	console.error( 'The big one >', err );
	process.exit( - 1 );

}

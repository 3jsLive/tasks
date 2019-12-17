const fs = require( 'fs' );

const assert = require( 'assert' );

const parserClass = require( `../src/typeProfilingParser` );

const testBasePath = `${__dirname}/data/typeProfilingParser/`;
const gold = JSON.parse( fs.readFileSync( `${__dirname}/data/typeProfilingParser/gold.json`, 'utf8' ) );


describe( `typeProfilingParser`, function () {

	it( 'basics', async function () {

		// timeout due to the additional workload
		this.timeout( 30000 );

		// analyze
		const parser = new parserClass( `${__dirname}/data/typeProfilingWorker/`, testBasePath, testBasePath );
		parser.work();

		const results = JSON.parse( fs.readFileSync( `${__dirname}/data/typeProfilingParser/results.json`, 'utf8' ) );

		assert.deepStrictEqual( results, gold );

	} );

	after( 'clean up', function () {

		fs.unlinkSync( `${__dirname}/data/typeProfilingParser/results.json` );

	} );

} );

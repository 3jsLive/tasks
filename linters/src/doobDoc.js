'use strict';

const Promise = require( 'bluebird' );
const fs = Promise.promisifyAll( require( 'fs' ) );
const path = require( 'path' );
const lister = require( 'listfiles' );

const BaseLinter = require( './BaseLinter' );




class DoobDoc extends BaseLinter {


	async generateListOfFiles() {

		try {

			this.files = lister
				.docs( { basePath: this.basePath, baseUrl: path.join( this.basePath, 'docs/' ) } )
				.urls
				.filter( path => ! path.includes( '/zh/' ) )
				.map( file => ( { absolute: file, relative: path.relative( this.basePath, file ) } ) );

			if ( ! this.files || this.files.length === 0 )
				throw new Error( 'No files found' );

		} catch ( err ) {

			this.logger.fatal( 'Listing docs failed:', err );

			throw err;

		}

	}


	/**
	 * @returns {{ errors: any[], results: Object.<string, { errors: any[], results: { line: number, ruleId: number, level: string, message: string, source: string, index: number, length: number }[] }> } }
	 */
	async worker() {

		const proms = Promise.map( this.files, file => {

			return fs.promises.readFile( file.absolute, 'utf8' )
				.then( content => {

					return this.testString( content );

				} )
				.then( results => {

					results.forEach( r => {

						this.logger.debug( '[%s] File: %s    Line: %i\n\t"%s"\n\t%s\n',
							r.level, file.relative, r.line, r.message, r.source
						);

					} );

					return { file, results, errors: [] };

				} )
				.catch( err => {

					this.logger.error( file.absolute, 'Promise.reduce failed:', err );

					const error = {
						message: err.message.replace( this.basePath, '' ),
						location: err.location,
						name: err.name
					};

					return { file, results: [], errors: [ error ] };

				} );

		}, { concurrency: 4 } );

		return Promise.all( proms )
			.then( allProms => {

				return allProms
					.filter( x => x.results.length > 0 || x.errors.length > 0 )
					.reduce( ( all, cur ) => {

						all.results[ cur.file.relative ] = { errors: cur.errors, results: cur.results };

						return all;

					}, { errors: [], results: {} } );

			} )
			.catch( err => {

				this.logger.fatal( 'Promise.all failed:', err );

				throw err;

			} );

	}


	async testString( str, rule ) {

		const rulesToUse = ( typeof rule !== 'undefined' ) ? DoobDoc.rules.filter( r => r.id === rule ) : DoobDoc.rules;

		return await Promise.reduce( rulesToUse, ( all, rule ) => {

			let match;

			rule.regex.forEach( regex => {

				while ( match = regex.exec( str ) ) {

					const _tmp = str.slice( 0, match.index ).toString();
					const lineNumber = _tmp.split( '\n' ).length;
					const source = '>' + str.slice( match.index, match.index + match[ 0 ].length ) + '<';

					all.push( {
						line: lineNumber,
						ruleId: rule.id,
						level: rule.level,
						message: rule.desc,
						source: source.toString(),
						index: match.index,
						length: match[ 0 ].length
					} );

				}

			} );

			return all;

		}, [] );

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


		// analyze
		const linter = new DoobDoc( basePath, outputStream );
		const result = await linter.run();


		// done
		console.log( "RESULT:", result );

	} )();

}


// because eslint complains otherwise
DoobDoc.rules = [
	{
		id: 'only-param',
		level: 'error',
		desc: 'only param tags allowed in method parens',
		regex: [
			// /\[method:[^\]]+\]\s*\([^\[\)]*\[(?!param)\w+:.*?\]\s*\)/gi // https://regex101.com/r/inyIq2/1
			/\[method:[^\]]+\]\s*\(\s+(?!\s*\))(?!\[param:\w+\s+.*?\])\s*[^\)]+\)/gi // https://regex101.com/r/inyIq2/2
		]
	}, {
		id: 'lowercase-types',
		level: 'warning',
		desc: 'prefer lowercase for field type',
		regex: [
			/(\[[A-Z]+(:|\]))/g
		]
	}, {
		id: 'whitespace-after-type',
		level: 'error',
		desc: 'no whitespace after field type',
		regex: [
			/\[(page|member|property|method|link|example|param):\s+.*?\]/gi // https://regex101.com/r/YkO7j9/1
		]
	}, {
		id: 'trailing-space-after-name',
		level: 'warning',
		desc: 'trailing space after name',
		regex: [
			/\[page:[^\]\s]+?\s+\]/gi, // https://regex101.com/r/udhv6f/2
			/\[(member|property|method|param):[^\]\s]+?\s+\]/gi, // https://regex101.com/r/BbwuYw/2
			/\[example:[^\]\s]+?\s+\]/gi // https://regex101.com/r/gUYF5l/1/
		]
	}, {
		id: 'missing-name',
		level: 'error',
		desc: 'missing name',
		regex: [
			/\[page:(\s*|\s+[^\]]+)\]/gi, // https://regex101.com/r/vFj3mo/2
			/\[(member|property|method|param):(\s*|\s+[^\]]+)\]/gi, // https://regex101.com/r/JYrNPz/1
			/\[example:(\s*|\s+[^\]]+)\]/gi // https://regex101.com/r/OTCUd8/1
		]
	}, {
		id: 'invalid-title',
		level: 'error',
		desc: 'title contains invalid characters (assuming everything else is fine)',
		regex: [
			/\[page:[\w\.]+\s+[\w\.\s]*[^\w\.\s\]]+[\w\.\s]*?\]/gi, // https://regex101.com/r/oKg2Ph/1
			/\[(member|property|method):(\w+?[^\s]*?\]|\w+?([\s\w\.]*[^\w\s\]\.]+?.*?))\]/gi, // https://regex101.com/r/Cz59qf/3
			/\[link:([\w:\/\.\-\(\)\#\=]+) [^\]]*?[^\w:\/\.\-\s\]]+.*?\]/gi // https://regex101.com/r/sfUMEu/1
		]
	}, {
		id: 'trailing-space-after-title',
		level: 'warning',
		desc: 'trailing space after title (assuming everything else is fine)',
		regex: [
			/\[page:[\w\.]+\s+[^\]]*?\s+\]/gi, // https://regex101.com/r/sBAIPJ/3
			/\[link:[\w:\/\.\-\(\)#=]+ [^\]]*?\s+\]/gi, // https://regex101.com/r/U5IlC3/1
			/\[example:[\w:\/\.\- \s]+?\s+\]/gi // https://regex101.com/r/iHCyO1/1
		]
	}, {
		id: 'legal-page-name',
		level: 'error',
		desc: 'only alphanumeric and underscore allowed in page name',
		regex: [
			/\[(member|property|method):\w*[^\w\s\]].*?\]/gi, // https://regex101.com/r/MPcNPz/3
			/\[page:[\.\w]*[^\w\s\.\]].*?\]/gi // https://regex101.com/r/sfR8kK/2
		]
	}, {
		id: 'invalid-url',
		level: 'error',
		desc: 'illegal characters in URL (testing URL only, ignoring title)',
		regex: [
			/\[link:[\w:\/\.\-\(\)#=]*(?!(\[path\]|\[name\]))[^\w:\/\.\-\(\)#=\s\]]+[\w:\/\.\-\(\)#=]*.*?\]/gi // https://regex101.com/r/3iYJML/3
		]
	}, {
		id: 'trailing-space-after-url',
		level: 'warning',
		desc: 'trailing space after URL',
		regex: [
			/\[link:([\w:\/\.\-\(\)#=]+)\s+\]/gi // https://regex101.com/r/5Gv5Jr/1
		]
	}, {
		id: 'missing-url',
		level: 'error',
		desc: 'missing URL',
		regex: [
			/\[link:(\s*|\s+[^\]]+)\]/gi // https://regex101.com/r/EAWfre/1
		]
	}, {
		// ... can't really come up with something, this only returns 0-false and 1-pos
		// cleaned up the non-lint-regex from source: \*([\w"\-\(][\w \-\/\+\(\)=,\."]*[\w"\)]|\w)\*
		id: 'malformed-strong',
		level: 'warning',
		desc: 'malformed strong tag',
		regex: [
			/\*([^\w"\-\(])[\w \-\/\+\(\)=,\."]*[\w"\-\(]\*/gi // https://regex101.com/r/sT25f8/1/
		]
	}, {
		id: 'legal-example-name',
		level: 'error',
		desc: 'only alphanumeric and underscore allowed in example name',
		regex: [
			/\[example:\w*[^\w\s\]].*?\]/gi // https://regex101.com/r/hHXvoU/3
		]
	}, {
		id: 'invalid-name-or-title',
		level: 'error',
		desc: 'name or title contain illegal characters',
		regex: [
			/\[example:[^\s]+\w+\s+.*?[^\w:\/\.\-\s][^\s]*?\]/gi // https://regex101.com/r/EZizAs/2
		]
	}, {
		id: 'space-missing',
		level: 'codestyle',
		desc: 'space missing before/after parens',
		regex: [
			/\[(?:member|property|method):([\w]+) ([\w\.\s]+)\]\s*((\([^\s\)]+|\(\s.*\S\)))/gi // https://regex101.com/r/eLA1wk/1
		]
	}, {
		id: 'invalid-short-form',
		level: 'error',
		desc: 'only alphanumeric and underscore allowed in parameter short-form name',
		regex: [
			/\[param:\w*[^\w\s\]]\w*\]/gi // https://regex101.com/r/bcmleK/1
		]
	}, {
		id: 'invalid-param-name',
		level: 'error',
		desc: 'illegal character in parameter name',
		regex: [
			/\[param:[\w\.]*[^\w\s\]\.][\w\.]* [^\]]+\]/gi // https://regex101.com/r/ne6AI4/1
		]
	}, {
		id: 'property-in-prose',
		level: 'warning',
		desc: 'property tag in prose',
		regex: [
			/[^\-<h3>]+\s*\[property:/gi // https://regex101.com/r/KLdmHd/1
		]
	}
];

module.exports = DoobDoc;

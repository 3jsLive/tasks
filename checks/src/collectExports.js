const fs = require( 'fs' );
const path = require( 'path' );

const { Project } = require( 'ts-morph' );


/*

	Collect exports from Type-/JavaScript files

*/


module.exports = {
	getModulesTs, // get exports via src/Three.d.ts
	getModulesJs, // get exports via src/Three.js
	getModulesRx, // legacy method via RegExp
	getExamplesModulesTs, // get exports from examples/**/*.d.ts
	getExamplesModulesJs // get exports from examples/jsm/**/*.js
};


/**
 * Get exports via src/Three.d.ts
 * @param {string} basePath base path to three.js directory
 * @param {boolean} writeToFile
 */
function getModulesTs( basePath, writeToFile = false ) {

	const project = new Project( { compilerOptions: { removeComments: false } } );
	project.addExistingSourceFiles( path.join( basePath, 'src/**/*.d.ts' ) );
	const origin = project.getSourceFileOrThrow( path.join( basePath, 'src/Three.d.ts' ) );

	// FIXME: hack
	const class2file = [ ...origin.getExportedDeclarations().values() ].reduce( ( all, decl ) => {

		decl.forEach( d => {

			// skip it
			if ( d.getSourceFile().getFilePath().includes( 'polyfill' ) )
				return/*  all */;

			all[ d.getSymbolOrThrow().getEscapedName() ] = path.relative( basePath, d.getSourceFile().getFilePath() ).replace( '.d.ts', '' );
			// return all;

		} );

		return all;

	}, {} );

	if ( writeToFile )
		fs.writeFileSync( 'class2file-TS.json', JSON.stringify( class2file ), 'utf8' );

	return class2file;

}


/**
 * Get exports from examples/** *.d.ts
 * @param {string} basePath base path to three.js directory
 * @param {boolean} writeToFile
 */
function getExamplesModulesTs( basePath, writeToFile = false ) {

	const project = new Project( { compilerOptions: { removeComments: false } } );
	const files = project.addExistingSourceFiles( path.join( basePath, 'examples/**/*.d.ts' ) );

	if ( files.length === 0 )
		throw new Error( 'No .d.ts files found' );

	const class2file = files.reduce( ( result, file ) => {

		file.getExportedDeclarations().forEach( ( decl/* , name */ ) => {

			decl.forEach( d => {

				// skip those
				if ( d.getSourceFile().getFilePath().includes( '/jsm/libs/' ) )
					return;

				result[ d.getSymbolOrThrow().getEscapedName() ] = path.relative( basePath, d.getSourceFile().getFilePath() ).replace( '.d.ts', '' );

			} );

		} );

		return result;

	}, {} );

	if ( writeToFile )
		fs.writeFileSync( 'class2file-examples-TS.json', JSON.stringify( class2file ), 'utf8' );

	return class2file;

}


/**
 * Get exports from examples/jsm/** *.js
 * @param {string} basePath base path to three.js directory
 * @param {boolean} writeToFile
 */
function getExamplesModulesJs( basePath, writeToFile = false ) {

	const project = new Project( { compilerOptions: { removeComments: false, allowJs: true } } );
	const files = project.addExistingSourceFiles( path.join( basePath, 'examples/jsm/**/*.js' ) );

	if ( files.length === 0 )
		throw new Error( 'No .js files found' );

	const class2file = files.reduce( ( result, file ) => {

		file.getExportedDeclarations().forEach( ( decl/* , name */ ) => {

			decl.forEach( d => {

				// skip those
				if ( d.getSourceFile().getFilePath().includes( '/jsm/libs/' ) )
					return;

				result[ d.getSymbolOrThrow().getEscapedName() ] = path.relative( basePath, d.getSourceFile().getFilePath() ).replace( '.js', '' );

			} );

		} );

		return result;

	}, {} );

	if ( writeToFile )
		fs.writeFileSync( 'class2file-examples-JS.json', JSON.stringify( class2file ), 'utf8' );

	return class2file;

}


/**
 * Get exports via src/Three.js
 * @param {string} basePath base path to three.js directory
 * @param {boolean} writeToFile
 */
function getModulesJs( basePath, writeToFile = false ) {

	const project = new Project( { compilerOptions: { removeComments: false, allowJs: true } } );
	project.addExistingSourceFiles( path.join( basePath, 'src/**/*.js' ) );
	const origin = project.getSourceFileOrThrow( path.join( basePath, 'src/Three.js' ) );

	const class2file = {};
	origin.getExportedDeclarations().forEach( ( decls/* , name */ ) => {

		decls.forEach( decl => {

			const filepath = decl.getSourceFile().getFilePath();

			// skip it
			if ( filepath.includes( 'polyfill' ) )
				return;

			class2file[ /* decl.getName() */ decl.getSymbolOrThrow().getEscapedName() ] = path.relative( basePath, filepath ).replace( '.d.ts', '' );

		} );

	} );

	if ( writeToFile )
		fs.writeFileSync( 'class2file-JS.json', JSON.stringify( class2file ), 'utf8' );

	return class2file;

}


/**
 * Legacy method via RegExp, src/-only
 * @param {string} basePath base path to three.js directory
 * @param {boolean} writeToFile
 */
function getModulesRx( basePath, writeToFile = false ) {

	const regex = /export (?:abstract )?(?:const|class|var|enum|namespace|let) (.*?)(?: ?(?:<|:|=).*?)? /gm;

	let class2file = {};

	const project = new Project( { compilerOptions: { removeComments: false } } );
	const files = project.addExistingSourceFiles( path.join( basePath, 'src/**/*.d.ts' ) );

	for ( const file of files ) {

		const content = fs.readFileSync( file.getFilePath(), 'utf8' );

		const relative = path.relative( basePath, file.getFilePath() );

		let m = regex.exec( content );
		while ( m !== null ) {

			m.forEach( ( match, groupIndex ) => {

				if ( groupIndex > 0 )
					class2file[ match ] = relative.replace( /\.d\.ts$/, '' );

			} );

			m = regex.exec( content );

		}

	}

	if ( writeToFile )
		fs.writeFileSync( 'class2file-Rx.json', JSON.stringify( class2file ), 'utf8' );

	return class2file;

}

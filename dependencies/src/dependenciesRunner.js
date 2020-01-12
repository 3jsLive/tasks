const fs = require( 'fs' );
const path = require( 'path' );
const acorn = require( 'acorn' );
const walk = require( 'acorn-walk' );
const Promise = require( 'bluebird' );
const puppeteer = require( 'puppeteer' );
const signale = require( 'signale' );
const stringify = require( 'json-stable-stringify' );

const config = require( 'rc' )( 'dependencies' );

const DependenciesWorker = require( './dependenciesWorker' );


class DependenciesRunner {

	/**
	 * @param {string} resultsBase Where to save the results
	 * @param {string} threejsBase Path to threejs git repository
	 * @param {string} threejsBuildFile Path of the used threejs build file, relative to threejsBase
	 * @param {string} urlBase Host and port of all URLs
	 * @param {string[]} puppeteerOptions Array of additional options for puppeteer
	 */
	constructor( resultsBase, threejsBase, threejsBuildFile, urlBase, puppeteerOptions = [] ) {

		this.resultsBase = resultsBase;
		this.threejsBase = threejsBase;
		this.threejsBuildFile = threejsBuildFile;
		this.urlBase = urlBase;
		this.puppeteerOptions = [ ...config.dependencies.puppeteerOptions, ...puppeteerOptions ];

		this.workload = [];
		this.currentIndex = 0;

		this.browser = null;
		this.worker = null;

		// same for all workers
		this.shaderLibs = {};
		this.shaderChunks = {};
		this.uniformsLibs = {};

		// *could* be adjusted for each worker, but for now they're fixed
		this.timeout = config.dependencies.networkidle.timeout;
		this.maxInflightRequests = config.dependencies.networkidle.maxInflightRequests;

		this.logger = signale.scope( 'Runner' );
		this.logger.config( { displayTimestamp: true } );

		this.prepareShadersAndUniforms();

	}


	loadUrls( workload ) {

		this.workload = workload.slice();

	}


	run() {

		return this.startBrowser()
			.then( () => this.launch() );

	}


	get currentUrl() {

		return this.workload[ this.currentIndex ];

	}


	get crudelyEscapedUrl() {

		return this.currentUrl.replace( this.urlBase, '' ).replace( /\/+/g, '_' ).replace( '.html', '.json' );

	}


	prepareThree() {

		const threeFile = path.join( this.threejsBase, this.threejsBuildFile );

		this.logger.debug( `Preparing script at ${threeFile}` );

		// modified (reduced), org. version by paul irish
		// TODO: do we still need this? ES6 should be fine by now
		const trackShaderCode = `var trackShaderShim = function (obj, propertyName, trackingCode, category ) {

	// this is directly from https://github.com/paulmillr/es6-shim
	function getPropertyDescriptor(obj, name) {
		var property = Object.getOwnPropertyDescriptor(obj, name);
		var proto = Object.getPrototypeOf(obj);
		while (property === undefined && proto !== null) {
			property = Object.getOwnPropertyDescriptor(proto, name);
			proto = Object.getPrototypeOf(proto);
		}
		return property;
	}

	var originalProperty = getPropertyDescriptor(obj, propertyName);
	var newProperty = { enumerable: originalProperty.enumerable };

	// read
	newProperty.get = function(val) {
		// console.log( { category } );
		if ( category === 'ShaderChunk' )
			window.trackShaderChunk( trackingCode );
		else if ( category === 'ShaderLib' )
			window.trackShaderLib( propertyName, trackingCode );
		// else
			// window.trackSomething( propertyName, trackingCode );

		return originalProperty.get ? originalProperty.get.call(this, val) : originalProperty.value;
	}

	Object.defineProperty(obj, propertyName, newProperty);

};`;

		const epilogue = `for ( const chunkName in ShaderChunk )
		trackShaderShim(ShaderChunk, chunkName, chunkName, "ShaderChunk" )

	for ( const libName in ShaderLib ) {
		trackShaderShim(ShaderLib[ libName ], "fragmentShader", libName, "ShaderLib" );
		trackShaderShim(ShaderLib[ libName ], "vertexShader", libName, "ShaderLib" );
	}

	for ( const uniformName in UniformsLib ) {
		for ( const subName in UniformsLib[ uniformName ] ) {
			trackShaderShim( UniformsLib[ uniformName ], subName, uniformName + '.' + subName, "UniformsLib" );
		}
	}

	// trackShaderShim( Vector3.prototype, 'set', 'Vec3', 'Vec3' );

	window.RENDERER = WebGLRenderer.prototype;
	window.VECTOR3 = Vector3.prototype;
	window.VECS = 0;

	debugger;`; // trigger a Debugger.paused event right after parsing


		// FIXME: the simple heuristic in these doesn't always match reality, needs something smarter
		// maybe: use the AST to find out which lines define e.g. depth_frag in ShaderChunk/ShaderLib and
		// take them as locatedCodeDependency?
		// TODO: add the same thing for uniforms, make it locatedCodeDependency

		return Promise.all( [
			// fs.promises.readFile( __dirname + '/seedrandom.min.js', 'utf8' ), // determinism
			// fs.promises.readFile( __dirname + '/timekeeper.min.js', 'utf8' ), // determinism
			fs.promises.readFile( threeFile, 'utf8' ),
			Promise.resolve( trackShaderCode ), // inject shaders-/uniforms-tracking code
			Promise.resolve( epilogue )
		] )
			.then( codes => {

				return codes.join( '\n' );

			} );

	}


	async startBrowser() {

		this.logger.debug( 'Starting browser...' );

		this.browser = await puppeteer.launch(
			{
				headless: false,
				devtools: false,
				dumpio: true,
				args: this.puppeteerOptions
			}
		);

	}


	async createPage() {

		this.logger.debug( 'Creating page...' );

		return await this.browser.newPage();

	}


	launch() {

		this.logger.debug( 'Launching...' );

		return this.prepareThree()
			.then( modifiedThree => {

				return Promise.mapSeries( this.workload, ( url, index ) => {

					this.logger.info( `${index + 1}/${this.workload.length} ${url}` );

					this.currentIndex = index;

					return this.createPage()
						.then( page => {

							this.worker = new DependenciesWorker(
								page,
								url,
								path.join( this.threejsBase, this.threejsBuildFile ),
								modifiedThree,
								this.shaderLibs,
								this.shaderChunks,
								this.uniformsLibs
							);

							return Promise.all( [
								fs.promises.readFile( __dirname + '/seedrandom.min.js', 'utf8' ),
								fs.promises.readFile( __dirname + '/timekeeper.min.js', 'utf8' )
							] )
								.then( consistencyShims => page.evaluateOnNewDocument( consistencyShims.join( '\n' ) ) )
								.then( () => this.worker.setupPage() )
								.then( () => this.worker.setupCDPClient() )
								.then( () => this.worker.run() )
								.catch( err => this.logger.error( 'Worker failed to start', err ) );

						} )
						.then( result => {

							// TODO: save results early?

							return this.worker.tearDownPage()
								.catch( err => this.logger.error( 'page.close failed:', err ) )
								.then( () => delete this.worker )
								.then( () => result );

						} );

				} ).then( results => {

					this.logger.debug( 'No more URLs left' );

					this.logger.info( 'Saving...' );

					return Promise.mapSeries( results, ( r, idx ) => {

						return Promise.mapSeries( Object.keys( r ), key => {

							const escaped = this.workload[ idx ].replace( this.urlBase, '' ).replace( /\/+/g, '_' ).replace( /^_+/, '' ).replace( '.html', `_${key}.json` );

							this.logger.log( `Saving ${path.join( this.resultsBase, escaped )}...` );

							return fs.promises.writeFile( path.join( this.resultsBase, escaped ), stringify( r[ key ] ), 'utf8' );

						} );

					} )
						.then( () => {

							this.logger.debug( 'Closing browser...' );

							return this.browser.close();

						} )
						.catch( err => this.logger.fatal( err ) );

				} ).then( () => {

					this.logger.info( 'Done' );

					return true;

				} );

			} )

			.catch( err => this.logger.error( "Launch error >", err ) );

	}


	prepareShadersAndUniforms() {

		// Process the Shader Chunks
		// https://astexplorer.net/#/gist/7697e565ae9610ea0f8386d2453e7763/ad16240d2b8781c2b7c8f6bf7dbb278ffefe1ab1
		const shaderChunkSource = fs.readFileSync( path.join( config.dependencies.fileBase, config.dependencies.shaderChunkPath ), 'utf8' );
		const shaderChunkAst = acorn.parse( shaderChunkSource, { locations: true, sourceType: 'module' } );

		if ( ! shaderChunkAst ) {

			this.logger.error( `Couldn't create shaderChunkAst, aborting...` );
			process.exit( - 1 ); // FIXME:

		}

		this.shaderChunks = shaderChunkAst.body.reduce( this.processShaderChunkAst, {} );

		// Process the Uniforms Library
		// https://astexplorer.net/#/gist/efab601013915b58740f6758f71dd226/8856d4eb8dc33cd5d280f12dbfc8a6ecd0d98e25
		const uniformsLibSource = fs.readFileSync( path.join( config.dependencies.fileBase, config.dependencies.uniformsLibPath ), 'utf8' );
		const uniformsLibAst = acorn.parse( uniformsLibSource, { locations: true, sourceType: 'module' } );
		const uniformsLibNode = walk.findNodeAt( uniformsLibAst, null, null, ( nodeType, node ) => {

			return nodeType === 'VariableDeclarator' && node.id.name === 'UniformsLib' && node.init.type === 'ObjectExpression';

		} );

		if ( ! uniformsLibNode ) {

			this.logger.error( `Couldn't find uniformsLibNode, aborting...` );
			process.exit( - 1 ); // FIXME:

		}

		this.uniformsLibs = uniformsLibNode.node.init.properties.reduce( this.processUniformsLibNodeProperties, {} );

		// Process the Shader Library
		this.loadShaderLibrary( path.join( config.dependencies.fileBase, config.dependencies.shaderLibPath ) );

	}


	addPropertiesToShader( shaderOrg, properties ) {

		let shader = JSON.parse( stringify( shaderOrg ) );

		for ( const prop of properties ) {

			const key = prop.key;
			const value = prop.value;

			if ( key.name === 'vertexShader' || key.name === 'fragmentShader' ) {

				if ( value.type === 'MemberExpression' ) {

					shader[ key.name ].group = value.object.name;
					shader[ key.name ].name = value.property.name;

				} else {

					this.logger.debug( `Unknown prop.value.type(shaders): ${value}` );

				}

			} else if ( key.name === 'uniforms' ) {

				if ( value.type === 'CallExpression' ) {

					shader.uniformsRefs = value.arguments[ 0 ].elements.reduce( ( all, element ) => {

						if ( element.type === 'MemberExpression' )
							/*
								All ShaderLibs entries look like 'UniformsUtils.merge( [ UniformsLib.lights, UniformsLib.fog, ... ] )'
								except for ShaderLib.physical since it references a previous ShaderLib entry (ShaderLib.standard.uniforms)
								it looks like 'UniformsUtils.merge( [ ShaderLib.standard.uniforms, ... ] )'.
								Hence the distinction between element.object.type being an Identifier ("Uniformslib") or an MemberExpression
								in and of itself ("ShaderLib.standard").
								This should be handled less hacky, but it ought to be enough for now.
							*/
							if ( element.object.type === 'MemberExpression' )
								all.push( ...this.shaderLibs[ 'standard' ].uniformsRefs ); // HACK
							else
								all.push( element.property.name );

						return all;

					}, [] );

				} else if ( value.type === 'ObjectExpression' ) {

					this.logger.debug( `Uniforms ObjectExpression, note sourceLocation and skip` );
					// console.log( util.inspect( value, false, 4, true ) );

				} else {

					this.logger.debug( `> Unknown prop.value.type(uniforms): ${value}` );

				}

			} else {

				this.logger.debug( `> Unknown prop.key.name: ${key.name}` );

			}

		}

		return shader;

	}


	linkUpShader( shaderOrg ) {

		let shader = JSON.parse( stringify( shaderOrg ) );

		//
		// connect the shader to its respective chunks and uniforms
		//
		if ( shader.vertexShader.group === 'ShaderChunk' )
			shader.vertexShader.linked = this.shaderChunks[ shader.vertexShader.name ];
		else
			this.logger.error( `> Unknown vertexShader.group for '${shader.name}': ${shader.vertexShader.group}` );

		if ( shader.fragmentShader.group === 'ShaderChunk' )
			shader.fragmentShader.linked = this.shaderChunks[ shader.fragmentShader.name ];
		else
			this.logger.error( `> Unknown fragmentShader.group for '${shader.name}': ${shader.fragmentShader.group}` );


		//
		// normalize the uniforms references, sometimes they're an array and sometimes a string
		//
		if ( shader.uniformsRefs.length > 0 ) {

			shader.uniformsRefs = shader.uniformsRefs.map( u => {

				if ( typeof u === 'string' )
					return this.uniformsLibs[ u ];
				else
					return u;

			} );

		}

		return shader;

	}


	loadShaderLibrary( shaderLibFile ) {

		// https://astexplorer.net/#/gist/4a71649e75a2fd96dd03c4a3756a2a09/9061de91b9c03236f2ec53384142bf5414c94c4b
		const shaderLibSource = fs.readFileSync( shaderLibFile, 'utf8' );
		const shaderLibAst = acorn.parse( shaderLibSource, { locations: true, sourceType: 'module' } );
		const shaderLibNode = walk.findNodeAt( shaderLibAst, null, null, ( nodeType, node ) => {

			return nodeType === 'VariableDeclarator' && node.id.name === 'ShaderLib' && node.init.type === 'ObjectExpression';

		} );

		if ( ! shaderLibNode ) {

			this.logger.error( `Couldn't find shaderLibNode, aborting...` );
			process.exit( - 1 ); // FIXME:

		}

		for ( const entry of shaderLibNode.node.init.properties ) {

			let shader = this.processShaderLibName( entry );
			shader = this.addPropertiesToShader( shader, entry.value.properties );
			shader = this.linkUpShader( shader );

			this.shaderLibs[ shader.name ] = shader;

		}


		//
		// PhysicalNode is listed seperately in the source file because it references an earlier ShaderLib entry (standard)
		//
		const shaderPhysicalNode = walk.findNodeAt( shaderLibAst, null, null, ( nodeType, node ) => {

			return nodeType === 'AssignmentExpression' && node.left.object.name === 'ShaderLib' && node.left.property.name === 'physical';

		} );

		if ( ! shaderPhysicalNode ) {

			this.logger.error( `Couldn't find shaderPhysicalNode, aborting...` );
			process.exit( - 1 ); // FIXME:

		}

		// we can't use processShaderLibName here
		let shader = {
			name: "physical",
			vertexShader: { group: undefined, name: undefined, linked: undefined },
			fragmentShader: { group: undefined, name: undefined, linked: undefined },
			uniformsRefs: [],
			start: shaderPhysicalNode.node.loc.start,
			end: shaderPhysicalNode.node.loc.end
		};

		shader = this.addPropertiesToShader( shader, shaderPhysicalNode.node.right.properties );

		shader = this.linkUpShader( shader );

		this.shaderLibs[ shader.name ] = shader;

	}


	processShaderLibName( entry ) {

		const shader = {
			name: entry.key.name,
			vertexShader: { group: undefined, name: undefined, linked: undefined },
			fragmentShader: { group: undefined, name: undefined, linked: undefined },
			uniformsRefs: [],
			start: entry.loc.start,
			end: entry.loc.end
		};

		return shader;

	}


	processShaderChunkAst( all, child ) {

		if ( child.type !== 'ImportDeclaration' )
			return all;

		if ( child.specifiers.length > 1 ) {

			this.logger.error( `Too many specifiers in chunksFile (${child.specifiers.length}), aborting...` );
			process.exit( - 1 ); // FIXME:

		}

		const name = child.specifiers[ 0 ].local.name;

		all[ name ] = {
			name: name,
			source: child.source.value,
			start: child.loc.start,
			end: child.loc.end

		};

		return all;

	}


	processUniformsLibNodeProperties( all, property ) {

		const uniform = {
			name: property.key.name,
			start: property.loc.start,
			end: property.loc.end
		};

		all[ uniform.name ] = uniform;

		return all;

	}

}

module.exports = DependenciesRunner;

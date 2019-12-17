foo = require('.')
parsed = foo.parseDoc.parseFile('test/fixtures/BufferGeometry.html')
fs.writeFileSync('test/fixtures/BufferGeometry_AST.json', JSON.stringify(parsed), 'utf8')
parsed.map( x => x.type )
types = parsed.map( x => x.type ).filter( ( x, i, arr ) => arr.indexOf( x ) === i )
types = parsed.map( x => x.type ).filter( ( x, i, arr ) => arr.indexOf( x ) === i && x.endsWith( 'Tag' ) )
types = parsed.map( x => x.type ).filter( ( x, i, arr ) => arr.indexOf( x ) === i && x !== 'Text' )
for ( const type of types ) { filtered = parsed.filter( x => x.type === type ); fs.writeFileSync( 'test/fixtures/BufferGeometry_'+type+'.json', JSON.stringify( filtered ), 'utf8' ); }

/*
	Comment here
	multiline
	last one
*/
function Foo( ) {

	Foo.function1();
	Foo.renamed();
	Foo.added1();
	Foo.added2();
	Foo.added3();

}

Object.assign( Foo.prototype, {

	method1: function ( a, b ) {

		method1_call1();
		method1_call2();
		method1_call3();

	},

	method2: function () {

		method2_call1();
		method2_call2();

	},

	method3: function () {

		method3_call1();	// inline comment

	}

} );

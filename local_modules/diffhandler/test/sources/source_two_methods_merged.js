/*
	Comment here
	multiline
	last one
*/
function Foo( ) {

	Foo.function1();
	Foo.function2();

}

Object.assign( Foo.prototype, {

	method1: function ( a, b ) {

		method1_call1();
		method1_call2();
		method1_call3();
		method2_call1();
		method2_call2();

	},

	method3: function () {

		method3_call1();	// inline comment

	}

} );

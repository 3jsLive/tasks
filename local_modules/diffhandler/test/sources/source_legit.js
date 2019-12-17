function Foo( x, y, z ) {

	this._x = x || 0;
	this._y = y || 0;
	this._z = z || 0;

}

Object.assign( Foo, {

	slerp: function ( qa, qb, qm, t ) {

		return qm.copy( qa ).slerp( qb, t );

	}

} );

Object.assign( Foo.prototype, {

	isFoo: true,

	set: function ( x, y, z, w ) {

		this._x = x;
		this._y = y;
		this._z = z;
		this._w = w;

		this.onChangeCallback();

		return this;

	},

	clone: function () {

		return new this.constructor( this._x, this._y, this._z, this._w );

	},

	update: ( function () {

                var identityMatrix = new Matrix4();

                return function update() {

                        var bones = this.bones;

                };

        } )()
} );

export { Foo };

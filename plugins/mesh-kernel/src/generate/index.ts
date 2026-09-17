/**
 * Generators: the operations that make geometry rather than edit it.
 *
 * All ported from Blender - `bmo_primitive.cc` for the primitives, `bmo_utils.cc` for spin,
 * `curve_to_mesh_convert.cc` and `curve_poly.cc` for the sweep, `MOD_array.cc` for the array and
 * `bmo_mirror.cc` for the mirror. The lathe and the torus are compositions of spin over a wire
 * profile, which is how Blender's own Screw modifier and torus add-on build them.
 *
 * These four - lathe, sweep, array, primitives - are what a vehicle is actually made of. See
 * `issues/open/modelling-tools/03-agent-modelling-api.md`.
 */

export * from './primitives'
export * from './spin'
export * from './lathe'
export * from './sweep'
export * from './array'
export * from './mirror'

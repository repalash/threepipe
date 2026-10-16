# `array {path}`: curve frames are Blender's Z-up, so copies flip in a Y-up scene

Found building `demos/haussmann/build.mjs` (balcony railings along the building outline).

## Repro

```js
// A 12 cm railing module standing on y = 0, 1 m tall (Y is up in threepipe).
await run({op: 'primitive', type: 'cube', name: 'm', width: 0.12, height: 1, depth: 0.04, position: [0.06, 0.5, 0]})
await run({op: 'applyTransform', object: 'm'})
// A path on the ground plane, first segment towards -x.
await run({op: 'array', object: 'm', path: [[6, 0, 2], [0, 0, 2], [-1, 0, 1], [-1, 0, -4]], count: 60, live: true})
await run({op: 'measure', object: 'm', mode: 'bounds'})
// y runs -1 .. -0.085: every copy is upside down.
```

The same module on a path whose first segment runs towards +x (`[[0,0,0],[6,0,0],[6,0,-6],...]`) comes
out upright (y 0..1). Whether the copies are flipped depends on which way the path starts.

## Why

`arrayCurve` (`plugins/mesh-kernel/src/generate/array.ts`) is a faithful port of Blender's
curve deform: the first frame comes from `vec_to_quat(dir, -Z, Y)` (`curve.cc`
`make_bevel_list_3D_minimum_twist`), i.e. Blender's Z-up convention. In Blender a path drawn on the
ground lies in XY and the frames keep Z up. In threepipe the ground is XZ, so the same path is, to
the port, a curve in a vertical plane, and the roll it picks is not "up".

## Expected (Blender)

Drawing a curve on the ground and putting an Array + Curve pair on an upright object keeps the
object upright all the way round, whichever way the curve starts.

## Workaround used

Model the module Z-up, give the path as `[x, -z, y]`, and rotate the arrayed object by -90° about X.
That is the Y-up/Z-up axis swap done by hand (`demos/haussmann/build.mjs`, `railingMaster`).

## Suggested fix (needs a decision)

Do the swap at the command layer: convert path and geometry to Blender axes (`x, -z, y`) before
`arrayCurve` and back after, so the kernel stays a literal port and the command means what a Blender
user expects. `sweep {normalMode: 'zUp'}` has the same question (see
`command-sweep-profile-orientation.md`).

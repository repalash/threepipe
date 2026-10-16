# Undo/redo snapshots store rotation as Euler angles, so a restored object is not bit-exact

**Status: fixed on `demo-edit-chain` (f58e33b)**: `EntrySnapshot.quaternion` replaces `rotation`
(Euler) and is restored with `quaternion.fromArray`. Test: `plugins/modelling/tests/undo-fidelity.test.ts`
(radial `array {into: 'objects'}` undo/redo, and undo/redo of an object rotation, both bit-exact).

**Found by**: edit-chain harness, step `array-03` (`array {into: 'objects', angle}`): "redo does not
restore the post-step document: link-r: transform differs".
**Severity**: low geometrically, but it breaks exact replay: a redo (or an undo that revives an object)
does not reproduce the document it recorded.

## Repro

```js
await run({op: 'primitive', type: 'cube', name: 'link', position: [2, 0, -2]})
await run({op: 'array', object: 'link', count: 3, angle: Math.PI * 2, pivot: [2, 0, -1], into: 'objects', name: 'link-r'})
// link-r.quaternion = [0, 0.8660254037844389, 0, 0.5]
await run({op: 'undo'})
await run({op: 'redo'})
// link-r.quaternion = [-8.4e-17, -0.8660254037844385, -8.4e-17, -0.5000000000000002]
```

The same rotation (`q` and `-q`), with noise in the last bits and the sign flipped - so anything that
compares or serialises the transform (a document hash, an exported glTF, a determinism check) sees a
different document after redo. Measured with three.js's own conversions in
`tmp/edit-chain/euler-probe.mjs`: 120° and 240° about Y come back negated with ~1e-16 error; 37° comes
back with ~1e-16 error; 90° is exact.

## Cause

`ModellingDocument.snapshot` (`plugins/modelling/src/document.ts`) records
`rotation: [o.rotation.x, o.rotation.y, o.rotation.z]`, and `_applyTransform` restores with
`o.rotation.set(...)`. The object's rotation is set through its quaternion (`transformObject` decomposes
a matrix), so a snapshot goes quaternion → Euler → quaternion, which is not an identity in floating
point (and picks the other hemisphere near ±180°).

## Expected

Blender's undo restores the stored datablock values, so redo is exact. Store `o.quaternion.toArray()`
(and restore it with `quaternion.fromArray`) - the quaternion is the value that was set.

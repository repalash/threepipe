# `reference {name, visible}` moved the plane to `front` (fixed on `demo-camera`)

Found building the camera demo: after hiding and showing the references, `camera {view: "ref:back"}`
framed the model from the **front**, and `ref:lens` (a `right` plane) looked down Z at a sliver of
the model. The transcript showed every reference reporting `plane: "front"` after the first
visibility toggle.

## Repro

```js
await run({op: 'reference', name: 'back', plane: 'back', image: '/rear.jpg', width: 150})
await run({op: 'reference', name: 'back', visible: false})   // result: plane "front"
await run({op: 'reference', name: 'back', visible: true})
await run({op: 'camera', projection: 'orthographic', view: 'ref:back'})
// camera at +Z looking -Z: the model's front, with the rear photo over it
```

## Cause

`commands/reference.ts` took `const planeName = p.plane ?? 'front'` before looking the reference
up, so any update that did not repeat `plane` re-oriented the plane to `front` (normal +Z) and the
registered view followed it.

## Fix

`referenceTarget()` resolves the name first and takes the plane from the existing reference when the
command gives none; only an explicit `plane` moves it. Test: `plugins/modelling/tests/reference-target.test.ts`.
(Blender equivalent: changing an image empty's visibility does not touch its transform.)

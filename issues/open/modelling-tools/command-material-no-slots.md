# One material per object: no material slots, so a recess and its glass must be separate objects

Found building the camera demo. The monitor recess is cut into the body with `bisect` + `inset`, and
the glass that fills it should be a different material (glossy black) on the inset face. `material`
sets one material on the whole object, and nothing assigns a material index to faces - so the glass
became a separate `lcd-screen` object, as did the top LCD and the eyepiece glass. The kernel already
carries `BMFace.matNr` and `bevel` has a `materialIndex` parameter, so the data model has slots; the
command surface does not.

## Repro

```js
await run({op: 'primitive', type: 'cube', name: 'c', size: 1})
const top = /* index of the +Y face from inspect detail */ 4
await run({op: 'inset', object: 'c', faces: [top], thickness: 0.1, depth: -0.05})
// No way to give the inset face a second material.
```

## Expected (Blender)

Material slots on the object (`object.material_slot_add`) and `object.material_slot_assign` for the
selected faces, which writes `material_index` per face (`BKE_mesh` `material_index` attribute). A
`material {object, slot, faces, ...}` form, with the glTF export splitting primitives by material
index, would match.

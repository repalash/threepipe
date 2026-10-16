# `primitive` could not generate UVs (fixed: `uvs` option) - its default differs from Blender's

**Found by**: edit-chain harness. No command could create a UV layer, so the per-step check that UVs
outside an edit are preserved (survey §3.4: attribute preservation is the scored quantity) had nothing
to check.
**Status**: fixed on `demo-edit-chain` - `primitive {uvs: true}` passes `calcUVs` to the kernel's ports
of `BM_mesh_calc_uvs_grid/_cube/_circle/_cone/_sphere` and the icosphere's `icouvs`
(`plugins/mesh-kernel/src/generate/primitives.ts`), with `plugins/modelling/src/commands/create.test.ts`.
`torus` with `uvs` is rejected: Blender's torus is the Python `add_mesh_torus` operator and its UV
layout is not ported.

## Still open: the default

Blender's add-primitive operators default "Generate UVs" (`calc_uvs`) **on**. Here it is opt-in, so
existing build scripts produce the same meshes they always did (no new corner layer in their exports
and captures). Decide whether to flip the default to Blender's - it changes every primitive-based build's
output - and port `add_mesh_torus`'s UVs either way.

With `uvs: true` on the chain's primitives, the corner `uv` layer is carried through every main-chain
step (inset, extrude, subdivide, bevel, bisect, grid fill, mirror, dissolve, F) and the locality check
compares it on every untouched face; it also survives the glb export → re-import round trip exactly.

# Edge / vertex slide: `correct_uv` is not ported

**Found by**: track L (loop tools), porting edge and vertex slide, 2026-10-03.

## What

Blender's slide operators have `correct_uv` (on by default for slides through the tool setting
`UVCALC_TRANSFORM_CORRECT_SLIDE`, `transform.cc:613`): while the vertices slide, the face corners
around them are re-interpolated from the faces as they were (`mesh_customdatacorrect_*`,
`transform_convert_mesh.cc:53-720`, applied from `recalcData_mesh`), so UVs and other corner data
follow the surface instead of stretching.

`plugins/mesh-edit/src/transform/slide.ts` moves the vertices only. A mesh with a UV layer
(`uvLayerEnsure`, the primitives with `calcUVs`) keeps its corner UVs, so a texture stretches across
a slid loop where Blender's would not.

## Fix

Port `mesh_customdatacorrect_create` / `_apply` / `_restore` into the transform (it applies to every
mesh transform mode when `correct_uv` is set, not only the slides), on top of the kernel's
`bmesh/interp.ts` (`BM_loop_interp_from_face` and friends), with the `correct_uv` property on the
slide operators' redo panels. Needs a UV parity fixture from Blender.

# No Shade Smooth / Shade Flat

Found by the `house-walkthrough` demo, 2026-10-16. Rank: **minor** for a low-poly house, **major** for
anything round (a cylinder or a subdivided shape shows its facets and there is no obvious way to
smooth them).

## What a newcomer tries

- Blender: right-click > Shade Smooth / Shade Flat / Shade Auto Smooth in object mode
  (`VIEW3D_MT_object_context_menu`), Face > Shade Smooth / Flat in edit mode (`VIEW3D_MT_edit_mesh_faces`).
- Figma/Spline-like tools: a smoothing toggle or angle in the object's properties.

## What happens

F3 "smooth" finds nothing that smooths shading (the demo records the palette results in
`demos/house-walkthrough/run-*.json`, step `shade-smooth`). The capability exists as the modelling
command `material` with `shading: 'auto' | 'flat' | 'smooth'` (`plugins/modelling/src/commands/scene.ts:53-56`,
`:82`), surfaced as an object-mode operator labelled just "Material"
(`plugins/editor-engine/src/ops/modellingOps.ts:60`), where nobody would look for it.

## Suggested fix

`object.shade_smooth`, `object.shade_flat`, `object.shade_auto_smooth` operators over that command,
in the Object menu and the object context menu, and the face-level variants in edit mode once per-face
smooth flags exist.

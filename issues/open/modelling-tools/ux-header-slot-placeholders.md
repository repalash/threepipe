# Pivot, orientation, snapping and proportional popovers are still placeholders

Found by the `house-walkthrough` demo, 2026-10-16. Rank: **major** (snapping and pivot are the
first things a Figma or Tinkercad user looks for; the engine has them, the UI does not).

## What happens

The four header buttons next to the shading toggles open a popover that says "Arrives with the
interaction engine (P1). The shell slot is ready." (`plugins/modelling-editor/src/ui/Header.tsx:138`,
the slots at `:151-154`). P1 has been merged since 2026-10-03: `MeshEditPlugin` has pivot points,
orientations, snapping (increment, grid, vertex, edge, face) and proportional editing
(`plugins/mesh-edit/src/transform/pivot.ts`, `orientation.ts`, `snap/`, `transform/proportional.ts`), but
the only way to reach them is Ctrl during a transform (snap toggle) or the redo panel after one.

## Expected

Blender's header: Transform Pivot Point, Transform Orientation, Snap (magnet + target menu), Proportional
Editing (`VIEW3D_HT_header` in `space_view3d.py`). Figma/Tinkercad: snapping and grid are on by default and
visible as a toggle.

## Suggested fix

Mount the real popovers: enums for pivot and orientation, the snap toggle + targets + increment, the
proportional toggle + falloff + size, bound to the `MeshEditPlugin` settings, each with its Blender key
(`.`, `,`, Shift+Tab, `O`).

# Blender users press Z for "up"; the editor's up axis is Y

Found by the `house-walkthrough` demo, 2026-10-16. Rank: **major** for the Blender preset (muscle
memory from every tutorial: `G Z 1`, `E Z`, `S Z 0`), a design decision to make, not a bug.

## What happens

The world is three.js Y-up. In the transform modal the axis keys map to the world axes as named
(`plugins/mesh-edit/src/transform/keymap.ts:47-53`), so `G Z 0.7` moves the selection towards the
viewer instead of up; `G Y 0.7` lifts it. The view gizmo does show Y on top, and the status strip says
`X / Y / Z Lock axis`, so it is discoverable, but every Blender tutorial says Z.

## Options (maintainer decision)

1. Keep Y-up and say so where it matters: the transform header could name the axis by direction
   ("along Y (up)"), and the Blender preset's welcome card could mention it.
2. A Blender-preset option that swaps the Y and Z axis keys in the transform, knife and gizmo labels
   (Blender files are Z-up; glTF is Y-up, so the data stays Y-up).

The demo uses `G Y` / `E Y` and a title card noting it.

# The start cube is 1 m; Blender's is 2 m

Found by the `house-walkthrough` demo, 2026-10-16. Rank: **minor** (only matters to people following a
Blender tutorial's numbers).

## What happens

`add.cube` creates a 1 x 1 x 1 cube (bounds -0.5..0.5). Every Blender tutorial starts from the 2 m
default cube (`primitive_cube_add`, `size=2.0`), so "S Z 0.5 then E 1" style instructions give different
proportions here, and typed values have to be halved.

## Suggested fix

Either default `add.cube` (and the start scene) to size 2 in the Blender preset, as Blender does, or
leave 1 m (glTF/three.js norms) and show the size in the redo panel so the difference is visible; the
panel already exposes it for Add Cube.

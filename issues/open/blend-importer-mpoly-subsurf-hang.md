# Pre-3.6 `.blend` files with Subsurf fail to load after the modifier stack landed

**Status**: fixed on `fix/blend-importer-mpoly-triangulation` (off `blend-importer-modifiers`).

## Report

`tmp/bugatti/bugatti.blend` (Blender 2.7x, 171 MB) loads on released 0.5.1 and "cannot load" on
`dev` + `blend-importer-modifiers`. Handed over from the three.js-upgrade session.

## What was actually happening

Measured on the Mac GPU browser and reproduced in Node with each branch's own loader code:

| | load | triangles | outcome |
| --- | --- | --- | --- |
| 0.5.1 | 3.7 s | 5,694,639 | loads, with holes |
| dev + modifiers | ~80 s | — | import fails, `load()` resolves empty |
| fix, Node | 27.6 s | 12,336,074 | all 446 objects, 0 modifier errors |

Four defects stacked:

1. **`createBufferGeometryOld` triangulated `MPoly` faces wrongly — present in 0.5.1 too.** It sized
   buffers as `floor(totloop * 3 / 2)` and walked a step-2 strip. A triangle reserved 4 slots and used
   3, so the index ended in unused zeros and was usually not a whole number of triangles; every face
   of 5+ corners lost the triangles the strip did not touch. 0.5.1 rendered bugatti ~389k triangles
   short.
2. **Subsurf read that index three at a time and walked off the end** —
   `TypeError: Cannot read properties of undefined (reading 'add')` in `subdivideOnce`.
3. **One failing mesh failed the whole file**, and `AssetImporter` reports that as a resolved, empty
   load — so it looked like a hang, not an error.
4. **Pre-3.6 files had no Catmull-Clark cage**, so Subsurf fell back to Loop on the per-corner buffer.
   Every triangle there is disconnected, so Loop cannot smooth anything — 4x the triangles, no change
   in shape — and every vertex is a boundary vertex, which made the per-vertex edge scan
   O(boundary verts x edges). That is what was still running after minutes.

## Fix

1. Fan triangulation with exact `n - 2` sizing. Triangles and quads are unchanged; n-gons are filled.
2. `subdivideGeometry` rejects a non-triangle index with a message that says so.
3. Each modifier runs in isolation; a failure is reported and the geometry from before it is kept,
   the way Blender continues past a modifier that errors.
4. The `MPoly` path builds the same `__cage` the 3.6-4.x path does, so pre-3.6 files get real
   Catmull-Clark. The boundary pass is one sweep over the edges; output is bit-identical.

Regression tests in `plugins/blend-importer/tests/mpoly-triangulation.test.ts`, each checked to fail
against the code it guards.

## Still open: which subdivision level to evaluate

Subsurf is evaluated at `renderLevels`. bugatti's 173 Subsurf modifiers are all `levels: 0`,
`renderLevels: 2` — the author chose no subdivision for interactive display — so the import does
4x the work 0.5.1 did and produces 12.3M triangles where Blender's own viewport shows 6.1M.

Blender picks per evaluation mode, `levels = use_render_params ? renderLevels : levels`
(`MOD_subsurf.cc:86`), and its exporters default to the viewport (`IO_wavefront_obj.hh:53`,
`export_eval_mode = DAG_EVAL_VIEWPORT`). A real-time viewer is the viewport case. Proposed as a
separate change.

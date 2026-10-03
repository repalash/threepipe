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
| fix, Node, render mode | 27.6 s | 12,336,074 | all 446 objects, 0 modifier errors |
| fix, Mac GPU browser, viewport mode | 9.0 s | 10,178,156 | loads, 446 meshes |

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

## Follow-up: viewport or render evaluation

**Done**, as a separate commit: `BlendLoadPlugin.evaluationMode`, `'viewport'` by default.

The importer ran modifiers by their render flag at their render Subsurf level. Blender evaluates in one
mode, which decides both which modifiers run - `required_mode = use_render ? eModifierMode_Render :
eModifierMode_Realtime` (`mesh_data_update.cc:303`) - and which Subsurf level is used -
`levels = use_render_params ? renderLevels : levels` (`MOD_subsurf.cc:86`). Its exporters default to
the viewport (`IO_wavefront_obj.hh:53`, `export_eval_mode = DAG_EVAL_VIEWPORT`), and a real-time viewer
is the viewport case.

bugatti's 173 Subsurf modifiers, all Catmull-Clark:

| viewport / render | objects | base faces |
| --- | --- | --- |
| 0 / 2 | 27 | 350,021 |
| 2 / 2 | 101 | 102,815 |
| 3 / 3 | 16 | 27,806 |
| 1 / 2 | 20 | 4,178 |
| 3 / 2 | 9 | 522 |

The 0 / 2 group is few objects but most of the geometry. Viewport evaluation takes bugatti from
12,336,074 triangles to 10,178,156 (-17%), and loads it in 9.0 s on the Mac GPU browser (0.5.1: 3.7-5.1 s
with holes). That is the size of the effect - the load works because of the fixes above, not because
of this.

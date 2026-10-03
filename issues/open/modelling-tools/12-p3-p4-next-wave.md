# P3 + P4 — modelling depth and the first five minutes (subplan of [10-editor-plan](./10-editor-plan.md))

**Status**: started 2026-10-03, after P1 ([11](./11-p1-interaction-engine.md)) merged into `modelling-editor`
(`d41c9db`). Each track is an agent in its own worktree, branched from `modelling-editor`, merged back
after review and a Mac GPU check.

## Tracks

### L — loop tools (`p3-loop`)
Kernel ports and interactive tools:
- full `bmo_subdivide.cc` (all quad/tri patterns, smoothness, fractal off), behind `mesh.subdivide` -
  today only the icosphere pattern exists;
- loop cut and slide (`editmesh_loopcut.cc`: preview of the ring under the cursor, wheel for cut count,
  then edge slide);
- edge slide and vertex slide (`transform_mode_edge_slide.cc`, `transform_mode_vert_slide.cc`) as
  transform modes in track T's `TransInfo`, so they get numeric input, Ctrl snap and the redo path.

### K — knife (`p3-knife`)
`editmesh_knife.cc` port: cut through faces by clicking points, angle snapping, cut-through (Z),
midpoint snapping, Enter to confirm, undo of individual segments while cutting, and a preview overlay.
Bisect (`bmo_bisect_plane.cc`, `mesh.bisect`) as a related plane cut.

### F — fill and connect (`p3-fill`)
- bridge edge loops (`bmo_bridge.cc`);
- fill (`F`, `bmo_contextual_create_exec` including edge-net fill, `bmo_edgenet.cc`);
- grid fill (`bmo_grid_fill.cc`);
- the dissolve options the engine flagged (`use_face_split`, `preserve_quads`, `boundary_tear`);
- connect vertex path (`J`, `bmo_connect_pair.cc`);
- merge by distance in edit mode wired to the existing kernel port.

### O — onboarding and polish (`p4-onboarding`)
For the user who has followed one Blender tutorial, or knows Figma:
- a first-run choice of keymap (Blender / Design), with trackpad detection (kokraf's heuristic is
  already in the engine) and a short "how to move around" card;
- a start scene with a primitive and three hints;
- empty states that teach;
- the redo panel opens on the first operations;
- an undo history list;
- a cheat sheet generated from the active keymap (`?`);
- File > New / Open / Save (glb with the topology extension) / Export (glb, obj, stl);
- toasts and errors that say what to do next.

## Rules for every track

Same as P1: port from Blender source and cite file:line; each user-facing behaviour gets a real-input
e2e test; tests that fail without the change; no `git stash`/`checkout`/`reset`/`restore`/`clean` and no
rebase; never commit `node_modules`; comm folder `tmp/agent-comm/<track>/`.

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

Status (2026-10-03, branch `p3-knife`, for review):
- Kernel: knife (`src/ops/knife/`: `KnifeTool`, `knifeProject`, `BM_face_split_edgenet` + connect
  islands, `KnifeView`), bisect (`bisectPlane`, `bisectSelection`, `bisectPlaneFromScreenLine`), scan-fill,
  `triangleFill`, `faceAttributeFill`. Checked against Blender 3.4.1: Knife Project (10), the interactive
  knife fed simulated input (16 recordings), bisect's line gesture (4), bisect with planes (10),
  triangle fill (34).
- Keys follow current Blender, not 2.9x: C is cut-through, A angle snapping, X/Y/Z axis locks; E and
  Backspace added (new cut, undo segment). The Design preset uses the Industry Compatible knife map.
- mesh-edit `startKnife` (modal, preview, one undo step), `startLineGesture`, `previewEdit`; modelling
  `bisect` command; engine `mesh.knife` (K / Shift+K), `mesh.bisect` (drag with live preview, redo
  panel), Knife and Bisect shelf tools; e2e `modelling-editor-cut`.
- Not yet: knife measurements drawing, bisect's after-the-fact gizmo (`MESH_GGT_bisect`) and the
  gesture's snap/flip keys, X-ray face fallback; see `kernel-knife-port-gaps.md`.

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

Status (2026-10-03, branch `p4-onboarding`, `ead20ea`..`8edc1c6`): all of the above done, with
real-input e2e (`modelling-editor`, new `modelling-editor-files`) and engine unit tests. Fixed on the
way: object-gizmo drags also box-selected (deselect after every move, `MeshEditPlugin`), threepipe
`Dropzone` ignored script-built drops, outliner lagging scene bursts (uiconfig-blueprint, see
`../uiconfig-blueprint-refresh-drops-calls.md`). Open: a real trackpad check on the Mac; Save writes a
download (File System Access API not used); the `modelling-workspace` example's import map
(`../example-modelling-workspace-importmap.md`).

## Merge status (2026-10-03)

- **F (`p3-fill`):** merged.
- **L (`p3-loop`):** merged. Both tracks had ported `bmo_subdivide_edgering.cc`, in files whose names differ
  only by case (`subdivideEdgering.ts` / `subdivideEdgeRing.ts`), which a macOS checkout cannot hold. F's
  port is kept: it passes L's 43 Blender fixtures and serves Bridge's Number of Cuts. L's parity test
  now runs against it, and `mesh.subdivide_edgering` is registered once, in `fillOps.ts`.
- **Follow-ups filed:** [mesh-edit-normals-current](./mesh-edit-normals-current.md),
  [kernel-enum-naming](./kernel-enum-naming.md).

## Next: menus

The header builds one flat menu per operator `category`. With the P3 operators, the Mesh menu is
taller than the window. It now scrolls inside itself; before, it scrolled the page and left it there.

Blender's edit-mode header instead has Select / Add / Mesh / Vertex / Edge / Face / UV, and Mesh
has submenus: Transform, Mirror, Snap, Split, Separate, Clean Up, Delete.

The fix is to port that structure (`VIEW3D_MT_edit_mesh*` in `space_view3d.py`) as menu
definitions in the engine, with the same ids the Ctrl+V/E/F menus already use, and to keep
`category` only for the command palette.

## Rules for every track

Same as P1: port from Blender source and cite file:line; each user-facing behaviour gets a real-input
e2e test; tests that fail without the change; no `git stash`/`checkout`/`reset`/`restore`/`clean` and no
rebase; never commit `node_modules`; comm folder `tmp/agent-comm/<track>/`.

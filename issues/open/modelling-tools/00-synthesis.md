# Modelling tools for threepipe — research synthesis and decisions

Status: research complete (2026-09-14); D1-D4 resolved, implementation starting at M0. This document distils the research reports in this folder and records the decisions.

Reports (read these for evidence, line numbers and file paths):
- `research-threepipe.md` — what exists in threepipe today, constraints, reusable pieces
- `research-kokraf.md` — kokraf's architecture, what to adopt, what to avoid
- `research-blender.md` — Blender Mesh/BMesh/bmo/transform/selection/undo architecture, port plan
- `research-ecosystem.md` — JS/WASM libraries, licences, API precedents (bmesh, jscad, build123d, Onshape, manifold)
- `research-experiments.md` — the maintainer's `experiments/` folder: the Blueprint editor (`threepipe-blueprint-editor`), its `EditModePlugin`, `EditorFeatures`, the MCP bridge, scripting system, and the webgi legacy sources
- `research-ai-3d-ecosystem.md` — frontier-AI-era 3D tooling landscape (pending at time of writing)

Work happens in the `modelling-tools` branch worktree at `.repos/threepipe-modelling/` (base `0641fb7`).

---

## 1. Goals (restated from the brief)

1. Blender-quality polygonal modelling in threepipe: edit mode with vert/edge/face selection, extrude, inset, bevel, loop cut, knife, dissolve, merge, bridge, subdivide, booleans, primitives.
2. A first-class programmatic API usable by humans and AI agents through scripting (typed TS, not MCP). API quality is as important as UX.
3. A proper editable-mesh representation instead of editing `BufferGeometry` directly, as a plugin, Node-safe.
4. `.blend` files load with their n-gon topology intact and editable, not only triangulated.
5. Kokraf is the UX/three.js-editor reference; Blender is the algorithm and architecture reference.

## 2. Key findings

### 2.1 threepipe today
- No editable mesh type. Closest pieces: blend-importer's `geometry.userData.__cage` (n-gon faces + per-corner UVs + material index, dropped on clone/export, only on the 3.6–4.x path, consumed by Subsurf then discarded), svg-renderer's vendored half-edge (triangle ingest, no attributes, broken `splitEdge`, tests disabled), procedural-generation's three ad-hoc formats (gitignored, triangles only).
- Object-level selection/gizmos/undo are solid and reusable: `PickingPlugin` (multi-select, primary = index 0, `select` scene event, `hitObject` with `consumed`), `TransformControls2` per-handle config, `MultiSelectHelper` median-dummy pattern, `PivotEditPlugin` as a secondary-mode template, `UndoManagerPlugin` (`record({undo, redo})`, `performAction`, `setValue` merging), `Object3DGeneratorPlugin` for "Add Mesh", `LineHelper` handle pattern, `IObjectExtension` for per-object UI.
- Gaps: no sub-object selection or element ids on `HitIntersects`; no BVH in core; no vertex/edge/grid snapping; no 3D cursor; no marquee select; no central keymap (see 2.5 — three uncoordinated `window` listeners, and `X/Y/Z`, `E`, `R`, `W`, `F`, `Delete`, `Escape`, `Q`, `Space` are all taken); undo is closure-based with a stale-reference issue; `import 'threepipe'` is not Node-safe (`constants.ts:3` ImageData, `src/core` value-imports `ThreeViewer` for dialogs).
- Persistence: `geometry.userData` non-prefixed keys round-trip through glTF `primitive.extras` automatically; binary needs a custom glTF extension with bufferViews (`registerGltfExtension`, `BundleArrayBuffers` precedent).

### 2.2 kokraf
- Data model is an id-keyed vertex/edge/face graph with unordered `Set` adjacency, no loops/corners, UVs in a side map, faces keyed by sorted vertex set. Ships extrude/inset/bevel/loop-cut/knife/edge-slide/bridge/booleans on it, but every op is an original construction: loop cut quads-only, knife one segment, edge-slide rail scoring is a placeholder, bevel is 2k lines with a 1000-iteration relaxation.
- Worth adopting as ideas: editable mesh separate from render geometry with an explicit slot map; delta undo with id watermarks; a single modal-tool lifecycle (start/apply/commit/cancel, gizmo-or-keyboard source, numeric input buffer, header text); topology-once-then-move-verts preview for extrude/inset/bevel; GPU id picking for knife and depth filtering; Manifold booleans with faceID-based n-gon reconstruction; configurable keymap with double-tap.
- Licence: BUSL-1.1 until 2029-05-11. Read for design only; never copy code.

### 2.3 Blender
- Two representations, bridged at mode switch/undo/eval: `Mesh` (SoA arrays: `face_offset_indices`, named attributes on Point/Edge/Face/Corner domains) for storage/file/undo/modifiers/draw; `BMesh` (vert/edge/loop/face with disk, radial and loop cycles, CustomData blocks, lazy indices) for every interactive operator.
- 83 operators in `bmesh_opdefines.cc` with typed named slots in/out, enum subtypes, declared post-op flags (`NORMALS_CALC`, `SELECT_FLUSH`). This is a machine-readable schema for our API and for LLM tool definitions.
- WM operators: `exec` (extrude), modal re-exec from a mesh backup (inset/bevel/loop cut), custom-model tools (knife). Redo panel = undo pop + re-exec with props, so every modal tool needs a pure `exec`.
- Transform: `STARTING → RUNNING → CONFIRM|CANCEL` state machine over `TransData` (loc pointer, iloc, center, axismtx, factor), constraint projection `spacemtx·P·spacemtx⁻¹`, NORMAL orientation from selection, numeric input with unit parsing, snapping, proportional falloffs.
- Selection: flags + counters, down-propagation on set, up-flush (vert→edge iff both, edge→face iff all), ordered history with active element, walkers (loop/ring/boundary/shell), vert>edge>face nearest picking with a select-id buffer or projected search.
- Undo: full SoA snapshot per step, deduplicated by a content-hashed 64 KiB chunk store against the previous snapshot; looptris/normals never stored.

### 2.4 Ecosystem
- No reusable editable n-gon mesh kernel exists in JS/TS. `sketchpunklabs/bmesh` (MIT, ~2.1k lines, verified) is a line-cited port of Blender's BMesh Euler-operator core but has no attribute layers, no operators, string UUID ids via `window.crypto`. Useful as a cross-check, not a dependency.
- Adopt: `three-mesh-bvh` (picking/snapping/knife rays), `manifold-3d` (booleans/hull; lazy optional plugin, Babylon CSG2 init pattern), `xatlas-three` (ours, UV unwrap), three's bundled Earcut/ShapeUtils and `toCreasedNormals` for the bake, optionally `quickhull3d`.
- Skip: MeshLib (non-commercial licence), CGAL, libigl GPL modules, chili3d (AGPL), opencascade.js, stale half-edge libs.
- API precedents: `bmesh.ops` explicit in/out slots (best structural fit), build123d `ShapeList` selectors (`filterBy/sortBy/groupBy`), Onshape queries instead of ids, Houdini named groups, manifold `status()/genus()/volume()` as agent-checkable invariants. BlenderMCP is the anti-pattern (hidden global selection state + arbitrary code escape hatch).

### 2.5 The maintainer's editor (`experiments/threepipe-blueprint-editor`)
- `EditModePlugin` there is **not** mesh editing: it is the editor *viewport* mode (editor cameras, grid, light/material overrides, WASD fly, app keymap). The `PluginType` string `'EditModePlugin'` is taken and the editor adds it unconditionally, so our plugin must be named differently (see D7a).
- There is **no mesh/geometry editing anywhere** in the editor: no vertex/edge/face selection, snapping, 3D cursor, marquee or measurement. Greenfield.
- `EditorFeatures` already implements the keyed `plugin.enable(key)/disable(key)` gating that D4 wants. Drive it, do not reinvent it. A plugin can claim a settings tab by declaring `static PluginTags = ['EditorMode-Extras']`.
- The MCP bridge is already a dumb relay; the tool *schemas* (hand-written JSON Schema) and the *implementations* (a 711-line `switch`) both live in the browser and duplicate each other. The bridge re-fetches the tool list on connect and supports `sendToolListChanged()`, so a generated list is a drop-in. Flaws not to repeat: name-or-uuid ambiguity, agent mutations that record no undo, `{error: string}` results, one flattened ~20-param `createObject`.
- Scripting is real ES modules hot-loaded through an import map, not `eval`. That is where user modelling scripts belong. `AgentsMdTemplate.md` is the existing "typed API doc for agents" precedent.
- `webgi-legacy-src/` is the most valuable reference folder: `PivotEditPlugin` is a genuine modal sub-tool with per-move undo, plus `ObjectPicker`/`PickingPlugin`/`MultiSelectHelper` ancestors and CSG plugins.
- The editor pins threepipe **0.4.3** while this repo is **0.5.1**; it needs a 0.5.x bump before it can consume the modelling plugin. Prerequisite, not a blocker for M1-M3.

### 2.6 Keymap conflicts (verified in threepipe 0.5.1)
Three `window`-level keydown handlers exist with no mode awareness:

| Source | Keys |
| --- | --- |
| `PickingPlugin._onKeyDown` (`src/plugins/interaction/PickingPlugin.ts:198-234`) | `Ctrl/Cmd+A/D/C/X/V`, `Escape`, `Delete`/`Backspace`, `H`, `Shift+H`, `F`, `Alt+G/R/S` |
| `TransformControlsPlugin._keyDownListener` (`:225-281`) | `W` translate, `E` rotate, `R` scale, `Shift` snapping |
| `handleGizmoKeyDown` (`src/three/controls/gizmoKeyboardHandler.ts:6-44`) | `Q`, `+`/`-`, **`X`/`Y`/`Z`**, `Space` |

Hard conflicts with Blender: `X/Y/Z` (gizmo handle visibility vs modal axis constraint), `E`/`R`/`W` (rotate/scale/translate vs extrude/rotate/grab), `F` (focus vs make edge/face), `Delete`/`Escape` (object-level vs element-level and modal cancel), `Space`, `P`. `Alt+G/R/S` already matches Blender's clear-transform and should stay. Free today and safe to claim for edit mode: `Tab`, `1`/`2`/`3`, `G`, `S`, `I`, `K`, `M`, `B`, `L`, `A`, `Ctrl+R`, `Ctrl+B`. Full table in `research-experiments.md` §4(d).

## 3. Proposed architecture (recommendation)

### 3.1 Layers

```
┌──────────────────────────────────────────────────────────────────────┐
│ Editor UX (browser): EditModePlugin, element picking/overlays,       │
│ modal tools (transform/extrude/inset/bevel/loopcut/knife), keymap,   │
│ redo panel, 3D cursor, snapping, tweakpane tab                       │
├──────────────────────────────────────────────────────────────────────┤
│ Tool/operator layer (Node-safe): mesh.* operators with props,        │
│ exec(ctx, props), selection-driven input/output, undo push, redo     │
├──────────────────────────────────────────────────────────────────────┤
│ Kernel (Node-safe, zero threepipe deps, three math only):            │
│   MeshData (SoA, Blender Mesh mirror) ⇄ BMesh (working copy)         │
│   ops.* generated from an op-definition table (bmo port)             │
│   selection flags/flush/history, walkers, normals, tessellation,     │
│   attribute layers with interpolation, validate(), chunked undo store│
├──────────────────────────────────────────────────────────────────────┤
│ Bake: MeshData → BufferGeometry (corner-split, faceId→triangle map)  │
│ Import: blend-importer emits MeshData; glTF extension persists it    │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 Data representation: hybrid, ported from Blender
- `MeshData` (SoA): `faceOffsets: Int32Array(f+1)` + attribute table `{name, domain: point|edge|face|corner, type, data: TypedArray}` with Blender's built-in names (`position`, `.edge_verts`, `.corner_vert`, `.corner_edge`, `.select_*`, `.hide_*`, `sharp_edge`, `sharp_face`, `uv_seam`, `material_index`, `custom_normal`, UV maps, colours, creases), plus select history/active/selectMode. This is exactly what the blend importer reads and what serializes, snapshots and bakes.
- `BMesh`: literal port of `bmesh_class.hh` (BMVert/BMEdge/BMLoop/BMFace, disk/radial/loop cycles, header flags, per-op flag layers, lazy index/table, CustomData blocks as offset views). All operators run here. Built on entering edit mode (`bmFromMesh`), flushed on commit (`bmToMesh`).
- Rationale: kokraf shows what happens with an ad-hoc graph (quads-only loop cut, one-segment knife). Blender's operators are written against radial/disk cycles and attribute interpolation; porting them faithfully needs the same structure. The SoA side keeps import, undo, modifiers and rendering array-based and cheap.

### 3.3 API shape
- `ops.<name>(bm, {…slots}) → {…outputs}` generated from one op table mirroring `bmesh_opdefines.cc` (typed props with defaults, enum string unions, element buffers, maps). Same table emits JSON schema for agents.
- Higher-level `mesh.*` operators with UI semantics (act on selection, select outputs, push undo, registered for redo). Every modal tool has a pure `exec(props)`.
- Selection is a first-class inspectable value (flags on elements + `selectHistory` with `.active`), plus query helpers in the build123d style (`mesh.faces().filterBy(...).sortBy(...)`) and named groups persisted as attributes.
- Agent affordances: `validate()`, `describe()`, `measure()`, invariants (`eulerCharacteristic`, `isManifold`, `volume`), and operator results that report warnings instead of throwing for recoverable conditions.

### 3.4 Editor integration
- `EditModePlugin` (or similar) owns edit state: which object is in edit mode, its BMesh, select mode, overlays (points/edges/faces with id + flag attributes, batched, `assetType='widget'`), element picking (screen-space nearest with vert>edge>face priority; BVH ray for knife/snap; select-id render target later for occlusion and box select).
- Modal tools share one state machine (transform port) with numeric input, axis/plane constraints, orientations (global/local/normal/view), pivots (median/active/cursor/individual), snapping, precision.
- Central mode-aware keymap plugin so Blender defaults (G/R/S/E/I/Ctrl+B/Ctrl+R/K/F/M/X/Tab/1-2-3/A/L/Alt+click) work without colliding with object-mode plugins; object-mode plugins get `disable('editmode')` while editing.
- Undo: one `MeshData` snapshot per committed operator through the existing `UndoManagerPlugin` (`record({undo, redo})`), stored in a chunked content-hashed array store (port of `BLI_array_store`).
- Render: `MeshData → BufferGeometry` baker (tessellation port of `bmesh_calc_tessellation_for_face_impl` with polyfill2d/earcut, corner-split by sharp edges/faces and attribute discontinuities, `triangle → face` map) with partial position/normal updates during drags; geometry replaced via the `mesh.geometry =` accessor, edits via `setDirty({refreshScene: false})`.
- Persistence: a glTF extension carrying `MeshData` arrays as bufferViews (registered through `assetManager.registerGltfExtension`), so edited n-gon topology survives export/import; the baked triangles remain the standard glTF primitive for other viewers.

### 3.5 blend-importer
- Replace the three triangulation loops with one path: decode DNA → `MeshData` (also reading `edata` for seams/sharp/creases and the 5.0 `attribute_storage` path) → bake. Subsurf/mirror/array/solidify move onto `MeshData` over time (Subsurf already has the cage-based Catmull-Clark).

## 4. Decisions

Resolved 2026-09-14 by the maintainer:

- **D1 Representation — hybrid SoA `MeshData` + BMesh port.** Blender's own split. SoA is canonical/serialized/baked; BMesh is built on edit-mode entry and is the only thing operators touch.
- **D2 Packaging — two packages.** A Node-safe kernel package with zero threepipe dependency (three math only) that is the scripting/agent API, plus an editor plugin package for edit mode, tools, overlays, keymap and UI. Exact npm names still open (D7b).
- **D3 Order — all of it; start anywhere.** Chosen order: kernel and API first, then blend n-gon import, then edit mode, then operators by value, with bevel and knife as the large late ports.
- **D4 Core changes approved**: central mode-aware keymap plugin, keyed `disable()` of object-mode plugins during edit mode, element ids on `HitIntersects`, lazy `ThreeViewer.Dialog` imports for Node safety. Each gets a subplan and a diff review before merge. Note the keymap work must *drive* the editor's existing `EditorFeatures` gating rather than duplicate it, and must generalise `EditModePlugin.keyListeners`' descriptor shape (adding a `mode` field and treating unspecified modifiers as "must be absent" — the current wildcard behaviour is a latent bug).
- **D5 sketchpunklabs/bmesh** — port fresh from Blender source; use it only as a cross-check. (Recommended; not explicitly confirmed.)
- **D6 Booleans** — manifold-3d as a lazy optional plugin, Babylon `InitializeCSG2Async`-style injectable init. (Recommended; not explicitly confirmed.)

Still open:

- **D7a Plugin name.** `EditModePlugin` is taken by the Blueprint editor and means "editor viewport mode". Proposal: `MeshEditPlugin` (`PluginType = 'MeshEditPlugin'`). Must be fixed before M4 because the editor is patched in lockstep.
- **D7b Package names.** e.g. `@threepipe/mesh` (kernel) and `@threepipe/plugin-modelling` (editor). Existing convention is `@threepipe/plugin-*` for plugins; the kernel is a library, not a plugin.
- **D7c API surface details** — camelCase operator names (`extrudeFaceRegion`), output slots without `.out`, where the Z-up/Y-up conversion boundary sits, and whether object mode keeps `W`/`E`/`R` while edit mode uses Blender's `G`/`R`/`S`/`E` (recommended: yes, don't break existing users).

### 4.1 Agent-facing API and the MCP bridge

The typed TS API is the single source of truth. The op-definition table generated from `bmesh_opdefines.cc` emits TS types, runtime validation, docs **and** `{name, description, inputSchema}` JSON Schema for agents. The editor's existing MCP bridge then becomes a thin generated wrapper: it already re-fetches the tool list on connect and supports `sendToolListChanged()`, and its handler signature `(action, params) => Promise<unknown>` already fits a registry dispatch instead of a `switch`. Requirements this places on the API: every mutation records undo (the current agent tools do not); results are typed with structured warnings rather than `{error: string}`; element references are queries/selectors rather than ambiguous name-or-uuid strings; no `eval` tool — user scripts are real ES modules loaded through the editor's existing import map.

## 5. Milestone sketch (to be refined into subplans after decisions)

M0 Design: op-definition table extracted from `bmesh_opdefines.cc` into a TS schema (also emitting MCP `inputSchema` JSON, so the bridge never grows a second hand-written tool list); kernel type sketch; API doc draft; test strategy (Node unit tests against Blender-generated fixtures: build the same mesh in Blender via `bmesh.ops`, export arrays, compare).
M1 Kernel: `MeshData`, attributes, `BMesh` core (create/kill, Euler ops, cycles, iterators, queries, interp, marking/select, walkers), `bmFromMesh/bmToMesh`, tessellation, normals, `validate()`, chunked undo store. Node-tested.
M2 Bake + import: `MeshData → BufferGeometry`, glTF extension, blend-importer emits `MeshData` with n-gons and edge attributes; Subsurf on `MeshData`.
M3 Operators batch 1: utils (transform/smooth/reverse/region_extend), dupe/split/delete, extrude family, primitives (incl. monkey), contextual_create (F), remove_doubles/merge/collapse, dissolve, split_edges.
M4 Edit mode UX (needs D7a fixed and the editor bumped to threepipe 0.5.x): edit-mode plugin, overlays, picking, select modes/flush/history, loop/ring/linked, keymap, transform modal (G/R/S with constraints, numeric input, pivots, orientations, snapping, proportional), extrude/duplicate macros, undo/redo panel, tweakpane tab, docs + interactive tests.
M5 Operators batch 2: inset, subdivide + loop cut + edge slide, connect/J, rotate edges, normals, triangulate/join tris, bridge, fills, poke, bisect, mirror/symmetrize.
M6 Bevel (8.5k-line port), knife, rip, shortest path.
M7 Booleans (manifold), modifier stack on `MeshData`, UV unwrap (xatlas-three), 3D cursor, marquee select.

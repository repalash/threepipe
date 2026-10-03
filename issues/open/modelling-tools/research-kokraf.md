# kokraf research (reference for threepipe modelling tools)

Repo: https://github.com/sengchor/kokraf (local clone `/Users/palash/Projects/threepipe/.repos/kokraf`, unshallowed to full history for this review).
~40.5k lines plain ES modules, no build step, three.js 0.176 via CDN importmap (`index.html:94-110`). Extra deps: `earcut`, `manifold-3d@3.4.1`, `three-mesh-bvh`, `three-gpu-pathtracer`, a custom-compiled `xatlas` wasm (`/wasm/xatlas.js`), Supabase for accounts/cloud save.

LOC by area: `js/tools/*` 11.6k, `js/vertex/*` 3.3k, `js/commands/*` 3.0k, `js/geometry/* + core/MeshData*` 2.3k, `js/uv/*` 4.4k, `js/texture/*` 2.3k, rest is UI/panels/services.

All line numbers below are for the files as of commit `2e13e71` (2026-09-13).

---

## 1. Mesh data model

### 1.1 Storage: `js/core/MeshData.js`

```js
// MeshData.js:3-27
class Vertex { id; position /* THREE.Vector3 OR plain {x,y,z} */; edgeIds = new Set(); faceIds = new Set(); }
class Edge   { id; v1Id; v2Id; faceIds = new Set(); }
class Face   { id; vertexIds /* ordered array, winding = normal */; edgeIds = new Set(); }

// MeshData.js:29-43
export class MeshData {
  vertices = new Map();  edges = new Map();  faces = new Map();   // id -> element
  nextVertexId = 0; nextEdgeId = 0; nextFaceId = 0;              // monotonic, never recycled
  edgeKeyMap = new Map();   // "minId_maxId" -> Edge           (MeshData.js:45-47)
  faceKeyMap = new Map();   // sorted vertex ids joined "_"  -> Face (MeshData.js:49-51)
  uvs = new Map();          // faceId -> [{u,v} per corner] (per-face-corner UVs, may be null)
}
```

What is stored:
- **Vertices**: id, position, incident edge ids, incident face ids (unordered Sets – no radial/cycle ordering).
- **Edges**: two vertex ids + incident face ids (unordered Set; any count, so non-manifold edges are representable but not distinguishable).
- **Faces**: ordered vertex id list (n-gon of any size, winding defines the normal), edge id Set.
- **Per-corner attributes**: only UVs, in a separate `uvs: Map<faceId, [{u,v}]>` (`MeshData.js:42`). There are no per-corner normals, colours, material indices, crease/bevel weights, or sharp flags anywhere in the model. Shading is a per-object string (`object.userData.shading = 'flat'|'smooth'|'auto'`, `js/utils/ObjectFactory.js:61`) and normals are always derived at render time.
- **Seams**: not in MeshData; kept as `object.userData.seam: Set<edgeId>` (`js/uv/SeamSnapshot.js:16-22`, `js/utils/SeamUtils.js`).
- **Materials**: one material per Mesh, no per-face material slot.
- **Selection**: not in MeshData; three `Set<number>`s on `EditSelection` (`js/tools/EditSelection.js:29-31`).

The MeshData object lives on `mesh.userData.meshData` next to `mesh.userData.renderBuffer` (`ObjectFactory.js:59-60`), so it is serialised into the three.js `ObjectLoader` JSON via `toJSON()` (`MeshData.js:167-177`) and rehydrated on load by prototype-patching (`MeshData.js:179-234`, `MeshRenderBuffer.js:33-82` uses `Object.setPrototypeOf`).

### 1.2 Invariants and construction

- `addEdge(v1,v2)` dedups via `edgeKeyMap` (`MeshData.js:59-71`).
- `addFace(vertices)` (`MeshData.js:73-94`) dedups via `faceKeyMap` keyed on the **sorted** vertex id set. Consequence: two faces with the same vertex set but different winding or different cyclic order cannot coexist (e.g. a face and its flipped twin, or a bow-tie ordering). `MeshEditor.mergeMeshData` has an explicit comment about UV loss caused by this collapse (`js/vertex/MeshEditor.js:38-40`).
- `addFace` auto-creates the boundary edges; `deleteFace` unlinks but leaves edges/vertices (orphans must be cleaned by `VertexDelete.cleanupOrphanEdges/Vertices`, `js/vertex/VertexDelete.js:232-263`).
- `deleteVertex` cascades to faces and edges (`MeshData.js:109-127`), `deleteEdge` cascades to faces (`MeshData.js:129-145`).
- Position type is **inconsistent**: `MeshDataBuilders` and `KnifeTool.applyCut` pass plain `{x,y,z}` objects (`js/utils/MeshDataBuilders.js:15-23`, `js/tools/KnifeTool.js:453`), `VertexTopologyUtils.mergeVertices` writes a plain object back (`js/vertex/VertexTopologyUtils.js:106`), but rehydration and most tools create `THREE.Vector3`. Several call sites assume Vector3 methods on it: `EdgeSlideTool.js:382,394`, `VertexBridge.js:444-445`, `BevelTool.js:1816-1817`, `VertexSubdivide.js:116` call `.position.clone()` / `.lerp()`. Not run-time verified here, but a fresh (unreloaded) primitive or a merged vertex looks like it can hit `clone is not a function` in edge/vertex slide.

### 1.3 Id allocation

Ids are monotonically increasing integers per element type (`MeshData.js:35-37`), never recycled, persisted with the mesh. `MeshDataRegion.captureNewElements` relies on this to find "everything created since op start" by scanning `[startId, nextId)` (`js/core/MeshDataRegion.js:115-135`). Edit helper picking encodes vertex ids into a `Uint16BufferAttribute` (`js/helpers/EditHelpers.js:74`), so picking silently breaks past 65535 vertex ids (ids, not count – a long editing session on a mid-size mesh gets there).

### 1.4 Conversion to BufferGeometry: `js/geometry/MeshRendererAdapter.js` + `MeshRenderBuffer.js` + `SlotAllocator.js`

Two paths:

**Full rebuild** (`toBufferGeometry`, `MeshRendererAdapter.js:8-19` → `buildDuplicatedMeshData` `:70-155`): every face gets its own run of vertex slots (corner-split, "duplicated" layout), each n-gon is projected to 2D (Newell normal, `TriangulationUtils.js:3-39`) and triangulated with `earcut`, falling back to a fan if earcut returns nothing (`:114-118`). Isolated vertices get slots too (`:124-131`). Buffers are allocated at **2x** the needed size (`:139-140`) and two first-fit `SlotAllocator`s (vertex slots, index slots) are created. Normals are then computed per mode: flat (`:385-411`), smooth (`:413-476`, builds a temporary shared-vertex `BufferGeometry` and calls `computeVertexNormals`), or angle-based (`:478-537`, per face-corner average of neighbour face normals within threshold – note: it averages over all faces around the vertex within the angle, not a connected smoothing group; the unused `NormalCalculator.computeVertexNormalsWithAngle` in `js/geometry/NormalCalculator.js:70-135` does flood-fill groups instead).

**Incremental "slots"** (added June 2026, commits `c392387`, `8ba622d`):
- `MeshRenderBuffer` keeps `vertexIdToBufferIndex: Map<vId, slot[]>`, `bufferIndexToVertexId`, `faceIdToBufferIndices`, `faceTriangleOffset/Count`, plus the two allocators (`MeshRenderBuffer.js:3-17`).
- `addFace` allocates `k` vertex slots and `3(k-2)` index slots, grows the buffers (copy to a bigger typed array and `setAttribute` again, `:349-383`) when the allocator is out of space, and writes positions/uvs/indices/normals directly (`:200-299`).
- `deleteFace` masks the face's triangles as degenerate (all three indices set to the same slot, `:310-318`) and frees the slots (`:301-347`). Nothing is compacted; `MeshDeltaCommand`'s constructor forces a full rebuild when allocator utilisation drops below 25% (`js/commands/MeshDeltaCommand.js:24-30`).
- Position-only edits (`VertexTransform.setVertexPositions`, `js/vertex/VertexTransform.js:30-84`) write straight into the attribute for every slot of the vertex, then recompute normals for affected faces/vertices (`MeshRendererAdapter.updateNormalsForAffectedFaces`, `:593-622`) and optionally re-triangulate n-gons (`retriangulateFace`, `:624-655`; returns `'rebuilt'` when the triangle count changes but nothing acts on that value, `:645-647`, `:657-662`).
- `addEdge/deleteEdge` do nothing on the render side (`VertexEditor.js:94-95`) – edges without faces are not rendered by the mesh at all (only by the edit helpers).

`VertexEditor` (`js/vertex/VertexEditor.js`) is the facade that keeps MeshData and the render buffer in sync: `addFace/deleteFace/addVertex/deleteVertex` (`:72-92`), `updateGeometry()` full rebuild (`:102-110`), `applyMeshData()` (`:112-118`), `applyDelta()` (`:120-186`, delete faces → delete verts → `MeshDataRegion.apply` → re-add verts → re-add faces → recompute bbox by iterating **all** vertices → normals).

### 1.5 Undo snapshots: `js/core/MeshDataRegion.js`

```js
// MeshDataRegion.js
expand(meshData, {vertexIds, edgeIds, faceIds}, depth=2)  // :4-52  grow seed set through V-E-F adjacency `depth` times
snapshot(meshData, ids)   // :54-69  {vertices:{id: serialized|null}, edges:{...}, faces:{...}}
apply(meshData, snapshot) // :79-113 write serialized elements back (null = delete); rebuilds edgeKeyMap/faceKeyMap entries
captureNewElements(meshData, {startVertexId,...}, beforeSnapshot) // :115-135 mark ids created since op start as null in "before"
```

The pattern every op uses (e.g. `js/actions/EditActions.js:144-221`, `js/tools/ExtrudeTool.js:322-333, 237-241`):
1. `before = snapshot(expand(selection, 2))`; remember `next*Id`.
2. Mutate through `vertexEditor`.
3. `captureNewElements` adds `null` entries for new ids to `before`; `after = snapshot(idsOf(before))`.
4. `new XCommand(editor, object, before, after)` → `MeshDeltaCommand`.

Correctness depends on the `depth=2` neighbourhood being a superset of everything the op touches. Ops that reach further (e.g. `mergeVertices` rewires edges of arbitrary neighbours; bevel `rebuildFaceTopology` on all faces adjacent to edge vertices) are covered only because callers pick `depth` by hand (`EditActions.js:364-368` uses 1 for merge; bevel uses 2 at `BevelTool.js:372-376`). There is no assertion that the mutation stayed inside the region.

### 1.6 Triangulation / n-gons

`earcut` on the 2D projection of each face (`MeshRendererAdapter.js:101-103`, `:259-261`, `EditHelpers.js:230-232`, `MeshDataManifold` uses a plain fan `:74-83`, `ManifoldRepair.earClip` has its own ear clipper `:399-445`). `addFace` does an O(k²) duplicate-position check before earcut (`:234-250`) because bevel creates coincident vertices during preview. `removeCollinearVertices` (`TriangulationUtils.js:41-65`) and `js/utils/QuadrangulateGeometry.js` (tri-pair → quad scoring, 161 lines) are **dead code** – no importers (GLB import dedups vertices by position only and keeps triangles as triangles, `js/loaders/GLBLoader.js:41-60`).

### 1.7 Non-manifold handling

MeshData itself accepts anything (any number of faces per edge, isolated vertices, wire edges). Nothing orders faces around an edge. Loop/ring/slide/loop-cut logic assumes `edge.faceIds.size <= 2` and quads in places (`VertexSelection.js:112,177,267`, `LoopCutTool.js:274 // only quads`, `EdgeSlideTool.js:352-357` aborts when a selected vertex has valence > 2). `ManifoldRepair.repairMeshData` (`js/geometry/ManifoldRepair.js:4-98`) exists only as a fallback for booleans: weld → drop degenerate/duplicate faces → drop faces on >2-face edges → split non-manifold vertices by fan components → BFS winding fix → ear-clip hole fill up to 128 edges.

### 1.8 Assessment: Blender Mesh vs BMesh?

Neither. It is an **id-keyed adjacency graph** ("VEF with Sets"):
- Like BMesh: elements are objects with identity, faces are n-gons, adjacency is stored on the element, edits are local, no index compaction.
- Unlike BMesh: no loops/corners as first-class elements (corner data is a parallel `uvs` map indexed by position in `face.vertexIds`), no radial cycle (face order around an edge) and no disk cycle (edge order around a vertex), so "next face across this edge", "walk around vertex", "is this edge manifold" all become Set scans/filters.
- Unlike Blender `Mesh`: no flat typed arrays, no corner/loop index, no attribute layers; `Map`/`Set`/objects everywhere, string keys for edge/face lookup.

Complexity of common operations:

| Operation | Cost | Where |
|---|---|---|
| addEdge/getEdge | O(1) via string key | `MeshData.js:59, 100` |
| addFace | O(k) + sort for key | `:73-94` |
| edge → faces / vertex → edges | O(1) Set | – |
| "opposite edge in quad", loop walking | O(k) per step | `VertexSelection.js:111-133` |
| Vertex-mode selection → derived edges/faces | **O(E + F)** full scan on every click | `EditSelection.js:932-967` |
| Snap to vertex | **O(total buffer vertices of every raycast-hit object)** per pointermove | `SnapManager.js:78-133` |
| Depth visibility test | full-screen render + `readRenderTargetPixels` per pick | `GPUDepthReader.js:66-92` |
| Edit helper rebuild (`refreshHelpers`) | O(V+E+F) rebuild of three helper geometries after every op commit | `EditHelpers.js:334-354` |
| `applyDelta` bbox | O(V) | `VertexEditor.js:174-181` |
| Full `toBufferGeometry` | O(V+F·k) with earcut per face | – |
| Serialise whole scene to IndexedDB | O(everything) after **every** command | `Editor.js:250-253` |
| Bevel scale solver | 1000 Jacobi iterations over new vertices | `BevelTool.js:487-521` |

---

## 2. Commands and history

`js/core/History.js` is the three.js-editor pattern: `undos[]/redos[]`, `execute(cmd)` calls `cmd.execute()` then pushes; `add(cmd)` pushes without executing (used by modal tools that already mutated live, e.g. `ExtrudeTool.js:241`); `maxCommands = 25` (`History.js:9`); `toJSON/fromJSON` via a `type → class` registry `js/commands/Commands.js:31-83` (`CommandClass.fromJSON(editor, json[, commandMap])`). History persistence is off by default (`js/core/Config.js:42 history: false`). There is no `updatable`/merge-of-continuous-edits concept; modal tools apply live preview outside the history and push one command on commit.

Command interface (duck-typed, no base class): `static type`, `execute()`, `undo()`, `toJSON()`, `static fromJSON()`; objects referenced by `uuid` and resolved via `editor.objectByUuid` (`Editor.js:355`).

Mesh-edit commands – two flavours:

```js
// js/commands/MeshDataCommand.js:3-66  – FULL snapshot (used by Union/Difference/Intersect)
constructor(editor, object, beforeMeshData, afterMeshData, name)  // structuredClone of whole MeshData
execute(){ editSelection.clearSelection(); vertexEditor.applyMeshData(after); seam.applyAfter(); }
undo()   { ...applyMeshData(before) }   // full BufferGeometry rebuild

// js/commands/MeshDeltaCommand.js:3-74 – REGION delta (14 subclasses: Extrude, Bevel, Inset, Knife, LoopCut,
// EdgeSlide, Bridge, CreateFace, DeleteSelection, Duplicate, Merge, Split, Subdivide, FlipNormals)
constructor(editor, object, beforeDelta, afterDelta, name)  // structuredClone of region snapshots
execute(){ clearSelection(); vertexEditor.applyDelta(after); seam.applyAfter(); }
undo()   { clearSelection(); vertexEditor.applyDelta(before); seam.applyBefore(); }
```

Every mesh command also embeds a `SeamSnapshot` (`js/uv/SeamSnapshot.js`) because seams live outside MeshData. Position-only edits use `SetVertexPositionCommand` (ids + old/new world positions, `js/commands/SetVertexPositionCommand.js`). Undo/redo **clears the sub-selection** (`MeshDataCommand.js:26`, `MeshDeltaCommand.js:35`) – selection is not part of the undo state, unlike Blender.

Composites: `MultiCommand` (`js/commands/MultiCommand.js`, executes children in order, undoes in reverse) and `SequentialMultiCommand` (`js/commands/SequentialMultiCommand.js`) which takes **factories** so later commands can be built from the state produced by earlier ones (booleans: `DifferenceTool.js:211-214`). `SeparateSelectionCommand` shows the object-creating variant: it keeps `newObjectUuid` so redo re-creates the same uuid (`js/commands/SeparateSelectionCommand.js:47-56`). Mode switches are commands too (`SwitchModeCommand.js`).

---

## 3. Tools and modal interaction UX

### 3.1 Wiring

`Toolbar` instantiates every tool once (`js/tools/Toolbar.js:34-51`) and on `updateTools()` disables all and enables the active one (`:233-297`). Modal ops are started either from the toolbar button or from `KeyHandler` dispatching a signal (`editTransformStart`, `editExtrudeStart`, `editBevelStart`, `editInsetStart`, `editEdgeSlideStart`, `Editor.js:105-111`). Transform-like tools attach a three.js `TransformControls` to an invisible pivot `Object3D` (`editSelection.vertexHandle`, `EditSelection.js:19-22`, positioned at the selection centroid `:624-654`); the gizmo is both the drag handle and the visual axis indicator for keyboard-driven mode.

### 3.2 Lifecycle (identical skeleton in EditTransformTool, ObjectTransformTool, ExtrudeTool, InsetTool, BevelTool, EdgeSlideTool)

```
enableFor(handle)                       // attach gizmo, add pointer/key listeners            EditTransformTool.js:53-65
  ├─ gizmo path:  TransformControls 'mouseDown'  → activeTransformSource='gizmo'  → startXSession()   :129-135
  │               'change' (dragging)            → applyXSession()                               :137-142
  │               'mouseUp'                      → commitXSession(); clear                       :144-150
  └─ command path: signal editXStart (G/R/S/E/I/Ctrl+B/GG)
                    → activeTransformSource='command'; startXSession();
                      transformSolver.updateHandleFromCommandInput(mode, lastPointerEvent); applyXSession()   :94-113
                  pointermove → solver moves the handle (axis/plane/normal constrained) → applyXSession()     :170-175
                  keydown x/y/z (+shift = plane) → solver.setAxis/PlaneConstraint; re-apply                   :190-206
                  keydown digits/-/backspace/arrows → TransformNumericInput.handleKey → applyNumericX(value)   :208-210
                  pointerdown / Enter → commitXSession()  (pushes command)                                   :177-182, 218-222
                  Escape → cancelXSession() (restore positions/apply before-delta)                            :212-216
startXSession   : capture pivot pos/quat/scale, selected ids, old world positions; dispatch onToolStarted(text)  :226-245
applyXSession   : compute delta from handle vs start pivot (+snap) → vertexEditor.transform.setVertexPositions()  :247-258, 319-345
commitXSession  : build final positions → editor.execute(SetVertexPositionCommand) / editor.add(MeshDeltaCommand)   :455-467
```

`TransformCommandSolver` (`js/tools/TransformCommandSolver.js`) is the shared "mouse → constrained handle" maths: free move on camera plane (`:169-172`), axis via closest-point-on-line-to-ray (`:150-158, 314-331`), plane via ray/plane (`:159-163`), custom axis (face normal for extrude, `ExtrudeTool.js:478-501`), rotation angle from atan2 on the constraint plane (`:185-220`), scale from projected distance ratio (`:222-311`). Note `getThreeAxisName` remaps keys `x→z, y→x, z→y` (`:355-361`) and `changeTransformControlsColor` recolours the gizmo (`:364-381`) so the user sees Blender's Z-up axis names on a Y-up scene.

Topology-changing modal tools (`ExtrudeTool`, `InsetTool`, `BevelTool`) perform the topology change **once at first `apply`** (`extrudeStarted` flag, `ExtrudeTool.js:221-226`) and then only move vertices; preview = the real mesh being edited live via the incremental render buffer. Cancel = `vertexEditor.applyDelta(beforeSnapshot)` (`InsetTool.js:277-291`, `BevelTool.js:318-334`), i.e. undo without a history entry. Extrude on Escape cancels the offset but still commits the topology (`ExtrudeTool.js:187-192`), matching Blender's behaviour.

Width-type tools (inset/bevel) map the pixel distance between the handle and its start screen position to world units at the pivot depth (`InsetTool.js:483-529`), so width is camera-relative like Blender.

### 3.3 Keymap (`js/core/Config.js:13-41`, handled in `js/tools/KeyHandler.js:54-263`, user-configurable and persisted)

`W` select, `G/R/S` move/rotate/scale (object or edit mode via signal), `GG` (double tap <300 ms) edge slide (`KeyHandler.js:87-105`), `E` extrude, `Ctrl+R` loop cut, `K` knife, `I` inset, `Ctrl+B` bevel, `Tab` object/edit, `A` select all, `L` select linked under mouse, `Alt+click` loop select (`EditSelection.js:146-150`), `F` create edge/face (and "quad from single vertex", `VertexTopologyUtils.js:48-83`), `P` separate, `M` merge, `Y` split, `Shift+D` duplicate, `Ctrl+J` join, `H/Shift+H/Alt+H` hide, `Shift+Q` mark seam, `Ctrl+Z/Ctrl+Shift+Z`. During a modal: `X/Y/Z` axis, `Shift+X/Y/Z` plane, digits/`-`/`Backspace`/arrows numeric entry, mouse wheel = segments (bevel, `BevelTool.js:184-217`) or cut count (loop cut, `LoopCutTool.js:158-180`), `Enter`/click confirm, `Esc` cancel. `KeyHandler` blocks other shortcuts while a drag is active (`:61`) and blurs the active element so inputs don't swallow keys (`:63-66`).

### 3.4 Numeric input and header text

`TransformNumericInput` (`js/tools/TransformNumericInput.js`) and `ToolNumericInput` (`js/tools/ToolNumericInput.js`, generic label/getter/setter/unit) implement a Blender-style typed buffer with caret, sign toggle and live re-apply; the display string ("Dx: [1.5|] = 1.500 (1.500 m) global", `TransformNumericInput.js:177-196`) is dispatched via `onToolStarted/onToolUpdated/onToolEnded` signals to `ToolInputDisplay` (`js/ui/ToolInputDisplay.js`), a header strip that can also show confirm/cancel buttons (payload `{text, buttons:[{label, variant, onClick}]}`, used by the boolean tools `DifferenceTool.js:152-158` for mobile).

### 3.5 "Adjust last operation" panel

`js/panels/OperatorPanel.js` (58 lines) is a minimal redo-panel: `open({title, params, schema:[{key,label,min,max,step}], onUpdate, onCommit, onCancel})`; any pointerdown outside or a non-Escape key commits. It is used by exactly one operator, Bridge (`js/actions/EditActions.js:563-585`): `onUpdate` re-applies the before-delta and re-runs the op with new params; `onCommit` snapshots and pushes the command. Everything else (bevel segments, inset width, loop-cut count) is adjusted only *during* the modal, not after commit. There is no generic operator-parameter registry.

### 3.6 Live preview rendering

- Transform/extrude/inset/bevel/slide: the real mesh (incremental buffer) plus edit helpers updated in place via the `vertexPositionsUpdated` signal (`VertexTransform.js:83` → `EditHelpers.updateHelpersAfterMeshEdit`, `EditHelpers.js:356-426`).
- Loop cut: `Line2` polylines rebuilt on every pointermove (`LoopCutTool.js:485-534`, allocates geometry+material each time).
- Knife: one `Line2` + `Points` for cut line and intersections (`KnifeTool.js:544-620`), pointermove throttled to rAF (`:193-206`).
- Edge slide: cyan rail line (`EdgeSlideTool.js:959-995`).
- Snap target: `SnapManager.createSnapPreview/updateSnapPreview` (`SnapManager.js:465-527`).
- Object outline: screen-space ID-buffer edge detect (`js/core/Outline.js`), rendered as a separate pass every frame (`Editor.js:269`).

---

## 4. Selection and picking

Object mode: `js/tools/Selection.js` – CPU `Raycaster` against every visible object (`:270-284`, `getPickableObjects :298-315`), box select via frustum from `SelectionBox` (`js/tools/SelectionBox.js`), shift toggle/add semantics (`:395-446`), `Box3Helper` highlight (`:448-475`), touch long-press → box select (`:138-268`).

Edit mode: `js/tools/EditSelection.js`:
- Modes `vertex|edge|face` (`subSelectionMode`), the other two sets are always derived (`resolveSelectionGraphFrom*`, `:932-1027`): from vertices → edges whose both ends are selected and faces whose all vertices are selected (**full E and F scan**), from edges → verts + faces whose all edges are selected, from faces → verts + edges. Mode switch re-derives (`:124-140`).
- Picking is **raycast against the edit helper geometries** built by `EditHelpers` (`__VertexPoints` Points with a `vertexId` attribute, invisible `__EdgeLines` `THREE.Line` for raycast next to the visible `LineSegments2`, `__FacePolygons` mesh with `faceIdToRange`) – `EditSelection.js:386-458`. Candidate hits are then filtered by **GPU depth**: `GPUDepthReader` renders the scene with a linear-depth `ShaderMaterial` override and reads back the whole framebuffer (`js/utils/GPUDepthReader.js:66-92`), then compares each candidate's view-space Z with a bias (`:94-125`; edges/faces test midpoint and biased endpoints, `EditSelection.js:674-739`). X-ray mode skips the filter. Nearest candidate is chosen by screen-space distance (`:828-870`).
- `GPUEdgePicker` (`js/utils/GPUEdgePicker.js`) is a second, separate ID-buffer: fat lines coloured by `edgeId+1`, rendered behind a depth-only copy of the object, and `pickSegment` reads back the bounding rect of a screen segment to find every edge crossed by the knife line (`:120-167`). Only the knife uses it.
- Loop/ring/linked: `js/vertex/VertexSelection.js` – edge loop with three modes (`STANDARD` requires valence-4 vertices and picks the edge not sharing a face, `BOUNDARY` follows edges with one face, `NGON_RIM` walks the quad/ngon rim, `:135-233`), ring via opposite edge in quads (`:85-133`), face loop across quads (`:247-287`), linked = BFS over edges (`:59-83`). Alt+click loop select in all three modes (`EditSelection.js:1127-1205`).
- Visualisation: `js/helpers/EditHelpers.js` rebuilds all three helper objects on every `editSelectionRefresh` (after each committed op) and recolours attributes on selection change (`:428-507`); seams are drawn red (`:10-13`). Selected faces get a 15% yellow overlay (`:495-497`).

---

## 5. Mesh operation implementations

| Op | Where | Algorithm | Blender-faithful? | Limits / notes |
|---|---|---|---|---|
| Move/rotate/scale verts | `EditTransformTool.js:319-452` | pivot = selection centroid; delta from handle; local/world space | UX yes; no proportional edit, no individual origins, no pivot options | – |
| Extrude (V/E/F) | `ExtrudeTool.js:312-443` | duplicate selection (`VertexDuplicate`), quad side faces on boundary edges with winding chosen by reference-face normal test, wire edges for lone verts, delete originals; direction = average face normal (`:478-501`) | Approximates `extrude_region` behaviour; no "extrude individual", no "extrude along normals" per-face | boundary from face-count parity only (`VertexSelection.getBoundaryEdges :10-57`) |
| Inset | `InsetTool.js:314-481, 636-655` | per face-island; duplicates faces, offsets boundary verts along `n1+n2` miter direction with `1/max(dot,0.1)` scale | Ad hoc, Blender-like result for simple cases; no thickness/depth, no "individual", no "even offset" toggle | – |
| Bevel (edges only) | `BevelTool.js` (2044 lines) | groups connected selected edges; per vertex valence 1/2/3+ handlers (`:697, 801, 965`) create offset verts along bisectors; `applyBevelFaceSubstitutions` rewrites adjacent faces; bridge quads; corner fill; segments inserted with quadratic-Bezier profile (`:1868-1939`); global miter scale via 1000-iteration Jacobi relaxation (`:459-522`); wheel changes segments by cancel+redo of the whole op (`:184-217`) | **Not** a port of `bmesh_bevel.c`; own construction. No vertex bevel, no profile parameter, no clamp-overlap, no width types (offset/width/depth/percent) | filters out edges with `faceIds.size !== 2` (`filterValidBevelEdges :594`) |
| Loop cut | `LoopCutTool.js` | ray-hit triangle → nearest of its 3 edges → walk opposite edges through quads (`:250-289`); N cuts at `t=(c+1)/(N+1)`; rebuild faces as quad strips | Same idea as Blender's `edgering_select` + subdivide, no smoothness/falloff, no post-cut slide | `// only quads` (`:274`), preview alloc per frame |
| Knife | `KnifeTool.js` | two clicks (or drag) define a screen segment; plane = segment × camera dir; GPU edge pick to find crossed edges; plane/edge intersection; split faces into 2 at 1 or 2 cut points (`:475-526`) | Far from `bmesh_knife`: single straight segment per action, no multi-segment path, no cut-through, no angle constraint | a face crossed 3+ times is skipped (`:501, 514`); vertex snap only |
| Edge/vertex slide | `EdgeSlideTool.js` | per chain vertex, pick a "side A/B" rail edge by consistent face orientation, factor from projected mouse offset | Ad hoc; loosely follows `transform_mode_edge_slide` idea | `pickBestEdge` scoring is a placeholder (`score = 0`, `:872-877` → first candidate wins); aborts on valence>2 (`:352-357`); factor clamped 0..1 |
| Bridge | `VertexBridge.js` | union-find groups → boundary loops → consistent winding → best rotational alignment by distance sum → loft with cuts/smoothness (Bezier-ish) | Similar feature set to Blender bridge (cuts, smoothness, twist) but own maths | exactly 2 loops (`:27-30`) |
| Dissolve V/E/F | `VertexDissolve.js` | vertex: 2-edge case removes from faces; else union faces via boundary loop; edge islands → merged face; face islands → merged face | Same intent as `bmesh_dissolve`; no "dissolve verts → face split" heuristics | boundary loop walk assumes a single simple loop (`orderBoundaryLoop :260-298`) |
| Delete V/E/F, only-edges/faces | `VertexDelete.js` | cascade + orphan cleanup | Fine | – |
| Merge (center/first/last, by distance) | `VertexTopologyUtils.js:85-264` | rewire edges to target, rewrite faces, drop collapsed, remove duplicates; hash-grid + union-find for by-distance (`:287-346`) | Reasonable | writes plain-object position (`:106`) |
| Subdivide edges | `VertexSubdivide.js:381-504` | tri→4, quad→4 with centre, else insert midpoints | Partial | no smoothness, no n-gon split |
| Split / Separate / Duplicate | `EditActions.js:286-457`, `VertexDuplicate.js`, `MeshEditor.extractMeshData` | duplicate then delete originals | Fine | – |
| Flip normals | `MeshEditor.js:243-267` | reverse `vertexIds`, relink edges | Fine | UV corner order is not reversed with it |
| Create face (`F`) | `EditActions.js:122-232`, `SortUtils.js` | sort by best-fit plane angle; flip against neighbours | OK for planar-ish | – |

None of these are ports of Blender source; all are original constructions written incrementally (see git log section). There are no `TODO/FIXME` markers anywhere in `js/`.

---

## 6. Booleans

`manifold-3d@3.4.1` wasm (`js/geometry/MeshDataManifold.js:1-14`). `toManifold` converts MeshData to a Manifold `Mesh` with fan-triangulated faces and `faceID = faceId + idOffset` (`:50-92`); if `manifold.status() !== 'NoError'` it retries on `repairMeshData` output and tags repair faces (`:16-48`). `fromManifoldResult` welds output verts at 1e-5, groups output triangles by `faceID`, extracts boundary loops per group, re-emits a single n-gon per loop (or stitches nested loops into one polygon with bridge edges, `:94-185, 248-290`), falls back to raw triangles for unknown ids. Result replaces the primary object's MeshData via a full `MeshDataCommand` + `RemoveObjectCommand` of the secondary inside a `SequentialMultiCommand` (`js/tools/DifferenceTool.js:179-223`). Union/Intersect tools are copy-paste of Difference with `add/intersect` (diff shown in review: only the method call differs). Not a modifier – destructive, two-object pick-pick-confirm state machine (`:126-163`).

---

## 7. UV and painting (brief)

- `js/uv/AutoUVUnwrap.js`: custom-compiled xatlas with n-gon support (commit `2026-08-21`); builds positions/indices/`faceVertexCount`, applies output UVs back into `meshData.uvs` per face corner (`:137-`).
- `js/uv/UVUnwrap.js` (1315 lines, single commit `67e44d9`): own seam-based unwrap – wedge/island build by DSU over non-seam edges, LSCM with pin selection and CGNR solver (`:512-738`), mirroring fix, min-area-rect / dominant-edge orientation, skyline packing (`:1095-1273`).
- `js/uv/UVEditor.js` + `UVRenderer.js` (WebGL, switched from canvas2d `8f002c9`), `UVSelection.js` with vertex/edge/face modes + sync selection to 3D (`EditSelection.applyUVSelection :1207-1221`), `UVTransformTool/Controls` (move/rotate/scale with own gizmo), `SetUVsCommand`, `SetUVPositionCommand`, `SetSeamCommand`.
- Texture paint (`js/texture/*`): `TexturePainter` (canvas-backed textures per map: map/metalness/roughness/normal), `ProjectionPainter` (spatial hash of triangles in world space, screen-space dab projected through UVs), `TexturePatchFill`/`TextureIslandMask`, `TextureBaker` (multi-view capture → UV-space bake), `NanoBanana` (Supabase edge function calling an image model for AI texture generation), `PaintStrokeCommand` (image-data before/after).

---

## 8. App structure

`js/main.js` → `new Editor().init()`. `js/Editor.js` is a three.js-editor-style service locator: a flat bag of ~90 `Signal`s (`:44-147`, own `Signal` class in `js/utils/Signals.js` – add/remove/dispatch, no priorities, no once) plus one instance of every manager/tool/panel (`:152-183`). Everything takes `editor` in its constructor and pulls what it needs (`editor.vertexEditor`, `editor.editSelection`, `editor.sceneManager.sceneEditorHelpers`, ...). Inherited from the three.js editor: history/command JSON pattern, `Storage` (IndexedDB), `Sidebar.*`/`Menubar.*` file naming, `ObjectLoader` project JSON, `Viewport.Controls`, helpers scene. Everything modelling-related is new.

Scenes: `mainScene`, `sceneHelpers` (light/camera helpers + edit helpers), `sceneEditorHelpers` (gizmos, preview lines, grid) rendered as three passes plus the outline pass each frame (`Editor.js:267-271`). Persistence: on every `historyChanged` the **entire project JSON** (scene with embedded MeshData + render buffers, camera, viewport state, brush) is written to IndexedDB (`Editor.js:250-253`, `:321-353`).

Coupling: modelling algorithms in `js/vertex/*` only depend on `vertexEditor` (MeshData + render sync) and `THREE` maths – they are reasonably UI-free. Everything above that (`js/tools/*`, `js/actions/*`) is fused with DOM events, `TransformControls`, signals, `editSelection`, `toolbar`, `window` listeners; each tool duplicates the same 150-line session/gizmo/listener scaffold. There is **no programmatic API**: no `editor` global (`grep window.editor` → nothing), operations are only reachable by dispatching signals or calling tool methods with a fake pointer event (`transformSolver.event`). An agent could script `vertexEditor.*` and `MeshDataRegion` directly, but not the modal tools.

Mode handling: `Viewport.Controls.switchMode` (`js/ui/Viewport.Controls.js:289-`) guards on exactly one selected mesh, `enterEditMode` (`:365-384`) sets `editSelection.editedObject` and fires `editSelectionRefresh` → helpers rebuilt; only one object can be in edit mode.

---

## 9. Quality assessment

### Structural weaknesses (do not copy)

1. **Undo scope is heuristic.** `MeshDataRegion.expand(…, depth)` with hand-picked depth per op; no check that mutations stayed inside the region. A future op that touches a 3-ring neighbour silently corrupts undo.
2. **Selection not in undo state**; every undo/redo clears the sub-selection.
3. **O(E+F) scans on every click** to derive edges/faces from vertex selection; **O(all vertices)** snapping per pointermove; **full-screen depth readback** per pick; **full helper rebuild** after every commit; **whole-project serialisation to IndexedDB after every command** (includes every MeshData and render-buffer map).
4. **Adjacency without ordering.** No radial/disk cycles → every "walk" is a Set filter; loop/ring/slide all special-case quads and valence-4/≤2; non-manifold input is silently accepted and later mis-handled.
5. **Corner data is bolted on.** UVs in a side map indexed by corner position; no per-corner normals; flip-normals/merge/rebuild-face paths don't carry UVs; smooth/flat/auto shading is per object not per face, and auto normals average by angle rather than by connected smoothing group.
6. **Face identity by sorted vertex set** – cannot represent both windings or two cyclic orders of the same vertices; silently returns the existing face.
7. **Position type ambiguity** (`Vector3` vs plain object) with call sites that assume methods.
8. **Ids in a `Uint16` attribute** for vertex picking; ids never recycled.
9. **Every modal tool re-implements the same scaffold** (six near-identical copies of gizmo/command/session/numeric wiring; three copies of the boolean tool). No `Operator` abstraction with declarative params, so only Bridge gets a redo panel and bevel segments require cancel+rebuild.
10. **Preview geometry churn**: `Line2` geometry/material allocated per pointermove in loop cut.
11. **Render buffer growth by re-`setAttribute`** (new typed arrays, new GPU buffers) and degenerate-triangle masking with a 25%-utilisation rebuild heuristic living inside a command constructor (`MeshDeltaCommand.js:24-30`) – side effects in a constructor.
12. **Ad hoc algorithms**: bevel is a 2k-line original construction with a 1000-iteration relaxation solver and a placeholder scorer in edge slide; knife handles one straight segment and at most two cuts per face; loop cut quads only.
13. **Global-ish state via `userData`**: `meshData`, `renderBuffer`, `shading`, `seam` all live on `mesh.userData` and are prototype-patched after JSON load (`Object.setPrototypeOf`), which is fragile and makes the three.js scene JSON huge.
14. **Dead code**: `QuadrangulateGeometry.js`, `removeCollinearVertices`, most of `NormalCalculator.js` (only used by the OBJ exporter).
15. Service-locator `Editor` with ~90 signals; tools read `editor.cameraManager.camera` at construction and patch it on `viewportCameraChanged`, listeners are never removed (`disable()` only detaches the gizmo, the DOM listeners added in `enableFor` stay attached – `EditTransformTool.js:61-70`).

### Things done well (adopt)

1. **Separate editable mesh from render geometry**, with an explicit adapter and an explicit `renderBuffer` mapping (`vertexId → slots[]`, `faceId → slots[]`, `faceId → triangle range`). Corner-split layout makes per-corner attributes and flat/auto shading trivial.
2. **Incremental render updates** for position edits (write to all slots of a vertex, recompute only affected normals, retriangulate only affected n-gons) – this is what makes 60 fps modal preview possible.
3. **Delta-based undo** with `null` markers for deletions and `captureNewElements` using id watermarks – cheap and serialisable; full snapshots reserved for booleans.
4. **Modal tool lifecycle** start/apply/commit/cancel with a single "source" flag (`gizmo` vs `command`) so keyboard and gizmo drive the same code path; numeric input buffer with caret; header text via signals; snapping integrated into `apply`.
5. **`TransformCommandSolver`**: one place for axis/plane/custom-normal constraint maths reused by all transform-like tools.
6. **Op-local topology change then vertex-only preview** (extrude/inset/bevel build topology on first apply, then only move vertices); cancel = apply before-delta.
7. **GPU ID picking for the knife** (fat-line ID buffer + depth-only object pass) and depth-buffer visibility filtering for vertex/edge/face picks in non-x-ray mode.
8. **Three helper objects with id attributes** for edit-mode drawing (Points with `vertexId`, `LineSegments2` with per-instance colours, face overlay with alpha attribute) and in-place attribute recolouring for selection changes.
9. **`SequentialMultiCommand` with factories**, uuid-stable object recreation in redo (`SeparateSelectionCommand.newObjectUuid`).
10. **Manifold round-trip that preserves n-gons** via `faceID` grouping + boundary loop extraction, with a repair fallback.
11. **Configurable keymap persisted in settings**, double-tap detection, `KeyHandler.startInteraction/endInteraction` mutual exclusion between select/box-select/tools.
12. Blender-axis relabelling of the gizmo for users coming from Blender (`getThreeAxisName`, gizmo recolour) – worth offering as an option.

---

## 10. Git history

510 commits, `2025-05-11` → `2026-09-13`, single author (Sengchor Taing), 8–28 commits/month, steady ~1/day. No AI-tool attributions or co-author trailers in any message. Largest commits by insertions: `67e44d9` "Implement UV unwrap algorithm" (1342, the whole LSCM unwrapper in one go), `45047c1` manual pages (1251), `95c6a05` "Refactor VertexEditor subsystem structure" (914), `8f002c9` UV editor to WebGL (750), `0e76cca` "Refactor MeshData core" (672), `44d34d2` EditHelpers module (636), `7856ae6` split TransformTool (588), `368f53f` manifold non-manifold handling (551). Almost everything else is <500 lines – incremental feature-by-feature work, not big generated dumps (though the uniformly polished JSDoc-free style, `// --- Section ---` comments and the single-commit 1.3k-line LSCM suggest assistant help for the maths-heavy pieces).

Timeline of the modelling core: three.js-editor-like shell (May–Jun 2025) → edit mode + vertex select + `SetVertexPositionCommand` (Jul 2025) → quad `meshData` (Aug 2025) → extrude/loop cut/knife (Sep–Nov 2025) → edge/face modes, box select, snapping (Nov–Dec 2025) → dissolve, `VertexEditor` refactor, command-driven transforms with axis constraints (Jan 2026) → numeric input, bevel, inset, edge slide, loop select (Feb–Mar 2026) → ID-buffer outline, booleans via Manifold, xatlas, batched edge rendering, GPU depth picking (May–Jun 2026) → **render-buffer/slot allocator + `MeshDeltaCommand` migration of every op (Jun 12–22 2026)** → GPU edge picker, texture painting (Jun–Jul 2026) → bridge, operator panel, UV mode/unwrap/seams (Aug–Sep 2026). I.e. the incremental render path and delta undo were retrofitted a year in, after full-rebuild-per-op became the bottleneck.

---

## Lessons for threepipe

### Adopt

- **Editable mesh ≠ render geometry, with an explicit render adapter and a persistent `vertexId/faceId → buffer slot` map.** Keep threepipe's `BufferGeometry` as a derived, corner-split view; write position edits through the slot map; recompute normals/triangulation only for affected faces.
- **Delta undo with id watermarks**: snapshot a neighbourhood before, mark ids ≥ watermark as "created", diff after. But derive the region from the *actual* mutation log (record every element touched inside the mesh API) instead of a guessed `depth` – kokraf's expand-by-2 is the weak link.
- **Include sub-selection (and active element) in the undo payload** so undo restores what the user had selected, as Blender does.
- **One `ModalOperator` base** with `start/apply/commit/cancel`, an input source flag (gizmo/pointer/keyboard/numeric), a `TransformCommandSolver`-style constraint solver shared by all, numeric-buffer input, header status text and confirm/cancel buttons; make every parameter (width, segments, cuts, twist…) declarative so a redo/"adjust last operation" panel comes for free for every op, not just bridge.
- **Topology-once, then vertex-only preview** for extrude/inset/bevel; cancel = apply before-delta.
- **GPU ID buffers for edit-mode picking** (vertex/edge/face id passes) and a depth pass for occlusion; kokraf's mixed CPU raycast + full-screen depth readback per click is the slow version of this – do a single small-rect readback around the cursor.
- **Edit helper objects with id attributes and in-place colour updates**; batched `LineSegments2` for edges.
- **Manifold for booleans**, with faceID-based n-gon reconstruction and an explicit repair step reported to the user.
- Keep Blender's keymap/semantics (G/R/S, GG, X/Y/Z + Shift, wheel for segments, Esc-after-E keeps topology) and the option to relabel axes Blender-style.
- Persist seams, crease, bevel weight, material index etc. as attribute layers **inside** the editable mesh, not on `userData`.

### Avoid

- The bare id-keyed VEF-with-Sets model. If we go the BMesh route, store loops/corners as first-class elements with radial and disk cycles so loop/ring/slide/bevel/knife can walk topology without quad-only special cases; if we go the Blender-`Mesh` route, use flat typed attribute arrays with a corner index and rebuild adjacency caches. Either way corner attributes (UV, normals, colours) must be part of the model.
- Sorted-vertex-set face keys (cannot hold both windings), unbounded monotonic ids stuffed into `Uint16` attributes, positions that may or may not be `Vector3`.
- Full-scan selection derivation, per-pointermove all-vertex snapping, full helper rebuild per commit, full project serialisation per command.
- Storing the mesh model and render maps on `Object3D.userData` with prototype patching after JSON load – give it a proper serialisable class and a threepipe plugin-owned registry.
- Copy-pasted tool scaffolds and per-op ad hoc algorithms: bevel, knife, edge slide, loop cut should be ports of Blender's `bmesh_bevel`, `bmesh_knife` / `mesh_knife`, `transform_mode_edge_slide`, `edgering`/`subdivide_edgering` rather than new constructions (kokraf shows exactly how far ad hoc gets: quads-only loop cut, one-segment knife, placeholder rail scoring, a 1000-iteration relaxation to fix miter widths).
- Render-buffer growth by replacing attributes and `Object3D`-level side effects in command constructors.
- Treating UV/seams/shading as outside the mesh so every command needs an extra `SeamSnapshot`.

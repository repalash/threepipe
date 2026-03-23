---
name: geonode-to-threepipe
description: >
  Convert Blender Geometry Nodes setups into threepipe/three.js procedural generators.
  Use this skill whenever the user wants to: port a Blender geometry nodes graph to the web,
  recreate a Blender procedural generator in threepipe or three.js, reverse-engineer a .blend
  file's node graph into TypeScript/JavaScript, build a web-based configurator from a Blender
  procedural asset, or compare Blender geometry node output against a threepipe implementation.
  Also trigger when the user mentions "geometry nodes to web", "geonode to threepipe",
  "procedural building generator web", "blender nodes to code", or similar phrasing.
---

# Geometry Nodes → Threepipe Generator

Convert Blender Geometry Nodes setups into threepipe procedural generators
that run in Node.js and the browser, with reactive UI and selective recompute.

## Goal

Produce a TypeScript graph that mirrors the **top-level** Blender geometry node tree 1:1:

- Every **node group** the user sees in Blender's node editor becomes a `defineNodeType` node in the TypeScript graph, with the same connections between them.
- Every **modifier input** the user sees in Blender's properties panel becomes a `PropDef` input visible in the browser UI.
- The output is **numerically identical** to Blender (100% full world matrix match) and **visually identical** when rendered with the same 3D assets.
- All building configs (e.g. 3 buildings with different parameters) must match.

### What lives in the graph vs what's inlined

The graph system operates at the **top level only** — the level you see in Blender's node editor. Inside each sub-group (e.g. "Windows points", "Extra"), the logic may be arbitrarily complex with dozens of internal nodes. These internals are **not** represented as graph nodes. Instead, each sub-group becomes a single `defineNodeType` whose evaluate function contains plain TypeScript that implements the sub-group's logic.

Internal nodes like `ShaderNodeMath(ADD)`, `FunctionNodeCompare(LESS_THAN)`, `FunctionNodeBooleanMath(AND)`, `ShaderNodeCombineXYZ` etc. are just JS operators (`+`, `<`, `&&`, `[x,y,z]`). Ported utility functions like `meshGrid()`, `separateGeometry()`, `mapRange()` are called directly. The evaluate function reads like imperative code, not a nested graph.

The graph system gives you: reactive recompute when inputs change, auto-generated UI with sliders/toggles for all parameters, and selective evaluation (changing one seed only recomputes that node and its downstream).

## Mental Model

**Read the Blender C++ source for every node you port.** Don't guess, don't reverse-engineer from outputs, don't assume behavior matches documentation. The source is at `.repos/blender-gn-source/source/blender/`. Every non-trivial bug in this pipeline was solved by reading the exact C++ implementation:

- Vertex ordering → `geometry/intern/mesh_primitive_grid.cc` (X outer, Y inner)
- World matrix formula → `blenlib/BLI_math_matrix.hh` (EulerXYZ rotation matrix)
- Pick Instance index → `nodes/geometry/nodes/node_geo_instance_on_points.cc` (uses ID field)
- ID field fallback → `nodes/geometry/nodes/node_geo_input_id.cc` (falls back to index)
- Collection member order → `nodes/geometry/nodes/node_geo_collection_info.cc` (sorted alphabetically)
- Random Value arg order → `functions/` (INT: hash(id,seed), FLOAT: hash(seed,id))
- **Resample Curve wall count** → `geometry/intern/resample_curves.cc` line 44: `int(curve_length / sample_length) + 1` — uses **floor()** not round()!

The Blender node graph is the specification. The C++ source is how it actually works.

---

## Available Infrastructure

Before writing any code, know what already exists in `@threepipe/plugin-procedural-generation`:

### Graph System (`src/graph/`)
- `defineNode(name, inputs, outputs, evaluate)` — create a node definition
- `defineNodeType(inputs, outputs, evaluate)` — create a reusable node type (like React.FC)
- `defineGraph(nodes, connections)` — create graph with validated connections + topo sort
- `connect(from, outputKey, to, inputKey)` — type-checked connection (validates key names + value types)
- `createRuntime(graph)` — mutable state with `set()`, `get()`, `evaluate()`, `markDirty()`
- `graphUiConfig(runtime, onChange)` — auto-generate UI from PropDef metadata
- `PropDef<T>` — inline UI metadata: `{default: 42, ui: {label: 'Seed', bounds: [0, 999]}}`
- `GraphModule` — standard export interface: `{graphs: [{graph, outputs}], assets, assetsPath}`
- `GeneratedInstance` — `{world_matrix: number[16], object_name: string}`
- `launchGraphViewer(graphModule, options)` — generic browser viewer (loads assets, builds scene, auto UI)

Import from `@threepipe/plugin-procedural-generation/graph` for Node-safe code (no browser deps), or from `@threepipe/plugin-procedural-generation` for browser code (includes viewer).

### Blender Built-ins (`src/blender/`)
- `hash1`, `hash2`, `hash3` — Jenkins Lookup3 hash (from `BLI_noise.hh`)
- `hash_to_float1`, `hash_to_float2`, `hash_to_float3` — hash to [0,1] float
- `randomInt(min, max, id, seed)` — INT Random Value: `hash(id, seed) % range`
- `randomFloat(min, max, id, seed)` — FLOAT Random Value: `hash(seed, id) * range` (**swapped args!**)
- `randomBool(probability, id, seed)` — BOOL Random Value: `hash(id, seed) <= prob`
- `randomVector(min, max, id, seed)` — VECTOR Random Value: per-component
- `meshToCurveSplitTrim(corners, splitPoints)` — Mesh to Curve + Split Edges + Trim
- `alignEulerToEdgeNormal(x0, z0, x1, z1)` — wall rotation from edge normal
- `resampleCurve(segment, moduleWidth, offset)` — Resample Curve (LENGTH mode)
- `pointOnSegment(fp, x0, z0, x1, z1)` — project point onto segment, return t or null
- `normalizeAngle(a)` — wrap to [-PI, PI]
- `meshGrid(sizeX, sizeY, verticesX, verticesY)` — create grid of points (Mesh Grid node)
- `separateGeometry(items, selection)` — split array by boolean selection
- `storeNamedAttribute(items, name, values)` — store per-element attribute
- `inputNamedAttribute(items, name)` — read per-element attribute
- `fromLocRotScale(px, py, pz, rx, ry, rz, sx, sy, sz)` — 4x4 column-major world matrix from position + EulerXYZ + scale (Instance on Points core)
- `joinGeometry(...arrays)` — concatenate arrays preserving point index order (Join Geometry node)
- `transformPoints(points, tx, ty, tz, sx, sy, sz)` — Transform Geometry in Components mode
- `mapRange(value, fromMin, fromMax, toMin, toMax)` — remap value between ranges
- `mapRangeStepped(...)` / `mapRangeSmoothstep(...)` — stepped and smoothstep variants
- `clamp(value, min, max)` — clamp to range
- `mixFloat(factor, a, b)` / `mixVector(factor, a, b)` — linear interpolation
- `compare(a, b, operation)` — comparison by operation enum (LESS_THAN, GREATER_THAN, EQUAL, etc.)
- `booleanMath(a, b, operation)` — boolean logic by operation enum (AND, OR, NOT, XOR, etc.)
- `mathOp(operation, a, b?, c?)` — all ShaderNodeMath operations (ADD, MULTIPLY, POWER, SINE, RADIANS, etc.)

### Blender Source Code

When porting new node types, you need the Blender C++ source for reference. Clone a sparse checkout into your project (only the relevant modules):
```bash
mkdir -p .repos && cd .repos
git clone --filter=blob:none --sparse https://projects.blender.org/blender/blender.git blender-source
cd blender-source
git sparse-checkout set \
  source/blender/blenlib \
  source/blender/functions \
  source/blender/geometry \
  source/blender/nodes/geometry \
  source/blender/nodes/function \
  source/blender/blenkernel \
  source/blender/makesdna \
  source/blender/makesrna
```

Key directories:
```
source/blender/blenlib/        — hash, noise, math (BLI_noise.hh)
source/blender/functions/      — Random Value node (node_fn_random_value.cc)
source/blender/nodes/geometry/ — all geometry nodes
source/blender/nodes/function/ — function nodes
source/blender/blenkernel/     — evaluation internals
```

### Viewer Utilities (`src/viewer/GraphViewer.ts`)
- `loadAssets(viewer, assets, basePath)` — load GLB assets into a ModuleMap
- `buildSceneFromInstances(instances, modules)` — create three.js scene from GeneratedInstance[] with Blender→Y-up conversion

For custom viewers (beyond `launchGraphViewer`), import these directly instead of duplicating.

### Worked Examples
- `examples/buildify-demo-3/graph.ts` — Grid-based buildings: GraphModule, 3 graphs, Group Input pattern
- `examples/buildify-demo-3/script.ts` — thin viewer using `launchGraphViewer(graphModule)`
- `examples/buildify-demo-4/graph.ts` — Edge-based building: ported from .blend, 238/238 matrix match
- `examples/buildify-demo-4/script.ts` — custom viewer with interactive footprint editing (TransformControls + vertex add/remove)
- `src/generators/buildify_demo_1.ts` — Buildify building (monolithic, Blender-accurate)
- `examples/buildify-demo-1/script.ts` — Buildify with custom scene setup

---

## Pipeline

```
Phase 1   Phase 2   Phase 3   Phase 4   Phase 5   Phase 6
Extract → Export  → Map     → Build   → Verify  → Wire UI
Graph     Assets    Nodes     Generator  Numbers   Graph
```

Complete each phase before moving to the next.

---

## Running Blender

The extraction and export scripts require Blender running headlessly.

- If Blender is installed locally, use `blender --background`
- In a sandboxed environment (CI, containers, cloud), ask the user before downloading. Blender's official Linux builds (x86_64) can be downloaded from https://www.blender.org/download/ and run without installation:
  ```bash
  # Check https://www.blender.org/download/ for the latest version (5.1 as of March 2026)
  wget https://download.blender.org/release/Blender5.1/blender-5.1.0-linux-x64.tar.xz
  tar xf blender-5.1.0-linux-x64.tar.xz
  ./blender-5.1.0-linux-x64/blender --background ...
  ```
  Note: ARM (aarch64) builds are not officially available — the user must provide Blender or run scripts on their machine.

---

## Phase 1 — Extract the Node Graph

Run the extraction script (paths relative to `plugins/procedural-generation/`):
```
blender --background file.blend --python porting/scripts/extract_geo_nodes.py \
  -- --output node_graph.json --summary summary.json
```

Read the output. Write a **plain-English summary** before proceeding:
- What does the setup generate?
- Which inputs are user-facing parameters?
- Which sub-groups exist and what does each one do?
- What is the overall dataflow?

Think about *design intent*. A "Grid Mesh → Instance on Points" chain means "tile objects on a grid."

## Phase 2 — Export Assets + Ground Truth

### Assets
```
blender --background file.blend --python porting/scripts/export_assets.py \
  -- --output ./assets/ --manifest asset_manifest.json
```

Only export hand-modeled meshes. Primitive geometry (Grid, Cube) will be created procedurally. The export script automatically **flattens procedural materials** to their dominant flat color before export — the glTF format doesn't support procedural shaders (Noise Texture, Brick Texture, ColorRamp, shader node groups). For materials using Brick Texture, it extracts Color1 as the base color. This loses texture detail but preserves the correct color per material slot.

The export script produces a manifest (`asset_manifest.json`) mapping Blender names → GLB filenames:
- Individual objects (ObjectInfo): `object_Foo_Bar.glb`
- Collection members (CollectionInfo): each member exported individually as `object_Member_Name.glb`. The manifest lists members per collection. **Sort them alphabetically** before using for Pick Instance — CollectionInfo with `Separate Children = true` sorts alphabetically (see Phase 3).

**The `object_name` in your `GeneratedInstance` must use the GLB filename**, not the Blender object name. This is what the viewer uses to look up loaded meshes. A mismatch produces silently invisible instances — no error, just an empty screen.

For collections with multiple members, use `members[point_index % members.length]` to pick per instance (see Pick Instance below). Do NOT export the whole collection as one GLB — that would stack all members at every instance position.

### Ground Truth
```
blender --background file.blend --python porting/scripts/export_ground_truth.py \
  -- --output ./ground_truth/ --configs test_configs.json
```

Test with: default params, min values, max values, a few mid-range.

### Analyze the ground truth before building

After exporting, analyze the ground truth data systematically in Node.js (using `npx tsx`). This saves time vs guessing from the node graph. Check:

1. **Group instances by Z** → find floor levels and how many instances per level
2. **Group by fixed coordinate** (X or Y) → identify wall faces and their positions
3. **Compute spacings** between adjacent instances → verify they match moduleLength
4. **Check object origin** from the ground truth `location` field — all positions include this offset
5. **Identify anomalous levels** — floor levels with different instance counts are likely div/roof/special floors
6. **Compare rotation matrices** across wall faces — identity vs 90° rotation tells you which face

This analysis reveals the grid structure, floor height formula, and wall offset pattern before you write any generation code. The graph JSON tells you the LOGIC, the ground truth tells you the NUMBERS.

## Phase 3 — Map Nodes to Implementations

**How to port a node:** Read the C++ source at `.repos/blender-gn-source/source/blender/` and translate to TypeScript line by line. Don't guess behavior from ground truth — the source is definitive. Key directories: `geometry/intern/` (primitives), `nodes/geometry/nodes/` (geometry nodes), `blenlib/` (math/hash), `functions/` (function nodes).

List every unique `bl_idname`. For each, categorize:

### Already ported (see "Available Infrastructure" above)
`FunctionNodeRandomValue`, Jenkins hash, `meshToCurveSplitTrim`, `alignEulerToEdgeNormal`, `resampleCurve`, etc.

### Structural
- `NodeGroupInput` — create a **Group Input node** using `defineNodeType` with all modifier inputs as PropDefs and a pass-through evaluate (`(inp) => ({...inp})`). This is the only node with settable inputs → the UI generates controls from it. All other nodes receive values via connections from this node. This mirrors Blender's modifier panel.
- `NodeGroupOutput` — no node needed. The `OutputRef` in `GraphModule.graphs[].outputs` points to the last node's output (typically a Join). This is the Group Output equivalent.
- `NodeReroute` — routing convenience in Blender, ignore. Use direct connections.
- `GeometryNodeGroup` — sub-groups become `defineNodeType` evaluate functions (see "What lives in the graph vs what's inlined").

### Inline JS — no utility function needed
These are plain JS operations. Use them directly in evaluate functions.
Note: `ShaderNode*` prefixed nodes are shared across Blender's shader and geometry node systems — the prefix indicates where the node was originally defined, not that it's shader-specific.
- `ShaderNodeMath` — arithmetic operations selected by `operation` enum (ADD, MULTIPLY, POWER, SINE, etc.) → `+`, `*`, `Math.pow()`, `Math.sin()`
- `FunctionNodeCompare` — comparison operators → `>`, `<`, `===`, `>=`
- `FunctionNodeBooleanMath` — boolean logic → `&&`, `||`, `!`
- `ShaderNodeCombineXYZ` / `ShaderNodeSeparateXYZ` — vector pack/unpack → `[x, y, z]` / destructuring
- `ShaderNodeClamp` — `Math.min(Math.max(value, min), max)`
- `GeometryNodeInputPosition` — read vertex positions from geometry attribute

### Already ported as utility functions (see "Available Infrastructure" above)
- `ShaderNodeMapRange` → `mapRange()`, `mapRangeStepped()`, `mapRangeSmoothstep()`
- `ShaderNodeMix` → `mixFloat()`, `mixVector()`
- `GeometryNodeMeshGrid` → `meshGrid()`
- `GeometryNodeSeparateGeometry` → `separateGeometry()`
- `GeometryNodeStoreNamedAttribute` / `GeometryNodeInputNamedAttribute` → `storeNamedAttribute()`, `inputNamedAttribute()`
- `GeometryNodeJoinGeometry` → `joinGeometry()` — preserves point index order
- `GeometryNodeTransform` (Components mode) → `transformPoints()`
- `GeometryNodeInstanceOnPoints` → `fromLocRotScale()` — builds world matrix from position + EulerXYZ + scale

### Data bindings — string pass-through
- `GeometryNodeObjectInfo` — single object reference → GLB path string input
- `GeometryNodeCollectionInfo` — collection reference → array of member GLB paths (from manifest)

The asset path (not Blender object name) should be used as the key to avoid conflicts when merging graphs from multiple .blend files.

### Instance on Points with Pick Instance
When `Pick Instance = true` and `Instance Index` is not connected, Blender implicitly uses the **point index** as the Instance Index (source: `node_geo_instance_on_points.cc` line 31, `implicit_field_on(NODE_DEFAULT_INPUT_ID_INDEX_FIELD)`). The selected member is `members[point_index % members.length]`.

In TypeScript: pass the collection members array and use `members[i % members.length]` per instance.

**Critical: member order.** When `Separate Children = true`, CollectionInfo sorts members **alphabetically** using natural case-insensitive sort (`BLI_strcasecmp_natural` in `node_geo_collection_info.cc` line 136-138). This is NOT the `collection.all_objects` order from Python. Sort the member filenames alphabetically before using them for Pick Instance.

**Critical:** The INT and FLOAT Random Value nodes use DIFFERENT argument order:
- INT: `hash(id, seed)` — id first
- FLOAT: `hash(seed, id)` — seed first
This was verified against Blender's actual output. See `src/blender/random_value.ts`.

## Phase 4 — Build the Generator

Write a `.ts` file that exports a `graphModule: GraphModule`. This is the standard format — both the comparison script (Phase 5) and the browser viewer (Phase 6) consume it directly.

Import from the `/graph` subpath, which works in both Node.js (tsx) and browser (vite):

```typescript
import {
    defineNodeType, defineGraph,
    type GraphModule, type GeneratedInstance,
} from '@threepipe/plugin-procedural-generation/graph'
```

Your graph's output nodes must produce `GeneratedInstance[]` — full 4x4 world matrices per instance, not just positions with a separate rotation value. Use the same column-major format as Blender's depsgraph (see `porting/scripts/output_format.md`).

Use `defineNodeType` for each Blender node group. Internal nodes receive values via connections — only the Group Input node has PropDef UI controls:

```typescript
// Group Input — pass-through node with all modifier inputs as PropDefs
const GroupInputType = defineNodeType(
    {
        seed: {default: 0, ui: {label: 'Seed', bounds: [0, 999], stepSize: 1}},
        count: {default: 5, ui: {label: 'Count', bounds: [1, 50], stepSize: 1}},
        // ... all modifier inputs with PropDef for UI
    },
    { seed: 0, count: 0 },  // outputs mirror inputs
    (inp) => ({...inp}),     // pass-through
)

// Internal node — receives values via connections, no PropDef
const WallsNode = defineNodeType(
    { segments: [] as Seg[], seed: 0, count: 0 },  // raw defaults, connected from GroupInput
    { instances: [] as GeneratedInstance[] },
    (inp) => ({instances: computeWalls(inp.segments, inp.seed, inp.count)}),
)
```

Export the graph module at the end of the file:

```typescript
export const graphModule: GraphModule = {
    graphs: [{
        graph: defineGraph([groupInput, walls, join, ...], [...connections]),
        outputs: [{node: join, output: 'instances'}],
    }],
    assets: ['wall_01.glb', 'wall_02.glb', ...],
    assetsPath: './assets/',
}
```

Each entry in `graphs` is an independent graph with its own runtime. For 3 buildings using the same node tree, create 3 entries with a factory function (see `examples/buildify-demo-3/graph.ts`).

### Key patterns

**Constants vs inputs**: True constants (fixed mesh width) → closure capture. Per-instance values (seed, collection) → node inputs.

**Two-stage variant selection** (for Instance on Points with Pick Instance):
```typescript
const stage1 = randomInt(0, 100, pointIndex, 0)
const stage2 = randomInt(0, 200, stage1, floorSeed)
const variant = stage2 % collectionSize
```

**Coordinate conversion**: The graph outputs Blender Z-up matrices. The viewer (`launchGraphViewer`) converts to three.js Y-up automatically. Do NOT convert in the graph — keep everything in Blender space for ground truth comparison.

## Phase 5 — Verify Numerically

**This is the most critical phase. Do NOT proceed until verification passes 100%.**

### Run the comparison script on your graph module

```bash
./plugins/procedural-generation/porting/scripts/compare.sh my_graph.ts ground_truth.json
```

This imports your graph module, evaluates it, and compares against ground truth. It checks **all 16 values of the world matrix** per instance — not just positions. It reports:
- **Full matrix match**: position + rotation + scale all correct
- **Position-only match**: position correct but rotation or scale wrong (this is NOT a pass)
- **No match**: position not found

**A position-only match is NOT a pass.** A building with correct positions but wrong rotations looks completely wrong visually. The comparison script exits with error code 1 unless 100% of instances are full matrix matches.

### What to compare
- Instance counts must match exactly
- All 16 world matrix values per instance must match within tolerance (1e-2)
- Object names where resolvable (source_resolved=true in ground truth)
- Compare as unordered sets — instance ordering may differ

### When it fails
- Check rotation mismatches first — the script shows gen vs gt rotation matrices
- Common cause: assuming fixed rotation per wall face when it actually varies per point (corner vs side, floor level)
- The ground truth's rotation matrix is what Blender renders — match it exactly

### Debugging position mismatches in filtered instances (extras/props)
If main wall instances match but filtered/scattered extras have wrong positions, the issue is **point index ordering**. The randomBool density filter depends on the exact index of each point.

1. **Export the intermediate point cloud** from Blender to see the exact vertex order:
   ```bash
   blender --background file.blend --python porting/scripts/export_intermediate.py -- \
     --object "Building 1" --node "Group.009" --socket "Input_1"
   ```
   This prints vertex positions in Blender's evaluated order — these indices are what randomBool uses.

2. **Compare** your generator's point ordering against the exported positions. Pay attention to:
   - MeshGrid ordering changes after Transform rotation (column-major vs row-major)
   - SeparateGeometry may reorder or compact indices
   - Join Geometry concatenation order depends on link order in the node tree

3. **Match the ordering** in your `gridSubGroup` or equivalent function, then re-run compare.sh.

### Do NOT proceed until
- The comparison script reports 100% full matrix matches
- Instance counts match
- All 3 (or N) building configs pass, not just the first one

## Phase 6 — Wire into Browser Example

Since your graph.ts already exports `graphModule`, the example is a thin wrapper:

```typescript
import {_testStart, _testFinish} from 'threepipe'
import {launchGraphViewer} from '@threepipe/plugin-procedural-generation'
import {graphModule} from './graph'

_testStart()
launchGraphViewer(graphModule, {
    cameraPos: [30, 25, 40],
    cameraTarget: [0, 15, 0],
}).finally(_testFinish)
```

`launchGraphViewer` handles: asset loading, Blender→three.js coordinate conversion, scene building from `GeneratedInstance[]`, auto-generated UI from PropDef metadata, and selective recompute on UI changes.

### Coordinate conversion

The graph outputs world matrices in **Blender Z-up** coordinates (matching the ground truth). The viewer converts them to **three.js Y-up** automatically. The GLB assets are also Y-up (Blender's glTF exporter handles this). You don't need to do any conversion in the graph — keep everything in Blender space.

### Visual verification (required)

**A 100% numerical match does NOT guarantee correct visual output.** The comparison script checks matrices but not:
- Whether `object_name` resolves to a loaded GLB (mismatches are silent — instance just invisible)
- Whether the coordinate conversion is correct (wrong axis swap = everything rotated 90°)
- Whether the camera can see all the generated geometry

After the comparison passes, **open the example in the browser** and verify:
1. All buildings are visible and not overlapping
2. The number of visible objects matches the instance count (check browser console)
3. Extras/props are visible (not silently missing due to asset name mismatch)
4. Compare side-by-side with Blender's viewport — positions, rotations, proportions should match

For custom scene setup, use `createRuntime` + `graphUiConfig` directly (see `examples/buildify-demo-1/`).

---

## Contributing New Utilities

When you port a new Blender function that could be reused by other generators:

1. **Add to your project's utils** — or to `src/blender/` if working in the threepipe repo
2. **Link to Blender source** — add a comment above the function with the source file path
3. **Add a test** if the function has non-trivial logic (e.g. hash functions, coordinate transforms)

If working in the threepipe repo (maintainers):
- Export new functions from `src/index.ts`
- Update the built-ins table in `porting/guide.md` and the "Available Infrastructure" section of this skill

If working in an external project:
- Consider opening a PR to `@threepipe/plugin-procedural-generation` to contribute the utility upstream
- Include the Blender source reference and verification test

Example: when porting the Buildify building, we discovered that Blender's FLOAT Random Value uses swapped argument order (`hash(seed, id)` instead of `hash(id, seed)`). This was added to `random_value.ts` with the Blender source reference and verified against Blender's output.

---

## Learnings from Real-World Porting

### Asset references live on the modifier, not the node
ObjectInfo and CollectionInfo nodes in the graph often have empty `pointer_refs` — the actual object/collection is assigned via the modifier's input overrides, not on the node socket default. The extraction script's JSON captures these in `modifiers[].input_overrides` as `{"_ref": "OBJECT", "name": "..."}`. Always check both the node tree AND modifier overrides when discovering referenced assets.

### Hidden assets need view layer linking for export
Assets referenced by geometry nodes are often in collections not linked to the scene's active view layer. Blender's glTF exporter requires objects to be selectable (in the view layer). The export script temporarily links collections/objects to the scene collection before export and unlinks them after. Without this, `obj.select_set(True)` throws `RuntimeError: Object cannot be selected because it is not in View Layer`.

### Nested geometry node instances lose source identity
Blender's depsgraph Python API cannot access instance domain attributes ([devtalk](https://devtalk.blender.org/t/is-there-a-way-to-access-named-custom-instance-attributes-generated-with-geometry-nodes-in-python/29143), [blenderartists](https://blenderartists.org/t/accessing-evaled-object-instance-attribute-from-geometry-nodes/1538038)). When geometry nodes use ObjectInfo → Instance on Points → Join Geometry, the depsgraph reports the parent object name for all joined instances instead of the individual module names.

**Impact:** The ground truth export captures correct positions/rotations/matrices for all instances, but `object_name` may show the parent object (e.g. "Building 1") instead of the actual module (e.g. "B1 Window") for instances created inside geometry nodes.

**What still works:**
- Collection-instanced objects (extras, props) get correct source names
- All instance positions, rotations, and scales are accurate
- Instance count is accurate

**Verification strategy:** For instances with unresolved source names, verify positions only. The module assignment is deterministic from the procedural logic — if positions match, modules match. The TypeScript evaluate function determines which module goes where based on point classification (corner vs side, floor level).

### Grid-based building generators use offset wall positions
When geometry nodes create wall grids using MeshGrid, the wall face is offset by `moduleLength / 2` beyond the grid edge. The wall position formula is `(dimension + 1) * moduleLength / 2`, not `dimension * moduleLength / 2`. This means a building with X=5, moduleLen=3 has its front wall at Y = (3+1)*3/2 = 6, not 3*3/2 = 4.5.

Div and roof floors use the **inner grid** (no offset) while window and ground floors use the **outer grid** (with offset).

### Position-only matching is insufficient
Comparing just the XYZ position of instances (matrix indices 12,13,14) catches placement errors but misses rotation and scale errors. Two instances at the same position but different rotations look completely different visually. Always compare the full 16-value world matrix using the standard comparison script. A "200/200 position match" with 36 rotation mismatches means the building looks wrong.

### Ground truth positions include object origin offset
Instance world matrices in the ground truth include the Blender object's origin position. When comparing generated positions against ground truth, subtract the object origin (available in the `location` field of the ground truth JSON). For example, Building 1 has origin at (-0.091, 0, 0), which shifts all X positions by -0.091.

### Extraction script socket defaults may be misleading
The extraction script (`extract_geo_nodes.py`) captures each socket's `default_value` field. For unlinked sockets, this IS the value used. But the `default_value` shown may be Blender's **UI socket default** (e.g. 0.5 for ShaderNodeMath ADD.Value_001), not the value the user typed in. If the user set Value_001 to 1.0 in the Blender UI, the extraction may still show 0.5.

**Workaround:** Don't trust socket defaults for critical formulas. Derive them empirically from the ground truth by solving for the unknown value. Or temporarily link the socket to the Group Output and evaluate.

### Div/roof corners use clockwise rotation assignment
Inner grid corners (div floor, roof floor) do NOT inherit the rotation of the wall face they're geometrically on. Instead, each corner gets the rotation of the wall face to its **clockwise left** (as seen from above):
- Corner at (-X, -Y) → left wall rotation (Rz(-90°))
- Corner at (+X, -Y) → front wall rotation (Rz(0°))
- Corner at (+X, +Y) → right wall rotation (Rz(+90°))
- Corner at (-X, +Y) → back wall rotation (Rz(180°))

All inner grid corners have scale [1,1,1] (no flip), unlike outer grid corners which use scale flips.

### Resample Curve LENGTH mode uses floor(), not round()
Blender's Resample Curve in LENGTH mode computes point count as `int(curve_length / sample_length) + 1` (source: `geometry/intern/resample_curves.cc` line 44). The `int()` cast is a floor operation. The number of wall segments (instances) = count - 1 = `floor(curve_length / sample_length)`.

Using `Math.round()` instead of `Math.floor()` produces different wall counts for many segment lengths, causing instance count mismatches. This was discovered during demo-4 porting where the .blend uses moduleWidth=3 but `round(len/3)` gave 38 walls/floor while `floor(len/3)` correctly gave 28.

### Edge-based buildings: coordinate conversion at the boundary
For edge-based generators (Buildify-style, using `meshToCurveSplitTrim` + `alignEulerToEdgeNormal`), the compute functions work in three.js Y-up internally. Convert to Blender Z-up only at the output boundary using:
```typescript
// three.js (tx, ty_height, tz_depth) → Blender (tx, -tz, ty)
fromLocRotScale(tx, -tz, ty, 0, 0, rotY, scaleX, 1, 1)
```
The rotation value (rotY in three.js = rotZ in Blender) is the same number — both represent rotation around the up axis.

### Export base geometry without modifiers
When exporting a mesh that has a GeometryNodes modifier (e.g. building_base for the roof plane), `export_apply=True` in the glTF exporter evaluates all modifiers first — you get the full generated building, not the base mesh. Remove modifiers before export: `for m in list(obj.modifiers): obj.modifiers.remove(m)`. Also apply the object transform (`bpy.ops.object.transform_apply(location=True)`) so vertices are in world space, matching the wall placement coordinates.

### Blender 5.0 glTF exporter changes
The `export_colors` parameter was removed from `bpy.ops.export_scene.gltf()` in Blender 5.0. Distro-packaged Blender (e.g. Alpine) may not bundle `numpy` which the glTF exporter requires — install it separately if you get `ModuleNotFoundError: No module named 'numpy'`. Official Blender downloads bundle numpy.

---

## Key Principles

- **Read the Blender C++ source.** Don't guess how a node works. Translate the source line by line. The source is at `.repos/blender-gn-source/source/blender/`.
- **Numbers first, then visuals.** Verify numerically with `compare.sh`, then visually in the browser. A 100% numerical match does NOT mean the visual output is correct — asset name mismatches and coordinate conversion bugs are invisible to the comparison.
- **`object_name` = GLB filename.** Not the Blender object name. A mismatch is silent — instances just disappear.
- **Graph outputs Blender coordinates.** Keep everything in Z-up for ground truth comparison. The viewer handles Y-up conversion automatically.
- **Use `defineNodeType` for repeated node groups.** One definition, multiple instances with different defaults.
- **PropDef for UI metadata.** `{default: 42, ui: {label: 'Seed', bounds: [0, 999]}}` auto-generates sliders.

---

## Known Limitations

Scripts tested on Blender 4.0.2 and **5.0.1** (Alpine Linux aarch64).
Blender 5.0 fixes applied: `export_colors` param removed from glTF exporter, view layer linking for hidden objects/collections, modifier input override scanning for ObjectInfo/CollectionInfo refs.
NOT tested on:
- Blender 5.1+
- Blender 3.x (fallback code path exists in extract_geo_nodes.py but is untested)
- Files with deeply nested instance hierarchies (ObjectInfo + CollectionInfo tested, but source identity lost for nested instances)
- Curve-heavy node setups (only edge-based Buildify tested)
- Node graphs with 1000+ nodes
- Boolean modifier params must be int (0/1), not Python bool — the export script handles this

## Scripts

Located at `porting/scripts/`. Tested on Blender 4.0.2 and 5.0.1.

| Script | Purpose |
|---|---|
| `extract_geo_nodes.py` | Dump node tree to JSON (all nodes, links, sockets, sub-groups, recursive) |
| `export_assets.py` | Export referenced collections/objects as .glb + manifest |
| `export_ground_truth.py` | Evaluate modifier, export instance data as JSON (full world matrices) |
| `export_intermediate.py` | Export intermediate point cloud from any node input — for debugging point ordering |
| `compare.sh` | Convenience wrapper — evaluates a graph .ts and compares against ground truth |
| `compare_graph.ts` | Import a GraphModule, evaluate, compare all 16 matrix values against ground truth |
| `compare_ground_truth.ts` | Compare raw JSON files — full 16-value matrix comparison (legacy/debugging) |
| `create_test_blend.py` | Create minimal test .blend for script validation |
| `output_format.md` | Standard format for GraphModule outputs and ground truth JSON |
| `tsconfig.json` | Path aliases for tsx to resolve `@threepipe/plugin-procedural-generation/graph` |

## External References

- **Threepipe docs:** https://threepipe.org/guide/introduction.html
- **Threepipe UI config:** https://threepipe.org/guide/ui-config.html
- **Three.js docs:** https://threejs.org/docs/
- **Blender Python API:** https://docs.blender.org/api/current/
- **Blender Geometry Nodes:** https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/
- **tree_clipper** (bl_rna reference): https://github.com/Algebraic-UG/tree_clipper
- **geonodes** (node type reference): https://github.com/al1brn/geonodes
- **Node To Python** (readable spec): https://github.com/BrendanParmer/NodeToPython

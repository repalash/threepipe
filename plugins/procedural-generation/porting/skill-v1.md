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

**Read the Blender C++ source for every node you port.** Always read and port from source FIRST. Reverse-engineering from ground truth output is acceptable for verification and debugging, but never as a substitute for reading the source. Don't brute-force IDs or values against ground truth to make numbers match — if something doesn't match, read the source to understand why. The source is at `.repos/blender-gn-source/source/blender/`. Every non-trivial bug in this pipeline was solved by reading the exact C++ implementation:

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

Import from `@threepipe/plugin-procedural-generation/graph` for graph code (works in both Node.js and browser — three.js types like BufferGeometry work in Node.js with polyfill). Import from `@threepipe/plugin-procedural-generation` for the full package including viewer. The `/graph` subpath exports Distribute, Instance, and all Blender utilities alongside the graph system.

### Blender Built-ins (`src/blender/`)
- `hash1`, `hash2`, `hash3` — Jenkins Lookup3 hash (from `BLI_noise.hh`)
- `hash_to_float1`, `hash_to_float2`, `hash_to_float3` — hash to [0,1] float
- `randomInt(min, max, id, seed)` — INT Random Value: `hash(id, seed) % range`
- `randomFloat(min, max, id, seed)` — FLOAT Random Value: `hash(seed, id) * range` (**swapped args!**)
- `randomBool(probability, id, seed)` — BOOL Random Value: `hash(id, seed) <= prob`
- `randomVector(min, max, id, seed)` — VECTOR Random Value: per-component
- `meshToCurveSplitTrim(corners, splitPoints)` — Mesh to Curve + Split Edges + Trim
- `alignEulerToEdgeNormal(x0, z0, x1, z1)` — wall rotation from edge normal
- `resampleCurve(segment, moduleWidth, offset)` — Resample Curve (LENGTH mode). Uses `Math.floor()` matching Blender source (`resample_curves.cc:44`).
- `pointOnSegment(fp, x0, z0, x1, z1)` — project point onto segment, return t or null
- `normalizeAngle(a)` — wrap to [-PI, PI]
- `meshGrid(sizeX, sizeY, verticesX, verticesY)` — create grid of points (Mesh Grid node)
- `separateGeometry(items, selection)` — split array by boolean selection
- `storeNamedAttribute(items, name, values)` — store per-element attribute
- `inputNamedAttribute(items, name)` — read per-element attribute
- `yUpToZUp(x, y, z)` — convert three.js Y-up coordinates to Blender Z-up. **Use this when positions come from GLB geometry** (e.g. `distributePointsOnFaces` on a loaded mesh). Returns `[blender_x, blender_y, blender_z]`.
- `fromLocRotScale(px, py, pz, rx, ry, rz, sx, sy, sz)` — 4x4 column-major world matrix from position + EulerXYZ + scale (Instance on Points core). **All inputs must be in Blender Z-up.** If positions come from GLB geometry, convert with `yUpToZUp` first.
- `joinGeometry(...arrays)` — concatenate arrays preserving point index order (Join Geometry node)
- `transformPoints(points, tx, ty, tz, sx, sy, sz)` — Transform Geometry in Components mode
- `mapRange(value, fromMin, fromMax, toMin, toMax, clamp=true)` — remap value between ranges. **Clamps by default** (matching Blender's Map Range node). Pass `clamp=false` for unclamped.
- `distributePointsOnFaces(geometry, options)` — exact port of Blender's `GeometryNodeDistributePointsOnFaces` (from `node_geo_distribute_points_on_faces.cc`). Supports RANDOM and POISSON modes with Blender's exact LCG RNG, round_probabilistic, per-triangle seeding, KDTree Poisson elimination, and deterministic point IDs. Options: `{method, density, densityFactor?, minDistance?, seed}`. Returns `{positions: Vector3[], normals: Vector3[], ids: number[], baryCoords: Vector3[], triIndices: number[]}` — positions are in the geometry's coordinate space (Y-up for GLB). `baryCoords` and `triIndices` enable interpolation of per-vertex attributes (UVs, colors) at scatter points via `interpolateScatterUVs()`.
- `interpolateScatterUVs(geometry, baryCoords, triIndices)` — interpolate UV coordinates from mesh triangle vertices at scatter point positions using barycentric coordinates. Returns `[u, v][]` per scatter point. Use instead of bounding-box UV approximation for texture-based density filtering.
- **`scatterToInstances(result, options)`** — **USE THIS for all scatter-to-instance pipelines.** Takes the result from `distributePointsOnFaces` and produces `GeneratedInstance[]` with coordinate conversion (yUpToZUp) baked in. Handles: position conversion, random rotation (per point ID), random scale (per point ID), `fromLocRotScale`. Options: `{objectName, scaleRange, scaleSeed?, rotationSeed?, rotationRange?, filter?, pickObject?}`. This eliminates the most common porting bug (forgetting yUpToZUp).
- `mapRangeStepped(...)` / `mapRangeSmoothstep(...)` — stepped and smoothstep variants
- `clamp(value, min, max)` — clamp to range
- `mixFloat(factor, a, b)` / `mixVector(factor, a, b)` — linear interpolation
- `compare(a, b, operation)` — comparison by operation enum (LESS_THAN, GREATER_THAN, EQUAL, etc.)
- `rotateEulerAxisAngleLocal(euler, axis, angle)` / `rotateEulerAxisAngleObject(...)` — Rotate Euler node (from `node_fn_rotate_euler.cc`). Local = multiply on right, Object = multiply on left.
- `eulToMat3(rx, ry, rz)` / `mat3ToEul(m)` / `axisAngleToMat3(ax, ay, az, angle)` / `mulMat3(a, b)` — rotation matrix utilities (from `math_rotation.c`)
- `sampleImageTexture(tex, u, v)` — sample red channel of image texture at UV coords with bilinear interpolation (from `node_geo_image_texture.cc`). `tex: {data, width, height, channels}`.
- `colorRampLinear2(fac, pos0, pos1)` — 2-stop linear ColorRamp (from `node_shader_valtorgb.cc`). Returns 0-1.
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

### When to use three.js vs Blender utilities

**Use three.js directly** for standard vector/matrix math:
- Vector operations (add, subtract, cross, dot, normalize) → `Vector3`
- Rotation → `Vector3.applyAxisAngle()`, `Vector3.applyQuaternion()`
- Matrix transforms → `Matrix4.compose()`, `Vector3.applyMatrix4()`
- Euler rotation → `Euler`, `Quaternion.setFromEuler()`

These are NOT Blender-specific — they're the same math everywhere. Don't rewrite them.

**Use the Blender utilities** (`src/blender/`) for Blender-specific behavior:
- `randomInt/Float/Bool` — Blender's exact Jenkins hash + argument order
- `mapRange` — Blender's clamp-by-default behavior
- `resampleCurve` — Blender's `floor()` point count formula
- `fromLocRotScale` — Blender's exact EulerXYZ matrix construction
- `meshGrid` — Blender's exact vertex ordering (X outer, Y inner)

**Before creating a new utility**, check:
1. Does three.js already provide it? → Use three.js
2. Is it a standard algorithm (Catmull-Clark subdivision, KDTree, etc.)? → Find an existing open-source implementation (npm package, GitHub repo, three.js addon) and port/use it. Clone repos into `.repos/` for reference. Don't reinvent standard algorithms from scratch, but don't skip them either.
3. Is it Blender-specific behavior? → Port from the C++ source with a link to the file
4. Is it just inline math (5 lines of sin/cos)? → Keep inline, don't create a utility

**Never skip a node because it's "too complex to port."** If the node uses a standard algorithm, find an existing implementation to port from. If it uses Blender-specific logic, port from the Blender source. If you truly cannot port it, flag it as a blocker and ask — do not silently skip or approximate.

**three.js works in Node.js** with a polyfill (see `experiments/tp-cf-test/src/polyfill.ts`). So generators and comparison scripts can import three.js for math — there's no need to maintain parallel "Node-safe" math implementations.

### Viewer Utilities (`src/viewer/GraphViewer.ts`)
- `loadAssets(viewer, assets, basePath)` — load GLB assets into a ModuleMap
- `buildSceneFromInstances(instances, modules)` — create three.js scene from GeneratedInstance[] with Blender→Y-up conversion

For custom viewers (beyond `launchGraphViewer`), import these directly instead of duplicating.

### Worked Examples
- `examples/buildify-demo-3/graph.ts` — Grid-based buildings: GraphModule, 3 graphs, Group Input pattern
- `examples/buildify-demo-4/graph.ts` — Edge-based building: ported from .blend, 238/238 matrix match
- `examples/buildify-demo-4/script.ts` — custom viewer with interactive footprint editing (TransformControls + vertex add/remove)
- `examples/flower-demo/` — Procedural flower using FlowerGenerator (AProceduralGenerator) with auto-UI
- `examples/flowers-on-building/graph.ts` — Composition: mixed outputs (GeneratedInstance[] + mesh scatter) in one graph
- `examples/flower-scattering/graph.ts` — Grass + flower scatter on terrain: 4 collections, texture-based density filtering, collection instancing (Separate Children=false for grass), Pick Instance for flowers, Random Orientation sub-group
- `examples/pebble-scatter/graph.ts` — 3 pebble sizes on ground mesh: POISSON + RANDOM distribution, custom viewer with ground geometry
- `src/generators/buildify_demo_1.ts` — Buildify building (monolithic, Blender-accurate)
- `src/generators/FlowerGenerator.ts` — Procedural rose: AProceduralGenerator using three.js for math

---

## Pipeline

```
Phase 1   Phase 2   Phase 3   Phase 4   Phase 5   Phase 6   Phase 7
Extract → Export  → Map     → Build   → Verify  → Wire UI → Library
Graph     Assets    Nodes     Generator  Numbers   Graph     Feedback
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

Only export hand-modeled meshes. Primitive geometry (Grid, Cube) will be created procedurally. The export script automatically **flattens procedural materials** to flat colors for glTF export. It handles ALL material types:
1. Principled BSDF with linked Base Color → traces the node chain (ShaderNodeGroup, Mix, Brick, RGB)
2. Trace fails → uses `material.diffuse_color` (viewport color) as fallback
3. No Principled BSDF (MixShader, Anisotropic, etc.) → replaces Surface with temp Principled BSDF using `diffuse_color`
4. CURVEs with materials → also flattened
5. Collection-instancing EMPTYs → exports all mesh/curve children of the instanced sub-collection as a single GLB

**After exporting, VERIFY material colors before proceeding.** Check each GLB's JSON chunk for `pbrMetallicRoughness.baseColorFactor`. If any material is white/missing, the export is broken — do not continue to Phase 3.

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

### Ground truth limitations
The export script captures **instances** from the depsgraph. Node trees that produce **geometry** (not instances) will have 0 instances in the ground truth. This does NOT mean the tree is unimportant or can be skipped. Examples: a floor made of instanced cubes that gets `Realize Instances` before output, a subdivided mesh with vertex displacement. If a tree has 0 instances in GT, inspect the node graph to understand what it produces and port it accordingly.

**Never skip a node tree without explicit approval.** If a required node isn't ported yet, report it as a blocker — don't approximate or skip silently. Every tree in the .blend file exists for a reason.

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

### Instance on Points with Pick Instance (Separate Children = true)
When `Pick Instance = true` and `Instance Index` is not connected, Blender implicitly uses the **point index** as the Instance Index (source: `node_geo_instance_on_points.cc` line 31, `implicit_field_on(NODE_DEFAULT_INPUT_ID_INDEX_FIELD)`). The selected member is `members[point_index % members.length]`.

In TypeScript: pass the collection members array and use `members[i % members.length]` per instance.

**Critical: member order.** When `Separate Children = true`, CollectionInfo sorts members **alphabetically** using natural case-insensitive sort (`BLI_strcasecmp_natural` in `node_geo_collection_info.cc` line 136-138). This is NOT the `collection.all_objects` order from Python. Sort the member filenames alphabetically before using them for Pick Instance.

### Instance on Points with Separate Children = false (whole collection)
When `Separate Children = false`, each scatter point instances the **entire collection**. Every child object is placed at that scatter point, each with its own transform composed from the scatter point transform and the child's local transform within the collection.

In Blender's depsgraph, each child produces a separate instance with world matrix = `scatter_matrix @ child_local_matrix_in_collection`. The ground truth export captures these per-child matrices — so for a collection with 4 members, each scatter point produces 4 instances with:
- **Same rotation/scale** (from the scatter point) but **different positions** (scatter position + child offset transformed by scatter rotation)
- The position difference between children at the same scatter point = `R_scatter * s_scatter * child_local_position`

**In TypeScript:** For each scatter point, create one `GeneratedInstance` per collection member. Since our GLB export (`export_apply=True`) bakes each child's local transform into the mesh vertices, applying the scatter matrix to each child's GLB produces the correct visual result automatically. Use the same `fromLocRotScale(scatter_pos, scatter_rot, scatter_scale)` for all members at a point.

**Comparison note:** The comparison against ground truth may show position mismatches because the ground truth matrices include the composed child offset, while our matrices are the same for all children at a scatter point. This is expected — the visual output is equivalent because the GLB geometry already includes the child offset. When comparing, group by scatter point and verify the scatter-level transform matches.

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

**Coordinate conversion**: The graph outputs Blender Z-up matrices. The viewer (`buildSceneFromInstances`) converts to three.js Y-up automatically. Do NOT convert in the graph — keep everything in Blender space for ground truth comparison.

**CRITICAL: GLB geometry is Y-up, `fromLocRotScale` expects Z-up.** When you scatter points on a loaded GLB mesh (e.g. via `distributePointsOnFaces`), the returned positions are in three.js Y-up space. You MUST convert them to Blender Z-up before passing to `fromLocRotScale`:
```typescript
const [bx, by, bz] = yUpToZUp(pos.x, pos.y, pos.z)  // Y-up → Z-up
const matrix = fromLocRotScale(bx, by, bz, rx, ry, rz, sx, sy, sz)
```
Without this conversion, everything renders rotated 90 degrees (appears as a wall instead of ground).

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

### Mandatory: run comparison and paste output
You MUST run `compare.sh` (or the compare_graph.ts script) and include its output in your progress report. Do not claim "verification should pass" or "positions look correct" — run the actual comparison and paste the results. If Blender is not available, run the graph in Node.js with `npx tsx` and compare a sample of instance matrices against the ground truth JSON programmatically.

### UV interpolation for Image Texture on scattered points
When the Blender graph uses Image Texture nodes on scattered points (e.g. density maps, masks), the UV coordinates must be interpolated from the triangle vertices at the scatter point's barycentric position. Do NOT approximate UVs from the mesh bounding box — this gives wrong spatial distribution. If `distributePointsOnFaces` doesn't return UVs, either extend it to do so or compute barycentric UV interpolation from the triangle the point landed on.

### Reactivity check (required)
After the numerical match passes, verify the graph is actually reactive:
1. Change a Group Input parameter (e.g. seed, count, density)
2. Re-evaluate the graph
3. Verify the output **changed** — different instance count, different positions, or different matrices
4. If the output is identical regardless of input changes, the port is broken — the evaluate functions are ignoring their inputs (likely using pre-baked data instead of computing)

This catches pre-baked graphs that trivially pass numerical verification but are non-functional.

### Do NOT proceed until
- The comparison script reports 100% full matrix matches
- Instance counts match
- All 3 (or N) building configs pass, not just the first one
- Changing at least one Group Input parameter changes the output (reactivity check)

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
5. **Change every UI slider** and verify the scene updates. If any input doesn't affect the output, the port is incomplete — the evaluate function is ignoring that input or using pre-baked data

For custom scene setup, use `createRuntime` + `graphUiConfig` directly (see `examples/buildify-demo-1/`).

### Pre-delivery verification checklist (MANDATORY)

Before presenting any port as "done", run ALL of these checks. Do not skip any.

**Asset checks (run in Node.js via `npx tsx`):**
1. Every GLB in the assets list loads with non-zero vertex count. If any has 0 verts or tiny file size (<200 bytes), the export is broken — object may be `hide_render=True` or have unevaluated modifiers.
2. Every GLB has material colors (check for `baseColorFactor` in the file). White/gray (0.8, 0.8, 0.8) is suspicious — verify it's the intended color in Blender, not a fallback.
3. Ground/surface meshes used for scatter: verify `getWorldGeometry()` returns non-null geometry with expected vertex count.

**Graph checks (run in Node.js):**
4. ALL node trees in the .blend are accounted for. "0 instances in GT" does NOT mean skip — check what the tree produces.
5. Instance counts match GT (within expected triangle-ordering tolerance).
6. No pre-baked/hardcoded data (JSON dumps of positions, IDs, etc.). Everything must be computed at runtime.
7. Reactivity: changing at least one parameter changes the output.

**Visual checks (run in browser):**
8. No "asset not loaded" warnings in console.
9. All objects have correct colors (not white unless intended).
10. Scale/proportions visually match Blender.
11. Animation plays if applicable (not just a dead slider).
12. No performance issues (rebuild only what changes per frame, not the entire scene).

**Code checks:**
13. `index.html` uses the standard importmap pattern (not `src="./script.ts"`).
14. New utilities are added to the library (not left inline in graph.ts).
15. No unused imports.

---

## Phase 7 — Library Feedback (MANDATORY)

**Every port must feed back into the library.** This is how the package grows. If you ported new Blender nodes or created new utilities, they must be properly integrated so the NEXT port can use them.

### For every new utility or Blender node port:

1. **Place in `src/blender/`** — one file per major node (e.g. `distribute_points_on_faces.ts`), or add to existing files for small functions
2. **Link to Blender source** — comment above every function with the exact source file path and line numbers
3. **Export from both entry points:**
   - `src/graph/index.ts` (the `/graph` subpath — available to graph files and Node.js scripts)
   - `src/index.ts` (the main entry — available to browser code)
4. **Write tests** — at minimum: determinism (same inputs → same output), edge cases (zero/empty), and correctness against known values
5. **Update this skill's "Available Infrastructure" section** — add the new function with its signature, source reference, and any gotchas. This is how the next agent knows what's available.
6. **Update `issues/open/procedural-generation-status.md`** — add to the "Blender Utilities" list and mark any "Not Yet Ported" nodes as done
7. **Update the tracking file** for this port (`issues/open/<port-name>.md`) — list every new utility added, with file paths

### What to report

At the end of every port, include a **Library Additions** section in the tracking file:

```markdown
## Library Additions
New utilities added to the package by this port:

| File | Function | Blender Source | Tests |
|------|----------|----------------|-------|
| `src/blender/distribute_points_on_faces.ts` | `distributePointsOnFaces()` | `node_geo_distribute_points_on_faces.cc` | `tests/distribute_points_on_faces.test.ts` |
| `src/blender/math_nodes.ts` | `smoothMin()` | `node_shader_math.cc` | (added to existing) |
```

This table is how the maintainer (or next agent) knows what was added and can verify it's correct.

### Why this matters

The strategy is: each `.blend` file port expands the library of reusable Blender node implementations. Without this feedback step, utilities get created but not registered — the next port doesn't know they exist and reimplements them. This is the most common source of duplicate code and wasted work.

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

### Procedural mesh generators use AProceduralGenerator, not GraphModule
Generators that create mesh geometry (like the flower) should use `AProceduralGenerator` with `ProceduralGeneratorPlugin` — not `GraphModule` with `GeneratedInstance[]`. `AProceduralGenerator` provides auto-UI, dirty-flag regeneration, and the Generate dropdown. The graph system (`GraphModule`) is for instance-placement generators where selective recompute between independent nodes matters.

For **composing** both types (e.g., flowers on a building), use a graph where:
- Building nodes output `GeneratedInstance[]` (placed from GLB assets)
- Procedural mesh nodes output plain vertex data (Node-safe arrays)
- The viewer renders both via runtime type detection
- The comparison script verifies both (instance matrices + vertex positions)

See `examples/flowers-on-building/graph.ts` for a complete example.

### Graph outputs: instances or mesh vertex data
The `OutputRef` in `GraphModule.graphs[].outputs` is type-agnostic — it points to any node output. The viewer and comparison script detect the type at runtime:
- `GeneratedInstance[]` (array with `world_matrix`) → placed from loaded GLB assets. Comparison checks 16-value matrices.
- Plain data object with `rings` (vertex arrays + placement positions) → built into BufferGeometry. Comparison checks vertex positions.
- `null` → skipped.

All outputs must be **plain data** (no three.js types). This ensures they work in both Node.js (comparison) and browser (rendering). See `examples/flowers-on-building/graph.ts` for a graph with both output types.

### GLB geometry does NOT include node transforms
When loading a GLB via three.js GLTFLoader, `mesh.geometry` contains raw vertex data in the mesh node's LOCAL space. Transforms like the Z→Y coordinate conversion, object positions, and rotations are stored in the node hierarchy (`mesh.matrixWorld`), NOT in the vertex buffer. If you extract geometry for computation (scatter, distance calculations, etc.), you MUST apply the world matrix first:
```typescript
obj.updateMatrixWorld(true)
const geom = child.geometry.clone()  // clone to avoid mutating shared/cached buffer
geom.applyMatrix4(child.matrixWorld)
```
Without this, scatter positions will be in the wrong coordinate frame — rotated, offset, or both. The `loadAssets` function in GraphViewer.ts handles this automatically.

### GLB triangle ordering differs from Blender's internal order
The glTF exporter reorders vertices and faces for GPU cache optimization. Scatter algorithms seeded per-triangle (`hash2(tri_i, seed)`) will produce different individual positions than Blender, even with identical RNG. For scatter-based systems (grass, flowers), this is acceptable — the density distribution matches but specific positions differ. For exact position matching, you would need to export mesh data in Blender's internal order (custom Python export, not glTF).

### Blender 5.0 glTF exporter changes
The `export_colors` parameter was removed from `bpy.ops.export_scene.gltf()` in Blender 5.0. Distro-packaged Blender (e.g. Alpine) may not bundle `numpy` which the glTF exporter requires — install it separately if you get `ModuleNotFoundError: No module named 'numpy'`. Official Blender downloads bundle numpy.

---

## Browser Example Patterns (MUST follow exactly)

**DO NOT use raw Tweakpane API** (`pane.addFolder`, `pane.addBinding`). Use threepipe's wrapper: `ui.setupPluginUi()` for built-in plugins, `graphUiConfig()` for graph controls. Raw Tweakpane calls break the UI silently.

**DO NOT use `MeshStandardMaterial2`** (deprecated). Use `MeshStandardMaterial` from threepipe.

### index.html template (copy exactly):
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Example Title</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script async src="https://unpkg.com/es-module-shims@1.6.3/dist/es-module-shims.js"></script>
    <script type="importmap">
    {
        "imports": {
          "three": "./../../dist/index.mjs",
          "threepipe": "./../../dist/index.mjs",
          "@threepipe/plugin-procedural-generation": "./../../plugins/procedural-generation/dist/index.mjs",
          "@threepipe/plugin-procedural-generation/graph": "./../../plugins/procedural-generation/dist/graph/index.mjs",
          "@threepipe/plugin-tweakpane": "./../../plugins/tweakpane/dist/index.mjs"
        }
    }
    </script>
    <style id="example-style">
        html, body, #canvas-container, #mcanvas { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    </style>
    <script type="module" src="../examples-utils/global-loading.mjs"></script>
    <script type="module" src="../examples-utils/simple-code-preview.mjs"></script>
    <script id="example-script" type="module" src="./script.js" data-scripts="./script.ts;./script.js"></script>
</head>
<body><div id="canvas-container"><canvas id="mcanvas"></canvas></div></body>
</html>
```

### script.ts template (working pattern from candy-bounce):
```typescript
import {
    _testFinish, _testStart,
    DirectionalLight2, GBufferPlugin, Group2,
    HemisphereLight2, type IObject3D,
    PickingPlugin, SSAOPlugin, ThreeViewer, Vector3,
} from 'threepipe'
import {
    createRuntime, graphUiConfig, graphVisualizerButton,
    loadAssets, buildSceneFromInstances, getWorldGeometry,
    type GeneratedInstance,
} from '@threepipe/plugin-procedural-generation'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {graphModule, groupInput} from './graph'

_testStart()

async function main() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true, rgbm: false,
        assetManager: {simpleCache: false, storage: false},
        plugins: [PickingPlugin, GBufferPlugin, SSAOPlugin],
    })
    const ssao = viewer.getPlugin(SSAOPlugin)
    if (ssao?.pass) ssao.pass.intensity = 0.5
    await viewer.setEnvironmentMap(
        'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr',
        {setBackground: true},
    )
    // Lights
    const sun = new DirectionalLight2(0xffeebb, 2.5)
    sun.position.set(3, 5, 3)
    sun.castShadow = true
    viewer.scene.addObject(sun)
    viewer.scene.addObject(new HemisphereLight2(0x88bbdd, 0x443322, 0.4))

    // Load assets from GraphModule
    const basePath = graphModule.assetsPath ?? './assets/'
    const modules = await loadAssets(viewer, graphModule.assets, basePath)

    // Create runtime, evaluate, build scene
    const runtime = createRuntime(graphModule.graphs[0].graph)
    runtime.evaluate()
    const instances = runtime.get(
        graphModule.graphs[0].outputs[0].node,
        graphModule.graphs[0].outputs[0].output,
    ) as GeneratedInstance[]
    const root = buildSceneFromInstances(instances, modules)
    viewer.scene.addObject(root)

    // Camera
    viewer.scene.mainCamera.position.set(5, 5, 5)
    viewer.scene.mainCamera.target = new Vector3(0, 0, 0)
    viewer.scene.mainCamera.setDirty?.()

    // UI — use threepipe's graphUiConfig, NOT raw Tweakpane
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(SSAOPlugin)
    const graphControls = graphUiConfig(runtime, () => {
        runtime.evaluate()
        // Rebuild scene...
    }, 'Controls')
    ui.appendChild(graphControls)
    ui.appendChild(graphVisualizerButton(graphModule))

    // Space to pause/play (for animated scenes)
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            e.preventDefault()
            isAnimating = !isAnimating
            if (isAnimating) requestAnimationFrame(animate)
        }
    })
}

main().then(_testFinish)
```

### `loadAssets` API (critical — previous agents got this wrong):
Returns `Map<string, {meshes: {geometry, material, worldMatrix}[]}>`. Each mesh entry has `geometry`, `material`, and `worldMatrix` (the node's world transform from the GLB hierarchy). Use `buildSceneFromInstances()` to place instances — do NOT manually create Mesh2 objects from the meshes map unless you need custom rendering.

### `getWorldGeometry` for computation meshes:
When you need a mesh for computation (scatter, raycasting), use `getWorldGeometry(modules, 'filename.glb')` — it returns a BufferGeometry with worldMatrix already applied.

### Compiling .ts to .js for browser:
Use `npx esbuild script.ts --outfile=script.js --format=esm --target=es2021 --bundle=false` to strip types. The browser loads `.js`, not `.ts`.

---

## Key Principles

- **Read the Blender C++ source.** Don't guess how a node works. Translate the source line by line. The source is at `.repos/blender-gn-source/source/blender/`.
- **Numbers first, then visuals.** Verify numerically with `compare.sh`, then visually in the browser. A 100% numerical match does NOT mean the visual output is correct — asset name mismatches and coordinate conversion bugs are invisible to the comparison.
- **`object_name` = GLB filename.** Not the Blender object name. A mismatch is silent — instances just disappear.
- **Graph outputs Blender coordinates.** Keep everything in Z-up for ground truth comparison. The viewer handles Y-up conversion automatically.
- **Use `defineNodeType` for repeated node groups.** One definition, multiple instances with different defaults.
- **PropDef for UI metadata.** `{default: 42, ui: {label: 'Seed', bounds: [0, 999]}}` auto-generates sliders.
- **Use three.js for standard math.** Vector rotation, matrix transforms, Euler angles — import from three.js, don't rewrite. Only port from Blender C++ source for Blender-specific behavior (hash functions, random value argument order, resample floor vs round, etc.).
- **three.js works in Node.js.** With the polyfill at `experiments/tp-cf-test/src/polyfill.ts`, three.js math classes work in Node.js. Prefer three.js over hand-rolled math. For graph nodes that must be evaluated by `compare_graph.ts`, keep outputs as plain data (arrays, not three.js objects).
- **Never pre-bake computable outputs.** If a Blender node's algorithm can be implemented in TypeScript, implement it — even if exact bit-for-bit match with Blender isn't possible. Pre-baking (embedding Blender's output as static data) is only acceptable for artist-authored assets (meshes, textures), NOT for procedural algorithms like DistributePointsOnFaces, Random Value, Noise Texture, etc. A pre-baked graph passes numerical verification trivially but is non-functional — changing inputs does nothing. The package already has `Distribute.distributeOnFaces()` and `SeededRandom`. Use them. If the algorithm is complex, implement it; don't dump 40K lines of Float32Array data.
- **Graphs must be reactive.** Every Group Input parameter that affects the output in Blender must affect the output in the TypeScript port. If changing a slider doesn't change the scene, the port is incomplete. Verify reactivity manually in the browser as part of Phase 6.

---

## Known Limitations

Scripts tested on Blender 4.0.2 and **5.0.1** (Alpine Linux aarch64).
Blender 5.0 fixes applied: `export_colors` param removed from glTF exporter, view layer linking for hidden objects/collections, modifier input override scanning for ObjectInfo/CollectionInfo refs.
NOT tested on:
- Blender 5.1+
- Blender 3.x (fallback code path exists in extract_geo_nodes.py but is untested)
- Files with deeply nested instance hierarchies (ObjectInfo + CollectionInfo tested, but source identity lost for nested instances)
- Curve-heavy node setups (edge-based Buildify and Repeat Zone flower tested)
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

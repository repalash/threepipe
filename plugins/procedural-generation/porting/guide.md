# Porting Blender Geometry Nodes to threepipe

Step-by-step guide for replicating a Blender geometry nodes setup as a threepipe web generator with reactive UI.

## Prerequisites

- Blender 4.0+ installed (for headless script execution)
- Node.js 18+
- The `.blend` file containing the geometry nodes setup
- This package (`@threepipe/plugin-procedural-generation`)

## Overview

The process follows 6 phases:

```
Extract → Export → Map → Implement → Verify → Wire UI
```

The Buildify building generator (`examples/buildify-demo-2/`) is a complete worked example of this process. Reference it throughout.

---

## Phase 1: Extract the Node Graph

Run the extraction script to dump the geometry node tree as JSON:

```bash
blender --background myfile.blend --python porting/scripts/extract_geo_nodes.py \
  -- --output node_graph.json --summary summary.json
```

This produces:
- `node_graph.json` — every node, link, socket default, property, and sub-group (recursive)
- `summary.json` — tree count, node types, group inputs, referenced assets

Read the summary and write a plain-English description:
- What does the setup generate?
- Which inputs are user-facing parameters?
- Which sub-groups exist and what does each do?
- What is the overall dataflow?

**Tip:** Run [Node To Python](https://github.com/BrendanParmer/NodeToPython) on the file for a readable Python specification of the graph.

## Phase 2: Export Assets and Ground Truth

### Export referenced meshes

```bash
blender --background myfile.blend --python porting/scripts/export_assets.py \
  -- --output ./assets/ --manifest asset_manifest.json
```

Exports all collections/objects referenced by Collection Info and Object Info nodes as `.glb` files. Only hand-modeled meshes need export — geometry from primitive nodes (Grid, Cube) will be created procedurally.

### Export ground truth instances

```bash
blender --background myfile.blend --python porting/scripts/export_ground_truth.py \
  -- --output ./ground_truth/ --configs test_configs.json
```

Where `test_configs.json` specifies parameter variations:

```json
{
  "configs": [
    {"name": "default", "object": "MyObject", "modifier": "GeometryNodes", "inputs": {}},
    {"name": "small", "object": "MyObject", "modifier": "GeometryNodes", "inputs": {"Socket_2": 3}},
    {"name": "large", "object": "MyObject", "modifier": "GeometryNodes", "inputs": {"Socket_2": 10}}
  ]
}
```

Test at minimum: default, minimum values, maximum values, a few mid-range.

**Known issues:**
- Boolean modifier params must be set as `0`/`1` (int), not `false`/`true`. Python `False` silently corrupts Blender's modifier evaluation. The script handles this automatically.
- ObjectInfo/CollectionInfo references are often set on the modifier (not the node). The export script scans both.
- Referenced assets may be hidden from the View Layer. The export script temporarily links them for export.
- **Nested instance source names:** When geometry nodes use ObjectInfo → Instance on Points → Join Geometry, the depsgraph reports the parent object name (e.g. "Building 1") instead of individual module names (e.g. "B1 Window"). This is a [Blender Python API limitation](https://devtalk.blender.org/t/is-there-a-way-to-access-named-custom-instance-attributes-generated-with-geometry-nodes-in-python/29143). Instance positions/rotations/matrices are still correct — only the source name is affected. Collection-instanced extras retain their correct source names. For verification, use position matching for unresolved instances.

## Phase 3: Map Blender Nodes to TypeScript

List every unique `bl_idname` from the extracted JSON. For each, check if an implementation already exists:

### Available Blender built-ins

These are already ported in `src/blender/` with source links to the Blender C++ code:

| Blender Node | threepipe function | File |
|---|---|---|
| `FunctionNodeRandomValue` (INT) | `randomInt(min, max, id, seed)` | `blender/random_value.ts` |
| `FunctionNodeRandomValue` (FLOAT) | `randomFloat(min, max, id, seed)` | `blender/random_value.ts` |
| `FunctionNodeRandomValue` (BOOL) | `randomBool(probability, id, seed)` | `blender/random_value.ts` |
| `FunctionNodeRandomValue` (VECTOR) | `randomVector(min, max, id, seed)` | `blender/random_value.ts` |
| Jenkins hash (`BLI_noise.hh`) | `hash1`, `hash2`, `hash3`, `hash_to_float1/2/3` | `blender/noise.ts` |
| Mesh to Curve + Split + Trim | `meshToCurveSplitTrim(corners, splitPoints)` | `blender/geometry_nodes.ts` |
| Align Euler to Vector | `alignEulerToEdgeNormal(x0, z0, x1, z1)` | `blender/geometry_nodes.ts` |
| Resample Curve (LENGTH) | `resampleCurve(segment, moduleWidth, offset)` | `blender/geometry_nodes.ts` |
| Point on segment | `pointOnSegment(fp, x0, z0, x1, z1)` | `blender/geometry_nodes.ts` |
| Math WRAP | `normalizeAngle(a)` | `blender/geometry_nodes.ts` |
| Mesh Grid | `meshGrid(sizeX, sizeY, verticesX, verticesY)` | `blender/geometry_nodes.ts` |
| Separate Geometry | `separateGeometry(items, selection)` | `blender/geometry_nodes.ts` |
| Store Named Attribute | `storeNamedAttribute(items, name, values)` | `blender/geometry_nodes.ts` |
| Input Named Attribute | `inputNamedAttribute(items, name)` | `blender/geometry_nodes.ts` |
| Map Range | `mapRange(value, fromMin, fromMax, toMin, toMax)` | `blender/math_nodes.ts` |
| Clamp | `clamp(value, min, max)` | `blender/math_nodes.ts` |
| Mix (float) | `mixFloat(factor, a, b)` | `blender/math_nodes.ts` |
| Mix (vector) | `mixVector(factor, a, b)` | `blender/math_nodes.ts` |
| Compare | `compare(a, b, operation)` | `blender/math_nodes.ts` |
| Boolean Math | `booleanMath(a, b, operation)` | `blender/math_nodes.ts` |
| Math (all ops) | `mathOp(operation, a, b?, c?)` | `blender/math_nodes.ts` |

**Important:** The INT and FLOAT random value nodes use different argument order:
- INT: `hash(id, seed)` — id first
- FLOAT: `hash(seed, id)` — seed first (swapped!)

This was verified empirically against Blender's output. See `src/blender/random_value.ts` for details.

### Blender source code

The Blender source for geometry nodes and math functions is available at:
```
.repos/blender-gn-source/source/blender/
  blenlib/          — hash, noise, math (BLI_noise.hh)
  functions/        — Random Value node (node_fn_random_value.cc)
  nodes/geometry/   — all geometry nodes
  nodes/function/   — function nodes (Align Euler, Compare, etc.)
```

For nodes not yet ported, read the Blender source and implement in TypeScript. Link to the source file in a comment above each function.

### Nodes that DON'T need porting

- **Group Input/Output** — structural, map to function parameters
- **Reroute** — just routing, ignore
- **Frame** — organizational, ignore
- **Math/Compare/Boolean** — plain JS math

## Phase 4: Implement as a GraphModule

Write a `.ts` file that exports `graphModule: GraphModule`. This file is consumed by both the comparison script (Phase 5) and the browser viewer (Phase 6).

Import from the `/graph` subpath (works in both Node.js and browser):

```typescript
import {
    defineNodeType, defineGraph,
    type GraphModule, type GeneratedInstance,
} from '@threepipe/plugin-procedural-generation/graph'
```

Each Blender node group becomes a `defineNodeType`. Output nodes must produce `GeneratedInstance[]` with full 4x4 world matrices:

```typescript
const MyNodeGroup = defineNodeType(
    {
        geometry: [] as SomeType[],              // connected from upstream
        count: {default: 5, ui: {label: 'Count', bounds: [1, 50], stepSize: 1}},
        seed: {default: 42, ui: {label: 'Seed', bounds: [0, 999], stepSize: 1}},
    },
    {instances: [] as GeneratedInstance[]},
    (inp) => ({
        instances: computeInstances(inp.geometry, inp.count, inp.seed)
    }),
)

const instance1 = MyNodeGroup('Instance 1', {count: 10, seed: 577})
const instance2 = MyNodeGroup('Instance 2', {count: 3, seed: 704})
```

Export the graph module:

```typescript
export const graphModule: GraphModule = {
    graphs: [{
        graph: defineGraph([groupInput, instance1, instance2, join], [...connections]),
        outputs: [{node: join, output: 'instances'}],
    }],
    assets: ['module_a.glb', 'module_b.glb'],
    assetsPath: './assets/',
}
```

### Key patterns from the Buildify port

**Constants vs inputs**: Values that never change across instances (like a fixed mesh width constant) can be closure captures. Values that differ per instance (like seed, collection name) must be node inputs.

**Two-stage variant selection**: Blender's Instance on Points with Pick Instance uses a two-stage hash:
```typescript
const stage1 = randomInt(0, 100, pointIndex, 0)        // per-point ID
const stage2 = randomInt(0, 200, stage1, floorSeed)     // variant selection
const variant = stage2 % collectionSize
```

**Coordinate conversion** (Blender Z-up → three.js Y-up):
```
position:    (blender_x, blender_z, -blender_y)
wall rotY:   blender_rot_z (same value)
pillar rotY: blender_rot_z + PI (pillars use opposite convention)
scale:       (blender_sx, blender_sz, blender_sy)
```
Convert in ONE place at the data boundary. Never scatter axis swaps.

**Grid-based wall offset**: Wall grids are offset by `moduleLength / 2` from the grid edge. The wall position is `(dimension + 1) * moduleLength / 2`. Div/roof floors use the inner grid (no offset). Corner points where two wall faces meet must be deduplicated.

**Object origin offset**: Ground truth instance positions include the Blender object origin. Subtract it when comparing (available in the ground truth JSON `location` field).

## Phase 5: Verify Numerically

**Do NOT proceed until this passes 100%.**

Run the comparison script on your graph module:

```bash
./plugins/procedural-generation/porting/scripts/compare.sh my_graph.ts ground_truth.json
```

This imports your graph, evaluates it, and compares against ground truth. It checks **all 16 values of the world matrix** per instance. It reports full matrix matches vs position-only matches. A position-only match (rotation/scale wrong) is NOT a pass — the visual output will look wrong even if positions are correct.

When it fails, check the rotation mismatches first. Common causes:
- Assuming fixed rotation per wall face when it varies per point (corner vs side)
- Missing coordinate conversion for rotation (not just position)
- Wrong axis convention in the rotation matrix

## Phase 6: Wire into Browser Example

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

`launchGraphViewer` handles: asset loading, runtime creation, scene building from `GeneratedInstance[]` world matrices, auto-generated UI from PropDef metadata, and selective recompute on UI changes.

For custom scene setup, use `createRuntime` + `graphUiConfig` directly (see `examples/buildify-demo-1/`).

See [Graph System Guide](../docs/graph.md) for the full API.

## Reference

- [Graph System Guide](../docs/graph.md) — defineNode, defineNodeType, connect, createRuntime, graphUiConfig
- [GraphModule interface](../src/graph/module.ts) — standard export shape for graph .ts files
- [Buildify Demo 3](../../examples/buildify-demo-3/) — graph module example (graph.ts + thin viewer script.ts)
- [Buildify Demo 1](../../examples/buildify-demo-1/) — complete worked example with custom scene setup
- [Blender source](../../../.repos/blender-gn-source/) — C++ implementations of geometry nodes (at repo root `.repos/blender-gn-source/`)
- [tree_clipper](https://github.com/Algebraic-UG/tree_clipper) — bl_rna property discovery approach (used in our extraction script)
- [geonodes](https://github.com/al1brn/geonodes) — typed Python wrappers for every node (useful for socket type reference)
- [Node To Python](https://github.com/BrendanParmer/NodeToPython) — readable Python spec of node graphs

## Scripts

All scripts in `porting/scripts/`. Tested on Blender 4.0.2 and 5.0.1.

| Script | Purpose |
|---|---|
| `extract_geo_nodes.py` | Dump node tree to JSON (all nodes, links, sockets, sub-groups) |
| `export_assets.py` | Export referenced collections/objects as .glb |
| `export_ground_truth.py` | Evaluate modifier and export instance data as JSON (full world matrices) |
| `export_intermediate.py` | Export intermediate point cloud from any node input — for debugging point ordering |
| `compare.sh` | Convenience wrapper — evaluates a graph .ts and compares against ground truth |
| `compare_graph.ts` | Import a GraphModule, evaluate, compare all 16 matrix values against ground truth |
| `compare_ground_truth.ts` | Compare raw JSON files — full 16-value matrix comparison (legacy/debugging) |
| `create_test_blend.py` | Create minimal test .blend for script validation |
| `output_format.md` | Standard format for GraphModule outputs and ground truth JSON |
| `tsconfig.json` | Path aliases for tsx to resolve `@threepipe/plugin-procedural-generation/graph` |

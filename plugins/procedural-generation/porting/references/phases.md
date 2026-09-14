# Detailed Phase Instructions

Read this reference when executing any phase of the porting pipeline. The main skill.md has the compressed overview; this file has the full details.

## Table of Contents
- [Phase 1: Extract](#phase-1--extract-the-node-graph)
- [Phase 2: Export](#phase-2--export-assets--ground-truth)
- [Phase 3: Map](#phase-3--map-nodes-to-implementations)
- [Phase 4: Build](#phase-4--build-the-generator)
- [Phase 5: Verify](#phase-5--verify-numerically)
- [Phase 6: Browser](#phase-6--wire-into-browser-example)
- [Phase 7: Library](#phase-7--library-feedback)

---

## Phase 1 -- Extract the Node Graph

Run the extraction script (paths relative to `plugins/procedural-generation/`):
```
blender --background file.blend --python porting/scripts/extract_geo_nodes.py \
  -- --output node_graph.json --summary summary.json
```

The extraction script captures ColorRamp element stops (`color_ramp.elements[].position/color`) and FloatCurve control points (`curve_mapping.curves[].points[].x/y/handle_type`). These are nested inside sub-tree nodes -- look for `color_ramp` and `curve_mapping` keys in the node data. Copy exact values into your TypeScript -- never reverse-engineer from ground truth (see Mental Model in skill.md).

Read the output. Write a **plain-English summary** before proceeding:
- What does the setup generate?
- Which inputs are user-facing parameters?
- Which sub-groups exist and what does each one do?
- What is the overall dataflow?

Think about *design intent*. A "Grid Mesh -> Instance on Points" chain means "tile objects on a grid."

---

## Phase 2 -- Export Assets + Ground Truth

### Assets
```
blender --background file.blend --python porting/scripts/export_assets.py \
  -- --output ./assets/ --manifest asset_manifest.json
```

Only export hand-modeled meshes. Primitive geometry (Grid, Cube) will be created procedurally. The export script flattens procedural materials to flat colors:
1. Principled BSDF with linked Base Color -> traces the node chain (ShaderNodeGroup, Mix, Brick, RGB)
2. Trace fails -> uses Principled BSDF Base Color socket `default_value` as fallback (NOT `material.diffuse_color`)
3. No Principled BSDF -> replaces Surface with temp Principled BSDF using `diffuse_color`
4. CURVEs with materials -> also flattened
5. Collection-instancing EMPTYs -> exports all mesh/curve children as a single GLB

**After exporting, VERIFY material colors.** Check each GLB's JSON chunk for `pbrMetallicRoughness.baseColorFactor`. If any material is white/missing, the export is broken.

The manifest maps Blender names -> GLB filenames:
- Individual objects: `object_Foo_Bar.glb`
- Collection members: each exported individually. **Sort alphabetically** before using for Pick Instance.

**The `object_name` in your `GeneratedInstance` must use the GLB filename**, not the Blender object name. A mismatch produces silently invisible instances.

### Ground Truth
```
blender --background file.blend --python porting/scripts/export_ground_truth.py \
  -- --output ./ground_truth/ --configs test_configs.json
```

Test with: default params, min values, max values, a few mid-range.

### Export per-instance attribute data

For trees with intermediate computations (proximity, curves, animation), export PER-INSTANCE values from Blender to verify your math chain. This catches errors the comparison script (which only checks final matrices) cannot.

### Re-export verification

After export, verify ALL GLBs:
1. File size > 200 bytes (empty = `hide_render=True` or unevaluated modifiers)
2. Contains material color (check for `baseColorFactor`)
3. Loads in Node.js with non-zero vertex count

If any asset fails, fix the export script -- don't work around it.

### Ground truth limitations

Node trees that produce **geometry** (not instances) will have 0 instances in GT. This does NOT mean the tree can be skipped. Inspect the node graph to understand what it produces. **Never skip a node tree without explicit approval.**

### Analyze ground truth before building

Analyze systematically in Node.js (`npx tsx`):
1. Group instances by Z -> floor levels
2. Group by fixed coordinate -> wall faces
3. Compute spacings -> verify moduleLength
4. Check object origin from GT `location` field
5. Identify anomalous levels -> special floors
6. Compare rotation matrices -> wall face identification

---

## Phase 3 -- Map Nodes to Implementations

Read the C++ source at `.repos/blender-gn-source/source/blender/` and translate line by line.

### Tracing fan-out chains

When a single node output connects to multiple downstream paths, trace each independently. Document chains in the graph.ts header comment:

Example (candy_bounce floor): `Geometry Proximity.Distance` fans out to:
- **Chain A (Scale):** `Distance -> FloatCurve -> MapRange[0,1->4.28,1.2] -> ScaleInstances`
- **Chain B (Translate Z):** `Distance -> Math(*3.97) -> MapRange[0,1.5->-0.01,-0.04] -> TranslateInstances`

Verify from extraction JSON `links` array which chain each operation belongs to.

### Node categories

**Structural:**
- `NodeGroupInput` -> `defineNodeType` with PropDefs, pass-through evaluate
- `NodeGroupOutput` -> `OutputRef` in GraphModule
- `NodeReroute` -> ignore, use direct connections
- `GeometryNodeGroup` -> `defineNodeType` evaluate functions

**Inline JS (no utility needed):**
- `ShaderNodeMath` -> `+`, `*`, `Math.pow()`, `Math.sin()`
- `FunctionNodeCompare` -> `>`, `<`, `===`
- `FunctionNodeBooleanMath` -> `&&`, `||`, `!`
- `ShaderNodeCombineXYZ` / `ShaderNodeSeparateXYZ` -> `[x, y, z]`
- `ShaderNodeClamp` -> `Math.min(Math.max(...))`
- `GeometryNodeInputPosition` -> read vertex positions

**Already ported (see skill.md Available Infrastructure):**
- `ShaderNodeMapRange` -> `mapRange()`
- `ShaderNodeMix` -> `mixFloat()`, `mixVector()`
- `GeometryNodeMeshGrid` -> `meshGrid()`
- `GeometryNodeSeparateGeometry` -> `separateGeometry()`
- `GeometryNodeJoinGeometry` -> `joinGeometry()`
- `GeometryNodeInstanceOnPoints` -> `fromLocRotScale()`

**Data bindings:**
- `GeometryNodeObjectInfo` -> GLB path string
- `GeometryNodeCollectionInfo` -> array of member GLB paths

### Instance on Points with Pick Instance (Separate Children = true)

When `Pick Instance = true` and `Instance Index` is not connected, Blender uses the **point index** as Instance Index. Selected member is `members[point_index % members.length]`.

CollectionInfo sorts members **alphabetically** using `BLI_strcasecmp_natural`. Sort member filenames alphabetically before using for Pick Instance.

### Instance on Points with Separate Children = false

Each scatter point instances the **entire collection**. Every child object is placed at that scatter point with its own composed transform. Since our GLB export (`export_apply=True`) bakes each child's local transform into the mesh vertices, using the same `fromLocRotScale` for all members at a point produces the correct visual result.

### Random Value argument order

**Critical -- INT and FLOAT use different argument order:**
- INT: `hash(id, seed)` -- id first
- FLOAT: `hash(seed, id)` -- seed first

---

## Phase 4 -- Build the Generator

Write a `.ts` file exporting `graphModule: GraphModule`. Import from `/graph` subpath:

```typescript
import {
    defineNodeType, defineGraph,
    type GraphModule, type GeneratedInstance,
} from '@threepipe/plugin-procedural-generation/graph'
```

Output `GeneratedInstance[]` with full 4x4 world matrices in Blender Z-up coordinates.

### Code patterns

**Group Input:**
```typescript
const GroupInputType = defineNodeType(
    { seed: {default: 0, ui: {label: 'Seed', bounds: [0, 999], stepSize: 1}} },
    { seed: 0 },
    (inp) => ({...inp}),  // pass-through
)
```

**Graph Module:**
```typescript
export const graphModule: GraphModule = {
    graphs: [{ graph, outputs: [{node: join, output: 'instances'}] }],
    assets: ['wall_01.glb'],
    assetsPath: './assets/',
}
```

---

## Phase 5 -- Verify Numerically

See `references/verification.md` for the full pre-delivery checklist and debugging guide.

Core requirements:
- 100% full matrix match (all 16 values, tolerance 1e-2)
- Instance counts match exactly
- All configs pass, not just the first
- Reactivity: changing Group Input params changes output

---

## Phase 6 -- Wire into Browser Example

**Simple cases** (static, no inter-graph dependencies):
```typescript
import {launchGraphViewer} from '@threepipe/plugin-procedural-generation'
import {graphModule} from './graph'
launchGraphViewer(graphModule, { cameraPos: [30, 25, 40], cameraTarget: [0, 15, 0] })
```

**Animated/inter-graph**: Write custom `script.ts` with `ThreeViewer` + `createRuntime` (see `examples/candy-bounce/script.ts`).

### Visual verification (required)

After comparison passes, open in browser and verify:
1. All objects visible, not overlapping
2. Instance count matches (check console)
3. Colors correct (not all white/gray)
4. Scale matches Blender
5. Every UI slider changes the scene

---

## Phase 7 -- Library Feedback

Every port feeds back into the library:
1. Place new utilities in `src/blender/`
2. Link to Blender source in comments
3. Export from both `src/graph/index.ts` and `src/index.ts`
4. Write tests (determinism, edge cases, known values)
5. Update skill.md Available Infrastructure section
6. Update the tracking file with a Library Additions table

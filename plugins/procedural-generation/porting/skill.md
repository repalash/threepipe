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

## Mental Model

Think as both a **graphics engineer** and a **reverse engineer**. You are translating a
visual dataflow graph into a typed node graph. The Blender node graph is the specification;
Blender's output is the ground truth.

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

### Worked Example
- `src/generators/buildify_demo_1.ts` — Buildify building (monolithic, Blender-accurate)
- `examples/buildify-demo-2/script.ts` — same building using the graph system with `defineNodeType`

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

Only export hand-modeled meshes. Primitive geometry (Grid, Cube) will be created procedurally.

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

List every unique `bl_idname`. For each, categorize:

### Already ported (see "Available Infrastructure" above)
`FunctionNodeRandomValue`, Jenkins hash, `meshToCurveSplitTrim`, `alignEulerToEdgeNormal`, `resampleCurve`, etc.

### Structural — no implementation needed
`NodeGroupInput`, `NodeGroupOutput`, `NodeReroute`, `GeometryNodeGroup` — these map to function boundaries and wiring in your TypeScript code, not utility functions.

### Inline JS — no utility function needed
These are plain JS operations. Use them directly in evaluate functions.
Note: `ShaderNode*` prefixed nodes are shared across Blender's shader and geometry node systems — the prefix indicates where the node was originally defined, not that it's shader-specific.
- `ShaderNodeMath` — arithmetic operations selected by `operation` enum (ADD, MULTIPLY, POWER, SINE, etc.) → `+`, `*`, `Math.pow()`, `Math.sin()`
- `FunctionNodeCompare` — comparison operators → `>`, `<`, `===`, `>=`
- `FunctionNodeBooleanMath` — boolean logic → `&&`, `||`, `!`
- `ShaderNodeCombineXYZ` / `ShaderNodeSeparateXYZ` — vector pack/unpack → `[x, y, z]` / destructuring
- `ShaderNodeClamp` — `Math.min(Math.max(value, min), max)`
- `GeometryNodeJoinGeometry` — array concatenation → `[...a, ...b]`
- `GeometryNodeInputPosition` — read vertex positions from geometry attribute

### Already ported as utility functions (see "Available Infrastructure" above)
- `ShaderNodeMapRange` → `mapRange()`, `mapRangeStepped()`, `mapRangeSmoothstep()`
- `ShaderNodeMix` → `mixFloat()`, `mixVector()`
- `GeometryNodeMeshGrid` → `meshGrid()`
- `GeometryNodeSeparateGeometry` → `separateGeometry()`
- `GeometryNodeStoreNamedAttribute` / `GeometryNodeInputNamedAttribute` → `storeNamedAttribute()`, `inputNamedAttribute()`

### Still needs implementation
- `GeometryNodeTransform` — apply translation/rotation/scale to geometry (use three.js Matrix4 or inline math)

### Data bindings — string pass-through
- `GeometryNodeObjectInfo` — single object reference → GLB path string input
- `GeometryNodeCollectionInfo` — collection reference → GLB path string[] input

The asset path (not Blender object name) should be used as the key to avoid conflicts when merging graphs from multiple .blend files.

**Critical:** The INT and FLOAT Random Value nodes use DIFFERENT argument order:
- INT: `hash(id, seed)` — id first
- FLOAT: `hash(seed, id)` — seed first
This was verified against Blender's actual output. See `src/blender/random_value.ts`.

## Phase 4 — Build the Generator

Your generator must output **full 4x4 world matrices** per instance — not just positions with a separate rotation value. Use the same column-major format as Blender's depsgraph (see `porting/scripts/output_format.md`). This ensures the comparison in Phase 5 is exact.

Use `defineNodeType` for each Blender node group. The evaluate function contains the group's logic:

```typescript
const WallsNode = defineNodeType(
    {
        segments: [] as CurveSegment[],
        wallCollection: [] as string[],     // varies per instance
        seed: {default: 0, ui: {label: 'Seed', bounds: [0, 999], stepSize: 1}},
        // ... more inputs with PropDef for UI
    },
    {walls: [] as WallPlacement[]},
    // See src/generators/buildify_demo_1.ts for the full evaluate function
    (inp) => ({walls: computeWalls(inp.segments, inp.wallCollection, inp.seed, inp.numFloors, ...)}),
)

// Create instances with different defaults
const groundWalls = WallsNode('Ground Walls', {wallCollection: GROUND, seed: 577})
const middleWalls = WallsNode('Middle Walls', {wallCollection: MIDDLE, seed: 704})
```

### Key patterns

**Constants vs inputs**: True constants (fixed mesh width) → closure capture. Per-instance values (seed, collection) → node inputs.

**Two-stage variant selection** (for Instance on Points with Pick Instance):
```typescript
const stage1 = randomInt(0, 100, pointIndex, 0)
const stage2 = randomInt(0, 200, stage1, floorSeed)
const variant = stage2 % collectionSize
```

**Coordinate conversion** (Blender Z-up → three.js Y-up):
```
position:    (blender_x, blender_z, -blender_y)
wall rotY:   blender_rot_z (same value)
pillar rotY: blender_rot_z + PI (pillars use opposite convention)
scale:       (blender_sx, blender_sz, blender_sy)
```
Convert in ONE place.

## Phase 5 — Verify Numerically

**This is the most critical phase. Do NOT proceed until verification passes 100%.**

Your generator must output the same JSON format as the ground truth (see `porting/scripts/output_format.md`): an array of instances, each with a full 16-float `world_matrix` in column-major order.

### Run the standard comparison script

```
npx tsx porting/scripts/compare_ground_truth.ts generated.json ground_truth.json
```

This compares **all 16 values of the world matrix** per instance — not just positions. It reports:
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
- Bisect: disable downstream nodes in Blender, export intermediate results, compare
- The ground truth's rotation matrix is what Blender renders — match it exactly

### Do NOT proceed until
- The comparison script reports 100% full matrix matches
- Instance counts match
- All 3 (or N) building configs pass, not just the first one

## Phase 6 — Wire into Graph + UI

```typescript
const graph = defineGraph(
    [preprocess, groundWalls, middleWalls, trimWalls, pillars, join],
    [
        connect(preprocess, 'segments', groundWalls, 'segments'),
        connect(preprocess, 'segments', middleWalls, 'segments'),
        connect(groundWalls, 'walls', join, 'groundWalls'),
        connect(middleWalls, 'walls', join, 'middleWalls'),
    ],
)

const rt = createRuntime(graph)
rt.evaluate()

// Auto UI from PropDef metadata
ui.appendChild(graphUiConfig(rt, rebuild, 'My Generator'))
```

Changing one seed recomputes only that node + downstream join. UI folders auto-generated per node.

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

Div and roof floors use the **inner grid** (no offset) while window and ground floors use the **outer grid** (with offset). The div grid has duplicate points at corners (where two wall faces meet) that must be deduplicated.

### Position-only matching is insufficient
Comparing just the XYZ position of instances (matrix indices 12,13,14) catches placement errors but misses rotation and scale errors. Two instances at the same position but different rotations look completely different visually. Always compare the full 16-value world matrix using the standard comparison script. A "200/200 position match" with 36 rotation mismatches means the building looks wrong.

### Ground truth positions include object origin offset
Instance world matrices in the ground truth include the Blender object's origin position. When comparing generated positions against ground truth, subtract the object origin (available in the `location` field of the ground truth JSON). For example, Building 1 has origin at (-0.091, 0, 0), which shifts all X positions by -0.091.

### Blender 5.0 glTF exporter changes
The `export_colors` parameter was removed from `bpy.ops.export_scene.gltf()` in Blender 5.0. Distro-packaged Blender (e.g. Alpine) may not bundle `numpy` which the glTF exporter requires — install it separately if you get `ModuleNotFoundError: No module named 'numpy'`. Official Blender downloads bundle numpy.

---

## Key Principles

- **Numbers first, visuals last.** Verify numerically before visual comparison.
- **Don't guess Blender internals.** Read the source in `.repos/blender-source/` or test empirically.
- **Coordinate conversion in one place.** Blender Z-up → three.js Y-up at the data boundary.
- **Use `defineNodeType` for repeated node groups.** One definition, multiple instances with different defaults.
- **PropDef for UI metadata.** `{default: 42, ui: {label: 'Seed', bounds: [0, 999]}}` auto-generates sliders.
- **Iterate incrementally.** Get one simple configuration working end-to-end before handling all parameters.

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
| `compare_ground_truth.ts` | Compare generated output vs ground truth — full 16-value matrix comparison |
| `create_test_blend.py` | Create minimal test .blend for script validation |
| `output_format.md` | Documents the standard JSON format generators must produce |

## External References

- **Threepipe docs:** https://threepipe.org/guide/introduction.html
- **Threepipe UI config:** https://threepipe.org/guide/ui-config.html
- **Three.js docs:** https://threejs.org/docs/
- **Blender Python API:** https://docs.blender.org/api/current/
- **Blender Geometry Nodes:** https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/
- **tree_clipper** (bl_rna reference): https://github.com/Algebraic-UG/tree_clipper
- **geonodes** (node type reference): https://github.com/al1brn/geonodes
- **Node To Python** (readable spec): https://github.com/BrendanParmer/NodeToPython

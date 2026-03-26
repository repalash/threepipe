---
name: geonode-to-threepipe
description: >
  Port Blender Geometry Nodes setups to threepipe/three.js procedural generators.
  Use this skill whenever the user wants to: port a Blender geometry nodes graph to the web,
  recreate a Blender procedural generator in threepipe or three.js, convert a .blend file's
  node graph into TypeScript, build a web-based configurator from a Blender procedural asset,
  or compare Blender geometry node output against a threepipe implementation. Also trigger when
  the user mentions "geometry nodes to web", "geonode to threepipe", "procedural generator web",
  "blender nodes to code", scatter/instance systems, or any .blend file porting. Use this even
  for partial ports, debugging existing ports, or extending previously ported graphs.
---

# Geometry Nodes -> Threepipe Generator

Port Blender Geometry Nodes setups into threepipe procedural generators that run in Node.js and the browser, with reactive UI and selective recompute.

## Goal

Produce a TypeScript graph that mirrors the **top-level** Blender geometry node tree 1:1. Every node group becomes a `defineNodeType` node, every modifier input becomes a `PropDef` visible in the browser UI. The output must be numerically identical to Blender (100% full world matrix match).

The graph system operates at the **top level only**. Inside each sub-group, the logic is plain TypeScript in the evaluate function -- internal nodes like `ShaderNodeMath(ADD)`, `FunctionNodeCompare(LESS_THAN)` are just JS operators. The graph gives you: reactive recompute, auto-generated UI, and selective evaluation.

## Mental Model

**Read the Blender C++ source for every node you port.** The source is at `.repos/blender-gn-source/source/blender/`. Every non-trivial bug in this pipeline was solved by reading the exact C++ implementation. The node graph is the specification; the C++ source is how it actually works.

**Never reverse-engineer data from ground truth.** ColorRamp stops, FloatCurve control points, and other node parameters are extracted by `extract_geo_nodes.py` into the node graph JSON. Copy these exact values into your TypeScript code. Reverse-engineered values are fragile and defeat the extraction script's purpose -- if the JSON is missing data for a node, fix the extraction script rather than working around it.

**Never skip a node tree.** If a tree has 0 instances in GT, that means it produces geometry (not instances) -- it's still important. If a node is complex, find an existing open-source implementation to port from. If you truly can't port it, flag it as a blocker. Never silently skip or approximate.

**Never pre-bake computable outputs.** Implement the algorithm even if exact match isn't possible. Pre-baked graphs pass verification trivially but are non-functional -- changing inputs does nothing.

Key source references:
- Vertex ordering -> `geometry/intern/mesh_primitive_grid.cc` (X outer, Y inner)
- World matrix -> `blenlib/BLI_math_matrix.hh` (EulerXYZ rotation matrix)
- Pick Instance index -> `nodes/geometry/nodes/node_geo_instance_on_points.cc` (uses ID field)
- Collection member order -> `nodes/geometry/nodes/node_geo_collection_info.cc` (sorted alphabetically)
- Random Value arg order -> `functions/` (INT: hash(id,seed), FLOAT: hash(seed,id) -- **swapped!**)

---

## Available Infrastructure

Before writing any code, know what already exists in `@threepipe/plugin-procedural-generation`:

### Graph System (`src/graph/`)
- `defineNode(name, inputs, outputs, evaluate)` -- create a node definition
- `defineNodeType(inputs, outputs, evaluate)` -- create a reusable node type
- `defineGraph(nodes, connections)` -- create graph with validated connections + topo sort
- `connect(from, outputKey, to, inputKey)` -- type-checked connection
- `createRuntime(graph)` -- mutable state with `set()`, `get()`, `evaluate()`, `markDirty()`
- `graphUiConfig(runtime, onChange)` -- auto-generate UI from PropDef metadata
- `PropDef<T>` -- inline UI metadata: `{default: 42, ui: {label: 'Seed', bounds: [0, 999]}}`
- `GraphModule` -- `{graphs: [{graph, outputs}], assets, assetsPath}`
- `GeneratedInstance` -- `{world_matrix: number[16], object_name: string}`
- `launchGraphViewer(graphModule, options)` -- generic browser viewer

Import from `@threepipe/plugin-procedural-generation/graph` for graph code (works in both Node.js and browser -- three.js types like BufferGeometry work in Node.js with polyfill).

### Blender Built-ins (`src/blender/`)
- `hash1`, `hash2`, `hash3` -- Jenkins Lookup3 hash (from `BLI_noise.hh`)
- `hash_to_float1/2/3` -- hash to [0,1] float
- `randomInt(min, max, id, seed)` -- INT Random Value: `hash(id, seed) % range`
- `randomFloat(min, max, id, seed)` -- FLOAT Random Value: `hash(seed, id) * range` (**swapped args!**)
- `randomBool(probability, id, seed)` / `randomVector(min, max, id, seed)`
- `meshToCurveSplitTrim(corners, splitPoints)` -- Mesh to Curve + Split Edges + Trim
- `alignEulerToEdgeNormal(x0, z0, x1, z1)` -- wall rotation from edge normal
- `resampleCurve(segment, moduleWidth, offset)` -- Resample Curve (LENGTH mode, uses `floor()`)
- `meshGrid(sizeX, sizeY, verticesX, verticesY)` -- Mesh Grid node (X outer, Y inner)
- `separateGeometry(items, selection)` / `joinGeometry(...arrays)`
- `storeNamedAttribute(items, name, values)` / `inputNamedAttribute(items, name)`
- `yUpToZUp(x, y, z)` -- convert Y-up (GLB) to Z-up (Blender). **Use when positions come from GLB geometry.**
- `fromLocRotScale(px, py, pz, rx, ry, rz, sx, sy, sz)` -- 4x4 world matrix. **All inputs must be Z-up.**
- `transformPoints(points, tx, ty, tz, sx, sy, sz)` -- Transform Geometry (Components mode)
- `mapRange(value, fromMin, fromMax, toMin, toMax, clamp=true)` -- **clamps by default**
- `mapRangeStepped(...)` / `mapRangeSmoothstep(...)` / `clamp(value, min, max)`
- `mixFloat(factor, a, b)` / `mixVector(factor, a, b)`
- `compare(a, b, operation)` / `booleanMath(a, b, operation)` / `mathOp(operation, a, b?, c?)`
- `distributePointsOnFaces(geometry, options)` -- exact port of Blender's RANDOM and POISSON modes. Returns `{positions, normals, ids, baryCoords, triIndices}`.
- `interpolateScatterUVs(geometry, baryCoords, triIndices)` -- UV interpolation at scatter points
- `scatterToInstances(result, options)` -- **USE THIS for scatter-to-instance pipelines.** Handles yUpToZUp, random rotation/scale, fromLocRotScale. Eliminates the most common porting bug.
- `rotateEulerAxisAngleLocal(euler, axis, angle)` / `rotateEulerAxisAngleObject(...)`
- `eulToMat3(rx, ry, rz)` / `mat3ToEul(m)` / `axisAngleToMat3(...)` / `mulMat3(a, b)`
- `sampleImageTexture(tex, u, v)` -- sample red channel with bilinear interpolation
- `colorRampLinear2(fac, pos0, pos1)` -- 2-stop linear ColorRamp
- `alignEulerToVectorAutoPivot(inputRotation, factor, vector, axisIndex)` -- Align Euler to Vector (AUTO pivot)
- `evaluateFloatCurve(value, factor, points)` -- Float Curve with piecewise linear control points
- `evaluateColorRamp(fac, stops)` -- ColorRamp LINEAR interpolation, N-stop. Returns `[r,g,b,a]`.
- `catmullClark(positions, cells, levels, toTriangles?)` -- Catmull-Clark subdivision with boundary handling
- `subdivisionSurface(geometry, level)` -- applies to BufferGeometry (use `catmullClark` directly for quad meshes)

### Blender Source Code

Clone a sparse checkout for reference:
```bash
mkdir -p .repos && cd .repos
git clone --filter=blob:none --sparse https://projects.blender.org/blender/blender.git blender-source
cd blender-source
git sparse-checkout set source/blender/blenlib source/blender/functions \
  source/blender/geometry source/blender/nodes/geometry source/blender/nodes/function \
  source/blender/blenkernel source/blender/makesdna source/blender/makesrna
```

### When to use three.js vs Blender utilities

**three.js** for standard math (Vector3, Matrix4, Euler, Quaternion). **Blender utilities** for Blender-specific behavior (hash functions, random value arg order, mapRange clamp-by-default, fromLocRotScale). Before creating a new utility: check three.js first, then existing open-source, then port from Blender C++ source.

### Worked Examples
- `examples/buildify-demo-3/graph.ts` -- Grid-based buildings: 3 graphs, Group Input pattern
- `examples/buildify-demo-4/graph.ts` -- Edge-based building: 238/238 matrix match
- `examples/flower-scattering/graph.ts` -- Grass + flower scatter: 4 collections, texture-based density
- `examples/pebble-scatter/graph.ts` -- 3 pebble sizes: POISSON + RANDOM distribution
- `examples/candy-bounce/graph.ts` -- 3 trees, animated: subdivision, proximity, FloatCurve, ColorRamp
- `examples/candy-bounce/script.ts` -- Custom animated viewer: inter-graph dependencies, auto-play

---

## Pipeline

```
Phase 1   Phase 2   Phase 3   Phase 4   Phase 5   Phase 6   Phase 7
Extract -> Export  -> Map     -> Build   -> Verify  -> Wire UI -> Library
Graph     Assets    Nodes     Generator  Numbers   Graph     Feedback
```

Complete each phase before moving to the next. For detailed instructions on each phase, read `references/phases.md`. For the verification checklist, read `references/verification.md`.

### Running Blender

- Locally: `blender --background`
- Sandboxed: download from https://www.blender.org/download/ (x86_64 Linux builds run without installation)
- ARM (aarch64): not officially available -- user must provide Blender

---

## Key Patterns

**Coordinate conversion**: Graph outputs Blender Z-up matrices. Viewer converts to Y-up automatically. GLB geometry is Y-up -- convert with `yUpToZUp()` before passing to `fromLocRotScale()`.

**Fan-out chains**: When a node output connects to multiple downstream paths, trace each independently. Don't mix operations from one chain into another. Document chains in the graph.ts header comment.

**Static vs dynamic trees**: Identify which trees are static (no frame dependency) and which are dynamic (per-frame). Build static once, rebuild dynamic in the animation loop.

**Inter-graph dependencies**: When one graph's output feeds another's input, write a custom `script.ts` that evaluates in dependency order, passes data between runtimes, and re-evaluates downstream. `launchGraphViewer` can't handle this.

**Animated scenes**: Auto-play on load via `requestAnimationFrame`. Wire frame input directly to runtime (`runtime.set/get`). Provide pause/play (Space key minimum).

**Data files**: Static data (mesh topology, lookup tables) should be `.ts` exports, not `.json` imports (Vite JSON parsing can fail). All code must use ESM `import`/`export` -- never `require()`.

**`object_name` = GLB filename**, not the Blender object name. A mismatch is silent -- instances just disappear.

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

- **Read the Blender C++ source.** Translate line by line. Don't guess.
- **Numbers first, then visuals.** Verify numerically, then visually in the browser.
- **Graphs must be reactive.** Every Group Input parameter that affects output in Blender must affect it in the TS port.
- **Use three.js for standard math.** Only port from Blender C++ for Blender-specific behavior.
- **three.js works in Node.js** with polyfill. No need for parallel "Node-safe" implementations.
- **Never pre-bake.** The package has `distributePointsOnFaces()`, `catmullClark()`, `evaluateColorRamp()`, etc. Use them.
- **Every port feeds back.** New utilities go in `src/blender/`, exported from both entry points, documented in this skill.

---

## Known Limitations

Scripts tested on Blender 4.0.2 and 5.0.1. Not tested on: Blender 5.1+, 3.x, deeply nested instance hierarchies, 1000+ node graphs.

## Scripts

Located at `porting/scripts/`. Tested on Blender 4.0.2 and 5.0.1.

| Script | Purpose |
|---|---|
| `extract_geo_nodes.py` | Dump node tree to JSON (all nodes, links, sockets, sub-groups, recursive) |
| `export_assets.py` | Export referenced collections/objects as .glb + manifest |
| `export_ground_truth.py` | Evaluate modifier, export instance data as JSON (full world matrices) |
| `export_intermediate.py` | Export intermediate point cloud from any node input |
| `compare.sh` | Wrapper: evaluates graph .ts and compares against ground truth |
| `compare_graph.ts` | Import GraphModule, evaluate, compare all 16 matrix values |

## References

Read these when you need detailed guidance for specific situations:

| File | When to read |
|---|---|
| `references/phases.md` | Executing any phase of the pipeline (detailed instructions per phase) |
| `references/verification.md` | Before presenting a port as "done" (pre-delivery checklist) |
| `references/buildify.md` | Porting grid/edge-based building generators (Buildify-style) |
| `references/learnings.md` | Hitting unexpected issues (GLB geometry, asset export, instance identity) |

## External References

- **Threepipe docs:** https://threepipe.org/guide/introduction.html
- **Three.js docs:** https://threejs.org/docs/
- **Blender Python API:** https://docs.blender.org/api/current/
- **Blender Geometry Nodes:** https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/

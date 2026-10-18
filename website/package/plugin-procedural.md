---
prev:
    text: '@threepipe/modelling-parts'
    link: './modelling-parts'

next:
    text: '@threepipe/plugin-mesh-edit'
    link: './plugin-mesh-edit'

aside: false
---

# @threepipe/plugin-procedural

Blender's geometry nodes, ported from the Blender 5.2.2 source (5.2 LTS) and evaluated on
[`@threepipe/mesh-kernel`](./mesh-kernel)'s `MeshData`, the same mesh the modelling tools edit. Graphs run in Node
and in the browser, lazily (only what an output needs) and reactively (changing an input re-runs only the nodes it
reaches). In a viewer they are a `geometryNodes` modifier in the [modelling command API](./plugin-modelling)'s
stack.

[Example](https://threepipe.org/examples/#procedural-terrain/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/procedural/src/index.ts)

```bash
npm i @threepipe/plugin-procedural
```

Two entries: `@threepipe/plugin-procedural` is the runtime, the nodes and the DSL, with no DOM and no threepipe
import; `@threepipe/plugin-procedural/plugin` is the viewer side (`ProceduralPlugin`, the `geometryNodes`
modifier, the `nodeGroup` and `blendAsset` commands).

## What is ported

Counts from the plan's progress section (`issues/open/modelling-tools/15-procedural-on-kernel.md` §12) and the
parity status files in `plugins/procedural/tests/parity/`, as of 2026-10-18:

- **Nodes:** 232 of the 319 geometry and function node types in Blender 5.2.2's inventory, counting Group and the
  Repeat and For Each zone nodes.
- **Not ported, by group:** volumes and grids (OpenVDB), grease pencil, lists / closures / bundles, Simulation and
  Bake zones, tool-context nodes, file import, Viewer, gizmos. Mesh Boolean, Mesh Bevel and Set Mesh Normal are not
  registered either.
- **Parity against Blender 5.2.2:** the package's own cases, 1042 in 55 sets: 946 bit-exact and 94 within a few
  ulps, from libm differences and the subdivision limit surface (the limit surface was made exact later the same
  day). The geonodes-kit corpus (`geonodes-kit.status.json`): 324 pass and 15 skip of 339. Whole assets against
  Blender's evaluated output: 31 of 31 plus 2 dumps with changed inputs; most are bit-exact, the flower field is
  within 1e-5, and Buildify's `building_base` has one known gap (a vertex group and a face attribute sharing a
  name).
- **Subdivision:** one implementation, in the kernel (OpenSubdiv's float pipeline and Blender's `bke::subdiv`). The
  Subdivide Mesh and Subdivision Surface nodes call it, as does the editor's Subdivision Surface modifier.

Every port cites the Blender file and line it follows. Blender computes in single precision, built with
`-ffp-contract=off`; the port rounds to float32 per operation where Blender does, so results match bit for bit
except where a libm function (`sin`, `atan2`, ...) differs in the last place.

## Graphs as code

`geometryNodes(name, g => {...})` builds a node group. `g.input.*` and `g.output.*` declare the interface, `n.*`
adds nodes (one typed constructor per ported node, generated from the registry), and sockets have math helpers
(`add`, `sub`, `mul`, ...). Links are checked as they are written: an unknown socket, an unknown property, an
enum value a property does not have, or a link between types Blender cannot convert is an error naming the node.

```typescript
import {geometryNodes, n} from '@threepipe/plugin-procedural'

// Blender's Z-up graph: a grid lifted by 4D noise (W is the seed), then shaded smooth.
export const terrain = geometryNodes('Terrain', g => {
    g.input.geometry('Geometry')
    const size = g.input.float('Size', {default: 20, min: 1, max: 60, subtype: 'DISTANCE'})
    const resolution = g.input.int('Resolution', {default: 96, min: 2, max: 300})
    const height = g.input.float('Height', {default: 4, min: 0, max: 15})
    const scale = g.input.float('Noise Scale', {default: 0.12, min: 0.01, max: 1})
    const detail = g.input.float('Detail', {default: 6, min: 0, max: 15})
    const roughness = g.input.float('Roughness', {default: 0.55, min: 0, max: 1})
    const seed = g.input.float('Seed', {default: 0, min: 0, max: 100})

    const grid = n.MeshGrid({sizeX: size, sizeY: size, verticesX: resolution, verticesY: resolution})
    const noise = n.NoiseTexture({noiseDimensions: '4D', w: seed, scale, detail, roughness})
    const lift = n.CombineXYZ({z: noise.fac.sub(0.5).mul(height)})
    const lifted = n.SetPosition({geometry: grid.mesh, offset: lift.vector})
    g.output.geometry('Geometry', n.SetShadeSmooth({geometry: lifted.geometry}).geometry)
})

terrain.toJSON()   // {Terrain: NodeTreeJSON}: the group and every group it uses
terrain.toCode()   // the group printed back as DSL code
```

`g.group(other, inputs)` uses another group, and `g.repeatZone(...)` and `g.forEachElement(...)` build zones.
`toCode(library, name)` prints any library as DSL code, including a tree imported from Blender, so it can be
edited as code; the printed code rebuilds an equivalent tree.

### Evaluating without a viewer

```typescript
import {GeometryNodesEvaluator} from '@threepipe/plugin-procedural'

const ev = new GeometryNodesEvaluator(terrain.toJSON(), 'Terrain')
const mesh = ev.evaluate().geometry!.mesh!   // MeshData, 96 x 96 vertices
ev.setInput('Height', 6)                     // by interface name or identifier
const again = ev.evaluate()                  // the grid is reused: again.stats.reused > 0
```

## In a viewer: the `geometryNodes` modifier

```typescript
import {ThreeViewer} from 'threepipe'
import {ModellingPlugin} from '@threepipe/plugin-modelling'
import {ProceduralPlugin} from '@threepipe/plugin-procedural/plugin'

const viewer = new ThreeViewer({canvas: document.getElementById('mcanvas') as HTMLCanvasElement})
const modelling = viewer.addPluginSync(ModellingPlugin)
viewer.addPluginSync(ProceduralPlugin)

await modelling.run({op: 'nodeGroup', library: terrain.toJSON()})
await modelling.run({op: 'primitive', type: 'plane', name: 'terrain'})
// the graph is Blender's Z-up; the object turns it to threepipe's Y-up
await modelling.run({op: 'transform', object: 'terrain', rotate: [-Math.PI / 2, 0, 0]})
await modelling.run({op: 'modifier', object: 'terrain', add: {type: 'geometryNodes', group: 'Terrain', inputs: {}}})

// one undoable command per change; only the nodes the input reaches re-run
await modelling.run({op: 'modifier', object: 'terrain', index: 0, update: {inputs: {Height: 6}}})
// the group's interface, and the group as code
await modelling.run({op: 'nodeGroup', name: 'Terrain', describe: true, code: true})
// bake it down
await modelling.run({op: 'modifier', object: 'terrain', apply: true})
```

`ProceduralPlugin` registers the `geometryNodes` modifier type and adds the `nodeGroup` and `blendAsset` commands
to `ModellingPlugin`.

- **`nodeGroup`** stores groups on the document: `library` (what `toJSON()` returns) or `name` + `tree` to add or
  replace, `describe` (and `code`) to read an interface, `remove`. Each group is compiled against the ported node
  types before it is stored, so an unported node or a bad link fails at the command, not at the next evaluation.
- **The modifier** `{type: 'geometryNodes', group, inputs, outputs}` runs the group on the stack's geometry so far.
  Inputs are keyed by interface name or identifier, and a field input can read a mesh attribute instead
  (`{attribute: 'UVMap'}`). `outputs` stores field outputs as named attributes, as Blender's modifier does.
- The modifier's mesh is what the next modifier and the renderer get. Instances and points are drawn beside it
  (every instanced mesh as one `InstancedMesh2`) and realized when the stack is applied. Curves are not drawn yet.

### In the modelling editor

With `ProceduralPlugin` in the viewer and at least one node group on the document, Properties > Modifiers offers
**Geometry Nodes** with a group picker. The modifier's inputs are editable there, each edit one `modifier update`
command, and a code button shows the group as DSL code. See the
[procedural-editor](https://threepipe.org/examples/#procedural-editor/) example.

## Importing `.blend` node trees

A `.blend` file is read by Blender itself, with two scripts in `plugins/procedural/porting/blender/`:

```bash
# 1. dump everything an evaluation needs (Blender 5.2.2)
blender --background --factory-startup file.blend \
  --python plugins/procedural/porting/blender/dump_blend.py -- --out tmp/gt-5.2.2/<name>
# 2. a runtime bundle for the browser: the dump without Blender's evaluated output (plain Python 3)
python3 -I plugins/procedural/porting/blender/bundle_dump.py tmp/gt-5.2.2/<name> tmp/bundles/<name>
```

The dump holds every geometry node group, each object's nodes modifiers and their input values, the geometry
entering the first nodes modifier, and the objects, collections and images the graphs read. A bundle is
`bundle.json` + `bundle.bin`.

- `importBlenderDump(dump)` gives `{library, modifiers}`: the groups as a `NodeGroupLibrary`, and per object the
  modifier stack's group and inputs. `sceneFromDump` and `geometryFromDump` load the linked data and the input
  geometry for a `GeometryNodesEvaluator`.
- The `blendAsset` command adds an object of a bundle to the document with its stack, each nodes modifier as a
  `geometryNodes` modifier with the file's input values, still editable:

```typescript
await modelling.run({op: 'blendAsset', url: '/tmp/bundles/buildify_1.0', object: 'building_base'})
```

Nothing Blender evaluated is read: the graph runs here.

## Extension nodes

Nodes Blender does not have, registered alongside the ported ones. Blender cannot evaluate a graph that uses them.

**`ThreepipeErosion`** (Erosion (threepipe)): hydraulic (droplet) and thermal erosion of a terrain's heights. The
input must be a square grid as the Grid node makes it (Vertices X = Vertices Y, at least 3), with heights in Z.

| | |
| --- | --- |
| Inputs | `Mesh`; `Hydraulic` (on), `Droplets per Cell` (2), `Seed`, `Radius` (cells), `Inertia`, `Capacity`, `Min Capacity`, `Erode Speed`, `Deposit Speed`, `Evaporate Speed`, `Gravity`, `Lifetime`; `Thermal` (off), `Thermal Angle` (35 degrees), `Thermal Iterations`; `Weight` (a field, 0..1, how much erosion may act) |
| Outputs | `Mesh`, and the fields `Flow`, `Deposit`, `Eroded`, `Talus` (0..1 masks of where it acted) |

```typescript
geometryNodes('Eroded', g => {
    const grid = n.MeshGrid({sizeX: 10, sizeY: 10, verticesX: 24, verticesY: 24}).mesh
    const h = n.NoiseTexture({scale: 0.4}).fac
    const hilly = n.SetPosition({geometry: grid, offset: n.CombineXYZ({z: h.mul(3)}).vector}).geometry
    const er = n.ThreepipeErosion({mesh: hilly, seed: 7, dropletsPerCell: 3})
    g.output.geometry('Geometry', n.StoreNamedAttribute({geometry: er.mesh, name: 'flow', value: er.flow}).geometry)
})
```

Hydraulic erosion follows H. T. Beyer (2015) with the parameter defaults of S. Lague's implementation; thermal
follows J. Olsen (2004).

## Examples

- [procedural-terrain](https://threepipe.org/examples/#procedural-terrain/): the DSL terrain above, as a
  `geometryNodes` modifier with a slider per input, undo, apply and the group as code.
- [procedural-editor](https://threepipe.org/examples/#procedural-editor/): the modelling editor with two DSL groups
  (studs and scattered cone instances) on a cube.
- [procedural-editor-assets](https://threepipe.org/examples/#procedural-editor-assets/): three assets in the
  editor, `?asset=terrain` (default), `?asset=buildify` and `?asset=flowers`.
- [procedural-blend-asset](https://threepipe.org/examples/#procedural-blend-asset/): any bundle
  (`?bundle=<dir>&object=<name>`), evaluated by the port, instances drawn as instanced meshes, inputs live.

`procedural-blend-asset` and the `buildify` and `flowers` modes need bundles made locally (below); the rest need
nothing.

## Third-party assets

The asset parity tests and the bundle examples run on six geometry-nodes `.blend` files made by other people.
They are not bundled: the `.blend` files (about 60 MB) and their dumps and bundles are not in git, and tests that
need them skip. Sources, authors, licences and checksums are in
[`plugins/procedural/tests/fixtures/ASSETS.md`](https://github.com/repalash/threepipe/blob/master/plugins/procedural/tests/fixtures/ASSETS.md),
with the steps to make the dumps and bundles locally.

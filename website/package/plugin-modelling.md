---
prev:
    text: '@threepipe/mesh-kernel'
    link: './mesh-kernel'

next:
    text: '@threepipe/modelling-parts'
    link: './modelling-parts'

aside: false
---

# @threepipe/plugin-modelling

A JSON command API for building geometry. One surface serves a script, a UI action, a replay log and
an AI agent, because a command carries nothing that cannot be written down.

[Example](https://threepipe.org/examples/#modelling-api/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/modelling/src/index.ts)

```bash
npm i @threepipe/plugin-modelling
```

```typescript
import {ThreeViewer} from 'threepipe'
import {ModellingPlugin} from '@threepipe/plugin-modelling'

const viewer = new ThreeViewer({canvas: document.getElementById('canvas')})
const modelling = viewer.addPluginSync(ModellingPlugin)

await modelling.run({op: 'primitive', type: 'cube', name: 'hull',
    width: 2.45, height: 0.95, depth: 6.5})

// A solid of revolution: profile points are [distance from axis, distance along it].
await modelling.run({op: 'lathe', name: 'roadwheel', axis: 'x', segments: 20,
    profile: [[0, -0.08], [0.28, -0.08], [0.32, -0.04], [0.32, 0.04], [0.28, 0.08], [0, 0.08]],
    position: [-1.21, 0.37, -2.05]})

// A *live* array: the master stays editable and every copy follows it.
await modelling.run({op: 'array', object: 'roadwheel', count: 6, step: [0, 0, 0.82], live: true})
```

## Results

```js
{
  ok: true,
  op: 'array',
  index: 3,                     // sequence number in this session
  documentId: 'doc-1-8fz3qa',   // which editor window this was
  objects: ['roadwheel'],
  data: {mode: 'linear', count: 6, verts: 972, faces: 1080},
  ms: 3.1
}
```

A failure returns `{ok: false, error}` and leaves the document exactly as it was — a command that
throws part-way has its changes rolled back rather than left behind. Unknown parameters are rejected
with a suggestion (`unknown parameter "raduis" — did you mean "radius"?`) rather than ignored.

## Commands

| Op | What it does |
| --- | --- |
| `primitive` | cube, plane, grid, circle, cylinder, cone, sphere, icosphere, torus — Blender's n-gon topology |
| `lathe` | revolve a profile: wheels, barrels, drums, bolt heads |
| `sweep` | a section along a path with rotation-minimising frames: rails, handles, pipes |
| `vertices` | move individual vertices by index |
| `transform` | move / rotate / scale objects, or a listed subset of their vertices, about a pivot |
| `extrude` | push faces out along their own normal, with an optional taper |
| `inset` | a smaller copy of a face ringed by new side faces — panel lines, hatch rims |
| `bevel` | round or chamfer edges, or a vertex corner |
| `bisect` | cut along a plane, optionally removing one side and filling the cut — Blender's Bisect |
| `solidify` | give a surface thickness, with a rim closing it — plates and panels |
| `poke` | split faces into triangle fans around a centre vertex — on a quad, both diagonals |
| `wireframe` | turn every edge into a strut — lattices and trusses; `live` for a modifier |
| `array` | repeat in a line, around a pivot, or along a path — baked, or `live` |
| `modifier` | the live stack (array, mirror, wireframe): add, update, reorder, remove, apply |
| `duplicate`, `mirror`, `join`, `separate`, `weld`, `delete` | the rest of object assembly |
| `deleteElements` | delete vertices, edges or faces — Blender's `mesh.delete` types |
| `makeEdgeFace` | Blender's F: an edge from two vertices, a face from a loop or an edge net, a lone border vertex extended round its corner |
| `gridFill` | fill a closed loop, or the gap between two loops, with a grid of quads (span / offset as Blender) |
| `connectVertices` | Blender's J: cut faces between vertices in the order listed; `pairs` for Connect Vertex Pairs |
| `dissolveElements`, `dissolveLimited` | dissolve by select mode with Blender's options; Limited Dissolve by angle and delimit |
| `mergeByDistance` | edit-mode Merge by Distance on listed vertices (`useUnselected`, `useCentroid`) |
| `part` | a parametric part - knurled ring, dial, button, rocker, eyecup, strap lug, lens barrel, pad - from [`@threepipe/modelling-parts`](./modelling-parts); regenerated with new `params` until edited |
| `groove` | a panel line along a `path` or round a rounded-rectangle `outline`, projected onto the body and cut with the Manifold boolean; `fill` lays a dark strip in it |
| `uv` | UVs by cube projection (Blender's UV > Cube Projection); `size` is the texture tile size, for tiling relief |
| `decal` | a printed marking (`content.text` or `content.svg`) as a thin textured object: `plane`, `project` onto a curved body, or `wrap` round an axis; `emboss` for raised type |
| `rename`, `select` | naming, viewport selection |
| `material` | colour, roughness, metalness, transmission... or a `preset` (below) |
| `light`, `lighting`, `display` | lights, environment, shading mode |
| `camera` | named views, fit-to-objects, saved views; orthographic or perspective with a chosen `fov` |
| `reference` | a calibrated reference photograph on a world plane |
| `capture` | render a frame and hand it back |
| `inspect` | counts, bounds, transform, per-vertex detail |
| `measure` | world bounds, and intersecting pairs — clearance checking |
| `undo`, `redo`, `checkpoint`, `history` | history, with named points to rewind to |
| `selftest` | validate every mesh's topology and render bake |
| `export` | GLB or glTF |
| `help` | the table itself |

`{op: 'help'}` lists them at runtime; `{op: 'help', command: 'lathe'}` gives one command's full
schema. The parameter is `command`, not `op`, because a command object already has an `op` key.

## Parts, panel lines, surfaces and markings

The commands that take a blocked-out shape to a product that reads as real. Each example is a recipe from the
skill's cookbook (`plugins/modelling-cli/src/skill/cookbook.ts`), which `tests/skill.test.ts` in
`@threepipe/modelling-cli` runs.

```typescript
// a knurled lens ring, turned from +y onto +z; `part {list: true}` gives every part's schema
await modelling.run({op: 'part', type: 'product/knurled-ring', name: 'focus-ring',
    params: {radius: 38, length: 14, ribs: 72}, position: [0, 0, 90], rotation: [Math.PI / 2, 0, 0]})

// a panel line round a cover on a closed, manifold body, with a dark gap strip (`body-gap`)
await modelling.run({op: 'primitive', type: 'cube', name: 'body', size: 20})
await modelling.run({op: 'groove', object: 'body',
    outline: {at: [0, 0, 10], normal: [0, 0, 1], size: [12, 8], radius: 2}, width: 0.6, depth: 0.4, fill: true})

// leather: UVs at the relief's tile size (mm), then the preset
await modelling.run({op: 'primitive', type: 'cube', name: 'grip', size: 30})
await modelling.run({op: 'uv', object: 'grip', size: 14})
await modelling.run({op: 'material', object: 'grip', preset: 'leather-black'})

// a legend projected onto a curved body
await modelling.run({op: 'primitive', type: 'sphere', name: 'barrel', radius: 10, segments: 48, rings: 24})
await modelling.run({op: 'decal', name: 'label', mode: 'project', object: 'barrel',
    at: [0, 0, 10], normal: [0, 0, 1], size: [8, 2], content: {text: {text: 'ZOOM'}}})
```

Relief maps and decal prints are textures: they need a browser session. In Node the geometry is built and the
command warns that the texture is left out. [`@threepipe/modelling-parts`](./modelling-parts) also has SVG
layouts for `decal` (`ringLabels`, `ringText`, `scaleLabels`, `wordmark`).

### Material presets

`material {preset}`, and the `preset` of `decal` and `fillPreset` of `groove`. Values from `src/materials/presets.ts`;
the relief tile sizes (`RELIEF_TILE_MM`) are what `uv {size}` should be, in mm.

| Preset | Roughness | Metalness | Other |
| --- | --- | --- | --- |
| `plastic-satin-black` | 0.23 | 0 | grain relief (tile 8) |
| `plastic-gloss-black` | 0.22 | 0 | |
| `rubber` | 0.30 | 0 | rubber relief (tile 6) |
| `rubber-matte` | 0.56 | 0 | rubber relief (tile 6) |
| `leather-black` | 0.53 | 0 | leather relief (tile 14) |
| `matte-black` | 0.74 | 0 | |
| `metal-dark` | 0.23 | 0.93 | |
| `chrome` | 0.23 | 1 | |
| `metal-satin` | 0.35 | 1 | |
| `gold-contact` | 0.25 | 1 | colour `#e5b75a` |
| `glass` | 0 | 0 | transmission 1, IOR 1.5 |
| `glass-coated` | 0.02 | 0 | transmission 1, IOR 1.6 |
| `screen-glass` | 0.14 | 0 | transmission 0.58, IOR 1.5 |
| `accent-red` | 0.5 | 0 | colour `#e74533` |
| `gap-black` | 1 | 0 | black (the `groove` strip default) |
| `print-white` | 0.5 | 0 | the `decal` default |

Clear glass shows whatever is behind it; put something dark behind it (a baffle, inner elements).

## Using it from an agent

`describeCommands()` returns `{name, description, inputSchema}` for every command — the shape an LLM
tool list takes, generated from the same definitions the dispatcher runs, so a command cannot exist
without being described.

```typescript
const tools = modelling.describeCommands()
// [{name: 'array', description: '...', inputSchema: {type: 'object', properties: {...}}}, ...]
```

## Calibrated references

```typescript
await modelling.run({
    op: 'reference', name: 'side', plane: 'right', image: '/photo.jpg',
    // Two points on the image, and the real distance between them.
    calibrate: {from: [0.18, 0.62], to: [0.86, 0.62], distance: 6.77},
    origin: [0, 0, 0], align: 'bottom', opacity: 0.45,
})
await modelling.run({op: 'camera', view: 'ref:side'})
```

The plane is placed at a *measured* scale, and a camera view registered to it is saved under
`ref:<name>`, so a capture and the photograph can be compared rather than eyeballed.

## Live modifiers

`{op: 'array', ..., live: true}` adds a modifier instead of baking. The object keeps a small
editable master — the one vertex indices refer to and the one `vertices` and `transform` edit — plus
an evaluated mesh the renderer draws. Editing the master re-evaluates every copy.

```typescript
await modelling.run({op: 'vertices', object: 'shoe', verts: [[7, 0, 0.04, 0]]})  // all 88 follow
await modelling.run({op: 'modifier', object: 'shoe', index: 0, update: {count: 92}})
await modelling.run({op: 'modifier', object: 'shoe', apply: true})  // bake it down when finished
```

## Undo

Every mutating command is undoable without implementing undo: the document records the state of any
object a command touches before it changes it.

```typescript
await modelling.run({op: 'checkpoint', name: 'hull done'})
// ...twenty commands later
await modelling.run({op: 'undo', to: 'hull done'})
```

## Without a browser

Geometry alone can be generated in Node with no viewport at all, by calling
[`@threepipe/mesh-kernel`](./mesh-kernel) directly. The *commands* need a `ThreeViewer`; in Node,
[`@threepipe/modelling-cli`](./modelling-cli)'s `NodeSession` builds one on threepipe's Node stubs
(`DummyRenderManager`, no WebGL), and every command that does not draw runs there exactly as in a page.
`look` and `capture` need pixels: the CLI and the [MCP server](./modelling-mcp) run them in a headless
browser.

The package does not depend on the edit-mode UI either way. `ModellingPlugin.fileSink` is where
`capture {path}`, `look {path}` and `export {path}` write when driving it from Node.

## Checks, renders and imports

- `validate` - a port of Blender's `BM_mesh_is_valid` (`bmesh_mesh_validate.cc`) on every object, and with
  `spec` a three-valued check of written requirements (bounds in world space, counts, volume, manifold,
  genus, attribute layers, groups unchanged since a checkpoint).
- `diff {object, from}` and the `locality` on every mutating result - what changed, split into what the
  command named and collateral.
- `look` - an auto-framed multi-view sheet (or the viewport, a saved view, `ref:<name>`) in solid,
  material, wireframe or x-ray, with a highlight overlay and labels, returning the image *and* a JSON
  description of it. The `view.look` editor operator shows the same sheet.
- `import` - a GLB/glTF/OBJ/STL, or three.js objects already in the scene, welded into editable
  document objects; a GLB written here comes back with exact topology.

## Agent socket

`AgentSocketPlugin` connects the page out to a relay (`threepipe-modelling relay`, or the MCP server)
and runs the commands it receives through `run`, so they are undoable like any other. See
[Connect an agent](../guide/connect-an-agent).

```typescript
import {AgentSocketPlugin} from '@threepipe/plugin-modelling'
viewer.addPluginSync(AgentSocketPlugin).connect('ws://127.0.0.1:9396', token)
```

## Driving a session

`scripts/modelling-session.mjs` in the threepipe repository runs a build script against a real
viewer, or watches a file of commands for a live session:

```bash
npm run modelling:session -- my-build.mjs --out tmp/my-build
npm run modelling:session -- --watch tmp/session
```

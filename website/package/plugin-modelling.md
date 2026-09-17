---
prev:
    text: '@threepipe/mesh-kernel'
    link: './mesh-kernel'

next:
    text: '@threepipe/plugin-mesh-edit'
    link: './plugin-mesh-edit'

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
| `solidify` | give a surface thickness, with a rim closing it — plates and panels |
| `array` | repeat in a line, around a pivot, or along a path — baked, or `live` |
| `modifier` | the live stack: add, update, reorder, remove, apply |
| `duplicate`, `mirror`, `join`, `separate`, `delete` | the rest of object assembly |
| `rename`, `material`, `select` | naming, surface, viewport selection |
| `light`, `lighting`, `display` | lights, environment, shading mode |
| `camera` | named views, fit-to-objects, saved views |
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

## Running headless

The package depends on `threepipe` and `@threepipe/mesh-kernel` but not on the edit-mode UI, so a
build script runs without a viewport. `ModellingPlugin.fileSink` is where `capture {path}` and
`export {path}` write when driving it from Node.

## Driving a session

`scripts/modelling-session.mjs` in the threepipe repository runs a build script against a real
viewer, or watches a file of commands for a live session:

```bash
npm run modelling:session -- my-build.mjs --out tmp/my-build
npm run modelling:session -- --watch tmp/session
```

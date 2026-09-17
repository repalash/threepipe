# @threepipe/plugin-modelling

A JSON command API for building geometry in [threepipe](https://threepipe.org).

Every modelling action is a plain object:

```js
await modelling.run({op: 'primitive', type: 'cube', name: 'hull', width: 2.45, height: 0.95, depth: 6.5})
await modelling.run({op: 'lathe', name: 'roadwheel', axis: 'x', segments: 24,
    profile: [[0, -0.06], [0.28, -0.06], [0.32, -0.02], [0.32, 0.02], [0.28, 0.06], [0, 0.06]]})
await modelling.run({op: 'array', object: 'roadwheel', count: 6, step: [0, 0, 0.84]})
```

One surface serves four callers - a script, a UI action, a replay log and an AI agent - because a
command carries no function references, no class instances and nothing else that cannot be written
down. `describeCommands()` returns the table as `{name, description, inputSchema}`, which is the
shape an LLM tool list takes, generated from the same definitions the dispatcher runs.

## Why it looks like this

It is modelled on a real session: an agent built a 64-object SU-152 tank from a reference photograph
in a competing tool, using 149 commands, and published what worked and what did not. Four
observations from that report shaped this package.

**The load-bearing operations are `lathe`, `sweep`, `array` and vertex edits by index** - not bevel,
inset, boolean or knife, none of which the tank needed. So those four came first.

**Reference calibration is the highest-value missing tool.** Their proportion errors came from
eyeballing an uncalibrated photograph and noticing 115 operations later. `reference` places a
photograph on a world plane at a *measured* scale - name two points on the image and the real
distance between them - and registers a camera view to it, so a capture and the photo can be
compared rather than approximated.

**A capture must never block an edit.** Their worst stall was 118 seconds: a screenshot waiting on a
background tab's animation frame, with the edit behind it stuck in the same acknowledgement.
`capture` drives the render loop explicitly and never awaits `requestAnimationFrame`.

**Repetition should stay editable.** Arraying 88 track shoes and then needing to change one meant
re-arraying by hand. `{op: 'array', ..., live: true}` adds a modifier instead of baking: the master
mesh stays small and editable, vertex indices keep referring to it, and every copy re-evaluates when
it changes. `{op: 'modifier', object, apply: true}` bakes the stack down when the part is finished.

## Install

```bash
npm i @threepipe/plugin-modelling
```

```js
import {ThreeViewer} from 'threepipe'
import {ModellingPlugin} from '@threepipe/plugin-modelling'

const viewer = new ThreeViewer({canvas})
const modelling = viewer.addPluginSync(ModellingPlugin)
```

## The commands

| Op | What it does |
| --- | --- |
| `primitive` | cube, plane, grid, circle, cylinder, cone, sphere, icosphere, torus - with Blender's n-gon topology |
| `lathe` | revolve a profile: wheels, barrels, drums, bolt heads |
| `sweep` | a section along a path, with rotation-minimising frames: rails, handles, pipes |
| `vertices` | move individual vertices by index |
| `transform` | move / rotate / scale objects, or a listed subset of their vertices, about a pivot |
| `extrude` | push faces out along their own normal, with an optional taper |
| `array` | repeat geometry in a line, around a pivot, or along a path - baked, or `live` |
| `modifier` | the live stack: add, update, reorder, remove, apply |
| `duplicate` | copy objects, optionally repeated and offset |
| `mirror` | mirror geometry across a plane, welding what sits on it |
| `join` | merge objects into one mesh, keeping relative placement |
| `separate` | split by loose parts, or by a list of faces |
| `delete` | remove objects |
| `rename`, `material`, `select` | naming, colour and surface, viewport selection |
| `light`, `lighting`, `display` | lights, environment, shading mode |
| `camera` | named views, fit-to-objects, saved views |
| `reference` | a calibrated reference photograph on a world plane |
| `capture` | render a frame and hand it back |
| `inspect` | counts, bounds, transform, and per-vertex detail |
| `measure` | world bounds, and intersecting pairs - clearance checking |
| `undo`, `redo`, `checkpoint`, `history` | history, with named points to rewind to |
| `selftest` | validate every mesh's topology and render bake |
| `export` | GLB or glTF |
| `help` | the table itself |

Run `{op: 'help'}` for the list at runtime, and `{op: 'help', command: 'lathe'}` for one command's
full schema. The parameter is `command` rather than `op` because a command object already has an
`op` key.

## Results

```js
{
  ok: true,
  op: 'array',
  index: 42,                 // sequence number in this session
  documentId: 'doc-1-8fz3qa', // which editor window this was
  objects: ['roadwheel'],
  data: {mode: 'linear', count: 6, verts: 1452, faces: 1176},
  warnings: undefined,
  ms: 3.1
}
```

A failure returns `{ok: false, error}` and leaves the document exactly as it was - a command that
throws half-way through has its changes rolled back, not left behind.

## Undo

Every mutating command is undoable without implementing undo. The document records the state of any
object a command touches before it changes it, and the history stack restores those snapshots. Name
a point with `{op: 'checkpoint', name: 'hull done'}` and come back to it with
`{op: 'undo', to: 'hull done'}`.

## Headless

The package depends on threepipe and `@threepipe/mesh-kernel` but not on the edit-mode UI, so a
build script runs without a viewport. `ModellingPlugin.fileSink` is where `capture {path}` and
`export {path}` write when you are driving it from Node.

## Driving a session

`scripts/modelling-session.mjs` in the threepipe repository runs a build script against a real
viewer and writes numbered captures plus a replayable transcript:

```bash
npm run modelling:session -- my-build.mjs --out tmp/my-build
```

## Licence

Apache-2.0

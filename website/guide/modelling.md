---
prev:
    text: 'Plugin System'
    link: './plugin-system'
---

# Modelling

threepipe can build and edit geometry, not only display it. Three packages, layered:

- **[`@threepipe/mesh-kernel`](../package/mesh-kernel)** — n-gon topology, per-domain attributes and
  Blender's mesh operators, ported from source. No dependencies, no browser API: geometry can be
  generated in Node with no viewport at all.
- **[`@threepipe/plugin-modelling`](../package/plugin-modelling)** — a JSON command API over it, with
  undo, validation and a document model.
- **[`@threepipe/plugin-mesh-edit`](../package/plugin-mesh-edit)** — edit mode for a person: element
  selection, overlays, a modal transform, the Blender keymap.

You can use any one of them alone. This page is about the middle one, because it is the layer that
makes the other two reachable from a script.

## One command

```typescript
import {ThreeViewer} from 'threepipe'
import {ModellingPlugin} from '@threepipe/plugin-modelling'

const viewer = new ThreeViewer({canvas: document.getElementById('canvas')})
const modelling = viewer.addPluginSync(ModellingPlugin)

const result = await modelling.run({op: 'primitive', type: 'cube', name: 'hull',
    width: 2.45, height: 0.95, depth: 6.5})
// {ok: true, op: 'primitive', objects: ['hull'], data: {verts: 8, faces: 6, bounds: {...}}, ms: 0.9}
```

Commands are plain objects and results are plain JSON. Nothing in either is a function, a class
instance or anything else that cannot be written down — which is what lets one surface serve a
script, a UI button, a replay log and an AI agent without any of them being a special case.

## Building something

The four operations most builds are actually made of:

```typescript
// A solid of revolution. Profile points are [distance from the axis, distance along it].
await modelling.run({op: 'lathe', name: 'wheel', axis: 'x', segments: 20,
    profile: [[0, -0.08], [0.28, -0.08], [0.32, -0.04], [0.32, 0.04], [0.28, 0.08], [0, 0.08]]})

// A section swept along a path, with rotation-minimising frames so it does not corkscrew.
await modelling.run({op: 'sweep', name: 'rail', radius: 0.016, steps: 8,
    path: [[-1.1, 1.8, -0.5], [-1.2, 1.9, -0.4], [-1.2, 1.9, 0.3], [-1.1, 1.8, 0.4]]})

// Repetition that stays editable — see Live modifiers below.
await modelling.run({op: 'array', object: 'wheel', count: 6, step: [0, 0, 0.82], live: true})

// Moving individual vertices, addressed by index.
const wheel = await modelling.run({op: 'inspect', object: 'wheel', detail: true})
await modelling.run({op: 'vertices', object: 'wheel', relative: true,
    verts: [[0, 0, 0.02, 0]]})
```

Then `extrude`, `inset`, `solidify`, `mirror`, `join`, `separate` and `weld` for the rest. `{op:
'help'}` lists everything at runtime.

## Live modifiers

`array` bakes by default. With `live: true` it adds a modifier instead, and the object keeps two
meshes: a small editable **master**, which is what vertex indices refer to and what `vertices` and
`transform` edit, and an **evaluated** copy that the renderer draws.

```typescript
await modelling.run({op: 'array', object: 'shoe', count: 88, path: trackOutline, live: true})
// Change the one master shoe; all 88 follow.
await modelling.run({op: 'vertices', object: 'shoe', verts: [[7, 0, 0.04, 0]]})
await modelling.run({op: 'modifier', object: 'shoe', index: 0, update: {count: 92}})
// And bake it down when the part is finished.
await modelling.run({op: 'modifier', object: 'shoe', apply: true})
```

## Modelling to measurement

A photograph at an unknown scale is a guess. `reference` places one on a world plane at a *measured*
scale: name two points on the image in normalised coordinates and the real distance between them.

```typescript
await modelling.run({
    op: 'reference', name: 'side', plane: 'right', image: '/photo.jpg',
    calibrate: {from: [0.18, 0.62], to: [0.86, 0.62], distance: 6.77},
    align: 'bottom', opacity: 0.45,
})
await modelling.run({op: 'camera', view: 'ref:side'})   // framed exactly as the photo is
```

A camera view registered to the plane is saved as `ref:<name>`, so a capture and the photograph can
be compared rather than eyeballed. A perspective snapshot still cannot give a true orthographic
overlay — a side elevation or a technical drawing can.

## Undo, checkpoints and history

Every mutating command is undoable, and no command implements undo: the document records the state of
whatever a command touches before it changes it.

```typescript
await modelling.run({op: 'checkpoint', name: 'hull done'})
// ...twenty commands later
await modelling.run({op: 'undo', to: 'hull done'})
await modelling.run({op: 'history'})   // what has been done, and what has been undone
```

A command that throws part-way is rolled back rather than leaving half its changes behind.

## Checking your work

```typescript
await modelling.run({op: 'selftest'})                      // topology and bake, every object
await modelling.run({op: 'measure', mode: 'overlaps'})     // intersecting pairs, with the overlap
await modelling.run({op: 'capture'})                       // a rendered frame, as a data URL
await modelling.run({op: 'export', format: 'glb'})
```

`capture` drives the render loop explicitly rather than awaiting `requestAnimationFrame`, so it
cannot stall behind a background tab and hold up the edits queued after it.

## Driving it from an agent

`describeCommands()` returns the table as `{name, description, inputSchema}` — the shape an LLM tool
list takes — generated from the same definitions the dispatcher runs, so a command cannot exist
without being described.

```typescript
const tools = modelling.describeCommands()
```

Mistakes are answered rather than ignored: an unknown parameter gets `unknown parameter "raduis" —
did you mean "radius"?`, and a missing object names the ones that do exist.

In the threepipe repository, `scripts/modelling-session.mjs` runs a build script against a real viewer
or watches a file of commands for a live session:

```bash
npm run modelling:session -- my-build.mjs --out tmp/my-build
npm run modelling:session -- --watch tmp/session
```

Both write numbered captures and a replayable transcript.

## Editing by hand

Load [`@threepipe/plugin-mesh-edit`](../package/plugin-mesh-edit) alongside and `Tab` into edit mode
on any object. It takes the exact topology from the modelling document rather than recovering it from
the triangle buffer, so an object built by command opens with its n-gons and vertex indices intact,
and an edit made by hand comes back into the document as an undoable change.

## Saving

Topology survives a glTF round trip. The mesh primitive stays an ordinary triangulated glTF mesh, so
other viewers are unaffected, and the `THREEPIPE_mesh_topology` extension carries the editable
`MeshData` and the modifier stack alongside it. Export, reload, and carry on editing.

## Example

[Modelling command API](https://threepipe.org/examples/#modelling-api/) — a console that takes a
command as JSON, the command list straight from `describeCommands()`, a calibrated reference pane, the
selected part with its modifier stack, and a clickable timeline.

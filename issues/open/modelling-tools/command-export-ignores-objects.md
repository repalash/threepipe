# `export {objects}` is accepted and ignored: it always writes the whole scene

Found building `demos/stair` (one GLB per piece).

`exportCommand` (`plugins/modelling/src/commands/session.ts`) declares
`objects: S.objectRef('Export only these objects. Default the whole scene.')`, so validation accepts
it, but `run` never reads it: it calls `ctx.viewer.exportScene(...)` unconditionally. Reference planes,
floors and every other object go into the file too.

## Repro

```js
await run({op: 'primitive', type: 'cube', name: 'a'})
await run({op: 'primitive', type: 'cube', name: 'b', position: [3, 0, 0]})
const r = await run({op: 'export', objects: 'a', includeData: true})
// The GLB has both cubes. Expected: only `a` (and its evaluated modifier stack).
```

## Expected (Blender)

`export_scene.gltf(use_selection=True)` writes only the selected objects. The equivalent here: resolve
`objects` with `readTargets`, and export those through threepipe's exporter (the
`AssetExporterPlugin` path `viewer.exportScene` uses, on an object or a temporary group) with their
world transforms; and say in the description whether reference planes are excluded.

## Workaround used

`demos/stair/build.mjs` deletes the other piece, exports, and `undo`es the delete.

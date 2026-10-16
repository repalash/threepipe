# `export {objects}` exports the whole scene

**Found by**: edit-chain harness, step `export-02` ("the file holds only the requested object: 40
meshes").
**Severity**: medium. The schema advertises the parameter; it is silently ignored.

## Repro

```js
await run({op: 'primitive', type: 'icosphere', name: 'gem'})
await run({op: 'primitive', type: 'cube', name: 'other'})
const r = await run({op: 'export', format: 'glb', includeData: true, objects: ['gem']})
// load r.data.base64: it contains gem *and* other (and everything else in the scene)
```

## Cause

`exportCommand.run` (`commands/session.ts`) calls `ctx.viewer.exportScene({exportExt})` and never reads
`p.objects`. `validateParams` accepts the key because the schema declares it.

## Expected

Blender's glTF exporter limits the file to the selection with `use_selection` ("Limit to: Selected
Objects", `io_scene_gltf2/__init__.py:628`, read into `export_settings['gltf_selected']` at `:1237`).
Export only the resolved objects (threepipe can export an object rather than the whole scene:
`AssetExporter.exportObject`, `src/assetmanager/AssetExporter.ts:64`), or remove the parameter from the
schema until it works.

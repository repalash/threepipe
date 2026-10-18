# `export` is not byte-deterministic: random uuids in the file, and a second export differs from the first

**Found by**: edit-chain harness, step `export-02` (determinism FAIL; "a second export in the same session
is byte-identical: 277124 vs 277092 bytes").
**Severity**: medium for the roadmap's replay goal (survey §5.2, "replaying a session on the same input
must produce a byte-identical glTF").

## Repro

Run the same command list in two fresh pages (the harness's pass 1 and pass 2), with the camera set to
a fixed position before exporting so the scene is identical:

```js
await run({op: 'camera', position: [6, 4, 6], target: [0, 0.5, 0]})
const a = await run({op: 'export', format: 'glb', includeData: true})
const b = await run({op: 'export', format: 'glb', includeData: true})   // same session
```

- Across sessions the documents are identical (every step's document hash matches) and the files are the
  same length, but the bytes differ. Diffing the JSON chunks (`tmp/edit-chain/export-pass-1.gltf.json`
  vs `-2`) shows only uuids: `userData.gltfUUID` on every node (written from `obj.uuid`,
  `src/assetmanager/export/assetExportHook.ts:70`), texture/image uuids, and material uuids.
  three.js uuids come from `MathUtils.generateUUID` (`Math.random`), so no two sessions agree.
- Within one session, exporting twice gives files of different length (277092 then 277124 bytes), so an
  export also depends on what earlier exports did. Not root-caused here.

## Expected

The uuids are threepipe's identity round trip (`GLTFLoader2.ts:212` restores them), so they cannot simply
be dropped. Options: derive them deterministically (e.g. from the modelling document's stable object ids
for modelling-owned objects), or offer `export {deterministic: true}` that omits them; and find what the
first export leaves behind that changes the second. Blender's glTF export of an unchanged scene is
byte-stable.

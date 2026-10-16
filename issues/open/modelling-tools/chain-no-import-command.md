# No command re-imports an exported file

**Found by**: edit-chain harness, step `export-02` ("an API command can re-import the file: no
import/load command").
**Status**: Track 1 (`track1-agent`) is adding an `import` command; this records the gap and how the
harness works around it until then.

## What the harness does instead

It exports `{format: 'glb', includeData: true}`, then calls `viewer.load(new File([bytes], 'x.glb'),
{importConfig: false})` in the page. `GLTFMeshTopologyExtension` adopts the meshes back into the
document, and the round trip is exact: the re-imported `gem` equals the original (positions, faces,
edges and every attribute layer, including the corner `uv` layer).

## Expected

A JSON-only agent cannot do the above. `import {data | url, format}` returning the adopted object names
closes the loop (and is what Blender's `import_scene.gltf` operator is). When Track 1 lands, switch
`export-02` in `demos/edit-chain/chain.mjs` to it; the check is already there.

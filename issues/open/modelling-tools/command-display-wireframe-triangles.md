# `display {mode: 'wireframe'}` draws the render triangulation, not the mesh's edges

Found building the camera demo (`demos/camera/build.mjs`, the "wireframe" close-ups).

## Repro

```js
await run({op: 'primitive', type: 'cube', name: 'c', size: 1})
await run({op: 'display', mode: 'wireframe'})
await run({op: 'capture'})
// Each square face shows a diagonal: 18 lines drawn for a mesh with 12 edges.
```

The mode switches the materials to `wireframe: true`, so WebGL draws every triangle of the baked
buffer. A lathed ring that is all quads, or a bevelled corner that is a clean quad strip, reads as a
triangle soup, and n-gon caps show their fan. For a model whose point is clean topology (the camera
build is 87 % quads), the capture undersells it - and cannot be used to check edge flow at all.

## Expected (Blender)

Blender's wireframe overlay draws mesh edges (`overlay_wireframe.cc`, from the edge list, with
`wireframe_threshold` hiding edges between near-coplanar faces). The kernel already has the edge
list, and `bakeGeometry` maps triangles back to faces (`triangleToFace`), so a `LineSegments` built
from `MeshData.edgeVerts` (optionally filtered by dihedral angle, as `wireframe_threshold` does)
would show the real topology.

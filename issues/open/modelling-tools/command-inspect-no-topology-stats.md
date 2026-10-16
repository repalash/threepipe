# `inspect` does not report polygon mix or manifoldness

Found building the camera demo (`demos/camera/build.mjs`), which has to report, per object, the
share of quads and whether the mesh is closed.

## What is missing

`inspect {object}` gives `verts`, `edges`, `faces` and bounds. To answer "how many quads / tris /
n-gons" and "is it a closed 2-manifold, where are the boundary or non-manifold edges", a caller
needs `inspect {detail: true, limit: 1e6}` - every position and face list over the wire - and then
recomputes edge-face incidence itself (the camera build's `topology()` helper does exactly that).
`selftest` validates structure but reports only pass/fail, and a valid mesh can still be open.

## Repro

```js
await run({op: 'primitive', type: 'plane', name: 'p', size: 1})
const r = await run({op: 'inspect', object: 'p'})
// r.data: verts 4, edges 4, faces 1. Nothing says the plane has 4 boundary edges.
```

## Expected (Blender)

Blender's viewport statistics overlay and the 3D-Print toolbox (`object_print3d_utils`,
`mesh_helpers.py` / `bmesh_check_*`) report triangles, quads and n-gons, and select non-manifold
edges (`mesh.select_non_manifold`, `bmesh/intern/bmesh_query.cc` `BM_edge_is_manifold`,
`BM_edge_is_boundary`). An `inspect` summary block - `{tris, quads, ngons, boundaryEdges,
nonManifoldEdges, looseVerts}` - computed in the kernel would make "is it watertight" one call.

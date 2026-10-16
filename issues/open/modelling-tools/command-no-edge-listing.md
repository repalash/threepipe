# Edge indices cannot be discovered through the command API

`bevel {edges}` and `deleteElements {edges, type: 'EDGE' | 'EDGE_FACE'}` take edge indices, but no
command lists edges. `inspect {detail: true}` returns `vertices` and `faceVerts` only
(`commands/session.ts`), so an agent has to guess edge numbering, which is `MeshData`'s internal
order after `bmToMesh`.

## Repro

```js
await run({op: 'primitive', type: 'cube', name: 'c', size: 1})
const d = await run({op: 'inspect', object: 'c', detail: true})
// d.data has vertices and faceVerts; nothing says which index the edge (0, 1) has.
await run({op: 'bevel', object: 'c', edges: [3], offset: 0.1}) // which edge is 3?
```

## Suggested fix

Add `edgeVerts` (pairs of vertex indices, in edge-index order) to `inspect` detail, under the same
`limit`, or let edge-taking commands accept vertex pairs. Found while building the Eiffel tower; the
build worked round it by only deleting faces.

## Status (2026-10-16, demo-stair): fixed as suggested

`inspect {detail: true}` now returns `edgeVerts` (vertex-index pairs in edge-index order, capped by
`limit`, with `edgesTruncated` when cut). `bmFromMesh` creates BMesh edges in `MeshData` edge order
(`bmesh/convert.ts`, the edges loop), so index i in the list is the edge `bevel {edges: [i]}`,
`subdivide`, `deleteElements` and `bridgeEdgeLoops` address. The stair demo picks the vertical edges at
the corners of the tread openings this way to round them with `bevel`, and the arcade picks the
string course's vertical edges for `subdivide`. E2E: `tests/interactive.spec.ts` (`modelling-api`)
checks every face side is in the list and bevels one edge chosen by position (10 verts, 7 faces).

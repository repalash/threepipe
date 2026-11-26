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

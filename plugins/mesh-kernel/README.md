# @threepipe/mesh-kernel

Node-safe editable polygon mesh kernel for [threepipe](https://threepipe.org/).

n-gon topology, per-domain attributes, and Blender-style mesh operators. No threepipe dependency, no
browser API: it runs in Node, in a worker, and in the browser. Rendering, picking, gizmos and UI live
in `@threepipe/plugin-mesh-edit`.

## Status

Early. `MeshData` (the struct-of-arrays representation) and its attribute storage are implemented and
tested. `BMesh` and the operator layer are next. See
`issues/open/modelling-tools/00-synthesis.md` in the repo for the plan.

## Two representations

Following Blender, which is the source this kernel is ported from:

- **`MeshData`** — struct-of-arrays. Four element counts, a face-offsets array, and every other piece of
  information as a named attribute on the point, edge, face or corner domain. Canonical and
  serialisable: this is what the blend importer produces, what undo snapshots, and what the render bake
  reads.
- **`BMesh`** (not yet implemented) — verts, edges, loops and faces linked by disk, radial and loop
  cycles. Built when editing starts. Every operator runs here and writes back.

The split exists because the two jobs pull in opposite directions. Arrays are cheap to copy, serialise
and upload, but insertion renumbers everything after it and adjacency is not stored. Linked topology
makes local edits O(1) and adjacency walks trivial, but maps to no file or GPU format.

## Usage

```ts
import {MeshData, AttrDomain, AttrName} from '@threepipe/mesh-kernel'

const mesh = MeshData.fromFaces({
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    faces: [[0, 1, 2, 3]],          // one quad, not two triangles
})

mesh.describe()            // 'verts 4, edges 4, faces 1, corners 4, attributes [position]'
mesh.validate()            // [] when well formed, otherwise human-readable problems
mesh.faceSize(0)           // 4
mesh.faceVerts(0)          // [0, 1, 2, 3]

// Per-corner data, so UV seams need no duplicated vertices.
const uv = mesh.attributes.add({name: 'uv', domain: AttrDomain.Corner, type: 'float2'})
uv.data.set([0, 0, 1, 0, 1, 1, 0, 1])
```

Attribute names match Blender's exactly (`position`, `.corner_vert`, `sharp_edge`, `material_index`,
`uv_seam`, …) so a `.blend` round-trip needs no translation table.

## Development

```bash
npm run build        # vite lib build into dist/
npm run dev          # watch build
npm run test         # vitest, node environment, no DOM polyfills
```

From the repo root, `npm run test:unit:mesh-kernel` runs the same tests.

The kernel's test environment deliberately has no DOM polyfills. If a test here needs `document` or
`ImageData`, that is a bug in the kernel rather than in the test setup.

## Licence

Apache-2.0. Algorithms are ported from Blender (GPL-2.0-or-later) — see the notes in each source file
for the exact upstream file and function. Porting provenance is tracked per file; consult the repo
issues before adding a port.

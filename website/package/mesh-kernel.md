---
prev:
    text: '@threepipe/plugin-troika-text'
    link: './plugin-troika-text'

next:
    text: '@threepipe/plugin-modelling'
    link: './plugin-modelling'

aside: false
---

# @threepipe/mesh-kernel

An editable polygon mesh kernel: n-gon topology, per-domain attributes, and Blender's mesh operators
ported from source. No dependencies at all — it runs in Node, in a worker, or in a browser, and
touches no browser API.

[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/mesh-kernel/src/index.ts)

```bash
npm i @threepipe/mesh-kernel
```

## Two representations, following Blender

- **`MeshData`** — struct-of-arrays with n-gon faces and per-domain attributes (point, edge, face,
  corner). Canonical, serialisable, cheap to snapshot and to bake into a `BufferGeometry`.
- **`BMesh`** — vertices, edges, loops and faces linked by disk, radial and loop cycles, built when
  editing starts. Every operator runs here, then writes back.

That is Blender's own split, and it is there for the same reason: array form is what you store and
render, linked form is what you can actually mutate in constant time.

```typescript
import {primitiveCube, bmFromMesh, bmToMesh, extrudeFaceRegion, bakeGeometry} from '@threepipe/mesh-kernel'

const mesh = primitiveCube({size: 2})        // 8 verts, 12 edges, 6 quads — not 12 triangles
const bm = bmFromMesh(mesh)
extrudeFaceRegion(bm, [[...bm.faces][0]])
const {data} = bakeGeometry(bmToMesh(bm), {includeNormals: true})
```

## Generators

| | Ported from |
| --- | --- |
| `primitiveCube`, `primitiveGrid`, `primitiveCircle`, `primitiveCone`, `primitiveUVSphere`, `primitiveIcoSphere` | `bmo_primitive.cc`, with UV generation |
| `spin` | `bmo_utils.cc` `bmo_spin_exec` |
| `lathe`, `primitiveTorus` | spin over a wire profile, as `MOD_screw.cc` does it |
| `sweep` | `curve_to_mesh_convert.cc` + `curve_poly.cc`, rotation-minimising frames |
| `arrayGeometry`, `arrayLinear`, `arrayRadial`, `arrayCurve` | `MOD_array.cc` |
| `mirrorGeometry` | `bmo_mirror.cc` |

## Operators

`extrudeFaceRegion`, `extrudeEdgeOnly`, `duplicateGeometry`, `splitSelection`, `deleteSelection`,
`mergeVerts`, `weldVerts`, `joinMeshes`, `separateLooseParts`, `separateFaces`, plus the four Euler
operators (`splitEdgeMakeVert`, `splitFaceMakeEdge`, `joinFaceKillEdge`, `joinEdgeKillVert`),
selection marking and flushing, and the topology walkers (vertex shell, edge loop, edge ring, face
loop, boundary).

## Rendering

The kernel imports no renderer. `bakeGeometry` emits plain typed arrays, and the caller supplies the
constructors:

```typescript
import {BufferAttribute, BufferGeometry2} from 'threepipe'
import {geometryDataToBufferGeometry} from '@threepipe/mesh-kernel'

const geometry = geometryDataToBufferGeometry(data, {BufferGeometry: BufferGeometry2, BufferAttribute})
```

That is what keeps the package usable from Node without a polyfill, and it is guarded by a test.

## Node safety

Every algorithm here is portable and tested under plain Node — 563 unit tests, including parity
fixtures extracted from real `.blend` files and reference values generated from three.js itself.

# mesh-kernel: `BMesh.faceCreate` creates a face's edges in a different order from Blender

**Found by**: track L (loop tools), writing the exact-order subdivide parity test, 2026-10-03.

## What

Blender's `BM_face_create_verts` makes the missing edges with `BM_edges_from_verts_ensure`
(`bmesh/intern/bmesh_construct.cc:57`), which starts at the closing edge:

```c
int i, i_prev = len - 1;
for (i = 0; i < len; i++) {
  edge_arr[i_prev] = BM_edge_create(bm, vert_arr[i_prev], vert_arr[i], nullptr, BM_CREATE_NO_DOUBLE);
  i_prev = i;
}
```

so a quad `[0, 1, 2, 3]` gets its edges in the order `(3,0) (0,1) (1,2) (2,3)`, with `v1 = 3, v2 = 0` on
the first. The kernel's `BMesh.faceCreate` (`plugins/mesh-kernel/src/bmesh/BMesh.ts:192`) starts at
`(0,1)` and ends with `(3,0)`.

## Why it matters

Anything order-dependent sees a different mesh from the one Blender would have built from the same
face list: operators that walk `bm.edges` in mesh order (`subdivide_edges` splits its input in mesh
order, which decides vertex creation order), and every edge's `v1`/`v2` direction (subdivide splits
from `edge->v1`). The geometry is still correct; element order and some tie-breaks are not Blender's.

The subdivide parity suite (`plugins/mesh-kernel/tests/subdivide-parity.test.ts`) works around it by
recording Blender's edge order in the fixture and creating those edges before the faces.

## Fix

Port `BM_edges_from_verts_ensure`'s loop into `faceCreate`. It is a core kernel change and will move
element order in existing tests and fixtures that depend on it, so it needs the maintainer's go-ahead.

# `splitEdgeMakeVert` copies corner attributes instead of interpolating them

Found while porting the icosphere (`plugins/mesh-kernel/src/generate/primitives.ts`), whose UVs come
from Blender's `icouvs` table on the twenty base triangles and are then meant to be carried through
`subdivide_edges`.

## What the kernel does

`splitEdgeMakeVert` (`plugins/mesh-kernel/src/bmesh/euler.ts`) interpolates the *vertex* domain
correctly:

```ts
interpElemAttrsMidpoint(vNew, tv, vOld, bm.vdata, factor)
```

but for the corner domain it only copies:

```ts
const lNew = new BMLoop(bm.nextId(), vNew, null, l.f)
copyElemAttrs(l, lNew, bm.ldata)
```

So the new corner takes the UV of the corner it was split from, rather than a value between that
corner and the next one along the edge.

## What Blender does

`BM_edge_split` (`source/blender/bmesh/intern/bmesh_mods.cc:478`) calls SEMV and then interpolates
both domains:

```c
BM_data_interp_face_vert_edge(bm, v_other, v, v_new, e, fac);
BM_data_interp_from_verts(bm, v, v_other, v_new, fac);
```

`BM_data_interp_face_vert_edge` (`bmesh_interp.cc`) walks the radial cycle of the split edge and
blends each face's two corners along the edge at `fac` into the corner at the new vertex. That is the
corner-domain half the kernel is missing.

## Effect

Any operator built on SEMV loses per-corner data at the new vertex:

- an icosphere at `subdivisions > 1` gets stepped UVs instead of a smooth unwrap (the topology,
  positions and radius are all correct - `generate/primitives.test.ts` asserts those),
- the same will hit `subdivide`, `knife`, `bevel` and `loop cut` when they land.

## Fix

Port `BM_data_interp_face_vert_edge` into `bmesh/customdata.ts` (or a new `bmesh/interp.ts`) and call
it from `splitEdgeMakeVert` when `factor` is given, alongside the existing `interpElemAttrsMidpoint`.
The machinery already exists - `interpElemAttrs` does the weighted blend and already treats integer
layers as categorical; what is missing is the radial walk that decides which two corners to blend.

## Regression test

Give a quad a UV layer, split one edge at `factor = 0.25`, and assert the new corner's UV is a quarter
of the way between the two corners it sits between - on both faces of a manifold edge, and on a face
whose loop runs the other way along the edge.

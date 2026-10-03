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

---

## Fixed

Ported into a new `plugins/mesh-kernel/src/bmesh/interp.ts` rather than into `customdata.ts`, because
the radial walk turned out to be the smallest of the several `bmesh_interp.cc` entry points the rest
of M1 needs, and they share the `interp_weights_poly_v2` machinery.

`splitEdgeMakeVert` now ends with `BM_edge_split`'s own two calls (`bmesh_mods.cc:521`), in that
order and after the radial split, because the new corners do not exist until then:

```ts
dataInterpFaceVertEdge(bm, vOld, tv, vNew, e, factor)
dataInterpFromVerts(bm, tv, vOld, vNew, factor)
```

The vertex half was previously `interpElemAttrsMidpoint`, which is the same weighted blend but
without `bm_data_interp_from_elem`'s `fac <= 0` / `fac >= 1` copy short circuits, so it is now
`dataInterpFromVerts` for both exactness at the ends and to carry layers that have no blend rule.

### One thing this uncovered

`interpElemAttrs` treated *every* integer-storage layer as categorical and gave it the highest-weighted
source's value. Blender does no such thing. `CustomData_bmesh_interp` (`customdata.cc:4004`) dispatches
on each type's `.interp` callback, and three of the kernel's integer types have one:

| kernel type | Blender | rule |
| --- | --- | --- |
| `int32` | `layerInterp_propInt` (`:503`) | weighted sum, `int(round(result))` |
| `bool` | `layerInterp_propbool` (`:1471`) | true if any source with a positive weight is true |
| `byteColor` | `layerInterp_mloopcol` (`:914`) | weighted per channel, `round_fl_to_uchar_clamp` |
| `int8`, `int32x2` | no callback | destination left untouched, *not* set from a dominant source |

`byteColor` was the visible defect: a vertex-colour layer took one endpoint's colour verbatim on every
split instead of blending. `BMLayerDef` now carries `interp: BMLayerInterp` and `interpElemAttrs`
follows the table. The "dominant source" behaviour recorded in `01-m1-kernel-subplan.md` under
"Categorical layers are not blended" is superseded by it; material index is unaffected either way,
because `BMFace.matNr` is a header field rather than a layer, exactly as in Blender.

### Proof the regression tests bite

Disabling only the `dataInterpFaceVertEdge` call fails 8 of the 30 tests in
`plugins/mesh-kernel/src/bmesh/interp.test.ts` and none elsewhere. Among them: 60 of the 80 faces of a
subdivision-2 icosphere come back with a degenerate UV triangle, and the UVs along a subdivided base
edge stop advancing. The *total* UV area is unchanged under the bug - the twenty corner sub-triangles
each keep the whole base triangle's unwrap while the other sixty collapse - so the test asserts the
per-face area, not the sum.

### Not affected

`splitFaceMakeEdge`, `joinFaceKillEdge` and `joinEdgeKillVert` have no omission of this class.
`bmesh_kernel_split_face_make_edge` only copies from its example loops (`bm_loop_create(bm, v2, e, f,
l_v2, ...)`) and from the example face (`bm_face_create__sfme`), which the kernel already does;
`bmesh_kernel_join_face_kill_edge` and `bmesh_kernel_join_edge_kill_vert` touch no customdata at all.
Interpolation on a collapse lives one level up, in `BM_vert_collapse_faces`' `DO_V_INTERP`
(`bmesh_mods.cc`), which is an operator-layer concern and not ported yet.

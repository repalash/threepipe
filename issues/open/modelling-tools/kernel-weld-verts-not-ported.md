# `bmo_weld_verts` is not ported; `mergeVerts` stands in for it

Found while porting `lathe` (`plugins/mesh-kernel/src/generate/lathe.ts`), which needs to weld the
copies of a profile point that sits on the axis of revolution.

## The two welds Blender has, and which one the kernel has

| Blender | what it is | kernel |
| --- | --- | --- |
| `BM_vert_splice` / `BM_edge_splice` (`bmesh_core.cc:2395`, `:2678`) | 1:1 weld of coincident geometry; moves edges and loops, rebuilds nothing | **ported** in this work, `bmesh/euler.ts` |
| `bmo_weld_verts_exec` (`bmo_removedoubles.cc:184`) | general weld from a target map; splits faces whose non-adjacent corners collide, collapses edges, rebuilds faces from the map, then deletes in one pass | **not ported** |
| `bmo_pointmerge_exec` | builds a target map and calls `bmo_weld_verts_exec` | approximated by `mergeVerts` in `ops/duplicate.ts`, written directly rather than over a weld |

`mergeVerts` does the right thing for the lathe's pole (the quads along the on-axis column collapse to
a triangle fan, which `lathe.test.ts` asserts for a cone, a sphere and a mixed profile), but it is a
hand-rolled subset:

- It does not do `remdoubles_splitface`. A face with two *non-adjacent* corners merging has to be split
  first; `mergeVerts` instead drops it in the `catch` around `faceCreate`.
- It does not average vertex attributes across a cluster (`average_vert_data` / `use_centroid`).
- It does not maintain selection history across the merge
  (`BM_select_history_merge_from_targetmap`).
- It takes a vertex list rather than a target map, so it can only weld one cluster per call. The lathe
  calls it once per on-axis profile point.

## Bug found and fixed in passing

`mergeVerts` killed the original face before recreating it and then passed
`bm.faces.has(example) ? example : undefined` as the example - which is always `undefined`, because the
face had just been killed. Every rebuilt face therefore lost its header flags, its material slot, its
face attributes and all of its per-corner attributes. The comment claimed "its flags were copied before
the kill", and nothing was.

Fixed by creating the replacement while the original is still alive, using it as the example and
copying the per-corner attributes across, then killing the original - the order
`remdoubles_createface` uses. `mergeVerts` also grew a `selectResult` parameter (default `true`, so no
existing behaviour changed) because the lathe must not clear the user's selection.

## What is still worth doing

Port `bmo_weld_verts_exec` properly as `ops/weld.ts`, express `mergeVerts` over it the way
`bmo_pointmerge_exec` does, and give the lathe a single target-map weld instead of one call per pole.
`remove_doubles` will need the same machinery, and so will any boolean or merge-by-distance operator.

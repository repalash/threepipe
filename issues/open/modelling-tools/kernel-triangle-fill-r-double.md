# `triangleFill` cannot report a duplicate face: the kernel's `facesJoin` has no `r_double`

Found while porting `bmo_triangle_fill_exec` (`plugins/mesh-kernel/src/ops/triangleFill.ts`, track K),
which bisect's **Fill** uses (`mesh_bisect_exec`, `editmesh_bisect.cc:345`).

Blender's dissolve pass after the fill (`bmo_triangulate.cc:236-279`) calls
`BM_faces_join_pair(bm, l_a, l_b, false, &f_double)`. When the joined face turns out to duplicate a face
that already exists, `f_double` is set and the operator kills the *new* face and the edge, keeping the
existing geometry. The kernel's `facesJoin` / `facesJoinPair` (`ops/dissolve.ts`, `ops/dissolveEdges.ts`
on `modelling-editor`) do not port the `r_double` out-parameter, and on a double they return the
existing face early **without killing the faces being joined**, where `BM_faces_join`
(`bmesh_core.cc:1376-1388`, `:1430-1435`) kills them.

Effect today: the mesh ends up as Blender's (the operator's `else if (f_new)` branch kills the
leftovers with the edge), but the pre-existing face is added to `geom.out`, and so is selected by
bisect's fill. Only reachable when a fill overlaps an existing face; no fixture covers it.

Status: track F (`p3-fill`) is adding `rDouble` to `facesJoin` and fixing the double path in its
worktree. Once both are merged, pass `rDouble` from `triangleFill.ts` (the call site carries a comment
pointing here) and add a fixture with a fill over an existing face.

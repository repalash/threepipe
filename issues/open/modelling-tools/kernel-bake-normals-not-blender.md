# `bakeGeometry` normals are not Blender's, and there is no welded bake

**Status**: parts 1 and 2 are **fixed**; part 3 is still open.

**Severity**: medium. Nothing is wrong on the test meshes, and it is visible on real ones.

`plugins/mesh-kernel/src/bake.ts`. Found while moving the `.blend` importer onto the kernel's bake
(M2); not fixed there, because `bake.ts` is shared with `MeshEditPlugin` and `ModellingDocument.rebake`
and the change belongs with step 9 of
[`01-m1-kernel-subplan.md`](./01-m1-kernel-subplan.md), which already lists "corner-angle normals with
sharp-edge fans" as outstanding.

## 1. Vertex normals are an unweighted average

`bakeGeometry` accumulates each face's **unit** normal into every vertex it touches and normalises:

```ts
faceNormal(mesh, start, end, normal)
for (let c = start; c < end; c++) {
    const v = cornerVerts[c] * 3
    vertNormals[v] += normal[0]   // ...unweighted
}
```

Blender weights each contribution by the **angle the face subtends at that vertex**
(`blenkernel/intern/mesh_normals.cc:194`, `normals_calc_verts`):

```c
const int2 adjacent_verts = face_find_adjacent_verts(faces[face], corner_verts, vert);
const float3 dir_prev = math::normalize(positions[adjacent_verts[0]] - positions[vert]);
const float3 dir_next = math::normalize(positions[adjacent_verts[1]] - positions[vert]);
const float factor = math::safe_acos_approx(math::dot(dir_prev, dir_next));
vert_normal += face_normals[face] * factor;
```

Three does it a third way - `computeVertexNormals` accumulates the un-normalised cross product, i.e.
area weighting - so the importer's old output and the new one differ too, on any mesh where the faces
around a vertex have unequal angles. A pole vertex of a UV sphere, or a vertex where one long thin
triangle meets several square quads, is where it shows.

The fix is a direct port of the loop above. It is contained, but it changes the output of every bake,
so it needs a pass over `mesh-edit`'s and `modelling`'s snapshots at the same time rather than a
drive-by.

**Fixed.** `bake.ts` `computeNormals` now weights each face's contribution by the angle it subtends at
the corner's vertex, using exact `acos` where Blender uses its `safe_acos_approx` polynomial - the
same value, computed more precisely rather than differently. In the event none of the six interactive
snapshots moved: they are all axis-aligned boxes and lathes, where every face around a vertex subtends
the same angle and the two agree exactly. It is on a UV sphere's pole and on mixed triangle/quad
fans that they differ.

## 2. `sharp_edge` does not split normals

The bake reads `sharp_face` and nothing else. Blender additionally splits the normal fan at any edge
with `sharp_edge`, at the auto-smooth angle, and at a `custom_normal` layer
(`mesh_normals.cc`, `normals_calc_corners`). The `.blend` importer now carries `sharp_edge` into
`MeshData` for every file that has it (49 meshes in the 44-file corpus), and it is silently ignored at
bake time - so a mesh marked sharp along an edge loop renders smooth across it.

Because the bake is already corner-indexed, this costs no extra vertices: it is a question of which
corners share an accumulation bucket, not of splitting geometry.

**Fixed.** Corners are grouped into fans by union-find: two corners at the same vertex merge only
across an edge that is manifold, not `sharp_edge`, and between two faces neither of which is
`sharp_face`. A boundary edge has nothing to merge with and a non-manifold edge is treated as sharp,
which is `normals_calc_corners`' own rule. Still not ported: the auto-smooth angle and
`custom_normal`, neither of which the kernel has a layer for.

## 3. There is no welded bake, and import pays for it — **still open**

Every output vertex is one corner. That is right for editing and for exact per-corner attributes, and
it is what Blender's draw path does. It also means a cube imports as 24 vertices rather than 8, and a
482-vertex UV sphere as 1984.

The old importer welded by vertex, then split only where UVs differed, so on a seamless mesh it was
close to the vertex count and on a UV-mapped one close to the corner count. For a scene like
`archiviz.blend` the difference is real memory.

Worth an option on `BakeOptions` - weld corners whose every attribute matches, which is a hash over
the corner's attribute tuple and is what `BKE_mesh_calc_normals_split`-era exporters do. Not urgent;
recorded so the trade-off is a decision rather than an accident.

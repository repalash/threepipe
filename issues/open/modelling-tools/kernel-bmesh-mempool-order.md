# Kernel BMesh: element order is insertion order, Blender's is BLI_mempool order

The kernel's `BMesh` keeps vertices / edges / faces in insertion-ordered sets. Blender iterates a BMesh in
`BLI_mempool` order, where an element created after another was freed reuses the freed slot, so iteration (and
therefore `BM_mesh_elem_index_ensure` indices and the face order of `BM_mesh_bm_to_me`) differs from creation
order once an operator has killed and created elements (bevel, inset, dissolve...).

Geometry parity is unaffected (the parity suites compare meshes as multisets). It becomes visible where Blender's
*result* depends on element order:

- **Bevel `harden_normals` on a smooth cyclic fan** (`tests/bevel-harden-parity.test.ts`, case
  `cube-ring-s2-affected`): Blender writes each loop's custom normal in its fan space, then decoding averages the
  int16 encodings over the fan. In a cyclic fan the space's reference direction is the edge of the lowest-index
  loop, and an average of angle encodings depends on that reference, so the shaded normal of such a fan depends on
  mempool order. The kernel matches Blender everywhere else in that fixture; those 4 corners differ.

Fix: give `BMesh` a free-list slot order per element type that mirrors `BLI_mempool` (alloc reuses the most
recently freed slot, iteration walks slots in order), so indices and `bmToMesh` order match Blender's. This is a
structural change to the kernel BMesh, needs approval first.

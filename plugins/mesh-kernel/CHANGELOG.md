# @threepipe/mesh-kernel Changelog

## 0.1.0

- Initial package. `MeshData` struct-of-arrays mesh with n-gon faces, `AttributeStorage` over the
  point/edge/face/corner domains, edge derivation, validation and describe. Node-safe, no threepipe
  dependency.
- Subdivide (all of `bmo_subdivide.cc`), Subdivide Edge-Ring (`bmo_subdivide_edgering.cc`), Loop Cut
  (`editMeshLoopCut`) and its ring preview, with Blender parity fixtures.

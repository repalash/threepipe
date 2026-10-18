# plugin-procedural: Eigen port in `src/blender/math/eigen.ts` needs a licence decision

**Found by**: track2-procedural (nodes-function2 sub-agent), 2026-10-18.

Blender's `math::invert(float4x4)` and `math::determinant(float4x4)` (`blenlib/intern/math_matrix.cc:131,203`)
call Eigen. To reproduce Blender 5.2.2 on its reference platform (macOS arm64) bit for bit, Invert Matrix and
the matrix determinant were ported from Eigen commit 8a1083e9 (the commit Blender 5.2.2 builds,
`build_files/build_environment/cmake/versions.cmake:1474`): the NEON `compute_inverse_size4` block inverse with
FRECPE/FRECPS reciprocals and FMA `pmadd` chains. With a plain `1 / det` the results drift by up to 2 ulp.

Eigen is **MPL-2.0** (file-level copyleft); the package is Apache-2.0 (like `mesh-kernel`'s Blender ports, an
existing maintainer decision for GPL Blender code). The ported file now names its source and licence in its
header. Options for the maintainer:

1. Keep `eigen.ts` as an MPL-2.0 file inside the package (MPL allows combining; the file keeps its licence and
   notice), and add an MPL notice to the package NOTICE.
2. Replace it with the plain formula and accept up to 2 ulp differences for Invert Matrix on arm64 (x86 Blender
   builds differ from arm64 ones anyway: no FMA, `1 / x` reciprocal).

Nothing else in the package uses Eigen.

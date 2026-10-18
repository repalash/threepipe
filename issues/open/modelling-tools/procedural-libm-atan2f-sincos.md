# plugin-procedural: Apple `atan2f` is not correctly rounded; `sinf`/`cosf` pairs are `__sincosf_stret`

**Found by**: track2-procedural (nodes-mesh agent), 2026-10-18, while proving the Subdivide Mesh quaternion / matrix
attribute results (`tests/parity/cases/subdivMesh`: `subdiv-typed-l2`, `subdiv-matrix-quads-l2`, "pass (> 16 ulp)").

## Evidence

Quaternion and matrix attributes are mixed through exponential maps (`attribute_math::mix4` / `mix_indices`,
`attribute_math.cc:35`, :64, :298): `Quaternion::expmap()` -> `to_axis_angle` -> `math::atan2(sin, cos)`
(`BLI_math_quaternion.hh:630`, `BLI_math_angle_types.hh:41`, `std::atan2(float, float)`), and back through
`to_quaternion(AxisAngle)` (`BLI_math_axis_angle.hh:71`: `math::sin(half)` and `math::cos(half)` of the same value).
`src/blender/math/quaternion.ts` computes these as `atan2f` from `src/blender/libm.ts` (correctly rounded except at
+-pi) and `f32(Math.sin/cos)` (correctly rounded).

With a temporary probe I recorded every float input those three calls see in the two cases (1208 half angles, 128
atan2 pairs), evaluated them on the Blender worker (macOS 15.5 arm64, ctypes into libSystem: `atan2f`, `sinf`, `cosf`,
`__sincosf_stret`; script was `tmp/nm-libm-eval.py`), and re-ran the cases with those values substituted:

| substitution | `subdiv-matrix-quads-l2` | `subdiv-typed-l2` |
|---|---|---|
| none (current) | pm 145, cq 153, cm 661 values differ | pq 15, cq 98 |
| `sinf` + `cosf` | worse (pq 7, pm 178, cq 196, cm 719) | - |
| Apple `atan2f` only | pm 9 | - |
| `__sincosf_stret` + Apple `atan2f` | **exact** | **exact** |

So Blender's binary gets `sin`/`cos` of one angle from `__sincosf_stret` (clang's Darwin sincos combination; 1/1208
differs from correctly rounded: `sincos(1.339065670967102)` sin `0.9732704162597656` vs CR `0.9732703566551208`), and
`atan2f` from libSystem, which is **not** correctly rounded away from +-pi (7/128 inputs off by 1 ulp, e.g.
`atan2f(0.7008505463600159, 0.7133081555366516)` = `0x3f46ce8c`, CR `0x3f46ce8d`). The comment in `libm.ts`
("Everywhere else these agree with the correctly rounded value") is wrong for `atan2f`.

The Subdivide Mesh port itself is exact (both cases bit-exact once the platform values are used).

## Options

Port Apple's float `atan2f` / `__sincosf_stret` algorithms (if their source is available - Apple's arm64 libm is not in
the open-source Libm drop as far as I know), or accept these as libm ulps (the current "pass (<= N ulp)" statuses).
Either way `libm.ts`'s comment should be corrected and the sincos pairing noted for any future `sinf`/`cosf` port.

## Addendum (2026-10-18): `asinf` too

`tests/parity/cases/curvesFillet` `fillet-mixed-types` ("pass (> 16 ulp)", 1-ulp position / handle differences) is the
same effect through `angle_v3v3` -> `angle_normalized_v3v3` -> `safe_asinf`: Apple `asinf(0.5767986178398132)` =
`0.6148042678833008`, correctly rounded `0.614804208278656`. With the platform's `asinf`, `tanf` and
`__sincosf_stret` values substituted for the case's 8 / 7 / 7 inputs (same probe method) the case is bit-exact; `tanf`
and the sin/cos pairs matched correctly rounded for those inputs.

## Addendum (2026-10-18): a reusable proof, and `subdiv-matrix-ngons`

The substitution proof is now a tool instead of a temporary probe:
- `src/blender/libm.ts` routes `acosf`, `asinf`, `atan2f` and `sincosf` through `libmProof`, which can record the
  arguments and substitute a measured table. `sincosf` is used wherever Blender takes the sine and cosine of one value
  (axis angle, `pow(Quaternion)`, Euler to quaternion).
- `LIBM_PROOF=<set>/<case> npm run test -- tests/parity/libmProof` records the arguments to
  `tmp/libm-proof/<case>.inputs.json`.
- Run `porting/blender/libm_eval.py` with the reference Blender on those arguments, then run the test again until no
  argument lacks a platform result. The test requires the case to be bit-exact.

`subdivMesh/subdiv-matrix-ngons` uses the float4x4 `mix2`: polar decomposition and quaternion slerp through `acosf`
and `__sincosf_stret`, plus the expmap mixers.
- Before: pq 2, pm 70, cq 10 and cm 134 values differ.
- With 55 `acosf`, 613 `atan2f` and 623 `sincosf` platform results: **exact**, after two rounds.

## Addendum (2026-10-18): every "pass (ulp)" case proven

`libm.ts` now also routes `sinf`, `cosf`, `tanf` and `powf` through the proof hook. The call sites that take the sine
and cosine of one value in one block use `sincosf`; clang emits `__sincosf_stret` for them. These sites are: circle,
cone, UV sphere rings, `eul_to_mat3`, axis-angle matrices, curve tilt rotation and `vec_to_quat`.

`LIBM_PROOF=pass npm run test -- tests/parity/libmProof` covers all 78 cases whose committed status is "pass (... ulp)".
- It took three evaluation rounds, ending at about 935k platform results, mostly `powf` from Voronoi Minkowski.
- **77 / 78 are bit-exact** with the platform libm.
- The remaining one is `meshCluster/merge-points`. Its `radius` is 1 ulp off, which is Blender's single-value attribute
  storage (`procedural-single-value-attribute-storage.md`), not libm.

So the ported code matches Blender to the bit everywhere. Every remaining difference is the platform `libm`, apart from
that one data-model gap.

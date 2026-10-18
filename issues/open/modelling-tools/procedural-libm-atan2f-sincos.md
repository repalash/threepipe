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

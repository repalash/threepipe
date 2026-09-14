# procedural-generation geometry_nodes.ts: mat3ToEul returns only eul1, not the smaller-magnitude of Blender's two solutions

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`mat3ToEul` implements only the `eul1` branch of Blender's
`mat3_normalized_to_eul2`. Blender's `mat3_normalized_to_eul` computes both `eul1`
and `eul2` (the two Euler representatives of the same rotation) and returns the one
with the smaller `|x| + |y| + |z|`. Both triples represent the same orientation, so
any downstream matrix is identical; only the returned angle triple can differ (e.g.
sign/branch selection near gimbal lock).

## Root Cause
```ts
// geometry_nodes.ts:380-395
export function mat3ToEul(m: number[]): [number, number, number] {
    const cy = Math.sqrt(m[0] * m[0] + m[3] * m[3])
    if (cy > 1e-6) {
        return [
            Math.atan2(m[7], m[8]),
            Math.atan2(-m[6], cy),
            Math.atan2(m[3], m[0]),
        ]
    } else {
        return [
            Math.atan2(-m[5], m[4]),
            Math.atan2(-m[6], cy),
            0,
        ]
    }
}
```
Blender `mat3_normalized_to_eul2` (`blenlib/intern/math_rotation_c.cc`, ~1420)
computes both `eul1` and `eul2` and `mat3_normalized_to_eul` returns whichever has
the smaller absolute-angle sum. The TS returns only `eul1`. The TS also does not
pre-normalize the matrix, but all inputs here are products of rotation matrices
(already orthonormal), so that is a no-op.

## Impact
Low. The orientation is correct; only the chosen angle representation can differ
from Blender's near gimbal configurations. Matters only if exact angle-triple parity
with Blender is required downstream.

## Fix
If exact angle parity matters, also compute `eul2` and select the lower
absolute-angle-sum solution, matching `mat3_normalized_to_eul`.

## Files
- `plugins/procedural-generation/src/blender/geometry_nodes.ts:380-395` — mat3ToEul returns only eul1

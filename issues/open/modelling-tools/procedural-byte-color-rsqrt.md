# Byte-colour encoding uses a hardware rsqrt estimate in Blender

**Status**: open, low. Found while porting `color::encode` for plugin-procedural (track 2).

Blender's release builds convert linear float colours to sRGB bytes with the SIMD path of
`linearrgb_to_srgb_v3_v3` (`blenlib/intern/math_color.cc:633`), whose `x^(1/2.4)` uses
`_mm_rsqrt_ps`. On x86 that is the RSQRTPS estimate refined by one Newton step (`:552`); on arm64
(sse2neon) it is FRSQRTE plus sse2neon's own Newton steps. The estimates differ by platform, so the
byte a colour encodes to can differ by one between Blender on Intel and on Apple Silicon at rounding
boundaries.

`plugins/procedural/src/blender/color.ts` follows the SIMD path but uses an exact `1 / sqrt`. The
geonodes-kit `attr-conversions` reference (Blender 5.2.2) matches. If a parity case ever differs by
one byte in a byte colour, port sse2neon's `_mm_rsqrt_ps` (NEON FRSQRTE is specified in the Arm ARM)
for arm64 references rather than widening the tolerance.

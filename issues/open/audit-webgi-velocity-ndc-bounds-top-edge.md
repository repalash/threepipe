# webgi velocity shaders: NDC bounds-check ignores `prevPositionNDC.y >= 1.0` (top edge) — duplicate-x typo in both copies

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
The guard that zeroes velocity for previous positions outside NDC tests `prevPositionNDC.x >= 1.0` twice and never tests the upper-Y bound `prevPositionNDC.y >= 1.0`. The third clause is a copy/paste of the first.

## Root Cause
```glsl
if(prevPositionNDC.x >= 1.0 || prevPositionNDC.x <= -1.0 || prevPositionNDC.x >= 1.0 || prevPositionNDC.y <= -1.0) {
    return vec2(0.0);
}
```
Coverage is `x>1`, `x<-1`, `x>1` (duplicate), `y<-1` — `y >= 1.0` (top edge) is omitted. Both shader copies have the identical defect.

## Impact
When the previous frame's reprojected position was above the top of the screen (NDC y > 1), velocity is not zeroed, so TAA (and the SSGI/SSR reprojection that `#include <computeScreenSpaceVelocity>`) samples history off the top edge — producing reprojection smearing/ghosting along the top edge under camera/object motion. Both the velocity-buffer write path and the no-velocity-buffer fallback path are affected.

## Fix
Replace the third clause with `prevPositionNDC.y >= 1.0` in both files (or better: `any(greaterThanEqual(abs(prevPositionNDC), vec2(1.0)))`).

## Files
- `experiments/threepipe-webgi/src/plugins/buffer/shaders/VelocityBufferPlugin.mat.frag.glsl:13` — velocity-buffer write path
- `experiments/threepipe-webgi/src/utils/shaders/computeScreenSpaceVelocity.glsl:12` — identical copy used by the no-velocity-buffer fallback

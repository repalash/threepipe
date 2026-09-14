# webgi DepthOfFieldPlugin: in-focus distance can go negative when focal point is behind the camera

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`focalDepthRange.x` (the in-focus view distance) is the camera→focalPoint length scaled by the dot with the view direction. If the focal point is behind the camera (dot < 0), `focalDepthRange.x` becomes negative; nothing clamps it.

## Root Cause
```ts
pass.focalDepthRange.x = this._tempVec.length()
pass.focalDepthRange.x *= cam.getWorldDirection(new Vector3()).dot(this._tempVec.normalize())
```
`dofComputeCoC.glsl` / `dofCombine.glsl` then evaluate `coc = (depth - focalDepthRange.x)/focalDepthRange.y` with a negative focus distance.

## Impact
Reachable via `setFocalPoint(p)` with a point behind the camera: the whole scene goes out of focus and the near/far CoC sign inverts.

## Fix
Clamp `focalDepthRange.x` to a small positive minimum (or clamp the dot to `>= 0`).

## Files
- `experiments/threepipe-webgi/src/plugins/postprocessing/DepthOfFieldPlugin.ts:187-188` — no clamp on `focalDepthRange.x`

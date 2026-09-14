# webgi ssrt.glsl: SSCS re-trace chunk uses wrong loopMax for step counts > 23

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
The fourth re-trace chunk (gated on `_STEP_COUNT > 23`) passes `_STEP_COUNT-16` as `loopMax`, identical to the third chunk, so it cannot reach steps beyond 24; it should pass `_STEP_COUNT-24`.

## Root Cause
```glsl
if(_STEP_COUNT > 8  && state.z > 0.98) _traceRay(..., _STEP_COUNT-8,  iStepCount);
if(_STEP_COUNT > 15 && state.z > 0.98) _traceRay(..., _STEP_COUNT-16, iStepCount);
if(_STEP_COUNT > 23 && state.z > 0.98) _traceRay(..., _STEP_COUNT-16, iStepCount);  // should be -24
```
`_traceRay`'s inner loop is a fixed unrolled `for i<8` guarded by `if (UNROLLED_LOOP_INDEX < loopMax)`, so `loopMax` is the active sample count for that chunk, not an offset.

## Impact
Latent for the in-scope caller: this `ssrt.glsl` is only consumed by `SSContactShadowsPlugin`, whose `stepCount` UI is capped at `[1,8]`, so the `>23` chunk is dead today. If the step cap is ever raised, steps 25-32 would be silently skipped.

## Fix
Change the fourth chunk's `loopMax` to `_STEP_COUNT-24`.

## Files
- `experiments/threepipe-webgi/src/plugins/postprocessing/shaders/ssrt.glsl:84` — `_STEP_COUNT-16` should be `_STEP_COUNT-24`

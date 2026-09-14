# webgi RandomizedDirectionalLight: `distanceScale` has no effect (re-normalized away)

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`randomizePosition` scales the direction by `distanceScale`, but then re-normalizes it when assigning `target.position`, discarding the scale. `target.position` is always a unit vector.

## Root Cause
```ts
dir.multiplyScalar(this._randomParams.distanceScale)   // line 166
// ...
this.position.set(0, 0, 0)                              // line 179
this.target.position.copy(dir.normalize().negate())    // line 180: re-normalizes → drops distanceScale
```
`refreshShadowCamNearFar` then computes `dist = |target.position - shadow.camera.position|` ≈ 1 regardless of `distanceScale`.

## Impact
The `distanceScale` UI slider (AdvancedGroundPlugin, bounds `[0.01, 60]`) and the constructor default `distanceScale: 20` have no effect on the baked shadow's near/far planes. `minDistanceScale` is dead too. Likely a regression from the `.negate()` refactor.

## Fix
Decide where the magnitude should live. If only direction matters for a directional light, remove the dead `distanceScale`/`minDistanceScale` so the UI doesn't imply an effect; if near/far should scale with distance, don't re-normalize at line 180 (use the scaled `dir`) or factor `distanceScale` into `refreshShadowCamNearFar`.

## Files
- `experiments/threepipe-webgi/src/utils/RandomizedDirectionalLight.ts:166` — `multiplyScalar(distanceScale)`
- `experiments/threepipe-webgi/src/utils/RandomizedDirectionalLight.ts:179-181` — `dir.normalize().negate()` drops the scale

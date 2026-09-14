# ViewerRenderManager: numeric `msaa` sample count collapsed to boolean `true`, losing the requested count

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
The `msaa` option is typed `boolean | number`, so a user may pass an explicit sample count (e.g. `msaa: 8`). But `this.msaa = msaa && this.isWebGL2` collapses any nonzero number to boolean `true` via JS `&&`, discarding the count. Downstream, the requested sample count falls back to `DEFAULT_MSAA_SAMPLES` (4), so `msaa: 8` silently renders at 4x.

## Root Cause
```ts
this.msaa = msaa && this.isWebGL2   // `8 && true` === true — numeric count lost
```
Downstream `ExtendedRenderPass` computes `samples: msaa ? typeof msaa !== 'number' ? DEFAULT_MSAA_SAMPLES : msaa : 0`. Since `this.msaa` is now boolean `true`, `typeof msaa !== 'number'` is true → falls back to `DEFAULT_MSAA_SAMPLES`. A numeric request is never honored.

## Impact
Any explicit numeric `msaa` request (≠ the default) is silently downgraded to 4 samples. Note: the targetOptions in the constructor currently hardcode `samples: 0` with the msaa-based line commented out, so the count does not even reach those targets — but the boolean-collapse bug is the right thing to fix at the source.

## Fix
Preserve the numeric value when WebGL2:
```ts
this.msaa = this.isWebGL2 ? msaa : false
```

## Files
- `src/viewer/ViewerRenderManager.ts:57` — `msaa = msaa && this.isWebGL2` collapses numeric count to boolean
- `src/viewer/ViewerRenderManager.ts:12,32` — `msaa` typed `boolean | number`
- `src/postprocessing/ExtendedRenderPass.ts:42,83` — downstream `samples` computation falls back to `DEFAULT_MSAA_SAMPLES`

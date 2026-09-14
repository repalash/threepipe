# webgi TemporalAAPlugin: `jitterSample` and `projection` uniforms declared but never set/used

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
The TAA pass declares `projection` and `jitterSample` uniforms that are never written from TS and never meaningfully used in the shader.

## Root Cause
```ts
projection: {value: new Matrix4()},
// ...
jitterSample: {value: new Vector2()},
```
In the TAA shader (`utils/shaders/temporalaa.glsl`) `jitterSample` appears only in commented-out `// todo` lines and `projection` is unused — velocity is computed from `lastProjectionViewMatrix`/`currentProjectionViewMatrix`/`inverseViewMatrix`, all of which *are* wired in `updateCameraProperties`.

## Impact
Pure dead uniforms; no functional impact, but they imply jitter handling that does not exist.

## Fix
Remove the unused uniforms (or implement the jitter offset they imply).

## Files
- `experiments/threepipe-webgi/src/plugins/postprocessing/TemporalAAPlugin.ts:209` — `projection` dead uniform
- `experiments/threepipe-webgi/src/plugins/postprocessing/TemporalAAPlugin.ts:211` — `jitterSample` dead uniform

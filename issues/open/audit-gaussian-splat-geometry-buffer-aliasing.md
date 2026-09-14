# GaussianSplatGeometry: attribute arrays alias the buffer transferred back to the worker

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`GaussianSplatGeometry.update()` assigns `color`, `quat`, `scale` (which are `subarray` views into the worker `result` buffer) directly as attribute `.array`s, then later transfers that same `result` buffer back to the worker via `transfer(result, [result])`, which detaches its underlying `ArrayBuffer`. After the transfer the three attribute arrays reference a detached (length-0) buffer.

## Root Cause
```ts
const {quat, scale, center, color} = this._extractViews(result) // subarrays of `result`

if (this._centersBuffer.length !== center.length) this._centersBuffer = new Float32Array(center)
else this._centersBuffer.set(center)

;(this.attributes.color as InstancedBufferAttribute).array = color;   // aliases result
(this.attributes.quat as InstancedBufferAttribute).array = quat;      // aliases result
(this.attributes.scale as InstancedBufferAttribute).array = scale;    // aliases result
(this.attributes.center as InstancedBufferAttribute).array = this._centersBuffer // copied, safe
// ...
await pms                                       // waits for onUpload of color/quat/scale
await this._worker.returnBuffer(transfer(result, [result]))  // DETACHES result's ArrayBuffer
```
`_extractViews` returns `subarray` views into `new Float32Array(result)` (lines 112-130). Only `center` is defensively copied into the persistent `_centersBuffer`; `color`/`quat`/`scale` are not given the same treatment, so they keep pointing at `result`, which is then detached.

## Impact
Blunted in steady state: `await pms` resolves on `onUpload`, which the modded `WebGLAttributes` fires *inside* `gl.bufferData`/`gl.bufferSubData` (after the GPU has consumed the array), so the currently-rendered frame is intact. Corruption only surfaces when the renderer re-reads `.array` after the detach but before the next `update()` swaps in a fresh `result` — e.g. a forced re-upload after WebGL context loss, or a second GPU upload of the same attribute before the next sort. In those paths the attribute reads a detached/empty buffer (zero-length), producing missing or broken splats. The contract "attribute array points at a buffer we then detach and hand to another thread" is fundamentally unsound.

## Fix
Mirror the `_centersBuffer` pattern for all four attributes: copy `color`, `quat`, `scale` into persistent reused `Float32Array`s before assigning them to the attribute `.array`s, OR keep ownership of `result` on the main thread (do not transfer it back) until the next update overwrites it.

## Files
- `plugins/gaussian-splatting/src/three-gaussian-splat/geometry/GaussianSplatGeometry.ts:58-87` — `update()` aliases then transfers `result`
- `plugins/gaussian-splatting/src/three-gaussian-splat/geometry/GaussianSplatGeometry.ts:112-130` — `_extractViews` returns `subarray` views into `result`
- `plugins/gaussian-splatting/src/three-gaussian-splat/geometry/GaussianSplatGeometry.ts:60-61` — `center` is already copied to `_centersBuffer`; color/quat/scale are not

## Related
- `audit-gaussian-splat-leaks-and-limits.md` — other gaussian-splatting lifecycle defects

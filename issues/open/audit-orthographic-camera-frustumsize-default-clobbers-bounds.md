# OrthographicCamera: default frustumSize=4 discards explicit left/right/top/bottom and isn't serialized

**Severity:** high
**Found:** 2026-06-13 code audit

## Bug
`OrthographicCamera2` defaults `_frustumSize` to `4` in its constructor. Because `refreshFrustum` only early-returns when `_frustumSize === undefined`, the default `4` actively recomputes `left/right/top/bottom` from the frustum size (half-extent 2 × aspect), overwriting any explicit bounds that were passed in. This breaks the `OrthographicCamera0` construct path used by the glTF and Blend loaders, which pass explicit `xmag/ymag` bounds and `frustumSize=undefined`. Separately, `frustumSize` is never `@serialize`'d, so it is lost on round-trip and a post-load resize clobbers the restored bounds.

## Root Cause
Constructor forces `_frustumSize` to `4` when none is supplied:
```ts
// OrthographicCamera2 ctor
this._frustumSize = frustumSize ?? 4
...
this.refreshFrustum(false)
```
`refreshFrustum` only no-ops for `undefined`, not for the default `4`:
```ts
refreshFrustum(setDirty = true) {
    if (this._frustumSize === undefined) return   // 4 !== undefined → proceeds
    this.top = this._frustumSize / 2
    this.bottom = -this.top
    this.left = this.bottom * this.aspect
    this.right = this.top * this.aspect
    ...
}
```
The glTF/Blend ctor passes explicit bounds and `undefined` for frustumSize:
```ts
// OrthographicCamera0 (registered as GLTFLoader.ObjectConstructors.OrthographicCamera
//   and BlendLoadPlugin OrthographicCamera)
constructor(left, right, top, bottom, near, far) {
    super(undefined, undefined, undefined, undefined, left, right, top, bottom, near, far, 1)
    //    ^frustumSize=undefined → ctor sets _frustumSize = 4 → refreshFrustum overwrites bounds
}
```
three.js GLTFLoader builds it as `new OrthographicCamera(-xmag, xmag, ymag, -ymag, znear, zfar)`, so the explicit bounds are immediately overwritten by the half-extent-2 frustum.

Serialization side: `left/right/top/bottom` are `@serialize`'d but `_frustumSize` / the `frustumSize` accessor are not. On load, a reconstructed camera keeps the default `_frustumSize = 4`; then `refreshAspect` (`iCameraCommons`) on resize calls `refreshFrustum(false)` and (since `4 !== undefined`) overwrites the deserialized bounds.

## Impact
- Orthographic cameras imported from glTF/Blend render with bounds of ±2 (scaled by aspect) instead of the file's `xmag/ymag` — wrong zoom/framing for every imported ortho camera.
- `frustumSize` value is not persisted across save/load.
- Even when `left/right/top/bottom` are serialized for a manual-bounds camera, the first resize after load wipes them back to the frustum-derived bounds because `_frustumSize` defaults to `4`.

## Fix
Default `_frustumSize` to `undefined` (not `4`) in the constructor so `refreshFrustum` early-returns whenever explicit bounds are supplied — i.e. `this._frustumSize = frustumSize` (or guard on whether left/right/top/bottom were passed). Additionally `@serialize` the `frustumSize` value so it round-trips. With both, manual-bounds cameras keep `_frustumSize === undefined` and survive resizes, and explicit-frustum cameras restore their size.

## Files
- `src/core/camera/OrthographicCamera2.ts:173` — ctor forces `_frustumSize = frustumSize ?? 4`
- `src/core/camera/OrthographicCamera2.ts:245` — `refreshFrustum` only no-ops for `undefined`, so default `4` overwrites bounds
- `src/core/camera/OrthographicCamera2.ts:475` — `OrthographicCamera0` (glTF/Blend ctor) passes `frustumSize=undefined`, triggering the default
- `src/core/camera/OrthographicCamera2.ts:62-77` — `_frustumSize` / `frustumSize` accessor have no `@serialize` (only left/right/top/bottom do, lines 48/52/56/60)

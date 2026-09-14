# AssetManager: camera replacement `??`/ternary precedence always builds a fresh PerspectiveCamera

**Severity:** high
**Found:** 2026-06-13 code audit

## Bug
When upgrading/replacing a parented `Camera` during import, the expression that decides whether to reuse a cached `iCamera` or construct a new `PerspectiveCamera2`/`OrthographicCamera2` is mis-parenthesized. `??` binds tighter than `?:`, so the cached camera is never reused, and orthographic source cameras are wrongly rebuilt as perspective.

## Root Cause
```ts
const newCamera: ICamera = (camera as any).iCamera ??
!(camera as Partial<ICamera>).isOrthographicCamera ?
    new PerspectiveCamera2('', manager.viewer.canvas) :
    new OrthographicCamera2('', manager.viewer.canvas)
if (camera === newCamera) continue
```
`??` has higher precedence than `?:`, so this parses as:
```ts
((camera.iCamera ?? !camera.isOrthographicCamera) ? Persp : Ortho)
```
When `camera.iCamera` is a truthy cached object, the ternary condition is that object (truthy) → it **always** constructs a fresh `PerspectiveCamera2`. The cached `iCamera` is never returned, and an orthographic source with a cached `iCamera` is rebuilt as a perspective camera. The `if (camera === newCamera) continue` guard is dead — a freshly-constructed object can never `===` the source camera.

## Impact
On every re-import (or re-process) of a scene with a parented camera, a brand-new `PerspectiveCamera2` is constructed instead of reusing the previously-built `iCamera`. Orthographic cameras with a cached `iCamera` silently become perspective. The intended reuse / no-op short-circuit never happens.

## Fix
Group explicitly so `??` is the fallback for `iCamera`:
```ts
const newCamera: ICamera = (camera as any).iCamera ??
    (!(camera as Partial<ICamera>).isOrthographicCamera
        ? new PerspectiveCamera2('', manager.viewer.canvas)
        : new OrthographicCamera2('', manager.viewer.canvas))
```

## Files
- `src/assetmanager/AssetManager.ts:755` — mis-parenthesized camera replacement expression (`if (camera === newCamera) continue` guard at 759 is dead)

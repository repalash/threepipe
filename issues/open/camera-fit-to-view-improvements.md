# Camera Fit-to-View Improvements

## Problem

`getFittingDistance` in `src/three/utils/camera.ts` has two issues:

### 1. World-AABB depth term assumes camera looks along Z

The formula uses `size.z / 2` as the depth term regardless of camera direction:
```ts
const dx = size.z / 2 + Math.abs(size.x / 2 / Math.tan(fovh / 2))
const dy = size.z / 2 + Math.abs(size.y / 2 / Math.tan(fov / 2))
```

For a long object along X viewed from the X direction, `size.z` is near-zero while the actual depth along the view axis is `size.x` — produces incorrect (too close) distance.

### 2. No orthographic camera support

Returns `1` for ortho cameras. `fitObject` then just moves the camera 1×multiplier units away, which doesn't frame the object at all. For ortho, framing should adjust `zoom` (or `frustumSize`), not camera distance.

## Proposed Solution: Per-Corner Formula

Instead of using AABB dimensions directly, project the 8 AABB corners onto the camera's right/up/forward axes via dot products:

```
D = max over all 8 corners of max(
    qz + |qx| / tan(fovH/2),
    qz + |qy| / tan(fovV/2)
)
```

Where `qx`, `qy`, `qz` are corner offsets from bbox center projected onto camera axes.

This is more accurate than a view-aligned AABB approach (used by camera-controls) because it evaluates each corner individually rather than combining independent maxima. Degenerates to the current formula when camera looks along world-Z.

For ortho: compute fitting zoom as `min(baseWidth / (2*max|qx|), baseHeight / (2*max|qy|))`.

## Research Summary

All major engines (Blender, Unity, Babylon, camera-controls) use view-aligned bounds. None use world-AABB dimensions directly. The per-corner approach is tighter than view-aligned AABB.

| Engine | Bounding | Ortho Handling |
|---|---|---|
| camera-controls | View-aligned AABB | Adjusts `camera.zoom` |
| Babylon.js | Sphere from AABB diagonal | Sets ortho extents |
| Unity | Sphere (`extents.magnitude`) | `size * 2` |
| Blender | Bounding sphere | Adjusts ortho scale |
| **threepipe (current)** | **World AABB (broken for rotated views)** | **Not supported (returns 1)** |

## Files to Modify

- `src/three/utils/camera.ts` — rewrite `getFittingDistance`, add `getFittingZoom`
- `src/three/utils/index.ts` — export `getFittingZoom`
- `src/core/object/iCameraCommons.ts` — ortho branch in `fitObject`
- `src/plugins/animation/CameraViewPlugin.ts` — ortho branch in `animateToFitObject`
- `src/core/object/RootScene.ts` — remove outdated todo in `dollyActiveCameraFov`

## Detailed Plan

See `/home/aibox/.claude/plans/vivid-riding-horizon.md`

## Priority

Medium — affects visual correctness of camera framing for non-axis-aligned views and ortho cameras.

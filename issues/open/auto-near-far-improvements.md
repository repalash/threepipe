# Auto Near/Far Plane Improvements

## Problem

`refreshActiveCameraNearFar` in `src/core/object/RootScene.ts` (line 619) uses a bounding-sphere-from-AABB approach with a `dist1` dot-product correction. This works reasonably but has known limitations:

### Current Algorithm
1. Compute scene AABB via `getBounds()`
2. Derive radius: `1.5 * max(0.25, diagonalLength) / 2`
3. Camera-to-center distance: `dist`
4. Dot-product correction: `dist1 = max(0.1, -normalize(camToCenter).dot(camForward))`
5. `near = max(minNear, dist1 * (dist - radius))`
6. `far = min(max(near + radius, dist1 * (dist + radius)), maxFar)`

### Issues
- **Bounding sphere overestimates** — the 1.5× radius multiplier plus sphere-from-AABB means near/far range is wider than needed, wasting depth precision
- **Includes geometry behind the camera** — objects entirely behind the camera still push far plane out
- **Performance concern** — full scene traversal (`getBounds`) on every camera update (existing TODO at line 636)
- **`dist1` correction is approximate** — works for most cases but can produce odd results at extreme angles

### Existing TODOs in Code
- Line 636: `// todo check if this takes too much time with large scenes`
- Line 637: `// todo: can we use this._sceneBounds or will it have some issue with animation?`
- Line 662: `// todo try using minimum of all 6 endpoints of bbox.`

## Proposed Solution: 8-Corner View-Axis Projection

Project the 8 AABB corners onto the camera's view axis (forward direction) and take min/max:

```
for each corner:
    viewZ = dot(corner - camPosition, camForward)
    nearZ = min(nearZ, viewZ)
    farZ = max(farZ, viewZ)

near = max(minNear, nearZ)
far = min(maxFar, farZ)
```

### Benefits
- **Tighter bounds** — no bounding sphere overestimation, no 1.5× multiplier needed
- **Naturally handles camera direction** — no `dist1` correction needed, the dot product with camForward is built into the formula
- **Corners behind the camera** get negative viewZ, so near clamps to > 0 naturally
- **Same approach as fit-to-view improvement** — shares the per-corner projection concept (see `camera-fit-to-view-improvements.md`)

### Edge Cases to Consider
- Camera inside the AABB (all corners surround the camera) — near should clamp to minNear
- Empty scene — fallback to defaults
- Very thin objects (near ≈ far) — ensure minimum range
- Animated objects changing bounds frame-to-frame — smoothing to prevent swimming

## Research Summary

| Engine | Auto Near/Far? | Approach |
|---|---|---|
| Three.js | No | Manual |
| Blender | No | Manual (Clip Start/End) |
| Unity (game) | No | Manual |
| Unity (editor) | Partial | Scene View auto-adjusts (buggy) |
| Unreal | No (not needed) | Reversed-Z + float depth eliminates the problem |
| Babylon.js | No | Manual (`camera.minZ`/`maxZ`) |
| drei (`<Bounds>`) | Optional | Separate `clip()` method, bbox-based |
| **threepipe** | **Yes** | **Bounding sphere from AABB + dot product correction** |

### Depth Precision Fundamentals
- 24-bit depth buffer: keep `far/near < 10,000` for acceptable precision, `< 1,000` for good
- Near plane has far more impact than far — moving near from 0.01→0.1 improves precision 10× everywhere
- **Reversed-Z with float depth** (Unreal approach) is the gold standard — eliminates most precision issues. Worth considering for WebGPU migration.

### Performance Considerations
- Current approach recomputes full scene bounds on every camera update (event-driven, not per-frame)
- Could cache bounds and only recompute on scene hierarchy changes (the TODO at line 637)
- The 8-corner projection itself is trivial (8 dot products) — the expense is in `getBounds()`

## Files to Modify

- `src/core/object/RootScene.ts` — rewrite `refreshActiveCameraNearFar`

## Related

- `camera-fit-to-view-improvements.md` — shares the per-corner projection approach
- `webgpu-*.md` — reversed-Z depth would be a natural improvement when WebGPU lands

## Priority

Medium — current implementation works for most cases. Improvement gives tighter depth precision and cleaner code.

# TransformControls.updateMatrixWorld drops the `force` parameter (defeats subtree skip-optimization)

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
The fork's top-level `TransformControls.updateMatrixWorld()` takes no `force` parameter and ends with `super.updateMatrixWorld( this )`, passing the always-truthy `this` as `Object3D.updateMatrixWorld(force)`'s `force` argument. This force-recomputes the gizmo + plane subtree's world matrices every frame regardless of the renderer's real `force` value. NOTE: this is NOT a correctness bug — the gizmo/plane recompute their key vars unconditionally anyway, so output is identical; it only defeats the `matrixWorldNeedsUpdate` skip-optimization for the gizmo subtree. Filed purely as a perf/signature-drift note.

## Root Cause
```js
// updateMatrixWorld  updates key transformation variables
updateMatrixWorld() {            // <-- no `force` param
    // ... decompose object/camera matrices ...
    super.updateMatrixWorld( this );   // `this` (truthy) passed as `force`
}
```

`Object3D.updateMatrixWorld(force)` (`three.js-modded/src/core/Object3D.js`) forwards `force` to every child, so the entire gizmo + plane subtree is force-recomputed each frame. Upstream three.js declares `updateMatrixWorld( force )` and passes the real `force` through. The child `TransformControlsGizmo.updateMatrixWorld(force)` and `TransformControlsPlane.updateMatrixWorld(force)` DO take and use `force` correctly — only the top-level class diverges.

## Impact
No behavioral/correctness difference. The gizmo subtree skips the matrixWorld update fast-path on every frame even when nothing changed — a minor, constant per-frame cost while the gizmo is attached. Looks like accidental signature drift from upstream.

## Fix
Declare `updateMatrixWorld( force )` and pass the real `force` through: `super.updateMatrixWorld( force )`, matching upstream and the child classes.

## Files
- `src/three/controls/TransformControls.js:184` — `updateMatrixWorld()` declared without `force`
- `src/three/controls/TransformControls.js:220` — `super.updateMatrixWorld( this )` passes truthy `this` as `force`

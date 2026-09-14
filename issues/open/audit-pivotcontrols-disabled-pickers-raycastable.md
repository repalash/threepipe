# PivotControls: disabled/hidden handle pickers remain raycastable

**Severity:** high
**Found:** 2026-06-13 code audit

## Bug
When a PivotControls handle is disabled (`disableRotations`/`disableScaling`/`disableAxes`/`disableSliders`, or an inactive `activeAxes[i]`), the handle is only hidden visually. Its invisible picker mesh is still intersected by the raycaster, so the user can still grab and drag a handle that is supposed to be disabled or hidden.

## Root Cause
`updateHandleVisibility()` disables a handle by toggling `.visible` on its gizmo meshes and on the picker's parent group:

```ts
for (const m of h.gizmoMeshes) m.visible = vis
for (const m of h.pickerMeshes) {
    // pickers are always invisible but we toggle their raycast-ability via parent
    if (m.parent) m.parent.visible = vis
}
```

But `_getAllPickers()` collects EVERY picker mesh unconditionally, regardless of `.visible`:

```ts
private _getAllPickers(): Object3D[] {
    const result: Object3D[] = []
    for (const h of this._handles) {
        for (const m of h.pickerMeshes) result.push(m)
    }
    return result
}
```

and `_handlePointerDown` (and hover) call `this._raycaster.intersectObjects(this._getAllPickers(), true)`.

The project resolves `three` to `three-modded` (`package.json`: `"three": "npm:three-modded@0.168.10006"`). That fork's `Raycaster.intersect()` (`three.js-modded/src/core/Raycaster.js:102-126`) removed the `if (object.visible === false) return;` guard that stock three.js has — it tests only `object.layers`. So toggling `.visible` on a picker does NOT remove it from raycasting. (Pickers are also created with `visible=false` by design, which is precisely why picking has always relied on the modded raycaster ignoring visibility — making the disable-via-`.visible` approach self-defeating here.)

## Impact
A handle the API/UI marked as disabled (rotation/scale/axis/slider off, or an inactive axis) can still be grabbed and dragged, mutating the attached object's transform in ways the caller explicitly disabled. The visual hiding is misleading: the control accepts input on invisible pickers.

## Fix
Filter `_getAllPickers()` to only include pickers whose handle passes the same enable test as `updateHandleVisibility()`. For example, compute and store a per-handle `enabled` boolean inside `updateHandleVisibility()` and skip disabled handles in `_getAllPickers()`, instead of relying on `.visible` (which the modded raycaster ignores).

## Files
- `src/three/controls/PivotControls.ts:481-485` — `updateHandleVisibility()` disables handles via `.visible` (ineffective for picking)
- `src/three/controls/PivotControls.ts:583-589` — `_getAllPickers()` returns all pickers unconditionally
- `src/three/controls/PivotControls.ts:604` — raycast against all pickers in `_handlePointerDown`
- `three.js-modded/src/core/Raycaster.js:102-126` — modded `intersect()` has no `.visible` guard (root reason `.visible` toggling fails)

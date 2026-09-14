# PointerLockControls2.update() ignores the `enabled` flag

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`PointerLockControls2` declares `enabled` as a user/serialized toggle, but `update()` never checks it. Setting `enabled = false` does not stop the control from rotating the camera (when locked and the pointer moves), diverging from sibling controls and from upstream three.js semantics.

## Root Cause
```ts
@uiToggle() @serialize() enabled = true
// ...
update() {
    if (Math.abs(this._movementX) < 0.0001 && Math.abs(this._movementY) < 0.0001) return
    _euler.setFromQuaternion(this.object.quaternion)
    _euler.y -= this._movementX * 0.002 * this.pointerSpeed
    _euler.x -= this._movementY * 0.002 * this.pointerSpeed
    // ... applies rotation; never reads this.enabled
}
```

The viewer drives controls via `ThreeViewer.update()` (`cam.controls?.update()`) every frame, gated only by `cam.canUserInteract`, NOT by `controls.enabled`. The sibling `FirstPersonControls2.update()` correctly starts with `if (!this.enabled) return`. Upstream three.js `PointerLockControls` additionally guards `onMouseMove`/movement on `this.enabled === false`; this fork's `onMouseMove`/`onElementClick`/`lock` also never consult `enabled`.

## Impact
Toggling `enabled = false` (via UI or programmatically) has no effect — the camera still rotates on pointer movement while locked. Inconsistent with `FirstPersonControls2` and the documented `enabled` contract.

## Fix
Add `if (!this.enabled) return` at the top of `update()`. Ideally also guard `onMouseMove`/`onElementClick`/`lock` on `enabled` to match upstream three.js and the other controls.

## Files
- `src/three/controls/PointerLockControls2.ts:177-195` — `update()` never checks `this.enabled`
- `src/three/controls/PointerLockControls2.ts:34` — `enabled` declared as serialized UI toggle
- `src/three/controls/FirstPersonControls2.ts` — sibling control that correctly early-returns on `!this.enabled`

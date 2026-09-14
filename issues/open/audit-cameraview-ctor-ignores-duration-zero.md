# CameraView: constructor/clone silently reset a meaningful `duration=0` to 1

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`duration = 0` is a documented, meaningful value ("Set to 0 for instant camera jump"), but the `CameraView` constructor only assigns `duration` when it is both not `undefined` and not `0`. Passing `0` is silently dropped, leaving the field at its default `1`. `clone()` re-runs the constructor with `this.duration`, so a view whose duration is `0` clones back to `1`.

## Root Cause
```ts
constructor(name?, position?, target?, quaternion?, zoom?, duration = 1, isWoldSpace?) {
    ...
    if (duration !== undefined && duration !== 0) this.duration = duration   // 0 rejected
}
...
clone() {
    return new CameraView(this.name, this.position, this.target, this.quaternion, this.zoom, this.duration, this.isWorldSpace)
}
```
The field default is `1` (and the param default is `1`), so the `duration !== 0` clause means a caller-supplied `0` never overwrites the default. On `clone()`, `this.duration === 0` is passed back into the constructor, rejected by the same guard, and the clone gets `duration = 1`. The field's own doc comment (`Set to 0 for instant camera jump`) confirms `0` is intended.

## Impact
A camera view configured for an instant jump (`duration = 0`) constructed via the constructor — or any `duration=0` view that is cloned — silently becomes a 1× animated transition instead of an instant cut.

## Fix
Drop the `&& duration !== 0` clause, keeping only the `undefined` check:
```ts
if (duration !== undefined) this.duration = duration
```

## Files
- `src/core/camera/CameraView.ts:69` — ctor guard rejects `duration === 0`
- `src/core/camera/CameraView.ts:86` — `clone()` re-runs the ctor, losing a `0` duration

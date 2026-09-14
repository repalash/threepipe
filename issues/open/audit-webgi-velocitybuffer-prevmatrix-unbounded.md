# webgi VelocityBufferPlugin: `_previousWorldMatrices` cache never pruned (per-object map grows unbounded)

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`SSVelocityMaterial` keeps a `Record<string, Matrix4>` keyed by `object.uuid`, populated in `onBeforeRender` for every object that renders to the velocity buffer, with no removal when objects leave the scene.

## Root Cause
```ts
private _previousWorldMatrices: Record<string, Matrix4> = {}

onBeforeRender(... object: IObject3D, ...) {
    // ...
    if (prevMatrix) { prevMatrix.copy(object.matrixWorld) }
    else { this._previousWorldMatrices[object.uuid] = object.matrixWorld.clone() }
}
```
There is no eviction when objects are deleted from the scene.

## Impact
In a long-running app with object churn (load/unload models, transient widgets), the map accumulates a `Matrix4` per ever-seen uuid forever. Not a crash, but an unbounded leak proportional to lifetime object count.

## Fix
Periodically prune entries for objects no longer in the scene, clear the cache on scene/model changes, or store the previous matrix on `object.userData` so it dies with the object.

## Files
- `experiments/threepipe-webgi/src/plugins/buffer/VelocityBufferPlugin.ts:217` — `_previousWorldMatrices` map
- `experiments/threepipe-webgi/src/plugins/buffer/VelocityBufferPlugin.ts:222-230` — populated per object, never pruned

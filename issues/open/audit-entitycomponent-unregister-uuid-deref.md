# EntityComponentPlugin.unregisterComponent: dereferences `obj.uuid` after detecting `obj` is undefined

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`unregisterComponent` defensively handles `comp.object` being falsy with a `console.warn` ("component already destroyed"), but does **not** return — execution continues to `this._components.delete(obj.uuid + comp.uuid)`, which throws `TypeError: Cannot read properties of undefined (reading 'uuid')` when `obj` is undefined.

## Root Cause
```ts
const obj = comp.object
let state: Record<string, any>|null = null
if (!obj) {
    console.warn('EntityComponentPlugin: component already destroyed', comp)   // warns, no return
} else {
    // ...stop/destroy...
}
this._components.delete(obj.uuid + comp.uuid)            // obj.uuid throws if obj is undefined
// ...
const comps = EntityComponentPlugin.ObjectToComponents.get(obj) || []
// ...
if (obj) this.dispatchEvent({...})                       // author re-guards obj here, confirming it can be falsy
```
The `if (obj)` re-guard on the dispatch line shows the author knew `obj` may be falsy at this point, yet the `obj.uuid` access two lines earlier is unconditional.

## Impact
Reachable when a component's `object` is undefined after it has been destroyed/torn down (e.g. double-remove). Hits the warn branch, then crashes on `obj.uuid`.

## Fix
`return` (or guard the map-key access) inside the `if (!obj)` branch, e.g. compute the component key only when `obj` exists, or early-return after the warning.

## Files
- `src/plugins/extras/EntityComponentPlugin.ts:467-469` — `if (!obj)` warns but does not return
- `src/plugins/extras/EntityComponentPlugin.ts:484` — unconditional `obj.uuid` deref
- `src/plugins/extras/EntityComponentPlugin.ts:503` — author re-guards with `if (obj)` for the dispatch

See `audit-entitycomponent-objectremove-drops-all-uiconfig-children.md` and `audit-entitycomponent-objecttocomponents-map-not-weakmap.md`.

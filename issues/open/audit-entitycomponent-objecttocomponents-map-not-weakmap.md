# EntityComponentPlugin.ObjectToComponents: declared `WeakMap` but instantiated as `Map` (strong refs leak objects)

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
The static `ObjectToComponents` map is typed `WeakMap` (so detached objects can be garbage-collected) but is constructed with `new Map()`, which holds strong references to its keys. Because the map is `static` and lives for the whole app lifetime, every `IObject3D` ever registered is retained forever unless explicitly `.delete()`d.

## Root Cause
```ts
static readonly ObjectToComponents: WeakMap<IObject3D, Object3DComponent[]> = new Map() // key = object
```
`Map` and `WeakMap` share `get`/`set`/`delete`, so this compiles via structural overlap, masking the mismatch. The `WeakMap` annotation was clearly intended to allow GC of objects that are otherwise unreferenced.

## Impact
Any object with components that is dropped/GC'd without going through proper `unregisterComponent`/`_objectRemove` teardown (error paths, partial cleanup where the comps array is never fully drained) leaks permanently for the app lifetime.

## Fix
Use `new WeakMap()` to match the declared type. Current code only uses `get`/`set`/`delete` on it (no iteration), so `WeakMap` is compatible. The sibling caches in `setupComponent.ts:171-174` (`ComponentCache.TypeProperties`/`InstanceProperties`) have the identical declared-WeakMap/`new Map()` mismatch and should be fixed the same way.

## Files
- `src/plugins/extras/EntityComponentPlugin.ts:80` — `WeakMap`-typed field initialized with `new Map()`
- `src/plugins/extras/components/setupComponent.ts:171-174` — same pattern in `ComponentCache`

See `audit-entitycomponent-objectremove-drops-all-uiconfig-children.md` and `audit-entitycomponent-unregister-uuid-deref.md`.

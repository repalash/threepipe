# EntityComponentPlugin._objectRemove: uiConfig filter drops ALL children instead of only the component folder

**Severity:** high
**Found:** 2026-06-13 code audit

## Bug
When an object is removed (or `_objectRemove` runs), the cleanup that is supposed to strip only the EntityComponentPlugin "Components" UI folder instead wipes the object's **entire** `uiConfig.children` array, destroying unrelated UI.

## Root Cause
```ts
obj.uiConfig.children = obj.uiConfig.children.filter(c=>{
    if (typeof c === 'object' && c.tags && Array.isArray(c.tags) && c.tags.includes(EntityComponentPlugin.PluginType)) {
        return false
    }
    // <-- no return here: non-matching children fall through to `undefined` (falsy)
})
```
`Array.prototype.filter` keeps an element only when the callback returns truthy. The component folder correctly returns `false`, but every non-matching child returns `undefined` (falsy) and is dropped too. The intended behavior — mirrored correctly in `ObjectConstraintsPlugin._cleanUpUiConfig` (findIndex + splice) — is to remove only the matching folder.

## Impact
Removing an object that has components clears all of its UI config children, not just the Components folder — silently destroying any other UI (constraints, other plugin folders, etc.) attached to the same object.

## Fix
Return `true` for non-matching children:
```ts
obj.uiConfig.children = obj.uiConfig.children.filter(c =>
    !(typeof c === 'object' && c.tags && Array.isArray(c.tags) && c.tags.includes(EntityComponentPlugin.PluginType)))
```

## Files
- `src/plugins/extras/EntityComponentPlugin.ts:588-592` — filter callback missing `return true` for non-matching children

See `audit-entitycomponent-objecttocomponents-map-not-weakmap.md` and `audit-entitycomponent-unregister-uuid-deref.md` for other EntityComponentPlugin defects.

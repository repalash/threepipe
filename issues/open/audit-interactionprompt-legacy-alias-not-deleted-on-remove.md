# InteractionPromptPlugin: legacy `InteractionPointerPlugin` alias not deleted on onRemove (dangling ref)

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`onAdded` installs a deprecated accessor property `InteractionPointerPlugin` on `viewer.plugins` (getter warns and returns `this`), explicitly marked `configurable: true` "required to be able to delete". But `onRemove` never deletes it, so after the plugin is removed the alias still resolves to the removed plugin instance.

## Root Cause
```ts
// onAdded:
const p = this
Object.defineProperty(viewer.plugins, 'InteractionPointerPlugin', {
    get(): any {
        console.warn('InteractionPromptPlugin: PluginType renamed from InteractionPointerPlugin to InteractionPromptPlugin. ...')
        return p
    },
    configurable: true, // required to be able to delete
})

// onRemove: removes all event listeners and the cursor element, but never:
//   delete viewer.plugins.InteractionPointerPlugin
```
The getter closes over `p = this`, so it keeps a reference to the removed plugin alive.

## Impact
After `removePlugin`, `viewer.plugins.InteractionPointerPlugin` still returns the detached plugin (dangling reference) and emits the deprecation `console.warn` on every access. Re-adding a new instance chains a stale getter.

## Fix
In `onRemove`, add (matching the cleanup `onAdded` already does at the top):
```ts
if (objectHasOwn(viewer.plugins, 'InteractionPointerPlugin')) delete viewer.plugins.InteractionPointerPlugin
```

## Files
- `src/plugins/interaction/InteractionPromptPlugin.ts:130-143` — alias installed in onAdded
- `src/plugins/interaction/InteractionPromptPlugin.ts:156-167` — onRemove never deletes the alias

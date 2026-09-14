# GridItemListPlugin has no PluginType — registers under the generic 'AViewerPlugin' key

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`GridItemListPlugin` defines no `static PluginType`. Static members are inherited, so it falls back to the base `AViewerPlugin.PluginType === 'AViewerPlugin'`, and the plugin is registered under that generic key instead of a unique one. Every other plugin in the repo defines an explicit `PluginType`.

## Root Cause
```ts
export class GridItemListPlugin extends AViewerPluginSync {
    enabled = true
    toJSON: any = undefined
    // no `static PluginType` — inherits 'AViewerPlugin' from src/viewer/AViewerPlugin.ts:19
```
In `addPluginSync` the plugin is registered as `this.plugins['AViewerPlugin']`.

## Impact
- Any other plugin that also omits `PluginType` (also inheriting `'AViewerPlugin'`) collides: adding the second one logs "Plugin of type AViewerPlugin already exists, removing and disposing old plugin" and removes `GridItemListPlugin`, silently breaking the configurator grid UI.
- `getPlugin('AViewerPlugin')` / `getPlugins` resolve to this helper, which is surprising.
- It "works" today only because nothing else currently collides on that key.

## Fix
Add `public static readonly PluginType = 'GridItemListPlugin'`.

## Files
- `plugins/configurator/src/GridItemListPlugin.ts:7-21` — class with no `PluginType`
- `src/viewer/AViewerPlugin.ts:19` — base `PluginType = 'AViewerPlugin'` that gets inherited

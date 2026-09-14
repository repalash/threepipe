# GridItemList: single static container/Elements shared across all viewers; per-viewer onRemove disposes the global

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`GridItemList._container` and `GridItemList.Elements` are static (one shared instance process-wide). `GridItemListPlugin.onRemove` calls `GridItemList.Dispose()`, which does `RemoveAll()` + removes the shared `_container`.

## Root Cause
`_container`/`Elements` are class statics, and `Dispose`/`RebuildUi`/`RemoveAll(tag)` operate on the global element list. With two viewers each holding a `MaterialConfiguratorPlugin`/`SwitchNodePlugin` (hence a `GridItemListPlugin`), removing the plugin from one viewer wipes the shared container and all grid items belonging to the OTHER viewer.

## Impact
Single-viewer apps are unaffected; multi-viewer usage cross-contaminates — removing the configurator from one viewer destroys the other viewer's grid items.

## Fix
Make the container/elements per-instance (store on the plugin) rather than static, or reference-count `Dispose`.

## Files
- `plugins/configurator/src/GridItemList.ts:17-19` — static `_container`/`Elements`
- `plugins/configurator/src/GridItemList.ts:99-103` — `Dispose` removes the shared container
- `plugins/configurator/src/GridItemListPlugin.ts:17-20` — per-viewer `onRemove` calls `GridItemList.Dispose()`

## Related
- `audit-griditemlistplugin-missing-plugintype.md` — missing `PluginType` on the same plugin

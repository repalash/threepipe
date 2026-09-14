# Bug: Hierarchy tree collapses on selection change (RESOLVED)

**Fix applied:** Option 2 — filter in `reset()`. Objects with `assetType === 'widget'` or `userData.isWidgetRoot` skip hierarchy rebuild.

## Summary

HierarchyUiPlugin's tree view collapses (rebuilds entirely) when new selection widgets are added to the scene. This happens during multi-selection when a new BoxSelectionWidget is created and added to the scene for the first time.

## Root Cause

1. `PickingPlugin._updateExtraWidgets()` calls `viewer.scene.addObject(widget, {addToRoot: true})` when creating a new widget for a newly multi-selected object
2. `addObject` triggers the scene's `addedToParent` change event
3. `RootScene` (line 505) dispatches `sceneUpdate` with `hierarchyChanged: true` when change is `addedToParent`
4. `HierarchyUiPlugin.reset()` sees `hierarchyChanged: true` and sets `_needsReset = true`
5. On next `postFrame`, `_reset()` rebuilds the entire tree from scratch, collapsing all open nodes

## Why it "fixes itself"

Extra widgets are created on demand and reused. After all needed widgets exist (e.g., after selecting 3 objects once), subsequent selection changes reuse existing widgets via `attach()`/`detach()` — no new objects added to scene, no `hierarchyChanged`, no collapse.

## Possible Fixes

1. **Pre-create a pool of extra widgets** in PickingPlugin constructor instead of on-demand. Avoids adding to scene during selection.
2. **Filter widget roots from hierarchyChanged** in HierarchyUiPlugin's `reset` — objects with `userData.isWidgetRoot` or `assetType === 'widget'` shouldn't trigger a hierarchy rebuild.
3. **Preserve tree open/close state** across rebuilds in `_reset()` — save expanded node UUIDs before rebuild, restore after.
4. **Use the modelRoot filter** — `hierarchyChanged` should only fire for changes under `modelRoot`, not scene root. Widget objects are added to scene root, not modelRoot.

Fix 4 is the most correct — the hierarchy tree only shows modelRoot children, so changes outside modelRoot shouldn't trigger a rebuild. But this requires a change in RootScene's event dispatch logic.

Fix 2 is the simplest immediate fix — add a check in `reset()`.

## Files

- `plugins/tweakpane-editor/src/HierarchyUiPlugin.ts:87` — reset() handler
- `src/core/object/RootScene.ts:505` — sceneUpdate dispatch
- `src/plugins/interaction/PickingPlugin.ts` — _updateExtraWidgets creates widgets

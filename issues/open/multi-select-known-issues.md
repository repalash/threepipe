# Multi-Selection: Known Issues and Future Work

## Local space forced to world during multi-select

When multiple objects are selected, the gizmo is forced to world space. This is intentional — the gizmo attaches to a dummy object at the median position which has no meaningful rotation. The `isMultiSelectDummy` flag on the dummy's `userData` is checked by both TransformControls and PivotControls to skip local space orientation.

Single-object selection respects the user's space setting normally.

## Duplicate with multiple selection

The "Duplicate Object" button in the object's context menu only duplicates the single object it belongs to. It doesn't know about multi-selection.

A "Duplicate Selection" action could be added as:
- A new button in PickingPlugin's UI
- A keyboard shortcut (Ctrl+D like Blender)
- An update to the existing duplicate to check PickingPlugin's selection

## Marquee/box drag selection (Phase 3)

Not yet implemented. See `issues/open/marquee-box-select.md`.

## Select all criteria

`selectAll()` traverses modelRoot and includes any object with `assetType === 'model'` and a material. This may include parent groups that shouldn't be individually selectable. May need refinement of the selection criteria.

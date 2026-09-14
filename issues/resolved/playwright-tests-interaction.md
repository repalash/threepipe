# Test Plan: Interaction Plugins (Playwright)

Automated tests for PivotControls, PivotEditPlugin, multi-selection, and multi-object transform.

## Multi-Selection

1. Click an object — single select, red bbox, gizmo attaches
2. Shift+click another object — both selected, orange bbox on second, gizmo moves to median
3. Shift+click a third — three bboxes, gizmo repositions
4. Shift+click one that's already selected — deselects just that one
5. Click without modifier — replaces with single select
6. Click empty space — clears all
7. Ctrl+A — selects all visible objects
8. Escape — clears selection
9. Check hierarchy panel — all selected objects highlighted
10. Shift+click in hierarchy panel — toggles that object in/out of selection

## Multi-Select Toggle

11. In PickingPlugin UI, uncheck "Multi-Select"
12. Shift+click — should NOT multi-select, just replaces
13. Re-enable, select multiple, disable again — should reduce to primary only

## Multi-Object Transform (TransformControls)

14. Select 2+ objects with Shift+click
15. Translate (W mode) — all move together
16. Rotate (E mode) — all rotate around shared pivot
17. Scale (R mode) — all scale relative to shared pivot
18. Press Q — space toggle should have no effect (forced world)
19. Ctrl+Z — undo, all revert, gizmo repositions to original median
20. Ctrl+Shift+Z — redo

## Multi-Object Transform (PivotControls)

21. Enable PivotControls from toolbar, disable TransformControls
22. Repeat steps 14-20 with PivotControls

## Pivot Edit

23. Select single object, click the yellow pivot dot — edit gizmo appears
24. Drag edit gizmo — pivot moves, object stays in place
25. Click dot again — exits edit mode
26. P key — toggles edit mode
27. Escape — exits edit mode
28. "Pivot to Center" / "Pivot to Bottom" / "Pivot to Origin" buttons
29. Ctrl+Z — undoes pivot change
30. Select different object while in edit mode — should exit edit mode

## Pivot Controls Features

31. Q key — toggle world/local space (single select)
32. Shift+drag — snap to grid
33. Alt+drag on scale sphere — uniform scale
34. Annotations visible during drag (values shown)
35. +/- keys — resize gizmo
36. X/Y/Z keys — toggle axis visibility

## Edge Cases

37. Select multiple, then enable PivotControls — multi-gizmo should appear
38. Select multiple, then disable PivotControls, re-enable — should restore multi-gizmo
39. Outline plugin (if loaded) — all selected objects get outlines

## Setup

Use the tweakpane editor example with a multi-part glTF model. Tests should:
- Load the editor page
- Import a test model with multiple selectable meshes
- Interact via simulated pointer events (click, shift+click, drag) and keyboard events
- Verify selection state via `viewer.getPlugin('Picking').getSelectedObjects()`
- Verify gizmo visibility and position via scene inspection
- Use screenshot comparison for visual regression where applicable

## Files Under Test

- `src/three/utils/ObjectPicker.ts`
- `src/plugins/interaction/PickingPlugin.ts`
- `src/plugins/interaction/TransformControlsPlugin.ts`
- `src/plugins/interaction/PivotControlsPlugin.ts`
- `src/plugins/interaction/PivotEditPlugin.ts`
- `src/plugins/interaction/MultiSelectHelper.ts`
- `src/three/controls/PivotControls.ts`
- `src/three/controls/TransformControls.js`
- `plugins/tweakpane-editor/src/HierarchyUiPlugin.ts`

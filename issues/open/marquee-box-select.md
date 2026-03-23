# Feature: Marquee/Box Drag Selection

## Summary

Add drag-to-select (marquee/box select) for selecting multiple objects by drawing a rectangle on screen. This is Phase 3 from the multi-selection plan.

## Approach

Use three.js `SelectionBox` (frustum-based, `three/examples/jsm/interactive/SelectionBox.js`) for the selection math. Write a simple DOM div overlay for the rectangle visual (not three.js `SelectionHelper` which is tightly DOM-coupled).

Could be a separate `MarqueeSelectPlugin` or integrated into PickingPlugin.

## Implementation

1. On pointer down: record start position
2. On pointer move: if distance > threshold, show rectangle overlay div
3. On pointer up: if was dragging:
   - Create `SelectionBox` with camera + scene
   - Call `select(startNDC, endNDC)` — returns array of objects in frustum
   - Filter by PickingPlugin's selectionCondition
   - Apply modifier logic (Shift to add to selection, plain to replace)
   - Call `setSelected(filteredObjects)`
4. Respect `multiSelectEnabled` flag on PickingPlugin

## References

- Three.js SelectionBox: `three/examples/jsm/interactive/SelectionBox.js` — handles perspective + orthographic, instanced meshes
- Multi-selection plan: `issues/resolved/multi-selection.md` (Phase 3 section)
- PickingPlugin: `src/plugins/interaction/PickingPlugin.ts`

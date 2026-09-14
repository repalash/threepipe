# Feature: Multi-Object Selection and Transformation

## Implementation Status

| Phase | Status |
|-------|--------|
| Phase 1: Core multi-selection (ObjectPicker) | Done |
| Phase 2: Selection visualization (widgets, hierarchy) | Done |
| Phase 3: Marquee/box drag select | Not started |
| Phase 4: Multi-object transform gizmo | Done |
| Phase 5: Keyboard shortcuts + undo | Done |
| Consumer updates (TransformControls, PivotControls, PivotEdit, Hierarchy, Outline) | Done |
| Documentation | Done |

See also: `issues/open/multi-select-known-issues.md` for remaining limitations.
Phase 3 extracted to: `issues/open/marquee-box-select.md`

## Summary

Multi-object selection in threepipe with modifier key support and grouped transform gizmo integration. Box/marquee drag-select is planned but not yet implemented.

## Current State

### What exists
- `ObjectPicker._selected: SelectionObjectArr` is already an array (line 165: `this._selected = object ? Array.isArray(object) ? [...object] : [object] : []`)
- `setSelected()` already accepts arrays
- TODO comment at line 136-138: `// todo multiselection`
- `SelectionWidget` and `BoxSelectionWidget` for single-object visual feedback (single `_widget` instance in PickingPlugin)
- Three.js provides `SelectionBox` (frustum-based) and `SelectionHelper` in `three/examples/jsm/interactive/`
- `SelectionBox` handles perspective + orthographic cameras, instanced meshes, uses Frustum planes
- `CameraViewPlugin.animateToFitObject` already handles arrays of objects for bounding box calculation
- OutlinePlugin exists for selection highlighting (in `@threepipe/webgi-plugins`, not core)
- `selectedObjectChanged` event currently sends `object: _selected[0]` (first element only)
- `_onPointerClick` in ObjectPicker has access to the PointerEvent (modifier keys available)

### What's missing
- No modifier key detection in `ObjectPicker._onPointerClick()` (Shift/Ctrl not checked)
- Events only emit first selected object, no `objects` array in event payload
- `TransformControls` and `PivotControls` only accept single `Object3D` via `attach()`
- PickingPlugin has single `_widget` and `_hoverWidget` — no multi-object bbox visualization
- No marquee/box drag-to-select
- No "Select All" shortcut
- Consumers (TransformControlsPlugin, PivotControlsPlugin, PivotEditPlugin, HierarchyUiPlugin) only read `event.object` — need updating for multi-selection

## Implementation Plan

### Phase 1: Core Multi-Selection in ObjectPicker

**File: `src/three/utils/ObjectPicker.ts`**

Modifier key handling belongs in ObjectPicker's `_onPointerClick` since it has the PointerEvent. ObjectPicker already stores arrays via `setSelected()`.

1. Update `_onPointerClick(event)`:
   ```typescript
   private _onPointerClick = (event: PointerEvent) => {
       const {obj, intersects} = this._hitObject()
       if (event.shiftKey || event.ctrlKey || event.metaKey) {
           // Toggle: add if not selected, remove if selected
           if (obj) {
               const current = [...this._selected]
               const idx = current.indexOf(obj)
               if (idx >= 0) current.splice(idx, 1)
               else current.push(obj)
               this.setSelected(current.length ? current : null, true, intersects || undefined)
           }
       } else {
           // Replace selection
           this.setSelected(obj, true, intersects || undefined)
       }
   }
   ```

2. Expand `selectedObjectChanged` event payload:
   ```typescript
   selectedObjectChanged: {
       object: IObject3D | null,       // primary/active object (last clicked or first in array)
       objects: IObject3D[],           // full selection array
       material: IMaterial | null,
       value: SelectionObject,
       lastValue: SelectionObject,
       intersects?: HitIntersects,
   }
   ```

3. Add `selectedObjects` getter (returns full array):
   ```typescript
   get selectedObjects(): SelectionObjectArr { return [...this._selected] }
   ```

4. Fix undo in `setSelected` — currently records undo with `current[0]` (loses multi-selection). Should record the full array.

5. Fix `_onSelectedRemoved` — the TODO at line 136 already outlines the fix: filter the removed object from `_selected` instead of clearing all.

**File: `src/plugins/interaction/PickingPlugin.ts`**

1. Add `getSelectedObjects()` method (exposes ObjectPicker's array)
2. Forward the new `objects` array field in dispatched events

### Phase 2: Selection Visualization

**File: `src/plugins/interaction/PickingPlugin.ts`, `src/three/widgets/BoxSelectionWidget.ts`**

Two approaches:
- **Option A**: Modify `BoxSelectionWidget.attach()` to accept an array — renders individual bboxes for each object, or a combined bbox
- **Option B**: Manage an array of widget instances in PickingPlugin — one per selected object

Option B is simpler to implement and gives better visual feedback (each object has its own bbox). PickingPlugin changes:
```typescript
private _widgets: SelectionWidget[] = []

// On selection change:
// Remove old widgets beyond new count
// Create new widgets as needed
// Attach each widget to its corresponding selected object
```

The primary/active object (last clicked) could use a brighter color to distinguish it.

### Phase 3: Marquee/Box Drag Selection

**New: `src/plugins/interaction/MarqueeSelectPlugin.ts` or integrated into PickingPlugin**

Use three.js `SelectionBox` for frustum-based selection (no custom math needed). Write a simple DOM overlay for the rectangle (not `SelectionHelper` which is DOM-coupled).

1. In `_onPointerDown`: Record start position
2. In `_onPointerMove`: If distance > threshold, show rectangle overlay
3. In `_onPointerUp`: If was dragging:
   - Create `SelectionBox` with camera + scene
   - Call `select(startNDC, endNDC)` — returns array of objects in frustum
   - Filter by `selectionCondition` (same as ObjectPicker uses)
   - Apply modifier logic (Shift to add, plain to replace)
   - Call `setSelected(filteredObjects)`

Decision: Separate plugin or integrate into PickingPlugin/ObjectPicker?
- Separate plugin is cleaner — PickingPlugin is already complex
- Can listen to pointer events on the canvas independently
- Uses PickingPlugin's `setSelected` to apply the selection

### Phase 4: Multi-Object Transform Gizmo

**Files: TransformControlsPlugin, PivotControlsPlugin**

Since TransformControls/PivotControls only accept single `Object3D`, use a **temporary pivot object**:

1. When `objects.length > 1` in `selectedObjectChanged`:
   - Compute median position of all selected objects
   - Create/reuse a temporary invisible `Object3D` at that position
   - Attach the gizmo to this temporary object
2. On `mouseDown`: Capture all objects' positions/rotations/scales
3. On `objectChange` (during drag): Compute delta from the temporary object's transform change, apply to each selected object:
   - **Translation**: `object.position.add(delta)` for each
   - **Rotation**: Rotate each object's position around the pivot, then apply rotation to the object itself
   - **Scale**: Scale each object's offset from pivot, then apply scale to the object itself
4. On `mouseUp`: Record single undo command with all objects' before/after states

**Gizmo position modes** (configurable property on the plugin):
- **Median Point** (default): Average of all selected object world positions
- **Bounding Box Center**: Center of combined bounding box
- **Active Element**: Position of the last-selected object

When only one object is selected, falls back to current single-selection behavior (no temporary object).

### Phase 5: Undo/Redo for Multi-Object Operations

Single undo step for the entire multi-object operation:
```typescript
// On mouseDown: capture state
const states = objects.map(obj => ({
    obj,
    lastPos: obj.position.clone(),
    lastRot: obj.rotation.clone(),
    lastScale: obj.scale.clone(),
}))

// On mouseUp: record
undoManager.record({
    undo: () => {
        for (const s of states) {
            s.obj.position.copy(s.lastPos)
            s.obj.rotation.copy(s.lastRot)
            s.obj.scale.copy(s.lastScale)
            s.obj.updateMatrixWorld(true)
            s.obj.setDirty?.({change: 'transform'})
        }
    },
    redo: () => {
        for (const s of states) {
            s.obj.position.copy(s.newPos)
            s.obj.rotation.copy(s.newRot)
            s.obj.scale.copy(s.newScale)
            s.obj.updateMatrixWorld(true)
            s.obj.setDirty?.({change: 'transform'})
        }
    }
})
```

Selection changes also need undo — ObjectPicker already records selection undo but needs to handle arrays properly.

## Consumer Updates Required

Plugins that listen to `selectedObjectChanged` and need updating:

| Plugin | Current behavior | Multi-select behavior |
|--------|-----------------|----------------------|
| TransformControlsPlugin | Attaches to `selectedHandle ?? selectedObject ?? object` | Attach to dummy pivot when `objects.length > 1` |
| PivotControlsPlugin | Same as above | Same approach |
| PivotEditPlugin | Tracks `_selectedObject` | Exit edit mode when multi-selecting, or apply to all |
| HierarchyUiPlugin | Highlights single object | Highlight all selected in hierarchy tree |
| Object3DWidgetsPlugin | Creates widgets for objects | No change needed (widgets are per-object already) |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **Shift+Click** | Toggle object in/out of selection |
| **Ctrl/Cmd+Click** | Toggle object in/out of selection (same as Shift) |
| **Click** (no modifier) | Select single object (replace selection) |
| **Ctrl/Cmd+A** | Select all selectable objects |
| **Escape** | Clear selection |

Box/marquee select (Phase 3, if separate plugin):
| Key | Action |
|-----|--------|
| **Drag** (with plugin enabled) | Draw selection rectangle |
| **Shift+Drag** | Add to current selection |

## Edge Cases

- **Selecting parent and child**: Child should be excluded from group transform (it already inherits parent transform). Check ancestry before applying delta.
- **Different parents**: Transform delta applied in each object's local parent space.
- **Widget objects**: Excluded from selection (`assetType === 'widget'`)
- **Mixed types**: If multi-selecting objects + materials (unlikely in practice), `selectionMode` should restrict to one type.
- **Click on selected object with Shift**: Should deselect only that object, not clear all.
- **Click empty space**: Clear entire selection (no modifier) or no-op (with modifier).
- **Object removed from scene while selected**: `_onSelectedRemoved` should filter it out (existing TODO at line 136).

## Implementation Order

1. Phase 1: ObjectPicker modifier keys + array event payload (foundation for everything else)
2. Phase 5 partial: Fix selection undo to handle arrays
3. Phase 2: Multi-object selection visualization
4. Phase 4: Multi-object transform gizmo (biggest piece of work)
5. Phase 3: Marquee selection (independent, can be done anytime after Phase 1)

## Priority

Medium-High. Multi-selection is a standard editor feature. Phase 1 is small and unlocks the rest.

## Dependencies

- PickingPlugin (required)
- OutlinePlugin from `@threepipe/webgi-plugins` (for selection highlighting, optional)
- TransformControlsPlugin or PivotControlsPlugin (for transform gizmo, optional)
- UndoManagerPlugin (for undo/redo, optional)

## References

- Three.js SelectionBox: `three/examples/jsm/interactive/SelectionBox.js` — frustum-based, handles perspective + ortho, instanced meshes
- Three.js SelectionHelper: `three/examples/jsm/interactive/SelectionHelper.js` — DOM rectangle overlay (reference only, write our own)
- ObjectPicker TODO: `src/three/utils/ObjectPicker.ts:136`
- ObjectPicker `_onPointerClick`: `src/three/utils/ObjectPicker.ts:292` — has PointerEvent for modifier keys
- ObjectPicker `setSelected`: `src/three/utils/ObjectPicker.ts:144` — already accepts arrays
- PickingPlugin `_selectedObjectChanged`: `src/plugins/interaction/PickingPlugin.ts:226` — single widget attach
- [Blender Selection Manual](https://docs.blender.org/manual/en/latest/interface/selecting.html)
- [Blender Pivot Point Options](https://docs.blender.org/manual/en/latest/scene_layout/object/editing/transform/control/pivot_point/index.html)
- [Unity Positioning GameObjects](https://docs.unity3d.com/Manual/PositioningGameObjects.html)

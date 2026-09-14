# Interactive Curve/Shape Editing Widgets

## Summary
Plan for adding interactive 3D widgets for editing curves and shapes used by the geometry generators (TubeGeometryGenerator, ShapeGeometryGenerator, TubeShapeGeometryGenerator) and LineGeometryGenerator.

## Current State

### What works
- **LineHelper** (`src/three/widgets/LineHelper.ts`) already creates draggable cube handles for curve control points via `getPointsForCurve()` + `userData.isWidgetHandle` + custom `setDirty` pattern
- **CurveUiHelper** provides comprehensive UI panel with curve type switching, property editors, and add/remove point buttons
- **Full regeneration loop**: handle drag → `setDirty({change: 'transform'})` → curve point update → `geometry.setDirty({regenerate: true})` → `GeometryGeneratorPlugin._geometryUpdate` → `generate()` → widget `update()`
- **TransformControlsPlugin** attaches to handles automatically via PickingPlugin's `selectedHandle` resolution

### What's missing
- [ ] **No CurveHelper widget** for tube/tubeShape generators — LineHelper only works for line objects (`isLine || isLineSegments2`), not for Mesh objects with tube geometry
- [ ] **No ShapeHelper widget** for visualizing/editing the 2D cross-section shape in TubeShapeGeometry
- [ ] **Add Point via 3D interaction** — currently only possible via UI panel buttons; no way to click on a curve and add a control point at that position
- [ ] **Per-vertex handles not draggable** — LineHelper's non-curve vertex handles are display-only
- [ ] **No tangent/normal visualization** for curves (Frenet frames, curvature)
- [ ] **Handle meshes not instanced** — each handle is an individual Mesh; TODO in LineHelper line 66
- [ ] **Widget handles don't auto-refresh** when points are added/removed via UI "Add Point" button (handle count only updates on geometry update)
- [ ] **`follow_path` constraint uses sampled vertices** instead of smooth curve evaluation — TODO in BasicObjectConstraints line 257

## Proposed Widgets

### CurveHelper (for tube/tubeShape)
A new widget that shows curve control point handles on tube and tubeShape geometry. Similar to LineHelper but:
- `Check(obj)`: returns true for any mesh with `geometry.userData.generationParams.path` (Curve object)
- Creates draggable handles at curve control points
- On handle drag, updates the curve and calls `geometry.setDirty({regenerate: true})`
- Also visualizes the curve path itself as a thin line overlay

### ShapeHelper (for shape/tubeShape)
A new widget that shows the 2D shape cross-section:
- `Check(obj)`: returns true for any mesh with `geometry.userData.generationParams.shapeType`
- For preset shapes (rectangle, circle, polygon): show resize handles (corner drag for rectangle, radius drag for circle)
- For custom shapes: show vertex handles similar to LineHelper's per-vertex mode
- On handle drag, updates shape params and calls `geometry.setDirty({regenerate: true})`

## Architecture Reference

### Existing patterns to follow
- `LineHelper.ts` lines 98-173: control point handle creation with `isWidgetHandle` + custom `setDirty`
- `LineHelper.getPointsForCurve()` lines 229-254: recursive curve point extraction with key paths
- `PivotEditPlugin.ts`: custom interaction mode that coexists with TransformControls
- `AHelperWidget.ts`: base class with event-driven lifecycle (attach/detach/update)
- `Object3DWidgetsPlugin.ts`: widget registry with `helpers[]` array

### Key integration points
- `Object3DWidgetsPlugin.helpers.push({Check, Create})` — register new widget type
- `userData.isWidgetHandle = true` — make a mesh pickable as a handle
- `userData.transformControls = {mode, space, lockProps}` — configure gizmo for handle
- `geometry.setDirty({regenerate: true})` — trigger geometry regeneration
- `PickingPlugin._onObjectHit` → `getRootIfWidget()` → `selectedHandle` resolution

### Pointer event flow
```
Canvas → ObjectPicker (raycast scene + widget roots)
  → PickingPlugin (resolve widget/handle)
  → TransformControlsPlugin (attach gizmo to handle)
  → gizmo drag → handle.setDirty → update data → geometry regenerate → widget update
```

# Instance-Level Picking and Transform Editing for InstancedMesh

## Goal
Support selecting and transforming individual instances within an InstancedMesh, similar to how widget handles work.

## Current State
- three.js `InstancedMesh.raycast()` sets `instanceId` on intersections, but threepipe never reads it
- `ObjectPicker` deduplicates by `object.id` (line 379-392), keeping only nearest instance hit (acceptable)
- Selection resolves to `IObject3D`, no concept of `(object, instanceId)` pair
- TransformControls/PivotControls directly mutate `object.position/quaternion/scale` -- no abstraction layer

## Design Considerations
- **Instance proxy pattern**: Similar to `MultiSelectHelper`'s dummy Object3D, create a proxy that:
  - Lives in the scene graph (required by TransformControls.js line 192)
  - Reads initial transform from `instanceMatrix` at the given `instanceId`
  - On `objectChange` event, writes transform back to `instanceMatrix` via `setMatrixAt`
- **Selection state**: Extend `HitIntersects` or `selectedObjectChanged` event to carry `instanceId`
- **UI**: Show instance properties in PickingPlugin panel when an instance is selected
- **Visual feedback**: Selection widget should highlight individual instance bounds, not the whole InstancedMesh

## Key Files
- `src/three/utils/ObjectPicker.ts` -- raycasting, `instanceId` available on intersections
- `src/plugins/interaction/PickingPlugin.ts` -- selection management, keyboard, UI
- `src/plugins/interaction/TransformControlsPlugin.ts` -- gizmo attachment, `selectionFilterTest`
- `src/plugins/interaction/PivotControlsPlugin.ts` -- alternative gizmo, same pattern
- `src/plugins/interaction/MultiSelectHelper.ts` -- dummy proxy pattern reference
- `src/core/object/InstancedMesh2.ts` -- threepipe's InstancedMesh wrapper

## Status
- [ ] Design instance proxy mechanism
- [ ] Implement instance-level selection in ObjectPicker/PickingPlugin
- [ ] Implement instance proxy for transform controls
- [ ] Selection widget for individual instances
- [ ] UI panel showing instance properties

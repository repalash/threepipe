# Duplicate as GPU Instance Support

## Goal
When duplicating objects, provide an option to duplicate as a GPU instance instead of a full deep clone. Also support duplicate/copy/paste operations on individual instances within an InstancedMesh.

## Current State
- `Ctrl+D` duplicates via deep clone (`obj.clone(true)`) -- always creates independent objects
- No "duplicate as instance" concept exists anywhere
- `autoGPUInstanceMeshes` merges existing same-geometry/material meshes post-hoc but doesn't create new instances
- three.js `InstancedMesh` allocates fixed-size buffers at construction; r159+ has `resize(count)` but threepipe doesn't use it
- `DuplicateTracker` handles smart offset chaining for duplicates

## Design Considerations

### Duplicate as GPU Instance (new mesh -> instance)
- Keyboard shortcut: e.g. `Ctrl+Shift+D` or `Ctrl+Alt+D` (Ctrl+Shift+D currently used for alternate duplicate mode)
- When duplicating a regular mesh:
  1. Create an InstancedMesh with count=2 (original + clone)
  2. Set instance 0 matrix from original mesh transform
  3. Set instance 1 matrix from original + offset
  4. Replace original mesh with the InstancedMesh in scene graph
- When duplicating an instance within an InstancedMesh:
  1. Grow the instance buffer (resize or recreate)
  2. Copy source instance matrix + apply offset for new instance
  3. Increment count

### Instance-Level Duplicate/Copy/Paste
- Depends on instance-level picking (issue: instanced-mesh-instance-picking.md)
- Copy instance: store (InstancedMesh ref, instanceId, matrix) in clipboard
- Paste instance: add new instance to same or different InstancedMesh (if compatible geometry/material)
- Delete instance: remove from buffer, compact remaining, decrement count

## Key Files
- `src/plugins/interaction/PickingPlugin.ts` -- keyboard handlers (line 198-233), `duplicateSelected()` (line 275)
- `src/core/object/iObjectCommons.ts` -- `duplicateObjects()` (line 653), `duplicateObject()` (line 582)
- `src/plugins/interaction/DuplicateTracker.ts` -- smart offset
- `src/plugins/interaction/ObjectClipboard.ts` -- copy/cut/paste
- `src/three/utils/gpu-instancing.ts` -- existing instancing utility
- `src/core/object/InstancedMesh2.ts` -- InstancedMesh wrapper

## Status
- [ ] Design keyboard shortcut scheme
- [ ] Implement "duplicate as instance" for regular meshes
- [ ] Implement instance buffer growing/shrinking on InstancedMesh2
- [ ] Implement instance-level duplicate within InstancedMesh
- [ ] Implement instance-level copy/paste
- [ ] Implement instance-level delete
- [ ] Undo/redo support for all operations

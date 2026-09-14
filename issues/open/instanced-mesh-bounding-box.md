# Instanced Mesh Bounding Box Bug

## Problem
Bounding box computation is incorrect for instanced meshes in `Box3B.expandByObject()` when `precise=true`.

### Root Cause
`Box3B.expandByObject()` (`src/three/math/Box3B.ts:29`) checks whether the geometry's `computeBoundingBox` is overridden instead of checking `object.isInstancedMesh`. When `precise=true` and the geometry uses the default `BufferGeometry.prototype.computeBoundingBox`, the code enters the vertex-iteration path that only iterates base geometry vertices **without accounting for instance transforms**.

Standard three.js `Box3.expandByObject` guards this with `object.isInstancedMesh !== true` (Box3.js line 171), but Box3B replaced that check with a geometry-prototype check that doesn't account for instancing.

### Impact
- `fitToView` frames incorrectly (TODO at `examples/instanced-mesh/script.ts:67`)
- `autoCenter`, `autoScale`, `pivotToBoundsCenter` (all use `precise=true` via `RootScene.getBounds`)
- Selection widget bounding box (`SelectionWidget.ts:17`)
- `CameraViewPlugin.animateToFitObject` (lines 394, 432-434)
- `snapObject` utility

### Fix
Add `isInstancedMesh` check at `Box3B.ts:29` to skip the precise vertex-iteration path for instanced meshes, falling through to the conservative path which correctly calls `InstancedMesh.computeBoundingBox()` (iterates all instances).

### Files
- `src/three/math/Box3B.ts` (line 29) -- main fix location
- `examples/instanced-mesh/script.ts` (line 67) -- remove TODO after fix
- `tests/interactive.spec.ts` (line 1575+) -- verify with existing tests

## Status
- [ ] Fix Box3B.expandByObject for instanced meshes
- [ ] Verify fitToView works correctly with instanced mesh example
- [ ] Remove TODO comment from example

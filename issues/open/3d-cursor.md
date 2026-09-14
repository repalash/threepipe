# Feature: 3D Cursor

## Summary

Add a persistent 3D cursor (spatial reference point) to threepipe, similar to Blender's 3D cursor. This is a general-purpose spatial marker in the viewport that can be used as a reference for multiple operations.

## What is a 3D Cursor?

A 3D cursor is a visible, persistent point in 3D space that is NOT attached to any object. It stays where the user places it until explicitly moved. It serves as a reference point for various operations.

### How Blender implements it

- **Placement**: Shift+Right-click anywhere in the viewport. Raycast hits a surface and places the cursor there. Falls back to the ground plane or a configurable depth if nothing is hit.
- **Precise placement**: Shift+S opens a snap menu with options like "Cursor to Selected", "Cursor to World Origin", "Cursor to Active", "Cursor to Grid".
- **Visual**: Small red-white crosshair/ring, always visible, renders on top of objects.
- **Uses**:
  - **Transform pivot**: When pivot mode is set to "3D Cursor", rotate/scale operations happen around the cursor position instead of the object center.
  - **Set Origin**: Move an object's origin (pivot point) to the cursor location.
  - **Spawn point**: Newly created objects appear at the cursor location.
  - **Snap target**: Objects can be snapped to the cursor position.
  - **Measurement reference**: Useful for measuring distances from a known point.

## Proposed Implementation for Threepipe

A `Cursor3DPlugin` that:
- Renders a small crosshair/axis widget at a configurable world position
- Placement via click (with modifier key) or API: `cursor.position.set(x, y, z)`
- Snap options: to selected object, to world origin, to grid, to vertex
- Integrates with PivotControlsPlugin/TransformControlsPlugin as an optional pivot mode
- Integrates with PivotEditPlugin as a target for "Pivot to Cursor"
- Integrates with Object3DGeneratorPlugin as a spawn point

## Priority

Low - This is a quality-of-life feature for advanced editor workflows. The simpler PivotEditPlugin covers the most common use case (editing pivot points) without needing a 3D cursor.

## References

- [Blender 3D Cursor Manual](https://docs.blender.org/manual/en/latest/editors/3dview/3d_cursor.html)
- [Blender Pivot Point Docs](https://docs.blender.org/manual/en/latest/editors/3dview/controls/pivot_point/index.html)

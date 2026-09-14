# Undo manager should invalidate entries when objects are disposed

## Problem

When undo/redo entries are recorded (in `MultiSelectHelper.recordUndo`, `PivotEditPlugin._recordUndo`, `TransformControlsPlugin`), they capture references to scene objects at record time. If a user later deletes/disposes one of those objects and then hits undo/redo, the closures still hold the stale references and attempt to set transforms on disposed objects.

Currently this doesn't crash because Three.js `dispose()` doesn't null out `position`/`quaternion`/`scale`, so the operations silently succeed on orphaned objects. But it's architecturally unsound — undo could restore transforms on objects no longer in the scene, and the stale references prevent garbage collection of disposed objects.

## Affected files

- `src/plugins/interaction/MultiSelectHelper.ts` — `recordUndo()` captures `objects` array
- `src/plugins/interaction/PivotEditPlugin.ts` — `_recordUndo()` captures `obj` reference
- `src/plugins/interaction/TransformControlsPlugin.ts` — similar pattern

## Proposed solution

The `UndoManagerPlugin` / `JSUndoManager` should support invalidating or pruning undo entries when the objects they reference are disposed. Possible approaches:

1. **Dispose listener approach**: Each undo record could register a `dispose` event listener on its referenced objects. When an object is disposed, the undo entry is marked invalid and skipped during undo/redo traversal.

2. **WeakRef approach**: Store object references as `WeakRef`s in undo closures. Before applying undo/redo, check if the reference is still alive. Skip or remove entries for collected objects.

3. **Scene membership check**: Before applying an undo/redo operation, verify the target objects are still in the scene. Skip entries for removed objects.

Each approach has trade-offs around complexity, GC behavior, and undo stack integrity. This requires changes to the undo manager architecture rather than individual plugin fixes.

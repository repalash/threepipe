# Bug: pivotToPoint return type mismatch between interface and implementation

## Summary

The `pivotToPoint` method has a return type mismatch between its interface declaration and implementation.

## Details

**Interface** (`src/core/IObject.ts:454`):
```typescript
pivotToPoint?(point: Vector3, setDirty?: boolean, compensateSharedGeometry?: boolean): this
```

**Implementation** (`src/core/object/iObjectCommons.ts:112`):
```typescript
pivotToPoint: function<T extends IObject3D>(this: T, point: Vector3, setDirty = true, compensateSharedGeometry = true): ()=>void {
```

The interface declares the return type as `this` (the object itself), but the implementation returns `() => void` (an undo function). The jsdoc correctly says "@returns undo function".

## Impact

Callers that use the return value as an undo function need to cast: `(obj.pivotToPoint(point) as unknown) as () => void`.

The existing "Pivot to Node Center" context menu button (`IObjectUi.ts`) returns the value directly and the UI system handles it as an undo function, so it works despite the type mismatch.

## Fix

Update the interface in `IObject.ts` to match the implementation:
```typescript
pivotToPoint?(point: Vector3, setDirty?: boolean, compensateSharedGeometry?: boolean): () => void
```

Check if any existing code relies on the `this` return type for chaining.

# GLTFMaterialsVariantsExtensionExport.compatibleObject: `!!array.filter(...)` is always true

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
The final clause of `compatibleObject` is meant to require that at least one variant material is compatible, but `!!Object.values(...).filter(...)` is always `true` (even `!![]` is `true`). So the predicate never excludes anything and reduces to "the object has `_variantMaterials`", regardless of whether any variant material is actually loaded/compatible.

## Root Cause
```ts
const compatibleObject = (object: Object3D) => {
    return (object as Mesh).material !== undefined &&
        object.userData &&
        object.userData._variantMaterials &&
        !!Object.values(object.userData._variantMaterials).filter(m => compatibleMaterial((m as Mesh)?.material as any))
}
```
`Array.prototype.filter` always returns an array; `!!someArray` is always `true`. The clear intent was `.some(...)` or `.filter(...).length > 0`. (The `(m as Mesh)` cast is also a type lie — `m` is a `{material, gltfMaterialIndex}` entry, so `m.material` is correct but `m` is not a `Mesh`.)

## Impact
The predicate is over-permissive: objects with `_variantMaterials` but zero compatible materials still pass. Impact is partly masked downstream (`writeMesh`/`beforeParse` re-check `compatibleMaterial` per material and bail when `mappingsDef.length === 0`), so it mostly self-corrects, but the predicate is definitively wrong.

## Fix
```ts
.some(m => compatibleMaterial((m as any)?.material))
```

## Files
- `src/plugins/extras/helpers/GLTFMaterialsVariantsExtensionExport.ts:16-21` — `!!filter(...)` always-true predicate

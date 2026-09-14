# Asset export: revert loop disposes shared Dummy material singletons process-wide

**Severity:** high
**Found:** 2026-06-13 code audit

## Bug
During export, placeholder/missing materials are temporarily swapped for the shared `AssetImporter.DummyMaterial` (and line variants) singletons. The export-revert cleanup then disposes every value in `matCloneMap` with no placeholder guard, destroying these process-wide static singletons on the first export of any model that has a missing/placeholder material.

## Root Cause
`processObjectMaterials` registers the singleton as the clone for a placeholder material:
```ts
materialsArr.forEach((material, i) => {
    if (material.userData.isPlaceholder) {
        // material is a dummy placeholder
        setMaterialRef(i, material, ()=>AssetImporter.DummyMaterial)   // stored into matCloneMap
    }
    ...
```
The revert loop disposes every clone unconditionally:
```ts
new Set([...matCloneMap.values()]).forEach(m=>{
    m.dispose && m.dispose()
})
matCloneMap.clear()
```
`AssetImporter.DummyMaterial` / `DummyLineBasicMaterial` / `DummyLineMaterial` are static singletons:
```ts
static DummyMaterial = new UnlitMaterial({color: '#ff00ff', name: 'NoneMaterial', userData: {isPlaceholder: true, runtimeMaterial: true}})
```
And `iMaterialCommons.dispose` defaults `force = true`, which bypasses the idle guard:
```ts
dispose: (superDispose) =>
    function(this: IMaterial, force = true): void {
        if (!force && this.userData.disposeOnIdle === false) return
        superDispose.call(this)   // always runs for the no-arg call
    },
```
So `m.dispose()` (no args → `force=true`) unconditionally disposes the shared singleton. The geometry path uses a `geomMap` restore (not dispose), so geometry is safe.

## Impact
The first export of any model containing a missing/placeholder material disposes the shared `DummyMaterial` (and line variants) for the entire process. Subsequent imports/exports that rely on the placeholder singleton get a disposed material (lost GPU resources, broken placeholder rendering). Triggered by any export of a model with an unassigned/placeholder material slot.

## Fix
Skip placeholder singletons in the revert dispose loop, e.g. guard on `userData.isPlaceholder`/`runtimeMaterial`:
```ts
new Set([...matCloneMap.values()]).forEach(m=>{
    if (m.userData?.isPlaceholder) return
    m.dispose && m.dispose()
})
```
(Alternatively, don't store the shared singleton in `matCloneMap`, or never register the Dummy singletons as disposable clones.)

## Files
- `src/assetmanager/export/assetExportHook.ts:148` — revert loop disposes all `matCloneMap` values with no placeholder guard
- `src/assetmanager/export/assetExportHook.ts:302` — placeholder path stores `AssetImporter.DummyMaterial` into `matCloneMap`
- `src/assetmanager/AssetImporter.ts:97` — `DummyMaterial`/`DummyLineBasicMaterial`/`DummyLineMaterial` static singletons
- `src/core/material/iMaterialCommons.ts:81` — `dispose` defaults `force=true`, bypassing the idle guard

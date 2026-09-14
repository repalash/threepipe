# GLTFMaterialExtrasExtension: explicitNotLegacy branch deletes define without `needsUpdate`

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
In the bump-map legacy-scale handling, the `isLegacy` branch sets the `BUMP_MAP_SCALE_LEGACY` define and `o.needsUpdate = true`. The `explicitNotLegacy` branch deletes the define but does not set `needsUpdate`. If the define was already present (e.g. set in a prior pass or restored from extras), removing it without `needsUpdate` leaves the compiled shader stale.

## Root Cause
```ts
if (isLegacy) {
    ...
    o.defines.BUMP_MAP_SCALE_LEGACY = '1'
    o.userData.legacyBumpScale = true
    o.needsUpdate = true
} else if (explicitNotLegacy) {
    // normalizedScale=true explicitly says not legacy — clear any stale flag from extras
    delete o.userData.legacyBumpScale
    delete o.defines.BUMP_MAP_SCALE_LEGACY    // no o.needsUpdate = true
}
```
In the normal fresh-load path the define isn't set yet, so deleting a non-existent key is a no-op and this is benign — hence low. But if the define ever was present, the shader won't recompile without `needsUpdate`.

## Impact
Edge case: a material whose `BUMP_MAP_SCALE_LEGACY` define was set (prior pass / extras restore) and is later cleared via the explicitNotLegacy branch keeps the stale legacy-scale shader until something else triggers a recompile.

## Fix
Set `o.needsUpdate = true` in the explicitNotLegacy branch too (ideally only when a define was actually deleted).

## Files
- `src/assetmanager/gltf/GLTFMaterialExtrasExtension.ts:185-189` — explicitNotLegacy branch deletes define without `needsUpdate`

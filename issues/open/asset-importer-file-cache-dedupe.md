# Bug: `AssetImporter` cache miss when same file dropped into multiple slots

## Summary

`src/assetmanager/AssetImporter.ts:240-248`:

```ts
if (options.cacheAsset !== false && this.cacheImportedAssets && !this._cachedAssets.includes(asset)) {
    if (Object.entries(asset).length === 1 && asset.path) {
        const ca = this._cachedAssets.find(value => value.path === asset.path)
        if (ca) Object.assign(asset, ca)
    }
    const ca = this._cachedAssets.findIndex(value => value.path === asset.path)
    if (ca >= 0) this._cachedAssets.splice(ca, 1)
    this._cachedAssets.push(asset)
}
```

The cache merge block (lines 241-244) only fires when the asset has **exactly one** property (`Object.entries(asset).length === 1 && asset.path`). For File drops via `setterFile`, the asset is `{file, path}` (two properties), so the merge is skipped. The old cached entry at the same path is then *removed* (line 246) and replaced by the fresh asset (without `preImported`). Full re-import runs.

## Effect

Dropping the same file (`.png`, `.jpg`, `.cube`, `.hdr`, `.exr`, etc.) into multiple slots produces **separate Texture / Wrapper instances** for each drop. Each gets its own GPU upload. For a 32³ float LUT cube: ~400KB doubled per slot. For a 4096×4096 RGBA image: ~64MB doubled. Cumulative if user re-drops same file across multiple materials.

Also affects:
- Drag-drop into slot, then drag a copy out and into another slot (two wrappers of same content).
- Filesystem-drop of the same `.cube` into multiple LUT slots in the LUT plugin (`lutMap`, `lutMap1`, `lutMap2`) — three wrappers, three `Data3DTexture` uploads.

Pre-existing issue. Not caused by any recent session.

## Fix options

### A. Reuse cached `preImported` even when file is present (smallest)

```ts
if (options.cacheAsset !== false && this.cacheImportedAssets && !this._cachedAssets.includes(asset)) {
    const ca = this._cachedAssets.find(v => v.path === asset.path)
    if (ca?.preImported && !options.forceImport) {
        Object.assign(asset, {preImported: ca.preImported, preImportedRaw: ca.preImportedRaw})
    }
    const idx = this._cachedAssets.findIndex(v => v.path === asset.path)
    if (idx >= 0) this._cachedAssets.splice(idx, 1)
    this._cachedAssets.push(asset)
}
```

Affects everything that goes through `importSingle`. Risk: serving stale results when a same-named file's content changed (e.g., user re-drops a file they edited). Pair with file-content-hash key if you want robustness.

### B. setterFile-only fix

In `tpImageInputGenerator.ts:setterFile`, before calling `importSingle`, check if a wrapper for this filename already exists in any registered slot and reuse it. Specific to image-input drops.

### C. Content-hashed path

Hash the file's bytes (sha256 or xxhash), use `path = name + '#sha256:' + hash` as the cache key. Robust against rename/edit. Slow for large files, but `.cube` and most textures are small.

## Recommendation

**(A)** as a first pass — fixes the common case, ~5 lines of code, no breaking surface change. Document the "stale-on-content-change" caveat. If it surfaces as a real problem later, add `forceImport: true` to `setterFile`'s call.

## Severity

Medium — wasted GPU memory but doesn't affect correctness. User may notice slow performance on scenes with many duplicated textures.

## Both threepipe and webgi affected

Same code structure. Fix should land in lockstep.

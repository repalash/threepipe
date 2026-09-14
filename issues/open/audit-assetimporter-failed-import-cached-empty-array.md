# AssetImporter: failed imports cached as empty array, blocking retry

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
When a file fails to load, `_loadFile` returns `[]`. Because `[]` is truthy, `importAsset` treats it as a successful result and caches it as `asset.preImported`. On the next import the cached empty array short-circuits the load, so the asset is permanently "successfully imported nothing" until `forceImport` is used. The dispose-listener cache cleanup never fires because an empty array has no results to listen on.

## Root Cause
On any load error, `_loadFile` returns an empty array:
```ts
} catch (e: any) {
    ...
    return []
}
```
`importAsset` treats `[]` (truthy) as success and caches it:
```ts
if (result) result = await this.processRaw(result, options, path)   // [] is truthy
if (result) {
    if (options.processRaw !== false && this.cacheImportedAssets) asset.preImported = result   // caches []
    ...
    arrs.forEach(r=>r?.addEventListener && ...)   // arrs is empty → no dispose listener attached
}
```
On retry:
```ts
let result: ImportResult | ImportResult[] | undefined = asset?.preImported   // [] (truthy)
...
if (!options.forceImport && result) {                                        // short-circuits
    const results = await this.processRaw<T>(result as any, options, path)
    return results                                                           // returns empty
}
```
The cache-invalidation logic only clears `preImported` from a result's own `dispose` event; an empty array has no results, so the stale empty cache persists.

## Impact
A transient load failure (network blip, temporarily-missing file) poisons the cache: every subsequent import of that path returns an empty result without retrying the load, until the caller passes `forceImport`. The user sees a permanently-empty asset with no error on retry.

## Fix
Do not cache failed/empty results. Either return `undefined` from `_loadFile` on error (so the `if (result)` guards skip caching), or in `importAsset` skip caching when the result is an empty array (`Array.isArray(result) && !result.length`).

## Files
- `src/assetmanager/AssetImporter.ts:427` — error path returns `[]`
- `src/assetmanager/AssetImporter.ts:271-273` — `[]` treated as success and cached as `preImported`; no dispose listener attached
- `src/assetmanager/AssetImporter.ts:256` — cached `[]` short-circuits the retry

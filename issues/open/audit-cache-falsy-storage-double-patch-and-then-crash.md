# overrideThreeCache: falsy-storage path corrupts `_orig` and crashes FileLoader

**Severity:** high
**Found:** 2026-06-13 code audit

## Bug
Two distinct, high-severity defects both root-caused to `overrideThreeCache` being called with a falsy (`undefined`) `storage`:

1. **`.then` of undefined crash on every asset load** — when `storage` is nullish, the patched `Cache.get` returns a non-Promise `undefined`. The modded `FileLoader` unconditionally chains `.then(...)` on it, so every responseType-based load (GLB, DRACO, JSON, text, etc.) throws `TypeError: Cannot read properties of undefined (reading 'then')`. This fires on the very FIRST patch with `undefined` storage.
2. **`_orig` corruption (double-patch)** — the same-storage dedup and the restore-before-repatch logic are gated on truthiness of `_storage`. When a prior call stored `_storage === undefined`, a later call skips both, then snapshots the ALREADY-PATCHED methods into `_orig`, permanently losing the genuine three.js cache functions and nesting patches on every subsequent call.

## Root Cause
`overrideThreeCache(undefined)` is a real, default-config call path. In `AssetImporter._initCacheStorage`, `storage` defaults to `true`; when `window.caches`/CacheStorage is unavailable (Node with polyfill, insecure/`file://` context, browsers without CacheStorage), `stro = true instanceof window.Cache` is `false` → `undefined`, and `overrideThreeCache(undefined)` is called.

Crash path (patched `get`):

```ts
threeCache.get = (url, responseType, mimeType) => {
    if (!responseType) return oldCache.get(url)
    if (url.startsWith('data:') || url.startsWith('blob') || url.startsWith('chrome-extension')) return Promise.resolve(undefined)
    return (storage as Cache|undefined)?.match(url).then(async response => {/* ... */})
    //     ^ storage === undefined → optional chain short-circuits to `undefined`, NOT a Promise
}
```

The modded `FileLoader.load` (`three.js-modded/src/loaders/FileLoader.js:26,38-41`) always calls `Cache.get(url, responseType, mimeType)` with `useCache = true` (it does NOT consult `Cache.enabled`) and immediately chains `.then(...)`. The original `Cache.js` contract is that `get` MUST return a Promise whenever a `responseType` is passed; the patched `get` violates this for nullish `storage`.

Double-patch / `_orig` corruption path:

```ts
if ((threeCache as any)._orig) {
    if ((threeCache as any)._storage) {            // <-- undefined is falsy: block skipped
        if ((threeCache as any)._storage === storage) return
        Object.assign(threeCache, (threeCache as any)._orig)
        delete (threeCache as any)._orig
        delete (threeCache as any)._storage
    }
}
const oldCache = {...threeCache}                    // snapshots ALREADY-PATCHED methods
;(threeCache as any)._orig = oldCache               // real originals lost
;(threeCache as any)._storage = storage
```

The commit "prevent internal three.js cache from being patched multiple times" shows the dedup is the intended guard; the `undefined` storage value defeats it because the code conflates "has been patched" with "storage is truthy".

## Impact
- In the default config on any environment without CacheStorage (Node-with-polyfill, `file://`, insecure context, older browsers), **every** asset load throws at `FileLoader`, breaking loading entirely.
- Repeated `overrideThreeCache` calls (e.g. re-init, switching storage) permanently replace `_orig` with patched functions, so a later restore reinstalls patched (nested) functions instead of the genuine three.js cache — the cache can never be cleanly un-patched.

## Fix
- In the patched `get`, when `storage` is nullish always return a Promise — e.g. guard at the top: `if (!storage) return oldCache.get(url, responseType, mimeType)` (delegating to the original, which honors the responseType→Promise contract), or wrap the lookup so a missing storage yields `Promise.resolve(undefined)`. Also consider honoring `threeCache.enabled` to match original semantics.
- For the dedup/restore, distinguish "patched" from "storage value": gate on `'_storage' in threeCache` (or a dedicated `_patched` boolean) rather than truthiness of `_storage`, so an `undefined` storage still triggers the same-storage early-return and the restore-before-repatch.

## Files
- `src/three/utils/cache.ts:24-27` — patched `get` returns non-Promise `undefined` for nullish storage (crash)
- `src/three/utils/cache.ts:13-23` — `_orig`/`_storage` double-patch corruption on falsy `_storage`
- `src/assetmanager/AssetImporter.ts:721-737` — `_initCacheStorage` computes `stro = undefined` and calls `overrideThreeCache(undefined)` in default config
- `three.js-modded/src/loaders/FileLoader.js:26,38-41` — always `Cache.get(...).then(...)` with `useCache = true`

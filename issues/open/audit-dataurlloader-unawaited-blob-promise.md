# DataUrlLoader: `blobToDataURL` Promise passed to `onLoad` un-awaited; `onError` can't catch rejection

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`DataUrlLoader.load` passes the unresolved Promise from the async `blobToDataURL` straight to `onLoad`, and the surrounding try/catch returns synchronously. A rejected `blobToDataURL` is never routed to `onError`, and `onLoad` receives a Promise rather than the expected data-URL string.

## Root Cause
```ts
return super.load(url, (res)=>{
    try {
        onLoad?.(blobToDataURL(res as any as Blob))   // Promise<string>, passed un-awaited
    } catch (e: any) {
        onError?.(e)                                   // can't catch the async rejection
    }
}, onProgress, onError)
```
`blobToDataURL` returns `Promise<string>`. The synchronous try/catch cannot catch its rejection, and `onLoad` gets a Promise.

It functionally works today via `loadAsync` because the outer `await` in `AssetImporter._loadFile` recursively unwraps the nested Promise and surfaces rejections in `_loadFile`'s own try/catch. But the loader contract is violated: a caller using `.load()` directly gets a Promise where a string is expected, and the async failure path bypasses `onError`.

## Impact
Low — the common `loadAsync` path masks it. A direct `.load()` consumer receives a Promise instead of a string, and async blob-conversion failures are not reported via `onError`.

## Fix
```ts
blobToDataURL(res as any as Blob).then(s => onLoad?.(s)).catch(e => onError?.(e))
```

## Files
- `src/assetmanager/import/DataUrlLoader.ts:14` — un-awaited `blobToDataURL` passed to `onLoad`

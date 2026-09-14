# ZipLoader: `unzipSync` throw not routed to `onError`

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`ZipLoader` runs `unzipSync` inside the FileLoader onLoad callback with no try/catch. A corrupt or non-zip payload throws synchronously; the throw escapes the callback instead of calling `onError`, so the loading manager sees an uncaught throw rather than a clean itemError.

## Root Cause
```ts
return super.load(url, (buffer: any)=>{
    const files = unzipSync(new Uint8Array(buffer))   // throws on corrupt/non-zip payload
    const map = new Map<string, File>(...)
    onLoad?.(map)
}, onProgress, onError)
```
No try/catch wraps `unzipSync`. Sibling loaders (`MTLLoader2`, `OBJLoader2`) wrap parse in try/catch + `onError`.

## Impact
A corrupt or non-zip file produces an uncaught exception in the loader callback instead of a routed `onError`, so the load fails ungracefully and the loading manager can't report a clean item error.

## Fix
```ts
return super.load(url, (buffer: any)=>{
    try {
        const files = unzipSync(new Uint8Array(buffer))
        const map = new Map<string, File>(Object.entries(files).map(([path, fileBuffer]) => [path, new File([fileBuffer as any], path)]))
        onLoad?.(map)
    } catch (e: any) {
        onError?.(e)
    }
}, onProgress, onError)
```

## Files
- `src/assetmanager/import/ZipLoader.ts:10` — `unzipSync` not wrapped in try/catch

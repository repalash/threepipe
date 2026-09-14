# SimpleJSONLoader: async `parseAsync` rejection unhandled, `onError` never called

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`SimpleJSONLoader.load` calls `this.parseAsync(...).then(onLoad)` with no `.catch`. The surrounding try/catch only covers the synchronous `JSON.parse`. If `parseAsync` rejects (the `JSONMaterialLoader` subclass does real async work — `loadConfigResources`, `ThreeSerialization.Deserialize`), the rejection escapes as an unhandled promise rejection and `onError` is never invoked.

## Root Cause
```ts
return super.load(url, (res)=>{
    try {
        if (typeof res === 'string') {
            this.parseAsync(JSON.parse(res)).then(onLoad)   // no .catch
        } else {
            throw new Error('Invalid JSON')
        }
    } catch (e: any) {
        onError?.(e)
    }
}, onProgress, onError)
```
The `try/catch` returns synchronously; it cannot catch a rejection from the async `parseAsync`. So a deserialization failure neither reaches `onError` nor the loading manager — the import promise can hang or resolve `undefined`, plus an unhandled rejection is logged.

## Impact
When a JSON material/config asset fails to deserialize, the error is swallowed (no `onError`, no clean itemError), the load may hang or silently resolve undefined, and an unhandled promise rejection surfaces.

## Fix
```ts
this.parseAsync(JSON.parse(res)).then(onLoad).catch(e => onError?.(e))
```

## Files
- `src/assetmanager/import/SimpleJSONLoader.ts:16` — `parseAsync(...).then(onLoad)` missing `.catch`

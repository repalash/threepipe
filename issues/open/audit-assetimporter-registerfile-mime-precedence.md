# AssetImporter: `registerFile` `??`/ternary precedence discards explicit mime for non-data paths

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
In `registerFile`, the local `mime` computation mixes `??` and `?:` without parentheses. `??` binds tighter than `?:`, so the data-URL parse runs even for non-data paths, dropping an explicitly-provided `file.mime` from the local `mime` value passed to the loader factory.

## Root Cause
```ts
const mime = file?.mime ?? isData ? path.slice(0, path.indexOf(';')).split(':')[1] || undefined : undefined
```
Parses as:
```ts
const mime = (file?.mime ?? isData) ? <data-url-parse> : undefined
```
With `file.mime = 'image/png'` and a non-data path `'model.png'`: `(file.mime ?? isData)` is `'image/png'` (truthy) → the data-URL parse branch runs on a non-data-URL path → yields `undefined`. So the explicit mime is dropped for the `mime` passed to `_getLoader`/`_createLoader` at line 492. (`file.mime` itself still survives the database write via `if (!file.mime) file.mime = mime`.)

## Impact
For a registered file with an explicit non-data-URL mime, loader resolution (`_getLoader`/`_createLoader`) receives `undefined` mime instead of the provided one — loader selection that relies on mime can pick the wrong loader or fall back to extension-only resolution.

## Fix
Parenthesize so `??` is the fallback and the parse only runs for data URLs:
```ts
const mime = file?.mime ?? (isData ? path.slice(0, path.indexOf(';')).split(':')[1] || undefined : undefined)
```

## Files
- `src/assetmanager/AssetImporter.ts:479` — mis-parenthesized `mime` expression; result feeds loader resolution at line 492

# overrideThreeCache: `startsWith('blob')` missing colon

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
The patched `get`/`add` short-circuit blob URLs with `url.startsWith('blob')` (no colon), so any non-blob URL that merely begins with the literal `blob` (e.g. `blobstore...`, `blob-data.glb`) is also wrongly bypassed from caching. Every other blob check in the codebase uses `'blob:'`.

## Root Cause
```ts
if (url.startsWith('data:') || url.startsWith('blob') || url.startsWith('chrome-extension')) return Promise.resolve(undefined)
// ...
if (url.startsWith('data:') || url.startsWith('blob') || url.startsWith('chrome-extension') || url.startsWith('asset://')) return
```

Everywhere else the check is `startsWith('blob:')` (e.g. `AssetManager.ts:525/532/539`, `AssetImporter.ts:450/546`, `RGBEPNGLoader.ts:37`, `TextSVG.ts:195`). Real `blob:` URLs are a subset so they still match, but the broader match wrongly bypasses caching for unrelated URLs.

## Impact
Caching is silently skipped for any URL/path/host starting with `blob` (without a colon). Correctness of real `blob:` handling is unaffected; the bug only over-matches. Low severity / consistency.

## Fix
Use `startsWith('blob:')` to match the convention used everywhere else.

## Files
- `src/three/utils/cache.ts:26` — patched `get` blob check
- `src/three/utils/cache.ts:75` — patched `add` blob check

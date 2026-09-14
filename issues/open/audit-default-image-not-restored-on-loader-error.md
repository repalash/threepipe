# FBXLoader2 / GLTFLoader2: `Texture.DEFAULT_IMAGE` not restored on parse error (global-state leak)

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
Both loaders temporarily set the process-global `Texture.DEFAULT_IMAGE = whiteImageData` and restore the previous value only on the success path. If `super.loadAsync` / `super.parse` throws or calls `onError`, `Texture.DEFAULT_IMAGE` is left mutated for all subsequent `new Texture()` calls process-wide. The pattern is also not concurrency-safe — overlapping loads race on the global.

## Root Cause
FBXLoader2 restores only after the awaited success:
```ts
const val = Texture.DEFAULT_IMAGE
if (!Texture.DEFAULT_IMAGE) Texture.DEFAULT_IMAGE = whiteImageData
const res = await super.loadAsync(url, onProgress)   // throw here → restore skipped
Texture.DEFAULT_IMAGE = val
return res
```
GLTFLoader2 restores only inside the onLoad callback:
```ts
const val = Texture.DEFAULT_IMAGE
if (!Texture.DEFAULT_IMAGE) Texture.DEFAULT_IMAGE = whiteImageData
return res ? super.parse(res, path, (ret)=>{
    Texture.DEFAULT_IMAGE = val   // only runs on success
    ...
    onLoad && onLoad(ret)
}, onError) : ...                  // onError path never restores
```
On a parse error / decode failure, the restore line never runs.

## Impact
After a failed FBX/glTF load, the global default texture image stays overridden, so later `new Texture()` calls elsewhere pick up `whiteImageData` (or whatever it was set to). Low because it only triggers on a load error and the override is to a benign white image, but it is a real process-global leak.

## Fix
- FBX: wrap in `try/finally` and restore `Texture.DEFAULT_IMAGE = val` in `finally`.
- glTF: also restore in the `onError` branch (or wrap the parse).

## Files
- `src/assetmanager/import/FBXLoader2.ts:11-21` — restore only on success path
- `src/assetmanager/import/GLTFLoader2.ts:155-174` — restore only inside onLoad; onError path leaves global mutated

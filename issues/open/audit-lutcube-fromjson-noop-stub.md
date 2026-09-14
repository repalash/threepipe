# LUTCubeTextureWrapper: `fromJSON` is a no-op stub (latent round-trip trap)

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`LUTCubeTextureWrapper.fromJSON` does not restore any state — it logs and returns `this`. The class is serializable and `toJSON` emits a real serialized texture into `meta.extras`, so the read/write halves are asymmetric. On the normal round-trip this is harmless because restore goes through `AssetImporter.importSingle` (the `loadConfigResources` URL path), not `ThreeSerialization.Deserialize`; but any future code that deserializes this type directly via `ThreeSerialization` would silently get an unpopulated wrapper.

## Root Cause
```ts
fromJSON(_data: any, _meta?: any): this {
    console.error('LUTCubeTextureWrapper.fromJSON: not implemented — restore .cube assets via AssetImporter.importSingle (loadConfigResources path) instead')
    return this
}

toJSON(meta?: any): any {
    return serializeTextureInExtras(this as any, meta, this.texture3D.name)
}
```
`toJSON` returns a serialized form with a populated `url` in `meta.extras`. On restore, `loadConfigResources` takes the `e.url`-present branch (`importSingle`/File import) and only calls `ThreeSerialization.Deserialize(e)` — which would invoke `fromJSON` — when `!e.url`. `url` is empty only in the already-errored "not loaded through asset manager" path. So `fromJSON` is dead on the happy path; it is a latent trap, not an active break.

## Impact
None on the normal save/load path today. The asymmetry is a latent trap: if a caller ever deserializes a `LUTCubeTextureWrapper` directly through `ThreeSerialization`, it gets an empty wrapper with no error surfaced to the caller.

## Fix
Either implement `fromJSON` to reconstruct from the extras resource, or document this type as write-only-through-the-wrapper so the asymmetry is intentional and visible.

## Files
- `src/assetmanager/import/LUTCubeLoader2.ts:48` — `fromJSON` no-op stub
- `src/assetmanager/import/LUTCubeLoader2.ts:53` — `toJSON` emits a real serialized texture

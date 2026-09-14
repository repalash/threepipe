# `ILoader`: add a preProcess hook for compressed / wrapped formats

**Created:** 2026-06-04
**Status:** Open — altitude / architectural, low priority
**Scope:** `src/assetmanager/IImporter.ts`, `src/assetmanager/Importer.ts`, `src/assetmanager/AssetImporter.ts`

## Context

`ILoader` currently exposes `loadAsync` (required) and `transform` (optional, post-parse). There is no pre-parse hook. Loaders that need byte-level pre-processing (decompression, container unwrapping) must subclass `FileLoader` and override `loadAsync` inline — which is what `BlendLoadPlugin` does (`plugins/blend-importer/src/BlendLoadPlugin.ts:33`) and what `ZipLoader.ts` does for zip unwrapping.

This is the second time this pattern has been written (third if you count USDZ). The next compressed-format loader will be the fourth.

## Proposal

Add a `preProcess?(raw: ArrayBuffer, options: AnyOptions): ArrayBuffer | Promise<ArrayBuffer>` to `ILoader`. `AssetImporter` (or `Importer.load`) calls it between the network fetch and the format parser. Loaders that need decompression provide this method; everyone else ignores it.

For the blend importer this would let us delete the inline `class extends FileLoader` and just provide `preProcess: decompressBlend` alongside `loadAsync`.

For ZipLoader / USDZ, the unzip step similarly becomes a `preProcess` call.

## Why not now

- No second callsite yet that wants the same hook (only blend-importer needs it today). Adding the hook for one consumer is speculative generality.
- Adds API surface to `ILoader`, an interface that's already implemented in many places. Even with the `?` making it optional, every implementer becomes a candidate for review.
- A shared `src/utils/decompress.ts` (gunzip + zstd + magic-detect) would deliver most of the reuse benefit without the interface change.

## When to revisit

When the second compressed/wrapped format lands (gzipped FBX, compressed glb, zstd-glb, etc.). At that point the pattern is repeated three times and the abstraction is justified.

## References

- `src/assetmanager/IImporter.ts:8` — `ILoader` definition.
- `src/assetmanager/Importer.ts` — wrapper that calls `loadAsync` + `transform`.
- `plugins/blend-importer/src/BlendLoadPlugin.ts:33-71` — the inline-subclass workaround.
- `src/assetmanager/import/ZipLoader.ts` — same pattern for zip.

# @threepipe/plugin-draco-js DRACOLoader2Pure: EdgeBreaker silent-mis-decode not validated + `preload()` drops decoder/encoder args

**Severity:** low
**Found:** 2026-06-13 code audit

Two latent integration gaps in `DRACOLoader2Pure`. The vendored decoder body is byte-for-byte upstream draco.js and is out of scope; both findings are in the threepipe integration glue.

## Bug 1 — EdgeBreaker decode result is never sanity-checked before returning
`isJsDecodable()` exists precisely because draco.js *fails silently* on unsupported streams (e.g. a sequential-encoded mesh decodes to a geometry with no position attribute rather than throwing). The header gate routes point-cloud/sequential/metadata streams to WASM, and a `.catch()` handles hard throws. But for a stream that passes the gate (EdgeBreaker triangle mesh, no metadata) yet decodes to a degenerate/empty geometry *without throwing*, nothing validates the result — `decodeGeometry` returns whatever `js.decodeGeometry()` produced, with no `getAttribute('position')`-present / vertex-count check before returning.
**Mitigation present:** the project's verified test asserts byte-for-byte equality with the WASM decoder for EdgeBreaker meshes, so EdgeBreaker is reliable in practice; this is a defense-in-depth gap, not a known live corruption.
**Fix:** after the JS decode resolves, when `EnableFallback`, sanity-check the result (non-empty `position` attribute and valid index/draw range) and `_fallback()` if it looks degenerate — closing the same silent-corruption class for the EdgeBreaker path, symmetric with the eager header gate.

## Bug 2 — `preload()` override silently drops the base `decoder`/`encoder` args
Base is `DRACOLoader2.preload(decoder = true, encoder = false)`, which forwards `encoder` to `initEncoder()`. The override is `preload(): this` and ignores both params, only warming the JS module.
```ts
// DRACOLoader2Pure.ts
preload(): this { /* warms JS module only; ignores decoder/encoder */ }
```
A caller doing `pure.preload(false, true)` (warm encoder only) gets a no-op encoder warm. Live call sites don't exercise it today (GLTFLoader calls `preload()` with no args; the Draco *export* path uses a separate `DRACOLoader2` instance), so this is a latent contract mismatch, not a live bug.
**Fix:** accept and honor the args — `preload(decoder = true, encoder = false)`, warm the JS module when `decoder`, `this.initEncoder()` when `encoder` — or narrow the documented contract.

## Files
- `plugins/draco-js/src/DRACOLoader2Pure.ts:100-108` — EdgeBreaker decode path returns without validating the result
- `plugins/draco-js/src/DRACOLoader2Pure.ts:71-74` — `preload()` override drops `decoder`/`encoder` args
- `src/assetmanager/import/DRACOLoader2.ts:41-45` — base `preload(decoder, encoder)` signature

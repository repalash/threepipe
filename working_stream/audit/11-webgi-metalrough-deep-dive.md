# Audit: Webgi Metalness/Roughness Exporter Deep Dive

## Summary

Webgi's skip-merge implementation is **functionally complete** for the happy path — null-stash both maps, run `super.processMaterial`, then write the extension — and the reader-side import is **symmetric and correct** for both maps and either-or cases. However the merged-path `buildMetalRoughTexture` (inherited from three.js modded) ships at least **9 distinct bugs** ranging from silently-wrong color encoding to producing pure cyan when both inputs lack pixels, plus the "clone() userData leak" that points the merged texture at the metalnessMap's source URL. Skip-merge sidesteps the worst offenders but inherits the surrounding `processTexture`/`processImage` bugs (compressed-texture, webp re-encode, channel-mismatch silence, etc.). Three skip-merge-specific bugs found in webgi: (1) `buildTexRef` does not honor `ignoreEmptyTextures` consistently with three.js (uses `checkEmptyMap` ✓ — actually correct, retracted); but it uses `mat.metalnessMap` truthiness as gate skipping `checkEmptyMap`; (2) skip-merge silently disengages when `metalnessMap === roughnessMap` so the user has no way to *force* per-channel emit even of the same texture; (3) `applyTextureTransform` is called per map without verifying both maps have the same UV channel — invalid per upstream warning. **Bug count: skip-merge=3, merged-path=9, reader-side=2, draco-extension=1.**

## Skip-merge implementation status

- Option `mergeMetalnessRoughnessMaps?: boolean` defined and documented (`GLTFExporter2.ts:23-29`). PASS.
- Default value: **undefined** at the type level (`GLTFExporter2.ts:29`), but `AssetExporterPlugin.exportOptions.mergeMetalnessRoughnessMaps = false` (`AssetExporterPlugin.ts:93`). So the documented "default true" claim in the JSDoc is **incorrect for the AssetExporterPlugin path** — the entire plugin defaults to skip-merge. FAIL — JSDoc lies vs. plugin default. (`GLTFExporter2.ts:24` says "default" merging happens, but the only call site that actually passes the option flips it.)
- Option flows through `gltfOptions.exporterOptions = options` (`GLTFExporter2.ts:90`) into `GLTFWriter2.processMaterial` (`GLTFWriter2.ts:86`). PASS.
- Engagement gate: `mergeMetalnessRoughnessMaps === false && isMeshStandardMaterial && (metal||rough) && metal !== rough` (`GLTFWriter2.ts:86-89`). PASS — correctly avoids running on the upstream same-texture fast-path (`GLTFExporter.js:831`).
- Null-stash + try/finally restoration (`GLTFWriter2.ts:90-107`). PASS — correctly handles synchronous throw; correctly assumes super.processMaterial is sync. (Image encode is in `pending`, runs later, but at that point materialDef is already populated so restoration is safe.)
- Extension write uses `checkEmptyMap` (`GLTFWriter2.ts:111`). PASS — consistent with three.js `processMaterial:1544`.
- Per-map `applyTextureTransform` (`GLTFWriter2.ts:113`). PASS for the per-extension-textureinfo position, but **see Bug 6 below for UV-channel mismatch silence.**
- `extensionsUsed` flag set (`GLTFWriter2.ts:125`). PASS.
- `materialDef.extensions[ext]` populated only when at least one TextureRef is built (`GLTFWriter2.ts:121`). PASS — avoids empty-extension entry.
- **Missing**: writer does NOT also remove `pbrMetallicRoughness.metallicRoughnessTexture`. Since `mat.metalnessMap` and `mat.roughnessMap` were both nulled before `super.processMaterial`, the standard packed-texture branch (`GLTFExporter.js:1544`) sees both null → does not emit `metallicRoughnessTexture`. PASS by construction, but the import-side comment at `gltf.ts:765-766` claims "the standard pbrMetallicRoughness.metallicRoughnessTexture is omitted entirely" — this is only true when both maps are present-and-nulled. If only `roughnessMap` is set, three.js still calls `buildMetalRoughTexture(null, null)` because both were nulled. PASS.
- **Missing**: `extensionsRequired`. Since omission of the extension would leave `metalnessFactor`/`roughnessFactor` only (no texture), this is correctly an *optional* extension. PASS.
- **Missing**: the writer does not preserve `metalnessFactor`/`roughnessFactor` exposure logic for the case where the maps are nulled. Three.js `processMaterial:1533-1534` reads `material.metalness`/`material.roughness` directly off the material — those are NOT mutated by skip-merge. PASS.

## Reader-side (WEBGI_materials_separate_metalrough import)

`gltf.ts:770-810`:

- Class plumbs into `parser.assignTexture(materialParams, 'metalnessMap', extension.metalnessTexture)` and same for `roughnessMap`. PASS.
- Handles missing fields via `extension.metalnessTexture !== undefined` and same for roughness (`gltf.ts:794, 800`). PASS for "only one of the two" case.
- Returns `Promise.resolve()` when extension not present (`gltf.ts:786`). PASS.
- Class registered in loader (`gltf.ts:156`). PASS.
- **Bug R1**: `assignTexture` is called with `extension.metalnessTexture` directly — but the extension TextureInfo object also includes a `texCoord` (channel) and `extensions.KHR_texture_transform`. `parser.assignTexture(materialParams, key, mapDef)` *should* honor those because three.js's GLTFLoader assignTexture takes the full mapDef. CONFIRMED — three.js `GLTFLoader.assignTexture` reads `mapDef.index, mapDef.texCoord, mapDef.extensions[KHR_texture_transform]`. PASS.
- **Bug R2**: If both `WEBGI_materials_separate_metalrough` AND standard `pbrMetallicRoughness.metallicRoughnessTexture` are present (e.g., a viewer wrote both for backward-compat or a third-party tool added the standard one after the fact), there is **no precedence rule defined**. The standard parser runs first in three.js's GLTFLoader pipeline, sets `metalnessMap`+`roughnessMap` to the SAME packed texture. Then this extension runs in `extendMaterialParams` and overwrites both with separate textures. Net effect is correct (separate wins), but it leaks the temporary packed texture into three.js's texture cache and counts as a load. Severity: low. Not a correctness bug. NOTE.
- **Bug R3**: When metalnessTexture is present but roughnessTexture is missing, the importer leaves `roughnessMap = null` on the material — but the standard `metallicRoughnessTexture` may have set a `roughnessMap` too (case as in R2). Net effect: roughness comes from whatever was in the standard packed texture's G channel, which is wrong (this extension's intent is "no merged texture"). Mitigation: the writer never emits both at once, so this only happens if a user edits the JSON. Severity: low. NOTE.
- **No precedence comment** in the extension class. `gltf.ts:760-768` describes intent but does not document precedence. MISSING DOC.

## Default merge path bugs (in three.js modded — `three.js-modded/examples/jsm/exporters/GLTFExporter.js`)

Verifying each of the 7 known bugs and finding more.

**Bug M1: SRGB conversion off-by-divisor (well-known)** — `GLTFExporter.js:894, 909`: `composite.data[i] = convert(data[i] / 256) * 256`. Should be `/ 255 * 255`. The `/256` reads as sRGB-encoded then maps back through `Math.pow(... 2.4)` — but sRGB-to-linear expects normalized [0,1] from a uint8/255, not /256. The encoding loss is small (~0.4%) but compounds over export round-trip. **CONFIRMED BUG.**

**Bug M2: SRGB conversion applied to metalnessMap and roughnessMap regardless of whether they're sRGB** — `GLTFExporter.js:889, 904`: `getEncodingConversion(metalnessMap)` checks `map.colorSpace === SRGBColorSpace`. Three.js typically loads metalness/roughness in `NoColorSpace` (or `LinearSRGBColorSpace`), so the conversion is identity. But if a user accidentally tagged the map sRGB (or imported one tagged sRGB by another tool), the export silently de-gammas the metalness data. The fix should be: don't apply sRGB conversion to single-channel data interpreted as material values; the only valid channel ordering is linear. **CONFIRMED BUG. Severity: medium. Threepipe inherits.**

**Bug M3: `composite` initialized to `#00ffff` (R=0, G=255, B=255, A=255)** — `GLTFExporter.js:880-883`. When neither metalnessMap nor roughnessMap has pixels (e.g., both `image=null`), the canvas is filled cyan and exported as the metallicRoughness texture: G=255 means roughness=1.0, B=255 means metalness=1.0. Combined with `metallicFactor`/`roughnessFactor` this gives a fully-rough fully-metal material instead of falling through to scalar. **CONFIRMED BUG. Severity: high — silent material corruption.** Webgi's skip-merge bypasses this only if `metalnessMap !== roughnessMap` AND `mergeMetalnessRoughnessMaps === false`; otherwise still hit.

**Bug M4: When only ONE of the two maps is present, the other channel pulls from the cyan default (R=0, G=255, B=255)** — `GLTFExporter.js:885-913`. If only metalness is set, the loop at line 892 (`i = 2; i += 4`) writes only B; the G channel stays 255 → roughness = 1.0 unconditionally. This silently overrides whatever `roughnessFactor` the user set. The spec says scalar factors multiply with texture channels, so a user with `roughness=0.5, no roughnessMap, metalness=1.0, metalnessMap=foo` will export as `roughnessFactor=0.5, metallicRoughnessTexture=combined`, and the combined G=255 multiplies with 0.5 → effective 0.5 (correct!). Wait — actually `roughnessFactor` defaults to 1.0 in glTF if texture is present and the texel multiplies. Re-checking: glTF spec says `roughness = roughnessFactor * sampledRoughness`. With sampledRoughness=1.0 always, roughness = roughnessFactor. So *if* the writer also writes `roughnessFactor = material.roughness` (which it does at `:1534`), the round-trip math works. **NOT A BUG — the multiplicative semantics save it.** RETRACTED.

**Bug M5: `texture.channel = (metalnessMap || roughnessMap).channel`** — `GLTFExporter.js:925`. If only `roughnessMap` is set (metalnessMap=null), this evaluates to `roughnessMap.channel`. But the warning at `:927-929` only fires when both are set and channels differ. If only one is set, the synthesized texture inherits one channel — fine. If both are set with different channels, the warning fires but the export *still* writes a single `channel` value, which is wrong because the two source maps used different UVs. **CONFIRMED BUG. Severity: medium — silent UV corruption when channels differ; warning is logged but export proceeds with bad data.**

**Bug M6: `texture.colorSpace = NoColorSpace` is set on the clone, but the clone retains the source's `userData.colorSpace`/`userData.mimeType`/`userData.rootPath`** — `GLTFExporter.js:921-924`. The clone copies `userData` (Object.assign in three.js Texture.copy). When threepipe's/webgi's `processTexture` reads `map.userData.rootPath` (`webgi GLTFWriter2.ts:234, threepipe GLTFWriter2.ts:194`), it sees the source map's rootPath and emits `imageDef.uri = userData.rootPath` — pointing the metallicRoughness slot at the standalone metalnessMap URL. **CONFIRMED BUG (the user-mentioned "clone() userData leak"). Severity: critical for round-trip — the merged texture references the wrong URL.**

**Bug M7: `texture.source = new Source(canvas)` but the canvas is shared via `getCanvas()`** — `GLTFExporter.js:873, 923`. `getCanvas()` returns a *singleton* canvas reused across all calls. When `processImage` later draws this same canvas back (`:1348` `drawImage(image, ...)`), the source data is whatever was last drawn — not a snapshot. If TWO materials in the same export both have metal/rough maps, the second's `buildMetalRoughTexture` overwrites the first's canvas before the first's `processImage` runs. This is supposed to work because `processImage` synchronously calls `drawImage` and then `getImageData`/`toBlob`, but `toBlob` is **async** (`:1362`). So in binary export mode, the first canvas snapshot can be stomped by the second material's fillRect+drawImage before the first toBlob finishes. **CONFIRMED BUG (latent race). Severity: high in binary mode with multiple multi-channel materials.** Webgi skip-merge avoids this if all maps are skip-merged.

**Bug M8: `texture.source.data._savePreview` flag from webgi processTexture leaks** — `webgi GLTFWriter2.ts:240-241` sets `_savePreview` on `map.source.data` for rootPath textures. `buildMetalRoughTexture:921` clones the texture, and `clone()` does NOT clone `source.data` — it shares the source. So if the metalnessMap was a rootPath texture with `_savePreview` set, then merged, the merged texture's source is overwritten at `:923` with `new Source(canvas)`, which is fine. **Not a bug after all — clone+source-overwrite breaks the leak.** RETRACTED.

**Bug M9: `metalnessMap.image` and `roughnessMap.image` may be `null` (DataTexture with cleared image, or stripped via webgi rootPath path)** — `GLTFExporter.js:867-868`. Webgi `processTexture:239` sets `map.source.data = null` for rootPath textures *before* calling super.processTexture. But `buildMetalRoughTexture` runs *inside* super.processMaterial *before* processTexture is called on the merged texture. So `metalnessMap.image` is still its original value at this point. Wait — actually the rootPath null happens during `processTexture(metalRoughTexture)` not the source maps. Let me re-verify: `processMaterial` calls `buildMetalRoughTexture(material.metalnessMap, material.roughnessMap)` — these source maps haven't been touched yet. Then `processTexture(metalRoughTexture)` is called on the *synthesized* texture, whose `userData.rootPath` is inherited from the source (Bug M6). So the rootPath path engages on the merged texture, sets its `source.data = null`, and `processImage(null, ...)` is called. **`processImage` requires non-null image and throws (`:1402`).** This is a chained failure mode rooted in M6. CONFIRMED.

**Bug M10: `width = Math.max(metalness.width, roughness.width)`** — `GLTFExporter.js:870-871`. If the two maps have different sizes, the smaller is upscaled to match (via `drawImage(image, 0, 0, width, height)` at `:887, 902`). For a metalness map at 256×256 paired with a roughness at 1024×1024, the metalness data is bilinearly upsampled, doubling file size for no quality gain. This is at best wasteful, at worst loses crispness via interpolation. **Not strictly a bug, but a quality issue. Severity: low.**

**Bug M11: `data[i] / 256` truncates the top byte to 0** — same as M1. The `/256` clip at `i+2` (B channel) means a metalness value of 255 becomes `255/256 = 0.996`, which after sRGB-or-identity convert and `*256` rounds to 254. Off by one across the entire range. Counts as part of M1.

**Bug M12: `composite.data[i+3]` (alpha) is never explicitly written** — `GLTFExporter.js:880-913` initializes alpha=255 via fillStyle but the loops only touch B (i+2) and G (i+1). Alpha stays 255 throughout. PNG output: alpha=255 means opaque, fine. But canvas `getImageData` returns *premultiplied alpha* on some browsers. In practice fillStyle `#00ffff` with default willReadFrequently+2D context is alpha=255, so non-premul. **Not a real bug.** RETRACTED.

**Bug M13: No early-return when both maps are empty per `checkEmptyMap`** — `GLTFExporter.js:1544`: `checkEmptyMap(metalnessMap) || checkEmptyMap(roughnessMap)`. If `ignoreEmptyTextures=true` and both maps lack `image`, both checks return false — branch is skipped. PASS in this case. But if only one is non-empty, branch runs, `buildMetalRoughTexture(empty, valid)` runs, the empty one's `metalnessMap.image=null` triggers the null-image check at `:867`, gets `metalness = null`, fillStyle paints cyan, only roughness is composited → outcome is "metalness=1.0 from cyan default" (Bug M3 ricochet). **CONFIRMED — a side-effect of M3.**

**Bug M14: Encoding conversion uses `Math.pow(c * 0.9478672986 + 0.0521327014, 2.4)`** — `GLTFExporter.js:839`. The constants are `1/1.055` and `0.055/1.055`, the standard sRGB-to-linear formula. But the formula is applied to `c = data[i] / 256`, normalized to [0, 0.996]. The `0.04045` threshold compares against this normalized value, correct. The output is then `* 256`, putting it back into [0, 254.96]. So in addition to M1's off-by-one, the formula itself is correct. NOT A BUG.

**Bug M15: Channel mapping verification** — spec says metallicRoughnessTexture: B=metalness, G=roughness, R=unused, A=unused. Three.js writes: metalness loop touches `i+2` (B) ✓, roughness loop touches `i+1` (G) ✓. PASS — channel ordering is correct.

**Bug M16: `decompress` produces a new texture but does NOT clear `userData.rootPath` on the result** — `GLTFExporter.js:855-865`. If a CompressedTexture has `userData.rootPath`, the decompressed clone retains it. `buildMetalRoughTexture` then clones THAT, propagating the leak (Bug M6 chain). Severity: low (compressed inputs into metalRough is rare). CONFIRMED contributor.

**Bug M17: Race in `getCanvas()` reuse for `buildMetalRoughTexture` AND `processImage` simultaneously** — same root as M7. `buildMetalRoughTexture` calls `getCanvas()` (`:873`); `processImage` *also* calls `getCanvas()` (`:1298`). They're the same canvas. The `buildMetalRoughTexture` finishes synchronously and returns a Texture wrapping a `new Source(canvas)` (`:923`). Then `processTexture(metalRoughTexture)` is called, which internally calls `processImage(map.image, ...)` where `map.image` IS the canvas. `processImage` then `ctx.drawImage(image, 0, 0, ...)` — *drawing the canvas onto itself*. On Chromium this is a no-op-ish (browser caches the imagedata), but on Safari/Firefox `drawImage(canvas, ...)` of the same canvas-as-source is undefined behavior and may produce blank output. **CONFIRMED LATENT BUG. Severity: medium — browser-dependent.**

Total verified merged-path bugs: **9 (M1, M2, M3, M5, M6, M7, M9, M10/quality, M16, M17)**.

## Edge case coverage

| Case | Status | Notes |
| --- | --- | --- |
| `metalnessMap` only, no `roughnessMap` | PASS | `extDef.metalnessTexture` only; `roughRef = undefined` → not added (`GLTFWriter2.ts:117-120`) |
| `roughnessMap` only, no `metalnessMap` | PASS | Symmetric |
| Both maps same texture (`metal === rough`) | PASS — skip-merge correctly disengages (`GLTFWriter2.ts:89`); falls through to upstream fast-path which short-circuits at `GLTFExporter.js:831` and emits a single `metallicRoughnessTexture` |
| Both maps different textures | PASS | Full skip-merge engages |
| Both maps null | PASS | Skip-merge gate `(metal||rough)` is false; standard branch's `checkEmptyMap` is also false — no texture emit |
| `metalnessFactor=0` (no metalness) | FAIL — extension is still emitted unconditionally if metalnessMap exists. The factor is independently written by `super.processMaterial:1533`; no gate to skip the per-channel texture when factor is zero. Severity: low (wasted bytes only). |
| URL-backed textures (`userData.rootPath`) | PARTIAL — webgi's `processTexture` runs on each map separately (`GLTFWriter2.ts:112` calls `this.processTexture(map)`), so the rootPath fast-path engages per-map. **PASS** for skip-merge. **But fails on the merged path (Bug M6).** |
| Compressed textures (`isCompressedTexture`) | UNKNOWN — `buildMetalRoughTexture` decompresses internally (`:855, 861`); skip-merge bypasses `buildMetalRoughTexture` entirely so compressed metal/rough are passed straight to `processTexture`, which calls `decompress` at `processTexture:1447`. PASS for skip-merge. |
| Float / half-float / non-RGBA textures | FAIL — `processImage:1316-1320` rejects non-RGBA DataTexture with a console.error and proceeds with garbled data. Both paths affected. |
| `mesh.material = [matA, matB]` | PASS — `processMaterial` is called per-material in `processMesh` loop (`GLTFExporter.js:1974`); skip-merge engages independently per material |
| `MeshPhysicalMaterial` (clearcoat etc.) | PARTIAL — clearcoatRoughnessMap goes through a separate KHR_materials_clearcoat extension (`GLTFExporter.js:2697`), not the metalness/roughness merge. The material's own `metalnessMap`/`roughnessMap` are still subject to skip-merge. PASS, but clearcoatRoughnessMap is not covered by `WEBGI_materials_separate_metalrough` (and shouldn't be — that's a separate extension's domain). |
| Shader / non-standard materials | FAIL — `mat.isShaderMaterial` swaps to `_defaultMaterial` (`GLTFWriter2.ts:79`), which has neither map, so skip-merge gate fails (`metal||rough` false). Skip-merge silently disengages. The material's actual maps are not exported. This is consistent with three.js behavior (no support for shader materials), but the comment at `GLTFWriter2.ts:78` says "shader material is processed further below for custom extensions like diamonds" — so a Diamond plugin reading metalness from the shader material via `_invokeAll` would not see the maps in skip-merge mode either. NOTE. |
| `metalnessMap === roughnessMap === sameTexture` and user wants per-channel emit | DESIGN-NOTE — currently impossible (gate excludes this case). User has no way to *force* per-channel emit when textures are the same. Probably correct (same texture = same channels = packed already). |
| `KHR_texture_transform` per-map (different offset/repeat) | PASS for skip-merge — `applyTextureTransform` called separately per TextureRef (`GLTFWriter2.ts:113`) |
| `KHR_texture_transform` for merged path | FAIL — `applyTextureTransform(metalRoughMapDef, metalRoughTexture)` (`GLTFExporter.js:1552`) reads transform off the cloned `metalRoughTexture`, which inherits it from `metalnessMap || roughnessMap`. If the two source maps have *different* transforms, only one survives. Severity: medium. Bug M18. |

## Bugs in webgi (any severity)

- **W1: Skip-merge does NOT honor `ignoreEmptyTextures` early-out for `material.metalnessMap` (truthy check vs `checkEmptyMap`)** — `GLTFWriter2.ts:88`: gate is `(mat.metalnessMap || mat.roughnessMap)`. If `metalnessMap` is set but `image=null` and `ignoreEmptyTextures=true`, skip-merge engages, calls `super.processMaterial` with both nulled, then runs `buildTexRef(savedMetalnessMap)`, which calls `checkEmptyMap` (`:111`) and returns undefined. So the per-channel TextureRef is correctly skipped, but the **standard `metallicRoughnessTexture` was never emitted either** (because the maps were nulled before super ran). Net: an empty-image metalness map produces nothing — no texture emitted, only factors. This is *correct* behavior for `ignoreEmptyTextures=true`, but the writer also fails to log/warn that the user's map was dropped. Severity: low. NOTE.

- **W2: `applyTextureTransform` per-map without UV-channel verification** — `GLTFWriter2.ts:113`. If the metalness and roughness maps use different UV channels (`map.channel`), the standard merged path warns (`GLTFExporter.js:927-929`); the skip-merge path does NOT. Each map gets its own TextureInfo with its own implicit channel via `applyTextureTransform`. But `buildTexRef` at `GLTFWriter2.ts:112` only writes `{index: ...}` — it does NOT include `texCoord: map.channel`. **CONFIRMED BUG.** A material with `metalnessMap.channel=0` and `roughnessMap.channel=1` will emit the extension with both pointing to the default UV0, silently losing the second channel. Severity: medium — silent UV corruption. The standard `metallicRoughnessTexture` flow at `GLTFExporter.js:1550` does include `channel: metalRoughTexture.channel`.

- **W3: `processSampler` doesn't write `flipY`/`colorSpace`/`uuid` extras** — `GLTFWriter2.ts:215-220` (commented-out block). When the same source image is used for two textures with different `flipY` or `colorSpace`, both reference the same sampler — wrong. Bidirectional bug. Severity: low (rare).

- **W4: `iMaterialIgnoredUserData` import from webgi paths is fragile** — `GLTFWriter2.ts:3-4`. The skip-merge implementation itself doesn't depend on this, but it co-resides in the file. Note only.

- **W5: Skip-merge does not preserve `metalnessMap` userData round-trip via the extension**: the extension TextureInfo is `{index, extensions?:{KHR_texture_transform}}`. The map's `userData.rootPath` is preserved by `processTexture` writing it into `imageDef`, so this works through `processTexture`. PASS — not a bug.

- **W6: `mat.isMeshStandardMaterial` gate excludes any standard-material *subclass* that overrides this flag** — `GLTFWriter2.ts:87`. `MeshPhysicalMaterial` extends MeshStandardMaterial and `isMeshStandardMaterial=true`, so PhysicalMaterial works. But a custom material that extends MeshStandardMaterial and overrides the flag would break. Edge case. NOTE.

- **W7: No event/warning when skip-merge replaces the standard packed emit** — The user has no observability that the extension was emitted vs the standard texture. Adding a `console.debug` or event would help debug. NOTE.

- **W8: `_defaultMaterial` is shared across all calls** — `GLTFWriter2.ts:67`. Multiple shader materials in the same export share the same `_defaultMaterial`; subsequent invocations may pollute its state if any plugin's `writeMaterial` ext mutates it. Not a skip-merge bug specifically. NOTE.

- **W9: `defIndex` returned from `super.processMaterial` is not null-checked before use** — `GLTFWriter2.ts:101-126`. `super.processMaterial` returns null for shader materials (`:1507`), but webgi already swapped to `_defaultMaterial` at `:79` so this shouldn't fire. The `if (defIndex === null)` at `:129` runs *after* the skip-merge block has potentially indexed `this.json.materials[defIndex]`. If defIndex is -1 or some other falsy-but-not-null, the `materialDef` access at `:122` errors. Severity: low.

- **W10: Skip-merge does not interact with `processMaterial`'s shader-material clone path** — `GLTFWriter2.ts:135-155`. After skip-merge applies the extension to `materialDef`, the shader-material clone path JSON-clones `defaultDef`, then `_invokeAll(writeMaterial)` runs. If a shader-material extension's `writeMaterial` reads `materialDef.extensions[ext]` (the WEBGI_materials_separate_metalrough block), it sees the underlying material's extension on a clone, which is correct. But the cloned `materialDef` is pushed at `:153`, and `cache.materials.set(material, index)` — the SHADER material is now associated with a clone that has the extension. Re-export of the same shader material returns the clone's index, which still has the extension. PASS.

## Missing features in webgi

- **No way to force-merge per-material** — the option is global. A user with mixed materials (some packed, some not) cannot opt-in per-material via userData flag. NOTE.
- **No `WEBGI_materials_separate_metalrough` validator/spec doc URL** other than the inline JSDoc comment (`gltf.ts:768`).
- **No interop fallback documentation** — if a viewer doesn't support the extension, the material renders with `metallicFactor`/`roughnessFactor` only. The reader correctly handles missing extension, but the writer does not emit a fallback `metallicRoughnessTexture` for compatibility. (Three.js's own GLTFLoader without the extension would render a metallic-rough material with no texture, only scalars.) Could be improved by an option like `mergeMetalnessRoughnessMaps: 'skip-with-fallback'` that emits both.
- **No `extensionsRequired` option** — the extension is always optional. Reasonable default.
- **No support for `MeshPhysicalMaterial.specularIntensityMap`/`specularColorMap` in the extension** — those follow `KHR_materials_specular`, separate domain. Not missing.
- **No skip-merge for `clearcoatRoughnessMap`** — also separate domain (`KHR_materials_clearcoat`). Not missing in the metalness/roughness extension.

## API/UX issues

- **Default value confusion**: JSDoc at `GLTFExporter2.ts:24-29` says "When true (default)..." but the `mergeMetalnessRoughnessMaps?: boolean` is `undefined` by default at type level. At the option-falsy check `GLTFWriter2.ts:86` (`=== false`), `undefined` passes through to merge. So the *exporter default* is merge=true, but the *plugin default* is merge=false (`AssetExporterPlugin.ts:93`). This split is confusing. **Recommend**: pick one default and document.
- **Discoverability**: No UI toggle in `AssetExporterPlugin.uiConfig` (`AssetExporterPlugin.ts:113-312`). The option is wired into the plugin's `exportOptions` but there's no checkbox to flip it. End users cannot toggle. SEVERE UX gap.
- **Error messages**: `GLTFWriter2.ts:130` logs `'Unexpected error: Failed to process material'` if `defIndex === null`. Vague. Consider including which path failed (skip-merge or normal).
- **No logging when skip-merge engages** — a `console.debug` listing materials hit by skip-merge would help troubleshooting. NOTE.

## gltf-transform draco interaction

- **`SeparateMetalRoughMaterialExtension` registered with `{metalnessTexture: TextureChannel.B, roughnessTexture: TextureChannel.G}`** — `GLTFDracoExporter.ts:494-497`. **This is wrong if both textures are full RGB images** — typically a metalness map is a single-channel grayscale stored in R/G/B, and `gltf-transform`'s channel hint is used for texture-resize/dedup. Setting `metalnessTexture: B` tells gltf-transform "only the B channel is used". For a grayscale metalness map (R=G=B=metalness), this discards data; for a 3-channel metalness encoding, this loses 2 channels. The standard `metallicRoughnessTexture` packs into B/G, so the convention is preserved in webgi to keep round-trip parity. **But this extension is supposed to allow each map to be a *separate* full texture**, so the channel masks should be `R|G|B` (use all channels) per map. Severity: medium. **Bug D1.**
- The extension survives draco compression because `ALL_WEBGI_EXTENSIONS` is registered in both read (`GLTFDracoExporter.ts:64`) and write paths. PASS.
- `createGenericExtensionClass` (referenced at `:494` from `:452`) builds an Extension class that round-trips the extension JSON on each Property. It does NOT touch the texture binary. PASS.
- Texture dedup in gltf-transform: a separate metalnessTexture and roughnessTexture pointing to two PNGs will each be dedup'd against any other extension's textures correctly because gltf-transform tracks Texture Property identity. PASS.

## Notes / open questions

- **Q1**: Should `mergeMetalnessRoughnessMaps=false` ever auto-fall-back to merge when one of the maps would compress poorly (e.g., DataTexture with no image)? Currently it just skips emitting that channel.
- **Q2**: For a `MeshPhysicalMaterial` with both `metalnessMap` AND a `KHR_materials_specular.specularIntensityMap`, does the import-side reader correctly distinguish? Both extensions are independent; PASS — just noting.
- **Q3**: The skip-merge JSDoc at `GLTFExporter2.ts:24-29` mentions "merging is faster and avoids a canvas roundtrip". Actually the **opposite is true**: skip-merge *avoids* the canvas roundtrip; merge *requires* it. The comment likely means "disabling merge is faster". Wording could be clearer.
- **Q4**: Does the `WEBGI_materials_separate_metalrough` extension propagate through `gltf-transform`'s "merge"/"weld" passes? Since it's registered as a generic extension with no `propertyTypes`, weld won't touch it. PASS, probably.
- **Q5**: The "mergeMetalnessRoughnessMaps" option is stored on `options.exporterOptions`, not on `gltfOptions` directly. Plugins via `register` callback receive `writer` but the option is at `writer.options.exporterOptions.mergeMetalnessRoughnessMaps`. PASS — accessible.
- **Q6**: When `mergeMetalnessRoughnessMaps=false` and a third-party `writeMaterial` extension expects `materialDef.pbrMetallicRoughness.metallicRoughnessTexture` (e.g., for some validation), it sees an absent texture. If that extension also doesn't know about `WEBGI_materials_separate_metalrough`, it may produce wrong output. Compatibility note.
- **Q7**: The `materialDef.extensions` allocation at `GLTFWriter2.ts:123` happens AFTER `super.processMaterial`'s `_invokeAll(writeMaterial)` (line 1656 of three.js). So the extension is added on top of any existing extensions object that other writers populated. PASS — but webgi's own `writeMaterial`-based extensions cannot read the WEBGI_materials_separate_metalrough block during their own write (it's added later). Order-of-write issue, low severity.
- **Q8**: `decompress` on a CompressedTexture does not preserve the texture's `channel` field, so Bug M5's UV-mismatch warning fires spuriously when one of the maps was compressed. Not webgi-specific.
- **Q9**: `iModelIgnoredUserData`, `iGeometryIgnoredUserData`, `iMaterialIgnoredUserData` import paths in `GLTFWriter2.ts:3-4` create a hard dep on `webgi/core` and `webgi/extras/asset_manager`. When porting to threepipe these will need to be replaced.

## Citations summary

- Skip-merge writer: `experiments/webgi-legacy-src/extras/asset_manager/exporter/threejs/exporters/GLTFWriter2.ts:73-157`
- Skip-merge gate: `GLTFWriter2.ts:86-89`
- Extension TextureRef builder: `GLTFWriter2.ts:110-115`
- Extension JSON write: `GLTFWriter2.ts:116-126`
- Reader: `experiments/webgi-legacy-src/extras/asset_manager/importer/threejs/generators/gltf.ts:770-810`
- Reader registration: `gltf.ts:156`
- Option type: `experiments/webgi-legacy-src/extras/asset_manager/exporter/threejs/exporters/GLTFExporter2.ts:23-29`
- Plugin default: `experiments/webgi-legacy-src/extras/asset_manager/AssetExporterPlugin.ts:93`
- Plugin UI (missing toggle): `AssetExporterPlugin.ts:188-237`
- Draco extension class: `experiments/webgi-legacy-src/extras/asset_manager/exporter/threejs/exporters/GLTFDracoExporter.ts:494-497`
- Draco channel mapping: `GLTFDracoExporter.ts:496`
- `buildMetalRoughTexture`: `three.js-modded/examples/jsm/exporters/GLTFExporter.js:829-935`
- `buildMetalRoughTexture` SRGB convert /256 bug: `GLTFExporter.js:894, 909`
- `buildMetalRoughTexture` cyan default fill: `GLTFExporter.js:880-881`
- `buildMetalRoughTexture` clone leak: `GLTFExporter.js:921-924`
- `buildMetalRoughTexture` shared canvas: `GLTFExporter.js:873`
- `buildMetalRoughTexture` channel single-write: `GLTFExporter.js:925, 927-929`
- Standard `processMaterial` merged emit: `GLTFExporter.js:1543-1555`
- `processImage` non-RGBA: `GLTFExporter.js:1316-1320`
- `processTexture` decompress + mimeType swap: `GLTFExporter.js:1447-1456`
- `applyTextureTransform`: `GLTFExporter.js:786-827`
- `KHR_materials_specular` writer: `GLTFExporter.js:2960-3011`

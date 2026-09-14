# Webgi-side issues to file (from threepipe ↔ webgi audit, 2026-05-05)

These were found while auditing the metalness/roughness exporter and the broader webgi codebase before syncing changes into threepipe. File each in webgi's tracker. Severity calls reflect impact on webgi users; tweak as needed.

---

## 1. `WEBGI_materials_separate_metalrough` exporter — missing `texCoord` in TextureRef (skip-merge UV corruption)

**Severity:** High (silent data corruption for materials whose metalness/roughness maps use different UV channels).

**Location:** `src/extras/asset_manager/exporter/threejs/exporters/GLTFWriter2.ts`, `processMaterial` → `buildTexRef` helper (added with the `mergeMetalnessRoughnessMaps=false` work).

**Bug:** `buildTexRef` writes `{index: this.processTexture(map)}` and applies texture transform, but does **not** propagate `texCoord` from `map.channel`. The standard `pbrMetallicRoughness.metallicRoughnessTexture` build path in upstream three.js writes `texCoord` (see `examples/jsm/exporters/GLTFExporter.js` `processMaterial` for the merge path's reference). When metalnessMap and roughnessMap use different UV sets and the user disables merge, the channel info is lost — both maps render against UV0 on import, which silently mis-samples one of them.

**Fix:**

```ts
const buildTexRef = (map: Texture | null) => {
    if (!map || !this.checkEmptyMap(map)) return undefined
    const def: any = {index: this.processTexture(map), texCoord: map.channel}
    this.applyTextureTransform(def, map)
    return def
}
```

(Match standard glTF TextureInfo shape — `texCoord` defaults to 0 if absent, but emit explicitly when non-zero for clarity.)

---

## 2. `mergeMetalnessRoughnessMaps` option not exposed in UI

**Severity:** UX gap (option is wired but undiscoverable).

**Location:** `src/extras/asset_manager/AssetExporterPlugin.ts:188-237` (`uiConfig`).

**Bug:** `ExportAssetOptions` includes `mergeMetalnessRoughnessMaps` (defaults to `false` per the plugin), but the uiConfig has no checkbox for it. Users who want to enable merging (e.g., for cross-viewer compatibility) have no UI path.

**Fix:** Add a checkbox alongside the other export-options toggles in the UI. Default value should match `_defaultOptions` so the UI reflects current state.

---

## 3. `mergeMetalnessRoughnessMaps` JSDoc default vs runtime default mismatch

**Severity:** Low (doc only).

**Location:** `src/extras/asset_manager/exporter/threejs/exporters/GLTFExporter2.ts` — JSDoc on `mergeMetalnessRoughnessMaps?: boolean` says "default `true`"; `AssetExporterPlugin._defaultOptions` sets it to `false`.

**Fix:** Update JSDoc to match the actual default, or change the runtime default if `true` was intended (decide based on user expectation — `false` matches the bug-fix motivation, `true` matches glTF-spec-portability).

---

## 4. gltf-transform draco extension — wrong channel masks for separate-metalrough

**Severity:** Medium (Draco compression of files using the extension may corrupt one or both maps).

**Location:** `src/extras/asset_manager/exporter/threejs/exporters/GLTFDracoExporter.ts:493-497`.

**Bug:** Channel masks are `{metalnessTexture: TextureChannel.B, roughnessTexture: TextureChannel.G}`. That convention is for **packed** `metallicRoughnessTexture` where metalness lives in B and roughness in G of the same RGBA texture. In the **separate** case, each is a standalone full RGB(A) texture, so masks should be `R|G|B` (or whatever your `TextureChannel` enum uses for "all channels").

**Fix:** Change masks so each map is treated as a full-channel texture, not a packed one.

---

## 5. `buildMetalRoughTexture` bugs (inherited from three.js modded — fix via override in `GLTFWriter2`)

**Severity:** High for M6 (the original motivating bug for the whole separate-metalrough work). Others range Low → Medium.

**Location:** `libs/three.js/examples/jsm/exporters/GLTFExporter.js`, function `buildMetalRoughTexture` (~line 829-935).

The user's session notes already documented 7 bugs. Audit verified these and found 2 more:

| ID | Issue | Severity |
|---|---|---|
| **M6** | **`clone()` userData leak** — merged texture inherits `rootPath`, `mimeType`, `gltfUUID` from the reference map. `processTexture` then emits the original source URL as the metallicRoughnessTexture image, **not the merged canvas**. Confirmed root-cause for "saved file's metallicRoughnessTexture is the original roughness JPG URL". | High |
| M9 | Chained null-image failure cascading from M6 (when merged texture has stale image source). | High |
| M10 | Size-mismatch upsample uses `drawImage(img, 0, 0, w, h)` → bilinear interpolation, not pixel-perfect. Quality issue when maps differ in resolution. | Medium |
| M16 | `decompress(map)` retains `rootPath` on the result texture — same family as M6. | Medium |
| M1 | `convert(data[i] / 256) * 256` precision off-by-one — max value 255 maps to 0.996 before convert. Should be `/255 * 255`. | Low |
| M2 | sRGB `convert()` applied to material maps that should be linear (metalness/roughness are linear). | Medium |
| M3 | Cyan-default canvas (background fill) → silent metalness=1.0/roughness=1.0 when **both** maps end up empty. | Medium |
| M5 | Single `texture.channel` written to the merged TextureInfo even when source maps disagree on channel — warning logged but bad data exported. | Medium |
| M7 | Shared `getCanvas()` racy under async `toBlob`. | Low (race) |
| M17 | Same-canvas `drawImage` is undefined behavior when source and dest are the same canvas. | Low |

**Fix path (recommended):** override `buildMetalRoughTexture` in `GLTFWriter2`. Don't `clone()` — construct a fresh `new Texture(canvas)`:

- Copy only: `wrapS`, `wrapT`, `magFilter`, `minFilter`, `anisotropy`, `generateMipmaps`, `channel`
- Set `flipY = false`, `colorSpace = NoColorSpace`
- Texture transform: copy from reference only if both maps agree; warn if they differ (M5)
- Leave `userData` empty, `mipmaps` empty, `format`/`type` as defaults
- Fix `/256` → `/255 * 255` (M1)

This single override kills M6 + M9 + M10 + M16 + M2 + M5 + M17 in one go. M1 and M3 are minor; fix while there.

Keep the three.js fork unmodified (rebase-friendly).

---

## 6. `WEBGI_materials_separate_metalrough` reader — no documented precedence vs standard `metallicRoughnessTexture`

**Severity:** Low (documentation gap; doesn't affect webgi-emitted files since webgi never emits both).

**Location:** `src/extras/asset_manager/importer/threejs/generators/gltf.ts`, `GLTFMaterialsSeparateMetalRoughExtension` reader (~line 760-800).

**Issue:** If a hand-crafted GLB has BOTH the standard `pbrMetallicRoughness.metallicRoughnessTexture` AND `WEBGI_materials_separate_metalrough.{metalnessTexture, roughnessTexture}`, the result depends on which `parser.assignTexture` Promise resolves last. Webgi's exporter doesn't write both, so this is a third-party-file edge case — but worth documenting as "extension wins on async resolution; behavior undefined if mixed".

**Fix:** Add an `afterRoot` hook to force-override on live materials after all textures load, OR document the limitation in the extension spec.

---

## 7. Cross-tool foreign GLB legacy-bump misclassification (the one I flagged in chat earlier)

**Severity:** Medium (silent visual incorrectness for any non-webgi GLB with a bump map).

**Location:** `src/extras/asset_manager/importer/threejs/generators/gltf.ts`, hoisted file-level legacy bump fallback (`gltfMaterialExtrasParser.afterRoot`).

**Bug:** Current cascade:

```ts
fileLevelLegacy = vcVersion ? compareVersions(vcVersion, '0.12.0') < 0 : true
```

A Blender-exported GLB (or any non-webgi tool) lacks both `WEBGI_materials_bumpmap` and `WEBGI_viewer.version`. It falls to the `: true` branch and gets the legacy shader applied — but it was authored against the modern (post three.js commit `7b13bb515...`) shader. Bump magnitude renders incorrectly.

The buggy bump-scale was a three.js shader issue; files exported by anything that uses post-fix three.js were authored against the **fixed** shader. Treating them as legacy applies the wrong-shader correction.

**Fix:** Make tier 3b generator-aware. Read `vc.metadata?.generator` alongside `vc.version`, and only apply the `0.12.0` threshold when the generator is `'WebGiViewerApp'`. For other generators (or no `WEBGI_viewer` extension at all), default to `false` (modern):

```ts
let vcVersion: string | undefined
let vcGenerator: string | undefined
for (const sc of jsonScenes) {
    const vc = sc?.extensions?.[viewerGLTFExtension]
    if (vc?.version) { vcVersion = vc.version; vcGenerator = vc.metadata?.generator; break }
}
if (vcGenerator === 'WebGiViewerApp') {
    fileLevelLegacy = vcVersion ? compareVersions(vcVersion, '0.12.0') < 0 : true
}
// foreign / unknown / no extension → fileLevelLegacy stays false
```

Users who hit a real legacy file from a foreign tool can flip the per-material `legacyBumpScale` UI checkbox.

---

## 8. (Optional) Other webgi bugs surfaced by audit — file as separate issues if useful

These aren't metalrough-related but came up in the same sweep. Each is in its own file:line. Cite the audit summary at `working_stream/AUDIT-SUMMARY.md` (sections C and the per-area reports under `working_stream/audit/`) for full context.

Quick list (severity in parens):

- `PickingPlugin` lines 184, 188-210 — anonymous-arrow listeners on `'select'` + `'addSceneObject'` never removed (file has `// todo: remove these event listeners`). (High — leak per onAdded/onRemove cycle.)
- `ObjectPicker` — no `dispose()`; binds 7 anonymous arrow listeners to canvas. (High — leak.)
- `ParallaxCameraControllerPlugin` — leaks `pointerdown`/`pointerup` listeners on every `onAdded`. (Medium.)
- `GLTFAnimationPlugin.onRemove` — `addEventListener` instead of `removeEventListener` on `loaderCreate` (typo). (Medium.)
- `CameraViewPlugin.setCurrentCameraView` — lacks `setDirty()`. (Low — visual update lag.)
- `MaterialLibraryBasePlugin._refreshUi` — dead-code-gated, returns `false` unconditionally; entire library grid never builds. (High — broken feature.)
- `VariationConfiguratorPlugin` — `getIcon` `&&` should be `||`; JSON-load not implemented; URL-add duplicate guard missing `return`. (High — broken paths.)
- `MaterialConfiguratorBasePlugin.ts:313` — operator-precedence bug, `variationKey ?? material.name.length > 0 ? ...` lacks parens, `variationKey` discarded. (Medium — wrong key picked.)
- `RGBEPNGLoader.ts:47` — uses `Uint32Array` instead of `Float32Array` for `FloatType` decode. (High — corrupts float HDR decode.)
- `gltf.ts:465-470` — passes `parseAsync(url, undefined, true)` unconditionally; mis-parses RGBE `encodingVersion=3`. (Medium.)
- `DRACOLoader2` factory — no `onModuleLoaded`; no `decoderModulePending` cache; decoder path-prefix-only matches `WebGiGLBWrapper`. (Medium — stalls on non-webgi-prefixed files.)
- `_isRootFileExtension` ignores mime. (Low.)
- `AssetExporterPlugin` "Encrypt Password" UI typed `checkbox` instead of `password`. (Low — UX.)
- `MaterialManager._refreshTextureRefs` runs on every dispose — O(N*M). (Medium — perf for large scenes.)
- `'adding'` state event lingers in process map until `processFileEnd`. (Low.)
- `MaterialManager.generateFromTemplate` clone closure captures original `mat` not current state. (Medium.)
- `MaterialExtender.UnregisterExtensions` is a TODO no-op. (Low — leak risk.)
- `ParallaxMappingPlugin` substitutes from `_defines` that doesn't have the keys. (Medium — feature broken in some paths.)
- `NormalBufferPlugin` and `VelocityBufferPlugin` call `disposeTarget(target?.dispose?.())` — passes `void`. (Low.)
- `AutoUVMappingPlugin` reads from nested userData bucket but writes to flat. (Medium.)
- `LayeredMaterialPlugin` defines `stepSize` uniform unused in shader. (Low.)
- `BloomPlugin` never overrides `onRemove` — gbuffer updater + material extension leak. (Medium.)
- `SSAOPlugin.onRemove` has unregister call commented out. (Medium.)
- `SSGIPlugin` permanently turns off SSAO on enable, never re-enables. (Medium.)
- `SwitchNodeBasePlugin._preRender`/`_postRender` `return` → `continue` snapIcons fix (was already noted; verify all three sites at lines 55, 70, 72 are fixed).

These should be filed as smaller issues (or one omnibus) at your discretion.

---

## 9. Post-process pipeline order — Chromatic + Vignette on wrong side of Tonemap; Chromatic also overwrites prior work (added 2026-05-09)

**Severity:** High (visible rendering bug — enabling chromatic aberration silently disables LUT and tonemap; vignette darkening curve is mathematically wrong relative to artist expectation).

**Where it comes from:** `extras/viewer/CoreEditorApp.ts:174` registration order:
```ts
plugins: [TonemapPlugin, OutlinePlugin, LUTPlugin, ChromaticAberrationPlugin,
          FilmicGrainPlugin, VignettePlugin, SSRPlugin, ...]
```

Webgi's `MaterialExtender.ApplyMaterialExtensions` (`extras/asset_manager/threejs/MaterialExtender.ts:49-53`) iterates in **registration order** with no priority sort. Each `shaderExtender` prepends a snippet at `#glMarker`. First-applied snippet ends up at the **top** of the fragment shader (= runs first).

That gives the shader, top-to-bottom (= execution order):

```glsl
gl_FragColor = ToneMapping(gl_FragColor);          // 1st applied → runs 1st
gl_FragColor = colorLookUp(gl_FragColor);          // 2nd
gl_FragColor = chromaticAberration();              // 3rd — RE-SAMPLES tDiffuse, overwrites!
gl_FragColor = grain(gl_FragColor);                // 4th
gl_FragColor = Vignette(gl_FragColor);             // 5th → runs last
#glMarker
```

So actual execution: **Tonemap → LUT → ChromaticAberration (overwrite) → Grain → Vignette**.

**Why this is broken:**

Compared to industry-standard order (verified from Unity URP UberPost.shader lines 185-298, Unity PPv2 RenderBuiltins, Unreal post-process material blendable locations):

```
LensDistortion(UV) → ChromaticAberration → Bloom → Vignette → ColorGrading(Tonemap+LUT) → Grain → Dither
```

ChromaticAberration and Vignette are physically **lens artifacts** — they happen before light reaches the sensor → linear HDR space → **pre-tonemap**. Putting them post-tonemap means:
- Vignette darkening curve gets multiplied by tonemap-mapped values → falloff doesn't match real lens behavior
- Chromatic fringe colour shifts because tonemap saturation crush has already been applied

Worse: `chromaticAberration()` (`plugins/shaders/chromaticAberration.glsl`) doesn't consume `gl_FragColor` at all:

```glsl
vec4 chromaticAberration() {
    vec4 color = tDiffuseTexelToLinear(texture2D(tDiffuse, vUv));
    vec4 outColor = vec4(
        tDiffuseTexelToLinear(texture2D(tDiffuse, vUv + aberrated)).r,
        color.g,
        tDiffuseTexelToLinear(texture2D(tDiffuse, vUv - aberrated)).b,
        color.a
    );
    return outColor;
}
```

It re-samples `tDiffuse` directly. When the registered order has Chromatic *after* Tonemap+LUT, `gl_FragColor = chromaticAberration()` discards the tonemapped LUT-graded result and starts fresh from raw linear values. Subsequent grain/vignette then operate on linear HDR, no tonemap is ever re-applied. **Enabling chromatic aberration silently disables LUT and tonemap.**

**Reproduction:**

1. Load any HDR scene with a visible `.cube` LUT enabled (cinematic warm tint)
2. Render → output is tonemapped + graded as expected
3. Enable ChromaticAberrationPlugin with intensity > 0
4. LUT grade is gone, exposure looks blown out — no tonemap is being applied

**Industry-correct order for webgi's screen-pass extensions:**

```
ChromaticAberration → Vignette → Tonemap → LUT → FilmicGrain
```

**Fix options:**

### Option A — Reorder registration in `CoreEditorApp.ts:174` (cheapest)

```ts
plugins: [ChromaticAberrationPlugin, VignettePlugin, TonemapPlugin, LUTPlugin,
          FilmicGrainPlugin, OutlinePlugin, SSRPlugin, ...]
```

Also fix `chromaticAberration()` to take `vec4 color` as input and use it (sample tDiffuse for offset R/B channels but keep input's G+A), so it stops acting as a "reset" point. Required even with reordering — otherwise chromatic still overwrites whatever vignette produced upstream.

### Option B — Add explicit priority field to `MaterialExtension` (more work, future-proof)

Add `priority` to `MaterialExtension` interface, sort in `ApplyMaterialExtensions`, set per-plugin numbers. Matches threepipe's existing convention; decoupled from registration order so `CoreEditorApp.ts` reorderings don't silently regress the pipeline.

**Threepipe-side note:**

Threepipe (the successor) already has explicit priority numbers and gets Chromatic/Vignette right (pre-tonemap). It has Filmic Grain on the wrong side, which threepipe will fix on its end. Once webgi lands Option A or B, both projects converge on industry-standard order.

**Sources:**

- Unity URP UberPost.shader (master, `Packages/com.unity.render-pipelines.universal/Shaders/PostProcessing/UberPost.shader:185-298`): `LensDistortion → ChromaticAberration → Bloom → Vignette → ColorGrading(Tonemap+LUT) → Grain → Dither`
- Unity PPv2 RenderBuiltins (`Unity-Technologies/PostProcessing@v2/Runtime/PostProcessLayer.cs`): `DOF → MotionBlur → AutoExposure → LensDistortion → ChromaticAberration → Bloom → Vignette → Grain → ColorGrading`
- Rendering Evolution (https://www.renderingevolution.net/?p=103): "DOF and Motion-Blur should be done in HDR, not LDR, so pre ToneMapping. Bloom simulates light bleeding, so DOF and MB should also be done pre Bloom."
- Unreal Engine post-process material blendable locations: Chromatic + Vignette baked into tonemapper input, not output.

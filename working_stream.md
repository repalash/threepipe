# Working Stream — Webgi 0.21.x Sync to threepipe

Tracking the port of webgi 0.20.0/0.21.x changes (legacy bump scale fix, round-trip 0-with-map guards, separate metal/rough exporter, OutlinePlugin cleanup) into core threepipe and `experiments/threepipe-webgi/`.

Source comparison: `experiments/webgi-legacy-src/` (webgi reference) vs threepipe `src/` and `experiments/threepipe-webgi/src/`.

## ★ Where to pick up (last updated 2026-05-09)

**Phase 1 + LUT side-track DONE.** All LUT regressions traced and fixed (gbuffer float-precision, priority order, slot routing, drag-drop). Interactive test in `tests/interactive.spec.ts` `lut-plugin` covers the regressions; webgi-reference render parity in `tests/lut-render-comparison.spec.ts` (diffRatio 0.40, was 1.00).

**Tweakpane plugin loop closed.** `tweakpane-image-plugin` v1.1.405 pushed upstream (`pkg.threepipe.org` confirmed serving it, github tag exists). `plugins/tweakpane/package.json` pinned to v1.1.405. The hand-edit-in-node_modules bug is contained.

**Open work (in order of size):**

1. **FilmicGrain priority fix** — quickest. `src/plugins/postprocessing/FilmicGrainPlugin.ts:41` `priority = -50` → `-200` so grain runs after LUT. **Audit complete:** Chromatic / Vignette stay where they are (already industry-correct). Only FilmicGrain is on the wrong side of tonemap. Filed `issues/open/post-extension-priority-tonemap-order.md` with full analysis.
2. **Phase 2 — separate metal/rough exporter** (items 5-7). Biggest remaining webgi-sync chunk. Audit pre-fixes documented in `working_stream/audit/11-webgi-metalrough-deep-dive.md` (W2 texCoord, M6 clone leak, D1 channel masks, missing UI toggle).
3. ~~**OutlinePlugin listener cleanup** (item 8)~~ — done.
4. ~~**Changelog entries** (item 9)~~ — done. `package.json` version bumps deferred to release time.
5. **Filed image-input issues** (`issues/open/image-input-color-space-list-incomplete.md` High, `image-input-mime-type-hardcoded.md` High) — separate session, not part of webgi sync.

**Webgi-side issue ready to file:** "Post-process pipeline order: Chromatic + Vignette + Grain on wrong side of Tonemap" — see `working_stream/webgi-issues-to-file.md` (added 2026-05-09). Includes industry-source citations from URP UberPost shader, PPv2, Unreal post-process material blendable locations.

## Phase 1 — Legacy bump scale + round-trip 0-with-map fixes

### 1. Round-trip 0-with-map guard in displacement & lightmap exporters

**Files:**
- `src/assetmanager/gltf/GLTFMaterialsDisplacementMapExtension.ts:84`
- `src/assetmanager/gltf/GLTFMaterialsLightMapExtension.ts:90`

**Change:** `scale === 0` → `scale === 0 && !map`. Currently if a user sets `displacementScale=0` or `lightMapIntensity=0` while still having a map assigned, the exporter skips writing the extension and the map is lost on re-import.

**Webgi reference:** `experiments/webgi-legacy-src/extras/asset_manager/exporter/threejs/exporters/gltf.ts:373` (displacement), `:419` (lightmap), `:327` (bump — also relevant in #2).

### 2. Re-enable bump exporter with `normalizedScale` field

**Files:**
- `src/assetmanager/gltf/GLTFMaterialsBumpMapExtension.ts:80-119` — update `writeMaterial`
- `src/assetmanager/export/GLTFExporter2.ts:194` — un-comment `GLTFMaterialsBumpMapExtension.Export`

**Change:** Update `writeMaterial` to:
- Skip-guard: `bumpScale === 0 && !bumpMap` (matches webgi pattern)
- Always write `extensionDef.normalizedScale = !material.userData?.legacyBumpScale`
- Keep writing `bumpScale` and `bumpTexture`

Even though threepipe's primary bump-export path is three.js's `EXT_materials_bump` (no `normalizedScale` field), per user direction we sync the webgi exporter shape so cross-tool readers (webgi, future threepipe versions) can rely on `normalizedScale` regardless of asset version.

**Webgi reference:** `experiments/webgi-legacy-src/extras/asset_manager/exporter/threejs/exporters/gltf.ts:325-352`.

### 3. 3-tier legacy bump priority + `normalizedScale` read on import

**File:** `src/assetmanager/gltf/GLTFMaterialExtrasExtension.ts:133-141`

**Change:** Replace the two-signal check with a three-tier priority:
1. `bumpExt.normalizedScale !== undefined` → `isLegacy = !normalizedScale`, `explicitNotLegacy = normalizedScale === true`
2. `o.userData.legacyBumpScale` → `isLegacy = true`
3. fallback `assetVersion <= 2.0` → `isLegacy = true`

When `explicitNotLegacy` and the legacy block doesn't fire, **clear** any stale `userData.legacyBumpScale` and `defines.BUMP_MAP_SCALE_LEGACY` so a leaked extras flag doesn't override a modern shader.

Lookup: `parser.associations.get(o)?.materials → parser.json.materials[idx].extensions[GLTFMaterialsBumpMapExtension.WebGiMaterialsBumpMapExtension]`.

**Webgi reference:** `experiments/webgi-legacy-src/extras/asset_manager/importer/threejs/generators/gltf.ts:332-361`.

### 4. `legacyBumpScale` getter/setter + UI checkbox on `PhysicalMaterial`

**File:** `src/core/material/PhysicalMaterial.ts` (and any `MeshStandardMaterial2` if separate)

**Change:**
- Getter: `!!this.userData.legacyBumpScale`
- Setter: writes `userData.legacyBumpScale` + `defines.BUMP_MAP_SCALE_LEGACY` together, calls `this.needsUpdate = true; this.setDirty()`
- UI: add `{type: 'checkbox', label: 'Legacy Bump Scale', property: [this, 'legacyBumpScale'], hidden: ()=>!this.bumpMap}` next to the bump scale slider

**Webgi reference:** `experiments/webgi-legacy-src/extras/asset_manager/threejs/MeshStandardMaterial2.ts:207-222` (getter/setter), `:296-301` (UI).

## Audit results

Full webgi↔threepipe audit complete (10 parallel agents). See:
- [`working_stream/AUDIT-SUMMARY.md`](working_stream/AUDIT-SUMMARY.md) — cross-cut summary by category (bugs in threepipe / threepipe-webgi / sync-back to webgi / missing features / divergences).
- `working_stream/audit/01-...` through `10-...` — per-area detailed reports.

## Phase 2 — Separate metal/rough exporter (new feature)

**Important — do NOT copy webgi verbatim.** The deep-dive audit (`audit/11-webgi-metalrough-deep-dive.md`) found bugs in webgi's implementation and in the inherited three.js merge path. Apply these fixes when porting:

- **W2 fix in `buildTexRef`:** include `texCoord: map.channel` in the per-map TextureRef. webgi forgot it — silent UV corruption when metalnessMap and roughnessMap use different UV channels.
- **M6 minimum (clone userData leak):** override `buildMetalRoughTexture` in threepipe's `GLTFWriter2` to construct a fresh `new Texture(canvas)` instead of `reference.clone()`. Copy only meaningful properties (wrap, filter, anisotropy, channel). Leave `userData` empty, `mipmaps` empty, set `flipY=false`. This kills M6 + M9 + M10 + M16 in one shot. Optional: also fix M1, M2, M3, M5, M17.
- **D1 fix:** the gltf-transform draco channel masks for `WEBGI_materials_separate_metalrough` should be `R|G|B` per map (each is a standalone texture, not channel-packed). webgi has them as `B`/`G` only — wrong for the separate case.
- **UI toggle:** add a checkbox in threepipe's `AssetExporterPlugin.uiConfig` for `mergeMetalnessRoughnessMaps`. webgi forgot this — option is wired but not exposed.

### 5. `mergeMetalnessRoughnessMaps` option + skip-merge null-and-restore

**Files:**
- `src/assetmanager/export/GLTFExporter2.ts` — add `mergeMetalnessRoughnessMaps?: boolean` to options type
- `src/assetmanager/export/GLTFWriter2.ts` — wrap `super.processMaterial` with try/finally; if `skipMerge`, null `metalnessMap`/`roughnessMap` before super, restore in finally, then emit `WEBGI_materials_separate_metalrough` extension via `processTexture` + `applyTextureTransform`

**Webgi reference:** `experiments/webgi-legacy-src/extras/asset_manager/exporter/threejs/exporters/GLTFWriter2.ts:81-127`.

### 6. `WEBGI_materials_separate_metalrough` import + name constant

**Files:**
- `src/assetmanager/gltf/` — new file, e.g. `GLTFMaterialsSeparateMetalRoughExtension.ts` with reader class (calls `parser.assignTexture` for `metalnessMap`/`roughnessMap`)
- `src/assetmanager/import/GLTFLoader2.ts` — register the import plugin
- Constant `WEBGI_materials_separate_metalrough` exported alongside other extension names

**Webgi reference:** `experiments/webgi-legacy-src/extras/asset_manager/importer/threejs/generators/gltf.ts:761-799` (reader), `ext-names.ts` (constant).

### 7. gltf-transform draco registration

**File:** `plugins/gltf-transform/src/GLTFDracoExportPlugin.ts`

**Change:** Add `SeparateMetalRoughMaterialExtension` via `createGenericExtensionClass` with `{metalnessTexture: TextureChannel.B, roughnessTexture: TextureChannel.G}` and add to `ALL_WEBGI_EXTENSIONS`.

**Webgi reference:** `experiments/webgi-legacy-src/extras/asset_manager/exporter/threejs/exporters/GLTFDracoExporter.ts:493-497`.

## Phase 3 — `experiments/threepipe-webgi/` plugin sync

### 8. OutlinePlugin listener cleanup

**File:** `experiments/threepipe-webgi/src/plugins/postprocessing/OutlinePlugin.ts`

**Change:** Lift the inline `selectedObjectChanged` and `mousemove` listeners into named arrow class fields (`_onSelectedObjectChanged`, `_onMouseMove`); also lift `preRender` into `_onPreRender`. In `onAdded`, store `pickingPlugin` to `this._pickingPlugin` for `onRemove` use. In `onRemove`, remove all three listeners and unregister the pass.

**Webgi reference:** `experiments/webgi-legacy-src/plugins/threejs/OutlinePlugin.ts:151-300`.

## Phase 4 — Versions, changelog

### 9. Version bumps + changelog entries

- threepipe `package.json` — bump version, update `CHANGELOG.md`
- `experiments/threepipe-webgi/package.json` — bump if OutlinePlugin changed

## Skipped / N/A

- **MaterialManager `\|\| userData.legacyBumpScale` fallback** — already in `src/core/material/iMaterialCommons.ts:67-68`.
- **`iMaterialIgnoredUserData` exclusions** — threepipe's `copyMaterialUserData` (`src/utils/serialization.ts:547`) only ignores `'uuid'` by default; `legacyBumpScale` already persists naturally.
- **Webgi-internal docs** — `issues/0.20.0-audit.md`, `issues/gltf-metalrough-exporter-session.md`, version/changelog churn.

## Status

- [x] 1. Round-trip 0-with-map guards (disp + lightmap)
- [x] 2. Sync bump exporter shape with webgi (kept disabled in `GLTFExporter2.ts:194`)
- [x] 3. Full legacy bump cascade on import (normalizedScale → userData → subversion → vcVersion+generator), `compareVersions` helper, TODO mirrored in `GLTFWriter2.ts:15`
- [x] 4. Legacy Bump Scale UI checkbox in `IMaterialUi.bumpNormal` (no class getter/setter — inline `getValue`/`setValue`)
- [x] 4a. **LUT slot routing fix** (gbuffer flags float-precision off-by-one — `* 255. + 0.5`)
- [x] 4b. **`enableOnAll` / `disableOnAll` `@uiButton`s** on `LUTPlugin`
- [x] 4c. **Generic `textureMap` registration** in `tpImageInputGenerator.proxyGetValue` (LUT inter-slot drag-drop prerequisite)
- [x] 4d. **`lut-plugin` interactive test** + slimmed `lut-render-comparison.spec.ts`
- [ ] 5. `mergeMetalnessRoughnessMaps` option + skip-merge
- [ ] 6. `WEBGI_materials_separate_metalrough` import + name
- [ ] 7. gltf-transform draco registration
- [x] 8. OutlinePlugin listener cleanup — done in `experiments/threepipe-webgi/src/plugins/postprocessing/OutlinePlugin.ts`. `selectedObjectChanged` on PickingPlugin uses `viewer.forPlugin(PickingPlugin, mount, unmount, this)` (the existing threepipe convention, matches `SwitchNodeBasePlugin.ts:43-49`) — auto-binds/auto-unbinds on either plugin's lifecycle. `document.mousemove` is a DOM listener so still manual: bound to `_onMouseMove` named field with `{passive: true}` in `onAdded`, removed in `onRemove`. `_pickingPlugin` cached for symmetric removal; `onRemove` clears `_animationCallBack`. `preRender` already used auto-cleaning `_viewerListeners`. CHANGELOG updated under `[Unreleased]`.
- [x] 9. Changelog entries added under the existing pre-release sections in `CHANGELOG.md` (`[0.6.0-dev]`), `plugins/tweakpane/CHANGELOG.md` (`[Unreleased]`), and `experiments/threepipe-webgi/CHANGELOG.md` (`[Unreleased]`). **`package.json` versions NOT bumped** — release-time action; up to the maintainer to flip `[X.Y.0-dev]` → `[X.Y.0] - DATE` and bump version in the same commit.

## Side issues found while debugging — done

- [x] **Inter-slot drag-drop preserves original Texture** — confirmed working via `tests/interactive.spec.ts` `tweakpane-editor` (regression-net for the `staticData.textureMap` recovery path). Traced end-to-end via dist-rebuild + `proxySetValue` instrumentation.
- [x] **Drop `.cube` on populated LUT slot was a silent no-op** — root cause: identity-check shortcut in `proxySetValue` had a missing `&& v.src != null` guard on the `cc.image?.src === v.src` branch → for non-image File drops on a wrapper-holding slot, `undefined === undefined` produced a false-positive "same value" hit. **Fix:** `plugins/tweakpane/src/tpImageInputGenerator.ts:201-209` — added the matching null guard. Kept the surgical fix (rather than skipping the whole identity check for File drops) since it's symmetric with the existing tp_src branches.
- [x] **`textureMap` registration for inter-slot drag-drop recovery** is load-bearing — confirmed via regression test (disabling line 375 makes `tweakpane-editor` test fail).
- [x] **LUTPlugin priority** changed from `-50` to `-150` so LUT executes AFTER tonemap (matching webgi). Background now correctly receives the LUT; render-comparison `diffRatio` dropped 0.974 → 0.396, mean channel diff 36 → 21 against the reference webgi snapshot.
- [x] **GBuffer flags float-precision off-by-one** — `src/plugins/pipeline/shaders/GBufferPlugin.unpack.glsl:46` was `ivec4(texture2D(tGBufferFlags, uv) * 255.)`. Float32 round-trip lands `n=249` at `248.999…` → `ivec4` truncated to 248 → `slotIndex = 248 % 8 = 0`, breaking per-mesh LUT dispatch (orange ring rendered green via LUT 0 instead of peach via LUT 1). **Fix:** `* 255. + 0.5` (round before truncate). Matches webgi's "LUT fix 2" patch verbatim. After fix: render-comparison `diffRatio` 1.0000 → 0.4027, orange ring routes correctly to LUT 1.
- [x] **`enableOnAll` / `disableOnAll` `@uiButton`s** ported from webgi's "LUT fix 2" — `src/plugins/postprocessing/LUTPlugin.ts:84-105`. Iterates `viewer.assetManager.materials.getAllMaterials()` and toggles per-material `userData['LUTPlugin1'].enable`.
- [x] **Generic `textureMap` registration in `proxyGetValue`** — `plugins/tweakpane/src/tpImageInputGenerator.ts` end of `proxyGetValue`. Without it, the `setterTex`-side registration only fires for `Texture`s, missing LUT wrappers (and any non-Texture wrapper) → drag-drop between LUT slots falls through to `new Texture(panelImg)` and gets rejected by the `.cube` guard. Mirrors webgi's port.
- [x] **`lut-plugin` interactive test** added at `tests/interactive.spec.ts` (after `screen-pass-extension-plugin` block). Covers slot routing sanity, `lutBackground` toggle, both buttons, inter-slot drag-drop. Catches all the LUT issues hit this session except the webgi-reference comparison (which lives in `lut-render-comparison.spec.ts`). Smoke entry removed from `tests/extras.spec.ts`.
- [x] **`lut-render-comparison.spec.ts` slimmed** from 839 → 154 lines — removed all diagnostic experiments (forceSlot0/1, allRedExp, gbufferProbe, voxel sampling, identity dumps). Kept: navigation, plugin-state sanity, snapshot capture, pixel diff vs webgi reference. Runtime 2.2 min → 33 s, same `diffRatio: 0.4027`.

## Side issues — still open

- [ ] **`FilmicGrainPlugin` priority** — only FilmicGrain needs to move (audit narrowed it). `priority = -50` should become `-200` so grain runs after LUT (sensor noise is conceptually post-display-encoding; matches Unity URP UberPost shader order, PPv2 RenderBuiltins, Unreal post-process material blendable locations). **Chromatic and Vignette stay** — they're already industry-correct (lens artifacts in linear/pre-tonemap). Webgi has Chromatic + Vignette + Grain all on the wrong side; that's a webgi-side bug filed in [`working_stream/webgi-issues-to-file.md`](working_stream/webgi-issues-to-file.md). Threepipe-side analysis in [`issues/open/post-extension-priority-tonemap-order.md`](issues/open/post-extension-priority-tonemap-order.md).

## REMINDERS — think about while in webgi

- **`AssetImporter` cache duplication for File drops.** Pre-existing (not from this session). When a file is dropped via `setterFile` → `importer.importSingle({file, path})`, the cache merge block at `AssetImporter.ts:240-248` only fires when the asset has exactly one property (`Object.entries(asset).length === 1 && asset.path`). Our asset is `{file, path}` (2 props), so the cached `preImported` is never reused — instead, the existing entry is removed and a fresh one (without `preImported`) is pushed. **Result:** dropping the same file (PNG / .cube / anything) into two slots produces two separate Texture/Wrapper instances and two GPU uploads. Affects threepipe AND webgi (same code structure). Fix options listed in chat: (1) reuse cached `preImported` even when file is present, (2) setterFile-only dedupe by filename, (3) content-hashed path. **Decide while doing webgi work — same fix should land in both.** Not blocking; just inefficient.

- **Identity-check shortcut convention.** The five `||` branches in `proxySetValue:201-207` are dedupe optimisations against re-import on no-op writes. Two patterns coexist: branches with `&& v.tp_src != null` / `&& v.src != null` guard against `undefined === undefined` false-positives, but the `cc.image?.src === v.src` branch was missing it. Now fixed. **Apply the same one-line null guard in webgi's `proxySetValue` if the same code structure is there** — same false-positive, same fix.

- **Same priority misorder probably present in webgi for FilmicGrain/ChromaticAberration/Vignette.** Worth checking when reviewing the LUT priority change in webgi.

## tweakpane-image-plugin upstream fork (forked into experiments/)

Discovered an unpushed local hand-edit of `node_modules/tweakpane-image-plugin/dist/index.js` (mtime 2026-04-20 10:25:31, only `index.js` updated, all sibling dist files unchanged). Traced via the Claude session log (`session 47caed76`, Apr 20) — a previous Claude session edited `node_modules` directly to fix a `.cube` drag-drop crash, never propagated upstream.

**Done in this session:**

- [x] **Cloned `repalash/tweakpane-image-plugin` into `experiments/tweakpane-image-plugin/`.** HEAD is `34d1e4b` (matches genuine v1.1.404 at `pkg.threepipe.org`).
- [x] **Ported the local hand-edit to source** (`experiments/tweakpane-image-plugin/src/controller.ts:130-154`). The `setValue(File)` branch now skips the `loadImage(createObjectURL)` wrap unless `src.type` starts with `image/`, so `.cube` / `.hdr` / `.exr` / `.ktx2` / custom-MIME files pass through the binding intact and reach `proxySetValue` as `v instanceof File === true`.
- [x] **Bumped to `v1.1.405`** (`package.json`).
- [x] **Built `dist/index.js` + `dist/index.min.js`** via `npm run build`. Verified the MIME branch made it into both compiled artifacts.
- [x] **Synced `node_modules/tweakpane-image-plugin/dist/`** in threepipe to the new build (`sha256: e462f56b…`). Rebuilt `plugins/tweakpane/dist/`. Threepipe now runs against the official-built version of the patch instead of the orphan hand-edit.
- [x] **Fixed CI workflow** (`experiments/tweakpane-image-plugin/.github/workflows/create-release.yml`): `npm pack` → `npm pack --silent`. Without `--silent`, the `npm notice` tarball-contents listing got piped into `xargs -I {} mv {}` and broke the rename. Verified locally — stdout is just the tarball filename now.

**Pending — for the user (outside this session's scope):**

- [x] Push the `controller.ts` change + version bump to `repalash/tweakpane-image-plugin` master, tag `v1.1.405`, let the CDN pick it up. (Confirmed 2026-05-06: github tag `v1.1.405` published, `pkg.threepipe.org/dep/tweakpane-image-plugin/-/v1.1.405/package.tgz` returns HTTP 200, MIME branch verified in tarball.)
- [x] Update `plugins/tweakpane/package.json:6` pin from `v1.1.404` → `v1.1.405`. (Done 2026-05-06; `npm install` in `plugins/tweakpane/` pulled the right tarball, `node_modules/tweakpane-image-plugin/package.json` shows `"version": "1.1.405"`.)
- [ ] Update webgi's pin to the same.
- [ ] Apply the same `&& v.src != null` guard in webgi's `proxySetValue` (already covered above).

## Image-input audit — full sweep, results filed in `issues/open/`

Comprehensive audit of `plugins/tweakpane/src/tpImageInputGenerator.ts` plus adjacent code. Each finding has its own issue file:

| File | Severity | Summary |
|---|---|---|
| [`image-input-color-space-list-incomplete.md`](issues/open/image-input-color-space-list-incomplete.md) | High | Hardcoded `isLinear` list misses `transmissionMap`, `clearcoatNormalMap`, `iridescenceMap`, `iridescenceThicknessMap`, `sheenRoughnessMap`, `anisotropyMap`, `specularIntensityMap`, `thicknessMap`, `clearcoatRoughnessMap`. **`emissiveMap` is wrongly listed as linear** (should be sRGB). Causes wrong material rendering on drop. |
| [`image-input-mime-type-hardcoded.md`](issues/open/image-input-mime-type-hardcoded.md) | High | Drop sets MIME to `image/jpeg` or `image/png` only — webp/gif/exr/hdr/avif/ktx2/etc. all wind up as `image/png`. Breaks GLTF round-trip. Two sites (`setterFile`, `proxySetValue`'s wrap branch). |
| [`asset-importer-file-cache-dedupe.md`](issues/open/asset-importer-file-cache-dedupe.md) | Medium | `AssetImporter.ts:240-248` cache merge requires `Object.entries(asset).length === 1`; `{file, path}` (2 props) skips merge → re-import every drop → wasted GPU memory. Affects all file types. Same code in webgi. |
| [`image-input-tempmap-key-mismatch.md`](issues/open/image-input-tempmap-key-mismatch.md) | Low | `delete tempMap[iMapKey]` after `iMapKey` reassignment deletes wrong key → small leak. |
| [`image-input-download-blob-leak.md`](issues/open/image-input-download-blob-leak.md) | Low | DataTexture branch of `downloadImage` doesn't set `revokeSrc = true` → blob URL never revoked. |
| [`image-input-tempmap-lut-skip.md`](issues/open/image-input-tempmap-lut-skip.md) | Low | LUT wrappers' `tp_src_uuid` bridge in `proxyGetValue` is skipped (no `cc.image` on wrappers). Asymmetric but works today. |
| [`image-input-misc-cleanup.md`](issues/open/image-input-misc-cleanup.md) | Low | 5 small items: `cc.image` null-deref on CompressedTexture, dead `instanceof HTMLVideoElement` checks, LUT-only guard misses multi-ext, broad `catch` swallows context, `imageBitmapToBase64` returns `''` for unloaded images. |
| [`tpImageInputGenerator-textureMap-leak.md`](issues/open/tpImageInputGenerator-textureMap-leak.md) | Medium | (Filed earlier this session) Module-level `staticData.textureMap` accumulates without eviction. |

**Recommended fix order if you want to land any:**

1. `image-input-color-space-list-incomplete.md` — visible bug, ~10 lines. Fix `emissiveMap` while there.
2. `image-input-mime-type-hardcoded.md` — round-trip correctness. Add a `src/utils/mime.ts` helper.
3. `asset-importer-file-cache-dedupe.md` — performance; fix in lockstep with webgi.
4. Bundle the three Low-severity items as one cleanup PR.
5. Defer the `textureMap`/`tempMap` leaks until they actually bite.

## Open — current iteration

See top of file ("Where to pick up") for current state and ordered next steps.

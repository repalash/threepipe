# Audit: Postprocessing Plugins

## Summary

The threepipe-webgi port covers 7 postprocessing plugins (Bloom, DepthOfField, Outline, SSContactShadows, SSGI, SSReflection, TemporalAA). Of the 13 webgi postprocessing plugins audited:

- **Ported in `experiments/threepipe-webgi`**: BloomPlugin, DepthOfFieldPlugin, OutlinePlugin, SSContactShadowsPlugin, SSGIPlugin (=SSGI/SSRTAOPlugin), SSReflectionPlugin (=SSRPlugin), TemporalAAPlugin
- **Already in threepipe core**: FrameFadePlugin (`src/plugins/pipeline/FrameFadePlugin.ts`), SSAOPlugin (`src/plugins/pipeline/SSAOPlugin.ts`). webgi versions can be sunset.
- **Missing entirely**: MipMapBlurPlugin, SSBevelPlugin, SSRTAOPlugin (standalone — its functionality lives inside SSGIPlugin), RandomizedDirectionalLightPlugin
- **Threepipe-webgi additions vs webgi**: split-debug mode, separate `bilateralPass` member, deprecated property aliases, `OldPluginType` legacy support, `gbufferUnpackExtensionChanged` reactive plumbing, `fromJSON` legacy migration, velocity-buffer extension hookup via `forPlugin`, generic `inlineShaderRayTrace` flag (replaces `inlineSSR`).

The biggest correctness risks are in the threepipe-webgi `OutlinePlugin` (acknowledged listener leaks plus a deprecated getter bug), `SSGIPlugin._beforeRender` permanently disabling SSAO without re-enabling, and several pass-level details (bloom prefilter init, DoF render skipping `super.render` early-out swap).

## Plugin matrix

| Plugin | webgi | threepipe-webgi | threepipe core | status |
|---|---|---|---|---|
| Bloom | `webgi-legacy-src/plugins/BloomPlugin.ts:1-118` (+ `passes/threejs/BloomPass.ts`) | `experiments/threepipe-webgi/src/plugins/postprocessing/BloomPlugin.ts:47-374` | — | ported; pass merged into plugin file. Some bugs (see below). |
| DepthOfField | `webgi-legacy-src/plugins/DepthOfFieldPlugin.ts:1-172` (+ `passes/threejs/DepthOfFieldPass.ts`) | `experiments/threepipe-webgi/src/plugins/postprocessing/DepthOfFieldPlugin.ts:53-471` | — | ported; material extension dropped (commented out). |
| Outline | `webgi-legacy-src/plugins/threejs/OutlinePlugin.ts:1-302` | `experiments/threepipe-webgi/src/plugins/postprocessing/OutlinePlugin.ts:55-476` | — | ported; listener leaks (already in todo) + deprecated-getter bug. |
| SSContactShadows | `webgi-legacy-src/plugins/SSContactShadows.ts:1-199` | `experiments/threepipe-webgi/src/plugins/postprocessing/SSContactShadowsPlugin.ts:34-326` | — | ported; behavior parity good. |
| SSGI (=SSRTGI) | `webgi-legacy-src/plugins/SSGIPlugin.ts:1-108` (uses `SSRTAOPass`) | `experiments/threepipe-webgi/src/plugins/postprocessing/SSGIPlugin.ts:64-588` | — | ported & enriched (split mode, reprojection uniforms, more UI). SSAO disable side effect not reverted (see bug). |
| SSReflection (was SSRPlugin) | `webgi-legacy-src/plugins/SSRPlugin.ts:1-73` | `experiments/threepipe-webgi/src/plugins/postprocessing/SSReflectionPlugin.ts:64-563` | — | ported; renamed; far richer pass surface. `inlineSSR`→`inlineShaderRayTrace`. |
| TemporalAA | `webgi-legacy-src/plugins/TemporalAAPlugin.ts:1-85` (+ `passes/threejs/TAAPass.ts`) | `experiments/threepipe-webgi/src/plugins/postprocessing/TemporalAAPlugin.ts:41-302` | — | ported; pass folded inline. `applyOnBackground` derived from `msaa` instead of `isAntialiased`. |
| FrameFade | `webgi-legacy-src/plugins/FrameFadePlugin.ts:1-214` | — | `src/plugins/pipeline/FrameFadePlugin.ts:20-235` | already in core (more complete than webgi). |
| SSAO | `webgi-legacy-src/plugins/SSAOPlugin.ts:1-171` | — | `src/plugins/pipeline/SSAOPlugin.ts:117-560` | already in core. |
| MipMapBlur | `webgi-legacy-src/plugins/MipMapBlurPlugin.ts:1-33` (+ `passes/threejs/MipMapBlurPass.ts`) | — | — | **missing**. Trivial wrapper; only the pass is non-trivial. |
| SSBevel | `webgi-legacy-src/plugins/SSBevelPlugin.ts:1-167` | — | — | **missing**. Includes glTF extension `WEBGI_materials_ssbevel` import/export, GBuffer flag updater, NormalBufferPlugin dependency. |
| SSRTAO | `webgi-legacy-src/plugins/SSRTAOPlugin.ts:1-72` | (folded into `SSGIPlugin`) | — | standalone variant **missing**; SSGI exposes `giEnabled=false` mode but no separate plugin. |
| RandomizedDirectionalLight | `webgi-legacy-src/plugins/RandomizedDirectionalLightPlugin.ts:1-180` | — | — | **missing** (lives in `experiments/threepipe-webgi/src/utils/RandomizedDirectionalLight.ts` as the math class only — no plugin wrapper). |

## webgi-only (missing in threepipe-webgi or core)

- **MipMapBlurPlugin** — webgi `MipMapBlurPlugin.ts:6-32`. `MipMapBlurPass` referenced but no port in threepipe-webgi/passes/. Used by reflective ground / blur stacks — file as low priority.
- **SSBevelPlugin** — webgi `SSBevelPlugin.ts`. Notable scope: registers GLTF loader extension `WEBGI_materials_ssbevel` (see lines 44-46, 131-167), gbuffer updater that packs bevel radius into 5 bits of `data.y` (lines 101-117), NormalBufferPlugin dependency. Significant work to port (depends on `SSBevelPass` and the `_ssBevel` material userData schema).
- **SSRTAOPlugin** (standalone) — webgi `SSRTAOPlugin.ts`. The threepipe-webgi `SSGIPlugin` is the merged successor (constructor takes `giEnabled`, see `SSGIPluginPass.ts:283-285,359`). Decide if a thin `SSRTAOPlugin` alias is wanted for backward compat.
- **RandomizedDirectionalLightPlugin** — webgi `RandomizedDirectionalLightPlugin.ts:8-180`. The light class itself appears ported in `experiments/threepipe-webgi/src/utils/RandomizedDirectionalLight.ts`, but the **plugin wrapper** (preRender hook to `randomizePosition`, layer mask gating, CameraHelper, full UI) is absent. Likely required for progressive-shadow examples.

## threepipe-only (new features in the port)

- **`OldPluginType` static field** on every ported plugin (e.g. `BloomPlugin.ts:51`, `OutlinePlugin.ts:58`, `SSReflectionPlugin.ts:69`, `SSGIPlugin.ts:69`, `TemporalAAPlugin.ts:44`, `SSContactShadowsPlugin.ts:36`, `DepthOfFieldPlugin.ts:56`) for serialization migration. Good. But there's a TODO `// todo swap` in many places — they haven't been swapped yet so deserialization compatibility is one-directional.
- **`fromJSON` legacy migration** — `SSGIPlugin.ts:168-177`, `SSReflectionPlugin.ts:185-194` translate legacy `passes.ssrtgi`/`passes.ssr` shapes into the new `pass` field. Only on these two; Bloom/DoF/TAA/Outline/SSContactShadows do not, which may break old saved configs.
- **Reactive `gbufferUnpackExtensionChanged` listener** — Bloom (`:79-85`), DoF (`:127-156`), SSContactShadows (`:306-314`), SSGI (`:128-136`), SSReflection (`:131-139`), TAA (`:73-81`). Cleanly registers/unregisters when GBufferPlugin changes — superior to webgi's one-shot dependency snapshot at constructor time.
- **`split` debug-uniform mode** in SSGI (`:277-279`) and SSReflection (`:275-277`) — splits screen at `ssrSplitX` for A/B preview. Not in webgi.
- **VelocityBufferPlugin auto-attach** via `viewer.forPlugin(VelocityBufferPlugin, ...)` in SSGI (`:155-159`) and SSReflection (`:155-159`). Replaces the webgi pattern of fetching `getPluginByType<VelocityBufferPlugin>` per frame in `_update`.
- **`uiImage` exposed buffer texture** in SSGI/SSReflection/Outline (e.g. `SSGIPlugin.ts:74`, `SSReflectionPlugin.ts:74`, `OutlinePlugin.ts:237`).
- **Per-pass UI through decorators** (`@uiFolderContainer`, `@uiSlider`, `@uiToggle`, `@uniform({propKey})`) replaces the manual `_uiConfig` getters in webgi. Less code but new API surface.
- **`OutlineRenderPass` improvements** (`OutlinePlugin.ts:361-475`) — multi-select expansion through textures/materials/geometries, layer-based masking (`selectionLayer = 6`), `transmissionRender: true` integration, `appliedObjects/appliedMeshes` traversal. Significantly more capable than `webgi-legacy-src/passes/threejs/OutlineRenderPass.ts`.
- **Pass-level `bilateralPass` is a serialized member** in `SSGIPluginPass:218`. webgi treats it as internal.
- **Bloom inlines its bloom pyramid** in `BloomPluginPass.render` (lines 243-349) using `renderManager.getTempTarget`/`releaseTempTarget` — webgi delegated to `BloomPass` class. Functionally similar but ported.
- **Outline plugin multi-select API** — uses `picking.getSelectedObjects()` *with* `getSelectedObject()` fallback at `OutlinePlugin.ts:294-296` and supports IMaterial / IGeometry / ITexture selection (`appliedObjects`, `appliedMeshes`). webgi only handled meshes/materials.

## Bugs in webgi

- `webgi-legacy-src/plugins/BloomPlugin.ts:90-94` — `onAdded` registers gbuffer updater + material extension but `onRemove` is **not overridden**: GBuffer updater never unregistered, material extension never unregistered. Same listener leak shape as Outline.
- `webgi-legacy-src/plugins/SSAOPlugin.ts:65-69` — `onRemove` line `// viewer.getPlugin(GBufferPlugin)?.unregisterGBufferUpdater(this.updateGBuffer)` is commented out. Updater leaks. Also `_aoTarget` is marked `// todo: dispose target` — but actually IS disposed here, the comment is stale.
- `webgi-legacy-src/plugins/SSContactShadows.ts:187-196` — `onAdded` registers material extension; `onRemove` unregisters it (good), but no `_gbufferUnpackExtensionChanged` handling — if GBuffer plugin is later replaced, material extension carries stale uniforms.
- `webgi-legacy-src/plugins/SSGIPlugin.ts:69-82` — disables `SSAO` via `ssao.enabled = false` on every update with no restore path. Once SSGI is enabled, SSAO is permanently off until manually re-enabled.
- `webgi-legacy-src/plugins/SSContactShadows.ts:122` — comment `// Because this frag is also patched in Anisotropy` but the replacement to vanilla `lights_fragment_begin` may stomp other extensions registered after this with same chunk. Not a regression, predates port.

## Bugs in threepipe-webgi

### OutlinePlugin (acknowledged + extras)
- **Confirmed listener leaks** (already on todo): `onAdded` registers `selectedObjectChanged` (line 186), `document.mousemove` (line 202) and pass via `viewer.renderManager.registerPass` (line 182). `onRemove` (lines 224-232) only unregisters the pass — not the picking listener nor the document mousemove. The plugin file even contains `// todo use forPlugin and remove listener` (line 184) and `// todo remove listener` (line 201).
- **Deprecated getter bug** — `OutlinePlugin.ts:348-355`: the deprecation alias for `outlineColor` returns/sets `this.intensity` instead of `this.color`. Identical bug pattern as `outlineIntensity` (where the code is correct) — copy-paste bug. Anyone using legacy `outlineColor` writes a number into `Color`.
- **`_viewerListeners` declared but registration unclear** — OutlinePlugin uses `_viewerListeners` for `preRender` (`:308-314`) which depends on AScreenPassExtensionPlugin auto-binding. Worth verifying that base does the unregister; if it does, the dpr-update listener is fine. Crucially, the **`document` mousemove and the `selectedObjectChanged` listener are NOT in `_viewerListeners`** so they aren't auto-cleaned.

### BloomPlugin
- `BloomPlugin.ts:199` — `prefilter = new Vector4(2, 0.5, 0, 0)` is a `@uniform()` decorated property, but `_thresholdsUpdated` only writes into the prefilter object's `.x/.y/.z/.w`, not the uniform value. With `@uniform({propKey: 'prefilter'})` style elsewhere, the binding may be class-instance-only, **not** flowing into `material.uniforms.prefilter` until first `setDirty`. Worth verifying that `@uniform()` with an object value is updated correctly given it isn't reset on each frame.
- `BloomPlugin.ts:234-235` — `this.prefilter.w = ... this.uniforms.prefilter.value.z` is computed from `uniforms.prefilter.value.z`, but uniform `prefilter` is *not* in the `uniforms` object passed to the shader (lines 172-181 — `prefilter` uniform is removed/commented). So `this.uniforms?.prefilter` is undefined and `prefilter.w` defaults to 0.
- `BloomPlugin.ts:235` — `this.uniforms?.prefilter ? .125 / (...) : 0` — even if it did exist, computing `.125 / (z + 0.00001)` on the uniform's `z` (which is `2 * threshold * softThreshold`) is correct logic; the issue is just that the uniform is not registered.
- `BloomPlugin.ts:259` — comment `// todo are we starting with 0.25? this should be 1 maybe? but more memory...` — port-time TODO unresolved.
- `BloomPlugin.ts:74-90` — The `addPlugin` listener for late GBufferPlugin attach is added in `onAdded`, but the registered handler binds `updateGBufferFlags.bind(this)` — a fresh function each call. `onRemove` calls `gbuffer?.unregisterGBufferUpdater(this.constructor.PluginType)` (line 89) which uses the type key, so that's OK; but the `_pass.material.unregisterMaterialExtensions([gbuffer.unpackExtension])` may run before `_onPluginAdd` ever fired, leaving a dangling extension if the order is unusual.

### DepthOfFieldPlugin
- `DepthOfFieldPlugin.ts:393-394` — `if (!this.enabled) return` exits without setting `this.needsSwap = false`. ExtendedShaderPass's superclass relies on `needsSwap` from constructor; `super.render` was never called so `writeBuffer/readBuffer` aren't swapped. May leave the wrong texture as the next pass's input. Compare webgi `DepthOfFieldPass` which sets `needsSwap` explicitly.
- `DepthOfFieldPlugin.ts:300-313` — `dofBlurMaterialPoisson` is a **module-level singleton** (declared outside the class). Multiple DoF instances would share state including `frameCount` uniform. Probably never matters in practice but is incorrect for multi-viewer.
- `DepthOfFieldPlugin.ts:99` — `this._viewer?.getPlugin(FrameFadePlugin)?.startTransition` (uses class) but the same line 86 above uses `this._viewer?.getPlugin<FrameFadePlugin>('FrameFadePlugin')` (string). Inconsistent pattern. Both work but suggests refactor noise.
- `DepthOfFieldPlugin.ts:174` — `pass.dofBlurMaterial.uniforms.frameCount` was a guard for the (now removed) box-blur path; with poisson hardcoded at line 324, the guard is redundant.

### SSGIPlugin
- `SSGIPlugin.ts:178-200` — `_beforeRender` calls `ssao.disable(SSGIPlugin.PluginType)` when SSGI is enabled, but **never re-enables** when SSGI becomes disabled. Inherits webgi bug; even though the call is now to a named-disable mechanism (`disable(name)`), the symmetric `enable(name)` is never called. Add `if (!e) ssao.enable(SSGIPlugin.PluginType)` path.
- `SSGIPlugin.ts:316` — `autoRadius: {value: giEnabled ? false : true}` — boolean defaulted opposite to the `@uniform` decorated `autoRadius = true` on the plugin (line 231). On first frame the uniform value is `false` until `updateShaderProperties` overwrites it.
- `SSGIPlugin.ts:283-285` — constructor signature `giEnabled = true` but the public `giEnabled` field defaults to `true` (line 223) — passing `false` here will be overwritten by the field initializer. Verify that decorator initialization order doesn't cause `giEnabled` to be set twice.
- `SSGIPluginPass.ts:374-376` — `if (!this.renderWithCamera && renderer.renderManager.frameCount < 2) return` exits without `needsSwap = false`. Same shape as DoF bug above.
- `SSGIPluginPass.ts:541-544` — `set uniformsNeedUpdate(value: true)` but typed parameter to literal `true` only — `material.uniformsNeedUpdate = false` would not be propagated. Minor but unusual.

### SSReflectionPlugin
- `SSReflectionPlugin.ts:285-286` — Default `SSR_RAY_COUNT: 4` in shader defines but UI/decorator default is `rayCount = 1` (line 249). Mismatch; the `@matDefine` decorator should sync them, but on first frame the shader would compile with 4 then recompile to 1. Cosmetic perf hit; verify.
- `SSReflectionPlugin.ts:290` — `'SSR_MASK_FRONT_RAYS': true` (boolean) but elsewhere defines use `0`/`1`. `matDefineBool` with `decorator default true` (line 269) might serialize as `"true"` → string in shader — depends on threepipe matDefineBool implementation. Worth confirming.
- `SSReflectionPlugin.ts:380-401` — pass `render` returns early when `!this.enabled` without `needsSwap = false` (same shape).
- `SSReflectionPlugin.ts:185-194` — `fromJSON` legacy fixup mutates `data` then returns `super.fromJSON`; but `data.passes.ssr.enabled` is *only* read if defined; otherwise the constructor default kicks in. OK but worth a comment.

### SSContactShadowsPlugin
- `SSContactShadowsPlugin.ts:284` — `if (v.getPlugin(BaseGroundPlugin)) v.getPlugin(BaseGroundPlugin)!.material!.userData.sscsDisabled = false` — **enables** SSCS on the ground material. But this runs once at `onAdded` only. If the BaseGroundPlugin is added later or rebuilds its material, the flag is lost. Comment `// todo remove after threepipe update` acknowledges. Subscribe to plugin add event or to ground's `materialUpdate`.
- `SSContactShadowsPlugin.ts:69-72` — `_defines = { PERSPECTIVE_CAMERA: 1 }` is hardcoded. Orthographic camera will silently produce wrong results — webgi at least had a commented `PERSPECTIVE_CAMERA` toggle. Should be camera-derived.
- `SSContactShadowsPlugin.ts:43-57` — `_uniforms` is now an instance field (good), but `materialExtension.extraUniforms` (`:186-188`) spreads `this._uniforms` into a plain object once at construction. Subsequent reassignment of `_uniforms` reference would not propagate. Minor as spread copies value refs.
- `SSContactShadowsPlugin.ts:286,294` — registers `gbufferUnpackExtensionChanged` listener; remove path (`:294`) calls `removeEventListener` but doesn't call `setGBufferUnpackExtension(undefined)` to detach the extension's uniforms/defines. Memory-only leak.

### TemporalAAPlugin
- `TemporalAAPlugin.ts:125` — uses `scene.mainCamera`. webgi used `scene.activeCamera`. Threepipe naming is correct, but: `pass.taaEnabled = frame <= 1 && ...` — TAA is enabled **only on the first 2 frames**? webgi has the same `frame <= 1` check at `TemporalAAPlugin.ts:40`. Looks like the condition is inverted in webgi too (since `taaEnabled` is set to `false` when frame > 1, TAA only runs on frames 0/1 then never again until reset). Suspicious in both — file as a potential preexisting bug.
- `TemporalAAPlugin.ts:87` — `applyOnBackground = !!this._viewer.renderManager.msaa` (webgi used `v.isAntialiased`). `renderManager.msaa` is a number/bool — verify truthy semantics match (msaa=0 means off → false; msaa=1 means hardware MSAA disabled but software anti-aliasing on? need to check threepipe internals).
- `TemporalAAPlugin.ts:269-272` — `feedBack = new Vector2(0.88, 0.97)` exposed via `@uiVector('Feedback', undefined, 0.0001)` on the **pass**, with `@uniform()` — but the pass's uniform list (lines 202-213) does **not** declare `feedBack`. So the value is wired to a non-existent uniform. webgi used a different feedback mechanism through TAAPass — needs verification.

### Cross-plugin
- All ported plugins (Bloom, DoF, SSGI, SSReflection, SSContactShadows, TemporalAA) declare `OldPluginType` with `// todo swap` — once `OldPluginType` and `PluginType` are swapped, every existing serialized config will break unless `fromJSON` migration is added. Currently only SSGI/SSReflection have it.

## Behavior divergences

- **Bloom prefilter** (`BloomPlugin.ts:199` vs webgi `BloomPass`): threepipe-webgi initializes `prefilter = (2, 0.5, 0, 0)`; webgi initializes `(1, 0.5, 0, 0)`. Different default threshold (2 vs 1 stops). Visible difference.
- **Bloom max iterations**: threepipe-webgi `bloomIterations = 4` (range 2-7), webgi default unknown (in passObject), but the iteration loop is structurally similar.
- **Bloom passId before/after**: threepipe-webgi `before=['screen']`, webgi `before=['combinedPost','screen']`. Threepipe-webgi has no CombinedPostPlugin (uses ScreenPass as terminal), so this is correct.
- **DoF blur direction order**: threepipe-webgi runs poisson with single direction, no separated horizontal/vertical pass for the new blur (`DepthOfFieldPlugin.ts:437-450`). webgi separable blur was different. Visual quality may change.
- **SSGIPlugin gbuffer attach order**: threepipe-webgi requires `GBufferPlugin` already added before SSGIPlugin (throws at `:140-141`). webgi was tolerant via `?.getUnpackSnippet() ?? ''`.
- **TemporalAA `taaEnabled` condition** is identical to webgi (`frame <= 1`) — see bug note.
- **Outline picking widget gating**: webgi `OutlineExtension._enable()` calls `picking.enableWidget(!enabled)` once (`:146`). Threepipe-webgi (`OutlinePlugin.setDirty:148-170`) toggles `picking.widgetEnabled` on every dirty + has Line-type filter. New behavior: lines suppress the outline. Gain.
- **SSReflection `inlineSSR` → `inlineShaderRayTrace`**: webgi `inlineSSR=true` was a class member; threepipe-webgi made it a constructor param `inlineShaderRayTrace=true` and `public readonly`. Cannot be flipped post-construction. webgi created the target only when `!inlineSSR`; threepipe-webgi same logic (`:103`).
- **DepthOfField focal point gizmo**: `enableEdit` in webgi triggers a UI gizmo through `_focalPointHitTime`, threepipe-webgi keeps the field but the gizmo itself isn't ported (TODO at `:63`).

## API / signature drift

- Plugin base class changed: `GenericFilterPlugin<TPass, 'passId', ''>` / `MultiFilterPlugin<...>` → `PipelinePassPlugin<TPass, TPassId>` (Bloom/DoF/SSGI/SSRefl/TAA), `AScreenPassExtensionPlugin` (Outline), or `AViewerPluginSync` (SSContactShadows). Renames are systemic — any external code that subclassed webgi plugins would break.
- `MaterialExtension` import from `webgi/extras/asset_manager/threejs/MaterialExtender` → `threepipe`.
- Pass classes renamed: `BloomPass` → `BloomPluginPass`, `DepthOfFieldPass` → `DepthOfFieldPluginPass`, `SSRPass` → `SSReflectionPluginPass`, `SSRTAOPass` → `SSGIPluginPass`/`SSGIPlugin`, `TAAPass` → `TemporalAAPluginPass`, `OutlineRenderPass` → kept name but moved to plugin file.
- Plugin static `PluginType` changed: `'BloomPlugin'`→`'Bloom'`, `'TemporalAAPlugin'`→`'TAA'`, etc. — `OldPluginType` records the previous value but bidirectional swap not yet performed.
- `passId` strings: `'frameFade'`, `'bloom'`, `'depthOfField'`, `'taa'`, `'outline'` unchanged. `'ssrtgi'` unchanged. `'ssr'` → `'ssrefl'` (renamed). May break consumers reading `viewer.renderManager.passes.ssr`.
- `viewer.renderer.maxHDRIntensity` (webgi) → `viewer.renderManager.maxHDRIntensity` (threepipe). All ported call sites updated.
- `picking.getSelectedObject()` (single) and `picking.getSelectedObjects()` (multi) — Outline uses both, with a `// @ts-expect-error fixed on update` (`OutlinePlugin.ts:294`) noting that `getSelectedObjects` may not exist yet on the typings.
- `GBufferPlugin.getUnpackSnippet()` (webgi) → `GBufferPlugin.unpackExtension` (threepipe-webgi: a MaterialExtension that you `registerMaterialExtensions` on the pass material). Different model.
- Decorator-driven uniform/define wiring (`@uniform({propKey, onChange})`, `@matDefine`, `@matDefineBool`) replaces manual write-through accessors. Several places in webgi exposed `depthRange`/`nearBlurScale` getters (DoFPlugin); these are now on the pass via `@bindToValue` decorators (`DepthOfFieldPlugin.ts:327-337`). The plugin-level getters are commented out (lines 230-254) — anyone using `dofPlugin.depthRange` directly will break.
- `viewer.scene.activeCamera`/`renderCamera`/`mainCamera` triplet: webgi mostly used `activeCamera`/`renderCamera`, threepipe-webgi uses `mainCamera`/`renderCamera`. SSGI pass `renderWithCamera` flag uses frame count instead of camera identity check.

## Notes / open questions

1. **`OldPluginType` swap path** — none of the ported plugins have done `// todo swap`. Plan needed: when swapping, every plugin needs a `fromJSON` migration like SSGIPlugin/SSReflectionPlugin already have. Otherwise existing user configs break.
2. **MipMapBlurPlugin** — confirm whether it's needed for any current example before deciding to port; the standalone usage in webgi was for HDRiGround / blurred reflections. Threepipe might already cover via filtered envmap.
3. **SSBevelPlugin** — significant port (gbuffer 5-bit packing, GLTF extension, NormalBufferPlugin coordination). Likely not in critical path; recommend deferring.
4. **RandomizedDirectionalLightPlugin** — the math class `RandomizedDirectionalLight` is in `experiments/threepipe-webgi/src/utils/`, but the plugin (preRender hook + UI) is missing. If progressive shadows are needed, this is a 1-day port.
5. **SSContactShadows `PERSPECTIVE_CAMERA` hardcoded to 1** — ortho support drop is intentional or regression?
6. **Bloom `prefilter` uniform missing** — Section "Bugs in threepipe-webgi → BloomPlugin" item 1/2: should `prefilter` be re-added to `uniforms` block? webgi reference would show how the uniform was wired in `BloomPass`. Cross-check `webgi-legacy-src/passes/threejs/BloomPass.ts`.
7. **TemporalAA `taaEnabled = frame <= 1`** logic looks inverted; both ports have it. Reread original intent — possibly legacy code that should be `>= 1` after first warm-up frame, or there's a separate reset path I haven't seen.
8. **SSGI permanent SSAO disable** — needs symmetric `enable(SSGIPlugin.PluginType)` when SSGI disables; same fix should be applied to webgi original.
9. **`OutlineRenderPass` in webgi vs threepipe-webgi** — the threepipe-webgi version is a near-rewrite (multi-select via `appliedObjects`/`appliedMeshes`, layer mask 6, transmission render). Confirm this is a known intentional improvement.
10. **`OutlinePlugin._viewerListeners` auto-cleanup** — verify `AScreenPassExtensionPlugin` superclass actually unregisters `_viewerListeners` on `onRemove`. If yes, the `dpr` updater is fine; if no, that's another leak.

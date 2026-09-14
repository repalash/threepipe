# Webgi ↔ Threepipe Audit — Cross-Cut Summary

Aggregated from 10 parallel audits. Each line cites the detailed report (linked at the bottom) where context lives.

**Scope:** core webgi (`experiments/webgi-legacy-src/`) vs threepipe core (`src/`, `plugins/`) and the partial port at `experiments/threepipe-webgi/`. Skipped: diamond/gem rendering, licensing/network/domain verification, AR/VR/WebXR, physics, ijewel.

---

## A. Bugs in threepipe (need fix)

### A1. Real bugs (clear-cut, fixable)

- **`AssetImporter.registerFile:479`** — operator-precedence: `file?.mime ?? isData ? ... : undefined`. Non-data files with `file.mime` set get garbage. One-line fix (parens). [03]
- **`MaterialManager.copyMaterialProps:264-269`** — direct `mesh.material = newMat` bypasses iMesh `setMaterial?.()` hooks. [03]
- **3-file `Object.keys` always-truthy** — `if (!Object.keys(extensionDef)) return` in `GLTFMaterialsAlphaMapExtension.ts:99`, `GLTFMaterialsDisplacementMapExtension.ts:105`, `GLTFMaterialsLightMapExtension.ts:108`. Produces empty `{}` extension entries in JSON. (Same dead line was already removed from BumpMap during item 2.) [02]
- **`GLTFObject3DExtrasExtension.Import`** silently flips `castShadow`/`receiveShadow` to `false` when extension exists but field missing — round-trip bug. [01]
- **`matrixAutoUpdate` exported but never imported** — one-sided round-trip loss (same gap on webgi side). [01]
- **`_resPathUrlModifier` shared across imports** — race under parallel imports. [01]
- **`Texture.DEFAULT_IMAGE` not restored on parse error path** — both sides. [01]
- **Lost `extras.t_colorSpace` write** — viewer-config texture lookups can fail in mixed cases. [02]
- **`castShadow=false` not emitted** (only `=true`) — round-trip relies on importer default; webgi emits unconditionally. [02]
- **`embedUrlImagePreviews` userData key** missing the `__` prefix that auto-strips in serialization. [02]
- **`copyMaterialUserData` ignores only `'uuid'`** (`src/utils/serialization.ts:547`). Should also exclude `appliedMeshes`, `imageLoadAwaiter`, `inverseModelMatrix`, `uvTransform`, `iMaterial`. Texture analogue: add `appliedMaterials`. [02][04]
- **`PopmotionPlugin._postFrame`** uses `Object.keys(arrayUpdaters).length` instead of `.length`. [07]
- **`PopmotionPlugin.onRemove`** removes `postFrame` listener but not the `preFrame` it registers. [07]
- **`GLTFAnimationPlugin._refreshAnimations`** pushes duplicates on re-add (always pushes even when `find` matched). [07]
- **`CameraViewPlugin`** dead `preFrame` listener never removed. [07]
- **`VirtualCamerasPlugin.preBlitCamera`** event types `readBuffer: WebGLTexture` but actual value is `Texture`. [07]
- **`MaterialConfiguratorBasePlugin.ts:431`** — operator precedence: `variationKey ?? material.name.length > 0 ? ...` discards `variationKey`. (Same bug at webgi `:313`.) [09]
- **`FragmentClippingExtensionPlugin.AddFragmentClipping:48-49`** — `=== undefined !== undefined` typo breaks default-init. [06]
- **`FragmentClippingExtensionPlugin`** non-Plane branch checks `Array.isArray(tfUd.clipPosition)` to decide how to copy `clipParams` — wrong field. [06]
- **`MeshOptSimplifyModifierPlugin._simplify`** returns non-indexed geometry (webgi returned indexed) — defeats simplification. [06]
- **`NoiseBumpMaterialPlugin`** `flakeScale=0.05` default vs UI bounds `[100, 10000]` and uniform default `1000` — UI shows out-of-range value. [06]
- **`OutlinePlugin.ts:348-355`** (threepipe-webgi) — deprecated `outlineColor` getter/setter accidentally proxies `this.intensity` instead of `this.color`. [05]
- **`BloomPlugin.ts:172-235`** (threepipe-webgi) — `prefilter` uniform computed/written but never registered in shader uniforms block. [05]
- **`BloomPlugin.ts:199`** — default `prefilter.x = 2` vs webgi `1` (visible threshold drift). [05]
- **`TemporalAAPlugin.ts:269-272`** (threepipe-webgi) — `feedBack` `@uniform()` decorated but not in uniforms block. [05]
- **`TemporalAAPlugin.ts:125`** — `taaEnabled = frame <= 1` is inverted (TAA only on first 2 frames). Same in webgi — preexisting. [05]
- **`SSContactShadowsPlugin.ts:69-72`** — hardcoded `PERSPECTIVE_CAMERA: 1` (ortho support regression). [05]
- **`SSContactShadowsPlugin.ts:284`** — sets `BaseGroundPlugin.material.userData.sscsDisabled = false` once at `onAdded`; lost if ground rebuilds material. [05]
- **`SSGIPlugin.ts:178-200`** — disables SSAO via named-disable but never re-enables symmetrically when SSGI turns off. [05]
- **SSGI/SSReflection/DoF early-out paths** skip setting `needsSwap = false`, leaving incorrect ping-pong state. [05]
- **`AnisotropyPlugin`** (experiment) UI binds to `_anisotropicDirection` (typo); data field is `_anisotropyDirection`. Slider does nothing. [06]
- **`AnisotropyPlugin`** (experiment) gltf importer drops the inline-resource branch. [06]
- **`VelocityBufferPlugin._previousWorldMatrices`** leaks (no cleanup on object removal). [06]
- **`GBufferPlugin._disposeTarget`** has `unregisterMaterialExtensions(unpackExtension)` commented out. Same in `DepthBufferPlugin._disposeTarget`. [06]
- **`AssetImporter.importPath`** — query-string variants of the same path collapse to one cache entry. [03]
- **`MaterialExtender.RegisterExtensions` priority** — confirm sort stability when extensions are registered out of order (low priority). [04]
- **Override Environment toggle missing `onChange: setDirty`** — `IMaterialUi.ts:380` has it commented out; webgi `MeshStandardMaterial2.ts:777` calls it. Toggle won't immediately re-render. [04]
- **Render to Depth UI hidden** — `IMaterialUi.ts:279` makes the toggle never appear unless externally seeded; webgi shows unconditionally. Confirm intent. [04]
- **`uiRefresh` arg-order divergence** — webgi `MeshStandardMaterial2.ts:197` calls `uiRefresh('postFrame', true, 1)`; threepipe `iMaterialCommons.ts:29` calls `uiRefresh(true, 'postFrame', 1)`. Likely real bug in one — needs uiconfig.js signature check. [04]
- **`iMaterialCommons.setValues` clears userData entirely** on `clearCurrentUserData` (`:36`) — drops `__*` extension version markers; webgi preserves at least `__appliedMeshes`. [04]
- **Duplicated `clearcoatRoughness` slider** in clearcoat folder — bug in both webgi `MeshStandardMaterial2.ts:382-396` and threepipe `IMaterialUi.ts:629-648`. [04]
- **`BaseGroundPlugin._refreshTransform`** overrides `visible` with size-check at `:235`. [10]
- **`BaseGroundPlugin._removeMaterial`** doesn't restore `gBufferData.tonemapEnabled`. [10]
- **`ContactShadowGroundPlugin`** `__csgpParamsSet` guard not in `_refreshMaterial`. [10]
- **`AdvancedGroundPlugin`** lost the "isNewMaterial" defaults branch (regression vs webgi). [10]
- **`ssaoDisabled` / `sscsDisabled`** no longer applied in `BaseGroundPlugin` (was webgi behaviour). [10]
- **`focusObject`** lost the `[OrbitControls.minDistance + 0.5, 50]` distance-band clamp; webgi clamped, threepipe just calls `viewer.fitToView`. [08]
- **Multi-select gizmo "force-world-space"** — dummy created with identity rotation but `space` mode left as previous; running with `space='local'` against identity dummy is a UX trap. Both sides. [08]
- **`MultiSelectHelper` dummy is pickable** — should set `userSelectable=false` and `bboxVisible=false`. Both sides. [08]
- **`Object3DWidgetsPlugin` PluginType renamed** `WidgetsPlugin` → `Object3DWidgetsPlugin` (breaking for serialized scenes). [08]
- **`HierarchyUiPlugin` location** lives in `plugins/tweakpane-editor/`, not `plugins/blueprintjs/` (note for docs). [08]

### A2. API / signature drift (potentially breaking on serialized state)

- **`FirstPersonControlsPlugin` → `ThreeFirstPersonControlsPlugin`** — controls key `firstPerson` → `threeFirstPerson`. Breaks saved configs. [07]
- **`FragmentClippingExtensionPlugin` glTF extension name changed** vs webgi — breaks round-trip with webgi files. [06]
- **`CameraView` constructor** signature totally changed: `(position, target, up, quaternion, duration)` → `(name, position, target, quaternion, zoom, duration, isWorldSpace)`. `up` removed; `name`/`zoom`/`isWorldSpace` added. [07]
- **`PopmotionPlugin.animateObject`** signature `(o, updaters, _external)` → `(o, delay?, canComplete?, driver?, delay2?)`. [07]
- **`IAnimationObject.from/to`** replaced with `values[]/offsets[]` keyframe model (has `fromJSON` migration shim). [07]
- **`extractAnimationKey`** lost its `target` param. [07]
- **`ACameraControlsPlugin`** listens on `mainCameraChange` instead of `activeCameraChange`. [07]
- **`SwitchNodeBasePlugin._preRender`/`_postRender`** restructured away (the structurally-similar `return → continue` bug remains in webgi `:55, :70, :72`). Threepipe path is fine. [09]
- **PassId rename** `ssr` → `ssrefl` (postprocessing). [05]
- **`getPreview` camDistance multiplier** — webgi `* 0.5` vs threepipe `* 2` — 4× difference; affects icon framing. [09]
- **`MaterialConfiguratorBasePlugin._refreshUiConfig`** arg order reversed and timeout 100→500 (suggests uiconfig.js API drift). [09]

---

## B. Bugs in `experiments/threepipe-webgi/` (the partial port)

Most of A1's threepipe-webgi-specific entries (Outline, Bloom, TAA, SSContactShadows, SSGI, AnisotropyPlugin, VelocityBufferPlugin) live here. See A1 for itemized list.

Other:

- **`AnisotropyPlugin`** (experiment) UI binding typo + GLTF importer regression (covered in A1).
- **No `fromJSON` legacy migration** on Bloom/DoF/TAA/Outline/SSContactShadows — their pending PluginType renames would break saved configs. [05]

---

## C. Bugs in webgi (sync-back candidates)

- **`PickingPlugin`** lines 184, 188-210 — anonymous-arrow listeners on `'select'` and `'addSceneObject'` never removed (file already has `// todo: remove these event listeners`). Threepipe fixed. [08]
- **`ObjectPicker`** has no `dispose()` and binds 7 anonymous arrow listeners to canvas. Threepipe fixed via `dispose()` + `__unregister` + undo. [08]
- **OutlinePlugin** listener cleanup (already on the to-do list — items 8/11 in working_stream.md).
- **`ParallaxCameraControllerPlugin`** leaks `pointerdown`/`pointerup` listeners on every `onAdded`. [07]
- **`GLTFAnimationPlugin.onRemove`** typo — `addEventListener` instead of `removeEventListener` on `loaderCreate`. [07]
- **`CameraViewPlugin.setCurrentCameraView`** lacks `setDirty()` — threepipe fixed via `ICamera.setView`. [07]
- **`MaterialLibraryBasePlugin._refreshUi`** is dead-code-gated (returns `false` unconditionally) — entire library grid never builds. [09]
- **`VariationConfiguratorPlugin`** — `getIcon` `&&` should be `||`; JSON-load not implemented; URL-add duplicate guard missing `return`. [09]
- **`MaterialConfiguratorBasePlugin.ts:313`** — same operator-precedence bug as threepipe `:431` (variationKey discarded). [09]
- **`RGBEPNGLoader.ts:47`** uses `Uint32Array` instead of `Float32Array` for `FloatType` decode. [01]
- **`gltf.ts:465-470`** passes `parseAsync(url, undefined, true)` unconditionally — mis-parses threepipe's RGBE `encodingVersion=3`. [01]
- **DRACOLoader2 factory** called with no `onModuleLoaded`; no `decoderModulePending` cache; decoder path-prefix-only matches `WebGiGLBWrapper`. [01]
- **`_isRootFileExtension`** ignores mime — threepipe fixed. [03]
- **`AssetExporterPlugin` "Encrypt Password" UI** typed `checkbox` — threepipe fixed. [03]
- **`MaterialManager._refreshTextureRefs`** runs on every dispose (O(N*M)). [03]
- **`'adding'` state event** lingers in process map until processFileEnd. [03]
- **`MaterialManager.generateFromTemplate` clone closure** `:121-141` captures original `mat` (closure bug); threepipe correctly uses `this`. [04]
- **`MaterialExtender.UnregisterExtensions`** is a TODO no-op in webgi. [04]
- **`ParallaxMappingPlugin`** substitutes from `_defines` that doesn't have the keys. Threepipe fixed. [06]
- **`NormalBufferPlugin` and `VelocityBufferPlugin`** call `disposeTarget(target?.dispose?.())` — passes `void`. Threepipe fixed. [06]
- **`AutoUVMappingPlugin`** reads from nested userData bucket but writes to flat. [06]
- **`LayeredMaterialPlugin`** defines `stepSize` uniform unused in shader. [06]
- **`BloomPlugin`** never overrides `onRemove` (gbuffer updater + material extension leak). [05]
- **`SSAOPlugin.onRemove`** has unregister call commented out. [05]
- **`SSGIPlugin`** permanently turns off SSAO. [05]
- **Cross-tool foreign GLB legacy-bump bug** — webgi flags every Blender-exported GLB with bump as legacy (`vcVersion ? cmp : true` defaults to `true`). User noted to fix on webgi side; threepipe is generator-aware.

---

## D. Missing webgi features in threepipe (port candidates)

### D1. GLTF / asset pipeline
- **`mergeMetalnessRoughnessMaps` option + `WEBGI_materials_separate_metalrough` extension** — already on Phase 2 list (items 5–7). [01][02]
- **6 webgi gltf-transform extensions** missing from threepipe's draco list: `WEBGI_animation_markers`, `WEBGI_materials_thinFilmLayer`, `WEBGI_materials_triplanarMapping`, `WEBGI_materials_ssbevel`, `WEBGI_materials_layered`, `WEBGI_materials_autouv`. [02]
- **`WEBGI_animation_markers` GLTF importer/exporter** — drives `currentTimelineMarker` + camera switching. [07]
- **`IMaterialTemplate` system + `generateFromTemplate`** — default-value templates for material classes. [03]
- **`__appliedMaterials` auto-dispose tracking** — texture leak risk without it. [03]
- **`AssetExporter.processors` map** — extensible export-time processors (`convertMeshToIndexed`, DRACO encoder options dead/commented in threepipe). [03]
- **`AAssetManagerProcessStatePlugin`** subscriptions for FileTransfer / MaterialConfigurator / SwitchNode / ThemePlugin — loading screen won't show those phases. [03]
- **`processRaw` for `rootSceneModelRoot`** — webgi merges scene-root animations / `__importedViewerConfig` / `__importData` into first child; potential animation loss in threepipe. [03]
- **LoadingScreenPlugin** lost the 16-char filename truncation. [03]
- **Plugin-preset auto-import** only fires through `loadImported`, not `processRaw`. [03]

### D2. Material classes
- **`iMaterialIgnoredUserData` filter** — covered under A1 as a fix; impacts D-class behavior too. [04]
- **`Material*2` exposes lots of `MaterialProperties`/`MapProperties`/`InterpolateProperties` static metadata** — threepipe has it, just listing as not-missing. [04]

### D3. Postprocessing plugins (4 missing entirely)
- **`MipMapBlurPlugin`**. [05]
- **`SSBevelPlugin`** + its `WEBGI_materials_ssbevel` glTF extension. [05]
- **Standalone `SSRTAOPlugin`** (folded into `SSGIPlugin` with `giEnabled` toggle in port — confirm acceptable). [05]
- **`RandomizedDirectionalLightPlugin`** plugin wrapper (only the math class is ported). [05]

### D4. Pipeline / material extension plugins (6 missing)
- **`FlatMaterialExtensionPlugin`**. [06]
- **`LayeredMaterialPlugin`**. [06]
- **`ThinFilmLayerPlugin`**. [06]
- **`TriplanarUVMappingPlugin`**. [06]
- **`AutoUVMappingPlugin`**. [06]
- **`XAtlasPlugin`**. [06]

### D5. Camera / controls / animation
- **`ArcballControlsPlugin`** + `ArcballControls2`. [07]
- **`TrackballControlsPlugin`** + `TrackballControls2`. [07]
- **`ParallaxCameraControllerPlugin`** (asymmetric perspective frustum + gyro/mouse). [07]
- **`CameraViewControlPlugin` + `ScrollableCameraViewPlugin` + `ScrollableCameraViewPreviewPlugin`** — damped state-based scrubber family. [07]
- **`ObjectRotationPlugin`** — offset, arbitrary curves, per-object userData persistence. (User-flagged.) [07][08]
- **`CameraViewPlugin` features:** `seekOnScroll`, `animateOnScroll`, `scrollAnimationDamping`, `rotationOffset` slider, splineCurve UI dropdown, `recordAllViews` (kept commented as scaffolding). [07]
- **`CustomAnimationHelperPlugin`, `PosePlugin`, `BeringRingAnimation`, `butter.ts`** — likely intentional skips, except possibly Pose. [07]

### D6. Configurator / library / UI
- **`MaterialLibraryBasePlugin` / `MaterialLibraryPlugin`**. [09]
- **`MaterialPresetPlugin`**. [09]
- **`PresetLibraryPlugin`**. [09]
- **`VariationConfiguratorPlugin` family** (object/material file-based swap with zip persistence) + `VariationConfiguratorEditorUiPlugin` + `VariationConfiguratorGridUiPlugin`. [09]
- **`ExtrasUiPlugin`, `LightsUiPlugin`, `SceneCamerasUiPlugin`**. [09]

### D7. Geometry / textures / extras
- **`TextureProjector` + `TextureProjectorPlugin`** (1109 + 441 lines) — recent webgi additions, flagged as priority. [10]
- **`SimpleTextPlugin`** (only the `TextSVG` builder util survives). [10]
- **`CanvasRecorderPlugin`** + four `extras/canvas_recorder/*.ts` backends. (`IConvergedCanvasRecorder` plumbing already exists on `ProgressivePlugin`.) [10]
- **`CSGPluginBase/BSP/BVH`**. [10]
- **`ModelStagePlugin`, `SnowFallPlugin`, `WaveGroundPlugin`, `EnvMapToolPlugin`, `EnvMapLoaderThree`, `GradientSvgPlugin`, `SceneLoopPlugin`, `RandomizedDirectionalLightPlugin`, `BeringAnimation`**. [10]
- **`extras/devices/{MouseInputDevice, GyroInputDevice, InputDevice}`** — used by ParallaxCameraController. [10]
- **`helpers/{CubeNormalsCaptureHelper, posehelper, refl, removeDuplicateGeometries}`**. [10]

---

## E. Threepipe-only / new in threepipe

Worth keeping (no action — listing for awareness):

- **GLTF importer:** AuxScene unwrap, line→fat-line conversion, `BundledResources`, `gltfUUID` rebind, animation `rootRefs`, MIME-aware Importer registry, ~30 small additions. [01]
- **Asset manager:** centralized `processState` + `processStateUpdate` event, `__sourceBlob`/`__sourceBuffer` moved out of userData, `__rootPathOptions` capture, `gltfExtensions` registry, Cache.Storage auto-init, render-target multi-texture zip export, mimeType in importer dispatch. [03]
- **Material classes:** `texturesChanged` event + map-ref tracking, `priority` sorting on extensions, `MaterialProperties`/`MapProperties`/`InterpolateProperties` static metadata, `setValues(...time)` lerp support, `select <typeSlug>` button, UV channel dropdown in samplers, `dispatchEvent` auto-bubble, `LegacyPhongMaterial`/`LineMaterial2`/`ShaderMaterial2` etc. [04]
- **Postprocessing:** `gbufferUnpackExtensionChanged` reactive listener, `split` debug uniform on SSGI/SSReflection, `forPlugin` velocity-buffer auto-attach, OutlineRenderPass multi-select via `appliedObjects/appliedMeshes`, decorator-driven UI, `OldPluginType` for migration. [05]
- **Picking:** clipboard, duplicate (with simple/compound mode + `DuplicateTracker`), visibility toggle/unhide, focus, reset-transform, hover widget, selection-mode auto-switching, rich shortcut surface (Ctrl+A/D/C/X/V, Esc, Delete, H, F, Alt+G/R/S). [08]
- **Configurator:** timeline-driven animation, `applyVariationAnimate`, animated cross-fade, `forPlugin` ordering fix, real context menus. [09]
- **Geometry/extras:** GeometryGeneratorPlugin much extended (tube/shape/tubeShape/line generators, Object3DGenerator integration), CanvasSnapshotPlugin, Box3B, GLTFSpecGlossinessConverterPlugin with NodeIO base split. [10]

---

## F. Behavior divergences (intentional or unclear)

- **Pre-May-2023 webgi files (no generator field)** load as legacy in webgi but as modern in threepipe. Comment says intentional. [01]
- **`useModelBounds` default flipped** `false → true` in threepipe — silently changes ground auto-fit. [10]
- **ContactShadow clear color** flipped to white with alphaMode toggle. [10]
- **`WatchHandsPlugin` PluginType** key changed `Progressive → ProgressivePlugin`. [10]
- **`AdvancedGroundPlugin` `_extraUiConfig` ordering** differs. [10]
- **`Iridescence` slider bounds `[0, 3]`** in both projects — diverges from three.js spec `[0, 1]`. Possibly intentional. [04]
- **`encodeUint16Rgbe` default drift** — webgi `true`, threepipe `false`. [02]
- **`forceIndices`** plumbed but not implemented (TODO). [02]
- **`FrameFadePlugin._fadeObjectUpdate`** uses truthy `ev.frameFade` while other three fades use `!== false` — opt-in vs opt-out asymmetry. Possibly intentional. [07]
- **No undo for variation apply / switch-node select** in either codebase. [09]

---

## G. Bidirectional bugs (both sides) — fix simultaneously

- **`buildMetalRoughTexture` clone-userData leak** — three.js modded `GLTFExporter.js:921`. Source of "metallicRoughnessTexture is original roughness JPG URL" bug. [02]
- **Multi-select gizmo "force-world-space" UX trap.** [08]
- **`MultiSelectHelper` dummy pickable.** [08]
- **`MaterialConfiguratorBasePlugin` operator-precedence** at threepipe `:431` / webgi `:313`. [09]
- **`Texture.DEFAULT_IMAGE` not restored on parse error path.** [01]
- **`matrixAutoUpdate` exported but never imported** (round-trip). [01]
- **`GLTFDracoExporter.preload()` fire-and-forget** — caller can't await readiness. [02]
- **`taaEnabled = frame <= 1` inversion** in TemporalAA. [05]
- **Duplicated `clearcoatRoughness` slider** in clearcoat folder. [04]

---

## Detailed reports

| # | Area | File |
|---|---|---|
| 01 | GLTF Importer | [`audit/01-gltf-importer.md`](audit/01-gltf-importer.md) |
| 02 | GLTF Exporter | [`audit/02-gltf-exporter.md`](audit/02-gltf-exporter.md) |
| 03 | Asset / Material Manager | [`audit/03-asset-material-manager.md`](audit/03-asset-material-manager.md) |
| 04 | Material Classes + UI | [`audit/04-material-classes.md`](audit/04-material-classes.md) |
| 05 | Postprocessing Plugins | [`audit/05-postprocessing-plugins.md`](audit/05-postprocessing-plugins.md) |
| 06 | Pipeline / Buffer / Material Ext | [`audit/06-pipeline-buffer-material-ext.md`](audit/06-pipeline-buffer-material-ext.md) |
| 07 | Camera / Controls / Animation | [`audit/07-camera-controls-animation.md`](audit/07-camera-controls-animation.md) |
| 08 | Picking / Transform / Hierarchy | [`audit/08-picking-transform-hierarchy.md`](audit/08-picking-transform-hierarchy.md) |
| 09 | Configurator / UI Plugins | [`audit/09-configurator-ui.md`](audit/09-configurator-ui.md) |
| 10 | Geometry / Extras / Viewer | [`audit/10-geometry-extras-viewer.md`](audit/10-geometry-extras-viewer.md) |

---

## Suggested attack order

**Quick fixes (each <10 lines):**
1. `Object.keys(extensionDef)` in 3 export files (A1)
2. `AssetImporter.registerFile` precedence (A1)
3. `PopmotionPlugin` array.length + listener leak (A1)
4. `MaterialConfiguratorBasePlugin:431` precedence (A1)
5. `FragmentClippingExtensionPlugin:48-49` typo (A1)
6. `OutlinePlugin` `outlineColor` proxy bug (A1)
7. Bloom/TAA missing uniforms registration (A1)
8. `castShadow=false` emission (A1)
9. Override Environment toggle `onChange: setDirty` (A1)
10. `copyMaterialUserData` extended ignore list (A1)

**Medium fixes (likely needs investigation):**
- `iMaterialCommons.setValues` userData clear behavior (A1)
- `uiRefresh` arg-order discrepancy — needs uiconfig.js signature check (A1)
- `MaterialManager.copyMaterialProps` setMaterial hook (A1)
- All 6 D4 missing material plugins (each ~100-300 lines)
- All 4 D3 postprocessing plugins
- D7 TextureProjector(Plugin) — sizable

**Phase 2 / large features:**
- Items 5–7 from `working_stream.md`: `mergeMetalnessRoughnessMaps` + `WEBGI_materials_separate_metalrough`
- D1 missing gltf-transform extensions
- D5 Arcball/Trackball/Parallax controls family
- D6 Configurator library/preset/variation family

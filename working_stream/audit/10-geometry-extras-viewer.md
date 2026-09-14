# Audit: Geometry / Extras / Viewer Core

## Summary

Most "core" infrastructure (BaseGroundPlugin, ContactShadowGroundPlugin, HDRiGroundPlugin, GeometryGeneratorPlugin, ShapeTubeExtrudePlugin, FullScreen/Dropzone/InteractionPrompt/FileTransfer, ViewerApp ↔ ThreeViewer, helpers like `Box3B`, `Reflector2`, controls, dropzone, canvas snapshot) has been ported to threepipe. The geometry generator system has been substantially upgraded in core (extra `tube/shape/tubeShape/line` generators, `IGeometry`-based, mesh/material class hooks, regenerate event flow, `Object3DGeneratorPlugin` integration). `AdvancedGroundPlugin`, `WatchHandsPlugin`, `AnisotropyPlugin`, `Reflector2`, `ShadowMapBaker`, `RandomizedDirectionalLight`, `FSShadowMaterial` live only in `experiments/threepipe-webgi/` (not yet in core/published plugin packages). Several webgi plugins are entirely unported: `TextureProjector` + `TextureProjectorPlugin` (the standalone projector with orbit/FOV/text/image/video/bump), `SimpleTextPlugin`, `CanvasRecorderPlugin` (the multi-encoder one), `CSGPluginBase/BSP/BVH`, `ModelStagePlugin`, `SnowFallPlugin`, `WaveGroundPlugin`, `EnvMapToolPlugin`, `GradientSvgPlugin`, `SceneLoopPlugin`, `RandomizedDirectionalLightPlugin`, `EnvMapLoaderThree`, the `extras/devices/` (Mouse/Gyro/InputDevice) input layer, and `BeringAnimation`. There is also drift in `_extraUiConfig` ordering and a few semantic differences in ContactShadowGroundPlugin and HDRiGroundPlugin.

## Plugin matrix

| Plugin/Module | webgi | threepipe core | threepipe plugins / threepipe-webgi | status |
|---|---|---|---|---|
| `BaseGroundPlugin` | `experiments/webgi-legacy-src/plugins/BaseGroundPlugin.ts` | `src/plugins/base/BaseGroundPlugin.ts` | — | ported, signature/API drift (no `setOptions/refreshOptions`, uses `refresh`) |
| `GroundPlugin` (reflector + shadow baker) | `experiments/webgi-legacy-src/plugins/GroundPlugin.ts` | — | `experiments/threepipe-webgi/src/plugins/extras/AdvancedGroundPlugin.ts` (renamed) | ported only in experiment, **not** in core or published plugin |
| `ContactShadowGroundPlugin` | `experiments/webgi-legacy-src/plugins/ContactShadowGroundPlugin.ts` | `src/plugins/extras/ContactShadowGroundPlugin.ts` | — | ported + extended (mapMode dropdown), depth-shader semantics changed |
| `HDRiGroundPlugin` | `experiments/webgi-legacy-src/plugins/HDRiGroundPlugin.ts` | `src/plugins/extras/HDRiGroundPlugin.ts` | — | ported + `promptOnBackgroundMismatch` flag, removed `SimpleBackgroundEnvUiPlugin` integration |
| `GeometryGeneratorPlugin` (basic primitives) | `experiments/webgi-legacy-src/plugins/GeometryGeneratorPlugin.ts` (75 lines) | `src/plugins/geometry/GeometryGeneratorPlugin.ts` (183 lines) | `plugins/geometry-generator/src/GeometryGeneratorExtrasPlugin.ts` (text only) | core extended substantially, deprecation shim in plugin |
| `AGeometryGenerator` | `experiments/webgi-legacy-src/helpers/threejs/AGeometryGenerator.ts` | `src/plugins/geometry/AGeometryGenerator.ts` | — | ported + `defaultMeshClass/MaterialClass/GeometryClass`, `LineGeometry2.setPositions` path, `removeUi` |
| Box/Sphere/Plane/Circle/Cylinder/Torus generators | `experiments/webgi-legacy-src/plugins/geometryGenerators/*.ts` | `src/plugins/geometry/primitives/*.ts` | — | ported (constructor accepts override params) |
| `LineGeometryGenerator` / `ShapeGeometryGenerator` / `TubeGeometryGenerator` / `TubeShapeGeometryGenerator` | — | `src/plugins/geometry/primitives/{Line,Shape,Tube,TubeShape}GeometryGenerator.ts` | — | new in threepipe |
| `TextGeometryGenerator` | — | — | `plugins/geometry-generator/src/primitives/TextGeometryGenerator.ts` | new in threepipe (uses `three/examples/jsm/Font`) |
| `ShapeTubeExtrudePlugin` | `experiments/webgi-legacy-src/plugins/ShapeTubeExtrudePlugin.ts` (251) | `src/plugins/geometry/ShapeTubeExtrudePlugin.ts` | — | ported |
| `TextureProjector` (class) | `experiments/webgi-legacy-src/plugins/TextureProjector.ts` (1109) | — | — | **NOT ported** |
| `TextureProjectorPlugin` | `experiments/webgi-legacy-src/plugins/TextureProjectorPlugin.ts` (441) | — | — | **NOT ported** |
| `SimpleTextPlugin` | `experiments/webgi-legacy-src/plugins/SimpleTextPlugin.ts` (568) | — (only the SVG builder util at `src/utils/TextSVG.ts`) | `plugins/troika-text/src/TroikaTextPlugin.ts` (different approach) | **selection-driven plugin not ported**; only TextSVG utility carried over |
| `ModelStagePlugin` | `experiments/webgi-legacy-src/plugins/ModelStagePlugin.ts` | — | — | **NOT ported** (only a comment reference in BaseGroundPlugin.ts:193) |
| `WatchHandsPlugin` | `experiments/webgi-legacy-src/plugins/WatchHandsPlugin.ts` | — | `experiments/threepipe-webgi/src/plugins/extras/WatchHandsPlugin.ts` | ported in experiment only |
| `SnowFallPlugin` | `experiments/webgi-legacy-src/plugins/SnowFallPlugin.ts` (340) | — | — | **NOT ported** |
| `WaveGroundPlugin` | `experiments/webgi-legacy-src/plugins/WaveGroundPlugin.ts` (146) | — | — | **NOT ported** |
| `EnvMapToolPlugin` | `experiments/webgi-legacy-src/plugins/EnvMapToolPlugin.ts` | — | — | **NOT ported** |
| `EnvMapLoaderThree` | `experiments/webgi-legacy-src/extras/EnvMapLoaderThree.ts` | — | — | **NOT ported** |
| `GradientSvgPlugin` | `experiments/webgi-legacy-src/plugins/GradientSvgPlugin.ts` (285) | — | — | **NOT ported** |
| `SceneLoopPlugin` | `experiments/webgi-legacy-src/plugins/SceneLoopPlugin.ts` | — | — | **NOT ported** |
| `RandomizedDirectionalLightPlugin` | `experiments/webgi-legacy-src/plugins/RandomizedDirectionalLightPlugin.ts` | — | (helper class only at `experiments/threepipe-webgi/src/utils/RandomizedDirectionalLight.ts`) | **plugin shell not ported** (only helper class survives) |
| `BeringAnimation` | `experiments/webgi-legacy-src/plugins/BeringAnimation.ts` | — | — | **NOT ported** |
| `FullScreenPlugin` | `experiments/webgi-legacy-src/plugins/FullScreenPlugin.ts` | `src/plugins/interaction/FullScreenPlugin.ts` | — | ported |
| `DropzonePlugin` | `experiments/webgi-legacy-src/plugins/DropzonePlugin.ts` | `src/plugins/interaction/DropzonePlugin.ts` | — | ported |
| `Dropzone` (utility) | `experiments/webgi-legacy-src/extras/dropzone.ts` | `src/utils/Dropzone.ts` | — | ported (parity) |
| `InteractionPromptPlugin` | `experiments/webgi-legacy-src/plugins/InteractionPromptPlugin.ts` | `src/plugins/interaction/InteractionPromptPlugin.ts` | — | ported |
| `FileTransferPlugin` | `experiments/webgi-legacy-src/plugins/FileTransferPlugin.ts` | `src/plugins/export/FileTransferPlugin.ts` | — | ported + extended (asset-manager processState wiring) |
| `CanvasSnipperPlugin` / `extras/canvasSnipper.ts` | `experiments/webgi-legacy-src/plugins/CanvasSnipperPlugin.ts`, `experiments/webgi-legacy-src/extras/canvasSnipper.ts` | `src/plugins/export/CanvasSnapshotPlugin.ts`, `src/utils/canvas-snapshot.ts` | — | ported and renamed (`CanvasSnipper` → `CanvasSnapshot`) |
| `CanvasRecorderPlugin` (mp4/webm/png/jpeg sequence) | `experiments/webgi-legacy-src/plugins/CanvasRecorderPlugin.ts` (547) + `extras/canvas_recorder/*` (4 recorders) | — | — | **NOT ported** (no convergence-aware recorder) |
| `CSGPluginBase / BSP / BVH` | `experiments/webgi-legacy-src/plugins/CSGPluginBase.ts`, `CSGPluginBSP.ts`, `CSGPluginBVH.ts` | — | — | **NOT ported** |
| `GLTFSpecGlossinessConverterPlugin` | `experiments/webgi-legacy-src/plugins/GLTFSpecGlossinessConverterPlugin.ts` (47) | — | `plugins/gltf-transform/src/GLTFSpecGlossinessConverterPlugin.ts` + `GLTFSpecGlossinessConverterPluginBase.ts` | ported and split base (Node-safe) |
| `Reflector2` | `experiments/webgi-legacy-src/helpers/threejs/Reflector2.ts` | — | `experiments/threepipe-webgi/src/utils/Reflector2.ts` | only in experiment |
| `ShadowMapBaker` | `experiments/webgi-legacy-src/extras/ShadowMapBaker.ts` | — | `experiments/threepipe-webgi/src/utils/ShadowMapBaker.ts` | only in experiment |
| `RandomizedDirectionalLight` (helper) | `experiments/webgi-legacy-src/extras/RandomizedDirectionalLight.ts` | — | `experiments/threepipe-webgi/src/utils/RandomizedDirectionalLight.ts` | only in experiment |
| `FSShadowMaterial` | `experiments/webgi-legacy-src/extras/FSShadowMaterial.ts` | — | `experiments/threepipe-webgi/src/utils/FSShadowMaterial.ts` | only in experiment |
| `extras/devices/` (Mouse/Gyro/InputDevice) | `experiments/webgi-legacy-src/extras/devices/*.ts` | — | — | **NOT ported** (DeviceOrientationControls2 exists separately) |
| `Box3B` | `experiments/webgi-legacy-src/helpers/threejs/Box3B.ts` | `src/three/math/Box3B.ts` | — | ported and extended (precise AABB w/ position attribute) |
| `helpers/threejs/MaterialPreviewGenerator` | `experiments/webgi-legacy-src/helpers/threejs/MaterialPreviewGenerator.ts` | `src/three/utils/MaterialPreviewGenerator.ts` | — | ported |
| `helpers/threejs/snapObject` | `experiments/webgi-legacy-src/helpers/threejs/snapObject.ts` | `src/three/utils/snapObject.ts` | — | ported |
| `helpers/threejs/colorEncodings` | `experiments/webgi-legacy-src/helpers/threejs/colorEncodings.ts` | `src/three/utils/encoding.ts` (and `src/utils/color-encodings.ts`) | — | ported (split) |
| `core/AViewerPlugin` | `experiments/webgi-legacy-src/core/AViewerPlugin.ts` (146) | `src/viewer/AViewerPlugin.ts` (177) | — | ported, signature drift (sync/async split) |
| `viewer/ViewerApp` | `experiments/webgi-legacy-src/viewer/ViewerApp.ts` (1324) | `src/viewer/ThreeViewer.ts` (1807) | — | ported and renamed, big surface change |
| `core/threejs/RootScene` / `BaseRenderer` / `EffectComposer2` | `experiments/webgi-legacy-src/core/threejs/*.ts` | `src/core/object/RootScene.ts`, `src/rendering/RenderManager.ts`, postprocessing | — | ported (rearranged) |
| `helpers/CubeNormalsCaptureHelper` | `experiments/webgi-legacy-src/helpers/CubeNormalsCaptureHelper.ts` | — | — | **NOT ported** |
| `helpers/posehelper` | `experiments/webgi-legacy-src/helpers/posehelper.ts` | — | — | **NOT ported** |
| `helpers/refl` | `experiments/webgi-legacy-src/helpers/refl.ts` | — | — | **NOT ported** |
| `helpers/removeDuplicateGeometries` | `experiments/webgi-legacy-src/helpers/removeDuplicateGeometries.ts` | — | — | **NOT ported** |
| `helpers/gpuInstancing` | `experiments/webgi-legacy-src/helpers/gpuInstancing.ts` | `src/three/utils/gpu-instancing.ts` | — | ported |
| `helpers/animation` | `experiments/webgi-legacy-src/helpers/animation.ts` | `src/utils/animation.ts` | — | ported |
| `helpers/dom` | `experiments/webgi-legacy-src/helpers/dom.ts` | `src/utils/browser-helpers.ts` | — | ported |
| `helpers/serialize` | `experiments/webgi-legacy-src/helpers/serialize.ts` | `src/utils/serialization.ts` | — | ported |

## webgi-only / new in webgi (still missing from threepipe)

These are present in `experiments/webgi-legacy-src/` but not in `src/`, `plugins/`, or `experiments/threepipe-webgi/`:

- `TextureProjector` (`plugins/TextureProjector.ts`, 1109 lines) — full standalone projector with:
  - `PerspectiveCamera` + helper, clip plane mesh, debug visuals.
  - Orbit controls (`orbitEnabled`, `orbitPhi/Theta/Radius/Roll`, `orbitTarget`).
  - FOV / aspect serializable controls.
  - Content API for text (`makeTextSvg`), image, video.
  - `_videoElement` lifecycle / `VideoTexture` reuse.
  - `bumpScale`, `bumpEnabled`, `bumpOnly`, `clipPlaneOffset` per-projector.
  - Multi-projector limit handling (`DEBUG_COLORS` cycle, `nextDebugColor`).
- `TextureProjectorPlugin` (`plugins/TextureProjectorPlugin.ts`, 441 lines) — `MaterialExtension`, `_TextureProjectorPlugin` userData key, `invertAlphaMap` (with deprecated `inverseAlphaMap` shim), per-mesh projector arrays, video texture pre-render hooks. Cited as a recent webgi addition; no parallel file exists in threepipe.
- `SimpleTextPlugin` — selection-driven SVG-text-on-material plugin. Threepipe carries the SVG builder helper (`src/utils/TextSVG.ts`) but not the plugin itself, the material extension, the `applyToMap/BumpMap/AlphaMap`/`inverseAlphaMap` toggles, the per-mesh projection-mapping userData, or the picking-driven `_selectedObjectChanged` UI refresh.
- `ModelStagePlugin` (313 lines) — only referenced as a comment in `src/plugins/base/BaseGroundPlugin.ts:193` (`useModelBounds` is not serialized "this can be controlled by other plugins like ModelStagePlugin").
- `SnowFallPlugin` (340 lines), `WaveGroundPlugin` (146 lines), `BeringAnimation`.
- `EnvMapToolPlugin` (envmap fix-cube-lookup material extension) and `EnvMapLoaderThree` (custom binary envmap loader, 185 lines).
- `GradientSvgPlugin` (285 lines).
- `SceneLoopPlugin` (zip-based multi-scene loader/playback, 173 lines).
- `RandomizedDirectionalLightPlugin` (180 lines) — only the underlying helper `RandomizedDirectionalLight` class is in `experiments/threepipe-webgi/src/utils/`, the plugin shell is not.
- `CanvasRecorderPlugin` (547 lines) plus `extras/canvas_recorder/{ACanvasRecorder,CanvasMediaRecorder,FFMPEGRecorder,ImageSequenceRecorder}.ts`. The `IConvergedCanvasRecorder` interface and `postFrameConvergedRecordingDelta` API on `ProgressivePlugin` exist in core (`src/plugins/pipeline/ProgressivePlugin.ts`), so the plumbing is ready, but no actual recorder plugin is shipped.
- `CSGPluginBase / CSGPluginBSP / CSGPluginBVH`.
- `extras/devices/{InputDevice,MouseInputDevice,GyroInputDevice}.ts` — gyro/mouse abstraction layer used by ParallaxCameraController (DeviceOrientationControls2 was ported, but as three.js controls, not as the device abstraction).
- `helpers/CubeNormalsCaptureHelper.ts`, `helpers/posehelper.ts`, `helpers/refl.ts`, `helpers/removeDuplicateGeometries.ts`.
- Webgi recent extras: `TextureProjectorPlugin` standalone (the system-reminder lists this as a "recent webgi addition"). Confirmed missing.

## threepipe-only / new in threepipe

- `LineGeometryGenerator`, `ShapeGeometryGenerator`, `TubeGeometryGenerator`, `TubeShapeGeometryGenerator` (`src/plugins/geometry/primitives/`).
- `TextGeometryGenerator` (`plugins/geometry-generator/src/primitives/TextGeometryGenerator.ts`).
- `GeometryGeneratorExtrasPlugin` and the deprecation shim `GeometryGeneratorPlugin` (`plugins/geometry-generator/src/GeometryGeneratorExtrasPlugin.ts:55`).
- `AGeometryGenerator.defaultMeshClass / defaultMaterialClass / defaultGeometryClass` hooks (`src/plugins/geometry/AGeometryGenerator.ts:86-88`) and `setDefaultParams` (line 157).
- `BufferGeometry2`, `LineGeometry2`, `LineSegmentsGeometry2`, `EllipseCurve3D`, `TubeShapeGeometry`, `WireframeGeometry3` (`src/core/geometry/`).
- `Object3DGeneratorPlugin` integration in `GeometryGeneratorPlugin` (auto-registers `geometry-<type>` generators).
- `ContactShadowGroundPlugin` `mapMode` dropdown (aoMap/map/alphaMap, `src/plugins/extras/ContactShadowGroundPlugin.ts:50`) — webgi version always uses `alphaMap`. `_depthPass.clearColor` is now toggled per mode.
- `HDRiGroundPlugin.promptOnBackgroundMismatch` (`src/plugins/extras/HDRiGroundPlugin.ts:35`).
- `BaseGroundPlugin` is `@uiFolderContainer`-decorated and uses `@bindToValue` for material binding (`src/plugins/base/BaseGroundPlugin.ts:91`); webgi exposed material via getter.
- `Box3B.expandByObject` precise mode using position attribute (`src/three/math/Box3B.ts`).
- Many helpers reorganised under `src/three/utils/` (`bbox.ts`, `camera.ts`, `const-mappings.ts`, `conversion.ts`, `curve.ts`, `decorators.ts`, `encoding.ts`, `gpu-instancing.ts`, `misc.ts`, `object-transform.ts`, `texture.ts`).
- `src/three/widgets/` family (`AHelperWidget`, `ACameraHelperWidget`, `ALightHelperWidget`, `BoneHelper`, `BoxSelectionWidget`, `CameraHelper2`, `DirectionalLightHelper2`, `LineHelper`, `PointLightHelper2`, `SelectionWidget`, `SkeletonHelper2`, `SpotLightHelper2`) — webgi had `Object3DWidgetsPlugin` infrastructure but no broken-out per-helper-type widget classes.
- `Object3DManager` (`src/assetmanager/Object3DManager.ts`) — webgi tracks adds via `RootScene` events; threepipe centralises object registration with proper `objectAdd/objectRemove` events used by `GeometryGeneratorPlugin._objectAdd/_objectRemove` (`src/plugins/geometry/GeometryGeneratorPlugin.ts:115-117`).
- `ViewerTimeline` (`src/utils/ViewerTimeline.ts`).
- Improved Dropzone `dropstart`/`drop`/`droperror` listeners using `Listener` arrays (parity with webgi but extended structure).
- `experiments/threepipe-webgi/src/plugins/extras/AdvancedGroundPlugin.ts` includes `@bindToValue planarReflections` alias and a deprecated alias `export const GroundPlugin = AdvancedGroundPlugin` (line 377).

## Bugs in webgi

- `ContactShadowGroundPlugin._blurShadow` (`experiments/webgi-legacy-src/plugins/ContactShadowGroundPlugin.ts:143-156`) ping-pongs the same blur target by writing `blurTarget → _depthPass.target → blurTarget`; threepipe's `HVBlurHelper.blur` was extracted to handle this cleanly. The webgi version also doesn't use `transparent: false`/`NoBlending` on the depth material → may pick up unintended alpha. Threepipe sets `transparent: false, blending: NoBlending` (`src/plugins/extras/ContactShadowGroundPlugin.ts:81-82`).
- `ContactShadowGroundPlugin.shadowFragment` (webgi 91-95) replaces `gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity )` with a literal `1.0 - fragCoordZ`; this means `opacity` no longer toggles between aoMap-style and alphaMap-style output. Threepipe's port preserves `opacity` as a direction switch (`src/plugins/extras/ContactShadowGroundPlugin.ts:84-89`).
- `BaseGroundPlugin` (webgi) defaults `up` to `[0, 100, 0]` (line 78) which is unused (only `Math.PI/2` rotation is applied) — leftover dead config; threepipe drops it.
- `BaseGroundPlugin.refreshOptions` (webgi 219) calls `_refreshMaterial → refreshTransform → _refreshCameraLimits` but mounts ground via `_manager.addImportedSingle` asynchronously (line 137); during the first `await`, scene listeners may fire while `this._mesh` is undefined. Threepipe avoids this by creating the mesh synchronously in the constructor.
- `HDRiGroundPlugin._paramsChanged` (webgi 71) reads `(this._viewer.renderer.rendererObject as any).background.getBoxMesh2()` — `.background` was added to a custom `WebGLRenderer` patch and the `getBoxMesh2` method spelling implies a private addition; if that mesh is null on first call, the plugin still mutates `ShaderLib.backgroundCube.uniforms` globally (lines 73-78), which leaks state across multiple viewers. Threepipe inherits the same global-state mutation pattern (`src/plugins/extras/HDRiGroundPlugin.ts:75-81`) — same risk persists.
- `SimpleTextPlugin.materialExtension.onObjectRender` (lines 314-323) reads `this._uniforms.thinBaseLayerFactors.value.fromArray(tfUd.baseLayerFactors)` but `_uniforms` is initialised as `{}` (line 261-266 — all properties commented out). Will throw on render whenever a projection-mapped material exists. Pre-existing bug; the plugin was never wired up.
- `GeometryGeneratorPlugin.generateObject` (webgi 30-37) `await this._viewer?.getManager()?.addImportedSingle(...)` returns `obj`, then sets `obj.name = type` AND `obj.name = v` from the UI button — name assignment is duplicated and inconsistent (geometry name takes a different prefix `'Generated ' + type` vs threepipe's `toTitleCase(type)`).

## Bugs in threepipe

- `BaseGroundPlugin._refreshTransform` (`src/plugins/base/BaseGroundPlugin.ts:235`) sets `this._mesh.visible = this.size >= 0.0001` after the visibility flag was already applied a few lines above — this overrides `this.visible = false`/`true` with a size check whenever size is small. Webgi did not do this (`experiments/webgi-legacy-src/plugins/BaseGroundPlugin.ts:283` only updates rotation/scale).
- `BaseGroundPlugin._refreshMaterial` (`src/plugins/base/BaseGroundPlugin.ts:285-297`) tracks `__renderToDepth` and `gBufferData.__tonemapEnabled` for restore, but `_removeMaterial` (line 134-141) only restores `renderToDepth` — `gBufferData.tonemapEnabled` is left in the modified state forever after removal.
- `ContactShadowGroundPlugin._refreshMaterial` (line 220-247) sets `_material.userData.ssaoDisabled = this.mapMode === 'aoMap'` but `_removeMaterial` (line 170-179) deletes regardless of mapMode, then super.refresh re-applies; the `__csgpParamsSet` guard exists in `refresh` (line 197) but not in `_refreshMaterial` — toggling `contactShadows` rapidly will leave stale `ssaoDisabled` flags.
- `AdvancedGroundPlugin._refreshMaterial` (`experiments/threepipe-webgi/src/plugins/extras/AdvancedGroundPlugin.ts:236-237`) sets both `ssaoDisabled = true` and `sscsDisabled = true` unconditionally. This was historically inside `BaseGroundPlugin` in webgi (`experiments/webgi-legacy-src/plugins/BaseGroundPlugin.ts:332-333`) and is now only in `AdvancedGroundPlugin`. If a user uses just `BaseGroundPlugin` or `ContactShadowGroundPlugin` and expects ssao to be disabled on the ground (matching old webgi semantics), they won't get that behaviour.
- `GeometryGeneratorPlugin.generateObject` (`src/plugins/geometry/GeometryGeneratorPlugin.ts:83`) creates the geometry/material from `defaultGeometryClass()` / `defaultMaterialClass()` only when no `mesh` is passed; if a mesh is passed but `obj.geometry`/`obj.material` is null, the fallback chain (`obj?.geometry || geometry || ...`) still works but `obj.geometry !== geometry1` check then unconditionally re-assigns and destroys any prior reference without dispose — minor leak risk for callers reusing meshes.
- `AGeometryGenerator.generate` (`src/plugins/geometry/AGeometryGenerator.ts:131`) does `indices && updateIndices(geometry, indices)` — short-circuits when indices is empty array `[]` (truthy) but never sets index back to null when generator returns no indices. For `LineGeometryGenerator`, the early `setPositions` branch handles it, but a custom non-line generator that drops from indexed→non-indexed won't clear the old index buffer.

## Behavior divergences

- `BaseGroundPlugin` lifecycle: webgi awaits `addImportedSingle` and reflects the mesh via the asset manager; threepipe directly creates `Mesh2` and adds it via `viewer.scene.addObject(this._mesh, {addToRoot: true})`. Consequence: in threepipe you can `dispose()` synchronously and the mesh is part of the scene at construction; in webgi the mesh appears asynchronously.
- `BaseGroundPlugin.useModelBounds` default differs: **webgi defaults `false`** (line 247), **threepipe defaults `true`** (`src/plugins/base/BaseGroundPlugin.ts:194`). This changes auto-fit semantics for ground transform.
- `BaseGroundPlugin.refresh` vs `refreshOptions` rename + the legacy `setOptions(GroundOptions)` constructor option (with `shape`, `up`, `autoAdjustTransform`) is removed. `autoAdjustTransform` is now a serialized property/decorator on the class.
- `ContactShadowGroundPlugin` clear color: webgi uses black `Color(0,0,0)` clear and clearAlpha 0 always (line 99); threepipe defaults to white `Color(1,1,1)` clear with alpha 1 and toggles per mapMode (line 92, 241-243). For an existing webgi project loading json without the new `mapMode`, the default deserializes to `'aoMap'`, which inverts the expected output convention.
- `ContactShadowGroundPlugin.refresh` (threepipe) actively NULLs `alphaMap`/`aoMap`/`map` when `contactShadows` is toggled off (lines 185-202). Webgi just left them in place (only super._refreshMaterial ran). Thread-safety improvement but breaks any external code that grabs a ref to `mat.alphaMap`.
- `HDRiGroundPlugin`: webgi consults `SimpleBackgroundEnvUiPlugin` for prompt-driven environment toggle (lines 62-66); threepipe directly sets `scene.background = 'environment'` (`src/plugins/extras/HDRiGroundPlugin.ts:69`), and the prompt is gated by `promptOnBackgroundMismatch`. Use of `dialog.confirmSync` (line 62) requires a synchronous confirm primitive — different ergonomics from webgi's `confirm()`.
- `HDRiGroundPlugin.enabled` is no longer the only state — `isDisabled()` is consulted (line 83-86) so plugin state from `AViewerPluginSync.disable(uuid)` calls also affects the macro.
- `GeometryGeneratorPlugin._sceneUpdate` (webgi) traverses `e.object || modelRoot` on every `sceneUpdate` to attach UI configs (lines 44-58). Threepipe drives this via `Object3DManager` `objectAdd/objectRemove` events (`src/plugins/geometry/GeometryGeneratorPlugin.ts:115-117`) — narrower, no full-tree traversal.
- `GeometryGeneratorPlugin.generateObject` signature: webgi returns `obj.modelObject` (asset-manager wrapper output); threepipe returns `IMesh` directly with explicit type params. Callers must adapt.
- `AGeometryGenerator.createUiConfig` (webgi 56-62) directly assigns `u.onChange = () => this.generate(geometry)`. Threepipe returns `UiObjectConfig[]` after `flatMap(getOrCall)` (line 92-94) and then assigns onChange — handles function-valued ui entries.
- `AdvancedGroundPlugin._refreshMaterial` calls `super._refreshMaterial()` which (post-port) doesn't return `isNewMaterial`, so the "isNewMaterial" branch in webgi `GroundPlugin._refreshMaterial` (lines 218-219) that sets default roughness=0.75, metalness=0.5 etc. on first material assignment is **lost** in `AdvancedGroundPlugin`. The defaults still come from `_createMaterial` but if a user provides a custom material via `bindToValue`, those default tweaks no longer fire.
- `ViewerApp` event types: webgi has `'update'|'preRender'|'postRender'|'preFrame'|'postFrame'|'dispose'|'addPlugin'|'renderEnabled'|'renderDisabled'`; threepipe adds `'removePlugin'|'renderError'` (`src/viewer/ThreeViewer.ts:83-84`). Plugins listening should not collide.
- `AViewerPlugin`: webgi uses generic `<TEvent extends string>`, threepipe splits into `AViewerPluginSync` and async base with `AViewerPluginEventMap`. Plugin lifecycle in threepipe is sync (`onAdded/onRemove` not `Promise<void>`).
- `WatchHandsPlugin` (threepipe-webgi): uses `getPlugin` instead of `getPluginByType` and `'ProgressivePlugin'` instead of `'Progressive'` (key change). External code targeting webgi's old key won't find the plugin.
- `_extraUiConfig` ordering: webgi `GroundPlugin._extraUiConfig` puts material UI **last** via `...super._extraUiConfig()` (line 372) which appends `this._material?.uiConfig`. `AdvancedGroundPlugin` (threepipe-webgi line 73-81) constructs its UI in the constructor and rearranges so that the material UI is appended after `_extraUiConfig` rather than at the bottom of `super._extraUiConfig` — for users who used to see Material at the bottom of the panel, ordering changes.

## API / signature drift

- `AViewerPlugin` async lifecycle: `onAdded/onRemove/onDispose` are `Promise<void>` in webgi; in threepipe `AViewerPluginSync` they are sync. Subclasses ported from webgi must drop `await super.onAdded(viewer)` and use synchronous patterns.
- `BaseGroundPlugin` constructor: webgi `constructor(options: Partial<GroundOptions> = {})` — threepipe `constructor()` (no options). Migration must move `up`, `shape`, `autoAdjustTransform` to property assignments.
- `BaseGroundPlugin.refresh()` replaces `refreshOptions()` (renamed) and `setOptions()` is removed.
- `BaseGroundPlugin.material` getter now `IMaterial|undefined` (was `MeshStandardMaterial2|undefined`).
- `BaseGroundPlugin.mesh` getter now `Mesh2<IGeometry&PlaneGeometry, IMaterial>` (was `IModel<TMesh>` wrapping the asset-manager model).
- `ContactShadowGroundPlugin._depthPass` typed `GBufferRenderPass<'contactShadowGround', WebGLRenderTarget|undefined>` (threepipe) vs `GBufferRenderPass<WebGLRenderTarget>` (webgi). Two-arg generic vs one-arg.
- `HDRiGroundPlugin.setDirty` is the public `_paramsChanged` rename.
- `GeometryGeneratorPlugin.generateObject<T,Tg,Tm,Tg>` adds extensive generics.
- `AGeometryGenerator.generate` second param defaults to `Partial<Tp>` (was `T` in webgi). Allows partial overrides to be merged with persisted `userData.generationParams`.
- `RandomizedDirectionalLight` import path: threepipe-webgi `src/utils/RandomizedDirectionalLight.ts`; webgi `extras/RandomizedDirectionalLight.ts`. Different, since plugin is unported, the helper is now an internal util only.
- `Reflector2` constructor: webgi `Reflector2(geometry, target)`; threepipe-webgi `Reflector2<TG>(geometry, ()=>target, 0, material)` (lazy target callback + material arg) — `experiments/threepipe-webgi/src/plugins/extras/AdvancedGroundPlugin.ts:86-97`.
- `CanvasSnipperPlugin` → `CanvasSnapshotPlugin` (`PluginType` changed from `'CanvasSnipper'` to `'CanvasSnapshotPlugin'`). Existing serialized config files referencing `'CanvasSnipper'` will not deserialize.
- `Box3B.expandByObject` adds optional `ignoreObject` callback in both, but threepipe extends with `geometry`-based precise computation requiring `position` attribute access.
- `GeometryGeneratorPlugin.generateObject` returns `IMesh` directly in threepipe; webgi returned `obj.modelObject` (the inner three.js mesh from asset-manager wrapper).

## Notes / open questions

- **TextureProjector port plan**: 1109 lines + the plugin (441 lines) + projection mapping shader (`projectionMapping.glsl`) need a dedicated audit/issue. Question: which parts of the API map cleanly to existing material extensions? `MaterialExtension` exists in core; `userData._projectionMapping` keys could move into `Mesh2.userData` cleanly. The orbit/FOV camera UI overlaps with what `CameraView` plugins already do — should the projector reuse `OrbitControls3` or keep a stripped-down internal one? Multi-projector limit is currently driven by `DEBUG_COLORS.length = 8` (line 56-65 in `TextureProjector.ts`); core would need to decide on a hard limit / dynamic uniform array sizing.
- **SimpleTextPlugin**: threepipe already has `TextSVG.ts` (utility) and `TroikaTextPlugin` (3D text via troika). The webgi plugin is a *texture* projector for selected meshes. If we port, it should probably live in `plugins/svg-renderer` or a new `plugins/text-on-mesh` package, sharing `TextSVG.ts`. The projection-mapping subset overlaps with `TextureProjectorPlugin`.
- **CanvasRecorderPlugin**: the convergence-aware `IConvergedCanvasRecorder` API is wired into core `ProgressivePlugin`. The actual recorder implementations (`CanvasMediaRecorder`, `FFMPEGRecorder`, `ImageSequenceRecorder`) bring fflate / ffmpeg.js dependencies → likely belongs in a separate plugin package (`@threepipe/plugin-canvas-recorder`).
- **CSG plugins**: `CSGPluginBSP` uses three-csg-ts; `CSGPluginBVH` uses three-bvh-csg. These should be a separate plugin package (`@threepipe/plugin-csg`) to keep core dep-free. CSGPluginBase (179 lines) provides the shared UI / picking logic.
- **AdvancedGroundPlugin promotion**: should `experiments/threepipe-webgi/src/plugins/extras/AdvancedGroundPlugin.ts` be promoted to `src/plugins/extras/` (alongside ContactShadow + HDRi) or split into a package? Reflector2/ShadowMapBaker/RandomizedDirectionalLight/FSShadowMaterial all need to come along. Note the deprecated alias `export const GroundPlugin = AdvancedGroundPlugin` (line 377) — once promoted, any third-party referencing `GroundPlugin` needs to keep that alias.
- **`ssaoDisabled`/`sscsDisabled` defaults**: webgi `BaseGroundPlugin._refreshMaterial` set these on every ground material (lines 332-333). Threepipe core `BaseGroundPlugin._refreshMaterial` does not (commented-out at lines 298-299 with `//todo should be in BakedGroundPlugin`); only `AdvancedGroundPlugin` reapplies. Decision: should this move to `BaseGroundPlugin` (matching webgi) or stay scoped to baked/advanced ground?
- **`HDRiGroundPlugin` global ShaderLib mutation**: both webgi and threepipe permanently modify `ShaderLib.backgroundCube.fragmentShader` (line 100-115 / 101-119). With multiple viewers or hot reload, this leaks. Worth a flag in issues/open.
- **`useModelBounds` default flip** (false → true) is silent: existing webgi configs migrated to threepipe will see different ground transforms. Worth documenting in the migration notes if not already done.
- **`extras/devices/`**: `MouseInputDevice`/`GyroInputDevice`/`InputDevice` abstraction is used by `ParallaxCameraControllerPlugin`. The threepipe equivalent (`src/three/controls/DeviceOrientationControls2.ts`) is a three.js-controls port without the input-abstraction. If `ParallaxCameraControllerPlugin` is intended for threepipe, the device layer needs to come along.
- **`EnvMapToolPlugin` + `EnvMapLoaderThree`**: legacy CubeTexture/RGBM-based envmap loader and the `fix_cube_lookup` material extension. Modern threepipe uses CubeUV-only flows (`CubeTexture` mip filtering hack is no longer needed). Verify whether any user-facing flows still depend on this; if not, it can probably be dropped from the port list.
- **`GeometryGeneratorPlugin` deprecation shim**: the shim in `plugins/geometry-generator/src/GeometryGeneratorExtrasPlugin.ts:55-65` will eventually be removed. Make sure migration docs call this out before cutting it.

# WebGPU Phase 1: RenderManager & Renderer Access Audit

**Date:** 2026-03-24
**Purpose:** Catalog every file in `src/` and `plugins/` that accesses `renderManager.*` or `renderer.*` APIs, classify each access pattern, and recommend an interface split for `IRenderManager` (backend-agnostic) vs `IWebGLRenderManager` (WebGL-specific).

---

## Classification Key

| Category | Meaning | Target Interface |
|----------|---------|------------------|
| **A** | Backend-agnostic: render/reset/resize, targets, blit, events, clock, frame counts | `IRenderManager` |
| **B** | Pipeline-specific: pass registration, pipeline ordering, screen/render pass, gbuffer | `IRenderManager` (with abstraction) |
| **C** | WebGL-specific: direct `renderer.*` access, WebGL context, `composer`, `msaa`, `isWebGL2`, `webglRenderer` | `IWebGLRenderManager` |

---

## File-by-File Audit

### src/rendering/RenderManager.ts
- **Categories:** A, B, C (core implementation)
- **Access patterns:** This IS the render manager. Implements all APIs. Uses `_renderer.getContext()`, `_renderer.capabilities`, `_renderer.shadowMap`, `_renderer.toneMapping`, `_renderer.toneMappingExposure`, `_renderer.outputColorSpace`, `_renderer.setRenderTarget()`, `_renderer.clear()`, `_renderer.renderWithModes()`, `_renderer.setSize()`, `_renderer.setPixelRatio()`, `_renderer.readRenderTargetPixels()`, `_renderer.getClearColor()`, `_renderer.setClearColor()`, `_renderer.autoClear`, `_renderer.getViewport()`, `_renderer.setViewport()`, `_renderer.getScissor()`, `_renderer.setScissor()`, `_renderer.setScissorTest()`, `_renderer.getRenderTarget()`, `_renderer.dispose()`
- **Can work with A only?** No. This is the implementation that must be split into base + WebGL subclass.

### src/viewer/ViewerRenderManager.ts
- **Categories:** A, B, C
- **Access patterns:** `_renderer.userData`, `renderPass`, `screenPass`, `rgbm`, `msaa`, `isWebGL2`, `zPrepass`, `gbufferTarget`, `gbufferUnpackExtension`, `maxHDRIntensity`
- **Can work with A only?** No. Extends RenderManager with pipeline-specific (B) and WebGL-specific (C) props.

### src/viewer/ThreeViewer.ts
- **Categories:** A, B, C
- **A APIs:** `renderManager.resetShadows()`, `renderManager.addEventListener()`, `renderManager.dispose()`, `renderManager.reset()`, `renderManager.setSize()`, `renderManager.needsRender`, `renderManager.render()`, `renderManager.renderScale`, `renderManager.onPostFrame()`
- **B APIs:** `renderManager.defaultRenderToScreen`
- **C APIs:** `renderManager.webglRenderer.xr`, `renderManager.useLegacyLights`
- **Can work with A only?** No. XR and useLegacyLights are WebGL-specific.

### src/postprocessing/ExtendedRenderPass.ts
- **Categories:** A, B, C
- **A APIs:** `renderManager.getTempTarget()`, `renderManager.releaseTempTarget()`, `renderManager.composerTarget`, `renderManager.blit()`
- **B APIs:** `renderManager.renderPass`, `renderManager.gbufferTarget`, `renderManager.rgbm`, `renderManager.zPrepass`, `renderManager.depthBuffer`, `renderManager.msaa`, `renderManager.maxHDRIntensity`, `renderManager.screenPass` (implicit)
- **C APIs:** `renderManager.renderer.extensions.has()`, `renderer.userData`, `renderer.properties.get()`, `renderer.renderWithModes()`, `renderer.info`, `renderer.setRenderTarget()` (implicit via EffectComposer)
- **Can work with A only?** No. Core pipeline pass, deeply WebGL-coupled.

### src/postprocessing/ScreenPass.ts
- **Categories:** A, B, C
- **A APIs:** (none directly on renderManager)
- **B APIs:** `renderManager.renderPass` (accessed via method param)
- **C APIs:** `renderManager.renderer` (passed to `reRender`), `renderer.outputColorSpace` (set/restored during render)
- **Can work with A only?** No. Render pass with direct renderer access.

### src/postprocessing/ExtendedShaderPass.ts
- **Categories:** C
- **C APIs:** `renderer.renderWithModes()`
- **Can work with A only?** No.

### src/postprocessing/GBufferRenderPass.ts
- **Categories:** C
- **C APIs:** `renderer.renderWithModes()`, `renderer.setRenderTarget()`
- **Can work with A only?** No.

### src/postprocessing/EffectComposer2.ts
- **Categories:** C
- **C APIs:** Wraps three.js `EffectComposer` which takes `WebGLRenderer`
- **Can work with A only?** No. Core WebGL compositor.

### src/assetmanager/AssetManager.ts
- **Categories:** C
- **C APIs:** `viewer.renderManager.renderer` (passed to `getTextureDataType()` which checks `renderer.extensions`, `renderer.capabilities`)
- **Can work with A only?** No. Needs renderer capability detection for texture data type.

### src/assetmanager/AssetExporter.ts
- **Categories:** A
- **A APIs:** `obj.renderManager.exportRenderTarget()`
- **Can work with A only?** Yes (if `exportRenderTarget` is on base interface).

### src/assetmanager/export/EXRExporter2.ts
- **Categories:** C
- **C APIs:** `target.renderManager.webglRenderer` (passed to three.js EXRExporter.parse)
- **Can work with A only?** No. EXR export uses WebGL readback.

### src/utils/serialization.ts
- **Categories:** A
- **A APIs:** `renderManager.createTarget()`
- **Can work with A only?** Yes.

### src/utils/AnimationObject.ts
- **Categories:** A
- **A APIs:** `renderManager.reset()`
- **Can work with A only?** Yes.

### src/three/utils/HVBlurHelper.ts
- **Categories:** A
- **A APIs:** `viewer.renderManager.blit()`
- **Can work with A only?** Yes.

### src/three/utils/texture.ts
- **Categories:** C
- **C APIs:** `renderer.extensions.has()`, `renderer.capabilities.isWebGL2`
- **Can work with A only?** No. WebGL capability detection utility.

### src/three/utils/snapObject.ts
- **Categories:** C
- **C APIs:** `renderer.setRenderTarget()`, `renderer.clear()`, `renderer.renderWithModes()`, `renderer.render()`
- **Can work with A only?** No. Direct renderer calls for snapshot rendering.

### src/three/utils/MaterialPreviewGenerator.ts
- **Categories:** C
- **C APIs:** Takes `IWebGLRenderer` param, passes to `snapObject()`
- **Can work with A only?** No.

### src/three/utils/ViewHelper2.ts
- **Categories:** C (but self-contained)
- **C APIs:** Creates its own `WebGLRenderer` instance, uses `renderer.render()`, `renderer.autoClear`
- **Note:** Does NOT use the main renderManager. Creates its own WebGL context.
- **Can work with A only?** N/A - self-contained WebGL usage.

### src/materials/MaterialExtender.ts
- **Categories:** C
- **C APIs:** Uses `IWebGLRenderer` type in `materialBeforeRender`/`materialAfterRender` callbacks
- **Can work with A only?** No. Material callbacks receive the renderer.

### src/materials/MaterialExtension.ts
- **Categories:** C
- **C APIs:** `IWebGLRenderer` type in `onObjectRender` and `onAfterRender` signatures
- **Can work with A only?** No. Interface definition uses WebGL types.

### src/rendering/RenderTarget.ts
- **Categories:** C
- **C APIs:** `IWebGLRenderer` type in `clear()` method signature
- **Can work with A only?** Mostly, but `clear()` takes `IWebGLRenderer`.

### src/rendering/RenderTargetManager.ts
- **Categories:** A
- **A APIs:** `createTarget()`, `getTempTarget()`, `releaseTempTarget()`, `disposeTarget()`, `trackTarget()`
- **Can work with A only?** Yes. Base class is already abstract.

### src/core/IRenderer.ts
- **Categories:** A, B, C (interface definitions)
- **Contains:** `IRenderManager` interface, `IWebGLRenderer` interface, `IRenderManagerEventMap`, `RendererBlitOptions`
- **Note:** This is the file that needs to be split.

### src/core/object/RootScene.ts
- **Categories:** B (commented out)
- **B APIs:** `renderManager.gbufferTarget` (in comment only)
- **Can work with A only?** Yes (access is in a comment).

### src/plugins/base/PipelinePassPlugin.ts
- **Categories:** B
- **B APIs:** `renderManager.registerPass()`, `renderManager.unregisterPass()`
- **Can work with A only?** No. Needs pass registration (Category B).

### src/plugins/extras/ContactShadowGroundPlugin.ts
- **Categories:** A, C
- **A APIs:** `renderManager.createTarget()`, `renderManager.disposeTarget()`, `renderManager.getTempTarget()`, `renderManager.releaseTempTarget()`
- **C APIs:** `renderManager.renderer` (passed to depth pass render call)
- **Can work with A only?** No. Passes renderer to depth pass.

### src/plugins/extras/HDRiGroundPlugin.ts
- **Categories:** C
- **C APIs:** `renderManager.renderer.background.getBoxMesh2()`, `renderManager.webglRenderer?.background.getBoxMesh()`
- **Can work with A only?** No. Accesses internal three.js WebGLBackground.

### src/plugins/animation/GLTFAnimationPlugin.ts
- **Categories:** A
- **A APIs:** `renderManager.resetShadows()`
- **Can work with A only?** Yes.

### src/plugins/animation/TransformAnimationPlugin.ts
- **Categories:** A
- **A APIs:** `renderManager.resetShadows()`
- **Can work with A only?** Yes.

### src/plugins/rendering/CascadedShadowsPlugin.ts
- **Categories:** A
- **A APIs:** `renderManager.resetShadows()`, `renderManager.addEventListener('resize')`, `renderManager.removeEventListener('resize')`
- **Can work with A only?** Yes.

### src/plugins/rendering/VirtualCamerasPlugin.ts
- **Categories:** A, B, C
- **A APIs:** `renderManager.render()`, `renderManager.blit()`, `renderManager.composerTarget`
- **C APIs:** `renderManager.composer.readBuffer.texture`
- **Can work with A only?** No. Accesses `composer.readBuffer` directly.

### src/plugins/postprocessing/AScreenPassExtensionPlugin.ts
- **Categories:** B
- **B APIs:** `renderManager.screenPass.setDirty()`, `renderManager.screenPass.material.registerMaterialExtensions()`, `renderManager.screenPass.material.unregisterMaterialExtensions()`
- **Can work with A only?** No. Needs screen pass access (Category B).

### src/plugins/postprocessing/TonemapPlugin.ts
- **Categories:** B, C
- **B APIs:** `renderManager.screenPass.clipBackground`
- **C APIs:** `renderer.toneMapping`, `renderer.toneMappingExposure` (set/restored during render)
- **Can work with A only?** No.

### src/plugins/pipeline/SSAOPlugin.ts
- **Categories:** A, B, C
- **A APIs:** `renderManager.createTarget()`, `renderManager.disposeTarget()`, `renderManager.blit()`, `renderManager.addEventListener()`
- **B APIs:** `renderManager.gbufferTarget`, `renderManager.gbufferUnpackExtension`, `renderManager.screenPass` (implicit)
- **C APIs:** `renderer.userData.screenSpaceRendering`, `renderManager.webglRenderer.domElement.height`
- **Can work with A only?** No.

### src/plugins/pipeline/DepthBufferPlugin.ts
- **Categories:** A, B, C
- **A APIs:** `renderManager.createTarget()`, `renderManager.disposeTarget()`
- **B APIs:** `renderManager.gbufferTarget`, `renderManager.gbufferUnpackExtension`, `renderManager.screenPass`, `renderManager.zPrepass`, `renderManager.msaa`
- **C APIs:** `renderer.resetCurrentMaterial()`
- **Can work with A only?** No.

### src/plugins/pipeline/GBufferPlugin.ts
- **Categories:** A, B, C
- **A APIs:** `renderManager.createTarget()`, `renderManager.disposeTarget()`
- **B APIs:** `renderManager.gbufferTarget`, `renderManager.gbufferUnpackExtension`, `renderManager.screenPass`, `renderManager.zPrepass`, `renderManager.msaa`
- **C APIs:** `renderManager.isWebGL2`
- **Can work with A only?** No.

### src/plugins/pipeline/GBufferMaterial.ts
- **Categories:** C
- **C APIs:** `renderer.materials.refreshTransformUniform()`, `renderer.resetCurrentMaterial()`
- **Can work with A only?** No. Uses WebGL-internal `renderer.materials`.

### src/plugins/pipeline/NormalBufferPlugin.ts
- **Categories:** A, C
- **A APIs:** `renderManager.createTarget()`, `renderManager.disposeTarget()`
- **C APIs:** `renderer.resetCurrentMaterial()`
- **Can work with A only?** No.

### src/plugins/pipeline/FrameFadePlugin.ts
- **Categories:** A, B
- **A APIs:** `renderManager.getTempTarget()`, `renderManager.releaseTempTarget()`, `renderManager.composerTarget`, `renderManager.blit()`, `renderManager.frameCount`
- **B APIs:** `renderManager.maxHDRIntensity`
- **Can work with A only?** No. Needs `maxHDRIntensity`.

### src/plugins/pipeline/SSAAPlugin.ts
- **Categories:** A
- **A APIs:** `renderManager.frameCount`, `renderManager.renderSize`, `renderManager.renderScale`, `renderManager.resetShadows()`
- **Can work with A only?** Yes.

### src/plugins/pipeline/ProgressivePlugin.ts
- **Categories:** A, B, C
- **A APIs:** `renderManager.frameCount`, `renderManager.composerTarget`, `renderManager.disposeTarget()`, `renderManager.blit()`
- **B APIs:** `renderManager.maxHDRIntensity`
- **C APIs:** `renderManager.composerTarget.clone(true) as WebGLRenderTarget`
- **Can work with A only?** No.

### src/plugins/import/KTX2LoadPlugin.ts
- **Categories:** C
- **C APIs:** `viewer.renderManager.renderer` (passed to `KTX2Loader.detectSupport()`)
- **Can work with A only?** No. KTX2 transcoder needs WebGL renderer for capability detection.

### src/plugins/ui/RenderTargetPreviewPlugin.ts
- **Categories:** A, C
- **A APIs:** `renderManager.blit()`, `renderManager.exportRenderTarget()`
- **C APIs:** `renderManager.webglRenderer.outputColorSpace` (get/set/restore)
- **Can work with A only?** No.

### src/plugins/export/CanvasSnapshotPlugin.ts
- **Categories:** A
- **A APIs:** `renderManager.renderScale` (get/set)
- **Can work with A only?** Yes.

### src/plugins/configurator/SwitchNodeBasePlugin.ts
- **Categories:** C
- **C APIs:** `renderManager.renderer` (passed to `snapObject()`)
- **Can work with A only?** No.

### src/plugins/configurator/MaterialConfiguratorBasePlugin.ts
- **Categories:** C
- **C APIs:** `renderManager.renderer` (passed to `MaterialPreviewGenerator.generate()`)
- **Can work with A only?** No.

---

### External Plugins (plugins/ directory)

### plugins/3d-tiles-renderer/src/TilesRendererPlugin.ts
- **Categories:** A, C
- **A APIs:** `renderManager.addEventListener('preRender')`, `renderManager.addEventListener('resize')`, `renderManager.removeEventListener()`, `renderManager.frameCount`
- **C APIs:** `renderManager.webglRenderer` (passed to `tilesRenderer.setResolutionFromRenderer()`)
- **Can work with A only?** No. Tile LOD needs WebGL renderer for resolution.

### plugins/gaussian-splatting/src/three-gaussian-splat/ThreeGaussianSplatPlugin.ts
- **Categories:** C
- **C APIs:** `renderManager.webglRenderer` (passed to splat `.update()`)
- **Can work with A only?** No.

### plugins/tweakpane/src/tpImageInputGenerator.ts
- **Categories:** A, C
- **A APIs:** `renderManager.renderTargetToDataUrl()`, `renderManager.exportRenderTarget()`
- **C APIs:** `WebGLRenderTarget` cast in `exportRenderTarget` call
- **Can work with A only?** Mostly. The `exportRenderTarget` signature currently requires `WebGLRenderTarget`.

### plugins/troika-text/src/TroikaTextPlugin.ts
- **Categories:** A
- **A APIs:** `renderManager.resetShadows()`
- **Can work with A only?** Yes.

### plugins/path-tracing/src/ThreeGpuPathTracerPlugin.ts
- **Categories:** A, B, C
- **A APIs:** `renderManager.frameCount`, `renderManager.blit()` (implicit via screenPass render)
- **B APIs:** `renderManager.defaultRenderToScreen`, `renderManager.screenPass`, `renderManager.renderer` (passed to screenPass.render), `renderManager.incRenderToScreen()`
- **C APIs:** `renderManager.webglRenderer` (constructor param for WebGLPathTracer2), `renderManager.webglRenderer.outputColorSpace` (get/set/restore)
- **Can work with A only?** No. Inherently WebGL (path tracing via WebGL2 compute).

### plugins/svg-renderer/src/BasicSVGRendererPlugin.ts
- **Categories:** A
- **A APIs:** `renderManager.addEventListener('resize')`, `renderManager.removeEventListener('resize')`
- **Can work with A only?** Yes.

### plugins/svg-renderer/src/ThreeSVGRendererPlugin.ts
- **Categories:** A
- **A APIs:** `renderManager.addEventListener('resize')`, `renderManager.removeEventListener('resize')`
- **Can work with A only?** Yes.

---

## Summary Table

| File | A | B | C | A-only? |
|------|---|---|---|---------|
| **src/rendering/RenderManager.ts** | x | x | x | No |
| **src/viewer/ViewerRenderManager.ts** | x | x | x | No |
| **src/viewer/ThreeViewer.ts** | x | x | x | No |
| **src/postprocessing/ExtendedRenderPass.ts** | x | x | x | No |
| **src/postprocessing/ScreenPass.ts** | | x | x | No |
| **src/postprocessing/ExtendedShaderPass.ts** | | | x | No |
| **src/postprocessing/GBufferRenderPass.ts** | | | x | No |
| **src/postprocessing/EffectComposer2.ts** | | | x | No |
| **src/assetmanager/AssetManager.ts** | | | x | No |
| **src/assetmanager/AssetExporter.ts** | x | | | **Yes** |
| **src/assetmanager/export/EXRExporter2.ts** | | | x | No |
| **src/utils/serialization.ts** | x | | | **Yes** |
| **src/utils/AnimationObject.ts** | x | | | **Yes** |
| **src/three/utils/HVBlurHelper.ts** | x | | | **Yes** |
| **src/three/utils/texture.ts** | | | x | No |
| **src/three/utils/snapObject.ts** | | | x | No |
| **src/three/utils/MaterialPreviewGenerator.ts** | | | x | No |
| **src/three/utils/ViewHelper2.ts** | | | x | No (self-contained) |
| **src/materials/MaterialExtender.ts** | | | x | No |
| **src/materials/MaterialExtension.ts** | | | x | No |
| **src/rendering/RenderTarget.ts** | | | x | No |
| **src/rendering/RenderTargetManager.ts** | x | | | **Yes** |
| **src/core/IRenderer.ts** | x | x | x | No (defs) |
| **src/plugins/base/PipelinePassPlugin.ts** | | x | | No |
| **src/plugins/extras/ContactShadowGroundPlugin.ts** | x | | x | No |
| **src/plugins/extras/HDRiGroundPlugin.ts** | | | x | No |
| **src/plugins/animation/GLTFAnimationPlugin.ts** | x | | | **Yes** |
| **src/plugins/animation/TransformAnimationPlugin.ts** | x | | | **Yes** |
| **src/plugins/rendering/CascadedShadowsPlugin.ts** | x | | | **Yes** |
| **src/plugins/rendering/VirtualCamerasPlugin.ts** | x | | x | No |
| **src/plugins/postprocessing/AScreenPassExtensionPlugin.ts** | | x | | No |
| **src/plugins/postprocessing/TonemapPlugin.ts** | | x | x | No |
| **src/plugins/pipeline/SSAOPlugin.ts** | x | x | x | No |
| **src/plugins/pipeline/DepthBufferPlugin.ts** | x | x | x | No |
| **src/plugins/pipeline/GBufferPlugin.ts** | x | x | x | No |
| **src/plugins/pipeline/GBufferMaterial.ts** | | | x | No |
| **src/plugins/pipeline/NormalBufferPlugin.ts** | x | | x | No |
| **src/plugins/pipeline/FrameFadePlugin.ts** | x | x | | No |
| **src/plugins/pipeline/SSAAPlugin.ts** | x | | | **Yes** |
| **src/plugins/pipeline/ProgressivePlugin.ts** | x | x | x | No |
| **src/plugins/import/KTX2LoadPlugin.ts** | | | x | No |
| **src/plugins/ui/RenderTargetPreviewPlugin.ts** | x | | x | No |
| **src/plugins/export/CanvasSnapshotPlugin.ts** | x | | | **Yes** |
| **src/plugins/configurator/SwitchNodeBasePlugin.ts** | | | x | No |
| **src/plugins/configurator/MaterialConfiguratorBasePlugin.ts** | | | x | No |
| **plugins/3d-tiles-renderer** | x | | x | No |
| **plugins/gaussian-splatting** | | | x | No |
| **plugins/tweakpane** | x | | x | No |
| **plugins/troika-text** | x | | | **Yes** |
| **plugins/path-tracing** | x | x | x | No |
| **plugins/svg-renderer (Basic)** | x | | | **Yes** |
| **plugins/svg-renderer (Three)** | x | | | **Yes** |

---

## Statistics

| Metric | Count |
|--------|-------|
| Total files accessing renderManager/renderer | **50** |
| Files that are A-only (backend-agnostic) | **13** (26%) |
| Files that need B (pipeline) | **18** (36%) |
| Files that need C (WebGL-specific) | **37** (74%) |
| Files that need both B and C | **13** (26%) |

### A-only files (can work with just IRenderManager):
1. `src/assetmanager/AssetExporter.ts`
2. `src/utils/serialization.ts`
3. `src/utils/AnimationObject.ts`
4. `src/three/utils/HVBlurHelper.ts`
5. `src/rendering/RenderTargetManager.ts`
6. `src/plugins/animation/GLTFAnimationPlugin.ts`
7. `src/plugins/animation/TransformAnimationPlugin.ts`
8. `src/plugins/rendering/CascadedShadowsPlugin.ts`
9. `src/plugins/pipeline/SSAAPlugin.ts`
10. `src/plugins/export/CanvasSnapshotPlugin.ts`
11. `plugins/troika-text/src/TroikaTextPlugin.ts`
12. `plugins/svg-renderer/src/BasicSVGRendererPlugin.ts`
13. `plugins/svg-renderer/src/ThreeSVGRendererPlugin.ts`

---

## Recommendations for Interface Split

### 1. Base `IRenderManager` Interface (Backend-Agnostic)

Keep these on the base interface -- they have no WebGL dependency:

```
render(scene, renderToScreen?)
reset()
resetShadows()
setSize(width, height)
renderSize (readonly)
renderScale (get/set)
frameCount (readonly)
totalFrameCount (readonly)
clock
needsRender (readonly)
setDirty(reset?)
rebuildPipeline(setDirty?)
defaultRenderToScreen

// Render target management (already in RenderTargetManager base)
createTarget(options)
createTargetCustom(size, options)
getTempTarget(options)
releaseTempTarget(target)
disposeTarget(target)
trackTarget(target)
composerTarget (readonly -- abstract over the "current output target")

// Operations
blit(destination, options)
clearColor(options)
renderTargetToDataUrl(target, ...)
renderTargetToBuffer(target)
exportRenderTarget(target, ...)

// Events
addEventListener / removeEventListener / dispatchEvent
dispose(clear?)

// Pipeline management (move from B to base -- both backends need pipelines)
registerPass(pass)
unregisterPass(pass)
passes (readonly)
pipeline (get/set)
refreshPasses()

// Frame lifecycle
onPostFrame()
incRenderToScreen()
```

### 2. `IViewerRenderManager` Extension (Pipeline-aware, still backend-agnostic)

These are viewer-specific but not WebGL-specific:

```
screenPass (readonly)
renderPass (readonly)
gbufferTarget
gbufferUnpackExtension
rgbm (readonly)
msaa (readonly -- but semantics change per backend)
depthBuffer (readonly)
zPrepass (readonly)
maxHDRIntensity (readonly)
```

**Decision needed:** `msaa` and `isWebGL2` are currently used as feature flags. For WebGPU, `msaa` maps to `multisample` in render pipeline descriptors, and `isWebGL2` should become a more general `capabilities` object.

### 3. `IWebGLRenderManager` Extension (WebGL-only)

These MUST stay WebGL-specific:

```
renderer (IWebGLRenderer) -- the raw three.js WebGLRenderer
webglRenderer (WebGLRenderer) -- alias for renderer
context (WebGLRenderingContext)
isWebGL2 (boolean)
composer (EffectComposer2)
useLegacyLights (deprecated, WebGL-only)
```

### 4. Key Refactoring Actions

#### High Priority (blocking backend abstraction)

1. **Abstract `renderTargetToBuffer` / `renderTargetToDataUrl` / `exportRenderTarget`**: These currently use `WebGLRenderer.readRenderTargetPixels()`. Need a backend-agnostic `readback` abstraction.

2. **Abstract `blit`**: Currently implemented via `EffectComposer2.copyPass` and `renderer.renderWithModes()`. Needs a backend-agnostic blit operation.

3. **Abstract `clearColor`**: Currently uses `renderer.setRenderTarget()` + `renderer.clear()`. Straightforward to abstract.

4. **Replace `IWebGLRenderer` in material callbacks**: `MaterialExtension.onObjectRender` and `MaterialExtender` pass `IWebGLRenderer` to all material extension callbacks. Need a backend-agnostic `IRenderer` type for these signatures.

5. **Replace `WebGLRenderTarget` in function signatures**: `IRenderManager` interface currently uses `WebGLRenderTarget` in `renderTargetToDataUrl`, `renderTargetToBuffer`, and `exportRenderTarget`. These need to accept `IRenderTarget` instead.

6. **`renderer.renderWithModes()`**: Used by ExtendedRenderPass, ExtendedShaderPass, GBufferRenderPass, SSAOPlugin, snapObject, and RenderManager.blit. This is a custom three.js mod. Need to decide: keep as WebGL-specific, or abstract the concept of "render mode flags" into the base interface.

7. **`renderer.resetCurrentMaterial()`**: Another custom three.js mod, used by DepthBufferPlugin, GBufferMaterial, NormalBufferPlugin. WebGL-specific state management.

8. **`renderer.properties.get()`**: Used by ExtendedRenderPass to access internal WebGL framebuffer objects. Deeply WebGL-specific.

9. **`renderer.materials.refreshTransformUniform()`**: Used by GBufferMaterial. WebGL-specific internal API.

#### Medium Priority (plugin refactoring)

10. **Plugins that pass `renderManager.renderer` to external libraries**: KTX2LoadPlugin, 3d-tiles-renderer, gaussian-splatting, path-tracing all pass the raw WebGL renderer to third-party code. These plugins will need WebGPU-specific counterparts or the libraries need to support both backends.

11. **`renderer.background.getBoxMesh2()`**: HDRiGroundPlugin accesses internal three.js WebGLBackground. Extremely WebGL-specific.

12. **`snapObject()` utility**: Takes `IWebGLRenderer`, does direct renderer calls. Needs a backend-agnostic version or stays WebGL-only.

#### Low Priority (can defer)

13. **`EffectComposer2` replacement**: For WebGPU, the entire post-processing pipeline will use a different compositor. The `composer` property should be WebGL-only.

14. **`renderManager.isWebGL2`**: Used as a feature flag by GBufferPlugin. Replace with a capabilities object: `renderManager.capabilities.multipleRenderTargets`, `renderManager.capabilities.msaa`, etc.

15. **`WebGLRenderTarget` type usage**: 22 files in src/ import this type. Many can switch to `IRenderTarget` with minimal changes. Some (like EffectComposer2, EXRExporter2) are inherently tied to WebGL.

### 5. Suggested File Structure

```
src/core/IRenderer.ts
  -> Split into:
     src/core/IRenderManager.ts       (base interface, Category A + B)
     src/core/IWebGLRenderManager.ts  (WebGL extension, Category C)
     src/core/IRenderer.ts            (IRenderer base, IWebGLRenderer)

src/rendering/RenderManager.ts
  -> Split into:
     src/rendering/BaseRenderManager.ts    (A + B implementation, no WebGL)
     src/rendering/WebGLRenderManager.ts   (C implementation, extends Base)
```

### 6. Migration Path

**Phase 1a (interface only, no runtime changes):**
- Define `IRenderManager` with only A + B APIs
- Define `IWebGLRenderManager extends IRenderManager` with C APIs
- Update type annotations in A-only files to use `IRenderManager`
- No behavioral changes -- existing `RenderManager` class implements both

**Phase 1b (plugin type narrowing):**
- Plugins that need C access cast to `IWebGLRenderManager` explicitly
- This makes the dependency visible and auditable

**Phase 2 (implementation split):**
- Extract `BaseRenderManager` with A + B implementation
- `WebGLRenderManager extends BaseRenderManager` adds C
- Future `WebGPURenderManager extends BaseRenderManager` adds WebGPU-specific

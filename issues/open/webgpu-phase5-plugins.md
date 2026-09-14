# Phase 5: Plugin Compatibility Audit & Migration

**Parent**: [webgpu-renderer-support.md](./webgpu-renderer-support.md)
**Status**: Not started
**Priority**: Medium
**Estimated effort**: 2-3 weeks
**Depends on**: Phase 1 (IRenderManager cleanup), Phase 2 (WebGPURenderManager)

## Goal

Categorize every plugin by WebGPU compatibility. Add compatibility metadata. Ensure incompatible plugins fail gracefully on WebGPU. Make compatible plugins work on both.

## Plugin Compatibility Tiers

### Tier 1: Works on Both Backends (no changes or minor changes)

These plugins don't touch renderer internals. They work through the `IRenderManager` interface, scene graph, asset management, or pure UI.

| Plugin | File | Changes Needed |
|---|---|---|
| **CanvasSnapshotPlugin** | `src/plugins/export/CanvasSnapshotPlugin.ts` | None — reads from canvas |
| **SSAAPlugin** | `src/plugins/pipeline/SSAAPlugin.ts` | None — only manipulates camera jitter |
| **FileTransferPlugin** | `src/plugins/interaction/FileTransferPlugin.ts` | None — file I/O only |
| **DropzonePlugin** | `src/plugins/interaction/DropzonePlugin.ts` | None — DOM events only |
| **PickingPlugin** | `src/plugins/interaction/PickingPlugin.ts` | Verify raycasting works on WebGPU |
| **TransformControlsPlugin** | `src/plugins/interaction/TransformControlsPlugin.ts` | Verify gizmo rendering |
| **FullScreenPlugin** | `src/plugins/interaction/FullScreenPlugin.ts` | None — DOM fullscreen API |
| **PopmotionPlugin** | `src/plugins/animation/PopmotionPlugin.ts` | None — animation/tween |
| **CameraViewPlugin** | `src/plugins/animation/CameraViewPlugin.ts` | None — camera animation |
| **GLTFAnimationPlugin** | `src/plugins/animation/GLTFAnimationPlugin.ts` | None — animation mixer |
| **AssetExporterPlugin** | `src/plugins/export/AssetExporterPlugin.ts` | Verify GLTF export |
| **Object3DWidgetsPlugin** | `src/plugins/extras/Object3DWidgetsPlugin.ts` | Verify helper rendering |
| **Object3DGeneratorPlugin** | `src/plugins/extras/Object3DGeneratorPlugin.ts` | None — creates geometry |
| **SwitchNodeBasePlugin** | `src/plugins/configurator/SwitchNodeBasePlugin.ts` | Needs WebGPU `snapObject()` or disable preview on WebGPU |
| **MaterialConfiguratorBasePlugin** | `src/plugins/configurator/MaterialConfiguratorBasePlugin.ts` | Needs WebGPU `MaterialPreviewGenerator` or disable preview on WebGPU |
| **LoadingScreenPlugin** | `src/plugins/ui/LoadingScreenPlugin.ts` | None — DOM overlay |
| **TweakpaneUiPlugin** | `plugins/tweakpane/` | Minor — RenderTarget type refs |
| **BlueprintJsUiPlugin** | `plugins/blueprintjs/` | Minor — RenderTarget type refs |

### Tier 2: WebGL-Only (skip gracefully on WebGPU)

These plugins use WebGL-specific APIs, GLSL shaders, or the MaterialExtension system. They should detect the backend and skip initialization with a clear console message.

| Plugin | File | Why WebGL-Only |
|---|---|---|
| **SSAOPlugin** | `src/plugins/pipeline/SSAOPlugin.ts` | GLSL compute pass, GBuffer dependency |
| **DepthBufferPlugin** | `src/plugins/pipeline/DepthBufferPlugin.ts` | GBuffer GLSL pass, renderer.resetCurrentMaterial |
| **NormalBufferPlugin** | `src/plugins/pipeline/NormalBufferPlugin.ts` | GBuffer GLSL pass, renderer.resetCurrentMaterial |
| **GBufferPlugin** | `src/plugins/pipeline/GBufferPlugin.ts` | GLSL3 MRT, isWebGL2 checks |
| **ProgressivePlugin** | `src/plugins/pipeline/ProgressivePlugin.ts` | EffectComposer-based blending — needs WebGPU TSL reimplementation (in alpha scope) |
| **FrameFadePlugin** | `src/plugins/pipeline/FrameFadePlugin.ts` | EffectComposer-based blending |
| **ContactShadowGroundPlugin** | `src/plugins/extras/ContactShadowGroundPlugin.ts` | Custom render pass, render targets |
| **HDRiGroundPlugin** | `src/plugins/extras/HDRiGroundPlugin.ts` | renderer.background internal API |
| **CascadedShadowsPlugin** | `src/plugins/rendering/CascadedShadowsPlugin.ts` | ShaderChunk patching |
| **VirtualCamerasPlugin** | `src/plugins/rendering/VirtualCamerasPlugin.ts` | WebGLTexture type in events |
| **RenderTargetPreviewPlugin** | `src/plugins/ui/RenderTargetPreviewPlugin.ts` | webglRenderer.outputColorSpace |
| **ThreeGpuPathTracerPlugin** | `plugins/path-tracing/` | Entirely WebGL-based library |
| **NoiseBumpMaterialPlugin** | `src/plugins/material/NoiseBumpMaterialPlugin.ts` | MaterialExtension + GLSL |
| **ParallaxMappingPlugin** | `src/plugins/material/ParallaxMappingPlugin.ts` | MaterialExtension + GLSL |
| **ClearcoatTintPlugin** | `src/plugins/material/ClearcoatTintPlugin.ts` | MaterialExtension + GLSL |
| **FragmentClippingExtensionPlugin** | `src/plugins/material/FragmentClippingExtensionPlugin.ts` | MaterialExtension + GLSL |
| **CustomBumpMapPlugin** | `src/plugins/material/CustomBumpMapPlugin.ts` | MaterialExtension + GLSL |

### Tier 3: Needs WebGPU-Specific Implementation (future)

These could have WebGPU-native versions but are not needed for alpha:

| Plugin | WebGPU Version |
|---|---|
| **TonemapPlugin** | Built into WebGPURenderManager for alpha; separate TSL plugin later |
| **VignettePlugin** | TSL post-processing pass |
| **FilmicGrainPlugin** | TSL post-processing pass |
| **ChromaticAberrationPlugin** | TSL post-processing pass |
| **SSAOPlugin** | TSL compute pass + depth from depth attachment |
| **DepthBufferPlugin** | TSL MRT output or depth attachment |
| **GBufferPlugin** | TSL MRT |
| **ProgressivePlugin** | TSL frame blending |

### Tier 4: External Plugins (case-by-case)

| Plugin | Assessment |
|---|---|
| **GaussianSplat** | Uses WebGLRenderer for getSize/getPixelRatio — likely works with minor changes |
| **3DTiles** | Passes webglRenderer to library — needs library WebGPU support |
| **Procedural Generation** | Non-rendering — fully compatible |

## Action Items

### 5.1 — Add compatibility metadata to plugin base class

```typescript
// In AViewerPlugin or IViewerPlugin
export interface IViewerPlugin {
    // ...existing...

    /**
     * Backend compatibility. If set, the plugin will only initialize on the specified backend(s).
     * If the backend doesn't match, onAdded() will log a warning and return.
     * @default undefined (both backends)
     */
    readonly supportedBackends?: ('webgl' | 'webgpu')[]
}
```

### 5.2 — Add backend check in plugin registration

In `ThreeViewer.addPluginSync()` and `addPlugin()`:

```typescript
addPluginSync(plugin: IViewerPluginSync) {
    if (plugin.supportedBackends &&
        !plugin.supportedBackends.includes(this.renderManager.capabilities.backend)) {
        this.console.warn(
            `Plugin ${plugin.constructor.name} requires ${plugin.supportedBackends.join('/')} ` +
            `but current backend is ${this.renderManager.capabilities.backend}. Skipping.`
        )
        return this
    }
    // ... existing registration code ...
}
```

### 5.3 — Annotate all WebGL-only plugins

Add `supportedBackends = ['webgl'] as const` to every Tier 2 plugin class:

```typescript
export class SSAOPlugin extends PipelinePassPlugin {
    static readonly supportedBackends = ['webgl'] as const
    readonly supportedBackends = SSAOPlugin.supportedBackends
    // ...
}
```

### 5.4 — Verify Tier 1 plugins on WebGPU

For each Tier 1 plugin, create a minimal test that:
1. Creates ThreeViewer with `renderer: 'webgpu'`
2. Adds the plugin
3. Loads a test scene
4. Verifies no errors and expected behavior

### 5.5 — KTX2LoadPlugin backend detection

`KTX2LoadPlugin` uses `renderer` for capability detection. On WebGPU:
- `KTX2Loader.detectSupport(renderer)` may not accept `WebGPURenderer`
- Need to investigate and potentially create a compatibility shim

### 5.6 — Import plugins (GLTF, EXR, etc.)

Asset import plugins should be backend-agnostic since they work with the AssetManager, not the renderer directly. Verify:
- [ ] GLTFLoader works with WebGPU (it should — it creates standard materials)
- [ ] EXRLoader works (texture loading is renderer-agnostic)
- [ ] DRACOLoader works (geometry decompression is CPU-side)
- [ ] KTX2Loader works (needs capability detection adaptation)

## Validation

- [ ] All Tier 1 plugins work on WebGPU without errors
- [ ] All Tier 2 plugins log clear warnings and skip gracefully on WebGPU
- [ ] Plugin documentation indicates WebGPU compatibility
- [ ] No crashes when adding incompatible plugins to a WebGPU viewer
- [ ] GLTF import with materials, textures, animations works on WebGPU

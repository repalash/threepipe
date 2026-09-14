# Phase 4: Basic Post-Processing for WebGPU

**Parent**: [webgpu-renderer-support.md](./webgpu-renderer-support.md)
**Status**: Not started
**Priority**: Medium
**Estimated effort**: 1-2 weeks
**Depends on**: Phase 2 (WebGPURenderManager), Phase 3 (materials work)

## Goal

Implement basic post-processing for the WebGPU path using Three.js's `RenderPipeline` + TSL. The alpha only needs tonemapping and correct screen output. Advanced effects (SSAO, bloom, etc.) are future work.

## Context

On WebGL, threepipe uses:
- `EffectComposer2` (extends three.js EffectComposer) for pass orchestration
- `ExtendedRenderPass` for multi-phase scene rendering (opaque → transparent → transmission)
- `ScreenPass` for final compositing with tonemapping, color space conversion
- `IPipelinePass` interface with topological sort for pass ordering
- `PipelinePassPlugin` for plugins that add passes

On WebGPU, Three.js provides:
- `PostProcessing` (r163-r182) / `RenderPipeline` (r183+) for TSL-based pass composition
- `pass()` TSL function for scene rendering
- Built-in TSL functions for bloom, FXAA, tonemapping, etc.

**EffectComposer is fundamentally incompatible** with WebGPURenderer (confirmed):
- `ShaderPass` creates `ShaderMaterial` → throws `"not compatible"` error
- `MaskPass` accesses `renderer.state.buffers.stencil` → `renderer.state` doesn't exist
- Even basic `RenderPass` bypasses renderer state tracking
- This applies to BOTH WebGPU backend AND WebGLBackend (forceWebGL)

## Action Items

### 4.1 — WebGPU render pipeline in WebGPURenderManager

```typescript
import { RenderPipeline, pass, output } from 'three/tsl'

class WebGPURenderManager {
    private _pipeline: RenderPipeline
    private _scenePass: ReturnType<typeof pass>

    private _setupPipeline(scene: Scene, camera: Camera) {
        this._pipeline = new RenderPipeline(this._renderer)
        this._scenePass = pass(scene, camera)

        // Default: just render the scene with tonemapping
        this._pipeline.outputNode = this._scenePass
    }

    render(scene: IScene) {
        if (!this._pipeline) {
            this._setupPipeline(scene, scene.mainCamera)
        }
        this._pipeline.renderAsync() // or .render() depending on three.js version
    }
}
```

### 4.2 — Tonemapping on WebGPU

Three.js r171+ has built-in TSL tonemapping. The `TonemapPlugin` on WebGL modifies the ScreenPass material via `AScreenPassExtensionPlugin`. On WebGPU, tonemapping is a TSL node:

```typescript
import { toneMapping } from 'three/tsl'

// In WebGPURenderManager
setTonemapping(type: number, exposure: number) {
    const sceneOutput = this._scenePass
    this._pipeline.outputNode = toneMapping(type, exposure, sceneOutput)
}
```

**Decision**: For alpha, tonemapping is built into `WebGPURenderManager` directly. It doesn't go through the `TonemapPlugin` (which is WebGL-specific). A `WebGPUTonemapPlugin` can be created later.

### 4.3 — Output color space

On WebGL, `ScreenPass` handles sRGB conversion. On WebGPU, the renderer handles this natively.

Ensure `WebGPURenderer.outputColorSpace = SRGBColorSpace` is set correctly.

### 4.4 — Alpha/transparency handling

WebGL path uses `ExtendedRenderPass` to render transparent objects separately and blend them. WebGPU's default rendering handles transparency through standard three.js sorting.

For alpha: Use three.js's default transparency handling. The multi-phase opaque/transparent separation is a WebGL-only optimization.

### 4.5 — Pipeline pass compatibility

For the alpha, `WebGPURenderManager` does NOT support `registerPass`/`unregisterPass` with `IPipelinePass` instances (which are GLSL-based). It provides stub implementations that log warnings:

```typescript
registerPass(pass: IPipelinePass) {
    console.warn(`Pipeline pass '${pass.passId}' is not supported on the WebGPU backend`)
}
```

Future: Design a `ITSLPipelinePass` interface for WebGPU-native passes.

### 4.6 — Screen pass extensions

On WebGL, plugins like `VignettePlugin`, `FilmicGrainPlugin`, `ChromaticAberrationPlugin` extend the ScreenPass material. These use `AScreenPassExtensionPlugin` which injects GLSL.

For alpha: These effects are not available on WebGPU. `AScreenPassExtensionPlugin.onAdded()` should check the backend and skip registration with a warning.

### 4.7 — Progressive rendering

`ProgressivePlugin` blends frames over time for anti-aliasing. On WebGL it uses EffectComposer blend passes. For WebGPU, this needs a TSL-based frame blending implementation using `PostProcessing`/`RenderPipeline`. This is in alpha scope per the master plan — needs a separate design for the TSL blending approach.

## Future: TSL Post-Processing Pass System (Design Sketch)

```typescript
// Future API for WebGPU post-processing plugins
interface ITSLPipelinePass {
    passId: string
    enabled: boolean
    priority: number

    // Returns a TSL node that processes the input
    getOutputNode(input: ShaderNode, context: { scene: IScene, camera: ICamera }): ShaderNode
}

// Example: Vignette as a TSL pass
class VignetteTSLPass implements ITSLPipelinePass {
    passId = 'vignette'
    enabled = true
    priority = 100

    getOutputNode(input: ShaderNode) {
        const uv = screenUV
        const vignetteAmount = uniform(0.5)
        const vignette = Fn(() => {
            const dist = length(uv.sub(vec2(0.5)))
            return smoothstep(0.8, 0.4, dist)
        })
        return mul(input, vignette())
    }
}
```

## Validation

- [ ] Scene renders correctly on WebGPU without any post-processing
- [ ] Tonemapping applies correctly (compare visual output with WebGL)
- [ ] sRGB output is correct (no washed-out or over-saturated colors)
- [ ] Transparent objects render correctly
- [ ] WebGL-only pipeline plugins log clear warnings on WebGPU (no crashes)
- [ ] Background color/texture renders correctly

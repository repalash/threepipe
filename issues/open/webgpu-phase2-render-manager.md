# Phase 2: WebGPURenderManager Implementation

**Parent**: [webgpu-renderer-support.md](./webgpu-renderer-support.md)
**Status**: Not started
**Priority**: High
**Estimated effort**: 2-3 weeks
**Depends on**: Phase 0 (three.js at r171+), Phase 1 (IRenderManager cleanup)

## Goal

Implement `WebGPURenderManager` — a new render manager class that uses Three.js's `WebGPURenderer`. It implements `IRenderManager` and provides basic scene rendering without the full multi-phase pipeline that `ViewerRenderManager` has.

## Architecture

```
RenderTargetManager (existing abstract base)
  ├── RenderManager (existing, WebGL)
  │     └── ViewerRenderManager (existing, WebGL)
  └── WebGPURenderManager (NEW)
```

`WebGPURenderManager` does NOT extend `RenderManager`. It extends `RenderTargetManager` directly and implements `IRenderManager`. This avoids inheriting WebGL-specific code from `RenderManager`.

## Key Differences from ViewerRenderManager

| Aspect | ViewerRenderManager (WebGL) | WebGPURenderManager (WebGPU) |
|---|---|---|
| Renderer | `WebGLRenderer` (modded) | `WebGPURenderer` (from `three/webgpu`, available at r168+) |
| Init | Synchronous | Auto-async via `setAnimationLoop` (transparent to user) |
| Post-processing | EffectComposer2 + GLSL passes | Three.js `RenderPipeline` + TSL passes |
| Render pass | ExtendedRenderPass (multi-phase) | Simple `scene.render()` via pass() TSL node |
| Screen pass | ScreenPass (GLSL) | TSL output node chain |
| Render modes | userData flags on modded renderer | Not needed — single-phase render |
| Material extensions | onBeforeCompile + MaterialExtender | Not supported initially |

## Action Items

### 2.1 — Create WebGPURenderManager class

New file: `src/rendering/WebGPURenderManager.ts`

Responsibilities:
- Create `WebGPURenderer` (from `'three/webgpu'` import)
- Handle async initialization (`init()`)
- Manage the animation loop
- Handle resize
- Create and manage render targets (re-use `RenderTargetManager` base)
- Basic `render(scene)` implementation
- Context loss/restore handling
- Expose `IRendererCapabilities` with `backend: 'webgpu'`

```typescript
import { WebGPURenderer } from 'three/webgpu'

export class WebGPURenderManager extends RenderTargetManager implements IRenderManager {
    private _renderer: WebGPURenderer
    private _initialized = false

    constructor(options: IRenderManagerOptions & { forceWebGL?: boolean }) {
        super()
        this._renderer = new WebGPURenderer({
            canvas: options.canvas,
            antialias: options.msaa !== false,
            alpha: options.alpha !== false,
            forceWebGL: options.forceWebGL,
        })
    }

    async init(): Promise<void> {
        await this._renderer.init()
        this._initialized = true
        // Setup post-processing pipeline
        this._setupPipeline()
        // Start animation loop
        this._renderer.setAnimationLoop(this._animationLoop)
    }
    // ...
}
```

### 2.2 — Handle async initialization in ThreeViewer

**DECIDED**: Use three.js's built-in `setAnimationLoop` auto-init.

- `WebGPURenderer.setAnimationLoop()` is async and auto-calls `init()` if not yet initialized
- ThreeViewer constructor stays **synchronous** — no breaking change
- First frame renders when WebGPU device is ready (transparent to user)
- Expose `viewer.ready: Promise<void>` for users who need to await (e.g., take screenshot immediately after creation)
- If user calls `setAnimationLoop()` without await, it still works — animation starts once init completes

This was confirmed by research into three.js, R3F, Babylon.js, and Threlte patterns. See [webgpu-workplan-week1.md](./webgpu-workplan-week1.md) Decisions Log.

### 2.3 — Post-processing via RenderPipeline (basic)

For the alpha, the WebGPU post-processing pipeline is minimal:

```typescript
import { RenderPipeline, pass } from 'three/tsl'

private _setupPipeline() {
    this._pipeline = new RenderPipeline(this._renderer)
    const scenePass = pass(this._scene, this._camera)

    // Basic tonemapping (if enabled)
    let output = scenePass
    if (this._tonemapEnabled) {
        output = scenePass.toneMapping(this._toneMapping, this._exposure)
    }

    this._pipeline.outputNode = output
}
```

This replaces `EffectComposer2` + `ExtendedRenderPass` + `ScreenPass` for the WebGPU path.

### 2.4 — Render target management for WebGPU

Three.js `RenderTarget` (base class) works with both backends. The `RenderTargetManager` base class creates `WebGLRenderTarget` instances via `_createTargetClass()`. For WebGPU, we need to ensure these are backend-compatible.

**Research needed**: Does `WebGPURenderer` accept `WebGLRenderTarget` instances? Or does it need plain `RenderTarget`? The base `RenderTarget` class is shared, but the WebGL-specific subclass has WebGL-specific state tracking.

**Approach**: Override `_createTargetClass()` in `WebGPURenderManager` to create backend-appropriate targets.

### 2.5 — Blit operation for WebGPU

`IRenderManager.blit()` copies from one render target to another. In WebGL, this uses `EffectComposer2.copyPass`. For WebGPU, use the renderer's built-in copy mechanism or a TSL pass.

### 2.6 — Export operations

`renderTargetToDataUrl()`, `renderTargetToBuffer()`, `exportRenderTarget()` need WebGPU implementations. Three.js `WebGPURenderer` has `readRenderTargetPixelsAsync()` (note: async, unlike WebGL's synchronous version).

### 2.7 — Integration with ThreeViewer

Modify `ThreeViewer` constructor to select render manager:

```typescript
// In ThreeViewer constructor
const rmClass = (options as any).rmClass ??
    (options.renderer === 'webgpu' ? WebGPURenderManager : ViewerRenderManager)
this.renderManager = new rmClass({ ... })
```

Also need to:
- Make the context lost/restored event listeners conditional (WebGPU has different events)
- Handle the async init flow
- Ensure plugin onAdded() runs after renderer init for WebGPU

## File Plan

| File | Status | Notes |
|---|---|---|
| `src/rendering/WebGPURenderManager.ts` | NEW | Core new class |
| `src/rendering/index.ts` | MODIFY | Export new class |
| `src/viewer/ThreeViewer.ts` | MODIFY | Add renderer option, async init |
| `src/core/IRenderer.ts` | MODIFY | (from Phase 1) |
| `src/rendering/RenderTargetManager.ts` | MODIFY | Make target creation overridable |

## Open Questions

1. **Import path**: `three/webgpu` is a separate entry point in modern three.js. Do we need to configure bundler aliases for this? Does the modded three.js support this entry point?

2. **Render target compatibility**: Can `WebGPURenderer` use `WebGLRenderTarget` instances, or do we need `RenderTarget` base instances?

3. **Animation loop**: Does `WebGPURenderer.setAnimationLoop` work the same as `WebGLRenderer.setAnimationLoop`? (Likely yes, it's on the base `Renderer` class.)

4. **Shadow maps**: Do shadow maps work out of the box with `WebGPURenderer`? Any bias/acne differences?

5. **Environment maps / PMREMGenerator**: Does the WebGPU path handle HDR environment maps the same way? The `textureSlots` patch on the WebGL path — does WebGPU need an equivalent?

## Validation

- ThreeViewer with `renderer: 'webgpu'` creates and initializes without errors
- A simple scene with a box and directional light renders correctly
- GLTF model loads and displays
- Canvas resize works
- Shadow maps render (may need bias adjustment)
- Orbit controls respond to input
- `renderer: 'webgl'` still works identically to before

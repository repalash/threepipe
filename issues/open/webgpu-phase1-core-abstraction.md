# Phase 1: Core Abstraction & IRenderManager Cleanup

**Parent**: [webgpu-renderer-support.md](./webgpu-renderer-support.md)
**Status**: Not started
**Priority**: High
**Estimated effort**: 1-2 weeks
**Depends on**: Can start partially in parallel with Phase 0

## Goal

Clean up the `IRenderManager` interface so it can serve as the contract between both WebGL and WebGPU render managers. Reduce WebGL-specific type leakage. Introduce renderer capability queries. Make plugins and core code program against the interface, not the implementation.

## Current Problems

The `IRenderManager` interface currently leaks WebGL-specific types:

```typescript
// src/core/IRenderer.ts — current state
export interface IRenderManager {
    readonly renderer: IWebGLRenderer          // ← WebGL-specific
    readonly context: WebGLRenderingContext     // ← WebGL-specific
    readonly isWebGL2: boolean                  // ← WebGL-specific
    webglRenderer: WebGLRenderer               // ← WebGL-specific
    composer: EffectComposer2                   // ← WebGL-specific (post-processing)
    // ...
}
```

And `IWebGLRenderer extends WebGLRenderer` — the entire renderer type is WebGL.

## Action Items

### 1.1 — Introduce IRenderer (renderer-agnostic interface)

Create a minimal renderer-agnostic interface that both `IWebGLRenderer` and a future `IWebGPURenderer` wrapper can implement:

```typescript
// New: src/core/IRenderer.ts additions
export interface IRenderer {
    readonly domElement: HTMLCanvasElement
    setSize(width: number, height: number, updateStyle?: boolean): void
    getSize(target: Vector2): Vector2
    setPixelRatio(value: number): void
    getPixelRatio(): number
    render(scene: any, camera: any): void
    setAnimationLoop(callback: ((time: DOMHighResTimeStamp) => void) | null): void
    dispose(): void
    setClearColor(color: any, alpha?: number): void
    getClearColor(target: Color): Color
    getClearAlpha(): number
    setRenderTarget(renderTarget: any): void
    getRenderTarget(): any
    clear(color?: boolean, depth?: boolean, stencil?: boolean): void
    readonly info: { render: { calls: number }, autoReset: boolean }
    outputColorSpace: string
    toneMapping: number
    toneMappingExposure: number
    shadowMap: { enabled: boolean, type: number, autoUpdate: boolean }
}
```

**Note**: This is a subset of what both `WebGLRenderer` and `WebGPURenderer` provide. It does NOT try to abstract away all differences — just the common surface.

### 1.2 — Add renderer capability queries

Replace `isWebGL2` with a capability system:

```typescript
export interface IRendererCapabilities {
    readonly backend: 'webgl' | 'webgl2' | 'webgpu'
    readonly supportsMultipleRenderTargets: boolean
    readonly supportsHalfFloatTextures: boolean
    readonly supportsFloatTextures: boolean
    readonly supportsCompute: boolean
    readonly maxTextureSize: number
    readonly maxSamples: number  // for MSAA
}
```

Usage in plugins changes from `renderManager.isWebGL2` to `renderManager.capabilities.supportsMultipleRenderTargets` (which is what they actually care about).

### 1.3 — Split IRenderManager into base + WebGL extension

```typescript
// Base interface — both backends implement this
export interface IRenderManager {
    readonly renderer: IRenderer
    readonly capabilities: IRendererCapabilities
    readonly needsRender: boolean
    readonly renderSize: Vector2
    renderScale: number
    readonly frameCount: number
    readonly clock: Clock

    render(scene: IScene): void
    reset(): void
    resetShadows(): void
    setSize(width: number, height: number): void
    rebuildPipeline(setDirty?: boolean): void

    // Render targets (backend-agnostic, both use three.js RenderTarget)
    createTarget(options?: CreateRenderTargetOptions): IRenderTarget
    getTempTarget(options?: any): IRenderTarget
    releaseTempTarget(target: IRenderTarget): void
    readonly composerTarget: IRenderTarget

    blit(destination: IRenderTarget | null | undefined, options?: RendererBlitOptions): void
    clearColor(options: { r?: number, g?: number, b?: number, a?: number, target?: IRenderTarget }): void

    // Export
    renderTargetToDataUrl(target: any, mimeType?: string, quality?: number): string
    renderTargetToBuffer(target: any): Uint8Array | Uint16Array | Float32Array
    exportRenderTarget(target: any, mimeType?: string, textureIndex?: number): BlobExt
}

// WebGL-specific extension — only ViewerRenderManager implements this
export interface IWebGLRenderManager extends IRenderManager {
    readonly webglRenderer: WebGLRenderer
    readonly context: WebGLRenderingContext
    readonly isWebGL2: boolean
    composer: EffectComposer2
    readonly passes: IPipelinePass[]
    pipeline: IPassID[]
    registerPass(pass: IPipelinePass): void
    unregisterPass(pass: IPipelinePass): void
    refreshPasses(): void
}
```

### 1.4 — Audit all IRenderManager consumers

Search every file that accesses `renderManager` and categorize:

| Access Pattern | Count (approx) | Action |
|---|---|---|
| `renderManager.renderer` (as IWebGLRenderer) | ~15 | Change to `IRenderManager.renderer` where possible |
| `renderManager.webglRenderer` | ~8 | Keep as `IWebGLRenderManager`-only |
| `renderManager.context` | ~2 | Keep as `IWebGLRenderManager`-only |
| `renderManager.isWebGL2` | ~5 | Replace with `capabilities.*` |
| `renderManager.composer` | ~3 | Keep as `IWebGLRenderManager`-only |
| `renderManager.registerPass/unregisterPass` | ~20 | Needs thought — see below |
| `renderManager.blit` | ~10 | Keep on base interface |
| `renderManager.createTarget/getTempTarget` | ~10 | Keep on base interface |
| `renderManager.renderSize/renderScale` | ~15 | Keep on base interface |

### 1.5 — Pipeline pass registration

The pipeline pass system (`registerPass`/`unregisterPass`/`IPipelinePass`) is currently tightly coupled to `EffectComposer2` and GLSL-based passes. For WebGPU, the pipeline will use `RenderPipeline` + TSL.

**Decision**: Keep `registerPass`/`unregisterPass` on the base `IRenderManager` but make `IPipelinePass` renderer-agnostic. Pass implementations are backend-specific, but the registration mechanism is shared. This allows `PipelinePassPlugin` to work with both backends by having different pass implementations.

```typescript
// Updated PipelinePassPlugin pattern
abstract class PipelinePassPlugin {
    abstract _createPass(viewer: ThreeViewer): IPipelinePass  // creates WebGL or WebGPU pass

    onAdded(viewer: ThreeViewer) {
        // Check backend compatibility
        if (this.requiredBackend && viewer.renderManager.capabilities.backend !== this.requiredBackend) {
            console.warn(`${this.constructor.name} requires ${this.requiredBackend} backend`)
            return
        }
        this._pass = this._createPass(viewer)
        viewer.renderManager.registerPass(this._pass)
    }
}
```

### 1.6 — Add renderer type to ThreeViewerOptions

```typescript
export interface ThreeViewerOptions {
    // ... existing options ...

    /**
     * Renderer backend to use.
     * - 'webgl': Use WebGLRenderer (default, stable)
     * - 'webgpu': Use WebGPURenderer (alpha, auto-falls back to WebGL backend if WebGPU unavailable)
     * @default 'webgl'
     */
    renderer?: 'webgl' | 'webgpu'
}
```

### 1.7 — Deprecate direct WebGL type exposure (gradual)

Add deprecation warnings on:
- `IRenderManager.webglRenderer` → use `renderManager.renderer` instead
- `IRenderManager.context` → check `capabilities.backend` first
- `IRenderManager.isWebGL2` → use `capabilities.*`

These keep working for WebGL but log warnings when accessed.

## Files to Modify

| File | Changes |
|---|---|
| `src/core/IRenderer.ts` | Add IRenderer, IRendererCapabilities, split IRenderManager |
| `src/rendering/RenderManager.ts` | Implement capabilities, deprecation warnings |
| `src/viewer/ViewerRenderManager.ts` | Implement IWebGLRenderManager |
| `src/viewer/ThreeViewer.ts` | Add `renderer` option, rmClass selection logic |
| `src/rendering/RenderTargetManager.ts` | Replace isWebGL2 with capabilities |
| `src/three/utils/texture.ts` | Replace extension checks with capabilities |
| `src/plugins/base/PipelinePassPlugin.ts` | Add backend compatibility check |
| `src/plugins/pipeline/GBufferPlugin.ts` | Replace isWebGL2 with capabilities |
| `src/postprocessing/ExtendedRenderPass.ts` | Type narrowing for WebGL-specific code |

## Backward Compatibility

All changes must be backward-compatible. The existing WebGL path must not break. The new types extend the existing ones, and deprecated properties continue to work with console warnings.

## Validation

- All existing examples render identically
- All existing tests pass
- TypeScript compilation succeeds with no new errors
- Deprecated property warnings appear in console but don't break functionality

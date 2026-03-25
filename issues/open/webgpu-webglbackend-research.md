# WebGPURenderer + WebGLBackend (forceWebGL: true) -- Research Findings

**Created**: 2026-03-24
**Question**: Can threepipe use `WebGPURenderer({ forceWebGL: true })` as an intermediate migration step?
**Related**: [webgpu-renderer-support.md](./webgpu-renderer-support.md), [webgpu-research-findings.md](./webgpu-research-findings.md)

---

## Executive Summary

Using `WebGPURenderer` with `forceWebGL: true` **does work** and gives access to the new node material architecture while outputting GLSL to WebGL2. However, it comes with a **severe performance penalty** (5-10x slower than old `WebGLRenderer` in draw-call-heavy scenes) due to the UBO management architecture. This issue remains **unresolved** as of r183 (March 2026). The approach is viable for development/testing but **not recommended for production** until the UBO performance issue is fixed.

---

## Q1: Does `new WebGPURenderer({ forceWebGL: true })` work reliably in r171+?

**Yes, it works.** The implementation is straightforward (source: `src/renderers/webgpu/WebGPURenderer.js` in r168):

```javascript
class WebGPURenderer extends StandardRenderer {
    constructor(parameters = {}) {
        let BackendClass;
        if (parameters.forceWebGL) {
            BackendClass = WebGLBackend;          // Direct WebGL, no fallback setup
        } else {
            BackendClass = WebGPUBackend;
            parameters.getFallback = () => {
                console.warn('THREE.WebGPURenderer: WebGPU is not available, running under WebGL2 backend.');
                return new WebGLBackend(parameters);
            };
        }
        const backend = new BackendClass(parameters);
        super(backend, parameters);
    }
}
```

When `forceWebGL: true`:
- WebGLBackend is instantiated directly (no WebGPU probe, no fallback chain)
- No getFallback is registered, so no async WebGPU detection runs
- The renderer still goes through the full `Renderer` base class init pipeline
- All node material infrastructure (GLSLNodeBuilder, NodeMaterial conversion, etc.) is active

**Reliability**: Standard materials, PBR materials, and basic scene rendering work correctly. There are minor differences between backends (e.g., MRT clear color behavior -- issue #30567, fixed), but the WebGLBackend has been part of the codebase since early in the new renderer development.

---

## Q2: Does GLSLNodeBuilder compile node materials to GLSL correctly for all standard materials?

**Yes, with the same caveats as normal WebGPURenderer.** The `WebGLBackend` uses `GLSLNodeBuilder` (located at `src/renderers/webgl-fallback/nodes/GLSLNodeBuilder.js`) which:

1. Extends `NodeBuilder` from the node system
2. Uses `GLSLNodeParser` for GLSL function parsing
3. Outputs GLSL 3.00 ES (WebGL2)
4. Handles all standard material conversions via `NodeMaterial.fromMaterial()`

**What works**:
- `MeshStandardMaterial` -> `MeshStandardNodeMaterial` (auto-converted)
- `MeshPhysicalMaterial` -> `MeshPhysicalNodeMaterial` (auto-converted)
- `MeshBasicMaterial`, `MeshLambertMaterial`, `MeshPhongMaterial` (auto-converted)
- `PointsMaterial`, `SpriteMaterial`, `LineBasicMaterial` (auto-converted)
- All PBR properties: maps, metalness, roughness, clearcoat, transmission, etc.
- `scene.environment`, IBL, PMREM generation

**What does NOT work** (same as WebGPUBackend):
- `ShaderMaterial` / `RawShaderMaterial` -- throws error
- `onBeforeCompile` callbacks -- silently ignored
- Custom GLSL injection via string manipulation

**One notable limitation**: `storageBuffer` support is explicitly `false` in GLSLNodeBuilder:
```javascript
const supports = {
    swizzleAssign: true,
    storageBuffer: false
};
```

---

## Q3: Performance comparison -- WebGPURenderer+WebGLBackend vs old WebGLRenderer

**This is the critical finding: WebGPURenderer+WebGLBackend (forceWebGL) is dramatically slower than old WebGLRenderer.**

### Benchmark data (MacBook M4 Pro, discourse.threejs.org/t/87939)

| Cubes | WebGLRenderer (old) | WebGPURenderer (WebGPU) | WebGPURenderer (forceWebGL) |
|-------|--------------------|-----------------------|-----------------------------|
| 5,000 | 350 fps | 140 fps | 50 fps |
| 10,000 | 130 fps | 60 fps | 14 fps |
| 50,000 | 40 fps | 3-6 fps | 1-2 fps |

### Root cause: UBO architecture (Issue #30560, OPEN, High Priority)

The new `Renderer` base class uses Uniform Buffer Objects (UBOs) for per-object uniforms. Each mesh gets its own UBO, requiring:
- `setBindGroup()` / `bindBufferBase()` per draw call
- `writeBuffer()` / `bufferData()` per dynamic object per frame
- Massive state-change overhead between draw calls

The old `WebGLRenderer` uses plain uniforms (`gl.uniformMatrix4fv`, etc.) which are significantly faster for per-object updates.

**Why forceWebGL is even slower than native WebGPU**: The UBO overhead on WebGL2 is worse because WebGL2's UBO API (`bindBufferBase`, `bufferSubData`) is less efficient than WebGPU's bind group model. WebGPU was designed around descriptor-based binding, while WebGL2 UBOs are a bolted-on extension pattern.

### Fix status (as of March 2026)

- Issue #30560 remains **OPEN** with "High priority" + "Needs Investigation" labels
- PR #27388 proposed a pooled buffer approach with `bindBufferRange()` / `dynamicOffsets` but is not merged
- r183 included a "UBO size and attribute update" fix (PR #32615) which may be a partial improvement
- The core team has acknowledged this is an architectural problem, not just an optimization
- Workaround: use instancing and BatchedMesh (which amortize the per-object cost)

### What this means for threepipe

For typical threepipe scenes (product viewers, configurators with 100-1000 meshes), the overhead is **noticeable but may be acceptable**. For scenes with thousands of individual draw calls (particles, forests, procedural content), it is **not viable**.

---

## Q4: Does `forceWebGL: true` still auto-init async or is it sync?

**It is still async**, but trivially so.

The `Renderer.init()` method is:
```javascript
async init() {
    this._initPromise = new Promise(async (resolve, reject) => {
        let backend = this.backend;
        try {
            await backend.init(this);   // <-- calls WebGLBackend.init()
        } catch (error) { ... }
        // ... sets up Nodes, Lighting, Background, etc.
    });
}
```

`WebGLBackend.init()` is a **synchronous function** (not async):
```javascript
init(renderer) {
    super.init(renderer);
    const glContext = renderer.domElement.getContext('webgl2');
    this.gl = glContext;
    // ... setup extensions, capabilities, state, utils
}
```

Even though `WebGLBackend.init()` is sync, it's called inside an `async` wrapper. The `await backend.init(this)` resolves immediately (sync function returns undefined, which is awaited trivially). So **init() completes near-instantly** but is still technically async (returns a Promise).

**Practical implication**: You must still `await renderer.init()` or use `setAnimationLoop()` (which auto-awaits), but there is no actual async delay. No GPU adapter probing, no device request -- just synchronous WebGL2 context creation.

This is a minor code structure change for threepipe but not a behavioral concern.

---

## Q5: Features that DON'T work with WebGLBackend

### Does NOT work at all

| Feature | Status | Details |
|---------|--------|---------|
| **Compute shaders (native)** | Partial | Uses WebGL2 Transform Feedback as workaround, not true compute. Has caching bugs (issue #29726, closed but not confirmed fixed) |
| **Storage buffers** | No | `GLSLNodeBuilder.supports.storageBuffer = false` |
| **Storage textures** | No | WebGL2 has no texture storage writes |
| **WGSL shaders (`wgslFn`)** | No | Obviously; WebGL2 only speaks GLSL |
| **Render bundles** | No | WebGPU-specific optimization |

### Works but with limitations

| Feature | Status | Details |
|---------|--------|---------|
| **MRT (Multiple Render Targets)** | Partial | Code has `// TODO Add support for MRT` in MSAA resolve path. Basic MRT works for non-MSAA targets. Clear color behavior differs between backends (issue #30567, fixed). |
| **Compute via Transform Feedback** | Buggy | Works for simple cases. Caching issues with multiple compute nodes sharing buffers (issue #29726). |
| **Timestamp queries** | Depends | Requires `EXT_disjoint_timer_query_webgl2` extension |

### Works the same as WebGPUBackend

| Feature | Status |
|---------|--------|
| Node material system | Full |
| Standard material auto-conversion | Full |
| `glslFn()` | Full (it outputs GLSL, and WebGLBackend compiles GLSL) |
| `tslFn()` | Full (TSL compiles to GLSL via GLSLNodeBuilder) |
| PostProcessing / RenderPipeline (TSL-based) | Full |
| `pass()`, `bloom()`, `fxaa()` etc. | Full |
| PMREMGenerator | Full |
| scene.environment / IBL | Full |
| Shadow maps | Full |
| Instancing / BatchedMesh | Full |

---

## Q6: Does `glslFn()` work correctly with WebGLBackend?

**Yes, fully.** This is actually the most natural fit.

`glslFn()` creates a `FunctionNode` with `language = 'glsl'`:
```javascript
export const glslFn = (code, includes) => nativeFn(code, includes, 'glsl');
```

The `GLSLNodeBuilder` used by WebGLBackend outputs GLSL. When it encounters a `glslFn` node, the GLSL code is inserted directly into the shader output. No translation needed.

This means threepipe's existing GLSL effect shaders can be wrapped in `glslFn()` and used with WebGLBackend without any WGSL conversion. This is a genuine advantage of the forceWebGL path for migration.

**Important**: `wgslFn()` does NOT work with WebGLBackend (it would try to insert WGSL into GLSL, which fails). Use `glslFn()` or `tslFn()` for cross-backend compatibility.

---

## Q7: Does `three/webgpu` import path exist in r168 or only r171?

**It exists in r168.** The modded three.js fork (v0.168.10003) has these package.json exports:

```json
{
    "./webgpu": "./build/three.webgpu.js",
    "./tsl": "./build/three.webgpu.js"
}
```

Both `three/webgpu` and `three/tsl` are available and point to the same build file (`build/three.webgpu.js`).

The `three/webgpu` path was introduced in r167. Before r167, WebGPU/TSL imports came from `three/examples/jsm/...` paths.

**For threepipe**: Since the modded fork is already at r168, the `three/webgpu` import path is already available. No three.js upgrade is needed just for this import path.

---

## Q8: Can EffectComposer (old) work with WebGPURenderer in any mode?

**Mostly no. It will crash on mask passes and cannot use ShaderMaterial-based passes.**

### Analysis of EffectComposer dependencies

The old `EffectComposer` (`examples/jsm/postprocessing/EffectComposer.js`) calls these renderer methods:

| Method/Property | WebGPURenderer has it? | Notes |
|----------------|----------------------|-------|
| `renderer.getPixelRatio()` | Yes | On `Renderer` base class |
| `renderer.getSize()` | Yes | On `Renderer` base class |
| `renderer.getRenderTarget()` | Yes | On `Renderer` base class |
| `renderer.setRenderTarget()` | Yes | On `Renderer` base class |
| `renderer.clear()` | Yes | On `Renderer` base class |
| `renderer.render()` | Yes | On `Renderer` base class |
| `renderer.getContext()` | Yes | Returns `WebGL2RenderingContext` with WebGLBackend |
| **`renderer.state.buffers.stencil`** | **NO** | WebGLRenderer-specific. Used in mask pass stencil ops (line 133). |

### What breaks

1. **MaskPass / stencil operations**: `EffectComposer` accesses `renderer.state.buffers.stencil` for mask passes (line 133-141). The new `Renderer` base class has no `.state` property. This will throw a runtime error if any `MaskPass` is used with `needsSwap = true`.

2. **ShaderPass with ShaderMaterial**: `ShaderPass` creates `ShaderMaterial` instances. WebGPURenderer does NOT support `ShaderMaterial` -- it throws `NodeMaterial: Material "ShaderMaterial" is not compatible.` This is a fundamental incompatibility.

3. **RenderPass with direct GL calls**: `RenderPass` calls `renderer.getContext()` and uses raw GL framebuffer operations (`gl.framebufferRenderbuffer`). With WebGLBackend, `getContext()` returns the GL context, so this technically works, but it bypasses the renderer's state tracking and may cause state corruption.

### What might work (untested, fragile)

- A simple `RenderPass` -> `ShaderPass(CopyShader)` chain, if you replace `ShaderMaterial` with a `NodeMaterial` equivalent and don't use mask passes
- But at that point, you're rewriting EffectComposer internals

### Conclusion

**EffectComposer is fundamentally incompatible with WebGPURenderer.** The official migration path is TSL-based `PostProcessing` (r163-r182) / `RenderPipeline` (r183+). For threepipe, this means the post-processing system must be rebuilt for the WebGPU path regardless of which backend is used.

---

## Strategic Assessment: Is forceWebGL a viable migration step?

### Pros

1. **Architecture migration without WGSL**: Get on the new node material system while staying in GLSL-land
2. **`glslFn()` works perfectly**: Existing GLSL shaders can be wrapped in glslFn() with minimal effort
3. **Same API for both backends**: Code written for forceWebGL works identically on native WebGPU
4. **Available now (r168)**: No three.js upgrade needed for basic functionality
5. **Material auto-conversion**: All standard materials work out of the box
6. **Gradual adoption**: Can wrap individual shaders in TSL/glslFn before a full port

### Cons

1. **Severe performance regression**: 5-10x slower than WebGLRenderer for draw-call-heavy scenes (issue #30560, OPEN)
2. **EffectComposer incompatible**: Must rewrite post-processing regardless
3. **ShaderMaterial incompatible**: All custom ShaderMaterial usage must be rewritten
4. **onBeforeCompile dead**: All threepipe MaterialExtensions cease to work
5. **MRT incomplete**: MSAA + MRT has a TODO in WebGLBackend
6. **UBO fix timeline unknown**: Core team has not committed to a fix date

### Recommendation

**forceWebGL is a useful development/testing tool but not a production migration path** at this time. The performance penalty makes it unsuitable for real-world use.

**Recommended approach instead**:
1. Stay on `WebGLRenderer` for production
2. Use `WebGPURenderer({ forceWebGL: true })` in a **parallel test pipeline** to validate material conversion and identify ShaderMaterial/onBeforeCompile dependencies
3. Port post-processing to TSL-based `PostProcessing` class (this work is needed regardless)
4. Port MaterialExtensions from `onBeforeCompile` to TSL node injection (this work is needed regardless)
5. Wait for the UBO performance fix (issue #30560) before switching production to WebGPURenderer
6. When switching, go directly to native WebGPU (with automatic WebGL2 fallback) rather than pinning to forceWebGL

---

## Sources

- Three.js modded fork source: `/Users/palash/Projects/threepipe/.repos/three.js-modded/` (v0.168.10003)
- [Three.js WebGPURenderer docs](https://threejs.org/docs/pages/WebGPURenderer.html)
- [Three.js WebGPURenderer manual](https://threejs.org/manual/en/webgpurenderer.html)
- [UBO performance issue #30560](https://github.com/mrdoob/three.js/issues/30560) (OPEN, High Priority)
- [WebGPU performance benchmarks -- forum thread](https://discourse.threejs.org/t/webgpu-performance-issue/87939) (Nov 2025)
- [WebGPURenderer performance comparison -- forum thread](https://discourse.threejs.org/t/why-webgpurenderer-performance-significantly-lower-than-webglrenderer/77629)
- [WebGLBackend compute bug #29726](https://github.com/mrdoob/three.js/issues/29726) (Closed, Jul 2025)
- [MRT clear color difference #30567](https://github.com/mrdoob/three.js/issues/30567)
- [WebGPURenderer backend detection #30024](https://github.com/mrdoob/three.js/issues/30024)
- [Utsubo: WebGPU Migration Checklist](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)
- [Understanding WebGPURenderer -- forum thread](https://discourse.threejs.org/t/understanding-about-webgpurenderer/86635)
- [r183 release notes](https://github.com/mrdoob/three.js/releases/tag/r183)

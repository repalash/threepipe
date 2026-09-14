# WebGPU Renderer Research Findings

**Created**: 2026-03-24
**Purpose**: Answers to open technical questions for the WebGPU migration plan
**Related**: [webgpu-renderer-support.md](./webgpu-renderer-support.md), [webgpu-phase0-threejs-upgrade.md](./webgpu-phase0-threejs-upgrade.md)

---

## 1. WebGPURenderer + RenderTarget Compatibility

### Class Hierarchy (r163, current installed version)

```
EventDispatcher
  └── RenderTarget                         (src/core/RenderTarget.js)
        ├── WebGLRenderTarget              (src/renderers/WebGLRenderTarget.js)
        │     ├── WebGLArrayRenderTarget
        │     ├── WebGL3DRenderTarget
        │     └── WebGLCubeRenderTarget
        └── (no WebGPU-specific subclass)
```

`WebGLRenderTarget` is a trivial subclass of `RenderTarget` -- it only adds `this.isWebGLRenderTarget = true`. All state (width, height, texture, depth, stencil, samples, viewport, scissor) lives on the base `RenderTarget` class.

### Does WebGPURenderer accept WebGLRenderTarget?

**Yes, it does.** The `Renderer` base class (which `WebGPURenderer` extends) stores the render target in `this._renderTarget` via `setRenderTarget()`. The implementation is:

```javascript
setRenderTarget( renderTarget, activeCubeFace = 0, activeMipmapLevel = 0 ) {
    this._renderTarget = renderTarget;
    this._activeCubeFace = activeCubeFace;
    this._activeMipmapLevel = activeMipmapLevel;
}
```

There is no type check -- it accepts any object with RenderTarget-like shape. The `_renderScene()` method reads properties from the render target (`textures`, `depthTexture`, `width`, `height`, etc.) which exist on the base `RenderTarget` class.

The `PMREMGenerator` in the common/extras path creates `RenderTarget` (base class, not `WebGLRenderTarget`) directly. The `CubeRenderTarget` in the common path also uses a custom implementation, not `WebGLCubeRenderTarget`.

### Practical recommendation

Use `RenderTarget` (base class) for the WebGPU path. `WebGLRenderTarget` will also work since it's a trivial subclass, but there's no reason to use it. For the `WebGPURenderManager`, override `_createTargetClass()` in `RenderTargetManager` to return `RenderTarget` instead of `WebGLRenderTarget`.

### Render target lifecycle

- **Creation**: No backend-specific creation -- just `new RenderTarget(w, h, options)`.
- **Resize**: `renderTarget.setSize(w, h)` calls `dispose()` internally then updates dimensions. Same for both backends.
- **Dispose**: `renderTarget.dispose()` fires a `'dispose'` event. The backend's `Textures` manager listens for this and frees GPU resources.
- **readRenderTargetPixels**: On the new `Renderer` base class, this is `readRenderTargetPixelsAsync()` (async only, unlike WebGL which has a sync version). Returns a promise of buffer data via `backend.copyTextureToBuffer()`.

---

## 2. Animation Loop

### Does setAnimationLoop work the same?

**Mostly yes, with one key difference: it's async on WebGPURenderer.**

```javascript
// WebGLRenderer (sync)
renderer.setAnimationLoop( callback );

// WebGPURenderer base Renderer class (async)
async setAnimationLoop( callback ) {
    if ( this._initialized === false ) await this.init();
    this._animation.setAnimationLoop( callback );
}
```

The callback signature is the same: `(time: DOMHighResTimeStamp) => void`.

### Async concerns

The `setAnimationLoop` on `Renderer` (WebGPU's base) is `async` because it auto-calls `this.init()` if the renderer hasn't been initialized. This means:
1. The first call to `setAnimationLoop()` may not start immediately -- it waits for WebGPU device creation.
2. If you call `setAnimationLoop()` without `await`, it works fine -- the animation starts once init completes.
3. If you need to guarantee the renderer is ready before proceeding, `await renderer.setAnimationLoop(cb)` or call `await renderer.init()` first.

### Three initialization patterns

1. `renderer.setAnimationLoop(animate)` -- recommended, handles init automatically
2. `await renderer.init()` then `renderer.setAnimationLoop(animate)` -- explicit control
3. `await renderer.render(scene, camera)` -- one-shot, auto-inits

For threepipe's `WebGPURenderManager`, the recommended approach is to call `await renderer.init()` in the manager's own `init()` method, then call `setAnimationLoop()` synchronously afterward.

---

## 3. Legacy Material Handling

### Automatic conversion: YES

**Three.js WebGPURenderer automatically converts standard materials to NodeMaterials internally.** This happens in `NodeBuilder.build()`:

```javascript
// node_modules/three/examples/jsm/nodes/core/NodeBuilder.js, line 1090-1098
build( convertMaterial = true ) {
    const { object, material } = this;
    if ( convertMaterial ) {
        if ( material !== null ) {
            NodeMaterial.fromMaterial( material ).build( this );
        }
    }
}
```

`NodeMaterial.fromMaterial()` works by:
1. If the material `isNodeMaterial === true`, return it as-is.
2. Otherwise, derive the NodeMaterial type name: `material.type.replace('Material', 'NodeMaterial')`.
   - `MeshPhysicalMaterial` becomes `MeshPhysicalNodeMaterial`
   - `MeshStandardMaterial` becomes `MeshStandardNodeMaterial`
   - `MeshBasicMaterial` becomes `MeshBasicNodeMaterial`
3. Create an instance of the node material class from a registry (`NodeMaterials` map).
4. Copy all properties from the legacy material to the node material via `for (const key in material) nodeMaterial[key] = material[key]`.

### What transfers correctly

All standard PBR properties transfer correctly via the property copy:
- `color`, `map`, `metalness`, `metalnessMap`, `roughness`, `roughnessMap`
- `normalMap`, `normalScale`, `aoMap`, `aoMapIntensity`
- `emissive`, `emissiveMap`, `emissiveIntensity`
- `envMap`, `envMapIntensity`
- `clearcoat`, `clearcoatRoughness`, `sheen`, `sheenRoughness`
- `transmission`, `ior`, `thickness`
- `opacity`, `transparent`, `alphaMap`, `alphaTest`
- `side`, `depthTest`, `depthWrite`, `visible`

### What does NOT work

- **`onBeforeCompile`** -- silently ignored. MaterialExtensions will not apply.
- **`ShaderMaterial` / `RawShaderMaterial`** -- will throw `NodeMaterial: Material "ShaderMaterial" is not compatible.`
- **Custom GLSL injections** -- anything that relied on shader string manipulation.
- **Material lifecycle hooks from modded three.js** (onBeforeRender/onAfterRender on Material) -- stock three.js Material doesn't have these; they're patched only on the WebGL side.

### Performance cost

There is a one-time conversion cost when a material is first encountered (building the node graph). After that, the node material is cached per `RenderObject` via `nodeBuilderCache`. The per-frame cost is minimal -- the node system updates uniforms similarly to how WebGL updates uniforms.

### scene.environment

`scene.environment` works on WebGPURenderer. The `Background` class in `renderers/common/Background.js` handles it using TSL nodes (`backgroundBlurriness`, `backgroundIntensity`, `normalWorld`). The `Nodes` class provides `getEnvironmentNode(scene)` which is passed to the `NodeBuilder` for IBL. PMREMGenerator exists in `renderers/common/extras/PMREMGenerator.js` with a TSL-based implementation.

**Key difference**: The modded three.js `textureSlots` / `envMapSlotKey` system for per-material env map overrides does NOT exist in the WebGPU path. Only `scene.environment` and per-material `envMap` (standard three.js) work.

---

## 4. Three.js r163 to r171 Breaking Changes

### r163 to r164
- `LWOLoader` coordinate conversion changed (assets orient differently)
- `USDZLoader.parseAsync()` replaces async parse; new `parse()` uses callbacks
- **Shader chunk `lightmap_fragment` removed** -- custom materials using it must inline the GLSL
- **Legacy `WebGLNodeBuilder` removed** -- node materials work only with `WebGPURenderer`

### r164 to r165
- `BatchedMesh` requires calling `addInstance()` to enable object rendering

### r165 to r166
- **`WebGLRenderer.copyTextureToTexture()` signature changed** (position, level parameters)
- **`WebGLRenderer.copyFramebufferToTexture()` signature changed** (position, level parameters)

### r166 to r167
- **TSL chaining removed** -- functions like `fxaa()` require explicit parameter passing
- **TSL `viewportTopLeft` renamed to `viewportUV`**
- TSL `viewportBottomLeft` removed (use `viewportUV.flipY()`)
- **TSL `uniforms()` renamed to `uniformArray()`**
- `DragControls.activate()`/`deactivate()` renamed to `connect()`/`disconnect()`
- `DragControls.getObjects()`, `setObjects()`, `getRaycaster()` removed
- `PointerLockControls.getObject()` removed (use `controls.object`)
- `LogLuvLoader` removed (migrate to `UltraHDRLoader`)

### r167 to r168
- **WebGPURenderer and TSL imports changed** -- use separate import paths
- TSL blending functions renamed: `burn()` -> `blendBurn()`, `dodge()` -> `blendDodge()`, etc.
- `storageObject()` deprecated (use `storage().setPBO(true)`)

### r168 to r169
- **`Material.type` now static and immutable** -- cannot be modified by application code
- Certain TSL modules moved from core to addons
- **Mipmaps always generated when `Texture.generateMipmaps = true`**
- Non-PBR materials export with `metallicFactor: 0` and `roughnessFactor: 1`
- `WebGLRenderer.copyTextureToTexture3D()` deprecated (use `copyTextureToTexture()`)
- MMD modules deprecated

### r169 to r170
- `TransformControls` now derived from `Controls` (add via `scene.add(controls.getHelper())`)
- `EXRExporter.parse()` now async
- `KTX2Exporter.parse()` now async
- `LightProbeGenerator.fromCubeRenderTarget()` now async
- `PackedPhongMaterial`, `SDFGeometryGenerator`, `TiltLoader`, `GPUStatsPanel` removed
- `GeometryCompressionUtils` functions accept geometries instead of meshes

### r170 to r171
- **WebGPURenderer/TSL import statements restructured**
- Use `three/webgpu` for WebGPURenderer modules, `three/tsl` for TSL
- TSL blending renames repeated (may be consolidation of r167-168 changes)

### Impact Summary for Threepipe

| Area | Impacting Changes | Severity |
|---|---|---|
| **WebGLRenderer** | `copyTextureToTexture()` and `copyFramebufferToTexture()` signature changes (r166) | Medium -- search for usages |
| **Material** | `Material.type` immutable (r169) -- threepipe modifies `material.type` in some places | **High** -- audit needed |
| **ShaderChunk** | `lightmap_fragment` removed (r164) | Low -- check if threepipe uses it |
| **EffectComposer** | No direct breaking changes listed | Low |
| **RenderTarget** | No breaking changes | Low |
| **PMREMGenerator** | No breaking changes in r163-171 range | Low |
| **TSL (for future)** | Major API churn in r166-171 range | Informational -- affects WebGPU path only |

---

## 5. Modded Three.js Fork - Patch Methodology

### Repository Structure

- **Repo**: https://github.com/repalash/three.js-modded
- **Branches**: `master` (default) and `dev`
- **No version-specific branches** (no r163, r167, etc.)
- **51 releases** published, latest: `v0.163.10003` (Oct 27, 2025)
- **Versioning scheme**: `v0.<three_version>.<patch_version>` (e.g., `v0.163.10003` = three.js r163, patch revision 10003)

### Distribution

Packages are distributed via a Cloudflare Worker proxy:
- URL: `https://pkg.threepipe.org/dep/three/-/v0.163.10003/package.tgz`
- Worker source: `/Users/palash/Projects/threepipe/website/.worker/cf.js`
- It proxies GitHub release assets from `https://github.com/repalash/three.js-modded/releases/download/`
- Types repo: `https://github.com/repalash/three-ts-types` — also at r168 (`v0.168.10001` on master)
  - Has branches: `master`, `dev`, `add_missing_props`, `generic_types`, `merge-upstream-changes`, `modded_three`, `pass_fix`
  - Has a `r180` tag (possibly from upstream merge)
  - dev branch is behind master (at r163)

### Patch Maintenance

**No formal patch file system exists.** The fork is maintained as a full copy of three.js with direct edits to source files. There are:
- No `.patch` files in the threepipe repo (only IDE shelf patches)
- No build scripts for applying patches to stock three.js
- No documented patch extraction/application process
- Releases are labeled "Updated builds" with minimal changelogs

### Upgrade Methodology (Current)

Based on the release history, upgrades happen by:
1. Updating the fork's master branch to a new three.js version
2. Manually resolving conflicts in patched files
3. Building and publishing a new release
4. Updating `package.json` in threepipe to point to the new tgz

### Versions Maintained

Release history shows packages for: r160 (v0.160.1005-1008), r162 (v0.162.10003-10005), r163 (v0.163.10001-10003). Each major version has 3-5 patch revisions.

### Recommendation for Upgrade

The current process is fragile. For the r163 to r171 upgrade, consider:
1. Creating a branch per three.js target version in the modded repo
2. Extracting the 20 patches as `git format-patch` diffs against stock three.js r163
3. Attempting to apply those patches to stock r167, r171 etc.
4. Tracking which patches conflict and need manual resolution
5. Documenting each patch's purpose and affected lines

---

## 6. RenderPipeline API (was PostProcessing)

### Naming

- **r163 (installed)**: `PostProcessing` class in `examples/jsm/renderers/common/PostProcessing.js`
- **r183 (current)**: `PostProcessing` deprecated, renamed to `RenderPipeline`

### Architecture

`RenderPipeline` (and the r163 `PostProcessing`) is fundamentally different from `EffectComposer`. It does NOT have a list of passes. Instead, it has a single `outputNode` -- a TSL node graph that defines the entire pipeline.

**r163 PostProcessing source (complete):**
```javascript
class PostProcessing {
    constructor( renderer, outputNode = vec4( 0, 0, 1, 1 ) ) {
        this.renderer = renderer;
        this.outputNode = outputNode;
    }
    render() {
        quadMesh.material.fragmentNode = this.outputNode;
        quadMesh.render( this.renderer );
    }
    renderAsync() {
        quadMesh.material.fragmentNode = this.outputNode;
        return quadMesh.renderAsync( this.renderer );
    }
}
```

### How passes work

There are no discrete "pass objects" to add/remove. Instead, you build a TSL node graph:

```javascript
// Create a scene render pass
const scenePass = pass(scene, camera);

// MRT setup (optional)
scenePass.setMRT(mrt({
    output: output,
    normal: transformedNormalView
}));

// Get intermediate textures from the scene pass
const colorTexture = scenePass.getTextureNode('output');
const normalTexture = scenePass.getTextureNode('normal');
const depthTexture = scenePass.getTextureNode('depth');

// Chain effects via TSL node composition
const aoPass = ao(depthTexture, normalTexture, camera);
const blended = aoPass.getTextureNode().mul(colorTexture);
const withBloom = bloom(blended);
const withFXAA = fxaa(withBloom);

// Set the pipeline output
pipeline.outputNode = withFXAA;
```

### Pass management

Since r183, there is a `.pipe()` method for chaining:
```javascript
pipeline.outputNode = scenePass.pipe(bloom()).pipe(fxaa());
```

But fundamentally:
- **Adding a pass** = modifying the node graph and reassigning `outputNode`
- **Removing a pass** = rebuilding the node graph without that node
- **Reordering** = changing the node graph connections
- **No explicit add/remove/reorder API** -- it's all node graph manipulation

### Can you get intermediate render results?

**Yes.** The `pass()` node provides `getTextureNode(name)` which returns a TSL texture node for named outputs ('output', 'depth', 'normal', etc.). These texture nodes can be used as inputs to other passes or read back.

### Flexibility vs EffectComposer

| Feature | EffectComposer | RenderPipeline |
|---|---|---|
| Add/remove passes at runtime | Easy (array manipulation) | Must rebuild node graph |
| Pass ordering | Array index | Node graph connections |
| Intermediate textures | Manual render target management | `getTextureNode()` |
| MRT support | Manual setup | Built-in via `setMRT()` |
| Custom shaders | GLSL ShaderPass | TSL `Fn()` or `glslFn()` |
| Plugin pattern | `IPipelinePass` with `passId` | Node graph composition |

**For threepipe's WebGPU path**: The `IPipelinePass` registration pattern doesn't map well to RenderPipeline. A new pattern is needed where plugins contribute TSL node graph fragments rather than discrete passes.

---

## 7. WebGPU Context Loss / Device Lost

### API

Three.js WebGPURenderer exposes device loss via a callback property:

```javascript
renderer.onDeviceLost = ( info ) => {
    console.log('Device Lost', info);
    // info contains { api: 'webgpu' | 'webgl' } indicating which backend
};
```

### Behavior on device loss

1. A formatted error message is logged to console by default
2. Both render loop and animation loop stop via early return
3. No `'webglcontextlost'` / `'webglcontextrestored'` DOM events (those are WebGL-specific)

### Recovery

Unlike WebGL, WebGPU allows graceful recovery:

```javascript
renderer.onDeviceLost = async ( info ) => {
    await renderer.init();  // Re-initialize the device
    // Developer must manually restore: textures, scenes, materials
    // The renderer does NOT auto-restore GPU resources
};
```

**Important caveat**: The developer is responsible for restoring application state after device loss. The renderer only re-creates the GPU device -- all textures, buffers, and compiled shaders must be re-uploaded.

### Comparison with WebGL context loss in threepipe

| Aspect | WebGL (current threepipe) | WebGPU |
|---|---|---|
| Events | `webglcontextlost`, `webglcontextrestored` on canvas | `renderer.onDeviceLost` callback |
| Auto-recovery | three.js attempts context restore | Must call `await renderer.init()` |
| Resource restoration | Partial auto-restore in three.js | Developer must handle manually |
| Detection | `renderer.getContext().isContextLost()` | Check via callback |

### For threepipe's WebGPURenderManager

```typescript
this._renderer.onDeviceLost = async (info) => {
    this.dispatchEvent({ type: 'deviceLost', info });
    try {
        await this._renderer.init();
        this.dispatchEvent({ type: 'deviceRestored' });
        // Force re-render
        this.setDirty();
    } catch (e) {
        console.error('WebGPU device recovery failed', e);
    }
};
```

---

## 8. glslFn() and wgslFn() Capabilities

### Function signatures

```javascript
import { glslFn, wgslFn } from 'three/tsl';  // r171+
// Or from 'three/examples/jsm/nodes/Nodes.js' in r163

const myGlslFn = glslFn(code: string, includes?: Array<FunctionNode>);
const myWgslFn = wgslFn(code: string, includes?: Array<FunctionNode>);
```

Both are convenience wrappers around `FunctionNode`:
```javascript
new FunctionNode(code, includes, 'glsl')  // glslFn
new FunctionNode(code, includes, 'wgsl')  // wgslFn
```

### Capabilities

#### Texture sampling -- YES

```javascript
const textureSample = wgslFn(`
    fn getTextureSample(
        inputTexture: texture_2d<f32>,
        textureSampler: sampler,
        uv: vec2<f32>
    ) -> vec4<f32> {
        return textureSample(inputTexture, textureSampler, uv);
    }
`);

// Call it by passing TSL nodes as arguments
material.colorNode = textureSample({
    inputTexture: texture(myTexture),
    textureSampler: texture(myTexture),  // sampler from same texture node
    uv: uv()
});
```

#### Uniforms -- YES (but manual)

All inputs must be passed as parameters. There's no automatic access to global uniforms:

```javascript
const myFn = wgslFn(`
    fn applyEffect(color: vec3<f32>, intensity: f32) -> vec3<f32> {
        return mix(color, vec3<f32>(1.0), intensity);
    }
`);

const intensityUniform = uniform(0.5);
material.colorNode = myFn({
    color: texture(map),
    intensity: intensityUniform
});
```

#### Function dependencies -- YES

Use the `includes` parameter:

```javascript
const helperFn = wgslFn(`fn helper(x: f32) -> f32 { return x * x; }`);
const mainFn = wgslFn(`
    fn main(value: f32) -> f32 {
        return helper(value);
    }
`, [helperFn]);
```

### Limitations

1. **No access to built-in uniforms/matrices** -- Standard matrices (modelViewMatrix, projectionMatrix, etc.) must be passed as parameters manually. Unlike traditional shaders where these are auto-provided.

2. **All inputs must be explicit parameters** -- Cannot access global state, textures, or uniforms without passing them as TSL node arguments.

3. **glslFn throws on WebGPU backend, wgslFn throws on WebGL backend** -- `glslFn` passes GLSL to the builder's parser; on WebGPU backend, `WGSLNodeParser` fails to parse GLSL syntax and throws `"FunctionNode: Function is not a WGSL code."` Similarly `wgslFn` fails on WebGLBackend. For cross-backend code, use `Fn()` (pure TSL). See [webgpu-glsl-research.md](./webgpu-glsl-research.md) for full analysis.

4. **MRT output** -- glslFn/wgslFn define individual functions that return a single value. MRT is handled at the RenderPipeline level via `setMRT()`, not within individual shader functions. You cannot write to multiple render targets from within a single glslFn/wgslFn call.

5. **No compute shader textureStore** -- Early versions lacked `textureStore()` support for compute shaders writing to textures via wgslFn (this may have improved in later releases).

6. **Cross-platform limitations** -- Code written with wgslFn/glslFn is not portable to non-three.js environments.

### Practical advice for porting threepipe GLSL

For porting existing GLSL shaders (like ScreenPass, Vignette, FilmicGrain, ChromaticAberration):
- **Simple effect shaders**: Use `tslFn` (pure TSL) for maximum portability across backends.
- **Complex GLSL**: Use `glslFn` for WebGL backend, write parallel `tslFn` or `wgslFn` for WebGPU.
- **Uniforms**: Wrap in `uniform()` nodes and pass as parameters.
- **Textures**: Wrap in `texture()` nodes and pass as parameters.

---

## 9. KTX2Loader + WebGPU

### detectSupport compatibility

**Yes, `detectSupport()` accepts `WebGPURenderer`** in recent three.js versions:

```typescript
.detectSupport( renderer: WebGPURenderer | WebGLRenderer ): KTX2Loader
```

### Async variant for WebGPU

There is also an async version specifically for WebGPU:

```typescript
.detectSupportAsync( renderer: WebGPURenderer ): Promise<KTX2Loader>
```

**Recommended usage with WebGPU:**
```javascript
const loader = new KTX2Loader();
loader.setTranscoderPath('examples/jsm/libs/basis/');
await loader.detectSupportAsync(webGPURenderer);  // async for WebGPU
const texture = await loader.loadAsync('diffuse.ktx2');
```

The synchronous `detectSupport()` is marked as deprecated for async detection scenarios.

### Known issues

- **Empty compressed textures throw errors on WebGPU** -- assigning a compressed texture without mipmaps can cause issues (three.js issue #29785).
- **Format support may vary** -- Some Basis Universal formats may not transcode correctly for WebGPU. Users reported issues in late 2024 (three.js forum thread on KTX2/Basis with WebGPURenderer).
- The r163 version installed in threepipe may not have `detectSupportAsync()` -- this was added in a later release. Needs verification after the three.js upgrade.

### For threepipe's KTX2LoadPlugin

The plugin currently calls `ktx2Loader.detectSupport(renderer)`. After upgrading three.js:
1. Check if the renderer is WebGPU
2. Use `await detectSupportAsync(renderer)` for WebGPU
3. Fall back to `detectSupport(renderer)` for WebGL

---

## 10. Existing WebGPU Work in Threepipe

### Source code

**No WebGPU code exists in the threepipe source** (`src/`). A grep for "webgpu" returns zero matches in the source directory.

### Git branches

**No WebGPU-specific branches exist.** Current branches: `blend-import`, `dev`, `master`, `migrate`, `monaco`, `pivot-controls`, `readme`, `theatrejs`, `timeline`, plus several worktree branches. None related to WebGPU.

### Issues/planning docs

Eight planning documents exist in `issues/open/`:
- `webgpu-renderer-support.md` -- Master plan
- `webgpu-phase0-threejs-upgrade.md` -- Three.js upgrade path
- `webgpu-phase1-core-abstraction.md` -- IRenderManager cleanup
- `webgpu-phase2-render-manager.md` -- WebGPURenderManager implementation
- `webgpu-phase3-materials.md` -- Material compatibility layer
- `webgpu-phase4-postprocessing.md` -- Basic post-processing
- `webgpu-phase5-plugins.md` -- Plugin compatibility audit
- `webgpu-phase6-alpha-release.md` -- Alpha release plan

These are comprehensive planning documents but no implementation work has started.

### Installed three.js

The installed three.js (r163) has WebGPURenderer available in `examples/jsm/renderers/webgpu/`, including the full `Renderer` base class, `WebGPUBackend`, `WebGLBackend`, node system, and `PostProcessing`. However, r163 predates the "production-ready" milestone (r171), so its WebGPU implementation is less mature.

---

## Summary: Key Answers for the Migration Plan

| Question | Answer |
|---|---|
| Can WebGPURenderer use WebGLRenderTarget? | Yes, but prefer base `RenderTarget` |
| Is setAnimationLoop the same? | Same callback, but async (auto-calls init) |
| Do legacy materials work on WebGPU? | Yes, auto-converted via `NodeMaterial.fromMaterial()` |
| Does scene.environment work? | Yes, handled by TSL-based Background/PMREMGenerator |
| Is onBeforeCompile supported? | No, silently ignored |
| What's the r163-r171 upgrade risk? | Medium -- Material.type immutable (r169) is highest risk |
| Is there a patch system for the fork? | No -- direct edits, no formal patches |
| How does RenderPipeline work? | Single `outputNode` (TSL node graph), no add/remove pass API |
| Can we handle device loss? | Yes, via `renderer.onDeviceLost` callback |
| Can glslFn/wgslFn access textures/uniforms? | Yes, but all must be passed as explicit parameters |
| Does KTX2 work with WebGPU? | Yes, use `detectSupportAsync()` |
| Any existing WebGPU code? | Planning docs only, no implementation |

---

## Sources

- Three.js source code: `/Users/palash/Projects/threepipe/node_modules/three/`
- [WebGPURenderer docs](https://threejs.org/docs/pages/WebGPURenderer.html)
- [Three.js WebGPURenderer manual](https://threejs.org/manual/en/webgpurenderer.html)
- [Three.js Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
- [Three.js Shading Language wiki](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)
- [FunctionNode docs](https://threejs.org/docs/pages/FunctionNode.html)
- [PostProcessing/RenderPipeline docs](https://threejs.org/docs/pages/PostProcessing.html)
- [KTX2Loader docs](https://threejs.org/docs/pages/KTX2Loader.html)
- [WebGPU Device Lost PR #29767](https://github.com/mrdoob/three.js/pull/29767)
- [NodeMaterial compatibility issue #29674](https://github.com/mrdoob/three.js/issues/29674)
- [wgslFn examples issue #26600](https://github.com/mrdoob/three.js/issues/26600)
- [r183 release notes](https://github.com/mrdoob/three.js/releases/tag/r183)
- [Codrops: BatchedMesh and Post processing with WebGPURenderer](https://tympanus.net/codrops/2024/10/30/interactive-3d-with-three-js-batchedmesh-and-webgpurenderer/)
- [Three.js modded fork](https://github.com/repalash/three.js-modded)
- [Utsubo: WebGPU Three.js Migration Guide](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)

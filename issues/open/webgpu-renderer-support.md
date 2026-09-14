# WebGPU Renderer Backend Support for Threepipe

**Status**: Planning
**Priority**: High
**Created**: 2026-03-24
**Estimated effort**: 2-4 months (phased, alpha-first)

## Goal

Add WebGPU renderer backend support to threepipe alongside the existing WebGL renderer. Users should be able to opt into WebGPU rendering via a configuration option. The WebGL path remains the default and fully supported. WebGPU starts as alpha — basic scene rendering, GLTF loading, standard materials, camera controls.

## Strategy

**Hybrid incremental approach:**
- Keep WebGL as the default, production renderer
- Add WebGPU as an opt-in alpha backend via `renderer: 'webgpu'` option in ThreeViewer
- NOT all plugins need WebGPU support — plugins like PathTracer stay WebGL-only, new plugins can be WebGPU-only
- Core rendering infrastructure (RenderPass, ScreenPass, pipeline) gets parallel WebGPU implementations where needed
- Materials need an abstraction layer that allows standard materials to work on both backends
- Leverage Three.js's `WebGPURenderer` with `WebGLBackend` fallback as the foundation
- Three.js version upgrades happen incrementally as we've been doing (r163 → r168 → r171 → r175 → r183)
- `three/webgpu` import path is already available in the r168 fork

## Architecture Overview

```
ThreeViewer
  ├── options.renderer: 'webgl' | 'webgpu'   (default: 'webgl')
  │
  ├── 'webgl' → ViewerRenderManager (existing, unchanged)
  │     └── WebGLRenderer (modded three.js)
  │
  └── 'webgpu' → WebGPURenderManager (new)
        └── WebGPURenderer (from three/webgpu, available at r168+)
              ├── WebGPUBackend (when WebGPU available)
              └── WebGLBackend (auto-fallback, 5-10x slower — issue #30560)
```

### Key Design Decisions

1. **Two RenderManager implementations**, not one abstracted one. The rendering pipelines are too different to meaningfully abstract without creating a leaky abstraction. `ViewerRenderManager` stays unchanged for WebGL. `WebGPURenderManager` is new and clean.

2. **IRenderManager interface is the contract.** Both render managers implement `IRenderManager`. Plugins that only use `IRenderManager` methods work on both backends. Plugins that downcast to `ViewerRenderManager` or access `webglRenderer` are WebGL-only.

3. **Material system needs a compatibility layer.** Standard materials (PhysicalMaterial, UnlitMaterial) must work on both backends. Material extensions (onBeforeCompile-based) remain WebGL-only initially. A new TSL-based node extension system can be added later for WebGPU-specific material customization.

4. **Plugin compatibility tiers:**
   - **Tier 1 (both)**: Scene graph, GLTF loading, camera controls, asset management, basic materials, UI plugins
   - **Tier 2 (WebGL-only, explicit)**: SSAO, GBuffer, DepthBuffer, NormalBuffer, MaterialExtension plugins, PathTracer, ExtendedRenderPass multi-phase rendering
   - **Tier 3 (WebGPU-only, future)**: Compute shader plugins, TSL material extensions, new rendering techniques

5. **The rmClass pattern already exists.** ThreeViewer already supports `(options as any).rmClass` for injecting a different render manager class (used by `DummyRenderManager` for Node.js). This pattern extends naturally to `WebGPURenderManager`.

## Subplans

Detailed implementation plans for each phase are tracked separately:

- [Phase 0: Three.js Upgrade Path](./webgpu-phase0-threejs-upgrade.md)
- [Phase 1: Core Abstraction & IRenderManager Cleanup](./webgpu-phase1-core-abstraction.md)
- [Phase 2: WebGPURenderManager Implementation](./webgpu-phase2-render-manager.md)
- [Phase 3: Material Compatibility Layer](./webgpu-phase3-materials.md)
- [Phase 4: Basic Post-Processing for WebGPU](./webgpu-phase4-postprocessing.md)
- [Phase 5: Plugin Compatibility Audit & Migration](./webgpu-phase5-plugins.md)
- [Phase 6: Examples, Testing & Alpha Release](./webgpu-phase6-alpha-release.md)

## Current Blockers & Dependencies

### Three.js Version Gap (r168 → r171+)
WebGPURenderer became production-ready at r171. The modded three.js fork is at r168 on dev (threepipe still consumes r163). The gap is manageable:
- Threepipe → r168 integration: fork work done, just needs consumption + compile fixes
- r168 → r171 in fork: 3 version bumps with patch conflict resolution
- The `@types/three` modded types repo (`repalash/three-ts-types`) is also at r168 (`v0.168.10001`)

**Phase 1 (core abstraction) can start NOW in parallel** — it's pure TypeScript refactoring independent of three.js version.

### Modded Three.js Patches
The 20 patches to three.js fall into categories:

| Category | Patches | WebGPU Impact |
|---|---|---|
| **Render mode flags** | userData.shadowMapRender/opaqueRender/etc | WebGL-only. WebGPU render manager won't use these. |
| **Material lifecycle** | onBeforeRender/onAfterRender on Material, allowOverride, onBuild | Need equivalents for WebGPU materials or node-based alternatives |
| **Internal API exposure** | renderer.properties/state/materials/background | WebGL-only. WebGPU render manager uses different APIs |
| **Background/env** | textureSlots, envMapSlotKey, backgroundColor, flipX/Y | Need WebGPU equivalents via TSL or scene properties |
| **Misc** | copyMaterialUserData, copyTextureUserData, reflectivity clamp | Material-level, mostly backend-agnostic |

**Key insight**: Most patches are only needed by the WebGL path. The WebGPU path starts clean without needing most of these. The patches that are material-level (userData copy, reflectivity) should work on both.

### GLSL Shader Inventory
All custom GLSL shaders (30+ files) are WebGL-only. For alpha WebGPU support, we do NOT need to port these — standard materials are auto-converted by `NodeMaterial.fromMaterial()`. Custom shader work (MaterialExtensions, post-processing effects) is post-alpha.

**Key research finding (2026-03-24)**: There is NO GLSL→WGSL transpilation available. `glslFn()` **throws** on the WebGPU backend (WGSLNodeParser can't parse GLSL). TSL `Fn()` is the only cross-backend solution for custom shaders. See [webgpu-glsl-research.md](./webgpu-glsl-research.md).

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Three.js upgrade breaks existing functionality | High | Incremental upgrades with full test suite at each step |
| TSL API continues changing between releases | Medium | Pin to a specific three.js version for WebGPU, don't chase latest |
| Modded three.js patches don't port cleanly | High | Some patches may need to be upstreamed or redesigned |
| Performance regression in WebGPU path | Medium | Benchmark early, optimize later — alpha doesn't need to be faster |
| Plugin authors confused by dual backend | Low | Clear documentation, plugin compatibility markers |

## Definition of Done (Alpha)

A user can do all of the following with `renderer: 'webgpu'`:
- [ ] Create a ThreeViewer with WebGPU rendering
- [ ] Load and display GLTF/GLB files with standard PBR materials
- [ ] Set environment map and background
- [ ] Use orbit camera controls
- [ ] Resize the canvas correctly
- [ ] Basic tonemapping works
- [ ] Canvas screenshot export works
- [ ] Transparent background works
- [ ] Editor helpers and gizmos render correctly (TransformControls, Object3DWidgets, etc.)
- [ ] Progressive rendering works (needs TSL-based implementation — see Phase 4)
- [ ] The same application code (minus WebGL-only plugins) works with both `renderer: 'webgl'` and `renderer: 'webgpu'`
- [ ] Playwright E2E tests pass for WebGPU examples (separate snapshot baselines)

### Post-Alpha Goals
- Material extensions on WebGPU — requires new TSL-based `NodeMaterialExtension` system; see [glsl research](./webgpu-glsl-research.md)

## Non-Goals (Alpha)

- SSAO, GBuffer, depth/normal buffer passes on WebGPU
- ExtendedRenderPass multi-phase rendering on WebGPU (not needed — this is a WebGL optimization)
- Path tracing on WebGPU
- Contact shadows on WebGPU
- HDRi ground projection on WebGPU
- Custom GLSL shaders (ObjectShaderMaterial/ShaderMaterial2) on WebGPU
- Gaussian splatting on WebGPU
- External plugin packages on WebGPU (focus on core only)
- Compute shader support (future feature, not alpha)

## Timeline & Dependency Graph

**KEY FINDING (2026-03-24):** The `three.js-modded` fork is already at r168 on its dev branch. Threepipe just hasn't consumed it yet. This shortens Phase 0 significantly — only r168 → r171 (3 versions) needs new fork work.

```
Phase 0a: Integrate r168 into threepipe       [~1 week — fork work already done]
Phase 0b: Upgrade fork r168 → r171            [~1-2 weeks — 3 version bumps]
    │
    ├── Phase 1: Core Abstraction             [1-2 weeks, STARTS NOW in parallel]
    │       │
    │       ├──→ Phase 2: WebGPURenderManager [2-3 weeks, after Phase 0b + 1]
    │       │       │
    │       │       ├──→ Phase 3: Materials   [2-3 weeks, can overlap Phase 2]
    │       │       │
    │       │       └──→ Phase 4: Post-proc   [1-2 weeks, after Phase 2 + 3]
    │       │
    │       └──→ Phase 5: Plugin Audit        [2-3 weeks, can overlap Phase 2-4]
    │
    └──────────→ Phase 6: Alpha Release       [1-2 weeks, after all above]
```

**Critical path**: Phase 0b → Phase 2 → Phase 4 → Phase 6
**Minimum time to alpha**: ~8-10 weeks (improved from 10-14 thanks to r168 existing)
**Parallelism**: Phase 1 runs NOW alongside Phase 0; Phase 3 + 5 overlap with Phase 2

## Research Findings (Reference)

### Threepipe Renderer Architecture (current)
- `ViewerRenderManager` extends `RenderManager` extends `RenderTargetManager` — all WebGL
- `IWebGLRenderer extends WebGLRenderer` with `renderWithModes()` for multi-phase rendering
- `EffectComposer2` orchestrates GLSL-based pipeline passes (topological sort)
- `ExtendedRenderPass` renders opaque → transparent → transmission in separate phases
- `ScreenPass` composites final output with tonemapping and color space conversion
- No direct `gl.*` calls — all through three.js abstractions (except `renderer.properties.get()`)

### Modded Three.js (r163, 20 patches)
- Render mode flags (userData.shadowMapRender, etc.) — core to multi-phase rendering
- Material lifecycle hooks (onBeforeRender/onAfterRender on Material) — core to MaterialExtension
- Internal API exposure (renderer.properties/state/materials/background)
- Background enhancements (flipX/Y, backgroundColor, getBoxMesh)
- Per-material env maps (textureSlots, envMapSlotKey, separateEnvMapIntensity)
- Material patches (allowOverride, onBuild, copyUserData, reflectivity clamp)

### Material System
- `IMaterial` interface wraps three.js materials via `upgradeMaterial()` monkey-patching
- `MaterialExtension` injects GLSL via `onBeforeCompile` + `MaterialExtender`
- `#glMarker` named injection points in shader strings
- `ShaderChunk` monkey-patching for global shader modifications
- 5 built-in material extension plugins + screen pass extension pattern

### GLSL Shader Inventory (30+ files)
- Core utilities: cameraHelpers, randomHelpers, voronoiNoise, defaultVertex/Fragment
- Post-processing: ScreenPass, Tonemap, Vignette, FilmicGrain, ChromaticAberration
- Pipeline: GBuffer vert/frag/unpack, DepthBuffer unpack, SSAO pass/patch
- Material extensions: FragmentClipping, NoiseBump, CustomBump, ParallaxMapping
- Extras: HDRiGround, Gaussian splatting shaders

### Three.js WebGPU Status (March 2026)
- `WebGPURenderer` production-ready since r171 (Sept 2025), current is r183
- Backend-agnostic `Renderer` base class with `WebGPUBackend`/`WebGLBackend`
- **TSL (Three Shading Language)** replaces GLSL — JS-based node shader authoring
- `onBeforeCompile` **silently ignored** (new Renderer never calls it — confirmed in source)
- `ShaderMaterial` / `RawShaderMaterial` **throw error** (`NodeMaterial: Material "ShaderMaterial" is not compatible`)
- `glslFn()` **throws on WebGPU backend** (WGSLNodeParser can't parse GLSL). Works on WebGLBackend only.
- `EffectComposer` **fundamentally incompatible** — ShaderMaterial unsupported, `renderer.state` missing
- `renderer.properties`/`state`/`materials` do NOT exist on new renderer
- No GLSL-to-WGSL transpilation planned. TSL `Fn()` is the only cross-backend shader authoring path.
- Browser support: ~95% (Chrome/Edge shipped 2023, Firefox v141+, Safari v26+)
- TSL API still evolving between releases (PostProcessing → RenderPipeline in r183)

### Plugin Coupling Analysis
- **17 plugins** are WebGL-only (SSAO, GBuffer, Depth, Normal, Progressive, FrameFade, ContactShadow, HDRiGround, CascadedShadows, VirtualCameras, PathTracer, 5 MaterialExtension plugins)
- **17 plugins** are backend-agnostic (controls, animation, export, UI, configurator, loaders)
- **3 plugins** need minor adaptation (tonemapping, KTX2, snapshot)
- **3 external plugins** need case-by-case assessment (GaussianSplat, 3DTiles, ProceduralGen)

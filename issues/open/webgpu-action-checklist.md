# WebGPU Migration — Action Checklist

**Last updated**: 2026-03-24
**Owner**: Palash (fork + threepipe) + Claude (abstraction + research)

---

## Priority 1: Immediate (this week)

### Integrate r168 into threepipe
Upgrade scan found **zero breaking API usages** in source. Type errors from `@types/three` changes possible but expected to be minimal.
- [ ] Update `package.json`: `three` URL → `v0.168.10003` tgz from GitHub releases
- [ ] Update `package.json`: `@types/three` URL → `v0.168.10001` tgz
- [ ] `npm install`
- [ ] `npm run build` — fix any type errors (scan found no API breaks, but type defs may have changed)
- [ ] Visual test key examples (GLTF viewer, material showcase, post-processing)
- [ ] Verify ShaderChunk patches still match (4 files: CascadedShadows, Tonemap, MaterialManager, ParallaxMapping — scan says they do, but verify after actual install)
- [ ] Test downstream consumers if any

### Finalize GLSL/WebGPU research
Two agents running — need answers before committing to architecture.
- [ ] Review `webgpu-glsl-research.md` when ready — key question: can GLSL be used with WebGPU at all?
- [ ] Review `webgpu-webglbackend-research.md` — key question: is WebGPURenderer+WebGLBackend a viable stepping stone?
- [ ] Based on findings, decide: TSL rewrite vs GLSL transpilation vs WebGLBackend-first
- [ ] Update phase plans with corrected strategy

### IRenderManager interface design
Audit is done (50 files catalogued). Design the split.
- [ ] Review `webgpu-rendermanager-audit.md` — 13 files are already backend-agnostic
- [ ] Draft `IRenderManager` base interface (Category A APIs only)
- [ ] Draft `IWebGLRenderManager extends IRenderManager` (Category C APIs)
- [ ] Decide where Category B (pipeline) APIs go — base or WebGL-specific
- [ ] Review with Palash before implementing

---

## Priority 2: Next 1-2 weeks

### Implement IRenderManager split (Phase 1)
- [ ] Create `IRendererCapabilities` interface (replace `isWebGL2`)
- [ ] Split `IRenderManager` in `src/core/IRenderer.ts`
- [ ] Update `ViewerRenderManager` to implement both interfaces
- [ ] Replace `WebGLRenderTarget` in base interface signatures with `IRenderTarget`
- [ ] Add `renderer?: 'webgl' | 'webgpu'` to `ThreeViewerOptions`
- [ ] Add `supportedBackends` to `IViewerPlugin` interface
- [ ] Add backend check in `ThreeViewer.addPluginSync()`
- [ ] Annotate WebGL-only plugins with `supportedBackends = ['webgl']`
- [ ] Verify all existing tests/examples still pass

### Upgrade fork r168 → r171
- [ ] Merge stock r169 into fork dev branch — key change: `Material.type` immutable
  - Fix `ShaderMaterial2.ts` lines 64, 70 (`this.type = ...`)
  - Fix `TubeShapeGeometry.ts` line 61
  - Fix `OBJLoader2.ts` lines 394, 411
- [ ] Merge stock r170 — key change: `TransformControls` API
  - Check if threepipe's custom `TransformControls.js` conflicts
  - `EXRExporter.parse()` becomes async
- [ ] Merge stock r171 — WebGPU milestone
  - `three/webgpu` and `three/tsl` import paths available
- [ ] Update `@types/three` modded types for r171
- [ ] Build, tag `v0.171.10001`, publish
- [ ] Integrate r171 into threepipe, fix compile errors, test

---

## Priority 3: After r171 + interface split done

### WebGPURenderManager (Phase 2)
- [ ] Create `WebGPURenderManager` extending `RenderTargetManager`
- [ ] Implement `IRenderManager` interface
- [ ] Wire into ThreeViewer via `renderer: 'webgpu'` option
- [ ] Basic render loop with `setAnimationLoop` (auto-init)
- [ ] `viewer.ready: Promise<void>` for users needing await
- [ ] Canvas resize handling
- [ ] Render target management (override `_createTargetClass` for base `RenderTarget`)
- [ ] `blit()` implementation for WebGPU
- [ ] Device lost handling (`renderer.onDeviceLost`)

### Material verification (Phase 3)
- [ ] Test `PhysicalMaterial` rendering on WebGPU (auto-converted via `NodeMaterial.fromMaterial`)
- [ ] Test `UnlitMaterial` rendering
- [ ] Test GLTF loading with standard materials
- [ ] Test environment maps (`scene.environment`)
- [ ] Test transparent objects
- [ ] Test shadow maps (note: may need different bias values)
- [ ] Error handling for `ShaderMaterial2`/`ObjectShaderMaterial` on WebGPU

### Basic post-processing (Phase 4)
- [ ] Tonemapping via TSL or renderer built-in
- [ ] Correct sRGB output
- [ ] Pipeline pass stubs (log warnings for WebGL-only passes)

---

## Priority 4: Alpha polish

### Testing (leverages existing Playwright pipeline — 180 E2E tests, screenshot comparison)
- [ ] Add `chromium-webgpu` project in `playwright.config.ts` with `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`
- [ ] Create `tests/webgpu.spec.ts` for WebGPU-specific examples
- [ ] WebGPU examples must call `_testStart()` / `_testFinish()` (same pattern as existing)
- [ ] Generate baseline WebGPU snapshots in `tests/snapshots/chromium-webgpu-{platform}/`
- [ ] Dual-renderer comparison: run select examples with both renderers, compare screenshots
- [ ] Verify deterministic injection works with WebGPU (`Math.random`, `Date.now`, `rAF` overrides)
- [ ] Update `check-test-coverage.mjs` to include WebGPU examples
- [ ] Test `ProgressivePlugin` convergence on WebGPU path

### Examples & docs
- [ ] WebGPU example: basic GLTF viewer (with `_testStart`/`_testFinish` instrumentation)
- [ ] WebGPU example: dual-renderer comparison
- [ ] Progressive rendering on WebGPU
- [ ] Editor helpers/gizmos verification
- [ ] Material extensions feasibility test
- [ ] Documentation: plugin compatibility table
- [ ] Documentation: known limitations
- [ ] Alpha release tag

---

## Research Findings Summary

| Question | Answer | Impact |
|---|---|---|
| `three/webgpu` import in r168? | **YES** — exists in r168 fork (since r167). NOT in currently installed r163. | Must integrate r168 first before any WebGPU dev |
| WebGPURenderer+WebGLBackend viable? | **Dev/test only** — 5-10x slower (UBO issue #30560, OPEN) | Not a production stepping stone |
| `glslFn()` on WebGLBackend? | **YES** — GLSL inserted directly, works perfectly | Existing GLSL can be wrapped in glslFn() for node system |
| Old EffectComposer with WebGPURenderer? | **NO** — ShaderMaterial unsupported, `renderer.state` missing | Post-processing must be rebuilt for WebGPU regardless |
| `onBeforeCompile` on WebGPURenderer? | **Silently ignored** — new Renderer never calls it | MaterialExtension system won't work as-is |
| Standard materials on WebGPU? | **YES** — auto-converted via `NodeMaterial.fromMaterial()` | GLTF loading works without changes |

| `glslFn()` on WebGPU backend? | **THROWS ERROR** — WGSLNodeParser can't parse GLSL syntax | glslFn is WebGLBackend-only. Not a WebGPU path. |
| GLSL→WGSL transpilation available? | **No viable option** — naga-wasm dormant since 2020, twgsl is 2MB. Three.js says "no plans." | Custom shaders must use TSL `Fn()` for WebGPU |
| TSL `Fn()` cross-backend? | **YES** — compiles to WGSL on WebGPU, GLSL on WebGL | This is THE migration path for custom shaders |

### Still pending:
| Question | Status | Blocks |
|---|---|---|
| How do material lifecycle hooks work with auto-converted materials? | Needs empirical test | Material extensions on WebGPU |
| Progressive rendering without EffectComposer? | Needs design | Alpha scope |

---

## Reference: Key Files

| File | Purpose |
|---|---|
| `issues/open/webgpu-renderer-support.md` | Master plan |
| `issues/open/webgpu-workplan-week1.md` | Week 1 work plan with status tracking |
| `issues/open/webgpu-r168-upgrade-scan.md` | r168 upgrade impact scan (LOW risk) |
| `issues/open/webgpu-rendermanager-audit.md` | Full audit of 50 files accessing renderer |
| `issues/open/webgpu-research-findings.md` | Technical research (render targets, animation loop, etc.) |
| `issues/open/webgpu-phase0-threejs-upgrade.md` | Three.js upgrade plan |
| `issues/open/webgpu-phase1-core-abstraction.md` | IRenderManager split plan |
| `issues/open/webgpu-phase2-render-manager.md` | WebGPURenderManager impl plan |
| `issues/open/webgpu-phase3-materials.md` | Material compatibility plan |
| `issues/open/webgpu-phase4-postprocessing.md` | Post-processing plan |
| `issues/open/webgpu-phase5-plugins.md` | Plugin audit and compatibility |
| `issues/open/webgpu-phase6-alpha-release.md` | Alpha release checklist |

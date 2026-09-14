# WebGPU — Week 1 Concrete Work Plan

**Parent**: [webgpu-renderer-support.md](./webgpu-renderer-support.md)
**Week of**: 2026-03-24
**Tracks**: Two parallel workstreams

---

## Workstream A: Phase 1 — Core Abstraction (Claude, immediate)

Can start now. Doesn't depend on three.js version. Pure TypeScript refactoring against current r163.

### Day 1-2: Audit & Design

- [ ] **A1.1** Audit every access to `renderManager` across the entire codebase. Categorize each access:
  - Uses only IRenderManager-safe methods (render, resize, targets, blit, size, clock, etc.)
  - Uses WebGL-specific: `webglRenderer`, `context`, `isWebGL2`, `composer`, `renderer` as IWebGLRenderer
  - Uses pipeline-specific: `registerPass`, `unregisterPass`, `passes`, `pipeline`
  - Output: table in this file or a separate audit file

- [ ] **A1.2** Audit every plugin's `onAdded()` for what it accesses on the viewer/renderManager.
  - Which plugins would work unmodified if renderManager changed?
  - Which need `webglRenderer` or `composer`?

- [ ] **A1.3** Design the `IRendererCapabilities` interface based on actual usage patterns found in audit

- [ ] **A1.4** Decision: async init pattern. Research results from background agent will inform this. Likely `setAnimationLoop` handles it (three.js auto-inits on first frame).

### Day 2-3: Interface Refactoring

- [ ] **A1.5** Create `IRendererCapabilities` and add to `IRenderManager`
  - Replace `isWebGL2` usages with capability checks
  - `ViewerRenderManager` implements it using current `renderer.capabilities.isWebGL2` + extension checks

- [ ] **A1.6** Split `IRenderManager` — extract WebGL-specific members into a sub-interface
  - `IRenderManager` = base contract (both backends)
  - `IWebGLRenderManager extends IRenderManager` = WebGL additions (composer, webglRenderer, context, passes)
  - All existing code keeps working — ViewerRenderManager implements both

- [ ] **A1.7** Add `renderer` option to `ThreeViewerOptions` type (type only, not wired yet)
  - `renderer?: 'webgl' | 'webgpu'`
  - Default: `'webgl'`

### Day 3-4: Plugin Compatibility Infrastructure

- [ ] **A1.8** Add `supportedBackends` to `IViewerPlugin` interface
  - Optional property, undefined = all backends
  - Add check in `ThreeViewer.addPluginSync()` / `addPlugin()`

- [ ] **A1.9** Annotate all WebGL-only plugins with `supportedBackends = ['webgl']`
  - See [Phase 5 plugin list](./webgpu-phase5-plugins.md)

- [ ] **A1.10** Verify: all existing examples and tests still pass after refactoring

### Deliverable
IRenderManager is clean enough that a new `WebGPURenderManager` can implement it without touching WebGL code. Plugin system knows about backends.

### Open Items for Workstream A
- **RenderTargetManager base class**: Currently creates `WebGLRenderTarget` in `_createTargetClass()`. Research confirms `WebGPURenderer` accepts these (it only checks `RenderTarget` shape), but cleaner to use base `RenderTarget`. Need to make `_createTargetClass()` overridable.
- **EffectComposer2 in IRenderManager**: Currently `composer: EffectComposer2` is on the interface. Must move to `IWebGLRenderManager`.
- **readRenderTargetPixels**: WebGL version is sync, WebGPU version is async (`readRenderTargetPixelsAsync`). The `renderTargetToBuffer`/`exportRenderTarget` APIs may need async variants.
- **Progressive rendering on WebGPU**: User wants this in alpha. `ProgressivePlugin` currently uses EffectComposer blend passes. Will need a TSL-based implementation or a different approach for WebGPU.

---

## Workstream B: Phase 0 — Three.js Upgrade (Palash + agents)

### KEY FINDING: Fork is already at r168 on dev branch

The `three.js-modded` repo's `dev` branch is at `v0.168.10003` with tags for r165, r166, r168.
But threepipe's `package.json` still points to `v0.163.10003`.

**Existing upgrade merge history on dev branch:**
```
r163 → r165 (Merge tag 'r165' into dev)
r165 → r166 (Merge tag '_r166.0' into dev)
r166 → r168 (Merge tag 'r168' into dev)
```

**This means:**
- r163 → r168 patches are ALREADY done in the fork
- Only r168 → r171 (3 versions) needs new fork work
- The `@types/three` modded types repo is also at r168 (`v0.168.10001` on master)
- Threepipe just hasn't been updated to consume r168 yet
- NOTE: `Material.type` immutable is r169, so it hasn't been handled yet — will be part of r168→r171

### Day 1-2: Integrate r168 into threepipe (Palash)

- [ ] **B1.1** Update threepipe's `package.json` to use `v0.168.10003`
  - Update `three` dependency URL
  - Update `@types/three` dependency URL
  - Run `npm install`

- [ ] **B1.2** Fix TypeScript compilation errors
  - Key known breaking changes r163→r168 (see [r168 upgrade scan](./webgpu-r168-upgrade-scan.md) for full details):
    - `copyTextureToTexture()` signature changed (r166)
    - `copyFramebufferToTexture()` parameter order swapped (r166)
    - `DragControls.activate()/deactivate()` → `connect()/disconnect()` (r167)
    - `lightmap_fragment` shader chunk removed (r164)
  - NOTE: `Material.type` immutable is r169, NOT in r168. Will affect r168→r171 upgrade.
  - NOTE: `TransformControls` API change is r170, NOT in r168.
  - Agent scan running (produces webgpu-r168-upgrade-scan.md)

- [ ] **B1.3** Visual testing — run key examples, compare rendering

- [ ] **B1.4** Run downstream library tests

### Day 2-3: Upgrade fork from r168 → r171 (Palash)

- [ ] **B2.1** Merge stock r170 tag into dev branch in three.js-modded
  - r169 changes: Material.type immutable, mipmap generation changes
  - r170 changes: TransformControls API, EXRExporter async, several removals
  - Resolve conflicts in patched files

- [ ] **B2.2** Merge stock r171 tag into dev branch
  - r171 changes: WebGPU import paths restructured (`three/webgpu`, `three/tsl`)
  - This is the milestone: WebGPURenderer is production-ready

- [ ] **B2.3** Build, tag as `v0.171.10001`, test

### Day 3-4: Integrate r171 into threepipe

- [ ] **B3.1** Update threepipe to use `v0.171.10001`
- [ ] **B3.2** Fix compilation errors
- [ ] **B3.3** Visual test all examples
- [ ] **B3.4** Verify `three/webgpu` import path is available

### Agent Strategy for Workstream B

Agents can help with:
1. **API usage scan**: Given a list of changed APIs (from migration guide), scan threepipe for usages
2. **Build validation**: Run `npm run build` after each three.js version bump, report errors
3. **Type checking**: Run `tsc` and categorize errors by cause
4. **Diff analysis**: Compare patched files between fork versions to track patch evolution
5. **Breaking change summary**: For each version bump (r168→r169, r169→r170, r170→r171), list changes that affect threepipe

**Process for each version bump:**
1. Agent scans threepipe for affected APIs
2. Palash does the merge in the fork
3. Agent builds and reports errors
4. Palash fixes, agent validates

---

## Open Decisions to Lock Down

### 1. Async Init Pattern — DECIDED

Research findings from multiple frameworks:
- **Three.js own examples**: `setAnimationLoop()` auto-calls `init()` if not initialized. First frame renders when ready.
- **Babylon.js**: `new WebGPUEngine(canvas) + await engine.initAsync()`. Also has `EngineFactory.CreateAsync()` factory.
- **R3F v9**: Async `gl` prop factory — `<Canvas gl={async (canvas) => { ... }}>`.
- **Threlte**: `createRenderer` prop with deferred renderMode, switched to `'on-demand'` after init.

**Decision**: Use three.js's built-in `setAnimationLoop` auto-init.

- `ThreeViewer` constructor stays **synchronous** — no breaking change
- `WebGPURenderManager` calls `this._renderer.setAnimationLoop(this._animationLoop)` which auto-inits
- First frame renders when WebGPU device is ready (transparent to user)
- Expose `viewer.ready: Promise<void>` for users who need to await (e.g., take screenshot immediately after creation)
- No `await viewer.init()` required — works just like WebGL from the user's perspective

This matches how three.js itself recommends using WebGPURenderer.

### 2. IRenderManager.registerPass/unregisterPass
**Decision needed**: Should the base `IRenderManager` include pass registration?
- Option A: Yes, both backends support passes (but with different pass types)
- Option B: No, pipeline management is backend-specific — only `IWebGLRenderManager` has it
- Option C: Base interface has it but `WebGPURenderManager` logs warnings for unsupported passes

**Leaning toward**: Option A with a backend-agnostic `IPipelinePass` base. Pass implementations are different but registration is shared. This lets `PipelinePassPlugin` work on both with backend-specific `_createPass()`.

### 3. Material Extensions on WebGPU
**Stretch goal for alpha — now understood to require significant work.**

Research confirmed:
- `onBeforeCompile` is silently ignored → the GLSL injection part of MaterialExtension is dead on WebGPU
- `glslFn()` throws on WebGPU backend → can't wrap existing GLSL
- No GLSL→WGSL transpilation available
- TSL `Fn()` is the only cross-backend path for custom shader logic

The `onObjectRender`/`onAfterRender` callbacks (which update uniforms per frame) depend on the modded three.js's `material.onBeforeRender` patch. This doesn't exist in the new Renderer. Even if uniforms could be updated, the shader modifications that use them wouldn't be compiled.

**Conclusion**: Material extensions on WebGPU require a new TSL-based `NodeMaterialExtension` system (using `material.colorNode`, `material.normalNode`, etc. instead of GLSL string injection). This is post-alpha work.

---

## Status Tracking

| Task | Status | Owner | Notes |
|---|---|---|---|
| A1.1 Audit renderManager access | **Done** | Claude | [webgpu-rendermanager-audit.md](./webgpu-rendermanager-audit.md) — 50 files, 13 A-only |
| A1.2 Audit plugin dependencies | **Done** | Claude | Covered in A1.1 audit — included in same report |
| A1.3 Design IRendererCapabilities | Not started | Claude | |
| A1.4 Async init decision | Research done | Both | setAnimationLoop auto-inits; see research below |
| A1.5 IRendererCapabilities impl | Not started | Claude | |
| A1.6 Split IRenderManager | Not started | Claude | |
| A1.7 Renderer option type | Not started | Claude | |
| A1.8 supportedBackends infra | Not started | Claude | |
| A1.9 Annotate plugins | Not started | Claude | |
| A1.10 Validate no regressions | Not started | Claude | |
| B1.1 Integrate r168 into threepipe | Not started | Palash | Fork already at r168! |
| B1.2 Fix r168 compile errors | Scan done | Palash + agent | **LOW RISK** — no source changes needed, only @types/three update. See [r168 scan](./webgpu-r168-upgrade-scan.md) |
| B1.3 Visual test r168 | Not started | Palash | |
| B2.1 Fork merge r170 tag | Not started | Palash | |
| B2.2 Fork merge r171 tag | Not started | Palash | |
| B2.3 Integrate r171 into threepipe | Not started | Palash + agent | |
| B3.1 Visual test r171 | Not started | Palash | |

---

## Decisions Log

| Decision | Date | Context |
|---|---|---|
| **Async init**: use `setAnimationLoop` auto-init, ThreeViewer constructor stays sync, expose `viewer.ready` promise | 2026-03-24 | Three.js auto-inits on first frame; matches official recommendation |
| **ExtendedRenderPass multi-phase**: WebGL-only optimization, not needed for WebGPU | 2026-03-24 | Palash confirmed: performance improvement + WebGL fixes, not a correctness requirement |
| **Alpha scope**: add progressive rendering, editor gizmos, possibly material extensions (stretch) | 2026-03-24 | Beyond basic GLTF + orbit, Palash wants these in alpha |
| **Focus on core only**: don't worry about external plugin packages for alpha | 2026-03-24 | PathTracer stays WebGL-only, new plugins can be WebGPU-only |
| **Three.js upgrade target**: r183 (latest) ultimately, r171 minimum, increments of 2-3 | 2026-03-24 | Consistent with existing upgrade pattern (r153→r155→r157→r158→r160→r162→r163→r165→r166→r168) |
| **Phase 0 and Phase 1 run in parallel** | 2026-03-24 | Phase 1 is pure TS refactoring, doesn't depend on three.js version |
| **Fork management**: separate git repo, manual merge process, pkg.threepipe.org proxies GitHub releases | 2026-03-24 | Palash is creator/maintainer of both threepipe and the fork |

## Repository References

| Repo | URL | Current State |
|---|---|---|
| **threepipe** | (this repo) | Consumes three.js r163 |
| **three.js-modded** | https://github.com/repalash/three.js-modded | dev branch at r168 (`v0.168.10003`) |
| **three-ts-types** | https://github.com/repalash/three-ts-types | master at r168 (`v0.168.10001`) |
| **pkg.threepipe.org** | Cloudflare Worker proxy → GitHub releases | Serves modded three.js packages |

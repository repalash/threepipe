# Three.js r168 to r171 Upgrade Scan — threepipe Codebase

**Date:** 2026-04-07
**Current three.js:** 0.168.10006 (three-modded, r168)
**Target three.js:** r171 (WebGPURenderer production-ready)
**Parent:** [webgpu-phase0-threejs-upgrade.md](./webgpu-phase0-threejs-upgrade.md)

---

## Summary

Upgrade from r168 to r171 is **feasible with moderate effort**. Most breaking changes don't affect threepipe. The main work is on the three.js-modded fork (codesplit build system) and a handful of API changes in threepipe itself.

---

## Breaking Changes — Action Required

### 1. EXRExporter.parse() now async (r169)
**Impact: 3 files**

| File | Line | Fix |
|------|------|-----|
| `src/assetmanager/export/EXRExporter2.ts` | 14-15 | Add `await` (method is already async) |
| `src/rendering/RenderManager.ts` | 698 | Convert to async/await, check callers |
| `plugins/tweakpane/src/tpImageInputGenerator.ts` | 280 | Convert to async/await |

### 2. TiltLoader removed (r169)
**Impact: 1 file**

| File | Line | Fix |
|------|------|-----|
| `plugins/extra-importers/src/index.ts` | 28, 167-170 | Remove `TiltLoadPlugin` or vendor TiltLoader from r168 |

### 3. Material.type static property (r170, partially reverted r171)
**Impact: 1 file**

| File | Line | Fix |
|------|------|-----|
| `src/core/material/ShaderMaterial2.ts` | 64-70 | `this.type = 'RawShaderMaterial'` may fail if type becomes read-only. Verify with r171 revert — builtins are writeable again, but ShaderMaterial needs checking |

All other custom materials use a separate static `TYPE` property and are already forward-compatible.

### 4. Codesplit entry points (r171)
**Impact: Fork build system only, threepipe source unaffected**

The three.js-modded fork needs:
- Add `Three.Core.js`, `Three.TSL.js`, `Three.WebGPU.Nodes.js` source entry points
- Update rollup config to produce `three.core.js`, `three.tsl.js`, etc.
- Update `package.json` exports map (`./tsl` currently points to wrong file)

Threepipe imports (`'three'`, `'three/examples/jsm/*'`) remain valid. Two fragile `three/src/*` imports exist in `Threejs.ts` and `TransformControls.d.ts` but still work.

### 5. ColorManagement treeshaking (r171)
**Impact: Needs verification**

| File | Lines | What to check |
|------|-------|---------------|
| `src/core/material/iMaterialCommons.ts` | 2, 40-41, 75 | `ColorManagement.enabled` toggle behavior preserved? |
| `src/three/Threejs.ts` | 182 | Re-export still resolves? |

---

## Breaking Changes — No Impact

| Change | Version | Why unaffected |
|--------|---------|----------------|
| TransformControls derives from Controls | r169 | Threepipe vendors its own copy extending `Object3D` |
| 23 TSL display modules moved to addons | r170 | None imported by threepipe |
| SpriteMaterial shader simplified | r169 | No sprite shader patches |
| CinematicCamera removed | r170 | Not used |
| PackedPhongMaterial/SDFGeometryGenerator/GPUStatsPanel removed | r169 | Not used |
| copyTextureToTexture3D deprecated | r170 | Not used |
| MMD modules deprecated | r170 | Not used |
| GeometryCompressionUtils signature change | r169 | Not used |
| KTX2Exporter.parse() async | r169 | Not used |
| LightProbeGenerator.fromCubeRenderTarget() async | r169 | Not used |
| TSL blending renames (burn→blendBurn etc.) | r171 | No TSL usage |
| storageObject() deprecated | r171 | Not used |
| CylinderGeometry degenerate triangles removed | r170 | Custom generator, three.js builtins only used for helpers |

---

## Opt-in Features — Defer

### Reverse-Z Depth Buffer (r169/r170)
- **Not enabled by default** — opt-in via `reverseDepthBuffer: true` on WebGLRenderer
- When enabled, would require updates to ~12 files (depth shaders, clear values, depthFunc)
- **Action:** Add `reverseDepthBuffer` option to `ThreeViewerOptions` → `IRenderManagerOptions` → WebGLRenderer constructor. Don't enable by default. Defer depth shader fixes until a user needs it.
- Key files: `DepthBufferPlugin.unpack.glsl`, `GBufferPlugin.unpack.glsl`, `cameraHelpers.glsl`, `SSAOPlugin.pass.glsl`, `ExtendedRenderPass.ts`

### Mipmap Generation Behavior (r170)
- Mipmaps now always generated when `generateMipmaps=true` regardless of filter
- **No functional impact** — threepipe render targets use `generateMipmaps: false`, and `RenderTargetManager` syncs filters
- Minor: `CanvasTexture` in `SVGTextureLoader.ts` and `ThreeViewer.ts` may generate unnecessary mipmaps

---

## New Features — Plugin Opportunities

### Integrate (r169-r171)
| Feature | Priority | Action |
|---------|----------|--------|
| **Renderer.initTexture()** (r171) | High | Expose via `IRenderManager` for texture pre-upload — prevents frame hitches in progressive rendering, KTX2, HDR env maps. `hasInitialized()` for render loop startup checks |
| **WebGLBackground.dispose()** (r171) | Medium | Call in `RootScene.disposeTextures()` and background change paths to release GPU resources |
| **PMREMGenerator.fromSceneAsync()** (r171) | Medium | Async scene-based PMREM for `HDRiGroundPlugin` and env map pipeline. Improves loading UX |

### Nice-to-Have / Automatic
| Feature | Assessment |
|---------|------------|
| **Raycaster barycoord** (r169) | Auto-available in `Intersection` results — `ObjectPicker` consumers get it for free |
| **LOD.removeLevel()** (r169) | Already re-exported, no internal LOD usage. Available for users |
| **Vector4.divide()** (r170) | Available automatically, no internal need |
| **BatchedMesh** enhancements (r169-r170) | Not used. Future: `BatchedMesh2` wrapper + extend `autoGPUInstanceMeshes` |

### WebGPU-Only — Defer to Later Phases
| Feature | Phase |
|---------|-------|
| TiledLighting (r170) | Phase 2+ (WebGPU renderer) |
| TSL time/pointer/ptr (r170) | Phase 3+ (material system) |
| IndirectStorageBufferAttribute (r170) | Phase 2+ |
| SpotLight.map for WebGPU (r171) | Phase 3+ (note: `SpotLight2` doesn't expose `.map` yet) |
| ClippingGroup + hardware clipping (r171) | Optional new plugin — threepipe has own `FragmentClippingExtensionPlugin` using SDF shaders |
| NodeMaterial castShadowNode/receivedShadowNode (r171) | Phase 3+ (WebGPU/NodeMaterial only) |
| PointShadowNode (r171) | Phase 3+ (WebGPU only — `PointLight2` already has full WebGL shadow support) |
| VSM shadow support (r169) | Phase 2+ (WebGL VSM already available and exposed in `RenderManager.shadowMapType`) |
| Per texture-set bindGroup caching (r171) | Transparent, no action ever |

---

## Upgrade Checklist

### Fork work (three.js-modded)
- [ ] Merge stock r169 into fork, resolve conflicts
- [ ] Merge stock r170 into fork, resolve conflicts
- [ ] Merge stock r171 into fork, resolve conflicts
- [ ] Add codesplit entry points (Three.Core.js, Three.TSL.js, Three.WebGPU.Nodes.js)
- [ ] Update rollup config for codesplit builds
- [ ] Update package.json exports map
- [ ] Build, tag, publish as `three-modded@0.171.x`

### Types fork (three-ts-types)
- [ ] Update to r171 types
- [ ] Publish as `three-types-modded@0.171.x`

### Threepipe
- [ ] Update `package.json` to new fork versions
- [ ] Fix EXRExporter.parse() async calls (3 files)
- [ ] Handle TiltLoader removal (remove plugin or vendor)
- [ ] Verify ShaderMaterial2.type assignment works with r171
- [ ] Verify ColorManagement import/behavior after r171
- [ ] Add `reverseDepthBuffer` option to renderer (opt-in, disabled by default)
- [ ] `npm run build` — fix any new type errors
- [ ] `npm run test:unit`
- [ ] `npm run test:e2e` — update snapshots
- [ ] `npm run check-test-coverage`

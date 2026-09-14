# Phase 0: Three.js Incremental Upgrade Path

**Parent**: [webgpu-renderer-support.md](./webgpu-renderer-support.md)
**Status**: Milestone 0a in progress
**Priority**: Critical (blocks all other phases)
**Estimated effort**: 3-6 weeks (incremental, can overlap with Phase 1 prep)

## Goal

Upgrade the modded three.js from r163 to at minimum r171 (where WebGPURenderer became production-ready). Ideally reach r175+ for stability.

## Current State

- **Threepipe uses**: `three-modded@0.168.10006` via npm alias (upgraded from `0.163.10003`)
- **Fork published at**: `v0.168.10006` (three-modded), `v0.168.10003` (three-types-modded) on npm
- **Gap remaining**: r168 → r171 (3 versions)
- **374 source files** import from `'three'`, **66 files** from `'three/examples/jsm/*'`

## Repositories

| Repo | URL | Branch | Current Version |
|---|---|---|---|
| three.js-modded | https://github.com/repalash/three.js-modded | dev | `v0.168.10006` (r168) — published as `three-modded` on npm |
| three-ts-types | https://github.com/repalash/three-ts-types | master | `v0.168.10003` (r168) — published as `three-types-modded` on npm |
| threepipe | (this repo) | dev | consuming `v0.168.10006` via `npm:three-modded` |

All three repos are at r168. Dependencies switched from GitHub tgz URLs to npm packages with `npm:` aliases.

## Upgrade Strategy (Updated 2026-03-24)

The fork already has upgrades through r168 on its `dev` branch. The work splits into:
1. **Integrate r168 into threepipe** (fork work is done, threepipe hasn't consumed it)
2. **Upgrade fork from r168 → r171** (3 version bumps — both code and types repos)
3. **Integrate r171 into threepipe**

### Milestone 0a: Integrate r168 into threepipe (fork already done)

The `three.js-modded` dev branch has these merge commits:
```
r163 → r165  (tag: v0.165.10001)
r165 → r166  (tag: v0.166.10001)
r166 → r168  (tag: v0.168.10003)
```

**Action items:**
- [x] Update threepipe `package.json` to r168 — switched to `npm:three-modded@0.168.10006` and `npm:three-types-modded@0.168.10003`
- [x] Set up CI/CD with OIDC trusted publishing for both npm packages
- [x] `npm install`
- [x] `npm run build` — fixed type errors (`useLegacyLights` removal, `shadowIntensity` in GLSL, `depthTexture` nullability, strict event maps, etc.)
- [x] Fix `CascadedShadowsPlugin` shadows not rendering — `refreshAttachedLight` race condition, re-entrancy guard, uniform upload fix (regression from v0.3.0, found during r168 testing)
- [x] Update CSM e2e snapshots (chromium-darwin + chromium-linux)
- [ ] `npm run test:unit` — verify unit test suites pass
- [ ] `npm run test:e2e` — run full Playwright suite, update snapshots for any r168 rendering changes
- [ ] `npm run check-test-coverage` — verify no examples lost coverage
- [ ] Make threepipe 0.6.0 release on r168

### Milestone 0b: Upgrade fork r168 → r171

**Three.js changes in this range:**
- r169: `Material.type` immutable (may already be handled), mipmap generation changes
- r170: `TransformControls` derived from `Controls`, EXRExporter/KTXExporter async, several removals
- r171: WebGPU import paths restructured (`three/webgpu`, `three/tsl`). **WebGPURenderer production-ready.**

**Action items:**
- [ ] Merge stock r169 tag into fork dev branch, resolve conflicts
- [ ] Merge stock r170 tag, resolve conflicts
- [ ] Merge stock r171 tag, resolve conflicts
- [ ] Build and tag as `v0.171.10001`
- [ ] Test patched three.js independently

### Milestone 0c: Integrate r171 into threepipe

- [ ] Update threepipe to `v0.171.10001`
- [ ] Fix compilation errors
- [ ] Visual test all examples
- [ ] Verify `three/webgpu` and `three/tsl` import paths are available
- [ ] Make threepipe release on r171

### Milestone 0d: Continue to r175+ (recommended, can happen later)

After r171 unlocks WebGPU development, continue upgrading in background:
- r172-r175: TSL stabilization, varying → toVarying
- r176+: Shadow Map Array, further improvements
- Target: r183 (latest)

## Patch Porting Guide

For each custom patch in the modded three.js, this tracks whether it ports cleanly:

### WebGLRenderer.js patches (render mode system)
These modify `WebGLRenderer` only. Since WebGPURenderer is a separate class, these patches **do not conflict** with WebGPU additions. They only need line-number adjustments if the stock WebGLRenderer code changes.

| Patch | Lines (r163) | Risk |
|---|---|---|
| userData render mode flags | ~1198-1460 | Medium — renderObjects function changes between versions |
| renderObjects save/restore | ~1607 | Medium |
| transmissionRenderTarget override | ~1449 | Low |
| readRenderTargetPixels textureIndex | ~2407 | Low |
| Internal API exposure (properties/state/materials) | ~335-347 | Low — just property assignments |
| userData property | ~162 | Low |
| textureSlots / envMapSlotKey | ~1693 | Medium — shader program changes between versions |
| separateEnvMapIntensity | ~2117 | Low |
| forceUseTangent | ~1834 | Low |

### Material.js patches
| Patch | Risk |
|---|---|
| allowOverride | Low — single property addition |
| onBuild callback | Low |
| onBeforeRender/onAfterRender on Material | Medium — may interact with new Material lifecycle |
| copyMaterialUserData | Low — replaces the copy function |

### Other patches
| Patch | File | Risk |
|---|---|---|
| Background shader (flipX/Y, backgroundColor) | ShaderLib/background.glsl.js, WebGLBackground.js | Medium |
| WebGLPrograms outputColorSpace | WebGLPrograms.js | Medium — this code changes between versions |
| MeshPhysicalMaterial reflectivity clamp | MeshPhysicalMaterial.js | Low |
| copyTextureUserData | Texture.js | Low |
| TextureLoader rootPath | TextureLoader.js | Low |
| Legacy encoding support | Texture.js | May be removable — check if threepipe still needs it |
| isWebGLMultipleRenderTargets compat | WebGLTextures.js | May be removable in newer three.js |

## Process for Each Upgrade

1. Clone stock three.js at target version
2. Generate diffs of all patches from current modded three.js vs stock three.js at current version
3. Apply diffs to new stock three.js, manually resolving conflicts
4. Run three.js's own test suite (if applicable)
5. Build threepipe against new three.js
6. Fix all TypeScript compilation errors
7. Run all threepipe examples visually
8. Run automated tests
9. Publish new modded package version
10. Update threepipe package.json

## Dependencies

- None (this is the first phase)

## Risks

- Some patches may become impossible if three.js refactors the relevant code significantly
- The further we go, the more breaking changes accumulate
- Need to maintain the patching infrastructure (ideally as git-format-patch files, not manual edits)

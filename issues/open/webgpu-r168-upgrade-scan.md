# Three.js r163 to r168 Upgrade Scan — threepipe Codebase

**Date:** 2026-03-24
**Scanned:** `src/`, `plugins/`, `examples/`
**Current three.js:** 0.163.10003 (modded r163)
**Target three.js:** 0.168.x (modded r168, already in `.repos/three.js-modded`)

---

## Summary

The upgrade from r163 to r168 has **low overall risk** for the threepipe codebase. Most of the breaking changes in r164-r168 target APIs that threepipe does not use. The main areas requiring attention are:

1. **`material.type` / `geometry.type` assignments** — currently writable in r168 but becoming immutable in r169 (future-proofing concern)
2. **ShaderChunk patching** — existing patches still work in r168 but are fragile and should be re-verified after upgrade
3. **`@types/three` alignment** — the modded `@types/three` package must be regenerated for r168 to match the new API surface

---

## Detailed Findings by Breaking Change

### r164: `lightmap_fragment` shader chunk removed

**Status: NOT AFFECTED**

No usage of `lightmap_fragment` found anywhere in `src/`, `plugins/`, or `examples/`. The `lightmap_pars_fragment` chunk (which still exists in r168) is also not directly referenced in code. The only lightmap reference is `GLTFMaterialsLightMapExtension` which deals with GLTF extension metadata, not shader chunks.

Files checked: All `.ts`, `.js`, `.glsl`, `.frag`, `.vert` files in `src/`, `plugins/`, `examples/`.

---

### r164: Legacy `WebGLNodeBuilder` removed

**Status: NOT AFFECTED**

No usage of `WebGLNodeBuilder` found anywhere in the codebase.

---

### r166: `WebGLRenderer.copyTextureToTexture()` signature changed

Old: `copyTextureToTexture(position, srcTexture, dstTexture, level)`
New: `copyTextureToTexture(srcTexture, dstTexture, srcRegion, dstPosition, level)`

**Status: NOT AFFECTED**

No calls to `.copyTextureToTexture()` found in `src/` or `plugins/`. The method is only used internally in the three.js-modded renderer code.

---

### r166: `WebGLRenderer.copyFramebufferToTexture()` parameter order swap

Old: `copyFramebufferToTexture(position, texture, level)`
New: `copyFramebufferToTexture(texture, position, level)`

**Status: NOT AFFECTED**

No calls to `.copyFramebufferToTexture()` found in `src/` or `plugins/`.

---

### r167: `DragControls.activate()`/`deactivate()` renamed to `connect()`/`disconnect()`

**Status: NOT AFFECTED**

No usage of `DragControls` found in `src/`, `plugins/`, or `examples/`. threepipe does not import or use `DragControls`.

---

### r167: `DragControls.getObjects()`, `setObjects()`, `getRaycaster()` removed

**Status: NOT AFFECTED**

No `DragControls` usage at all. The `getObjects()`, `getRaycaster()` found in code belong to threepipe's own `Object3DManager` and `TransformControls` (custom implementations), not three.js `DragControls`.

---

### r167: `PointerLockControls.getObject()` removed

**Status: NOT AFFECTED (custom implementation)**

threepipe uses a custom `PointerLockControls2` class (`src/three/controls/PointerLockControls2.ts`) that extends `EventDispatcher` directly — it does NOT extend three.js's `PointerLockControls`. The `getObject()` method is already commented out (line 130-134). The class already uses `connect()`/`disconnect()` methods and exposes `object` as a public property. No action needed.

- File: `src/three/controls/PointerLockControls2.ts`

---

### r168: TSL blending functions renamed (`burn()` -> `blendBurn()`, etc.)

**Status: NOT AFFECTED**

No usage of TSL functions `burn()`, `dodge()`, `blendBurn()`, `blendDodge()` found in any `.ts` files.

---

### r168: `storageObject()` deprecated

**Status: NOT AFFECTED**

No usage of `storageObject()` found in the codebase.

---

### r168: `uniforms()` renamed to `uniformArray()` (TSL)

**Status: NOT AFFECTED**

The `uniformArray` references found in `CascadedShadowsPlugin.ts` are local variable names (`this._uniformArray`), not calls to the TSL `uniforms()` or `uniformArray()` function.

---

## Additional Findings (Not Breaking But Noteworthy)

### `material.type` and `geometry.type` direct assignments (r169 concern)

In r168, `Material.type` and `BufferGeometry.type` are still writable. However, **r169 makes `Material.type` immutable**, so these assignments should be flagged for future-proofing.

| File | Line | Assignment | Risk |
|------|------|-----------|------|
| `src/core/material/ShaderMaterial2.ts` | 64, 70 | `this.type = 'ShaderMaterial'` / `this.type = 'RawShaderMaterial'` | **Medium** — will break in r169. The class property declaration on line 64 and the constructor assignment on line 70 both set `type`. Needs a different approach (e.g., override in subclass or use `Object.defineProperty`). |
| `src/core/geometry/TubeShapeGeometry.ts` | 61 | `this.type = 'TubeShapeGeometry'` | **Low** — geometry type assignment, check if `BufferGeometry.type` also becomes immutable in r169. Already has a `@ts-expect-error` comment. |
| `src/assetmanager/import/OBJLoader2.ts` | 394, 411 | `this.object.geometry.type = 'Points'` / `= 'Line'` | **Low** — used for geometry type tagging in OBJ parser. Non-standard usage. |
| `src/three/controls/TransformControls.js` | 800, 1538 | `this.type = 'TransformControlsGizmo'` / `'TransformControlsPlane'` | **Low** — these are on Object3D subclasses, not Material. |
| `src/three/utils/curve.ts` | 8 | `this.type = 'CurvePath3'` | **None** — Curve class, not Material. |

### ShaderChunk patching — fragility risk

threepipe patches several `ShaderChunk` entries by doing string replacement. These patches rely on exact string matching. While all current patches still match in r168, any subtle whitespace or content change in future versions could silently break them.

| File | Lines | ShaderChunk Patched | Status in r168 |
|------|-------|-------------------|----------------|
| `src/plugins/rendering/CascadedShadowsPlugin.ts` | 700-710, 839-846 | `lights_fragment_begin`, `lights_pars_begin` | **OK** — string matches verified |
| `src/plugins/postprocessing/TonemapPlugin.ts` | 153 | `tonemapping_pars_fragment` | **OK** — `CustomToneMapping` string still present |
| `src/assetmanager/MaterialManager.ts` | 316 | `bumpmap_pars_fragment` | **OK** — `vSigmaX` pattern still present |
| `src/plugins/material/ParallaxMappingPlugin.ts` | 56, 59, 73, 76 | `normal_fragment_maps` (via `#include`) | **OK** — chunk still exists |

### `@types/three` / Type definitions

The current codebase heavily uses `WebGLProgramParametersWithUniforms` (from `@types/three@0.163.10003`) in 20+ files across materials. This type is used as the parameter type for `onBeforeCompile()`. The type is defined in `@types/three`, not in three.js source code itself.

When upgrading to r168, the modded `@types/three` package must be regenerated. If the upstream `@types/three` for r168 still exports `WebGLProgramParametersWithUniforms`, this is a non-issue. If not, all `onBeforeCompile` signatures across the codebase need updating.

**Files using `WebGLProgramParametersWithUniforms`:**
- `src/core/material/ShaderMaterial2.ts`
- `src/core/material/PhysicalMaterial.ts`
- `src/core/material/UnlitMaterial.ts`
- `src/core/material/UnlitLineMaterial.ts`
- `src/core/material/LineMaterial2.ts`
- `src/core/material/LegacyPhongMaterial.ts`
- `src/core/material/ObjectShaderMaterial.ts`
- `src/core/material/ExtendedShaderMaterial.ts`
- `src/core/material/iMaterialCommons.ts`
- `src/core/IMaterial.ts`
- `src/materials/MaterialExtension.ts`
- `src/three/Threejs.ts` (re-export)

---

## Risk Assessment

| Category | Files Affected | Complexity | Urgency |
|----------|---------------|------------|---------|
| `lightmap_fragment` removed | 0 | N/A | None |
| `WebGLNodeBuilder` removed | 0 | N/A | None |
| `copyTextureToTexture` signature | 0 | N/A | None |
| `copyFramebufferToTexture` signature | 0 | N/A | None |
| `DragControls` API changes | 0 | N/A | None |
| `PointerLockControls.getObject()` | 0 (custom impl) | N/A | None |
| TSL renames (`burn`/`dodge`) | 0 | N/A | None |
| `storageObject()` deprecated | 0 | N/A | None |
| `material.type` immutability (r169) | 2-3 files | Medium | **Future** |
| ShaderChunk patch fragility | 4 files | Low | Monitor |
| `@types/three` alignment | 12+ files | Medium | **Required at upgrade time** |

### Overall Upgrade Difficulty: **LOW**

The threepipe codebase avoids all of the r164-r168 breaking changes. The primary work for the upgrade is:

1. **Regenerating the modded `@types/three` package** for r168 — this is mechanical work but affects type definitions across the codebase.
2. **Verifying ShaderChunk patches** — already confirmed working in r168 but should be re-tested after actual upgrade.
3. **(Optional, future-proofing)** Addressing `material.type` assignments before r169.

No code changes are required for the r163 to r168 upgrade itself, assuming the modded `@types/three` package is updated to match.

# Phase 3: Material Compatibility Layer

**Parent**: [webgpu-renderer-support.md](./webgpu-renderer-support.md)
**Status**: Not started
**Priority**: High
**Estimated effort**: 2-3 weeks
**Depends on**: Phase 0 (three.js r171+), Phase 2 (WebGPURenderManager exists)

## Goal

Make threepipe's standard materials (PhysicalMaterial, UnlitMaterial, etc.) render correctly on both WebGL and WebGPU backends. Material extensions remain WebGL-only for alpha.

## The Challenge

Threepipe materials extend three.js material classes:
- `PhysicalMaterial extends MeshPhysicalMaterial`
- `UnlitMaterial extends MeshBasicMaterial`
- etc.

In the WebGPU path, three.js uses `MeshPhysicalNodeMaterial`, `MeshBasicNodeMaterial`, etc. These are **different classes** with different APIs. A `MeshPhysicalMaterial` instance passed to `WebGPURenderer` _should_ work (three.js's WebGPU path converts legacy materials internally), but there are caveats:

1. `onBeforeCompile` is silently ignored — so MaterialExtensions won't apply
2. Some legacy material properties may behave differently
3. Internal conversion may have performance overhead vs native NodeMaterials

## Strategy

### For Alpha: Use Legacy Materials with WebGPU's Internal Conversion

Three.js `WebGPURenderer` auto-converts legacy materials via `NodeMaterial.fromMaterial()` (confirmed in source: `NodeBuilder.js` line 1098). The conversion:
1. Maps type name: `MeshPhysicalMaterial` → `MeshPhysicalNodeMaterial`
2. Copies all properties: `for (key in material) nodeMaterial[key] = material[key]`
3. The node material builds itself through TSL node graphs — the old GLSL shader chunks are NEVER used

This means:
- `PhysicalMaterial` (extends `MeshPhysicalMaterial`) renders correctly — all PBR properties transfer
- `UnlitMaterial` (extends `MeshBasicMaterial`) renders correctly
- `onBeforeCompile` is **silently ignored** (new Renderer never calls it) — MaterialExtensions don't apply
- `ShaderMaterial` / `RawShaderMaterial` **throw errors** — these are not auto-convertible

**This is acceptable for alpha.** Users get correct PBR rendering without custom effects.

### For Beta/Stable: Dual Material System

Longer term, the material system needs to support:
1. Legacy materials + `onBeforeCompile` extensions (WebGL path)
2. NodeMaterials + TSL node extensions (WebGPU path)
3. A shared `IMaterial` interface that both implement

This is a much larger effort and is NOT in scope for alpha.

## Action Items

### 3.1 — Verify standard material rendering on WebGPU

Test that threepipe's material classes render correctly when passed to `WebGPURenderer`:

- [ ] `PhysicalMaterial` with all PBR properties (color, metalness, roughness, normal, ao, emissive)
- [ ] `PhysicalMaterial` with clearcoat, sheen, transmission, IOR
- [ ] `UnlitMaterial` with color and map
- [ ] `LegacyPhongMaterial` with diffuse, specular, normal
- [ ] `LineMaterial2` (fat lines)
- [ ] `UnlitLineMaterial`
- [ ] Materials from GLTF import (these go through MaterialManager.convertToIMaterial)

### 3.2 — Handle upgradeMaterial() for WebGPU

`upgradeMaterial()` in `iMaterialCommons.ts` monkey-patches `onBeforeCompile`, `onBeforeRender`, `onAfterRender` onto materials. On the WebGPU path:

- `onBeforeCompile` — silently ignored by WebGPURenderer, safe to keep
- `onBeforeRender` — the modded three.js adds this to Material, stock three.js doesn't have it. For WebGPU, we need to check if this works or if we need a different hook.
- `onAfterRender` — same concern

**Action**: Check if three.js r171+ WebGPURenderer calls material.onBeforeRender/onAfterRender. If not, the MaterialExtension per-frame update system (`onObjectRender`) won't fire on WebGPU. For alpha, this is acceptable (no material extensions on WebGPU).

### 3.3 — MaterialManager backend awareness

`MaterialManager` should know which backend is active so it can:
- Skip registering material extensions on WebGPU materials (they won't work)
- Log clear warnings when a user tries to use a WebGL-only extension with WebGPU
- In the future, register TSL-based extensions instead

```typescript
// In MaterialManager
registerMaterial(material: IMaterial) {
    // ... existing code ...
    if (this._renderBackend === 'webgl') {
        material.registerMaterialExtensions(this._materialExtensions)
    } else {
        // WebGPU: skip GLSL-based extensions, apply TSL extensions when available
        if (this._materialExtensions.length > 0) {
            console.info('Material extensions are not yet supported on the WebGPU backend')
        }
    }
}
```

### 3.4 — Environment map handling

On WebGL, threepipe uses the modded three.js `textureSlots` + `envMapSlotKey` system for per-material environment map overrides. This doesn't exist on stock WebGPU three.js.

For alpha: Use standard `scene.environment` for all materials. Per-material env map overrides are a WebGL-only feature until we implement the TSL equivalent.

### 3.5 — Color space and encoding

WebGPU handles color space differently:
- `WebGPURenderer` default output is HalfFloat, not Uint8
- Color space management may differ

**Action**: Verify that `PhysicalMaterial` textures with `SRGBColorSpace` render correctly on WebGPU. Test HDR environments.

### 3.6 — Material serialization compatibility

Materials serialized from a WebGL session should deserialize correctly in a WebGPU session and vice versa. The `IMaterial` serialization format (JSON/glTF) is renderer-agnostic — it describes material properties, not shader code. This should work naturally.

**Action**: Test round-trip: serialize scene on WebGL → deserialize on WebGPU → verify visual correctness.

## Open Questions

1. **ObjectShaderMaterial / ShaderMaterial2**: These hold custom GLSL vertex/fragment shaders. They **throw** on WebGPU (`NodeMaterial: Material "ShaderMaterial" is not compatible`). Three.js throws this automatically — no threepipe code needed. For alpha: catch this at the threepipe level and log a user-friendly warning instead of letting the three.js error propagate.

2. **GBufferMaterial**: Uses GLSL3 MRT. WebGPU-only features that need GBuffer will need a TSL-based GBufferMaterial. Not in alpha scope.

3. **ShaderChunk patches**: `MaterialManager` patches `bumpmap_pars_fragment`, `TonemapPlugin` patches `tonemapping_pars_fragment`, `CascadedShadowsPlugin` patches `lights_fragment_begin`. These affect WebGL only. Do we need to verify they don't break when applied in a WebGPU context? (Probably safe since WebGPU doesn't use ShaderChunk at all.)

## Future: TSL Material Extension System (Post-Alpha Design Sketch)

For reference, here's a sketch of what the future TSL-based material extension system might look like:

```typescript
// Future API — NOT for alpha implementation
interface INodeMaterialExtension {
    id: string
    priority: number

    // TSL node composition — replaces parsFragmentSnippet/shaderExtender
    colorNodeModifier?: (existing: ShaderNode) => ShaderNode
    normalNodeModifier?: (existing: ShaderNode) => ShaderNode
    roughnessNodeModifier?: (existing: ShaderNode) => ShaderNode
    positionNodeModifier?: (existing: ShaderNode) => ShaderNode

    // Per-frame update — replaces onObjectRender
    onBeforeRender?: (object: IObject3D, material: IMaterial) => void

    // Compatibility
    isCompatible?: (material: IMaterial) => boolean
}

// Usage:
const noiseBump: INodeMaterialExtension = {
    id: 'noiseBump',
    priority: 10,
    normalNodeModifier: (existingNormal) => {
        const noise = Fn(() => { /* voronoi noise TSL */ })
        return mix(existingNormal, perturbedNormal, noiseStrength)
    }
}
```

This design is for future planning only. It shows how the MaterialExtension concept could translate to TSL.

## Validation

- [ ] GLTF model with standard PBR materials renders correctly on WebGPU
- [ ] Environment map applies correctly on WebGPU
- [ ] Material properties (color, metalness, roughness, maps) all work
- [ ] Clear error when using ShaderMaterial2/ObjectShaderMaterial on WebGPU
- [ ] Material serialization round-trips between WebGL and WebGPU
- [ ] No console errors from material extension system when on WebGPU

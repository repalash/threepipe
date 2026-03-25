# Phase 6: Examples, Testing & Alpha Release

**Parent**: [webgpu-renderer-support.md](./webgpu-renderer-support.md)
**Status**: Not started
**Priority**: Medium
**Estimated effort**: 1-2 weeks
**Depends on**: All previous phases

## Goal

Create WebGPU examples, establish comparison testing between backends, and prepare for alpha release.

## Action Items

### 6.1 — WebGPU example: Basic scene

A minimal example that demonstrates WebGPU rendering:

```typescript
import { ThreeViewer } from 'threepipe'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    renderer: 'webgpu',
})
await viewer.init()

await viewer.load({ src: 'model.glb' })
viewer.scene.environment = await viewer.load({ environment: 'env.hdr' })
```

### 6.2 — WebGPU example: GLTF viewer

A more complete example with:
- GLTF loading
- Environment map
- Camera controls (orbit)
- Background color/map
- Basic tonemapping
- Canvas resize
- Screenshot export

### 6.3 — Dual-renderer comparison example

A side-by-side example with two canvases:
- Left: `renderer: 'webgl'`
- Right: `renderer: 'webgpu'`
- Same scene loaded in both
- Visual comparison of output

This is valuable for:
- Catching rendering differences
- Verifying material fidelity
- Performance comparison

### 6.4 — Backend detection example

An example that:
- Checks WebGPU availability
- Falls back to WebGL if unavailable
- Shows which backend is active

```typescript
const webgpuAvailable = navigator.gpu !== undefined
const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    renderer: webgpuAvailable ? 'webgpu' : 'webgl',
})
```

### 6.5 — Automated visual regression tests

Set up visual comparison tests using Playwright or similar:
- Render a set of test scenes on both backends
- Compare screenshots pixel-by-pixel (with tolerance)
- Flag significant differences

**Test scenes:**
- Solid color objects (geometry + lighting)
- PBR material showcase (metallic, rough, smooth, transmissive)
- GLTF test models (DamagedHelmet, FlightHelmet, etc.)
- Environment map rendering
- Transparent objects
- Shadow rendering

### 6.6 — Performance benchmarks

Create a benchmark suite that measures:
- Scene initialization time (including async init for WebGPU)
- Frame render time (average, p95, p99)
- Memory usage
- Draw call count
- GLTF load time

Run on both backends for comparison.

### 6.7 — Documentation

- [ ] API docs for `renderer` option in ThreeViewerOptions
- [ ] API docs for `viewer.init()` (required for WebGPU)
- [ ] Plugin compatibility table
- [ ] Known limitations (alpha)
- [ ] Migration guide for plugin authors

### 6.8 — Alpha release checklist

- [ ] All Phase 0-5 action items complete
- [ ] Basic examples working
- [ ] No console errors on happy path
- [ ] Plugin compatibility annotations complete
- [ ] TypeScript types correct
- [ ] Package exports `WebGPURenderManager` for advanced use
- [ ] Version bump with alpha tag (e.g., `0.6.0-alpha.1`)
- [ ] Changelog entry

## Known Limitations (Alpha)

Document these clearly:

1. **Material extensions not supported on WebGPU** — plugins like NoiseBump, Parallax, ClearcoatTint, FragmentClipping will not apply on WebGPU
2. **No SSAO, GBuffer, depth/normal buffer on WebGPU** — advanced post-processing is WebGL-only
3. **No progressive rendering on WebGPU**
4. **No ExtendedRenderPass multi-phase rendering** — transparency may look different (no RGBM blending)
5. **No HDRi ground projection on WebGPU**
6. **No custom GLSL shaders on WebGPU** — ObjectShaderMaterial, ShaderMaterial2 throw errors
7. **Per-material environment map overrides not supported on WebGPU**
8. **Some shadow parameter differences** — may need different bias values
9. **Async initialization required** — `await viewer.init()`
10. **Performance not optimized** — alpha focuses on correctness, not speed

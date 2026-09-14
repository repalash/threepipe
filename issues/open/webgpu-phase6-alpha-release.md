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
// No await needed — setAnimationLoop auto-inits WebGPU transparently
// Use viewer.ready if you need to await (e.g., for immediate screenshots)
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

### 6.5 — Automated visual regression tests (Playwright)

Threepipe already has a mature E2E test pipeline: 180 tests (151 smoke + 29 interactive) using Playwright + headless Chromium with screenshot comparison (`maxDiffPixelRatio: 0.003`). The infrastructure supports this natively via Playwright projects.

#### Add a `chromium-webgpu` Playwright project

In `playwright.config.ts`, add a second project with WebGPU Chromium flags:

```typescript
projects: [
    {
        name: 'chromium',  // existing WebGL tests
        use: { ...devices['Desktop Chrome'] },
    },
    {
        name: 'chromium-webgpu',
        use: {
            ...devices['Desktop Chrome'],
            launchOptions: {
                args: [...baseArgs, '--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'],
            },
        },
        // Only run WebGPU-compatible tests
        testMatch: /webgpu\.spec\.ts/,
    },
]
```

Snapshots auto-separate via the existing `snapshotPathTemplate` which includes `{projectName}`:
- `tests/snapshots/chromium-linux/...` (WebGL, existing)
- `tests/snapshots/chromium-webgpu-linux/...` (WebGPU, new)

#### WebGPU test spec file

Create `tests/webgpu.spec.ts` that:
- Tests WebGPU-specific examples (e.g., `webgpu-gltf-viewer`, `webgpu-basic-scene`)
- Can also re-test select existing examples with `renderer: 'webgpu'` to compare visual output
- Uses the same `setupTestHooks()`, `screenshotMatch()`, `downloadFileMatch()` helpers
- The existing deterministic injection (`Math.random`, `Date.now`, `requestAnimationFrame` overrides) should work as-is

#### Dual-renderer comparison tests

For key examples, test BOTH renderers and compare:
```typescript
for (const renderer of ['webgl', 'webgpu']) {
    test(`gltf-viewer-${renderer}`, async ({ page }) => {
        await page.goto(`http://127.0.0.1:9229/examples/gltf-viewer/?renderer=${renderer}`)
        await page.waitForSelector('body._testFinish')
        await screenshotMatch(page, testInfo, `initial-${renderer}`)
    })
}
```

#### WebGPU examples need `_testStart()`/`_testFinish()` instrumentation

Same pattern as existing examples — the test waits for `body._testFinish` CSS class.

#### Challenges to address

- **SwiftShader WebGPU support**: `--use-webgpu-adapter=swiftshader` is less mature than SwiftShader for WebGL. May need real GPU or Vulkan on CI.
- **Async init**: WebGPU takes longer to init than WebGL. The 120s `_testFinish` timeout should be sufficient.
- **Convergence plugins**: `ProgressivePlugin` on WebGPU may have different convergence timing. The `screenshotMatch` helper already waits for `ProgressivePlugin.convergedPromise`.
- **Non-determinism**: WebGPU compute pipeline and async buffer mapping could introduce additional non-determinism beyond what the current deterministic injection handles.

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
- [ ] API docs for `viewer.ready` promise (for edge cases needing await)
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
3. **Progressive rendering on WebGPU uses TSL-based implementation** — may behave differently from WebGL version
4. **No ExtendedRenderPass multi-phase rendering** — transparency may look different (no RGBM blending)
5. **No HDRi ground projection on WebGPU**
6. **No custom GLSL shaders on WebGPU** — ObjectShaderMaterial, ShaderMaterial2 throw errors
7. **Per-material environment map overrides not supported on WebGPU**
8. **Some shadow parameter differences** — may need different bias values
9. **First frame may be delayed** — WebGPU auto-inits via `setAnimationLoop`, no explicit `await` needed but first render waits for GPU device
10. **Performance not optimized** — alpha focuses on correctness, not speed

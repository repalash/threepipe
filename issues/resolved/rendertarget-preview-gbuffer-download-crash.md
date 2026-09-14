# RenderTargetPreviewPlugin: GBuffer MRT target handling [RESOLVED]

## Original Bug
Right-clicking a GBuffer preview panel and clicking "Download" crashed with:
```
TypeError: Cannot read properties of undefined (reading '0')
    at exportRenderTarget (RenderManager.ts:669)
```

## Fix Applied
1. **Core**: `exportRenderTarget`, `renderTargetToDataUrl`, `renderTargetToCanvas`, `renderTargetToBuffer` — all use `target.textures?.[textureIndex] ?? target.texture` fallback
2. **RenderTargetPreviewPlugin**: Added `textureIndex` to `RenderTargetBlock` and `addTarget()` for MRT texture selection. `downloadTarget()` now uses `viewer.exportBlob()` instead of manual `<a>` link hack.
3. **Examples**: Updated to pass actual MRT render targets with `textureIndex` parameter

## Examples updated
- [x] `examples/gbuffer-plugin/script.ts`
- [x] `examples/fat-lines/script.ts`
- [x] `examples/fat-lines-ssr/script.ts`
- [x] `examples/troika-text-plane/script.ts`
- [x] `examples/instanced-mesh/script.ts`
- [x] `examples/tweakpane-editor/ThreeEditor.ts`

## Regression tests (all passing)
- [x] `gbuffer-plugin` — EXR download from normalDepth panel, panel collapse/expand/remove, stale buffer test
- [x] `depth-buffer-plugin` — EXR download from depth panel, panel interactions
- [x] `normal-buffer-plugin` — EXR download from normal panel, panel interactions
- [x] `render-target-preview` — downloads from normal/composer-1/depth panels, multi-remove
- [x] `geometry-uv-preview` — PNG downloads from glassDish/olives panels
- [x] `gltf-transmission-test-msaa` — EXR download from transparent panel
- [x] `cascaded-shadows-plugin-basic` — binary download from shadow map panel

## Remaining edge case — depth texture download
Downloading the `depthTexture` preview produces an empty/zero-size image. This is a **WebGL limitation**, not a code bug:
- `DepthTexture` is a framebuffer depth attachment — `readRenderTargetPixels` can only read color attachments
- The `{texture: depthTexture}` wrapper has no `.width`/`.height` (added fallback to `texture.image.width` but depth textures don't have `.image` either)
- The depth texture preview renders correctly on screen because `RenderTargetPreviewPlugin` uses a shader pass (reads via sampler uniform), but pixel readback requires a color render target

**To fix properly**: `downloadTarget` would need to detect depth textures and render them to a temporary color target via a fullscreen pass (depth-to-color conversion) before reading back. This is a new feature, not a bug fix.

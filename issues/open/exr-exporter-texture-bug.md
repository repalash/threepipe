# EXRExporter: `texture is not defined` in buildInfoRTT

**Created:** 2026-03-27
**Status:** Fixed upstream in three.js fork. Resolve when updated to v0.168.10004.
**Discovered via:** E2E tests (render-target-export, render-target-preview, hdr-to-exr)

## Bug

In `three/examples/jsm/exporters/EXRExporter.js`, the `buildInfoRTT` function had several issues:

1. **`texture is not defined`** — `COLOR_SPACE = texture.colorSpace` referenced a variable only in scope in `buildInfoDT`, not `buildInfoRTT`.
2. **MRT: wrong texture used** — `renderTarget.texture` (always first texture) was used even when `textureIndex > 0`. Should use `renderTarget.textures[textureIndex]`.
3. **Missing `flipY` in return** — `buildInfoDT` returns `flipY` (used at line 241), `buildInfoRTT` didn't. Should be `flipY: false` (WebGL readback is already bottom-to-top, no flip needed for RTT).
4. **Missing `colorSpace` in return** — computed but not returned (dead code currently, but should be returned for consistency with `buildInfoDT`).

## Fix (applied upstream)

```js
function buildInfoRTT( renderTarget, options = {} ) {
    const textureIndex = options.textureIndex || 0;
    const texture = renderTarget.textures
        ? renderTarget.textures[textureIndex]
        : renderTarget.texture;

    // Use `texture.*` instead of `renderTarget.texture.*` for MRT support
    const TYPE = texture.type,
        FORMAT = texture.format,
        COLOR_SPACE = texture.colorSpace;

    return {
        // ...
        colorSpace: COLOR_SPACE,
        flipY: false, // RTT readback is already bottom-to-top
        textureIndex: textureIndex,
    };
}
```

## Impact

If this bug resurfaces (e.g., after fresh `npm install` without dist patch), these 6 interactive tests would fail on EXR download:

1. **render-target-export** — `EffectComposer.rt1.exr` button download
2. **render-target-preview** — context menu EXR download (normal, depth panels)
3. **gbuffer-plugin** — context menu EXR download on MRT target (most critical — needs textureIndex)
4. **depth-buffer-plugin** — context menu EXR download
5. **normal-buffer-plugin** — context menu EXR download
6. **gltf-transmission-test-msaa** — context menu EXR download (transparent panel)

Additionally, smoke tests for `hdr-to-exr` example would fail.

## Current state
The bug is patched in `dist/index.mjs` (build output). The `node_modules` source has the unpatched version. Will be permanently fixed when three.js fork is updated to v0.168.10004.

# A Node modelling session cannot export textures

**Found:** 2026-10-18, Track R (R4 materials and markings).

`plugins/modelling-cli/src/node/polyfill.ts` stubs `canvas` without image encoding, so three's `GLTFExporter`
fails on any texture (`s.convertToBlob is not a function`) and the whole GLB save fails. Seen with a
`DataTexture` normal map (`material {preset: 'leather-black'}`) in `threepipe-modelling run ... --node`.

Today `material {relief}` and `decal` detect the missing renderer (`viewer.renderManager.webglRenderer`) and leave
the texture out with a warning, so Node sessions still save; builds with prints and relief maps run with
`--browser`.

Fix: give the headless path an image encoder for `DataTexture` / `ImageData` (a PNG encoder over the RGBA bytes
is enough for the exporter), and an SVG rasteriser for decals (resvg-wasm, or sharp where present), as part of
moving the polyfill into core (`issues/open/modelling-node-session-polyfill.md`).

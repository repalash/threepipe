# Changelog for @threepipe/webgi-plugins

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- SSGIPlugin: spatiotemporal denoiser (`SSGIPluginPass.denoiser`). The GI history is reprojected with the velocity buffer (or the camera matrices without one) and kept only on the same surface, then a variance-guided a-trous filter cleans what is left. GI is now stable while the camera and objects move; before, it reset on every moving frame. New settings: history length in motion and when still, anti-lag, spatial iterations and filter tolerances, and a debug view (raw, temporal, history length, variance)
- `SpatioTemporalDenoiser` is exported (the type of `SSGIPluginPass.denoiser`)
- SSGIPlugin: `radianceClamp` setting, a luminance cap on the light read at ray hits (fewer fireflies)
- Example `ssgi-temporal`: a Cornell-box room with moving objects, camera orbit and a moving light
- Example `ssgi-demo`: SSGI on several scenes (Cornell, Sponza, the webgi.dev scenes) with camera orbit, a split view and a GPU benchmark whose report can be copied
- SSGIPlugin: `maxScreenRadius` setting (default 1), an upper bound of the ray length in screen heights at each pixel's depth. A small model in front of a large backdrop (a car in a mountain scene) keeps its contact occlusion without tuning the ray length
- SSGIPlugin: temporal gradient, after A-SVGF. Each ray also reads the frame before the last one at its hit point, so the denoiser knows how much the light over the same rays changed. The denoiser moves its history by that change and shortens it in proportion to a change above `gradientThreshold` (10%). After a light moves or changes color, the bounce light now follows in a few frames (Cornell box, light moved from the red to the green wall: 90% settled after 7 frames, was 43; the same change on a still scene: 13 frames, was 27). New denoiser settings `gradientAntiLag` (0 turns it off, also its cost) and `gradientThreshold`. Costs one more texture read per ray, 9 gradient reads per pixel in the denoiser and one full-screen copy per changing frame (still frames skip it); memory: a copy of the last frame, a second texture on the raw GI target and a scratch target for the spatial filter (the filter used the raw target before). The raw GI target is now always half float (the gradient is signed)

### Changed

- SSGIPlugin: new ray estimator. Rays are cosine-weighted and averaged (the old one took the maximum of the rays) and the noise changes on every frame. The look of existing scenes changes: bounce light is physically scaled, so `intensity` defaults to 1 (was 2), and `falloff` defaults to 0, no distance falloff (was 0.7). `falloff` is now an exponent on the hit distance (it was a multiplier)
- SSGIPlugin: scenes saved before this change (they carry `bilateralPass`) map the old defaults to the new ones on load: `intensity` is halved, `falloff` 0.7 becomes 0
- SSGIPlugin: `autoRadius` ray length is `2 * objectRadius * scene bounding radius`, so `objectRadius = 1` crosses the scene. With `autoRadius` off, `objectRadius` is the ray length in world units (it was multiplied by the scene bounding radius)
- SSGIPlugin: the pass runs after the velocity buffer pass, so it reprojects with this frame's velocities
- SSGIPlugin: the GI history is always half float, also when the GI buffer is 8-bit
- SSGIPlugin: UI ranges `Ray Count` up to 8 (was 5) and `Step count` up to 32 (was 16)
- SSGIPlugin: the GI buffer defaults to half float (`HalfFloatType`), so bounce light above 1 is kept
- SSGIPlugin: `smoothEnabled` now turns the denoiser's spatial filter on or off; the bilateral filter pass is removed
- SSGIPlugin: the material's own occlusion map (`aoMap`) is kept: the darker of the baked and the screen-space occlusion applies. Before, SSGI removed the baked map, so models with baked occlusion lost their contact shadows
- SSGIPlugin: the occlusion also applies to the clearcoat and sheen environment reflections, as three.js does for `aoMap`
- SSGIPlugin: SSGI applies only to materials that write the G-buffer. Glass (transmission) and alpha-blended materials no longer get the occlusion of the surface behind them, which darkened their reflections in the shape of that surface
- SSGIPlugin: SSAO is enabled again when SSGI is turned off (before, it stayed off until reload)
- SSGIPlugin: the material setting `ssgiDisabled` (the SSGI checkbox in the material UI) now works; before, only `ssrtaoDisabled` and `ssaoDisabled` did
- SSGIPlugin: the `Object Radius` slider is labeled `Ray length` and goes down to 0.001 (was 0.01)

## [0.7.0]

### Changed

- License: the webgi Free Forever License replaces the GPL v3 notice with additional terms; see LICENSE and THIRD_PARTY_NOTICES.md. Releases before 0.7.0 keep the license they carried
- Package moved into the threepipe plugin layout; the plugins and their API are unchanged
- `peerDependencies`: `threepipe` `>=0.5.1` (was `>=0.4.0`)
- The bundle is no longer minified, like the other threepipe plugins; the package also ships `src`
- Shader provenance: unused helpers and dead code removed; the TAA sharpening and the light sampling are rewritten from their formulas

## [0.6.4]

- Fix for SSContact Shadow plugin after threepipe/three.js update

## [0.6.3]

- Ground fix for widget update

## [0.6.2]

- Support for multiple object selection in OutlinePlugin (since threepipe 0.5.0)

## [0.6.1] - 2025-11-07

### Changed

- Compile with tsconfig target ES2020


## [0.6.0] - 2025-11-07

### Changed

- Update [threepipe](https://threepipe.org/) `peerDependency` to [0.4.0](https://github.com/repalash/threepipe/releases/tag/v0.4.0)
- Add `enabled` parameter to `BloomPlugin` constructor
- Updates and type changes for three.js r163
- Some type fixes.
- Compile with tsconfig target ES2022

## [0.5.11] - 2025-10-04

### Changed

- Disable SSAO and SSCS on ground mesh material in `AdvancedGroundPlugin` by setting `userData.ssaoDisabled` and `userData.sscsDisabled` to `true`.

## [0.5.10] - 2025-09-03

### Added

- Add exports field to package.json

## [0.5.9] - 2025-09-03

### Changed

- Update [threepipe](https://threepipe.org/) `peerDependency` to >=[0.2.0](https://github.com/repalash/threepipe/releases/tag/v0.2.0)

## [0.5.7] - 2025-09-01

### Added

- Batching shader snippets in `VelocityBufferPlugin`
- Handle extension cleanup in `VelocityBufferPlugin`, `SSGIPlugin`, `SSReflectionPlugin`

### Changed

- Update [threepipe](https://threepipe.org/) `peerDependency` to [0.1.0](https://github.com/repalash/threepipe/releases/tag/v0.1.0)

[unreleased]: https://github.com/repalash/threepipe/tree/dev/plugins/webgi-plugins
[0.7.0]: https://github.com/repalash/threepipe/tree/dev/plugins/webgi-plugins
[0.5.7]: https://webgi.dev/

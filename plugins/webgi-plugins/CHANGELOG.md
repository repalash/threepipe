# Changelog for @threepipe/webgi-plugins

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- NA

## [0.7.0] - 2026-10-24

### Changed

- License unchanged: the modified GNU GPL-3.0-only notice of 0.6.x, see LICENSE; third-party notices in THIRD_PARTY_NOTICES.md
- Package moved into the threepipe plugin layout; the plugins and their API are unchanged
- `peerDependencies`: `threepipe` `>=0.5.1` (was `>=0.4.0`)
- The bundle is no longer minified, like the other threepipe plugins; the package also ships `src`
- Shader provenance: unused helpers and dead code removed; the TAA sharpening and the light sampling are rewritten from their formulas

### Fixed

- `AdvancedGroundPlugin`: planar reflections created a new 1024x1024 render target on every reflection update; the target is now created once, reused, and disposed in `onRemove`
- `WatchHandsPlugin`: a watch without a second hand never moved, and an hour or minute offset change waited for the second hand; any hand off its target rotation now updates all hands
- `SSGIPlugin`: disabling or removing SSGI left SSAO disabled for good; SSGI now gives the SSAO disable key back when it is off or removed
- `SSGIPlugin`: the material's SSGI "Enabled" toggle (`userData.ssgiDisabled`) had no effect on rendering; it now turns SSGI off for that material
- `VelocityBufferPlugin`: the per-material opt-out (`userData.VelocityBuffer.disabled`) worked the wrong way round; it is now passed as the inverse of `renderToGBuffer`
- `VelocityBufferPlugin`: alpha-mapped meshes wrote motion vectors over their cut-out texels (and the alpha map had no UV channel); the velocity shader now applies the alpha test like the GBuffer material
- `AdvancedGroundPlugin`: removing the plugin left the shadow baker's render target, blur material and light in place; `ShadowMapBaker.dispose()` frees them and `onRemove` calls it. `RandomizedDirectionalLight.dispose()` now frees its shadow map

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

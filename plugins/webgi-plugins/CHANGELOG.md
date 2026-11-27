# Changelog for @threepipe/webgi-plugins

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [0.8.0-r183.1] - 2026-11-27

Release candidate of the three.js r183 upgrade lane, under the npm dist-tag `three-r183`, for threepipe 0.7.0-r183.1: the changes listed under [Unreleased] below. Its peer range is `threepipe >=0.7.0-r183.1`: its shaders need the `packingOnce` chunk and the shaders of three.js r182 and later, which threepipe 0.7.0-r183.1 brings.

## [Unreleased]

### Changed

- License: the webgi Free Forever License replaces the modified GNU GPL-3.0-only notice, from 0.8.0 (including its prereleases, such as 0.8.0-r172.1); see LICENSE and THIRD_PARTY_NOTICES.md. Releases up to 0.7.0 keep the license they carried

### Changed

- `AnisotropyPlugin` glTF export uses the async `writeMaterialAsync` hook and `processTextureAsync` (three.js r170 made `GLTFExporter` async and no longer calls `writeMaterial`; without this, exported files silently lost the anisotropy extension)
- `AnisotropyPlugin` with three.js r181: the anisotropic lobe is the single-scattering term of `BRDF_GGX_Multiscatter`, which r181 uses for direct lights, so anisotropic materials keep its energy compensation (with r181 the old patch did not find its anchor, and direct light on anisotropic materials was isotropic)
- The shader patches use the metalness-blended colors of three.js r182's `PhysicalMaterial` struct (#32190), `diffuseContribution` and `specularColorBlended`, where they used `diffuseColor` and `specularColor` (now the base color and the dielectric F0): the SSGI patch, the SSR patch, the physical mode of `Reflector2` and `AnisotropyPlugin`. With the old names a metal got the dielectric F0 and its full base color as diffuse color
- The baked shadow type of `AdvancedGroundPlugin` no longer offers `PCFSoftShadowMap`, deprecated in three.js r182 (`PCFShadowMap` is soft)

### Fixed

- `SSContactShadowsPlugin` with three.js r182: the contact shadow is added to each `getShadow` (r182 has one for each shadow map type, PCF with a `sampler2DShadow`). The plugin changed the first one only, now the VSM one, so with the default `PCFShadowMap` the materials did not compile
- `SSContactShadowsPlugin` with `CascadedShadowsPlugin`: every directional and spot `getShadow` call gets the light direction, also the four that `CascadedShadowsPlugin` adds; with both plugins a material did not compile
- `AnisotropyPlugin`: the anisotropic lobe passes its dot products to three.js's `D_GGX_Anisotropic( alphaT, alphaB, dotNH, dotTH, dotBH )` in that order; it passed them in Filament's order (`dotTH, dotBH, dotNH`), so the distribution of the direct light used the wrong angles. Anisotropic highlights look different
- `AdvancedGroundPlugin`: a saved `PCFSoftShadowMap` baked shadow type is `PCFShadowMap` (three.js r182 deprecates it and warned on every frame of a bake)
- `SSContactShadowsPlugin` and the inline ray trace of `SSReflectionPlugin` include `<packing>`, which three.js r182 removed from the material shaders; `ShadowMapBaker` (`AdvancedGroundPlugin`) includes it for its baked map, and `FSShadowMaterial` for `ShadowMaterial`

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

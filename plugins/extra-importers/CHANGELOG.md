# Changelog for @threepipe/plugins-extra-importers

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- `AmbientCGLoadPlugin` with `AmbientCGZipLoader`: an [ambientCG](https://ambientcg.com) zip with `fileExtension: 'acgzip'`. A material zip (like `Fabric087_1K-JPG.zip`) loads as a `PhysicalMaterial` with its maps (Color, NormalGL, or NormalDX with the green channel flipped, Roughness, Metalness, AmbientOcclusion, Opacity, Emission, Displacement with `displacementScale` 0), repeating, with the colour spaces set; an HDRI zip (like `NightEnvironmentHDRI011_1K.zip`) loads as its equirectangular `_HDR.exr` texture, for `viewer.setEnvironmentMap(url, {fileExtension: 'acgzip'})` or `viewer.load`, and is saved as a reference to the zip. Ported from cc0textures-threejs. `PolyhavenMaterialGLTFLoader` and `AmbientCGZipLoader` are exported, and the website guide (Loading files) documents both. Example: `examples/polyhaven-ambientcg-material-load`
- `PolyhavenMaterialLoadPlugin` with `PolyhavenMaterialGLTFLoader` (`phmatgltf`, moved from core): a material glTF from Poly Haven's CDN loads its textures (the CDN keeps them in `Textures/<jpg|png>/<res>/<id>/`, not in the `textures/` folder the glTF names; the loader maps each url by that rule)

## [0.2.7] - 2026-10-23

### Fixed

- Type declarations resolve in consumer projects with `moduleResolution: bundler`, `node16` and `nodenext` ([#60](https://github.com/repalash/threepipe/pull/60)): the `.d.ts` files imported a tsconfig `paths` alias of `three`, which resolves nowhere; relative imports carry `.js`

## [0.2.6] - 2025-19-24

### Fixes

- Fixed an issue when saving collada files loaded with ColladaLoader with library in userData.
- Kinematics and Library in the model are now saved in the result Scene under `colladaKinematics` and `colladaLibrary` instead of `userData`.

## [0.2.5] - 2025-09-03

### Changed

- Update [threepipe](https://threepipe.org/) `peerDependency` to [0.1.0](https://github.com/repalash/threepipe/releases/tag/v0.1.0)

[unreleased]: https://github.com/repalash/threepipe/tree/dev/plugins/extra-importers
[0.2.7]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugins-extra-importers-0.2.7
[0.2.5]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugins-extra-importers-0.2.5
[0.2.4]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugins-extra-importers-0.2.4

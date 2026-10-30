# Changelog for @threepipe/plugin-tweakpane

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- NA

## [0.10.2] - 2026-06-05

### Added

- `tpImageInputGenerator`: 3D LUT (`.cube`) thumbnail previews — renders a 3-band reference strip (grayscale luminance ramp, desaturated midtone rainbow, saturated rainbow) trilinearly sampled through the LUT voxel grid so distinct LUTs produce visibly distinct thumbnails. Supports `Uint8`/`Float32` voxel data and both `.texture3D` and legacy `.texture` 2D-fallback wrappers.
- `tpImageInputGenerator`: per-input extension override — `params.extensions` now honours `config.extensions` (e.g. `@uiImage('LUT', {extensions: ['.cube']})`) before falling back to the default image extensions list.
- `tpImageInputGenerator`: `.cube`-only slot guard in `setterTex` that rejects non-LUT values via `renderer.alert(...)`. Catches drag-drop, which bypasses the file-picker accept list.
- `tpImageInputGenerator.proxyGetValue`: generic `staticData.textureMap[ret] = cc` registration so non-`Texture` wrappers (e.g. `LUTCubeTextureWrapper`) survive inter-slot drag-drop recovery in `tweakpane-image-plugin@1.1.404+`, which transfers only the source `<img>`'s `src`/`id`.

### Fixed

- `tpImageInputGenerator.proxySetValue` identity-check shortcut on the `cc.image?.src === v.src` branch now guards on `v.src != null`, matching the pattern on the four `tp_src` branches. Prevents an `undefined === undefined` false-positive that turned `.cube` (and other non-image `File`) drops onto a populated wrapper-holding slot into a silent no-op.

### Changed

- Bump `tweakpane-image-plugin` pin from `v1.1.404` → `v1.1.405` (upstream MIME-check fix — `setValue(File)` now skips the `loadImage(createObjectURL)` wrap when MIME type doesn't start with `image/`, so `.cube`/`.hdr`/`.exr`/`.ktx2`/custom-MIME files pass through to `proxySetValue` as `File` instances).

## [0.10.1] - 2025-10-27

### Changed

- Update [uiconfig-tweakpane](https://threepipe.org/) in `devDependencies` to [1.0.1](https://github.com/repalash/threepipe/releases/tag/v1.0.1)

## [0.10.0] - 2025-10-27

### Changed

- Update [uiconfig-tweakpane](https://threepipe.org/) in `devDependencies` to [1.0.0](https://github.com/repalash/threepipe/releases/tag/v1.0.0)

## [0.9.0] - 2025-10-27

### Changed

- Update [threepipe](https://threepipe.org/) in `peerDependencies` to [0.4.0](https://github.com/repalash/threepipe/releases/tag/v0.4.0)

## [0.8.4] - 2025-09-03

### Fixed

- Fix `peerDependency` issue on npm.

## [0.8.3] - 2025-09-01

### Added

- Add `tsconfig.json` to package files.

### Changed

- Move `uiconfig-tweakpane` from `dependencies` to `peerDependencies`.

## [0.8.2] - 2025-09-01

### Changed

- Move `uiconfig-tweakpane` from `peerDependencies` to `dependencies`.

## [0.8.1] - 2025-09-01

### Changed

- Update [threepipe](https://threepipe.org/) `peerDependency` to [0.1.0](https://github.com/repalash/threepipe/releases/tag/v0.1.0)

[unreleased]: https://github.com/repalash/threepipe/tree/dev/plugins/tweakpane
[0.10.2]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-tweakpane-0.10.2
[0.8.1]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-tweakpane-0.8.1

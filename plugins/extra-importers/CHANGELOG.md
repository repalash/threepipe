# Changelog for @threepipe/extra-importers

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- NA

## [0.2.6] - 2025-19-24

### Fixes

- Fixed an issue when saving collada files loaded with ColladaLoader with library in userData.
- Kinematics and Library in the model are now saved in the result Scene under `colladaKinematics` and `colladaLibrary` instead of `userData`.

## [0.2.5] - 2025-09-03

### Changed

- Update [threepipe](https://threepipe.org/) `peerDependency` to [0.1.0](https://github.com/repalash/threepipe/releases/tag/v0.1.0)

[unreleased]: https://github.com/repalash/threepipe/tree/dev/plugins/extra-importers
[0.2.5]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugins-extra-importers-0.2.5
[0.2.4]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugins-extra-importers-0.2.4

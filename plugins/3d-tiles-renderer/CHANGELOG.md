# Changelog for @threepipe/plugin-3d-tiles-renderer

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- NA

## [0.3.3] - 2026-10-23

### Fixed

- Type declarations resolve in consumer projects with `moduleResolution: bundler`, `node16` and `nodenext` ([#60](https://github.com/repalash/threepipe/pull/60)): the `.d.ts` files imported `three/examples/jsm/loaders/GLTFLoader` without `.js`; relative imports carry `.js`
- Guard the `setDirty` call in the `load-content`, `load-tile-set` and `needs-update` handlers of `TilesRendererLoader`, so a handler that runs while the tileset group has no `setDirty` does not throw

## [0.3.2] - 2025-09-03

### Changed

- Update [threepipe](https://threepipe.org/) `peerDependency` to [0.1.0](https://github.com/repalash/threepipe/releases/tag/v0.1.0)

[unreleased]: https://github.com/repalash/threepipe/tree/dev/plugins/3d-tiles-renderer
[0.3.3]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-3d-tiles-renderer-0.3.3
[0.3.2]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-3d-tiles-renderer-0.3.2

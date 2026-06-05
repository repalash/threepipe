# Changelog for @threepipe/plugin-blend-importer

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- Support for compressed `.blend` files: gzip (Blender ≤ 2.93) via fflate, and zstd (Blender 3.0+ default save format) via [fzstd](https://github.com/101arrowz/fzstd). Magic-byte detection mirrors Blender's own `BLO_file_reader_uncompressed`. Verified end-to-end against 13 official Blender demo files spanning v1.69 → v4.5.
- Blender's embedded preview thumbnail (RGBA8 typed array, 128×128 typical) is now reachable from the existing `onBlendLoad` callback as `blend.thumbnail` — the parser was already extracting it; this is a docs change so consumers know it's there. Shape: `{width, height, data: Uint32Array}`. Real-world hit rate: 9 of 13 tested official Blender demo files carry one. Not put on `userData` so it doesn't round-trip into export pipelines.

### Changed

- Loader now rejects files whose first bytes don't match `BLENDER`, gzip, or zstd magic, with a diagnostic error including the offending bytes in hex. Previously such inputs reached the parser and produced a logged warning + empty scene; the new behavior surfaces the failure clearly to callers.

## [0.1.0] - 2025-09-03

### Fixed

- Fix `peerDependency` issue on npm.

## [0.0.9] - 2025-09-01

### Changed

- Update [threepipe](https://threepipe.org/) `peerDependency` to [0.1.0](https://github.com/repalash/threepipe/releases/tag/v0.1.0)

[unreleased]: https://github.com/repalash/threepipe/tree/dev/plugins/blend-importer
[0.1.0]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-blend-importer-0.1.0
[0.0.9]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-blend-importer-0.0.9

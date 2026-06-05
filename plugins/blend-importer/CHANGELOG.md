# Changelog for @threepipe/plugin-blend-importer

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- NA

## [0.2.0] - 2026-06-05

### Added

- Support for compressed `.blend` files: gzip (Blender ≤ 2.93) via fflate, and zstd (Blender 3.0+ default save format) via [fzstd](https://github.com/101arrowz/fzstd). Magic-byte detection mirrors Blender's own `BLO_file_reader_uncompressed`. Verified end-to-end against 13 official Blender demo files spanning v1.69 → v4.5.
- Typed `BlendFile` and `BlendLoadOptions` interfaces exported from the plugin entry, with JSDoc and a worked example. The existing `onBlendLoad` callback was already wired in but undiscoverable; consumers can now use it to access Blender's embedded preview thumbnail (`blend.thumbnail`, RGBA8 `{width, height, data: Uint32Array}` — typically 128×128, present in ~9 of 10 real .blend files) and the raw parsed DNA tree without re-parsing. Not put on `userData` to avoid round-tripping the typed array through serialization / export.

### Changed

- Loader now rejects files whose first bytes don't match `BLENDER`, gzip, or zstd magic, with a diagnostic error including the offending bytes in hex. Previously such inputs reached the parser and produced a logged warning + empty scene; the new behavior surfaces the failure clearly to callers.

### Fixed

- Bounds guard added to the parser's SDNA-search loop. On certain Blender 4.x geometry-nodes files the DNA1 search walked past EOF and `DataView.getInt32` threw `RangeError` synchronously, killing the entire `viewer.load(...)` promise. Now sets `ERROR` softly and lets the parser return a partial result, matching the soft-error pattern already used in the main block loop.

## [0.1.0] - 2025-09-03

### Fixed

- Fix `peerDependency` issue on npm.

## [0.0.9] - 2025-09-01

### Changed

- Update [threepipe](https://threepipe.org/) `peerDependency` to [0.1.0](https://github.com/repalash/threepipe/releases/tag/v0.1.0)

[unreleased]: https://github.com/repalash/threepipe/tree/dev/plugins/blend-importer
[0.2.0]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-blend-importer-0.2.0
[0.1.0]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-blend-importer-0.1.0
[0.0.9]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-blend-importer-0.0.9

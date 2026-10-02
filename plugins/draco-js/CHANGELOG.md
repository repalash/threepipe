# Changelog for @threepipe/plugin-draco-js

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

## [0.1.0] - 2026-06-05

### Added

- Initial release of `@threepipe/plugin-draco-js`.
- `DracoJSDecodePlugin` — opt-in plugin that decodes Draco meshes (standalone `.drc` and glTF
  `KHR_draco_mesh_compression`) with the pure-JS [draco.js](https://github.com/mrdoob/draco.js)
  decoder, reversibly swapping the `.drc` importer.
- `DRACOLoader2Pure` — `DRACOLoader2` subclass that decodes via lazy-loaded draco.js with an
  automatic WASM fallback (`EnableFallback`, `LogFallback`, `fallbackCount`). The fallback uses
  **eager Draco-header detection** (`isJsDecodable`) to route point-cloud / sequential /
  metadata-bearing streams straight to WASM — draco.js mis-decodes those *silently* (no throw), so a
  try/catch alone would let broken geometry through. `preload()` warms the JS module instead of
  eagerly fetching the `.wasm`.

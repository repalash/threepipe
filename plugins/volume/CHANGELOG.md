# Changelog for @threepipe/plugin-volume

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- First version: `VolumeObject`, `VolumeData` (extends three.js `Volume`), `VolumeMaterial` (composite, MIP, MinIP, average, isosurface and x-ray modes; replaceable shader hooks; clip planes and crop box; stops at opaque meshes with `GBufferPlugin`; jitter averaged by `ProgressivePlugin`; lower sampling rate while moving), `TransferFunction`, the VolView presets and colour maps, `VolumePlugin` (glTF saving as a link to the data file, `WEBGI_volume`), `NRRDLoadPlugin`. Example: `examples/volume-plugin`

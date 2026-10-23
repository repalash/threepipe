# Changelog

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- NA

## [0.2.6] - 2026-10-23

### Fixed

- Type declarations resolve in consumer projects with `moduleResolution: bundler`, `node16` and `nodenext` ([#60](https://github.com/repalash/threepipe/pull/60)): the `.d.ts` files imported `../../threepipe` from a tsconfig `paths` alias, which resolves nowhere; relative imports carry `.js`

## [0.2.5] - 2025-09-03

### Changed

- Update [threepipe](https://threepipe.org/) `peerDependency` to [0.1.0](https://github.com/repalash/threepipe/releases/tag/v0.1.0)

[unreleased]: https://github.com/repalash/threepipe/tree/dev/plugins/svg-renderer
[0.2.6]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-svg-renderer-0.2.6
[0.2.4]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-svg-renderer-v0.2.4
[0.2.5]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-svg-renderer-0.2.5

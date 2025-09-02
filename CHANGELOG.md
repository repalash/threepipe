# Changelog

All notable changes to this project will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- `indexInParent` parameter to `AddObjectOptions`
- `projectionUpdated` parameter to `ICameraSetDirtyOptions`, which is set automatically when any projection related property is changed on cameras.

### Changed

- Cleanup in how `IObject3D.objectProcessor` is assigned and called
- Remove `objectProcessor` parameter in `iObjectCommons.upgradeObject3D`
- Dispatch `camera.setDirty` events when camera properties changed in `RootScene`
- Improve automatic `near`, `far` properties update in `RootScene`, when `authNearFar` is `true`.
- Set default value for `minNearPlane` and `maxFarPlane` to `undefined`.
- Remove automatic call to `updateProjectionMatrix` when near/far are changed. It is called in `camera.setDirty()` now, hence `setDirty` needs to be called explicitly when changing it. Alternatively, `iCameraCommons.setNearFar()` can be used to change near/far and call `setDirty` automatically.

## [0.1.1] - 2025-09-01

### Fixes

- Revert `objectProcessor` change that resulted in breaking some material processing.

## [0.1.0] - 2025-09-01

### Changes

- Initial Framework Release.

[unreleased]: https://github.com/repalash/threepipe/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/repalash/releases/tag/v0.1.0

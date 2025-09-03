# Changelog

All notable changes to this project will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- NA


## [0.2.0] - 2025-09-03

### Added

- Add `indexInParent` parameter to `AddObjectOptions`
- Add `projectionUpdated` parameter to `ICameraSetDirtyOptions`, which is set automatically when any projection related property is changed on cameras
- Add `Forced Linear Depth` (`material.userData.forcedLinearDepth`) to automatic material UI config under blending
- Add `IUniform.needsUpdate` type
- Add `autoRadius` to `SSAOPluginPass`
- Add `CascadedShadowsPlugin` for directional light shadows with cascades CSM. This is same as [three-csm](https://github.com/StrandedKitty/three-csm) implementation at the moment.
- Add example - [cascaded-shadows-plugin-basic](https://threepipe.org/examples/#cascaded-shadows-plugin-basic/) - Sample usage of `CascadedShadowsPlugin`
- Add example - [three-csm-basic](https://threepipe.org/examples/#three-csm-basic/) - Sample usage of `CSM` addon in three.js directly without a plugin.

### Changed

- Cleanup in how `IObject3D.objectProcessor` is assigned and called
- Remove `objectProcessor` parameter in `iObjectCommons.upgradeObject3D`
- Dispatch `camera.setDirty` events when camera properties changed in `RootScene`
- Improve automatic `near`, `far` properties update in `RootScene`, when `autoNearFar` is `true`.
- Set default value for `minNearPlane` and `maxFarPlane` to `undefined`.
- Remove automatic call to `updateProjectionMatrix` when near/far are changed. It is called in `camera.setDirty()` now, hence `setDirty` needs to be called explicitly when changing it. Alternatively, `iCameraCommons.setNearFar()` can be used to change near/far and call `setDirty` automatically.
- Set mesh in `BaseGroundPlugin` invisible when the scene is empty.
- Set default value in cameras - `near = 0.1`, `far = 1000` to remain consistent with three.js defaults. These are applicable when `autoNearFar` is `false`.

### Fixed

- Fixes in `GBufferMaterial` rendering when `customGBufferMaterial` is used.

## [0.1.1] - 2025-09-01

### Fixes

- Revert `objectProcessor` change that resulted in breaking some material processing.

## [0.1.0] - 2025-09-01

### Changes

- Initial Framework Release.

[unreleased]: https://github.com/repalash/threepipe/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/repalash/releases/tag/v0.2.0
[0.1.0]: https://github.com/repalash/releases/tag/v0.1.0

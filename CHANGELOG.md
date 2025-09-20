# Changelog

All notable changes to this project will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- Add [`backgroundColor`](https://threepipe.org/docs/interfaces/ThreeViewerOptions.html#backgroundColor) to `ThreeViewerOptions` to set initial background color of the scene. Note that background map can be set by `load.background` in the options.
- Add `uiconfig` in `RootScene` to toggle transparent background.
- Add `backgroundTonemap` in `RootScene` to toggle tonemapping of background color and map.
- Add `Group2` class, use in `Object3DGeneratorPlugin` when creating empty object.
- Add `warn` parameter to `shaderReplaceString`
- Add `objectActionsUiConfig` to extended light classes (`AmbientLight2`, `DirectionalLight2`, `HemisphereLight2`, `PointLight2`, `RectAreaLight2`, `SpotLight2`) for consistent UI actions across light types.
- Dispatch `lightAdd`, `lightRemove` events, and track all lights in `Object3DManager`, add function `getLights`.
- Add `mapMode` to `ContactShadowGroundPlugin` (Values = `'alphaMap' | 'aoMap' | 'map'`), to control which slot the depth map is assigned to in the material. Default is `aoMap`.
- Add `refreshAttachedLight` to `CascadedShadowsPlugin` to be able to manually refresh the auto attached light.
- Add `near`, `far`, `controlsMode` settings to `makeICameraCommonUiConfig`

### Changed

- Set canvas style to `100%`(when viewer is created) if not explicitly set in canvas inline style and no `maxWidth`/`maxHeight` is set in css. This is done to prevent canvas auto-resizing to huge sizes when not set.
- Set `colorSpace` of texture returned by [dataTextureFromVec4](https://threepipe.org/docs/functions/dataTextureFromVec4.html) to `LinearSRGBColorSpace` to be consistent with other texture creation functions.
- Remove `uiconfig` for `tonemapBackground` in `TonemapPlugin` in favor of `backgroundTonemap` UI in `RootScene`.
- Better toggle for `autoNearFarEnabled` in `PickingPlugin`
- Changed default `mapMode` in `ContactShadowGroundPlugin` to `aoMap`, this is different from previous value of `alphaMap` and hence changes the default results from the plugin. 
  - Set `mapMode` to `alphaMap`, and `material.color` to `0x111111` to achieve the same result as before.
- Make `controlsCtors` public readonly in `ICamera`
- Avoid changing background color and dispatching events when the same color is passed to `RootScene.setBackgroundColor()`.

### Fixes

- Sync `color` with the attached light in `CascadedShadowsPlugin`.
- Improve `attachedLight` handling in `CascadedShadowsPlugin`, to avoid issues when the light is added without `castShadow` flag.

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

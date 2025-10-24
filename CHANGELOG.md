# Changelog

All notable changes to this project will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- Add `renderBackground` property to `ExtendedRenderPass`
- Add `toggleEnvironmentBackground` to `RootScene` and its uiConfig. Allows to toggle the background rendering between environment and separate background map.
- Add option `importAsModelRoot` in GLTFLoader2 options
- Support extras in GLTF document root during and save back when exporting a gltf file
- Add `_basePath` option in `GLTFExporter2` to clear from sub-asset uri if absolute URLs are used.
- `GLTFLoader2` saves the current `path/resourcePath` as `resourcePath` in the gltf document extras/userData.
- Use the resourcePath saved in extras to resolve embedded assets if required/possible.
- Add `controlsMode` dropdown to `uiConfig` and serialize `controlsMode` in `OrthographicCamera2`, `PerspectiveCamera2`.
- Add `lastValue` property to `selectedObjectChanged` event in `ObjectPicker` and `PickingPlugin`
- Add automatic `type` to `ThreeSerialization.PrimitiveSerializer`
- Use `deserialize` `changeKey` to update camera projection matrix
- Automatically deserialize json files of serializable classes(with `serializableClassId`) when loaded with `AssetManager`.
- Add `showFar` to `CameraHelper2` to hide fructum and far plane.
- Export `ConvexHull` from three addons.
- `GLTFExporter2` - feature to ability to export extra resources present in any item/node's `userData`
- `GLTFExporter2` - bundle extra resources in glTF asset extras when a file is exported without viewer config. 
- `GLTFLoader2` - import asset's bundled resources if available in glTF asset extras
- `GLTFLoader2` - pass deserialized meta to `deserializeUserData` to resolve resource references.
- Add `importedBundledResources` to `RootSceneImportResult` (similar to `importedViewerConfig`).
- Add `meta` parameter to `toJSON` and `fromJSON` in `ThreeViewer`.
- Better event dispatcher in `ThreeViewer` to dispatch preFrame events with sorting order.

### Fixes

- Disable `rootPath` being set inside assets that are loaded from local files like when dropping or importing from file blobs.
- Fix for empty objects in CameraViewPlugin.animateToFitObject
- Subscribe to objects properly in `Object3DWidgetsPlugin` using `Object3DManager`.
- Removed sync plugins synchronously during viewer dispose.
- Fix crash when `TransformControlsPlugin` is attached to an ancestor of itself

### Changed

- Update three.js to [r163](https://github.com/mrdoob/three.js/wiki/Migration-Guide#162--r163).
- Deprecate `RootScene.envMapIntensity` in favor of `Scene.environmentIntensity` 
- Remove `RootScene.environment.rotation` in favor of `Scene.environmentRotation` 
- Remove `WebGLMultipleRenderTargets` since `WebGLRenderTarget` now supports `textureCount`, simplify render target functions.
- Support for `WebGL1` completely dropped since WebGL2 has high adoption now.
- Add `trackUndo` in `Object3DEventMap.select` (default `true`)
- Set default `name` of `RootScene` to 'RootScene'
- Do not attach `SelectionWidget` to an object that's not in the `RootScene` 
- Move renderManager above scene and timeline in `ThreeViewer` UI Config
- Keep the selection widget visible when transform controls are enabled
- Changed `autoScale` and `autoCenter` signature in `IObject3D`, they now return `void` instead of `this`
- Use object `visible` property to prevent extra updates in widget helpers when object is invisible.
- Improved type support when using `IObject3D`
- From three - When using an instance of HTMLImageElement for a texture, the renderer uses now naturalWidth and naturalHeight instead of width and height for computing the image dimensions. This enables simplifications on app level if the images are part of the DOM and resized with CSS.

## [0.3.0] - 2025-10-13

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
- Add `auto` to `GLTFLoader2.CreateUniqueNames` and `LoadFileOptions.createUniqueNames`. When set to auto (default), unique names are created only when importing a model root(scene)
- Add `ImportAssetOptions.cacheAsset`(default true), can be set to `false` to disable caching an asset(in asset manager cache if provided) when importing.
- Add parameter `uuid` in `MaterialManager.create` to set material uuid explicitly when creating a material.
- Add support for `forcedOverrideGeometry` in `IObject3D` to override geometry accessor of a mesh. (similar to `forcedOverrideMaterial`).
- Add `oldTexture`, `texture` to `environmentChanged` and `backgroundChanged` events in `RootScene`, `ISceneEventMap`.
- Add `RootScene.disposeTextures(clear = true)` to remove and dispose all textures set directly on the scene.
- Add `IViewerPlugin.constructor.PluginTags`, these can be set and used by plugins for filtering/categorisation etc
- Add `pickingMode` to `ObjectPicker` (defaults to `auto`)
- Add functions `isNonRelativeUrl` and `getFittingDistance`
- Add support for `userData.isPlaceholder` in `IGeometry` and `IMaterial` to mark them as placeholder that should not be saved
- Add `AssetExporter.exportHooks` for a better way to process individual object components/assets when exporting.
- Add support for placeholder materials during import and export of 'gltf' files. Materials with `userData.isPlaceholder` set to `true` are not exported and a dummy material is assigned during import.
- Add property `unregisterExtensionsOnRemove` in `MaterialManager`. Defaults to `false`. Hence by default, Material Extensions are not removed from material when its disposed or removed from the scene. 
- Add static property `JSONMaterialLoader.FindExistingMaterial`, if set to true, the loader will attempt to find any existing material with the same uuid from `MaterialManager` and deserialize into that. 
- Add static property `TypeAlias: string[]` to `IMaterial`
- Add a way to register custom `Importer` to import files with extension `json` and a custom `type` property
- Add support in `JSONMaterialLoader` to load material files with extension `json`. 
- Add `ThreeSerialization.PrimitiveSerializer` and `ThreeSerialization.MakeSerializable`.
- Add more information and examples for serialization in the [Serialization Guide](https://threepipe.org/guide/serialization.html). 
- Make many three.js utility classes serializable by default that support it like `Curve`, `Shape`(and their subclasses), `AnimationClip` etc
- Add `DynamicImportPlugin` as a sample plugin to demonstrate dynamic imports of modules plugins with hot reload.
- Add constructor parameter `attach` in `AHelperWidget` to be able to manually attach later in subclasses.
- Add utility function `getPlugins` in `ThreeViewer` to get plugins of a type or a parent type, support parent types in `addPluginListener` in `ThreeViewer`

### Changed

**Breaking changes**
- Set canvas style to `100%`(when viewer is created) if not explicitly set in canvas inline style and no `maxWidth`/`maxHeight` is set in css. This is done to prevent canvas auto-resizing to huge sizes when not set.
- Change `ThreeViewer.renderEnabled` functionality to run the animation loop and fire frame events, but skip rendering using the render manager.
- Changed default `mapMode` in `ContactShadowGroundPlugin` to `aoMap`, this is different from previous value of `alphaMap` and hence changes the default results from the plugin.
- Moved object material and geometry UI Config to `PickingPlugin`(from `object.uiConfig`). They are now populated only when the object is selected.
- Auto unwrap(ignore root and take children) single scene with the name `AuxScene` in glTF/glb files.
- Remove `IMaterialTemplate` and `IMaterialGenerator`, and static property `IMaterial.MaterialTempalate`, which are now replaced with `IMaterial['constructor']`.
- Remove `MaterialManager.templates`, replaced with `ThreeSerialization.SerializableMaterials`.

**Changes**
- Set `colorSpace` of texture returned by [dataTextureFromVec4](https://threepipe.org/docs/functions/dataTextureFromVec4.html) to `LinearSRGBColorSpace` to be consistent with other texture creation functions.
- Remove `uiconfig` for `tonemapBackground` in `TonemapPlugin` in favor of `backgroundTonemap` UI in `RootScene`.
- Better toggle for `autoNearFarEnabled` in `PickingPlugin`
  - Set `mapMode` to `alphaMap`, and `material.color` to `0x111111` to achieve the same result as before.
- Make `controlsCtors` public readonly in `ICamera`
- Avoid creating widgets for objects that have `userData.disableWidgets` set to `true`
- Use `options.exportExt` when exporting materials in `AssetExporter`
- Set `GLTFLoader2.CreateUniqueNames` to `auto` by default.
- Set asset/object/material/texture `name` to the file name being imported if it's empty string. Earlier the complete URL was set to `name`.
- `iMaterialCommons.getMapsForMaterial` now returns a `Map` of property names to textures.
- `iMaterialCommons.getMapsForObject3D` now returns a `Map` of property names to textures.
- Changed parameter type of `maps` in `checkTexMapReference` from `Set` to `Map`.
- Better `importFile` event file tracking in `AssetImporter` using some events from `LoadingManager`.
- Add `enableAutoNearFar` and `disableAutoNearFar` functions in `RootScene` and deprecate boolean `autoNearFarEnabled` property. These can be used by multiple plugins to enable/disable auto near/far without interfering with each other.
- `rootPath`(the path from where an asset was loaded) is now set in `userData` even when its relative/host-relative URL. It is now also set before the `processRawStart` event in `AssetImporter`.
- Change automatic material unregistration to happen when removed from the scene (unregister from Object3DManager), instead of material dispose.
- Remove `MaterialManager` from `SerializationMetaType`, and remove dependency of `MaterialManager` in `ThreeSerialization` and `MetaImporter`. Materials are now not immediately registered in `MaterialManager` when deserialized.
- Handle `null` (mouse) `pointer` in `TransformControls.js`
- Change `IImporter.ext` type to `ValOrFunc<string[]>` from `string[]`
- Simplify unregister logic in PickingPlugin when object is removed

### Fixes

- Sync `color` with the attached light in `CascadedShadowsPlugin`.
- Improve `attachedLight` handling in `CascadedShadowsPlugin`, to avoid issues when the light is added without `castShadow` flag.
- Use `exportExt` when exporting models in AssetExporter
- Avoid changing background color and dispatching events when the same color is passed to `RootScene.setBackgroundColor()`.
- Dispatch frame events and update timeline and object extensions when `ThreeViewer.renderEnabled` is `false`
- Subscribe to `texturesChanged` on objects and `backgroundChanged`, `environmentChanged` on scene in `Object3DManager` to correctly update texture references on objects.
- Avoid calling `controls.update`(camera) when `update` is defined but not a function.
- Catch uncaught errors and log as warnings when saving files/responses in storage/cache in `overrideThreeCache`
- Texture uuid save fix in `GLTFWriter2`
- Fix for plugin constructor replacing existing plugin when duplicate plugin is added to `ThreeViewer`
- Prevent internal three.js `Cache` from being patched multiple times
- Fix for `mainCameraChange` event not working in `EditorViewWidgetPlugin`
- `SSAAPlugin` now respects `camera.aspect` when `camera.autoAspect` is `false`.
- Fix for issues with far clipping in large scenes when using `PickingPlugin`

### Examples

- Add example - [gltf-export](https://threepipe.org/examples/#gltf-export/) - Example showing the use of `viewer.export` to export a glTF(JSON) file with and without embedded assets.
- Add example - [sky-shader-simple](https://threepipe.org/examples/#sky-shader-simple/) - Example showing a simple sky shader from three.js addons.
- Add example - [sky-shader-simple-ts](https://threepipe.org/examples/#sky-shader-simple-ts/) - TypeScript decorator(for UI and API) version of the above example.

## [0.2.0] - 2025-09-03

### Added

- Add `indexInParent` parameter to `AddObjectOptions`
- Add `projectionUpdated` parameter to `ICameraSetDirtyOptions`, which is set automatically when any projection related property is changed on cameras
- Add `Forced Linear Depth` (`material.userData.forcedLinearDepth`) to automatic material UI config under blending
- Add `IUniform.needsUpdate` type
- Add `autoRadius` to `SSAOPluginPass`
- Add `CascadedShadowsPlugin` for directional light shadows with cascades CSM. This is same as [three-csm](https://github.com/StrandedKitty/three-csm) implementation at the moment.

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

### Examples

- Add example - [cascaded-shadows-plugin-basic](https://threepipe.org/examples/#cascaded-shadows-plugin-basic/) - Sample usage of `CascadedShadowsPlugin`
- Add example - [three-csm-basic](https://threepipe.org/examples/#three-csm-basic/) - Sample usage of `CSM` addon in three.js directly without a plugin.


## [0.1.1] - 2025-09-01

### Fixes

- Revert `objectProcessor` change that resulted in breaking some material processing.

## [0.1.0] - 2025-09-01

### Changes

- Initial Framework Release.

[unreleased]: https://github.com/repalash/threepipe/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/repalash/releases/tag/v0.2.0
[0.1.0]: https://github.com/repalash/releases/tag/v0.1.0

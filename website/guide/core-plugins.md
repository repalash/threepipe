---
prev:
    text: 'Viewer API'
    link: './viewer-api'

next:
    text: '@threepipe Packages'
    link: './threepipe-packages'
---

# Core Plugins

ThreePipe has a simple plugin system that allows you to easily add new features to the viewer. Plugins can be added to the viewer using the `addPlugin` and `addPluginSync` methods.

Plugins can be added to the viewer at any time and can be removed using the `removePlugin` and `removePluginSync` methods.

There are built-in plugins provided in the core of threepipe, that can be directly added to the viewer to add new features. These plugins are designed to be modular and can be used independently or in combination with other plugins. They also serve as good examples and starting points for creating custom plugins.

All the plugins are configurable, serializable and expose a UI to control their properties.

Checkout the [model-viewer](https://threepipe.org/examples/#model-viewer) or [tweakpane-editor](https://threepipe.org/examples/#tweakpane-editor) examples which use most of these plugins.

More plugins are available as separate packages, check the [@threepipe Packages](./threepipe-packages) page for more details.

## Rendering Pipeline

Plugins configuring the rendering pipeline and providing resources for other plugins, effects.

- [ProgressivePlugin](../plugin/ProgressivePlugin) - Post-render pass to blend the last frame with the current frame. Used for progressive rendering. It's a dependency for several other plugins.
- [SSAAPlugin](../plugin/SSAAPlugin) - Add Super Sample Anti-Aliasing across frames by applying jitter to the camera.
- [DepthBufferPlugin](../plugin/DepthBufferPlugin) - Pre-rendering of depth buffer. The buffer can be used in materials and post-processing effects.
- [NormalBufferPlugin](../plugin/NormalBufferPlugin) - Pre-rendering of normal buffer. The buffer can be used in materials and post-processing effects.
- [GBufferPlugin](../plugin/GBufferPlugin) - Pre-rendering of depth-normal and flags buffers in a single pass. This is a dependency to several post-processing plugins.
- [SSAOPlugin](../plugin/SSAOPlugin) - Extends the render pipeline to add SSAO(Screen Space Ambient Occlusion) for physical materials in the scene.
- [FrameFadePlugin](../plugin/FrameFadePlugin) - Post-render pass to smoothly fade to a new rendered frame over time. Used by the core and several plugins like configurators.

## Import

Plugins to add importers/loaders for different file formats.

- [Rhino3dmLoadPlugin](../plugin/Rhino3dmLoadPlugin) - Add support for loading .3dm files
- [PLYLoadPlugin](../plugin/PLYLoadPlugin) - Add support for loading .ply files
- [STLLoadPlugin](../plugin/STLLoadPlugin) - Add support for loading .stl files
- [KTX2LoadPlugin](../plugin/KTX2LoadPlugin) - Add support for loading .ktx2 files
- [KTXLoadPlugin](../plugin/KTXLoadPlugin) - Add support for loading .ktx files
- [USDZLoadPlugin](../plugin/USDZLoadPlugin) - Add support for loading .usdz files
- [GLTFMeshOptDecodePlugin](../plugin/GLTFMeshOptDecodePlugin) - Decode gltf files with EXT_meshopt_compression extension.

## Post-processing

Plugins to add basic post-processing effects to the final screen pass.

Check packages for more advanced post-processing effects.

- [TonemapPlugin](../plugin/TonemapPlugin) - Add tonemap to the final screen pass. Added to the viewer by default.
- [VignettePlugin](../plugin/VignettePlugin) - Add Vignette effect  by patching the final screen pass
- [ChromaticAberrationPlugin](../plugin/ChromaticAberrationPlugin) - Add Chromatic Aberration effect  by patching the final screen pass
- [FilmicGrainPlugin](../plugin/FilmicGrainPlugin) - Add Filmic Grain effect  by patching the final screen pass

## Interaction

Plugins to add/configure interaction and user editable elements to the viewer.

- [DropzonePlugin](../plugin/DropzonePlugin) - Drag and drop local files to import and automatically load. Also provides hooks for custom processing.
- [UndoManagerPlugin](../plugin/UndoManagerPlugin) - Adds support for undo/redo operations in the viewer. It can be used to manage the history of changes made to the scene, objects, materials, etc.
- [ObjectConstraintsPlugin](https://threepipe.org/plugin/ObjectConstraintsPlugin.html) - Adds support for constraints between objects like follow path, look at, position/rotation/scale locking, etc.
- [PickingPlugin](../plugin/PickingPlugin) - Adds support for selecting objects in the viewer with user interactions(click and hover) and shows selection widgets.
- [LoadingScreenPlugin](../plugin/LoadingScreenPlugin) - Shows a configurable loading screen overlay over the canvas which can be extended to show a loader during any kind of processing.
- [FullScreenPlugin](../plugin/FullScreenPlugin) - Provides helpers for entering the fullscreen mode in browsers.
- [InteractionPromptPlugin](../plugin/InteractionPromptPlugin) - Adds an animated hand icon over canvas and rotates the camera to prompt the user to interact.
- [TransformControlsPlugin](../plugin/TransformControlsPlugin) - Adds support for moving, rotating and scaling objects in the viewer with interactive widgets
- [EditorViewWidgetPlugin](../plugin/EditorViewWidgetPlugin) - Adds an interactive ViewHelper/AxisHelper that syncs with the main camera.
- [DeviceOrientationControlsPlugin](../plugin/DeviceOrientationControlsPlugin) - Adds a controlsMode to the mainCamera for device orientation controls(gyroscope rotation control).
- [PointerLockControlsPlugin](../plugin/PointerLockControlsPlugin) - Adds a controlsMode to the mainCamera for pointer lock controls.
- [ThreeFirstPersonControlsPlugin](../plugin/ThreeFirstPersonControlsPlugin) - Adds a controlsMode to the mainCamera for first person controls from threejs.

## Animation

Plugins to add support for animations and animation controls.

- [GLTFAnimationPlugin](../plugin/GLTFAnimationPlugin) - Add support for playing and seeking gltf animations
- [AnimationObjectPlugin](../plugin/AnimationObjectPlugin) - Create and manage keyframe-based animations for any object, material, or viewer property with timeline controls
- [PopmotionPlugin](../plugin/PopmotionPlugin) - Integrates with popmotion.io library for animation/tweening
- [CameraViewPlugin](../plugin/CameraViewPlugin) - Add support for saving, loading, animating, looping between camera views
- [TransformAnimationPlugin](../plugin/TransformAnimationPlugin) - Add support for saving, loading, animating, between object transforms

## Material

Plugins to add support for custom materials and material extensions for existing materials.

- [NoiseBumpMaterialPlugin](../plugin/NoiseBumpMaterialPlugin) - Sparkle Bump/Noise Bump material extension for PhysicalMaterial
- [CustomBumpMapPlugin](../plugin/CustomBumpMapPlugin) - Custom Bump Map material extension for PhysicalMaterial
- [ClearcoatTintPlugin](../plugin/ClearcoatTintPlugin) - Clearcoat Tint material extension for PhysicalMaterial
- [FragmentClippingExtensionPlugin](../plugin/FragmentClippingExtensionPlugin) - Fragment/SDF Clipping material extension for PhysicalMaterial
- [ParallaxMappingPlugin](../plugin/ParallaxMappingPlugin) - Relief Parallax Bump Mapping extension for PhysicalMaterial

## Export

Plugins to configure export options and methods for different file formats.

- [CanvasSnapshotPlugin](../plugin/CanvasSnapshotPlugin) - Add support for taking snapshots of the canvas.
- [AssetExporterPlugin](../plugin/AssetExporterPlugin) - Provides helper options, methods and ui config to export the scene, object GLB or Viewer Configuration.
- [FileTransferPlugin](../plugin/FileTransferPlugin) - Provides a way to extend the `viewer.export` functionality with custom actions.

## Extras

- [ContactShadowGroundPlugin](../plugin/ContactShadowGroundPlugin) - Adds a ground plane at runtime with contact shadows
- [HDRiGroundPlugin](../plugin/HDRiGroundPlugin) - Add support for ground projected hdri/skybox to the webgl background shader.
- [VirtualCamerasPlugin](../plugin/VirtualCamerasPlugin) - Add support for rendering virtual cameras before the main one every frame.
- [Object3DWidgetsPlugin](../plugin/Object3DWidgetsPlugin) - Automatically create light and camera helpers/gizmos when they are added to the scene.
- [Object3DGeneratorPlugin](../plugin/Object3DGeneratorPlugin) - Provides UI and API to create scene objects like lights, cameras, meshes, etc.
- [GLTFKHRMaterialVariantsPlugin](../plugin/GLTFKHRMaterialVariantsPlugin) - Support using for variants from KHR_materials_variants extension in gltf models.
- [SimplifyModifierPlugin](../plugin/SimplifyModifierPlugin) - Boilerplate for plugin to simplify geometries
- [MeshOptSimplifyModifierPlugin](../plugin/MeshOptSimplifyModifierPlugin) - Simplify geometries using meshoptimizer library

## UI

Plugins related UI, plugins creating UI element. Check the [packages](./threepipe-packages) page for UI config rendering plugins.

- [RenderTargetPreviewPlugin](../plugin/RenderTargetPreviewPlugin) - Preview any render target in a UI panel over the canvas
- [GeometryUVPreviewPlugin](../plugin/GeometryUVPreviewPlugin) - Preview UVs of any geometry in a UI panel over the canvas
- [SceneUiConfigPlugin](https://threepipe.org/docs/classes/SceneUiConfigPlugin.html) - A dummy plugin to show only the scene ui config using any UI plugin
- [ViewerUiConfigPlugin](https://threepipe.org/docs/classes/ViewerUiConfigPlugin.html) - A dummy plugin to show only the viewer ui config using any UI plugin

## Base

Base plugins that can be inherited to create new plugins for specific use cases.

- [AAssetManagerProcessStatePlugin](https://threepipe.org/docs/classes/AAssetManagerProcessStatePlugin.html) - Base class to create loading bars, process state related plugins.
- [ACameraControlsPlugin](https://threepipe.org/docs/classes/ACameraControlsPlugin.html) - Base class that adds camera controls to the viewer.
- [BaseGroundPlugin](https://threepipe.org/docs/classes/BaseGroundPlugin.html) - Base class that adds a ground plane to the viewer.
- [BaseImporterPlugin](https://threepipe.org/docs/classes/BaseImporterPlugin.html) - Base class that registers an importer to the viewer.
- [PipelinePassPlugin](https://threepipe.org/docs/classes/PipelinePassPlugin.html) - Base class that registers a pass to the main render pipeline.
- [AScreenPassExtensionPlugin](https://threepipe.org/docs/classes/AScreenPassExtensionPlugin.html) - Create plugins that adds an extension to screen pass in the render manager.

## Configurator

Base plugins for creating configurators. These include the functionality, serialization and state management and UI can be added but any subclass or in the application.

- [MaterialConfiguratorBasePlugin](https://threepipe.org/docs/classes/MaterialConfiguratorBasePlugin.html) - Base class to create material configurator plugins.
- [SwitchNodeBasePlugin](https://threepipe.org/docs/classes/SwitchNodeBasePlugin.html) - Base class to create switch node plugins.

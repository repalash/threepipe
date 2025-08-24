---
prev:
  text: 'Editors in Threepipe'
  link: './editors'

next:
  text: 'Viewer API'
  link: './viewer-api'
---

# Features

Threepipe comes packed with an asset manager, render pipeline, serialization setup, material extensions, UI configurations and bundles many plugins, that can be added with a single line of code to provide a variety of features listed below. In a custom application it’s possible to tree-shake the bundle by picking the plugins that are required.

## File Formats

ThreePipe Asset Manager supports the import of the following file formats out of the box:
* **Models**: gltf, glb, obj+mtl, fbx, drc
* **Materials**: mat, pmat, bmat (json based), registered material template slugs
* **Textures**: webp, png, jpeg, jpg, svg, ico, avif, hdr, exr, mp4, mov, webm
* **Misc**: json, vjson, zip, txt

Plugins can add additional formats:
* Models
    * 3dm - Using [Rhino3dmLoadPlugin](../plugin/Rhino3dmLoadPlugin)
    * ply - Using [PLYLoadPlugin](../plugin/PLYLoadPlugin)
    * usdz - Using [USDZLoadPlugin](../plugin/USDZLoadPlugin)
    * stl - Using [STLLoadPlugin](../plugin/STLLoadPlugin)
    * ktx - Using [KTXLoadPlugin](../plugin/KTXLoadPlugin)
    * ktx2 - Using [KTX2LoadPlugin](../plugin/KTX2LoadPlugin)

Plugins to support more model formats are available in the package [@threepipe/plugins-extra-importers](../package/plugins-extra-importers) including .3ds,
.3mf, .collada, .amf, .bvh, .vox, .gcode, .mdd, .pcd, .tilt, .wrl, .mpd, .vtk, .xyz. 

### Loading files

All the file formats can be easily loaded using the `viewer.load` method.

```typescript
const objectGlb = await viewer.load<IObject3D>('https://example.com/file.glb')
const texture = await viewer.load<ITexture>('https://example.com/texture.png')
const material = await viewer.load<PhysicalMaterial>('https://example.com/material.pmat')
const json = await viewer.load<any>('https://example.com/file.json')
```

This method internally uses the [AssetManager](https://threepipe.org/docs/classes/AssetManager.html) to load files and returns a promise that resolves to the loaded object.

Check the [Loading Files](./loading-files) guide for more details and how to load different file types.

- [3D models](./loading-files#3d-models)
- [Materials](./loading-files#materials)
- [Images/Textures](./loading-files#imagestextures)
- [zip files](./loading-files#zip-files)
- [txt, json files](./loading-files#txt-json-files)
- [Data URLs](./loading-files#data-urls)
- [Local files, File and Blob](./loading-files#local-files-file-and-blob)
- [Background, Environment maps](./loading-files#background-environment-maps)
- [SVG strings](./loading-files#svg-strings)

### Exporting files

Threepipe has built-in support for exporting some file types like glb, exr, images(textures, render targets), materials, json(viewer/scene configuration and plugin configurations). 

To export files, several helpers are provided - [`viewer.export()`](https://threepipe.org/docs/classes/ThreeViewer.html#export) and [`viewer.exportScene()`](https://threepipe.org/docs/classes/ThreeViewer.html#exportScene).

```typescript
const blob = await viewer.exportScene({viewerConfig: true})
const blob1 = await viewer.export(object, {exportExt: 'glb', embedUrlImages: true})
const blob2 = await viewer.export(material)
const blob3 = await viewer.export(texture)
const blob4 = await viewer.export(dataTexture)
const blob5 = await viewer.export(renderTarget)
```

Check the [Exporting Files](./exporting-files) guide for more details and how to export different file types.

- [Exporting 3D models](./exporting-files#exporting-3d-models)
- [Exporting Materials](./exporting-files#exporting-materials)
- [Exporting Canvas Images](./exporting-files#exporting-canvas-images)
- [Exporting Images/Textures](./exporting-files#exporting-imagestextures)
- [Exporting Render Targets](./exporting-files#exporting-render-targets)

## Plugin System

Threepipe includes a plugin system for adding additional features to the viewer in a modular way.

All plugins follow the same basic structure, independent of the logic, with the API to add and remove plugins being always consistent (and one-liner). This makes it easy to debug, bundle, tree-shake, serialisation/deserialisation and extend functionality to the 3d viewer. It is also recommended to keep individual plugins small and handle one specific functionality.

Plugins can be dependent on other plugins. These dependencies are automatically resolved and added to the viewer at runtime. e.g. `SSAOPlugin` depends on `GBufferPlugin` to get the depth and normal data. So, when `SSAOPlugin` is added to the viewer, it automatically adds `GBufferPlugin` before that (if not added already).

The plugins can be added synchronously or asynchronously using `viewer.addPluginSync` and `viewer.addPlugin` methods respectively.

It is recommended to create custom plugins for reusable features, as they provide built-in features for ui configuration, serialization, integration with editors etc. and are easy to manage and tree-shake in the code.

Check out the list of plugins in the [Core Plugin](./core-plugins) and [@threepipe Packages](./threepipe-packages) pages.

To create new plugins, simply implement the `IViewerPlugin` interface or extend the [AViewerPluginSync](https://threepipe.org/docs/classes/AViewerPluginSync.html) or [AViewerPluginAsync](https://threepipe.org/docs/classes/AViewerPluginAsync.html) classes.

Read more about the [Plugin System](./plugin-system) on its page.

## Render pipeline

Threepipe includes a [RenderManager](https://threepipe.org/docs/classes/RenderManager.html) for managing the composition pipeline, and provides helpers for rendering and render target management. 

The `RenderManager` includes an [EffectComposer](https://threejs.org/docs/#api/en/postprocessing/EffectComposer) from three.js for rendering passes and a [WebGLRenderer](https://threejs.org/docs/#api/en/renderers/WebGLRenderer) for rendering, but the pass management and sorting is managed by the `RenderManager` itself. It inherits from [RenderTargetManager](https://threepipe.org/docs/classes/RenderTargetManager.html) which provides utilities for creating, tracking and destroying dedicated and temporary render targets.

The main render pipeline supports progressive rendering and is fully configurable. Plugins and applications can add custom passes, effects, and shaders to the pipeline. 

By default, the render pipeline includes 2 passes - [RenderPass](https://threejs.org/docs/#api/en/postprocessing/RenderPass) for rendering the scene hierarchy and [ScreenPass](https://threejs.org/docs/#api/en/postprocessing/ShaderPass) for rendering the final output on the canvas.

Plugins like [GBufferPlugin](https://threepipe.org/docs/classes/GBufferPlugin.html), [SSAOPlugin](https://threepipe.org/docs/classes/SSAOPlugin.html), [TonemapPlugin](https://threepipe.org/docs/classes/TonemapPlugin.html), etc. interact and extend the render pipeline by adding custom passes to the render pipeline and material extensions to the material manager.

Check the [Render Pipeline](./render-pipeline) guide for more details about render targets and how to add custom passes.

## Material Extension

Threepipe includes a Material extension system along with a material manager.
The material manager is used to register materials and material extensions.

The material extensions can extend any material in the scene, or any plugin/pass with additional uniforms, defines, shader snippets and provides hooks.

The material extensions are automatically applied to all materials in the scene that are compatible,
when the extension is registered or when the material(the object it's assigned to) is added to the scene.

Threepipe includes several built-in materials like [PhysicalMaterial](https://threepipe.org/docs/classes/PhysicalMaterial.html), [UnlitMaterial](https://threepipe.org/docs/classes/UnlitMaterial.html), [ExtendedShaderMaterial](https://threepipe.org/docs/classes/ExtendedShaderMaterial.html), [LegacyPhongMaterial](https://threepipe.org/docs/classes/LegacyPhongMaterial.html), that include support for extending the material. Any existing three.js material can be made extendable, check the `ShaderPass2` class for a simple example that adds support for material extension to three.js ShaderPass.

Several Plugins create and register material extensions to add different kinds of rendering features over the standard three.js materials like [ClearcoatTintPlugin](https://threepipe.org/docs/classes/ClearcoatTintPlugin.html), [SSAOPlugin](https://threepipe.org/docs/classes/SSAOPlugin.html), [CustomBumpMapPlugin](https://threepipe.org/docs/classes/CustomBumpMapPlugin.html), [AnisotropyPlugin](https://threepipe.org/examples/anisotropy-plugin/), [FragmentClippingExtensionPlugin](https://threepipe.org/docs/classes/FragmentClippingExtensionPlugin.html), etc. They also provide uiConfig that can be used to dynamically generate UI or the material extensions. 

Some plugins also expose their material extensions to be used by other passes/plugins to access properties like buffers, synced uniforms, defines etc. Like [GBufferPlugin](https://threepipe.org/docs/classes/GBufferPlugin.html), [DepthBufferPlugin](https://threepipe.org/docs/classes/DepthBufferPlugin.html), [NormalBufferPlugin](https://threepipe.org/docs/classes/NormalBufferPlugin.html), etc. 

Read more and check a sample plugin in the [Material Extension](./material-extension) guide.

## UI Configuration

Almost all the classes and plugins in Threepipe include [uiconfig.js](https://repalash.com/uiconfig.js/) support and can be used to create configuration UIs, 3d configurators and even full-editors.
The UIs are automatically generated based on the configuration object under `.uiConfig` property on all objects. These are of type [UiObjectConfig](https://repalash.com/uiconfig.js/interfaces/UiObjectConfig.html).
In some classes, the ui configs are also generated using typescript decorators.

The `uiConfig` is also added to all three.js objects and materials when they are added to the scene.

The UIs can be generated at runtime using any of the UI plugins like [TweakpaneUIPlugin](../package/plugin-tweakpane), [BlueprintJsUiPlugin](../package/plugin-blueprintjs)

An example showing how to create a UI for a material

```typescript
const ui = viewer.addPluginSync(TweakpaneUiPlugin)

const object = viewer.scene.getObjectByName('objectName');
const material = object.material as PhysicalMaterial;

ui.appendChild(material.uiConfig)
```

See it in action: https://threepipe.org/examples/#material-uiconfig/

Check more examples showing [Viewer UI](https://threepipe.org/examples/#viewer-uiconfig/), [Scene UI](https://threepipe.org/examples/#scene-uiconfig/), [Object UI](https://threepipe.org/examples/#object-uiconfig/), [Camera UI](https://threepipe.org/examples/#camera-uiconfig/)

::: info
[TweakpaneEditorPlugin](../package/plugin-tweakpane-editor) further uses the Tweakpane configuration panel along with various plugins to create a 3d editor.
:::

Custom UI configuration can be created to generate custom UI for the editor or tweaking.
This can be done by using typescript decorators or defining the UI in javascript as a [UiObjectConfig](https://repalash.com/uiconfig.js/interfaces/UiObjectConfig.html) object.

Read more and check a sample in the [UI Configuration](./ui-config) guide.

## Serialization

Easy serialization of all threepipe and most three.js objects are supported out of the box using the Asset Manager.
Fine control over serialization is also supported
using the [ThreeSerialization](https://threepipe.org/docs/classes/ThreeSerialization.html) class

Call `ThreeSerialization.serialize` on any object to serialize it.
and `ThreeSerialization.deserialize` to deserialize the serialized object.

This is done by performing a nested serialization of all the properties of the object.
It's possible to implement custom serializers for custom types and classes and is done for three.js primitives,
objects and plugins in threepipe

```typescript
const vec = new Vector3()
const serialized = ThreeSerialization.serialize(vec)
const deserialized = ThreeSerialization.deserialize(serialized)
// deserialized will be an instance of Vector3
```

::: tip
For any high-level usage, don't use the `ThreeSerialization` class directly. Use the `viewer.export` and `viewer.import` methods or other methods to save and load configurations that's available in the plugins and the viewer.
:::

Read more and check samples in the [Serialization](./serialization) guide.

## Timeline

ThreePipe provides a **global timeline system** that serves as the central control mechanism for all time-based animations and effects in the viewer. The timeline enables synchronized playback, recording, and control of multiple animation systems working together.

### Core Timeline Features

The viewer timeline ([ViewerTimeline](https://threepipe.org/docs/classes/ViewerTimeline.html)) provides:

- **Global Time Control**: Centralized time management for all animations
- **Playback Controls**: Play, pause, stop, seek, and loop functionality  
- **Frame-by-Frame Control**: Precise frame stepping for animation recording
- **Progressive Integration**: Synchronization with progressive rendering for high-quality output
- **Plugin Integration**: Unified interface for all animation plugins

```typescript
// Basic timeline control
viewer.timeline.time = 2.5        // Current time in seconds
viewer.timeline.endTime = 10      // Timeline duration in seconds
viewer.timeline.resetOnEnd = true // Loop timeline when it reaches the end

viewer.timeline.start()           // Start timeline playback
viewer.timeline.stop()            // Pause timeline
viewer.timeline.reset()           // Reset to time 0
```

### Plugin Integration

Multiple plugins interface with the global timeline to provide synchronized animation experiences:

#### Animation Plugins
- **[GLTFAnimationPlugin](../plugin/GLTFAnimationPlugin)**: Plays GLTF animations synchronized with the global timeline
- **[AnimationObjectPlugin](../plugin/AnimationObjectPlugin)**: Low-level Keyframe-based property animations that follow timeline control
- **[CameraViewPlugin](../plugin/CameraViewPlugin)**: Camera transitions and view animations
- **[TransformAnimationPlugin](../plugin/TransformAnimationPlugin)**: Object transform animations over time [WIP]
- **[TimelineUiPlugin](../package/plugin-timeline-ui)**: UI controls for managing timeline animations.

#### Other Plugins
- **[MaterialConfiguratorBasePlugin](https://threepipe.org/docs/classes/MaterialConfiguratorBasePlugin.html)**: Material switching animations that can be timed with the timeline
- **CanvasRecorderPlugin**: Recording plugins use timeline for frame-perfect animation capture

### Progressive Rendering Integration

The timeline system integrates with the **[ProgressivePlugin](../plugin/ProgressivePlugin)** to provide high-quality animation recording. When recording animations, the timeline waits for progressive rendering to converge before advancing to the next frame, ensuring each frame is rendered with maximum quality.

```typescript
// All animations play synchronized on the global timeline
viewer.timeline.endTime = 5
viewer.timeline.start() // Plays GLTF, property, and camera animations together
```

The global timeline system ensures all animation components work together harmoniously, providing a unified animation experience in ThreePipe applications. Check the [API Reference](https://threepipe.org/docs/classes/ViewerTimeline.html) for complete timeline documentation.

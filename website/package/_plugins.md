
## @threepipe/plugin-tweakpane

[Tweakpane](https://tweakpane.github.io/docs/) UI plugin for ThreePipe

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#tweakpane-ui-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane/src/TweakpaneUiPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane/docs/classes/TweakpaneUiPlugin.html)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-tweakpane.svg)](https://www.npmjs.com/package/@threepipe/plugin-tweakpane)

```bash
npm install @threepipe/plugin-tweakpane
```

TweakpaneUiPlugin adds support for using [uiconfig-tweakpane](https://github.com/repalash/uiconfig-tweakpane)
to create a configuration UI in applications using the [Tweakpane](https://tweakpane.github.io/docs/) library.

The plugin takes the [uiconfig](https://github.com/repalash/uiconfig.js)
that's defined in the viewer and all the objects to automatically render a UI in the browser.

```typescript
import {IObject3D, ThreeViewer, TonemapPlugin} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

const viewer = new ThreeViewer({...})

// Add the plugin
const plugin = viewer.addPluginSync(new TweakpaneUiPlugin(true)) // true to show expanded the UI by default

// Add the UI for the viewer
plugin.appendChild(viewer.uiConfig)
// Add UI for some plugins
plugin.setupPlugins(TonemapPlugin, DropzonePlugin)
```

## @threepipe/plugin-blueprintjs
[Blueprint.js](https://blueprintjs.com/) UI plugin for ThreePipe

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#blueprintjs-ui-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/blueprintjs/src/BlueprintJsUiPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/blueprintjs/docs/classes/BlueprintJsUiPlugin.html)


[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-blueprintjs.svg)](https://www.npmjs.com/package/@threepipe/plugin-blueprintjs)

```bash
npm install @threepipe/plugin-blueprintjs
```

BlueprintJsUiPlugin adds support for using [uiconfig-blueprint](https://github.com/repalash/uiconfig-blueprint)
to create a configuration UI in applications using the [BlueprintJs](https://blueprintjs.com/) library.

The plugin takes the [uiconfig](https://github.com/repalash/uiconfig.js)
that's defined in the viewer and all the objects to automatically render a UI in the browser.

```typescript
import {IObject3D, ThreeViewer, TonemapPlugin} from 'threepipe'
import {BlueprintJsUiPlugin} from '@threepipe/plugin-blueprintjs'

const viewer = new ThreeViewer({...})

// Add the plugin
const plugin = viewer.addPluginSync(new BlueprintJsUiPlugin(true)) // true to show expanded the UI by default

// Add the UI for the viewer
plugin.appendChild(viewer.uiConfig)
// Add UI for some plugins
plugin.setupPlugins(TonemapPlugin, DropzonePlugin)
```

## @threepipe/plugin-tweakpane-editor

Tweakpane Editor Plugin for ThreePipe

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#tweakpane-editor/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane-editor/src/TweakpaneEditorPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/TweakpaneEditorPlugin.html)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-tweakpane-editor.svg)](https://www.npmjs.com/package/@threepipe/plugin-tweakpane-editor)

```bash
npm install @threepipe/plugin-tweakpane-editor
```

`TweakpaneEditorPlugin` uses `TweakpaneUiPlugin` and other custom ui to create an editor for editing viewer, plugins, model and material configurations in the browser.

```typescript
import {IObject3D, ThreeViewer, TonemapPlugin} from 'threepipe'
import {TweakpaneEditorPlugin} from '@threepipe/plugin-tweakpane-editor'

const viewer = new ThreeViewer({...})

viewer.addPluginSync(new TweakpaneUiPlugin(true))
const editor = viewer.addPluginSync(new TweakpaneEditorPlugin())

// Add some plugins to the viewer
await viewer.addPlugins([
    new ViewerUiConfigPlugin(),
    // new SceneUiConfigPlugin(), // this is already in ViewerUiPlugin
    new DepthBufferPlugin(HalfFloatType, true, true),
    new NormalBufferPlugin(HalfFloatType, false),
    new RenderTargetPreviewPlugin(false),
])

// Load the plugin UI in the editor and tweakpane ui with categories.
editor.loadPlugins({
    ['Viewer']: [ViewerUiConfigPlugin, SceneUiConfigPlugin, DropzonePlugin, FullScreenPlugin],
    ['GBuffer']: [DepthBufferPlugin, NormalBufferPlugin],
    ['Post-processing']: [TonemapPlugin],
    ['Debug']: [RenderTargetPreviewPlugin],
})
```

## @threepipe/plugin-configurator

Configurator Plugin implementations with basic UI for Threepipe.

Includes Material Configurator and Switch Node Configurator Plugins.

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-configurator.svg)](https://www.npmjs.com/package/@threepipe/plugin-configurator)

```bash
npm install @threepipe/plugin-configurator
```

### MaterialConfiguratorPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#material-configurator-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/configurator/src/MaterialConfiguratorPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/configurator/docs/classes/MaterialConfiguratorPlugin.html)

MaterialConfiguratorPlugin adds a UI to configure and switch between different material variations.

The variations of materials are mapped to material names or uuids in the scene.
These variations can be applied to the materials in the scene. (This copies the properties to the same material instances instead of assigning new materials)
The plugin interfaces with the picking plugin and also provides uiConfig to show and edit the variations.
This functionality is inherited from [MaterialConfiguratorBasePlugin](https://threepipe.org/docs/classes/MaterialConfiguratorBasePlugin.html).

Additionally, this plugin adds a simple Grid UI in the DOM over the viewer canvas to show various material variations and allow the user to apply them.
The UI can also be used in the editor to edit the variations and apply them.

To use, simply add the plugin in the viewer and configure using the created UI and UI Config. Note that `PickingPlugin` is required to be added before this to allow configurator.

To create a custom configurator UI, use the `MaterialConfiguratorBasePlugin` directly and call the function `applyVariation`, `getPreview` and `addVariation` to apply and add variations respectively.

[//]: # (TODO Add Example for custom UI)

### SwitchNodePlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#switch-node-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/configurator/src/SwitchNodePlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/configurator/docs/classes/SwitchNodePlugin.html)

SwitchNodePlugin adds a UI to configure and switch between different different object variations within a switch node object.

This plugin allows you to configure object variations with object names in a file and apply them in the scene.
Each SwitchNode is a parent object with multiple direct children. Only one child is visible at a time.
This works by toggling the `visible` property of the children of a parent object.
The plugin interfaces with the picking plugin and also provides uiConfig to show and edit the variations.
It also provides a function to create snapshot previews of individual variations. This creates a limited render of the object with the selected child visible.
To get a proper render, its better to render it offline and set the image as a preview.
This functionality is inherited from [SwitchNodeBasePlugin](https://threepipe.org/docs/classes/SwitchNodeBasePlugin.html).

Additionally, this plugin adds a simple Grid UI in the DOM over the viewer canvas to show various material variations and allow the user to apply them.
The UI can also be used in the editor to edit the variations and apply them.

To use, simply add the plugin in the viewer and configure using the created UI and UI Config. Note that `PickingPlugin` is required to be added before this to allow configurator.

To create a custom configurator UI, use the `SwitchNodeBasePlugin` directly and call the function `selectNode`, `getPreview` and `addNode` to apply and add variations respectively.

[//]: # (TODO Add Example for custom UI)

## @threepipe/plugin-geometry-generator

Exports [GeometryGeneratorPlugin](https://threepipe.org/plugins/geometry-generator/docs/classes/BlendLoadPlugin.html) with several Geometry generators to create parametric and updatable geometries like plane, circle, sphere, box, torus, cylinder, cone etc.

[Example](https://threepipe.org/examples/#geometry-generator-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/geometry-generator/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/geometry-generator/docs)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-geometry-generator.svg)](https://www.npmjs.com/package/@threepipe/plugin-geometry-generator)

```bash
npm install @threepipe/plugin-geometry-generator
```

The generated geometries/meshes include the parameters in the userData and can be re-generated by changing the parameters from the UI or the plugin API.

Includes the following generator which inherit from [AGeometryGenerator](https://threepipe.org/plugins/geometry-generator/docs/classes/AGeometryGenerator.html):
- **plane**: [PlaneGeometryGenerator](https://threepipe.org/plugins/geometry-generator/docs/classes/PlaneGeometryGenerator),
- **sphere**: [SphereGeometryGenerator](https://threepipe.org/plugins/geometry-generator/docs/classes/SphereGeometryGenerator),
- **box**: [BoxGeometryGenerator](https://threepipe.org/plugins/geometry-generator/docs/classes/BoxGeometryGenerator),
- **circle**: [CircleGeometryGenerator](https://threepipe.org/plugins/geometry-generator/docs/classes/CircleGeometryGenerator),
- **torus**: [TorusGeometryGenerator](https://threepipe.org/plugins/geometry-generator/docs/classes/TorusGeometryGenerator),
- **cylinder**: [CylinderGeometryGenerator](https://threepipe.org/plugins/geometry-generator/docs/classes/CylinderGeometryGenerator),


Sample Usage:

```typescript
import {ThreeViewer, UnlitMaterial} from 'threepipe'
import {GeometryGeneratorPlugin} from '@threepipe/plugin-geometry-generator'

const viewer = new ThreeViewer({...})
const generator = viewer.addPluginSync(GeometryGeneratorPlugin)

const sphere = generator.generateObject('sphere', {radius: 3})
viewer.scene.addObject(sphere)

// to update the geometry
generator.updateGeometry(sphere.geometry, {radius: 4, widthSegments: 100})

// to add a custom generator
generator.generators.custom = new CustomGenerator('custom') // Extend from AGeometryGenerator or implement GeometryGenerator interface
// refresh the ui so the new generator is available to select.
generator.uiConfig.uiRefresh?.()

// change the material type for all objects
generator.defaultMaterialClass = UnlitMaterial // by default its PhysicalMaterial
viewer.scene.addObject(generator.generateObject('box', {width: 2, height: 2, depth: 2}))

```

## @threepipe/plugin-gltf-transform

Exports [GLTFDracoExportPlugin](https://threepipe.org/plugins/gltf-transform/docs/classes/GLTFDracoExportPlugin.html) that extends the default gltf exporter to compress the file after export.

[Example](https://threepipe.org/examples/#glb-draco-export/) &mdash;
[Source Code](plugins/gltf-transform/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/gltf-transform/docs)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-gltf-transform.svg)](https://www.npmjs.com/package/@threepipe/plugin-gltf-transform)

```bash
npm install @threepipe/plugin-gltf-transform
```

To use, simply add the plugin to the viewer and export using the `viewer.export` or `viewer.exportScene` functions. This also adds UI options to `AssetExporterPlugin` which are used when exporting using the plugin or using `viewer.exportScene`

The plugin overloads the default gltf exporter in the asset manager with `GLTFDracoExporter`. Using the [gltf-transform](https://gltf-transform.donmccurdy.com/) library, it compresses the exported gltf file using the [khr_draco_mesh_compression](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_draco_mesh_compression/README.md) extension.

Note - Only `glb` export supported right now.

Sample Usage:

```typescript
import {ThreeViewer, downloadBlob} from 'threepipe'
import {GLTFDracoExportPlugin} from '@threepipe/plugin-gltf-transform'

const viewer = new ThreeViewer({...})
viewer.addPluginSync(GLTFDracoExportPlugin)

await viewer.load('file.glb')

const blob = await viewer.exportScene({
  compress: true, // this must be specified, by default it's false.
  viewerConfig: true, // to export with viewer, scene and plugin settings
})
// download the file
downloadBlob(blob, 'scene.glb')
```

## @threepipe/plugins-extra-importers

Exports several plugins to add support for various file types.

[Example](https://threepipe.org/examples/#extra-importer-plugins/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/extra-importers/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/extra-importers/docs)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugins-extra-importers.svg)](https://www.npmjs.com/package/@threepipe/plugins-extra-importers)

```bash
npm install @threepipe/plugins-extra-importers
```

This package exports several plugins to add support for several file types using the following plugins

- [TDSLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/TDSLoadPlugin.html) - Load 3DS Max (.3ds) files
- [ThreeMFLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/ThreeMFLoadPlugin.html) - Load 3MF (.3mf) files
- [ColladaLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/ColladaLoadPlugin.html) - Load Collada (.dae) files
- [AMFLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/AMFLoadPlugin.html) - Load AMF (.amf) files
- [BVHLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/BVHLoadPlugin.html) - Load BVH (.bvh) files
- [VOXLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/VOXLoadPlugin.html) - Load MagicaVoxel (.vox) files
- [GCodeLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/GCodeLoadPlugin.html) - Load GCode (.gcode) files
- [MDDLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/MDDLoadPlugin.html) - Load MDD (.mdd) files
- [PCDLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/PCDLoadPlugin.html) - Load Point cloud data (.pcd) files
- [TiltLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/TiltLoadPlugin.html) - Load Tilt Brush (.tilt) files
- [VRMLLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/VRMLLoadPlugin.html) - Load VRML (.wrl) files
- [MPDLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/MPDLoadPlugin.html) - Load LDraw (.mpd) files
- [VTKLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/VTKLoadPlugin.html) - Load VTK (.vtk) files
- [XYZLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/XYZLoadPlugin.html) - Load XYZ (.xyz) files

To add all the plugins at once use `extraImporters`. This adds support for loading all the above file types.
```typescript
import {ThreeViewer} from 'threepipe'
import {extraImporters} from '@threepipe/plugins-extra-importers'

const viewer = new ThreeViewer({...})
viewer.addPluginsSync(extraImporters)

// Now load any file as is.
const model = await viewer.load<IObject3D>('file.3mf')

// To load the file as a data url, use the correct mimetype
const model1 = await viewer.load<IObject3D>('data:model/3mf;base64,...')
```

Remove the `<IObject3D>` if using javascript and not typescript.

## @threepipe/plugin-network

Network/Cloud related plugin implementations for Threepipe.

Includes `AWSClientPlugin` and `TransfrSharePlugin`.

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-network.svg)](https://www.npmjs.com/package/@threepipe/plugin-network)

```bash
npm install @threepipe/plugin-network
```

### TransfrSharePlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#transfr-share-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/network/src/TransfrSharePlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/network/docs/classes/TransfrSharePlugin.html)

TransfrSharePlugin provides functionality to export and upload the scene or an object as glb and provide link to share/preview/edit the files.

It uses the options from the `AssetExporterPlugin` to export the scene or object, and can be configured using it's ui.

Uses the free service [transfr.one](https://transfr.one/) by default which deletes the files after a certain time, but the url can be changed to a custom backend or a self-hosted version of transfr.

::: tip Note
Since the uploaded files are publicly accessible by anyone by default, it is recommended to encrypt the file using the exporter options or use a secure backend.
:::

```typescript
import {ThreeViewer} from 'threepipe'
import {TransfrSharePlugin} from '@threepipe/plugin-network'

const viewer = new ThreeViewer({...})

// Add the plugin
const sharePlugin = viewer.addPluginSync(new TransfrSharePlugin())

// when sharing, this query param is set to the model link
sharePlugin.queryParam = 'm' // this is the default
// used when clicking/calling Share page link
sharePlugin.pageUrl = window.location.href // this is the default

// used when clicking/calling Share viewer link
sharePlugin.baseUrls.viewer = 'https://threepipe.org/examples/model-viewer/index.html'
// used when clicking/calling Share editor link
sharePlugin.baseUrls.editor = 'https://threepipe.org/examples/tweakpane-editor/index.html'

// set to a custom server
// sharePlugin.serverUrl = 'https://example.com/'

// upload and get the link of the 3d model
const link = await sharePlugin.getLink()
// or upload and get the share link with a base page. And also copy to clipboard and shows a alert prompt(using viewer.dialog)
const link2 = await sharePlugin.shareLink('https://example.com/custom_viewer')
// or get the editor link directly 
const link3 = await sharePlugin.shareEditorLink()

// to encrypt
const assetExporterPlugin = viewer.getPlugin(AssetExporterPlugin) // this is a dependency, so automatically added
assetExporterPlugin.encrypt = true
// assetExporterPlugin.encryptKey = 'password' // user will be prompted for password when exporting if this is commented 

await sharePlugin.shareViewerLink()
```

### AWSClientPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#aws-client-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/network/src/AWSClientPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/network/docs/classes/AWSClientPlugin.html)

Provides `fetch` function that performs a fetch request with AWS v4 signing.
This is useful for connecting to AWS services like S3 directly from the client.
It also interfaces with the `FileTransferPlugin` to directly upload file when exported with the viewer or the plugin.

::: danger Note
Make sure to use keys with limited privileges and correct CORS settings.
All the keys will be stored in plain text if `serializeSettings` is set to true
:::

```typescript
import {ThreeViewer} from 'threepipe'
import {AWSClientPlugin} from '@threepipe/plugin-network'

const viewer = new ThreeViewer({...})

const awsPlugin = viewer.addPluginSync(new AWSClientPlugin())
// set parameters and export. This can all be done from the UI also.
awsPlugin.accessKeyId = '00000000000000000000'
awsPlugin.accessKeySecret = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
awsPlugin.endpointURL = 'https://s3.amazonaws.com/bucket/'
awsPlugin.pathPrefix = 'some/path/'
// or load a json file with the parameters
// the json file can be creating by entering the data in the UI and clicking the download preset json option.
await viewer.load('file.json')

// this will export the scene as glb
const blob = await viewer.exportScene()

// for a plugin config
// blob = await viewer.export(viewer.getPlugin(GroundPlugin))
// for a material
// blob = await viewer.export(object.material)
// for an object/mesh
// blob = await viewer.export(object, {exportExt: 'glb'})

// upload to s3. needs the parameters to be correct
await viewer.exportBlob(blob, 'filename.glb')
```

::: tip Note
CORS should be enabled for the S3 bucket on the domain where the viewer is hosted. This requirement can be bypassed during development by setting `AWSClientPlugin.USE_PROXY = true`. A free proxy is already set by default and can be changed by setting `AWSClientPlugin.PROXY_URL`.
:::

## @threepipe/plugin-blend-importer

Exports [BlendImporterPlugin](https://threepipe.org/plugins/blend-importer/docs/classes/BlendLoadPlugin.html) which adds support for loading .blend files.

It uses [js.blend](https://github.com/acweathersby/js.blend) for parsing blend file structure.

::: warning Note
This is still a WIP.
:::

Currently working: `Mesh`, `BufferGeometry` and basic `PointLight`.
To be added: `PhysicalMaterial`, `UnlitMaterial` (similar to blender-gltf-io plugin)

[Example](https://threepipe.org/examples/#blend-load/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/blend-importer/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/blend-importer/docs)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-blend-importer.svg)](https://www.npmjs.com/package/@threepipe/plugin-blend-importer)

```bash
npm install @threepipe/plugin-blend-importer
```

```typescript
import {ThreeViewer} from 'threepipe'
import {BlendLoadPlugin} from '@threepipe/plugin-blend-importer'

const viewer = new ThreeViewer({...})
viewer.addPluginSync(BlendLoadPlugin)

// Now load any .blend file.
const model = await viewer.load<IObject3D>('path/to/file.blend')

// To load the file as a data url, use the correct mimetype
const model1 = await viewer.load<IObject3D>('data:application/x-blender;base64,...')

```

[//]: # ( TODO: The plugin should parse and references to other assets and find them relative to the .blend file or the current location.)

## @threepipe/plugin-gaussian-splatting

Exports [GaussianSplattingPlugin](https://threepipe.org/plugins/gaussian-splatting/docs/classes/GaussianSplattingPlugin.html) which adds support for loading .blend files.

It uses [`three-gaussian-splat`](https://github.com/repalash/threepipe/blob/master/plugins/gaussian-splatting/src/three-gaussian-splat), a rewrite of [@zappar/three-guassian-splat](https://github.com/zappar-xr/three-gaussian-splat) (and [gsplat.js](https://github.com/huggingface/gsplat.js) and [antimatter15/splat](https://github.com/antimatter15/splat)) for loading splat files and rendering gaussian splats.

[Example](https://threepipe.org/examples/#splat-load/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/gaussian-splatting/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/gaussian-splatting/docs)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-gaussian-splatting.svg)](https://www.npmjs.com/package/@threepipe/plugin-gaussian-splatting)

```bash
npm install @threepipe/plugin-gaussian-splatting
```

::: warning Note
This is still a WIP.
:::

Currently working:
* Importing .splat files (just array buffer of gaussian splat attributes)
* ThreeGaussianSplatPlugin (Same as GaussianSplattingPlugin), add importer and update events to the viewer
* GaussianSplatMaterialExtension for adding gaussian splat functionality to any material like Unlit, Physical
* GaussianSplatMesh a subclass of Mesh2 for holding the gaussian splat geometry and a material with gaussian splat extension. also handles basic raycast in the splat geometry. (assuming simple points)
* GaussianSplatGeometry holds the geometry data and and the sort worker. Computes correct bounding box and sphere.
* SplatLoader for loading splat files and creating the geometry and material.
* GaussianSplatMaterialUnlit, GaussianSplatMaterialRaw
* GaussianSplatMaterialPhysical, working but normals are hardcoded to 0,1,0

TBD:
* Exporting/embedding splat files into glb
* Rendering to depth/gbuffer
* Estimate normals/read from file
* Lighting in GaussianSplatMaterialPhysical

```typescript
import {ThreeViewer} from 'threepipe'
import {GaussianSplattingPlugin} from '@threepipe/plugin-gaussian-splatting'

const viewer = new ThreeViewer({...})
viewer.addPluginSync(GaussianSplattingPlugin)

// Now load any .splat file.
const model = await viewer.load<GaussianSplatMesh>('path/to/file.splat')

```

## @threepipe/plugin-svg-renderer

Exports [ThreeSVGRendererPlugin](https://threepipe.org/plugins/svg-renderer/docs/classes/ThreeSVGRendererPlugin.html) and [BasicSVGRendererPlugin](https://threepipe.org/plugins/svg-renderer/docs/classes/BasicSVGRendererPlugin.html) which provide support for rendering the 3d scene as [SVG(Scalable Vector Graphics)](https://developer.mozilla.org/en-US/docs/Web/SVG). The generated SVG is compatible with browser rendering and other software like figma, illustrator etc.

[Example](https://threepipe.org/examples/#three-svg-renderer/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/svg-renderer/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/svg-renderer/docs) &mdash;
[GPLV3 License](https://github.com/repalash/threepipe/blob/master/plugins/svg-renderer/LICENSE)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-network.svg)](https://www.npmjs.com/package/@threepipe/plugin-svg-renderer)

```bash
npm install @threepipe/plugin-svg-renderer
```

::: warning Note
This is still a WIP. API might change a bit
:::

`ThreeSVGRendererPlugin` uses [`three-svg-renderer`](https://github.com/repalash/threepipe/blob/master/plugins/svg-renderer/src/three-svg-renderer), which is a modified version of [three-svg-renderer](https://www.npmjs.com/package/three-svg-renderer) (GPLV3 Licenced).
The plugin renderers meshes in the viewer scene to svg objects by computing polygons and contours of the geometry in view space. Check [LokiResearch/three-svg-renderer](https://github.com/LokiResearch/three-svg-renderer?tab=readme-ov-file#references) for more details.
In the modified version that is used here, support for some types of geometries is added and a rendered image in screen-space is used to create raster fill images for paths along with some other small changes. Check out the [Example](https://threepipe.org/examples/#three-svg-renderer/) for demo. See also [svg-geometry-playground example](https://threepipe.org/examples/#svg-geometry-playground/) for usage with other plugins `PickingPlugin`, `TransformControlsPlugin` and `GeometryGeneratorPlugin`.

Note that this does not support all the features of three.js and may not work with all types of materials and geometries. Check the examples for a list of sample models that do and don't work.

`BasicSVGRendererPlugin` is a sample plugin using [SVGRenderer](https://threejs.org/docs/index.html?q=svg#examples/en/renderers/SVGRenderer) from three.js addons. This renders all triangles in the scene to separate svg paths. Check the three.js docs for more details. Check out the [Example](https://threepipe.org/examples/#basic-svg-renderer/) for demo.

```typescript
import {ThreeViewer} from 'threepipe'
import {ThreeSVGRendererPlugin} from '@threepipe/plugin-svg-renderer'

const viewer = new ThreeViewer({
  ...,
  rgbm: false, // this is required
})
const svgRender = viewer.addPluginSync(ThreeSVGRendererPlugin)
svgRender.autoRender = true // automatically render when camera or any object changes.
svgRender.autoMakeSvgObjects = true // automatically create SVG objects for all meshes in the scene.
// svgRender.makeSVGObject(object) // manually create SVG object for an object. (if autoMakeSvgObjects is false) 

// Now load or generate any 3d model. Make sure its not very big. And the meshes are optimized.
const model = await viewer.load<IOBject3D>('path/to/file.glb')

// clear the background of the viewer 
viewer.scene.backgroundColor = null
viewer.scene.background = null
        
// disable damping to get better experience.
viewer.scene.mainCamera.controls!.enableDamping = false

// hide the canvas to see the underlying svg node.
// note: do not set the display to none or remove the canvas as OrbitControls and other plugins might still be tracking the canvas.
viewer.canvas.style.opacity = '0'

// 3d pipeline can also be disabled like this if `drawImageFills` is `false` to get better performance. Do this only after loading the model.
// await viewer.doOnce('postFrame') // wait for the first frame to be rendered (for autoScale etc)
// viewer.renderManager.autoBuildPipeline = false
// viewer.renderManager.pipeline = [] // this will disable main viewer rendering
```

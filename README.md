# ThreePipe

A new way to work with three.js, 3D models and rendering on the web.

[ThreePipe](https://threepipe.org/) &mdash;
[Github](https://github.com/repalash/threepipe) &mdash;
[Examples](https://threepipe.org/examples/) &mdash;
[API Reference](https://threepipe.org/docs/) &mdash;
[WebGi](https://webgi.xyz/docs/)

[![NPM Package](https://img.shields.io/npm/v/threepipe.svg)](https://www.npmjs.com/package/threepipe)
[![Discord Server](https://img.shields.io/discord/956788102473584660?label=Discord&logo=discord)](https://discord.gg/apzU8rUWxY)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-green.svg)](https://opensource.org/license/apache-2-0/)
[![Twitter](https://img.shields.io/twitter/url/https/twitter.com/repalash.svg?style=social&label=Follow%20%40repalash)](https://twitter.com/repalash)

ThreePipe is a 3D framework built on top of [three.js](https://threejs.org/) in TypeScript with a focus on rendering quality, modularity and extensibility.

Key features include:
- Simple, intuitive API for creating 3D model viewers/configurators/editors on web pages, with many built-in presets for common workflows and use-cases.
- Companion [editor](https://threepipe.org/examples/tweakpane-editor/) to create, edit and configure 3D scenes in the browser.
- Modular architecture that allows you to easily extend the viewer, scene objects, materials, shaders, rendering, post-processing and serialization with custom functionality.
- Simple plugin system along with a rich library of built-in plugins that allows you to easily add new features to the viewer.
- [uiconfig](https://github.com/repalash/uiconfig.js) compatibility to automatically generate configuration UIs in the browser.
- Modular rendering pipeline with built-in deferred rendering, post-processing, RGBM HDR rendering, etc. 
- Material extension framework to modify/inject/build custom shader code into existing materials at runtime from plugins.
- Extendable asset import, export and management pipeline with built-in support for gltf, glb, obj+mtl, fbx, materials(pmat/bmat), json, zip, png, jpeg, svg, webp, ktx2, ply, 3dm and many more.
- Automatic serialization of all viewer and plugin settings in GLB(with custom extensions) and JSON formats. 
- Automatic disposal of all three.js resources with built-in reference management. 

## Examples

Code samples and demos covering various usecases and test are present in the [examples](./examples/) folder. 

Try them: https://threepipe.org/examples/

View the source code by pressing the code button on the top left of the example page.

To make changes and run the example, click on the CodePen button on the top right of the source code.


## Getting Started

### Installation

```bash
npm install threepipe
```

### Loading a 3D Model

First, create a canvas element in your HTML page:
```html
<canvas id="three-canvas" style="width: 800px; height: 600px;"></canvas>
```

Then, import the viewer and create a new instance:

```typescript
import {ThreeViewer, IObject3D} from 'threepipe'

// Create a viewer
const viewer = new ThreeViewer({canvas: document.getElementById('three-canvas') as HTMLCanvasElement})

// Load an environment map
await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')

// Load a model
const result = await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
    autoCenter: true,
    autoScale: true,
})
```

That's it! You should now see a 3D model on your page.

The 3D model can be opened in the [editor](TODO) to view and edit the scene settings, objects, materials, lights, cameras, post-processing, etc. and exported as a GLB file. All settings are automatically serialized and saved in the GLB file, which can be loaded into the viewer. Any plugins used in the editor can be added to the viewer to add the same functionality. The plugin data is automatically loaded(if the plugin is added) when the model is added to the scene.

The viewer initializes with a Scene, Camera, Camera controls(Orbit Controls), several importers, exporters and a default rendering pipeline. Additional functionality can be added with plugins.

Check out the GLTF Load example to see it in action or to check the JS equivalent code: https://threepipe.org/examples/gltf-load/

Check out the [Plugins](#plugins) section below to learn how to add additional functionality to the viewer.

## License
The core framework([src](https://github.com/repalash/threepipe/tree/master/src), [dist](https://github.com/repalash/threepipe/tree/master/dist), [examples](https://github.com/repalash/threepipe/tree/master/examples) folders) and any [plugins](https://github.com/repalash/threepipe/tree/master/plugins) without a separate license are under the [Apache 2.0 license](https://github.com/repalash/threepipe/tree/master/LICENSE).

Some plugins(in the [plugins](https://github.com/repalash/threepipe/tree/master/plugins) folder) might have different licenses. Check the individual plugin documentation and the source folder/files for more details.

## Status 
The project is in `alpha` stage and under active development. Many features will be added but the core API will not change significantly in future releases. 

Check out [WebGi](https://webgi.xyz/) for an advanced tailor-made solution for e-commerce, jewelry, automobile, apparel, furniture etc.

## Documentation

Check the list of all functions, classes and types in the [API Reference Docs](https://threepipe.org/docs/).

## WebGi
Check out WebGi - Premium Photo-realistic 3D rendering framework and tools for web applications and online commerce along with custom modules and rendering solutions for e-commerce, jewelry, automobile, apparel, furniture and other retail applications.

[Homepage](https://webgi.xyz/) &mdash; [Docs](https://webgi.xyz/docs/)

[![Twitter](https://img.shields.io/twitter/url/https/twitter.com/repalash.svg?style=social&label=Follow%20%40pixotronics)](https://twitter.com/pixotronics)

## Contributing
Contributions to ThreePipe are welcome and encouraged! Feel free to open issues and pull requests on the GitHub repository.

## File Formats

ThreePipe Asset Manager supports the import of the following file formats out of the box:
* Models: 
  * gltf, glb
  * obj, mtl
  * fbx
  * drc
* Materials
  * mat, pmat, bmat (json based), registered material template slugs
* Images
  * webp, png, jpeg, jpg, svg, ico
  * hdr, exr
  * ktx2, ktx, dds, pvr
* Misc
  * json, vjson
  * zip
  * txt

Plugins can add additional formats:
* Models
  * 3dm - Using [Rhino3dmLoadPlugin](#Rhino3dmLoadPlugin)

## Plugins

ThreePipe has a simple plugin system that allows you to easily add new features to the viewer. Plugins can be added to the viewer using the `addPlugin` and `addPluginSync` methods. The plugin system is designed to be modular and extensible. Plugins can be added to the viewer at any time and can be removed using the `removePlugin` and `removePluginSync` methods.

### TonemapPlugin

todo: image

Example: https://threepipe.org/examples/#tonemap-plugin/

Source Code: [src/plugins/postprocessing/TonemapPlugin.ts](./src/plugins/postprocessing/TonemapPlugin.ts)

API Reference: [TonemapPlugin](https://threepipe.org/docs/classes/TonemapPlugin.html)

TonemapPlugin adds a post-processing material extension to the ScreenPass in render manager
that applies tonemapping to the color. The tonemapping operator can be changed
by setting the `toneMapping` property of the plugin. The default tonemapping operator is `ACESFilmicToneMapping`.

Other Tonemapping properties can be like `exposure`, `contrast` and `saturation`

TonemapPlugin is added by default in ThreeViewer unless `tonemap` is set to `false` in the options.

### DropzonePlugin

todo: image

Example: https://threepipe.org/examples/#dropzone-plugin/

Source Code: [src/plugins/interaction/DropzonePlugin.ts](./src/plugins/interaction/DropzonePlugin.ts)

API Reference: [DropzonePlugin](https://threepipe.org/docs/classes/DropzonePlugin.html)

DropzonePlugin adds support for drag and drop of local files to automatically import, process and load them into the viewer. 

DropzonePlugin can be added by default in ThreeViewer
by setting the `dropzone` property to `true` or an object of `DropzonePluginOptions` in the options.

```typescript
import {DropzonePlugin, ThreeViewer} from 'threepipe'
const viewer = new ThreeViewer({
  canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
  dropzone: true, // just set to true to enable drag drop functionatility in the viewer
})
```

To set custom options,
pass an object of [DropzonePluginOptions](https://threepipe.org/docs/interfaces/DropzonePluginOptions.html) type to the `dropzone` property.
```typescript
import {DropzonePlugin, ThreeViewer} from 'threepipe'
const viewer = new ThreeViewer({
  canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
  dropzone: { // this can also be set to true and configured by getting a reference to the DropzonePlugin
    allowedExtensions: ['gltf', 'glb', 'hdr', 'png', 'jpg', 'json', 'fbx', 'obj'], // only allow these file types. If undefined, all files are allowed.
    addOptions: {
      disposeSceneObjects: true, // auto dispose of old scene objects
      autoSetEnvironment: true, // when hdr is dropped
      autoSetBackground: true, // when any image is dropped
      autoCenter: true, // auto center the object
      autoScale: true, // auto scale according to radius
      autoScaleRadius: 2,
      license: 'Imported from dropzone', // Any license to set on imported objects
      importConfig: true, // import config from file
    },
    // check more options in the DropzonePluginOptions interface
  },
})
```

### DepthBufferPlugin

todo: image

Example: https://threepipe.org/examples/#depth-buffer-plugin/

Source Code: [src/plugins/pipeline/DepthBufferPlugin.ts](./src/plugins/pipeline/DepthBufferPlugin.ts)

API Reference: [DepthBufferPlugin](https://threepipe.org/docs/classes/DepthBufferPlugin.html)

Depth Buffer Plugin adds a pre-render pass to the render manager and renders a depth buffer to a target. The render target can be accessed by other plugins throughout the rendering pipeline to create effects like depth of field, SSAO, SSR, etc. 

```typescript
import {ThreeViewer, DepthBufferPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const depthPlugin = viewer.addPluginSync(new DepthBufferPlugin(HalfFloatType))

const depthTarget = depthPlugin.target;

// Use the depth target by accesing `depthTarget.texture`.
```

The depth values are based on camera near far values, which are controlled automatically by the viewer. To manually specify near, far values and limits, it can be set in the camera userData. Check the [example](https://threepipe.org/examples/#depth-buffer-plugin/) for more details.

### NormalBufferPlugin

todo: image

Example: https://threepipe.org/examples/#normal-buffer-plugin/

Source Code: [src/plugins/pipeline/NormalBufferPlugin.ts](./src/plugins/pipeline/NormalBufferPlugin.ts)

API Reference: [NormalBufferPlugin](https://threepipe.org/docs/classes/NormalBufferPlugin.html)

Normal Buffer Plugin adds a pre-render pass to the render manager and renders a normal buffer to a target. The render target can be accessed by other plugins throughout the rendering pipeline to create effects like SSAO, SSR, etc. 

Note: Use [`DepthNormalBufferPlugin`](#DepthNormalBufferPlugin) if using both `DepthBufferPlugin` and `NormalBufferPlugin` to render both depth and normal buffers in a single pass.

```typescript
import {ThreeViewer, NormalBufferPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const normalPlugin = viewer.addPluginSync(new NormalBufferPlugin())

const normalTarget = normalPlugin.target;

// Use the normal target by accessing `normalTarget.texture`.
```


### DepthNormalBufferPlugin

todo


### RenderTargetPreviewPlugin

todo: image

Example: https://threepipe.org/examples/#render-target-preview/

Source Code: [src/plugins/ui/RenderTargetPreviewPlugin.ts](./src/plugins/ui/RenderTargetPreviewPlugin.ts)

API Reference: [RenderTargetPreviewPlugin](https://threepipe.org/docs/classes/RenderTargetPreviewPlugin.html)

RenderTargetPreviewPlugin is a useful development and debugging plugin that renders any registered render-target to the screen in small collapsable panels.

```typescript
import {ThreeViewer, RenderTargetPreviewPlugin, NormalBufferPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const normalPlugin = viewer.addPluginSync(new NormalBufferPlugin(HalfFloatType))

const previewPlugin = viewer.addPluginSync(new RenderTargetPreviewPlugin())

// Show the normal buffer in a panel
previewPlugin.addTarget(()=>normalPlugin.target, 'normal', false, false)
```

### Rhino3dmLoadPlugin

Example: https://threepipe.org/examples/#rhino3dm-load/

Source Code: [src/plugins/import/Rhino3dmLoadPlugin.ts](./src/plugins/import/Rhino3dmLoadPlugin.ts)

API Reference: [Rhino3dmLoadPlugin](https://threepipe.org/docs/classes/Rhino3dmLoadPlugin.html)

Adds support for loading .3dm files generated by [Rhino 3D](https://www.rhino3d.com/). This plugin includes some changes with how 3dm files are loaded in three.js. The changes are around loading layer and primitive properties when set as reference in the 3dm files.

## Additional Plugins

Additional plugins can be found in the [plugins](plugins/) directory.
These add support for integrating with other libraries, adding new features, and other functionality with different licenses.

### Tweakpane Ui plugin

todo: image

Example: https://threepipe.org/examples/#viewer-uiconfig/

Source Code: [plugins/tweakpane/src/TweakpaneUiPlugin.ts](plugins/tweakpane/src/TweakpaneUiPlugin.ts)

API Reference: [TweakpaneUiPlugin](https://threepipe.org/plugins/tweakpane/docs/classes/TweakpaneUiPlugin.html)

NPM: `npm install @threepipe/plugin-tweakpane`

CDN: https://threepipe.org/plugins/tweakpane/dist/index.mjs

TweakpaneUiPlugin adds support for using [uiconfig-tweakpane](https://github.com/repalash/uiconfig-tweakpane)
to create a configuration UI in applications using the [Tweakpane](https://cocopon.github.io/tweakpane/) library.

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

### Tweakpane Editor Plugin

todo: image

Example: https://threepipe.org/examples/#tweakpane-editor/

Source Code: [plugins/tweakpane-editor/src/TweakpaneEditorPlugin.ts](plugins/tweakpane-editor/src/TweakpaneEditorPlugin.ts)

API Reference: [TweakpaneEditorPlugin](https://threepipe.org/plugins/tweakpane-editor/docs/classes/TweakpaneEditorPlugin.html)

NPM: `npm install @threepipe/plugin-tweakpane-editor`

CDN: https://threepipe.org/plugins/tweakpane-editor/dist/index.mjs

TweakpaneEditorPlugin uses TweakpaneUiPlugin to create an editor for editing viewer,
plugins, model and material configurations in the browser.

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

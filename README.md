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

ThreePipe is a 3D framework built on top of [three.js](https://threejs.org/) in TypeScript with a focus on quality rendering, modularity and extensibility.

Key features include:
- Simple, intuitive API for creating 3D model viewers/configurators/editors on web pages, with many built-in presets for common workflows and use-cases.
- Companion [editor](TODO) to create, edit and configure 3D scenes in the browser.
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

ThreePipe Asset Manager supports the import of following file formats out of the box:
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

Additional formats can be added by plugins:
* Models
  * 3dm - Using [Rhino3dmLoadPlugin](#Rhino3dmLoadPlugin)

## Plugins

ThreePipe has a simple plugin system that allows you to easily add new features to the viewer. Plugins can be added to the viewer using the `addPlugin` and `addPluginSync` methods. The plugin system is designed to be modular and extensible. Plugins can be added to the viewer at any time and can be removed using the `removePlugin` and `removePluginSync` methods.

### DepthBufferPlugin

todo: image

Example: https://threepipe.org/examples/#depth-buffer-plugin/

Source Code: [src/plugins/pipeline/DepthBufferPlugin.ts](./src/plugins/pipeline/DepthBufferPlugin.ts)

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

Adds support for loading .3dm files generated by [Rhino 3D](https://www.rhino3d.com/). This plugin includes some changes with how 3dm files are loaded in three.js. The changes are around loading layer and primitive properties when set as reference in the 3dm files.

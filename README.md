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

ThreePipe is a 3D framework built on top of [three.js](https://threejs.org/) in TypeScript with a focus on rendering quality, modularity, and extensibility.

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

# Table of Contents

- [ThreePipe](#threepipe)
  - [Examples](#examples)
  - [Table of Contents](#table-of-contents)
  - [Getting Started](#getting-started)
    - [HTML/JS Quickstart (CDN)](#htmljs-quickstart-cdn)
    - [NPM/YARN Package](#npmyarn)
      - [Installation](#installation)
      - [Loading a 3D Model](#loading-a-3d-model)
  - [License](#license)
  - [Status](#status)
  - [Documentation (API Reference)](#documentation)
  - [WebGi](#webgi)
  - [Contributing](#contributing)
- [Features](#features)
  - [File Formats](#file-formats)
  - [Loading files](#loading-files)
    - [3D models](#3d-models)
    - [Materials](#materials)
    - [Images/Textures](#imagestextures)
    - [zip files](#zip-files)
    - [txt, json files](#txt-json-files)
    - [Data URLs](#data-urls)
    - [Local files, File and Blob](#local-files-file-and-blob)
    - [Background, Environment maps](#background-environment-maps)
    - [SVG strings](#svg-strings)
- [Plugins](#threepipe-plugins)
  - [TonemapPlugin](#tonemapplugin) - Add tonemap to the final screen pass
  - [DropzonePlugin](#dropzoneplugin) - Drag and drop local files to import and load
  - [ProgressivePlugin](#progressiveplugin) - Post-render pass to blend the last frame with the current frame
  - [DepthBufferPlugin](#depthbufferplugin) - Pre-rendering of depth buffer
  - [NormalBufferPlugin](#normalbufferplugin) - Pre-rendering of normal buffer
  - [GBufferPlugin](#depthnormalbufferplugin) - Pre-rendering of depth and normal buffers in a single pass buffer
  - [GLTFAnimationPlugin](#gltfanimationplugin) - Add support for playing and seeking gltf animations
  - [RenderTargetPreviewPlugin](#rendertargetpreviewplugin) - Preview any render target in a UI panel over the canvas
  - [Rhino3dmLoadPlugin](#rhino3dmloadplugin) - Add support for loading .3dm files
  - [PLYLoadPlugin](#plyloadplugin) - Add support for loading .ply files
  - [STLLoadPlugin](#stlloadplugin) - Add support for loading .stl files
  - [KTX2LoadPlugin](#ktx2loadplugin) - Add support for loading .ktx2 files
  - [KTXLoadPlugin](#ktxloadplugin) - Add support for loading .ktx files
- [Packages](#threepipe-packages)
  - [@threepipe/plugin-tweakpane](#threepipeplugin-tweakpane) Tweakpane UI Plugin
  - [@threepipe/plugin-tweakpane-editor](#threepipeplugin-tweakpane-editor) - Tweakpane Editor Plugin

## Getting Started

### HTML/JS Quickstart (CDN)

```html
<canvas id="three-canvas" style="width: 800px; height: 600px;"></canvas>
<script type="module">
  import {ThreeViewer} from 'https://threepipe.org/dist/index.mjs'
  const viewer = new ThreeViewer({canvas: document.getElementById('three-canvas')})
  
  // Load an environment map
  const envPromise = viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
  const modelPromise = viewer.load('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
    autoCenter: true,
    autoScale: true,
  })
  
  Promise.all([envPromise, modelPromise]).then(([env, model])=>{
    console.log('Loaded', model, env, viewer)
  })
</script>
```
Check it in action: https://threepipe.org/examples/#html-sample/

### NPM/YARN

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

Check out the GLTF Load example to see it in action or to check the JS equivalent code: https://threepipe.org/examples/#gltf-load/

Check out the [Plugins](#plugins) section below to learn how to add additional functionality to the viewer.

## License
The core framework([src](https://github.com/repalash/threepipe/tree/master/src), [dist](https://github.com/repalash/threepipe/tree/master/dist), [examples](https://github.com/repalash/threepipe/tree/master/examples) folders) and any [plugins](https://github.com/repalash/threepipe/tree/master/plugins) without a separate license are under the Free [Apache 2.0 license](https://github.com/repalash/threepipe/tree/master/LICENSE).

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

# Features

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
  * webp, png, jpeg, jpg, svg, ico, avif
  * hdr, exr
* Misc
  * json, vjson
  * zip
  * txt

Plugins can add additional formats:
* Models
  * 3dm - Using [Rhino3dmLoadPlugin](#Rhino3dmLoadPlugin)
  * ply - Using [PLYLoadPlugin](#PLYLoadPlugin)
  * stl - Using [STLLoadPlugin](#STLLoadPlugin)
  * ktx - Using [KTXLoadPlugin](#KTXLoadPlugin)
  * ktx2 - Using [KTX2LoadPlugin](#KTX2LoadPlugin)

## Loading files

ThreePipe uses the [AssetManager](https://threepipe.org/docs/classes/AssetManager.html) to load files.
The AssetManager has support for loading files from URLs, local files and data URLs.
The AssetManager also adds support for loading files from a zip archive. The zip files are automatically unzipped, and the files are loaded from the zip archive.

[viewer.load()](https://threepipe.org/docs/classes/ThreeViewer.html#load) is a high-level wrapper for loading files from the AssetManager.
It automatically adds the loaded object to the scene and returns a promise that resolves to the loaded object,
the materials are also automatically registered to the material manager.

If the purpose is not to add files to the scene then [viewer.assetManager.importer.import()](https://threepipe.org/docs/classes/AssetImporter.html#import) method can be used
to import files from the `AssetImporter`.
viewer.assetManager.loadImported()](https://threepipe.org/docs/classes/AssetManager.html#loadImported)
can then be called to load the imported files after any processing.
The `viewer.load()`, `viewer.assetManager.addAsset()`
and `viewer.assetManager.addAssetSingle()` methods perform combination of `import` and `loadImported`.

### 3D models

The 3d models are added to `viewer.scene.modelRoot` on `viewer.load` unless some option is specified.

```typescript
const objectGlb = await viewer.load<IObject3D>('https://example.com/file.glb')
const objectFbx = await viewer.load<IObject3D>('https://example.com/file.fbx')
const objectObj = await viewer.load<IObject3D>('https://example.com/file.obj') // .mtl referenced in obj is automatically loaded
// ... load any 3d model file as an object
```
Here, we are casting to [IObject3D](https://threepipe.org/docs/interfaces/IObject3D.html) type
to get the proper type and autocomplete for the object.
`IObject3D` inherits [Object3D](https://threejs.org/docs/#api/en/core/Object3D) from three.js and adds some additional properties.

For JavaScript, the type can be omitted.
```javascript
const objectGlb = await viewer.load('https://example.com/file.glb')
```

When loading models, several options can be passed to automatically process the model first time, like `autoScale`, `autoCenter`, `addToRoot` etc. Check [AddObjectOptions](https://threepipe.org/docs/interfaces/AddObjectOptions.html) and [ImportAddOptions](https://threepipe.org/docs/interfaces/ImportAddOptions.html) for more details.

### Materials

The materials downloaded as PMAT/BMAT/JSON etc from threepipe,
webgi or the editor can be loaded
and registered with the [MaterialManager](https://threepipe.org/docs/classes/MaterialManager)
using the `viewer.load` method. 

Custom material types can also be registered by plugins(like dmat for diamonds), which can also be loaded automatically using the `viewer.load` method.

```typescript
const pMaterial = await viewer.load<PhysicalMaterial>('https://example.com/file.pmat')
const bMaterial = await viewer.load<UnlitMaterial>('https://example.com/file.bmat')
// ... load any material file as a material
```
Casting to [PhysicalMaterial](https://threepipe.org/docs/classes/PhysicalMaterial) or [UnlitMaterial](https://threepipe.org/docs/classes/UnlitMaterial) is optional but recommended to get the proper type and autocomplete for the material.

To assign the material on any object, set it to `object.material`

```typescript
// find a loaded mesh in the scene
const object = viewer.scene.getObjectByName('objectName');
// assign the material
object.material = pMaterial;
```

To copy the properties without changing the material reference, use `material.copy()` or `material.setValues()` methods.

```typescript
object.material.copy(pMaterial);
```

TODO: add examples for material load and copy

### Images/Textures

Images can be loaded using the `viewer.load` method.
There is built-in support for loading all image formats supported by the browser (webp, png, jpeg, jpg, svg, ico, avif) and hdr, exr, hdr.png formats for all browsers.
More formats like ktx2, ktx, etc. can be added using plugins.

```typescript
const texture = await viewer.load<ITexture>('https://example.com/file.png')
// ... load any image file as a texture
```
Casting to [ITexture](https://threepipe.org/docs/interfaces/ITexture.html) is optional
but recommended to get the proper type and autocomplete for the texture.
It inherits from three.js [Texture](https://threejs.org/docs/#api/en/textures/Texture) and adds some additional properties.

To assign the texture on any material, set it to `material.map`

```typescript
// find a loaded mesh in the scene
const object = viewer.scene.getObjectByName('objectName');
const material = object.material as PhysicalMaterial;
// assign the texture
material.map = texture;
material.setDirty() // to let the viewer know that the material has changed and needs to re-render the scene. This will also trigger fade effect if FrameFadePlugin is added.
```
Check out the image load example to see it in action or to check the JS equivalent code: https://threepipe.org/examples/#image-load/

### Zip files

.zip files are automatically unzipped and the files are sent to re-load recursively when loaded with `viewer.load`.
Any level of zip hierarchy is flattened.
Loading files like .gltf with references to assets inside the zip file,
any relative references are also automatically resolved.
This is supported for file types like gltf, glb, obj,
etc which support references to external files and has `root` set to `true in [IImporter](https://threepipe.org/docs/interfaces/IImporter.html).

```typescript
const objectGltf = await viewer.load<IObject3D>('https://example.com/model.gltf.zip')
```
If we know that the zip file contains a single gltf with all the assets, we can cast the result to [IObject3D](https://threepipe.org/docs/interfaces/IObject3D.html) type. 

To load multiple assets from zip files like multiple textures or materials, use `viewer.assetManager.addAsset` method which returns a promise of array of loaded assets.

```typescript
const textures = await viewer.assetManager.addAsset<ITexture[]>('https://example.com/textures.zip')
const materials = await viewer.assetManager.addAsset<IMaterial[]>('https://example.com/materials.zip')
```

The auto import of zip contents can be disabled to get the files and blobs in the zip 
```typescript
const zip = await viewer.load<any>('https://example.com/file.zip', {autoImportZipContents: false})
```

TODO - add example for loading zip files.

### txt, json files

Text and JSON files can be loaded using the `viewer.load` method and return strings and objects respectively.

```typescript
const text = await viewer.load<string>('https://example.com/file.txt')
const json = await viewer.load<any>('https://example.com/file.json')
```

### Data URLs

Data URLs can be loaded using the `viewer.load` method. The correct mime-type is required to be set in the data URL for finding the correct importer.

```typescript
const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA' // ... some data url
const texture = await viewer.load<ITexture>(dataUrl)
```

### Local files, File and Blob

Local files can be loaded using the `viewer.load` method by passing a [IAsset](https://threepipe.org/docs/interfaces/IAsset) object with [File](https://developer.mozilla.org/en-US/docs/Web/API/File) or [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob) object.

```typescript
const file: File|Blob = fileObject // create a new file, blob or get from input element 
const text = await viewer.load<IObject>({
  // a path/name is required to determine the proper importer by extension. `file.name` can also be used if available
  path: 'file.glb', 
  file
})
```
The same can be done for any file type.

To load a `Map` of files(like when multiple files are dragged and dropped on the webpage) with internal references to other files, use `viewer.assetManager.importer.importFiles` method. Check the source for [DropzonePlugin](#DropzonePlugin) for an example.

### Background, Environment maps

The background and environment maps can be set using the `viewer.setBackgroundMap` and `viewer.setEnvironmentMap` methods respectively. These accept both loaded textures from `viewer.load` and direct URLs. Files can be of any image format including hdr, exr.

```typescript
await viewer.setEnvironmentMap('https://example.com/file.hdr')
await viewer.setBackgroundMap('https://example.com/file.png')
```

The same texture can be set to both by setting `setBackground` or `setEnvironment` to true in the options: 
```typescript
await viewer.setEnvironmentMap('https://example.com/file.hdr', {setBackground: true})
```

Check the HDR Load example to see it in action: https://threepipe.org/examples/#hdr-load/

### SVG strings
SVG strings can be converted to data urls using the [svgUrl](https://repalash.com/ts-browser-helpers/functions/svgUrl.html) string template function

```typescript
const svgDataUrl = svgUrl`<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"> ... </svg>`;
const texture = await viewer.load<ITexture>(dataUrl)
```


# Threepipe Plugins

ThreePipe has a simple plugin system that allows you to easily add new features to the viewer. Plugins can be added to the viewer using the `addPlugin` and `addPluginSync` methods. The plugin system is designed to be modular and extensible. Plugins can be added to the viewer at any time and can be removed using the `removePlugin` and `removePluginSync` methods.

## TonemapPlugin

todo: image

Example: https://threepipe.org/examples/#tonemap-plugin/

Source Code: [src/plugins/postprocessing/TonemapPlugin.ts](./src/plugins/postprocessing/TonemapPlugin.ts)

API Reference: [TonemapPlugin](https://threepipe.org/docs/classes/TonemapPlugin.html)

TonemapPlugin adds a post-processing material extension to the ScreenPass in render manager
that applies tonemapping to the color. The tonemapping operator can be changed
by setting the `toneMapping` property of the plugin. The default tonemapping operator is `ACESFilmicToneMapping`.

Other Tonemapping properties can be like `exposure`, `contrast` and `saturation`

TonemapPlugin is added by default in ThreeViewer unless `tonemap` is set to `false` in the options.

## DropzonePlugin

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
    allowedExtensions: ['gltf', 'glb', 'hdr', 'png', 'jpg', 'json', 'fbx', 'obj', 'bin', 'exr'], // only allow these file types. If undefined, all files are allowed.
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

## ProgressivePlugin

todo: image

Example: https://threepipe.org/examples/#progressive-plugin/

Source Code: [src/plugins/postprocessing/ProgressivePlugin.ts](./src/plugins/pipeline/ProgressivePlugin.ts)

API Reference: [ProgressivePlugin](https://threepipe.org/docs/classes/ProgressivePlugin.html)

Progressive Plugin adds a post-render pass to blend the last frame with the current frame.

This is used as a dependency in other plugins for progressive rendering effect which is useful for progressive shadows, gi, denoising, baking, anti-aliasing, and many other effects.

## DepthBufferPlugin

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

## NormalBufferPlugin

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


## GBufferPlugin

todo


## GLTFAnimationPlugin

todo: image

Example: https://threepipe.org/examples/#gltf-animation-plugin/

Source Code: [src/plugins/animation/GLTFAnimationPlugin.ts](./src/plugins/animation/GLTFAnimationPlugin.ts)

API Reference: [GLTFAnimationPlugin](https://threepipe.org/docs/classes/GLTFAnimationPlugin.html)

Manages playback of GLTF animations.

The GLTF animations can be created in any 3d software that supports GLTF export like Blender.
If animations from multiple files are loaded, they will be merged in a single root object and played together.

The time playback is managed automatically, but can be controlled manually by setting {@link autoIncrementTime} to false and using {@link setTime} to set the time.

This plugin is made for playing, pausing, stopping, all the animations at once, while it is possible to play individual animations, it is not recommended.

To play individual animations, with custom choreography, use the {@link GLTFAnimationPlugin.animations} property to get reference to the animation clips and actions. Create your own mixers and control the animation playback like in three.js

## RenderTargetPreviewPlugin

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

## Rhino3dmLoadPlugin

Example: https://threepipe.org/examples/#rhino3dm-load/

Source Code: [src/plugins/import/Rhino3dmLoadPlugin.ts](./src/plugins/import/Rhino3dmLoadPlugin.ts)

API Reference: [Rhino3dmLoadPlugin](https://threepipe.org/docs/classes/Rhino3dmLoadPlugin.html)

Adds support for loading .3dm files generated by [Rhino 3D](https://www.rhino3d.com/). This plugin includes some changes with how 3dm files are loaded in three.js. The changes are around loading layer and primitive properties when set as reference in the 3dm files.

```typescript
import {Rhino3dmLoadPlugin} from 'threepipe'
viewer.addPluginSync(new Rhino3dmLoadPlugin())

const mesh = await viewer.load('file.3dm')
```

## PLYLoadPlugin

Example: https://threepipe.org/examples/#ply-load/

Source Code: [src/plugins/import/PLYLoadPlugin.ts](./src/plugins/import/PLYLoadPlugin.ts)

API Reference: [PLYLoadPlugin](https://threepipe.org/docs/classes/PLYLoadPlugin.html)

Adds support for loading .ply ([Polygon file format](https://en.wikipedia.org/wiki/PLY_(file_format))) files.

```typescript
import {PLYLoadPlugin} from 'threepipe'
viewer.addPluginSync(new PLYLoadPlugin())

const mesh = await viewer.load('file.ply')
```

## STLLoadPlugin

Example: https://threepipe.org/examples/#stl-load/

Source Code: [src/plugins/import/STLLoadPlugin.ts](./src/plugins/import/STLLoadPlugin.ts)

API Reference: [STLLoadPlugin](https://threepipe.org/docs/classes/STLLoadPlugin.html)

Adds support for loading .stl ([Stereolithography](https://en.wikipedia.org/wiki/STL_(file_format))) files.

```typescript
import {STLLoadPlugin} from 'threepipe'
viewer.addPluginSync(new STLLoadPlugin())

const mesh = await viewer.load('file.stl')
```

## KTX2LoadPlugin

Example: https://threepipe.org/examples/#ktx2-load/

Source Code: [src/plugins/import/KTX2LoadPlugin.ts](./src/plugins/import/KTX2LoadPlugin.ts)

API Reference: [KTX2LoadPlugin](https://threepipe.org/docs/classes/KTX2LoadPlugin.html)

Adds support for loading .ktx2 ([Khronos Texture](https://www.khronos.org/opengles/sdk/tools/KTX/file_format_spec/) files.

KTX2LoadPlugin also adds support for exporting loaded .ktx2 files in glTF files with the [KHR_texture_basisu](https://www.khronos.org/registry/KHR/textures/2.0-extensions/KHR_texture_basisu/) extension.

```typescript
import {KTX2LoadPlugin} from 'threepipe'
viewer.addPluginSync(new KTX2LoadPlugin())

const texture = await viewer.load('file.ktx2')
```

## KTXLoadPlugin

Example: https://threepipe.org/examples/#ktx-load/

Source Code: [src/plugins/import/KTXLoadPlugin.ts](./src/plugins/import/KTXLoadPlugin.ts)

API Reference: [KTXLoadPlugin](https://threepipe.org/docs/classes/KTXLoadPlugin.html)

Adds support for loading .ktx ([Khronos Texture](https://www.khronos.org/opengles/sdk/tools/KTX/file_format_spec/) files.

Note: This plugin only adds support for loading .ktx file, and not exporting them in the bundled .glb.  Use .ktx2 files instead of .ktx files for better compression and performance.

```typescript
import {KTXLoadPlugin} from 'threepipe'
viewer.addPluginSync(new KTXLoadPlugin())

const texture = await viewer.load('file.ktx')
```

# @threepipe Packages

Additional plugins can be found in the [plugins](plugins/) directory.
These add support for integrating with other libraries, adding new features, and other functionality with different licenses.

## @threepipe/plugin-tweakpane
Tewakpane UI plugin for ThreePipe

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

## @threepipe/plugin-tweakpane-editor

Tweakpane Editor Plugin for ThreePipe

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

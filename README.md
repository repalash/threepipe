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
- Plugin system along with a rich library of built-in plugins that allows you to easily add new features to the viewer.
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

## Table of Contents

- [ThreePipe](#threepipe)
  - [Examples](https://threepipe.org/examples/)
  - [Table of Contents](#table-of-contents)
  - [Getting Started](#getting-started)
    - [HTML/JS Quickstart (CDN)](#htmljs-quickstart-cdn)
    - [React](#react)
    - [Vue.js](#vuejs)
    - [Svelte](#svelte)
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
  - [Exporting files](#exporting-files)
    - [Exporting 3D models](#exporting-3d-models)
    - [Exporting Materials](#exporting-materials)
    - [Exporting Canvas Images](#exporting-canvas-images)
    - [Exporting Images/Textures](#exporting-imagestextures)
    - [Exporting Render Targets](#exporting-render-targets)
  - [Render Pipeline](#render-pipeline)
  - [Material Extension](#material-extension)
  - [UI Configuration](#ui-configuration)
  - [Serialization](#serialization)
  - [Plugin System](#plugin-system)
- [Viewer API](#viewer-api)
  - [ThreeViewer](#threeviewer)
  - [RenderManager](#rendermanager)
  - [RootScene](#rootscene)
  - [ICamera](#icamera)
  - [AssetManager](#assetmanager)
    - [AssetImporter](#assetimporter)
    - [AssetExporter](#assetexporter)
    - [MaterialManager](#materialmanager)
- [Plugins](#threepipe-plugins)
  - [TonemapPlugin](#tonemapplugin) - Add tonemap to the final screen pass
  - [DropzonePlugin](#dropzoneplugin) - Drag and drop local files to import and load
  - [ProgressivePlugin](#progressiveplugin) - Post-render pass to blend the last frame with the current frame
  - [DepthBufferPlugin](#depthbufferplugin) - Pre-rendering of depth buffer
  - [NormalBufferPlugin](#normalbufferplugin) - Pre-rendering of normal buffer
  - [GBufferPlugin](#depthnormalbufferplugin) - Pre-rendering of depth and normal buffers in a single pass buffer
  - [PickingPlugin](#pickingplugin) - Adds support for selecting objects in the viewer with user interactions and selection widgets
  - [GLTFAnimationPlugin](#gltfanimationplugin) - Add support for playing and seeking gltf animations
  - [PopmotionPlugin](#popmotionplugin) - Integrates with popmotion.io library for animation/tweening
  - [CameraViewPlugin](#cameraviewplugin) - Add support for saving, loading, animating, looping between camera views
  - [RenderTargetPreviewPlugin](#rendertargetpreviewplugin) - Preview any render target in a UI panel over the canvas
  - [GeometryUVPreviewPlugin](#geometryuvpreviewplugin) - Preview UVs of any geometry in a UI panel over the canvas
  - [FrameFadePlugin](#framefadeplugin) - Post-render pass to smoothly fade to a new rendered frame over time
  - [VignettePlugin](#vignetteplugin) - Add Vignette effect  by patching the final screen pass
  - [ChromaticAberrationPlugin](#chromaticaberrationplugin) - Add Chromatic Aberration effect  by patching the final screen pass
  - [FilmicGrainPlugin](#filmicgrainplugin) - Add Filmic Grain effect  by patching the final screen pass
  - [NoiseBumpMaterialPlugin](#noisebumpmaterialplugin) - Sparkle Bump/Noise Bump material extension for PhysicalMaterial
  - [CustomBumpMapPlugin](#custombumpmapplugin) - Custom Bump Map material extension for PhysicalMaterial
  - [ClearcoatTintPlugin](#clearcoattintplugin) - Clearcoat Tint material extension for PhysicalMaterial
  - [FragmentClippingExtensionPlugin](#fragmentclippingextensionplugin) - Fragment/SDF Clipping material extension for PhysicalMaterial
  - [HDRiGroundPlugin](#hdrigroundplugin) - Add support for ground projected hdri/skybox to the webgl background shader.
  - [VirtualCamerasPlugin](#virtualcamerasplugin) - Add support for rendering virtual cameras before the main one every frame.
  - [Rhino3dmLoadPlugin](#rhino3dmloadplugin) - Add support for loading .3dm files
  - [PLYLoadPlugin](#plyloadplugin) - Add support for loading .ply files
  - [STLLoadPlugin](#stlloadplugin) - Add support for loading .stl files
  - [KTX2LoadPlugin](#ktx2loadplugin) - Add support for loading .ktx2 files
  - [KTXLoadPlugin](#ktxloadplugin) - Add support for loading .ktx files
- [Packages](#threepipe-packages)
  - [@threepipe/plugin-tweakpane](#threepipeplugin-tweakpane) Tweakpane UI Plugin
  - [@threepipe/plugin-blueprintjs](#threepipeplugin-blueprintjs) BlueprintJs UI Plugin
  - [@threepipe/plugin-tweakpane-editor](#threepipeplugin-tweakpane-editor) - Tweakpane Editor Plugin
  - [@threepipe/plugins-extra-importers](#threepipeplugins-extra-importers) - Plugin for loading more file types supported by loaders in three.js
  - [@threepipe/plugin-blend-importer](#threepipeplugin-blend-importer) - Blender to add support for loading .blend file
  - [@threepipe/plugin-geometry-generator](#threepipeplugin-geometry-generator) - Generate parametric geometry types that can be re-generated from UI/API.

## Getting Started

### HTML/JS Quickstart (CDN)

```html

<canvas id="three-canvas" style="width: 800px; height: 600px;"></canvas>
<script type="module">
  import {ThreeViewer, DepthBufferPlugin} from 'https://threepipe.org/dist/index.mjs'

  const viewer = new ThreeViewer({canvas: document.getElementById('three-canvas')})

  // Add some plugins 
  viewer.addPluginSync(new DepthBufferPlugin())
  
  // Load an environment map
  const envPromise = viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
  const modelPromise = viewer.load('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
    autoCenter: true,
    autoScale: true,
  })

  Promise.all([envPromise, modelPromise]).then(([env, model]) => {
    console.log('Loaded', model, env, viewer)
  })
</script>
```
Check it in action: https://threepipe.org/examples/#html-js-sample/

Check out the details about the [ThreeViewer API](#viewer-api) and more [plugins](#threepipe-plugins) below.

### React

A sample [react](https://react.dev) component in tsx to render a model with an environment map.

```tsx
import React from 'react'
function ThreeViewerComponent({src, env}: {src: string, env: string}) {
  const canvasRef = React.useRef(null)
  React.useEffect(() => {
    const viewer = new ThreeViewer({canvas: canvasRef.current})

    const envPromise = viewer.setEnvironmentMap(env)
    const modelPromise = viewer.load(src)
    Promise.all([envPromise, modelPromise])
    return () => {
      viewer.dispose()
    }
  }, [])
  return (
     <canvas id="three-canvas" style={{width: 800, height: 600}} ref={canvasRef} />
  )
}
```

Check it in action: https://threepipe.org/examples/#react-tsx-sample/

Other examples in js: https://threepipe.org/examples/#react-js-sample/ and jsx: https://threepipe.org/examples/#react-jsx-sample/

### Vue.js

A sample [vue.js](https://vuejs.org/) component in js to render a model with an environment map.

```js
const ThreeViewerComponent = {
  setup() {
    const canvasRef = ref(null);

    onMounted(() => {
      const viewer = new ThreeViewer({ canvas: canvasRef.value });

      const envPromise = viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr');
      const modelPromise = viewer.load('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf');

      Promise.all([envPromise, modelPromise])

      onBeforeUnmount(() => {
        viewer.dispose();
      });
    });

    return { canvasRef };
  },
};
```

Check it in action: https://threepipe.org/examples/#vue-html-sample/

Another example with Vue SFC(Single file component): https://threepipe.org/examples/#vue-sfc-sample/ 

### Svelte

A sample [svelte](https://svelte.dev/) component in js to render a model with an environment map.

```html
<script>
    import {onDestroy, onMount} from 'svelte';
    import {ThreeViewer} from 'threepipe'; 

    let canvasRef;
    let viewer;
    onMount(() => {
        viewer = new ThreeViewer({canvas: canvasRef});

        const envPromise = viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr');
        const modelPromise = viewer.load('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf');

        Promise.all([envPromise, modelPromise])
    });
    onDestroy(() => viewer.dispose())
</script>

<canvas bind:this={canvasRef} id="three-canvas" style="width: 800px; height: 600px"></canvas>
```

Check it in action: https://threepipe.org/examples/#svelte-sample/

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
* **Models**: gltf, glb, obj+mtl, fbx, drc
* **Materials**: mat, pmat, bmat (json based), registered material template slugs
* **Images**: webp, png, jpeg, jpg, svg, ico, avif, hdr, exr
* **Misc**: json, vjson, zip, txt

Plugins can add additional formats:
* Models
  * 3dm - Using [Rhino3dmLoadPlugin](#Rhino3dmLoadPlugin)
  * ply - Using [PLYLoadPlugin](#PLYLoadPlugin)
  * usdz - Using [USDZLoadPlugin](#USDZLoadPlugin)
  * stl - Using [STLLoadPlugin](#STLLoadPlugin)
  * ktx - Using [KTXLoadPlugin](#KTXLoadPlugin)
  * ktx2 - Using [KTX2LoadPlugin](#KTX2LoadPlugin)

Plugins to support more model formats are available in the package [@threepipe/plugins-extra-importers](#threepipeplugins-extra-importers) including .3ds,
.3mf, .collada, .amf, .bvh, .vox, .gcode, .mdd, .pcd, .tilt, .wrl, .mpd, .vtk, .xyz

## Loading files

ThreePipe uses the [AssetManager](https://threepipe.org/docs/classes/AssetManager.html) to load files.
The AssetManager has support for loading files from URLs, local files and data URLs.
The AssetManager also adds support for loading files from a zip archive. The zip files are automatically unzipped, and the files are loaded from the zip archive.

[viewer.load()](https://threepipe.org/docs/classes/ThreeViewer.html#load) is a high-level wrapper for loading files from the AssetManager.
It automatically adds the loaded object to the scene and returns a promise that resolves to the loaded object,
the materials are also automatically registered to the material manager.

AssetManager internally uses [AssetImporter](https://threepipe.org/docs/classes/AssetImporter.html),
which provides a low-level API
for managing three.js [LoadingManager](https://threejs.org/docs/#api/en/loaders/LoadingManager)
and adding and registering loaders for different file types.

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

// or use material manager to apply to multiple materials.
viewer.assetManager.materialManager.applyMaterial(pMaterial, 'METAL') // apply props to all materials/objects with the name METAL
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

To load a `Map` of files(like when multiple files are dragged and dropped on the webpage) with internal references to other files, use `viewer.assetManager.importer.importFiles` method. Check the source for [DropzonePlugin](#dropzoneplugin) for an example.

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

### Custom file types

Custom file importers/loaders can be registered to the `AssetImporter` using the `addImporter` method.

```typescript
class CustomLoader extends FileLoader implements ILoader{
    constructor(manager?: LoadingManager) {
        super(manager);
    }
    load(url: string, onLoad: (data: any) => void, onProgress?: (event: ProgressEvent) => void, onError?: (event: ErrorEvent) => void): Mesh {
      this.setResponseType('json')
      return super.load(url, (json: any)=>{
        const mat = new PhysicalMaterial(json)
        onLoad?.(mat)
      }, onProgress, onError)
    }
}

viewer.assetManager.importer.addImporter(new Importer(CustomLoader, ['ext'], ['mime/type'], false))

// load the file
const mat = await viewer.load<PhysicalMaterial>('https://example.com/file.ext')
```

## Exporting files

Threepipe has support for exporting various asset type with AssetManager,
as well as support to export viewer and plugin configuration, arbitrary objects etc using the [serialization](#serialization) system.

[viewer.export()](https://threepipe.org/docs/classes/ThreeViewer.html#export) is a high-level wrapper for exporting scene objects, materials, textures, render targets, viewer/scene configuration and plugin configurations.

AssetManager internally uses [AssetExporter](https://threepipe.org/docs/classes/AssetExporter.html) to export files.
AssetExporter includes some basic exporters for glb, exr, textures,
and materials and a system to register exporters for different file types with plugins or custom exporters.

### Exporting 3D models

Export the root scene as glb
```typescript
const blob = await viewer.exportScene({
  viewerConfig: true, // default = true. export all viewer and plugin configuration. if false only the model root object is exported.
})
// download the file
downloadBlob(blob, 'scene.glb')
```

Export a single object from the scene as glb
```typescript
const object = viewer.scene.getObjectByName('objectName');
const glb: Blob = await viewer.export(object, {
  exportExt: 'glb', // default = glb for models
  embedUrlImages: true, // default = false. embed images in glb even when url is available.
})
// download the file
downloadBlob(glb, 'object.glb')
```

Check the example [glb-export](https://threepipe.org/examples/#glb-export/) to see a demo.

### Exporting Materials

Export a material
```typescript
const material = viewer.assetManager.materialManager.findMaterialsByName('materialName')[0];
// or 
// const material = viewer.scene.getObjectByName('objectName').material;
const blob = await viewer.export(material)
// download the file
downloadBlob(blob, 'material.' + blob.ext)
```

Check the example [pmat-material-export](https://threepipe.org/examples/#pmat-material-export/) to see a demo.

### Exporting Canvas Images

Canvas Screenshot/snapshot can be exported as png, jpeg or webp(if supported by the browser)
```typescript
const blob = await viewer.getScreenshotBlob({mimeType: 'image/' + type, quality: 0.85})
// or to get data url:
// const dataUrl = await viewer.getScreenshotDataUrl({mimeType: 'image/' + type, quality: 0.85})
// download the file
downloadBlob(blob, 'screenshot.' + blob.ext)
```

Check the example [image-snapshot-export](https://threepipe.org/examples/#image-snapshot-export/) to see a demo.

### Exporting Textures

Textures can be exported to JSON using `viewer.export` or `AssetExporter`

```typescript
const texture = await viewer.load('https://example.com/file.jpeg')
const blob = await viewer.export(texture)
downloadBlob(blob, texture.name + '.' + blob.ext)
```

Render target textures can be exported with `viewer.renderManager.exportRenderTarget` or `viewer.export`,
read about [Exporting Render Targets](#exporting-render-targets) below.

TODO: add examples for texture export

Textures and Uint8 Data Textures can be exported as a data url or copied to a new canvas
```typescript
// get a base64 data url
const dataUrl = textureToDataUrl(texture, 4096, false, 'image/png') // texture or data texture, max-size, flipY, mimeType
// or copy to a new canvas
const canvas = textureToCanvas(texture, 4096) // texture or data texture, max-size
```

Data Textures of type Half float and Float can be exported with `viewer.export`
```typescript
const dataTex = await viewer.load('https://example.com/file.hdr')
const blob = await viewer.export(dataTexture, {exportExt: 'exr'})
```
Check the example [hdr-to-exr](https://threepipe.org/examples/#hdr-to-exr/) to see a demo of HDR to EXR conversion.

TODO: add support to export unsigned byte textures as png, jpeg, webp

### Exporting Images

Exporting Textures as Images with image of types ImageBitmap, HTMLImageElement,
HTMLOrSVGImageElement, CanvasImageSource, HTMLCanvasElement,
OffscreenCanvas can be exported to png data urls with [imageBitmapToBase64](https://repalash.com/ts-browser-helpers/functions/imageBitmapToBase64.html) function.

```typescript
const texture = await viewer.load('https://example.com/file.jpeg')

const dataUrl = await imageBitmapToBase64(texture.image, 'image/png', 0.85);
```

TODO: add support for texture export as images in AssetExporter

### Exporting Render Targets

Unsigned byte render targets can be exported as png, jpeg or webp(if supported by the browser)
```typescript
const depthPlugin = viewer.addPluginSync(DepthBufferPlugin, UnsignedByteType)
// wait for the first render
const blob = await viewer.export(depthPlugin.target!, {exportExt: 'png'})
if (blob) downloadBlob(blob, target.texture.name + '.' + blob.ext)
```

Half float and float render targets can be exported as exr
```typescript
const depthPlugin = viewer.addPluginSync(DepthBufferPlugin, HalfFloatType)
// wait for the first render
const blob = await viewer.export(depthPlugin.target!, {exportExt: 'exr'})
if (blob) downloadBlob(blob, target.texture.name + '.' + blob.ext)
```

Note: `exportExt` is determined automatically if not specified.

## Render pipeline

Threepipe includes a [RenderManager](https://threepipe.org/docs/classes/RenderManager.html) for managing the composition pipeline, and provides helpers for rendering and render target management.

The RenderManager includes a [EffectComposer](https://threejs.org/docs/#api/en/postprocessing/EffectComposer) from three.js for rendering passes and a [WebGLRenderer](https://threejs.org/docs/#api/en/renderers/WebGLRenderer) for rendering,
but the pass management and sorting is managed by the RenderManager itself. 

The RenderManager inherits from [RenderTargetManager](https://threepipe.org/docs/classes/RenderTargetManager.html)
which provides utilities for creating, tracking and destroying dedicated and temporary render targets.

### Render Targets

Render targets can be created
using the `viewer.renderManager.createTarget` and `viewer.renderManager.createTargetCustom` methods.
These can then be disposed using the `viewer.renderManager.disposeTarget` method when not needed anymore.

Or to create temp targets for one time use `viewer.renderManager.getTempTarget` and `viewer.renderManager.releaseTempTarget` methods. 
can be used.
All created render targets are tracked in the RenderManager,
and are resized and disposed automatically when needed along with the viewer.


```typescript
const newTarget = viewer.renderManager.createTarget({sizeMultiplier: 1})
// or
const newTarget2 = viewer.renderManager.createTarget({size: {
    width: 1024,
    height: 1024,
  },
  type: HalfFloatType
})
// or clone an existing target
const newTarget3 = viewer.renderManager.composerTarget.clone()
// for multi-sample render target
const newTarget4 = viewer.renderManager.createTarget({sizeMultiplier: 1, samples: 4})

// or create a custom target
const newTarget5 = viewer.renderManager.createTargetCustom(
    {width: 1024, height: 1024},
    {type: HalfFloatType},
    WebGLCubeRenderTarget
)

// dispose targets
viewer.renderManager.disposeTarget(newTarget)
viewer.renderManager.disposeTarget(newTarget2)
viewer.renderManager.disposeTarget(newTarget3)
viewer.renderManager.disposeTarget(newTarget4)
viewer.renderManager.disposeTarget(newTarget5)

// get a temporary target
const tempTarget = viewer.renderManager.getTempTarget({sizeMultiplier: 1})
// release the temporary target
viewer.renderManager.releaseTempTarget(tempTarget)
```

Note: Render targets created with a sizeMultiplier are automatically resized when the canvas is resized.


### Passes

By default, the render pipeline includes 2 passes -
[RenderPass](https://threejs.org/docs/#api/en/postprocessing/RenderPass) for rendering the scene hierarchy and [ScreenPass](https://threejs.org/docs/#api/en/postprocessing/ShaderPass)
 for rendering the final output on the canvas.

More passes can be added and removed from the pipeline
using the [registerPass](https://threepipe.org/docs/classes/RenderManager.html#registerPass) and [unregisterPass](https://threepipe.org/docs/classes/RenderManager.html#unregisterPass) methods.

The pipeline passes need
to follow the interface of [IPipelinePass](https://threepipe.org/docs/interfaces/IPipelinePass.html) and [IPipelinePassPlugin](https://threepipe.org/docs/interfaces/IPipelinePassPlugin.html).
Which adds some important parameters over the three.js Pass,
like pass id and support for defining where the pass should be added in the pipeline and it's dependants.

```typescript
const pass = new GBufferRenderPass('customPass', viewer.renderManager.createTarget({sizeMultiplier: 1}))
pass.before = ['render'] // Add the pass before the render pass
pass.after = [] // Add the pass after these passes (none in this case)
pass.required = ['render'] // render pass is required to be in the pipeline for this
viewer.renderManager.registerPass(pass)
```
Note:
See [PipelinePassPlugin](https://threepipe.org/docs/classes/PipelinePassPlugin.html) for an abstract plugin
that provides the boilerplate to create a plugin that registers a custom pass in the pipeline.
Check [NormalBufferPlugin](https://threepipe.org/docs/classes/NormalBufferPlugin.html) for an example of that.

Note: All effects in post-processing or material extension need not be a separate pass in the pipeline.
Most effects can be achieved with either extending the scene object material shaders or the Screen Pass material shader
using [Material extension](#material-extension) system

## Material Extension

Threepipe includes a Material extension system along with a material manager. 
The material manager is used to register materials and material extensions.

The material extensions are used to extend any material in the scene,
or any plugin/pass with additional uniforms, defines, shader snippets and provides hooks.

The material extensions are automatically applied to all materials in the scene that are compatible,
when the extension is registered or when the material is added to the scene.

Threepipe includes several built-in materials like
[PhysicalMaterial](https://threepipe.org/docs/classes/PhysicalMaterial.html),
[UnlitMaterial](https://threepipe.org/docs/classes/UnlitMaterial.html),
[ExtendedShaderMaterial](https://threepipe.org/docs/classes/ExtendedShaderMaterial.html), [LegacyPhongMaterial](https://threepipe.org/docs/classes/LegacyPhongMaterial.html),
that include support for extending the material. 
Any three.js material can be made extendable,
check the `ShaderPass2` class for a simple example that adds support for material extension to three.js ShaderPass.

The material extensions must follow the [MaterialExtension](https://threepipe.org/docs/interfaces/MaterialExtension.html) interface.
Many plugins create their own material extensions either for the scene materials or shader passes(like the screen pass).
Some plugins like `DepthBufferPlugin` also provides helper material extensions for other custom plugins
to fetch value in the depth buffer.

A sample material extension
```typescript
const extension: MaterialExtension = {
    shaderExtender: (shader)=> {
        // change the shader properties like shader.fragmentShader, etc
    },
    parsFragmentSnippet: ` // add some code before the main function in the fragment shader
    uniform sampler2D tTexture;
    uniform float opacity;
    `,
    extraUniforms: {
      tTexture: ()=>({value: getTexture()}),
      opacity: {value: 1}
      // add additional uniforms, these can be IUniform or functions that return IUniform
    },
    extraDefines: {
      ['DEPTH_PACKING']: BasicDepthPacking,
      ['SOME_DEFINE']: ()=>"1",
      // add additional defines, these can be values or functions that return values 
    },
    priority: 100, // priority when using multiple extensions on the same material
    isCompatible: (material) => material.isMeshBasicMaterial, // check if the material is compatible with this extension,
    computeCacheKey: (material) => material.uuid, // a custom cache key for the material extension. Shader is recompiled when this is changed
    onObjectRender: (object: Object3D, material: IMaterial) => {
      // called when some object is rendererd which has a material with this extension.
    },
    // uiConfig
    // check more properties and hooks in the MaterialExtension interface
}

// The extension can be registered to all the materials using the MaterialManager
viewer.assetManager.materialManager.registerMaterialExtension(extension)

// or register it on a single material (like the Screen Pass)
viewer.renderManager.screenPass.material.registerMaterialExtensions([extension])
```

## UI Configuration

Most of the classes and plugins in Threepipe include [uiconfig.js](https://repalash.com/uiconfig.js/) support
and can be used to create configuration UIs, 3d configurators and even full-editors. 
The UIs are automatically generated based on the configuration object under `.uiConfig` property on all objects.
These are of type [UiObjectConfig](https://repalash.com/uiconfig.js/interfaces/UiObjectConfig.html).
In some classes, the ui configs are also generated using typescript decorators.

The `uiConfig` is also added to all three.js objects and materials when they are added to the scene.

The UIs can be generated at runtime using any of the UI plugins like [TweakpaneUIPlugin](#threepipeplugin-tweakpane), [BlueprintJsUiPlugin](#threepipeplugin-blueprintjs)

An example showing how to create a UI for a material

```typescript
const ui = viewer.addPluginSync(TweakpaneUiPlugin)

const object = viewer.scene.getObjectByName('objectName');
const material = object.material as PhysicalMaterial;

ui.appendChild(material.uiConfig)
```

See it in action: https://threepipe.org/examples/#material-uiconfig/

Check more examples showing [Viewer UI](https://threepipe.org/examples/#viewer-uiconfig/),
[Scene UI](https://threepipe.org/examples/#scene-uiconfig/),
[Object UI](https://threepipe.org/examples/#object-uiconfig/), [Camera UI](https://threepipe.org/examples/#camera-uiconfig/)

[TweakpaneEditorPlugin](#threepipeplugin-tweakpane-editor) further uses the Tweakpane configuration panel along with various plugins to create an 3d editor.

Custom UI configuration can be created to generate custom UI for the editor or tweaking.
This can be done by using typescript decorators or defining the UI in javascript as a [UiObjectConfig](https://repalash.com/uiconfig.js/interfaces/UiObjectConfig.html) object.

Here is a sample of extending the orbit controls class with decorators to automatically generate UI.
```typescript
@uiPanelContainer('Orbit Controls')
export class OrbitControlsWithUi extends OrbitControls implements IUiConfigContainer {
  // for autocomplete
  uiConfig?: UiObjectConfig<void, 'panel'> 

  @uiToggle() enabled = true

  @uiToggle() dollyZoom = false
  @uiToggle() enableDamping = true
  @uiInput() dampingFactor = 0.08

  @uiToggle() autoRotate = false
  @uiInput() autoRotateSpeed = 2.0

  @uiToggle() enableZoom = true
  @uiInput() zoomSpeed = 0.15
  @uiInput() maxZoomSpeed = 0.20

  @uiToggle() enableRotate = true
  @uiInput() rotateSpeed = 2.0

  @uiToggle() enablePan = true
  @uiInput() panSpeed = 1.0

  @uiInput() autoPushTarget = false
  @uiInput() autoPullTarget = false
  @uiInput() minDistance = 0.35
  @uiInput() maxDistance = 1000

  @uiInput() minZoom = 0.01
  @uiInput() maxZoom = 1000

  @uiInput() minPolarAngle = 0
  @uiInput() maxPolarAngle = Math.PI

  @uiInput() minAzimuthAngle = -10000 // should be -Infinity but this breaks the UI
  @uiInput() maxAzimuthAngle = 10000

}
```

Check out the full source code:
[./src/three/controls/OrbitControls3.ts](./src/three/controls/OrbitControls3.ts) for proper implementation

See it in action: https://threepipe.org/examples/#camera-uiconfig/ Open the Camera UI and click on the Orbit Controls panel.

There are many available decorators like `uiToggle`, `uiSlider`, `uiInput`, `uiNumber`, `uiColor`, `uiImage`.
Check the complete list in the [uiconfig.js documentation](https://repalash.com/uiconfig.js/).

The UI configuration can also be created using json objects in both typescript and javascript
```javascript
const viewer = new ThreeViewer({...})

const ui = viewer.addPluginSync(TweakpaneUiPlugin)

const state = {
    position: new Vector3(),
    scale: 1,
}

ui.appendChild({
  type: 'folder',
  label: 'Custom UI',
  children: [
    {
        type: 'vec3',
        label: 'Position',
        property: [state, 'position']
    },
    {
        type: 'slider',
        label: ()=>'Scale', // everything can be a function as well.
        property: [state, 'scale'],
        bounds: [1, 2],
        stepSize: 0.1,
    }
  ]
})
```
TODO: create example/codepen for this


## Serialization

Easy serialization of all threepipe and most three.js objects are supported out of the box using the Asset Manager.
Fine control over serialization is also supported
using the [ThreeSerialization](https://threepipe.org/docs/classes/ThreeSerialization.html) class

Call `ThreeSerialization.serialize` on any object to serialize it.
and `ThreeSerialization.deserialize` to deserialize the serialized object.

This is done by performing a nested serialization of all the properties of the object.
It's possible to implement custom serializers for custom types and classes and is done for three.js primitives,
objects and plugins in threepipe

To make a custom data class that is serializable,
mark it using `@serializable` decorator and any properties using `@serialize` decorator.
```typescript
@serializable('DataClass')
class DataClass{
    @serialize() prop1 = 1
    @serialize() prop2 = 'string'
    @serialize() prop3 = new Vector3()
    @serialize() prop4 = new PhysicalMaterial()
    @serialize() prop4 = {
        prop1: 1,
        prop2: 'string',
        prop3: new Vector3(),
        prop4: new PhysicalMaterial(),
    }
}

const data = new DataClass()
const serialized = ThreeSerialization.serialize(data)
const deserialized = ThreeSerialization.deserialize(serialized)
```

The classes without a `@serializable` decorator are serialized as plain objects.
These can still include `@serialize` decorator to mark the properties are serializable
but these classes cannot be deserialized into a new instance of the class.
The ThreeViewer and plugins are an example of these.
When deserialized they need an object to deserialize into.
This ensures there is always just one instance.
With this, the serialization system works like `toJSON` and `fromJSON` methods in three.js.

Check the [plugin system](#plugin-system) below for more details on how to mark properties as serializable for plugins.

```typescript
class CustomClass{
    @serialize() prop1 = 1
    @serialize() prop2 = 'string'
    @serialize() prop3 = new Vector3()
    @serialize() prop4 = new PhysicalMaterial()
}
const obj = new DataClass()
const serialized = ThreeSerialization.serialize(data)
// now to deserialize we need to pass in the object to deserialize into
ThreeSerialization.deserialize(serialized, obj)
```

## Plugin System

Threepipe includes a plugin system for adding additional features to the viewer in a modular way.
The plugins can be added synchronously or asynchronously using `viewer.addPluginSync` and `viewer.addPlugin` methods respectively.

It is recommended to create custom plugins for reusable features,
as they provide built-in features for ui configuration,
serialization, integration with editors etc and are easy to manage and tree-shake in the code.

Check out the list of plugins in the [Plugin List](#threepipe-plugins) section below.

To create new plugins,
simply implement the `IViewerPlugin` interface or extend the [AViewerPluginSync](https://threepipe.org/docs/classes/AViewerPluginSync.html) or [AViewerPluginAsync](https://threepipe.org/docs/classes/AViewerPluginAsync.html) classes.
The only difference is that in async the `onAdded` and `onRemove` functions are async

Here is a sample plugin
```typescript
@uiFolder("Sample Plugin") // This creates a folder in the Ui. (Supported by TweakpaneUiPlugin)
export class SamplePlugin extends AViewerPluginSync<"sample-1" | "sample-2"> {
  // These are the list of events that this plugin can dispatch.
  static readonly PluginType = "SamplePlugin"; // This is required for serialization and handling plugins. Also used in viewer.getPluginByType()

  @uiToggle() // This creates a checkbox in the Ui. (Supported by TweakpaneUiPlugin)
  @serialize() // Adds this property to the list of serializable. This is also used when serializing to glb in AssetExporter.
  enabled = true;

  // A plugin can have custom properties.

  @uiSlider("Some Number", [0, 100], 1) // Adds a slider to the Ui, with custom bounds and step size (Supported by TweakpaneUiPlugin)
  @serialize("someNumber")
  @onChange(SamplePlugin.prototype._updateParams) // this function will be called whenevr this value changes.
  val1 = 0;

  // A plugin can have custom properties.
  @uiInput("Some Text") // Adds a slider to the Ui, with custom bounds and step size (Supported by TweakpaneUiPlugin)
  @onChange(SamplePlugin.prototype._updateParams) // this function will be called whenevr this value changes.
  @serialize()
  val2 = "Hello";

  @uiButton("Print Counters") // Adds a button to the Ui. (Supported by TweakpaneUiPlugin)
  public printValues = () => {
    console.log(this.val1, this.val2);
    this.dispatchEvent({ type: "sample-1", detail: { sample: this.val1 } }); // This will dispatch an event.
  }

  constructor() {
    super();
    this._updateParams = this._updateParams.bind(this);
  }

  private _updateParams() {
    console.log("Parameters updated.");
    this.dispatchEvent({ type: "sample-2" }); // This will dispatch an event.
  }

  onAdded(v: ThreeViewer): void {
    super.onAdded(v);

    // Do some initialization here.
    this.val1 = 0;
    this.val2 = "Hello";

    v.addEventListener("preRender", this._preRender);
    v.addEventListener("postRender", this._postRender);
    v.addEventListener("preFrame", this._preFrame);
    v.addEventListener("postFrame", this._postFrame);

    this._viewer!.scene.addEventListener("addSceneObject", this._objectAdded); // this._viewer can also be used while this plugin is attached.
  }

  onRemove(v: ThreeViewer): void {
    // remove dispose objects

    v.removeEventListener("preRender", this._preRender);
    v.removeEventListener("postRender", this._postRender);
    v.removeEventListener("preFrame", this._preFrame);
    v.removeEventListener("postFrame", this._postFrame);

    this._viewer!.scene.removeEventListener("addSceneObject", this._objectAdded); // this._viewer can also be used while this plugin is attached.

    super.onRemove(v);
  }

  private _objectAdded = (ev: IEvent<any>) => {
    console.log("A new object, texture or material is added to the scene.", ev.object);
  };
  private _preFrame = (ev: IEvent<any>) => {
    // This function will be called before each frame. This is called even if the viewer is not dirty, so it's a good place to do viewer.setDirty()
  };
  private _preRender = (ev: IEvent<any>) => {
    // This is called before each frame is rendered, only when the viewer is dirty.
  };
  // postFrame and postRender work the same way as preFrame and preRender.
}
```

Notes:
* All plugins that are present in the dependencies array when the plugin is added to the viewer, are created and attached to the viewer in `super.onAdded`
* Custom events can be dispatched with `this.dispatchEvent`, and subscribed to with `plugin.addEventListener`. The event type must be described in the class signature for typescript autocomplete to work.
* Event listeners and other hooks can be added and removed in `onAdded` and `onRemove` functions for the viewer and other plugins.
* To the viewer render the next frame, `viewer.setDirty()` can be called, or set `this.dirty = true` in preFrame and reset in postFrame to stop the rendering. (Note that rendering may continue if some other plugin sets the viewer dirty like `ProgressivePlugin` or any of the animation plugins). Check `isConverged` in `ProgressivePlugin` to check if its the final frame.
* All Plugins which inherit from AViewerPlugin support serialisation. Create property `serializeWithViewer = false` to disable serialisation with the viewer in config and glb or `toJSON: any = undefined` to disable serialisation entirely
* `plugin.toJSON()` and `plugin.fromJSON()` or `ThreeSerialization` can be used to serialize and deserialize plugins. `viewer.exportPluginConfig` and `viewer.importPluginConfig` also exist for this.
* @serialize('label') decorator can be used to mark any public/private variable as serializable. label (optional) corresponds to the key in JSON.
* @serialize supports instances of ITexture, IMaterial, all primitive types, simple JS objects, three.js math classes(Vector2, Vector3, Matrix3...), and some more.
* uiDecorators can be used to mark properties and functions that will be shown in the Ui. The Ui shows up automatically when TweakpaneUiPlugin/BlueprintJsUiPlugin is added to the viewer. Plugins have special features in the UI for download preset and saving state.

Check various plugins in the source code for more examples.

# Viewer API

[ThreeViewer](https://threepipe.org/docs/classes/ThreeViewer.html) - is the main entry point to 3d rendering on the canvas.
  - `.renderManager`: [ViewerRenderManager](https://threepipe.org/docs/classes/ViewerRenderManager.html) & [RenderManager](https://threepipe.org/docs/classes/RenderManager.html) & [RenderTargetManager](https://threepipe.org/docs/classes/RenderTargetManager.html) - Render manager for managing the rendering and composition pipeline, and provides helpers for rendering and render target management
    - `.renderer`: [IWebGLRenderer](https://threepipe.org/docs/interfaces/IWebGLRenderer.html) - for rendering. Instance of three.js [WebGLRenderer](https://threejs.org/docs/#api/en/renderers/WebGLRenderer)
    - `.composer`: [EffectComposer2](https://threepipe.org/docs/classes/EffectComposer2.html) - for rendering passes. Instance of three.js [EffectComposer](https://threejs.org/docs/#api/en/postprocessing/EffectComposer)
    - `.context`: [WebGLRenderingContext](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext) - WebGL rendering context
    - `.renderPass`: [ExtendedRenderPass](https://threepipe.org/docs/classes/ExtendedRenderPass.html) - Render pass for rendering the scene. Instance of three.js [RenderPass](https://threejs.org/docs/#api/en/postprocessing/RenderPass) with extra features
    - `.screenPass`: [ScreenPass](https://threepipe.org/docs/classes/ScreenPass.html) - Screen pass for rendering the final output. Instance of three.js [ShaderPass](https://threejs.org/docs/#api/en/postprocessing/ShaderPass) with extra features.
  - `.scene`: [RootScene](https://threepipe.org/docs/classes/RootScene.html) - Main scene used for rendering. Instance of three.js [Scene](https://threejs.org/docs/#api/en/scenes/Scene) 
    - `.mainCamera`: [PerspectiveCamera2](https://threepipe.org/docs/classes/PerspectiveCamera2.html) - Main camera currently being used for rendering. Instance of three.js [PerspectiveCamera](https://threejs.org/docs/#api/en/cameras/PerspectiveCamera) 
  - `.assetManager`: [AssetManager](https://threepipe.org/docs/classes/AssetManager.html) - Asset manager for loading, managing and exporting assets
    - `.importer`: [AssetImporter](https://threepipe.org/docs/classes/AssetImporter.html) - for importing assets
    - `.exporter`: [AssetExporter](https://threepipe.org/docs/classes/AssetExporter.html) - for exporting assets
    - `.materialManager`: [MaterialManager](https://threepipe.org/docs/classes/MaterialManager.html) - for managing materials and material extensions
  - `.plugins`: `Record`<`string`, [IViewerPlugin](https://threepipe.org/docs/interfaces/IViewerPlugin.html)> - Plugins added to the viewer
  - `.uiConfig`: [UiObjectConfig](https://repalash.com/uiconfig.js/interfaces/UiObjectConfig.html) - UI confguration for the viewer. Used to automatically generate UIs for the viewer and plugins.

## ThreeViewer

Source Code: [src/viewer/ThreeViewer.ts](./src/viewer/ThreeViewer.ts)

API Reference: [ThreeViewer](https://threepipe.org/docs/classes/ThreeViewer.html)

`ThreeViewer` is the main entry point to the viewer. It provides all the API for managing the scene, camera, rendering, plugins, etc.

It is initialized with either a canvas element or a `HTMLElement` for the container.
The canvas element is used for rendering, and the options are used to configure the viewer.
If the canvas element is not provided, a new canvas element is created and appended to the container.

More options can be passed in the constructor to configure various built-in plugins and rendering features in the viewer.

### Constructor

```typescript
import {ThreeViewer, CameraViewPlugin} from 'threepipe'

// Create a viewer. All options except canvas/container are optional
const viewer = new ThreeViewer({
  canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
  // or a container like: 
  // container: document.getElementById('mcontainer'),
  // container: document.body,

  // Set the render scale to render at device resolution
  renderScale: window.devicePixelRatio,
  // modify the screen shader: See ScreenPass and ScreenPass.glsl for more details
  screenShader: `diffuseColor = diffuseColor * 2.0;`,
  // Add TonemapPlugin
  tonemap: true,
  // Use MSAA(anti-aliasing)
  msaa: false,
  // Use Uint8 RGBM HDR Render Pipeline. Provides better performance with post-processing. RenderManager Uses Half-float if set to false. 
  rgbm: true,
  // Use rendered gbuffer as depth-prepass / z-prepass.
  zPrepass: false,

  // Options for AssetManager
  assetManager: {
      // Use a custom CacheStorage
      storage: caches.open('threepipe-assetmanager'),
  },

  // Use DropzonePlugin to add support for file drag and drop
  // Enable and set properties
  dropzone: {
    // Set allowed extensions
    allowedExtensions: ['png', 'glb', 'gltf'],
    // Automatically add downloaded assets
    autoAdd: true
    // autoImport: true,
    // domElement: document.body,
    // addOptions: { ... }
    // importOptions: { ... }
  },
  // By default its false
  // dropzone: false,
  // To Enable without options
  // dropzone: true
  
  // Add some plugins after viewer creation.
  plugins: [CameraViewPlugin, new CustomPlugin()],
  
  // Shorthand to load files immediately after viewer initialization
  load: {
      src: 'https://example.com/file.glb',
      environment: 'https://example.com/file.hdr',
      background: 'https://example.com/file.png',
  },
  onLoad: (viewer) => {
      // Called when all the files are loaded
  },
})
```

Check the interface [ThreeViewerOptions](https://threepipe.org/docs/interfaces/ThreeViewerOptions.html) for all the options.

To dispose off the viewer and all its resources call [`viewer.dispose()`](https://threepipe.org/docs/classes/ThreeViewer.html#dispose) method.

To dispose only the scene objects and not the complete viewer, use `viewer.scene.disposeSceneModels()`

### Plugin Functions

```typescript
import {ThreeViewer, TonemapPlugin, DepthBufferPlugin, NormalBufferPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

// Add a plugin
const plugin = viewer.addPluginSync(new TonemapPlugin())
// plugins can be added with just the class also
const plugin2 = viewer.addPluginSync(TonemapPlugin)

// Add multiple plugins at once
viewer.addPluginsSync([
  TonemapPlugin,
  new NormalBufferPlugin(),
  DepthBufferPlugin,
  //  ...
])

// Get a plugin
const plugin3 = viewer.getPlugin(TonemapPlugin)
        
// Get or add a plugin, when not sure if the plugin is already added
const plugin4 = viewer.getOrAddPluginSync(TonemapPlugin)

// Remove a plugin
viewer.removePluginSync(TonemapPlugin)

```

Note: all sync functions above have async counterparts like `addPlugin`, `getOrAddPlugin`,
`removePlugin` that are used for async plugins.
There are no async plugins built-in to threepipe yet.

### Import/Export Functions

```typescript
import {ThreeViewer} from 'threepipe'

const viewer = new ThreeViewer({...})

// Load a 3d model
const object = await viewer.load<IObject3D>('https://example.com/file.glb')

// Load a material
const material = await viewer.load<PhysicalMaterial>('https://example.com/file.pmat')

// Load an image
const texture = await viewer.load<ITexture>('https://example.com/file.png')

// Import a model without adding to the scene
const imported = await viewer.import('https://example.com/file.glb')

// Export the complete scene with viewer configuraion
const exportedScene = await viewer.exportScene({})

// Export an object
const exported = await viewer.export(object)

// Export a material
const exportedMaterial = await viewer.export(material)

// Export a texture
const exportedTexture = await viewer.export(texture)

// Export viewer and plugins configurations
const exportedConfig = await viewer.export(viewer)

// Export plugin configuration
const exportedPlugin = await viewer.exportPlugin(viewer.getPlugin(PluginClass))

// Set Background Image
await viewer.setBackgroundMap('https://example.com/file.png')

// Set Environment Map
await viewer.setEnvironmentMap('https://example.com/file.hdr')

// Add an imported object or a created three.js object to the scene
viewer.addSceneObject(imported)
```

[`viewer.load`](https://threepipe.org/docs/classes/ThreeViewer.html#load) - Loads a single asset by path or [IAsset](https://threepipe.org/docs/interfaces/IAsset.html) object, and adds to the scene if its 3d object or loads it if it's a configuration It is the same as [AssetManager.addAssetSingle](https://threepipe.org/docs/classes/AssetManager.html#addAssetSingle). Use [AssetManager.addAsset](https://threepipe.org/docs/classes/AssetManager.html#addAsset) to load multiple assets from the same path like in case of zip bundles.

[`viewer.import`](https://threepipe.org/docs/classes/ThreeViewer.html#import) - Load a single asset but does not add to the scene or load the configuration. It is the same as [AssetManager.importer.importSingle](https://threepipe.org/docs/classes/AssetImporter.html#importSingle). Use [AssetManager.importer.import](https://threepipe.org/docs/classes/AssetImporter.html#import) to import multiple assets from the same path like in case of zip bundles.

[`viewer.export`](https://threepipe.org/docs/classes/ThreeViewer.html#export) - Exports an object, material, texture, render target or plugin configuration and returns a Blob. It is similar to [AssetManager.exporter.exportObject](https://threepipe.org/docs/classes/AssetExporter.html#exportObject) but adds support for exporting plugin and self(viewer) configs. 

[`viewer.exportScene`](https://threepipe.org/docs/classes/ThreeViewer.html#exportScene) - Exports the scene model root and all configurations into a bundled `glb` file and returns a blob.

[`viewer.exportPlugin`](https://threepipe.org/docs/classes/ThreeViewer.html#exportPlugin) - Exports a plugin configuration and returns a blob.

[`viewer.setBackgroundMap`](https://threepipe.org/docs/classes/ThreeViewer.html#setBackgroundMap) - Sets the background map to the given texture or url. Also sets it as environment map if `setEnvironment` is `true` in the options.

[`viewer.setEnvironmentMap`](https://threepipe.org/docs/classes/ThreeViewer.html#setEnvironmentMap) - Sets the environment map to the given texture or url. Also sets it as background if `setBackground` is `true` in the options.

[`viewer.addSceneObject`](https://threepipe.org/docs/classes/ThreeViewer.html#addSceneObject) - Adds an imported object or a created three.js object to the scene model root. If an imported scene model root is passed, it will be loaded with viewer configuration, unless `importConfig` is `false` in the options.

### Frame/Rendering Events

```typescript
import {ThreeViewer} from 'threepipe'

const viewer = new ThreeViewer({...})

// Add a callback to be called before every frame, irrespective of whether enything is being rendered that frame
viewer.addEventListener('preFrame', (ev)=>{
    console.log(ev);
    // change something 
    viewer.setDirty() // let the viewer know to re-render the scene from this frame
})

// Add a callback to be called after every frame, irrespective of whether enything was rendered that frame
viewer.addEventListener('postFrame', (ev)=>{
    console.log(ev);
    // change something 
    viewer.setDirty() // let the viewer know to re-render the scene from next frame
})

// Add a callback to be called before every render, only if something is being rendered that frame
viewer.addEventListener('preRender', (ev)=>{
    // canvas is about to be rendered, or re-rendered for progressive rendering
    console.log(ev, viewer.renderManager.frameCount);
})

// Add a callback to be called after every render, only if something was rendered that frame
viewer.addEventListener('postRender', (ev)=>{
    // canvas is rendered, or re-rendered for progressive rendering
    console.log(ev);
})

// Listen to viewer.setDirty() calls 
viewer.addEventListener('update', (ev)=>{
    // viewer.setDirty() was called by some plugin or code
    console.log(ev);
})

// to remove an event listener, first keep a reference to the callback
const callback = (ev)=>{ return }
viewer.addEventListener('preFrame', callback)
// then remove it
viewer.removeEventListener('preFrame', callback)

// Add a callback to be called only once for an event
viewer.doOnce('postFrame', () => viewer.canvas.toDataURL('image/png'))

// Enable/disable rendering in the viewer
viewer.renderEnabled = false
// do something with the canvas or load assets 
await viewer.load('https://example.com/file.glb')
await viewer.load('https://example.com/file1.glb')
await viewer.load('https://example.com/file2.glb')
viewer.renderEnabled = true // all the assets will be rendered together in the next frame

```

Check the [IViewerEvent](https://threepipe.org/docs/interfaces/IViewerEvent.html) interface for all the event types.

[`viewer.addEventListener`](https://threepipe.org/docs/classes/ThreeViewer.html#addEventListener) - Adds a callback to be called on the given event. The callback is called with an [IViewerEvent](https://threepipe.org/docs/interfaces/IViewerEvent.html) object.

[`viewer.removeEventListener`](https://threepipe.org/docs/classes/ThreeViewer.html#removeEventListener) - Removes a callback from the given event.

[`viewer.doOnce`](https://threepipe.org/docs/classes/ThreeViewer.html#doOnce) - Adds a callback to be called only once for the given event. The listener will be added and automatically removed after the first call.

### Utility Functions

```typescript
import {ThreeViewer} from 'threepipe'

const viewer = new ThreeViewer({...})

// Set size
viewer.setSize({width: 800, height: 600})

// Traverse scene objects
viewer.traverseSceneObjects((object) => {
    console.log(object)
  // do something with object
})

// If the size is set by css or manually by javascript use `resize` to update the viewer
viewer.resize()

// Trigger re-render with `setDirty` when something changes and viewer is not notified internally
viewer.setDirty()

// Get snapshot of the canvas as a blob 
const blob = await viewer.getScreenshotBlob({mimeTye: 'image/png', quality: 90})

// Get snapshot of the canvas as a data url
const dataUrl = await viewer.getScreenshotDataUrl({mimeTye: 'image/jpeg', quality: 85})

// Dispose viewer and all resources
viewer.canvas.remove() // canvas needs to be removed separately from the DOM
viewer.dispose()

```

[`viewer.setSize`](https://threepipe.org/docs/classes/ThreeViewer.html#setSize) - Sets the size of the canvas and updates the renderer and the camera. If no width/height is passed, canvas is set to 100% of the container.

[`viewer.traverseSceneObjects`](https://threepipe.org/docs/classes/ThreeViewer.html#traverseSceneObjects) - Loop through all the objects in the scene model root hierarchy and calls the callback function with each object.

[`viewer.resize`](https://threepipe.org/docs/classes/ThreeViewer.html#resize) - Mark that the canvas is resized. If the size is changed, the renderer and all render targets are resized.

[`viewer.setDirty`](https://threepipe.org/docs/classes/ThreeViewer.html#setDirty) - Triggers re-render on next `requestAnimationFrame` call.

[`viewer.getScreenshotBlob`](https://threepipe.org/docs/classes/ThreeViewer.html#getScreenshotBlob) - Returns a blob of the canvas screenshot. The blob can be used to download the screenshot or upload to a server.

[`viewer.getScreenshotDataUrl`](https://threepipe.org/docs/classes/ThreeViewer.html#getScreenshotDataUrl) - Returns a data url of the canvas screenshot. The data url can be used to display the screenshot in an image element.

[`viewer.dispose`](https://threepipe.org/docs/classes/ThreeViewer.html#dispose) - Disposes the viewer and all its resources. Use this to dispose the viewer when it is no longer needed. Note: the canvas element is not removed from the DOM and needs to be removed separately.

## RenderManager

Source Code: [src/viewer/ViewerRenderManager.ts](./src/viewer/ViewerRenderManager.ts), [src/rendering/RenderManager.ts](./src/rendering/RenderManager.ts), [src/rendering/RenderTargetManager.ts](./src/rendering/RenderTargetManager.ts)

API Reference: [ViewerRenderManager](https://threepipe.org/docs/classes/ViewerRenderManager.html), [RenderManager](https://threepipe.org/docs/classes/RenderManager.html), [RenderTargetManager](https://threepipe.org/docs/classes/RenderTargetManager.html)

It manages the rendering, composition/postprocessing of the scene and provides helpers for rendering and render target management.

```typescript
const viewer = new ThreeViewer({...})

const renderManager = viewer.renderManager

// Get the effect composer
const composer = renderManager.composer

// Get the three.js webgl renderer
const renderer = renderManager.renderer

// Get the main Render Pass in the pipeline
const renderPass = renderManager.renderPass

// Get the main Screen Pass in the pipeline
const screenPass = renderManager.screenPass

// Set the render scale
renderManager.renderScale = Math.min(window.devicePixelRatio, 2)

// Register a custom composer pass
const customPass: IPipelinePass = new CustomPass()
renderManager.registerPass(customPass)

// Unregister a custom composer pass
renderManager.unregisterPass(customPass)

// The pipeline is automatically created and sorted based on dependencies in pipeline pass. 
// To check the built pipeline
console.log(renderManager.pipeline)

// Set a custom render pipeline 
renderManager.autoBuildPipeline = false
renderManager.pipeline = ['depth', 'render', 'screen']

// Check the total frames rendererd
console.log(renderManager.totalFrameCount)

// Get the current frame count in progressive rendering
console.log(renderManager.frameCount)

// Force reset shadows when some object is moved
renderManager.resetShadows()

// Render Target Management

// Get the main composer target
const composerTarget = renderManager.composerTarget
// clone the target to get a copy of the target with all the default options
const clonedTarget = composeTarget.clone()

// Create a render target, same size as the canvas. The target are automatically resized when the canvas is resized
const renderTarget = renderManager.createTarget({
  sizeMultiplier: 1, // size multiplier from the canvas. 0.5 will be half width and height of the canvas
  type: UnsignedByteType,
  // ... // See CreateRenderTargetOptions for all options
})

// Create a render target of custom size
const renderTarget = renderManager.createTarget({
  size: {
    width: 1024,
    height: 1024,
  },
  type: HalfFloatType,
  // ...
})

// Dispose the render target
renderManager.disposeTarget(renderTarget)

// Create and release temporary targets for in-pass rendering.
const tempTarget = renderManager.getTempTarget({
  sizeMultiplier: 0.5,
  type: HalfFloatType,
  // ...
})
// do something
renderManager.releaseTempTarget(tempTarget)

// Set how many temporary targets can remain in memory for a specific set of options
renderManager.maxTempPerKey = 10 // default = 5

// Copy/Blit a texture to the canvas or another render target with standard or a custom material
renderManager.blit(destination, {source: sourceTexture})

// Clear color of the canvas
renderManager.clearColor({r: 0, g: 0, b: 0, a: 1, depth: true, viewport: new Vector4(...)})

// Clear of a render target
renderManager.clearColor(renderTarget, {r: 0, g: 0, b: 0, a: 1, target: renderTarget})

// Export a render target to a blob. The type is automatically picked from exr to png based on the render target
const blob = renderManager.exportRenderTarget(renderTarget, 'auto')

// Export a render target to png/jpeg data url. This will clamp any floating point targets to fit in png/jpeg
const dataUrl = renderManager.renderTargetToDataUrl(renderTarget, 'image/png')

// Read render target pixels to array buffer. Returns Uint8Array|Uint16Array|Float32Array based on the render target type
const buffer = renderManager.renderTargetToBuffer(renderTarget)

```

[`renderManager.composer`](https://threepipe.org/docs/classes/ViewerRenderManager.html#composer) - The three.js [EffectComposer](https://threejs.org/docs/#api/en/postprocessing/EffectComposer) used for rendering the pipeline.

[`renderManager.renderer`](https://threepipe.org/docs/classes/ViewerRenderManager.html#renderer) - The three.js [WebGLRenderer](https://threejs.org/docs/#api/en/renderers/WebGLRenderer) used for rendering

[`renderManager.context`](https://threepipe.org/docs/classes/ViewerRenderManager.html#context) - Access  the WebGL rendering context for the canvas.

[`renderManager.renderPass`](https://threepipe.org/docs/classes/ViewerRenderManager.html#renderPass) - The main render pass used in the render pipeline. Instance of three.js [RenderPass](https://threejs.org/docs/#api/en/postprocessing/RenderPass) with extra features like z prepass, rgbm rendering, blurred transmission, msaa and other optimizations.

[`renderManager.screenPass`](https://threepipe.org/docs/classes/ViewerRenderManager.html#screenPass) - The main screen pass used in the render pipeline. Instance of three.js [ShaderPass](https://threejs.org/docs/#api/en/postprocessing/ShaderPass) with extra features like material extension, custom fragment, overriding read buffer, re-render to screen on change, etc

[`renderManager.renderScale`](https://threepipe.org/docs/classes/RenderManager.html#renderScale) - Sets the render scale. All targets are scaled by this factor. This is equivalent to calling `EffectComposer.setPixelRatio` and `WebGLRenderer.setPixelRatio` in three.js.

[`renderManager.resetShadows`](https://threepipe.org/docs/classes/RenderManager.html#resetShadows) - Resets all shadow maps in the scene. This is useful when some object is moved and the shadows need to be updated. This is automatically called when `scene.setDirty` or any `object.setDirty` is called, and during animation with plugins.

### Rendering Pipeline

[`renderManager.registerPass`](https://threepipe.org/docs/classes/RenderManager.html#registerPass) - Registers a custom composer pass to the render pipeline. See [IPipelinePass](https://threepipe.org/docs/interfaces/IPipelinePass.html) interface.

[`renderManager.unregisterPass`](https://threepipe.org/docs/classes/RenderManager.html#unregisterPass) - Unregisters a custom composer pass from the render pipeline.

[`renderManager.pipeline`](https://threepipe.org/docs/classes/RenderManager.html#pipeline) - The render pipeline array. The array is automatically sorted based on dependencies in the pipeline passes.

[`renderManager.autoBuildPipeline`](https://threepipe.org/docs/classes/RenderManager.html#autoBuildPipeline) - If `true`, the pipeline is automatically created and sorted based on dependencies in pipeline pass. If `false`, the pipeline is built only once and is not changed after that. The default value is `true`.

[`renderManager.totalFrameCount`](https://threepipe.org/docs/classes/RenderManager.html#totalFrameCount) - The total frames rendered since the render manager was created.

[`renderManager.frameCount`](https://threepipe.org/docs/classes/RenderManager.html#frameCount) - The current frame count in progressive rendering. This is useful for progressive rendering effects like progressive shadows, gi, denoising, baking, anti-aliasing, and many other effects.

### Render Targets management

[`renderManager.composerTarget`](https://threepipe.org/docs/classes/RenderManager.html#composerTarget), [`renderManager.composerTarget1`](https://threepipe.org/docs/classes/RenderManager.html#composerTarget1) - The main targets used in [EffectComposer2](https://threepipe.org/docs/classes/EffectComposer2)

[`renderManager.createTarget`](https://threepipe.org/docs/classes/RenderTargetManager.html#createTarget) - Creates a render target with the given options. The render target is automatically resized when the canvas is resized if `sizeMultiplier` is used. See [CreateRenderTargetOptions](https://threepipe.org/docs/interfaces/CreateRenderTargetOptions.html) for options

[`renderManager.disposeTarget`](https://threepipe.org/docs/classes/RenderTargetManager.html#disposeTarget) - Disposes a render target and removes it from the render target manager.

[`renderManager.getTempTarget`](https://threepipe.org/docs/classes/RenderTargetManager.html#getTempTarget) - Gets a temporary render target with the given options. The render target is automatically resized when the canvas is resized if `sizeMultiplier` is used. See [CreateRenderTargetOptions](https://threepipe.org/docs/interfaces/CreateRenderTargetOptions.html) for options

[`renderManager.releaseTempTarget`](https://threepipe.org/docs/classes/RenderTargetManager.html#releaseTempTarget) - Releases a temporary render target and adds it back to the render target manager.

[`renderManager.maxTempPerKey`](https://threepipe.org/docs/classes/RenderTargetManager.html#maxTempPerKey) - Sets how many temporary targets can remain in memory for a specific set of options. The default value is `5`.

### Helpers

[`renderManager.blit`](https://threepipe.org/docs/classes/RenderManager.html#blit) - Blits a texture to the canvas or another render target with standard or a custom material. See [RendererBlitOptions](https://threepipe.org/docs/interfaces/RendererBlitOptions.html) for options.

[`renderManager.clearColor`](https://threepipe.org/docs/classes/RenderManager.html#clearColor) - Clears the color of the canvas or a render target.

[`renderManager.exportRenderTarget`](https://threepipe.org/docs/classes/RenderManager.html#exportRenderTarget) - Exports a render target to a blob. The type is automatically picked from exr to png based on the render target.

[`renderManager.renderTargetToDataUrl`](https://threepipe.org/docs/classes/RenderManager.html#renderTargetToDataUrl) - Exports a render target to png/jpeg data url string. This will clamp any floating point targets to fit in png/jpeg. See [RenderTargetToDataUrlOptions](https://threepipe.org/docs/interfaces/RenderTargetToDataUrlOptions.html) for options.

[`renderManager.renderTargetToBuffer`](https://threepipe.org/docs/classes/RenderManager.html#renderTargetToBuffer) - Reads render target pixels to a Uint8Array|Uint16Array|Float32Array array buffer.

## RootScene

Source Code: [src/core/object/RootScene.ts](./src/core/object/RootScene.ts)

API Reference: [RootScene](https://threepipe.org/docs/classes/RootScene.html)

RootScene is the main scene that is rendered in the canvas.
It is an instance of three.js [Scene](https://threejs.org/docs/#api/en/scenes/Scene) with extra features including separation between model root and others,
backgroundColor, background map and background intensity,
environment map rotation and intensity, fixed env map direction patch, event bubbling in the scene hierarchy, scene config serialization, main camera management,
automatic active near far management based on scene bounds, disposing complete scene hierarchy, etc

```typescript

const viewer = new ThreeViewer({...})

const scene = viewer.scene

// List oll loaded objects in the model root
console.log(scene.modelRoot.children)

// Set the background color
scene.setBackgroundColor('#ffffff')
// or 
// scene.backgroundColor = new Color('#ffffff')
// or
// scene.backgroundColor.set('#ffffff')
// scene.onBackgroundChange() // this must be called when not using a setter or set function.

// Set a texture as background (or use viewer.setBackgroundMap). When both color and texture are set, they are multiplied
scene.background = customTexture

// Set the background same as the environment map
scene.background = 'environment' // background is automatically changed when the environment changes.
// or
// scene.background = scene.environment

// Set the background intensity
scene.backgroundIntensity = 2

// Set a texture as environment map (or use viewer.setEnvironmentMap)
scene.environment = customTexture

// Set the environment intensity
scene.envMapIntensity = 2

// Set the environment map rotation
scene.environment.rotation = Math.PI / 2

// Set Fixed env direction (rotate environment according the the camera)
scene.fixedEnvMapDirection = true

// Get the main camera used for rendering
const camera: PerspectiveCamera2 = scene.mainCamera
// Set camera props
camera.position.set(0, 0, 10)
camera.target.set(0, 0, 0)
camera.setDirty() // this needs to be called to notify the viewer to re-render the scene

// Traverse the model root hierarchy (or just use viewer.traverseSceneObjects)
scene.modelRoot.traverse((object) => {
  console.log(object)
  // do something with object
})

// Access the default camera (same as mainCamera if not changed explicitly)
const defaultCamera: ICamera = scene.defaultCamera

// Dispose all assets in the modelRoot
scene.disposeSceneModels()

// Remove all objects from the modelRoot
scene.clearSceneModels()

// Dispose the scene and all its resources and children
scene.dispose()

// Get bounds of the scene model root
const bounds = scene.getBounds(true, true) // true for precise bounds and ignore invisible 

// Add an object to the scene or its model root depending on the options (or just use viewer.addSceneObject)
scene.addObject(object, {addToRoot: false}) // adds to the scene directly when addToRoot is true

// Load an imported model root from the asset importer
scene.loadModelRoot(object)

// notify that something has changed in the scene for re-render
scene.setDirty()

// notify that some object has changed in the scene for scene refresh(like shadow refresh, ground etc) and re-render
scene.refreshScene()
// or 
scene.setDirty({refreshScene: true})

// set geometryChanged: false to prevent shadow recompute
scene.refreshScene({geometryChanged: false})

// refresh active near far. (in most cases this is done automatically and need not be called)
scene.refreshActiveNearFar()
```

[`scene.modelRoot`](https://threepipe.org/docs/classes/RootScene.html#modelRoot) - The root object. All the objects loaded in the viewer are added to this object. And this is exported when exporting the gltf. Everything else like meta or UI objects can be added outside this.

[`scene.backgroundColor`](https://threepipe.org/docs/classes/RootScene.html#backgroundColor) - The background color of the scene. Can be a `Color | null`. This is not the same as `scene.background`. When both backgroundColor and background are set, they are multiplied. 

[`scene.background`](https://threepipe.org/docs/classes/RootScene.html#background) - The background of the scene. This is the same as `scene.background` in three.js. This can be a texture or a color or null, but it's preferred to use `scene.backgroundColor` for color, and this for texture, then both can be used together.

[`scene.setBackgroundColor`](https://threepipe.org/docs/classes/RootScene.html#setBackgroundColor) - Set the background color from a string, number or color. Same as setting `backgroundColor` to a new color value.

[`scene.backgroundIntensity`](https://threepipe.org/docs/classes/RootScene.html#backgroundIntensity) - The background intensity of the scene. This is the same as `scene.backgroundIntensity` in three.js.

[`scene.environment`](https://threepipe.org/docs/classes/RootScene.html#environment) - The environment map of the scene. This is the same as `scene.environment` in three.js.

`scene.environment.rotation` - The rotation of the environment map around the y-axis.

[`scene.envMapIntensity`](https://threepipe.org/docs/classes/RootScene.html#envMapIntensity) - The environment intensity of the scene.

[`scene.fixedEnvMapDirection`](https://threepipe.org/docs/classes/RootScene.html#fixedEnvMapDirection) - If `true`, the environment map is rotated according to the camera. This is the same as `scene.fixedEnvMapDirection` in three.js.

[`scene.mainCamera`](https://threepipe.org/docs/classes/RootScene.html#mainCamera) - The main camera used for rendering. This is the same as `scene.mainCamera` in three.js.

[`scene.defaultCamera`](https://threepipe.org/docs/classes/RootScene.html#defaultCamera) - The default camera used for rendering. This is the same as `scene.defaultCamera` in three.js.

[`scene.disposeSceneModels`](https://threepipe.org/docs/classes/RootScene.html#disposeSceneModels) - Disposes all assets in the modelRoot.

[`scene.clearSceneModels`](https://threepipe.org/docs/classes/RootScene.html#clearSceneModels) - Removes all objects from the modelRoot.

[`scene.dispose`](https://threepipe.org/docs/classes/RootScene.html#dispose) - Disposes the scene and all its resources and children.

[`scene.getBounds`](https://threepipe.org/docs/classes/RootScene.html#getBounds) - Gets the bounds of the scene model root. Returns an instance of three.js [Box3](https://threejs.org/docs/#api/en/math/Box3) with min and max bounds according to parameters.

[`scene.addObject`](https://threepipe.org/docs/classes/RootScene.html#addObject) - Adds an object to the scene or its model root depending on the options. If `addToRoot` is `true`, the object is added to the model root, else it is added to the scene directly.

[`scene.setDirty`](https://threepipe.org/docs/classes/RootScene.html#setDirty) - Notifies that something has changed in the scene for re-render.

[`scene.refreshScene`](https://threepipe.org/docs/classes/RootScene.html#refreshScene) - Notifies that some object has changed in the scene for scene refresh(like shadow refresh, ground etc) and re-render. Slower than `setDirty`, as it refreshes shadows, updates bounds, etc.

[`scene.refreshActiveNearFar`](https://threepipe.org/docs/classes/RootScene.html#refreshActiveNearFar) - Refreshes active near far. (in most cases this is done automatically and need not be called)

[`scene.loadModelRoot`](https://threepipe.org/docs/classes/RootScene.html#loadModelRoot) - Loads an imported model root from the asset importer. This is used internally and in most cases, you don't need to call this.

### Scene Events

RootScene dispatches many events that are useful when writing app logic or plugins

`'sceneUpdate'` - Listen to `refreshScene` called in RootScene. When some object changes.

`'addSceneObject'` - When a new object is added to the scene

`'mainCameraChange'` - When the main camera is changed to some other camera.

`'mainCameraUpdate'` - When some properties in the current main camera has changed.

`'environmentChanged'` - When the environment map changes

`'backgroundChanged'` - When the background map or color changes

`'materialUpdate`' - When a material in the scene has updated. (setDirty called on the material)

`'objectUpdate`' - When a object in the scene has updated. (setDirty called on the object)

`'textureUpdate`' - When a texture in the scene has updated. (setDirty called on the texture)

`'cameraUpdate`' - When a camera in the scene has updated.
(setDirty called on the camera)

`'geometryUpdate`' - When a geometry in the scene has updated.
(setDirty called on the geometry)

`'geometryChanged`' - When a geometry is changed on any mesh

`'materialChanged'` - When a material is changed on any mesh

Check [IObject3DEventTypes](https://threepipe.org/docs/interfaces/IObject3DEventTypes.html) and[ISceneEventTypes](https://threepipe.org/docs/interfaces/ISceneEventTypes.html) for more information.


## ICamera

Source Code: [src/core/camera/PerspectiveCamera2.ts](./src/core/camera/PerspectiveCamera2.ts), [src/core/ICamera.ts](./src/core/ICamera.ts)

API Reference: [PerspectiveCamera2](https://threepipe.org/docs/classes/PerspectiveCamera2.html), [ICamera](https://threepipe.org/docs/interfaces/ICamera.html)

ICamera is an interface for a camera that extends the three.js [Camera](https://threejs.org/docs/#api/en/cameras/Camera).
PerspectiveCamera2 implements the interface,
extending from three.js [PerspectiveCamera](https://threejs.org/docs/#api/en/cameras/PerspectiveCamera) with extra features like target, automatic aspect management, automatic near far management(from RootScene), camera control attachment and hooks(like OrbitControls) and the ability to set as the main camera in the root scene.

```typescript
import {OrbitControls3} from './OrbitControls3'

const viewer = new ThreeViewer({...})

const camera: PerspectiveCamera2 = viewer.scene.mainCamera

// Set the camera position
camera.position.set(0, 0, 10)

// Set the camera target (where the camera looks at)
camera.target.set(0, 0, 0)

// Set the camera fov
camera.fov = 45

// Set the camera aspect ratio
camera.autoAspect = false // disable automatic aspect management based on the canvas size
camera.aspect = 1

// Set camera near far bounds. 
// Near, Far plane will be calculated automatically within these limits
// Try changing these values when encountering z-fighting issues or far-plane clipping
camera.minNearPlane = 0.5 // min near plane
camera.maxFarPlane = 10 // max far plane

// Set a custom camera near far
camera.autoNearFar = false // disable automatic near far management based on the scene bounds
camera.minNearPlane = 0.1 // near plane
camera.maxFarPlane = 1000 // far plane

// this needs to be called to notify the viewer to re-render the scene
// in most cases this is done internally. But calling this does not have much impact
camera.setDirty()

// Check if user can interact with the camera. Also checks if its the main camera.
console.log(camera.canUserInteract)

// Get the camera controls (orbit controls for the default camera)
const controls: OrbitControls3 = camera.controls
// Disable controls
controls.enabled = false

// Change the controls mode
camera.controlsMode = 'none' // this will remove the current controls.

// Register a custom camera controls
camera.setControlsCtor('customOrbit', (camera, domElement) => new CustomOrbitControls(camera, domElement))

// Set the camera controls
camera.controlsMode = 'customOrbit' // this will initialize the controls with the customOrbit constructor and set it on the camera

// Disable interactions to the camera. (eg when animating)
camera.setInteractions(false, 'animation')
// Enable interactions back 
camera.setInteractions(true, 'animation') // this will enable interactions when all the keys have been set to true(which were set to false earlier)

// Force refresh aspect ratio (this is done automatically with a ResizeObserver on the canvas in the viewer)
camera.refreshAspect()

// Set the camera as the main camera
camera.activateMain()
// Deactivate the camera as the main camera
camera.deactivateMain()
```

[`camera.target`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#target) - The target of the camera. This is the same as `controls.target` in three.js. The target is always in world-space coordinates, as opposed to position, rotation, and scale which are always relative to their parent.

[`camera.autoAspect`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#autoAspect) - If `true`, the aspect ratio is automatically calculated based on the canvas size. 

[`camera.aspect`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#aspect) - The aspect ratio of the camera. This is the same as `camera.aspect` in three.js. This is only used when `camera.autoAspect` is `false`.

[`camera.minNearPlane`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#minNearPlane) - The minimum near plane of the camera. This is the same as `camera.near` in three.js when `camera.autoNearFar` is `false`, otherwise it is the minimum near plane distance from the camera allowed when computing automatically

[`camera.maxFarPlane`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#maxFarPlane) - The maximum far plane of the camera. This is the same as `camera.far` in three.js when `camera.autoNearFar` is `false`, otherwise it is the maximum far plane distance from the camera allowed when computing automatically

[`camera.autoNearFar`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#autoNearFar) - If `true` (default), the near and far planes are automatically calculated based on the scene bounds.

[`camera.setDirty`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#setDirty) - Notifies that something has changed in the camera for re-render.

[`camera.canUserInteract`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#canUserInteract) - Checks if user can interact with the camera. Also checks if it's the main camera.

[`camera.controls`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#controls) - Get the current camera controls set on the camera. This can be changed by changing `controlsMode`

[`camera.controlsMode`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#controlsMode) - Get or set the current controls that are attached to the camera. More modes can be registered with `setControlsCtor`. Default for the default camera is `orbit` and `none` for any new cameras.

[`camera.setControlsCtor`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#setControlsCtor) - Register a custom camera controls constructor. The controls can be set by setting `controlsMode` to the key/name of the controls.

[`camera.setInteractions`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#setInteractions) - If `true`, the camera can be interacted with. This is useful when animating the camera or using the window scroll or programmatically automating the viewer. Using this multiple plugins can disable interactions and it will be enabled again when all of them enable it back.

[`camera.refreshAspect`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#refreshAspect) - Force refresh aspect ratio (this is done automatically with a ResizeObserver on the canvas in the viewer or when `viewer.resize()` is called)

[`camera.activateMain`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#activateMain) - Set the camera as the main camera. This is the same as doing `scene.mainCamera = camera`. The camera needs to be in the scene hierarchy for this to work.

[`camera.deactivateMain`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#deactivateMain) - Deactivate the camera as the main camera.

See also [CameraViewPlugin](#cameraviewplugin) for camera focus animation.

## AssetManager

Source Code: [src/assetmanager/AssetManager.ts](./src/assetmanager/AssetManager.ts)

API Reference: [AssetManager](https://threepipe.org/docs/classes/AssetManager.html)

`AssetManager` is a class that manages the loading and exporting of assets and provides helpers for caching assets. It is used internally in the viewer and can be used to load assets outside the viewer. It provides a modular framework for adding more asset loaders and exporters.

```typescript
const viewer = new ThreeViewer({...})

const assetManager = viewer.assetManager

// Add an asset or an asset bundle
const assets = await assetManager.addAsset('https://example.com/model.zip')
// or
const assets = await assetManager.addAsset({
  path: 'https://example.com/model.zip',
  file: blob,
})

// Get the storage used in the asset manager for caching
const storage: Cache | Storage = assetManager.storage

// Get the importer. Provides low level functions to import assets
const importer = assetManager.importer

// import a file by asset or url
const file = await importer.import('https://example.com/model.gltf')

// Import a Map<string, File> from drag drop
const res = await importer.importFiles(mapOfFiles, {})

// Register a custom path that maps to a File object. Useful when some file types have path references to other files.
importer.registerFile('/myFile.png', file) // this returns the three.js loader for that kind of file.
// Unregister the path 
importer.unregisterFile('/myFile.png')

// Unregister all files and clear the loader cache(memory, not storage)
importer.clearCache()

// Add custom importers (check extra load plugins for more examples)
importer.addImporter(new Importer(class extends PLYLoader implements ILoader {
  transform(res: BufferGeometry, _: AnyOptions): Mesh | undefined {
    return res ? new Mesh(res, new PhysicalMaterial({color: new Color(1, 1, 1)})) : undefined
  }
}, ['ply'], ['text/plain+ply'], false))

// Get the exporter. Provides low level functions to export assets
const exporter = assetManager.exporter

// Export any IObject3D, IMaterial, ITexture, IRenderTarget
const exported = exporter.exportObject(obj, options)

// Add a custom exporter
exporter.addExporter({
  ext: ['gltf', 'glb'], // file extensions
  extensions: [], // extensions for the exporter
  ctor: (assetExporter, iexporter) => {
    return new GLTFExporter2()
  }
})


// Material Manager

const materialManager = assetManager.materialManager

// Create a material of type
const mat = materialManager.create('physical')
const mat2 = materialManager.create('unlit')

// find or create a material by uuid
const mat = materialManager.findOrCreate('00000000-0000-0000-0000-000000000000', {color: '#ffffff'})

// find a material creation template 
const template = materialManager.findTemplate('physical')

// Get all materials 
const materials = materialManager.getAllMaterials()

// Get all materials of type
const materials = materialManager.getMaterialsOfType(PhysicalMaterial.TypeSlug)

// register a custom material to the manager for tracking and extensions
// Note all materials created in threepipe internally are registered automatically on creation or when added to any scene object.
materialManager.registerMaterial(customMat)
// unregister
materialManager.unregisterMaterial(customMat)

// clear all material references
materialManager.clearMaterials()

// Register a custom material template
materialManager.registerTemplate({
  generator: (params: any) => new PhysicalMaterial(params),
  name: 'custom',
  materialType: PhysicalMaterial.TYPE, 
  params: {
    color: '#ffffff',
    roughness: 0.5,
    metalness: 0.5,
  },
})
const mat3 = materialManager.create('custom')

// convert a standard three.js material to threepipe material 
const mat4 = materialManager.convertToIMaterial(new ShadowMaterial(), {materialTemplate: 'test'})

// register a custom material extension for all materials in the viewer
materialManager.registerMaterialExtension(customExtension)
// unregister
materialManager.unregisterMaterialExtension(customExtension)
// remove all extensions
materialManager.clearExtensions()

// Apply a material properties to other material(s) in the scene by name or uuid
materialManager.applyMaterial(goldMaterial, 'METAL') // this will copy the properties from goldMaterial to all the materials(or objects) in the viewer with the name METAL.

// export a material as JSON. Note: use AssetExporter instead to export all the embedded assets and properties properly.
const blob = materialManager.exportMaterial(mat)

// dispose manager and all materials.
materialManager.dispose()
```

[`assetManager.addAsset`](https://threepipe.org/docs/classes/AssetManager.html#addAsset) - Add an asset or an asset bundle. Returns a promise that resolves to an array of asset objects. An asset can contain multiple objects, hence an array is returned. Use shorthand `viewer.load(path)` to load a single asset from a single file. 

[`assetManager.storage`](https://threepipe.org/docs/classes/AssetManager.html#storage) - Get the storage used in the asset manager for caching. This is the storage that can be passed in the `ThreeViewer` contructor options.

[`assetManager.importer`](https://threepipe.org/docs/classes/AssetManager.html#importer) - Get the importer. Provides low-level functions to import assets. This is an instance of [AssetImporter](https://threepipe.org/docs/classes/AssetImporter.html).

[`assetManager.exporter`](https://threepipe.org/docs/classes/AssetManager.html#exporter) - Get the exporter. Provides low-level functions to export assets. This is an instance of [AssetExporter](https://threepipe.org/docs/classes/AssetExporter.html).

### AssetImporter

[`importer.import`](https://threepipe.org/docs/classes/AssetImporter.html#import) - Import a file by asset or url. Returns a promise that resolves to a [File](https://threepipe.org/docs/classes/File.html) object.

[`importer.importFiles`](https://threepipe.org/docs/classes/AssetImporter.html#importFiles) - Import a Map<string, File> from drag and drop. Returns a promise that resolves to a Map<string, any[]> of imported object arrays.

[`importer.registerFile`](https://threepipe.org/docs/classes/AssetImporter.html#registerFile) - Register a custom path that maps to a File object. Useful when some file types have path references to other files. Like when importing a .zip with a .gltf file that references a .bin file, or when loading remote files from custom local cache implementation.

[`importer.unregisterFile`](https://threepipe.org/docs/classes/AssetImporter.html#unregisterFile) - Unregister the path.

[`importer.clearCache`](https://threepipe.org/docs/classes/AssetImporter.html#clearCache) - Unregister all the registered files and clear the loader cache(memory cache, not cache-storage).

[`importer.addImporter`](https://threepipe.org/docs/classes/AssetImporter.html#addImporter) - Add custom importers (check extra load plugins for more examples). This allows to pass a class to a ILoader, that is used to import assets. Loaders are only created when a file is being loaded of that type. And they remain in the loader cache until `clearCache` or `clearLoaderCache` is called.

### AssetExporter

[`exporter.exportObject`](https://threepipe.org/docs/classes/AssetExporter.html#exportObject) - Export any IObject3D, IMaterial, ITexture, IRenderTarget. Returns a promise that resolves to an exported object. Use `viewer.export` or `AssetExporterPlugin`, which provide more features and shortcuts to export viewer, scene and plugins as well.

[`exporter.addExporter`](https://threepipe.org/docs/classes/AssetExporter.html#addExporter) - Add a custom exporter for a custom file type.

### MaterialManager

[`materialManager.create`](https://threepipe.org/docs/classes/MaterialManager.html#create) - Create a new material of a given type and with passed properties. Returns an implementation of [IMaterial](https://threepipe.org/docs/interfaces/IMaterial.html).

[`materialManager.findOrCreate`](https://threepipe.org/docs/classes/MaterialManager.html#findOrCreate) - Find or create a material by uuid. Returns an instance of [IMaterial](https://threepipe.org/docs/interfaces/IMaterial.html). If a material with the uuid exists, it is returned, else a new material is created with the passed properties.

[`materialManager.findTemplate`](https://threepipe.org/docs/classes/MaterialManager.html#findTemplate) - Find a material creation template. Returns an instance of [IMaterialTemplate](https://threepipe.org/docs/interfaces/IMaterialTemplate.html). Material templates are used to create materials of a given type with default properties.

[`materialManager.getAllMaterials`](https://threepipe.org/docs/classes/MaterialManager.html#getAllMaterials) - Get all materials registered with the manager.

[`materialManager.getMaterialsOfType`](https://threepipe.org/docs/classes/MaterialManager.html#getMaterialsOfType) - Get all materials of a specific type. Pass in the typeslug from the class like `pmat` or `dmat` to identify the material.

[`materialManager.registerMaterial`](https://threepipe.org/docs/classes/MaterialManager.html#registerMaterial) - Register a new material to the manager for tracking and extensions. Note: all materials created in threepipe internally or any that are set to any object in the scene are registered automatically on creation or when used

[`materialManager.unregisterMaterial`](https://threepipe.org/docs/classes/MaterialManager.html#unregisterMaterial) - Unregister a material from the manager.

[`materialManager.clearMaterials`](https://threepipe.org/docs/classes/MaterialManager.html#clearMaterials) - Clear all registered material references.

[`materialManager.registerTemplate`](https://threepipe.org/docs/classes/MaterialManager.html#registerTemplate) - Register a custom material template. Requires an instance of [IMaterialTemplate](https://threepipe.org/docs/interfaces/IMaterialTemplate.html). Material templates are used to create materials of a given type with default properties.

[`materialManager.convertToIMaterial`](https://threepipe.org/docs/classes/MaterialManager.html#convertToIMaterial) - Convert/upgrade a standard three.js material to threepipe material, by making it conform to [IMaterial](https://threepipe.org/docs/interfaces/IMaterial.html).

[`materialManager.registerMaterialExtension`](https://threepipe.org/docs/classes/MaterialManager.html#registerMaterialExtension) - Register a custom material extension for all materials in the viewer. Requires an instance of [IMaterialExtension](https://threepipe.org/docs/interfaces/IMaterialExtension.html). Material extensions are used to add custom properties, methods, uniforms, defines, shader patches etc to predefined materials. The extensions are added to the material when the mateiral or extension is registered to the manager.

[`materialManager.unregisterMaterialExtension`](https://threepipe.org/docs/classes/MaterialManager.html#unregisterMaterialExtension) - Unregister a material extension from the manager.

[`materialManager.clearExtensions`](https://threepipe.org/docs/classes/MaterialManager.html#clearExtensions) - Remove all material extensions from the manager.

[`materialManager.applyMaterial`](https://threepipe.org/docs/classes/MaterialManager.html#applyMaterial) - Apply a material properties to other material(s) in the scene by name or uuid. This is useful when you want to change the properties of all materials with a given name or uuid. This can also be a regex, in that case a regex.match will be performed on the material/object name.

[`materialManager.exportMaterial`](https://threepipe.org/docs/classes/MaterialManager.html#exportMaterial) - Export a material as JSON. Note: use `viewer.export` or `AssetExporter` instead to export all the embedded assets properly.

[`materialManager.dispose`](https://threepipe.org/docs/classes/MaterialManager.html#dispose) - Dispose manager and all materials.

# Threepipe Plugins

ThreePipe has a simple plugin system that allows you to easily add new features to the viewer. Plugins can be added to the viewer using the `addPlugin` and `addPluginSync` methods. The plugin system is designed to be modular and extensible. Plugins can be added to the viewer at any time and can be removed using the `removePlugin` and `removePluginSync` methods.

## TonemapPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#tonemap-plugin/) &mdash;
[Source Code](./src/plugins/postprocessing/TonemapPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/TonemapPlugin.html) 

TonemapPlugin adds a post-processing material extension to the ScreenPass in render manager
that applies tonemapping to the color. The tonemapping operator can be changed
by setting the `toneMapping` property of the plugin. The default tonemapping operator is `ACESFilmicToneMapping`.

Other Tonemapping properties can be like `exposure`, `contrast` and `saturation`

TonemapPlugin is added by default in ThreeViewer unless `tonemap` is set to `false` in the options.

## DropzonePlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#dropzone-plugin/) &mdash;
[Source Code](./src/plugins/interaction/DropzonePlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/DropzonePlugin.html) 

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

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#progressive-plugin/) &mdash;
[Source Code](./src/plugins/pipeline/ProgressivePlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ProgressivePlugin.html) 

Progressive Plugin adds a post-render pass to blend the last frame with the current frame.

This is used as a dependency in other plugins for progressive rendering effect which is useful for progressive shadows, gi, denoising, baking, anti-aliasing, and many other effects.

## DepthBufferPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#depth-buffer-plugin/) &mdash;
[Source Code](./src/plugins/pipeline/DepthBufferPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/DepthBufferPlugin.html) 

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

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#normal-buffer-plugin/) &mdash;
[Source Code](./src/plugins/pipeline/NormalBufferPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/NormalBufferPlugin.html) 

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

## PickingPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#picking-plugin/) &mdash;
[Source Code](./src/plugins/interaction/PickingPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/PickingPlugin.html) 

Picking Plugin adds support for selecting and hovering over objects in the viewer with user interactions and selection widgets.

When the plugin is added to the viewer, it starts listening to the mouse move and click events over the canvas.
When an object is clicked, it is selected,
and if a UI plugin is added, the uiconfig for the selected object is populated in the interface.
The events `selectedObjectChanged`, `hoverObjectChanged`, and `hitObject` can be listened to on the plugin.

Picking plugin internally uses [ObjectPicker](https://threepipe.org/docs/classes/ObjectPicker.html),
check out the documentation or source code for more information.

```typescript
import {ThreeViewer, PickingPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const pickingPlugin = viewer.addPluginSync(new PickingPlugin())

// Hovering events are also supported, but since its computationally expensive for large scenes it is disabled by default.
pickingPlugin.hoverEnabled = true

pickingPlugin.addEventListener('hitObject', (e)=>{
  // This is fired when the user clicks on the canvas.
  // The selected object hasn't been changed yet, and we have the option to change it or disable selection at this point.
    
  // e.intersects.selectedObject contains the object that the user clicked on.
  console.log('Hit: ', e.intersects.selectedObject)
  // It can be changed here 
  // e.intersects.selectedObject = e.intersects.selectedObject.parent // select the parent
  // e.intersects.selectedObject = null // unselect
  
  // Check other properties on the event like intersects, mouse position, normal etc.
  console.log(e)
})

pickingPlugin.addEventListener('selectedObjectChanged', (e)=>{
  // This is fired when the selected object is changed.
  // e.object contains the new selected object. It can be null if nothing is selected.
  console.log('Selected: ', e.object)
})

// Objects can be programmatically selected and unselected

// to select
pickingPlugin.setSelectedObject(object)

// get the selected object
console.log(pickingPlugin.getSelectedObject())
// to unselect
pickingPlugin.setSelectedObject(null)

// Select object with camera animation to the object
pickingPlugin.setSelectedObject(object, true)

pickingPlugin.addEventListener('hoverObjectChanged', (e)=>{
  // This is fired when the hovered object is changed.
  // e.object contains the new hovered object.
  console.log('Hovering: ', e.object)
})

```

## GLTFAnimationPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#gltf-animation-plugin/) &mdash;
[Source Code](./src/plugins/animation/GLTFAnimationPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/GLTFAnimationPlugin.html) 

Manages playback of GLTF animations.

The GLTF animations can be created in any 3d software that supports GLTF export like Blender.
If animations from multiple files are loaded, they will be merged in a single root object and played together.

The time playback is managed automatically, but can be controlled manually by setting {@link autoIncrementTime} to false and using {@link setTime} to set the time.

This plugin is made for playing, pausing, stopping, all the animations at once, while it is possible to play individual animations, it is not recommended.

To play individual animations, with custom choreography, use the {@link GLTFAnimationPlugin.animations} property to get reference to the animation clips and actions. Create your own mixers and control the animation playback like in three.js

## PopmotionPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#popmotion-plugin/) &mdash;
[Source Code](./src/plugins/animation/PopmotionPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/PopmotionPlugin.html) 

Provides animation/tweening capabilities to the viewer using the [popmotion.io](https://popmotion.io/) library.

Overrides the driver in popmotion to sync with the viewer and provide ways to store and stop animations.

```typescript
import {PopmotionPlugin, ThreeViewer} from 'threepipe'

const viewer = new ThreeViewer({...})

const cube = viewer.scene.getObjectByName('cube');

const popmotion = viewer.addPluginSync(new PopmotionPlugin())

// Move the object cube 1 unit up.
const anim = popmotion.animateTarget(cube, 'position', {
  to: cube.position.clone().add(new Vector3(0,1,0)),
  duration: 500, // ms
  onComplete: () => isMovedUp = true,
  onStop: () => throw(new Error('Animation stopped')),
})

// Alternatively, set the property directly in onUpdate.
const anim1 = popmotion.animate({
  from: cube.position.y,
  to: cube.position.y + 1,
  duration: 500, // ms
  onUpdate: (v) => {
    cube.position.setY(v)
    cube.setDirty()
  },
  onComplete: () => isMovedUp = true,
  onStop: () => throw(new Error('Animation stopped')),
  onEnd: () => console.log('Animation ended'), // This runs after both onComplete and onStop
})

// await for animation. This promise will reject only if an exception is thrown in onStop or onComplete. onStop rejects if throwOnStop is true
await anim.promise.catch((e)=>{
  console.log(e, 'animation stopped before completion')
});

// or stop the animation
// anim.stop()

// Animate the color
await popmotion.animateAsync({ // Also await for the animation.
  from: '#' + cube.material.color.getHexString(),
  to: '#' + new Color().setHSL(Math.random(), 1, 0.5).getHexString(),
  duration: 1000, // 1s
  onUpdate: (v) => {
    cube.material.color.set(v)
    cube.material.setDirty()
  },
})
```

Note: The animation is started when the animate or animateAsync function is called.

## CameraViewPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#camera-view-plugin/) &mdash;
[Source Code](./src/plugins/animation/CameraViewPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/CameraViewPlugin.html) 

CameraViewPlugin adds support to save and load camera views, which can then be animated to.
It uses PopmotionPlugin internally to animate any camera to a saved view or to loop through all the saved views.

It also provides a UI to manage the views.

```typescript
import {CameraViewPlugin, ThreeViewer, CameraView, Vector3, Quaternion, EasingFunctions, timeout} from 'threepipe'

const viewer = new ThreeViewer({...})

const cameraViewPlugin = viewer.addPluginSync(new CameraViewPlugin())

const intialView = cameraViewPlugin.getView()
// or = viewer.scene.mainCamera.getView()

// create a new view
const view = new CameraView(
    'My View', // name
    new Vector3(0, 0, 10), // position
    new Vector3(0, 0, 0), // target
    new Quaternion(0, 0, 0, 1), // quaternion rotation
    1 // zoom
)

// or clone a view
const view2 = intialView.clone()
view2.position.add(new Vector3(0, 5, 0)) // move up 5 units

// animate the main camera to a view
await cameraViewPlugin.animateToView(
    view,
    2000, // in ms, = 2sec
    EasingFunctions.easeInOut,
).catch(()=>console.log('Animation stopped'))

// stop any/all animations
cameraViewPlugin.stopAllAnimations()

// add views to the plugin
cameraViewPlugin.addView(view)
cameraViewPlugin.addView(view2)
cameraViewPlugin.addView(intialView)
cameraViewPlugin.addCurrentView() // adds the current view of the main camera

// loop through all the views once
cameraViewPlugin.animDuration = 2000 // default duration
cameraViewPlugin.animEase = EasingFunctions.easeInOutSine // default easing
await cameraViewPlugin.animateAllViews()

// loop through all the views forever
cameraViewPlugin.viewLooping = true
await timeout(10000) // wait for some time
// stop looping
cameraViewPlugin.viewLooping = false

```


## RenderTargetPreviewPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#render-target-preview/) &mdash;
[Source Code](./src/plugins/ui/RenderTargetPreviewPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/RenderTargetPreviewPlugin.html) 

RenderTargetPreviewPlugin is a useful development and debugging plugin that renders any registered render-target to the screen in small collapsable panels.

```typescript
import {ThreeViewer, RenderTargetPreviewPlugin, NormalBufferPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const normalPlugin = viewer.addPluginSync(new NormalBufferPlugin(HalfFloatType))

const previewPlugin = viewer.addPluginSync(new RenderTargetPreviewPlugin())

// Show the normal buffer in a panel
previewPlugin.addTarget(()=>normalPlugin.target, 'normal', false, false)
```

## GeometryUVPreviewPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#geometry-uv-preview/) &mdash;
[Source Code](./src/plugins/ui/GeometryUVPreviewPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/GeometryUVPreviewPlugin.html) 

GeometryUVPreviewPlugin is a useful development and debugging plugin
that adds a panel to the viewer to show the UVs of a geometry.

```typescript
import {ThreeViewer, GeometryUVPreviewPlugin, SphereGeometry} from 'threepipe'

const viewer = new ThreeViewer({...})

const previewPlugin = viewer.addPluginSync(new GeometryUVPreviewPlugin())

const geometry = new SphereGeometry(1, 32, 32)
// Show the normal buffer in a panel
previewPlugin.addGeometry(geometry, 'sphere')
```

## FrameFadePlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#frame-fade-plugin/) &mdash;
[Source Code](./src/plugins/pipeline/FrameFadePlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/FrameFadePlugin.html) 

FrameFadePlugin adds a post-render pass to the render manager and blends the last frame with the current frame over time. This is useful for creating smooth transitions between frames for example when changing the camera position, material, object properties, etc to avoid a sudden jump.

```typescript
import {ThreeViewer, FrameFadePlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const fadePlugin = viewer.addPluginSync(new FrameFadePlugin())

// Make some changes in the scene (any visual change that needs to be faded)

// Start transition and wait for it to finish
await fadePlugin.startTransition(400) // duration in ms

```

To stop a transition, call `fadePlugin.stopTransition()`. This will immediately set the current frame to the last frame and stop the transition. The transition is also automatically stopped when the camera is moved or some pointer event occurs on the canvas.

The plugin automatically tracks `setDirty()` function calls in objects, materials and the scene. It can be triggerred by calling `setDirty` on any material or object in the scene. Check the [example](https://threepipe.org/examples/#frame-fade-plugin/) for a demo. This can be disabled by options in the plugin.

## VignettePlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#vignette-plugin/) &mdash;
[Source Code](./src/plugins/postprocessing/VignettePlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/VignettePlugin.html) 

VignettePlugin adds a post-processing material extension to the ScreenPass in render manager
that applies a vignette effect to the final render. The parameters `power` and `color` can be changed to customize the effect.

```typescript
import {ThreeViewer, VignettePlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const vignettePlugin = viewer.addPluginSync(VignettePlugin)

// Change the vignette color
vignettePlugin.power = 1
vignettePlugin.color = new Color(0.5, 0, 0)

// or 
// vignettePlugin.color.set('#ff0000'); vignettePlugin.setDirty() // Call setDirty to tell the plugin that color has changed
```

## ChromaticAberrationPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#chromatic-aberration-plugin/) &mdash;
[Source Code](./src/plugins/postprocessing/ChromaticAberrationPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ChromaticAberrationPlugin.html) 

ChromaticAberrationPlugin adds a post-processing material extension to the ScreenPass in render manager
that applies a chromatic-aberration effect to the final render. The parameter `intensity` can be changed to customize the effect.

```typescript
import {ThreeViewer, ChromaticAberrationPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const chromaticAberrationPlugin = viewer.addPluginSync(ChromaticAberrationPlugin)

// Change the chromaticAberration color
chromaticAberrationPlugin.intensity = 0.5
```

## FilmicGrainPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#filmic-grain-plugin/) &mdash;
[Source Code](./src/plugins/postprocessing/FilmicGrainPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/FilmicGrainPlugin.html) 

FilmicGrainPlugin adds a post-processing material extension to the ScreenPass in render manager
that applies a filmic-grain effect to the final render. The parameters `power` and `color` can be changed to customize the effect.

```typescript
import {ThreeViewer, FilmicGrainPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const filmicGrainPlugin = viewer.addPluginSync(FilmicGrainPlugin)

// Change the filmicGrain color
filmicGrainPlugin.intensity = 10
filmicGrainPlugin.multiply = false
```

## NoiseBumpMaterialPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#noise-bump-material-plugin/) &mdash;
[Source Code](./src/plugins/material/NoiseBumpMaterialPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/NoiseBumpMaterialPlugin.html) 

NoiseBumpMaterialPlugin adds a material extension to PhysicalMaterial to add support for sparkle bump / noise bump by creating procedural bump map from noise to simulate sparkle flakes.
It uses voronoise function from blender along with several additions to generate the noise for the generation.
It also adds a UI to the material to edit the settings.
It uses `WEBGI_materials_noise_bump` glTF extension to save the settings in glTF/glb files.

```typescript
import {ThreeViewer, NoiseBumpMaterialPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const noiseBump = viewer.addPluginSync(NoiseBumpMaterialPlugin)

// Add noise bump to a material
NoiseBumpMaterialPlugin.AddNoiseBumpMaterial(material, {
  flakeScale: 300,
})

// Change properties with code or use the UI
material.userData._noiseBumpMat!.bumpNoiseParams = [1, 1]
material.setDirty()

// Disable
material.userData._noiseBumpMat!.hasBump = false
material.setDirty()
```

## CustomBumpMapPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#custom-bump-map-plugin/) &mdash;
[Source Code](./src/plugins/material/CustomBumpMapPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/CustomBumpMapPlugin.html) 

CustomBumpMapPlugin adds a material extension to PhysicalMaterial to support custom bump maps.
A Custom bump map is similar to the built-in bump map, but allows using an extra bump map and scale to give a combined effect.
This plugin also has support for bicubic filtering of the custom bump map and is enabled by default.
It also adds a UI to the material to edit the settings.
It uses `WEBGI_materials_custom_bump_map` glTF extension to save the settings in glTF/glb files.

```typescript
import {ThreeViewer, CustomBumpMapPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const customBump = viewer.addPluginSync(CustomBumpMapPlugin)

// Add noise bump to a material
customBump.enableCustomBump(material, bumpMap, 0.2)

// Change properties with code or use the UI
material.userData._customBumpMat = texture
material.setDirty()

// Disable
material.userData._hasCustomBump = false
// or 
material.userData._customBumpMat = null
material.setDirty()
```

## ClearcoatTintPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#clearcoat-tint-plugin/) &mdash;
[Source Code](./src/plugins/material/ClearcoatTintPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ClearcoatTintPlugin.html) 

ClearcoatTintPlugin adds a material extension to PhysicalMaterial which adds tint and thickness to the built-in clearcoat properties.
It also adds a UI to the material to edit the settings.
It uses `WEBGI_materials_clearcoat_tint` glTF extension to save the settings in glTF/glb files.

```typescript
import {ThreeViewer, ClearcoatTintPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const clearcoatTint = viewer.addPluginSync(ClearcoatTintPlugin)

material.clearcoat = 1
// add initial properties
ClearcoatTintPlugin.AddClearcoatTint(material, {
  tintColor: '#ff0000',
  thickness: 1,
})

// Change properties with code or use the UI
material.userData._clearcoatTint!.tintColor = '#ff0000'
material.setDirty()

// Disable
material.userData._clearcoatTint.enableTint = false
material.setDirty()
```

## FragmentClippingExtensionPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#fragment-clipping-extension-plugin/) &mdash;
[Source Code](./src/plugins/material/FragmentClippingExtensionPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/FragmentClippingExtensionPlugin.html) 

FragmentClippingExtensionPlugin adds a material extension to PhysicalMaterial to add support for fragment clipping.
Fragment clipping allows to clip fragments of the material in screen space or world space based on a circle, rectangle, plane, sphere, etc.
It uses fixed SDFs with params defined by the user for clipping.
It also adds a UI to the material to edit the settings.
It uses `WEBGI_materials_fragment_clipping_extension` glTF extension to save the settings in glTF/glb files.

```typescript
import {ThreeViewer, FragmentClippingExtensionPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const fragmentClipping = viewer.addPluginSync(FragmentClippingExtensionPlugin)

// add initial properties
FragmentClippingExtensionPlugin.AddFragmentClipping(material, {
  clipPosition: new Vector4(0.5, 0.5, 0, 0),
  clipParams: new Vector4(0.1, 0.05, 0, 1),
})

// Change properties with code or use the UI
material.userData._fragmentClipping!.clipPosition.set(0, 0, 0, 0)
material.setDirty()

// Disable
material.userData._clearcoatTint.clipEnabled = false
material.setDirty()
```

## HDRiGroundPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#hdri-ground-plugin/) &mdash;
[Source Code](./src/plugins/extras/HDRiGroundPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/HDRiGroundPlugin.html) 

HDRiGroundPlugin patches the background shader in the renderer to add support for ground projected environment map/skybox. Works simply by setting the background same as the environemnt and enabling the plugin.

The world radius, tripod height, and origin position(center offset) can be set in the plugin.

The plugin is disabled by default when added. Set `.enabled` to enable it or pass `true` in the constructor.
If the background is not the same as the environment when enabled, the user will be prompted for this, unless `promptOnBackgroundMismatch` is set to `false` in the plugin.

```typescript
import {ThreeViewer, HDRiGrounPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const hdriGround = viewer.addPluginSync(new HDRiGrounPlugin())

// Load an hdr environment map
await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
// set background to environment
viewer.scene.background = 'environment'
// or 
// viewer.scene.background = viewer.scene.environemnt

// enable the plugin
hdriGround.enabled = true
```

Check the [example](https://threepipe.org/examples/#hdri-ground-plugin/) for a demo. 

## VirtualCamerasPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#virtual-cameras-plugin/) &mdash;
[Source Code](./src/plugins/rendering/VirtualCamerasPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/VirtualCamerasPlugin.html) 

VirtualCamerasPlugin adds support for rendering to multiple virtual cameras in the viewer. These cameras are rendered in preRender callback just before the main camera is rendered. The virtual cameras can be added to the plugin and removed from it.

The feed to the virtual camera is rendered to a Render Target texture which can be accessed and re-rendered in the scene or used in other plugins.

```typescript
import {ThreeViewer, VirtualCamerasPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const hdriGround = viewer.addPluginSync(new VirtualCamerasPlugin())

const camera = new PerspectiveCamera2('orbit', viewer.canvas, false, 45, 1)
camera.name = name
camera.position.set(0, 5, 0)
camera.target.set(0, 0.25, 0)
camera.userData.autoLookAtTarget = true // automatically look at the target (in setDirty)
camera.setDirty()
camera.addEventListener('update', ()=>{
  viewer.setDirty() // if the camera is not added to the scene it wont update automatically when camera.setDirty is called(like from the UI)
})

const vCam = virtualCameras.addCamera(camera)
console.log(vCam.target) // target is a WebGLRenderTarget/IRenderTarget
```

Check the [virtual camera](https://threepipe.org/examples/#hdri-ground-plugin/) example for using the texture in the scene. 

## Rhino3dmLoadPlugin

[Example](https://threepipe.org/examples/#rhino3dm-load/) &mdash;
[Source Code](./src/plugins/import/Rhino3dmLoadPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/Rhino3dmLoadPlugin.html) 

Adds support for loading .3dm files generated by [Rhino 3D](https://www.rhino3d.com/). This plugin includes some changes with how 3dm files are loaded in three.js. The changes are around loading layer and primitive properties when set as reference in the 3dm files.

It also adds some helpful options to process the model after load.

```typescript
import {Rhino3dmLoadPlugin} from 'threepipe'
const rhino3dmPlugin = viewer.addPluginSync(new Rhino3dmLoadPlugin())

rhino3dmPlugin.importMaterials = true // import materials source from 3dm file
rhino3dmPlugin.forceLayerMaterials = true // force material source to be layer in 3dm file.
rhino3dmPlugin.hideLineMesh = true // hide all lines and points in the model.
rhino3dmPlugin.replaceWithInstancedMesh = true // replace meshes with the same parent, geometry and material with a single instance mesh.

const mesh = await viewer.load('file.3dm')
```

## PLYLoadPlugin

[Example](https://threepipe.org/examples/#ply-load/) &mdash;
[Source Code](./src/plugins/import/PLYLoadPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/PLYLoadPlugin.html) 

Adds support for loading .ply ([Polygon file format](https://en.wikipedia.org/wiki/PLY_(file_format))) files.

```typescript
import {PLYLoadPlugin} from 'threepipe'
viewer.addPluginSync(new PLYLoadPlugin())

const mesh = await viewer.load('file.ply')
```

## USDZLoadPlugin

[Example](https://threepipe.org/examples/#usdz-load/) &mdash;
[Source Code](./src/plugins/import/USDZLoadPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/USDZLoadPlugin.html) 

Adds support for loading .usdz and .usda ([Universal Scene Description](https://graphics.pixar.com/usd/docs/index.html)) files.

```typescript
import {USDZLoadPlugin} from 'threepipe'
viewer.addPluginSync(new USDZLoadPlugin())

const mesh = await viewer.load('file.usdz')
const mesh2 = await viewer.load('file.usda')
```

## STLLoadPlugin

[Example](https://threepipe.org/examples/#stl-load/) &mdash;
[Source Code](./src/plugins/import/STLLoadPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/STLLoadPlugin.html) 

Adds support for loading .stl ([Stereolithography](https://en.wikipedia.org/wiki/STL_(file_format))) files.

```typescript
import {STLLoadPlugin} from 'threepipe'
viewer.addPluginSync(new STLLoadPlugin())

const mesh = await viewer.load('file.stl')
```

## KTX2LoadPlugin

[Example](https://threepipe.org/examples/#ktx2-load/) &mdash;
[Source Code](./src/plugins/import/KTX2LoadPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/KTX2LoadPlugin.html) 

Adds support for loading .ktx2 ([Khronos Texture](https://www.khronos.org/opengles/sdk/tools/KTX/file_format_spec/) files.

KTX2LoadPlugin also adds support for exporting loaded .ktx2 files in glTF files with the [KHR_texture_basisu](https://www.khronos.org/registry/KHR/textures/2.0-extensions/KHR_texture_basisu/) extension.

```typescript
import {KTX2LoadPlugin} from 'threepipe'
viewer.addPluginSync(new KTX2LoadPlugin())

const texture = await viewer.load('file.ktx2')
```

## KTXLoadPlugin

[Example](https://threepipe.org/examples/#ktx-load/) &mdash;
[Source Code](./src/plugins/import/KTXLoadPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/KTXLoadPlugin.html) 

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
[Tweakpane](https://tweakpane.github.io/docs/) UI plugin for ThreePipe

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#tweakpane-ui-plugin/) &mdash;
[Source Code](./plugins/tweakpane/src/TweakpaneUiPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane/docs/classes/TweakpaneUiPlugin.html) 

NPM: `npm install @threepipe/plugin-tweakpane`

CDN: https://threepipe.org/plugins/tweakpane/dist/index.mjs

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
[Source Code](./plugins/blueprintjs/src/BlueprintJsUiPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/blueprintjs/docs/classes/BlueprintJsUiPlugin.html) 

NPM: `npm install @threepipe/plugin-blueprintjs`

CDN: https://threepipe.org/plugins/blueprintjs/dist/index.mjs

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
[Source Code](./plugins/tweakpane-editor/src/TweakpaneEditorPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/TweakpaneEditorPlugi &mdash;

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

## @threepipe/plugins-extra-importers

Exports several plugins to add support for various file types.

[Example](https://threepipe.org/examples/#extra-importer-plugins/) &mdash;
[Source Code](./plugins/extra-importers/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/extra-importers/docs) 

NPM: `npm install @threepipe/plugins-extra-importers`

CDN: https://threepipe.org/plugins/extra-importers/dist/index.mjs

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

## @threepipe/plugin-blend-importer

Exports [BlendImporterPlugin](https://threepipe.org/plugins/blend-importer/docs/classes/BlendLoadPlugin.html) which adds support for loading .blend files. 

It uses [js.blend](https://github.com/acweathersby/js.blend) for parsing blend file structure.

Note: This is still a WIP.
Currently working: `Mesh`, `BufferGeometry` and basic `PointLight`.
To be added: `PhysicalMaterial`, `UnlitMaterial` (similar to blender-gltf-io plugin)

[Example](https://threepipe.org/examples/#blend-load/) &mdash;
[Source Code](./plugins/blend-importer/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/blend-importer/docs) 

NPM: `npm install @threepipe/plugin-blend-importer`

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

## @threepipe/plugin-geometry-generator

Exports [GeometryGeneratorPlugin](https://threepipe.org/plugins/geometry-generator/docs/classes/BlendLoadPlugin.html) with several Geometry generators to create parametric and updatable geometries like plane, circle, sphere, box, torus, cylinder, cone etc.

[Example](https://threepipe.org/examples/#geometry-generator-plugin/) &mdash;
[Source Code](./plugins/geometry-generator/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/geometry-generator/docs) 

NPM: `npm install @threepipe/plugin-geometry-generator`

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
import {ThreeViewer} from 'threepipe'
import {GeometryGeneratorPlugin} from '@threepipe/plugin-geometry-generator'

const viewer = new ThreeViewer({...})
const generator = viewer.addPluginSync(GeometryGeneratorPlugin)

const sphere = generator.generateObject('sphere', {radius: 3})
viewer.scene.addObject(sphere)

// to update the geometry
generator.updateGeometry(sphere.geometry, {radius: 4, widthSegments: 100})

// to add a custom generator
generator.generators.custom = new CustomGenerator('custom') // Extend from AGeometryGenerator or implement GeometryGenerator
generator.uiConfig.uiRefresh?.()
```


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
  - [Exporting files](#exporting-files)
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
  - [Other classes and interfaces](#other-classes-and-interfaces)
- [Plugins](#threepipe-plugins)
  - [TonemapPlugin](#tonemapplugin) - Add tonemap to the final screen pass
  - [DropzonePlugin](#dropzoneplugin) - Drag and drop local files to import and load
  - [ProgressivePlugin](#progressiveplugin) - Post-render pass to blend the last frame with the current frame
  - [SSAAPlugin](#ssaaplugin) - Add Super Sample Anti-Aliasing by applying jitter to the camera.
  - [DepthBufferPlugin](#depthbufferplugin) - Pre-rendering of depth buffer
  - [NormalBufferPlugin](#normalbufferplugin) - Pre-rendering of normal buffer
  - [GBufferPlugin](#gbufferplugin) - Pre-rendering of depth-normal and flags buffers in a single pass
  - [SSAOPlugin](#ssaoplugin) - Add SSAO(Screen Space Ambient Occlusion) for physical materials.
  - [CanvasSnapshotPlugin](#canvassnapshotplugin) - Add support for taking snapshots of the canvas
  - [PickingPlugin](#pickingplugin) - Adds support for selecting objects in the viewer with user interactions and selection widgets
  - [AssetExporterPlugin](#assetexporterplugin) - Provides options and methods to export the scene, object GLB or Viewer Configuration.
  - [LoadingScreenPlugin](#loadingscreenplugin) - Shows a configurable loading screen overlay over the canvas.
  - [FullScreenPlugin](#fullscreenplugin) - Adds support for moving the canvas or the container fullscreen mode in browsers
  - [InteractionPromptPlugin](#interactionpromptplugin) - Adds an animated hand icon over canvas to prompt the user to interact
  - [TransformControlsPlugin](#transformcontrolsplugin) - Adds support for moving, rotating and scaling objects in the viewer with interactive widgets
  - [ContactShadowGroundPlugin](#contactshadowgroundplugin) - Adds a ground plane at runtime with contact shadows
  - [GLTFAnimationPlugin](#gltfanimationplugin) - Add support for playing and seeking gltf animations
  - [PopmotionPlugin](#popmotionplugin) - Integrates with popmotion.io library for animation/tweening
  - [CameraViewPlugin](#cameraviewplugin) - Add support for saving, loading, animating, looping between camera views
  - [TransformAnimationPlugin](#transformanimationplugin) - Add support for saving, loading, animating, between object transforms
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
  - [ParallaxMappingPlugin](#parallaxmappingplugin) - Relief Parallax Bump Mapping extension for PhysicalMaterial
  - [HDRiGroundPlugin](#hdrigroundplugin) - Add support for ground projected hdri/skybox to the webgl background shader.
  - [VirtualCamerasPlugin](#virtualcamerasplugin) - Add support for rendering virtual cameras before the main one every frame.
  - [EditorViewWidgetPlugin](#editorviewwidgetplugin) - Adds an interactive ViewHelper/AxisHelper that syncs with the main camera.
  - [Object3DWidgetsPlugin](#object3dwidgetsplugin) - Automatically create light and camera helpers/gizmos when they are added to the scene.
  - [Object3DGeneratorPlugin](#object3dwidgetsplugin) - Provides UI and API to create scene objects like lights, cameras, meshes, etc.
  - [DeviceOrientationControlsPlugin](#deviceorientationcontrolsplugin) - Adds a controlsMode to the mainCamera for device orientation controls(gyroscope rotation control).
  - [PointerLockControlsPlugin](#pointerlockcontrolsplugin) - Adds a controlsMode to the mainCamera for pointer lock controls.
  - [ThreeFirstPersonControlsPlugin](#threefirstpersoncontrolsplugin) - Adds a controlsMode to the mainCamera for first person controls from threejs.
  - [GLTFKHRMaterialVariantsPlugin](#gltfkhrmaterialvariantsplugin) - Support using for variants from KHR_materials_variants extension in gltf models.
  - [Rhino3dmLoadPlugin](#rhino3dmloadplugin) - Add support for loading .3dm files
  - [PLYLoadPlugin](#plyloadplugin) - Add support for loading .ply files
  - [STLLoadPlugin](#stlloadplugin) - Add support for loading .stl files
  - [KTX2LoadPlugin](#ktx2loadplugin) - Add support for loading .ktx2 files
  - [KTXLoadPlugin](#ktxloadplugin) - Add support for loading .ktx files
  - [USDZLoadPlugin](#usdzloadplugin) - Add support for loading .usdz files
  - [GLTFMeshOptDecodePlugin](#gltfmeshoptdecodeplugin) - Decode gltf files with EXT_meshopt_compression extension.
  - [SimplifyModifierPlugin](#simplifymodifierplugin) - Boilerplate for plugin to simplify geometries
  - [MeshOptSimplifyModifierPlugin](#meshoptsimplifymodifierplugin) - Simplify geometries using meshoptimizer library
- [Packages](#threepipe-packages)
  - [@threepipe/plugin-tweakpane](#threepipeplugin-tweakpane) Tweakpane UI Plugin
  - [@threepipe/plugin-blueprintjs](#threepipeplugin-blueprintjs) BlueprintJs UI Plugin
  - [@threepipe/plugin-tweakpane-editor](#threepipeplugin-tweakpane-editor) - Tweakpane Editor Plugin
  - [@threepipe/plugin-configurator](#threepipeplugin-configurator) - Provides Material Configurator and Switch Node Plugin to allow users to select variations 
  - [@threepipe/plugin-gltf-transform](#threepipeplugin-gltf-transform) - Plugin to transform gltf models (draco compression)
  - [@threepipe/plugins-extra-importers](#threepipeplugins-extra-importers) - Plugin for loading more file types supported by loaders in three.js
  - [@threepipe/plugin-blend-importer](#threepipeplugin-blend-importer) - Blender to add support for loading .blend file
  - [@threepipe/plugin-geometry-generator](#threepipeplugin-geometry-generator) - Generate parametric geometry types that can be re-generated from UI/API.
  - [@threepipe/plugin-gaussian-splatting](#threepipeplugin-gaussian-splatting) - Gaussian Splatting plugin for loading and rendering splat files
  - [@threepipe/plugin-network](#threepipeplugin-network) - Network/Cloud related plugin implementations for Threepipe.
  - [@threepipe/plugin-svg-renderer](#threepipeplugin-svg-renderer) - Add support for exporting 3d scene as SVG.

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
    Promise.all([envPromise, modelPromise]).then(([env, model]) => {
      console.log('Loaded', model, env, viewer)
    })
    
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

      Promise.all([envPromise, modelPromise]).then(([env, model]) => {
        console.log('Loaded', model, env, viewer)
      })

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

        Promise.all([envPromise, modelPromise]).then(([env, model]) => {
          console.log('Loaded', model, env, viewer)
        })
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

The 3D model can be opened in the [editor](https://threepipe.org/examples/tweakpane-editor/) to view and edit the scene settings, objects, materials, lights, cameras, post-processing, etc. and exported as a GLB file. All settings are automatically serialized and saved in the GLB file, which can be loaded into the viewer. Any plugins used in the editor can be added to the viewer to add the same functionality. The plugin data is automatically loaded(if the plugin is added) when the model is added to the scene.

The viewer initializes with a Scene, Camera, Camera controls(Orbit Controls), several importers, exporters and a default rendering pipeline. Additional functionality can be added with plugins.

Check out the GLTF Load example to see it in action or to check the JS equivalent code: https://threepipe.org/examples/#gltf-load/

Check out the [Plugins](#plugin-system) section below to learn how to add additional functionality to the viewer.

## License
The core framework([src](https://github.com/repalash/threepipe/tree/master/src), [dist](https://github.com/repalash/threepipe/tree/master/dist), [examples](https://github.com/repalash/threepipe/tree/master/examples) folders) and any [plugins](https://github.com/repalash/threepipe/tree/master/plugins) without a separate license are under the Free [Apache 2.0 license](https://github.com/repalash/threepipe/tree/master/LICENSE).

Some plugins(in the [plugins](https://github.com/repalash/threepipe/tree/master/plugins) folder) might have different licenses. Check the individual plugin documentation and the source folder/files for more details.

## Status
The project is in `alpha` stage and under active development. Many features will be added but the core API will not change significantly in future releases.

Check out [WebGi](https://webgi.xyz/) for an advanced tailor-made solution for e-commerce, jewelry, automobile, apparel, furniture etc.

## Documentation

Check the list of all functions, classes and types in the [API Reference Docs](https://threepipe.org/docs/).

## Contributing
Contributions to ThreePipe are welcome and encouraged! Feel free to open issues and pull requests on the GitHub repository.

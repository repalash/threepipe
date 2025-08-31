# ThreePipe

A new way to work with three.js, 3D models and rendering on the web.

[ThreePipe](https://threepipe.org/) &mdash;
[Github](https://github.com/repalash/threepipe) &mdash;
[Examples](https://threepipe.org/examples/) &mdash;
[API Reference](https://threepipe.org/docs/) &mdash;
[WebGi](https://webgi.dev/)

[![NPM Package](https://img.shields.io/npm/v/threepipe.svg)](https://www.npmjs.com/package/threepipe)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-green.svg)](https://opensource.org/license/apache-2-0/)
[![Twitter](https://img.shields.io/twitter/url/https/twitter.com/repalash.svg?style=social&label=Follow%20%40repalash)](https://twitter.com/repalash)

ThreePipe is a modern 3D framework built on top of [three.js](https://threejs.org/), written in TypeScript, designed to make creating high-quality, modular, and extensible 3D experiences on the web simple and enjoyable.

Key features include:
- Simple, intuitive API for creating 3D model viewers/configurators/editors on web pages, with many built-in presets for common workflows and use-cases.
- Companion [editor](https://threepipe.org/examples/tweakpane-editor/) to create, edit and configure 3D scenes in the browser.
- Modular architecture that allows you to easily extend the viewer, scene objects, materials, shaders, rendering, post-processing and serialization with custom functionality.
- Plugin system along with a rich of built-in plugins that allows you to easily add new features to the viewer.
- [uiconfig](https://github.com/repalash/uiconfig.js) compatibility to automatically generate configuration UIs in the browser.
- Modular rendering pipeline with built-in deferred rendering, post-processing, RGBM HDR rendering, etc.
- Material extension framework to modify/inject/build custom shader code into existing materials at runtime from plugins.
- Extendable asset import, export and management pipeline with built-in support for gltf, glb, obj+mtl, fbx, materials(pmat/bmat), json, zip, png, jpeg, svg, webp, ktx2, ply, 3dm and many more.
- Automatic serialization of all viewer and plugin settings in GLB(with custom extensions) and JSON formats.
- Built-in undo/redo support for user actions.
- Automatic disposal of all three.js resources with built-in reference management.
- Realtime Realistic Rendering with screen-space post-processing effects from [webgi](https://webgi.dev/).
- Animation system(and UI) to create state, keyframe-based animations for any object, material, or viewer property with global timeline.

Checkout the documentation and guides on the [threepipe website](https://threepipe.org) for more details.

## Examples

Code samples and demos covering various usecases and test are present in the [examples](./examples/) folder.

Try them: https://threepipe.org/examples/

View the source code by pressing the code button on the top left of the example page.

To make changes and run the example, click on the CodePen button on the top right of the source code.

## Getting Started

Checkout the full [Getting Started Guide](https://threepipe.org/guide/getting-started.html) on [threepipe.org](https://threepipe.org)

### Local Setup

To create a new project locally

```npm create threepipe@latest```

And follow the instructions to create a new project.

### Stackblitz

Get started with pre-ready templates with model viewer and plugins that run locally directly in your browser -

- [**javascript**](https://stackblitz.com/github/repalash/create-threepipe/tree/master/template-vanilla?file=package.json&title=Threepipe%20Starter)

- [**typescript**](https://stackblitz.com/github/repalash/create-threepipe/tree/master/template-vanilla-ts?file=package.json&title=Threepipe%20Starter)

- [**javascript + plugins**](https://stackblitz.com/github/repalash/create-threepipe/tree/master/template-vanilla-webgi?file=package.json&title=Threepipe%20Starter)

- [**typescript + plugins**](https://stackblitz.com/github/repalash/create-threepipe/tree/master/template-vanilla-webgi-ts?file=package.json&title=Threepipe%20Starter)

- [**javascript + r3f**](https://stackblitz.com/github/repalash/create-threepipe/tree/master/template-r3f-webgi?file=package.json&title=Threepipe%20Starter)

- [**typescript + r3f**](https://stackblitz.com/github/repalash/create-threepipe/tree/master/template-r3f-webgi-ts?file=package.json&title=Threepipe%20Starter)

### HTML/JS Quickstart (CDN)

```html

<canvas id="three-canvas" style="width: 800px; height: 600px;"></canvas>
<script type="module">
  import {ThreeViewer, DepthBufferPlugin} from 'https://unpkg.com/threepipe@latest/dist/index.mjs'

  const viewer = new ThreeViewer({canvas: document.getElementById('three-canvas')})

  // Add some plugins 
  viewer.addPluginSync(new DepthBufferPlugin())
  
  // Load an environment map
  const envPromise = viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
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

Check out the details about the [ThreeViewer API](https://threepipe.org/guide/viewer-api.html) and more [plugins](https://threepipe.org/guide/core-plugins.html).

### React

The best way to use the viewer in react is to wrap it in a custom component.

Here is a sample [react](https://react.dev) component in tsx to render a model with an environment map.

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

### React Three Fiber (R3F)

For a more declarative approach using JSX syntax, you can use the [@threepipe/plugin-r3f](https://threepipe.org/package/plugin-r3f.html) package which provides React Three Fiber integration.

```bash
npm install @threepipe/plugin-r3f
```

Here is a sample [React Three Fiber](https://r3f.docs.pmnd.rs/) component to render a model with an environment map using declarative JSX syntax.

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ViewerCanvas, Asset, Model } from '@threepipe/plugin-r3f'
import { LoadingScreenPlugin } from 'threepipe'

function App() {
  return (
    <ViewerCanvas
      id="three-canvas"
      style={{width: 800, height: 600}}
      plugins={[LoadingScreenPlugin]}
      onMount={async (viewer) => {
        console.log('Viewer mounted:', viewer)
      }}
    >
      <React.Suspense fallback={<mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="orange" />
      </mesh>}>
        <Asset 
          url="https://samples.threepipe.org/minimal/venice_sunset_1k.hdr"
          autoSetBackground={true}
        />
        <Asset 
          url="https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf"
          autoCenter={true}
          autoScale={true}
        />
      </React.Suspense>
    </ViewerCanvas>
  )
}

createRoot(document.getElementById('root')).render(<App />)
```

`ViewerCanvas` is the wrapper around the r3f `Canvas` component that initializes the ThreePipe viewer and provides the viewer context to all child components.

Any children added to this component are added to the scene model root. 

Check it in action: https://threepipe.org/examples/#r3f-tsx-sample/

### NextJs

The best way to use the viewer in nextjs is to wrap it in a custom component.

Here is a sample client side [react](https://react.dev) component with [nextjs](https://nextjs.org) in tsx to render a model with an environment map.

```tsx
'use client'
import React from 'react'
import type {ThreeViewer} from 'threepipe/dist';

export default function ThreeViewerComponent({src, env}: {src: string, env: string}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)

  React.useEffect(() => {
    if (!canvasRef.current) return
    let viewer: ThreeViewer;
    (async () => {
      const { ThreeViewer } = await import('threepipe/dist')
      viewer = new ThreeViewer({ canvas: canvasRef.current!, tonemap: false, rgbm: false, msaa: true })
      viewer.scene.backgroundColor = null

      const envPromise = viewer.setEnvironmentMap(env)
      const modelPromise = viewer.load(src, {autoScale: true, autoCenter: true})

      Promise.all([envPromise, modelPromise]).then(([envMap, model]) => {
        console.log('Loaded', model, envMap, viewer)
      })
    })()
    return () => {if (viewer) viewer.dispose()}
  }, [src, env])

  return <canvas id="three-canvas" style={{
    width: 800, height: 600,
    position: 'absolute', transform: 'translate(-50%, -50%)', top: '50%', left: '50%',
  }} ref={canvasRef}/>
}
```

The component can simply be used on any page

```tsx
<ThreeViewerComponent
  src={"https://sample.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf"}
  env={"https://samples.threepipe.org/minimal/venice_sunset_1k.hdr"}
/>
```

### Vue.js

A sample [vue.js](https://vuejs.org/) component in js to render a model with an environment map.

```js
const ThreeViewerComponent = {
  setup() {
    const canvasRef = ref(null);

    onMounted(() => {
      const viewer = new ThreeViewer({ canvas: canvasRef.value });

      const envPromise = viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr');
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

        const envPromise = viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr');
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

For Svelte 5, simply initialize `canvasRef` to `$state()` -
```js
let canvasRef = $state();
```

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
await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

// Load a model
const result = await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
    autoCenter: true,
    autoScale: true,
})
```

That's it! You should now see a 3D model on your page.

The 3D model can be opened in the [editor](https://threepipe.org/examples/tweakpane-editor/) to view and edit the scene settings, objects, materials, lights, cameras, post-processing, etc. and exported as a GLB file. All settings are automatically serialized and saved in the GLB file, which can be loaded into the viewer. Any plugins used in the editor can be added to the viewer to add the same functionality. The plugin data is automatically loaded(if the plugin is added) when the model is added to the scene.

The viewer initializes with a Scene, Camera, Camera controls(Orbit Controls), several importers, exporters and a default rendering pipeline. Additional functionality can be added with plugins.

Check out the glTF Load example to see it in action or to check the JS equivalent code: https://threepipe.org/examples/#gltf-load/

Check out the [Plugins](https://threepipe.org/guide/features.html#plugin-system) section to learn how to add additional functionality to the viewer.

## License
The core framework([src](https://github.com/repalash/threepipe/tree/master/src), [dist](https://github.com/repalash/threepipe/tree/master/dist), [examples](https://github.com/repalash/threepipe/tree/master/examples) folders) and any [plugins](https://github.com/repalash/threepipe/tree/master/plugins) without a separate license are under the Free [Apache 2.0 license](https://github.com/repalash/threepipe/tree/master/LICENSE).

Some plugins(in the [plugins](https://github.com/repalash/threepipe/tree/master/plugins) folder) might have different licenses. Check the individual plugin documentation and the source folder/files for more details.

## Status
The project is in `beta` stage and under active development. 
Many features will be added but the core API will not change significantly in future releases.

## Table of Contents

- [ThreePipe](#threepipe)
  - [Examples](https://threepipe.org/examples/)
  - [Table of Contents](#table-of-contents)
  - [Getting Started](#getting-started)
    - [HTML/JS Quickstart (CDN)](#htmljs-quickstart-cdn)
    - [React](#react)
    - [React Three Fiber (R3F)](#react-three-fiber-r3f)
    - [Vue.js](#vuejs)
    - [Svelte](#svelte)
    - [NPM/YARN Package](#npmyarn)
      - [Installation](#installation)
      - [Loading a 3D Model](#loading-a-3d-model)
  - [License](#license)
  - [Status](#status)
  - [Documentation (API Reference)](#documentation)
  - [Contributing](#contributing)
- [Features](https://threepipe.org/guide/features.html)
  - [File Formats](https://threepipe.org/guide/features.html#file-formats)
  - [Loading files](https://threepipe.org/guide/features.html#loading-files)
  - [Exporting files](https://threepipe.org/guide/features.html#exporting-files)
  - [Render Pipeline](https://threepipe.org/guide/features.html#render-pipeline)
  - [Material Extension](https://threepipe.org/guide/features.html#material-extension)
  - [UI Configuration](https://threepipe.org/guide/features.html#ui-configuration)
  - [Serialization](https://threepipe.org/guide/features.html#serialization)
  - [Plugin System](https://threepipe.org/guide/features.html#plugin-system)
  - [Timeline](https://threepipe.org/guide/features.html#timeline)
- [Viewer API](https://threepipe.org/guide/viewer-api.html#viewer-api)
  - [ThreeViewer](https://threepipe.org/guide/viewer-api.html#threeviewer)
  - [RenderManager](https://threepipe.org/guide/viewer-api.html#rendermanager)
  - [RootScene](https://threepipe.org/guide/viewer-api.html#rootscene)
  - [ICamera](https://threepipe.org/guide/viewer-api.html#icamera)
  - [AssetManager](https://threepipe.org/guide/viewer-api.html#assetmanager)
    - [AssetImporter](https://threepipe.org/guide/viewer-api.html#assetimporter)
    - [AssetExporter](https://threepipe.org/guide/viewer-api.html#assetexporter)
    - [MaterialManager](https://threepipe.org/guide/viewer-api.html#materialmanager)
  - [Other classes and interfaces](https://threepipe.org/guide/viewer-api.html#other-classes-and-interfaces)
- [Plugins](https://threepipe.org/guide/core-plugins.html#threepipe-plugins)
  - [TonemapPlugin](https://threepipe.org/plugin/TonemapPlugin.html) - Add tonemap to the final screen pass
  - [DropzonePlugin](https://threepipe.org/plugin/DropzonePlugin.html) - Drag and drop local files to import and load
  - [ProgressivePlugin](https://threepipe.org/plugin/ProgressivePlugin.html) - Post-render pass to blend the last frame with the current frame
  - [SSAAPlugin](https://threepipe.org/plugin/SSAAPlugin.html) - Add [Super Sample Anti-Aliasing](https://en.wikipedia.org/wiki/Supersampling) by applying jitter to the camera.
  - [DepthBufferPlugin](https://threepipe.org/plugin/DepthBufferPlugin.html) - Pre-rendering of [depth buffer](https://en.wikipedia.org/wiki/Z-buffering)
  - [NormalBufferPlugin](https://threepipe.org/plugin/NormalBufferPlugin.html) - Pre-rendering of normal buffer ([deferred shading](https://en.wikipedia.org/wiki/Deferred_shading))
  - [GBufferPlugin](https://threepipe.org/plugin/GBufferPlugin.html) - Pre-rendering of depth-normal and flags buffers in a single pass ([deferred shading](https://en.wikipedia.org/wiki/Deferred_shading))
  - [SSAOPlugin](https://threepipe.org/plugin/SSAOPlugin.html) - Add [SSAO(Screen Space Ambient Occlusion)](https://en.wikipedia.org/wiki/Screen_space_ambient_occlusion) for physical materials.
  - [CanvasSnapshotPlugin](https://threepipe.org/plugin/CanvasSnapshotPlugin.html) - Add support for taking snapshots of the canvas with anti-aliasing and other options
  - [PickingPlugin](https://threepipe.org/plugin/PickingPlugin.html) - Adds support for selecting objects in the viewer with user interactions and selection widgets
  - [AssetExporterPlugin](https://threepipe.org/plugin/AssetExporterPlugin.html) - Provides options and methods to export the scene/object GLB or Viewer Configuration JSON
  - [LoadingScreenPlugin](https://threepipe.org/plugin/LoadingScreenPlugin.html) - Shows a configurable loading screen overlay over the canvas
  - [FullScreenPlugin](https://threepipe.org/plugin/FullScreenPlugin.html) - Adds support for moving the canvas or the container fullscreen mode in browsers
  - [InteractionPromptPlugin](https://threepipe.org/plugin/InteractionPromptPlugin.html) - Adds an animated hand icon over canvas to prompt the user to interact
  - [TransformControlsPlugin](https://threepipe.org/plugin/TransformControlsPlugin.html) - Adds support for moving, rotating and scaling objects in the viewer with interactive widgets
  - [ContactShadowGroundPlugin](https://threepipe.org/plugin/ContactShadowGroundPlugin.html) - Adds a ground plane at runtime with contact shadows
  - [GLTFAnimationPlugin](https://threepipe.org/plugin/GLTFAnimationPlugin.html) - Add support for playing and seeking glTF animations
  - [PopmotionPlugin](https://threepipe.org/plugin/PopmotionPlugin.html) - Integrates with popmotion.io library for animation/tweening
  - [AnimationObjectPlugin](https://threepipe.org/plugin/AnimationObjectPlugin.html) - Create and manage keyframe-based animations for any object, material, or viewer property with timeline controls
  - [CameraViewPlugin](https://threepipe.org/plugin/CameraViewPlugin.html) - Add support for saving, loading, animating, looping between camera views
  - [TransformAnimationPlugin](https://threepipe.org/plugin/TransformAnimationPlugin.html) - Add support for saving, loading, animating, between object transforms
  - [RenderTargetPreviewPlugin](https://threepipe.org/plugin/RenderTargetPreviewPlugin.html) - Preview any render target in a UI panel over the canvas
  - [GeometryUVPreviewPlugin](https://threepipe.org/plugin/GeometryUVPreviewPlugin.html) - Preview UVs of any geometry in a UI panel over the canvas
  - [FrameFadePlugin](https://threepipe.org/plugin/FrameFadePlugin.html) - Post-render pass to smoothly fade to a new rendered frame over time
  - [VignettePlugin](https://threepipe.org/plugin/VignettePlugin.html) - Add Vignette effect  by patching the final screen pass
  - [ChromaticAberrationPlugin](https://threepipe.org/plugin/ChromaticAberrationPlugin.html) - Add [Chromatic Aberration](https://en.wikipedia.org/wiki/Chromatic_aberration) effect  by patching the final screen pass
  - [FilmicGrainPlugin](https://threepipe.org/plugin/FilmicGrainPlugin.html) - Add [Filmic Grain](https://en.wikipedia.org/wiki/Film_grain) effect  by patching the final screen pass
  - [NoiseBumpMaterialPlugin](https://threepipe.org/plugin/NoiseBumpMaterialPlugin.html) - Sparkle Bump/Noise Bump material extension for PhysicalMaterial
  - [CustomBumpMapPlugin](https://threepipe.org/plugin/CustomBumpMapPlugin.html) - Adds multiple bump map support and bicubic filtering material extension for PhysicalMaterial
  - [ClearcoatTintPlugin](https://threepipe.org/plugin/ClearcoatTintPlugin.html) - Clearcoat Tint material extension for PhysicalMaterial
  - [FragmentClippingExtensionPlugin](https://threepipe.org/plugin/FragmentClippingExtensionPlugin.html) - Fragment/SDF Clipping material extension for PhysicalMaterial
  - [ParallaxMappingPlugin](https://threepipe.org/plugin/ParallaxMappingPlugin.html) - Relief Parallax Bump Mapping extension for PhysicalMaterial
  - [HDRiGroundPlugin](https://threepipe.org/plugin/HDRiGroundPlugin.html) - Add support for ground projected hdri/skybox to the webgl background shader.
  - [VirtualCamerasPlugin](https://threepipe.org/plugin/VirtualCamerasPlugin.html) - Add support for rendering virtual cameras before the main one every frame.
  - [EditorViewWidgetPlugin](https://threepipe.org/plugin/EditorViewWidgetPlugin.html) - Adds an interactive `ViewHelper`/`AxisHelper` that syncs with the main camera.
  - [Object3DWidgetsPlugin](https://threepipe.org/plugin/Object3DWidgetsPlugin.html) - Automatically create light and camera helpers/gizmos when they are added to the scene.
  - [Object3DGeneratorPlugin](https://threepipe.org/plugin/Object3DGeneratorPlugin.html) - Provides an API and UI to create scene objects like lights, cameras, meshes, etc.
  - [DeviceOrientationControlsPlugin](https://threepipe.org/plugin/DeviceOrientationControlsPlugin.html) - Adds a `controlsMode` to the `mainCamera` for device orientation controls(gyroscope rotation control).
  - [PointerLockControlsPlugin](https://threepipe.org/plugin/PointerLockControlsPlugin.html) - Adds a `controlsMode` to the `mainCamera` for pointer lock controls.
  - [ThreeFirstPersonControlsPlugin](https://threepipe.org/plugin/ThreeFirstPersonControlsPlugin.html) - Adds a `controlsMode` to the `mainCamera` for first person controls from threejs.
  - [GLTFKHRMaterialVariantsPlugin](https://threepipe.org/plugin/GLTFKHRMaterialVariantsPlugin.html) - Support using for variants from KHR_materials_variants extension in glTF models.
  - [Rhino3dmLoadPlugin](https://threepipe.org/plugin/Rhino3dmLoadPlugin.html) - Add support for loading .3dm files ([Rhino 3D](https://www.rhino3d.com/))
  - [PLYLoadPlugin](https://threepipe.org/plugin/PLYLoadPlugin.html) - Add support for loading .ply files
  - [STLLoadPlugin](https://threepipe.org/plugin/STLLoadPlugin.html) - Add support for loading .stl files ([STL](https://en.wikipedia.org/wiki/STL_(file_format)))
  - [KTX2LoadPlugin](https://threepipe.org/plugin/KTX2LoadPlugin.html) - Add support for loading .ktx2 files ([KTX2 - GPU Compressed Textures](https://doc.babylonjs.com/features/featuresDeepDive/materials/using/ktx2Compression))
  - [KTXLoadPlugin](https://threepipe.org/plugin/KTXLoadPlugin.html) - Add support for loading .ktx files (Note - use ktx2)
  - [USDZLoadPlugin](https://threepipe.org/plugin/USDZLoadPlugin.html) - Add partial support for loading .usdz, .usda files ([USDZ](https://en.wikipedia.org/wiki/Universal_Scene_Description))
  - [GLTFMeshOptDecodePlugin](https://threepipe.org/plugin/GLTFMeshOptDecodePlugin.html) - Decode glTF files with [EXT_meshopt_compression](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md) extension.
  - [SimplifyModifierPlugin](https://threepipe.org/plugin/SimplifyModifierPlugin.html) - Boilerplate for plugin to simplify geometries
  - [MeshOptSimplifyModifierPlugin](https://threepipe.org/plugin/MeshOptSimplifyModifierPlugin.html) - Simplify geometries using [meshoptimizer](https://github.com/zeux/meshoptimizer) library
  - [UndoManagerPlugin](https://threepipe.org/plugin/UndoManagerPlugin.html) - Adds support for undo/redo operations in the viewer. Used by other plugins to manage undo history.
  - [ObjectConstraintsPlugin](https://threepipe.org/plugin/ObjectConstraintsPlugin.html) - Add support for constraints between objects like follow path, look at, position/rotation/scale locking, etc.
- [Packages](https://threepipe.org/guide/threepipe-packages.html)
  - [@threepipe/webgi-plugins](https://webgi.dev) - Web [Global Illumination](https://en.wikipedia.org/wiki/Global_illumination) - Realistic rendering plugin pack (SSR, SSRTAO, HDR Bloom, TAA, Depth of Field, SSGI, etc.)
  - [@threepipe/plugin-tweakpane](https://threepipe.org/package/plugin-tweakpane.html) [Tweakpane](https://tweakpane.github.io/docs/) UI Plugin
  - [@threepipe/plugin-blueprintjs](https://threepipe.org/package/plugin-blueprintjs.html) [BlueprintJs](https://blueprintjs.com/) UI Plugin
  - [@threepipe/plugin-tweakpane-editor](https://threepipe.org/package/plugin-tweakpane-editor.html) - Editor Plugin using Tweakpane for plugin UI
  - [@threepipe/plugin-configurator](../package/plugin-configurator) - Provides `MaterialConfiguratorPlugin` and `SwitchNodePlugin` to allow users to select variations
  - [@threepipe/plugin-gltf-transform](https://threepipe.org/package/plugin-gltf-transform.html) - Plugin to transform glTF models (draco compression)
  - [@threepipe/plugins-extra-importers](https://threepipe.org/package/plugins-extra-importers.html) - Plugin for loading more file types supported by loaders in three.js
  - [@threepipe/plugin-blend-importer](https://threepipe.org/package/plugin-blend-importer.html) - Add support for loading .blend file. (Partial/WIP) ([Blender](https://www.blender.org/))
  - [@threepipe/plugin-geometry-generator](https://threepipe.org/package/plugin-geometry-generator.html) - Generate parametric geometry types that can be re-generated from UI/API
  - [@threepipe/plugin-gaussian-splatting](https://threepipe.org/package/plugin-gaussian-splatting.html) - [3D Gaussian Splatting](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/) plugin for loading and rendering splat files
  - [@threepipe/plugin-network](https://threepipe.org/package/plugin-network.html) - Network/Cloud related plugin implementations for Threepipe
  - [@threepipe/plugin-svg-renderer](https://threepipe.org/package/plugin-svg-renderer.html) - Add support for exporting a 3d scene as SVG using [three-svg-renderer](https://www.npmjs.com/package/three-svg-renderer)
  - [@threepipe/plugin-3d-tiles-renderer](https://threepipe.org/package/plugin-3d-tiles-renderer.html) - Plugins for [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS), b3dm, i3dm, cmpt, pnts, dzi, slippy maps importers
  - [@threepipe/plugin-path-tracing](https://threepipe.org/package/plugin-path-tracing.html) - Plugins for [path-tracing](https://en.wikipedia.org/wiki/Path_tracing). Using [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)
  - [@threepipe/plugin-assimpjs](https://threepipe.org/package/plugin-assimpjs.html) - Plugin and helpers to load and use [assimpjs](https://github.com/kovacsv/assimpjs) (with fbx, other exporters) in the browser
  - [@threepipe/plugin-timeline-ui](https://threepipe.org/package/plugin-timeline-ui.html) - A timeline UI component and plugin to manage global viewer timeline and animations
  - [@threepipe/plugin-r3f](https://threepipe.org/package/plugin-r3f.html) - React Three Fiber integration. Provides React components for declarative 3D experiences with ThreePipe viewer context
  - [@threepipe/plugin-troika-text](https://threepipe.org/package/plugin-troika-text.html) - [troika-three-text](https://protectwise.github.io/troika/troika-three-text/) integration plugin that provides high performance SDF Text

## Documentation

Check the list of all functions, classes and types in the [API Reference Docs](https://threepipe.org/docs/).

## Contributing
Contributions to ThreePipe are welcome and encouraged! Feel free to open issues and pull requests on the GitHub repository.

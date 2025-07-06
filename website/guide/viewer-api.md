---
prev:
    text: 'Features'
    link: './features'

next:
    text: 'Core Plugins'
    link: './core-plugins'
---

# Viewer API

`viewer`: [`ThreeViewer`](https://threepipe.org/docs/classes/ThreeViewer.html) - is the main entry point to 3d rendering on the canvas.
- `.scene`: [`RootScene`](https://threepipe.org/docs/classes/RootScene.html) - Main scene used for rendering. Instance of three.js [Scene](https://threejs.org/docs/#api/en/scenes/Scene)
  - `.mainCamera`: [`PerspectiveCamera2`](https://threepipe.org/docs/classes/PerspectiveCamera2.html) - Main camera currently being used for rendering. Instance of three.js [PerspectiveCamera](https://threejs.org/docs/#api/en/cameras/PerspectiveCamera)
- `.renderManager`: [`ViewerRenderManager`](https://threepipe.org/docs/classes/ViewerRenderManager.html) & [RenderManager](https://threepipe.org/docs/classes/RenderManager.html) & [RenderTargetManager](https://threepipe.org/docs/classes/RenderTargetManager.html) - Render manager for managing the rendering and composition pipeline, and provides helpers for rendering and render target management
    - `.renderer`: [`IWebGLRenderer`](https://threepipe.org/docs/interfaces/IWebGLRenderer.html) - for rendering. Instance of three.js [WebGLRenderer](https://threejs.org/docs/#api/en/renderers/WebGLRenderer)
    - `.composer`: [`EffectComposer2`](https://threepipe.org/docs/classes/EffectComposer2.html) - for rendering passes. Instance of three.js [EffectComposer](https://threejs.org/docs/#api/en/postprocessing/EffectComposer)
    - `.context`: [`WebGLRenderingContext`](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext) - WebGL rendering context
    - `.renderPass`: [`ExtendedRenderPass`](https://threepipe.org/docs/classes/ExtendedRenderPass.html) - Render pass for rendering the scene. Instance of three.js [RenderPass](https://threejs.org/docs/#api/en/postprocessing/RenderPass) with extra features
    - `.screenPass`: [`ScreenPass`](https://threepipe.org/docs/classes/ScreenPass.html) - Screen pass for rendering the final output. Instance of three.js [ShaderPass](https://threejs.org/docs/#api/en/postprocessing/ShaderPass) with extra features.
- `.assetManager`: [`AssetManager`](https://threepipe.org/docs/classes/AssetManager.html) - Asset manager for loading, managing and exporting assets
    - `.importer`: [`AssetImporter`](https://threepipe.org/docs/classes/AssetImporter.html) - for importing assets
    - `.exporter`: [`AssetExporter`](https://threepipe.org/docs/classes/AssetExporter.html) - for exporting assets
    - `.materialManager`: [`MaterialManager`](https://threepipe.org/docs/classes/MaterialManager.html) - for managing materials and material extensions
- `.plugins`: `Record<string,`[`IViewerPlugin`](https://threepipe.org/docs/interfaces/IViewerPlugin.html)`>` - Plugins added to the viewer
- `.uiConfig`: [`UiObjectConfig`](https://repalash.com/uiconfig.js/interfaces/UiObjectConfig.html) - UI configuration for the viewer. Used to automatically generate UIs for the viewer and plugins.

## ThreeViewer

Source Code: [src/viewer/ThreeViewer.ts](https://github.com/repalash/threepipe/blob/master/src/viewer/ThreeViewer.ts)

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

  // Set the render scale to render at device resolution and clamp to max 2.
  renderScale: 'auto',
  // or Set the render scale to render at device resolution
  // renderScale: window.devicePixelRatio,
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

::: info Note
All sync functions above have async counterparts like `addPlugin`, `getOrAddPlugin`,
`removePlugin` that are used for async plugins.
There are no async plugins built-in to threepipe yet.
:::

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

[`viewer.load`](https://threepipe.org/docs/classes/ThreeViewer.html#load) - Loads a single asset by path or [IAsset](https://threepipe.org/docs/interfaces/IAsset.html) object, and adds to the scene if its 3d object or loads it if it's a configuration It is the same as [AssetManager.addAssetSingle](https://threepipe.org/docs/classes/AssetManager.html#addAssetSingle). Use [AssetManager.addAsset](https://threepipe.org/docs/classes/AssetManager.html#addAsset) to load multiple assets from the same path as in case of zip bundles.

[`viewer.import`](https://threepipe.org/docs/classes/ThreeViewer.html#import) - Load a single asset but does not add to the scene or load the configuration. It is the same as [AssetManager.importer.importSingle](https://threepipe.org/docs/classes/AssetImporter.html#importSingle). Use [AssetManager.importer.import](https://threepipe.org/docs/classes/AssetImporter.html#import) to import multiple assets from the same path as in case of zip bundles.

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

// Set the final render size directly and fit in container based on mode.
viewer.setRenderSize({width: 800, height: 600}, 'cover')

// Set size of the canvas
viewer.setSize({width: 800, height: 600})
// Set the render scale
viewer.renderManager.renderScale = Math.min(window.devicePixelRatio, 2)


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

[`viewer.setRenderSize`](https://threepipe.org/docs/classes/ThreeViewer.html#setRenderSize) - Sets the rendering resolution and fits the canvas in container based on the mode. The modes are `cover`, `contain`, `fill`, `scale-down` and `none`. The canvas size and render scale is calculated automatically to match the render.

[`viewer.setSize`](https://threepipe.org/docs/classes/ThreeViewer.html#setSize) - Sets the size of the canvas and updates the renderer and the camera. If no width/height is passed, canvas is set to 100% of the container.

[`viewer.traverseSceneObjects`](https://threepipe.org/docs/classes/ThreeViewer.html#traverseSceneObjects) - Loop through all the objects in the scene model root hierarchy and calls the callback function with each object.

[`viewer.resize`](https://threepipe.org/docs/classes/ThreeViewer.html#resize) - Mark that the canvas is resized. If the size is changed, the renderer and all render targets are resized.

[`viewer.setDirty`](https://threepipe.org/docs/classes/ThreeViewer.html#setDirty) - Triggers re-render on next `requestAnimationFrame` call.

[`viewer.getScreenshotBlob`](https://threepipe.org/docs/classes/ThreeViewer.html#getScreenshotBlob) - Returns a blob of the canvas screenshot. The blob can be used to download the screenshot or upload to a server.

[`viewer.getScreenshotDataUrl`](https://threepipe.org/docs/classes/ThreeViewer.html#getScreenshotDataUrl) - Returns a data url of the canvas screenshot. The data url can be used to display the screenshot in an image element.

[`viewer.dispose`](https://threepipe.org/docs/classes/ThreeViewer.html#dispose) - Disposes the viewer and all its resources. Use this to dispose the viewer when it is no longer needed. Note: the canvas element is not removed from the DOM and needs to be removed separately.

## RenderManager

Source Code: [src/viewer/ViewerRenderManager.ts](https://github.com/repalash/threepipe/blob/master/src/viewer/ViewerRenderManager.ts), [src/rendering/RenderManager.ts](https://github.com/repalash/threepipe/blob/master/src/rendering/RenderManager.ts), [src/rendering/RenderTargetManager.ts](.https://github.com/repalash/threepipe/blob/master/src/rendering/RenderTargetManager.ts)

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
const renderTarget2 = renderManager.createTarget({
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
renderManager.clearColor({r: 0, g: 0, b: 0, a: 1, depth: true, viewport: new Vector4()})

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

[`renderManager.renderPass`](https://threepipe.org/docs/classes/ViewerRenderManager.html#renderpass) - The main render pass used in the render pipeline. Instance of three.js [RenderPass](https://threejs.org/docs/#api/en/postprocessing/RenderPass) with extra features like z-prepass, RGBM rendering, blurred transmission, msaa and other optimizations.

[`renderManager.screenPass`](https://threepipe.org/docs/classes/ViewerRenderManager.html#screenpass) - The main screen pass used in the render pipeline. Instance of three.js [ShaderPass](https://threejs.org/docs/#api/en/postprocessing/ShaderPass) with extra features like material extension, custom fragment, overriding read buffer, re-render to screen on change, etc

[`renderManager.renderScale`](https://threepipe.org/docs/classes/RenderManager.html#renderscale) - Sets the render scale. All targets are scaled by this factor. This is equivalent to calling `EffectComposer.setPixelRatio` and `WebGLRenderer.setPixelRatio` in three.js.

[`renderManager.resetShadows`](https://threepipe.org/docs/classes/RenderManager.html#resetshadows) - Resets all shadow maps in the scene. This is useful when some object is moved and the shadows need to be updated. This is automatically called when `scene.setDirty` or any `object.setDirty` is called, and during animation with plugins.

### Rendering Pipeline

[`renderManager.registerPass`](https://threepipe.org/docs/classes/RenderManager.html#registerpass) - Registers a custom composer pass to the render pipeline. See [IPipelinePass](https://threepipe.org/docs/interfaces/IPipelinePass.html) interface.

[`renderManager.unregisterPass`](https://threepipe.org/docs/classes/RenderManager.html#unregisterpass) - Unregisters a custom composer pass from the render pipeline.

[`renderManager.pipeline`](https://threepipe.org/docs/classes/RenderManager.html#pipeline) - The render pipeline array. The array is automatically sorted based on dependencies in the pipeline passes.

[`renderManager.autoBuildPipeline`](https://threepipe.org/docs/classes/RenderManager.html#autobuildpipeline) - If `true`, the pipeline is automatically created and sorted based on dependencies in pipeline pass. If `false`, the pipeline is built only once and is not changed after that. The default value is `true`.

[`renderManager.totalFrameCount`](https://threepipe.org/docs/classes/RenderManager.html#totalframecount) - The total frames rendered since the render manager was created.

[`renderManager.frameCount`](https://threepipe.org/docs/classes/RenderManager.html#framecount) - The current frame count in progressive rendering. This is useful for progressive rendering effects like progressive shadows, gi, denoising, baking, antialiasing, and many other effects.

### Render Targets management

[`renderManager.composerTarget`](https://threepipe.org/docs/classes/RenderManager.html#composertarget), [`renderManager.composerTarget1`](https://threepipe.org/docs/classes/RenderManager.html#composertarget1) - The main targets used in [EffectComposer2](https://threepipe.org/docs/classes/EffectComposer2)

[`renderManager.createTarget`](https://threepipe.org/docs/classes/RenderTargetManager.html#createtarget) - Creates a render target with the given options. The render target is automatically resized when the canvas is resized if `sizeMultiplier` is used. See [CreateRenderTargetOptions](https://threepipe.org/docs/interfaces/CreateRenderTargetOptions.html) for options

[`renderManager.disposeTarget`](https://threepipe.org/docs/classes/RenderTargetManager.html#disposetarget) - Disposes a render target and removes it from the render target manager.

[`renderManager.getTempTarget`](https://threepipe.org/docs/classes/RenderTargetManager.html#gettemptarget) - Gets a temporary render target with the given options. The render target is automatically resized when the canvas is resized if `sizeMultiplier` is used. See [CreateRenderTargetOptions](https://threepipe.org/docs/interfaces/CreateRenderTargetOptions.html) for options

[`renderManager.releaseTempTarget`](https://threepipe.org/docs/classes/RenderTargetManager.html#releasetemptarget) - Releases a temporary render target and adds it back to the render target manager.

[`renderManager.maxTempPerKey`](https://threepipe.org/docs/classes/RenderTargetManager.html#maxtempperkey) - Sets how many temporary targets can remain in memory for a specific set of options. The default value is `5`.

### Helpers

[`renderManager.blit`](https://threepipe.org/docs/classes/RenderManager.html#blit) - Copy a texture to the canvas or another render target with standard or a custom material. See [RendererBlitOptions](https://threepipe.org/docs/interfaces/RendererBlitOptions.html) for options.

[`renderManager.clearColor`](https://threepipe.org/docs/classes/RenderManager.html#clearcolor) - Clears the color of the canvas or a render target.

[`renderManager.exportRenderTarget`](https://threepipe.org/docs/classes/RenderManager.html#exportrendertarget) - Exports a render target to a blob. The type is automatically picked from exr to png based on the render target.

[`renderManager.renderTargetToDataUrl`](https://threepipe.org/docs/classes/RenderManager.html#rendertargettodataurl) - Exports a render target to png/jpeg data url string. This will clamp any floating point targets to fit in png/jpeg. See [RenderTargetToDataUrlOptions](https://threepipe.org/docs/interfaces/RenderTargetToDataUrlOptions.html) for options.

[`renderManager.renderTargetToBuffer`](https://threepipe.org/docs/classes/RenderManager.html#rendertargettobuffer) - Reads render target pixels to a Uint8Array|Uint16Array|Float32Array array buffer.

## RootScene

Source Code: [src/core/object/RootScene.ts](https://github.com/repalash/threepipe/blob/master/src/core/object/RootScene.ts)

API Reference: [RootScene](https://threepipe.org/docs/classes/RootScene.html)

RootScene is the main scene that is rendered in the canvas.
It is an instance of three.js [Scene](https://threejs.org/docs/#api/en/scenes/Scene) with extra features including separation between model root and others,
`backgroundColor`, `background` map and `backgroundIntensity`,
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

[`scene.modelRoot`](https://threepipe.org/docs/classes/RootScene.html#modelroot) - The root object. All the objects loaded in the viewer are added to this object. And this is exported when exporting the gltf. Everything else like meta or UI objects can be added outside this.

[`scene.backgroundColor`](https://threepipe.org/docs/classes/RootScene.html#backgroundcolor) - The background color of the scene. Can be a `Color | null`. This is not the same as `scene.background`. When both backgroundColor and background are set, they are multiplied.

[`scene.background`](https://threepipe.org/docs/classes/RootScene.html#background) - The background of the scene. This is the same as `scene.background` in three.js. This can be a texture or a color or null, but it's preferred to use `scene.backgroundColor` for color, and this for texture, then both can be used together.

[`scene.setBackgroundColor`](https://threepipe.org/docs/classes/RootScene.html#setbackgroundcolor) - Set the background color from a string, number or color. Same as setting `backgroundColor` to a new color value.

[`scene.backgroundIntensity`](https://threepipe.org/docs/classes/RootScene.html#backgroundintensity) - The background intensity of the scene. This is the same as `scene.backgroundIntensity` in three.js.

[`scene.environment`](https://threepipe.org/docs/classes/RootScene.html#environment) - The environment map of the scene. This is the same as `scene.environment` in three.js.

`scene.environment.rotation` - The rotation of the environment map around the y-axis(number).

[`scene.envMapIntensity`](https://threepipe.org/docs/classes/RootScene.html#envmapintensity) - The environment intensity of the scene.

[`scene.fixedEnvMapDirection`](https://threepipe.org/docs/classes/RootScene.html#fixedEnvMapDirection) - If `true`, the environment map is rotated according to the camera. This is the same as `scene.fixedEnvMapDirection` in three.js.

[`scene.mainCamera`](https://threepipe.org/docs/classes/RootScene.html#maincamera) - The main camera used for rendering. This is the same as `scene.mainCamera` in three.js.

[`scene.defaultCamera`](https://threepipe.org/docs/classes/RootScene.html#defaultcamera) - The default camera used for rendering. This is the same as `scene.defaultCamera` in three.js.

[`scene.disposeSceneModels`](https://threepipe.org/docs/classes/RootScene.html#disposescenemodels) - Disposes all assets in the modelRoot.

[`scene.clearSceneModels`](https://threepipe.org/docs/classes/RootScene.html#clearscenemodels) - Removes all objects from the modelRoot.

[`scene.dispose`](https://threepipe.org/docs/classes/RootScene.html#dispose) - Disposes the scene and all its resources and children.

[`scene.getBounds`](https://threepipe.org/docs/classes/RootScene.html#getbounds) - Gets the bounds of the scene model root. Returns an instance of three.js [Box3](https://threejs.org/docs/#api/en/math/Box3) with min and max bounds according to parameters.

[`scene.addObject`](https://threepipe.org/docs/classes/RootScene.html#addobject) - Adds an object to the scene or its model root depending on the options. If `addToRoot` is `true`, the object is added to the model root, else it is added to the scene directly.

[`scene.setDirty`](https://threepipe.org/docs/classes/RootScene.html#setdirty) - Notifies that something has changed in the scene for re-render.

[`scene.refreshScene`](https://threepipe.org/docs/classes/RootScene.html#refreshscene) - Notifies that some object has changed in the scene for scene refresh(like shadow refresh, ground etc.) and re-render. Slower than `setDirty`, as it refreshes shadows, updates bounds, etc.

[`scene.refreshActiveNearFar`](https://threepipe.org/docs/classes/RootScene.html#refreshactivenearfar) - Refreshes active near far. (in most cases this is done automatically and need not be called)

[`scene.loadModelRoot`](https://threepipe.org/docs/classes/RootScene.html#loadmodelroot) - Loads an imported model root from the asset importer. This is used internally and in most cases, you don't need to call this.

### Scene Events

RootScene dispatches many events that are useful when writing app logic or plugins

`'sceneUpdate'` - Listen to `refreshScene` called in RootScene. When some object changes.

`'addSceneObject'` - When a new object is added to the scene

`'mainCameraChange'` - When the main camera is changed to some other camera.

`'mainCameraUpdate'` - When some properties in the current main camera has changed.

`'environmentChanged'` - When the environment map changes

`'backgroundChanged'` - When the background map or color changes

`'materialUpdate`' - When a material in the scene has updated. (setDirty called on the material)

`'objectUpdate`' - When an object in the scene has updated. (setDirty called on the object)

`'textureUpdate`' - When a texture in the scene has updated. (setDirty called on the texture)

`'cameraUpdate`' - When a camera in the scene has updated.
(setDirty called on the camera)

`'geometryUpdate`' - When a geometry in the scene has updated.
(setDirty called on the geometry)

`'geometryChanged`' - When a geometry is changed on any mesh

`'materialChanged'` - When a material is changed on any mesh

Check [IObject3DEventTypes](https://threepipe.org/docs/interfaces/IObject3DEventTypes.html) and[ISceneEventTypes](https://threepipe.org/docs/interfaces/ISceneEventTypes.html) for more information.


## ICamera

Source Code: [src/core/camera/PerspectiveCamera2.ts](https://github.com/repalash/threepipe/blob/master/src/core/camera/PerspectiveCamera2.ts), [src/core/ICamera.ts](https://github.com/repalash/threepipe/blob/master/src/core/ICamera.ts), [src/core/camera/OrthographicCamera2.ts](https://github.com/repalash/threepipe/blob/master/src/core/camera/OrthographicCamera2.ts)

API Reference: [PerspectiveCamera2](https://threepipe.org/docs/classes/PerspectiveCamera2.html), [ICamera](https://threepipe.org/docs/interfaces/ICamera.html), [OrthographicCamera2](https://threepipe.org/docs/classes/OrthographicCamera2.html)

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

[`camera.setInteractions`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#setInteractions) - If `true`, the camera can be interacted with. This is useful when animating the camera or using the window scroll or programmatically automating the viewer. Using this multiple plugins can disable interactions, and it will be enabled again when all of them enable it back.

[`camera.refreshAspect`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#refreshAspect) - Force refresh aspect ratio (this is done automatically with a ResizeObserver on the canvas in the viewer or when `viewer.resize()` is called)

[`camera.activateMain`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#activateMain) - Set the camera as the main camera. This is the same as doing `scene.mainCamera = camera`. The camera needs to be in the scene hierarchy for this to work.

[`camera.deactivateMain`](https://threepipe.org/docs/classes/PerspectiveCamera2.html#deactivateMain) - Deactivate the camera as the main camera.

[`OrbitControls3`](https://threepipe.org/docs/classes/OrbitControls3.html) - An extension of three.js orbit controls with several new features like scroll damping, room bounds, dolly zoom and more.

See also [CameraViewPlugin](../plugin/CameraViewPlugin) for camera focus animation.

::: info Note
The constructor signature of `PerspectiveCamera2` is different `PerspectiveCamera`(from three.js), since it requires the canvas and the controlsMode during creation.
Because of this `PerspectiveCamera0` is provided with the same signature as `PerspectiveCamera` for compatibility, in case the controls functionality is not required.
:::

::: tip Orthographic Projection
Threepipe provides a way to specify the type of the main scene camera when initializing. This is `perspective` by default but can be used as `orthographic` to set the main camera as an orthographic camera.
For most 3d applications, using `orthographic` main camera is not recommended, as it provides a different API and serialized differently. 

To use orthographic projection, it is possible to use the Perspective Camera with a field of view of 1 degree for an approximation, which is good enough for most applications.
This has several additional advantages including the ability to move the camera with scroll in orbit controls, animate between perspective and orthographic(by animating FoV), compatibility with gltf and other formats, compatibility with all post-processing plugins, and use the same API for both cameras.
:::

::: details Orthographic Main Camera
`OrthographicCamera2` is an extension of three.js [OrthographicCamera](https://threejs.org/docs/#api/en/cameras/OrthographicCamera) with extra features like target, automatic frustum management(with aspect), automatic near far management(from RootScene), camera control attachment and hooks(like OrbitControls) and the ability to set as the main camera in the root scene.
It can be used as the main camera by passing the type when creating the `ThreeViewer` instance - 
```typescript
const viewer = new ThreeViewer({
  camera: {
      type: 'orthographic',
  }
})
const camera = viewer.scene.mainCamera as OrthographicCamera2
```

A `OrthographicCamera0` is also provided similar to `PerspectiveCamera0` for compatibility.

As mentioned above, its possible to use perspective camera with a field of view of 1 degree for an approximation - 
```typescript
const viewer = new ThreeViewer({...})
viewer.scene.mainCamera.fov = 1
```
:::

## AssetManager

Source Code: [src/assetmanager/AssetManager.ts](https://github.com/repalash/threepipe/blob/master/src/assetmanager/AssetManager.ts)

API Reference: [AssetManager](https://threepipe.org/docs/classes/AssetManager.html)

`AssetManager` is a class that manages the loading and exporting of assets and provides helpers for caching assets. It is used internally in the viewer and can be used to load assets outside the viewer. It provides a modular framework for adding more asset loaders and exporters.

```typescript
const viewer = new ThreeViewer({...})

const assetManager = viewer.assetManager

// Add an asset or an asset bundle
const assets = await assetManager.addAsset('https://example.com/model.zip')
// or
const assets1 = await assetManager.addAsset({
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
const mat1 = materialManager.create('physical')
const mat2 = materialManager.create('unlit')

// find or create a material by uuid
const mat3 = materialManager.findOrCreate('00000000-0000-0000-0000-000000000000', {color: '#ffffff'})

// find a material creation template 
const template = materialManager.findTemplate('physical')

// Get all materials 
const materials = materialManager.getAllMaterials()

// Get all materials of type
const materials2 = materialManager.getMaterialsOfType(PhysicalMaterial.TypeSlug)

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
const mat4 = materialManager.create('custom')

// convert a standard three.js material to threepipe material 
const mat5 = materialManager.convertToIMaterial(new ShadowMaterial(), {materialTemplate: 'test'})

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

[`assetManager.storage`](https://threepipe.org/docs/classes/AssetManager.html#storage) - Get the storage used in the asset manager for caching. This is the storage that can be passed in the `ThreeViewer` constructor options.

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

[`materialManager.registerMaterialExtension`](https://threepipe.org/docs/classes/MaterialManager.html#registerMaterialExtension) - Register a custom material extension for all materials in the viewer. Requires an instance of [IMaterialExtension](https://threepipe.org/docs/interfaces/IMaterialExtension.html). Material extensions are used to add custom properties, methods, uniforms, defines, shader patches etc. to predefined materials. The extensions are added to the material when the material or extension is registered to the manager.

[`materialManager.unregisterMaterialExtension`](https://threepipe.org/docs/classes/MaterialManager.html#unregisterMaterialExtension) - Unregister a material extension from the manager.

[`materialManager.clearExtensions`](https://threepipe.org/docs/classes/MaterialManager.html#clearExtensions) - Remove all material extensions from the manager.

[`materialManager.applyMaterial`](https://threepipe.org/docs/classes/MaterialManager.html#applyMaterial) - Apply a material properties to other material(s) in the scene by name or uuid. This is useful when you want to change the properties of all materials with a given name or uuid. This can also be a regex, in that case a regex. Match will be performed on the material/object name.

[`materialManager.exportMaterial`](https://threepipe.org/docs/classes/MaterialManager.html#exportMaterial) - Export a material as JSON. Note: use `viewer.export` or `AssetExporter` instead to export all the embedded assets properly.

[`materialManager.dispose`](https://threepipe.org/docs/classes/MaterialManager.html#dispose) - Dispose manager and all materials.

## Other classes and interfaces

Threepipe provides various interfaces and classes for three.js objects with upgraded features like UI events, serialization, etc.
These can be used while developing new apps to get better developer experience and features.
When standard three.js instances are added to the scene, they are automatically upgraded at runtime to make them work with the rest of the framework.

Some important interfaces:

* [IObject3D](https://threepipe.org/docs/interfaces/IObject3D.html) - Interface for an extended version of three.js [Object3D](https://threejs.org/docs/#api/en/core/Object3D).
* [ILight](https://threepipe.org/docs/interfaces/ILight.html) - Interface for an extended version of three.js [Light](https://threejs.org/docs/#api/en/lights/Light).
* [ICamera](https://threepipe.org/docs/interfaces/ICamera.html) - Interface for an extended version of three.js [Camera](https://threejs.org/docs/#api/en/cameras/Camera).
* [IMaterial](https://threepipe.org/docs/interfaces/IMaterial.html) - Interface for an extended version of three.js [Material](https://threejs.org/docs/#api/en/materials/Material).
* [ITexture](https://threepipe.org/docs/interfaces/ITexture.html) - Interface for an extended version of three.js [Texture](https://threejs.org/docs/#api/en/textures/Texture).
* [IRenderTarget](https://threepipe.org/docs/interfaces/IRenderTarget.html) - Interface for an extended version of three.js [WebGLRenderTarget](https://threejs.org/docs/#api/en/renderers/WebGLRenderTarget).
* [IGeometry](https://threepipe.org/docs/interfaces/IGeometry.html) - Interface for an extended version of three.js [BufferGeometry](https://threejs.org/docs/#api/en/core/BufferGeometry).
* [IScene](https://threepipe.org/docs/interfaces/IScene.html) - Interface for an extended version of three.js [Scene](https://threejs.org/docs/#api/en/scenes/Scene).
* [IRenderManager](https://threepipe.org/docs/interfaces/IRenderManager.html) - Interface for rendering and render target manager.

Some important classes

* [Object3D2](https://threepipe.org/docs/classes/Object3D2.html) - Extends three.js [Object3D](https://threejs.org/docs/#api/en/objects/Object3D) and implements [IObject3D](https://threepipe.org/docs/interfaces/IObject3D.html).
* [Mesh2](https://threepipe.org/docs/classes/Mesh2.html) - Extends three.js [Mesh](https://threejs.org/docs/#api/en/objects/Mesh) and implements [IObject3D](https://threepipe.org/docs/interfaces/IObject3D.html).
* [PerspectiveCamera2](https://threepipe.org/docs/classes/PerspectiveCamera2.html) - Extends three.js [PerspectiveCamera](https://threejs.org/docs/#api/en/cameras/PerspectiveCamera) and implements [ICamera](https://threepipe.org/docs/interfaces/ICamera.html). (different constructor than PerspectiveCamera)
* [OrthographicCamera2](https://threepipe.org/docs/classes/OrthographicCamera2.html) - Extends three.js [OrthographicCamera](https://threejs.org/docs/#api/en/cameras/OrthographicCamera) and implements [ICamera](https://threepipe.org/docs/interfaces/ICamera.html). (different constructor than OrthographicCamera)
* [PerspectiveCamera0](https://threepipe.org/docs/classes/PerspectiveCamera0.html) - Extends three.js [PerspectiveCamera](https://threejs.org/docs/#api/en/cameras/PerspectiveCamera) and implements [ICamera](https://threepipe.org/docs/interfaces/ICamera.html). (same constructor than PerspectiveCamera)
* [OrthographicCamera0](https://threepipe.org/docs/classes/OrthographicCamera0.html) - Extends three.js [OrthographicCamera](https://threejs.org/docs/#api/en/cameras/OrthographicCamera) and implements [ICamera](https://threepipe.org/docs/interfaces/ICamera.html). (same constructor than OrthographicCamera)
* [BufferGeometry2](https://threepipe.org/docs/classes/BufferGeometry2.html) - Extends three.js [BufferGeometry](https://threejs.org/docs/#api/en/core/BufferGeometry) and implements [IGeometry](https://threepipe.org/docs/interfaces/IGeometry.html).
* [LineGeometry2](https://threepipe.org/docs/classes/LineGeometry2.html) - Extends three.js [LineGeometry](https://threejs.org/docs/#api/en/core/LineGeometry) and implements [IGeometry](https://threepipe.org/docs/interfaces/IGeometry.html).
* [LineSegmentsGeometry2](https://threepipe.org/docs/classes/LineSegmentsGeometry2.html) - Extends three.js [LineSegmentsGeometry](https://threejs.org/docs/#api/en/core/LineSegmentsGeometry) and implements [IGeometry](https://threepipe.org/docs/interfaces/IGeometry.html).
* [WireframeGeometry3](https://threepipe.org/docs/classes/WireframeGeometry3.html) - Extends three.js [WireframeGeometry2](https://threejs.org/docs/#api/en/core/WireframeGeometry2) and implements [IGeometry](https://threepipe.org/docs/interfaces/IGeometry.html).
* [RootScene](https://threepipe.org/docs/classes/RootScene.html) - Extends three.js [Scene](https://threejs.org/docs/#api/en/scenes/Scene) and implements [IScene](https://threepipe.org/docs/interfaces/IScene.html).
* [RenderManager](https://threepipe.org/docs/classes/RenderManager.html) - Implements [IRenderManager](https://threepipe.org/docs/interfaces/IRenderManager.html).
* [PhysicalMaterial](https://threepipe.org/docs/classes/PhysicalMaterial.html) - Extends three.js [MeshPhysicalMaterial](https://threejs.org/docs/#api/en/materials/MeshPhysicalMaterial) and implements [IMaterial](https://threepipe.org/docs/interfaces/IMaterial.html).
* [UnlitMaterial](https://threepipe.org/docs/classes/UnlitMaterial.html) - Extends three.js [MeshBasicMaterial](https://threejs.org/docs/#api/en/materials/MeshBasicMaterial) and implements [IMaterial](https://threepipe.org/docs/interfaces/IMaterial.html).
* [LineMaterial2](https://threepipe.org/docs/classes/LineMaterial2.html) - Extends three.js [LineMaterial](https://threejs.org/docs/#api/en/materials/LineMaterial) and implements [IMaterial](https://threepipe.org/docs/interfaces/IMaterial.html).
* [ObjectShaderMaterial](https://threepipe.org/docs/classes/ObjectShaderMaterial.html) - Extends three.js [ShaderMaterial](https://threejs.org/docs/#api/en/materials/ShaderMaterial) and implements [IMaterial](https://threepipe.org/docs/interfaces/IMaterial.html) and can be assigned to objects in the scene.
* [ShaderMaterial2](https://threepipe.org/docs/classes/ShaderMaterial2.html) - Extends three.js [ShaderMaterial](https://threejs.org/docs/#api/en/materials/ShaderMaterial) and implements [IMaterial](https://threepipe.org/docs/interfaces/IMaterial.html).
* [ExtendedShaderMaterial](https://threepipe.org/docs/classes/ExtendedShaderMaterial.html) - Extends [ShaderMaterial2](https://threepipe.org/docs/classes/ShaderMaterial2.html) and supports texture access/write with color-space/encoding support.
* [LegacyPhongMaterial](https://threepipe.org/docs/classes/LegacyPhongMaterial.html) - Extends three.js [MeshPhongMaterial](https://threejs.org/docs/#api/en/materials/MeshPhongMaterial) and implements [IMaterial](https://threepipe.org/docs/interfaces/IMaterial.html).
* [UnlitLineMaterial](https://threepipe.org/docs/classes/UnlitLineMaterial.html) - Extends three.js [LineBasicMaterial](https://threejs.org/docs/#api/en/materials/LineBasicMaterial) and implements [IMaterial](https://threepipe.org/docs/interfaces/IMaterial.html).
* [DirectionalLight2](https://threepipe.org/docs/classes/DirectionalLight2.html) - Extends three.js [DirectionalLight](https://threejs.org/docs/#api/en/lights/DirectionalLight) and implements [ILight](https://threepipe.org/docs/interfaces/ILight.html).
* [SpotLight2](https://threepipe.org/docs/classes/SpotLight2.html) - Extends three.js [SpotLight](https://threejs.org/docs/#api/en/lights/SpotLight) and implements [ILight](https://threepipe.org/docs/interfaces/ILight.html).
* [PointLight2](https://threepipe.org/docs/classes/PointLight2.html) - Extends three.js [PointLight](https://threejs.org/docs/#api/en/lights/PointLight) and implements [ILight](https://threepipe.org/docs/interfaces/ILight.html).
* [HemisphereLight2](https://threepipe.org/docs/classes/HemisphereLight2.html) - Extends three.js [HemisphereLight](https://threejs.org/docs/#api/en/lights/HemisphereLight) and implements [ILight](https://threepipe.org/docs/interfaces/ILight.html).
* [AmbientLight2](https://threepipe.org/docs/classes/AmbientLight2.html) - Extends three.js [AmbientLight](https://threejs.org/docs/#api/en/lights/AmbientLight) and implements [ILight](https://threepipe.org/docs/interfaces/ILight.html).
* [RectAreaLight2](https://threepipe.org/docs/classes/RectAreaLight2.html) - Extends three.js [RectAreaLight](https://threejs.org/docs/#api/en/lights/RectAreaLight) and implements [ILight](https://threepipe.org/docs/interfaces/ILight.html).

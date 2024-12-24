
## TonemapPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#tonemap-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/postprocessing/TonemapPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/TonemapPlugin.html)

TonemapPlugin adds a post-processing material extension to the ScreenPass in render manager
that applies tonemapping to the color. The tonemapping operator can be changed
by setting the `toneMapping` property of the plugin. The default tonemapping operator is `ACESFilmicToneMapping`.

Other Tonemapping properties can be like `exposure`, `contrast` and `saturation`

TonemapPlugin is added by default in ThreeViewer unless `tonemap` is set to `false` in the options.

## DropzonePlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#dropzone-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/DropzonePlugin.ts) &mdash;
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
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/pipeline/ProgressivePlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ProgressivePlugin.html)

Progressive Plugin adds a post-render pass to blend the last frame with the current frame.

This is used as a dependency in other plugins for progressive rendering effect which is useful for progressive shadows, gi, denoising, baking, anti-aliasing, and many other effects. The helper function `convergedPromise` returns a new promise that can be used to wait for the progressive rendering to converge.

## SSAAPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#ssaa-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/pipeline/SSAAPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/SSAAPlugin.html)

SSAA Plugin adds support for [Super Sampling Anti-Aliasing](https://en.wikipedia.org/wiki/Supersampling) to the viewer. Simply add the plugin to the viewer to use it.

It jitters the camera view offset over multiple frames, which are then blended by the [ProgressivePlugin](#progressiveplugin) to create a higher quality image. This is useful for reducing aliasing artifacts in the scene.

By default, the pipeline only renders once per request animation frame. So we don't get any anti-aliasing while moving. For that, either use the TAA(Temporal Anti-aliasing) plugin or for the case of simple scenes - render multiple times per frame which can be done by setting `plugin.rendersPerFrame` or `viewer.rendersPerFrame`. Check out the [example](https://threepipe.org/examples/#ssaa-plugin/) to see the effect on frame rate.

```typescript

const ssaa = viewer.addPluginSync(new SSAAPlugin())

ssaa.enabled = true // toggle jittering(if you want to set custom view offset)

ssaa.rendersPerFrame = 4 // render 4 times per frame (max 32 is useful)
```

## DepthBufferPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#depth-buffer-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/pipeline/DepthBufferPlugin.ts) &mdash;
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
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/pipeline/NormalBufferPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/NormalBufferPlugin.html)

Normal Buffer Plugin adds a pre-render pass to the render manager and renders a normal buffer to a target. The render target can be accessed by other plugins throughout the rendering pipeline to create effects like SSAO, SSR, etc.

::: info NOTE
Use [`GBufferPlugin`](#GBufferPlugin) if using both `DepthBufferPlugin` and `NormalBufferPlugin` to render both depth and normal buffers in a single pass.
:::

```typescript
import {ThreeViewer, NormalBufferPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const normalPlugin = viewer.addPluginSync(new NormalBufferPlugin())

const normalTarget = normalPlugin.target;

// Use the normal target by accessing `normalTarget.texture`.
```

## GBufferPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#gbuffer-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/pipeline/GBufferPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/GBufferPlugin.html)

GBuffer Plugin adds a pre-render pass to the render manager and renders depth+normals to a target and some customizable flags to another. The multiple render target and textures can be accessed by other plugins throughout the rendering pipeline to create effects like SSAO, SSR, etc.

```typescript
import {ThreeViewer, GBufferPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const gBufferPlugin = viewer.addPluginSync(new GBufferPlugin())

const gBuffer = gBufferPlugin.target;
const normalDepth = gBufferPlugin.normalDepthTexture;
const gBufferFlags = gBufferPlugin.flagsTexture;
```

## SSAOPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#ssao-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/pipeline/SSAOPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/SSAOPlugin.html)

SSAO Plugin adds support for [Screen Space Ambient Occlusion](https://en.wikipedia.org/wiki/Screen_space_ambient_occlusion) to the viewer. Simply add the plugin to the viewer to use it.

This is done by adding a pre-render pass to the render manager which renders SSAO to a custom render target. SSAOPlugin depends on [GBufferPlugin](#gbufferplugin), and is automatically added if not already.

This render target is then used by all PhysicalMaterial(s) in the scene during the main RenderPass to get the AO data. SSAO can also be disabled from the UI of the material.

Note: Use with [ProgressivePlugin](#progressiveplugin) and `TemporalAAPlugin` for best results.

```typescript
import {ThreeViewer, SSAOPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const ssaoPlugin = viewer.addPluginSync(new SSAOPlugin())

// get the buffer. 
console.log(ssaoPlugin.target);

// disable ssao for a material in the scene
material.userData.ssaoDisabled = true
```
> In the target/buffer - The ssao data is in the `r` channel to remain compatible with ORM. `gba` contains the depth in vec3(xyz) format.
> Note that its `ssaoDisabled`, so setting it to `true` will disable the effect.


## CanvasSnapshotPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#canvas-snapshot-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/export/CanvasSnapshotPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/CanvasSnapshotPlugin.html)

Canvas Snapshot Plugin adds support for taking snapshots of the canvas and exporting them as images and data urls. It includes options to take snapshot of a region, mime type, quality render scale and scaling the output image. Check out the interface [CanvasSnapshotOptions](https://threepipe.org/docs/interfaces/CanvasSnapshotOptions.html) for more details.

```typescript
import {ThreeViewer, CanvasSnapshotPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const snapshotPlugin = viewer.addPluginSync(new CanvasSnapshotPlugin())

// download a snapshot.
await snapshotPlugin.downloadSnapshot('image.webp', { // all parameters are optional
  scale: 1, // scale the final image
  timeout: 0, // wait before taking the snapshot, in ms
  quality: 0.9, // quality of the image (0-1) only for jpeg and webp
  displayPixelRatio: 2, // render scale 
  mimeType: 'image/webp', // mime type of the image
  waitForProgressive: true, // wait for progressive rendering to finish (ProgressivePlugin). true by default
  rect: { // region to take snapshot. eg. crop center of the canvas
    height: viewer.canvas.clientHeight / 2,
    width: viewer.canvas.clientWidth / 2,
    x: viewer.canvas.clientWidth / 4,
    y: viewer.canvas.clientHeight / 4,
  },
})

// get data url (string)
const dataUrl = await snapshotPlugin.getDataUrl({ // all parameters are optional
  displayPixelRatio: 2, // render scale 
  mimeType: 'image/webp', // mime type of the image
})

// get File
const file = await snapshotPlugin.getFile('file.jpeg', { // all parameters are optional
  mimeType: 'image/jpeg', // mime type of the image
})
```

## PickingPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#picking-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/PickingPlugin.ts) &mdash;
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

## FullScreenPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#fullscreen-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/FullScreenPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/FullScreenPlugin.html)

A simple plugin that provides functions to enter, exit and toggle full screen mode and check if the viewer is in full screen mode. Either the canvas or the whole container can be set to full screen.

```typescript
import {ThreeViewer, FullScreenPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const fullscreen = viewer.addPluginSync(new FullScreenPlugin())

// enter full screen
await fullscreen.enter(viewer.container) // viewer.canvas is used if no element is passed
// exit full screen
await fullscreen.exit()
// toggle
await fullscreen.toggle(viewer.container)
// check if full screen
console.log(fullScreenPlugin.isFullScreen())
```

## AssetExporterPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#asset-exporter-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/export/AssetExporterPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/AssetExporterPlugin.html)

Asset Exporter Plugin provides options and methods to export the scene, object GLB or Viewer Config.
All the functionality is available in the viewer(and `AssetExporter`) directly, this plugin only provides a ui-config and maintains state of the options which is saved as plugin configuration along with glb/vjson file

```typescript
import {ThreeViewer, AssetExporterPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const assetExporter = viewer.addPluginSync(new AssetExporterPlugin())
// check the existing options
console.log(assetExporter.exportOptions)
// enable/disable viewer config/json embedding in glb
assetExporter.viewerConfig = true
// set encryption
assetExporter.encrypt = true
assetExporter.encryptKey = 'superstrongpassword' // comment this to get prompted for a key during export.

// export scene as blob
const blob = assetExporter.exportScene()
// or export and download directly 
assetExporter.downloadSceneGlb()

// export a specific object
const object = viewer.scene.getObjectByName('objectName')
const blob2 = assetExporter.exportObject(object, true) // true to also download
```
Note: when downloading the model through the plugin, it uses viewer.export, which downloads the files by default, but uploads it to remote destinations when overloaded using `FileTransferPlugin`.

## FileTransferPlugin

[//]: # (todo: image)

[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/export/FileTransferPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/FileTransferPlugin.html)

Provides a way to extend the viewer.export functionality with custom actions. It also maintains a process state for plugins like `LoadingScreenPlugin`.

This plugin is added automatically, there is no need to use it manually, unless writing a plugin to extend the export functionality.

Used in eg `AWSClientPlugin` to upload files directly to S3.

## LoadingScreenPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#loading-screen-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/LoadingScreenPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/LoadingScreenPlugin.html)

Loading Screen Plugin adds configurable overlay with a logo, loading text, spinner and the list of loading items. It also provides options to minimize and maximize the loading popup when there is no objects in the scene.

The overlay is automatically added to the viewer container and shown when any files are loading. Behaviour can be configured to change how its shown and hidden, and can even be triggered programmatically.

```typescript
import {ThreeViewer, LoadingScreenPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const loadingScreen = viewer.addPluginSync(new LoadingScreenPlugin())
loadingScreen.loadingTextHeader = 'Loading Helmet 3D Model'
loadingScreen.errorTextHeader = 'Error Loading Helmet 3D Model'
loadingScreen.showFileNames = true
loadingScreen.showProcessStates = true
loadingScreen.showProgress = true
loadingScreen.backgroundOpacity = 0.4 // 0-1
loadingScreen.backgroundBlur = 28 // px
```

See also the base class [AAssetManagerProcessStatePlugin](https://threepipe.org/docs/classes/AAssetManagerProcessStatePlugin.html) to write a custom loading plugin.

## InteractionPromptPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#interaction-prompt-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/InteractionPromptPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/InteractionPromptPlugin.html)

Interaction Prompt Plugin adds a hand pointer icon over the canvas that moves to prompt the user to interact with the 3d scene. To use, simply add the plugin to the viewer.

The default pointer icon from [google/model-viewer](https://github.com/google/model-viewer) and can be configured with the `pointerIcon` property.

The pointer is automatically shown when some object is in the scene and the camera is not moving.

The animation starts after a delay and stops on user interaction. It then restarts after a delay after the user stops interacting

The plugin provides several options and functions to configure the automatic behaviour or trigger the animation manually.

```typescript
import {ThreeViewer, InteractionPromptPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const interactionPrompt = viewer.addPluginSync(new InteractionPromptPlugin())

// change duration
interactionPrompt.animationDuration = 3000
// change animation distance in pixels 
interactionPrompt.animationDistance = 100

// disable auto start when the camera stops
interactionPrompt.autoStart = false
interactionPrompt.autoStop = false
// manually start and stop 
interactionPrompt.startAnimation()
// ...
interactionPrompt.stopAnimation()
```

Note - The pointer is automatically shown/hidden when animation is started/stopped.

## TransformControlsPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#transform-controls-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/TransformControlsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/TransformControlsPlugin.html)

Transform Controls Plugin adds support for moving, rotating and scaling objects in the viewer with interactive widgets.

Under the hood, TransformControlsPlugin uses [TransformControls2](https://threepipe.org/docs/classes/TransformControls2) to provide the interactive controls, it is a extended version of three.js [TransformControls](https://threejs.org/docs/#examples/en/controls/TransformControls).

When the plugin is added to the viewer, it interfaces with the [PickingPlugin](#pickingplugin) and shows the control gizmos when an object is selected and hides them when the object is unselected.

If the `PickingPlugin` is not added to the viewer before the `TransformControlsPlugin`, it is added automatically with the plugin.

```typescript
import {ThreeViewer, TransformControlsPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const transfromControlsPlugin = viewer.addPluginSync(new TransformControlsPlugin())

// Get the underlying transform controls
console.log(transfromControlsPlugin.transformControls)
```

## ContactShadowGroundPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#contact-shadow-ground-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/ContactShadowGroundPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ContactShadowGroundPlugin.html)

Contact Shadow Ground Plugin adds a ground plane with three.js contact shadows to the viewer scene.

The plane is added to the scene root at runtime and not saved with scene export. Instead the plugin settings are saved with the scene.

It inherits from the base class [BaseGroundPlugin](https://threepipe.org/docs/classes/BaseGroundPlugin.html) which provides generic ground plane functionality. Check the source code for more details. With the property `autoAdjustTransform`, the ground plane is automatically adjusted based on the bounding box of the scene.

```typescript
import {ThreeViewer, ContactShadowGroundPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

viewer.addPluginSync(new ContactShadowGroundPlugin())
```

## GLTFAnimationPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#gltf-animation-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/animation/GLTFAnimationPlugin.ts) &mdash;
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
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/animation/PopmotionPlugin.ts) &mdash;
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
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/animation/CameraViewPlugin.ts) &mdash;
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

## TransformAnimationPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#transform-animation-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/animation/TransformAnimationPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/TransformAnimationPlugin.html)

TransformAnimationPlugin adds support to save and load transform(position, rotation, scale) states for objects in the scene, which can then be animated to.
It uses PopmotionPlugin internally to animate any object to a saved transform object.

The transformations are saved in the object userData, and can be created and interacted with from the plugin.

It also provides a UI to manage the states, this UI is added to the object's uiConfig and can be accessed using the object UI or PickingPlugin. Check the example for a working demo.

Sample Usage -
```javascript
import {TransformAnimationPlugin, ThreeViewer, Vector3, Quaternion, EasingFunctions, timeout} from 'threepipe'

const viewer = new ThreeViewer({...})

const model = viewer.scene.getObjectByName('model')

const transformAnim = viewer.addPluginSync(new TransformAnimationPlugin())

// Save the current state of the model as a transform
transformAnim.addTransform(model, 'initial')

// Rotate/Move the model and save other transform states
// left
model.rotation.set(0, Math.PI / 2, 0)
model.setDirty?.()
transformAnim.addTransform(model, 'left')

// top
model.rotation.set(Math.PI / 2, 0, 0)
model.setDirty?.()
transformAnim.addTransform(model, 'top')

// up
model.position.set(0, 2, 0)
model.lookAt(viewer.scene.mainCamera.position)
model.setDirty?.()
transformAnim.addTransform(model, 'up')

// animate to a transform(from current position) in 1 sec
const anim = transformAnim.animateTransform(model, 'left', 1000)
// to stop the animation
// anim.stop()
// wait for the animation to finish
await anim.promise

// set a transform without animation
transformAnim.setTransform(model, 'top')

// await directly.
await transformAnim.animateToTransform(model, 'up', 1000)?.promise
```

## RenderTargetPreviewPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#render-target-preview/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/ui/RenderTargetPreviewPlugin.ts) &mdash;
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
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/ui/GeometryUVPreviewPlugin.ts) &mdash;
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
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/pipeline/FrameFadePlugin.ts) &mdash;
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
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/postprocessing/VignettePlugin.ts) &mdash;
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
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/postprocessing/ChromaticAberrationPlugin.ts) &mdash;
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
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/postprocessing/FilmicGrainPlugin.ts) &mdash;
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
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/material/NoiseBumpMaterialPlugin.ts) &mdash;
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
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/material/CustomBumpMapPlugin.ts) &mdash;
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
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/material/ClearcoatTintPlugin.ts) &mdash;
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
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/material/FragmentClippingExtensionPlugin.ts) &mdash;
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

## ParallaxMappingPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#parallax-mapping-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/material/ParallaxMappingPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ParallaxMappingPlugin.html)

`ParallaxMappingPlugin` adds a material extension to PhysicalMaterial to add support for [parallax relief mapping](https://en.wikipedia.org/wiki/Relief_mapping_(computer_graphics)). The idea is to walk along a ray that has entered the bumpmap's volume, finding the intersection point of the ray with the bumpmap. [Steep parallax mapping](https://en.wikipedia.org/wiki/Parallax_mapping) and [parallax occlusion mapping](https://en.wikipedia.org/wiki/Parallax_occlusion_mapping) are other common names for these techniques.

To use the plugin, add the plugin to the viewer and use the `bumpMap` in `PhysicalMaterial` normally. The max height is determined by the `bumpScale` in the material. This is assumed to be in world scale.

```typescript
import {ThreeViewer, ParallaxMappingPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const parallaxMapping = viewer.addPluginSync(ParallaxMappingPlugin)

// load or create an object 

// set the bump map
object.material.bumpMap = await viewer.load<ITexture>(bumps[0]) || null
// set the bump scale
object.material.bumpScale = 0.1
// setDirty to notify the viewer to update.
object.material.setDirty()
```

### References and related links:

- WebGL implementation by Rabbid76 - [github.com/Rabbid76/graphics-snippets](https://github.com/Rabbid76/graphics-snippets/blob/master/html/technique/parallax_005_parallax_relief_mapping_derivative_tbn.html)
- Lesson on Parallax Occlusion Mapping in GLSL - [http://sunandblackcat.com/tipFullView.php?topicid=28](https://web.archive.org/web/20190128023901/http://sunandblackcat.com/tipFullView.php?topicid=28)
- Learn OpenGL - https://learnopengl.com/Advanced-Lighting/Parallax-Mapping

## HDRiGroundPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#hdri-ground-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/HDRiGroundPlugin.ts) &mdash;
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
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/rendering/VirtualCamerasPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/VirtualCamerasPlugin.html)

VirtualCamerasPlugin adds support for rendering to multiple virtual cameras in the viewer. These cameras are rendered in preRender callback just before the main camera is rendered. The virtual cameras can be added to the plugin and removed from it.

The feed to the virtual camera is rendered to a Render Target texture which can be accessed and re-rendered in the scene or used in other plugins.

```typescript
import {ThreeViewer, VirtualCamerasPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const virtualCameras = viewer.addPluginSync(new VirtualCamerasPlugin())

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

Check the [virtual camera](https://threepipe.org/examples/#virtual-camera/) example for using the texture in the scene.

## EditorViewWidgetPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#editor-view-widget-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/EditorViewWidgetPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/EditorViewWidgetPlugin.html)

EditorViewWidgetPlugin adds a ViewHelper in the parent of the viewer canvas to show the current camera view and allow the user to change the camera view to one of the primary world axes.

Simply add the plugin to the viewer to see the widget.

```typescript
import {ThreeViewer, EditorViewWidgetPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const plugin = viewer.addPluginSync(new EditorViewWidgetPlugin())

// to hide the widget
plugin.enabled = false
```

## Object3DWidgetsPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#object3d-widgets-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/Object3DWidgetsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/Object3DWidgetsPlugin.html)

Object3DWidgetsPlugin adds support for light and camera helpers/gizmos in the viewer.
A helper is automatically created when any supported light or camera is added to the scene.
Simply add the plugin to the viewer to see the widget.

Support for additional types of helpers can be added dynamically or by other plugins by pushing a helper constructor to the `Object3DWidgetsPlugin.helpers` array, and calling `Object3DWidgetsPlugin.refresh()`.

The helper class prototype should implement the `IObject3DHelper` interface. Check `DirectionalLightHelper2` for an example.

```typescript
import {ThreeViewer, Object3DWidgetsPlugin, Object3DGeneratorPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

// Add the plugin to add support
const plugin = viewer.addPluginSync(new Object3DWidgetsPlugin())

// Add some lights or cameras to the scene. (This can be done before adding the plugin as well)
// Using Object3DGeneratorPlugin to create a camera and add it to the scene.
const generator = viewer.getOrAddPluginSync(Object3DGeneratorPlugin)
generator.generate('camera-perspective', {
  position: new Vector3(5, 5, 0),
  name: 'My Camera'
})

// to hide the widgets
plugin.enabled = false

// to add support for a custom helper
plugin.helpers.push(MyCustomHelper)
plugin.refresh()

```

## Object3DGeneratorPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#object3d-generator-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/Object3DGeneratorPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/Object3DGeneratorPlugin.html)

Object3DGeneratorPlugin adds support for creating different types of lights and camera objects in the viewer.
Call the `generate` method with any type to generate a type of object(like lights, cameras, mesh etc).

Support for the following types of generators is included in the plugin:
* camera-perspective - Creates instance of `PerspectiveCamera2`
* light-directional - Creates instance of `DirectionalLight2`
* light-ambient - Creates instance of `AmbientLight2`
* light-point - Creates instance of `PointLight2`
* light-spot - Creates instance of `SpotLight2`
* light-hemisphere - Creates instance of `HemisphereLight2`
* light-rect-area - Creates instance of `RectAreaLight2`

Additional types of generators can be added dynamically or by other plugins by adding a custom generator function to the `Object3DGeneratorPlugin.generators` object. This is done by [GeometryGeneratorPlugin](#threepipeplugin-geometry-generator) to add various type of primitive objects like plane, sphere, etc
A custom generator can take in any kind object as parameters and should return an `IObject3D`.

Sample Usage
```typescript
import {ThreeViewer, Object3DWidgetsPlugin, Object3DGeneratorPlugin, Mesh2} from 'threepipe'

const viewer = new ThreeViewer({...})

const generator = viewer.addPluginSync(Object3DGeneratorPlugin)
generator.generate('camera-perspective', {
  position: new Vector3(5, 5, 0),
  name: 'My Camera'
})
const light = generator.generate('light-spot', {
  position: new Vector3(5, 0, 0),
})

// to add support for a custom helper
plugin.generators['custom-object'] = (params)=>{
  const object = new Mesh2(new PlaneGeometry(1,1), new PhysicalMaterial())
  object.name = params.name ?? 'Custom Mesh'
  if(params.position) object.position.copy(params.position)
  return object
}
const obj = generator.generate('custom-object', {
  position: new Vector3(5, 0, 0),
})

// Add Object3DWidgetsPlugin to see the added lights and cameras.
viewer.addPluginSync(new Object3DWidgetsPlugin())
```

Check the [example](https://threepipe.org/examples/#object3d-generator-plugin/) for the UI.

## DeviceOrientationControlsPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#device-orientation-controls-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/DeviceOrientationControlsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/DeviceOrientationControlsPlugin.html)

DeviceOrientationControlsPlugin enables controlling the main camera rotation in the scene with device orientation. This only works on devices which have a gyroscope(but can also be emulated in devtools in chrome).
After the plugin is added, it adds support for setting `deviceOrientation` as the key in `scene.mainCamera.controlMode`.

When the controls is started (for the first time), the current camera rotation is and the device orientation is saved and used as reference. To reset the saved device orientation, call `resetView` in the controls.

Sample Usage
```typescript
import {ThreeViewer, DeviceOrientationControlsPlugin, Mesh2} from 'threepipe'

const viewer = new ThreeViewer({...})

viewer.addPluginSync(DeviceOrientationControlsPlugin)

// after some user action
viewer.scene.mainCamera.controlsMode = 'deviceOrientation'

// to reset the saved device orientation
viewer.scene.mainCamera.controls.resetView()

// switch back to default orbit controls
viewer.scene.mainCamera.controlsMode = 'orbit'
```

## PointerLockControlsPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#pointer-lock-controls-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/PointerLockControlsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/PointerLockControlsPlugin.html)

PointerLockControlsPlugin adds support for using PointerLockControls from three.js. It works similar to controls in first person shooter, captures the mouse pointer and uses it to look around with the camera.

After the plugin is added, it adds support for setting `pointerLock` as the key in `scene.mainCamera.controlMode`.

Sample Usage
```typescript
import {ThreeViewer, PointerLockControlsPlugin, Mesh2} from 'threepipe'

const viewer = new ThreeViewer({...})

viewer.addPluginSync(PointerLockControlsPlugin)

// after some user action
viewer.scene.mainCamera.controlsMode = 'pointerLock'

// listen to lock/unlock events 
viewer.scene.mainCamera.controls?.addEventListener('lock', ()=> console.log('pointer locked'))
viewer.scene.mainCamera.controls?.addEventListener('unlock', ()=> console.log('pointer unlocked'))

// switch back to default orbit controls
viewer.scene.mainCamera.controlsMode = 'orbit'
```

## ThreeFirstPersonControlsPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#three-first-person-controls-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/ThreeFirstPersonControlsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ThreeFirstPersonControlsPlugin.html)

ThreeFirstPersonControlsPlugin adds support for using FirstPersonControls from three.js. It works similar to idle look around in first person games, it does not captures the mouse pointer.

After the plugin is added, it adds support for setting `threeFirstPerson` as the key in `scene.mainCamera.controlMode`.

Sample Usage
```typescript
import {ThreeViewer, ThreeFirstPersonControlsPlugin, Mesh2} from 'threepipe'

const viewer = new ThreeViewer({...})

viewer.addPluginSync(ThreeFirstPersonControlsPlugin)

// after some user action
viewer.scene.mainCamera.controlsMode = 'threeFirstPerson'

// switch back to default orbit controls
viewer.scene.mainCamera.controlsMode = 'orbit'
```

## GLTFKHRMaterialVariantsPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#gltf-khr-material-variants-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/GLTFKHRMaterialVariantsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/GLTFKHRMaterialVariantsPlugin.html)

GLTFKHRMaterialVariantsPlugin adds support for importing and exporting glTF models with the `KHR_materials_variants` extension to load the model with different material variants/combinations. It also provides API and UI to change the current material variant.

The plugin automatically adds support for the extension when added to the viewer.

The materials are stored in `object.userData._variantMaterials` and are automatically loaded and saved when using the `GLTFLoader`.

Sample Usage
```typescript
import {ThreeViewer, GLTFKHRMaterialVariantsPlugin, Mesh2} from 'threepipe'

const viewer = new ThreeViewer({...})

const variantsPlugin = viewer.addPluginSync(GLTFKHRMaterialVariantsPlugin)

// load some model
await viewer.load(model_url)

// list of all variants in the model (names and objects)
console.log(variantsPlugin.variants) 

// change the selected variant
variantsPlugin.selectedVariant = 'beach'
```

### Links

- https://www.khronos.org/blog/blender-gltf-i-o-support-for-gltf-pbr-material-extensions
- https://www.khronos.org/blog/streamlining-3d-commerce-with-material-variant-support-in-gltf-assets
- https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_variants/README.md

## Rhino3dmLoadPlugin

[Example](https://threepipe.org/examples/#rhino3dm-load/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/import/Rhino3dmLoadPlugin.ts) &mdash;
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
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/import/PLYLoadPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/PLYLoadPlugin.html)

Adds support for loading .ply ([Polygon file format](https://en.wikipedia.org/wiki/PLY_(file_format))) files.

```typescript
import {PLYLoadPlugin} from 'threepipe'
viewer.addPluginSync(new PLYLoadPlugin())

const mesh = await viewer.load('file.ply')
```

## USDZLoadPlugin

[Example](https://threepipe.org/examples/#usdz-load/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/import/USDZLoadPlugin.ts) &mdash;
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
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/import/STLLoadPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/STLLoadPlugin.html)

Adds support for loading .stl ([Stereolithography](https://en.wikipedia.org/wiki/STL_(file_format))) files.

```typescript
import {STLLoadPlugin} from 'threepipe'
viewer.addPluginSync(new STLLoadPlugin())

const mesh = await viewer.load('file.stl')
```

## KTX2LoadPlugin

[Example](https://threepipe.org/examples/#ktx2-load/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/import/KTX2LoadPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/KTX2LoadPlugin.html)

Adds support for loading .ktx2 ([Khronos Texture](https://www.khronos.org/opengles/sdk/tools/KTX/file_format_spec/) files with asset manager and embedded in glTF files.

KTX2LoadPlugin also adds support for exporting loaded .ktx2 files in glTF files with the [KHR_texture_basisu](https://www.khronos.org/registry/KHR/textures/2.0-extensions/KHR_texture_basisu/) extension.

```typescript
import {KTX2LoadPlugin} from 'threepipe'
viewer.addPluginSync(new KTX2LoadPlugin())

const texture = await viewer.load('file.ktx2')
```

## KTXLoadPlugin

[Example](https://threepipe.org/examples/#ktx-load/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/import/KTXLoadPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/KTXLoadPlugin.html)

Adds support for loading .ktx ([Khronos Texture](https://www.khronos.org/opengles/sdk/tools/KTX/file_format_spec/) files.

Note: This plugin only adds support for loading .ktx file, and not exporting them in the bundled .glb.  Use .ktx2 files instead of .ktx files for better compression and performance.

```typescript
import {KTXLoadPlugin} from 'threepipe'
viewer.addPluginSync(new KTXLoadPlugin())

const texture = await viewer.load('file.ktx')
```

## GLTFMeshOptDecodePlugin

[Example](https://threepipe.org/examples/#gltf-meshopt-compression/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/import/GLTFMeshOptDecodePlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/GLTFMeshOptDecodePlugin.html)

Loads the MeshOpt Decoder module from [meshoptimizer](https://github.com/zeux/meshoptimizer) library at runtime from a customisable cdn url.
The loaded module is set in `window.MeshoptDecoder` and then used by `GLTFLoader2` to decode files using [EXT_meshopt_compression](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md) extension

```typescript
import {GLTFMeshOptDecodePlugin} from 'threepipe'
const plugin = viewer.addPluginSync(new GLTFMeshOptDecodePlugin())
// await plugin.initialize() // optional, this happens when loading a gltf file with extension anyway

const texture = await viewer.load('file.glb')
```

## SimplifyModifierPlugin

[Example](https://threepipe.org/examples/#simplify-modifier-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/SimplifyModifierPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/SimplifyModifierPlugin.html)

Boilerplate for implementing a plugin for simplifying geometries.
This is a base class and cannot be used directly.

A sample to use it:
```typescript
class SimplifyModifierPluginImpl extends SimplifyModifierPlugin {
  protected _simplify(geometry: IGeometry, count: number) {
    return new SimplifyModifier().modify(geometry, count) as IGeometry
  }
}

const plugin = viewer.addPluginSync(new SimplifyModifierPluginImpl())

const root = await viewer.load('file.glb')
plugin.simplifyAll(root, {factor: 0.75})
```
Check the [example](https://threepipe.org/examples/#simplify-modifier-plugin/) for full implementation.

## MeshOptSimplifyModifierPlugin

[Example](https://threepipe.org/examples/#meshopt-simplify-modifier-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/MeshOptSimplifyModifierPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/MeshOptSimplifyModifierPlugin.html)

Simplify modifier using [meshoptimizer](https://github.com/zeux/meshoptimizer) library. It Loads the library at runtime from a customisable CDN URL.

Note: It does not guarantee that the geometry will be simplified to the exact target count.

```typescript
const simplifyModifier = viewer.addPluginSync(new MeshOptSimplifyModifierPlugin())

const root = await viewer.load('file.glb')
simplifyModifier.simplifyAll(root, {factor: 0.75})
```

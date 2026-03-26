---
prev: 
    text: 'PopmotionPlugin'
    link: './PopmotionPlugin'

next: 
    text: 'TransformAnimationPlugin'
    link: './TransformAnimationPlugin'

---

# CameraViewPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#camera-view-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/animation/CameraViewPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/CameraViewPlugin.html)

`CameraViewPlugin` adds support to save and load camera views, which can then be animated to.
It uses `PopmotionPlugin` internally to animate any camera to a saved view or to loop through all the saved views.

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

### Fit to Object

The plugin also provides methods to animate or instantly set the camera to frame specific objects:

```typescript
const cameraViewPlugin = viewer.getPlugin(CameraViewPlugin)

// Animate camera to fit a specific object
await cameraViewPlugin.animateToFitObject(myObject, 1.5, 1000, 'easeInOutSine')

// Instant fit (no animation) — pass duration=0
await cameraViewPlugin.animateToFitObject(myObject, 1.5, 0)

// Animate to a specific target position and distance
await cameraViewPlugin.animateToTarget(5, new Vector3(0, 0, 0), 1000)

// Instant target set (no animation)
await cameraViewPlugin.animateToTarget(5, new Vector3(0, 0, 0), 0)

// These also work via the viewer shortcut:
await viewer.fitToView(myObject, 1.5, 1000) // animated
await viewer.fitToView(myObject, 1.5, 0)    // instant
```

`animateToFitObject` accepts `Object3D`, materials, textures, or geometries — materials/textures/geometries are resolved to their applied meshes automatically.

For instant (non-animated) fitting directly on the camera, see [`camera.fitObject()`](../guide/viewer-api#camera).

### Animation Duration Scaling

The fit functions (`animateToFitObject`, `animateToTarget`, `animateToObject`) always enable `normalizeDuration` on `PopmotionPlugin.animateCamera`, which scales the animation duration based on how far the camera needs to travel. If the camera is already at the target position, the animation is skipped entirely. For small movements, the duration is proportionally shorter — preventing the canvas from feeling "locked" when the camera barely needs to move.

When calling `animateToView` directly, `normalizeDuration` is enabled by default only when no explicit duration is provided. It can also be controlled via the `normalizeDuration` parameter.

---
prev: 
    text: 'CameraViewPlugin'
    link: './CameraViewPlugin'

next: 
    text: 'RenderTargetPreviewPlugin'
    link: './RenderTargetPreviewPlugin'

---

# TransformAnimationPlugin

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

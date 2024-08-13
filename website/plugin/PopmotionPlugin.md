---
prev: 
    text: 'GLTFAnimationPlugin'
    link: './GLTFAnimationPlugin'

next: 
    text: 'CameraViewPlugin'
    link: './CameraViewPlugin'

---

# PopmotionPlugin

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

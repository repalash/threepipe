---
prev: 
    text: 'AnimationObjectPlugin'
    link: './AnimationObjectPlugin'

next: 
    text: 'PopmotionPlugin'
    link: './PopmotionPlugin'

---

# GLTFAnimationPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#gltf-animation-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/animation/GLTFAnimationPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/GLTFAnimationPlugin.html)

Manages playback of GLTF animations.

The GLTF animations can be created in any 3d software that supports GLTF export like Blender.
If animations from multiple files are loaded, they will be merged in a single root object and played together.

The time playback is managed automatically, but can be controlled manually by setting [autoIncrementTime](https://threepipe.org/docs/classes/GLTFAnimationPlugin.html#autoincrementtime) to false and using [setTime](https://threepipe.org/docs/classes/GLTFAnimationPlugin.html#settime) to set the time.

This plugin is made for playing, pausing, stopping, all the animations at once, while it is possible to play individual animations, it is not recommended.

To play individual animations, with custom choreography, use the [`GLTFAnimationPlugin.animations`](https://threepipe.org/docs/classes/GLTFAnimationPlugin.html#animations) property to get reference to the animation clips and actions. Create your own mixers and control the animation playback like in three.js

---
prev: 
    text: 'LoadingScreenPlugin'
    link: './LoadingScreenPlugin'

next: 
    text: 'TransformControlsPlugin'
    link: './TransformControlsPlugin'

---

# InteractionPromptPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#interaction-prompt-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/InteractionPromptPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/InteractionPromptPlugin.html)

Interaction Prompt Plugin adds a hand pointer icon over the canvas that moves to prompt the user to interact with the 3d scene. To use, simply add the plugin to the viewer.

The default pointer icon from [google/model-viewer](https://github.com/google/model-viewer) and can be configured with the `pointerIcon` property.

The pointer is automatically shown when some object is in the scene and the camera are not moving.

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

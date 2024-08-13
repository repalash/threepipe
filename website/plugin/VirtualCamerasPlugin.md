---
prev: 
    text: 'HDRiGroundPlugin'
    link: './HDRiGroundPlugin'

next: 
    text: 'EditorViewWidgetPlugin'
    link: './EditorViewWidgetPlugin'

---

# VirtualCamerasPlugin

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

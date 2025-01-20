---
prev: 
    text: 'DeviceOrientationControlsPlugin'
    link: './DeviceOrientationControlsPlugin'

next: 
    text: 'ThreeFirstPersonControlsPlugin'
    link: './ThreeFirstPersonControlsPlugin'

---

# PointerLockControlsPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#pointer-lock-controls-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/PointerLockControlsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/PointerLockControlsPlugin.html)

PointerLockControlsPlugin adds support for using PointerLockControls from three.js. It works similar to controls in first-person shooter, captures the mouse pointer and uses it to look around with the camera.

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

---
prev: 
    text: 'Object3DGeneratorPlugin'
    link: './Object3DGeneratorPlugin'

next: 
    text: 'PointerLockControlsPlugin'
    link: './PointerLockControlsPlugin'

---

# DeviceOrientationControlsPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#device-orientation-controls-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/DeviceOrientationControlsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/DeviceOrientationControlsPlugin.html)

DeviceOrientationControlsPlugin enables controlling the main camera rotation in the scene with device orientation. This only works on devices which have a gyroscope(but can also be emulated in devtools in chrome).
After the plugin is added, it adds support for setting `deviceOrientation` as the key in `scene.mainCamera.controlMode`.

When the controls are started (for the first time), the current camera rotation is and the device orientation is saved and used as reference. To reset the saved device orientation, call `resetView` in the controls.

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

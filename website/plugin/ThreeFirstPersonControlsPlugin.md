---
prev: 
    text: 'PointerLockControlsPlugin'
    link: './PointerLockControlsPlugin'

next: 
    text: 'GLTFKHRMaterialVariantsPlugin'
    link: './GLTFKHRMaterialVariantsPlugin'

---

# ThreeFirstPersonControlsPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#three-first-person-controls-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/ThreeFirstPersonControlsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ThreeFirstPersonControlsPlugin.html)

ThreeFirstPersonControlsPlugin adds support for using FirstPersonControls from three.js. It works similar to idle look around in first person games, it does not capture the mouse pointer.

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

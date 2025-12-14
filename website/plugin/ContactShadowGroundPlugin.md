---
prev: 
    text: 'TransformControlsPlugin'
    link: './TransformControlsPlugin'

next: 
    text: 'GLTFAnimationPlugin'
    link: './GLTFAnimationPlugin'

aside: false
---

# ContactShadowGroundPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#contact-shadow-ground-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/ContactShadowGroundPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ContactShadowGroundPlugin.html)

<iframe src="https://threepipe.org/examples/contact-shadow-ground-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Bloom Plugin Example"></iframe>

Contact Shadow Ground Plugin adds a ground plane with three.js contact shadows to the viewer scene.

The plane is added to the scene root at runtime and not saved with scene export. Instead, the plugin settings are saved with the scene.

It inherits from the base class [BaseGroundPlugin](https://threepipe.org/docs/classes/BaseGroundPlugin.html) which provides generic ground plane functionality. Check the source code for more details. With the property `autoAdjustTransform`, the ground plane is automatically adjusted based on the bounding box of the scene.

```typescript
import {ThreeViewer, ContactShadowGroundPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

viewer.addPluginSync(new ContactShadowGroundPlugin())
```

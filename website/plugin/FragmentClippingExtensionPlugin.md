---
prev: 
    text: 'ClearcoatTintPlugin'
    link: './ClearcoatTintPlugin'

next: 
    text: 'ParallaxMappingPlugin'
    link: './ParallaxMappingPlugin'

---

# FragmentClippingExtensionPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#fragment-clipping-extension-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/material/FragmentClippingExtensionPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/FragmentClippingExtensionPlugin.html)

FragmentClippingExtensionPlugin adds a material extension to PhysicalMaterial to add support for fragment clipping.
Fragment clipping allows to clip fragments of the material in screen space or world space based on a circle, rectangle, plane, sphere, etc.
It uses fixed SDFs with params defined by the user for clipping.
It also adds a UI to the material to edit the settings.
It uses `WEBGI_materials_fragment_clipping_extension` glTF extension to save the settings in glTF/glb files.

```typescript
import {ThreeViewer, FragmentClippingExtensionPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const fragmentClipping = viewer.addPluginSync(FragmentClippingExtensionPlugin)

// add initial properties
FragmentClippingExtensionPlugin.AddFragmentClipping(material, {
  clipPosition: new Vector4(0.5, 0.5, 0, 0),
  clipParams: new Vector4(0.1, 0.05, 0, 1),
})

// Change properties with code or use the UI
material.userData._fragmentClipping!.clipPosition.set(0, 0, 0, 0)
material.setDirty()

// Disable
material.userData._clearcoatTint.clipEnabled = false
material.setDirty()
```

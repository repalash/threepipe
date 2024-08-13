---
prev: 
    text: 'CustomBumpMapPlugin'
    link: './CustomBumpMapPlugin'

next: 
    text: 'FragmentClippingExtensionPlugin'
    link: './FragmentClippingExtensionPlugin'

---

# ClearcoatTintPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#clearcoat-tint-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/material/ClearcoatTintPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ClearcoatTintPlugin.html)

ClearcoatTintPlugin adds a material extension to PhysicalMaterial which adds tint and thickness to the built-in clearcoat properties.
It also adds a UI to the material to edit the settings.
It uses `WEBGI_materials_clearcoat_tint` glTF extension to save the settings in glTF/glb files.

```typescript
import {ThreeViewer, ClearcoatTintPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const clearcoatTint = viewer.addPluginSync(ClearcoatTintPlugin)

material.clearcoat = 1
// add initial properties
ClearcoatTintPlugin.AddClearcoatTint(material, {
  tintColor: '#ff0000',
  thickness: 1,
})

// Change properties with code or use the UI
material.userData._clearcoatTint!.tintColor = '#ff0000'
material.setDirty()

// Disable
material.userData._clearcoatTint.enableTint = false
material.setDirty()
```

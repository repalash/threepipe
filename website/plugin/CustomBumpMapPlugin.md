---
prev: 
    text: 'NoiseBumpMaterialPlugin'
    link: './NoiseBumpMaterialPlugin'

next: 
    text: 'ClearcoatTintPlugin'
    link: './ClearcoatTintPlugin'

---

# CustomBumpMapPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#custom-bump-map-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/material/CustomBumpMapPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/CustomBumpMapPlugin.html)

CustomBumpMapPlugin adds a material extension to PhysicalMaterial to support custom bump maps.
A Custom bump map is similar to the built-in bump map, but allows using an extra bump map and scale to give a combined effect.
This plugin also has support for bicubic filtering of the custom bump map and is enabled by default.
It also adds a UI to the material to edit the settings.
It uses `WEBGI_materials_custom_bump_map` glTF extension to save the settings in glTF/glb files.

```typescript
import {ThreeViewer, CustomBumpMapPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const customBump = viewer.addPluginSync(CustomBumpMapPlugin)

// Add noise bump to a material
customBump.enableCustomBump(material, bumpMap, 0.2)

// Change properties with code or use the UI
material.userData._customBumpMat = texture
material.setDirty()

// Disable
material.userData._hasCustomBump = false
// or 
material.userData._customBumpMat = null
material.setDirty()
```

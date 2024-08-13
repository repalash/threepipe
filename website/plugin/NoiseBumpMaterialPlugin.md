---
prev: 
    text: 'FilmicGrainPlugin'
    link: './FilmicGrainPlugin'

next: 
    text: 'CustomBumpMapPlugin'
    link: './CustomBumpMapPlugin'

---

# NoiseBumpMaterialPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#noise-bump-material-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/material/NoiseBumpMaterialPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/NoiseBumpMaterialPlugin.html)

NoiseBumpMaterialPlugin adds a material extension to PhysicalMaterial to add support for sparkle bump / noise bump by creating procedural bump map from noise to simulate sparkle flakes.
It uses voronoise function from blender along with several additions to generate the noise for the generation.
It also adds a UI to the material to edit the settings.
It uses `WEBGI_materials_noise_bump` glTF extension to save the settings in glTF/glb files.

```typescript
import {ThreeViewer, NoiseBumpMaterialPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const noiseBump = viewer.addPluginSync(NoiseBumpMaterialPlugin)

// Add noise bump to a material
NoiseBumpMaterialPlugin.AddNoiseBumpMaterial(material, {
  flakeScale: 300,
})

// Change properties with code or use the UI
material.userData._noiseBumpMat!.bumpNoiseParams = [1, 1]
material.setDirty()

// Disable
material.userData._noiseBumpMat!.hasBump = false
material.setDirty()
```

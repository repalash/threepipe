---
prev: 
    text: 'ThreeFirstPersonControlsPlugin'
    link: './ThreeFirstPersonControlsPlugin'

next: 
    text: 'Rhino3dmLoadPlugin'
    link: './Rhino3dmLoadPlugin'

---

# GLTFKHRMaterialVariantsPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#gltf-khr-material-variants-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/GLTFKHRMaterialVariantsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/GLTFKHRMaterialVariantsPlugin.html)

GLTFKHRMaterialVariantsPlugin adds support for importing and exporting glTF models with the `KHR_materials_variants` extension to load the model with different material variants/combinations. It also provides API and UI to change the current material variant.

The plugin automatically adds support for the extension when added to the viewer.

The materials are stored in `object.userData._variantMaterials` and are automatically loaded and saved when using the `GLTFLoader`.

Sample Usage
```typescript
import {ThreeViewer, GLTFKHRMaterialVariantsPlugin, Mesh2} from 'threepipe'

const viewer = new ThreeViewer({...})

const variantsPlugin = viewer.addPluginSync(GLTFKHRMaterialVariantsPlugin)

// load some model
await viewer.load(model_url)

// list of all variants in the model (names and objects)
console.log(variantsPlugin.variants) 

// change the selected variant
variantsPlugin.selectedVariant = 'beach'
```

## Links

- https://www.khronos.org/blog/blender-gltf-i-o-support-for-gltf-pbr-material-extensions
- https://www.khronos.org/blog/streamlining-3d-commerce-with-material-variant-support-in-gltf-assets
- https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_variants/README.md

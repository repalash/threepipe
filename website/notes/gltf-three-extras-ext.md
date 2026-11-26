---
prev:
  text: 'Using Vanilla Three.js style code'
  link: './vanilla-threejs'

next:
  text: 'Follow Path Constraint Animation'
  link: './follow-path-constraint'

aside: false
---

# Saving three.js properties in glTF

Threepipe support saving three.js object, material and light properties in glTF files automatically.

This is done using custom glTF extensions that are added to the glTF file when exporting.

If the files exported from threepipe exporter plugin or any of the editors is opened in external three.js editor, it cannot read these extra properties without the extensions support.

## Extensions

- `WEBGI_object3d_extras` 
  - Implemented in [GLTFObject3DExtrasExtension](https://threepipe.org/docs/classes/GLTFObject3DExtrasExtension.html)
  - This extension saves additional properties of `Object3D` like `visible`, `castShadow`, `frustumCulled`, etc. 
  - Reference from three.js -> `ObjectLoader`
- `WEBGI_material_extras` 
  - Implemented in [GLTFMaterialExtrasExtension](https://threepipe.org/docs/classes/GLTFMaterialExtrasExtension.html)
  - This extension saves additional properties of `Material` like `emissiveIntensity`, `flatShading`, `blending`, etc.
  - Reference from three.js -> `MaterialLoader`
- `WEBGI_light_extras` 
  - Implemented in [GLTFLightExtrasExtension](https://threepipe.org/docs/classes/GLTFLightExtrasExtension.html)
  - This extension saves additional properties of `Light` like `shadow`.
  - This is used alongside `WEBGI_object3d_extras` extension for Light objects
- `WEBGI_lights_ambient`
  - Implemented in [GLTFLightsAmbientExtension](https://threepipe.org/docs/classes/GLTFLightsAmbientExtension.html)
  - Saves ambient and hemisphere lights (`AmbientLight`, `HemisphereLight`), which `KHR_lights_punctual` does not have (it has directional, point and spot lights).
  - Laid out like `KHR_lights_punctual`: the lights are in an array at the root of the file, and a node uses one by its index. On import the node is the light, with its name and transform.
  - A hemisphere light takes its sky direction from the world origin to the node's position, as in three.js.
  ```json
  "extensions": {"WEBGI_lights_ambient": {"lights": [
      {"type": "ambient", "color": [1, 1, 1], "intensity": 0.5},
      {"type": "hemisphere", "color": [0.6, 0.8, 1], "groundColor": [0.3, 0.25, 0.2], "intensity": 1}
  ]}},
  "nodes": [{"name": "Ambient", "extensions": {"WEBGI_lights_ambient": {"light": 0}}}]
  ```
  - `color` and `groundColor` are linear sRGB, default `[1, 1, 1]`; `intensity` is the three.js intensity, default 1.
- `WEBGI_materials_alphamap`
  - Implemented in [GLTFMaterialsAlphaMapExtension](https://threepipe.org/docs/classes/GLTFMaterialsAlphaMapExtension.html)
  - This extension saves the alpha map texture for materials that have an `alphaMap` property.
- `WEBGI_materials_bumpmap`
  - Implemented in [GLTFMaterialsBumpMapExtension](https://threepipe.org/docs/classes/GLTFMaterialsBumpMapExtension.html)
  - This extension saves the bump map texture for materials that have an `bumpMap` property.
- `WEBGI_materials_displacementmap`
  - Implemented in [GLTFMaterialsDisplacementMapExtension](https://threepipe.org/docs/classes/GLTFMaterialsDisplacementMapExtension.html)
  - This extension saves the displacement map texture for materials that have an `displacementMap` property.
- `WEBGI_materials_lightmap`
  - Implemented in [GLTFMaterialsLightMapExtension](https://threepipe.org/docs/classes/GLTFMaterialsLightMapExtension.html)
  - This extension saves the light map texture for materials that have an `lightMap` property.
- `WEBGI_viewer`
  - Implemented in [GLTFViewerConfigExtension](https://threepipe.org/docs/classes/GLTFViewerConfigExtension.html)
  - Saves all the `ThreeViewer`, `RootScene`, `RenderManager` and all plugin configurations in the glTF file as JSON object. Textures are saved as binary blob or base64 encoded string depending on the file format.

Threepipe includes some more extensions that are defined within plugins like `customBumpMapGLTFExtension`, `clearCoatTintGLTFExtension` etc. 

These custom extensions are written as standard three.js GLTFLoader and GLTFExporter extensions, so they can _ideally_ be used with any three.js project.

## glTF Transform Extensions

It's possible to use the custom extensions with the [gltf-transform](https://gltf-transform.donmccurdy.com/) library as well.

To do that, a custom extension implementation/class has to be created. Fortunately, in threepipe this can be done automatically at runtime. 
`@threepipe/plugin-gltf-transform` package provides `createGenericExtensionClass` function, and can be used to create an extension class that can be used with glTF Transform library.

```typescript
const MyExtension = createGenericExtensionClass(GLTFMaterialsLightMapExtension.WebGiMaterialsLightMapExtension, GLTFMaterialsLightMapExtension.Textures)
const io = new WebIO().registerExtensions([MyExtension])
```

`WEBGI_lights_ambient` keeps its lights at the root of the file, which the generic class does not read, so it has its own class, `GLTFLightsAmbientExtensionGP` (with `AmbientLightGP` for a light, like `KHRLightsPunctual` and `Light` of `@gltf-transform/extensions`).

It is also possible to get all the extensions supported for `gltf-transform` using the `GLTFDracoExportPlugin` - 
```typescript
const plugin = viewer.getPlugin(GLTFDracoExportPlugin) // add the plugin before if not added
const ALL_THREEPIPE_EXTENSIONS = plugin.gltfTransformExtensions
const io = new WebIO().registerExtensions(ALL_THREEPIPE_EXTENSIONS)
```

Checkout the [Serialization guide](./../guide/serialization) for more details on how to serialize and deserialize js in threepipe.

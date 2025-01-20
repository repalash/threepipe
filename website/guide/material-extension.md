---
prev:
    text: 'Render Pipeline'
    link: './render-pipeline'

next:
    text: 'UI Configuration'
    link: './ui-config'
---

# Material Extension

Threepipe includes a Material extension system along with a material manager.
The material manager is used to register materials and material extensions.

The material extensions can extend any material in the scene, or any plugin/pass with additional uniforms, defines, shader snippets and provides hooks.

The material extensions are automatically applied to all materials in the scene that are compatible,
when the extension is registered or when the material(the object it's assigned to) is added to the scene.

Threepipe includes several built-in materials like [PhysicalMaterial](https://threepipe.org/docs/classes/PhysicalMaterial.html), [UnlitMaterial](https://threepipe.org/docs/classes/UnlitMaterial.html), [ExtendedShaderMaterial](https://threepipe.org/docs/classes/ExtendedShaderMaterial.html), [LegacyPhongMaterial](https://threepipe.org/docs/classes/LegacyPhongMaterial.html), that include support for extending the material. Any existing three.js material can be made extendable, check the `ShaderPass2` class for a simple example that adds support for material extension to three.js ShaderPass.

Several Plugins create and register material extensions to add different kinds of rendering features over the standard three.js materials like [ClearcoatTintPlugin](https://threepipe.org/docs/classes/ClearcoatTintPlugin.html), [SSAOPlugin](https://threepipe.org/docs/classes/SSAOPlugin.html), [CustomBumpMapPlugin](https://threepipe.org/docs/classes/CustomBumpMapPlugin.html), [AnisotropyPlugin](https://threepipe.org/docs/classes/AnisotropyPlugin.html), [FragmentClippingExtensionPlugin](https://threepipe.org/docs/classes/FragmentClippingExtensionPlugin.html), etc. They also provide uiConfig that can be used to dynamically generate UI or the material extensions.

Some plugins also expose their material extensions to be used by other passes/plugins to access properties like buffers, synced uniforms, defines etc. Like [GBufferPlugin](https://threepipe.org/docs/classes/GBufferPlugin.html), [DepthBufferPlugin](https://threepipe.org/docs/classes/DepthBufferPlugin.html), [NormalBufferPlugin](https://threepipe.org/docs/classes/NormalBufferPlugin.html), etc.

The material extensions must follow the [MaterialExtension](https://threepipe.org/docs/interfaces/MaterialExtension.html) interface.
Many plugins create their own material extensions either for the scene materials or shader passes(like the screen pass). Some plugins like `DepthBufferPlugin` also provides helper material extensions for other custom plugins to fetch value in the depth buffer.

A sample material extension
```typescript
const extension: MaterialExtension = {
    shaderExtender: (shader)=> { 
        // change the shader properties like shader.fragmentShader, etc
        // similar to onBeforeCompile
    },
    parsFragmentSnippet: ` // add some code before the main function in the fragment shader
    uniform sampler2D tTexture;
    uniform float opacity;
    `,
    extraUniforms: {
      tTexture: ()=>({value: getTexture()}),
      opacity: {value: 1}
      // add additional uniforms, these can be IUniform or functions that return IUniform
    },
    extraDefines: {
      ['DEPTH_PACKING']: BasicDepthPacking,
      ['SOME_DEFINE']: ()=>"1",
      // add additional defines, these can be values or functions that return values 
    },
    priority: 100, // priority when using multiple extensions on the same material
    isCompatible: (material) => material.isMeshBasicMaterial, // check if the material is compatible with this extension,
    computeCacheKey: (material) => material.uuid, // a custom cache key for the material extension. Shader is recompiled when this is changed
    onObjectRender: (object: Object3D, material: IMaterial) => {
      // called when some object is rendererd which has a material with this extension.
    },
    // uiConfig
    // check more properties and hooks in the MaterialExtension interface
}

// The extension can be registered to all the materials using the MaterialManager
viewer.assetManager.materialManager.registerMaterialExtension(extension)

// or register it on a single material (like the Screen Pass)
viewer.renderManager.screenPass.material.registerMaterialExtensions([extension])
```

[//]: # (todo add example)

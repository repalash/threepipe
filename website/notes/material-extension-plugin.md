---
prev:
  text: 'Follow Path Constraint Animation'
  link: './follow-path-constraint'
  
next: 
  text: 'Dynamically Loaded Files'
  link: './dynamically-loaded-files'

aside: false
---

# Creating a Custom Material Extension Plugin

While simple material extensions provide powerful shader modification capabilities, creating complete plugins that handle UI configuration, serialization, and glTF export/import provides a professional, reusable solution.

This guide demonstrates how to build complete material extension plugins using the `CustomBumpMapPlugin` as a detailed example.

::: tip Background

The concepts here apply to any material extension plugin, not just bump mapping. You can create plugins for effects like clearcoat tinting, anisotropy, iridescence, etc.

Read the [Material Extension guide](../guide/material-extension) first to understand the basics of material extensions before writing a plugin.

:::

Custom Bump Map Plugin adds a custom bump map extension to Physical Materials in the scene, that allow us to add a secondary bump map on top of the regular bump map with bicubic filtering support.

<iframe src="https://threepipe.org/examples/custom-bump-map-plugin/" style="width:100%;height:600px;border:none;" loading="lazy" title="Threepipe Custom Bump Map Plugin Example"></iframe>

## Plugin Architecture Overview

A complete material extension plugin typically includes:

1. **Plugin Class**: Extends `AViewerPluginSync` or `AViewerPluginAsync`
2. **Material Extension**: The core extension that modifies shaders
3. **UI Configuration**: Automatic UI generation for material properties
4. **Serialization**: Save/load plugin state and material properties
5. **glTF Extension**: Import/export custom properties in glTF files
6. **Shader Code**: Custom GLSL code for the extension

## Complete Plugin Example: CustomBumpMapPlugin

The [CustomBumpMapPlugin](https://github.com/repalash/threepipe/blob/master/src/plugins/material/CustomBumpMapPlugin.ts) demonstrates all these concepts in a production-ready implementation.

### 1. Plugin Class Structure

```typescript
@uiFolderContainer('Custom BumpMap (MatExt)')
export class CustomBumpMapPlugin extends AViewerPluginSync {
    static readonly PluginType = 'CustomBumpMapPlugin'

    @uiToggle('Enabled', (that: CustomBumpMapPlugin)=>({onChange: that.setDirty}))
    @serialize() 
    enabled = true

    @uiToggle('Bicubic', (that: CustomBumpMapPlugin)=>({onChange: that.setDirty}))
    @serialize() 
    bicubicFiltering = true

    // Material extension implementation
    readonly materialExtension: MaterialExtension = {
        // ...extension implementation
    }

    onAdded(v: ThreeViewer) {
        super.onAdded(v)
        // Register the material extension globally
        v.assetManager.materials.registerMaterialExtension(this.materialExtension)
        // Register glTF extension for import/export
        v.assetManager.registerGltfExtension(customBumpMapGLTFExtension)
    }

    onRemove(v: ThreeViewer) {
        // Clean up registrations
        v.assetManager.materials?.unregisterMaterialExtension(this.materialExtension)
        v.assetManager.unregisterGltfExtension(customBumpMapGLTFExtension.name)
        return super.onRemove(v)
    }
}
```

**Key Features:**
- `@uiFolderContainer`: Creates UI folder for plugin settings
- `@uiToggle`: Adds checkbox controls with change callbacks
- `@serialize`: Marks properties for automatic serialization
- Plugin lifecycle management in `onAdded`/`onRemove`

### 2. Material Extension with UI Integration

```typescript
readonly materialExtension: MaterialExtension = {
    // Shader code injection
    parsFragmentSnippet: (_, material: PhysicalMaterial) => {
        if (this.isDisabled() || !material?.userData._hasCustomBump) return ''
        return CustomBumpMapPluginShader // External GLSL file (string)
    },

    // Dynamic uniform updates per object
    onObjectRender: (object: IObject3D, material) => {
        const userData = material.userData
        if (!userData?._hasCustomBump) return
        
        // Update uniforms based on material properties
        const tex = userData._customBumpMap?.isTexture ? userData._customBumpMap : null
        this._uniforms.customBumpMap.value = tex
        this._uniforms.customBumpScale.value = tex ? userData._customBumpScale ?? 0 : 0
        
        if (tex) {
            tex.updateMatrix()
            this._uniforms.customBumpUvTransform.value.copy(tex.matrix)
        }
    },

    // Cache key for shader compilation optimization
    computeCacheKey: (material1: PhysicalMaterial) => {
        return (this.enabled ? '1' : '0') + 
               (material1.userData._hasCustomBump ? '1' : '0') + 
               material1.userData?._customBumpMap?.uuid
    },

    // Material compatibility check
    isCompatible: (material1: PhysicalMaterial) => material1.isPhysicalMaterial,

    // Dynamic UI configuration for materials. The UI Config is created and cached for each material its attached to.
    getUiConfig: material => {
        const enableCustomBump = this.enableCustomBump.bind(this)
        const state = material.userData

        const config: UiObjectConfig = {
            type: 'folder',
            label: 'CustomBumpMap',
            onChange: () => this.setDirty(),
            children: [
                {
                    type: 'checkbox',
                    label: 'Enabled',
                    get value() { return state._hasCustomBump || false },
                    set value(v) {
                        if (v) {
                            if (!enableCustomBump(material)) {
                                viewer.dialog.alert('Cannot add CustomBumpMap.')
                            }
                        } else {
                            state._hasCustomBump = false
                            material.setDirty?.()
                        }
                        config.uiRefresh?.(true, 'postFrame')
                    },
                },
                {
                    type: 'slider',
                    label: 'Bump Scale',
                    bounds: [-20, 20],
                    hidden: () => !state._hasCustomBump,
                    property: [state, '_customBumpScale'],
                },
                {
                    type: 'image',
                    label: 'Bump Map',
                    hidden: () => !state._hasCustomBump,
                    property: [state, '_customBumpMap'],
                    onChange: () => material.setDirty?.(),
                }
            ],
        }
        return config
    }
}
```

::: tip Naming Convention

The property names inside `userData` (e.g., `_hasCustomBump`, `_customBumpMap`, `_customBumpScale`) should be unique to avoid conflicts with other plugins. Using a descriptive name is a good practice. For plugins that require many properties, an object like `_customBump` can be used to group them.

The names start with `_` in this plugin, this ensures the properties are not serialized by three.js by default inside the userData when saving a glTF/glb file. 
This allows us to create a custom glTF extension to handle serialization manually and provide validation of the properties and textures inside glTF as an extension.

:::

### 3. Helper Methods

```typescript
// Enable the extension on a specific material
public enableCustomBump(material: IMaterial, map?: ITexture, scale?: number): boolean {
    const ud = material?.userData
    if (!ud) return false
    
    // Validation logic
    if (ud._hasCustomBump === undefined) {
        const meshes = material.appliedMeshes
        let possible = true
        if (meshes) {
            for (const {geometry} of meshes) {
                if (geometry && (!geometry.attributes.position || 
                    !geometry.attributes.normal || !geometry.attributes.uv)) {
                    possible = false
                }
            }
        }
        if (!possible) return false
    }
    
    // Enable the extension
    ud._hasCustomBump = true
    ud._customBumpScale = scale ?? ud._customBumpScale ?? 0.001
    ud._customBumpMap = map ?? ud._customBumpMap ?? null
    
    if (material.setDirty) material.setDirty()
    return true
}
```

### 4. glTF Extension Implementation

The plugin includes a complete glTF extension for import/export:

```typescript
// glTF Import
class GLTFMaterialsCustomBumpMapImport implements GLTFLoaderPlugin {
    public name: string
    public parser: GLTFParser

    constructor(parser: GLTFParser) {
        this.parser = parser
        this.name = customBumpMapGLTFExtension.name
    }

    async extendMaterialParams(materialIndex: number, materialParams: any) {
        const parser = this.parser
        const materialDef = parser.json.materials[materialIndex]
        if (!materialDef.extensions || !materialDef.extensions[this.name]) return
        
        const extension = materialDef.extensions[this.name]

        if (!materialParams.userData) materialParams.userData = {}
        materialParams.userData._hasCustomBump = true
        materialParams.userData._customBumpScale = extension.customBumpScale ?? 0.0
        
        const pending = []
        const tex = extension.customBumpMap
        if (tex) {
            pending.push(parser.assignTexture(materialParams.userData, '_customBumpMap', tex))
        }
        return Promise.all(pending)
    }
}

// glTF Export
const glTFMaterialsCustomBumpMapExport = (w: GLTFWriter2) => ({
    writeMaterial: (material: any, materialDef: any) => {
        if (!material.isMeshStandardMaterial || !material.userData._hasCustomBump) return
        if ((material.userData._customBumpScale || 0) < 0.001) return

        materialDef.extensions = materialDef.extensions || {}

        const extensionDef: any = {}
        extensionDef.customBumpScale = material.userData._customBumpScale || 1.0

        if (w.checkEmptyMap(material.userData._customBumpMap)) {
            const customBumpMapDef = {index: w.processTexture(material.userData._customBumpMap)}
            w.applyTextureTransform(customBumpMapDef, material.userData._customBumpMap)
            extensionDef.customBumpMap = customBumpMapDef
        }

        materialDef.extensions[customBumpMapGLTFExtension.name] = extensionDef
        w.extensionsUsed[customBumpMapGLTFExtension.name] = true
    },
})

// Extension definition for gltf-transform and other plugins
export const customBumpMapGLTFExtension = {
    name: 'WEBGI_materials_custom_bump_map',
    import: (p) => new GLTFMaterialsCustomBumpMapImport(p),
    export: glTFMaterialsCustomBumpMapExport,
    textures: {
        customBumpMap: 'RGB',
    },
} satisfies AssetManager['gltfExtensions'][number]
```

::: info

The glTF extension is optional to create for custom extensions that don't require textures. 
In that case the custom properties can be serialized directly inside `userData` without a custom extension. To ensure the properties are saved, avoid using names that start with `_` in that case.

:::

### 5. TypeScript Declarations

Extend material user data interface for type safety:

```typescript
declare module 'threepipe' {
    interface IMaterialUserData {
        _hasCustomBump?: boolean
        _customBumpMap?: ITexture | null
        _customBumpScale?: number
    }
}
```

## Creating Your Own Plugin

To create a similar plugin, follow this template structure:

### Step 1: Plugin Class Setup

Create a class and define any global properties. 

```typescript
import { AViewerPluginSync, ThreeViewer } from 'threepipe'
import { MaterialExtension } from 'threepipe'
import { uiFolderContainer, uiToggle, uiSlider } from 'threepipe'
import { serialize } from 'threepipe'

@uiFolderContainer('My Custom Effect')
export class MyCustomEffectPlugin extends AViewerPluginSync {
    static readonly PluginType = 'MyCustomEffectPlugin'

    @uiToggle('Enabled')
    @serialize() 
    enabled = true

    @uiSlider('Intensity', [-20, 20], 0.001)
    @serialize()
    intensity = 1.0

    // Your material extension
    readonly materialExtension: MaterialExtension = {
        // Implementation here
    }

    onAdded(v: ThreeViewer) {
        super.onAdded(v)
        v.assetManager.materials.registerMaterialExtension(this.materialExtension)
        // Register glTF extension if needed
    }

    onRemove(v: ThreeViewer) {
        v.assetManager.materials?.unregisterMaterialExtension(this.materialExtension)
        return super.onRemove(v)
    }
}
```

### Step 2: Implement Material Extension

```typescript
readonly materialExtension: MaterialExtension = {
    parsFragmentSnippet: `
        uniform float uMyEffect;
        vec3 applyMyEffect(vec3 color) {
            return mix(color, color * 2.0, uMyEffect);
        }
    `,
    
    extraUniforms: {
        uMyEffect: () => ({ value: this.enabled ? this.intensity : 0.0 })
    },
    
    shaderExtender: (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
            'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
            `
            vec3 effectColor = applyMyEffect(outgoingLight);
            gl_FragColor = vec4(effectColor, diffuseColor.a);
            `
        )
    },
    
    computeCacheKey: (material) => {
        return `my_effect_${this.enabled}_${this.intensity}_${material.uuid}`
    }
}
```

### Step 3: Add UI Configuration (Optional)

```typescript
getUiConfig: material => ({
    type: 'folder',
    label: 'My Custom Effect',
    children: [
        {
            type: 'checkbox',
            label: 'Enable Effect',
            property: [material.userData, '_myEffectEnabled']
        },
        {
            type: 'slider',
            label: 'Effect Strength',
            bounds: [0, 2],
            property: [material.userData, '_myEffectStrength']
        }
    ]
})
```

## Plugin Examples in Threepipe

Study these plugin implementations for different patterns:

**Core Material Extension Plugins:**
- [**CustomBumpMapPlugin**](https://github.com/repalash/threepipe/blob/master/src/plugins/material/CustomBumpMapPlugin.ts) - Complete implementation with UI, serialization, and glTF
- [**ClearcoatTintPlugin**](https://github.com/repalash/threepipe/blob/master/src/plugins/material/ClearcoatTintPlugin.ts) - Simple tint effect
- [**FragmentClippingExtensionPlugin**](https://github.com/repalash/threepipe/blob/master/src/plugins/material/FragmentClippingExtensionPlugin.ts) - Advanced clipping planes

**Render Pipeline Plugins:**
- [**SSAOPlugin**](https://github.com/repalash/threepipe/blob/master/src/plugins/postprocessing/SSAOPlugin.ts) - Screen-space ambient occlusion
- [**DepthBufferPlugin**](https://github.com/repalash/threepipe/blob/master/src/plugins/pipeline/DepthBufferPlugin.ts) - Depth buffer access
- [**GBufferPlugin**](https://github.com/repalash/threepipe/blob/master/src/plugins/pipeline/GBufferPlugin.ts) - G-buffer implementation

## Best Practices for Plugin Development

### 1. Plugin Organization
```typescript
// Organize related functionality
export class MyEffectPlugin extends AViewerPluginSync {
    // Plugin settings
    @serialize() enabled = true
    @serialize() intensity = 1.0
    
    // Internal state (not serialized)
    private _uniformsCache = new Map()
    
    // Material extension
    readonly materialExtension: MaterialExtension = { /* ... */ }
    
    // Public API methods
    public enableEffect(material: IMaterial) { /* ... */ }
    public disableEffect(material: IMaterial) { /* ... */ }
    
    // Lifecycle methods
    onAdded(v: ThreeViewer) { /* ... */ }
    onRemove(v: ThreeViewer) { /* ... */ }
}
```

### 2. Performance Considerations
```typescript
// Cache expensive operations
computeCacheKey: (material) => {
    return `${this.constructor.name}_${this.enabled}_${material.uuid}_${this._version}`
},

// Efficient uniform updates
onObjectRender: (object, material) => {
    if (!this._shouldUpdate(material)) return
    this._updateUniforms(material)
},

// Lazy initialization
get materialExtension() {
    if (!this._materialExtension) {
        this._materialExtension = this._createExtension()
    }
    return this._materialExtension
}
```

### 3. Error Handling
```typescript
public enableEffect(material: IMaterial): boolean {
    try {
        if (!this._validateMaterial(material)) {
            console.warn(`Cannot apply effect to material: ${material.name}`)
            return false
        }
        
        material.userData._hasMyEffect = true
        material.setDirty?.()
        return true
    } catch (error) {
        console.error('Failed to enable effect:', error)
        return false
    }
}
```

### 4. Documentation and Types
```typescript
/**
 * My Custom Effect Plugin
 * 
 * Adds a custom visual effect to materials with full UI integration,
 * serialization support, and glTF import/export capabilities.
 * 
 * @example
 * ```typescript
 * const plugin = viewer.addPluginSync(new MyCustomEffectPlugin())
 * plugin.enableEffect(material)
 * plugin.intensity = 1.5
 * \```
 */
export class MyCustomEffectPlugin extends AViewerPluginSync {
    // ...
}

// Extend TypeScript declarations
declare module 'threepipe' {
    interface IMaterialUserData {
        _hasMyEffect?: boolean
        _myEffectIntensity?: number
    }
}
```

By following these patterns and studying the source code of existing plugins, you can create professional, reusable material extension plugins that integrate seamlessly with threepipe's ecosystem. The key is to provide a complete solution that handles not just the visual effect, but also user interaction, data persistence, and file format compatibility.

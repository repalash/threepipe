---
prev:
    text: 'Loading Files'
    link: './loading-files'

next:
    text: 'Exporting Files'
    link: './exporting-files'
---

# Materials Guide

Materials in threepipe define the visual appearance of 3D objects, including properties like color, texture, reflectivity, transparency, and surface characteristics. Threepipe provides a comprehensive material system built on top of three.js materials with enhanced features for physically-based rendering (PBR), material extensions, and advanced configuration options.

## Overview

Materials are self-contained objects that contain information about surface properties and can be applied to any 3D object in the scene, regardless of the geometry or shape. Threepipe's default workflow uses PBR (Physically Based Rendering) to achieve realistic material appearance.

## Core Material Types

### Physical Material

The `PhysicalMaterial` is threepipe's primary material for realistic rendering, extending three.js `MeshPhysicalMaterial` with additional features.

**Key Features:**
- Physically-based rendering (PBR) workflow
- Support for metallic/roughness workflow
- Advanced features like transmission, clearcoat, and sheen
- Material extension support
- UI configuration and serialization

**Basic Usage:**
```typescript
import { PhysicalMaterial, Color, Vector2 } from 'threepipe'

const material = new PhysicalMaterial({
    color: new Color(0xff0000),          // Base color
    metalness: 1.0,                      // 0 = dielectric, 1 = metallic
    roughness: 0.1,                      // 0 = mirror, 1 = completely rough
    transmission: 0.0,                   // For glass-like materials
    thickness: 1.0,                      // Thickness for transmission
    clearcoat: 0.0,                      // Clear coating layer
    clearcoatRoughness: 0.0,             // Roughness of clear coat
})
```

::: details **Advanced Properties:**

```typescript
const material = new PhysicalMaterial({
    // Base properties
    color: new Color(0xffffff),
    map: baseColorTexture,               // Base color texture
    
    // PBR properties
    metalness: 0.0,
    roughness: 0.5,
    metalnessMap: metalnessTexture,
    roughnessMap: roughnessTexture,
    
    // Normal mapping
    normalMap: normalTexture,
    normalScale: new Vector2(1, 1),
    
    // Displacement
    displacementMap: heightTexture,
    displacementScale: 0.1,
    displacementBias: 0.0,
    
    // Ambient occlusion
    aoMap: aoTexture,
    aoMapIntensity: 1.0,
    
    // Transmission (glass/transparent materials)
    transmission: 0.0,
    transmissionMap: transmissionTexture,
    thickness: 1.0,
    thicknessMap: thicknessTexture,
    attenuationDistance: Infinity,
    attenuationColor: new Color(0xffffff),
    
    // Clearcoat (car paint, etc.)
    clearcoat: 0.0,
    clearcoatMap: clearcoatTexture,
    clearcoatRoughness: 0.0,
    clearcoatRoughnessMap: clearcoatRoughnessTexture,
    clearcoatNormalMap: clearcoatNormalTexture,
    clearcoatNormalScale: new Vector2(1, 1),
    
    // Sheen (fabric-like materials)
    sheen: 0.0,
    sheenRoughness: 1.0,
    sheenColor: new Color(0x000000),
    sheenColorMap: sheenColorTexture,
    sheenRoughnessMap: sheenRoughnessTexture,
    
    // Iridescence
    iridescence: 0.0,
    iridescenceMap: iridescenceTexture,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [100, 400],
    iridescenceThicknessMap: iridescenceThicknessTexture,
    
    // Anisotropy (requires AnisotropyPlugin)
    // anisotropy: 0.0,
    // anisotropyRotation: 0.0,
    // anisotropyMap: anisotropyTexture,
})
```

::: 

### Unlit Material

The `UnlitMaterial` extends three.js `MeshBasicMaterial` for flat, non-lighting dependent rendering.

**Use Cases:**
- UI elements and overlays
- Stylized/cartoon rendering
- Billboards and sprites
- Emissive materials
- Debug visualization

**Basic Usage:**
```typescript
import { UnlitMaterial, Color } from 'threepipe'

const material = new UnlitMaterial({
    color: new Color(0x00ff00),
    map: texture,                        // Base texture
    alphaMap: alphaTexture,             // Alpha channel texture
    opacity: 1.0,                       // Material opacity
    transparent: false,                  // Enable transparency
    alphaTest: 0.0,                     // Alpha testing threshold
})
```

### Extended Shader Material

`ExtendedShaderMaterial` provides a base for custom shader materials with material extension support.

```typescript
import { ExtendedShaderMaterial } from 'threepipe'

const customMaterial = new ExtendedShaderMaterial({
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec3 color;
        varying vec2 vUv;
        void main() {
            gl_FragColor = vec4(color, 1.0);
        }
    `,
    uniforms: {
        color: { value: new Color(0xff0000) }
    }
})
```

There are more materials available in threepipe like `LineMaterial`, `LegacyPhongMaterial`, etc. Check the [API Reference](https://threepipe.org/docs/) for more details.

In most cases for 3D Objects, its ideal to use the Physical or Unlit Materials as they provide the maximum compatibility across threepipe and other 3d engines. With the material extension system, you can add custom functionality to these materials without needing to create a custom shader material.

## Creating Materials

### In Code

Materials can be created programmatically and applied to objects:

```typescript
import { Mesh, BoxGeometry, PhysicalMaterial, ThreeViewer } from 'threepipe'

// Create viewer
const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas')
})

// Create material
const material = new PhysicalMaterial({
    color: 0xff0000,
    metalness: 0.8,
    roughness: 0.2
})

// Create geometry and mesh
const geometry = new BoxGeometry(1, 1, 1)
const mesh = new Mesh(geometry, material)

// Add to scene
viewer.scene.addObject(mesh)
```

### Loading from Files

Materials are automatically created when loading 3D files:

```typescript
// Load GLTF with materials
const model = await viewer.load('./model.glb')

// Access materials
const materials = viewer.assetManager.materialManager.getAllMaterials()
console.log('Loaded materials:', materials)

// Modify existing material
const material = materials[0] as PhysicalMaterial
material.metalness = 1.0
material.roughness = 0.1
material.setDirty() // Mark for update
```

### In Blender

When creating materials in Blender for use with threepipe:

1. **Use Principled BSDF**: The standard shader for PBR materials
2. **Connect textures properly**:
   - Base Color → Base Color input
   - Roughness → Roughness input
   - Metallic → Metallic input
   - Normal Map → Normal input (through Normal Map node)
   - Height/Displacement → Displacement output

3. **Export Settings**:
   - Use glTF 2.0 format for best compatibility
   - Enable "Export Materials" option
   - Choose appropriate texture formats (PNG for alpha, JPEG for RGB)

**Blender Node Setup Example:**
```
[Image Texture] → [Base Color] → [Principled BSDF] → [Material Output]
[Image Texture] → [Roughness] → [Principled BSDF]
[Image Texture] → [Metallic] → [Principled BSDF]
[Image Texture] → [Normal Map] → [Normal] → [Principled BSDF]
```

### In Other 3D Software

**3ds Max:**
- Use Physical Material or Arnold Standard Surface
- Connect maps to appropriate slots
- Export via glTF exporter

**Maya:**
- Use aiStandardSurface (Arnold) or StandardSurface
- Connect file nodes to material inputs
- Export using Maya2glTF or similar

**Substance Painter:**
- Use PBR workflow templates
- Export texture maps for threepipe:
  - Base Color
  - Roughness
  - Metallic
  - Normal
  - Height

**Rhino 3DM**
- DO NOT export using glTF exporter. Use 3DM
- Load 3DM files directly in threepipe and export to optimized glb.
- Use PBR materials in Rhino or use Layers and assign materials in threepipe.


## Material Extensions

Material extensions allow you to add custom functionality to materials without modifying the core material classes. This is particularly powerful for adding rendering effects, custom properties, or shader modifications.

### Creating a Material Extension

```typescript
import { MaterialExtension } from 'threepipe'

const customExtension: MaterialExtension = {
    // Add custom uniforms
    extraUniforms: {
        tCustomTexture: { value: null },
        uCustomValue: { value: 1.0 },
        uTime: () => ({ value: performance.now() * 0.001 })
    },
    
    // Add shader defines
    extraDefines: {
        USE_CUSTOM_EFFECT: 1,
        CUSTOM_ITERATIONS: () => Math.floor(Math.random() * 10)
    },
    
    // Add custom shader code
    parsFragmentSnippet: `
        uniform sampler2D tCustomTexture;
        uniform float uCustomValue;
        uniform float uTime;
        
        vec3 customEffect(vec3 color) {
            return color * (0.5 + 0.5 * sin(uTime));
        }
    `,
    
    // Modify shader during compilation
    shaderExtender: (shader, material, renderer) => {
        // Insert custom code at specific points
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <output_fragment>',
            `
            gl_FragColor.rgb = customEffect(gl_FragColor.rgb);
            #include <output_fragment>
            `
        )
    },
    
    // Extension priority (higher = applied later)
    priority: 100,
    
    // Custom cache key for shader compilation
    computeCacheKey: (material, renderer) => {
        return `custom_${material.uuid}_${renderer.info.programs?.length || 0}`
    }
}
```

### Registering Extensions

```typescript
// Register extension globally
viewer.assetManager.materialManager.registerMaterialExtensions([customExtension])

// Register extension on specific material
material.registerMaterialExtensions([customExtension])

// Register during material creation
const material = new PhysicalMaterial({
    color: 0xff0000,
    customMaterialExtensions: [customExtension]
})
```

### Built-in Extension Plugins

Threepipe includes several plugins that use material extensions:

- **ClearcoatTintPlugin**: Adds tinted clearcoat effects
- **CustomBumpMapPlugin**: Enhanced bump mapping
- **SSAOPlugin**: Screen-space ambient occlusion
- **FragmentClippingExtensionPlugin**: Fragment-level clipping
- **ParallaxMappingPlugin**: Relief parallax mapping
- **AnisotropyPlugin**: Anisotropic reflections

## Material Chaining and Composition

Material extensions can be chained together to create complex effects:

```typescript
// Create multiple extensions
const glowExtension: MaterialExtension = {
    parsFragmentSnippet: `
        uniform float uGlowIntensity;
        vec3 addGlow(vec3 color) {
            return color + vec3(uGlowIntensity);
        }
    `,
    extraUniforms: {
        uGlowIntensity: {value: 0.1}
    }
}

const pulseExtension: MaterialExtension = {
    parsFragmentSnippet: `
        uniform float uTime;
        vec3 addPulse(vec3 color) {
            float pulse = 0.5 + 0.5 * sin(uTime * 2.0);
            return color * pulse;
        }
    `,
    extraUniforms: {
        uTime: () => ({value: performance.now() * 0.001})
    }
}

const combinedExtension: MaterialExtension = {
    shaderExtender: (shader) => {
        shader.fragmentShader = shaderReplaceString(
            '#include <output_fragment>',
            `
            gl_FragColor.rgb = addGlow(gl_FragColor.rgb);
            gl_FragColor.rgb = addPulse(gl_FragColor.rgb);
            `, {prepend: true},
        )
    },
    priority: 200 // Apply after other extensions
}

// Apply all extensions
material.registerMaterialExtensions([
    glowExtension,
    pulseExtension,
    combinedExtension
])
```

## Advanced Features

### Transmission and Refraction

For glass and transparent materials:

```typescript
const glassMaterial = new PhysicalMaterial({
    transmission: 1.0,              // Full transmission
    thickness: 0.5,                 // Glass thickness
    roughness: 0.0,                 // Smooth surface
    metalness: 0.0,                 // Non-metallic
    ior: 1.5,                       // Index of refraction
    attenuationDistance: 0.5,       // Light attenuation
    attenuationColor: new Color(0.9, 0.95, 1.0), // Slight blue tint
})
```

### Clearcoat Effects

For car paint and lacquered surfaces:

```typescript
const carPaintMaterial = new PhysicalMaterial({
    color: new Color(0x8B0000),    // Dark red base
    metalness: 0.9,                // Metallic base
    roughness: 0.5,                // Somewhat rough base
    clearcoat: 1.0,                // Full clearcoat
    clearcoatRoughness: 0.1,       // Smooth clearcoat
})
```

### Fabric Materials

Using sheen for fabric-like appearance:

```typescript
const fabricMaterial = new PhysicalMaterial({
    color: new Color(0x8B4513),    // Brown fabric
    metalness: 0.0,                // Non-metallic
    roughness: 0.8,                // Rough surface
    sheen: 1.0,                    // Full sheen effect
    sheenColor: new Color(0.5, 0.5, 0.5), // White sheen
    sheenRoughness: 0.3,           // Moderate sheen roughness
})
```

## Performance Considerations

### Material Sharing

Share materials between objects to reduce memory usage:

```typescript
const sharedMaterial = new PhysicalMaterial({ color: 0xff0000 })

// Use same material for multiple objects
const mesh1 = new Mesh(geometry1, sharedMaterial)
const mesh2 = new Mesh(geometry2, sharedMaterial)
```

### Texture Sharing

Share textures to optimize loading and memory:

```typescript
// Load texture once, use multiple times
const baseTexture = await viewer.load<ITexture>('./texture.jpg')

const material1 = new PhysicalMaterial({ map: baseTexture })
const material2 = new PhysicalMaterial({ 
    map: baseTexture,
    color: new Color(0.5, 0.5, 1.0) // Tint the texture
})
```

### Material Updates

Use `setDirty()` to mark materials for update:

```typescript
material.color.setHex(0x00ff00)
material.roughness = 0.8
material.setDirty() // Trigger update
```

## Best Practices

1. **Use PBR workflow**: Stick to physically-based values for realistic results
2. **Texture resolution**: Use appropriate texture sizes (power of 2)
3. **Material sharing**: Reuse materials when possible for performance
4. **Extension organization**: Keep extensions focused and modular
5. **Testing**: Test materials under different lighting conditions

## Debugging Materials

### Material Inspector

Use the built-in UI to inspect material properties:

```typescript
import { TweakpaneUiPlugin } from '@threepipe/plugin-tweakpane'

const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
ui.setupPluginUi(PickingPlugin)
// Material(and object) properties will appear in the UI when objects are selected
```

[//]: # (todo not a bad idea)
[//]: # (### Shader Debugging)

[//]: # ()
[//]: # (Enable shader debugging for development:)

[//]: # ()
[//]: # (```typescript)

[//]: # (// Enable shader debugging)

[//]: # (material.userData.debugShader = true)

[//]: # (material.setDirty&#40;&#41;)

[//]: # ()
[//]: # (// Check compiled shader in browser console)

[//]: # (console.log&#40;material.userData.compiledShader&#41;)

[//]: # (```)

## Examples

See the [threepipe examples](https://threepipe.org/examples/) for practical material usage:

- [Custom Bump Map Plugin](https://threepipe.org/examples/custom-bump-map-plugin/)
- [Animate Material Properties](https://threepipe.org/examples/animate-material-properties/)
- [Clearcoat Tint Plugin](https://threepipe.org/examples/clearcoat-tint-plugin/)
- [Anisotropy Plugin](https://threepipe.org/examples/anisotropy-plugin/)

For more advanced material extension topics, see the [Material Extension](./material-extension.md) guide.

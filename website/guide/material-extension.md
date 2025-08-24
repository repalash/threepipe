---
prev:
    text: 'Plugin System'
    link: './plugin-system'

next:
    text: 'Screen Pass'
    link: './screen-pass'
---

# Material Extension

Threepipe's Material Extension system is a powerful architecture that allows you to modify, enhance, and extend the behavior of materials without creating entirely new material classes. This system provides a clean, modular way to add custom shader code, uniforms, defines, and rendering logic to existing materials.

Check out the [3d Assets](./3d-assets) and [Materials](./materials) guides first to understand how to work with materials in threepipe.

## Overview

The material extension system works by intercepting the material's shader compilation process and injecting custom code at specific points. This allows you to:

- Add custom visual effects to existing materials
- Inject additional uniforms and shader variables
- Modify shader compilation with custom defines
- Create reusable rendering components
- Build complex effects through extension chaining

The material manager automatically applies compatible extensions to materials when they are added to the scene or when extensions are registered globally.

## How Material Extensions Work

Material extensions hook into the `onBeforeCompile` callback of three.js materials, allowing you to modify the shader code before it's compiled by the GPU. Threepipe enhances this process with:

1. **Automatic Extension Registration**: Extensions are automatically applied to compatible materials
2. **Shader Injection Points**: Predefined locations in shaders where code can be injected
3. **Priority System**: Control the order in which extensions are applied
4. **Dependency Management**: Extensions can depend on other extensions or plugins
5. **Performance Optimization**: Intelligent caching and compilation management

## Creating Material Extensions

### Basic Extension Structure

A material extension follows the `MaterialExtension` interface:

```typescript
import { MaterialExtension, PhysicalMaterial, Color } from 'threepipe'

const basicExtension: MaterialExtension = {
    // Add custom uniforms
    extraUniforms: {
        uTime: () => ({ value: performance.now() * 0.001 }),
        uIntensity: { value: 1.0 },
        uColor: { value: new Color(1, 0.5, 0) }
    },
    
    // Add shader defines
    extraDefines: {
        USE_CUSTOM_EFFECT: 1,
        MAX_ITERATIONS: 10
    },
    
    // Add custom shader code to fragment shader
    parsFragmentSnippet: `
        uniform float uTime;
        uniform float uIntensity;
        uniform vec3 uColor;
        
        vec3 applyCustomEffect(vec3 baseColor) {
            float wave = sin(uTime * 2.0) * 0.5 + 0.5;
            return mix(baseColor, uColor, wave * uIntensity);
        }
    `,
    
    // Modify the compiled shader
    shaderExtender: (shader, material, renderer) => {
        shader.fragmentShader = shader.fragmentShader.replace(
            'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
            `
            vec3 customColor = applyCustomEffect(outgoingLight);
            gl_FragColor = vec4(customColor, diffuseColor.a);
            `
        )
    },
    
    priority: 100
}
```

### Advanced Extension with Vertex Shader Modifications

```typescript
const advancedExtension: MaterialExtension = {
    extraUniforms: {
        uDisplacement: { value: 0.1 },
        uFrequency: { value: 5.0 },
        uTime: () => ({ value: performance.now() * 0.001 })
    },
    
    // Add code to vertex shader
    parsVertexSnippet: `
        uniform float uDisplacement;
        uniform float uFrequency;
        uniform float uTime;
        
        vec3 displacementWave(vec3 pos) {
            float wave = sin(pos.x * uFrequency + uTime) * uDisplacement;
            return pos + normal * wave;
        }
    `,
    
    // Add code to fragment shader
    parsFragmentSnippet: `
        varying vec3 vDisplacedPosition;
    `,
    
    shaderExtender: (shader, material, renderer) => {
        // Modify vertex shader
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `
            vec3 displaced = displacementWave(transformed);
            vec4 mvPosition = vec4( displaced, 1.0 );
            mvPosition = modelViewMatrix * mvPosition;
            gl_Position = projectionMatrix * mvPosition;
            vDisplacedPosition = displaced;
            `
        )
        
        // Add varying declaration
        shader.vertexShader = 'varying vec3 vDisplacedPosition;\n' + shader.vertexShader
        shader.fragmentShader = 'varying vec3 vDisplacedPosition;\n' + shader.fragmentShader
    },
    
    priority: 50
}
```

## Extension Registration and Management

### Global Registration

Register extensions globally to apply them to all compatible materials:

```typescript
// Register single extension
viewer.assetManager.materialManager.registerMaterialExtensions([basicExtension])

// Register multiple extensions
viewer.assetManager.materialManager.registerMaterialExtensions([
    basicExtension,
    advancedExtension
])
```

### Material-Specific Registration

Apply extensions to specific materials only:

```typescript
const material = new PhysicalMaterial({
    color: 0xff0000,
    customMaterialExtensions: [basicExtension]
})

// Or register after creation
material.registerMaterialExtensions([advancedExtension])
```

### Dynamic Extension Management

```typescript
// Check if extension is registered
const isRegistered = material.materialExtensions.includes(basicExtension)

// Remove extensions
material.unregisterMaterialExtensions([basicExtension])

// Get all registered extensions
const extensions = material.materialExtensions
console.log('Registered extensions:', extensions)
```

## Extension Chaining and Composition

One of the most powerful features of the material extension system is the ability to chain multiple extensions together to create complex effects.

### Priority-Based Chaining

Extensions are applied based on their priority values (lower numbers = higher priority):

```typescript
const baseColorExtension: MaterialExtension = {
    parsFragmentSnippet: `
        vec3 adjustBaseColor(vec3 color) {
            return color * 1.2; // Brighten
        }
    `,
    priority: 10 // Applied first
}

const contrastExtension: MaterialExtension = {
    parsFragmentSnippet: `
        vec3 adjustContrast(vec3 color) {
            return (color - 0.5) * 1.5 + 0.5;
        }
    `,
    priority: 20 // Applied second
}

const finalCompositeExtension: MaterialExtension = {
    shaderExtender: (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
            'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
            `
            vec3 adjusted = adjustBaseColor(outgoingLight);
            adjusted = adjustContrast(adjusted);
            gl_FragColor = vec4(adjusted, diffuseColor.a);
            `
        )
    },
    priority: 100 // Applied last
}
```

### Layered Effects System

Create a system of layered effects that can be mixed and matched:

```typescript
// Color grading layer
const colorGradingExtension: MaterialExtension = {
    extraUniforms: {
        uSaturation: { value: 1.0 },
        uContrast: { value: 1.0 },
        uBrightness: { value: 0.0 }
    },
    
    parsFragmentSnippet: `
        uniform float uSaturation;
        uniform float uContrast;
        uniform float uBrightness;
        
        vec3 colorGrade(vec3 color) {
            // Adjust brightness
            color += uBrightness;
            
            // Adjust contrast
            color = (color - 0.5) * uContrast + 0.5;
            
            // Adjust saturation
            float luminance = dot(color, vec3(0.299, 0.587, 0.114));
            color = mix(vec3(luminance), color, uSaturation);
            
            return color;
        }
    `,
    priority: 80
}

// Distortion layer
const distortionExtension: MaterialExtension = {
    extraUniforms: {
        uDistortionStrength: { value: 0.1 },
        uTime: () => ({ value: performance.now() * 0.001 })
    },
    
    parsFragmentSnippet: `
        uniform float uDistortionStrength;
        uniform float uTime;
        
        vec2 distortUV(vec2 uv) {
            vec2 distortion = vec2(
                sin(uv.y * 10.0 + uTime) * uDistortionStrength,
                cos(uv.x * 10.0 + uTime) * uDistortionStrength
            );
            return uv + distortion;
        }
    `,
    priority: 30
}

// Composite layer that applies all effects
const compositeExtension: MaterialExtension = {
    shaderExtender: (shader) => {
        // Modify UV coordinates first
        shader.fragmentShader = shader.fragmentShader.replace(
            'vUv',
            'distortUV(vUv)'
        )
        
        // Apply color grading to final output
        shader.fragmentShader = shader.fragmentShader.replace(
            'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
            `
            vec3 graded = colorGrade(outgoingLight);
            gl_FragColor = vec4(graded, diffuseColor.a);
            `
        )
    },
    priority: 100
}

// Apply all layers
material.registerMaterialExtensions([
    distortionExtension,
    colorGradingExtension,
    compositeExtension
])
```

## Advantages of Material Extensions

### 1. Modularity and Reusability
Extensions can be developed once and applied to multiple materials and projects:

```typescript
// Create reusable effects library
export const GlowEffect: MaterialExtension = { /* ... */ }
export const HologramEffect: MaterialExtension = { /* ... */ }
export const WaterDistortion: MaterialExtension = { /* ... */ }

// Use across different materials
metalMaterial.registerMaterialExtensions([GlowEffect])
glassMaterial.registerMaterialExtensions([HologramEffect, WaterDistortion])
```

### 2. Non-Destructive Modifications
Extensions don't modify the base material, allowing for easy addition and removal:

```typescript
// Toggle effects on/off
function toggleGlowEffect(material: PhysicalMaterial, enabled: boolean) {
    if (enabled) {
        material.registerMaterialExtensions([GlowEffect])
    } else {
        material.unregisterMaterialExtensions([GlowEffect])
    }
    material.setDirty()
}
```

### 3. Performance Optimization
Extensions are only compiled when needed and can share uniforms efficiently:

```typescript
const sharedTimeExtension: MaterialExtension = {
    extraUniforms: {
        // Shared time uniform across all materials
        uGlobalTime: () => ({ value: performance.now() * 0.001 })
    },
    
    // Custom cache key for efficient compilation
    computeCacheKey: (material, renderer) => {
        return `shared_time_${material.type}`
    }
}
```

### 4. Easy Integration with UI Systems
Extensions integrate seamlessly with threepipe's UI configuration system:

```typescript
@uiFolder("Custom Effect")
class CustomEffectPlugin extends AViewerPluginSync {
    @uiSlider("Intensity", [0, 2], 0.1)
    @serialize()
    intensity = 1.0
    
    @uiColor()
    @serialize()
    effectColor = new Color(1, 0.5, 0)
    
    private _extension: MaterialExtension = {
        extraUniforms: {
            uIntensity: () => ({ value: this.intensity }),
            uColor: () => ({ value: this.effectColor })
        },
        // ... rest of extension
    }
    
    onAdded(viewer: ThreeViewer) {
        viewer.assetManager.materialManager.registerMaterialExtensions([this._extension])
    }
}
```

## Built-in Extension Plugins

Threepipe includes several plugins that demonstrate and provide material extensions:

### Core Extension Plugins

- **ClearcoatTintPlugin**: Adds tinted clearcoat effects
- **CustomBumpMapPlugin**: Enhanced bump mapping
- **SSAOPlugin**: Screen-space ambient occlusion
- **FragmentClippingExtensionPlugin**: Fragment-level clipping
- **ParallaxMappingPlugin**: Relief parallax mapping
- **AnisotropyPlugin**: Anisotropic reflections

## Real-World Examples

### Example 1: Animated Hologram Effect

```typescript
const hologramExtension: MaterialExtension = {
    extraUniforms: {
        uTime: () => ({ value: performance.now() * 0.001 }),
        uScanlineFreq: { value: 100.0 },
        uFlickerIntensity: { value: 0.1 },
        uHologramColor: { value: new Color(0.3, 0.8, 1.0) }
    },
    
    parsFragmentSnippet: `
        uniform float uTime;
        uniform float uScanlineFreq;
        uniform float uFlickerIntensity;
        uniform vec3 uHologramColor;
        
        vec3 hologramEffect(vec3 color, vec2 uv) {
            // Scanlines
            float scanline = sin(uv.y * uScanlineFreq + uTime * 10.0) * 0.04;
            
            // Flicker
            float flicker = (sin(uTime * 13.0) * 0.5 + 0.5) * uFlickerIntensity;
            
            // Hologram tint
            color = mix(color, uHologramColor, 0.3);
            
            // Apply effects
            color += scanline;
            color *= (1.0 - flicker);
            
            return color;
        }
    `,
    
    shaderExtender: (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
            'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
            `
            vec3 hologrammed = hologramEffect(outgoingLight, vUv);
            gl_FragColor = vec4(hologrammed, diffuseColor.a * 0.7);
            `
        )
    }
}
```

### Example 2: Dynamic Material Blending

```typescript
const materialBlendExtension: MaterialExtension = {
    extraUniforms: {
        tBlendTexture: { value: null },
        tMaskTexture: { value: null },
        uBlendFactor: { value: 0.5 },
        uBlendMode: { value: 0 } // 0: mix, 1: multiply, 2: screen
    },
    
    parsFragmentSnippet: `
        uniform sampler2D tBlendTexture;
        uniform sampler2D tMaskTexture;
        uniform float uBlendFactor;
        uniform int uBlendMode;
        
        vec3 blendColors(vec3 base, vec3 blend, float factor, int mode) {
            if (mode == 1) {
                return mix(base, base * blend, factor);
            } else if (mode == 2) {
                return mix(base, 1.0 - (1.0 - base) * (1.0 - blend), factor);
            }
            return mix(base, blend, factor);
        }
    `,
    
    shaderExtender: (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            `
            vec4 diffuseColor = vec4( diffuse, opacity );
            
            if (tBlendTexture != null) {
                vec3 blendColor = texture2D(tBlendTexture, vUv).rgb;
                float mask = tMaskTexture != null ? texture2D(tMaskTexture, vUv).r : 1.0;
                diffuseColor.rgb = blendColors(diffuseColor.rgb, blendColor, uBlendFactor * mask, uBlendMode);
            }
            `
        )
    }
}
```

### Example 3: Environment-Aware Material

```typescript
const environmentAwareExtension: MaterialExtension = {
    extraUniforms: {
        uEnvironmentInfluence: { value: 1.0 },
        uTemperature: { value: 6500.0 }, // Kelvin
        uHumidity: { value: 0.5 }
    },
    
    parsFragmentSnippet: `
        uniform float uEnvironmentInfluence;
        uniform float uTemperature;
        uniform float uHumidity;
        
        vec3 temperatureToColor(float kelvin) {
            kelvin = clamp(kelvin, 1000.0, 12000.0) / 100.0;
            
            vec3 color;
            if (kelvin <= 66.0) {
                color.r = 1.0;
                color.g = clamp(0.39008157876 * log(kelvin) - 0.63184144378, 0.0, 1.0);
            } else {
                color.r = clamp(1.29293618606 * pow(kelvin - 60.0, -0.1332047592), 0.0, 1.0);
                color.g = clamp(1.12989086089 * pow(kelvin - 60.0, -0.0755148492), 0.0, 1.0);
            }
            
            if (kelvin >= 66.0) {
                color.b = 1.0;
            } else if (kelvin <= 19.0) {
                color.b = 0.0;
            } else {
                color.b = clamp(0.54320678911 * log(kelvin - 10.0) - 1.19625408914, 0.0, 1.0);
            }
            
            return color;
        }
        
        vec3 applyEnvironmentalEffects(vec3 color) {
            vec3 tempColor = temperatureToColor(uTemperature);
            color = mix(color, color * tempColor, uEnvironmentInfluence * 0.3);
            
            // Humidity effect (affects saturation)
            float luminance = dot(color, vec3(0.299, 0.587, 0.114));
            float saturation = 1.0 - (uHumidity * 0.3);
            color = mix(vec3(luminance), color, saturation);
            
            return color;
        }
    `,
    
    shaderExtender: (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
            'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
            `
            vec3 environmentalColor = applyEnvironmentalEffects(outgoingLight);
            gl_FragColor = vec4(environmentalColor, diffuseColor.a);
            `
        )
    }
}
```

## Best Practices

### 1. Extension Organization
```typescript
// Group related extensions in modules
export namespace WaterEffects {
    export const Ripples: MaterialExtension = { /* ... */ }
    export const Foam: MaterialExtension = { /* ... */ }
    export const Caustics: MaterialExtension = { /* ... */ }
}

// Use factory functions for configurable extensions
export function createGlowExtension(color: Color, intensity: number): MaterialExtension {
    return {
        extraUniforms: {
            uGlowColor: { value: color },
            uGlowIntensity: { value: intensity }
        },
        // ... rest of extension
    }
}
```

### 2. Performance Optimization
```typescript
// Cache expensive operations
const optimizedExtension: MaterialExtension = {
    extraUniforms: {
        uTime: (() => {
            let lastTime = 0
            let cachedValue = 0
            
            return () => {
                const now = performance.now()
                if (now - lastTime > 16) { // ~60fps
                    cachedValue = now * 0.001
                    lastTime = now
                }
                return { value: cachedValue }
            }
        })()
    }
}

// Use efficient shader code
const efficientExtension: MaterialExtension = {
    parsFragmentSnippet: `
        // Pre-calculate constants
        const float INV_PI = 0.31830988618;
        const vec3 LUMINANCE_WEIGHTS = vec3(0.299, 0.587, 0.114);
        
        // Use built-in functions when possible
        float fastSin(float x) {
            return sin(x * 6.28318530718); // 2π
        }
    `
}
```

### 3. Cross-Platform Compatibility
```typescript
const compatibleExtension: MaterialExtension = {
    parsFragmentSnippet: `
        // Use precision qualifiers
        precision highp float;
        
        // Avoid unsupported functions
        vec3 safePow(vec3 base, float exp) {
            return pow(max(base, vec3(0.001)), exp);
        }
        
        // Handle different texture coordinate systems
        vec2 getScreenUV() {
            #ifdef GL_FRAGMENT_PRECISION_HIGH
                return gl_FragCoord.xy / resolution;
            #else
                return vUv;
            #endif
        }
    `
}
```

## Debugging and Troubleshooting

### Shader Debugging
```typescript
const debugExtension: MaterialExtension = {
    extraDefines: {
        DEBUG_MODE: 1
    },
    
    parsFragmentSnippet: `
        #ifdef DEBUG_MODE
            vec3 debugColor(vec3 color, float value) {
                return mix(color, vec3(1.0, 0.0, 0.0), step(0.5, value));
            }
        #endif
    `,
    
    shaderExtender: (shader, material) => {
        console.log('Extension applied to:', material.name)
        console.log('Shader uniforms:', Object.keys(shader.uniforms))
        
        // Add debug output
        shader.fragmentShader = shader.fragmentShader.replace(
            'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
            `
            #ifdef DEBUG_MODE
                outgoingLight = debugColor(outgoingLight, vUv.x);
            #endif
            gl_FragColor = vec4( outgoingLight, diffuseColor.a );
            `
        )
    }
}
```

## Summary

The material extension system in threepipe offers a flexible and powerful way to enhance and customize material behavior without the need for creating entirely new material classes. By leveraging shader injection points, priority-based chaining, and modular design, you can create complex visual effects that are reusable, non-destructive, and optimized for performance.

The material manager is used to register materials and material extensions.

The material extensions can extend any material in the scene, or any plugin/pass with additional uniforms, defines, shader snippets and provides hooks.

The material extensions are automatically applied to all materials in the scene that are compatible, when the extension is registered or when the material(the object it's assigned to) is added to the scene.

Threepipe includes several built-in materials like [PhysicalMaterial](https://threepipe.org/docs/classes/PhysicalMaterial.html), [UnlitMaterial](https://threepipe.org/docs/classes/UnlitMaterial.html), [ExtendedShaderMaterial](https://threepipe.org/docs/classes/ExtendedShaderMaterial.html), [LegacyPhongMaterial](https://threepipe.org/docs/classes/LegacyPhongMaterial.html), that include support for extending the material. Any existing three.js material can be made extendable, check the `ShaderPass2` class for a simple example that adds support for material extension to three.js ShaderPass.

Several plugins create and register material extensions to add different kinds of rendering features over the standard three.js materials like [ClearcoatTintPlugin](https://threepipe.org/docs/classes/ClearcoatTintPlugin.html), [SSAOPlugin](https://threepipe.org/docs/classes/SSAOPlugin.html), [CustomBumpMapPlugin](https://threepipe.org/docs/classes/CustomBumpMapPlugin.html), [AnisotropyPlugin](https://threepipe.org/docs/classes/AnisotropyPlugin.html), [FragmentClippingExtensionPlugin](https://threepipe.org/docs/classes/FragmentClippingExtensionPlugin.html), etc. They also provide uiConfig that can be used to dynamically generate UI or the material extensions.

Some plugins also expose their material extensions to be used by other passes/plugins to access properties like buffers, synced uniforms, defines etc. Like [GBufferPlugin](https://threepipe.org/docs/classes/GBufferPlugin.html), [DepthBufferPlugin](https://threepipe.org/docs/classes/DepthBufferPlugin.html), [NormalBufferPlugin](https://threepipe.org/docs/classes/NormalBufferPlugin.html), etc.

The material extensions must follow the [MaterialExtension](https://threepipe.org/docs/interfaces/MaterialExtension.html) interface.
Many plugins create their own material extensions either for the scene materials or shader passes(like the screen pass). Some plugins like `DepthBufferPlugin` also provides helper material extensions for other custom plugins to fetch value in the depth buffer.

## Creating a Material Extension Plugin

While simple material extensions provide powerful shader modification capabilities, creating complete plugins that handle UI configuration, serialization, and glTF export/import provides a professional, reusable solution.

Check out the [Material Extension Plugin Guide](../notes/material-extension-plugin) to learn how to create full-featured material extension plugins with an example.

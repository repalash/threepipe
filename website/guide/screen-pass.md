---
prev:
    text: 'Material Extension'
    link: './material-extension'

next: false
---

# Screen Pass - Extensions and Shaders

The `ScreenPass` is the final rendering stage in Threepipe that outputs the rendered scene to the screen or a render target. It provides multiple ways to customize the final image through custom shaders, material extensions, and shader snippets.

## Overview

The Screen Pass renders the final scene by processing the diffuse and transparent render targets. It supports:
- Custom fragment shaders
- Shader snippets for simple modifications
- Material extensions for complex modifications
- Built-in features like tonemapping, background clipping, and transparency handling

Check out the [ScreenPass.glsl](https://github.com/repalash/threepipe/blob/master/src/postprocessing/ScreenPass.glsl) for the default fragment shader code used in the screen pass.

Let's explore how to customize the screen pass using different methods to achieve a color tint effect as an example.

<iframe src="https://threepipe.org/examples/screen-pass-extension-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Screen Pass Extension Example"></iframe>

## Basic Screen Shader

The simplest way to customize the screen pass is by providing a shader snippet as a string:

```typescript
const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    screenShader: `
        // add a basic red tint
        diffuseColor *= vec4(1.0, 0.0, 0.0, 1.0);
    `
})
```

This snippet is inserted at the `#glMarker` position in the default screen shader and can modify the `diffuseColor` variable which contains the final pixel color.

**Live Example:** [Basic Screen Shader](https://threepipe.org/examples/#screen-shader/)

## Advanced Screen Shader with Parameters

For more complex modifications, you can provide shader parameters and functions:

```typescript
const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    screenShader: {
        pars: ` // this is added before the main function
        uniform vec3 tintColor;
        vec4 applyTint(vec4 color) {
            return vec4(color.rgb * tintColor, color.a);
        }
        `,
        main: ` // this is added inside the main function
        diffuseColor = applyTint(diffuseColor);
        `
    }
})

// Add the uniform to the screen pass material
viewer.renderManager.screenPass.material.uniforms.tintColor = {
    value: new Color(0, 0, 1) // blue tint
}
```

**Live Example:** [Advanced Screen Shader](https://threepipe.org/examples/#screen-shader-advanced/)

## Custom Screen Shader Material

For complete control, you can provide a full shader material configuration:

```typescript
const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    tonemap: true,
    screenShader: new ExtendedShaderMaterial({
        ...CopyShader,
        // Custom fragment shader
        fragmentShader: `
#include <packing>

varying vec2 vUv;
uniform vec3 tintColor;

void main() {
    vec4 diffuseColor = tDiffuseTexelToLinear (texture2D(tDiffuse, vUv));

    #glMarker

    diffuseColor.rgb *= tintColor;

    gl_FragColor = diffuseColor;
    #include <colorspace_fragment>
}
        `,
        uniforms: {
            tDiffuse: {value: null},
            tTransparent: {value: null},
            tintColor: {value: new Color(0, 1, 0)},
        },
        transparent: true,
        blending: NoBlending,
        side: FrontSide,
    }, ['tDiffuse', 'tTransparent'])
})
```

**Live Example:** [Custom Screen Shader Material](https://threepipe.org/examples/#screen-shader-material/)

## The #glMarker System

The `#glMarker` is a special placeholder in the screen shader that allows plugins and extensions to inject their own code. This enables:

1. **Plugin Integration**: Plugins like tonemap, vignette, and film grain can modify the final image
2. **Extension Points**: Multiple extensions can modify the same shader without conflicts
3. **Shader Composition**: Complex effects can be built by combining multiple extensions

When using custom screen shaders, include `#glMarker` to ensure compatibility with plugins:

```glsl
void main() {
    vec4 diffuseColor = tDiffuseTexelToLinear (texture2D(tDiffuse, vUv));
    
    #glMarker  // Plugin injection point
    
    // Your custom modifications
    diffuseColor.rgb *= tintColor;
    
    gl_FragColor = diffuseColor;
}
```

## Screen Pass Material Extensions

Material extensions provide the most flexible way to modify the screen pass. They allow you to:
- Add custom uniforms, defines
- Inject/modify shader code
- Hook into render events

```typescript
const extension = {
    extraUniforms: {
        tintColor: {value: new Color(0, 1, 1)} // cyan tint
    },
    parsFragmentSnippet: ` // added before main function
        uniform vec3 tintColor;
        vec4 applyTint(vec4 color) {
            return vec4(color.rgb * tintColor, color.a);
        }
    `,
    shaderExtender: (shader, material, renderer) => {
        console.log('Patching shader')
        shader.fragmentShader = shaderReplaceString(
            shader.fragmentShader,
            '#glMarker', 
            `diffuseColor = applyTint(diffuseColor);`,
            {prepend: true} // prepend to existing #glMarker content
        )
    },
    priority: 100, // execution order
    isCompatible: (material) => material.isShaderMaterial,
    computeCacheKey: (material) => 'tint-extension'
}

// Register the extension
viewer.renderManager.screenPass.material.registerMaterialExtensions([extension])
```

**Live Example:** [Screen Pass Extension](https://threepipe.org/examples/#screen-pass-extension/)

## Screen Pass Extension Plugins

For more complex effects that need UI configuration and serialization, you can create a custom screen pass extension plugin using `AScreenPassExtensionPlugin`. This base class provides automatic UI generation, serialization, and integration with the plugin system.

```typescript
import {
    AScreenPassExtensionPlugin,
    Color,
    glsl,
    onChange,
    serialize,
    uiColor,
    uiFolderContainer,
    uiSlider,
    uiToggle,
    uniform,
} from 'threepipe'

@uiFolderContainer('Custom Tint Extension')
export class CustomScreenPassExtensionPlugin extends AScreenPassExtensionPlugin {
    static readonly PluginType = 'CustomTint'

    // Define uniforms that will be available in the shader
    readonly extraUniforms = {
        tintIntensity: {value: 1},
        tintColor: {value: new Color(0xff0000)},
    } as const

    // Plugin properties with UI decorators
    @onChange(CustomScreenPassExtensionPlugin.prototype.setDirty)
    @uiToggle('Enable')
    @serialize() enabled: boolean = true

    @uiSlider('Intensity', [0.1, 4], 0.01)
    @uniform({propKey: 'tintIntensity'}) // Links to extraUniforms
    @serialize() intensity = 1

    @uiColor('Color')
    @uniform({propKey: 'tintColor'})
    @serialize('tintColor') color = new Color(0xff0000)

    /**
     * Priority determines the order of extension application
     * Lower values = applied later (after other extensions)
     */
    priority = -50

    /**
     * Add shader code before the main function
     * Use glsl`` template literal for syntax highlighting
     */
    parsFragmentSnippet = () => {
        if (this.isDisabled()) return ''

        return glsl`
            uniform float tintIntensity;
            uniform vec3 tintColor;
            vec4 ApplyTint(vec4 color) {
                return vec4(color.rgb * tintColor * tintIntensity, color.a);
            }
        `
    }

    /**
     * Shader code to inject at the #glMarker position
     */
    protected _shaderPatch = 'diffuseColor = ApplyTint(diffuseColor);'

    constructor(enabled = true) {
        super()
        this.enabled = enabled
    }
}

// Register the plugin
const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    plugins: [CustomScreenPassExtensionPlugin],
})
```

### Key Features of Extension Plugins:

1. **Automatic UI Generation**: UI decorators create controls automatically
2. **Serialization**: Properties are saved/loaded with `@serialize()`
3. **Uniform Binding**: `@uniform()` decorator links properties to shader uniforms
4. **Change Detection**: `@onChange()` triggers updates when properties change
5. **Priority System**: Control the order of extension application
6. **Conditional Logic**: Use `isDisabled()` to conditionally apply effects

### Extension Plugin Methods:

- `parsFragmentSnippet()`: Add code before the main function
- `_shaderPatch`: Code to inject at #glMarker (can also be a function)
- `isDisabled()`: Check if the extension should be applied
- `setDirty()`: Mark the material for recompilation

**Live Example:** [Screen Pass Extension Plugin](https://threepipe.org/examples/#screen-pass-extension-plugin/)

## Built-in Features

### Background Clipping

Control background rendering with the `clipBackground` option:

```typescript
// Enable background clipping
viewer.renderManager.screenPass.clipBackground = true

// Force background clipping (overrides the above which is also in the UI)
viewer.renderManager.screenPass.clipBackgroundForce = true
```

### Output Color Space

Configure the output color space for the final render:

```typescript
import { SRGBColorSpace, LinearSRGBColorSpace } from 'threepipe'

viewer.renderManager.screenPass.outputColorSpace = SRGBColorSpace
```

## Available Variables

When writing custom screen shaders, these variables are available:

- `diffuseColor`: The final pixel color (vec4)
- `tDiffuse`: Main render target texture (sampler2D)
- `vUv`: UV coordinates (vec2)
- `transparentColor`: Transparent objects color (vec4)
- `tTransparent`: Transparent render target texture (sampler2D)

### Working with G-Buffer

When using the GBufferPlugin, additional variables become available:

::: details GBuffer Snippet
```glsl
#ifdef HAS_GBUFFER
float depth = getDepth(vUv);
bool isBackground = depth > 0.99 && transparentColor.a < 0.001;
#endif
```
:::

```glsl
// Use depth information for effects
diffuseColor.rgb = mix(diffuseColor.rgb, fogColor.rgb, depth);
```

## Best Practices

1. **Always include #glMarker** in custom shaders to maintain plugin compatibility
2. **Use material extensions** for complex modifications that need to interact with other plugins
3. **Test with different plugins** to ensure compatibility
4. **Consider performance** when adding complex shader operations
5. **Use appropriate uniforms** instead of hardcoded values for dynamic effects

## Integration with Plugins

Many built-in plugins extend the screen pass:

- **TonemapPlugin**: Adds tone mapping to the final image
- **VignettePlugin**: Adds vignette effect
- **FilmGrainPlugin**: Adds film grain texture
- **ChromaticAberrationPlugin**: Adds chromatic aberration

These plugins use the material extension system to inject their effects at the `#glMarker` position, allowing them to work together seamlessly.

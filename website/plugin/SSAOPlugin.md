---
prev: 
    text: 'GBufferPlugin'
    link: './GBufferPlugin'

next: 
    text: 'CascadedShadowsPlugin'
    link: './CascadedShadowsPlugin'

aside: false
---

# SSAOPlugin

[Example](https://threepipe.org/examples/#ssao-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/pipeline/SSAOPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/SSAOPlugin.html)

<iframe src="https://threepipe.org/examples/ssao-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe SSAO Plugin Example"></iframe>

The [`SSAOPlugin`](https://threepipe.org/docs/classes/SSAOPlugin.html) adds support for [Screen Space Ambient Occlusion (SSAO)](https://en.wikipedia.org/wiki/Screen_space_ambient_occlusion) to enhance lighting and depth perception in 3D scenes. SSAO is a real-time ambient occlusion technique that approximates the soft shadows that occur in creases, holes, and surfaces that are close to each other.

## What is SSAO?

Screen Space Ambient Occlusion is a shading and rendering technique used to calculate how exposed each point in a scene is to ambient lighting. The algorithm uses the depth and normal information already available in screen space to estimate ambient occlusion, creating more realistic lighting without the computational cost of global illumination techniques.

**Key Benefits:**
- **Enhanced depth perception** - makes surfaces appear more three-dimensional
- **Realistic contact shadows** - adds subtle shadows in crevices and corners  
- **Improved material definition** - helps distinguish between different surface details
- **Performance efficient** - runs in screen space without scene complexity impact

## Features

### Core Functionality
- **Real-time SSAO calculation** using optimized screen-space algorithms
- **Multiple sampling patterns** with configurable sample counts (1-11 samples)
- **Adaptive radius scaling** that can automatically adjust based on scene size
- **Configurable quality settings** including intensity, radius, bias, and falloff
- **Multiple buffer formats** supporting different precision levels and performance targets

### Material Integration
- **Per-material control** - individual materials can disable or customize SSAO behavior
- **Automatic material extension** - seamlessly integrates with [`PhysicalMaterial`](https://threepipe.org/docs/classes/PhysicalMaterial.html)
- **Casting control** - materials can be excluded from SSAO calculations while still receiving AO
- **Debug visualization** - built-in buffer preview and split-screen comparison modes

### Serialization & Configuration
- **Complete serialization** - all plugin and per-material settings are automatically saved
- **UI integration** - automatic UI generation for all configurable parameters
- **Legacy compatibility** - handles migration from older configuration formats
- **Runtime configuration** - settings can be modified during runtime with immediate effect

## Basic Usage

```typescript
import {ThreeViewer, SSAOPlugin} from 'threepipe'

const viewer = new ThreeViewer({
    plugins: [new SSAOPlugin()]
})

// Plugin is automatically configured and ready to use
// SSAO will be applied to all PhysicalMaterial objects in the scene that render to gbuffer
```

## Configuration Options

### Plugin Constructor Parameters

The [`SSAOPlugin`](https://threepipe.org/docs/classes/SSAOPlugin.html) constructor accepts several parameters for initial setup:

```typescript
const ssaoPlugin = new SSAOPlugin(
    UnsignedByteType,  // bufferType - texture data precision
    1.0,               // sizeMultiplier - render target resolution
    true,              // enabled - initial enable state  
    1                  // packing - data packing mode
)
```

**Buffer Types:**
- `UnsignedByteType` - 8-bit precision, best performance (default)
- `HalfFloatType` - 16-bit precision, better quality
- `FloatType` - 32-bit precision, highest quality but slower

**Size Multipliers:**
- `1.0` - Full resolution (highest quality)
- `0.75` - 75% resolution (good balance) 
- `0.5` - Half resolution (better performance)
- `0.25` - Quarter resolution (mobile performance)

### Runtime Settings

Access the plugin's pass to configure SSAO parameters:

```typescript
const ssaoPlugin = viewer.getPlugin(SSAOPlugin)!
const ssaoPass = ssaoPlugin.pass

// Core SSAO parameters
ssaoPass.intensity = 0.25          // Overall effect strength
ssaoPass.occlusionWorldRadius = 1  // Sampling radius in world units
ssaoPass.bias = 0.001              // Prevents self-shadowing artifacts
ssaoPass.falloff = 1.3             // Controls how AO fades with distance

// Quality settings  
ssaoPass.numSamples = 8            // Number of samples (1-11)
ssaoPass.autoRadius = false        // Automatic radius scaling

// Debug options
ssaoPass.split = 0                 // Split screen comparison (0-1)
```

## Per-Material Control

### Disabling SSAO for Specific Materials

```typescript
// Disable SSAO effect on a material (won't receive ambient occlusion)
material.userData.ssaoDisabled = true

// Disable SSAO casting (material won't contribute to AO calculation)
material.userData.ssaoCastDisabled = true

// Disable all plugin effects on a material
material.userData.pluginsDisabled = true
```

### Material UI Integration

The plugin automatically adds SSAO controls to each material's UI configuration:

- **Enabled** - Toggle SSAO effect for the material
- **Cast SSAO** - Toggle whether the material contributes to AO calculation

## Serialization

The [`SSAOPlugin`](https://threepipe.org/docs/classes/SSAOPlugin.html) follows ThreePipe's [serialization system](../guide/serialization):

### Plugin Settings
All plugin-level settings are automatically serialized with the viewer configuration:

```typescript
// Export viewer configuration including SSAO settings
const config = viewer.exportConfig()

// Plugin settings are saved under the plugin type
console.log(config.plugins.SSAOPlugin)
```

### Per-Material Settings
Material-specific SSAO settings are stored in `userData` and included in glTF exports:

```typescript
// Material settings are preserved in userData
const materialConfig = material.userData
console.log(materialConfig.ssaoDisabled)
console.log(materialConfig.ssaoCastDisabled)

// Settings are automatically saved in glTF files as extras
const glbBlob = await viewer.export()
```

## Performance Optimization

::: tip
The SSAO plugin is very performance optimised and work well on all devices across all kinds of scenes with the default settings. 
Unless you have a very specific performance target or quality requirement, the default settings should be suitable for most use cases and try to avoid changing them.
:::

### Mobile Performance
```typescript
// Optimized settings for mobile devices
const mobileSSAO = new SSAOPlugin(
    UnsignedByteType,  // Use 8-bit precision
    0.5,               // Half resolution rendering
)

// Configure for performance
const ssaoPass = mobileSSAO.pass
ssaoPass.numSamples = 4        // Reduce sample count
ssaoPass.intensity = 0.4       // Increase intensity to compensate
```

### High-Quality Setup
```typescript
// High-quality settings for desktop
const desktopSSAO = new SSAOPlugin(
    HalfFloatType,     // Better precision
    1.0,               // Full resolution
)

const ssaoPass = desktopSSAO.pass
ssaoPass.numSamples = 11       // Maximum samples
ssaoPass.intensity = 0.2       // Lower intensity for subtlety
```

## Integration with Other Plugins

SSAO works exceptionally well when combined with other rendering plugins:

```typescript
const viewer = new ThreeViewer({
    plugins: [
        new SSAOPlugin(),
        new ProgressivePlugin(),    // Temporal accumulation for cleaner results
        new FrameFadePlugin()       // Smooth transitions when changing settings
    ]
})
```

- **[`ProgressivePlugin`](./ProgressivePlugin)** - Provides temporal accumulation for noise reduction
- **[`GBufferPlugin`](./GBufferPlugin)** - Automatically added as dependency (provides both depth and normal data)
- **`TemporalAAPlugin`** - Reduces SSAO flickering in animated scenes

## Debugging and Visualization

### Buffer Preview
The plugin provides a debug texture preview accessible through the UI Config or programmatically:

```typescript
const ssaoPlugin = viewer.getPlugin(SSAOPlugin)!
console.log(ssaoPlugin.texture) // Access the SSAO buffer texture

const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
targetPreview.addTarget(()=>ssaoTarget, 'ssao', false, true, true, (s)=>`${s} = vec4(${s}.r);`)
targetPreview.addTarget(()=>viewer.getPlugin(ProgressivePlugin)?.target, 'progressive', false, false, true)
```

### Split Screen Comparison
Enable split-screen mode to compare with and without SSAO:

```typescript
ssaoPlugin.pass.split = 0.5  // Show comparison at 50% screen width
```

Note that this can also be animated to achieve a wipe effect.

## Technical Details

The plugin implements a multi-step SSAO algorithm:

1. **Depth & Normal Sampling** - Uses GBuffer data for efficient access
2. **Sample Generation** - Creates hemisphere samples around each pixel
3. **Occlusion Calculation** - Compares sample depths to determine occlusion
4. **Noise Reduction** - Applies filtering to reduce sampling artifacts
5. **Material Integration** - Blends AO with material ambient occlusion maps without a separate pass

### Implementation Details

This is implemented by adding a pre-render pass to the render manager which renders SSAO to a custom render target. [`SSAOPlugin`](https://threepipe.org/docs/classes/SSAOPlugin.html) depends on [`GBufferPlugin`](./GBufferPlugin), and is automatically added if not already present.

The render target is then used by all [`PhysicalMaterial`](https://threepipe.org/docs/classes/PhysicalMaterial.html)(s) in the scene during the main RenderPass to get the AO data. SSAO can also be disabled from the UI of individual materials or programmatically via `userData`.

### Buffer Data Format

The SSAO buffer stores data in different packing modes for optimization:

> **Mode 1** (default): SSAO data in red channel, depth in GBA channels to remain compatible with ORM workflows
> **Mode 2**: SSAO data in RGB channels with alpha set to 1
> **Mode 3**: Not complete
> **Mode 4**: Not complete

**Note**: Setting `ssaoDisabled` to `true` will disable the effect for that material, as it's a disabled flag rather than an enabled flag.

### Material Extension Integration

The plugin uses ThreePipe's [Material Extension Framework](../guide/material-extension) to seamlessly integrate SSAO into existing materials without requiring custom shaders. The extension:

- Automatically injects SSAO sampling code into fragment shaders
- Manages uniform updates for SSAO textures and parameters  
- Provides per-material enable/disable functionality for both cast and receive
- Handles different packing modes transparently

## Browser Compatibility

The [`SSAOPlugin`](https://threepipe.org/docs/classes/SSAOPlugin.html) works in all modern browsers supporting WebGL. Performance depends on:

- **GPU capabilities** - Texture sampling performance
- **WebGL version** - WebGL2 provides better precision options
  - Note that WebGL2 is required for `FloatType` buffers and configuring SSAO for individual materials(requires MRT)

## See Also

### Threepipe Documentation
- **[GBufferPlugin](./GBufferPlugin)** - Required dependency for depth/normal data
- **[ProgressivePlugin](./ProgressivePlugin)** - Temporal accumulation for quality improvement
- **[DepthBufferPlugin](./DepthBufferPlugin)** - Enhanced depth buffer precision
- **[Render Pipeline Guide](../guide/render-pipeline)** - Understanding the rendering architecture
- **[Material Extension System](../guide/material-extension)** - How SSAO integrates with materials
- **[Serialization Guide](../guide/serialization)** - How settings are saved and loaded

### External References
- **[Screen Space Ambient Occlusion (Wikipedia)](https://en.wikipedia.org/wiki/Screen_space_ambient_occlusion)** - Comprehensive overview of the SSAO technique
- **[Ambient Occlusion (Wikipedia)](https://en.wikipedia.org/wiki/Ambient_occlusion)** - General ambient occlusion concepts and applications
- **[Deferred Shading (Wikipedia)](https://en.wikipedia.org/wiki/Deferred_shading)** - Understanding the rendering pipeline SSAO uses
- **[Global Illumination (Wikipedia)](https://en.wikipedia.org/wiki/Global_illumination)** - Context for ambient occlusion in realistic rendering
- **[SSAO Tutorial (LearnOpenGL)](https://learnopengl.com/Advanced-Lighting/SSAO)** - Technical implementation details and theory
- **[Real-Time Rendering Resources](https://www.realtimerendering.com/)** - Academic and industry resources on real-time graphics techniques

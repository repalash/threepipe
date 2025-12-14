---
prev:
  text: 'DepthOfFieldPlugin (Depth of Field)'
  link: './DepthOfFieldPlugin'

next:
  text: 'AnisotropyPlugin'
  link: './AnisotropyPlugin'

aside: false
---

# SSGIPlugin (Screen Space Global Illumination Plugin)

[Example](https://threepipe.org/examples/#ssgi-plugin/) &mdash;
[API Reference](https://webgi.dev/docs/classes/SSGIPlugin.html)

<iframe src="https://threepipe.org/examples/ssgi-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe SSGI Plugin Example"></iframe>

Screen Space Global Illumination (SSGI) Plugin adds realistic indirect lighting to the scene by simulating light bounces and diffuse reflections using screen-space ray-tracing, creating natural ambient lighting that responds to scene geometry and colors.

The SSGIPlugin implements an advanced screen-space ray-tracing algorithm that traces rays from surface points through the depth buffer to gather indirect illumination from visible surfaces. This creates physically-plausible global illumination effects including color bleeding, soft shadows, and ambient occlusion without the computational cost of traditional ray-tracing or light probes.

## Features

- **Screen-Space Ray-Traced Global Illumination**: Traces multiple rays per pixel to gather indirect light
- **Color Bleeding**: Simulates light bouncing between colored surfaces
- **Combined AO and GI**: Single pass for both ambient occlusion and global illumination
- **Temporal Reprojection**: Uses previous frames to reduce noise and enhance quality
- **Configurable Ray Count**: Balance quality vs performance with adjustable ray samples
- **Automatic Radius Calculation**: Adapts to scene scale automatically
- **Bilateral Filtering**: Optional smoothing pass to reduce noise while preserving edges
- **Per-Material Control**: Enable or disable SSGI for individual materials
- **SSAO Compatibility**: Automatically disables SSAOPlugin when enabled to avoid conflicts
- **GBuffer Integration**: Leverages depth and normal data for accurate ray-tracing
- **Velocity Buffer Support**: Works with motion vectors for temporal stability
- **Progressive Rendering**: Higher quality with progressive frame accumulation
- **Debug Split View**: Compare SSGI on/off side-by-side

## Installation

This plugin is part of the `@threepipe/webgi-plugins` package:

```bash
npm install @threepipe/webgi-plugins
```

## Basic Setup

```typescript
import {ThreeViewer, GBufferPlugin, SSAAPlugin, BaseGroundPlugin} from 'threepipe'
import {SSGIPlugin, VelocityBufferPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: false,
    plugins: [
        GBufferPlugin, 
        SSAAPlugin, 
        TemporalAAPlugin, 
        new VelocityBufferPlugin(undefined, false)
    ]
})

// Enable stable noise for cleaner results
viewer.renderManager.stableNoise = true

// Add SSGI plugin
const ssgi = viewer.addPluginSync(new SSGIPlugin())

// Add ground after SSGI for proper ordering
viewer.addPluginSync(new BaseGroundPlugin())

// Load environment
await viewer.setEnvironmentMap('environment.hdr', {
    setBackground: true
})

// Load model - SSGI applies automatically
await viewer.load('model.glb')
```

With this setup, all physically-based materials will receive realistic indirect lighting that responds to nearby geometry and colors, creating a more grounded and believable scene.

## Configuration

### Global Illumination Quality

Control the quality and strength of global illumination:

```typescript
const ssgiPass = ssgi.pass

// Ray count: number of rays traced per pixel (1-5)
ssgiPass.rayCount = 4 // Balanced (default)
ssgiPass.rayCount = 5 // Maximum quality
ssgiPass.rayCount = 2 // Better performance

// Step count: ray-marching steps per ray (1-16)
ssgiPass.stepCount = 8  // Balanced (default)
ssgiPass.stepCount = 12 // Higher accuracy
ssgiPass.stepCount = 4  // Faster but less accurate

// Intensity: strength of indirect lighting (0-4)
ssgiPass.intensity = 2    // Default
ssgiPass.intensity = 3    // Stronger GI effect
ssgiPass.intensity = 0.5  // Subtle GI
```

Higher ray and step counts produce smoother, more accurate global illumination but at a performance cost. Lower values are suitable for real-time applications or less powerful hardware.

### Spatial Parameters

Configure the spatial behavior of the ray-tracing:

```typescript
const ssgiPass = ssgi.pass

// Auto radius: automatically calculate ray distance based on scene
ssgiPass.autoRadius = true // Default, recommended

// Object radius: manual control when autoRadius is false (0.01-10)
ssgiPass.objectRadius = 1 // Scene-dependent scale

// Tolerance: ray-marching tolerance (0.1-5)
ssgiPass.tolerance = 1   // Default
ssgiPass.tolerance = 1.5 // More forgiving, smoother
ssgiPass.tolerance = 0.5 // Stricter, more detailed

// Bias: prevents self-intersection artifacts (-0.3 to 0.3)
ssgiPass.bias = 0.001 // Default, minimal bias
ssgiPass.bias = 0.01  // Reduce self-shadowing artifacts
```

The `autoRadius` setting is recommended as it adapts to the scene bounds. Manual `objectRadius` control is useful for specific artistic effects or when the automatic calculation doesn't match your scene scale.

### Visual Tuning

Fine-tune the appearance of global illumination:

```typescript
const ssgiPass = ssgi.pass

// Power: contrast/falloff curve for GI (0-3)
ssgiPass.power = 1.1 // Default
ssgiPass.power = 1.5 // Stronger contrast
ssgiPass.power = 0.8 // Softer, more uniform

// Falloff: distance attenuation (0.0001-4)
ssgiPass.falloff = 0.7 // Default
ssgiPass.falloff = 1.5 // Faster falloff, more local GI
ssgiPass.falloff = 0.3 // Slower falloff, wider influence
```

The `power` parameter affects how global illumination contributes to the final image, similar to an exposure curve. The `falloff` controls how quickly indirect light fades with distance from surfaces.

### Smoothing

Enable bilateral filtering to reduce noise while preserving edges:

```typescript
const ssgiPass = ssgi.pass

// Enable/disable bilateral smoothing
ssgiPass.smoothEnabled = true // Default, recommended

// Access bilateral filter for advanced control
const bilateral = ssgiPass.bilateralPass
bilateral.sigma = 0.5  // Filter strength
bilateral.radius = 2   // Filter kernel size
```

Smoothing is highly recommended for production use as SSGI can be noisy, especially with lower ray counts. The bilateral filter preserves edges while reducing noise in flat areas.

### GI Toggle

Enable or disable global illumination independently:

```typescript
const ssgiPass = ssgi.pass

// Toggle GI on/off (still calculates AO when disabled)
ssgiPass.giEnabled = true  // Default, full SSGI
ssgiPass.giEnabled = false // Only ambient occlusion
```

When `giEnabled` is false, the plugin functions primarily as an ambient occlusion effect without the color bleeding and indirect lighting contributions.

## Buffer Configuration

Configure the render target for custom quality/performance trade-offs:

```typescript
import {HalfFloatType, UnsignedByteType} from 'threepipe'

// Create with custom buffer settings
const ssgi = new SSGIPlugin(
    HalfFloatType,  // Buffer type: HalfFloatType or UnsignedByteType
    1.0,            // Size multiplier: 0.5 for half-res, 1.0 for full-res
    true            // Enabled by default
)

viewer.addPluginSync(ssgi)
```

Using `HalfFloatType` provides higher precision for better quality but uses more memory. Lower `sizeMultiplier` values (e.g., 0.5) can significantly improve performance by computing SSGI at a lower resolution, though with some quality loss.

## Per-Material Control

Control SSGI behavior on individual materials:

```typescript
// Disable SSGI for specific material
material.userData.ssgiDisabled = true

// Re-enable
material.userData.ssgiDisabled = false

// Disable all ambient occlusion effects
material.userData.ssaoDisabled = true

// Disable all plugin effects
material.userData.pluginsDisabled = true
```

This is useful when certain materials shouldn't receive global illumination, such as emissive surfaces, skyboxes, or special effects.

## Rendering Control

Configure when and how SSGI renders:

```typescript
const ssgiPass = ssgi.pass

// Render with camera movement (vs. only after stabilization)
ssgiPass.renderWithCamera = true // Default, real-time
ssgiPass.renderWithCamera = false // Only render when stationary
```

Setting `renderWithCamera` to false can improve performance during camera movement by only computing SSGI when the camera stops, useful for progressive rendering workflows.

## Debug Mode

Use split-screen debug mode to compare with/without SSGI:

```typescript
const ssgiPass = ssgi.pass

// Split screen at position (0-1, left to right)
ssgiPass.split = 0.5 // 50% split - left without, right with SSGI
ssgiPass.split = 0   // No split, full SSGI (default)
ssgiPass.split = 0.7 // 70% split
```

The split view is invaluable for tuning SSGI parameters and demonstrating the effect to others.

## Performance Considerations

SSGI is computationally expensive. Here are optimization strategies:

### For Better Performance:
- Reduce `rayCount` (2-3 instead of 4-5)
- Lower `stepCount` (4-6 instead of 8+)
- Use `sizeMultiplier: 0.5` for half-resolution
- Set `renderWithCamera: false` for progressive rendering
- Disable `smoothEnabled` if performance is critical

### For Better Quality:
- Increase `rayCount` (4-5)
- Increase `stepCount` (8-16)
- Use `HalfFloatType` for buffer
- Enable `smoothEnabled` with bilateral filtering
- Ensure `TemporalAAPlugin` and `VelocityBufferPlugin` are active
- Enable stable noise: `viewer.renderManager.stableNoise = true`
- Use progressive rendering for static scenes

## Integration with Other Plugins

### Recommended Plugin Stack

```typescript
import {
    ThreeViewer, 
    GBufferPlugin, 
    SSAAPlugin,
    BaseGroundPlugin,
    ProgressivePlugin
} from 'threepipe'
import {
    SSGIPlugin,
    VelocityBufferPlugin,
    TemporalAAPlugin,
    BloomPlugin
} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    plugins: [
        GBufferPlugin,           // Required for SSGI
        SSAAPlugin,              // Anti-aliasing
        new VelocityBufferPlugin(undefined, false), // Temporal stability
        TemporalAAPlugin,        // Temporal anti-aliasing
        ProgressivePlugin,       // Progressive quality
        BloomPlugin              // Post-processing
    ]
})

// Add SSGI before ground/environment plugins
const ssgi = viewer.addPluginSync(new SSGIPlugin())

// Add ground and other plugins after
viewer.addPluginSync(new BaseGroundPlugin())
```

### Plugin Compatibility

- **Required**: `GBufferPlugin` - Provides depth and normal data
- **Recommended**: `VelocityBufferPlugin` - Improves temporal stability
- **Recommended**: `TemporalAAPlugin` - Reduces noise over time
- **Recommended**: `ProgressivePlugin` - Accumulates quality in static scenes
- **Compatible**: `BloomPlugin`, `SSReflectionPlugin` (can be used together)
- **Conflicts**: `SSAOPlugin` - SSGI automatically disables SSAO when enabled

### Plugin Ordering

The SSGI plugin should be added **before** ground and environment plugins to ensure proper rendering order:

```typescript
// Correct order
viewer.addPluginSync(new SSGIPlugin())
viewer.addPluginSync(new BaseGroundPlugin())

// If ground is added first, you'll see a console warning
```

## Common Use Cases

### Architectural Visualization

```typescript
const ssgi = viewer.addPluginSync(new SSGIPlugin(HalfFloatType, 1.0))
const ssgiPass = ssgi.pass

ssgiPass.rayCount = 5
ssgiPass.stepCount = 12
ssgiPass.intensity = 2.5
ssgiPass.power = 1.2
ssgiPass.smoothEnabled = true

// Use progressive rendering for best quality
viewer.renderManager.stableNoise = true
```

### Product Visualization

```typescript
const ssgi = viewer.addPluginSync(new SSGIPlugin(HalfFloatType, 1.0))
const ssgiPass = ssgi.pass

ssgiPass.rayCount = 4
ssgiPass.stepCount = 8
ssgiPass.intensity = 2.0
ssgiPass.bias = 0.005 // Reduce self-shadowing
ssgiPass.smoothEnabled = true
```

### Real-Time Interactive

```typescript
const ssgi = viewer.addPluginSync(new SSGIPlugin(UnsignedByteType, 0.5))
const ssgiPass = ssgi.pass

ssgiPass.rayCount = 2
ssgiPass.stepCount = 6
ssgiPass.intensity = 1.5
ssgiPass.renderWithCamera = true
```

### Static Scene (Maximum Quality)

```typescript
const ssgi = viewer.addPluginSync(new SSGIPlugin(HalfFloatType, 1.0))
const ssgiPass = ssgi.pass

ssgiPass.rayCount = 5
ssgiPass.stepCount = 16
ssgiPass.intensity = 2.5
ssgiPass.power = 1.3
ssgiPass.smoothEnabled = true
ssgiPass.renderWithCamera = false // Progressive only

viewer.renderManager.stableNoise = true
```

## Technical Details

### Algorithm Overview

The SSGI algorithm works in several stages:

1. **Ray Generation**: Multiple rays are generated per pixel in a hemisphere around the surface normal
2. **Ray Marching**: Each ray is traced through the depth buffer using iterative steps
3. **Intersection Testing**: When a ray hits geometry, the color at that point is sampled
4. **Accumulation**: All ray samples are accumulated and weighted based on distance and angle
5. **Temporal Blending**: Results are blended with previous frames using velocity/depth reprojection
6. **Bilateral Filtering**: Optional edge-preserving blur reduces noise while maintaining detail
7. **Material Integration**: Final SSGI is applied to materials during rendering

### Buffer Requirements

- Requires `GBufferPlugin` for depth and normal data
- Creates internal render target for SSGI accumulation
- Optional velocity buffer for temporal reprojection
- Supports both `UnsignedByteType` and `HalfFloatType` formats

### Shader Integration

SSGI integrates at the material level, modifying the lighting calculation:
- Adds indirect diffuse lighting based on ray-traced samples
- Darkens areas with low sample visibility (ambient occlusion)
- Respects material roughness and metalness properties
- Compatible only with `PhysicalMaterial` (PBR materials)

## Limitations

- **Screen-Space Only**: Can only reflect/illuminate what's visible on screen
- **No Off-Screen Lighting**: Objects outside the view frustum don't contribute
- **Performance Cost**: Ray-tracing per pixel is expensive, especially at high quality
- **Temporal Artifacts**: Fast camera motion can cause temporal reprojection artifacts
- **Edge Bleeding**: Near screen edges, GI may show artifacts or missing information
- **Material Compatibility**: Only works with physically-based materials

## API Reference

See the [SSGIPlugin API documentation](https://webgi.dev/docs/classes/SSGIPlugin.html) for detailed information on all properties and methods.

## Related Plugins

- [SSReflectionPlugin](./SSReflectionPlugin) - Screen-space reflections for metallic surfaces
- [SSContactShadowsPlugin](./SSContactShadowsPlugin) - Enhanced contact shadows
- [TemporalAAPlugin](./TemporalAAPlugin) - Temporal anti-aliasing for noise reduction
- [VelocityBufferPlugin](./VelocityBufferPlugin) - Motion vectors for temporal effects
- [BloomPlugin](./BloomPlugin) - HDR bloom and glow effects

---
prev:
  text: 'BloomPlugin (HDR Bloom)'
  link: './BloomPlugin'

next:
  text: 'SSContactShadowsPlugin (Screen Space Contact Shadows)'
  link: './SSContactShadowsPlugin'

aside: false
---

# SSReflectionPlugin (Screen Space Reflection Plugin)

[Example](https://threepipe.org/examples/#ssreflection-plugin/) &mdash;
[API Reference](https://webgi.dev/docs/classes/SSReflectionPlugin.html)

<iframe src="https://threepipe.org/examples/ssreflection-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe SSReflection Plugin Example"></iframe>

Screen Space Reflection (SSR) Plugin adds real-time reflections to reflective surfaces by ray-tracing against the rendered screen buffer, creating realistic mirror-like reflections of visible scene elements.

The SSReflectionPlugin implements an advanced screen-space ray-tracing algorithm that traces reflection rays through the depth buffer to find intersection points, enabling highly realistic reflections on metallic and glossy surfaces without the computational cost of traditional ray-tracing or the memory requirements of reflection probes.

## Features

- **Real-Time Screen-Space Ray-Tracing**: Traces reflection rays through depth buffer for accurate reflections
- **Inline or Post-Process Mode**: Choose between inline shader integration or separate render pass
- **Roughness-Based Reflections**: Automatic roughness-aware reflection intensity
- **Temporal Reprojection**: Uses previous frames to enhance quality and reduce noise
- **Multi-Ray Sampling**: Configurable ray count for smoother reflections on rough surfaces
- **Per-Material Control**: Enable or disable SSR for individual materials
- **Non-Physical Mode**: Optional artistic control over reflection behavior
- **Adaptive Quality**: Lower quality during camera motion for better performance
- **Front Ray Masking**: Avoids self-reflections and artifacts
- **GBuffer Integration**: Leverages depth and normal data for accurate ray-tracing
- **Velocity Buffer Support**: Works with motion vectors for temporal stability
- **Debug Split View**: Compare SSR on/off side-by-side

## Installation

This plugin is part of the `@threepipe/webgi-plugins` package:

```bash
npm install @threepipe/webgi-plugins
```

## Basic Setup

```typescript
import {ThreeViewer, GBufferPlugin, SSAAPlugin} from 'threepipe'
import {SSReflectionPlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: false,
    plugins: [GBufferPlugin, SSAAPlugin]
})

// Add SSR plugin (inline mode - recommended)
const ssr = viewer.addPluginSync(new SSReflectionPlugin(true))

// Load a scene with reflective materials
await viewer.load('model.glb')
```

With this setup, all physically-based materials (PhysicalMaterial) with metallic or reflective properties will automatically show screen-space reflections.

## Configuration

### Reflection Quality

Control the quality and accuracy of reflections:

```typescript
const ssrPass = ssr.pass

// Step count: ray-marching steps per ray (1-32)
ssrPass.stepCount = 16 // Balanced (default)
ssrPass.stepCount = 24 // Higher quality
ssrPass.stepCount = 8  // Better performance

// Ray count: number of rays per pixel (1-8)
ssrPass.rayCount = 1 // Sharp reflections (default)
ssrPass.rayCount = 4 // Smoother rough reflections

// Ray blend mode
ssrPass.rayBlendMax = false // Average rays (default)
ssrPass.rayBlendMax = true  // Use maximum value
```

Higher step counts improve accuracy but reduce performance. More rays create smoother reflections on rough surfaces but multiply the cost.

### Reflection Intensity & Appearance

Adjust the strength and look of reflections:

```typescript
const ssrPass = ssr.pass

// Intensity: overall reflection strength (0-4)
ssrPass.intensity = 1.0 // Default
ssrPass.intensity = 0.5 // Subtle reflections
ssrPass.intensity = 2.0 // Strong reflections

// Power: controls falloff with roughness (0-3)
ssrPass.power = 1.1 // Default
ssrPass.power = 2.0 // Stronger on smooth surfaces

// Boost: color multiplier per channel
ssrPass.boost.set(1, 1, 1) // No boost (default)
ssrPass.boost.set(1.2, 1.1, 1.0) // Slightly warm

// Roughness factor: scales material roughness (0.1-1.25)
ssrPass.roughnessFactor = 1.0 // Use material roughness
ssrPass.roughnessFactor = 0.8 // Reduce roughness effect
```

### Ray-Tracing Parameters

Fine-tune the ray-tracing algorithm:

```typescript
const ssrPass = ssr.pass

// Object radius: scene scale for ray stepping (0.01-2)
ssrPass.objectRadius = 1.0 // Default, adjust based on scene size

// Auto radius: automatically calculate from scene bounds
ssrPass.autoRadius = true // Automatic (default)
ssrPass.autoRadius = false // Use manual objectRadius

// Tolerance: intersection threshold (0.1-5)
ssrPass.tolerance = 0.5 // Default
ssrPass.tolerance = 0.2 // Tighter (fewer artifacts, may miss hits)
ssrPass.tolerance = 1.0 // Looser (more hits, may have artifacts)
```

### Front Ray Masking

Control reflections of surfaces facing the camera:

```typescript
const ssrPass = ssr.pass

// Mask front-facing rays to reduce self-reflections
ssrPass.maskFrontRays = true // Enabled (default)
ssrPass.maskFrontRays = false // Show all reflections

// Mask factor: threshold for front-facing test (-1 to 1)
ssrPass.maskFrontFactor = -0.2 // Default
ssrPass.maskFrontFactor = 0.0  // More aggressive masking
ssrPass.maskFrontFactor = -0.5 // Less masking
```

### Performance Optimization

Reduce quality during motion for better performance:

```typescript
const ssrPass = ssr.pass

// Low quality frames: reduce quality for N frames after movement (0-4)
ssrPass.lowQualityFrames = 0 // Always full quality (default)
ssrPass.lowQualityFrames = 2 // Reduced quality during motion
```

This temporarily reduces step and ray counts when the camera moves, improving responsiveness.

### Per-Material Control

Enable or disable SSR for specific materials:

```typescript
import {SSReflectionPlugin} from '@threepipe/webgi-plugins'

// Disable SSR for a material
material.userData.ssreflDisabled = true

// Enable non-physical mode (artistic control)
material.userData.ssreflNonPhysical = true

// Changes require material update
material.setDirty()
```

Non-physical mode ignores PBR rules and reflects based on intensity alone, useful for artistic effects.

## Advanced Usage

### Inline vs Post-Process Mode

Choose the rendering mode based on your needs:

```typescript
// Inline mode (recommended): SSR calculated during main render
const ssr = new SSReflectionPlugin(true)

// Post-process mode: SSR calculated in separate pass
const ssr = new SSReflectionPlugin(
    false,                // inline = false
    UnsignedByteType,     // buffer type
    1.0                   // buffer size multiplier
)
```

**Inline mode** (default):
- Better performance (single render pass)
- Direct integration with material shading
- No separate buffer required
- Recommended for most use cases

**Post-process mode**:
- Separate SSR buffer for debugging
- Can apply additional processing to reflections
- More memory usage
- Useful for advanced effects

### Temporal Stability

Combine with TAA for temporally stable reflections:

```typescript
import {
    SSReflectionPlugin,
    TemporalAAPlugin,
    VelocityBufferPlugin
} from '@threepipe/webgi-plugins'

// Add plugins in order
const ssr = viewer.addPluginSync(new SSReflectionPlugin(true))
const velocityBuffer = viewer.addPluginSync(new VelocityBufferPlugin())
const taa = viewer.addPluginSync(new TemporalAAPlugin())

// SSR automatically uses velocity data for temporal reprojection
// This reduces flickering and improves quality over multiple frames
```

The velocity buffer helps SSR reproject previous frame data correctly when objects or camera move.

### Integration with Ground Plane

SSR works well with ground planes for floor reflections:

```typescript
import {BaseGroundPlugin} from 'threepipe'

const ssr = viewer.addPluginSync(new SSReflectionPlugin(true))

// Important: Add ground AFTER SSR to avoid z-fighting issues
const ground = viewer.addPluginSync(new BaseGroundPlugin())

// Configure ground for reflections
ground.material.roughness = 0.2
ground.material.metalness = 0.0
ground.material.color.set(0x1B1B1F)
```

The ground plane will show reflections of objects above it.

### Debug Split View

Compare SSR effect side-by-side:

```typescript
// Enable split view
ssr.pass.split = 0.5

// Values from 0-1 control the split position
// Left side shows without SSR, right side with SSR
// Set to 0 to disable split mode
```

Perfect for tuning parameters and demonstrating the effect.

### Combining with Bloom

SSR and Bloom work together for realistic bright reflections:

```typescript
import {SSReflectionPlugin, BloomPlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: false,
    maxHDRIntensity: 8, // Enable HDR for bloom
    plugins: [GBufferPlugin, BloomPlugin, SSAAPlugin]
})

const ssr = viewer.addPluginSync(new SSReflectionPlugin(true))
const bloom = viewer.addPluginSync(new BloomPlugin())

// Bright areas reflect with bloom glow
bloom.pass.intensity = 1.0
bloom.pass.threshold = 1.5
```

### Visualizing the SSR Buffer (Post-Process Mode)

In post-process mode, visualize the SSR buffer:

```typescript
import {RenderTargetPreviewPlugin} from 'threepipe'

const ssr = new SSReflectionPlugin(false) // Post-process mode
viewer.addPluginSync(ssr)

// Add preview plugin
const preview = viewer.addPluginSync(new RenderTargetPreviewPlugin())
preview.addTarget(
    () => ssr.target,
    'ssrefl',
    true // show in UI
)
```

## How It Works

The SSReflectionPlugin implements a sophisticated screen-space ray-tracing algorithm:

1. **Ray Generation**: For each pixel, generates reflection rays based on surface normal and view direction
   - Multiple rays for rough surfaces (distributed around reflection vector)
   - Ray direction influenced by material roughness

2. **Ray Marching**: Traces rays through the depth buffer
   - Steps along ray direction in screen space
   - Compares ray depth to scene depth at each step
   - Configurable step count and tolerance

3. **Intersection Testing**: Detects when ray intersects scene geometry
   - Depth comparison with tolerance threshold
   - Front-ray masking to avoid self-intersections
   - Object radius affects step size

4. **Reflection Lookup**: Samples color at intersection point
   - Reads from current or previous frame buffer
   - Applies roughness-based filtering
   - Blends multiple ray samples

5. **Temporal Reprojection**: Uses velocity buffer for stability
   - Reprojects previous frame reflections
   - Reduces noise and flickering
   - Maintains quality during motion

6. **Material Integration**: Composites reflections with material
   - Modulates by material properties (metalness, roughness)
   - Physical or non-physical blending modes
   - Respects material enable/disable flags

The inline mode integrates steps 1-6 directly into the material shader, while post-process mode renders to a separate buffer first.

## Performance Considerations

- **Step Count**: Primary performance factor - directly multiplies ray-marching cost
- **Ray Count**: Secondary performance factor - multiplies per-pixel cost
- **Resolution**: Full-resolution ray-tracing is expensive
- **Inline Mode**: Better performance than post-process mode
- **Scene Complexity**: More depth variance = more ray-marching work

Tips for optimization:
- Start with `stepCount: 16` and `rayCount: 1`
- Use `lowQualityFrames: 2` for responsive camera movement
- Disable SSR on non-reflective materials
- Consider lower `roughnessFactor` to reduce multi-ray needs
- Use TAA to improve quality without increasing ray count

## Use Cases

The SSReflectionPlugin is ideal for:

1. **Product Visualization**: Showcasing metallic, glossy, or polished products
2. **Automotive Rendering**: Reflections on car paint, chrome, and glass
3. **Architectural Visualization**: Reflective floors, glass, and polished surfaces
4. **Jewelry & Watches**: Realistic metallic reflections on precious materials
5. **Interior Design**: Mirror and glossy furniture reflections
6. **Game Environments**: Real-time reflections in interactive scenes
7. **Technical Demos**: Showcasing advanced rendering capabilities

## Limitations

SSR has inherent screen-space limitations:

- **Off-Screen Objects**: Cannot reflect objects not visible on screen
- **Edge Artifacts**: Reflections may fade at screen edges
- **Occluded Surfaces**: Cannot reflect surfaces behind other geometry
- **Depth Discontinuities**: May show artifacts at sharp depth changes

For complete reflections, consider combining with:
- Environment maps for distant/off-screen reflections
- Reflection probes for local reflections
- [SSGIPlugin](./SSGIPlugin) for indirect lighting

## Common Patterns

### Glossy Product Showcase

For product visualization with strong reflections:

```typescript
ssr.pass.stepCount = 20
ssr.pass.rayCount = 1
ssr.pass.intensity = 1.5
ssr.pass.power = 1.5
ssr.pass.roughnessFactor = 0.9
```

### Subtle Architectural Reflections

For realistic architectural scenes:

```typescript
ssr.pass.stepCount = 16
ssr.pass.rayCount = 1
ssr.pass.intensity = 0.8
ssr.pass.power = 1.0
ssr.pass.roughnessFactor = 1.0
ssr.pass.maskFrontRays = true
```

### Performance-Optimized Mobile

For mobile devices:

```typescript
ssr.pass.stepCount = 8
ssr.pass.rayCount = 1
ssr.pass.intensity = 1.0
ssr.pass.lowQualityFrames = 3
ssr.pass.tolerance = 0.8
```

## Dependencies

- **[GBufferPlugin](./GBufferPlugin)** (required): Provides depth and normal data for ray-tracing
- **[SSAAPlugin](./SSAAPlugin)** (required): Anti-aliasing for cleaner reflections
- **[VelocityBufferPlugin](./VelocityBufferPlugin)** (optional): Enables temporal reprojection
- **[ProgressivePlugin](./ProgressivePlugin)** (required): Frame accumulation for temporal effects

## Troubleshooting

**Reflections not visible:**
- Ensure materials have `metalness > 0` or `roughness < 1`
- Check that GBufferPlugin is added before SSReflectionPlugin
- Verify material is PhysicalMaterial (not compatible with other material types)
- Make sure `intensity > 0`

**Flickering or noisy reflections:**
- Add [TemporalAAPlugin](./TemporalAAPlugin) for temporal stability
- Add [VelocityBufferPlugin](./VelocityBufferPlugin) for better reprojection
- Increase `stepCount` for more accurate ray-marching
- Adjust `tolerance` for better intersection detection

**Self-reflections or artifacts:**
- Enable `maskFrontRays` (default: true)
- Adjust `maskFrontFactor` (try values between -0.5 and 0.0)
- Increase `tolerance` slightly
- Check `objectRadius` matches scene scale

**Performance issues:**
- Reduce `stepCount` (try 8-12)
- Use `rayCount: 1` for sharp reflections
- Enable `lowQualityFrames` for motion
- Disable SSR on non-metallic materials
- Consider reducing canvas resolution

**Reflections cut off at edges:**
- This is a limitation of screen-space techniques
- Combine with environment map for background reflections
- Adjust camera framing to keep reflected objects on screen

## Examples

Check out these examples to see the plugin in action:

- [SSReflection Plugin](https://threepipe.org/examples/#ssreflection-plugin/) - Basic SSR setup with watch model
- [Bloom Plugin](https://threepipe.org/examples/#bloom-plugin/) - SSR combined with bloom effect

## See Also

- [BloomPlugin](./BloomPlugin) - HDR bloom that works well with SSR
- [TemporalAAPlugin](./TemporalAAPlugin) - Anti-aliasing for stable reflections
- [VelocityBufferPlugin](./VelocityBufferPlugin) - Motion vectors for temporal reprojection
- [GBufferPlugin](./GBufferPlugin) - Required depth and normal buffers
- [SSGIPlugin](./SSGIPlugin) - Screen-space global illumination
- [DepthBufferPlugin](./DepthBufferPlugin) - Depth buffer generation

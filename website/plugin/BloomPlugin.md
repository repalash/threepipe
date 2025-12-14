---
prev:
  text: 'VelocityBufferPlugin'
  link: './VelocityBufferPlugin'

next:
  text: 'SSReflectionPlugin'
  link: './SSReflectionPlugin'

aside: false
---

# BloomPlugin (HDR Bloom)

[Example](https://threepipe.org/examples/#bloom-plugin/) &mdash;
[API Reference](https://webgi.dev/docs/classes/BloomPlugin.html)

<iframe src="https://threepipe.org/examples/bloom-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Bloom Plugin Example"></iframe>

Bloom Plugin adds a high-quality HDR bloom post-processing effect that creates glowing halos around bright areas in the scene, simulating the way real cameras capture bright light sources.

The BloomPlugin implements a multi-pass Gaussian blur technique that extracts bright areas from the rendered scene based on a threshold, blurs them progressively at multiple resolutions, and composites the result back onto the original image for a realistic glow effect.

## Features

- **HDR Bloom**: Properly handles High Dynamic Range values for realistic bloom
- **Multi-Pass Blurring**: Uses progressive downsampling and upsampling for efficient, high-quality blur
- **Threshold Control**: Configurable brightness threshold and soft threshold for smooth transitions
- **Adjustable Intensity**: Control the strength of the bloom effect
- **Radius & Power Controls**: Fine-tune the spread and falloff of the glow
- **Per-Material Control**: Enable or disable bloom for individual materials
- **Background Bloom**: Optional bloom effect on the scene background
- **Configurable Iterations**: Adjust quality vs performance with iteration count
- **Debug Mode**: Visualize the bloom buffer for tuning
- **GBuffer Integration**: Respects material flags for selective bloom rendering

## Installation

This plugin is part of the `@threepipe/webgi-plugins` package:

```bash
npm install @threepipe/webgi-plugins
```

## Basic Setup

```typescript
import {ThreeViewer} from 'threepipe'
import {BloomPlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: false,
    maxHDRIntensity: 8, // Maximum HDR intensity for bloom
})

// Add the bloom plugin
const bloom = viewer.addPluginSync(new BloomPlugin())

// Configure basic settings
bloom.pass.intensity = 0.5
bloom.pass.threshold = 1.5
```

With this setup, any bright areas in your scene (above the threshold) will have a glowing bloom effect.

## Configuration

### Intensity & Threshold

Control which areas bloom and how strong the effect is:

```typescript
const bloomPass = bloom.pass

// Intensity: strength of the bloom effect (0-3)
bloomPass.intensity = 0.5 // Subtle bloom
bloomPass.intensity = 2.0 // Strong bloom

// Threshold: minimum brightness for bloom (0-2)
bloomPass.threshold = 1.0 // Only very bright areas bloom
bloomPass.threshold = 0.5 // More areas bloom

// Soft Threshold: smooth transition (0-1)
bloomPass.softThreshold = 0.5 // Smooth falloff
bloomPass.softThreshold = 0.0 // Sharp cutoff
```

The threshold determines which pixels contribute to bloom:
- **Lower threshold**: More areas glow, including moderately bright surfaces
- **Higher threshold**: Only the brightest lights and reflections glow
- **Soft threshold**: Creates smooth transitions at the threshold boundary

### Quality Settings

Adjust the quality and performance of the bloom effect:

```typescript
// Iterations: more iterations = higher quality but slower (2-7)
bloomPass.bloomIterations = 4 // Balanced (default)
bloomPass.bloomIterations = 7 // Highest quality
bloomPass.bloomIterations = 2 // Fastest

// Radius: controls the spread of the blur (0-1)
bloomPass.radius = 0.6 // Default
bloomPass.radius = 0.3 // Tighter bloom
bloomPass.radius = 0.9 // Wider bloom

// Power: controls the falloff curve (0.2-10)
bloomPass.power = 1.0 // Linear (default)
bloomPass.power = 2.0 // More concentrated in center
bloomPass.power = 0.5 // More spread out
```

Higher iterations provide smoother, more realistic bloom but impact performance. Adjust based on your target hardware.

### Background Bloom

Control whether the scene background receives bloom:

```typescript
// Enable bloom on the background
bloomPass.backgroundBloom = true

// Useful when you have a bright HDR environment
await viewer.setEnvironmentMap('bright_sunset.hdr', {
    setBackground: true,
})
```

### Per-Material Control

Enable or disable bloom for specific materials:

```typescript
import {BloomPlugin} from '@threepipe/webgi-plugins'

// Disable bloom for a specific material
material.userData[BloomPlugin.PluginType] = {
    enable: false
}

// Or use the helper method
BloomPlugin.AddBloomData(material, {
    enable: true // or false
})

// This material will now participate (or not) in bloom
material.setDirty()
```

This is useful for:
- Disabling bloom on UI elements
- Excluding certain objects from the glow effect
- Creating selective bloom for specific materials only

## Advanced Usage

### HDR Workflow Integration

Bloom works best with HDR rendering and proper tonemapping:

```typescript
import {ThreeViewer} from 'threepipe'
import {BloomPlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: false,
    rgbm: false, // Use true HDR rendering
    maxHDRIntensity: 16, // Support higher brightness values
})

const bloom = viewer.addPluginSync(new BloomPlugin())

// Configure tonemap plugin for HDR
const tonemap = viewer.getPluginSync('Tonemap')
if (tonemap) {
    tonemap.exposure = 1.0
    tonemap.toneMapping = 'ACESFilmic'
}

// Bloom will now properly handle HDR values
bloom.pass.threshold = 2.0 // Threshold in HDR space
bloom.pass.intensity = 1.0
```

### Debug Mode

Visualize the bloom buffer to understand which areas are contributing:

```typescript
// Show only the bloom buffer
bloom.pass.bloomDebug = true

// This displays the extracted and blurred bright areas
// Useful for tweaking threshold and intensity
```

In debug mode, you'll see:
- White/bright areas: Contributing to bloom
- Black areas: Below threshold
- Use this to fine-tune your threshold settings

### Combining with Other Effects

Bloom works well with other post-processing effects:

```typescript
import {ThreeViewer, SSAAPlugin} from 'threepipe'
import {
    BloomPlugin,
    TemporalAAPlugin,
    SSReflectionPlugin
} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: false,
    plugins: [SSAAPlugin]
})

// Add effects in order
const bloom = viewer.addPluginSync(new BloomPlugin())
const taa = viewer.addPluginSync(new TemporalAAPlugin())
const ssr = viewer.addPluginSync(new SSReflectionPlugin())

// Bloom is applied before screen passes
// Works seamlessly with TAA and SSR
```

### Dynamic Intensity Control

Animate bloom intensity for dramatic effects:

```typescript
import {PopmotionPlugin, EasingFunctions} from 'threepipe'

const popmotion = viewer.getOrAddPluginSync(PopmotionPlugin)

// Pulse bloom intensity
popmotion.animate({
    from: 0.5,
    to: 2.0,
    repeat: Infinity,
    repeatType: 'reverse',
    duration: 2000,
    ease: EasingFunctions.easeInOutSine,
    onUpdate: (v) => {
        bloom.pass.intensity = v
    },
})
```

### Emissive Materials for Bloom

Create materials that glow by setting their emissive properties:

```typescript
import {PhysicalMaterial, Color} from 'threepipe'

const glowMaterial = new PhysicalMaterial()

// Set emissive color and intensity
glowMaterial.emissive = new Color(0xff6600)
glowMaterial.emissiveIntensity = 3.0 // Higher values bloom more

// The emissive parts will now bloom
object.material = glowMaterial
```

Emissive materials are perfect for:
- Light sources (lamps, screens, buttons)
- Glowing sci-fi elements
- Neon signs and displays
- Energy effects

## How It Works

The BloomPlugin operates through multiple rendering passes:

1. **Prefilter Pass**: Extracts bright areas above the threshold
   - Reads the rendered scene
   - Applies threshold and soft threshold filtering
   - Outputs only bright pixels to a half-resolution target

2. **Downsampling Passes**: Progressive blur at multiple resolutions
   - Each iteration reduces resolution by 2x
   - Applies Gaussian blur weights
   - Creates a blur pyramid (e.g., 1/2, 1/4, 1/8, 1/16 resolution)
   - Configurable iterations (2-7 passes)

3. **Upsampling Passes**: Combine blurred layers
   - Processes blur pyramid in reverse order
   - Upsamples and additively blends each level
   - Uses weighted blending based on radius and power settings

4. **Composite Pass**: Blend bloom with original scene
   - Adds the final bloom buffer to the original render
   - Preserves HDR values
   - Applies intensity scaling

This multi-resolution approach provides efficient, high-quality bloom with minimal performance impact.

## Performance Considerations

- **Iteration Count**: Primary performance factor - fewer iterations = better performance
- **Resolution**: Bloom uses half-resolution buffers to save memory
- **Threshold**: Higher thresholds = less area to process = better performance
- **Half Float Textures**: Uses 16-bit float textures for efficiency
- **Temp Target Pooling**: Reuses temporary render targets to minimize allocation

Tips for optimization:
- Start with `bloomIterations: 4` and adjust as needed
- Use higher thresholds (1.5-2.0) for performance-critical applications
- Disable bloom on materials that don't need it
- Consider disabling `backgroundBloom` if not needed

## Use Cases

The BloomPlugin is ideal for:

1. **Realistic Lighting**: Simulating camera bloom from bright light sources
2. **Sci-Fi Scenes**: Glowing energy effects, holograms, and futuristic interfaces
3. **Product Visualization**: Highlighting metallic and reflective surfaces
4. **Automotive Rendering**: Enhancing chrome, headlights, and polished surfaces
5. **Jewelry & Watches**: Creating sparkle and shine on precious materials
6. **Game Environments**: Adding atmospheric glow to lamps, screens, and effects
7. **Architectural Visualization**: Realistic lighting from windows and fixtures

## Common Patterns

### Subtle Realistic Bloom

For photorealistic scenes:

```typescript
bloom.pass.threshold = 1.5
bloom.pass.softThreshold = 0.5
bloom.pass.intensity = 0.3
bloom.pass.bloomIterations = 5
bloom.pass.radius = 0.6
```

### Strong Stylized Bloom

For artistic or sci-fi scenes:

```typescript
bloom.pass.threshold = 0.8
bloom.pass.softThreshold = 0.7
bloom.pass.intensity = 2.0
bloom.pass.bloomIterations = 6
bloom.pass.radius = 0.8
bloom.pass.power = 1.5
```

### Performance-Optimized Bloom

For mobile or low-end devices:

```typescript
bloom.pass.threshold = 1.8
bloom.pass.intensity = 0.5
bloom.pass.bloomIterations = 3
bloom.pass.radius = 0.5
```

## Dependencies

- **[GBufferPlugin](./GBufferPlugin)** (required): Provides material flags for selective bloom rendering

## Troubleshooting

**Bloom too subtle or not visible:**
- Ensure scene has HDR values (`maxHDRIntensity` > 1)
- Lower the threshold value
- Increase intensity
- Check if materials have emissive properties

**Bloom too strong or blown out:**
- Increase threshold
- Decrease intensity
- Reduce emissive intensity on materials
- Adjust soft threshold for smoother falloff

**Performance issues:**
- Reduce `bloomIterations` (try 3-4)
- Increase threshold to bloom fewer areas
- Disable bloom on unnecessary materials
- Reduce canvas resolution with `renderScale`

## Examples

Check out these examples to see the plugin in action:

- [Bloom Plugin](https://threepipe.org/examples/#bloom-plugin/) - Basic bloom setup and configuration
- [Velocity Buffer Plugin](https://threepipe.org/examples/#velocity-buffer-plugin/) - Bloom combined with TAA

## See Also

- [TemporalAAPlugin](./TemporalAAPlugin) - Anti-aliasing that works well with bloom
- [SSReflectionPlugin](./SSReflectionPlugin) - Screen-space reflections for realistic lighting
- [TonemapPlugin](./TonemapPlugin) - HDR tonemapping for proper bloom exposure
- [GBufferPlugin](./GBufferPlugin) - Required dependency for material flags

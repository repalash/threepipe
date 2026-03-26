---
prev:
  text: 'FrameFadePlugin'
  link: './FrameFadePlugin'

next:
  text: 'VelocityBufferPlugin'
  link: './VelocityBufferPlugin'

aside: false
---

# TemporalAAPlugin (Temporal Anti-Aliasing Plugin)

[Example](https://threepipe.org/examples/#temporalaa-plugin/) &mdash;
[API Reference](https://webgi.dev/docs/classes/TemporalAAPlugin.html)

<iframe src="https://threepipe.org/examples/temporalaa-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Temporal AA Plugin Example"></iframe>

Temporal Anti-Aliasing (TAA) plugin that smooths out the final image when the camera or objects are moving by blending frames over time.

The `TemporalAAPlugin` provides a high-quality anti-aliasing solution that works in real-time during camera movement or object animation. Unlike [SSAAPlugin](./SSAAPlugin) which requires multiple renders per frame(or multiple frames), TAA accumulates samples across multiple dynamic frames for a smoother result with better performance.

It automatically interfaces with [ProgressivePlugin](./ProgressivePlugin) for frame accumulation and runs only when the camera or any objects in the scene are moving. 
It requires [GBufferPlugin](./GBufferPlugin) for depth and normal information used in reprojection calculations. 
Optionally, it can also utilize [VelocityBufferPlugin](./VelocityBufferPlugin) to improve quality when dealing with fast-moving objects.

## Features

- **Real-time Anti-aliasing**: Provides smooth anti-aliasing during camera movement and animation
- **Frame Accumulation**: Intelligently blends current and previous frames to reduce aliasing artifacts
- **Motion Vectors**: Works with velocity data to maintain quality during movement
- **Configurable Feedback**: Adjustable temporal feedback for controlling blur and sharpness
- **Stable Noise**: Optional stable(deterministic) noise generation across frames for better convergence
- **Debug Mode**: Built-in velocity visualization for debugging

## Installation

This plugin is part of the `@threepipe/webgi-plugins` package:

```bash
npm install @threepipe/webgi-plugins
```

## Basic Setup

```typescript
import {ThreeViewer, GBufferPlugin} from 'threepipe'
import {TemporalAAPlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    plugins: [GBufferPlugin] // GBufferPlugin is required
})

// Add the TAA plugin
const taa = viewer.addPluginSync(new TemporalAAPlugin())
taa.stableNoise = true // Enable stable noise for better quality
```

With this setup, the plugin will automatically provide temporal anti-aliasing during camera movement and scene animation. The plugin integrates seamlessly with the viewer's rendering pipeline and works alongside other post-processing effects.

## Configuration

### Temporal Feedback

Control how much the previous frame influences the current frame:

```typescript
// Access the pass settings
const taaPass = taa.pass

// Adjust feedback (default: [0.88, 0.97])
// Lower values = more responsive but less smooth
// Higher values = smoother but more ghosting
taaPass.feedBack.set(0.85, 0.95)
```

The `feedBack` vector contains two values:
- **X component**: Min Value
- **Y component**: Max Value

### Stable Noise

Enable stable noise generation for consistent random values across frames:

```typescript
taa.stableNoise = true
```

When enabled, the plugin uses the total frame count rather than resetting on dirty frames. This produces smoother progressive rendering results when combined with effects that use random sampling.

### Debug Mode

Visualize motion vectors for debugging:

```typescript
taa.pass.debugVelocity = true
```

This renders the velocity buffer directly to the screen, helping you understand object and camera motion.

## Advanced Usage

### Integration with Other Effects

TAA works seamlessly with other post-processing plugins:

```typescript
import {ThreeViewer, GBufferPlugin} from 'threepipe'
import {
    TemporalAAPlugin,
    BloomPlugin,
    SSReflectionPlugin
} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: false,
    plugins: [GBufferPlugin, BloomPlugin, SSReflectionPlugin]
})

const taa = viewer.addPluginSync(new TemporalAAPlugin())
```

### Combining with VelocityBufferPlugin

For enhanced motion-based effects and better TAA quality with animated objects:

```typescript
import {VelocityBufferPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'

const taa = viewer.addPluginSync(new TemporalAAPlugin())
const velocityBuffer = viewer.addPluginSync(new VelocityBufferPlugin())

// TAA will automatically use velocity data when available
```

The [VelocityBufferPlugin](./VelocityBufferPlugin) provides per-pixel motion vectors that help TAA handle fast-moving objects more accurately.

### Performance Considerations

TAA vs SSAA for different scenarios:

```typescript
// For real-time interactive scenes (recommended)
const taa = viewer.addPluginSync(new TemporalAAPlugin())

// For static/slow scenes where you want highest quality
const ssaa = viewer.addPluginSync(new SSAAPlugin())
ssaa.rendersPerFrame = 4 // Multiple renders per frame

// TAA: Better for animation, 1 render/frame, temporal artifacts possible
// SSAA: Better for static scenes, N renders/frame, higher GPU cost
```

## How It Works

The TemporalAAPlugin operates by:

1. **Capturing Frame History**: Stores the previous frame's render in a buffer
2. **Reprojection**: Uses camera matrices to align previous frame data with current frame
3. **Motion Compensation**: Accounts for camera and object movement using velocity data
4. **Temporal Blending**: Intelligently blends current and previous frames based on feedback values
5. **Artifact Reduction**: Applies quality controls to minimize ghosting and smearing

The plugin automatically integrates with the [ProgressivePlugin](./ProgressivePlugin) for frame accumulation and requires the [GBufferPlugin](./GBufferPlugin) for depth and normal information used in reprojection calculations.

## Dependencies

- **[GBufferPlugin](./GBufferPlugin)** (required): Provides depth and normal data for reprojection
- **[ProgressivePlugin](./ProgressivePlugin)** (required): Handles frame accumulation
- **[VelocityBufferPlugin](./VelocityBufferPlugin)** (optional): Enhances motion handling for animated objects

## Notes

- **Ghosting**: Some temporal ghosting may occur with fast-moving objects; adjust feedback values to minimize
- **First Frame**: The first frame after camera movement may show slight artifacts as temporal data accumulates
- **Automatic Reset**: The plugin automatically resets on window resize to prevent artifacts
- **Background TAA**: Optionally applies TAA to background elements when MSAA is enabled on the render target

## Examples

Check out these examples to see the plugin in action:

- [Temporal AA Plugin](https://threepipe.org/examples/#temporalaa-plugin/) - Basic TAA setup and configuration
- [Velocity Buffer Plugin](https://threepipe.org/examples/#velocity-buffer-plugin/) - TAA with motion vectors for animated objects

## See Also

- [SSAAPlugin](./SSAAPlugin) - Alternative anti-aliasing for static scenes
- [VelocityBufferPlugin](./VelocityBufferPlugin) - Motion vector generation for enhanced TAA
- [ProgressivePlugin](./ProgressivePlugin) - Frame accumulation system
- [GBufferPlugin](./GBufferPlugin) - Geometry buffer for reprojection data


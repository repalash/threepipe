---
prev:
  text: 'TemporalAAPlugin'
  link: './TemporalAAPlugin'

next:
  text: 'BloomPlugin'
  link: './BloomPlugin'

aside: false
---

# VelocityBufferPlugin

[Example](https://threepipe.org/examples/#velocity-buffer-plugin/) &mdash;
[API Reference](https://webgi.dev/docs/classes/VelocityBufferPlugin.html)

<iframe src="https://threepipe.org/examples/velocity-buffer-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Velocity Buffer Plugin Example"></iframe>

Velocity Buffer Plugin generates per-pixel motion vectors that encode the movement of objects and camera between frames, essential for motion-based effects like Temporal Anti-Aliasing (TAA) and motion blur.

The VelocityBufferPlugin creates a pre-render pass that calculates the velocity of each pixel by comparing the current and previous frame's object positions and camera matrices. This velocity data is stored in a render target that can be used by other post-processing effects.

## Features

- **Per-Pixel Motion Vectors**: Generates accurate velocity data for every pixel in the scene
- **Object and Camera Tracking**: Tracks both object transformations and camera movement
- **Previous Frame Storage**: Automatically stores and compares previous world matrices for each object
- **Seamless TAA Integration**: Automatically integrates with [TemporalAAPlugin](./TemporalAAPlugin) when both are enabled
- **Configurable Buffer Type**: Choose the texture data type for the velocity buffer
- **Material Override Support**: Individual materials can opt-out of velocity buffer rendering
- **Alpha Map Support**: Respects alpha maps and alpha testing from object materials

## Installation

This plugin is part of the `@threepipe/webgi-plugins` package:

```bash
npm install @threepipe/webgi-plugins
```

## Basic Setup

```typescript
import {ThreeViewer} from 'threepipe'
import {VelocityBufferPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: false,
})

// Add the velocity buffer plugin
const velocityBuffer = viewer.addPluginSync(new VelocityBufferPlugin())

// Optionally add TAA plugin (will automatically use velocity data)
const taa = viewer.addPluginSync(new TemporalAAPlugin())
```

With this setup, the plugin will automatically generate velocity data each frame that can be consumed by TAA and other effects.

## Configuration

### Buffer Type

Choose the texture data type for the velocity buffer:

```typescript
import {HalfFloatType, UnsignedByteType} from 'threepipe'

// Higher precision (default: UnsignedByteType)
const velocityBuffer = new VelocityBufferPlugin(HalfFloatType)

// Lower precision, better performance
const velocityBuffer = new VelocityBufferPlugin(UnsignedByteType)
```

The buffer type affects both memory usage and precision:
- **`UnsignedByteType`** (default): 8-bit precision, sufficient for most TAA use cases
- **`HalfFloatType`**: 16-bit precision, better for high-velocity movements or motion blur

### Accessing Velocity Data

The velocity buffer can be accessed by other plugins or custom effects:

```typescript
const velocityBuffer = viewer.getPluginSync(VelocityBufferPlugin)

// Access the render target
const velocityTarget = velocityBuffer.target

// Access the velocity texture
const velocityTexture = velocityBuffer.texture

// Use in a custom shader or material extension
material.uniforms.tVelocity = {value: velocityTexture}
```

### Disabling for Specific Objects

You can disable velocity buffer rendering for specific objects by setting material userData:

```typescript
import {VelocityBufferPlugin} from '@threepipe/webgi-plugins'

// Disable velocity rendering for a specific material
material.userData[VelocityBufferPlugin.PluginType] = {
    disabled: true
}
```

This is useful for objects that don't need motion tracking or cause artifacts in the velocity buffer.

## Advanced Usage

### Manual TAA Integration

If you need to manually integrate velocity data into custom effects:

```typescript
const velocityBuffer = viewer.addPluginSync(new VelocityBufferPlugin(
    UnsignedByteType, // buffer type
    true,             // enabled
    false             // don't auto-attach to TAA
))

// Manually access the velocity unpack extension
const unpackExtension = velocityBuffer.unpackExtension

// Use in your custom material
myMaterial.registerMaterialExtensions([unpackExtension])
```

### Debugging Velocity Data

Use the [RenderTargetPreviewPlugin](./RenderTargetPreviewPlugin) to visualize the velocity buffer:

```typescript
import {RenderTargetPreviewPlugin} from 'threepipe'

const preview = viewer.addPluginSync(new RenderTargetPreviewPlugin())
preview.addTarget(
    () => velocityBuffer.target,
    'velocityBuffer',
    true, // showInUi
    true, // showPreview
    true  // flip
)
```

This displays the velocity buffer on screen, where:
- **Red/Green channels**: Encode X/Y screen-space velocity
- **Gray (0.5, 0.5)**: Represents zero velocity
- **Brighter/Darker**: Indicates movement direction and magnitude

### Animation Integration

For animated objects, the plugin automatically tracks transformations:

```typescript
import {PopmotionPlugin, EasingFunctions} from 'threepipe'

const popmotion = viewer.getOrAddPluginSync(PopmotionPlugin)

// Animate object position
popmotion.animate({
    from: 0,
    to: 1,
    repeat: Infinity,
    duration: 2000,
    ease: EasingFunctions.easeInOutSine,
    onUpdate: (v) => {
        object.position.x = Math.sin(v * Math.PI * 2) * 2
        object.setDirty()
    },
})

// Velocity buffer automatically tracks the movement
```

## How It Works

The VelocityBufferPlugin operates through the following process:

1. **Matrix Storage**: Before each render, stores the current world matrix of each object
2. **Projection Calculation**: Computes current and previous projection-view matrices from the camera
3. **Velocity Rendering**: Renders the scene with a special shader that:
   - Projects object vertices using current transformation
   - Projects same vertices using previous frame's transformation
   - Calculates screen-space motion vector from the difference
4. **Encoding**: Motion vectors are encoded in the render target (typically RG channels)
5. **Distribution**: Makes velocity data available to other plugins via material extensions

The velocity is calculated per-pixel and accounts for:
- Object transformations (position, rotation, scale)
- Camera movement (position, rotation, FOV changes)
- Object animations (skeletal, morph targets, etc.)

## Dependencies

This plugin has no hard dependencies but automatically integrates with:

- **[TemporalAAPlugin](./TemporalAAPlugin)** (optional): Consumes velocity data for better anti-aliasing during motion

## Performance Considerations

- **Extra Render Pass**: Adds one full-scene render pass before the main render
- **Memory Usage**: Requires a render target matching screen resolution
- **Matrix Tracking**: Stores one Matrix4 per unique object (minimal overhead)
- **First Frame**: Initial frame has zero velocity as there's no previous frame data

Tips for optimization:
- Use `UnsignedByteType` instead of `HalfFloatType` when possible
- Disable velocity rendering for static objects that never move
- Consider disabling for objects that are always off-screen

## Use Cases

The VelocityBufferPlugin is essential for:

1. **Temporal Anti-Aliasing**: Provides motion vectors for [TemporalAAPlugin](./TemporalAAPlugin) to handle animated objects correctly
2. **Motion Blur**: Can be used to create realistic motion blur effects based on object velocity
3. **Temporal Effects**: Any effect that needs to track motion between frames
4. **Object Tracking**: Identifying and tracking fast-moving objects in the scene

## Examples

Check out these examples to see the plugin in action:

- [Velocity Buffer Plugin](https://threepipe.org/examples/#velocity-buffer-plugin/) - Basic velocity buffer setup with visualization
- [Temporal AA Plugin](https://threepipe.org/examples/#temporalaa-plugin/) - TAA using velocity data for animated objects

## See Also

- [TemporalAAPlugin](./TemporalAAPlugin) - Primary consumer of velocity buffer data
- [DepthBufferPlugin](./DepthBufferPlugin) - Similar buffer generation for depth data
- [NormalBufferPlugin](./NormalBufferPlugin) - Similar buffer generation for normal data
- [GBufferPlugin](./GBufferPlugin) - Comprehensive geometry buffer system

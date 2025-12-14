---
prev:
  text: 'SSContactShadowsPlugin (Screen-Space Contact Shadows)'
  link: './SSContactShadowsPlugin'

next:
  text: 'SSGIPlugin (Screen-Space Global Illumination)'
  link: './SSGIPlugin'

aside: false
---

# DepthOfFieldPlugin (Depth of Field Plugin)

[Example](https://threepipe.org/examples/#depthoffield-plugin/) &mdash;
[API Reference](https://webgi.dev/docs/classes/DepthOfFieldPlugin.html)

<iframe src="https://threepipe.org/examples/depthoffield-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Depth of Field Plugin Example"></iframe>

Depth of Field (DOF) Plugin adds realistic camera focus effects by blurring areas that are closer or farther than the focal point, simulating the behavior of physical camera lenses and drawing attention to specific subjects.

The DepthOfFieldPlugin implements a high-quality multi-pass depth of field algorithm that computes circle of confusion (CoC) based on distance from the focal plane, applies sophisticated blur using Poisson disk sampling, and composites the result for photorealistic bokeh effects.

## Features

- **Interactive Focal Point**: Click on objects to set focus (with edit mode enabled)
- **Configurable Depth Range**: Adjust the depth of field falloff
- **Separate Near/Far Blur**: Independent control for foreground and background blur
- **High-Quality Poisson Blur**: Uses disk sampling for realistic bokeh
- **Visual Focus Indicator**: Shows focal point with crosshair overlay
- **Smooth Transitions**: Automatic cross-fade when changing focus
- **GBuffer Integration**: Leverages depth data for accurate CoC calculation
- **Half-Resolution Processing**: Efficient blur computation at lower resolution
- **Progressive Rendering Support**: Works with temporal accumulation
- **Programmatic Control**: Set focal point via API or user interaction

## Installation

This plugin is part of the `@threepipe/webgi-plugins` package:

```bash
npm install @threepipe/webgi-plugins
```

## Basic Setup

```typescript
import {ThreeViewer, PickingPlugin} from 'threepipe'
import {DepthOfFieldPlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: true,
    plugins: [PickingPlugin] // For interactive focus
})

// Add DOF plugin
const dof = viewer.addPluginSync(new DepthOfFieldPlugin())

// Enable interactive editing (click to focus)
dof.enableEdit = true

// Load model
await viewer.load('model.glb')

// Set initial focal point
dof.setFocalPoint(new Vector3(0, 1, 0), false, true)
```

With this setup, users can click on objects to change the focal point, and areas outside the focal range will be blurred.

## Configuration

### Depth Range

Control the depth of field range (how quickly blur increases with distance):

```typescript
const dofPass = dof.pass

// Depth range: controls DoF falloff (0.25-3)
dofPass.depthRange = 1.5 // Default, moderate DoF
dofPass.depthRange = 0.5 // Shallow DoF (tight focus)
dofPass.depthRange = 2.5 // Deep DoF (wider focus range)
```

Smaller values create a tighter focus with stronger blur, similar to a wide aperture lens (f/1.4). Larger values create a wider focus range with gentler blur, like a narrow aperture (f/16).

### Near and Far Blur Scale

Independently control foreground and background blur strength:

```typescript
const dofPass = dof.pass

// Near blur scale: blur strength for objects closer than focal point (0-1)
dofPass.nearBlurScale = 0.25 // Default, subtle foreground blur
dofPass.nearBlurScale = 0.5  // Stronger foreground blur
dofPass.nearBlurScale = 0.0  // No foreground blur

// Far blur scale: blur strength for objects farther than focal point (0-1)
dofPass.farBlurScale = 0.25 // Default, subtle background blur
dofPass.farBlurScale = 0.8  // Strong background blur
dofPass.farBlurScale = 0.0  // No background blur
```

You can create effects like:
- **Portrait mode**: High far blur, low near blur
- **Macro photography**: High near and far blur
- **Selective focus**: Different blur strengths for artistic control

### Interactive Focus

Enable or disable interactive focal point selection:

```typescript
// Enable clicking to set focus
dof.enableEdit = true

// Disable interactive focus
dof.enableEdit = false

// Users can now click on objects to change the focal point
// A crosshair indicator shows where focus is set
```

When enabled, clicking on objects automatically sets the focal point to the clicked location with smooth transitions.

### Transition Settings

Control the fade animation when changing focus:

```typescript
// Cross-fade time in milliseconds (default: 200ms)
dof.crossFadeTime = 200  // Quick transition
dof.crossFadeTime = 500  // Slower, cinematic transition
dof.crossFadeTime = 1000 // Very slow transition

// The focal point indicator shows during transitions
```

Longer transition times create smoother, more cinematic focus changes.

## Advanced Usage

### Programmatic Focus Control

Set focal point via code with full control:

```typescript
import {Vector3} from 'threepipe'

// Set focal point to specific world position
const focalPoint = new Vector3(5, 2, 0)

// With smooth transition and visual indicator
dof.setFocalPoint(focalPoint, true, true)

// Without transition (instant)
dof.setFocalPoint(focalPoint, false, false)

// Get current focal point
const currentFocus = dof.getFocalPoint()
console.log('Focus at:', currentFocus)
```

The three parameters of `setFocalPoint` are:
- **point**: World-space position (Vector3)
- **fade**: Enable smooth cross-fade transition (boolean)
- **showGizmo**: Show crosshair indicator (boolean)

### Camera-Relative Focus

Focus on objects relative to camera:

```typescript
// Get object position
const objectPos = model.position.clone()

// Set focus with transition
dof.setFocalPoint(objectPos, true, true)

// Update camera to look at the same point
viewer.scene.mainCamera.target.copy(objectPos)
viewer.scene.mainCamera.setDirty()
```

### Focus Animation

Animate focus changes over time:

```typescript
import {PopmotionPlugin, EasingFunctions, Vector3} from 'threepipe'

const popmotion = viewer.getOrAddPluginSync(PopmotionPlugin)

const startPos = new Vector3(0, 0, 0)
const endPos = new Vector3(5, 0, 0)
const tempPos = new Vector3()

popmotion.animate({
    from: 0,
    to: 1,
    duration: 3000,
    ease: EasingFunctions.easeInOutQuad,
    onUpdate: (v) => {
        // Interpolate between positions
        tempPos.lerpVectors(startPos, endPos, v)
        dof.setFocalPoint(tempPos, false, false)
    },
})
```

This creates a smooth focus pull effect between two points.

### Combining with Bloom

DOF and Bloom work together for cinematic effects:

```typescript
import {DepthOfFieldPlugin, BloomPlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: true,
    maxHDRIntensity: 8
})

// Add both effects
const dof = viewer.addPluginSync(new DepthOfFieldPlugin())
const bloom = viewer.addPluginSync(new BloomPlugin())

// Configure for bokeh effect with bright highlights
bloom.pass.intensity = 1.5
bloom.pass.threshold = 1.0
dof.pass.depthRange = 1.0
dof.pass.farBlurScale = 0.6
```

Bright areas in blurred regions create realistic bokeh with glowing highlights.

### Rack Focus Effect

Create a focus pull between two objects:

```typescript
// Start focused on object A
const objectA = scene.getObjectByName('objectA')
dof.setFocalPoint(objectA.position, false, true)

// After delay, pull focus to object B
setTimeout(() => {
    const objectB = scene.getObjectByName('objectB')
    dof.setFocalPoint(objectB.position, true, true)
}, 2000)

// The smooth transition creates a cinematic rack focus
```

### Custom Focal Distance

Set focus at specific distance from camera:

```typescript
const camera = viewer.scene.mainCamera

// Get camera position and direction
const camPos = camera.position.clone()
const camDir = camera.getWorldDirection(new Vector3())

// Set focal point 5 units ahead of camera
const focalPoint = camPos.add(camDir.multiplyScalar(5))
dof.setFocalPoint(focalPoint, true, false)
```

### Disable Transitions with FrameFadePlugin

Control frame fade behavior:

```typescript
import {FrameFadePlugin} from 'threepipe'

const frameFade = viewer.getPluginSync(FrameFadePlugin)

if (frameFade) {
    // Disable automatic frame fades during DOF transitions
    frameFade.enabled = false
}

// Or adjust the fade duration via crossFadeTime
dof.crossFadeTime = 100 // Faster, less noticeable fade
```

## How It Works

The DepthOfFieldPlugin operates through a multi-pass rendering pipeline:

1. **Depth Sampling**: Read depth buffer from GBufferPlugin
   - Gets per-pixel depth information
   - Camera near/far values from scene

2. **Circle of Confusion (CoC) Computation**: Calculate blur amount per pixel
   - Computes distance from focal plane
   - Applies depth range formula
   - Separate CoC for near and far regions
   - Outputs to half-resolution render target

3. **CoC Expansion**: Blur the near-field CoC
   - Two-pass separable blur (horizontal + vertical)
   - Spreads foreground blur into background
   - Prevents sharp edges on near-field blur

4. **Poisson Disk Blur**: Apply high-quality blur
   - Uses Poisson disk sampling pattern
   - Multiple samples distributed in disk shape
   - Weighted by CoC value
   - Creates realistic bokeh effect
   - Operates at half-resolution for efficiency

5. **Final Composition**: Blend sharp and blurred images
   - Uses CoC as blend factor
   - Composites near and far blur
   - Adds optional crosshair indicator
   - Outputs final depth-of-field result

The multi-pass approach provides high-quality results while maintaining good performance through half-resolution blur processing.

## Performance Considerations

- **Half-Resolution Blur**: DOF processes blur at 50% resolution for efficiency
- **Multi-Pass Overhead**: Requires 5+ render passes (CoC, expand, blur, composite)
- **Poisson Sampling**: High-quality but more expensive than box blur
- **GBuffer Dependency**: Requires depth buffer (minimal extra cost)
- **Memory Usage**: Multiple half-resolution render targets

Tips for optimization:
- Reduce `depthRange` for simpler blur calculations
- Lower blur scales reduce blur intensity and sampling
- Consider disabling during camera motion on lower-end devices
- Half-resolution processing already provides good performance balance

## Use Cases

The DepthOfFieldPlugin is ideal for:

1. **Product Visualization**: Focus attention on specific product features
2. **Cinematic Presentations**: Create film-like focus effects
3. **Character Portraits**: Blur background for subject emphasis
4. **Interactive Stories**: Guide viewer attention through focus changes
5. **Photography Simulation**: Realistic camera depth of field
6. **Macro Visualization**: Simulate close-up photography effects
7. **Focus Reveals**: Dramatically change scene focus for impact

## Common Patterns

### Portrait Photography Effect

For subject isolation with blurred background:

```typescript
dof.pass.depthRange = 1.0
dof.pass.nearBlurScale = 0.15
dof.pass.farBlurScale = 0.6
dof.enableEdit = true

// Focus on subject's face
dof.setFocalPoint(facePosition, true, false)
```

### Macro Photography Effect

For extreme close-ups with strong blur:

```typescript
dof.pass.depthRange = 0.5
dof.pass.nearBlurScale = 0.7
dof.pass.farBlurScale = 0.7

// Very shallow depth of field
```

### Cinematic Rack Focus

For dramatic focus pulls between subjects:

```typescript
dof.crossFadeTime = 800 // Slow, cinematic
dof.pass.depthRange = 1.2
dof.pass.farBlurScale = 0.5

// Pull focus between objects with smooth transition
```

### Subtle Product Focus

For gentle emphasis without distraction:

```typescript
dof.pass.depthRange = 2.0
dof.pass.nearBlurScale = 0.15
dof.pass.farBlurScale = 0.25

// Subtle blur, maintains context
```

## Dependencies

- **[GBufferPlugin](./GBufferPlugin)** (required): Provides depth buffer for CoC calculation
- **[PickingPlugin](./PickingPlugin)** (optional): Enables interactive focus selection
- **[FrameFadePlugin](./FrameFadePlugin)** (optional): Provides smooth transitions between focus changes

## Troubleshooting

**DOF not visible:**
- Check that depth range is appropriate for scene scale
- Increase blur scale values (near/far)
- Ensure focal point is set (visible with showGizmo)
- Verify GBufferPlugin is loaded

**Interactive focus not working:**
- Enable with `dof.enableEdit = true`
- Ensure PickingPlugin is added
- Check that objects have geometry to click on
- Verify objects are not marked as non-pickable

**Blur too strong or weak:**
- Adjust `depthRange` (smaller = stronger blur)
- Modify blur scales (`nearBlurScale`, `farBlurScale`)
- Check focal point distance from objects
- Scene scale affects blur perception

**Artifacts or harsh edges:**
- Increase `depthRange` for gentler falloff
- Reduce blur scale values if over-blurred
- Ensure proper depth buffer in GBufferPlugin
- Check for depth discontinuities in geometry

**Performance issues:**
- DOF is relatively expensive (5+ passes)
- Consider disabling during camera motion
- Reduce canvas resolution if needed
- Half-resolution processing already optimized
- Check if other heavy effects are combined

**Focus transitions too fast/slow:**
- Adjust `crossFadeTime` property (milliseconds)
- Shorter times = snappier focus changes
- Longer times = smoother, cinematic pulls
- Default 200ms is generally good

## Examples

Check out these examples to see the plugin in action:

- [Depth of Field Plugin](https://threepipe.org/examples/#depthoffield-plugin/) - Interactive DOF with focus selection
- [Bloom Plugin](https://threepipe.org/examples/#bloom-plugin/) - DOF combined with bloom for bokeh

## See Also

- [BloomPlugin](./BloomPlugin) - Creates bokeh highlights in blurred areas
- [SSReflectionPlugin](./SSReflectionPlugin) - Screen-space reflections
- [GBufferPlugin](./GBufferPlugin) - Required depth buffer
- [PickingPlugin](./PickingPlugin) - Enables interactive focus selection
- [FrameFadePlugin](./FrameFadePlugin) - Smooth transition effects
- [ProgressivePlugin](./ProgressivePlugin) - Frame accumulation support

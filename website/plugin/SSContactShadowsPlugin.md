---
prev:
  text: 'SSReflectionPlugin'
  link: './SSReflectionPlugin'

next:
  text: 'DepthOfFieldPlugin'
  link: './DepthOfFieldPlugin'

aside: false
---

# SSContactShadowsPlugin (Screen Space Contact Shadows Plugin)

[Example](https://threepipe.org/examples/#sscontactshadows-plugin/) &mdash;
[API Reference](https://webgi.dev/docs/classes/SSContactShadowsPlugin.html)

<iframe src="https://threepipe.org/examples/sscontactshadows-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe SS Contact Shadows Plugin Example"></iframe>

Screen Space Contact Shadows Plugin enhances traditional shadow maps by adding detailed contact shadows where objects meet surfaces, using screen-space ray-tracing to create soft, realistic shadows at contact points.

The SSContactShadowsPlugin extends the shadow system by tracing rays from lit surfaces toward light sources through the depth buffer. This creates subtle, ambient occlusion-like shadows at contact areas that standard shadow maps often miss, significantly improving visual realism especially for small details and object-ground intersections.

## Features

- **Screen-Space Ray Tracing**: Traces shadow rays through depth buffer for contact areas
- **Enhances Existing Shadows**: Works alongside traditional shadow maps, not as a replacement
- **Configurable Radius**: Control the size of the contact shadow search area
- **Adjustable Intensity**: Fine-tune shadow strength for artistic control
- **Per-Material Control**: Enable or disable contact shadows for individual materials
- **Minimal Performance Impact**: Efficient ray-marching with configurable step count
- **GBuffer Integration**: Leverages depth data for accurate ray-tracing
- **Progressive Rendering**: Supports temporal noise patterns for smoother results
- **Debug Mode**: Visualize only contact shadows for tuning
- **Light-Aware**: Respects all directional and spot light directions

## Installation

This plugin is part of the `@threepipe/webgi-plugins` package:

```bash
npm install @threepipe/webgi-plugins
```

## Basic Setup

```typescript
import {ThreeViewer, GBufferPlugin, BaseGroundPlugin} from 'threepipe'
import {SSContactShadowsPlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: true,
    plugins: [GBufferPlugin, BaseGroundPlugin]
})

// Add contact shadows plugin
const sscs = viewer.addPluginSync(new SSContactShadowsPlugin())

// Enable stable noise for cleaner results
viewer.renderManager.stableNoise = true

// Add a directional light with shadows
const light = new DirectionalLight2(0xffffff, 4)
light.position.set(2, 2, 2)
light.castShadow = true
viewer.scene.addObject(light)

// Load model - contact shadows appear automatically
await viewer.load('model.glb')
```

With this setup, objects will show enhanced contact shadows where they meet other surfaces, creating more realistic and grounded appearance.

## Configuration

### Basic Parameters

Control the appearance and quality of contact shadows:

```typescript
// Radius: size of the shadow search area (0.0001-0.1)
sscs.radius = 0.015 // Default, subtle contact shadows
sscs.radius = 0.030 // Larger, softer shadows
sscs.radius = 0.005 // Tighter, sharper shadows

// Intensity: shadow strength (0-1)
sscs.intensity = 1.0 // Default, full strength
sscs.intensity = 0.5 // Subtle, light shadows
sscs.intensity = 1.0 // Strong, dramatic shadows

// Tolerance: ray intersection threshold (0.1-5)
sscs.tolerance = 1.5 // Default
sscs.tolerance = 0.5 // More precise (fewer artifacts)
sscs.tolerance = 3.0 // More forgiving (may have artifacts)
```

The radius parameter is the most important for controlling the look:
- **Smaller radius**: Tight, hard-edged contact shadows (faster)
- **Larger radius**: Soft, ambient occlusion-like shadows (slower)

### Quality Settings

Adjust the ray-tracing quality:

```typescript
// Step count: ray-marching steps (1-8)
sscs.stepCount = 2 // Default, fast
sscs.stepCount = 4 // Higher quality
sscs.stepCount = 1 // Fastest, may have gaps

// Each step increases the search distance but adds computation
```

More steps improve shadow continuity but increase rendering cost. The default of 2 steps provides a good balance.

### Debug Mode

Visualize only contact shadows for tuning:

```typescript
// Show only contact shadows (no regular lighting)
sscs.onlySSCSDebug = true

// This displays:
// - White: No contact shadow
// - Dark: Strong contact shadow
// - Useful for adjusting radius and intensity
```

### Per-Material Control

Disable contact shadows for specific materials:

```typescript
// Disable contact shadows on a material
material.userData.sscsDisabled = true

// Re-enable
material.userData.sscsDisabled = false

// Changes require material update
material.setDirty()
```

This is useful for:
- Transparent or translucent materials
- UI elements or overlays
- Materials that shouldn't cast contact shadows
- Performance optimization on distant objects

## Advanced Usage

### Lighting Setup

Contact shadows work best with properly configured lights:

```typescript
import {DirectionalLight2, PCFSoftShadowMap} from 'threepipe'

// Create directional light with shadows
const light = new DirectionalLight2(0xffffff, 4)
light.position.set(2, 2, 2)
light.lookAt(0, 0, 0)

// Shadow map configuration
light.castShadow = true
light.shadowMapSize.setScalar(1024) // Or 2048 for higher quality
light.shadowNear = 0.1
light.shadowFar = 10
light.shadowFrustum = 4

// Use soft shadow map for better blending
viewer.renderManager.renderer.shadowMap.type = PCFSoftShadowMap

viewer.scene.addObject(light)
```

Contact shadows enhance the existing shadow map rather than replacing it.

### Ground Plane Integration

Works seamlessly with ground planes:

```typescript
import {BaseGroundPlugin} from 'threepipe'

// Add ground before loading model
const ground = viewer.addPluginSync(new BaseGroundPlugin())

// Contact shadows automatically work on ground
ground.material.roughness = 0.5
ground.material.color.set(0x808080)

// Add contact shadows plugin
const sscs = viewer.addPluginSync(new SSContactShadowsPlugin())

// Objects will now show contact shadows on the ground
```

### Multiple Lights

Contact shadows work with all shadow-casting lights:

```typescript
// Directional light (sun)
const sun = new DirectionalLight2(0xffffee, 3)
sun.position.set(5, 10, 5)
sun.castShadow = true
viewer.scene.addObject(sun)

// Spot light (accent)
const spot = new SpotLight2(0xffffff, 10)
spot.position.set(-2, 3, 2)
spot.castShadow = true
spot.angle = Math.PI / 6
viewer.scene.addObject(spot)

// Contact shadows enhance both lights automatically
```

### Stable Noise for Cleaner Results

Enable stable noise for better temporal stability:

```typescript
// Enable stable noise pattern
viewer.renderManager.stableNoise = true

// Combine with progressive rendering for high quality
const progressive = viewer.getPluginSync(ProgressivePlugin)
if (progressive) {
    progressive.convergeMode = true
}

// Contact shadows will accumulate smoothly over frames
```

### Visualizing Shadow Maps

Debug shadow maps alongside contact shadows:

```typescript
import {RenderTargetPreviewPlugin} from 'threepipe'

const preview = viewer.addPluginSync(new RenderTargetPreviewPlugin())

// Preview shadow map
const light = viewer.scene.getObjectByType(DirectionalLight2)
if (light?.shadow.map) {
    preview.addTarget(
        () => light.shadow.map,
        'shadowMap',
        true, // show in UI
        true, // show preview
        true  // flip Y
    )
}
```

### Performance Tuning by Scene Scale

Adjust parameters based on your scene size:

```typescript
// Small objects (jewelry, watches)
sscs.radius = 0.005
sscs.stepCount = 2
sscs.tolerance = 0.5

// Medium objects (products, furniture)
sscs.radius = 0.015
sscs.stepCount = 2
sscs.tolerance = 1.5

// Large objects (vehicles, buildings)
sscs.radius = 0.030
sscs.stepCount = 3
sscs.tolerance = 2.0
```

## How It Works

The SSContactShadowsPlugin operates by modifying the shadow calculation in materials:

1. **Shadow Map Evaluation**: Traditional shadow map is sampled first
   - Regular Three.js shadow mapping runs normally
   - Shadow map provides base shadow information

2. **Ray Origin Setup**: For lit pixels, set up ray origin
   - Origin is the surface point in view space
   - Direction is toward the light source

3. **Screen-Space Ray Tracing**: Trace ray through depth buffer
   - Configurable number of steps (typically 2-4)
   - Each step checks depth buffer for intersections
   - Uses scene bounding radius for adaptive sampling
   - Random noise pattern avoids banding artifacts

4. **Intersection Detection**: Check if ray hits geometry
   - Compares ray depth to scene depth with tolerance
   - Tolerance prevents false positives
   - Early termination on first hit

5. **Shadow Modulation**: Darken pixels where ray hits geometry
   - Intensity controls shadow strength
   - Result multiplied with existing shadow map value
   - Creates darkening at contact areas

6. **Final Composition**: Combine with material lighting
   - Contact shadows integrated into standard lighting pipeline
   - Works with all material properties
   - Respects existing shadow attenuation

The plugin enhances rather than replaces standard shadows, working alongside Three.js shadow maps.

## Performance Considerations

- **Step Count**: Primary performance factor - keep at 2-4 for most cases
- **Radius**: Larger radius = more searching = slower (but usually negligible)
- **Resolution**: Operates at full resolution, scales with screen size
- **Per-Light Cost**: Runs for each shadow-casting light
- **GBuffer Requirement**: Needs depth buffer, minimal extra cost

Tips for optimization:
- Use `stepCount: 2` for most applications (default)
- Disable on materials that don't need contact shadows
- Reduce `radius` for distant objects if needed
- Consider disabling for mobile devices if performance critical

## Use Cases

The SSContactShadowsPlugin is ideal for:

1. **Product Visualization**: Enhanced contact between products and surfaces
2. **Jewelry & Watches**: Subtle shadows on small details and contact points
3. **Architectural Interiors**: Improved shadow definition at wall-floor junctions
4. **Furniture Visualization**: Realistic shadows where furniture meets floors
5. **Character Rendering**: Better ground contact for feet and props
6. **Technical Demos**: Showcasing advanced shadow techniques
7. **High-Quality Renders**: Adding that extra layer of realism

## Limitations

Screen-space contact shadows have inherent limitations:

- **Off-Screen Geometry**: Cannot create shadows from objects outside the view
- **Screen-Space Only**: Limited to visible geometry in the depth buffer
- **Small Search Radius**: Not suitable for large-scale shadow simulation
- **Light Direction Dependent**: Quality depends on light-surface angle
- **Not a Shadow Map Replacement**: Enhances, doesn't replace traditional shadows

Contact shadows work best as an **enhancement** to existing shadow maps, not as a standalone solution.

## Common Patterns

### Subtle Product Enhancement

For product visualization with natural-looking shadows:

```typescript
sscs.radius = 0.010
sscs.intensity = 0.8
sscs.stepCount = 2
sscs.tolerance = 1.0

// Use with soft PCF shadows
viewer.renderManager.renderer.shadowMap.type = PCFSoftShadowMap
```

### Strong Artistic Effect

For dramatic, high-contrast contact shadows:

```typescript
sscs.radius = 0.025
sscs.intensity = 1.0
sscs.stepCount = 3
sscs.tolerance = 1.5

// Combine with strong directional lighting
light.intensity = 5
```

### Performance-Optimized

For mobile or lower-end devices:

```typescript
sscs.radius = 0.012
sscs.intensity = 0.7
sscs.stepCount = 1
sscs.tolerance = 2.0

// Use smaller shadow map size
light.shadowMapSize.setScalar(512)
```

## Dependencies

- **[GBufferPlugin](./GBufferPlugin)** (required): Provides depth buffer for ray-tracing
- **[ProgressivePlugin](./ProgressivePlugin)** (optional): Enables temporal stability
- **[BaseGroundPlugin](./BaseGroundPlugin)** (recommended): Provides ground plane for shadows

## Troubleshooting

**Contact shadows not visible:**
- Ensure lights have `castShadow = true`
- Check that materials have `receiveShadow = true` (default)
- Verify GBufferPlugin is loaded
- Try increasing `intensity` or `radius`
- Check that `sscsDisabled` is not set on materials

**Artifacts or noise in shadows:**
- Enable `viewer.renderManager.stableNoise = true`
- Reduce `radius` value
- Adjust `tolerance` (try lower values like 0.5-1.0)
- Increase `stepCount` for smoother results

**Performance issues:**
- Reduce `stepCount` to 1 or 2
- Decrease `radius` value
- Disable contact shadows on distant or small objects
- Consider using lower shadow map resolution

**Shadows too strong or dark:**
- Reduce `intensity` (try 0.5-0.8)
- Decrease `radius` for tighter shadows
- Adjust regular shadow map settings (bias, near/far)

**Shadows in wrong locations:**
- Check light position and direction
- Verify shadow frustum encompasses the scene
- Adjust `tolerance` parameter
- Ensure scene scale matches `radius` expectations

## Examples

Check out these examples to see the plugin in action:

- [SS Contact Shadows Plugin](https://threepipe.org/examples/#sscontactshadows-plugin/) - Basic contact shadows setup with directional light
- [Contact Shadow Ground Plugin](https://threepipe.org/examples/#contact-shadow-ground-plugin/) - Ground plane with contact shadows

## See Also

- [SSReflectionPlugin](./SSReflectionPlugin) - Screen-space reflections using similar ray-tracing
- [GBufferPlugin](./GBufferPlugin) - Required depth buffer system
- [BaseGroundPlugin](./BaseGroundPlugin) - Ground plane for shadow receiving
- [CascadedShadowsPlugin](./CascadedShadowsPlugin) - Advanced shadow mapping for large scenes
- [SSAOPlugin](./SSAOPlugin) - Ambient occlusion for similar depth-based effects


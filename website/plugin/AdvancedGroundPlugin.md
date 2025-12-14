---
prev:
  text: 'AnisotropyPlugin'
  link: './AnisotropyPlugin'

next:
  text: 'OutlinePlugin'
  link: './OutlinePlugin'

aside: false
---

# AdvancedGroundPlugin

[Example](https://threepipe.org/examples/#advanced-ground-plugin/) &mdash;
[API Reference](https://webgi.dev/docs/classes/AdvancedGroundPlugin.html)

<iframe src="https://threepipe.org/examples/advanced-ground-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Advanced Ground Plugin Example"></iframe>

Advanced Ground Plugin extends the BaseGroundPlugin with additional features including planar reflections and baked shadow support. It creates a configurable ground plane that can display real-time reflections and accumulate high-quality soft shadows over multiple frames, providing a professional presentation foundation for 3D models.

The AdvancedGroundPlugin builds upon the basic ground plane functionality by adding a sophisticated reflection system using render-to-texture and an advanced shadow baking system with customizable soft shadows, automatic frustum sizing, and optional alpha vignette effects for transparent grounds.

## Features

- **Planar Reflections**: Real-time mirror-like reflections on the ground surface
- **Physical/Non-Physical Modes**: Toggle between accurate and artistic reflection behavior
- **Baked Soft Shadows**: Multi-frame shadow accumulation for smooth, realistic shadows
- **Automatic Shadow Updates**: Shadows update automatically when scene changes
- **Customizable Shadow Light**: Randomized directional light with adjustable parameters
- **Auto Frustum Sizing**: Shadow map frustum automatically matches ground size
- **Multiple Shadow Types**: Basic, PCF, PCFSoft, and VSM shadow map types
- **Alpha Vignette**: Fade shadows at edges for transparent ground planes
- **Shadow Smoothing**: Optional blur filter for even softer shadows
- **Render Target Preview**: Debug shadow maps and baked shadow textures
- **Inherited Features**: All BaseGroundPlugin features (size, position, material, etc.)
- **SSR Integration**: Automatically disables screen-space reflections on ground

## Installation

This plugin is part of the `@threepipe/webgi-plugins` package:

```bash
npm install @threepipe/webgi-plugins
```

## Basic Setup

```typescript
import {ThreeViewer, GBufferPlugin, SSAAPlugin} from 'threepipe'
import {AdvancedGroundPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: true,
    plugins: [GBufferPlugin, SSAAPlugin, TemporalAAPlugin]
})

// Add advanced ground with planar reflections
const ground = viewer.addPluginSync(new AdvancedGroundPlugin())
ground.groundReflection = true
ground.material.roughness = 0.2

// Load model
await viewer.load('model.glb')
```

With this setup, the scene will have a reflective ground plane with baked soft shadows, creating a professional product visualization look.

## Configuration

### Ground Visibility and Transform

Control basic ground plane properties (inherited from BaseGroundPlugin):

```typescript
// Visibility
ground.visible = true  // Show/hide ground
ground.enabled = true  // Same as visible

// Size (in scene units)
ground.size = 8    // Default, 8x8 units
ground.size = 15   // Larger ground
ground.size = 0    // Hide ground

// Vertical position
ground.yOffset = 0    // Default, at model's base
ground.yOffset = -0.5 // Lower ground
ground.yOffset = 0.1  // Raised ground

// Auto-adjust to scene
ground.autoAdjustTransform = true // Default, automatically fits under model
ground.autoAdjustTransform = false // Manual positioning
```

The ground automatically positions itself under the scene's bounding box when `autoAdjustTransform` is enabled.

### Planar Reflections

Enable and configure real-time reflections:

```typescript
// Enable planar reflections
ground.groundReflection = true  // Enable reflections
ground.groundReflection = false // Disable (default)

// Reflection mode
ground.physicalReflections = true  // Physically accurate (default)
ground.physicalReflections = false // Non-physical, artistic control

// Material roughness affects reflection blur
ground.material.roughness = 0.0  // Perfect mirror
ground.material.roughness = 0.2  // Slightly blurred
ground.material.roughness = 0.5  // More diffuse
ground.material.roughness = 1.0  // No reflections visible
```

Planar reflections render the scene from a mirrored camera position into a texture, which is then applied to the ground material. The `physicalReflections` setting determines whether reflections follow PBR rules or use more artistic blending.

### Baked Shadows

Configure the advanced shadow baking system:

```typescript
// Enable/disable baked shadows
ground.bakedShadows = true  // Enable (default)
ground.bakedShadows = false // Disable

// Auto-update shadows when scene changes
ground.autoBakeShadows = true  // Default, automatic updates
ground.autoBakeShadows = false // Manual control

// Manually trigger shadow bake (when autoBakeShadows is false)
ground.bakeShadows()

// Shadow accumulation frames
ground.shadowBaker.maxFrameNumber = 64  // Default, 64 frames
ground.shadowBaker.maxFrameNumber = 128 // Higher quality, slower
ground.shadowBaker.maxFrameNumber = 32  // Faster, less smooth
```

Baked shadows accumulate over multiple frames with a randomized light position, creating extremely soft and realistic shadows without the typical shadow map artifacts.

### Shadow Light Configuration

Customize the virtual light used for shadow baking:

```typescript
const shadowBaker = ground.shadowBaker

// Light parameters (randomized per frame)
const randomParams = shadowBaker.light.randomParams

// Focus: how centered the light randomization is (0-1)
randomParams.focus = 0.5   // Default, balanced
randomParams.focus = 0.8   // More focused, harder shadows
randomParams.focus = 0.2   // Less focused, softer shadows

// Spread: randomization amount (0-1)
randomParams.spread = 0.5  // Default
randomParams.spread = 0.8  // More spread, very soft shadows
randomParams.spread = 0.2  // Less spread, sharper shadows

// Distance scale: light distance multiplier
randomParams.distanceScale = 10  // Default
randomParams.distanceScale = 20  // Farther light, softer shadows
randomParams.distanceScale = 5   // Closer light, harder shadows

// Direction: base light direction (normalized vector)
randomParams.direction.set(0.5, -1, 0.3)
randomParams.normalDirection.set(0, -1, 0)

// Shadow radius: penumbra size
shadowBaker.light.shadowParams.radius = 1  // Default
shadowBaker.light.shadowParams.radius = 3  // Softer edges
shadowBaker.light.shadowParams.radius = 0  // Sharp edges

// Shadow bias: prevents self-shadowing artifacts
shadowBaker.light.shadowParams.bias = -0.0001 // Default
shadowBaker.light.shadowParams.bias = -0.001  // More bias if artifacts appear
```

These parameters control the randomized light that creates soft shadows through multi-frame accumulation.

### Shadow Map Type

Choose the shadow map algorithm:

```typescript
import {BasicShadowMap, PCFShadowMap, PCFSoftShadowMap, VSMShadowMap} from 'threepipe'

// Set shadow map type
ground.shadowBaker.shadowMapType = PCFSoftShadowMap // Default, best quality
ground.shadowBaker.shadowMapType = PCFShadowMap      // Good quality, faster
ground.shadowBaker.shadowMapType = VSMShadowMap      // Variance shadow maps
ground.shadowBaker.shadowMapType = BasicShadowMap    // Fastest, hard shadows

// Smooth the final baked shadow
ground.shadowBaker.smoothShadow = true  // Default, applies blur
ground.shadowBaker.smoothShadow = false // No additional smoothing
```

PCFSoftShadowMap provides the best quality when combined with the multi-frame accumulation.

### Auto Frustum Sizing

Automatically match shadow map frustum to ground size:

```typescript
// Auto-size shadow frustum to ground plane
ground.autoFrustumSize = true  // Default, recommended
ground.autoFrustumSize = false // Manual control

// Manual frustum size (when autoFrustumSize is false)
ground.shadowBaker.light.shadowParams.frustumSize = 10
ground.shadowBaker.light.updateShadowParams()
ground.bakeShadows() // Rebake with new frustum
```

Auto frustum sizing ensures the shadow map covers exactly the ground plane area, maximizing shadow map resolution efficiency.

### Alpha Vignette

Fade shadows at edges for transparent/transmissive grounds:

```typescript
// First make ground transparent or transmissive
ground.material.transparent = true
ground.material.opacity = 0.5
// or
ground.material.transmission = 0.8

// Enable alpha vignette (fades shadow at edges)
ground.shadowBaker.alphaVignette = true  // Enable fade
ground.shadowBaker.alphaVignette = false // No fade (default)

// Vignette axis
ground.shadowBaker.alphaVignetteAxis = 'xy' // Fade on both axes (default)
ground.shadowBaker.alphaVignetteAxis = 'x'  // Fade only horizontally
ground.shadowBaker.alphaVignetteAxis = 'y'  // Fade only vertically
```

Alpha vignette creates a smooth fade at the ground edges, perfect for transparent ground planes that should blend into the background.

### Shadow Map Mode

Choose how shadows are applied to the material:

```typescript
// Shadow application mode
ground.shadowBaker.groundMapMode = 'aoMap'    // Default, as AO
ground.shadowBaker.groundMapMode = 'map'      // As diffuse map
ground.shadowBaker.groundMapMode = 'alphaMap' // As alpha map
```

Different modes affect how the baked shadow interacts with the material's other properties.

### Material Configuration

Access and configure the ground material:

```typescript
const material = ground.material

// Material is a PhysicalMaterial
material.color.set('#ffffff')     // Ground color
material.roughness = 0.8          // Surface roughness
material.metalness = 0.5          // Metallic amount
material.transmission = 0         // Transparency
material.opacity = 1.0            // Opacity

// Add textures
material.map = await viewer.load('ground_color.jpg')
material.normalMap = await viewer.load('ground_normal.jpg')
material.roughnessMap = await viewer.load('ground_roughness.jpg')

material.setDirty()
```

The ground uses a standard PhysicalMaterial, so all PBR properties are available.

## Advanced Usage

### Studio Setup with Reflections

Create a professional studio environment:

```typescript
import {PCFSoftShadowMap} from 'threepipe'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: true,
    rgbm: true,
    plugins: [GBufferPlugin, SSAAPlugin, TemporalAAPlugin]
})

const ground = viewer.addPluginSync(new AdvancedGroundPlugin())

// Enable reflections with low roughness
ground.groundReflection = true
ground.physicalReflections = true
ground.material.roughness = 0.15
ground.material.metalness = 0.2

// Configure soft shadows
ground.bakedShadows = true
ground.shadowBaker.shadowMapType = PCFSoftShadowMap
ground.shadowBaker.maxFrameNumber = 128 // High quality
ground.shadowBaker.light.randomParams.focus = 0.6
ground.shadowBaker.light.randomParams.spread = 0.7

// Load environment and model
await viewer.setEnvironmentMap('studio.hdr', {setBackground: false})
await viewer.load('product.glb')
```

### Transparent Ground with Vignette

Create a ground that fades to transparent at edges:

```typescript
const ground = viewer.addPluginSync(new AdvancedGroundPlugin())

// Make ground transparent
ground.material.transparent = true
ground.material.opacity = 0.7
ground.material.roughness = 0.3

// Enable shadow vignette
ground.bakedShadows = true
ground.shadowBaker.alphaVignette = true
ground.shadowBaker.alphaVignetteAxis = 'xy'

// Soft shadow settings
ground.shadowBaker.maxFrameNumber = 64
ground.shadowBaker.smoothShadow = true
```

### Manual Shadow Control

Take manual control of shadow baking:

```typescript
const ground = viewer.addPluginSync(new AdvancedGroundPlugin())

// Disable auto-baking
ground.autoBakeShadows = false

// Configure shadow parameters
ground.shadowBaker.maxFrameNumber = 96
ground.shadowBaker.light.randomParams.focus = 0.7
ground.shadowBaker.light.randomParams.spread = 0.6

// Manually trigger bake when ready
function rebakeShadows() {
    ground.bakeShadows()
}

// Bake after scene changes
viewer.addEventListener('sceneUpdate', () => {
    setTimeout(rebakeShadows, 100) // Delay to ensure scene is settled
})
```

### Debug Shadow Maps

Preview shadow render targets:

```typescript
import {RenderTargetPreviewPlugin} from 'threepipe'

const rtPreview = viewer.addPluginSync(new RenderTargetPreviewPlugin())

// Preview shadow map
rtPreview.addTarget(
    () => ground.shadowBaker?.light.shadow.map,
    'shadow',
    false, // Not screen space
    false, // Not depth
    true,  // Transform
    (s) => s + ' = vec4(' + s + '.r/2.);' // Adjust visualization
)

// Preview baked shadow texture
rtPreview.addTarget(
    () => ground.shadowBaker?.target,
    'baked shadow',
    false,
    false,
    true
)
```

### Non-Physical Reflections

Use artistic reflection control:

```typescript
const ground = viewer.addPluginSync(new AdvancedGroundPlugin())

ground.groundReflection = true
ground.physicalReflections = false // Non-physical mode

// In non-physical mode, you have more artistic control
ground.material.roughness = 0.5 // Still affects reflection visibility
ground.material.opacity = 0.8   // Can blend reflections

// Perfect for artistic/stylized presentations
```

### Custom Geometry

Replace the ground plane with custom geometry:

```typescript
import {CircleGeometry} from 'threepipe'

const ground = viewer.addPluginSync(new AdvancedGroundPlugin())

// Create circular ground
const circleGeometry = new CircleGeometry(5, 64)
ground.setGeometry(circleGeometry)

// Enable reflections and shadows
ground.groundReflection = true
ground.bakedShadows = true
```

### Camera Limits

Prevent camera from going below ground:

```typescript
const ground = viewer.addPluginSync(new AdvancedGroundPlugin())

// Limit camera to stay above ground
ground.limitCameraAboveGround = true

// Works with OrbitControls3
const camera = viewer.scene.mainCamera
// Camera will not be able to move below the ground plane
```

### Depth and Tonemap Control

Configure rendering behavior:

```typescript
const ground = viewer.addPluginSync(new AdvancedGroundPlugin())

// Render ground to depth buffer (for post-processing)
ground.renderToDepth = true  // Default
ground.renderToDepth = false // Exclude from depth

// Apply tonemapping to ground
ground.tonemapGround = true  // Default, tonemap with scene
ground.tonemapGround = false // No tonemapping (keeps HDR values)

// Requires GBufferPlugin to be active
```

## Integration with Other Plugins

### With SSReflectionPlugin

The AdvancedGroundPlugin automatically manages SSReflectionPlugin:

```typescript
import {SSReflectionPlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    plugins: [GBufferPlugin, SSAAPlugin, SSReflectionPlugin]
})

const ground = viewer.addPluginSync(new AdvancedGroundPlugin())

// When planar reflections are enabled, SSR is disabled for the ground
ground.groundReflection = true // SSR automatically disabled on ground

// When disabled, SSR works normally
ground.groundReflection = false // SSR can work on ground
```

This prevents conflicting reflection systems and ensures optimal performance.

### With TemporalAAPlugin

Combine with temporal anti-aliasing for best quality:

```typescript
import {TemporalAAPlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    plugins: [GBufferPlugin, SSAAPlugin, TemporalAAPlugin]
})

const ground = viewer.addPluginSync(new AdvancedGroundPlugin())

// Temporal AA helps smooth both reflections and shadows
viewer.renderManager.stableNoise = true
```

### With BloomPlugin

Create glowing reflections:

```typescript
import {BloomPlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    maxHDRIntensity: 8,
    plugins: [GBufferPlugin, SSAAPlugin, BloomPlugin]
})

const bloom = viewer.getPlugin(BloomPlugin)
bloom.pass.intensity = 1.5
bloom.pass.threshold = 1.0

const ground = viewer.addPluginSync(new AdvancedGroundPlugin())
ground.groundReflection = true
ground.material.roughness = 0.1

// HDR reflections will bloom on the ground
```

## Performance Considerations

### Planar Reflections

- **Render Cost**: Renders entire scene again from mirrored view
- **Memory**: Creates additional render target (default 1024x1024)
- **Optimization**: 
  - Lower reflection texture resolution for better performance
  - Use higher roughness to hide lower quality
  - Disable reflections on mobile devices

### Baked Shadows

- **Initial Cost**: Takes multiple frames to accumulate (default 64)
- **Runtime Cost**: Minimal once baked (just texture sampling)
- **Memory**: One shadow map + one baked shadow texture
- **Optimization**:
  - Reduce `maxFrameNumber` for faster accumulation
  - Use `BasicShadowMap` for fastest baking
  - Disable `autoBakeShadows` and bake manually when needed

### Combined Features

Using both reflections and baked shadows:
- **Memory**: ~2-3 render targets total
- **Performance**: Reflection has highest cost, baked shadows are cheap
- **Recommendation**: Use for product visualization and static scenes
- **Avoid**: Real-time applications with frequent scene changes

## Common Use Cases

The AdvancedGroundPlugin is ideal for:

1. **Product Visualization**: Professional presentation with reflections and soft shadows
2. **Automotive**: Car configurators with reflective showroom floor
3. **Jewelry**: Highly reflective ground for gems and metals
4. **Architectural Viz**: Polished floor materials in interior scenes
5. **Character Presentation**: Portrait-style ground with soft shadows
6. **E-commerce**: Product shots with professional lighting and reflections
7. **Marketing Materials**: High-quality renders for promotional content

## Troubleshooting

**Reflections not visible:**
- Check that `groundReflection` is true
- Lower material `roughness` (try 0.2 or less)
- Ensure scene has objects above ground to reflect
- Check that ground is properly positioned under scene
- Verify camera can see the ground plane

**Shadows not appearing:**
- Ensure `bakedShadows` is true
- Wait for accumulation (64 frames by default)
- Check that objects are casting shadows (`castShadow = true`)
- Verify shadow light parameters are reasonable
- Look for shadow frustum size issues (enable `autoFrustumSize`)

**Shadows too hard/soft:**
- Adjust `focus` and `spread` in `randomParams`
- Modify `radius` in shadow parameters
- Change `maxFrameNumber` (higher = softer)
- Try different `shadowMapType` (PCFSoftShadowMap is softest)
- Enable `smoothShadow` for additional blur

**Performance issues:**
- Disable reflections with `groundReflection = false`
- Reduce shadow `maxFrameNumber` (try 32 instead of 64)
- Lower reflection texture resolution (modify source code)
- Use `BasicShadowMap` instead of `PCFSoftShadowMap`
- Disable `autoBakeShadows` and bake manually only when needed

**Reflection artifacts:**
- Try toggling `physicalReflections` mode
- Adjust material `roughness` to hide artifacts
- Check for camera near/far plane issues
- Ensure proper scene bounds and ground positioning

**Shadow frustum too small/large:**
- Enable `autoFrustumSize` for automatic sizing
- Manually adjust `ground.size` to match scene
- Modify `frustumSize` directly if needed:
  ```typescript
  ground.shadowBaker.light.shadowParams.frustumSize = 20
  ground.shadowBaker.light.updateShadowParams()
  ground.bakeShadows()
  ```

**Alpha vignette not working:**
- Ensure material is transparent (`transparent = true`) or transmissive (`transmission > 0`)
- Check that `alphaVignette` is enabled
- Verify alpha vignette axis matches your needs
- Material opacity/transmission must be less than 1.0

## API Reference

See the [AdvancedGroundPlugin API documentation](https://webgi.dev/docs/classes/AdvancedGroundPlugin.html) for detailed information on all properties and methods.

## Related Plugins

- [BaseGroundPlugin](https://threepipe.org/docs/classes/BaseGroundPlugin.html) - Basic ground plane functionality
- [SSReflectionPlugin](./SSReflectionPlugin) - Screen-space reflections for materials
- [SSContactShadowsPlugin](./SSContactShadowsPlugin) - Contact shadows enhancement
- [BloomPlugin](./BloomPlugin) - HDR bloom for reflections
- [TemporalAAPlugin](./TemporalAAPlugin) - Temporal anti-aliasing
- [GBufferPlugin](https://threepipe.org/docs/classes/GBufferPlugin.html) - Depth buffer for various effects

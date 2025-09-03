---
prev: 
    text: 'SSAOPlugin'
    link: './SSAOPlugin'

next: 
    text: 'FrameFadePlugin'
    link: './FrameFadePlugin'

aside: false
---

# CascadedShadowsPlugin

[Example](https://threepipe.org/examples/#cascaded-shadows-plugin-basic/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/rendering/CascadedShadowsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/CascadedShadowsPlugin.html) &mdash;
[Original Implementation](https://github.com/StrandedKitty/three-csm)

<iframe src="https://threepipe.org/examples/cascaded-shadows-plugin-basic/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Cascaded Shadows Plugin Example"></iframe>

The [`CascadedShadowsPlugin`](https://threepipe.org/docs/classes/CascadedShadowsPlugin.html) implements [Cascaded Shadow Maps (CSM)](https://en.wikipedia.org/wiki/Cascaded_shadow_maps) to provide high-quality directional light shadows across large scenes. This technique splits the view frustum into multiple cascades, each with its own shadow map at an appropriate resolution, dramatically improving shadow quality at different distances from the camera.

**Note**: Currently only one [`DirectionalLight2`](https://threepipe.org/docs/classes/DirectionalLight2.html) is supported per plugin instance.

## Features

- **Multiple cascade splitting modes**: uniform, logarithmic, practical, or custom
- **Automatic light attachment**: Automatically attaches to the first directional light found in the scene
- **Configurable shadow parameters**: Per-light configuration of cascades, shadow map size, bias, etc.
- **Material extension**: Seamless integration with existing materials through shader injection
- **Optional fade transitions**: Smooth blending between cascades for artifact-free transitions
- **Performance optimized**: Efficient frustum culling and shadow map updates
- **Serialization support**: Plugin settings are saved with the plugin, light-specific parameters are stored in light's userData (glTF extras)

## Basic Usage

```typescript
import {ThreeViewer, CascadedShadowsPlugin, DirectionalLight2} from 'threepipe'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    plugins: [new CascadedShadowsPlugin()]
})

// Create a directional light
const light = new DirectionalLight2(0xffffff, 1.5)
light.position.set(-200, -200, -200)
light.lookAt(0, 0, 0)
light.castShadow = true
viewer.scene.addObject(light)

// Configure CSM parameters
const csmPlugin = viewer.getPlugin(CascadedShadowsPlugin)!
csmPlugin.setLightParams({
    cascades: 4,
    shadowMapSize: 1024,
    lightMargin: 100
}, light)
```

## Configuration Options

### Plugin Properties

These properties are serialized with the plugin configuration:

- **[`enabled`](https://threepipe.org/docs/classes/CascadedShadowsPlugin.html#enabled)**: Enable/disable the plugin
- **[`maxFar`](https://threepipe.org/docs/classes/CascadedShadowsPlugin.html#maxFar)**: Maximum far distance for shadow calculation (default: 100000)
- **[`mode`](https://threepipe.org/docs/classes/CascadedShadowsPlugin.html#mode)**: Cascade splitting mode - `'uniform'`, `'logarithmic'`, `'practical'`, or `'custom'`
- **[`attachToFirstLight`](https://threepipe.org/docs/classes/CascadedShadowsPlugin.html#attachToFirstLight)**: Automatically attach to first directional light found (default: true)
- **[`fade`](https://threepipe.org/docs/classes/CascadedShadowsPlugin.html#fade)**: Enable smooth transitions between cascades (default: false)
- **[`customSplitsCallback`](https://threepipe.org/docs/classes/CascadedShadowsPlugin.html#customSplitsCallback)**: Custom function for cascade splitting when mode is 'custom'

### Light Parameters (CSMLightData)

Configure individual lights using [`setLightParams()`](https://threepipe.org/docs/classes/CascadedShadowsPlugin.html#setLightParams). These parameters are saved in the light's `userData` (glTF extras):

- **cascades**: Number of shadow cascades (default: 3)
- **shadowMapSize**: Shadow map resolution for each cascade (default: 2048)
- **shadowBias**: Shadow bias to prevent shadow acne
- **lightNear**: Near plane distance for shadow camera
- **lightFar**: Far plane distance for shadow camera
- **lightMargin**: Margin around frustum bounds (default: 200)

## Serialization

The plugin follows ThreePipe's serialization conventions:

- **Plugin settings** (enabled, maxFar, mode, etc.) are serialized with the plugin configuration
- **Light-specific parameters** are stored in the light's `userData` under the plugin type key
- **glTF compatibility**: Light parameters are saved as glTF extras and automatically loaded when importing models

```typescript
// Plugin settings are automatically serialized
const config = viewer.exportConfig()

// Light parameters are saved in userData and glTF extras
const lightConfig = light.userData[CascadedShadowsPlugin.PluginType] // CSMLightData
```

## Cascade Splitting Modes

### Uniform
Splits the frustum into equal depth slices. Simple but may not be optimal for most scenes.

```typescript
csmPlugin.mode = 'uniform'
```

### Logarithmic
Uses logarithmic distribution, providing more detail near the camera. Good for outdoor scenes.

```typescript
csmPlugin.mode = 'logarithmic'
```

### Practical (Default)
Combines uniform and logarithmic splitting for balanced quality. Best general-purpose option.

```typescript
csmPlugin.mode = 'practical'
```

### Custom
Allows defining custom cascade splits using a callback function.

```typescript
csmPlugin.customSplitsCallback = (cascades, near, far, breaks) => {
    // Custom logic to populate breaks array
    for (let i = 1; i < cascades; i++) {
        breaks.push(i / cascades)
    }
    breaks.push(1)
}
csmPlugin.mode = 'custom'
```

## Advanced Configuration

### Multiple Lights
While the plugin currently supports rendering one main light, you can configure different parameters for multiple lights:

```typescript
// Configure different cascade counts for different lights
csmPlugin.setLightParams({ cascades: 3, shadowMapSize: 1024 }, mainLight)
csmPlugin.setLightParams({ cascades: 2, shadowMapSize: 512 }, secondaryLight)
```

### Performance Optimization

For better performance on lower-end devices:

```typescript
csmPlugin.setLightParams({
    cascades: 2,           // Fewer cascades
    shadowMapSize: 512,    // Lower resolution
    lightMargin: 50        // Smaller margin
}) // no need to pass the light if main light is already set
```

For highest quality on high-end devices:

```typescript
csmPlugin.setLightParams({
    cascades: 6,           // More cascades
    shadowMapSize: 2048,   // Higher resolution
    lightMargin: 200       // Larger margin
})
csmPlugin.fade = true      // Enable smooth transitions
```

## Integration with Other Effects

CSM works well with other rendering plugins:

```typescript
const viewer = new ThreeViewer({
    plugins: [
        new CascadedShadowsPlugin(),
        SSAAPlugin,              // Anti-aliasing
        SSAOPlugin,              // Ambient occlusion
        BloomPlugin,             // HDR bloom
        TemporalAAPlugin         // Temporal anti-aliasing
    ]
})
```

## Debugging and Visualization

You can visualize the cascade splits using the `CSMHelper` from three.js:

```typescript
import {CSMHelper} from 'three/examples/jsm/csm/CSMHelper.js'

const csmHelper = new CSMHelper(csmPlugin as any)
csmHelper.visible = true
viewer.scene.modelRoot.add(csmHelper)

viewer.addEventListener('preRender', () => {
    if (csmHelper.visible) csmHelper.update()
})
```

## Technical Details

The plugin works by:
1. Splitting the camera frustum into multiple cascades based on the selected mode
2. Creating individual DirectionalLight instances for each cascade
3. Positioning and orienting each light to cover its respective frustum slice
4. Injecting custom shader code to sample the appropriate shadow map based on fragment depth
5. Optionally blending between cascades for smooth transitions

The implementation is based on the original [three-csm](https://github.com/StrandedKitty/three-csm) library and adapted for the ThreePipe architecture.

## Browser Compatibility

Works in all modern browsers that support WebGL. Performance depends on:
- GPU capability
- Available texture units
- WebGL2 features for optimal performance

## See Also

- [DirectionalLight2](https://threepipe.org/docs/classes/DirectionalLight2.html) - Enhanced directional light implementation
- [SSAOPlugin](./SSAOPlugin) - Screen space ambient occlusion
- [DepthBufferPlugin](./DepthBufferPlugin) - Depth buffer rendering
- [Material Extension Framework](../guide/features.html#material-extension) - Custom shader injection system

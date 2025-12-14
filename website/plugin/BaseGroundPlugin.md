---
aside: false
---

# BaseGroundPlugin

[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/base/BaseGroundPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/BaseGroundPlugin.html)

Base Ground Plugin adds a simple horizontal ground plane to the scene that automatically positions itself below the model. It provides a foundation for displaying 3D objects with proper grounding and can be extended by plugins like AdvancedGroundPlugin for more advanced features.

The plugin creates a plane mesh with a configurable PhysicalMaterial, automatically adjusts its position and scale based on the scene bounds, and provides options for camera limits, depth rendering, and tonemapping.

## Features

- **Auto-Positioning**: Automatically positions ground below scene bounding box
- **Configurable Size**: Adjustable ground plane dimensions
- **Height Offset**: Fine-tune vertical position
- **Material Access**: Full control over PhysicalMaterial properties
- **Camera Limits**: Optional constraint to keep camera above ground
- **Depth Rendering**: Control whether ground appears in depth buffer
- **Tonemap Control**: Toggle tonemapping for the ground material
- **Extensible**: Base class for advanced ground plugins
- **Serializable**: Full state serialization support

## Installation

BaseGroundPlugin is part of the core threepipe package:

```bash
npm install threepipe
```

## Basic Setup

```typescript
import {ThreeViewer, BaseGroundPlugin} from 'threepipe'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: true
})

// Add ground plugin
const ground = viewer.addPluginSync(new BaseGroundPlugin())

// Load model - ground will auto-position below it
await viewer.load('model.glb')
```

The ground plane will automatically position itself below the model's bounding box.

## Configuration

### Visibility and Size

Control basic ground appearance:

```typescript
const ground = viewer.getPlugin(BaseGroundPlugin)

// Visibility
ground.visible = true  // Show ground (default)
ground.visible = false // Hide ground
ground.enabled = true  // Same as visible

// Size (in scene units)
ground.size = 8   // Default, 8x8 units
ground.size = 15  // Larger ground
ground.size = 3   // Smaller ground
ground.size = 0   // Hide ground (alternative to visible = false)
```

The ground plane scales uniformly in X and Z directions.

### Position

Adjust the vertical position of the ground:

```typescript
// Height offset (Y position relative to model bottom)
ground.yOffset = 0     // Default, at model's base
ground.yOffset = -0.5  // Lower ground (0.5 units below)
ground.yOffset = 0.1   // Raised ground (0.1 units above)
```

The `yOffset` is relative to the bottom of the scene's bounding box.

### Auto-Adjustment

Control automatic positioning:

```typescript
// Auto-adjust ground to fit under scene
ground.autoAdjustTransform = true  // Default, automatic
ground.autoAdjustTransform = false // Manual control

// When true, ground automatically:
// - Centers below the scene's bounding box
// - Updates when objects are added/removed
// - Respects the yOffset setting
```

### Material Configuration

Access and modify the ground material:

```typescript
const material = ground.material

// Material is a PhysicalMaterial
material.color.set('#ffffff')  // White ground
material.color.set('#8b8b8b')  // Gray ground
material.roughness = 0.8       // Default
material.metalness = 0.5       // Default
material.opacity = 1.0

// Add textures
material.map = await viewer.load('ground_texture.jpg')
material.normalMap = await viewer.load('ground_normal.jpg')
material.roughnessMap = await viewer.load('ground_roughness.jpg')

// Must call setDirty after changes
material.setDirty()
```

The ground uses a standard PhysicalMaterial with all PBR properties available.

### Camera Limits

Prevent camera from going below ground:

```typescript
// Limit camera to stay above ground
ground.limitCameraAboveGround = true  // Enable limit
ground.limitCameraAboveGround = false // No limit (default)

// Only works with OrbitControls3 or three.js OrbitControls
// Camera's maxPolarAngle is set to π/2 (90°) when enabled
```

This is useful for architectural visualizations or when you want to prevent the camera from viewing the scene from below.

### Rendering Options

Control how the ground appears in rendering buffers:

```typescript
// Render to depth buffer
ground.renderToDepth = true  // Default, included in depth
ground.renderToDepth = false // Excluded from depth buffer

// Apply tonemapping
ground.tonemapGround = true  // Default, tonemap with scene
ground.tonemapGround = false // No tonemapping (keeps HDR values)

// Note: Both options require GBufferPlugin to be active
```

These options are useful when combining with post-processing effects that rely on depth or require special handling of ground colors.

## Advanced Usage

### Custom Material

Replace the default material with your own:

```typescript
import {PhysicalMaterial} from 'threepipe'

const ground = viewer.getPlugin(BaseGroundPlugin)

// Create custom material
const customMaterial = new PhysicalMaterial({
    name: 'CustomGroundMaterial',
    color: 0x3a5f0b,  // Green
    roughness: 0.9,
    metalness: 0.0
})

// Assign to ground (via mesh.material binding)
ground.mesh.material = customMaterial

// Or access the protected _material directly
// Note: This is not recommended for general use
```

### Custom Geometry

Replace the plane with custom geometry:

```typescript
import {CircleGeometry} from 'three'

const ground = viewer.getPlugin(BaseGroundPlugin)

// Create circular ground
const circleGeometry = new CircleGeometry(5, 64)
ground.setGeometry(circleGeometry)

// Ground will use the new geometry
// UV coordinates (uv2) are automatically created
```

### Manual Positioning

Take full control of ground position:

```typescript
const ground = viewer.getPlugin(BaseGroundPlugin)

// Disable auto-adjustment
ground.autoAdjustTransform = false

// Access mesh directly
const mesh = ground.mesh

// Set custom position
mesh.position.set(0, -1, 0)

// Set custom rotation (ground is rotated -90° around X by default)
mesh.rotation.set(-Math.PI / 2, 0, Math.PI / 4) // 45° Z rotation

// Set custom scale
mesh.scale.set(10, 10, 1)

// Update matrices
mesh.updateMatrixWorld()
```

### Extend for Custom Ground

Create a custom ground plugin by extending BaseGroundPlugin:

```typescript
import {BaseGroundPlugin, PhysicalMaterial, ThreeViewer} from 'threepipe'

class MyCustomGroundPlugin extends BaseGroundPlugin {
    static readonly PluginType = 'MyCustomGroundPlugin'

    // Override material creation
    protected _createMaterial(material?: PhysicalMaterial): PhysicalMaterial {
        if (!material) {
            material = new PhysicalMaterial({
                name: 'MyCustomGroundMaterial',
                color: 0xff0000,  // Red ground
                roughness: 0.5,
                metalness: 0.8
            })
        }
        return super._createMaterial(material)
    }

    // Override positioning logic
    protected _refreshTransform() {
        const updated = super._refreshTransform()
        
        // Add custom transform logic here
        if (updated && this._mesh) {
            // Custom modifications to position/rotation/scale
        }
        
        return updated
    }

    // Add custom functionality
    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        // Custom initialization
    }
}

// Use your custom plugin
const ground = viewer.addPluginSync(new MyCustomGroundPlugin())
```

### Scene Bounds Control

Control which objects affect ground positioning:

```typescript
const ground = viewer.getPlugin(BaseGroundPlugin)

// Use only model bounds (default)
ground.useModelBounds = true  // Only scene.modelRoot children

// Use full scene bounds
ground.useModelBounds = false // All objects in scene

// Manually refresh ground position
ground.refreshTransform()
```

### Physics Integration

The ground is automatically configured for physics:

```typescript
const ground = viewer.getPlugin(BaseGroundPlugin)
const mesh = ground.mesh

// Physics properties (already set by plugin)
console.log(mesh.userData.physicsMass)      // 0 (static)
console.log(mesh.userData.physicsBodyType)  // 'static'
console.log(mesh.userData.userSelectable)   // false
console.log(mesh.userData.isGroundMesh)     // true

// These properties are used by physics plugins
```

### Shadow Configuration

Configure shadow casting and receiving:

```typescript
const ground = viewer.getPlugin(BaseGroundPlugin)
const mesh = ground.mesh

// Shadows (enabled by default)
mesh.castShadow = true     // Ground casts shadows
mesh.receiveShadow = true  // Ground receives shadows

// Disable shadows
mesh.castShadow = false
mesh.receiveShadow = false
```

## UI Integration

Use with TweakpaneUiPlugin for runtime controls:

```typescript
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
const ground = viewer.getPlugin(BaseGroundPlugin)

// Add ground controls to UI
ui.setupPluginUi(BaseGroundPlugin)

// Now you have interactive controls for:
// - Visible toggle
// - Size slider
// - Height (yOffset) slider
// - Render to Depth toggle
// - Tonemap Ground toggle
// - Limit Camera Above Ground toggle
// - Auto Adjust Transform toggle
// - Material properties folder
```

## Extended Plugins

BaseGroundPlugin serves as the foundation for more advanced ground plugins:

### AdvancedGroundPlugin

Extends BaseGroundPlugin with planar reflections and baked shadows:

```typescript
import {AdvancedGroundPlugin} from '@threepipe/webgi-plugins'

// AdvancedGroundPlugin extends BaseGroundPlugin
const ground = viewer.addPluginSync(new AdvancedGroundPlugin())

// Has all BaseGroundPlugin features plus:
ground.groundReflection = true   // Planar reflections
ground.bakedShadows = true       // Baked soft shadows
ground.physicalReflections = true
```

See [AdvancedGroundPlugin](./AdvancedGroundPlugin) for full documentation.

### ContactShadowGroundPlugin

Extends BaseGroundPlugin with contact shadow effects:

```typescript
import {ContactShadowGroundPlugin} from 'threepipe'

const ground = viewer.addPluginSync(new ContactShadowGroundPlugin())

// Has all BaseGroundPlugin features plus contact shadows
```

See [ContactShadowGroundPlugin](./ContactShadowGroundPlugin) for full documentation.

### HDRiGroundPlugin

Extends BaseGroundPlugin with ground-projected environment:

```typescript
import {HDRiGroundPlugin} from 'threepipe'

const ground = viewer.addPluginSync(new HDRiGroundPlugin())

// Has all BaseGroundPlugin features plus HDRI projection
```

See [HDRiGroundPlugin](./HDRiGroundPlugin) for full documentation.

## Technical Details

### How It Works

1. **Initialization**: Creates plane geometry and default PhysicalMaterial
2. **Scene Integration**: Adds mesh to scene root on plugin addition
3. **Auto-Positioning**: Listens to scene updates and adjusts transform
4. **Material Management**: Tracks and manages material depth/tonemap settings
5. **Camera Integration**: Optionally limits camera polar angle

### Geometry

- **Type**: PlaneGeometry (1x1, subdivisions: 1x1)
- **Orientation**: Rotated -90° around X axis (horizontal)
- **UVs**: Both uv and uv2 attributes available
- **Scale**: Controlled by `size` property

### Material

- **Type**: PhysicalMaterial
- **Default Color**: White (#ffffff)
- **Default Roughness**: 0.8
- **Default Metalness**: 0.5
- **Runtime Material**: Marked with `userData.runtimeMaterial = true`

### Performance

- **Minimal Impact**: Single plane mesh with standard material
- **Efficient Updates**: Only refreshes transform when needed
- **Lazy Evaluation**: Transform refresh deferred to postFrame

### Events

The plugin listens to:
- `scene.sceneUpdate` - Refresh ground when scene changes
- `scene.addSceneObject` - Refresh ground when objects added
- `viewer.preRender` - Pre-render setup
- `viewer.postFrame` - Post-frame transform updates

## Common Use Cases

BaseGroundPlugin is ideal for:

1. **Simple Model Display**: Quick ground plane for object presentation
2. **Base for Extensions**: Foundation for custom ground plugins
3. **Prototyping**: Fast setup without complex features
4. **Mobile Friendly**: Lightweight ground solution
5. **Physics Simulations**: Static ground for physics engines
6. **Architectural Viz**: Base ground for buildings and structures

## Troubleshooting

**Ground not visible:**
- Check `ground.visible` is true
- Verify `ground.size` is greater than 0
- Ensure scene has objects (ground auto-sizes to scene bounds)
- Check camera position can see ground plane

**Ground in wrong position:**
- Enable `autoAdjustTransform` for automatic positioning
- Check `yOffset` value
- Verify scene bounds are correct
- Try calling `ground.refreshTransform()` manually

**Ground not updating:**
- Ensure `autoAdjustTransform` is enabled
- Check that scene events are firing
- Verify objects are properly added to scene
- Call `ground.refresh()` manually if needed

**Camera goes below ground:**
- Enable `limitCameraAboveGround`
- Check that OrbitControls3 is being used
- Verify camera controls are active

**Material changes not applied:**
- Call `material.setDirty()` after changes
- Check material is properly assigned to mesh
- Verify changes to correct material instance

**Ground not receiving shadows:**
- Check `mesh.receiveShadow` is true
- Ensure lights have `castShadow` enabled
- Verify shadow maps are configured in viewer

## API Reference

See the [BaseGroundPlugin API documentation](https://threepipe.org/docs/classes/BaseGroundPlugin.html) for detailed information on all properties and methods.

## Related Plugins

- [AdvancedGroundPlugin](./AdvancedGroundPlugin) - Extended ground with reflections and baked shadows
- [ContactShadowGroundPlugin](./ContactShadowGroundPlugin) - Ground with contact shadow effects
- [HDRiGroundPlugin](./HDRiGroundPlugin) - Ground with environment projection
- [GBufferPlugin](./GBufferPlugin) - Required for depth and tonemap features


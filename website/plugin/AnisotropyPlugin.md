---
prev:
  text: 'SSGIPlugin'
  link: './SSGIPlugin'

next:
  text: 'AdvancedGroundPlugin'
  link: './AdvancedGroundPlugin'

aside: false
---

# AnisotropyPlugin

[Example](https://threepipe.org/examples/#anisotropy-plugin/) &mdash;
[API Reference](https://webgi.dev/docs/classes/AnisotropyPlugin.html)

<iframe src="https://threepipe.org/examples/anisotropy-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Anisotropy Plugin Example"></iframe>

Anisotropy Plugin adds a material extension to PhysicalMaterial to support anisotropic reflections. Anisotropy is a directional material property that causes the material to reflect light differently depending on the surface direction, creating realistic effects for brushed metal, fabric, hair, vinyl records, and other materials with directional micro-structures.

The AnisotropyPlugin implements a physically-based anisotropic BRDF based on the Filament rendering engine, extending Three.js's standard PBR materials with advanced directional reflection capabilities. Unlike Three.js's built-in anisotropy (KHR_materials_anisotropy), this implementation includes additional features like support for both rotation and directional maps (similar to Blender), procedural noise, and progressive rendering integration.

## Features

- **Physically-Based Anisotropic BRDF**: Advanced lighting model for directional reflections
- **Multiple Direction Modes**: Constant angle, rotation map, or direction map
- **Procedural Noise**: Add variation to anisotropic reflections
- **Automatic Tangent Generation**: Computes tangent vectors when missing
- **Material Extension UI**: Interactive controls in material inspector
- **glTF Extension Support**: Uses WEBGI_materials_anisotropy for import/export
- **Filament-Based Implementation**: Industry-standard anisotropic shading
- **Per-Material Control**: Enable/disable per material with custom parameters
- **Texture Mapping Support**: Rotation and direction texture maps
- **UV Transform Support**: Full texture transform capabilities
- **Compatible with PBR Workflow**: Works seamlessly with PhysicalMaterial
- **Progressive Rendering**: Integrates with frame accumulation
- **Dynamic Updates**: Runtime material property changes

## Installation

This plugin is part of the `@threepipe/webgi-plugins` package:

```bash
npm install @threepipe/webgi-plugins
```

## Basic Setup

```typescript
import {ThreeViewer, PhysicalMaterial} from 'threepipe'
import {AnisotropyPlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: true,
})

// Add anisotropy plugin
const anisotropy = viewer.addPluginSync(new AnisotropyPlugin())

// Load a model
const model = await viewer.load('model.glb')

// Enable anisotropy on a material
const material = viewer.scene.getObjectByName('BrushedMetal')?.material as PhysicalMaterial

// Enable with default settings
anisotropy.enableAnisotropy(material)

// Or enable with custom parameters
anisotropy.enableAnisotropy(
    material,
    null,        // texture map (optional)
    1.0,         // factor
    0.0,         // noise
    'CONSTANT'   // direction mode
)
```

With this setup, the material will display anisotropic reflections similar to brushed metal or fabric.

## Configuration

### Enable Anisotropy

Enable anisotropy on any PhysicalMaterial:

```typescript
// Basic enable (uses defaults)
anisotropy.enableAnisotropy(material)

// Enable with custom factor
anisotropy.enableAnisotropy(material, null, 1.5) // Stronger anisotropy

// Enable with texture map and direction mode
const directionMap = await viewer.load('anisotropy_direction.png')
anisotropy.enableAnisotropy(material, directionMap, 1.0, 0.0, 'DIRECTION')

// Returns false if geometry doesn't support anisotropy (missing UVs, etc.)
const success = anisotropy.enableAnisotropy(material)
if (!success) {
    console.warn('Material cannot be made anisotropic')
}
```

The `enableAnisotropy` method automatically computes tangent vectors if they're missing from the geometry.

### Anisotropy Factor

Control the strength of the anisotropic effect:

```typescript
// Access material's anisotropy settings
material.userData._anisotropyFactor = 1.0  // Default, moderate effect
material.userData._anisotropyFactor = 2.0  // Strong anisotropy
material.userData._anisotropyFactor = 0.5  // Subtle effect
material.userData._anisotropyFactor = -1.0 // Inverted direction
material.setDirty()

// Valid range: -2.0 to 2.0
// Positive values: anisotropy along tangent direction
// Negative values: anisotropy perpendicular to tangent direction
```

Higher absolute values create more pronounced directional reflections, while values near zero approach isotropic (non-directional) reflections.

### Anisotropy Noise

Add procedural variation to anisotropic reflections:

```typescript
material.userData._anisotropyNoise = 0.0  // No noise (default)
material.userData._anisotropyNoise = 0.5  // Subtle variation
material.userData._anisotropyNoise = 1.0  // Moderate noise
material.userData._anisotropyNoise = 2.0  // Heavy variation
material.setDirty()

// Valid range: 0.0 to 2.0
// Creates random variation per pixel
// Useful for natural materials like hair or fabric
```

Noise adds per-pixel randomness to the anisotropy direction, creating more organic and less uniform reflections.

### Direction Modes

Three modes control how anisotropy direction is determined:

#### 1. CONSTANT Mode

Uses a single direction value for the entire material:

```typescript
material.userData._anisotropyDirectionMode = 'CONSTANT'
material.userData._anisotropyDirection = 1.0 // Direction in radians
material.setDirty()

// Direction range: 0.0 to 2π (6.28)
// 0.0 = horizontal, π/2 = vertical, etc.
// Uniform direction across entire surface
```

#### 2. ROTATION Mode

Uses a texture where pixel values define rotation angles:

```typescript
const rotationMap = await viewer.load('rotation_map.png')

material.userData._anisotropyDirectionMode = 'ROTATION'
material.userData._anisotropyDirectionMap = rotationMap
material.setDirty()

// Texture values (0-1) map to rotation angles (0-2π)
// Grayscale texture: brightness = rotation angle
// Allows per-pixel rotation control
```

#### 3. DIRECTION Mode

Uses a texture where RGB values encode direction vectors:

```typescript
const directionMap = await viewer.load('direction_map.png')

material.userData._anisotropyDirectionMode = 'DIRECTION'
material.userData._anisotropyDirectionMap = directionMap
material.setDirty()

// RGB channels encode tangent-space direction
// Similar to tangent-space normal maps
// Provides full directional control per pixel
```

### Texture Mapping

Control texture sampling with standard UV transforms:

```typescript
const directionMap = material.userData._anisotropyDirectionMap

// Scale
directionMap.repeat.set(2, 2) // Repeat texture 2x

// Offset
directionMap.offset.set(0.5, 0.5) // Shift texture

// Rotation
directionMap.rotation = Math.PI / 4 // 45-degree rotation

// Updates are automatic
material.setDirty()
```

The anisotropy direction map supports all standard Three.js texture transforms.

### Per-Material UI Control

When PickingPlugin is active, material UI includes anisotropy controls:

```typescript
import {PickingPlugin} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

viewer.addPluginSync(PickingPlugin)
const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

// Setup UI for the plugin
ui.setupPluginUi(AnisotropyPlugin)

// Now selecting materials in the viewer shows anisotropy controls:
// - Enable/Disable checkbox
// - Factor slider (-2 to 2)
// - Noise slider (0 to 2)
// - Mode dropdown (CONSTANT/ROTATION/DIRECTION)
// - Direction slider (when applicable)
// - Texture picker (when applicable)
// - Sampler controls (wrap, filter, etc.)
```

### Runtime Updates

Change anisotropy properties at runtime:

```typescript
// Enable/disable
material.userData._isAnisotropic = false // Disable
material.setDirty()

// Animate factor
function animate() {
    const time = performance.now() * 0.001
    material.userData._anisotropyFactor = Math.sin(time) * 2
    material.setDirty()
    requestAnimationFrame(animate)
}
animate()

// Switch modes dynamically
material.userData._anisotropyDirectionMode = 'ROTATION'
material.userData._anisotropyDirectionMap = rotationMap
material.setDirty()

// Remove anisotropy
material.userData._isAnisotropic = false
material.setDirty()
```

## Advanced Usage

### Programmatic Material Setup

Complete setup via code:

```typescript
import {PhysicalMaterial, Texture} from 'threepipe'

// Create material
const material = new PhysicalMaterial()
material.roughness = 0.2
material.metalness = 1.0

// Enable anisotropy with all parameters
const directionMap = await viewer.load<Texture>('anisotropy_dir.png')

anisotropy.enableAnisotropy(material, directionMap, 1.5, 0.3, 'DIRECTION')

// Fine-tune settings
material.userData._anisotropyFactor = 1.8
material.userData._anisotropyNoise = 0.5
material.setDirty()

// Apply to object
object.material = material
```

### Brushed Metal Effect

Create realistic brushed metal surfaces:

```typescript
const metal = new PhysicalMaterial()
metal.color.set('#cccccc')
metal.metalness = 1.0
metal.roughness = 0.3

// Linear brush strokes
anisotropy.enableAnisotropy(metal, null, 1.2, 0.1, 'CONSTANT')
metal.userData._anisotropyDirection = 0 // Horizontal brushing

// Apply to cylindrical object for radial brushing
// (use rotation map for circular patterns)
```

### Fabric Material

Simulate woven fabric with anisotropic reflections:

```typescript
const fabric = new PhysicalMaterial()
fabric.color.set('#8b4513')
fabric.metalness = 0.0
fabric.roughness = 0.8

// Subtle anisotropy with noise for fabric texture
anisotropy.enableAnisotropy(fabric, null, 0.6, 0.8, 'CONSTANT')
fabric.userData._anisotropyDirection = Math.PI / 4 // 45-degree weave
```

### Hair or Fur

Create hair-like anisotropic reflections:

```typescript
const hair = new PhysicalMaterial()
hair.color.set('#331100')
hair.metalness = 0.0
hair.roughness = 0.5

// Strong directional reflection with noise
anisotropy.enableAnisotropy(hair, null, 1.5, 1.2, 'CONSTANT')
hair.userData._anisotropyDirection = Math.PI / 2 // Vertical hair strands

// For more complex hair, use direction map
```

### Vinyl Record

Simulate circular grooves of a vinyl record:

```typescript
const vinyl = new PhysicalMaterial()
vinyl.color.set('#1a1a1a')
vinyl.metalness = 0.1
vinyl.roughness = 0.4

// Load radial rotation map
const radialMap = await viewer.load('radial_rotation.png')
anisotropy.enableAnisotropy(vinyl, radialMap, 1.0, 0.0, 'ROTATION')

// Rotation map should have radial gradient (black at center to white at edge)
// Creates circular reflection pattern
```

### Dynamic Direction Animation

Animate anisotropy direction over time:

```typescript
let animating = true

function updateAnisotropy() {
    if (!animating) return
    
    const time = performance.now() * 0.001
    material.userData._anisotropyDirection = time % (Math.PI * 2)
    material.setDirty()
    
    requestAnimationFrame(updateAnisotropy)
}

updateAnisotropy()

// Stop animation
// animating = false
```

### Combining with Other Effects

Anisotropy works well with other material properties:

```typescript
import {BloomPlugin} from '@threepipe/webgi-plugins'

viewer.addPluginSync(new BloomPlugin())

const material = new PhysicalMaterial()
material.metalness = 1.0
material.roughness = 0.2
material.emissive.set('#440044')
material.emissiveIntensity = 2

// Anisotropic reflections with bloom
anisotropy.enableAnisotropy(material, null, 1.5, 0.0, 'CONSTANT')

// Creates dramatic directional highlights that bloom
```

## glTF Extension Support

The plugin implements the `WEBGI_materials_anisotropy` glTF extension for import/export:

### Exporting

```typescript
import {AssetExporterPlugin} from 'threepipe'

const exporter = viewer.getPlugin(AssetExporterPlugin)

// Anisotropy settings are automatically saved when exporting
const glb = await exporter.exportObject(scene, {
    exportExt: 'glb'
})

// Extension includes:
// - anisotropyFactor
// - anisotropyNoiseFactor
// - anisotropyDirectionMode
// - anisotropyDirection (map or value)
```

### Importing

```typescript
// Models with WEBGI_materials_anisotropy extension load automatically
const model = await viewer.load('model_with_anisotropy.glb')

// Tangents are computed automatically if missing
// Extension settings are applied to materials

// Access imported settings
model.traverse((object) => {
    const mat = object.material
    if (mat?.userData._isAnisotropic) {
        console.log('Anisotropy factor:', mat.userData._anisotropyFactor)
        console.log('Direction mode:', mat.userData._anisotropyDirectionMode)
    }
})
```

### Extension Specification

The glTF extension structure:

```json
{
  "materials": [
    {
      "name": "BrushedMetal",
      "pbrMetallicRoughness": {...},
      "extensions": {
        "WEBGI_materials_anisotropy": {
          "anisotropyFactor": 1.5,
          "anisotropyNoiseFactor": 0.2,
          "anisotropyDirectionMode": "ROTATION",
          "anisotropyDirection": {
            "index": 2,
            "texCoord": 0
          }
        }
      }
    }
  ]
}
```

Full specification: [WEBGI_materials_anisotropy](https://webgi.xyz/docs/gltf-extensions/WEBGI_materials_anisotropy.html)

## Technical Details

### Algorithm Overview

The anisotropy implementation follows these steps:

1. **Tangent Space Setup**: Compute or use existing tangent/bitangent vectors
2. **Direction Calculation**: Based on mode (constant, rotation map, or direction map)
3. **Anisotropic TBN**: Modify tangent/bitangent based on direction and noise
4. **BRDF Evaluation**: Use anisotropic GGX BRDF from Filament
5. **IBL Integration**: Apply bent normals for environment reflections
6. **Shader Integration**: Inject into Three.js's physical material shader

### Requirements

Materials must meet these requirements for anisotropy:

- **Material Type**: PhysicalMaterial (or derived classes)
- **Geometry Attributes**: Must have position, normal, and UV attributes
- **Tangents**: Automatically computed if missing (requires indexed geometry)

### Tangent Generation

The plugin automatically computes tangents when needed:

```typescript
// Happens automatically when enabling anisotropy
anisotropy.enableAnisotropy(material)

// Tangents computed if:
// - Geometry has position, normal, UV, and index
// - No existing tangent attribute

// Manual tangent computation (if needed)
geometry.computeTangents()
```

### Shader Modifications

The plugin modifies Three.js shaders to add anisotropic BRDF:

- Replaces `BRDF_GGX` with `BRDF_GGX_Anisotropy`
- Adds tangent/bitangent calculations
- Modifies IBL sampling with bent normals
- Injects uniforms and defines for anisotropy parameters

### Compatibility

- **Three.js Anisotropy**: This is a separate implementation from Three.js's built-in anisotropy (KHR_materials_anisotropy)
- **Blender**: Supports Blender-style rotation and direction maps
- **Physical Materials**: Only works with PhysicalMaterial, not Basic/Lambert/Phong materials
- **Other Plugins**: Compatible with most plugins (Bloom, SSR, SSGI, etc.)

## Performance Considerations

Anisotropy has minimal performance impact:

- **Shader Complexity**: Adds ~10-20% overhead to fragment shader
- **Memory**: One additional texture per material (if using maps)
- **Tangent Computation**: One-time cost when enabling (automatic)
- **Runtime Updates**: Changing parameters is very cheap

Tips for optimization:
- Use constant mode when possible (no texture sampling)
- Reuse direction maps across multiple materials
- Pre-compute tangents in modeling software
- Consider texture resolution (smaller maps = better performance)

## Common Use Cases

The AnisotropyPlugin is ideal for:

1. **Brushed Metal Surfaces**: Aluminum, steel, copper with directional finishing
2. **Fabric and Textiles**: Silk, satin, velvet with visible weave patterns
3. **Hair and Fur**: Realistic strand-like reflections
4. **Vinyl Records**: Circular groove patterns
5. **Wood Grain**: Directional reflections along grain
6. **Automotive Paint**: Metallic flakes with directional sparkle
7. **Polished Surfaces**: Any material with directional micro-structure

## Troubleshooting

**Anisotropy not visible:**
- Check that material has metalness > 0 or appropriate roughness
- Ensure lighting is present in the scene
- Verify anisotropy factor is not too low
- Check that geometry has UV coordinates
- Try increasing the factor or adjusting direction

**Black/missing rendering:**
- Error about missing tangents - geometry may lack required attributes
- Check console for tangent computation errors
- Ensure geometry has position, normal, UV, and index buffers
- Try manually computing tangents before loading

**Incorrect direction:**
- Verify direction mode matches your texture type
- Check UV coordinates are correct
- Ensure texture is loaded and assigned properly
- Try switching between ROTATION and DIRECTION modes
- Validate tangent space is correct (check in 3D software)

**Tangent computation fails:**
- Geometry must be indexed for tangent computation
- Ensure position, normal, and UV attributes exist
- Check for degenerate triangles (zero-area)
- Try computing tangents in modeling software (Blender, Maya, etc.)

**Performance issues:**
- Use constant mode instead of texture maps when possible
- Reduce direction map resolution
- Limit number of anisotropic materials in scene
- Check if multiple materials can share direction maps

**glTF export/import issues:**
- Ensure AnisotropyPlugin is added before loading
- Check that AssetExporterPlugin is available
- Verify extension is in extensionsUsed
- Direction maps must be embedded or properly referenced

## Examples

Check out these examples to see the plugin in action:

- [Anisotropy Plugin](https://threepipe.org/examples/#anisotropy-plugin/) - Interactive demo with various materials

## API Reference

See the [AnisotropyPlugin API documentation](https://webgi.dev/docs/classes/AnisotropyPlugin.html) for detailed information on all properties and methods.

## Related Plugins

- [ClearcoatTintPlugin](./ClearcoatTintPlugin) - Add tinted clearcoat layers
- [CustomBumpMapPlugin](./CustomBumpMapPlugin) - Custom bump/normal mapping
- [ParallaxMappingPlugin](./ParallaxMappingPlugin) - Height-based parallax effects
- [BloomPlugin](./BloomPlugin) - HDR bloom for bright anisotropic highlights
- [SSReflectionPlugin](./SSReflectionPlugin) - Screen-space reflections

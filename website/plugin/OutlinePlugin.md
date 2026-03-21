---
prev:
  text: 'AdvancedGroundPlugin'
  link: './AdvancedGroundPlugin'

next:
  text: 'WatchHandsPlugin'
  link: './WatchHandsPlugin'

aside: false
---

# OutlinePlugin

[Example](https://threepipe.org/examples/#outline-plugin/) &mdash;
[API Reference](https://webgi.dev/docs/classes/OutlinePlugin.html)

<iframe src="https://threepipe.org/examples/outline-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Outline Plugin Example"></iframe>

Outline Plugin adds visual selection feedback by rendering outlines and optional highlights around selected objects. It integrates seamlessly with PickingPlugin to automatically show outlines when users click on objects, making it perfect for interactive 3D applications, product configurators, and educational visualizations.

The plugin renders selected objects to a separate depth buffer and processes it to create smooth, customizable outlines with adjustable color, thickness, and transparency. Optional highlight effects can be enabled to fill the selected object with a semi-transparent overlay.

## Features

- **Automatic Selection Outlines**: Integrates with PickingPlugin for click-to-select feedback, including multi-selection
- **Customizable Appearance**: Adjust color, thickness, and intensity
- **Optional Highlight Fill**: Semi-transparent overlay on selected objects
- **Smooth Animations**: Fade in/out effects when selecting/deselecting
- **Mouse-Aware Transitions**: Outline fades when mouse leaves canvas
- **Material Selection Mode**: Highlight by material instead of object
- **Name-Based Grouping**: Highlight all materials with the same name
- **Debug Mode**: Visualize the outline buffer
- **Performance Optimized**: Efficient depth-based outline detection
- **Widget Integration**: Automatically manages PickingPlugin widgets

## Installation

This plugin is part of the `@threepipe/webgi-plugins` package:

```bash
npm install @threepipe/webgi-plugins
```

## Basic Setup

```typescript
import {ThreeViewer, PickingPlugin, GBufferPlugin} from 'threepipe'
import {OutlinePlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: true,
    plugins: [PickingPlugin, GBufferPlugin] // Required dependencies
})

// Add outline plugin
const outline = viewer.addPluginSync(new OutlinePlugin())

// Load model
await viewer.load('model.glb')

// Click on objects to see outlines!
```

With this setup, clicking on any object in the scene will display a colored outline around it.

## Configuration

### Basic Outline Settings

Control the appearance of the outline:

```typescript
const outline = viewer.getPlugin(OutlinePlugin)

// Outline color
outline.color.set('#e98a65')  // Default orange
outline.color.set('#00ff00')  // Green
outline.color.set('#ffffff')  // White

// Outline intensity (brightness)
outline.intensity = 2    // Default
outline.intensity = 4    // Brighter
outline.intensity = 1    // Subtle

// Outline thickness
outline.thickness = 2    // Default
outline.thickness = 5    // Thick outline
outline.thickness = 0.5  // Thin outline

// Enable/disable
outline.enabled = true   // Show outlines
outline.enabled = false  // Hide outlines
```

The outline color, intensity, and thickness can be adjusted in real-time to match your application's design.

### Highlight Fill

Add a semi-transparent fill to selected objects:

```typescript
// Enable highlight
outline.enableHighlight = true  // Show transparent fill
outline.enableHighlight = false // Only show outline (default)

// Highlight transparency (0 = opaque, 1 = invisible)
outline.highlightTransparency = 0.84 // Default, subtle
outline.highlightTransparency = 0.5  // More visible
outline.highlightTransparency = 0.95 // Nearly invisible
```

When enabled, the highlight creates a semi-transparent overlay that makes the selected object stand out even more.

### Animation Settings

Control the fade animations:

```typescript
// Enable dynamic animation on selection
outline.enableDynamicSelection = true  // Default, fade in/out
outline.enableDynamicSelection = false // Instant selection

// Enable mouse in/out animation
outline.mouseInOutAnimationEnabled = true  // Default
outline.mouseInOutAnimationEnabled = false // No fade when mouse leaves

// When enabled:
// - Outline fades in when object is selected (400ms)
// - Outline fades out when mouse leaves canvas (600ms)
```

Dynamic animations provide smooth visual feedback that feels responsive and polished.

### Material-Based Selection

Highlight by material instead of objects:

```typescript
// Highlight selected material
outline.highlightSelectedMaterials = true  // Select material
outline.highlightSelectedMaterials = false // Select object (default)

// When enabled, all objects using the selected material are outlined

// Highlight all materials with same name
outline.highlightMaterialSameNames = true  // Group by name
outline.highlightMaterialSameNames = false // Individual material (default)

// When both enabled, clicking an object outlines all objects
// that use materials with the same name
```

This is useful for configurators where you want to highlight all parts made of the same material (e.g., all metal parts, all fabric parts).

### Debug Mode

Visualize the outline buffer:

```typescript
// Show the raw outline depth buffer
outline.debugOutline = true  // Debug view
outline.debugOutline = false // Normal view (default)

// Useful for understanding how the outline is generated
```

## Usage Examples

### Product Configurator

Highlight parts when clicked for color/material changes:

```typescript
import {PickingPlugin} from 'threepipe'
import {OutlinePlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    plugins: [PickingPlugin, GBufferPlugin]
})

const outline = viewer.addPluginSync(new OutlinePlugin())

// Customize for product visualization
outline.color.set('#0088ff')        // Blue outline
outline.thickness = 3                // Prominent outline
outline.enableHighlight = true       // Show highlight
outline.highlightTransparency = 0.9  // Subtle fill

const picking = viewer.getPlugin(PickingPlugin)

// Listen for selection changes
picking.addEventListener('selectedObjectChanged', (e) => {
    const selected = picking.getSelectedObject()
    if (selected) {
        console.log('Selected:', selected.name)
        // Update your UI to show customization options
    }
})

await viewer.load('product.glb')
```

### Educational/Interactive Scene

Clear selection feedback for clickable objects:

```typescript
const outline = viewer.addPluginSync(new OutlinePlugin())

// Bright, obvious outline for educational content
outline.color.set('#ffff00')    // Yellow
outline.intensity = 3            // Bright
outline.thickness = 4            // Thick
outline.enableHighlight = false  // No fill, just outline

// Clear visual feedback when clicking to learn about parts
```

### Material Selection System

Select all objects with the same material:

```typescript
const outline = viewer.addPluginSync(new OutlinePlugin())

// Enable material-based selection
outline.highlightSelectedMaterials = true
outline.highlightMaterialSameNames = true

outline.color.set('#ff6600')
outline.thickness = 2

// Now clicking on one object highlights all objects
// with materials of the same name
// Perfect for "select all metal parts" functionality
```

### Custom Selection Colors

Change outline color based on what's selected:

```typescript
const outline = viewer.addPluginSync(new OutlinePlugin())
const picking = viewer.getPlugin(PickingPlugin)

picking.addEventListener('selectedObjectChanged', () => {
    const selected = picking.getSelectedObject()
    
    if (selected?.name.includes('Metal')) {
        outline.color.set('#c0c0c0') // Silver for metal
    } else if (selected?.name.includes('Plastic')) {
        outline.color.set('#00ff00') // Green for plastic
    } else if (selected?.name.includes('Glass')) {
        outline.color.set('#00ccff') // Cyan for glass
    } else {
        outline.color.set('#e98a65') // Default orange
    }
})
```

### Subtle Hover Effect

Minimal outline for subtle selection feedback:

```typescript
const outline = viewer.addPluginSync(new OutlinePlugin())

// Minimal, subtle outline
outline.color.set('#ffffff')
outline.intensity = 1.5
outline.thickness = 1
outline.highlightTransparency = 0.95 // Nearly invisible highlight
outline.enableHighlight = true
```

## Integration with PickingPlugin

The OutlinePlugin requires and automatically integrates with PickingPlugin:

```typescript
import {PickingPlugin} from 'threepipe'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    plugins: [PickingPlugin, GBufferPlugin]
})

const outline = viewer.addPluginSync(new OutlinePlugin())
const picking = viewer.getPlugin(PickingPlugin)

// Outline automatically responds to picking events
picking.addEventListener('selectedObjectChanged', (e) => {
    // Outline updates automatically
    const selected = picking.getSelectedObject()
    console.log('Outlined:', selected?.name)
})

// Programmatically select objects
picking.selectObject(someObject) // Outline appears

// Clear selection
picking.selectObject(null) // Outline disappears
```

The plugin automatically:
- Shows outlines when objects are selected
- Hides outlines when deselected
- Animates transitions (if enabled)
- Disables picking widgets while outline is active
- Handles line objects (which look bad with outlines)

## UI Integration

Use with TweakpaneUiPlugin for runtime control:

```typescript
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
const outline = viewer.getPlugin(OutlinePlugin)

// Add outline controls to UI
ui.setupPluginUi(OutlinePlugin)

// Now you have interactive controls for:
// - Enable/Disable
// - Color picker
// - Intensity slider
// - Thickness slider
// - Highlight toggle
// - Transparency slider
// - Material selection options
// - Debug mode toggle
```

## Technical Details

### How It Works

1. **Selection Detection**: Listens to PickingPlugin's `selectedObjectChanged` event. Supports both single and multi-selection (Shift+Click). When multiple objects are selected, all of them receive outlines.
2. **Depth Rendering**: Renders selected objects to a separate depth buffer
3. **Edge Detection**: Processes the depth buffer to find edges
4. **Outline Generation**: Applies thickness and color to detected edges
5. **Highlight Fill**: Optionally fills the selected area with transparent color
6. **Compositing**: Blends the outline over the final render

### Requirements

- **PickingPlugin**: Required for selection detection
- **GBufferPlugin**: Required for depth information
- Both plugins must be added before OutlinePlugin

### Performance

- **Minimal Impact**: Only renders selected objects to outline buffer
- **Efficient Edge Detection**: Depth-based algorithm is very fast
- **Single Extra Pass**: One additional render pass per frame when enabled
- **Typical Cost**: <1ms per frame for most scenes

### Buffer Configuration

```typescript
import {HalfFloatType, UnsignedByteType} from 'threepipe'

// Create with custom buffer type
const outline = new OutlinePlugin(
    true,              // enabled
    UnsignedByteType   // buffer type (default)
)

// Or use HalfFloatType for higher precision (usually not needed)
const outline = new OutlinePlugin(true, HalfFloatType)

viewer.addPluginSync(outline)
```

UnsignedByteType is sufficient for outlines and uses less memory.

## Common Use Cases

The OutlinePlugin is ideal for:

1. **Product Configurators**: Highlight parts for customization
2. **Interactive Exploded Views**: Show which part is selected
3. **Educational Applications**: Identify clickable objects clearly
4. **3D Model Viewers**: Provide selection feedback
5. **Assembly Instructions**: Highlight current step components
6. **Architectural Walkthroughs**: Select and inspect building elements
7. **CAD Model Review**: Identify selected components

## Troubleshooting

**Outline not visible:**
- Ensure PickingPlugin is added and working
- Check that GBufferPlugin is added
- Verify an object is selected: `picking.getSelectedObject()`
- Try increasing `intensity` and `thickness`
- Check that `enabled` is true

**Outline looks wrong on line objects:**
- Plugin automatically disables for line objects
- This is intentional (lines look bad with depth-based outlines)
- Consider using a different visualization for line objects

**Animation not working:**
- Check `enableDynamicSelection` is true
- Verify `highlightTransparency` is less than 1.0
- Ensure highlight is enabled: `enableHighlight = true`

**Picking widget disappears:**
- OutlinePlugin disables picking widgets when active
- This is intentional to avoid visual conflicts
- Widgets re-enable when outline is disabled

**Performance issues:**
- Outline plugin is very efficient
- If issues occur, check other plugins in the stack
- Verify the scene doesn't have excessive objects selected
- Try disabling debug mode if enabled

**Material selection not working:**
- Enable `highlightSelectedMaterials`
- Optionally enable `highlightMaterialSameNames`
- Ensure materials have proper names assigned
- Check that objects share materials as expected

## API Reference

See the [OutlinePlugin API documentation](https://threepipe.org/docs/classes/OutlinePlugin.html) for detailed information on all properties and methods.

## Related Plugins

- [PickingPlugin](https://threepipe.org/docs/classes/PickingPlugin.html) - Required for object selection
- [GBufferPlugin](https://threepipe.org/docs/classes/GBufferPlugin.html) - Required for depth information

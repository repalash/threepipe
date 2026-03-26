---
prev:
    text: 'MeshOptSimplifyModifierPlugin'
    link: './MeshOptSimplifyModifierPlugin'

next:
    text: 'SwitchNodeBasePlugin'
    link: './SwitchNodeBasePlugin'

aside: false
---

# MaterialConfiguratorBasePlugin

[Example](https://threepipe.org/examples/#material-configurator-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/configurator/MaterialConfiguratorBasePlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/MaterialConfiguratorBasePlugin.html)

<iframe src="https://threepipe.org/examples/material-configurator-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Material Configurator Plugin Example"></iframe>

Base plugin for creating material configurators. It manages **material variations** — groups of alternative materials that can be swapped onto scene objects by matching material names or UUIDs. Materials are applied by copying properties onto existing material instances (not replacing references), which enables smooth animated transitions between variations.

This is the base class included in the core `threepipe` package. For a ready-made UI with visual material swatches, use [MaterialConfiguratorPlugin](../package/plugin-configurator) from `@threepipe/plugin-configurator`.

## Basic Setup

```typescript
import {ThreeViewer, MaterialConfiguratorBasePlugin} from 'threepipe'

const viewer = new ThreeViewer({canvas: document.getElementById('canvas')})

const configurator = viewer.addPluginSync(new MaterialConfiguratorBasePlugin())

// Load a model
await viewer.load('watch.glb')
```

## Creating Variations

A variation group maps a material name/UUID pattern to a set of alternative materials:

```typescript
// Get a material from the scene
const strapMat = viewer.scene.getObjectByName('strap')?.material

// Create a variation group for this material (keyed by material name regex)
const variation = configurator.createVariation(strapMat)
// variation.uuid is now a regex like "^strap$" based on strapMat.name

// Add alternative materials to the same group using the variationKey to find it
configurator.addVariation(leatherMat, variation.uuid)
configurator.addVariation(rubberMat, variation.uuid)

// Or push directly to the variation's materials array
variation.materials.push(anotherMat.clone())
```

### MaterialVariations Interface

```typescript
interface MaterialVariations {
    uuid: string             // Name or UUID regex pattern to match scene materials
    title: string            // Display title in UI
    preview: keyof PhysicalMaterial | 'generate:sphere' | 'generate:cube' | 'generate:cylinder'
    materials: IMaterial[]   // Array of material options
    data?: {                 // Optional per-material metadata
        icon?: string,
        [key: string]: any
    }[]
    regex?: boolean          // Whether uuid is a regex pattern (default: true)
    selectedIndex?: number | string  // Currently selected material index or UUID
    timeline?: {             // Keyframes for timeline animation
        time: number,
        index: number | string,
        duration?: number,
    }[]
}
```

## Applying Variations

```typescript
// Find a variation group
const variation = configurator.findVariation('strap')

// Apply by index
configurator.applyVariation(variation, 0)

// Apply by material UUID
configurator.applyVariation(variation, 'leather-material-uuid')

// Apply and update the selectedIndex
configurator.applyVariation(variation, 1, true)

// Reapply all currently selected variations
configurator.reapplyAll()
```

## Animated Transitions

Material transitions can be animated using [PopmotionPlugin](./PopmotionPlugin) (must be added to the viewer):

```typescript
import {PopmotionPlugin} from 'threepipe'

viewer.addPluginSync(new PopmotionPlugin())

// Animated transition (default 500ms)
await configurator.applyVariationAnimate(variation, 1)

// Custom duration
await configurator.applyVariationAnimate(variation, 2, 1000)
```

During animated transitions, [FrameFadePlugin](./FrameFadePlugin) is temporarily disabled and re-enabled after completion.

## Material Previews

Generate preview thumbnails for materials:

```typescript
// Render material on a sphere (returns base64 data URL)
const preview = configurator.getPreview(material, 'generate:sphere')

// Other preview types
configurator.getPreview(material, 'generate:cube')
configurator.getPreview(material, 'generate:cylinder')
configurator.getPreview(material, 'color')       // SVG circle with material color
configurator.getPreview(material, 'map')          // Diffuse texture preview
configurator.getPreview(material, 'emissive')     // Emissive texture preview
```

::: tip
`getPreview` should ideally be called during the `preFrame` event for best performance.
:::

## Timeline Integration

Variations support keyframe-based animation on the viewer timeline:

```typescript
const variation = configurator.findVariation('strap')

// Define keyframes
variation.timeline = [
    {time: 0, index: 0, duration: 0.5},    // Material 0 at t=0, 500ms transition
    {time: 3, index: 1, duration: 0.5},    // Material 1 at t=3s
    {time: 6, index: 2, duration: 0.5},    // Material 2 at t=6s
]

// Set up timeline
viewer.timeline.endTime = 9
viewer.timeline.resetOnEnd = true
```

The plugin automatically reads keyframes in `_preFrame` and applies materials with interpolation when the timeline is running.

## Managing Variations

```typescript
// Find variation by name/UUID
const variation = configurator.findVariation('strap')

// Get variation for currently selected material (via PickingPlugin)
const selected = configurator.getSelectedVariation()

// Remove a specific material's variation
configurator.removeVariationForMaterial(material)

// Remove an entire variation group
configurator.removeVariation(variation)
```

## Serialization

The plugin serializes its `variations` array and `applyOnLoad` setting (both via `@serialize()`). When loading from JSON (e.g., from a glTF config), variations are automatically reapplied if `applyOnLoad` is `true`:

```typescript
configurator.applyOnLoad = true       // Apply variations when config is loaded (default)
configurator.applyOnLoadForce = false  // Force reapply even without explicit applyOnLoad in data
```

## Plugin Integration

- **[PickingPlugin](./PickingPlugin)** — Used to determine the currently selected material for the UI. Integrated reactively via `viewer.forPlugin()`, so PickingPlugin can be added before or after.
- **[PopmotionPlugin](./PopmotionPlugin)** — Required for `applyVariationAnimate()`. Throws if not found.
- **[FrameFadePlugin](./FrameFadePlugin)** — Temporarily disabled during animated transitions.

## UI Integration

The plugin exposes a `uiConfig` for use with [TweakpaneUiPlugin](../package/plugin-tweakpane) or other UI renderers:

```typescript
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
ui.setupPluginUi(MaterialConfiguratorBasePlugin)
```

The UI shows:
- Selected material info (when an object is picked)
- Variation editor with material options
- Buttons for adding/removing variations, refreshing UI, and applying all

## Extended Plugin

For a complete visual configurator with clickable material swatches overlaid on the viewer, use `MaterialConfiguratorPlugin` from [`@threepipe/plugin-configurator`](../package/plugin-configurator):

```typescript
import {MaterialConfiguratorPlugin} from '@threepipe/plugin-configurator'

const configurator = viewer.addPluginSync(new MaterialConfiguratorPlugin())
configurator.enableEditContextMenus = true  // Right-click editing
configurator.animateApply = true            // Animated transitions
configurator.animateApplyDuration = 500     // Transition duration (ms)
```

::: info
Both `MaterialConfiguratorBasePlugin` and `MaterialConfiguratorPlugin` share `PluginType = 'MaterialConfiguratorPlugin'`. Only one can be active in a viewer at a time.
:::

## How It Works

1. Variation groups define a regex pattern (`uuid`) that matches materials in the scene by name or UUID
2. `applyVariation()` delegates to `viewer.materialManager.applyMaterial()`, which finds all matching materials and copies properties via `copyMaterialProps()`
3. When a `time` parameter is provided, properties are interpolated using `lerpParams()` — supporting smooth transitions for numbers, Colors, Vectors, and even Textures (via render target blitting)
4. The UI refresh is deferred to `preFrame` to avoid redundant rebuilds

## Related Plugins

- [SwitchNodeBasePlugin](./SwitchNodeBasePlugin) — Sibling plugin for object/node visibility switching
- [GLTFKHRMaterialVariantsPlugin](./GLTFKHRMaterialVariantsPlugin) — Standard glTF material variants extension

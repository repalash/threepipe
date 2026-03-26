---
prev:
    text: 'MaterialConfiguratorBasePlugin'
    link: './MaterialConfiguratorBasePlugin'

next:
    text: 'RenderTargetPreviewPlugin'
    link: './RenderTargetPreviewPlugin'

aside: false
---

# SwitchNodeBasePlugin

[Example](https://threepipe.org/examples/#switch-node-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/configurator/SwitchNodeBasePlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/SwitchNodeBasePlugin.html)

<iframe src="https://threepipe.org/examples/switch-node-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Switch Node Plugin Example"></iframe>

Base plugin for creating object/node configurators. A **switch node** is a parent Object3D whose direct children represent swappable variants — only one child is visible at a time. This enables product configurators with interchangeable parts (e.g., watch straps, phone cases, shoe soles).

This is the base class included in the core `threepipe` package. For a ready-made UI with visual thumbnail grids, use [SwitchNodePlugin](../package/plugin-configurator) from `@threepipe/plugin-configurator`.

## Basic Setup

```typescript
import {ThreeViewer, SwitchNodeBasePlugin} from 'threepipe'

const viewer = new ThreeViewer({canvas: document.getElementById('canvas')})

const switcher = viewer.addPluginSync(new SwitchNodeBasePlugin())

// Load a model with switch node groups
await viewer.load('product_configurator.glb')
```

## Defining Switch Nodes

A switch node maps a parent object name to a set of child variants:

```typescript
// Add a switch node — 'strap_variants' is the name of a parent Object3D in the scene
// whose children are the individual strap options
switcher.addNode({
    name: 'strap_variants',      // Parent object name in scene
    title: 'Watch Strap',        // Display title in UI
    selected: '',                // Currently selected child (name or UUID)
    camView: 'front',            // Camera angle for preview thumbnails
    camDistance: 1,              // Camera distance multiplier for previews
})
```

### ObjectSwitchNode Interface

```typescript
interface ObjectSwitchNode {
    name: string        // Name of the parent Object3D in the scene
    title: string       // Display title for UI
    selected: string    // Name or UUID of the currently selected child
    camView: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | string
    camDistance: number  // Camera distance multiplier for preview snapshots
}
```

## Selecting Variants

```typescript
// Select by child name
switcher.selectNode(variation, 'leather_strap')

// Select by child UUID
switcher.selectNode(variation, 'some-uuid-string')

// Select by index (0-based)
switcher.selectNode(variation, 0)

// Select without marking scene dirty
switcher.selectNode(variation, 1, false)
```

When a child is selected:
1. All sibling children are hidden (`visible = false`)
2. The selected child is shown (`visible = true`)
3. The scene is marked dirty with `frameFade: true` for smooth transitions (if [FrameFadePlugin](./FrameFadePlugin) is active)

## Reapply All

Reapply all currently selected variations (useful after scene changes):

```typescript
switcher.reapplyAll()
```

This iterates all variations and calls `selectNode` for each, using the stored `selected` value or index 0 as fallback.

## Preview Thumbnails

Generate preview images of individual child variants:

```typescript
// Get a base64 PNG data URL of a child object
const preview = switcher.getPreview(variation, childObject)

// Auto-generate and cache icons for all children
switcher.snapIcons()

// Enable automatic icon generation on UI refresh
switcher.autoSnapIcons = true
```

The preview uses the variation's `camView` and `camDistance` to position the camera, rendering via `snapObject()`.

## Serialization

The plugin serializes its `variations` array and `refreshScene` setting (both via `@serialize()`). The `applyOnLoad` property controls deserialization behavior but is not itself serialized. The `fromJSON` method uses `this.applyOnLoad` to decide whether to call `reapplyAll()` after deserialization:

```typescript
// Controls whether fromJSON reapplies variations (default: true, not serialized)
switcher.applyOnLoad = true

// Whether to call refreshScene when a node is selected (default: true, serialized)
// Disable if geometry changes are insignificant (e.g., color-only swaps)
switcher.refreshScene = true
```

When loading from JSON (e.g., embedded in a glTF config), all stored selections are automatically reapplied if `applyOnLoad` is `true`.

## Plugin Integration

- **[PickingPlugin](./PickingPlugin)** — Used for selection awareness. When a user picks an object that belongs to a switch node group, the UI shows editing options for that group.
- **[FrameFadePlugin](./FrameFadePlugin)** — Provides smooth visual transitions when switching between variants.

## UI Integration

The plugin exposes a `uiConfig` for use with [TweakpaneUiPlugin](../package/plugin-tweakpane) or other UI renderers:

```typescript
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
ui.setupPluginUi(SwitchNodeBasePlugin)
```

The UI shows:
- List of all registered switch nodes with editable names
- "Add Node" button to create new switch node entries
- When a switch node child is selected via PickingPlugin: title editor, camera view dropdown, camera distance slider

## Extended Plugin

For a complete visual configurator with clickable thumbnail grids overlaid on the viewer, use `SwitchNodePlugin` from [`@threepipe/plugin-configurator`](../package/plugin-configurator):

```typescript
import {SwitchNodePlugin} from '@threepipe/plugin-configurator'

const switcher = viewer.addPluginSync(new SwitchNodePlugin())
switcher.enableEditContextMenus = true  // Right-click to rename/remove switch nodes
```

::: info
Both `SwitchNodeBasePlugin` and `SwitchNodePlugin` share `PluginType = 'SwitchNodePlugin'`. Only one can be active in a viewer at a time.
:::

## How It Works

1. Each `ObjectSwitchNode` entry stores a parent object `name` that is looked up in the scene
2. `selectNode()` finds the parent, iterates its direct children, and toggles visibility so only the selected child is shown
3. Scene is marked dirty with `refreshScene` and `frameFade` flags to notify other plugins (shadow baking, progressive rendering, etc.)
4. Preview generation computes a camera offset from the variation's `camView`/`camDistance` and delegates to `snapObject()`, which renders the child within the scene
5. UI refresh is deferred to `postFrame` to batch updates

## Related Plugins

- [MaterialConfiguratorBasePlugin](./MaterialConfiguratorBasePlugin) — Sibling plugin for material property swapping
- [GLTFKHRMaterialVariantsPlugin](./GLTFKHRMaterialVariantsPlugin) — Standard glTF material variants extension

---
prev:
    text: 'TransformControlsPlugin'
    link: './TransformControlsPlugin'

next:
    text: 'PivotEditPlugin'
    link: './PivotEditPlugin'

aside: false
---

# PivotControlsPlugin

[Example](https://threepipe.org/examples/#pivot-controls-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/PivotControlsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/PivotControlsPlugin.html)

<iframe src="https://threepipe.org/examples/pivot-controls-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Pivot Controls Plugin Example"></iframe>

Pivot Controls Plugin adds interactive transform gizmos that display all handles simultaneously: translation arrows, plane sliders, rotation arcs, and scaling spheres, without requiring mode switching.

The implementation is based on the [PivotControls](https://github.com/pmndrs/drei/blob/master/src/web/pivotControls/index.tsx) component from [drei](https://github.com/pmndrs/drei) and adapted for the vanilla three.js, and threepipe architecture.

When the plugin is added to the viewer, it interfaces with the [PickingPlugin](./PickingPlugin) and shows the control gizmos when an object is selected and hides them when the object is unselected.

If the `PickingPlugin` is not added to the viewer before the `PivotControlsPlugin`, it is added automatically with the plugin.

## Usage

```typescript
import {ThreeViewer, PivotControlsPlugin, PickingPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const pivotControlsPlugin = viewer.addPluginSync(new PivotControlsPlugin())

// Get the underlying pivot controls
const pivotControls = pivotControlsPlugin.pivotControls

// Select an object to show the gizmo
const picking = viewer.getPlugin(PickingPlugin)
picking.setSelectedObject(someObject)
```

## Features

- **Translation**: Axis arrows for single-axis movement, plane sliders for dual-axis movement
- **Rotation**: Quarter-arc torus handles for continuous rotation around each axis
- **Scaling**: Sphere handles for single-axis scaling, Alt/Option+drag for uniform scaling (all scale spheres enlarge as visual feedback)
- **Snapping**: Hold Shift while dragging for snap-to-grid on translation, rotation, and scaling (configurable snap values)
- **Space**: World or local coordinate space (Q key to toggle)
- **Annotations**: Value annotations shown during drag (enabled by default), displaying axis label and current value
- **Depth Test**: Toggle to control whether gizmos render through objects (off by default)
- **Fixed Size**: Gizmo maintains constant screen size regardless of camera distance (default), or scales with the scene in world units
- **Undo/Redo**: Integrates with [UndoManagerPlugin](https://threepipe.org/docs/classes/UndoManagerPlugin.html) for transform history

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **Q** | Toggle coordinate space (world/local) |
| **+/-** | Increase/decrease gizmo scale |
| **X** | Toggle X axis handles |
| **Y** | Toggle Y axis handles |
| **Z** | Toggle Z axis handles |
| **Space** | Toggle controls enabled/disabled |
| **Shift** (hold) | Snap to grid while dragging |
| **Alt/Option** (hold) | Uniform scale while dragging a scale sphere |

Transforms applied to duplicated objects are automatically tracked by [PickingPlugin](./PickingPlugin)'s smart duplicate system — the next Ctrl+D applies the same offset.

## Configuration

```typescript
const pc = pivotControlsPlugin.pivotControls

// Coordinate space
pc.space = 'local' // or 'world' (default)

// Gizmo size
pc.gizmoScale = 1.25  // size multiplier (default, matches TransformControls)
pc.fixed = true        // constant screen size (default)

// Visual options
pc.depthTest = false   // always visible through objects (default)
pc.annotations = true  // show values during drag (default)

// Snap values (applied when shift is held)
pc.translationSnap = 0.5  // units (default)
pc.rotationSnap = 15      // degrees (default)
pc.scaleSnap = 0.1        // factor (default)

// Uniform scale (alt+drag on scale spheres)
pc.uniformScaleEnabled = true // default: enabled

// Disable specific handle types
pc.disableAxes = true      // hide translation arrows
pc.disableSliders = true   // hide plane sliders
pc.disableRotations = true // hide rotation arcs
pc.disableScaling = true   // hide scale spheres

// Per-axis control
pc.activeAxes = [true, false, true] // disable Y axis handles

// Limits (per-axis [min, max] tuples, undefined to skip)
pc.translationLimits = [[-5, 5], [-5, 5], [-5, 5]]
pc.rotationLimits = [undefined, [-Math.PI, Math.PI], undefined]
pc.scaleLimits = [[0.1, 10], [0.1, 10], [0.1, 10]]
```

## Multi-Object Transform

When multiple objects are selected (Shift+Click), the gizmo appears at the median position of all selected objects. All transform operations apply to the group simultaneously, maintaining relative positions. The coordinate space is forced to world mode during multi-select. See [PickingPlugin](./PickingPlugin) for multi-selection controls.

## Comparison with TransformControlsPlugin

| Feature | PivotControlsPlugin | TransformControlsPlugin |
|---------|-------------------|----------------------|
| Handle visibility | All handles visible at once | One mode at a time (W/E/R to switch) |
| Translation | Arrows + plane sliders | Arrows + plane sliders |
| Rotation | Quarter-arc toruses | Full circle toruses |
| Scaling | Spheres at arrow tips | Box handles |
| Uniform scale | Alt+drag on any scale sphere | XYZ mode with octahedron |
| Snapping | Shift+drag (configurable values) | Shift+drag (fixed values) |
| Annotations | Value overlay during drag | None |
| Coordinate space | World / Local | World / Local |

## Pivot Point Editing

To interactively edit an object's pivot point (origin), use the [PivotEditPlugin](./PivotEditPlugin) alongside this plugin. It provides a separate translate-only gizmo for moving the pivot while keeping the object mesh in place.

---
prev:
  text: 'TransformControlsPlugin'
  link: './TransformControlsPlugin'

next:
  text: 'EditorViewWidgetPlugin'
  link: './EditorViewWidgetPlugin'

aside: false
---

# ObjectConstraintsPlugin

[Example](https://threepipe.org/examples/#object-constraints-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/ObjectConstraintsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ObjectConstraintsPlugin.html)

<iframe src="https://threepipe.org/examples/object-constraints-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Object Constraints Plugin Example"></iframe>

Create sophisticated object relationships and behaviors using simple constraint-based animation system inspired by Blender's constraints.

The ObjectConstraintsPlugin provides a powerful constraint system that allows objects to automatically follow, copy, or respond to other objects' transformations and properties. This enables complex animations and interactive behaviors without manual keyframe animation.

## Features

- **Multiple Constraint Types**: Support for position, rotation, scale, transform copying, path following, and look-at constraints
- **Influence Control**: Adjustable influence factor acts as damping for partial constraint effects and smooth blending
- **Real-time Updates**: Automatic constraint evaluation during scene updates
- **UI Integration**: Automatic UI generation for constraint properties and controls
- **Serialization**: Constraints are saved and loaded with scene data
- **Animation Integration**: Compatible with AnimationObjectPlugin for animating constraint properties
- **Target Management**: Automatic target object reference management and cleanup

## Constraint Types

### Copy Position (`copy_position`)
Makes an object copy the position of a target object.
- **axis**: Array of axes to copy (`['x', 'y', 'z']`)
- **invert**: Array of axes to invert (`[]`)

### Copy Rotation (`copy_rotation`) 
Makes an object copy the rotation of a target object.
- **axis**: Array of axes to copy (`['x', 'y', 'z']`)
- **invert**: Array of axes to invert (`[]`)
- **order**: Euler rotation order (`'XYZ'`, `'XZY'`, etc.)

### Copy Scale (`copy_scale`)
Makes an object copy the scale of a target object.
- **axis**: Array of axes to copy (`['x', 'y', 'z']`)
- **uniform**: Whether to apply uniform scaling (`false`)

### Copy Transforms (`copy_transforms`)
Makes an object copy all transformations (position, rotation, scale) from a target object.

### Follow Path (`follow_path`)
Makes an object follow along a path defined by a line geometry. See the [detailed Follow Path Constraint guide](../notes/follow-path-constraint.md) for comprehensive examples.
- **offset**: Position along the path (0-1 range)
- **followCurve**: Whether to orient along the path direction (`false`)

### Look At (`look_at`)
Makes an object always look toward a target object.
- **upAxis**: Which axis represents "up" (`'y'`, `'-y'`, `'x'`, `'-x'`, `'z'`, `'-z'`)

## Basic Setup

```typescript
import {ThreeViewer, ObjectConstraintsPlugin, Object3DGeneratorPlugin} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    plugins: [ObjectConstraintsPlugin, Object3DGeneratorPlugin]
})

// Add UI for constraint controls
const ui = viewer.addPluginSync(TweakpaneUiPlugin)

const constraintsPlugin = viewer.getPlugin(ObjectConstraintsPlugin)
```

## Creating Constraints

### Position Constraint

```typescript
// Load or create objects
const follower = await viewer.load<IObject3D>('follower.glb')
const target = await viewer.load<IObject3D>('target.glb')

// Add position constraint
const posConstraint = constraintsPlugin.addConstraint(follower, 'copy_position', target)
posConstraint.props.axis = ['x', 'z'] // Only copy X and Z position
posConstraint.influence = 0.5 // 50% influence for smooth following
```

### Look At Constraint

```typescript
// Make an object always look at another object
const lookConstraint = constraintsPlugin.addConstraint(follower, 'look_at', target)
lookConstraint.props.upAxis = 'y' // Keep Y axis as up
lookConstraint.influence = 0.6 // Moderate influence for natural head turning
```

### Follow Path Constraint

```typescript
import {CatmullRomCurve3, Vector3} from 'threepipe'

// Create a curved path
const points = [
    new Vector3(0, 0, 0),
    new Vector3(5, 2, 0),
    new Vector3(10, 0, 5),
    new Vector3(15, -2, 0)
]
const curve = new CatmullRomCurve3(points)

// Generate line object from curve
const generator = viewer.getPlugin(Object3DGeneratorPlugin)
const pathLine = generator.generate('geometry-line', { // Note that GeometryGeneratorPlugin must be included in the viewer for this
    curve: curve,
    segments: 100
})
viewer.scene.addObject(pathLine)

// Make object follow the path
const pathConstraint = constraintsPlugin.addConstraint(follower, 'follow_path', pathLine)
pathConstraint.props.offset = 0.0 // Start at beginning of path
pathConstraint.props.followCurve = true // Orient along path direction
pathConstraint.influence = 0.2 // Low influence for smooth, fluid movement
```

### Scale Constraint

```typescript
// Make object scale based on another object
const scaleConstraint = constraintsPlugin.addConstraint(follower, 'copy_scale', target)
scaleConstraint.props.axis = ['y'] // Only copy Y scale
scaleConstraint.props.uniform = true // Apply to all axes uniformly
scaleConstraint.influence = 0.7 // Strong but not rigid scaling
```

## Animating Constraints

Constraints work seamlessly with the PopmotionPlugin for creating animated behaviors:

```typescript
import {PopmotionPlugin} from 'threepipe'

const popPlugin = viewer.getPlugin(PopmotionPlugin)

// Animate path following
popPlugin.animate({
    target: pathConstraint.props,
    key: 'offset',
    from: 0,
    to: 1,
    duration: 5000,
    repeat: Infinity,
    repeatType: 'reverse',
    onUpdate: () => {
        pathConstraint.setDirty() // Trigger constraint update
    }
})
```

## Managing Constraints

### Remove Constraints

```typescript
// Remove a specific constraint
constraintsPlugin.removeConstraint(follower, posConstraint)
```

### Enable/Disable Constraints

```typescript
// Disable constraint temporarily
posConstraint.enabled = false

// Re-enable constraint
posConstraint.enabled = true
```

### Adjust Influence

```typescript
// Change constraint strength
posConstraint.influence = 0.3 // Weaker influence
lookConstraint.influence = 1.0 // Full influence
```

## UI Integration

The plugin automatically adds constraint controls to object UI panels:

```typescript
// Setup UI for constraint management
ui.appendChild(posConstraint.uiConfig, {expanded: true})
ui.appendChild(lookConstraint.uiConfig, {expanded: true})

// Or setup plugin-wide UI
ui.setupPluginUi(ObjectConstraintsPlugin)
```

Each object with constraints gets:
- **Add Constraint** button to create new constraints
- Individual constraint folders with type selection
- Property controls for each constraint type
- Influence sliders
- Enable/disable toggles
- Remove buttons for cleanup

## Advanced Usage

### Custom Constraint Properties

```typescript
const rotConstraint = constraintsPlugin.addConstraint(obj, 'copy_rotation', target)
rotConstraint.props.axis = ['y'] // Only copy Y rotation
rotConstraint.props.invert = ['y'] // Invert Y axis
rotConstraint.props.order = 'YXZ' // Custom rotation order
rotConstraint.influence = 0.4 // Damped rotation for smooth turning
```

### Multiple Constraints

Objects can have multiple constraints working together:

```typescript
// Combine position and look-at constraints
const posConstraint = constraintsPlugin.addConstraint(obj, 'copy_position', target1)
const lookConstraint = constraintsPlugin.addConstraint(obj, 'look_at', target2)

posConstraint.influence = 0.5
lookConstraint.influence = 0.5
```

### Influence

The **influence** parameter acts as a damping factor that controls how strongly a constraint affects an object:

- **1.0**: Full constraint effect (100% influence)
- **0.5**: Half constraint effect (50% influence) - creates smooth, damped motion
- **0.0**: No constraint effect (constraint disabled)

Lower influence values create smoother, more natural motion by reducing the constraint's strength, similar to adding damping to a physical system. This is particularly useful for creating fluid animations and preventing jerky movements.

### Performance Considerations

Constraints are evaluated every frame when active after the source or target have changed.
For optimal performance:

- Use appropriate influence values to reduce unnecessary updates
- Disable constraints when not needed
- Combine related constraints when possible
- Consider using `copy_transforms` instead of multiple individual constraints
- Call `setDirty` on the source, target or the constraint to update it manually

## Integration with Other Plugins

- **AnimationObjectPlugin**: Animate constraint properties like offset over time
- **PopmotionPlugin**: Create smooth animated constraint behaviors with easing
- **Object3DGeneratorPlugin**: Generate path objects for follow_path constraints
- **TransformControlsPlugin**: Interactively adjust target objects
- **TweakpaneUiPlugin**: Provides rich UI controls for constraint management

## Learn More

For detailed examples and advanced path constraint techniques, see:
- [Follow Path Constraint Animation Guide](../notes/follow-path-constraint.md) - Complete tutorial with spiral paths, curves, and animation
- [Object Constraints Example](https://threepipe.org/examples/#object-constraints-plugin/) - Interactive demo
- [Follow Path Example](https://threepipe.org/examples/#follow-path-constraint/) - Path following demo
- [Basic Constraints](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/helpers/BasicObjectConstraints.ts) - Implementation of basic constraints, these can be extended to add more types.

The ObjectConstraintsPlugin provides a powerful foundation for creating complex, interactive 3D behaviors with natural damping, making it easy to build sophisticated animations and object relationships in your three.js applications.

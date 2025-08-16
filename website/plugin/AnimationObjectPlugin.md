---
prev:
  text: 'ContactShadowGroundPlugin'
  link: './ContactShadowGroundPlugin'

next:
  text: 'GLTFAnimationPlugin'
  link: './GLTFAnimationPlugin'

aside: false
---

# AnimationObjectPlugin

[Example](https://threepipe.org/examples/#animation-object-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/animation/AnimationObjectPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/AnimationObjectPlugin.html)

<iframe src="https://threepipe.org/examples/animation-object-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Animation Object Plugin Example"></iframe>

Create and manage keyframe-based animations for any object, material, or viewer property with timeline controls.

The AnimationObjectPlugin provides a comprehensive system for creating custom property animations that can be bound to any object, material, or viewer property. It supports keyframe-based animations with customizable timing, easing, and playback controls.

## Features

- **Property Animation**: Animate any accessible property on objects, materials, or the viewer itself
- **Keyframe System**: Define multiple keyframes with custom timing offsets and values
- **Timeline Integration**: Seamlessly integrates with the viewer's global timeline
- **UI Integration**: Automatically generates UI controls for animation properties
- **Serialization**: Animations are automatically saved and loaded with scene data
- **Interactive Triggers**: Visual trigger buttons in the UI for easy keyframe management
- **Undo/Redo Support**: Full integration with the undo manager for animation changes

## Basic Setup

```typescript
import {ThreeViewer, AnimationObjectPlugin, PickingPLugin} from 'threepipe'
import {TweakpaneUiPlugin} from "@threepipe/plugin-tweakpane";
import {TimelineUiPlugin} from "@threepipe/plugin-timeline-ui";

const viewer = new ThreeViewer({canvas: document.getElementById('canvas'), plugins: [PickingPLugin]})

// Add the plugin
const animPlugin = viewer.addPluginSync(AnimationObjectPlugin)

// Set timeline duration for looping
viewer.timeline.endTime = 5 // 5 seconds
viewer.timeline.resetOnEnd = true  // Loop timeline

const uiPlugin = viewer.addPluginSync(TweakpaneUiPlugin)
uiPlugin.setupPluginUi(PickingPLugin)
uiPlugin.setupPluginUi(AnimationObjectPlugin)
        
// add the timeline ui to control animations
const timelineUiPlugin = viewer.addPluginSync(TimelineUiPlugin)
uiPlugin.setupPluginUi(TimelineUiPlugin)
// or show just the uiconfig triggers to create animations, and manage using custom UI.
timelineUiPlugin.showTriggers(true)
```

With this basic setup, you can start creating animations for any object or property in the viewer. 
The plugin automatically integrates with the viewer's timeline and provides UI controls for managing animations.
The timeline UI plugin allows you to visualize and control animations over time, making it easy to create complex animated sequences.

## UI Integration

The plugin automatically creates trigger buttons in the UI for each animatable property. These are automatically shown when timeline UI is active, but can also be shown manually:

```typescript
// Show/hide trigger buttons
animPlugin.showTriggers(true)
```

Users can click the trigger buttons (◆) next to properties in the UI to:
- Create new animations for that property
- Add keyframes at the current timeline position
- Update the current keyframe value

## Creating Animations

### Animate Object Properties

```typescript
// Load a model
const myModel = await viewer.load('model.glb')

// Create position animation
const positionAnim = animPlugin.addAnimation('position', myModel)
positionAnim.name = 'Object Position'
positionAnim.delay = 1000 // Start after 1 second
positionAnim.duration = 3000 // 3 second duration
positionAnim.values = [
    new Vector3(0, 0, 0),
    new Vector3(-1, 0, -1),
    new Vector3(-1, -1, 1),
    new Vector3(1, -1, -1),
    new Vector3(0, 0, 0)
]
positionAnim.offsets = [0, 0.25, 0.5, 0.75, 1] // Keyframe timing
positionAnim.updateTarget = true // Calls setDirty on update
```

The keyframe system works by defining **values** (the target states) and **offsets** (the timing of each keyframe):

- **Values Array**: Contains the actual values the property should have at each keyframe. These can be numbers, vectors, colors, or any animatable property type.
- **Offsets Array**: Defines when each keyframe occurs within the animation duration, using normalized values from 0 to 1:
  - `0` = start of animation
  - `0.25` = 25% through the animation (0.75 seconds into a 3-second animation)
  - `1` = end of animation
- **Interpolation**: The plugin automatically interpolates between keyframes using the specified easing function.

In this example, the object moves through 5 positions over 3 seconds, creating a complex path that returns to the starting position.

### Animate Viewer Properties

```typescript
// Animate background color
const bgAnim = animPlugin.addAnimation('scene.backgroundColor')
bgAnim.name = 'Background Color'
bgAnim.values = ['#ffffff', '#ff0000', '#0000ff']
bgAnim.offsets = [0, 0.5, 1]
bgAnim.duration = 2000
bgAnim.updateViewer = true // Calls viewer.setDirty on update
```

### Animate Material Properties

```typescript
// Animate material properties
const material = myModel.material
const roughnessAnim = animPlugin.addAnimation('roughness', material)
roughnessAnim.name = 'Material Roughness'
roughnessAnim.values = [0.0, 1.0, 0.5]
roughnessAnim.offsets = [0, 0.5, 1]
roughnessAnim.duration = 4000
```

## AnimationObject

The core of this plugin is the **AnimationObject** class, which represents a single keyframe-based animation for a specific property. Each AnimationObject defines:

- **Target Property**: Uses dot-notation access strings (e.g., `'position.x'`, `'material.roughness'`, `'scene.backgroundColor'`)
- **Keyframe Values**: An array of values that the property should animate through
- **Timing Offsets**: Normalized time values (0-1) that define when each keyframe occurs
- **Animation Settings**: Duration, delay, easing, and repeat behavior
- **Update Callbacks**: Automatic dirty marking for scene updates

AnimationObjects are **serializable** and automatically saved with scene data, making them persistent across sessions. They integrate seamlessly with the viewer's timeline system and provide UI controls for interactive editing.

The plugin manages two main animation containers:
- **Viewer Animations** (`plugin.animation`): Global animations for viewer and scene properties
- **Runtime Animations** (`plugin.runtimeAnimation`): Object and material-specific animations loaded from scene data

## Animation Control

### Manual Playback

```typescript
// Play a single animation outside the timeline
await positionAnim.animate().promise

// Play all animations with timeline
viewer.timeline.start()

// Pause timeline
viewer.timeline.stop()

// Seek to specific time
viewer.timeline.setTime(2.5) // 2.5 seconds
```

### Animation Properties

```typescript
const anim = animPlugin.addAnimation('rotation.y', object)

// Basic properties
anim.delay = 500        // Delay before starting (ms)
anim.duration = 2000    // Animation duration (ms)
anim.ease = 'easeInOut' // Easing function (string or a custom function)

// Keyframe values and timing
anim.values = [0, Math.PI, Math.PI * 2]
anim.offsets = [0, 0.3, 1] // Custom keyframe timing

// Update callbacks
anim.updateTarget = true  // Call setDirty on target
anim.updateViewer = true  // Call setDirty on viewer
```

**Easing Options**: The `ease` property can be either a string from the built-in easing functions or a custom function:

- **Built-in Easing Functions** (strings):
  - `'linear'` - No easing, constant speed
  - `'easeIn'`, `'easeOut'`, `'easeInOut'` - Standard cubic easing
  - `'easeInOutSine'` - Smooth sine-based easing (default)
  - `'circIn'`, `'circOut'`, `'circInOut'` - Circular easing curves
  - `'backIn'`, `'backOut'`, `'backInOut'` - Overshoot easing
  - `'bounceIn'`, `'bounceOut'`, `'bounceInOut'` - Bouncing effects
  - `'anticipate'` - Slight reverse before moving forward

- **Custom Easing Function**: You can also provide a custom easing function:
  ```typescript
  anim.ease = (x: number) => x * x // Custom quadratic easing
  ```

## Advanced Usage

### Custom Animation Objects

```typescript
import {AnimationObject} from 'threepipe'

// Create custom animation object
const customAnim = new AnimationObject()
customAnim.access = 'scene.background.rotation'
customAnim.values = [1, 2, 0.5]
customAnim.offsets = [0, 0.6, 1]
customAnim.duration = 3000

// Add to plugin
animPlugin.addAnimation(undefined, undefined, customAnim)
```

### Other Operations

```typescript
// Remove animation. Note that target has to be same as the one used to create the animation
animPlugin.removeAnimation(positionAnim, myModel)

// Get all animtion objects for external control
const animations = animPlugin.getAllAnimations()
animations.forEach((animObject) => {
    console.log(animObject)
})
```

## Notes

- **Dependencies**: Requires [PopmotionPlugin](./PopmotionPlugin) for animation engine
- **Timeline**: Works with the global viewer timeline system
- **Serialization**: Animations are automatically saved along with the plugin or material/object userData.
- **UI Plugins**: Compatible with TweakpaneUiPlugin and other UI systems
- **Undo/Redo**: Uses [UndoManagerPlugin](./UndoManagerPlugin) for undoable animation operations triggered from the UI.

## Examples

Check out the [animation-object-plugin example](https://threepipe.org/examples/#animation-object-plugin/) to see the plugin in action with various animation types and UI integration.

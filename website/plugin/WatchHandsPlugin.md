---
prev:
  text: 'OutlinePlugin'
  link: './OutlinePlugin'

next:
  text: 'SSGI Plugin (Screen Space Global Illumination)'
  link: './SSGIPlugin'

aside: false
---

# WatchHandsPlugin

[Source Code](https://github.com/repalash/threepipe/blob/master/src/webgi/extras/WatchHandsPlugin.ts) &mdash;
[API Reference](https://webgi.dev/docs/classes/WatchHandsPlugin.html)

Watch Hands Plugin automatically finds and animates watch hands (hour, minute, second) in your 3D model to display the current real-time. Perfect for watch visualizations, product configurators, and interactive timekeeping displays.

The plugin uses naming patterns to identify watch hand objects in your scene and continuously updates their rotation to match the current system time, with support for analog smooth motion, time offsets, and customizable rotation axes.

## Features

- **Automatic Hand Detection**: Finds watch hands by object name patterns
- **Real-Time Animation**: Updates to match current system time
- **Regex Pattern Matching**: Flexible object name matching
- **Analog Smooth Motion**: Smooth second hand movement (optional)
- **Time Offsets**: Adjust each hand independently
- **Axis Configuration**: Choose rotation axis (X, Y, or Z)
- **Axis Inversion**: Reverse rotation direction
- **Manual Refresh**: Re-scan scene for watch hands
- **Progressive Recording**: Compatible with progressive frame recording

## Installation

This plugin is part of the `@threepipe/webgi-plugins` package:

```bash
npm install @threepipe/webgi-plugins
```

## Basic Setup

### 1. Name Your Watch Hand Objects

In your 3D modeling software (Blender, Maya, etc.), name your watch hand objects with identifiable patterns:

```
hand_hour      // Hour hand
hand_minute    // Minute hand  
hand_second    // Second hand
```

Or use any pattern containing these keywords:
```
watch_hour_mesh
minute_hand
second_pointer
```

### 2. Add the Plugin

```typescript
import {ThreeViewer} from 'threepipe'
import {WatchHandsPlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: true
})

// Add watch hands plugin
const watchHands = viewer.addPluginSync(new WatchHandsPlugin())

// Load your watch model
await viewer.load('watch.glb')

// Hands will automatically animate to current time!
```

That's it! The plugin will automatically find and animate any objects matching the default naming patterns.

## Configuration

### Object Name Patterns

Customize the patterns used to find watch hand objects:

```typescript
const watchHands = viewer.getPlugin(WatchHandsPlugin)

// Default patterns (regex enabled)
watchHands.hour = '.*hour.*'     // Matches any name containing "hour"
watchHands.minute = '.*minute.*' // Matches any name containing "minute"
watchHands.second = '.*second.*' // Matches any name containing "second"

// Custom patterns
watchHands.hour = 'hour_hand'
watchHands.minute = 'minute_hand'
watchHands.second = 'second_hand'

// Exact match (disable regex)
watchHands.regex = false
watchHands.hour = 'HourHand'     // Exact name match only
watchHands.minute = 'MinuteHand'
watchHands.second = 'SecondHand'

// After changing patterns, refresh to re-scan
watchHands.refresh()
```

### Rotation Axis

Configure which axis the hands rotate around:

```typescript
// Rotation axis (depends on how your model is oriented)
watchHands.axis = 'y' // Default, hands rotate around Y axis
watchHands.axis = 'z' // Hands rotate around Z axis
watchHands.axis = 'x' // Hands rotate around X axis

// Invert rotation direction
watchHands.invertAxis = false // Default, clockwise
watchHands.invertAxis = true  // Counter-clockwise
```

**Tip**: Check your model's orientation. Most watch models use the Y axis, but this depends on how the model was created.

### Time Offsets

Adjust the time displayed on the watch:

```typescript
// Hour offset (0-12)
watchHands.hourOffset = 0   // Default, current hour
watchHands.hourOffset = 3   // Add 3 hours
watchHands.hourOffset = -2  // Subtract 2 hours

// Minute offset (0-60)
watchHands.minuteOffset = 0   // Default, current minute
watchHands.minuteOffset = 15  // Add 15 minutes
watchHands.minuteOffset = -30 // Subtract 30 minutes

// Second offset (0-60)
watchHands.secondOffset = 0   // Default, current second
watchHands.secondOffset = 10  // Add 10 seconds
watchHands.secondOffset = -5  // Subtract 5 seconds
```

### Analog Motion

Control second hand movement style:

```typescript
// Smooth analog motion
watchHands.analog = true  // Default, smooth continuous motion

// Digital stepping motion
watchHands.analog = false // Step once per second (like digital watches)
```

With `analog` enabled, the second hand moves smoothly using milliseconds for precise animation.

### Enable/Disable

Toggle the animation on/off:

```typescript
// Enable animation
watchHands.enabled = true  // Default, hands animate

// Disable animation (hands return to initial rotation)
watchHands.enabled = false // Hands stop, return to model's original pose
```

When disabled, hands return to their initial rotation from the model file.

## Usage Examples

### Basic Watch Visualization

```typescript
import {ThreeViewer} from 'threepipe'
import {WatchHandsPlugin} from '@threepipe/webgi-plugins'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas')
})

const watchHands = viewer.addPluginSync(new WatchHandsPlugin())

// Load watch model with objects named:
// - "hour_hand"
// - "minute_hand" 
// - "second_hand"
await viewer.load('watch.glb')

// That's it! Hands will animate automatically
```

### Custom Naming Convention

If your model uses different names:

```typescript
const watchHands = viewer.addPluginSync(new WatchHandsPlugin())

// Your model uses "Zeiger" (German for pointer/hand)
watchHands.hour = '.*Stunden.*'   // Matches "Stundenzeiger"
watchHands.minute = '.*Minuten.*' // Matches "Minutenzeiger"
watchHands.second = '.*Sekunden.*'// Matches "Sekundenzeiger"

await viewer.load('watch_german.glb')

// Manually refresh after loading
watchHands.refresh()
```

### Different Time Zone

Display a different time zone:

```typescript
const watchHands = viewer.addPluginSync(new WatchHandsPlugin())

// Show New York time (EST, UTC-5) from UTC
watchHands.hourOffset = -5

// Or for Tokyo time (JST, UTC+9)
watchHands.hourOffset = 9

await viewer.load('watch.glb')
```

### Z-Axis Rotation

If your watch model is oriented differently:

```typescript
const watchHands = viewer.addPluginSync(new WatchHandsPlugin())

// Model uses Z axis for rotation
watchHands.axis = 'z'

// If hands move backwards, invert
watchHands.invertAxis = true

await viewer.load('watch_z_axis.glb')
```

### Multiple Watches

The plugin works with multiple watches in the same scene:

```typescript
const watchHands = viewer.addPluginSync(new WatchHandsPlugin())

// All watches in the scene will animate
await viewer.load('watch_collection.glb')

// All objects matching the patterns will be found
// Even if there are multiple watches
```

### With UI Controls

Use TweakpaneUiPlugin for runtime configuration:

```typescript
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas')
})

const watchHands = viewer.addPluginSync(new WatchHandsPlugin())
const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

await viewer.load('watch.glb')

// Add watch hands controls to UI
ui.setupPluginUi(WatchHandsPlugin)

// Now you have interactive controls for:
// - Enable/Disable toggle
// - Axis selection (X/Y/Z)
// - Invert axis toggle
// - Analog motion toggle
// - Hour/Minute/Second offsets
// - Name patterns
// - Regex toggle
// - Refresh button
```

## Object Naming Guide

### Recommended Naming Patterns

For best results, include these keywords in your object names:

| Hand Type | Keywords | Examples |
|-----------|----------|----------|
| Hour | `hour`, `hr`, `h` | `hand_hour`, `hour_pointer`, `hr_hand` |
| Minute | `minute`, `min`, `m` | `hand_minute`, `minute_pointer`, `min_hand` |
| Second | `second`, `sec`, `s` | `hand_second`, `second_pointer`, `sec_hand` |

### Best Practices

1. **Use descriptive names**: `hour_hand` is better than `hand1`
2. **Be consistent**: Use the same naming pattern for all hands
3. **Avoid ambiguity**: Don't use "hand" alone - specify which hand
4. **Include keywords**: Make sure hour/minute/second appears in the name
5. **Consider regex**: Default patterns are flexible with `.*hour.*` matching

### Example Naming Schemes

**Simple:**
```
hour
minute
second
```

**Descriptive:**
```
watch_hour_hand
watch_minute_hand
watch_second_hand
```

**With prefixes:**
```
mesh_hour_pointer
mesh_minute_pointer
mesh_second_pointer
```

**Multiple watches:**
```
watch1_hour
watch1_minute
watch1_second
watch2_hour
watch2_minute
watch2_second
```

## Model Setup Requirements

### Rotation Pivot

- **Hour hand**: Pivot at center of watch face
- **Minute hand**: Pivot at center of watch face
- **Second hand**: Pivot at center of watch face

The pivot point (origin) of each hand object should be at the rotation center, not at the tip of the hand.

### Initial Rotation

Hands should be positioned at 12 o'clock (pointing up) in the model file. The plugin stores the initial rotation and uses it as the reference when disabled.

### Hierarchy

Watch hands can be anywhere in the scene hierarchy. The plugin traverses the entire scene to find matching objects. However, avoid nesting hands inside each other - each hand should be a separate object.

## Technical Details

### How It Works

1. **Scene Scanning**: When added or refreshed, the plugin traverses the scene looking for objects with names matching the patterns
2. **Hand Registration**: Matching objects are registered as hour, minute, or second hands
3. **Time Calculation**: Each frame, current system time is retrieved
4. **Rotation Update**: Hand rotations are calculated based on time and offsets
5. **Rendering**: Scene is marked dirty to trigger re-render

### Performance

- **Minimal Impact**: Only updates rotations when second hand changes
- **Smart Updates**: Skips updates during progressive frame recording convergence
- **Shadow Reset**: Automatically resets baked shadows when hands move
- **Efficient**: Typically <0.1ms per frame

### Progressive Recording

The plugin integrates with ProgressivePlugin:
- Waits for convergence during progressive recording
- Uses recording delta time for accurate frame capture
- Ensures watch time is consistent in recorded frames

## Troubleshooting

**Hands not animating:**
- Check object names match the patterns (`watchHands.hour`, etc.)
- Verify `enabled` is true
- Try calling `watchHands.refresh()` manually
- Check console for any errors
- Ensure hands are in the scene after loading

**Hands rotating on wrong axis:**
- Change `watchHands.axis` to 'x', 'y', or 'z'
- Check your model's orientation in 3D software
- Most watches use Y axis (up direction)

**Hands rotating backwards:**
- Set `watchHands.invertAxis = true`
- Or fix the pivot orientation in your 3D software

**Only some hands found:**
- Check object names for typos
- Verify all hands are in the scene hierarchy
- Review the name patterns with `console.log(watchHands.hour)`
- Try disabling regex: `watchHands.regex = false`

**Hands jump to wrong position:**
- Check initial rotation in model file
- Hands should be at 12 o'clock initially
- Verify pivot points are at watch center

**Regex pattern not working:**
- Test your pattern: `new RegExp(watchHands.hour).test('your_object_name')`
- Escape special regex characters: `\\.`, `\\[`, etc.
- Try simpler patterns first: `'hour'`

**Wrong time displayed:**
- Check system time is correct
- Adjust offsets to match your timezone
- Verify `analog` setting for smooth/step motion

## Related Plugins

- [ProgressivePlugin](https://threepipe.org/docs/classes/ProgressivePlugin.html) - Progressive frame recording
- [TransformAnimationPlugin](./TransformAnimationPlugin) - General object animation
- [PopmotionPlugin](./PopmotionPlugin) - Advanced animation control


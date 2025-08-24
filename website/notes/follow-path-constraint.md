---
prev:
  text: 'Saving three.js properties in glTF'
  link: './gltf-three-extras-ext'
  
next:
  text: 'Material Extension Plugin'
  link: './material-extension-plugin'

aside: false
---

# Follow Path Constraint Animation

<iframe src="https://threepipe.org/examples/follow-path-constraint/" style="width:100%;height:600px;border:none;" loading="lazy" title="Threepipe Follow Path Constraint Example"></iframe>

This example demonstrates how to use ThreePipe's Object Constraints system to make 3D objects follow a curved path. A 3D helmet model smoothly travels along a spiral path, automatically orienting itself to face the direction of travel.

**How it works:**
- A spiral path is created using `CatmullRomCurve3` with mathematically calculated points
- The path is visualized as a thick green line using `MeshLine` for better visibility
- An object constraint binds the helmet to follow the path with smooth animation
- The `PopmotionPlugin` animates the constraint's offset parameter to move the object along the path

**Key code:**

```typescript
// Create spiral path points
const spiralPoints = []
for (let i = 0; i <= totalPoints; i++) {
    const t = i / pointsPerLoop
    const angle = t * 2 * Math.PI
    const radius = 1 + (maxRadius - 1) * (i / totalPoints)
    const y = i / totalPoints * height - height / 2
    
    spiralPoints.push(new Vector3(
        Math.cos(angle) * radius,
        -y,
        Math.sin(angle) * radius
    ))
}

const curve = new CatmullRomCurve3(spiralPoints, false)

// Generate visual path line
const pathLine = generator.generate('geometry-line', {
    curve,
    segments: 200,
})

// Apply follow path constraint
const constraintsPlugin = viewer.getPlugin(ObjectConstraintsPlugin)
const objConstraint = constraintsPlugin.addConstraint(obj, 'follow_path', pathLine)
objConstraint.props.offset = 0.01 // position along curve (0-1)
objConstraint.props.followCurve = true // auto-orient to path direction
objConstraint.influence = 0.2 // damping for smooth motion
```

The animation is driven by smoothly changing the offset parameter:

```typescript
const pop = viewer.getPlugin(PopmotionPlugin)
pop.animate({
    target: objConstraint.props,
    key: 'offset',
    from: 0,
    to: 1,
    repeat: Infinity,
    duration: 5000,
    repeatType: 'reverse',
    onUpdate: () => objConstraint.setDirty(),
})
```

See the [full code here](https://github.com/repalash/threepipe/blob/master/examples/follow-path-constraint/script.ts), live example on [threepipe.org/examples](https://threepipe.org/examples/#follow-path-constraint/).

## Features of Object Constraints

- **Follow Path:** Objects can follow any 3D curve with automatic orientation
- **Smooth Motion:** Built-in damping prevents jerky movement
- **Real-time Control:** Adjust path position and influence parameters live via UI
- **Multiple Constraint Types:** Support for various constraint types beyond path following
- **Performance:** Efficient constraint evaluation without frame drops

## Understanding Path Constraints

The `follow_path` constraint works by:

1. **Path Definition:** Any 3D curve (Line, CatmullRomCurve3, etc.) can serve as a path
2. **Offset Parameter:** A value from 0 to 1 determines position along the path (0 = start, 1 = end)
3. **Orientation:** When `followCurve` is enabled, objects automatically rotate to face the path direction
4. **Influence:** Controls how strongly the constraint affects the object (0 = no effect, 1 = full constraint)

## Creating Complex Paths

You can create various path types:

**Spiral Path (as shown):**
```typescript
const spiralPoints = []
for (let i = 0; i <= totalPoints; i++) {
    const angle = (i / totalPoints) * Math.PI * 2 * loops
    const radius = startRadius + (endRadius - startRadius) * (i / totalPoints)
    spiralPoints.push(new Vector3(
        Math.cos(angle) * radius,
        i / totalPoints * height,
        Math.sin(angle) * radius
    ))
}
```

**Simple Curved Path:**
```typescript
const points = [
    new Vector3(-5, 0, 0),
    new Vector3(0, 3, 2),
    new Vector3(5, 0, 0)
]
const curve = new CatmullRomCurve3(points, false)
```

**Multi-Curve Path with CurvePath3:**
```typescript
import {CurvePath3} from 'threepipe'

const curve = new CurvePath3()
curve.add(new LineCurve3(new Vector3(0, 0, 0), new Vector3(1, 1, 1)))
curve.add(new CatmullRomCurve3([
    new Vector3(1, 1, 1),
    new Vector3(1, 1, 2),
    new Vector3(0, 2, 2),
    new Vector3(-1, 1, 1)
]))
const line = generator!.generate('geometry-line', {
    curve,
})
```

**Closed Loop:**
```typescript
const curve = new CatmullRomCurve3(points, true) // true = closed curve
```

## When to Use Path Constraints

Path constraints are perfect for:
- **Camera Movement:** Creating cinematic camera paths and fly-throughs
- **Object Animation:** Moving objects along predefined routes
- **UI Elements:** Animating interface components along curved paths  
- **Game Mechanics:** Rail-based movement systems or guided projectiles

## Integration with Animation Systems

The constraint system works seamlessly with:
- **PopmotionPlugin:** For smooth, eased animations with various easing curves
- **Animation Plugins:** Can be keyframed and controlled via timeline
- **UI Controls:** Real-time parameter adjustment via Tweakpane
- **Multiple Objects:** The same path can constrain multiple objects with different offsets

## Performance Considerations

- Constraints are evaluated efficiently each frame
- Path complexity (number of segments) has minimal impact on performance
- Multiple objects can share the same path constraint
- Constraint influence can be animated for dynamic effects

The Object Constraints system provides a powerful, flexible way to create complex object movements and relationships in your ThreePipe scenes, all with real-time control and smooth performance.

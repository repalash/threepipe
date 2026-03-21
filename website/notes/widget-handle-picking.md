---
prev:
  text: 'Dynamically Loaded Files'
  link: './dynamically-loaded-files'

aside: false
---

# Widget Handle Picking System

This note documents how threepipe's widget handle picking system works, from click to gizmo attachment. This system enables interactive handles on widgets (e.g., curve control points on LineHelper) that can be selected and transformed independently.

## Key Concepts

- **Widget**: An object with `assetType = 'widget'` and `isWidget = true` that visualizes or controls another object. Implements `IWidget` from `src/core/IScene.ts`.
- **Widget Handle**: A child mesh of a widget with `userData.isWidgetHandle = true`. When picked, the transform gizmo attaches directly to this handle instead of the parent object.
- **Widget Root**: A scene-level group (`userData.isWidgetRoot = true`) that holds widgets. Created by `Object3DWidgetsPlugin`. Added to ObjectPicker's `extraObjects` so widgets can be raycast.

## Data Flow

```
User clicks canvas
    |
ObjectPicker.checkIntersection()
    - raycaster.intersectObjects([modelRoot, ...widgetRoots], recursive=true)
    - Filters by selectionCondition (userSelectable, bboxVisible, material)
    - Returns HitIntersects { selectedObject, intersect, intersects, mouse }
    |
PickingPlugin._onObjectHit()
    - Calls getRootIfWidget(selectedObject)
      Walks up parent chain until assetType === 'widget' or userData.allowPicking
    - If a widget is found:
        selectedObject = widget.object    (the model the widget is attached to)
        selectedWidget = widget           (the widget itself, e.g. LineHelper)
        selectedHandle = clicked mesh     (only if userData.isWidgetHandle === true)
    - Dispatches 'hitObject' event
    |
ObjectPicker.setSelected()
    - Dispatches 'selectedObjectChanged' with full HitIntersects
    |
TransformControlsPlugin listener
    - Reads: event.intersects.selectedHandle ?? selectedObject ?? object
    - Attaches gizmo to the handle (if present) or the object
    |
TransformControls2.attach(target)
    - Reads target.userData.transformControls config (if present)
    - Applies config: mode, space, showX/Y/Z, snap values, lockProps
    - Saves previous gizmo state, restores on detach
```

## Creating a Widget Handle

Example from `LineHelper.ts` (curve control point handles):

```typescript
const cube = new Mesh(cubeGeometry, material)

// Mark as a widget handle so PickingPlugin identifies it
cube.userData.isWidgetHandle = true

// Configure how TransformControls behaves when this handle is selected
cube.userData.transformControls = {
    mode: 'translate',      // Only allow translation
    space: 'local',         // Use local coordinate space
    showX: true,
    showY: true,
    showZ: true,
    lockProps: ['mode'],    // Prevent user from switching mode
}

// Override setDirty to receive transform feedback
;(cube as IObject3D).setDirty = (e: IObjectSetDirtyOptions) => {
    if (e.change !== 'transform') return
    // Update underlying data from handle position
    curvePoint.copy(cube.position)
    geometry.setDirty({regenerate: true})
}

widget.add(cube) // Add as child of the widget
```

## userData Markers

| Property | Type | Where Set | Purpose |
|----------|------|-----------|---------|
| `isWidgetHandle` | `boolean` | Handle mesh | Marks a mesh as a pickable widget handle |
| `isWidgetRoot` | `boolean` | Widget root group | Marks root for ObjectPicker raycast inclusion |
| `transformControls` | `object` | Handle mesh | Config applied to gizmo on attach (mode, space, axes, lockProps) |
| `userSelectable` | `boolean` | Any object | `false` to exclude from picking |
| `bboxVisible` | `boolean` | Any object | `false` to exclude from picking and bounding box |
| `allowPicking` | `boolean` | Any object | Stops `getRootIfWidget` traversal, allows picking the object directly |
| `disableWidgets` | `boolean` | Any object | Prevents Object3DWidgetsPlugin from creating widgets for this object |

## How the Gizmo Adapts to Handles

`TransformControls2.attach()` checks `object.userData.transformControls` and applies its properties:

```typescript
// Properties that can be configured per-handle:
'translationSnap', 'rotationSnap', 'scaleSnap',
'space', 'mode', 'showX', 'showY', 'showZ', 'lockProps'
```

The gizmo saves its current state before applying handle config, and restores it when detached.

## Adding Custom Widget Handles

To create your own interactive handles:

1. Create a widget class extending `AHelperWidget` (or implement `IWidget`)
2. Add child meshes with `userData.isWidgetHandle = true`
3. Set `userData.transformControls` on each handle to configure gizmo behavior
4. Override `setDirty` on handles to receive transform change callbacks
5. Register the widget with `Object3DWidgetsPlugin.helpers` or add directly to the scene

The PickingPlugin and TransformControlsPlugin handle the rest automatically.

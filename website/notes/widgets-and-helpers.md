---
prev:
  text: 'Widget Handle Picking'
  link: './widget-handle-picking'

aside: false
---

# Widgets, Helpers & Interactive Gizmos

This is a comprehensive reference for threepipe's widget system — the architecture behind interactive 3D helpers, selection visuals, transform gizmos, and editable curve/shape handles.

## Widget Architecture

### IWidget Interface

Every widget implements `IWidget` (`src/core/IScene.ts`):

```typescript
interface IWidget extends IObject3D {
    attach(object: any): this
    detach(): this
    isWidget: true
    object: any              // the scene object this widget is attached to
    update?(setDirty?: boolean): void
    preRender?(): void
}
```

Widgets are automatically excluded from: bounding box calculations, scene export/serialization, shadow casting/receiving, auto-near-far, frame-fade effects, and normal scene traversal.

### Class Hierarchy

All widget classes extend `Group2` and implement `IWidget`:

```
Group2
  ├── AHelperWidget (implements IWidget — event-driven lifecycle, UI integration)
  │     ├── LineHelper           (line/curve control point handles — INTERACTIVE)
  │     ├── BoneHelper           (single bone segment visualization)
  │     ├── SkeletonHelper2      (full skeleton visualization)
  │     ├── ALightHelperWidget
  │     │     ├── DirectionalLightHelper2
  │     │     ├── SpotLightHelper2
  │     │     └── PointLightHelper2
  │     └── ACameraHelperWidget
  │           └── CameraHelper2
  └── SelectionWidget (implements IWidget)
        └── BoxSelectionWidget   (wireframe bounding box on selection)
```

### Scene Separation

Widgets live outside the model root. They are parented under a **widget root** group (`userData.isWidgetRoot = true`), added directly to the `RootScene` via `addToRoot: true`. This ensures:
- Widgets don't affect model bounding box, centering, or auto-scaling
- Widgets aren't included in scene exports (glTF, JSON)
- Widgets must be explicitly registered with `ObjectPicker.extraObjects` for raycasting (done automatically by `PickingPlugin`)

## AHelperWidget — The Base Class

`AHelperWidget` (`src/three/widgets/AHelperWidget.ts`) provides the lifecycle for all object-visualizing widgets.

**Construction:** The constructor sets `this.matrix = object.matrixWorld` (inherits world transform, no own transform) and disables `matrixAutoUpdate`. Calls `attach()` by default.

**Attachment:** When `attach(object)` is called:
- Subscribes to `beforeRender`, `objectUpdate`, `geometryUpdate` events on the target
- Pushes its `uiConfig` into the object's UI panel

**Event-driven updates:** Uses a dirty-flag pattern:
1. `objectUpdate` / `geometryUpdate` → sets `_objectUpdated = true`
2. `beforeRender` → checks flag, calls `update()` if dirty

This debounces updates to at most once per render frame.

**Known limitation:** Three.js `onBeforeRender` is not called on lights or cameras, only meshes. This is why `ALightHelperWidget` and `ACameraHelperWidget` override with `preRender()`, which `Object3DWidgetsPlugin` calls explicitly in its viewer `preRender` listener.

## Object3DWidgetsPlugin — Automatic Widget Creation

`Object3DWidgetsPlugin` (`src/plugins/extras/Object3DWidgetsPlugin.ts`) automatically creates widgets for supported scene objects.

**Registry pattern:** Maintains a `helpers: IObject3DHelper[]` array of widget factories:

```typescript
interface IObject3DHelper<T extends IWidget = IWidget> {
    Check: (o: IObject3D) => boolean
    Create: (o: IObject3D) => T
}
```

Default registered helpers:
- `DirectionalLightHelper2`, `SpotLightHelper2`, `PointLightHelper2`
- `CameraHelper2`
- `LineHelper`
- `SkeletonHelper2`

**Lifecycle:**
1. Object added to scene → `viewer.object3dManager` fires `objectAdd` event
2. Plugin iterates `helpers`, calls `Check(object)` on each
3. For matches, calls `Create(object)` → widget added to `_widgetRoot`
4. Object removed → widget disposed

**Extension:** Add custom widget types at runtime:
```typescript
const widgetsPlugin = viewer.getPlugin(Object3DWidgetsPlugin)
widgetsPlugin.helpers.push({
    Check: (obj) => obj.userData.myCustomFlag === true,
    Create: (obj) => new MyCustomWidget(obj),
})
```

## Concrete Widgets

### LineHelper — Interactive Curve Editing

`LineHelper` (`src/three/widgets/LineHelper.ts`) is the most complex widget. It has two modes:

**Curve mode** (when `geometry.userData.generationParams.curve` exists):
- Extracts control points via `getPointsForCurve(curve)` — recursive, handles CubicBezier (`v0-v3`), CatmullRom/Spline (`points[]`), CurvePath (recursive with `curves.N.` prefix)
- Creates draggable cube handles at each control point
- Each handle has `userData.isWidgetHandle = true` and a custom `setDirty` that writes position changes back to the curve and triggers geometry regeneration

**Vertex mode** (fallback): Creates non-interactive blue cubes at each vertex position.

See [Widget Handle Picking](./widget-handle-picking) for the full interaction data flow.

### Light Helpers

- **DirectionalLightHelper2**: Square plane at light position + line toward target. Updates orientation via `lookAt()`, target line scales with intensity.
- **SpotLightHelper2**: Cone visualization matching spotlight angle and distance. 5 cone lines + 32-segment circle at cone end.
- **PointLightHelper2**: Wireframe sphere at light position.

All extend `ALightHelperWidget` and use `preRender()` for updates.

### CameraHelper2

Frustum visualization showing near/far planes, field of view cone, up direction, and target line. Uses a `pointMap` system mapping named points to buffer indices for efficient frustum corner updates via `camera.projectionMatrixInverse`.

### BoneHelper / SkeletonHelper2

- **BoneHelper**: Single bone as a colored line segment (blue→green gradient).
- **SkeletonHelper2**: Full skeleton — collects all bones, draws all connections. Uses `_hasSkeletonHelper` marker to prevent duplicates.

### BoxSelectionWidget

Wireframe bounding box for selected objects. Created by `PickingPlugin` for selection and hover visualization. Uses `LineSegments2` + `LineMaterial2` with no depth write.

## Interactive Controls (Gizmos)

### TransformControls

Three.js-derived gizmo for translate/rotate/scale (one mode at a time). Forked to use `UnlitMaterial`/`UnlitLineMaterial` so gizmos render correctly in threepipe's pipeline.

**TransformControls2** wraps it as an `IWidget` with:
- Keyboard shortcuts: W=translate, E=rotate, R=scale, Q=toggle space, X/Y/Z=toggle axes
- Per-handle config via `userData.transformControls` (applied on attach, restored on detach)
- Scene dirty propagation on `objectChange`

### PivotControls

drei-inspired gizmo showing ALL handles simultaneously: translation arrows + plane sliders, rotation arcs, scaling spheres. Own raycaster and pointer handling. Supports snap (Shift), fixed screen size, and depth test toggle.

**Key drag math:**
- Arrows: project ray onto axis direction
- Sliders: intersect ray with axis-plane, decompose into basis vectors
- Rotators: project ray-plane intersection onto tangent direction
- Scalers: offset along axis → `Math.pow(2, offset * 0.2)`

### PivotEditPlugin — Custom Gizmo Mode

Demonstrates creating a secondary gizmo mode that coexists with TransformControls:
1. Creates a pivot marker (yellow sphere) as a widget handle
2. On click, toggles pivot-edit mode — creates a separate TransformControls instance
3. Disables the main TransformControls/PivotControls while active
4. On gizmo release, calls `object.pivotToPoint()` and records undo

### Plugin Integration

Both `TransformControlsPlugin` and `PivotControlsPlugin` follow the same pattern:
1. Depend on `PickingPlugin`
2. Listen to `selectedObjectChanged`
3. Attach gizmo to `selectedHandle ?? selectedObject ?? event.object`
4. Disable camera interactions during drag (`setInteractions(false)`)
5. Record undo on `mouseUp` (capture start state on `mouseDown`, compare on release)

## The Picking Pipeline

```
Canvas pointer event
    ↓
ObjectPicker.checkIntersection()
    raycaster.intersectObjects([modelRoot, ...widgetRoots])
    Filter by selectionCondition
    ↓
PickingPlugin._onObjectHit()
    getRootIfWidget(): walk up parent chain to widget
    Resolve: selectedObject = widget.object
             selectedWidget = widget
             selectedHandle = mesh (if userData.isWidgetHandle)
    ↓
selectedObjectChanged event
    ↓
TransformControlsPlugin / PivotControlsPlugin
    Attach gizmo to handle (or object)
    ↓
User drags gizmo
    ↓
objectChange event → handle.setDirty({change: 'transform'})
    ↓
(For curve handles) Update curve point → geometry.setDirty({regenerate: true})
    ↓
GeometryGeneratorPlugin._geometryUpdate → generate()
    ↓
AHelperWidget._objectUpdate → update() on next render
```

## userData Markers Reference

| Property | Type | Purpose |
|----------|------|---------|
| `isWidget` | `boolean` | Identifies an object as a widget |
| `isWidgetRoot` | `boolean` | Root group added to ObjectPicker for raycasting |
| `isWidgetHandle` | `boolean` | Makes a mesh pickable as an interactive handle |
| `transformControls` | `object` | Per-handle gizmo config: `{mode, space, showX/Y/Z, lockProps, translationSnap, rotationSnap, scaleSnap}` |
| `disableWidgets` | `boolean` | Prevents Object3DWidgetsPlugin from creating widgets |
| `userSelectable` | `boolean` | `false` excludes from picking |
| `bboxVisible` | `boolean` | `false` excludes from picking and bounding box |
| `allowPicking` | `boolean` | Stops `getRootIfWidget` traversal |
| `__keepShadowDef` | `boolean` | Prevents shadow plugins from overriding cast/receive |

## Key Patterns

### Widget Root Pattern
All widgets are parented under a root `Group2` with `userData.isWidgetRoot = true`. This root is added to the scene with `addToRoot: true` (bypassing the model root). `PickingPlugin` adds these widget roots to `ObjectPicker.extraObjects` for raycasting.

### Widget Handle Pattern
Interactive sub-meshes of widgets set `userData.isWidgetHandle = true`. When `PickingPlugin` resolves a hit, it provides both the `selectedWidget` and `selectedHandle` to the transform controls. The handle's `userData.transformControls` configures gizmo behavior (mode, space, axes, lockProps).

### Material Convention
Widget subclasses typically set on their materials (not enforced by `AHelperWidget`, but followed by light/camera/selection helpers):
- `toneMapped: false` — render at full brightness
- `transparent: true` — blend over scene
- `depthWrite: false` — don't occlude other widgets
- `userData.renderToGBuffer = false`, `userData.renderToDepth = false` — excluded from deferred passes
- `allowOverride: false` — resist material extension plugins

Note: `LineHelper` uses `MeshBasicMaterial` for its handles and does not set all of these. Each subclass chooses what's appropriate.

### Shadow Prevention
All widget children get `castShadow = false`, `receiveShadow = false`, and `userData.__keepShadowDef = true` (prevents shadow plugins from re-enabling shadows).

### Dirty Propagation
Widgets call `iObjectCommons.setDirty()` which dispatches `objectUpdate` events that bubble to the root scene, triggering a re-render.

### Interactive Curve Editing Loop
When a LineHelper handle is dragged, the full loop is:
1. User drags handle cube via TransformControls
2. Handle's custom `setDirty` fires on `{change: 'transform'}`
3. Handler updates the curve control point from handle position
4. Calls `geometry.setDirty({regenerate: true})`
5. `GeometryGeneratorPlugin._geometryUpdate` catches the event and re-runs `generate()`
6. `AHelperWidget._objectUpdate` is triggered, schedules `update()` on next `beforeRender`
7. Widget rebuilds its handle positions from the regenerated geometry

## Creating Custom Widgets

### Step 1: Widget Class

```typescript
import {AHelperWidget} from 'threepipe'

export class MyWidget extends AHelperWidget {
    static Check(obj: IObject3D) { return obj.userData.myFlag === true }
    static Create(obj: IObject3D) { return new MyWidget(obj) }

    constructor(object: IObject3D) {
        super(object, true) // auto-attach
    }

    update(setDirty?: boolean) {
        // Rebuild visuals from object data
        super.update(setDirty)
    }
}
```

### Step 2: Add Interactive Handles

```typescript
const handle = new Mesh(geometry, material)
handle.userData.isWidgetHandle = true
handle.userData.transformControls = {
    mode: 'translate',
    space: 'local',
    lockProps: ['mode'],
}

// Receive transform feedback
;(handle as IObject3D).setDirty = (e) => {
    if (e.change !== 'transform') return
    // Write handle position back to your data model
    myData.controlPoint.copy(handle.position)
    // Trigger regeneration
    targetGeometry.setDirty({regenerate: true})
}

this.add(handle)
```

### Step 3: Register

```typescript
const widgetsPlugin = viewer.getPlugin(Object3DWidgetsPlugin)
widgetsPlugin.helpers.push(MyWidget)
```

The PickingPlugin and TransformControlsPlugin handle selection, gizmo attachment, and undo automatically.

## Related Pages

- [Widget Handle Picking](./widget-handle-picking) — Detailed data flow for handle selection
- [Fat Lines](./fat-lines) — MeshLine / LineGeometry2 rendering
- [Follow Path Constraint](./follow-path-constraint) — Animating objects along curves

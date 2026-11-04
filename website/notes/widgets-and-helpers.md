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

Mesh
  └── WidgetIcon (the icon of a light or camera widget in sprite mode: a camera-facing quad, a child of the widget)

WidgetIconOverlay (DOM layer of the icons in DOM mode, made by Object3DWidgetsPlugin; not in the scene)
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

**Kind, colour and icon:** `attach()` sets `kind` from `getWidgetKind(object)` (a light or camera kind, else
`undefined`). The colour of the lines is `color` when it is set, else the light colour for a light, else the colour of
the kind (`_lineColor`); a change of `color` redraws the widget. A widget
with a kind and `showIcon` on (`hasIcon`) has an `icon` (`WidgetIcon`, see [Icons](#icons-of-lights-and-cameras)) while
`iconMode` is `'sprite'`, updated in `update()`; with `'dom'` it has no sprite and the plugin's DOM layer draws the icon.
`iconSize` is its diameter in CSS pixels. Each option change runs `update()`; `batchUpdate(fn)` sets several options
with one update (the plugin uses it). `dispose()` removes and clears `icon` (and `shadowHelper` of a light widget).
`_createLineMaterial()` makes the line material of the light and camera helpers (the
[material convention](#material-convention)).

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

All extend `ALightHelperWidget` and use `preRender()` for updates. The lines are in the light's own colour (as is the
dot on the icon); the icon is in the colour of the light kind.

**Shadow frustum:** with `showShadowFrustum` on (`Object3DWidgetsPlugin.showShadowFrustum`, default off), a directional
or spot light that casts shadows gets `shadowHelper`, a `CameraHelper2` of `light.shadow.camera` inside its widget, in the
colour of the light kind. The widget calls `light.shadow.updateMatrices(light)` (as the renderer does before the shadow
map) and gives the helper the matrix of the shadow camera relative to the light. The helper has no icon,
`userData.userSelectable = false`: a hit on its lines is not picked and does not go up to the light widget (see
[picking a widget](#picking-a-widget)), so a click on a line selects nothing and goes to the model behind it.

### CameraHelper2

Frustum visualization showing near/far planes, field of view cone, up direction, and target line. Uses a `pointMap` system mapping named points to buffer indices for efficient frustum corner updates via `camera.projectionMatrixInverse`.
The lines are in the camera colour, the cross on the near and far planes darker.

### Icons of lights and cameras

`Object3DWidgetsPlugin.iconMode` sets how the icons are drawn: `'dom'` (default) or `'sprite'`. The plugin sets
`iconMode` on each widget: `'dom'` only while it has its DOM layer (a viewer container in a page), else `'sprite'`.
Changing it switches all icons; the sprites or the DOM elements of the other mode are removed.

The shapes of an icon are defined once, in `getWidgetIconShapes(kind)` (`src/three/widgets/widgetKinds.ts`): a white
disc with a ring in the colour of the kind, the icon path of the kind, and for lights a dot in the object's colour with a
white edge, in icon units (`widgetIconLayout`). `createWidgetIconTexture(kind, texels)` draws them on a 2D canvas for the
sprite, `getWidgetIconSvg(kind)` writes them as SVG for the DOM (the dot is `currentColor`). The colour and the icon of each
kind are in one table, `widgetKinds`, with `getWidgetKind(object)`. Other UI that shows lights and cameras (an editor
overlay, an outliner) reads the same functions.

**Sprite mode.** `WidgetIcon` (`src/three/widgets/WidgetIcon.ts`) is a quad mesh with a `MeshBasicMaterial`, not a
three.js `Sprite`. Before each render (`onBeforeRender`, also of its dot), `updateScale()` turns it to face the camera of
the render and converts `iconSize` pixels to its units, which depend on the projection (`projectionMatrix[5]`: the field
of view or the zoom), the canvas height and, for a perspective camera, the distance along the view axis. It makes the world matrix first and takes it into the space of the widget (the
transform of its object), so a rotation or a non-uniform scale of the object does not skew the icon. A mesh, so that the icon writes its GBuffer
flags (`userData.renderToFlags`) and is not tone mapped: its material keeps `allowOverride: false` (the debug views of
`ViewOverridesPlugin` would draw it as a square), and the GBuffer pass draws it with its own `customGBufferMaterial`,
cut by the alpha of the icon texture. `updateTexture(pixelRatio)` draws the texture at the size of the icon on screen,
`getWidgetIconTextureSize(iconSize, renderScale)` texels (about one texel per device pixel, so it is not upscaled or
shrunk), and again only when that size changes. Lights also have a child sprite, `dot`, on the same quad, with only the
dot in its texture, tinted with the light colour; it cannot be picked. A hit on a hidden icon (`showIcon` off) is not picked (see [picking a widget](#picking-a-widget)). The icon owns its textures and disposes them.

The icon materials follow the [material convention](#material-convention) and are also `depthTest: false`, so the icon
is drawn on top. The textures are premultiplied at upload and blended once (`CustomBlending`, `One` and
`OneMinusSrcAlpha`); `premultipliedAlpha: true` would multiply the colour by the alpha a second time in the shader. For the same reason `WidgetIcon.raycast` gives its hits a distance under `1e-6` (`d / (d + 1) * 1e-6`):
a click on an icon that is in front of a model on screen selects the light or the camera, not the model, and where icons
overlap the nearer one is hit first (it is also drawn last). The icon and dot quads have `frustumCulled = false`: the
world bounds of the frustum test ignore the pixel size of the quad, so an icon whose centre is just out of the view would
vanish while its disc is still on screen.

**DOM mode.** `WidgetIconOverlay` (`src/three/widgets/WidgetIconOverlay.ts`) is a `div` (`z-index` 8, under the other
canvas overlays) in the viewer container, over the canvas, with one element per widget holding the SVG. The plugin calls
`update(widgets, camera)` after each render (`postRender`) with the camera of the render (`scene.renderCamera`): it
projects the widget position, places the element with `transform` only (snapped to device pixels), and writes the DOM
only where something changed. It reads the layout (the canvas rectangle) only after `invalidateViewport()`, which the
plugin calls on a resize of the viewer, and checks which icons can be selected only after `invalidateClickable()`,
which the plugin calls on a viewer `update` event (a `setDirty`: the picking plugin, its options, the selection) and
when a plugin is added or removed. A change of `userData` flags alone sends no event: call `setDirty` or
`plugin.iconOverlay.invalidateClickable()` after it. An icon is hidden when the
widget or a parent is hidden, `hasIcon` is false, or the object is out of the near and far range (behind the camera). The
nearer icon is on top (`z-index` by depth). The pointer goes through the picker as on a sprite icon:
- The icon can be selected only when the picker's `selectableFor(widget)` gives the widget, the same check as a ray hit
  on a sprite icon (the selection condition, by default `isPickable`, which checks a widget from itself up as it does
  for the parts of a widget). The icons that cannot be selected (`widget-icon-static`) have `pointer-events: none`: the
  pointer goes through them to the canvas (orbit, clicks).
- A click is a hit on the widget at its position given to `ObjectPicker.selectHit`, which the clicks on the canvas also
  use: the `hitObject` event (the PickingPlugin maps the widget to its object, and a listener can consume the click),
  the picking mode, multi-select with shift, ctrl or cmd, and undo. As on the canvas, a press longer than
  `ObjectPicker.PointerClickMaxTime` or a move more than `PointerClickMaxDistance` is not a click.
- With the picker's `hoverEnabled`, the pointer on an icon hovers the object (`ObjectPicker.hoverHit`).
- A wheel over an icon is sent on to the canvas. A drag that starts on an icon does not orbit the camera.

#### Picking a widget

`isPickable` accepts a widget itself (it has no material), for the DOM icons. It checks the flags from the object up:
a part of a widget with `userSelectable === false`, or under such a part (the shadow frustum helper), is not picked. A
ray hit on a part that is not picked (hidden, or with that flag) does not go up to its widget: `ObjectPicker.selectableFor`
stops at a widget when it climbs from a part, so the hit is dropped and the next hit (the model behind) is picked. A
widget is picked through its parts that are picked, or as itself (a DOM icon).

The layer, the icons and its stylesheet are removed when the mode changes and when the plugin is removed. It is a small
layer of its own; it can move onto a shared screen overlay later.

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
- `userData.renderToFlags = true` — still writes the GBuffer flags (only those), so with `toneMapped: false` the screen pass does not tone map it, see [GBufferPlugin](../plugin/GBufferPlugin#materials-in-the-gbuffer)
- `allowOverride: false` — resist material extension plugins

Note: `LineHelper` uses `MeshBasicMaterial` for its handles and does not set all of these. Each subclass chooses what's appropriate.
The light and camera helpers get their line material from `AHelperWidget._createLineMaterial()`; `WidgetIcon` sets the
same on its sprite materials. DOM icons are not in the canvas, so no render, screenshot or recording has them.

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

---
prev:
    text: 'ShapeTubeExtrudePlugin'
    link: './ShapeTubeExtrudePlugin'

next:
    text: 'PenToolPlugin'
    link: './PenToolPlugin'

---

# PathEditPlugin

[Example](https://threepipe.org/examples/#path-edit-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/geometry/PathEditPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/PathEditPlugin.html)

PathEditPlugin edits the points of generated lines on the screen, like the path editing of Figma or Illustrator. It works on any object whose geometry has a curve in `geometry.userData.generationParams.curve`: a `line` of [GeometryGeneratorPlugin](./GeometryGeneratorPlugin), a path of `PenToolPlugin`, a camera path.

Start editing with `edit(object)`, or double-click a line (`editOnDoubleClick`, on by default). Then, on the canvas:

| Input | Action |
|---|---|
| Drag a point | Move it, on a plane that faces the camera through the point |
| <kbd>Shift</kbd> + drag | Move it on a level plane: the height stays |
| Click or drag a `+` | Add a point in the middle of the segment (and move it) |
| <kbd>Alt</kbd> + click a point | Remove it |
| Click a point, then <kbd>Delete</kbd> or <kbd>Backspace</kbd> | Remove the selected point |
| <kbd>Esc</kbd> | End editing; during a drag, cancel the drag |
| Click away from the line | End editing |

Each drag, add and remove is one undo step with [UndoManagerPlugin](./UndoManagerPlugin) (a click or a drag on a `+` adds the point and moves it in one step). An undo or redo during a drag ends the drag first, with no undo step for it.

```typescript
import {ThreeViewer, GeometryGeneratorPlugin, PathEditPlugin, UndoManagerPlugin, CatmullRomCurve3, Vector3} from 'threepipe'

const viewer = new ThreeViewer({...})
const generator = viewer.addPluginSync(GeometryGeneratorPlugin) // required (added as a dependency when missing)
viewer.addPluginSync(UndoManagerPlugin) // optional: undo and redo of the edits

const line = viewer.scene.addObject(generator.generateObject('line', {
    curve: new CatmullRomCurve3([new Vector3(-2, 0, 0), new Vector3(0, 1, 0), new Vector3(2, 0, 0)]),
}))

const pathEdit = viewer.addPluginSync(PathEditPlugin)
pathEdit.edit(line) // or double-click the line
pathEdit.editing // the object being edited, or null
pathEdit.canEdit(line) // true: a generated curve with points

pathEdit.addEventListener('editStart', ({object}) => console.log('editing', object.name))
pathEdit.addEventListener('editEnd', ({object}) => console.log('done', object.name))
pathEdit.addEventListener('pointChange', ({object, change}) => console.log(change)) // 'move' | 'add' | 'remove' | 'restore'

// from code, each one undo step (positions in the local space of the object)
pathEdit.getPoints() // the points of the curve
pathEdit.movePoint(1, new Vector3(0, 2, 0))
const i = pathEdit.addPoint(0) // in the middle of segment 0, returns the index of the new point
pathEdit.removePoint(i!)

pathEdit.stopEditing()
pathEdit.editOnDoubleClick = false
pathEdit.enabled = false // ends editing, and edit() does nothing
```

The settings are in the plugin UI (uiconfig decorators, `Path Edit`; with the Tweakpane UI: `ui.setupPluginUi(PathEditPlugin)`): Enabled, Edit on double-click, and an Edit selected line / Done button (`toggleEditSelected()`, with the selected object of `PickingPlugin`). They are not saved with the viewer.

## The handles

The handles are drawn in an SVG overlay in the viewer container: the curve, a filled dot at each point on the curve (anchor), a hollow dot at each Bezier control point (handle) with a line to its anchor, and a `+` in the middle of each segment that can have a point (hidden when the segment is short on the screen). A point behind the camera (perspective or orthographic) is not drawn and cannot be pressed. To change the colors, set the CSS variables `--sh-accent` and `--sh-fill` on `.sh-overlay.path-edit` (the overlay of this plugin).

While editing, a left press on a handle is taken in the capture phase: the camera controls, the picking and the transform controls do not get it, so the selection does not change. Every other press works as usual (orbit, pan, select). <kbd>Delete</kbd> and <kbd>Esc</kbd> are taken while editing, so they do not delete or deselect the object. These keys are for this viewer only: a key typed on the canvas or an element in the viewer container, or on the page after a press in this viewer. A key in a text field, a panel or another viewer is left to its own handlers. During a drag, only the pointer of the press moves the point; a second finger does not.

## The curve

The curve is in the local space of the object, so the object can be moved, rotated and scaled (also in the model root, with `modelRootScale`). A 2D curve is dragged in the xy plane of the object.

| Curve | Points | `+` adds | Remove |
|---|---|---|---|
| `LineCurve3`, `LineCurve` | 2 anchors | the line becomes a `CurvePath3` (`CurvePath` in 2D) of two lines | a line keeps 2 points |
| `CubicBezierCurve3`, `QuadraticBezierCurve3` (and 2D) | anchors and handles | split at its middle (de Casteljau): a path of two Beziers, the same shape | a handle goes back to its anchor |
| `CatmullRomCurve3`, `SplineCurve` | each point | a point on the curve | a spline keeps 2 points (3 when closed) |
| `CurvePath3`, `CurvePath`, `Path` | the points of each curve, each joint once | the segment is split in place | a joint joins its two curves (a line for two lines, else a cubic Bezier with the outer handles), an end point removes its curve |
| Other curves (an ellipse) | the vector fields, if any | no | no |

- The joint of two curves of a path is one point. It can be the same `Vector3` in both curves (as `PenToolPlugin` makes them) or two equal vectors (a path loaded from a file); moving it moves both curves, and adding or removing a point keeps the joints shared. The end of the last curve and the start of the first one are one point only when they are the same vector (a closed path): an open path whose ends meet stays open.
- Moving an anchor moves its Bezier handles with it. Moving a handle of a smooth point (two handles on one line through the anchor) turns the other handle to keep it smooth; its length stays.
- An add or a remove puts a new curve object in `generationParams.curve` (the old one is kept for undo); a move changes the vectors of the curve.
- The plugin regenerates the geometry with `geometry.setDirty({regenerate: true})`, so `GeometryGeneratorPlugin` must be in the viewer and the object in the scene.

The same edits are available without the plugin, as functions of a curve: `getCurveEditPoints`, `setCurveEditPoint`, `curvePointMover`, `getCurveSegments`, `addCurvePoint`, `removeCurvePoint`, `cloneCurve`, `snapshotCurve` and `restoreCurve`.

## LineHelper

[Object3DWidgetsPlugin](./Object3DWidgetsPlugin) adds a `LineHelper` to each line. It shows the points of the curve (or the vertices of a line without one) as dots of a constant size on the screen, and only draws them: they cannot be picked and have no gizmo. `showPoints` hides them. Before, the helper had cube handles that the transform gizmo moved; PathEditPlugin replaces them, so there is one way to edit a curve.

The plugin is not saved with the viewer config (`serializeWithViewer = false`). On remove it ends editing and removes its listeners, overlay, hint and stylesheet.

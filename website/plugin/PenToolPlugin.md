---
prev:
    text: 'ShapeTubeExtrudePlugin'
    link: './ShapeTubeExtrudePlugin'

next:
    text: 'GLTFKHRMaterialVariantsPlugin'
    link: './GLTFKHRMaterialVariantsPlugin'

---

# PenToolPlugin

[Example](https://threepipe.org/examples/#pen-tool-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/geometry/PenToolPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/PenToolPlugin.html)

PenToolPlugin is a pen for 3D paths, like the pen tool of Figma or Illustrator. It makes a `line` object of [GeometryGeneratorPlugin](./GeometryGeneratorPlugin) with a `CurvePath3` of cubic Bezier curves, so the path stays editable as a generated geometry and is saved in a glb.

After `start()` (or `toggle()`), on the canvas:

| Input | Action |
|---|---|
| Click | Add a corner point |
| Click and drag | Add a smooth point and pull out its Bezier handles (symmetric) |
| Click on the first point (3 points or more) | Close the path and finish |
| <kbd>Enter</kbd> or double-click | Finish (2 points or more) |
| <kbd>Backspace</kbd> or <kbd>Delete</kbd> | Remove the last point |
| <kbd>Esc</kbd> | Cancel |
| <kbd>Shift</kbd> while clicking | Keep the height of the previous point (draw in the air) |

A point goes on the visible surface of a model under the pointer (the pointer position in the canvas, also when the canvas is smaller than the container), else on the ground (y = 0), else (above the horizon) on the level plane through the previous point. A drag pulls the handles on a level plane through the point, or on a plane facing the camera when the camera looks along the ground. While drawing, the pen takes the left mouse button on the canvas: no selection and no orbit. The wheel still zooms. Keys in a text field are ignored.

An overlay shows the points, the handles, the curve and a dashed preview of the next segment, with a hint at the bottom of the viewer.

```typescript
import {ThreeViewer, GeometryGeneratorPlugin, PenToolPlugin, UndoManagerPlugin, PickingPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})
viewer.addPluginSync(GeometryGeneratorPlugin) // required (added as a dependency when missing)
viewer.addPluginSync(UndoManagerPlugin) // optional: the new path is one undo step
viewer.addPluginSync(PickingPlugin) // optional: the new path is selected

const pen = viewer.addPluginSync(new PenToolPlugin({
    color: '#ff6b3d', // default
    linewidth: 3, // px, default
}))

pen.start() // or pen.toggle(), e.g. from a toolbar button or a key
pen.active // true while drawing
pen.points // the points placed so far

pen.addEventListener('change', () => updateToolbar(pen.active)) // started, finished or cancelled
pen.addEventListener('created', ({object}) => console.log('new path', object.name)) // not on undo or redo

const path = pen.finish() // from code: make the path from the points so far; pen.finish(true) closes it
pen.cancel()
pen.enabled = false // cancels, and start() does nothing
```

The plugin UI (`uiConfig`) has Enabled, a Draw Path / Finish Path button, Color and Line Width.

## The path

- The object is at the centre of its points, named `Path 1`, `Path 2`, ... It is added to the model root, in its space, so it stays on the drawn points when the root is moved or scaled (`modelRootScale`).
- Each segment is a `CubicBezierCurve3`. Neighbouring segments share their end point (the same `Vector3`), so moving a point in the geometry editor keeps them joined.
- The line has 32 divisions for each curve (`samplePerCurve` of the line generator), so every point of the path is a vertex and corners stay sharp.
- The material is the default material of the line generator (`LineMaterial2`, or a basic line material with `LineGeometryGenerator.UseMeshLines = false`), with `color` and `linewidth`.
- With `UndoManagerPlugin`, adding the path is one undo step. With `PickingPlugin`, the path is selected, without an undo step of its own.

The plugin is not saved with the viewer config (`serializeWithViewer = false`). On remove it cancels a path being drawn and removes its listeners, overlay, hint and stylesheet.

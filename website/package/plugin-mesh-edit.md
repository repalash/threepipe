---
prev:
    text: '@threepipe/plugin-modelling'
    link: './plugin-modelling'
next:
    text: '@threepipe/plugin-editor-engine'
    link: './plugin-editor-engine'

aside: false
---

# @threepipe/plugin-mesh-edit

Blender-style edit mode for threepipe: vertex, edge and face selection with overlays, a modal
transform, and the Blender keymap.

[Example](https://threepipe.org/examples/#mesh-edit-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/mesh-edit/src/index.ts)

```bash
npm i @threepipe/plugin-mesh-edit
```

```typescript
import {ThreeViewer, PickingPlugin} from 'threepipe'
import {MeshEditPlugin} from '@threepipe/plugin-mesh-edit'

const viewer = new ThreeViewer({canvas, plugins: [PickingPlugin]})
const meshEdit = viewer.addPluginSync(MeshEditPlugin)

meshEdit.enter()              // Tab, on the selected mesh
meshEdit.setSelectMode(4)     // 1 / 2 / 3 for vertex / edge / face
meshEdit.selectAllElements()  // A
meshEdit.extrude()            // E, which chains into a move along the face normal
```

## Keymap

Edit mode owns these while it is active, and gives them back on exit:

| | |
| --- | --- |
| `Tab` | enter / leave |
| `1` `2` `3` | vertex / edge / face select |
| `A`, `Alt+A`, `Ctrl+I` | all, none, invert |
| `L` | select linked under the cursor |
| `G` `R` `S` | move, rotate, scale — or drag the gizmo |
| `G` `G` | edge slide (vertex slide when the selection is not edge loops) |
| `E` | extrude, constrained to the region's normal (`orient_type NORMAL`, Z) |
| `Shift+D`, `X`, `M`, `Y` | duplicate, delete, merge, split |
| `Esc` | cancel the running transform, restoring the snapshot |

During a transform, as in Blender: `X`/`Y`/`Z` constrain to an axis (again for local, again to
clear), `Shift+X/Y/Z` to a plane, `MMB` picks the axis under the drag, digits type an exact amount
(`Tab` moves to the next axis, `-` negates, `/` inverts, `=` opens an expression such as `2*pi/3`),
`Ctrl` inverts snapping (increments unless a target is set), `Shift` is precision, the wheel or
`PageUp`/`PageDown` resize the proportional circle, `Shift+O` cycles the falloff, `G`/`R`/`S` switch
mode, click or `Enter` confirm, right-click or `Esc` cancel. The header text Blender shows is
`meshEdit.activeTransform.status`.

Object-mode plugins — transform gizmos, pivot controls, widgets — are disabled by key while edit
mode is active, so their shortcuts do not fight with these, and restored afterwards.

## Transforms, pivot, orientation, snapping, proportional editing

The transform is a port of Blender's `editors/transform/` and runs without a renderer, so the
same code drives edit-mode elements and whole objects (`startObjectTransform`, with undo on
`UndoManagerPlugin`).

```typescript
meshEdit.setPivot('individual')      // median | active | individual | bounds | cursor
meshEdit.setOrientation('normal')    // global | local | normal | view | cursor
meshEdit.setSnapping({enabled: true, targets: ['vertex', 'edge', 'edgeMidpoint', 'face', 'grid', 'increment']})
meshEdit.setProportional({enabled: true, falloff: 'smooth', size: 1, connected: false})
meshEdit.setCursor(0, 1, 0)          // the 3D cursor
meshEdit.showGizmo(true)             // off by default: it belongs to the Move/Rotate/Scale tools
meshEdit.startTransform('rotate', {constraint: CON_AXIS2, releaseConfirm: true})
```

The gizmo is Blender's combined one — arrows and plane squares, rotation rings, scale boxes, a
screen-space centre circle, a view-rotation ring and the uniform-scale annulus, X red, Y green,
Z blue — and follows the pivot and orientation. Dragging a handle starts the same transform with that
handle's constraint and confirms on release; typing a number during the drag sets it exactly.

## Loop tools: edge slide, vertex slide, loop cut and slide

Edge slide and vertex slide are transform modes of the same `TransInfo`, ported from Blender's
`transform_mode_edge_slide.cc`, `transform_mode_vert_slide.cc` and the slide data of
`transform_convert_mesh.cc`, so numeric input, snapping, precision and the redo path work as for
move. During a move, `G` again switches to edge slide when the selection is one or more edge loops,
else to vertex slide (Blender's `VERT_EDGE_SLIDE` modal key); `G` once more goes back to move.

| During a slide | |
| --- | --- |
| mouse | slide along the loop's neighbouring faces (vertex slide: along the edge the mouse moves towards) |
| digits | exact factor: `1` reaches the neighbouring loop on one side, `-1` the other |
| `E` | even: keep the shape of the neighbouring loop |
| `F` | with even, follow the other neighbouring loop |
| `C`, or `Alt` held | unclamped: slide past the neighbouring edges |
| `Ctrl` | snap; with a vertex/edge/face target the slide follows it |

Loop Cut and Slide is Blender's `MESH_OT_loopcut_slide` (`editmesh_loopcut.cc`, then an edge slide):
hovering an edge previews the ring it would cut (`EDBM_preselect_edgering_update_from_edge`); the wheel,
`PageUp`/`PageDown` or typed digits set the number of cuts, `Alt` with them the smoothness; a click cuts
and slides the new loops, a second click places them, a right click leaves them centred. `Esc` or a
right click before the cut cancels. The cut and the slide are one undo step.

```typescript
meshEdit.startTransform('edgeSlide')                 // or 'vertSlide'; {slide: {useEven, flipped, useClamp}}
meshEdit.activeTransform!.status                     // 'Edge Slide: 0.2500 '
meshEdit.startLoopCut()                              // Ctrl+R; {releaseConfirm: true} is the Loop Cut tool
meshEdit.activeLoopCut!.preview                      // {edges: [[a, b], ...], verts}, object space
meshEdit.loopCutBy({cuts: 2, smoothness: 0, falloff: 'inverseSquare', edgeIndex: 4}, null) // the redo path
```

A finished slide reports its properties through `transformCommitted` (`saved.slide`), a loop cut through
`loopCutDone`, which is what the editor's redo panel re-runs. Two deliberate deviations from Blender, so
that a redo reproduces what was on screen: the `E`/`F`/`C` toggles are saved (Blender's `saveTransform`
drops them), and the cursor the slide started from is kept and reused (Blender's exec runs with the
cursor at the region's corner, which picks the reference vertex and, with several loops, which way
each loop slides). Not ported: `correct_uv`, which re-interpolates UVs as vertices slide
(`issues/open/modelling-tools/transform-slide-correct-uv.md`).

## Reference images

`ReferenceImagePlugin` puts photographs over the viewport as draggable, resizable panels. They stay
put when the camera orbits and never appear in a render or an export, which is what you want for
working by eye.

For modelling *to measurement* rather than by eye, see the `reference` command in
[`@threepipe/plugin-modelling`](./plugin-modelling): that places a photograph on a world plane at a
calibrated scale with a camera view registered to it.

## Sharing a document with the command API

When [`@threepipe/plugin-modelling`](./plugin-modelling) is also loaded, edit mode takes the exact
topology from it instead of recovering it from the triangle buffer — so an object built by command
opens with its n-gons and vertex indices intact — and a committed edit goes back into the document as
an undoable change. Neither plugin imports the other; the connection is made by plugin-type string.

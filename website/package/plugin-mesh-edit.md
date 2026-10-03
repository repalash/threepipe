---
prev:
    text: '@threepipe/plugin-modelling'
    link: './plugin-modelling'

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

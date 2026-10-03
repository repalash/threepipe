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
| `G` `R` `S` | move, rotate, scale — then `X`/`Y`/`Z` to constrain, digits for an exact amount |
| `E` | extrude, constrained to the region's averaged normal |
| `Shift+D`, `X`, `M`, `Y` | duplicate, delete, merge, split |
| `Esc` | cancel the running transform, restoring the snapshot |

Object-mode plugins — transform gizmos, pivot controls, widgets — are disabled by key while edit
mode is active, so their shortcuts do not fight with these, and restored afterwards.

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

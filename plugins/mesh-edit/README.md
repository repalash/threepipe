# @threepipe/plugin-mesh-edit

Blender-style mesh edit mode for [threepipe](https://threepipe.org/).

Select a mesh, press <kbd>Tab</kbd>, and its vertices, edges and faces become selectable elements. The
topology is taken over by [`@threepipe/mesh-kernel`](../mesh-kernel), so what you are clicking is real
n-gon topology rather than the triangle buffers the renderer sees. Leaving edit mode bakes the result
back into the object's geometry.

## Status

Early. Element selection, overlays, picking and mode switching work. The modal transform tools (move,
rotate, scale with axis constraints) and the modelling operators (extrude, inset, bevel, loop cut) are
next. See `issues/open/modelling-tools/02-parity-goal.md` in the repo.

## Naming

This plugin is `MeshEditPlugin`, not `EditModePlugin`. The latter is taken by the Threepipe Editor,
where it means the editor's *viewport* mode: cameras, grid and fly navigation. Two plugins cannot share
a `PluginType`.

## Usage

```ts
import {MeshEditPlugin} from '@threepipe/plugin-mesh-edit'

const meshEdit = viewer.addPluginSync(MeshEditPlugin)

meshEdit.enter(someMesh)          // or enter() to use the current selection
meshEdit.setSelectMode(SelectMode.Face)
meshEdit.selectAllElements()
meshEdit.state!.describe()        // 'face mode | verts 26 edges 72 faces 48 | selected 26/72/48'
meshEdit.exit()                   // bakes back into the geometry
```

Everything the keyboard and mouse do is reachable from this API. That is deliberate: the scripting
surface is also the surface an agent drives, so a tool that only works from a gizmo is not finished.

## Keys

| Key | Action |
| --- | --- |
| <kbd>Tab</kbd> | enter / leave edit mode |
| <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> | vertex / edge / face mode |
| <kbd>A</kbd> / <kbd>Alt+A</kbd> | select all / none |
| <kbd>Ctrl+I</kbd> | invert selection |
| <kbd>L</kbd> | select linked |
| <kbd>Shift</kbd>+click | extend selection |
| <kbd>Esc</kbd> | leave edit mode |

While edit mode is active, `TransformControlsPlugin`, `PivotControlsPlugin`, `PivotEditPlugin` and
`Object3DWidgetsPlugin` are disabled *by key*, so their shortcuts and gizmos do not fight with the
edit-mode ones and the host editor's own bookkeeping is not clobbered. They are restored on exit.

## Entering edit mode is lossy for imported meshes

A `BufferGeometry` is a triangle soup with split corners. Recovering shared-vertex topology means
welding coincident positions, and welding cannot know which coincident vertices were deliberately
separate. `state.weldedCount` reports how many collapsed. Meshes authored through the kernel keep their
`MeshData` and skip this entirely.

## Licence

Apache-2.0. Algorithms are ported from Blender (GPL-2.0-or-later); see the kernel's notes for
provenance per file.

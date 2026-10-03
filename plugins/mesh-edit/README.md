# @threepipe/plugin-mesh-edit

Blender-style mesh edit mode for [threepipe](https://threepipe.org/).

Select a mesh, press <kbd>Tab</kbd>, and its vertices, edges and faces become selectable elements. The
topology is taken over by [`@threepipe/mesh-kernel`](../mesh-kernel), so what you are clicking is real
n-gon topology rather than the triangle buffers the renderer sees. Leaving edit mode bakes the result
back into the object's geometry.

## Status

Element selection, overlays, picking, mode switching, the modal transforms (move, rotate, scale
with Blender's constraints, pivots, orientations, snapping, proportional editing, numeric input and
the combined gizmo) and the knife (`startKnife`, Blender's knife with its snapping, cut-through,
angle and axis locks and per-segment undo) work. Loop cut is next. See
`issues/open/modelling-tools/` in the repo.

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
| <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> | vertex / edge / face mode; <kbd>Shift</kbd> combines modes, <kbd>Ctrl</kbd> expands (contracts going down) |
| click / <kbd>Shift</kbd>+click | select / toggle an element |
| drag | box select (`dragSelect`); <kbd>Shift</kbd> adds, <kbd>Ctrl</kbd> subtracts, both intersect |
| <kbd>MMB</kbd> drag / <kbd>Alt</kbd>+drag | orbit while drag-select is on |
| <kbd>B</kbd> / <kbd>C</kbd> | box tool / circle select modal (wheel resizes, <kbd>Esc</kbd> ends) |
| <kbd>Alt</kbd>+click / <kbd>Ctrl+Alt</kbd>+click | edge loop / edge ring (face loop in face mode); <kbd>Shift</kbd> toggles |
| <kbd>Ctrl</kbd>+click | shortest path from the active element |
| <kbd>L</kbd> / <kbd>Shift+L</kbd> / <kbd>Ctrl+L</kbd> | select linked under the cursor / deselect it / grow the selection to linked |
| <kbd>Ctrl</kbd>+<kbd>Numpad+</kbd> / <kbd>Numpad-</kbd> | select more / less |
| <kbd>A</kbd> / <kbd>Alt+A</kbd> | select all / none |
| <kbd>Ctrl+I</kbd> | invert selection |
| <kbd>H</kbd> / <kbd>Shift+H</kbd> / <kbd>Alt+H</kbd> | hide selected / hide unselected / reveal |
| <kbd>Alt+Z</kbd> | X-ray: see and select through the surface |
| <kbd>K</kbd> / <kbd>Shift+K</kbd> | knife: click points, <kbd>Enter</kbd> applies (Shift: cut through, selected faces only) |
| <kbd>Esc</kbd> | cancel a drag or modal; never leaves edit mode |

The selection tools are Blender's, ported from `editors/mesh/editmesh_select.cc`, `editmesh_path.cc`,
`editmesh_utils.cc` and `space_view3d/view3d_select.cc` (see `src/select/`), and run on the GPU
selection buffer when X-ray is off, so only visible elements take part. Each has a method the host
editor can bind instead of the keys: `boxSelect`, `lassoSelect`, `circleSelect`, `selectLoop`,
`selectShortestPath`, `selectLinkedPick`, `selectLinked`, `selectMore`, `selectLess`, `hideSelected`,
`revealHidden`, `toggleSelectMode`; `dragSelect` and `setOrbitButtons` decide what the mouse does.

While edit mode is active, `TransformControlsPlugin`, `PivotControlsPlugin`, `PivotEditPlugin` and
`Object3DWidgetsPlugin` are disabled *by key*, so their shortcuts and gizmos do not fight with the
edit-mode ones and the host editor's own bookkeeping is not clobbered. They are restored on exit.

## Transforms

The modal transform is a port of Blender's `editors/transform/` (`transform.cc`,
`transform_mode_{translate,rotate,resize}.cc`, `transform_input.cc`, `transform_constraints.cc`,
`transform_orientations.cc`, `transform_snap*.cc`, `transform_generics.cc`,
`transform_convert_mesh.cc`) and `editors/util/numinput.cc`; `src/transform/` and `src/snap/` cite
the function and line per port. It is renderer-free: the view comes in as matrices, so the whole state
machine runs in Node (`tests/transform.test.ts`).

| Key, during <kbd>G</kbd> / <kbd>R</kbd> / <kbd>S</kbd> or a gizmo drag | Action |
| --- | --- |
| <kbd>X</kbd> <kbd>Y</kbd> <kbd>Z</kbd> | constrain to an axis; again for local, again to clear |
| <kbd>Shift+X/Y/Z</kbd> | constrain to the plane perpendicular to the axis |
| <kbd>MMB</kbd> drag, <kbd>Shift+MMB</kbd> | pick the axis (plane) the cursor moves along |
| <kbd>C</kbd> | clear the constraint |
| digits, <kbd>.</kbd>, <kbd>-</kbd>, <kbd>/</kbd>, <kbd>Tab</kbd> | exact value; negate; invert; next axis (`G 1 Tab 2`) |
| <kbd>=</kbd> then an expression | `2*pi/3`, `(1+sqrt(2))`, `90deg`, `1r` |
| <kbd>Ctrl</kbd> | invert snapping (increments by default: grid step, 5°, 0.1) |
| <kbd>Shift</kbd> | precision: a tenth of the motion, 1° and 0.01 increments |
| <kbd>Shift+Tab</kbd> | toggle snapping |
| wheel, <kbd>PageUp</kbd> / <kbd>PageDown</kbd> | proportional size ×1.1 |
| <kbd>Shift+O</kbd>, <kbd>Alt+C</kbd> | cycle the falloff, toggle connected-only |
| <kbd>G</kbd> <kbd>R</kbd> <kbd>S</kbd> | switch mode without restarting |
| click / <kbd>Enter</kbd>, right-click / <kbd>Esc</kbd> | confirm, cancel |

```ts
meshEdit.startTransform('translate')                       // G; 'rotate' / 'resize' for R / S
meshEdit.startTransform('translate', {orientation: 'normal', constraint: CON_AXIS2}) // what E does
meshEdit.activeTransform!.status                           // 'Dx:  0.1000   Dy:  0.0000   Dz:  0.0000 (0.1000)'
meshEdit.activeTransform!.handleNumericKey('2')            // type
meshEdit.activeTransform!.setAxis(0)                       // X
meshEdit.confirmTransform()  /  meshEdit.cancelTransform()

meshEdit.setPivot('individual')      // 'median' | 'active' | 'individual' | 'bounds' | 'cursor'
meshEdit.setOrientation('normal')    // 'global' | 'local' | 'normal' | 'view' | 'cursor'
meshEdit.setSnapping({enabled: true, targets: ['vertex', 'edgeMidpoint'], source: 'closest'})
meshEdit.setProportional({enabled: true, falloff: 'sphere', size: 1.5, connected: true})
meshEdit.setCursor(0, 1, 0)
meshEdit.showGizmo(true)             // the gizmo belongs to a transform tool, so it is off by default

// Object mode: the same backend, with an undo step on UndoManagerPlugin
meshEdit.objectGizmo = true
meshEdit.startObjectTransform('rotate', {objects})
```

The gizmo (`meshEdit.gizmo`) is Blender's combined one: translate arrows and plane squares outside
the rotation rings, scale boxes inside, a screen-space centre circle, a white view-rotation ring with
the uniform-scale annulus just inside it; X red, Y green, Z blue, full alpha on hover, handles pointing
at the view fade out. A drag on a handle runs `startTransform` with that handle's constraint and
confirms on release; typing a number during the drag sets it exactly.

## Entering edit mode is lossy for imported meshes

A `BufferGeometry` is a triangle soup with split corners. Recovering shared-vertex topology means
welding coincident positions, and welding cannot know which coincident vertices were deliberately
separate. `state.weldedCount` reports how many collapsed. Meshes authored through the kernel keep their
`MeshData` and skip this entirely.

## Licence

Apache-2.0. Algorithms are ported from Blender (GPL-2.0-or-later); see the kernel's notes for
provenance per file.

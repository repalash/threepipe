---
prev:
    text: '@threepipe/plugin-mesh-edit'
    link: './plugin-mesh-edit'
next:
    text: '@threepipe/plugin-modelling-editor'
    link: './plugin-modelling-editor'

aside: false
---

# @threepipe/plugin-editor-engine

The interaction engine of the modelling editor, with no UI framework in it: operator and tool registries, a
keymap with presets and one input router, one undo history with a label per step, redo-last ("Adjust Last
Operation"), status hints and the events a shell renders from. The React shell
(`@threepipe/plugin-modelling-editor`) only draws what this exposes; any other threepipe app, and an agent,
drives the same surface.

[Example](https://threepipe.org/examples/#modelling-editor/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/editor-engine/src/index.ts)

```bash
npm i @threepipe/plugin-editor-engine
```

```ts
import {EditorEnginePlugin} from '@threepipe/plugin-editor-engine'

const engine = viewer.addPluginSync(EditorEnginePlugin)   // adds Picking, UndoManager and MeshEdit if absent
await engine.run('add.cube')                               // the operator the Add menu runs
engine.setMode('edit')                                     // Tab
engine.setSelectMode('face')                               // 3
await engine.run('mesh.inset', {thickness: 0.1})           // one undo step, labelled "Inset cube"
await engine.lastOperation!.redo!({thickness: 0.2})        // pop that step, run again, record again
engine.history.undo()                                      // back to before the inset
engine.keymap.setPreset('design')                          // Figma/trackpad keys
```

## What it composes

- `MeshEditPlugin` (`@threepipe/plugin-mesh-edit`): the edit-mode session, element selection, overlays and
  the modal transform. Its own key handler is switched off (`keyHandling = false`) while the engine is present;
  modal keys are forwarded through `handleModalKey`.
- `ModellingPlugin` (`@threepipe/plugin-modelling`): the document and the command table. Every command with a
  schema becomes a `modelling.<op>` operator; the edit-mode inset, bevel, delete menu and separate run the
  command on the edited object's document entry with the selected element indices, then the session reloads.
  An object that is not in the document joins it when edit mode starts on it, so imported meshes get the same
  commands.
- threepipe's `PickingPlugin` (object selection, delete, duplicate, hide, transform clear; `keyboardShortcuts`
  off while the engine runs), `TransformControlsPlugin` (the object gizmo behind the move/rotate/scale tools)
  and `UndoManagerPlugin` (the one history).

## Registries

`src/registry.ts` is what a shell renders from (moved here from the shell package, unchanged in shape):

- `OperatorDescriptor` - `id`, `label`, `description`, `icon`, `category`, `modes`, `contextMenu`, `props`
  (JSON schema, rendered as the redo-last form), `flags` (`undo`, `register`), `hidden`, `poll(ctx)` (false or
  a reason string disables with a tooltip) and `exec(ctx, props)`. `shortcut` is **filled in by the engine from
  the active keymap**; descriptors never hard-code a key.
- `ToolDescriptor` - sticky tools for the tool shelf: `activate` / `deactivate`, `hints`.
- `EditorEngine` - the registries, `mode`, `selectMode`, `activeTool`, `lastOperation`, `history`, `keymap`,
  `input`, `status`, `stats()`, `poll()`, `run(id, props)`, `record()`, `message()` and the events
  (`modeChanged`, `selectionChanged`, `registryChanged`, `lastOperationChanged`, `historyChanged`,
  `statusChanged`, `keymapChanged`, `message`, `uiRequest`).
- `uiRequest` asks the shell for one of its surfaces: `palette`, `history`, `shortcuts`, `about`,
  `operatorPanel`, or `menu` with a list of `{id, label?, props?}` items to open at the cursor - how Blender's
  `X` (delete menu), `M` (merge), `Shift+A` (add) and `Ctrl+A` (apply) keys work (`WM_menu_invoke`).

## One history

Everything records on `UndoManagerPlugin`'s `JSUndoManager`, with a label per step: modelling commands (the
plugin records them itself when the undo manager is present), edit-mode operations (`MeshEditPlugin` records
them), object selection and deletes (`PickingPlugin`), property edits (uiconfig). One Ctrl+Z walks back through
all of it in order, in both modes. `engine.history.entries()` lists the labels for a history dialog. An agent's
`undo` command walks the same stack.

## Redo-last

`run()` remembers the undo step a registered operator pushed. `lastOperation.redo(newProps)` is Blender's
`ED_undo_operator_repeat` (`editors/undo/ed_undo.cc:651`): undo until that step is popped (`ED_undo_pop_op`),
run the operator again with the new props (`WM_operator_repeat`), and if the re-run fails redo what was undone
(`ED_undo_redo`). Modal operators report their final props when the modal ends - a transform's value, axis
and orientation (`MeshEditPlugin`'s `transformCommitted`, Blender's `saveTransform`), extrude's offset - so
they re-run exactly. The panel goes away once its step is no longer the top of the stack.

## Keymap presets

Each preset is a list of `{keys, id, props?, tool?, mode?, repeat?}` bindings plus a navigation block. Keys are
`KeyboardEvent.code` based (`z` is the physical Z key on any layout); `ctrl` also matches the Command key on a
Mac. The display string of every operator and tool is derived from the active preset, so tooltips, menus, the
palette and the shortcuts dialog cannot disagree with what is bound. Switch with `engine.keymap.setPreset(id)`,
the Edit > Keymap operator, or the `edit.keymap` operator with `{preset}`; the choice persists in
`localStorage` (`storageKey` option).

### Blender

Ported from Blender's default keymap (`scripts/presets/keyconfig/keymap_data/blender_default.py`; the source
file cites the line of each binding).

| Keys | Operator |
|---|---|
| Tab | Edit mode / Object mode |
| 1 / 2 / 3 | Vertex / edge / face select |
| A, Alt+A, Ctrl+I | Select all / none / invert |
| L, Ctrl+L | Select linked |
| G / R / S | Move / rotate / scale (modal; X/Y/Z lock an axis, numbers type a value, Shift precision) |
| G G | Edge slide (vertex slide when the selection is not edge loops) |
| Shift+V | Vertex slide |
| Ctrl+R | Loop cut and slide |
| E | Extrude along the normal |
| I | Inset faces |
| Ctrl+B | Bevel |
| K / Shift+K | Knife (Shift: cut through, selected faces only) - see [Cutting](#cutting) |
| M | Merge menu (At Center / First / Last, By Distance) |
| Y | Split |
| P | Separate selection |
| F | Make Edge/Face (edge-net fill; press again to keep extending) |
| J | Connect Vertex Path |
| Shift+D | Duplicate |
| X, Delete | Delete menu (delete types, Dissolve Vertices / Edges / Faces, Limited Dissolve) |
| Ctrl+X, Ctrl+Delete | Dissolve by select mode |
| Ctrl+V / Ctrl+E / Ctrl+F | Vertex / Edge / Face menus (Connect, Bridge Edge Loops, Grid Fill, ...) |
| Shift+A | Add menu |
| Ctrl+J | Join |
| Ctrl+P, Alt+P | Parent to active / clear parent |
| Alt+G / Alt+R / Alt+S | Clear location / rotation / scale |
| Ctrl+A | Apply menu |
| H, Alt+H | Hide / unhide all |
| Ctrl+Z, Ctrl+Shift+Z, Ctrl+Alt+Z | Undo, redo, undo history |
| F9 | Adjust last operation |
| Shift+R | Repeat last |
| F3 | Command palette |
| F2 | Rename |
| Home, Numpad . | Frame all / frame selected |
| Numpad 1/3/7 (+Ctrl) | Front/right/top (back/left/bottom) views |
| Numpad 5 | Perspective / orthographic |
| Alt+Z | X-ray |
| W | Select tool |

Navigation: middle-drag orbits, Shift+middle-drag pans, the wheel zooms, Alt+left-drag orbits ("Emulate 3 Button
Mouse"), right-drag pans and a right click opens the context menu. A left drag belongs to selection (box select
in edit mode, from track S). Trackpad: two-finger scroll orbits, Shift+two-finger pans, pinch zooms - Blender's
own trackpad mapping.

### Design (Figma / trackpad)

For someone who knows Figma, Photoshop or a trackpad better than Blender. Built on Blender's Industry
Compatible keymap (`industry_compatible_data.py`, the cross-DCC survey of task T54963) plus the 2D-tool
conventions from the editor research: Enter drills into edit mode, Esc backs out one level, Space+drag pans,
Alt+drag orbits.

| Keys | Operator |
|---|---|
| Q / W / E / R | Select / move / rotate / scale tools |
| Enter | Edit mode on the selection |
| Esc | Back out: cancel a running tool, else clear the selection, else leave edit mode |
| 1 / 2 / 3 | Vertex / edge / face select (enters edit mode if needed) |
| 4 | Object mode |
| Ctrl+A, Ctrl+Shift+A, Ctrl+I | Select all / none / invert |
| Ctrl+L | Select linked |
| Ctrl+E | Extrude |
| I | Inset faces |
| Ctrl+B | Bevel |
| K | Knife tool (IC's `builtin.knife`) - see [Cutting](#cutting) |
| M | Merge menu (incl. By Distance) |
| Ctrl+D | Duplicate |
| P | Make Edge/Face (Modo's Make Polygon key; P parents only in object mode) |
| J | Connect Vertex Path |
| Delete, Backspace | Delete (by select mode, no menu) |
| right click | context menu: Bridge Edge Loops, Grid Fill, Connect, the dissolve family, ... by select mode |
| Ctrl+Backspace, Ctrl+Delete | Dissolve |
| Ctrl+J, Ctrl+Shift+J | Join / separate |
| P, Shift+P | Parent to active / clear parent |
| Alt+W / Alt+E / Alt+R | Clear location / rotation / scale |
| Ctrl+H, Alt+H | Hide / unhide all |
| Shift+A | Add menu |
| Ctrl+Z, Ctrl+Shift+Z, Ctrl+Alt+Z | Undo, redo, undo history |
| F9 | Adjust last operation |
| Ctrl+K | Command palette |
| F2 | Rename |
| F, A | Frame selected / frame all |
| F1 / F2 (edit mode) / F3 (+Ctrl) | Front / right / top (back / bottom) views |
| Alt+X | X-ray |

Navigation: a left drag selects, Space+left-drag pans (Figma), Alt+left-drag orbits (Spline), right-drag
orbits, middle-drag pans, the wheel zooms. Trackpad: two-finger scroll pans, Shift+two-finger orbits, pinch
zooms.

Both presets ignore keys typed into inputs, text areas, selects and editable content, and let Space/Enter
activate a focused button. The shell suspends the router (`engine.input.suspend(key)`) while a dialog, the
palette or a popup menu is open.

## Operators

Object mode: `add.<primitive>` (cube, plane, circle, sphere, icosphere, cylinder, cone, torus, grid; parametric,
adjust in the panel), `add.menu`, `object.enter_edit`, `object.select_all/none/invert`, `object.delete`,
`object.duplicate`, `object.join`, `object.separate`, `object.hide`, `object.unhide_all`, `object.parent`,
`object.clear_parent`, `object.reset_position/rotation/scale`, `object.apply_transform`, `modelling.<op>` for the
remaining document commands (inset, bevel, solidify, mirror, array, extrude, weld, poke, wireframe, material,
light, lathe, sweep), `file.new/open/save/export_glb/export_obj/export_stl`, `edit.undo/redo/history/
repeat_last/repeat/rename/escape/keymap`.

Edit mode: `mesh.exit_edit`, `mesh.exit_discard`, `mesh.apply`, `mesh.select_mode_vertex/edge/face`,
`mesh.select_all/none/invert/linked/loop/ring`, `mesh.move/rotate/scale` (modal, or exact with props),
`mesh.extrude` (modal along the normal, or `{offset}`), `mesh.duplicate`, `mesh.split`, `mesh.merge`,
`mesh.dissolve` (Ctrl+X, `mesh.dissolve_mode`), `mesh.dissolve_verts/edges/faces` and `mesh.dissolve_limited`
with Blender's options, `mesh.fill` (F, `mesh.edge_face_add`: contextual create with edge-net fill and the
tricky-extend selection), `mesh.fill_grid` (span calculated from the loop on the first run, then adjustable),
`mesh.bridge_edge_loops` (twist, merge, cuts with the edge-ring interpolation), `mesh.vert_connect_path` (J),
`mesh.vert_connect`, `mesh.remove_doubles` (Merge by Distance), `mesh.vertices_menu/edges_menu/faces_menu`
(Ctrl+V/E/F), `mesh.inset`, `mesh.bevel`, `mesh.delete` (Blender's five delete types),
`mesh.separate`, `mesh.knife` and `mesh.bisect` (see [Cutting](#cutting)), `mesh.toggle_xray`, and the loop tools: `mesh.subdivide` (all of `bmo_subdivide.cc`: cuts,
smoothness, n-gons, quad corner type; fractal is not ported), `mesh.subdivide_edgering`
(`bmo_subdivide_edgering.cc`: linear, blend path, blend surface, profile shape), `mesh.loopcut_slide` (modal
with Ctrl+R; with props the cut through `_saved.edgeIndex` and then the slide, as the redo panel re-runs it),
`mesh.edge_slide` and `mesh.vert_slide` (modal, or exact with `{value, even, flipped, clamp}`). A slide reached
with `G G` from Move becomes the redo panel's operation as Edge Slide or Vertex Slide, as Blender switches the
operator's type; the panel keeps the first run's cursor and the E/F/C toggles so a redo matches what was on
screen (two deliberate deviations, see `@threepipe/plugin-mesh-edit`).

The shell adds `view.*` (frame, axis views, projection, grid, shading), `ui.command_palette` and `help.*`
through `engine.operators.register`.

## Tools

`select`; `object.move/rotate/scale` (the `TransformControlsPlugin` gizmo); `mesh.move/rotate/scale` and
`mesh.extrude` (one-shot: they start the modal and the shelf returns to Select when it ends - track T's element
gizmo replaces this); `mesh.inset` and `mesh.bevel` (interactive: run with defaults, drag sets the
thickness/width, the wheel changes bevel segments, click confirms, Esc cancels - each change is the redo-last
path, so the drag and the panel cannot disagree); `mesh.loop_cut` (Blender's Loop Cut tool: hover previews the
ring, press and drag cuts and slides, release places, and the tool stays for the next cut; Esc hands the shelf
back to Select); `mesh.knife` and `mesh.bisect` (sticky, as Blender's: see
[Cutting](#cutting)).

## Cutting

**Knife** - `mesh.knife` (K), the shelf's Knife tool. A port of Blender's knife (`editmesh_knife.cc`, in the
kernel's `src/ops/knife/`), checked against Blender's own modal knife on recorded input. Click points on the
surface; each click snaps to a vertex or an edge near the cursor, or lands on the face, and the line from the last
point previews where it will cut. Enter or Space applies the whole cut as one undo step; Esc throws it away.

| While cutting (Blender preset) | |
|---|---|
| LMB click / drag | add a point / cut freehand while dragging |
| Double-click | close the loop back to the first point |
| RMB, E | end this cut, start another (E is an addition; Blender has RMB only) |
| Ctrl+Z, Backspace | take back the last segment (Backspace is an addition) |
| Shift (hold) | snap to edge midpoints |
| Ctrl (hold) | no snapping |
| C | cut through to the faces behind |
| X / Y / Z | lock the cut to an axis (again: the object's axis; again: off) |
| A | angle snapping: screen, then relative to an edge, then off; type a number for the step |
| R | relative angle snapping: the next reference edge |
| S | measurements (the mode cycles; not drawn yet) |
| V | X-ray the preview |
| MMB | orbit without leaving the knife |

Shift+K starts it with cut-through on and only selected faces cut (Blender's Shift+K). With the Knife tool
active, the first click is already the first point (`wait_for_input=False`) and the tool stays active. The Design
preset uses Blender's Industry Compatible knife map instead: Ctrl snaps to midpoints, Shift turns snapping off,
Alt+drag orbits, D measures, and Space does not confirm.

**Bisect** - `mesh.bisect`, the shelf's Bisect tool. A port of Blender's `bmo_bisect_plane` /
`BM_mesh_bisect_plane` and `mesh_bisect_exec`. Select what to cut, then drag a line across it: the plane is the
one you see edge-on along that line (`mesh_bisect_interactive_calc`), and the cut previews while you drag. The
release runs the modelling document's `bisect` command once (one undo step) and selects the cut; the panel then
edits the plane point and normal, **Fill** (close the cut with a face), **Clear Inner** / **Clear Outer**
(remove one side) and the threshold. A click with the Bisect tool, without a drag, selects as usual. With a plane
given - `engine.run('mesh.bisect', {planeCo, planeNo, fill, clearOuter})` - it runs directly.

## Status hints

`engine.status` is what the status bar shows: a running modal's text and keys, else the active tool's hints,
else the mouse mapping of the preset plus the keys that matter most in the mode, read from the keymap.

## Tests

`npm run test:unit:editor-engine` - keymap parsing and presets, the router's dispatch rules, the history and
`undoTo`. The real-input tests (keys and mouse through Playwright: presets, menus, palette, redo-last, undo
across modes, context menus) are in `tests/interactive.spec.ts` under `modelling-editor`; the loop tools (edge
slide by `G G` with a typed factor, vertex slide, Subdivide from the Mesh menu, Subdivide Edge-Ring, Loop Cut and
Slide with one and three cuts, the Loop Cut tool, the redo panel and undo after each) under
`modelling-loop-tools`; the knife and bisect
ones under `modelling-editor-cut`.

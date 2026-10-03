# P1 — interaction engine (subplan of [10-editor-plan](./10-editor-plan.md))

**Status**: started 2026-10-03. P0 is done (`2c1dce3`, `4d44e3f`), the shell is merged (`98c33f3`), and so is
the Eiffel work (`a5ac8e3` via `modelling-tools`). Base for all P1 branches: `modelling-editor`.

## Where things live

```
@threepipe/mesh-kernel             topology + operators (Node-safe)
@threepipe/plugin-mesh-edit        edit-mode primitives: session, overlays, selection buffer, picking,
                                   element ops, modal transforms, gizmos, snapping       [tracks T, S]
@threepipe/plugin-modelling        document, commands + schemas, modifiers                [unchanged]
@threepipe/plugin-editor-engine    NEW, framework-free: implements EditorEngine           [track E]
                                   registries (operators, tools), keymaps + one input router, one
                                   history (UndoManagerPlugin) with labels, redo-last, status hints,
                                   object mode + edit mode operators, tools
@threepipe/plugin-modelling-editor the React shell; renders the engine                    [track E swaps it]
```

Decisions:

- **The engine is a separate package** because it composes three packages that must not depend on each
  other's internals (`mesh-edit` does not import `modelling`; core picking/transform are threepipe). No
  React in it: any threepipe app, and the agent API, gets the same behaviour.
- **The registry types move into the engine package** (`registry.ts` from the shell, unchanged in shape),
  and the shell imports them from there. `engine/legacyEngine.ts` is deleted when the engine lands.
- **One undo history**: `UndoManagerPlugin`'s `JSUndoManager`, with a label per step. `ModellingHistory`
  and mesh-edit both record through it; the shell's history list reads it.
- **One input router** owns `keydown` for the viewport, dispatches through a keymap (presets: Blender,
  and a Figma/trackpad "design" preset), and calls operators/tools. Plugins keep their own key handlers
  only as fallbacks behind a flag, so they still work standalone (examples, other apps).
- **Redo-last for every registered operator**: undo to the step before, `exec(newProps)`, record again
  (Blender `ED_undo_operator_repeat`). Mesh-edit operations become parametric — extrude stores its
  offset vector, transforms store value/axis/orientation — so they can be re-run with edited props.

## Tracks (parallel agents, own worktrees, merged into `modelling-editor`)

### E — engine (`plugins/editor-engine`, shell swap)
Registries; keymap + router + presets; operators for object mode (add/delete/duplicate/join/separate,
transform reset, visibility, parenting, export) and edit mode (select all/none/invert/linked/loop/ring,
extrude, inset, bevel, merge, split, delete menu, dissolve, subdivide, fill, separate) wrapping
`MeshEditPlugin` and `ModellingPlugin` commands; parametric mesh-edit ops; unified history; redo-last;
status hints; tools (select box/tweak, move/rotate/scale via track T's gizmos, extrude/inset/bevel
interactive); shell switched over; real-input e2e for keymaps and redo-last.

### T — transform and gizmos (`plugins/mesh-edit`: `transform.ts`, new `gizmo/`, `snap/`)
Transform maths ported from Blender `editors/transform/transform_mode_translate.cc`, `_rotate.cc`,
`_resize.cc` (rotation about the projected pivot, scale by distance ratio, axis/plane constraints,
`Shift` precision, numeric input incl. expressions); pivot (median, active, individual origins,
bounding box, 3D cursor) and orientation (global, local, normal, view); snapping (increment, grid,
vertex, edge, face, with target glyph) from `transform_snap*.cc`; proportional editing
(`transform_mode_*` + `proportional` falloffs); a combined gizmo (axis arrows, plane handles, rotation
rings, screen-space centre) for elements and for objects, driving the same transform backend.

### S — selection and overlays (`plugins/mesh-edit`: `select/`, `overlays*`)
Box, lasso and circle select on the selection buffer (`DRW_select_buffer_bitmap_from_rect/_poly/_circle`)
with Blender's modes (set/extend/subtract/difference/intersect) and the X-ray path; select-mode
conversion when switching (Blender `EDBM_selectmode_set`); loop/ring select on click (Alt+click,
Ctrl+Alt+click), shortest path (Ctrl+click), select more/less, linked under cursor (`L`); fat-line edges
(threepipe `LineSegments2`/`LineMaterial2`) with the overlay shader's flags; face dots in face mode;
theme sizes from Blender's theme; hidden elements (H / Alt+H).

## Coordination rules

- T and S both touch `MeshEditPlugin.ts`: keep changes there to wiring (a few lines per feature);
  put logic in their own modules. Rebase is not allowed; merge `modelling-editor` in when it moves.
- E is the only track that changes key handling. T and S expose public methods (`startTransform`,
  `boxSelect`, `setPivot`, ...) and keep the plugin's existing keys working as fallbacks.
- Every user-facing behaviour gets a real-input e2e test and a Mac GPU browser check before it is
  reported done. Ports cite Blender file:line.

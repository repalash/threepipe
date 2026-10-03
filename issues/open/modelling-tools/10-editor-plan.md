# Modelling editor — plan

**Status**: active, started 2026-10-03. Branch `modelling-editor` (off `modelling-tools`), worktree
`.repos/threepipe-editor`.

## Goal

Best-in-class modelling editor in the browser: Blender-level power, but productive in the first five
minutes for someone who has followed one Blender YouTube tutorial, or who knows Photoshop or Figma.
It needs all the UI: a gizmo-driven viewport, toolbar, outliner, properties, operator (redo-last) panel,
modifier stack, command search, context menus, status hints, onboarding. The same operators are also the
agent/scripting API, so a human and an AI agent drive one surface.

Everything here builds on the three packages already on this branch: `@threepipe/mesh-kernel` (BMesh
port), `@threepipe/plugin-mesh-edit` (edit mode) and `@threepipe/plugin-modelling` (command API,
document, undo, modifiers).

## Where we are — research

Research notes (gitignored scratch, to be copied into this folder as `research-editor-*.md`):

- `tmp/editor-research/repro.md` — real-browser repro of "can't even select the vertices".
- `tmp/editor-research/ux-audit.md` — newcomer audit of the current plugins, file:line, ranked.
- `tmp/editor-research/parts/blender.md` — Blender 2.8+ UX and the source mechanisms behind it.
- `tmp/editor-research/parts/other-tools.md` — Spline, Womp, SketchUp, Shapr3D, Plasticity, Nomad,
  Maya/Max, Figma/Penpot, web modellers; convergent patterns.
- `tmp/editor-research/parts/kokraf.md` — kokraf's UI code.
- `tmp/editor-research/blueprint-editor.md` — the existing threepipe editor app, architecture and options.
- Pending: Tinkercad and the 3D-printing web modellers.

### Why it is unusable today (confirmed)

1. Both examples preselect the mesh, and `ObjectPicker` cycles to the next hit when the selected object is
   clicked again, so the first click **deselects**; `Tab` then fails with a console-only warning.
2. Vertex/edge overlays use `vertexColors` on a near-black base colour, and three.js multiplies them, so
   **selected vertices render black** — a successful click shows no change.
3. Selection happens on `pointerdown`, on the canvas the orbit controls also use: **every orbit drag
   clears or replaces the selection**.
4. Picking ranks by 2D distance with no occlusion; **hidden back vertices win**, and a repeated click
   cycles away from the intended one.
5. Object-mode keys (`Picking`) stay live in edit mode: `Esc` exits and deselects, `Delete` can delete
   the **whole object**, `H`/`F`/`Ctrl+D` act on the object.
6. **No undo in edit mode.** No redo-last. Every mistake is permanent.
7. Primitives open as **triangles**, not quads, outside the modelling document.
8. No affordances: no mode buttons, toolbar, gizmo, hover highlight, status hints, grid, view gizmo.
9. Tests drive the plugin through `page.evaluate`; no test presses a key or clicks a vertex.

## Principles

- **One operator system.** Blender's model (`wmOperatorType`): an operator has an id, label,
  description, a property schema, `poll`, `exec(props)`, optional `invoke`/`modal` for interaction, and
  flags (`REGISTER`, `UNDO`). Toolbar buttons, menus, context menus, the command palette, keymaps, the
  redo panel and the agent API are all views onto the same registry. `plugin-modelling`'s commands
  already have schemas and validation; they become the `exec` side of operators.
- **Undo is a snapshot per confirmed operator**, as in Blender edit-mode undo (full mesh copy per step;
  structural sharing later). The redo-last panel is `pop undo; exec(newProps); push` (Blender
  `ED_undo_operator_repeat`).
- **Selection by GPU ID buffer**, as Blender does: occlusion for free, pixel tolerance, preselection on
  hover, the same buffer for box/lasso, and X-ray switches to projected tests.
- **Click selects, drag orbits or box-selects** — never both. Select on release under a drag threshold,
  as `ObjectPicker` already does for objects.
- **Visible over hidden.** Every hotkey has a button or menu entry that shows the hotkey. Modal states
  show their keys in a status strip. Errors appear on screen, not in the console.
- **Progressive disclosure.** Primitives stay parametric (adjust-last) until edited; object mode first,
  edit mode one double-click/Tab/button away; Blender keys for those who know them, a Figma/trackpad
  preset for those who don't.
- **Port, don't invent.** Interaction maths (transform, snapping, loop cut, knife) comes from Blender
  source; UI patterns follow the research.

## Architecture

```
@threepipe/mesh-kernel         topology + operators (Node-safe, exists)
@threepipe/plugin-modelling    document, commands = operator exec + schemas, undo snapshots, modifiers (exists)
@threepipe/plugin-mesh-edit    interaction engine (rework):
    operators/     registry, poll/invoke/exec/modal, redo-last, repeat-last
    input/         one input router: focus-aware, keymaps per mode + presets, click-vs-drag
    tools/         active tools (select box/lasso, move/rotate/scale gizmo, extrude, inset, bevel,
                   loop cut, knife, ...) each with a keymap and gizmo group
    select/        GPU ID-buffer picking, preselection, box/lasso, select-through
    overlays/      flag-driven overlay shader: verts/edges/faces/face dots, preselect, depth offset, x-ray
    gizmos/        element transform gizmo, pivot/orientation, snapping, numeric input
@threepipe/plugin-modelling-editor  (new) the app: React 18 + Blueprint 5 shell
    layout, header, toolbar, viewport, outliner, properties (uiConfig), operator panel, modifier stack,
    command palette, context menus, status bar, view gizmo, onboarding, keymap/navigation presets,
    agent panel
examples/modelling-editor      mounts the app
```

Decisions:

- **Shell: a new package in this repo** (option B of `blueprint-editor.md`), transplanting the
  blueprint editor's reusable parts — pane layout, DnD outliner, uiConfig inspector, context menus,
  theme, MCP client — and leaving its project/script/play-mode coupling behind. The existing app no
  longer builds (dangling `threepipe`/`uiconfig-blueprint` links) and has no mode/tool/keymap registries.
- **Engine stays framework-free.** Everything in `plugin-mesh-edit` and `plugin-modelling` works without
  React, so other threepipe apps (and the agent API) get the same behaviour; the shell only renders it.
- **Object mode belongs to the engine too.** Object selection, gizmo and keys go through the same router
  and operators, reusing threepipe's `PickingPlugin`, `TransformControlsPlugin` and `UndoManagerPlugin`
  where they fit, so the two modes cannot fight over keys again.

### Core threepipe changes (flagged; additive)

- `ObjectPicker`: an option to keep the selection when the selected object is clicked again (cycle only
  with a modifier, as in Blender's Alt+click). Default unchanged.
- Anything else found goes to `issues/open/` first.

## Phases

### P0 — make what exists usable (now)

Fix the audit's blocking items in `plugin-mesh-edit` and the examples, each with a **real-input** e2e
test (Playwright mouse/keyboard, plus a pixel check where it is visual):

1. Overlay colours: selected/active visibly orange/white; edges likewise.
2. Select on click-release under a drag threshold; orbit drags never touch the selection.
3. Occlusion-aware picking (interim: depth test against the surface; replaced by the ID buffer in P1);
   cycling only when the nearest element is already selected and the mouse has not moved.
4. Edit mode owns the keyboard: suspend `Picking`'s keys; `Esc` cancels, never exits; `Tab` only when the
   canvas has focus.
5. Entering edit mode: double-click a mesh, or a visible mode button; first click on a preselected mesh
   keeps it selected.
6. Edit-mode undo/redo (`Ctrl+Z`/`Ctrl+Shift+Z`), one snapshot per confirmed operator.
7. Workspace primitives through the modelling document, so a cube opens as 6 quads.
8. Hover preselection highlight; face dots in face mode.

### P1 — interaction engine

Operator registry and redo-last; input router and keymaps (Blender preset + Figma/trackpad preset);
active tools; GPU ID-buffer selection with box/lasso and select-through; overlay shader; element gizmo
(translate/rotate/scale with plane handles and screen-space centre); pivot (median/active/individual/
cursor) and orientation (global/local/normal); snapping (increment, vertex, edge, face, grid); transform
maths ported from Blender `transform_mode_*.cc` (rotation about the projected pivot, scale by distance
ratio); proportional editing; numeric input during and after a drag.

### P2 — editor shell

`plugin-modelling-editor` with the layout, header (mode switch, select-mode buttons, pivot/orientation/
snap popovers, shading/X-ray), left toolbar (tools with tooltips and shortcuts), right outliner +
properties (object, mesh data, modifiers, material via uiConfig), bottom-left operator panel, status
strip with modal hints, command palette (F3 / ⌘K, shows shortcuts, intent words), context menus per
select mode, view gizmo + numpad/ortho views, grid and axes, frame selected, toasts for errors, undo
history list, file new/open/save/export (glb, obj, stl).

### P3 — modelling depth

Loop cut and slide, knife, interactive bevel/inset/extrude variants, bridge edge loops, fill and grid
fill, spin, merge menu, separate/join, mirror editing and symmetry, shade smooth/flat and auto-smooth,
modifier stack UI with live preview, booleans (needs `manifold-3d` approval), primitives with
adjust-last parameters.

### P4 — first five minutes

Start scene with a primitive and hints; first-run choice of keymap/navigation preset with trackpad
detection; empty states that teach; Tinkercad-style workplane, rulers and snapping for 3D-print users;
units and dimensions; sample projects; tooltips that show the shortcut and a one-line "why".

### P5 — agent

Agent panel driving the same operators (`describeCommands()` → tools), with every agent step visible in
the undo history and reversible.

## Testing

- Every user-facing behaviour gets a real-input e2e test: keys and mouse through Playwright, state read
  afterwards, a screenshot or pixel check where the point is visual.
- Operators get unit tests in Node against the kernel.
- Checked in the Mac GPU browser before being called done.

## Work split

Foundational interfaces (operator registry, input router, undo) are designed in the parent session.
Implementation fans out to agents in their own worktrees/branches merged into `modelling-editor`, each
with a comm folder (`tmp/agent-comm/<name>/`). Parallel tracks once P0 lands: engine (P1), shell (P2),
modelling depth (P3). Agent work is reviewed and re-verified before merge.

## Log

- 2026-10-03: research done (see above); plan written; P0 started.
- 2026-10-03: P0 done (`2c1dce3`, real-input e2e `4d44e3f`). Shell (P2 first cut) merged (`98c33f3`).
  Eiffel build merged via `modelling-tools`. P1 split into tracks: [11-p1-interaction-engine](./11-p1-interaction-engine.md).

---
prev:
    text: '@threepipe/plugin-editor-engine'
    link: './plugin-editor-engine'

aside: false
---

# @threepipe/plugin-modelling-editor

The modelling editor shell: a React 18 + Blueprint 5 layout - header menus, Object/Edit mode switch,
vertex/edge/face buttons, tool shelf, viewport with view gizmo and grid, outliner, properties,
last-operation panel, status bar, command palette and context menus - rendered from operator and
tool registries, so every action is a button, a menu entry, a palette hit and a script call at once.

[Example](https://threepipe.org/examples/#modelling-editor/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/modelling-editor/src/index.ts)

```bash
npm i @threepipe/plugin-modelling-editor
```

```typescript
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'

const editor = createModellingEditor({container: document.getElementById('editor')!})
await editor.engine.run('add.cube')          // the same operator the Add menu runs
editor.engine.setMode('edit')                // Tab / the Edit button
editor.engine.operators.list()               // what the menus, palette and context menus show
editor.engine.tools.list()                   // what the tool shelf shows
```

## Registries

`src/registry.ts` defines what the shell renders from:

- `OperatorDescriptor` - `id`, `label`, `description`, `icon`, `shortcut` (display only; the engine
  owns the keymap), `category` (menu), `modes`, `contextMenu`, `props` (JSON schema, rendered as a
  form in the last-operation panel), `flags` (`undo`, `register`), `poll(ctx)` (false or a reason
  string disables with a tooltip) and `exec(ctx, props)`.
- `ToolDescriptor` - sticky tools for the tool shelf: `activate` / `deactivate`, `hints` for the
  status bar.
- `EditorEngine` - the object the shell talks to: the two registries, `mode`, `selectMode`,
  `activeTool`, `lastOperation`, `history`, `status`, `stats()`, `run(id, props)` and events
  (`modeChanged`, `selectionChanged`, `registryChanged`, `lastOperationChanged`, `message`, ...).

`LegacyEditorEngine` implements it over `MeshEditPlugin`, `ModellingPlugin` (every command from
`describeCommands()` becomes a `modelling.<op>` operator with its schema), `PickingPlugin`,
`TransformControlsPlugin` and `UndoManagerPlugin`. Pass `createEngine` to `createModellingEditor`
to use another engine.

## Layout

- Header: File / Edit / Add / Object / Mesh / Select / View / Help menus (grouped by operator
  `category`), Object/Edit switch, vertex/edge/face buttons in edit mode, pivot / orientation /
  snapping / proportional slots, shading, X-ray, grid and projection toggles.
- Left: the tool shelf, with tooltips showing name, shortcut and a one-line description.
- Centre: the viewport (`EditorViewWidgetPlugin` gizmo, `EditorViewportPlugin` grid and axes) and
  the floating last-operation panel.
- Right: outliner (drag-and-drop re-parenting, visibility, context menu, double-click to edit) over
  properties tabs (Object, Mesh, Modifiers, Material; uiConfig-driven).
- Bottom: status bar with mouse-button hints, modal keys and scene statistics.
- Overlays: command palette (`Ctrl/Cmd+K`, `F3`), toasts for errors and warnings, undo history,
  keyboard shortcuts and about dialogs.

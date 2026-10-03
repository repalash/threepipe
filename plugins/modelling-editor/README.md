# @threepipe/plugin-modelling-editor

The modelling editor shell for threepipe: a React 18 + Blueprint 5 application layout (header with
registry-driven menus, Object/Edit mode switch and select-mode buttons, left tool shelf, viewport,
outliner, properties tabs, last-operation panel, status bar, command palette, context menus,
toasts, view gizmo, grid) rendered from operator and tool registries.

Status: phase P2 of `issues/open/modelling-tools/10-editor-plan.md`, on the P1 interaction engine. The shell
renders `@threepipe/plugin-editor-engine` (`EditorEnginePlugin`): operator and tool registries, keymap presets
(Blender, Design), one labelled undo history with redo-last, status hints. Pass `createEngine` to
`createModellingEditor` to render another `EditorEngine`.

```bash
npm i @threepipe/plugin-modelling-editor
```

```ts
import {createModellingEditor} from '@threepipe/plugin-modelling-editor'

const editor = createModellingEditor({container: document.getElementById('editor')!})
await editor.engine.run('add.cube')
editor.engine.operators.list().map(op => op.id) // everything the menus, palette and toolbar show
```

See `examples/modelling-editor`, `examples/modelling-editor-engine` and the engine package's `src/registry.ts`
for the interfaces (`OperatorDescriptor`, `ToolDescriptor`, `EditorEngine`).

## Development

- `npm run typecheck` - type-check the package.
- `npm run build:dev` / `npm run dev` (watch) - bundle to `dist/`. React, Blueprint and
  uiconfig-blueprint are bundled; threepipe and the modelling plugins stay external.
- From the repo root: `npm run build:modelling-editor` then `npm run vite:modelling-editor` and open
  `/examples/modelling-editor/`. The examples dev server resolves this package from its `dist`
  (the examples config aliases `react` to esm.sh react@19 for the r3f samples, so the bundle carries its
  own React 18).

## Credits

The pane layout, drag-and-drop outliner tree (`ui/tree/*`, originally Palantir Blueprint's `Tree`),
uiconfig inspector wiring, context-menu provider, icon buttons and the viewport camera/grid/shading
plugin are adapted from `experiments/threepipe-blueprint-editor` (Kite 3D editor). Each file says
what it came from.

# @threepipe/plugin-editor-engine

The interaction engine behind the [threepipe](https://threepipe.org/) modelling editor, with no UI framework in it.

It composes three packages that must not depend on each other's internals - `@threepipe/plugin-mesh-edit` (edit mode),
`@threepipe/plugin-modelling` (document, commands, schemas) and threepipe's own picking, transform gizmo and undo
manager - into one surface: operator and tool registries, a keymap with presets and one input router, one undo
history with a label per step, redo-last, status hints and events. The React shell
(`@threepipe/plugin-modelling-editor`) only renders it; any other threepipe app, and the agent API, gets the same
behaviour.

```ts
import {EditorEnginePlugin} from '@threepipe/plugin-editor-engine'

const engine = viewer.addPluginSync(EditorEnginePlugin)
await engine.run('add.cube')                // the same operator the Add menu runs
engine.setMode('edit')                      // Tab
engine.keymap.setPreset('design')           // Figma/trackpad keys instead of Blender's
engine.operators.list().map(o => [o.id, o.shortcut])
engine.lastOperation?.redo({size: 2})       // adjust the last operation: undo, re-run, record again
```

See `website/package/plugin-editor-engine.md` for the API, the keymap presets and the operator list.

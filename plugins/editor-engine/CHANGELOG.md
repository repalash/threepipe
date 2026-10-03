# @threepipe/plugin-editor-engine Changelog

## 0.1.0

- Initial package. `EditorEnginePlugin`: operator and tool registries, keymap presets (Blender, Design) with
  one focus-aware input router, one labelled undo history on `UndoManagerPlugin` with redo-last
  (`ED_undo_operator_repeat`), status hints, object-mode and edit-mode operators over
  `@threepipe/plugin-modelling` commands and `@threepipe/plugin-mesh-edit`, and the registry types the
  modelling editor shell renders from.
- Loop tools: `mesh.subdivide`, `mesh.subdivide_edgering`, `mesh.loopcut_slide` (Ctrl+R) and the Loop Cut
  tool, `mesh.edge_slide` and `mesh.vert_slide` (Shift+V), each with its redo panel.

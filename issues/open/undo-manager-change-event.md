# `UndoManagerPlugin` / `JSUndoManager` have no change event

**Where**: `src/plugins/interaction/UndoManagerPlugin.ts`, `ts-browser-helpers` `JSUndoManager`.

`JSUndoManager` keeps `stack` and `sp` but dispatches nothing when they move. Anything that renders the
history (the modelling editor's Undo History dialog, the Edit menu's enabled state, the redo-last panel
that must disappear once its step is no longer the top of the stack) has to find out some other way.

Today `@threepipe/plugin-editor-engine`'s `EditorHistory` wraps `_record`, `undo`, `redo`, `reset`,
`replaceLast` and `setLimit` on the manager instance to fire its `historyChanged`, and puts the originals
back on dispose. It works and is contained in one file, but it reaches into the manager, and a second
consumer wrapping the same methods would stack wrappers.

**Proposal** (additive):

- `JSUndoManager` (ts-browser-helpers) dispatches `change: {action: 'record' | 'undo' | 'redo' | 'reset' | 'replace' | 'limit'}`.
- `UndoManagerPlugin` re-dispatches it as a plugin event (`historyChanged`), so `viewer.forPlugin('UndoManagerPlugin', ...)`
  consumers can subscribe without touching the manager.
- Optionally a `label?: string` on `JSUndoManagerCommand1`, since every step the editor records carries one
  and `UndoManagerPlugin.performAction` could accept it.

When that lands, `EditorHistory._wrap()` goes away.

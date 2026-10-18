# `UndoManagerPlugin`'s Ctrl+Z hotkeys act inside text fields and cannot be switched off

**Where**: `src/plugins/interaction/UndoManagerPlugin.ts` (`new JSUndoManager({bindHotKeys: true, hotKeyRoot: document})`),
`ts-browser-helpers` `JSUndoManager.bindHotKeys` / `_keyDown`.
**Found by**: flake-redo (2026-10-18), the `modelling-loop-tools` e2e flake
(`issues/open/modelling-tools/e2e-loop-tools-redo-panel-detached.md`).
**Severity**: medium. Any threepipe page with a text field: Ctrl+Z typed in the field undoes the scene.

## What happens

`JSUndoManager._keyDown` runs `undo()` on Ctrl/Cmd+Z, `redo()` on Ctrl/Cmd+Shift+Z or Ctrl+Y, for any
`keydown` that reaches the document, whatever its target. It does not skip inputs, textareas or
contenteditables, and the manager has no way to unbind it short of `dispose()` (which also clears the stack;
`_keyDown` is private).

So with the focus in a text field (a tweakpane or Blueprint number field, the modelling editor's redo panel,
its command palette, an outliner rename), Ctrl+Z undoes the last scene step, and the browser also performs its
own text undo on the same key. In the modelling editor this showed as: click a redo-panel label (the field gets
the focus), Ctrl+Z, and the operation behind the panel is undone, while Chrome's text undo can move the focus
into another field that had typing (the closing command palette's input), which then swallowed the next
shortcut (Ctrl+R).

Trace (CDP-throttled run, focus logged per event):

```
4804 focusin INPUT#me-prop-smoothness
4811 keydown KeyZ ctrl=true target=INPUT#me-prop-smoothness   <- the engine's router leaves it to the field
4813 lastOperationChanged null                                 <- but JSUndoManager undid the scene (no edit.undo run)
4832 historyChanged top=Add Cube
4838 focusin INPUT                                             <- the palette's input, by the browser's text undo
```

The editor's `InputRouter` already turns off `PickingPlugin.keyboardShortcuts` and `MeshEditPlugin.keyHandling`
while the engine routes keys; there is no such switch here.

## What the editor does now

`@threepipe/plugin-editor-engine`'s `InputRouter` stops a keymap-bound key that was typed into a form control on
`<html>`, in the bubble phase, after the control had it and before the document-level listeners
(`InputRouter.fieldKey`). That keeps Ctrl+Z / Ctrl+Shift+Z in a field away from `JSUndoManager`. Ctrl+Y is not
bound by the editor's presets, so it still reaches `JSUndoManager` (a redo from anywhere, including fields).

## Proposal

- `JSUndoManager` (ts-browser-helpers): `unbindHotKeys()`, and `_keyDown` skips targets that take typed text
  (input/textarea/select/contenteditable), as most hotkey libraries do.
- `UndoManagerPlugin`: a `hotKeys` flag (default true) that binds/unbinds them, like
  `PickingPlugin.keyboardShortcuts`. The editor engine then sets it false in `onAdded` alongside the other two
  and restores it in its disposers.

Needs the owner's approval (core + library API).

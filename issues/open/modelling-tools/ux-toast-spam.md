# The same toast stacks up: five copies of "Finish the current operation first"

Found by the `house-walkthrough` demo, 2026-10-16. Rank: **minor** once the inset/bevel drag is fixed
(it was the trigger: every mouse move posted one), **major** as a pattern.

## What happens

`EditorEnginePlugin.message()` posts every message as a new toast
(`plugins/modelling-editor/src/ui/ModellingEditorApp.tsx:115-123`, `AppToaster().show({...})` with no
`key`). A message repeated while it is still on screen stacks another copy; the demo saw five identical
"Finish the current operation first: click or Enter confirms it, Esc cancels" toasts covering the top
half of the viewport (`demos/house-walkthrough/shots/` from the first exploration, `s18.png` in the run
notes). The toasts are also centred over the viewport, where the model is.

## Expected

Blender reports in the status bar (`WM_report`, one line, replaced by the next); Figma shows one toast
at a time, bottom-centre. Blueprint's `OverlayToaster.show(props, key)` replaces a toast with the same
key.

## Suggested fix

Pass the message text (or level + text) as the toast key so a repeat refreshes the existing toast's
timeout instead of stacking, and place the toaster at the bottom (`position: Position.BOTTOM`) above
the status strip, off the model.

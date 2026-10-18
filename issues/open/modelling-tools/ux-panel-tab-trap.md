# Tab through the redo panel stops on a field label and stays there

Found by the `house-walkthrough` demo while writing the `modelling-editor-panel-keys` e2e, 2026-10-18.
Rank: **minor** (keyboard users only).

## What happens

In the Scale panel, click Value X and press Tab: focus goes to Y, then Z, then the "Orientation" label, and
every further Tab keeps it there. The labels are Blueprint `Tooltip` targets rendered as focusable
`label` elements (`plugins/modelling-editor/src/ui/PropsForm.tsx`, `Field`: `<Tooltip ...
targetTagName="label">`), and the tooltip that opens on focus appears to take the next Tab.

## Expected

Tab moves from control to control (Blender: Tab and Ctrl+Tab move between text fields while editing;
web forms: the next input).

## Suggested fix

Make the label tooltip target non-focusable (`targetProps={{tabIndex: -1}}` or the tooltip on hover
only), so Tab goes from one control to the next.

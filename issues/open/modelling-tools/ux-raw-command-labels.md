# Object-mode Mesh menu shows raw command names: "BridgeEdgeLoops", "ConnectVertices"

Found by the `house-walkthrough` demo, 2026-10-16. Rank: **minor** (looks unfinished; also doubles the
edit-mode entries under different names).

## What happens

Every `@threepipe/plugin-modelling` command is registered as an object-mode operator with its command
name capitalised as the label: `label: def.name.charAt(0).toUpperCase() + def.name.slice(1)`
(`plugins/editor-engine/src/ops/modellingOps.ts:60`). The Mesh menu therefore lists `BridgeEdgeLoops`,
`ConnectVertices`, `DissolveElements`, `DissolveLimited`, `GridFill`, `MakeEdgeFace`,
`MergeByDistance` next to the edit-mode `Bridge Edge Loops`, `Merge by Distance` and so on, and the
command palette shows both.

## Suggested fix

Split camelCase into words for the label (as `labelOf` in `PropsForm.tsx` already does for props) and
mark the object-mode command operators as "(whole object)" or move them to a submenu, so the palette
does not offer two "Bevel"s without saying how they differ.

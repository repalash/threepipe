# No zoom commands: nothing but framing zooms without a wheel

Found by the `house-walkthrough` demo, 2026-10-16. Rank: **major**.

## What a newcomer tries

- Blender users: Numpad +/- (`view3d.zoom`, km_view3d in `blender_default.py`), Ctrl+middle-drag, or
  View > Navigation > Zoom In / Out.
- Figma users: Ctrl/Cmd + and -, Shift+0/1/2 (zoom to 100% / fit / selection), or the zoom menu.
- Tinkercad: the + / - buttons under the view cube.

## What happens

None of these exist: the operator registry has `view.frame_all` and `view.frame_selected` but no zoom
(`plugins/modelling-editor/src/ops/viewOps.ts`; Blender preset
`plugins/editor-engine/src/keymap/presets/blender.ts:42-51`). With the wheel broken
([ux-wheel-zoom-dead](./ux-wheel-zoom-dead.md)) framing is the only zoom, and frame-selected zooms in as far
as it can.

## Suggested fix

`view.zoom_in` / `view.zoom_out` operators (OrbitControls `dollyIn`/`dollyOut`, as `view3d.zoom` steps
the distance), bound to Numpad +/- (Blender) and Ctrl+= / Ctrl+- (Design), listed in the View menu, and
+ / - buttons on the view gizmo for mouse-only users.

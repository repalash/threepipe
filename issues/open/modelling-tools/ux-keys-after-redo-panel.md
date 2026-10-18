# Keys stop reaching the viewport after using the redo panel until the viewport is clicked

Found during the 2026-10-16 GPU check (`tmp/browser-check/gpu-oct16.cjs`, bisect section).

## Repro

1. `examples/modelling-editor-cut`, Tab, A, Bisect tool, drag a cut.
2. In the redo panel tick Fill and Clear Outer.
3. Move the mouse over the viewport (no click) and press Numpad3.

Expected (Blender): the viewport takes keys when the pointer is over it, so Numpad3 switches to the
side view. Observed: nothing happens; the checkbox keeps focus. The e2e tests already work around it
with a click in the viewport before Ctrl+Z (`tests/interactive.spec.ts`, "modelling-editor-cut" step 9).

## Where

`plugins/editor-engine/src` input router: key events are routed by `document.activeElement`; Blender's
rule is the region under the pointer (`wm_event_system.cc`, `wm_handlers_do` on the hovered area). The
fix is to return focus to the viewport on `pointerenter` when the active element is a panel control
that is not being typed into (text inputs keep it until Enter/Escape/blur).

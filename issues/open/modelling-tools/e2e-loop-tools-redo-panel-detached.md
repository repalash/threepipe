# e2e `modelling-loop-tools`: the redo panel's Cuts field keeps detaching after `fill` (failed 1 of 3 runs)

**Found by**: demos-gpu (2026-10-18), `npm run test:e2e -- --grep modelling` on demos-gpu (cf6b8aa0 + demo commits;
no editor source changed there except `light {target}` in plugin-modelling, which this test does not use).
**Severity**: medium - a non-deterministic e2e failure, so a real bug somewhere (CLAUDE.md: never weaken the test).

## What happened

Full `--grep modelling` run: 15 passed, `modelling-loop-tools` failed with a timeout at
`tests/interactive.spec.ts:5129`:

```
Error: locator.press: Test timeout of 180000ms exceeded.
  - waiting for locator('[data-operator-panel="mesh.loopcut_slide"] #me-prop-cuts')
  - locator resolved to <input min="1" value="2" max="1000" type="text" id="me-prop-cuts" role="spinbutton" ...>
  - elementHandle.press("Enter")
  - element was detached from the DOM, retrying
```

`fill('2')` had landed (value="2"), then for the rest of the 180 s every attempt to press Enter found the input
detached: the operator panel was re-mounting its field over and over, not once. The retry could not run (an EACCES
writing the trace under test-results/, environment). Run alone twice right after, under the same browser lock, the
test passed both times (14.4 s, 13.6 s). The machine was loaded (another agent's GPU jobs and builds).

## Where to look

`plugins/modelling-editor/src/ui/PropsForm.tsx` `NumberField` commits on Enter or blur only, so typing alone should
not re-run the operator. Something else re-renders the operator panel continuously while the field holds an
uncommitted edit - a candidate is the panel re-keying on every engine state update (the loop-cut modal finishing,
or the viewport's hover/preview updates) - and a re-mounted field loses focus, which `onBlur={commit}` would then
commit, re-running the operator and re-rendering again. Reproduce by slowing the page (CPU throttling in CDP) on this
test.

## Second occurrence (19:55 UTC, same tree + demo commits)

`--grep modelling`: 15 passed, 1 flaky - `modelling-loop-tools` failed at the same step and passed on its retry. This
time the press landed but the edit did not: after `fill('2')` + Enter the counts stayed at the 3-cut result
`[20, 36, 18]` for 15 s instead of `[16, 28, 14]` (line 5130). Same symptom from the other side: the field the edit
was typed into is not the one that commits - the panel re-mounted between `fill` and Enter. 2 of 4 full runs today.
demos-gpu changes no editor UI code (its only plugin change is `light {target}` in plugin-modelling, unused here).

## A concrete candidate (read, not yet reproduced)

`OperatorPanel.tsx` renders the form inside `<Collapse isOpen={open} keepChildrenMounted={false}>`, and `open` is
derived from state set asynchronously by events: `autoOpenFor` (set in the `lastOperationChanged` handler from
`store.redoPanelOpen` at that moment) or `forcedFor`, or `store.redoPanelOpen`. Any render in which `open` is briefly
false unmounts the PropsForm, and the next render mounts a new input: exactly "detached, retrying" (first failure) and
"the typed value never commits" (second). The test opens the panel by clicking the title (`store.setRedoPanel`), while
the loop-cut operation that just finished also fires `lastOperationChanged` / `store.noteOperation()`; the order of the
two updates decides `open`. Next step: reproduce with CDP CPU throttling (`Emulation.setCPUThrottlingRate` 4-6x) on
this test, log `open` per render, then make `open` a single source of truth (or keep the children mounted).

## Root cause (flake-redo, 2026-10-18)

Reproduced with CDP `Emulation.setCPUThrottlingRate` (3-6x) on a copy of the test with per-event logging
(engine `run`/`lastOperationChanged`/`historyChanged`, focusin/focusout, keydown target and
`engine._redoing`, mousedown/click target, panel class, field mount/unmount, `HTMLElement.focus` stacks).
Three causes, two in the test and one in the editor; the candidates from the brief do not hold:

1. **The test closed the panel it was about to type into** (failures 1 and 2). The title is a toggle and
   the panel remembers that the user opened it (`OnboardingStore.setRedoPanel`): after the test's first
   title click (Edge Slide) every later panel opens by itself, so the clicks for Subdivide, Edge-Ring and
   Loop Cut alternately *closed*, opened, *closed* it. For Subdivide and Loop Cut the test typed into a
   `<Collapse>` that was closing (children stay mounted only for the ~200 ms transition):
   ```
   4663 mount INPUT#me-prop-cuts                     <- subdivide panel open by itself
   4904 panel class=me-operator-panel op=mesh.subdivide   <- the test's title click: me-open gone
   5001 focusin INPUT#me-prop-cuts                   <- fill() during the close transition
   5241 unmount INPUT#me-prop-cuts value=2           <- transition over
   ```
   On a fast machine fill + Enter fit in the transition; under load the field unmounted first: "element
   was detached" (reproduced at 6x: `locator.press ... #me-prop-cuts ... element was detached from the DOM,
   retrying` at the Subdivide step), or Enter went to the body after the unmount (the counts stayed).
2. **The test's "empty" click point was under the open redo panel.** `{x: vp.x + 40, y: vp.y + vp.height - 60}`
   is inside the panel (bottom-left, e.g. `panelRect=52,425,341,686`). Depending on the panel's height and
   how far its open transition had got, the click hit:
   `LABEL for=me-prop-flipped` (toggled Flipped: a stray re-run, `run> mesh.edge_slide {... "flipped":true}`),
   `LABEL for=me-prop-smoothness` / `me-prop-value` (focus into a text field), or nothing.
3. **Editor: Ctrl+Z typed in a text field undid the scene** (failure 3, and why 2 mostly went unnoticed).
   The engine's `InputRouter` correctly leaves keys typed into a field to the field, but `UndoManagerPlugin`
   binds `JSUndoManager`'s own Ctrl+Z on the document with no text-field check, so it undid the scene anyway
   (no `edit.undo` run in the trace, yet `historyChanged top=Add Cube`). The browser's own text undo on the same
   key could then move the focus into another field with typing - the command palette's input while its exit
   transition was still running - and the following Ctrl+R was typed into that input:
   ```
   4804 focusin INPUT#me-prop-smoothness             <- "empty" click on the Smoothness label
   4811 keydown KeyZ ctrl=true target=INPUT#me-prop-smoothness
   4813 lastOperationChanged null                    <- JSUndoManager's undo (counts back to the cube)
   4838 focusin INPUT                                <- palette input, by the browser's text undo
   4862 focusout INPUT -> CANVAS                     <- palette onExited returns focus; a Ctrl+R before this is lost
   ```
   Core issue filed: `issues/open/undo-manager-hotkeys-in-text-fields.md`.

Not the cause: (a) a second commit on blur after Enter - `NumberField`'s `pending` ref drops it, every Enter
gave exactly one `run>`; (b) a redo in flight when Ctrl+Z / Ctrl+R arrive - the loop/subdivide `exec`s are
synchronous, and no keydown in any trace arrived with `_redoing` true; (d) `open` flipping across renders -
the panel class changed only on the test's own title clicks.

## Fix

- `editor-engine` `InputRouter` (c2a82c03): a keymap-bound key typed into a form control is stopped on
  `<html>` on its way up, after the field had it, before document-level listeners (`fieldKey`). Ctrl+Z in a
  field is the field's, as in Blender's text editing. Unit test in `tests/inputRouter.test.ts`.
- `modelling-loop-tools` (e222ce9d): the first title click opens the panel (asserted closed before, open
  after); later panels are asserted open instead of clicked; the empty point is bottom-right and asserted to be
  the canvas at every click; a Ctrl+Z-in-a-field step (fails without the engine fix: counts went to
  `[8, 12, 6]`); the Ctrl+R poll's failure prints the focus at the key, the focus now and the state; the
  whole sequence runs a second time after a reload with the CPU throttled 6x.
- `modelling-editor-fill` / `modelling-editor-engine` (9e4bb14b): the same bottom-left "empty" click; fill
  passed only because its click focused a panel field and JSUndoManager's Ctrl+Z reached the scene. Now
  bottom-right, asserted.

Also seen, not verified or fixed: the panel title's `onMouseDown` preventDefault keeps the focus in a field, so
collapsing the panel while a field holds a typed, uncommitted value probably drops the value with the field (its
commit is on blur, and an unmounted field may get no blur). Blender applies a text edit on a click outside it.

## Verification

- `modelling-loop-tools` alone: passes (24 s, both passes). With the `InputRouter` listener commented out (dist
  rebuilt): fails at the Ctrl+Z-in-a-field step, counts `[8, 12, 6]` instead of `[16, 28, 14]`.
- Full `--grep "modelling|mesh-edit" --workers=1 --retries=0`: before the fill/engine test fix, 17 passed and
  `modelling-editor-fill` failed at its bottom-left click + Ctrl+Z (cause 2 + 3 above). After 9e4bb14b, three
  runs in a row: 18 passed, 18 passed, 18 passed (3.9 min each).
- `npm run typecheck:plugins` clean; editor-engine `npm test` 67/67. modelling-editor has no unit tests.

Ready to move to `issues/closed` once the core issue (`undo-manager-hotkeys-in-text-fields.md`) is decided.

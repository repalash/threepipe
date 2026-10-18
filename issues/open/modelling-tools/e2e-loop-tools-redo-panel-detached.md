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

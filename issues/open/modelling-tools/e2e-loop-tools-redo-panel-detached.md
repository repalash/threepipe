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

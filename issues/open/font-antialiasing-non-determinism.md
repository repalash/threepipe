# Font/antialiasing rendering is non-deterministic across runs

**Created:** 2026-03-27
**Status:** Open
**Discovered via:** E2E test `camera-uiconfig` — intermittent screenshot diff in tweakpane UI text

## Problem

Tweakpane UI text renders with slightly different font antialiasing between runs on the same machine. The 3D canvas content is identical, but the UI overlay text (numbers, labels) has sub-pixel differences that exceed the `maxDiffPixelRatio: 0.003` threshold.

This affects any test that includes tweakpane UI panels in the screenshot.

## Workaround

`retries: 1` in playwright.config.ts — if the first run has a font rendering diff, the retry usually matches.

## Investigation needed

- Is this a Chrome font cache issue?
- Does `await document.fonts.ready` before screenshot help?
- Would masking the UI panel region in screenshots avoid the issue?
- Does increasing `maxDiffPixelRatio` to 0.005 eliminate it without losing sensitivity?

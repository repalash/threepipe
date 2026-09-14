# Test Audit — chromium-darwin First Run (2026-03-28)

**193 tests | 180 passed | 12 failed | 1 flaky**

## Failed Tests by Category

### Screenshot instability — never stabilized (6)
These have progressive/noisy rendering that Playwright can't get two stable screenshots of:
- `advanced-ground-plugin` — continuously animating ground shader
- `clear-reimport-test-2` — uuid-already-registered warnings, non-deterministic state
- `fat-lines-ssr` — SSR jitter
- `reimport-duplicate-test` — same as clear-reimport-test-2
- `ssgi-plugin` — SSGI is inherently noisy/progressive (already in excluded list? should be)
- `ssgi-ssr-plugin` — SSGI+SSR combined

### _testFinish timeout (4)
- `flickity-carousel` — loads threepipe from unpkg, no _testFinish
- `html-js-sample` — plain HTML/JS, no _testFinish
- `troika-text-plane` — esm.sh returned empty MIME for troika-three-text module
- `troika-text-shadow` — same MIME issue

### Test code error (1)
- `picking-plugin` — stale build (three.BoxGeometry reference), fixed in current code

### Non-deterministic rendering (1)
- `three-gpu-pathtracer` — 12% pixel diff, inherently non-deterministic

## Tests with Page Errors (passed but have real bugs)
- `cascaded-shadows-plugin-basic` — `Cannot read properties of undefined (reading 'shadow')` (tracked in issues/open)
- `hdr-to-exr` — EXR export broken: `Cannot read properties of undefined (reading 'length')`

## Recurring Warnings
- `No material template found for PointsMaterial` — in assimpjs, extra-importers, gltf-mesh-lines, pnts-load
- `depth-buffer-plugin` — 255x GL_INVALID_OPERATION (shader output mismatch)

## Tests to exclude (should never pass deterministically)
ssgi-plugin, ssgi-ssr-plugin, three-gpu-pathtracer — inherently non-deterministic rendering
flickity-carousel, html-js-sample — no _testFinish signal

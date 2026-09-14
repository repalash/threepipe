# setRenderSize/setSize: render size round-trips through CSS layout and loses pixels (2500 requested → 2498 exported)

**Severity:** high
**Found:** 2026-08-11 external size-issues report (share.ijewel.info/threepipe-size-issues), verified against source at `0641fb7`

## Bug
The requested render size is never stored. `setSize` writes CSS only, the render loop reads the size back from the DOM as `clientWidth`/`clientHeight`, and three.js floors `width * pixelRatio`. Two roundings, and the multiply amplifies the first one, so an explicit `setRenderSize({width: 2500, height: 2500})` can produce a 2498×2498 buffer.

## Root Cause
- `src/viewer/ThreeViewer.ts:1097-1105` — `setSize` writes only `canvas.style.width/height`; no field stores the request (TODOs at L1107-1108 acknowledge this: `// todo make a constructor parameter for renderSize`).
- `src/viewer/ThreeViewer.ts:823` — the resize path re-reads `Math.floor(clientWidth)/Math.floor(clientHeight)` from the DOM; three.js then does `canvas.width = Math.floor(width * pixelRatio)` (`WebGLRenderer.js:414-415`).
- `src/viewer/ThreeViewer.ts:1137-1198` — `setRenderSize` computes a fractional CSS fit (`renderHeight = containerHeight * aspect`), writes it as fractional CSS px, and derives `renderScale = dpr * height / renderHeight` (L1197) from the **unfloored** value — but the buffer is later computed from the **rounded** `clientHeight`. Note `renderScale` is derived from height only; a fractional `renderWidth` compounds the error on the X axis.

Concrete trace — request 2500×2500, `mode: 'contain'`, dpr 1, container 1200×800.33:

| step | value |
|---|---|
| `renderHeight = containerHeight * aspect` | 800.33 |
| `canvas.style.height = '800.33px'` | fractional CSS |
| `clientHeight` readback | **800** (rounding #1) |
| `renderScale = 2500 / 800.33` | 3.123712… (computed for 800.33, not 800) |
| `canvas.height = floor(800 × 3.123712)` (three) | **2498** (rounding #2) |

When the container height happens to be an integer the same math gives exactly 2500 — the bug looks intermittent.

Related contributors:
- `ThreeViewer.ts:1094` doc recommends `max-width: 100%` on the canvas — that silently clamps a larger CSS request with no warning; the export is then far smaller than requested.
- `src/rendering/RenderManager.ts:161` — constructor seeds `_renderSize` from `clientWidth/clientHeight` — 0×0 when the canvas is not laid out yet.
- `ThreeViewer.ts:1141` — `// todo what about container resize?`: the `ResizeObserver` (L433) only calls `resize()`, which re-reads the DOM; it never recomputes the fit, so the compensating `renderScale` goes stale on container resize.
- No assertion anywhere that the achieved `canvas.width` equals the request (only the 0.1-epsilon no-op guard at `RenderManager.ts:213-220`).

## Impact
High-res exports and any explicit render-size request can silently come out up to several pixels short, depending on fractional container layout. Downstream, everything derived from `renderScale` (SSAA jitter, sizeMultiplier targets — see related issues) inherits the fractional scale.

## Fix
Store the requested integers and stop deriving the buffer from the DOM while an explicit render size is active (same model as PlayCanvas `RESOLUTION_FIXED`; the resize handler reads `clientWidth` only in AUTO mode). Compute `renderScale` from the same integer the loop will use. CSS keeps the fitted rect for display only. After resize, verify `canvas.width === expected` and warn once. Prior art: three.js and Babylon never read the DOM in the engine; PlayCanvas gates the readback behind a stored resolution mode.

## Files
- `src/viewer/ThreeViewer.ts:1097-1105` — `setSize` CSS-only, request not stored
- `src/viewer/ThreeViewer.ts:823,838` — DOM readback + floor feeding `renderManager.setSize`
- `src/viewer/ThreeViewer.ts:1137-1198` — `setRenderSize` fit math; `renderScale` from unfloored height at L1197
- `src/rendering/RenderManager.ts:161` — `_renderSize` seeded from `clientWidth/clientHeight`

## Related
- `size-canvassnapshot-displaypixelratio-overrides-renderscale.md` (export path defeats the computed renderScale entirely)
- `size-no-single-render-size-authority.md` (consumers disagree on which size to use)
- `size-hygiene-sizemultiplier-epsilon-odd-buffers.md`

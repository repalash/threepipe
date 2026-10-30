---
prev:
    text: 'GeometryUVPreviewPlugin'
    link: './GeometryUVPreviewPlugin'

next:
    text: 'TailwindCSSCDNPlugin'
    link: './TailwindCSSCDNPlugin'

---

# PerfPanelPlugin

[Example](https://threepipe.org/examples/#perf-panel-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/ui/PerfPanelPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/PerfPanelPlugin.html)

PerfPanelPlugin shows a small performance panel over the canvas, in plain DOM. It starts as a pill like `60 fps` with a status dot (green from 50 fps, amber from 25 fps, red below). An amber dot on the corner of the pill shows that a warning is on. A click on the pill opens the card, and a click on the card header collapses it again.

The card shows:
- A sparkline of the frame times of the last 3 seconds. Accent bars are frames that rendered, grey bars are idle frames, red bars are slower than 50 ms. Lines mark 16.7 ms and 33.3 ms.
- Frame ms: the time between frames over the last second (average, 95th percentile, maximum).
- Render CPU: the CPU time of a render, from the viewer `preRender` to `postRender` event. The GPU works after it, in parallel.
- Renders/s: the renders in the last second, and the progressive frame (`frame 12/32`) while `ProgressivePlugin` converges. 0 is normal for a still scene: the viewer renders only when something changes.
- Draws · tris: the draw calls and triangles of the last render, summed over all its passes (shadows, scene, effects, screen).
- Canvas: the size in CSS pixels, the render scale and the device pixel ratio.
- GPU: the renderer name from WebGL, where the browser shows it.
- JS heap: used and limit (Chrome only).
- The warnings.

```typescript
import {ThreeViewer, PerfPanelPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const perf = viewer.addPluginSync(new PerfPanelPlugin({
    position: 'bottom-right', // 'top-left' | 'top-right' | 'bottom-left' (default) | 'bottom-right'
    collapsed: true, // start as the pill (default)
    theme: 'light', // or 'dark'. With the tweakpane UI on the page, the panel takes its theme colours
    // container: element, // default: viewer.container. It must be positioned (e.g. position: relative)
}))

perf.collapsed = false // open the card
perf.position = 'top-left'
perf.enabled = false // hide the panel and stop measuring

// the numbers in code, 4 times per second
perf.addEventListener('update', ({stats}) => {
    console.log(stats.fps, stats.frameP95, stats.drawCalls, stats.warnings.map(w => w.id))
})
```

## Stats

`perf.stats` (type `PerfStats`) is updated in place 4 times per second while the panel measures:

| Field | Meaning |
|---|---|
| `fps` | Animation frame rate over the last second |
| `refreshRate` | The fastest steady rate seen at a common display rate (24 to 240 Hz), 0 until known |
| `frameAvg`, `frameP95`, `frameMax` | Frame interval in ms over the last second |
| `renderAvg`, `renderMax` | CPU time of a render in ms, over the frames that rendered in the last second |
| `rendersPerSecond` | Renders in the last second |
| `drawCalls`, `triangles` | Of the last render, over all its passes |
| `gpu` | GPU name, `''` when the browser hides it |
| `warnings` | `PerfWarning[]`: `{id, text, hint?}`, the most important first |

## Warnings

| `id` | When |
|---|---|
| `capped` | Idle frames (nothing rendered) come at a steady ~33 ms, or clearly slower than the display rate seen before (below 60 % of it). An idle frame costs almost nothing, so a heavy scene cannot cause this: a power saver caps the frame rate (Chrome Energy Saver, Safari / iOS Low Power Mode). No browser API tells about the cap, so the panel detects it this way. The hint shows `chrome://settings/performance`, which a click copies (a page cannot open `chrome://` links). |
| `maybe-capped` | The viewer renders at a steady ~30 fps with a light CPU part, and no idle frames were seen yet. It can be a cap or the GPU. Keep the scene still for 2 s to know. |
| `cpu-bound` | The viewer renders most frames, the frames are slower than 1.25 × the frame budget (the frame time of the display rate, 60 Hz while it is unknown, or of the cap), and the render CPU time is at least 60 % of the frame time. |
| `gpu-bound` | The same, with a smaller CPU part. |
| `battery` | `navigator.getBattery()` reports that the device does not charge. Chrome Energy Saver can turn on when unplugged. |
| `software` | The GPU name is a software renderer (SwiftShader, llvmpipe, softpipe, Microsoft Basic Render Driver). |
| `hidden` | The tab is hidden. A hidden tab gets no animation frames, so the panel stops measuring until it shows again. |

## How it measures

- It runs its own `requestAnimationFrame` loop while it is added, enabled and the tab is visible. It never calls `setDirty`, so an idle viewer stays idle.
- The render time and the renders come from the viewer `preRender` and `postRender` events.
- The draw calls and triangles: `renderer.info` resets on each `renderer.render()` call, so it holds only the last pass. The plugin wraps `renderer.info.update` while it is added, and counts every draw between `preRender` and `postRender`. `onRemove` restores it.
- `enabled = false`, `disable(key)` and a hidden tab stop the loop and the counting of renders and draws (the `renderer.info.update` wrap then only passes the call on). `onRemove` also removes the element, its stylesheet and all listeners.

The plugin is not saved with the viewer config (`serializeWithViewer = false`). It imports no other plugin: it finds `ProgressivePlugin` with `viewer.getPlugin('ProgressivePlugin')`, so an import of it adds nothing else to a bundle.

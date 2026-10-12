# @threepipe/plugin-canvas-recorder

Canvas recorder plugin for [threepipe](https://threepipe.org/). Records the viewer canvas into a video file or an image sequence, in the browser.

- **Frame-exact video** (default): every rendered frame is captured right after the render and encoded with WebCodecs (H.264, or VP9/AV1 when H.264 is not available) into an MP4 file. The scene time advances by exactly `1 / fps` per frame, so the video is smooth at the set frame rate, independent of how long a frame takes to render or encode.
- **Image sequence**: the same frame-exact capture, saved as PNG, JPEG or WebP frames in a zip file or a folder (File System Access API).
- **Real-time fallback**: `MediaRecorder` over `canvas.captureStream()` for browsers without WebCodecs.
- Optional per-frame convergence with `ProgressivePlugin` (off by default), camera turntables, per-frame callbacks, progress events and a UI config.

```typescript
import {ThreeViewer} from 'threepipe'
import {CanvasRecorderPlugin} from '@threepipe/plugin-canvas-recorder'

const viewer = new ThreeViewer({...})
const recorder = viewer.addPluginSync(CanvasRecorderPlugin)
const blob = await recorder.recordDuration(5, {fps: 60}) // downloads recording.mp4
```

[Github](https://github.com/repalash/threepipe/tree/dev/plugins/canvas-recorder) &mdash;
[Example](https://threepipe.org/examples/#canvas-recorder-plugin) &mdash;
[API Reference](https://threepipe.org/plugins/canvas-recorder/docs/)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-canvas-recorder.svg)](https://www.npmjs.com/package/@threepipe/plugin-canvas-recorder)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-green.svg)](https://opensource.org/license/apache-2-0/)

**Documentation and Guides**: [threepipe.org/package/plugin-canvas-recorder](https://threepipe.org/package/plugin-canvas-recorder.html)

Bundles [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT) for MP4 muxing, see `dist/dependencies.txt`.

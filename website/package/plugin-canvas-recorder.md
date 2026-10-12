---
prev:
  text: '@threepipe/plugin-troika-text'
  link: './plugin-troika-text'

next: false

aside: false
---

# @threepipe/plugin-canvas-recorder

Records the viewer canvas into a video file or an image sequence, in the browser.

[Example](https://threepipe.org/examples/#canvas-recorder-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/canvas-recorder/src/CanvasRecorderPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/canvas-recorder/docs/classes/CanvasRecorderPlugin.html)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-canvas-recorder.svg)](https://www.npmjs.com/package/@threepipe/plugin-canvas-recorder)

```bash
npm install @threepipe/plugin-canvas-recorder
```

<iframe src="https://threepipe.org/examples/canvas-recorder-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Canvas Recorder Plugin Example"></iframe>

`CanvasRecorderPlugin` has three modes:

| Mode | How | Result | Time |
|---|---|---|---|
| `video` (default) | WebCodecs `VideoEncoder`, every rendered frame | MP4 (H.264, or VP9/AV1 when H.264 is not available) | Frame-exact: the scene time advances by exactly `1 / fps` per frame |
| `images` | `canvas.toBlob`, every rendered frame | PNG, JPEG or WebP frames in a zip file or a folder | Frame-exact |
| `realtime` | `MediaRecorder` over `canvas.captureStream()` | WebM or MP4, as the browser supports | Real time (wall clock), frames are dropped when the render is slow |

## Why frame-exact

`MediaRecorder` records the canvas in real time while it renders. The encoder runs at the same time as the render, so it slows down the render, and every slow frame shows as a dropped or repeated frame in the video.
In a test on an Apple M4 Pro (Chrome, 1080p), `MediaRecorder` with VP8/VP9 cut the render from about 80 fps to about 40 fps, and `MediaRecorder` with `video/mp4;codecs=avc1` delivered almost no frames from the WebGL canvas (0.2 Mbit/s).

In the frame-exact modes, the recorder controls the scene time instead:

1. Each frame is rendered as usual.
2. Right after the render (in the viewer `postFrame` event), the canvas is captured as a `VideoFrame` with the timestamp `frame / fps`, and given to a `VideoEncoder` (or encoded as an image).
3. The scene time advances by exactly `1 / fps` for the next frame, through `viewer.timeline.recordingDeltaProvider`.

The result plays smoothly at the set frame rate, independent of how long a frame takes to render or encode. A slow machine takes longer to record, the video is the same.
When the encoder falls behind, the viewer pauses until the encoder catches up (see `maxPendingFrames`).

These follow the fixed time step: `viewer.timeline` and the animations driven by it when it runs (like `AnimationObjectPlugin`), animations in `PopmotionPlugin` (and the plugins that use it, like `CameraViewPlugin` and `TransformAnimationPlugin`), `GLTFAnimationPlugin`, and the camera controls.
Code that reads the wall clock directly (`performance.now()`, `Date.now()`, CSS animations, HTML video elements) does not follow it.

## Usage

```typescript
import {ThreeViewer, PopmotionPlugin} from 'threepipe'
import {CanvasRecorderPlugin} from '@threepipe/plugin-canvas-recorder'

const viewer = new ThreeViewer({...})
const recorder = viewer.addPluginSync(CanvasRecorderPlugin)

// Record 5 seconds at 60 fps, frame-exact. Downloads recording.mp4 (autoDownload is on by default)
const blob = await recorder.recordDuration(5, {fps: 60})

// Update the scene for every frame
await recorder.recordDuration(4, {
    fps: 30,
    onFrame: ({frame, time}) => {
        object.rotation.y = time * Math.PI / 2
        object.setDirty()
    },
})

// Record while an animation runs. One more frame is captured after it ends, so the end state is in the video.
const popmotion = viewer.getPlugin(PopmotionPlugin)!
await recorder.record(() => popmotion.animate({
    from: 0, to: 1, duration: 2000,
    onUpdate: (v) => {/* ... */},
}).promise)

// Camera turntable around the target
await recorder.recordTurntable({duration: 6, angle: 360})

// Start and stop manually
await recorder.startRecording({mode: 'video', fps: 60, bitrate: 20e6})
// ...
const result = await recorder.stopRecording() // or recorder.cancelRecording()
```

Options that are not passed to a record function use the plugin properties (`mode`, `frameRate`, `videoCodec`, `videoBitrate`, `imageFormat`, `convergeMode`, `autoDownload`, `filename`, ...), which are also in the UI:

```typescript
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
ui.setupPluginUi(CanvasRecorderPlugin)
```

### Events

```typescript
recorder.addEventListener('start', (e) => console.log(e.mode, e.width, e.height, e.fps, e.codec))
recorder.addEventListener('progress', (e) => console.log(e.frame, e.frames, e.time, e.progress))
recorder.addEventListener('stop', (e) => console.log(e.blob, e.cancelled, e.frames))
recorder.addEventListener('error', (e) => console.error(e.error))
```

## Video (WebCodecs)

The default codec is `auto`: H.264 (`avc`) when the browser can encode it, then VP9, then AV1. All are written into an MP4 file with [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT, bundled).
The codec string is computed from the frame size and the frame rate, like `avc1.64002A` (High profile, level 4.2) for 1080p at 60 fps. Set `codecString` for a different profile or for H.265 (`hvc1...`).

| Option | Default | |
|---|---|---|
| `videoCodec` | `'auto'` | `'auto'`, `'avc'`, `'vp9'` or `'av1'` |
| `codecString` | computed | full WebCodecs codec string, overrides `videoCodec` |
| `bitrate` | about 0.12 bit per pixel per frame (15 Mbit/s for 1080p60) | bits per second |
| `keyFrameInterval` | `2` | seconds between key frames |
| `hardwareAcceleration` | `'prefer-hardware'` | falls back to `'no-preference'` when no hardware encoder is available |
| `fallbackToRealtime` | `true` | record in the `realtime` mode when no WebCodecs encoder is available |

The video has the size of the canvas drawing buffer (CSS size × `renderScale`). Odd sizes are cropped by one pixel to an even size. Set the canvas size before the recording for a specific resolution.

WebCodecs needs a secure context (https or localhost). Check with `CanvasRecorderPlugin.IsWebCodecsSupported()`, or `findVideoEncoderConfig(...)` for a codec and a size.

## Image sequence

```typescript
// zip download: recording.zip with frame_000000.png, frame_000001.png, ...
await recorder.recordDuration(2, {mode: 'images', fps: 30, imageFormat: 'image/png'})

// write the frames into a folder (File System Access API, Chrome and Edge)
button.onclick = async() => {
    await recorder.pickDirectory() // needs a user gesture
    await recorder.recordDuration(10, {mode: 'images', imageDestination: 'directory', imageFormat: 'image/jpeg', imageQuality: 0.9})
}
```

The frames are stored in the zip without compression, since PNG, JPEG and WebP are compressed already. The zip is kept in memory until the recording stops: use a folder for long sequences.

## Real-time (MediaRecorder)

`mode: 'realtime'` records with `MediaRecorder` over `canvas.captureStream(fps)`. It is the fallback for browsers without WebCodecs.
The scene time follows the wall clock, so the result shows what was on the screen, including slow frames. The mime type is the first supported one of `video/webm;codecs=vp9`, `video/webm;codecs=vp8`, `video/webm`, `video/mp4;codecs=avc1`, `video/mp4`.
Chrome does not write the duration into WebM files from `MediaRecorder`, some players show no duration for them.

## Convergence (off by default)

With `convergeMode` (or `converge: true` in the options), the scene time is held until `convergeFrames` progressive frames are accumulated by `ProgressivePlugin`, and only then the frame is captured.

```typescript
viewer.addPluginSync(ProgressivePlugin)
await recorder.recordTurntable({duration: 6, converge: true, convergeFrames: 32})
```

::: warning Converged frames hide temporal artifacts
Each captured frame is the converged result of many progressive frames: noise, flicker, aliasing and the ghosting or lag of temporal effects (like TAA or temporal GI) are averaged out.
This is right for turntables and product shots of static scenes. It is wrong for showing the real-time quality of the renderer in motion: record without convergence for that.
:::

## Timeline

Animations driven by `viewer.timeline` (like `AnimationObjectPlugin` animations and camera views on the timeline) only advance while the timeline runs.
Set `startTimeline: true` to start the timeline with the recording (it is stopped again at the end, if it was not running before).

The fixed time step is a general hook of the timeline, so other recorders and offline renderers can use it:

```typescript
viewer.timeline.recordingDeltaProvider = () => 1 / 60 // advance 1/60 s per frame, 0 to hold, -1 for real time
// ...
viewer.timeline.recordingDeltaProvider = undefined
```

Plugins that animate on their own can read the step with `viewer.timeline.recordingDelta()`.

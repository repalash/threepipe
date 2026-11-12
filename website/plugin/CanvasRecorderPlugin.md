---
prev:
    text: 'CanvasSnapshotPlugin'
    link: './CanvasSnapshotPlugin'

next:
    text: 'AssetExporterPlugin'
    link: './AssetExporterPlugin'

---

# CanvasRecorderPlugin

[Example](https://threepipe.org/examples/#canvas-recorder-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/export/CanvasRecorderPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/CanvasRecorderPlugin.html)

Canvas Recorder Plugin records the viewer canvas to a video or to an image sequence. Set `mimeType` to choose the recorder:

| `mimeType` | Recorder | Output |
|---|---|---|
| `'video/mp4'` (default) | [FFMPEGRecorder](https://threepipe.org/docs/classes/FFMPEGRecorder.html) | H.264 MP4, encoded with ffmpeg.js in a worker |
| `'auto'` | [CanvasMediaRecorder](https://threepipe.org/docs/classes/CanvasMediaRecorder.html) | The browser's `MediaRecorder` picks the format (WebM or MP4) |
| `'image/png'`, `'image/jpeg'`, `'image/webp'` | [ImageSequenceRecorder](https://threepipe.org/docs/classes/ImageSequenceRecorder.html) | One file per frame, written to a folder that the user picks (`showDirectoryPicker`) |

**Converge mode** (`convergeMode`, on by default) records frame by frame instead of in real time. A frame is captured only after the [ProgressivePlugin](./ProgressivePlugin) converges, and the animations step by `1 / videoFrameRate` seconds per captured frame, with [ProgressivePlugin.postFrameConvergedRecordingDelta](https://threepipe.org/docs/classes/ProgressivePlugin.html#postframeconvergedrecordingdelta). [PopmotionPlugin](./PopmotionPlugin), [GLTFAnimationPlugin](./GLTFAnimationPlugin) and the viewer timeline follow it. So the video plays at the full frame rate with converged frames, also when one frame takes long to render. Without the ProgressivePlugin, every frame counts as converged.

While the scene does not change (a pause), the animations still step, and each step captures the last frame again. A wait in an action uses `waitRecordingTime(ms)`: in a converge-mode recording it waits for the frames of that time in the video (a scene that does not converge waits the rest on the wall clock), else for the wall time. The end padding (`endPaddingMs`) and the pause between camera views of `CameraViewPlugin` use it. The browser recorder (`MediaRecorder`) records each frame of a converge-mode recording for one frame time; until it is done, the animations do not step (`canRecordFrame()`), so each pose gets its own frame.

```typescript
import {ThreeViewer, CanvasRecorderPlugin, PopmotionPlugin, ProgressivePlugin, FileTransferPlugin} from 'threepipe'

const viewer = new ThreeViewer({...plugins: [ProgressivePlugin, PopmotionPlugin, FileTransferPlugin]})

const recorder = viewer.addPluginSync(CanvasRecorderPlugin)
recorder.mimeType = 'video/mp4'
recorder.videoFrameRate = 30
recorder.convergeMode = true

// record while an animation runs. The promise resolves with the video when the action ends.
const blob = await recorder.record(async() => {
    await viewer.getPlugin(PopmotionPlugin)!.animateAsync({
        from: 0, to: Math.PI * 2, duration: 2000,
        onUpdate: (v) => { mesh.rotation.y = v; mesh.setDirty() },
    })
})
if (blob) await viewer.exportBlob(blob, 'animation.mp4')

// turn the camera around the target (needs PopmotionPlugin), then prompt for the file name and download
await recorder.download360Recording(5) // duration in seconds

// or get the blob of the turn
const turntable = await recorder.recordCamera360(5)
```

`record()` rejects when the action fails. The recording then stops and its result is dropped.

A recording needs rendered frames. `startRecording()` (and so `record()`) does not start on a disabled viewer (`viewer.enabled` false, also while the WebGL context is lost) or with rendering paused (`renderEnabled` false). When rendering stops during a recording (also after a render error), no frame is captured and the animations of a converge-mode recording do not step. `record()` then stops waiting for its action and resolves with the frames recorded so far, and `stopRecording()` does not wait for frames.

Use `startRecording()` and `stopRecording()` to start and stop a recording yourself. The plugin dispatches the `start`, `stop`, `error` and `encode-progress` events.

With converge mode off (or without the `ProgressivePlugin`, where the animations run on the wall clock), the frames follow `videoFrameRate`, not the render rate: a faster render captures fewer frames, a slower one repeats the last image, so the video keeps the speed of the animation. A recording keeps the format, the frame rate and the converge mode that it started with (`recordingSettings`). A change of `mimeType`, `videoFrameRate` or `convergeMode` during a recording applies to the next one. A new recording cannot start while the last one still stops (an MP4 encodes while it stops). When the MP4 encode fails, `stopRecording()` resolves with no blob and the recorder is in the `error` state. In a browser without `MediaRecorder`, a recording with `mimeType: 'auto'` does not start (the `error` state); use an image sequence there.

[CameraViewPlugin.recordAllViews](https://threepipe.org/docs/classes/CameraViewPlugin.html#recordallviews) uses this plugin to record the animation through all the camera views.

The MP4 recorder loads ffmpeg.js from [FFMPEGRecorder.LIBRARY_PATH](https://threepipe.org/docs/classes/FFMPEGRecorder.html#library_path) (jsdelivr by default) when it is created. Set it before the plugin is added to host the files yourself. All such URLs are listed in [Dynamically loaded files](../notes/dynamically-loaded-files).

## Where the frames go

An image sequence gives its frames to a sink, set with `frameSink`:

| Sink | Where the frames go | Browsers |
|---|---|---|
| [DirectoryFrameSink](https://threepipe.org/docs/classes/DirectoryFrameSink.html) (default in Chromium browsers) | A new folder inside one the user picks, one file per frame | Chromium browsers (needs `showDirectoryPicker` and a click to start) |
| [ZipFrameSink](https://threepipe.org/docs/classes/ZipFrameSink.html) (default in Safari and Firefox) | One zip, downloaded (or given to a callback) when the recording stops | All; keeps every frame in memory until then |
| A function, or an object with `start`, `write`, `finish` and `dispose` ([ICanvasFrameSink](https://threepipe.org/docs/interfaces/ICanvasFrameSink.html)) | Anywhere: a server, memory | All |

With no `frameSink`, the default is the folder where the browser can pick one, and a zip elsewhere. The "Save frames to" setting lists only what the browser can do.

A failed recording shows why in a toast, where the viewer's dialog has toasts (the editor's does), like a write that failed. Cancelling the folder picker shows nothing. Turn it off with `recorder.toastErrors = false`; the `error` event and a rejected `record()` report it either way.

```typescript
import {ZipFrameSink} from 'threepipe'

const recorder = viewer.getPlugin(CanvasRecorderPlugin)!
recorder.mimeType = 'image/png'
recorder.frameSink = new ZipFrameSink('turntable') // downloads turntable.zip when the recording stops
await recorder.recordCamera360(3)

// or send each frame somewhere yourself
recorder.frameSink = async({blob, index, name, mimeType}) => {
    await fetch('/frames/' + name, {method: 'PUT', body: blob})
}
```

Frames arrive one at a time and in order. In converge mode the next frame waits for the sink, so a slow one doesn't fill the memory. If a write fails, no more frames are sent, the sink isn't finished, and the recorder reports an `error` when it stops.

## Adding a recorder

`registerRecorder` adds a new output with no change to the plugin, for example one built on WebCodecs. It's used when `mimeType` matches, ahead of the built-in recorders. The recorder implements [ICanvasRecorder](https://threepipe.org/docs/interfaces/ICanvasRecorder.html); extending [ACanvasRecorder](https://threepipe.org/docs/classes/ACanvasRecorder.html) is the shortest way.

```typescript
recorder.registerRecorder('webcodecs',
    (canvas, options) => new MyWebCodecsRecorder(canvas, options),
    mimeType => mimeType === 'video/webm',
    {label: 'WebM (WebCodecs)', mimeType: 'video/webm'}) // optional: an entry in the plugin UI's format list
recorder.mimeType = 'video/webm'
```

Registered recorders have their own names: one called `image` doesn't replace the built-in image recorder.

`registerRecorder` and `unregisterRecorder` return `false` and change nothing during a recording.

The plugin UI has the recorder options, buttons to record the camera turntable and the glTF animations, and the ffmpeg options of the MP4 recorder.

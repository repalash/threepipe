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

Use `startRecording()` and `stopRecording()` to start and stop a recording yourself. The plugin dispatches the `start`, `stop`, `error` and `encode-progress` events.

With converge mode off (or without the `ProgressivePlugin`, where the animations run on the wall clock), the frames follow `videoFrameRate`, not the render rate: a faster render captures fewer frames, a slower one repeats the last image, so the video keeps the speed of the animation. A recording keeps the format, the frame rate and the converge mode that it started with (`recordingSettings`). A change of `mimeType`, `videoFrameRate` or `convergeMode` during a recording applies to the next one. A new recording cannot start while the last one still stops (an MP4 encodes while it stops). When the MP4 encode fails, `stopRecording()` resolves with no blob and the recorder is in the `error` state. In a browser without `MediaRecorder`, a recording with `mimeType: 'auto'` does not start (the `error` state); use an image sequence there.

[CameraViewPlugin.recordAllViews](https://threepipe.org/docs/classes/CameraViewPlugin.html#recordallviews) uses this plugin to record the animation through all the camera views.

The MP4 recorder loads ffmpeg.js from [FFMPEGRecorder.LIBRARY_PATH](https://threepipe.org/docs/classes/FFMPEGRecorder.html#library_path) (jsdelivr by default) when it is created. Set it before the plugin is added to host the files yourself. All such URLs are listed in [Dynamically loaded files](../notes/dynamically-loaded-files).

The plugin UI has the recorder options, buttons to record the camera turntable and the glTF animations, and the ffmpeg options of the MP4 recorder.

# Changelog for @threepipe/plugin-canvas-recorder

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- NA

## [0.1.0] - 2026-10-12

### Added

- First release.
- `CanvasRecorderPlugin` with three modes: frame-exact video with WebCodecs (`video`, default), frame-exact image sequences (`images`) and real-time `MediaRecorder` (`realtime`)
- Frame-exact capture: the scene time advances by exactly `1 / fps` per captured frame through `viewer.timeline.recordingDeltaProvider` (needs threepipe 0.6.0)
- `WebCodecsVideoRecorder`: H.264 (default), VP9 or AV1 into MP4 with [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (bundled), codec level from the frame size and the frame rate, hardware encoder preferred
- `ImageSequenceRecorder`: PNG, JPEG or WebP frames into a zip file (uncompressed entries) or a folder (File System Access API)
- `MediaStreamRecorder`: `MediaRecorder` over `canvas.captureStream()`, WebM (VP9, VP8) first
- Optional per-frame convergence with `ProgressivePlugin` (off by default)
- `startRecording`, `stopRecording`, `cancelRecording`, `record(action)`, `recordDuration(seconds, {onFrame})`, `recordTurntable({duration, angle, ccw, ease})`
- `start`, `progress`, `stop` and `error` events, auto download, UI config

[unreleased]: https://github.com/repalash/threepipe/tree/dev/plugins/canvas-recorder
[0.1.0]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-canvas-recorder-0.1.0

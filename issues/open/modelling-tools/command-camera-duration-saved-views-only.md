# `camera {duration}` only animates to saved views; explicit and fitted moves always jump

Found directing the `demos/stair` recording.

`cameraCommand` (`plugins/modelling/src/commands/session.ts`) documents
`duration: 'Animate over this many milliseconds. 0, the default, jumps.'`, but only the saved-view
branch reads it (`views.animateToView(saved, duration)`). A `camera {position, target, duration}` or
`camera {view: 'front', fit, duration}` jumps, silently.

## Repro

```js
await run({op: 'camera', position: [10, 5, 10], target: [0, 0, 0]})
await run({op: 'camera', position: [-10, 5, 10], target: [0, 0, 0], duration: 2000})
// Returns at once; the next frame is already at [-10, 5, 10].
```

## Expected

Either animate every move (CameraViewPlugin can animate to an unsaved `CameraView` built from the
computed position and target, the way `animateToView` does for saved ones), or warn that `duration`
was ignored. `demos/stair/record.mjs` eases moves itself by sending one `camera` command a frame.

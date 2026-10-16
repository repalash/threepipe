# `camera {duration}` only animates saved views

The schema says `duration: Animate over this many milliseconds`, but `commands/session.ts` only uses
it for a *saved* view (`views.animateToView(saved, duration)`). An explicit `position` / `target`, a
standard view (`front`, `iso`, ...) or a `fit` jumps, whatever the duration, with no warning.

## Repro

```js
await run({op: 'primitive', type: 'cube', name: 'c', size: 1})
const t = performance.now()
await run({op: 'camera', position: [6, 3, 6], target: [0, 0, 0], duration: 2000})
// returns at once; the next frame is already at the new position
console.log(performance.now() - t) // a few ms, not ~2000
```

## Why it matters

Found writing the Haussmann demo's recorder (`demos/haussmann/record.mjs`), which drives the camera
through the same commands the build uses. Every eased move in the storyboard had to be re-implemented
as a page-side tween of `viewer.scene.mainCamera`, outside the command API.

## Expected

Either animate every camera change that has a `duration` (threepipe's `CameraViewPlugin` can animate
to an arbitrary `CameraView` built from the target position/target), or reject `duration` where it
is not supported, like `fov` is rejected for an orthographic camera.

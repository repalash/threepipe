# `camera {duration}` only animates saved views; it is silently ignored for `fit`, `view` and `position`

Found building the camera demo's video (`demos/camera/record.mjs`).

## Repro

```js
await run({op: 'primitive', type: 'cube', name: 'c', size: 1})
await run({op: 'camera', view: 'front', fit: '*'})
const r = await run({op: 'camera', position: [3, 2, 3], target: [0, 0, 0], duration: 2000})
// r.ok, no warning; the camera jumps in one frame. Same with {view: 'iso', fit: '*', duration: 2000}.
```

`commands/session.ts` (`cameraCommand.run`) honours `duration` only on the saved-view branch
(`views.animateToView(saved, duration)`). The computed-view and explicit-position branches call
`applyCamera` directly.

## Why it matters

The parameter is documented as "Animate over this many milliseconds", with no restriction. A script
asking for a two-second move and getting a cut cannot tell from the result. For the camera demo's
video every move had to be tweened client-side (one `camera` command per frame from a
`requestAnimationFrame` loop in the page).

## Expected

Either animate every branch (threepipe's `CameraViewPlugin.animateToView` takes a view built from
any position/target, or interpolate the two the way Blender's smooth view does - `view3d_smooth_view`
in `source/blender/editors/space_view3d/view3d_view.cc`, which lerps the target and slerps the view
rotation, distance separately), or reject/warn on `duration` where it has no effect.

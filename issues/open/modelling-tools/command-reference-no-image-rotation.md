# `reference` cannot rotate or flip the image on its plane

Found building the camera demo. The only usable side elevation of the EF 24-105mm lens is a
photograph of it standing on its rear cap (front up). On a `right` plane the lens axis has to run
along Z, so the photo needs a quarter turn. `reference` has `plane`, `width`, `origin`, `align` and
`calibrate`, but no rotation, so the build ships a rotated copy of the file
(`demos/camera/refs/lens-side-rotated.jpg`) next to the original.

## Repro

```js
await run({op: 'reference', name: 'lens', plane: 'right', image: '/demos/camera/refs/lens-side.jpg',
    calibrate: {from: [0.49, 0.807], to: [0.49, 0.196], distance: 107}})
// The lens stands vertically on the plane; there is no parameter to lay it along +Z.
```

## Expected (Blender)

Blender's reference/background image empties have a rotation (the empty's transform) and
`use_flip_x` / `use_flip_y` (`Image` empty, `rna_object.cc` `empty_image_*`). An `angle` (radians,
about the plane normal) and `flipX`/`flipY` on `reference`, applied before calibration so
`calibrate` points stay in the original image's coordinates, would cover it.

# The mouse wheel and trackpad pinch do not zoom the editor's viewport

Found by the `house-walkthrough` demo (`demos/house-walkthrough/`), 2026-10-16. Rank: **blocking**
(the first thing anyone does in a 3D view; the only remaining zoom is framing).

## Repro

`examples/modelling-editor/`, skip the welcome, put the pointer over the viewport, scroll the wheel (or
pinch on a trackpad, which the browser sends as Ctrl+wheel). The camera does not move; the camera
distance (`viewer.scene.mainCamera.controls.getDistance()`) stays 7.51.

## Cause

`three-modded` `examples/jsm/controls/OrbitControls.js:422` (published `three-modded@0.168.10006`):

```js
this._spherical.radius *= 1 + this._sphericalDelta.radius * ( this.enableDamping ? this.dampingFactor : 0 );
```

With damping off the factor is 0, so a wheel dolly never changes the radius; `update()` then clears
`_sphericalDelta` (:491). The `dollyZoom` branch just above (:413) uses `: 1`. The editor turns damping
off on purpose (`plugins/modelling-editor/src/EditorViewportPlugin.ts:141`, `:149`), so every wheel and
pinch zoom in the editor is a no-op. Touch pinch still works (`_scale`, :438).

## Fix

In three.js-modded: `( this.enableDamping ? this.dampingFactor : 1 )` at :422, as at :413 (the parent
session is making this change in the fork; it needs a `three-modded` release). Not worked around in the
editor.

## Also

There is no other way to zoom: no View > Zoom In / Zoom Out, no Numpad +/- (Blender: `view3d.zoom`,
`blender_default.py` km_view3d, Numpad +/- and Ctrl+MMB drag; Figma: Ctrl +/-). See
[ux-no-zoom-commands](./ux-no-zoom-commands.md).

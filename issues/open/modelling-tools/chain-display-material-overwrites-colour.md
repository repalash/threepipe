# `display {mode: 'material'}` throws away colours set while in solid mode

**Found by**: edit-chain harness, step `scene-06`.
**Severity**: low-medium. A colour an agent sets is silently replaced by an older one.

## Repro

```js
await run({op: 'display', mode: 'solid'})
await run({op: 'material', object: 'rook', color: '#aa3322'})
await run({op: 'display', mode: 'material'})
// rook's colour is back to what it was before `display solid` (#3a3a40), not #aa3322
```

## Cause

`displayCommand` (`commands/scene.ts`) implements solid shading by overwriting `mat.color` with grey and
stashing the original in `mat.userData.__modellingSolidColor` the first time; switching back writes the
stash over whatever the colour is now. A `material` command in between changes the live colour, which
is then discarded. (Also: the stash is never cleared, so a second solid/material cycle restores the
colour from the *first* one.)

## Expected (Blender)

Solid shading is a viewport setting (`View3DShading.type`, `DNA_view3d_types.h`) and never touches
material data; switching back shows the materials as they are. Do the same: render solid through a
viewport override (an override material on the render pass, or the viewer's material-override
mechanism) instead of editing the materials, so `material` and `display` cannot interfere.

## Re-verified (demos-gpu, 2026-10-18, modelling-editor 461ab07b)

Still fails: the edit-chain re-run's `scene-06` gets `3a3a40`, not `#aa3322`. The GPU demo films do not use
`display {mode: 'solid'}` for their clay passes for this reason; `demos/shared/film.mjs` renders clay with
`scene.overrideMaterial`, the viewport-override approach proposed above.

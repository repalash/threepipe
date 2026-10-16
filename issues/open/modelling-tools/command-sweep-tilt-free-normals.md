# `sweep`: the curve `tilt` attribute and Free normal mode are not ported

Found building `demos/stair` (the helix handrail and the vault ribs).

Blender's Curve to Mesh takes its section frames from `CurvesGeometry::evaluated_normals`
(`blenkernel/intern/curves_geometry.cc`, around line 1040 in the checkout under `.repos/blender`):

- `NORMAL_MODE_Z_UP` and `NORMAL_MODE_MINIMUM_TWIST` (both ported, `generate/sweep.ts`);
- `NORMAL_MODE_FREE`, which reads a per-point `custom_normal` attribute, interpolates it to the
  evaluated points (`evaluate_generic_data_for_curve`) and normalises it (not ported);
- then, for every mode, the `tilt` point attribute rotates each normal about its tangent
  (`rotate_directions_around_axes`) (not ported).

`SweepOptions` and the `sweep` command offer only `normalMode: 'minimumTwist' | 'zUp'`. So a section
cannot be turned about the path except by rewriting the profile, and cannot follow a normal field
the caller already knows (a banked road, a rail that rolls into a landing).

## Repro

```js
// A flat bar that should roll from flat to on-edge along its length: no way to ask for it.
await run({op: 'sweep', name: 'bar', path: [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
    profile: [[-0.05, -0.01], [0.05, -0.01], [0.05, 0.01], [-0.05, 0.01]]})
// Blender: set the curve's tilt to 0, 45 deg, 90 deg on the three points; the section turns.
```

## Why it is not blocking

With the Y-up conversion fix (see `command-sweep-profile-orientation.md`), `normalMode: 'zUp'` gives
an exactly radial normal on a helix about Y and an across-the-plane normal on any arc in a vertical
plane, which is what the stair handrail and the arcade ribs need.

## Expected (Blender)

`tilt: number[]` (one angle per path point, radians, like `radii`) applied after the normal mode, and
`normalMode: 'free'` with `normals: [x, y, z][]` (one per point, in world Y-up axes, converted like
the path). Port `rotate_directions_around_axes` and the Free branch of `evaluated_normals`; on a poly
curve the evaluated points are the control points, so no interpolation is needed.

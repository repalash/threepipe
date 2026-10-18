# `sweep`: which way a custom profile faces is undocumented and cannot be set

`sweep {profile}` documents the profile as "`[x, y]` pairs" but not which way x and y point.

- The kernel follows Blender's `fill_mesh_positions` (`generate/sweep.ts`, `buildPointMatrix`):
  profile X runs along the frame *normal*, and Y runs along `cross(tangent, normal)`.
- For a path in a vertical plane, the minimum-twist normal is perpendicular to that plane, so X
  points *across* the curve.
- In practice you find this out by trial. The Eiffel build's consoles and arches each took a
  render to discover it.

There is also no way to rotate the section about the path. Blender has the curve `tilt` attribute,
and Curve to Mesh honours it. The kernel's sweep header mentions tilt, but neither `SweepOptions`
nor the command exposes it, and `normalMode` only offers `minimumTwist` and `zUp`.

## Repro

```js
await run({op: 'sweep', name: 's', path: [[0, 0, 0], [0, 1, 1], [0, 0, 2]],
    profile: [[-1, -0.1], [1, -0.1], [1, 0.1], [-1, 0.1]]})
// The 2-unit side lies along world x, across the plane of the path, not in it.
```

## Suggested fix

Document the mapping in the command description. Port the tilt attribute (one angle per path point,
as `radii` is one scale per point), so a section can be turned without rewriting the profile.

## Status (2026-10-16, demo-stair)

**Root cause of the orientation quirk found and fixed.** The `sweep` command handed threepipe's Y-up
path straight to the kernel, whose frames are Blender's and therefore Z-up
(`curve_poly.cc:126` `calculate_normals_z_up`, `:166` `calculate_normals_minimum`: the first normal
is `normalize(t.y, -t.x, 0)`, perpendicular to world Z). Every other generator in
`commands/create.ts` converts axes at the command layer; `sweep` did not. So threepipe's +Z (a
horizontal axis) was "up": `zUp` kept sections level with nothing in particular, and a one-sided
section on a path in the XY plane landed differently from the same path in the YZ plane (in the YZ
plane the start normal was across the plane, in the XY plane it was in it).

Fix: `sweepYUp` in `plugins/modelling/src/commands/create.ts` converts the path into Blender's axes
with the inverse of `axisMatrix('y')` and the mesh back through it. The mapping is now documented in
the command description: profile x along the frame normal, profile y along tangent x normal; on a
horizontal path, x is horizontal to the right of travel and y points down (Blender's
`build_point_matrix`, `curve_to_mesh_convert.cc:182`); on a path in any vertical plane x is across
that plane. Tests: `plugins/modelling/tests/sweep.test.ts` (4 of 6 fail on the old command).

Eiffel build re-run on the fix: 19/19 checks pass. Arch crown 39.143 -> 39.100 (start normal of the
arch on the sloping face moved by the chord's x component). The corner consoles changed for the
better: their section is now symmetric about the diagonal plane they lie in (bounds x = z), where it
was rotated about the path before.

Still open: the curve `tilt` attribute and `NORMAL_MODE_FREE` custom normals
(`curves_geometry.cc` `CurvesGeometry::evaluated_normals`) are not ported. With the axis fix, `zUp`
covers the helix handrail of `demos/stair` (normal exactly radial), so nothing in the demos needs them
yet.

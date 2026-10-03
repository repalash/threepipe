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

# The camera drifts by an ulp on every rendered frame, so exports with viewer config differ

**Found** 2026-10-18 by Track 1 while chasing edit-chain's `chain-export-not-deterministic.md` ("a second
export in the same session differs": 277092 vs 277124 bytes).

## What

`OrbitControls.update()` (three r168, `examples/jsm/controls/OrbitControls.js:308`; threepipe's
`OrbitControls3` inherits it) rebuilds the camera position on every call from spherical coordinates:
`offset = position - target -> spherical -> offset' -> position = target + offset'`. That round trip is not
the identity in floating point, so a camera placed at `[6, 4, 6]` reads `[6, 4, 6.000000000000001]` after
the next rendered frame, and `near` moves in its last digit with it. The bundled viewer config carries
both, so:

- two exports with a frame rendered between them differ (32 bytes in the modelling session page:
  `plugins/modelling-cli/tests/browser/session.test.ts` reproduces it with a `look` between exports,
  `tmp/track1/export-diff.mjs` diffs the JSON: only `position.z` and `near` change);
- in a Node session (no rendering, so no `controls.update()`) the same exports are byte-identical.

The document itself is unaffected: `export {viewerConfig: false, uuids: false}` is byte-identical in both
cases, and that is what the replay-determinism tests assert.

## Options (core / three fork, needs a decision)

1. In `OrbitControls3`, leave `object.position` alone when the update has no rotation, pan, zoom or
   damping delta (the common idle frame).
2. Round-trip-stable spherical conversion in the fork.

Not worked around in the modelling packages.

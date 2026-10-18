# `light {target}` wrote a world point into the light's local space: aimed lights shone the wrong way

**Found by**: demos-gpu (2026-10-18), re-recording the demos on the GPU: tops of cubes rendered darker than their sides,
planes facing up came out navy, and no `castShadow` light ever drew a shadow.
**Severity**: high for every rendered result - every build that placed a directional or spot light with `target`
(the camera, Haussmann, stair and edit-chain demos, the cookbook's lighting) was lit from a wrong direction, and a
`target: [0, 0, 0]` light lit nothing.
**Status**: fixed on `demos-gpu` (plugins/modelling/src/commands/scene.ts) with a test
(plugins/modelling-cli/tests/light-aim.test.ts); the parent decides whether it lands from there or in its own branch.

## Cause

threepipe's `DirectionalLight2` and `SpotLight2` (`src/core/light/*.ts`) keep `target` as a **child** of the light at
local (0, 0, -1), as glTF's KHR_lights_punctual does: a light shines down its own -z. The `light` command set
`light.target.position` to the world point it was given, i.e. in the light's local space. The light then aimed at
`light.position + target` instead of `target`; with `target: [0, 0, 0]` the target sat on the light and the direction
was zero (probe: world direction [0, 0, 0], every surface black with the environment off).

## Fix

Keep the child where it is and turn the light: `light.lookAt(target)` (three's lookAt points a light's -z at the
point). The world target is kept on the light, so changing only `position` later keeps it aimed at the same point.

## Not fixed here

- Shadows: `DirectionalLight2.shadowFrustum` defaults to 10 units and the command has no parameter for it, so a 30 m
  building (Haussmann) or a 150 mm camera gets a shadow camera of the wrong size. Needs a `shadowFrustum` (or
  automatic fit to the document's bounds) on `light` - an API addition, not done here.

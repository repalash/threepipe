# Transmission/iridescence rendering slightly non-deterministic

## Observation
The `gltf-transmission-test-msaa` test's initial screenshot varies by ~2% between runs.
Passes consistently when run alone (3/3), but flakes when run in parallel with other GPU-heavy tests.

## Cause
Glass/transmission rendering involves multiple render passes (opaque → read back buffer → render transparent with refraction) and iridescence thin-film calculations. GPU scheduling differences under load cause small float precision variations in the refracted/iridescent pixels.

## Impact
Low — passes on retry. Default `retries: 1` handles it. Not a code bug, just GPU/SwiftShader scheduling noise.

## Files
- `examples/gltf-transmission-test-msaa/script.ts`
- `tests/interactive.spec.ts` — test at line 736

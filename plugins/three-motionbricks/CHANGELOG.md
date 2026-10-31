# Changelog

## Unreleased

- The SOMA human model: `rig: 'soma'`, `MotionBricksSOMA` (validated against NVIDIA's kernels), `SOMA_SKELETON`,
  `SOMA_BRICKS` with stride cycles, `SOMAMannequin`, retargeting from SOMA (`SOMA_PARTS`), and NVIDIA's SOMA
  Smart Primitives. G1Controller now takes a `PoseRig` (`G1_RIG`, `SOMA_RIG`) for the skeleton's poses.
- Under slow inference, gait segments lengthen just enough for the next one to be ready (no stalls at 900 ms).
- Jumps, vaults, ducking and sitting with NVIDIA's Smart Primitives: `loadPrimitive`, `setObstacles`, `sit`,
  `standUp` (`G1Primitives.ts`). Pivot alignment and sequence playback follow NVIDIA's runtime; the documents and
  clips load from NVIDIA's repository.
- Keyboard steering regenerates at 15 degrees of change instead of 20.
- Even steps: gait targets come from a symmetric stride cycle, at the point of the stride the robot reaches, with
  a fixed segment length to match. The left/right step timing went from 32% apart to under 5% when running, and
  from 22% to 2-3% when walking (`tools/make_cycles.py` bakes the cycles).
- Stopping from a run allows only segments long enough to slow down, so the last metres are not rushed.
- A lite model pack for phones (`tools/pack_lite.py`, `liteModel`, `lite: 'auto'`). On phones the page's peak
  memory while loading is about 25% lower than before: onnxruntime-web's WebAssembly-only build by default, and a
  pause before the first generation so the downloaded weights are collected first.
- Model packs are kept in Cache Storage (`cache`, default on), so they download once per browser.
- The GitHub Pages site (`site/`, `tools/build_site.sh`).

## 0.1.0

- MotionBricksCharacter, MotionBricksG1, MotionBricksRemote, G1Controller and G1Robot for three.js.

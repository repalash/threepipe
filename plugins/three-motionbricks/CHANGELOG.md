# Changelog

## Unreleased

- Even steps: gait targets come from a symmetric stride cycle, at the point of the stride the robot reaches, with
  a fixed segment length to match. The left/right step timing went from 32% apart to under 5% when running, and
  from 22% to 2-3% when walking (`tools/make_cycles.py` bakes the cycles).
- Stopping from a run allows only segments long enough to slow down, so the last metres are not rushed.
- A lite model pack for phones (`tools/pack_lite.py`, `liteModel`, `lite: 'auto'`).
- The GitHub Pages site (`site/`, `tools/build_site.sh`).

## 0.1.0

- MotionBricksCharacter, MotionBricksG1, MotionBricksRemote, G1Controller and G1Robot for three.js.

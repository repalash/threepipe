# Examples That Need Interactive Tests (Not Smoke Tests)

**Created:** 2026-03-27
**Updated:** 2026-03-28
**Status:** Partially addressed — convergence plugins now auto-disabled in deterministic injection

## Current State

The `deterministic-injection.js` now auto-disables convergence plugins (`TemporalAAPlugin`, `SSReflectionPlugin`, `SSAAPlugin`, `WatchHandsPlugin`) on first frame after viewer initialization. This resolves most non-determinism from progressive rendering.

## Remaining examples with continuous animations

Examples using `PopmotionPlugin.animate()` with `repeat: Infinity` or `GLTFAnimationPlugin.autoplayOnLoad` may still produce non-deterministic screenshots. The `beforeEach` hook in helpers.ts pauses GLTF animations and stops popmotion animations before the initial screenshot.

## Examples now covered by interactive tests (25 total)

image-snapshot-export, 3dm-to-glb, camera-uiconfig, custom-pipeline, depth-buffer-plugin, frame-fade-plugin, fullscreen-plugin, geometry-uv-preview, canvas-snapshot-plugin, glb-export, glb-draco-export, normal-buffer-plugin, pmat-material-export, popmotion-plugin, render-target-export, render-target-preview, tonemap-plugin, gbuffer-plugin, screen-pass-extension-plugin, cascaded-shadows-plugin-basic, unreal-bloom-pass, gltf-transmission-test-msaa, stencil-clipping-portal, multi-render-uv-clip, material-configurator-plugin

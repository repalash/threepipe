# Depth buffer PNG/JPEG export is non-deterministic

**Created:** 2026-03-27
**Updated:** 2026-03-28
**Status:** Mitigated (not fixed at source)
**Discovered via:** E2E test `render-target-export` — hash mismatch on repeated runs

## Problem

Exporting the depth buffer as PNG via `renderManager.exportRenderTarget()` produces different binary output across runs on the same machine with the same scene. Packed float→RGBA encoding amplifies tiny GPU scheduling differences into ~2% pixel changes.

## Mitigation

The `downloadFileMatch` helper now allows `maxDiffPixelRatio: 0.03` for files matching `/depth|normal/i` pattern. This is a tolerance-based workaround — the root cause (GPU non-determinism in readPixels) remains.

## Root Cause

GPU `readPixels` returns slightly different floating-point depth values between runs due to scheduling/precision variance. When these are packed into RGBA bytes, small float differences become large pixel value changes. This is inherent to GPU rendering with SwiftShader/ANGLE.

## Impact

- Tests pass with 3% tolerance
- Cannot verify depth buffer exports with exact byte comparison
- Not a code bug — GPU behavior

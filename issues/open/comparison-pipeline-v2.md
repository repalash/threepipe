# Comparison Pipeline V2 — Unified Scene Verification

**Parent:** [procedural-generation-status.md](procedural-generation-status.md)
**Status:** Steps 1-2 complete. Steps 3-4 deferred to next Blender export.
**Priority:** High — unblocks reliable verification for all future ports

## Problem
The current comparison only checks matrices/vertices. It doesn't verify:
- Asset names resolve to actual loadable GLBs
- Per-asset-name instance counts are correct
- Scene bounding box matches Blender's
- Asset geometry at instance positions produces correct overall shape

## Approach
ThreeViewer works in Node.js with DummyRenderManager + polyfill (verified — see [threepipe-nodejs-support.md](threepipe-nodejs-support.md)). GLB loading via `viewer.assetManager.addAsset(File)` works. This means we can:

1. Evaluate the graph → get GeneratedInstance[] or mesh data
2. Load all GLB assets via threepipe's AssetManager in Node.js
3. For each instance: verify asset exists, compute world-space bbox
4. Compare total scene bbox against Blender ground truth

## Implementation Steps

- [x] **Step 1:** Rewrite compare_graph.ts — single-pass comparison with structure checks
  - Per-asset-name instance counts (e.g., "28 trimm.glb")
  - Scene bounding box from instance positions
  - Asset name validation (every object_name in output exists in assets list)

- [x] **Step 2:** GLB asset loading + world-space scene bbox comparison (asset bbox × instance matrix)

- [x] Mesh scatter outputs now apply placement transforms for world-space comparison
- [x] Flat vertex array outputs (`number[][]`) supported directly
  - Use DummyRenderManager + polyfill to create headless ThreeViewer
  - Load each GLB, extract per-asset bounding box
  - For each instance: compute world bbox = asset bbox transformed by instance matrix
  - Compare scene bbox against GT scene bbox

- [ ] **Step 3:** Update export_ground_truth.py
  - Include per-object-name instance counts in GT JSON
  - Include scene bounding box
  - Include per-asset bounding boxes (from the Blender objects)

- [ ] **Step 4:** Standardize ground truth format
  ```json
  {
    "instances": [...],
    "scene_bbox": {"min": [x,y,z], "max": [x,y,z]},
    "object_counts": {"trimm.glb": 28, "window.glb": 84, ...},
    "asset_bboxes": {"trimm.glb": {"min": [...], "max": [...]}, ...}
  }
  ```

- [ ] **Step 5:** Verify all existing demos pass with enhanced checks

## Not Doing
- No headless rendering / pixel comparison
- No external dependencies (uses threepipe only)

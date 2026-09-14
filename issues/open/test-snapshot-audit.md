# E2E Snapshot Test Audit

**Date:** 2026-03-28 (updated)
**Last run:** 25 interactive tests + ~165 smoke tests
**Status:** 25/25 interactive pass (2 flaky on retry), 108 unit tests pass

---

## 1. Summary Stats

| Metric | Value |
|---|---|
| Test definitions in spec | 175 |
| Snapshot directories created | 176 (175 test dirs + 1 `downloads/` for download file artifacts) |
| Total PNGs in snapshot dirs | 188 |
| Console.log files | 175 (every test) |
| Tests with `initial.png` | 168 (7 dirs missing it) |
| Tests with extra screenshots (interactive steps) | 7 (camera-uiconfig, custom-pipeline, depth-buffer-plugin, frame-fade-plugin, fullscreen-plugin, geometry-uv-preview, normal-buffer-plugin, popmotion-plugin) |
| Suspiciously small PNGs (<1KB) | 0 |
| `timeout-state.png` files | 0 |
| Test-result (failure artifact) directories | 46 |
| Spec-to-snapshot directory coverage | 175/175 = 100% (1:1 match) |
| Download artifact subdirectories | 6 |

---

## 2. Tests Missing `initial.png` (6 real tests)

These snapshot directories have a `console.log` but no `initial.png`. The test reached the page and logged console output but the initial screenshot was never written (likely `_testFinish` not reached within the 120s timeout, or the test was killed at the 180s test-level timeout before the timeout-state handler could run).

| Test | Console Observations | Likely Root Cause |
|---|---|---|
| `advanced-ground-plugin` | Viewer init OK, webgi-plugins loaded from CDN | CDN-loaded plugin, `_testFinish` likely never set |
| `clear-reimport-test-2` | 63+ warnings: "Object3DManager - same uuid already registered" | Reimport loop produces excessive duplicates; async completion stalled |
| `fat-lines-ssr` | GPU ReadPixels stall warnings | SSR post-processing too heavy for SwiftShader |
| `monkey-type-3d` | "unsupported GSUB table LookupType 6" from troika font parser | Async troika font loading never completes in time |
| `reimport-duplicate-test` | 63+ warnings: "Object3DManager - same uuid" (identical to clear-reimport-test-2) | Same reimport loop issue |
| `ssgi-ssr-plugin` | "SSGIPluginPass: DepthNormalBuffer required for ssrtao/ssgi" | Heavy SSGI+SSR; never signals completion |

**Note:** The `downloads` directory also has no `initial.png` but it is not a test -- it is the storage location for download file baselines.

---

## 3. Failure Classification (46 test-result directories)

### 3a. Visual Regressions with Diffs (7 tests)

These failed because the new screenshot exceeds the `maxDiffPixelRatio: 0.003` threshold vs the stored baseline. In update mode, snapshots were overwritten with the new images.

| Test | Actual Size | Expected/Previous Size | Notes |
|---|---|---|---|
| `animation-clip-data` | 103,846 B | 103,128 B | Minor pixel drift |
| `gltf-animation-plugin` | 25,579 B | 25,640 B | Minor pixel drift |
| `gltf-camera-animation` | 503,771 B | 508,071 B | Camera position / animation timing delta |
| `gltf-transmission-test-msaa-zprepass` | 213,437 B | 213,438 B | Borderline 1-byte delta |
| `monkey-type-3d` | 247,124 B | 246,912 B (prev) | Font rendering + timing |
| `obj-to-glb` | 97,552 B | 83,268 B | Larger diff; GLTFExporter material warnings present |
| `skeleton-helper-widget` | 149,448 B | 148,155 B | Minor pixel drift |

### 3b. Snapshot Updated Successfully -- Still Flagged as "Failed" (30 tests)

In `--update-snapshots` mode, Playwright overwrites old baselines with new screenshots but still reports them as "failed" because they differ from the previous baseline. The snapshots on disk now match the actual renders. These represent expected visual churn from code changes on the `dev` branch.

Verified: snapshot file sizes match the actual file sizes in test-results for all checked cases.

Full list: fat-lines, follow-path-constraint, material-configurator-plugin, object-constraints-plugin, splat-load, sscontactshadows-plugin, ssgi-plugin, ssreflection-plugin, stencil-clipping-portal, stencil-picking-outline, svg-geometry-playground, switch-node-plugin, tailwind-css-cdn-plugin, temporalaa-plugin, three-csm-basic, three-svg-renderer-plugin, timeline-ui-plugin, transform-animation-plugin, transform-controls-plugin, troika-text-plane, troika-text-plugin, troika-text-shadow, tweakpane-ui-plugin, unreal-bloom-pass, velocity-buffer-plugin, viewer-render-size, vignette-plugin, virtual-camera, virtual-cameras-plugin, watch-hands-plugin

### 3c. Interactive Test Failures (5 tests)

| Test | Failure Type | Details |
|---|---|---|
| `camera-uiconfig` | Interactive step screenshot mismatch | Has `0-actual.png` (107,992 B) -- the interactive zoom step screenshot differs from previous |
| `custom-pipeline` | Download file hash mismatch | `file.png` new=91,737 B vs old=90,165 B -- rendered depth screenshot binary changed |
| `render-target-export` | **Page error: `texture is not defined`** | `ReferenceError` at `dist/index.mjs:45487` in `AssetExporter.exportRenderTarget`. Real bug. |
| `render-target-preview` | **Page error: `texture is not defined`** | Same `ReferenceError` in same code path. Same bug. |
| `tonemap-plugin` | Interactive step failure (no actual.png produced) | UI interaction timing issue or selector breakage |

### 3d. Timeout / No-Screenshot Failures (4 tests with test-result dirs)

| Test | Root Cause |
|---|---|
| `advanced-ground-plugin` | CDN-loaded webgi-plugins; `_testFinish` not reached |
| `fat-lines-ssr` | SSR rendering + GPU ReadPixels stalls under SwiftShader |
| `monkey-type-3d` | Troika font async load timing |
| `ssgi-ssr-plugin` | Heavy SSGI+SSR; DepthNormalBuffer warning |

### 3e. Stale Artifact

| Test | Issue |
|---|---|
| `dispose-reimport-test-3` | Only has `initial-expected.png` in test-results, no actual. Stale artifact from a prior run. |

---

## 4. Console Log Analysis

### 4.1 Aggregate Stats (across all 175 console.log files)

| Category | Count |
|---|---|
| Total lines | 1,796 |
| `[log]` entries | 320 |
| `[warning]` entries | 356 |
| `[error]` entries | 18 |
| `[pageerror]` entries (JS exceptions) | 3 |
| `[debug]` entries | 16 |

### 4.2 Warning Breakdown

| Warning Pattern | Tests Affected | Severity |
|---|---|---|
| GPU stall due to ReadPixels (GL_CLOSE_PATH_NV) | 48 | **Benign** -- expected with SwiftShader/ANGLE |
| `Serialization: replacing object Er with deserialized object Er` | 6 | Low -- expected during typed object deserialization |
| `Object3DManager - Object/Material/Texture with same uuid already registered` | 3 (clear-reimport-test-2, reimport-duplicate-test, dispose-reimport-test-3) | Low -- expected in reimport test scenarios |
| `GLTFExporter: Use MeshStandardMaterial or MeshBasicMaterial` | 2 (3dm-to-glb, obj-to-glb) | Low -- informational |
| `plugin not found:` (dumps entire minified class source) | 3 (fat-line-spiral, temporalaa-plugin, velocity-buffer-plugin) | **Medium** -- PickingPlugin not registered; warning message dumps thousands of chars of minified source code |
| `pauseAnimation called when animation was not playing` | 3 (bone-helper-widget, three-svg-renderer-plugin, skeleton-helper-widget) | Low -- harmless race condition |
| `unsupported GSUB/GPOS table LookupType` | 4 (monkey-type-3d, troika-text-plane, troika-text-plugin, troika-text-shadow) | Low -- troika font parser limitation |
| `old file format, backgroundIntensity/background moved to RootScene` | 1 (switch-node-plugin) | Low -- migration compatibility |
| `Serialization: Data might already be deserialized` (dumps entire Texture class) | 1 (anisotropy-plugin) | **Medium** -- same noisy-dump pattern as plugin-not-found |
| `THREE.Texture .encoding replaced by .colorSpace` | 2 | Low -- deprecation warning |
| `SSGIPluginPass: DepthNormalBuffer required for ssrtao/ssgi` | 2 (ssgi-plugin, ssgi-ssr-plugin) | Low -- expected when buffer not yet available |
| `cdn.tailwindcss.com should not be used in production` | 1 (tailwind-css-cdn-plugin) | Low -- expected, example uses CDN intentionally |

### 4.3 Actual Errors (`[error]` entries)

| Test | Error | Severity |
|---|---|---|
| `assimpjs-plugin` | 3x HTTP 404 for JPG textures (01_-_Default1noCulling.JPG, male-02-1noCulling.JPG, orig_02_-_Defaul1noCulling.JPG) | **Medium** -- example asset files missing from repo |
| `clear-reimport-test` | 2x "Imported viewer config was deleted, cannot import it again" | Low -- intentional test behavior |
| `extra-importer-plugins` | 3x "No material template found for type PointsMaterial" + 2x 404 for textures | **Medium** -- PointsMaterial not registered + missing assets |
| `gltf-mesh-lines` | 2x "No material template found for type PointsMaterial" | **Medium** -- PointsMaterial not registered |
| `hdr-to-exr` | "AssetExporter: Unable to Export file" | **High** -- export pipeline failure |
| `image-load` | "Unable to import file" + "Failed to fetch" for threepipe.org/favicon.ico | Low -- external URL blocked by test cache, expected |
| `pnts-load` | "No material template found for type PointsMaterial" | **Medium** -- PointsMaterial not registered |
| `render-target-export` | "AssetExporter: Unable to Export file js" | **High** -- export pipeline failure |

### 4.4 Page Errors (JS Exceptions) -- 3 Total

These are actual uncaught JavaScript exceptions:

1. **`hdr-to-exr`**: `TypeError: Cannot read properties of undefined (reading 'length')` at `EXRExporter.parseAsync` (dist/index.mjs:45629). The EXR exporter receives `undefined` where it expects an array.

2. **`render-target-export`**: `ReferenceError: texture is not defined` at dist/index.mjs:45487, called from `AssetExporter.exportRenderTarget` -> `EXRExporter.parse`. A variable `texture` is not in scope.

3. **`render-target-preview`**: Same `ReferenceError: texture is not defined` at same location. Triggered from the "Download" context menu action on a render target preview.

**All 3 page errors point to bugs in the AssetExporter / EXR export code path (dist/index.mjs around lines 45487-45629).**

---

## 5. Cross-Reference: Spec vs Snapshots

- **175 tests** defined in `tests/example.spec.ts`
- **175 test directories** in `tests/snapshots/chromium-darwin/` (exact 1:1 match)
- **1 extra directory**: `downloads/` (storage for download test baselines, not a test)
- **0 gaps**: Every test in the spec has a corresponding snapshot directory
- **0 orphans**: No snapshot directories without a corresponding test

---

## 6. Recommendations

### High Priority -- Real Bugs

1. **AssetExporter `texture is not defined`** -- Affects `render-target-export` and `render-target-preview`. The variable `texture` at dist/index.mjs:45487 is referenced but not defined in scope. This is a regression in the export pipeline. Both interactive download tests crash because of this.

2. **EXR export `undefined.length`** -- Affects `hdr-to-exr`. The `parseAsync` method at dist/index.mjs:45629 receives `undefined` instead of an array-like. Same AssetExporter code area as above.

3. **PointsMaterial template not registered** -- Affects `extra-importer-plugins`, `gltf-mesh-lines`, `pnts-load`. The material template registry does not include `PointsMaterial`, so point cloud imports lose their intended material. This error is logged every time a PointsMaterial is encountered.

### Medium Priority -- Warning Noise

4. **`plugin not found:` dumps entire minified class** -- When `viewer.getPlugin()` fails to find a plugin, the warning message stringifies the entire plugin class constructor (thousands of characters of minified code). This makes console.log files huge and unreadable. Should truncate to just the class name. Affects: fat-line-spiral, temporalaa-plugin, velocity-buffer-plugin.

5. **`Serialization: Data might already be deserialized` dumps Texture class** -- Same pattern. The warning at dist/index.mjs:22022 stringifies the entire `Texture` class source. Should log only the class name and key identifier. Affects: anisotropy-plugin.

6. **assimpjs-plugin missing texture files** -- 3 JPG texture files referenced by the OBJ model are missing from `examples/assimpjs-plugin/`. Either add the missing assets or document this as expected.

### Medium Priority -- Test Stability

7. **6 tests produce no screenshot** (advanced-ground-plugin, clear-reimport-test-2, fat-lines-ssr, monkey-type-3d, reimport-duplicate-test, ssgi-ssr-plugin). These need investigation:
   - `advanced-ground-plugin`: Does it set `_testFinish`?
   - `clear-reimport-test-2`, `reimport-duplicate-test`: Heavy reimport loops may stall
   - `monkey-type-3d`: Troika font loading is async; may need explicit wait
   - `fat-lines-ssr`, `ssgi-ssr-plugin`: Heavy post-processing under SwiftShader

8. **5 interactive test failures** need attention:
   - `render-target-export` and `render-target-preview`: blocked by bug #1 above
   - `camera-uiconfig`, `custom-pipeline`: snapshot churn from dev branch changes; re-run after update
   - `tonemap-plugin`: possible selector breakage

### Low Priority

9. **30 tests had snapshots updated** -- This is large churn. Worth spot-checking key visual tests (ssgi-plugin, stencil-clipping-portal, troika-text-*) after stabilization to ensure no unintended regressions.

10. **GPU ReadPixels stall warnings** (48 tests) -- Benign with SwiftShader; cannot and should not be suppressed.

11. **No `timeout-state.png` files generated** -- The 120s `_testFinish` timeout handler should save a debug screenshot, but none exist. This suggests the failing tests hit the 180s test-level timeout before the 120s `waitForSelector` timeout, or the screenshot call itself failed. Consider reducing the `_testFinish` timeout to ensure the handler runs before the test-level timeout kills the process.

---

## 7. Download Tests

### Baseline status (6 of 8 expected download test groups)

| Test | Files | Status |
|---|---|---|
| `3dm-to-glb` | file.glb | OK |
| `custom-pipeline` | file.png | Hash mismatch (91,737 B new vs 90,165 B old) |
| `geometry-uv-preview` | renderTarget.png | OK |
| `glb-export` | helmet.glb, helmet.pmat, scene.glb, scene_with_config.glb | OK |
| `image-snapshot-export` | snapshot.png, snapshot.jpeg, snapshot.webp | OK |
| `pmat-material-export` | material.pmat | OK |
| `render-target-export` | -- | Missing (test crashes with `texture is not defined`) |
| `render-target-preview` | -- | Missing (test crashes with same bug) |

### `download-file-hashes.json`

Contains 10 hash entries across 6 test groups. All present hashes match the files on disk. The `render-target-export` and `render-target-preview` entries are absent because those tests crash before downloading.

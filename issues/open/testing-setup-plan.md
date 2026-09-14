# Testing Setup Plan for threepipe

**Created:** 2026-03-26
**Status:** Phase 2 complete, tests improved with updated skill. Phase 3: CI pending.
**Updated:** 2026-03-28

### Current state
- **25 interactive tests** in `tests/interactive.spec.ts` covering: rendering pipeline, post-processing, material system, export/download, stencil, transmission, CSM, context menus, CRUD workflows
- **~165 smoke tests** in `tests/extras.spec.ts` (load + initial screenshot)
- **108 unit tests** in 6 files under `src/` (Vitest, Node.js)
- **Skill doc** at `tests/SKILL-interactive-tests.md` (v5) — tested and validated through iterative agent improvement
- All tests use actual Tweakpane UI interactions where controls exist (not just page.evaluate)
- Download comparison: PNG/JPEG visual diff, EXR pixel comparison, WEBP→PNG conversion, GLB/PMAT byte comparison
- GLB export determinism fix in GLTFWriter2 (deferred image bufferView ordering)
- Deterministic injection: seeded random, frozen timers (2024-01-01 base), disabled convergence plugins
**Branch reference:** `origin/testing-old` (commit `afc7345`, 1 commit on top of v0.0.31 from June 2024)

## Context

There is an old `testing-old` branch on the remote with a Playwright-based e2e testing setup that was never merged. The codebase has evolved significantly since then (122 new examples, asset URL migration, `_testStart`/`_testFinish` in 228+ examples). This plan covers setting up proper testing infrastructure from scratch, informed by that old work and by how three.js (r183) and other 3D libs handle testing.

### What exists in `testing-old`

- `playwright.config.ts` — Chromium/Firefox/WebKit, viewport 1280x720, serves via `ws -d . -p 9229`
- `tests/example.spec.ts` — 51 tests (15 interactive + 36 smoke), each test = one example page
- `tests/deterministic-injection.js` — deterministic Math.random, timers, RAF (from three.js e2e)
- `tests/download-file-hashes.json` — SHA256 hashes for exported file comparison (per browser/platform)
- `scripts/check-test-coverage.mjs` — ensures every example folder has a test and vice versa
- `.github/workflows/playwright.yml` — CI workflow
- `tsconfig.tests.json` — separate tsconfig for test files
- Screenshots were never committed (separate storage was planned)

### What exists in current codebase

- `src/testing/testing.ts` — exports `_testFinish()` and `_testStart()`, used by 228-229 of 234 examples
- `window.threeViewers` — already registered in `ThreeViewer.ts:491-492` (constructor pushes, dispose removes)
- `window.TESTING` — injected by deterministic-injection.js but not consumed anywhere currently
- No test framework installed, no test scripts in package.json
- SVG renderer plugin has 6 `.test.ts` files (real unit tests)
- Procedural generation plugin has ad-hoc test harness (skip for now, not ready)

### Key reference: three.js r183 testing approach

- Puppeteer + custom image comparison, QUnit for unit tests
- SwiftShader: `--use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox`
- Screenshots in-repo as JPEG 400x250 (dual-use as gallery thumbnails)
- 5 parallel CI shards on ubuntu-latest
- Thresholds: 0.1 per-pixel, 0.3% max different pixels
- Chrome 137+ requires explicit SwiftShader flags (`--use-angle=swiftshader --enable-unsafe-swiftshader`)

---

## Phase 1: Unit Test Framework (Vitest)

### Goal
Set up Vitest for Node.js unit tests across threepipe core and plugins.

### Tasks

1. **Install Vitest**, create `vitest.config.ts` with `environment: 'node'`
2. **Migrate existing unit tests** to Vitest:
   - `plugins/svg-renderer/src/three-mesh-halfedge/**/*.test.ts` (6 files)
   - Skip `plugins/procedural-generation/tests/` (not ready)
3. **Add initial core unit tests** — start small, e.g. basic viewer lifecycle, serialization roundtrips, math utilities
4. **Add scripts:**
   - `npm run test:unit` — runs Vitest in Node environment
5. **Create/update `tsconfig.tests.json`** for test file compilation

### Files to create/modify
- `vitest.config.ts` (new)
- `tsconfig.tests.json` (port from old branch or create fresh)
- `package.json` (add vitest dep + scripts)
- Migrate SVG renderer test files to use Vitest APIs (`describe`, `it`, `expect`)

---

## Phase 2: E2E Visual Regression (Playwright)

### Goal
Port and extend the old `testing-old` spec with Playwright, generate baselines, set up snapshot storage.

### Tasks

#### 2.1 Install & configure Playwright

- Install `@playwright/test`, `proper-lockfile`, `hexer` (from old setup deps)
- Create `playwright.config.ts`:
  - Viewport: 1280x720 (configurable via `VIEWPORT_WIDTH`/`VIEWPORT_HEIGHT` env vars)
  - Workers: configurable via `PLAYWRIGHT_WORKERS` env var (default 2)
  - Sharding: use Playwright's native `--shard` CLI flag
  - Screenshot format: PNG (configurable via config, Playwright supports png/jpeg)
  - Tolerance: `maxDiffPixelRatio: 0.003` (~0.3%), `threshold: 0.1` (matching three.js)
  - Browser launch args: `--use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox --disable-dev-shm-usage`
  - Chromium only initially
  - Dev server: `npm run serve` (`ws -d . -p 9229`), requires pre-built examples

#### 2.2 Port test infrastructure

- `tests/deterministic-injection.js` — port from old branch as-is
- `tests/example.spec.ts` — rewrite from old branch:
  - Port `screenshotMatch()` helper (pauses animations, waits for progressive convergence, takes screenshot)
  - Port `downloadFileMatch()` helper (file hash comparison with lockfile)
  - Update all asset URLs if needed (most examples already migrated to `samples.threepipe.org`)
  - Port the 15 interactive tests: `image-snapshot-export`, `3dm-to-glb`, `camera-uiconfig`, `custom-pipeline`, `depth-buffer-plugin`, `frame-fade-plugin`, `fullscreen-plugin`, `geometry-uv-preview`, `glb-export`, `normal-buffer-plugin`, `pmat-material-export`, `popmotion-plugin`, `render-target-export`, `render-target-preview`, `tonemap-plugin`
  - Port the 36 smoke tests (title check + initial screenshot via beforeEach)
  - Extend smoke test list to cover all ~228 examples with `_testFinish`
  - Exclusion list for known-problematic examples (react/vue/svelte samples, webgi-dependent, external service dependent, etc.)
- `tests/download-file-hashes.json` — keep in main repo (small JSON, port from old branch, values will need regeneration)
- `scripts/check-test-coverage.mjs` — port from old branch

#### 2.3 Snapshot repository

- Create `threepipe-test-snapshots` GitHub repo (same org)
- Directory structure: `<browser>-<platform>/` (e.g. `chromium-linux/`, `chromium-darwin/`)
- Main repo stores `tests/snapshot-commit.json`: `{"repo": "...", "commit": "<hash>"}`
- Scripts:
  - `tests/sync-snapshots.sh` — clones/checks out snapshot repo at pinned commit into `tests/snapshots/`
  - `tests/update-snapshots.sh` — runs tests with `--update-snapshots`, commits to snapshot repo, updates `snapshot-commit.json`
- `.gitignore`: add `tests/snapshots/` (the cloned snapshot repo)

#### 2.4 Build & serve pipeline

- Tests use pre-built examples (static serve via `ws`), NOT Vite dev server
- Build: `npm run build-examples` (already exists: `tsc --project examples/tsconfig.build.json`)
- Serve: `npm run serve` (already exists: `ws -d . -p 9229`)
- Playwright config `webServer` block handles starting the server

#### 2.5 Scripts

- `npm run test:e2e` — sync snapshots + build examples + run Playwright
- `npm run test:e2e:update` — regenerate baselines
- `npm run test` — `npm run test:unit && npm run test:e2e`

### Files to create/modify
- `playwright.config.ts` (new)
- `tests/example.spec.ts` (new, ported from old branch)
- `tests/deterministic-injection.js` (new, ported from old branch)
- `tests/download-file-hashes.json` (new, ported from old branch)
- `tests/snapshot-commit.json` (new)
- `tests/sync-snapshots.sh` (new)
- `tests/update-snapshots.sh` (new)
- `scripts/check-test-coverage.mjs` (new, ported from old branch)
- `package.json` (add deps + scripts)
- `.gitignore` (add test output dirs, snapshot dir)

---

## Phase 3: CI, Multi-platform, Console Log Comparison

### Goal
CI workflow, multi-browser support, console log regression testing.

### Tasks

#### 3.1 GitHub Actions workflow

- `.github/workflows/test.yml`:
  - Job 1: `unit-tests` — `npm run test:unit` (fast, no browser, ubuntu-latest)
  - Job 2: `e2e-tests` — matrix with configurable shards
    - `ubuntu-latest` primary, optionally macOS/Windows
    - Steps: checkout, install deps, checkout snapshot repo, build examples, install Playwright browsers, run tests
    - Upload artifacts (diffs, traces, report) on failure (`actions/upload-artifact`)
    - `fail-fast: false` for matrix jobs
  - Triggered on: PR to master, push to dev

#### 3.2 Multi-browser

- Add Firefox + WebKit projects in `playwright.config.ts`
- Separate snapshot directories per `<browser>-<platform>` in snapshot repo
- Per-browser exclusion lists (e.g. WebP tests skip on WebKit, WASM issues on WebKit/win32)

#### 3.3 Snapshot update workflow

- `.github/workflows/update-snapshots.yml` — manually triggered
- Runs tests with `--update-snapshots`, commits to snapshot repo, creates PR updating `snapshot-commit.json`

#### 3.4 Console log capture & comparison

- During each test, capture all `console.log`, `console.warn`, `console.error` from the page
- Store expected console output in `tests/console-logs.json` or similar (needs experimentation)
- Fail on unexpected `console.error` entries
- Compare log output for regressions
- Needs filtering/normalization rules for non-deterministic content (timing values, asset URLs, etc.)
- The old branch had `tests/console-log-state.json` (empty `{}`), confirming this was planned
- **This requires experimentation** — start with error-only capture, expand based on findings

#### 3.5 Interactive test expansion

- Add detailed interactive tests for important plugins beyond the original 15
- See `issues/open/playwright-tests-interaction.md` for interaction plugin test plans (PivotControls, multi-select, etc.)

### Files to create/modify
- `.github/workflows/test.yml` (new)
- `.github/workflows/update-snapshots.yml` (new)
- `playwright.config.ts` (update for multi-browser)
- `tests/example.spec.ts` (add console log capture)
- `tests/console-logs.json` (new, expected console output)

---

## Phase 4: Unit Test Expansion (ongoing)

### Goal
Expand unit test coverage across core and plugins.

### Areas
- Core: math utilities, serialization roundtrips, plugin lifecycle, event system
- Plugins: geometry generators, material extensions, asset importers/exporters
- Node.js headless: using threepipe's polyfill support for server-side tests

### Not in scope
- Procedural generation tests (separate effort, not ready)
- Vitest browser mode (Playwright standalone is better for full-page e2e)
- Dual-use screenshot thumbnails (maybe later)

---

## Configuration Summary

All test settings should be configurable via env vars:

| Setting | Env var | Default |
|---|---|---|
| Viewport width | `VIEWPORT_WIDTH` | `1280` |
| Viewport height | `VIEWPORT_HEIGHT` | `720` |
| Workers | `PLAYWRIGHT_WORKERS` | `2` |
| Browser | `PLAYWRIGHT_BROWSER` | `chromium` |
| Screenshot format | Playwright config | `png` |
| Pixel threshold | Playwright config | `0.1` |
| Max diff pixel ratio | Playwright config | `0.003` |
| Sharding | `--shard` CLI flag | none |
| CI mode | `CI` env var | auto-detected |

---

## Dependencies to add

### Phase 1
- `vitest` (devDep)

### Phase 2
- `@playwright/test` (devDep)
- `proper-lockfile` + `@types/proper-lockfile` (devDep, for download file hash locking)
- `hexer` (devDep, for hex dump of mismatched files)

---
name: test-analysis
description: >
  Run, analyze, and report on threepipe test results. Invoke this skill when asked to:
  run tests, check test results, audit snapshots, analyze test failures, compare test
  runs, diagnose broken tests, generate test reports, investigate visual regressions,
  check console logs for errors, or assess test health. Also trigger when the user says
  things like "what tests are failing", "run the e2e tests", "check if tests pass",
  "audit the snapshots", "compare before/after", or "are there any real bugs in tests".
---

# Test Analysis Skill for threepipe

This skill guides agents through running tests, interpreting results, diagnosing failures,
and producing structured reports for the threepipe 3D viewer framework.

Explore codebase before continuing

## Project overview

threepipe is a three.js-based 3D viewer framework with two test suites:

- **Unit tests** (Vitest): 6 files, ~62 tests in `src/**/*.test.ts`, run in Node.js
- **E2E visual regression tests** (Playwright): ~180 tests in `tests/example.spec.ts`, run in headless Chromium with SwiftShader software rendering

## Running tests

### Unit tests

```bash
npm run test:unit          # Run all unit tests (vitest run)
```

- Config: `vitest.config.ts`
- Setup: `tests/setup.ts` (Node.js polyfills for three.js: ImageData, document, window, etc.)
- Test files: `src/**/*.test.ts`

### E2E tests

```bash
npm run test:e2e              # All 175 tests (interactive + smoke)
npm run test:e2e:interactive  # 15 interactive tests only (--grep interactive)
npm run test:e2e:smoke        # 160 smoke tests only (--grep smoke)
npm run test:e2e:update       # Regenerate all baselines (--update-snapshots)
npm run test:e2e:list         # List all test names without running
npm run test:e2e:precache     # Pre-cache CDN modules (add --assets for remote assets too)
```

- Config: `playwright.config.ts`
- Spec: `tests/example.spec.ts`
- Viewport: 1280x720, Chromium with SwiftShader (ANGLE)
- Timeout: 180s per test, 15s for screenshot assertions
- Threshold: `maxDiffPixelRatio: 0.003`, `threshold: 0.1`
- Workers: 2 local, 1 in CI
- Retries: 0 local, 2 in CI

Run a single test by name:
```bash
npx playwright test --grep "tonemap-plugin"
```

Run with visible browser:
```bash
npx playwright test --headed --grep "tonemap-plugin"
```

Results in `./test-results`

## Test categories

### Smoke tests (160)

Smoke tests are simple one-liner tests. Each test:

1. `beforeEach` injects `deterministic-injection.js` (must be before navigation)
2. Sets up remote cache interception (memory → disk → network download)
3. Navigates to `examples/<test-name>/`
4. Waits for `body._testFinish` CSS class (120s timeout). On timeout, saves `timeout-state.png` and fails.
5. Resets GLTF animation to t=0
6. Hides stats.js overlay and code blocks via injected CSS
7. Waits 1000ms for rendering to settle
8. Takes `initial` screenshot with stabilization (pause GLTF, stop Popmotion, wait convergence)
9. Test body verifies `page.toHaveTitle(expectedTitle)`
10. `afterEach` saves console.log alongside snapshots, checks for download errors

### Interactive tests (15)

Interactive tests have multi-step test bodies. Same `beforeEach` as smoke but the test body
performs additional actions: button clicks, UI interactions, downloads, and multiple screenshots.

Interactive test list: `image-snapshot-export`, `3dm-to-glb`, `camera-uiconfig`,
`custom-pipeline`, `depth-buffer-plugin`, `frame-fade-plugin`, `fullscreen-plugin`,
`geometry-uv-preview`, `glb-export`, `normal-buffer-plugin`, `pmat-material-export`,
`popmotion-plugin`, `render-target-export`, `render-target-preview`, `tonemap-plugin`

### Excluded examples

Not tested because they need Vite transforms (React/Vue/Svelte), use external services
(AWS, OGC tiles), require pointer-lock, are procedural-generation (shelved), or are
non-deterministic (video, shadertoy). Exclusion is implicit in `tests/example.spec.ts`
(no `test()` call = not tested). The canonical exclusion Set is in `scripts/check-test-coverage.mjs`.

## Interpreting results

### Exit codes

| Exit | Meaning |
|------|---------|
| 0 | All tests passed |
| 1 | Some tests failed |

### Key artifacts to check after a run

1. **`test-results/.last-run.json`** -- machine-readable failure summary
   ```json
   {"status": "failed", "failedTests": ["test-id-1", "test-id-2"]}
   ```

2. **`test-results/` directories** -- one per failed test, containing:
   - `initial-actual.png` -- what was rendered
   - `initial-diff.png` -- pixel difference overlay (pink = changed pixels)
   - `initial-previous.png` -- the old baseline
   - `error-context.md` -- DOM snapshot

3. **`playwright-report/`** -- full HTML report
   ```bash
   npx playwright show-report
   ```

4. **Console logs** -- saved per test at `tests/snapshots/<platform>/<test-name>/console.log`

### Reading console logs

Each line is formatted as `[type] message (location)`. Important types:

| Pattern | Severity | Meaning |
|---------|----------|---------|
| `[pageerror]` | **HIGH** | Uncaught JS exception -- real bug |
| `[error]` | **MEDIUM** | `console.error` call -- may be a real issue |
| `[warning]` | **LOW** | `console.warn` -- often benign |
| `[log]` | **INFO** | `console.log` -- informational |

### Known benign patterns (ignore these)

- `"GPU stall due to ReadPixels"` -- SwiftShader limitation, ~48 tests show this
- `"plugin not found: class ..."` -- dumps minified class source, known noise issue
- `"No material template found for type PointsMaterial"` -- unregistered material type
- `"unsupported GSUB table LookupType"` -- troika font parser limitation (types 5, 6)
- `"Object3DManager - same uuid already registered"` -- reimport test expected warnings

### Real bug indicators

- `[pageerror]` with stack traces pointing to threepipe source code
- `[error]` messages about null references, missing plugins, or failed asset loads
- Tests that produce `timeout-state.png` (the test never reached `_testFinish`)
- Download hash mismatches (binary output changed)
- Visual regressions where the diff shows structural changes (not just pixel noise)

## Failure diagnosis workflow

### Step 1: Identify what failed

```bash
# Check last run status
cat test-results/.last-run.json 2>/dev/null || echo "No last-run data"

# List failure artifact directories
ls test-results/ 2>/dev/null | grep -v '.last-run'
```

### Step 2: Classify failures

For each failed test, determine the category:

**Category A -- Visual regression (diff exists)**
- `test-results/example-<name>-chromium/initial-diff.png` exists
- Compare actual vs previous image sizes and visual content
- Small size difference (<1%) with minor pixel drift = likely benign (animation timing, font rendering)
- Large structural difference = real regression from code change

**Category B -- Timeout (no _testFinish)**
- `tests/snapshots/<platform>/<name>/timeout-state.png` exists
- Check console.log for errors that prevented loading
- Common causes: CDN module failed to load, heavy post-processing on SwiftShader, async operation never completed

**Category C -- Missing baseline (first run / new test)**
- No previous snapshot exists for comparison
- In update mode, this creates the baseline and flags as "failed" (expected behavior)

**Category D -- Download hash mismatch**
- Binary file output (GLB, PNG, PMAT) changed
- Check `tests/download-file-hashes.json` for stored hashes
- Compare old vs new hex dumps in test-results artifacts

**Category E -- Page error (JS exception)**
- `[pageerror]` in console.log
- Test may pass visually but the page threw an error
- Check afterEach annotations in the HTML report

### Step 3: Dig deeper

For visual regressions, check what code changed:
```bash
# What changed since the snapshots were last updated
git log --oneline tests/snapshots/ | head -5

# What source files changed recently
git log --oneline --name-only -5
```

For timeouts, check the console.log:
```bash
cat tests/snapshots/chromium-darwin/<test-name>/console.log
```

For download mismatches, check the hex dumps:
```bash
ls test-results/example-<test>-chromium/*.txt
```

## Comparing runs

### Before/after snapshot comparison

After running tests twice (e.g., before and after a code change):

```bash
# Compare snapshot file sizes (crude but fast)
find tests/snapshots/chromium-darwin -name 'initial.png' -exec ls -la {} \; | sort

# Count tests with console errors
grep -rl '\[pageerror\]' tests/snapshots/chromium-darwin/*/console.log | wc -l

# Count tests with console warnings
grep -rl '\[warning\]' tests/snapshots/chromium-darwin/*/console.log | wc -l
```

### Console log pattern analysis

```bash
# Find all unique pageerror messages
grep '\[pageerror\]' tests/snapshots/chromium-darwin/*/console.log | sort -u

# Find tests with errors (not just warnings)
grep -l '\[error\]' tests/snapshots/chromium-darwin/*/console.log

# Count "GPU stall" occurrences (benign baseline)
grep -rl 'GPU stall' tests/snapshots/chromium-darwin/*/console.log | wc -l
```

### Coverage verification

```bash
# Verify every example has a test (should exit 0)
npm run check-test-coverage

# List all tests
npm run test:e2e:list
```

## Generating a structured report

After running tests and analyzing results, produce a report with this structure:

```markdown
# Test Run Report

**Date:** YYYY-MM-DD
**Platform:** chromium-darwin | chromium-linux
**Run command:** <exact command used>
**Overall status:** passed | failed (N failures)

## Summary

| Metric | Count |
|--------|-------|
| Total tests | 175 |
| Passed | N |
| Failed | N |
| Timeouts | N |
| Page errors | N |

## Failures

### Visual Regressions
| Test | Diff Size | Root Cause | Severity |
|------|-----------|------------|----------|

### Timeouts
| Test | Console Observations | Likely Cause |
|------|---------------------|--------------|

### Download Mismatches
| Test | File | Old Hash | New Hash |
|------|------|----------|----------|

### Page Errors
| Test | Error Message | Real Bug? |
|------|--------------|-----------|

## Console Log Audit

| Pattern | Count | Verdict |
|---------|-------|---------|
| [pageerror] | N | <assessment> |
| [error] | N | <assessment> |
| [warning] (GPU stall) | N | Benign (SwiftShader) |
| [warning] (other) | N | <assessment> |

## Findings

<Bullet list of real bugs found, if any. Reference the test name and console.log path.>

## Recommendations

<What to fix, what to update baselines for, what to investigate further.>
```

## Updating baselines

When failures are expected (e.g., after intentionally changing rendering):

```bash
# Update all baselines
npm run test:e2e:update

# Update specific test baseline
npx playwright test --update-snapshots --grep "tonemap-plugin"
```

After updating, review the new snapshots visually and check that:
1. No timeout-state.png files were created
2. Console logs do not contain new `[pageerror]` entries
3. Download hashes in `tests/download-file-hashes.json` are expected

## Snapshot management

Snapshots live in a separate git repo (`tests/snapshots/`). The pinned commit is stored
in `tests/snapshot-commit.json`. To sync:

```bash
bash tests/sync-snapshots.sh     # Clone/checkout at pinned commit
bash tests/update-snapshots.sh   # Regenerate, commit, push, update pin
```

If `tests/snapshot-commit.json` has an empty commit field, snapshots have not been
published to the remote repo yet. Baselines exist only locally.

## Platform differences

Snapshots are platform-specific: `chromium-darwin` (macOS) and `chromium-linux`.
SwiftShader rendering produces slightly different output across platforms, so baselines
are not cross-platform. Always generate and compare baselines on the same platform.

Alpine Linux uses system Chromium with Mesa EGL instead of SwiftShader, which produces
different rendering output. The config auto-detects Alpine and adjusts launch args.

## Common pitfalls

- **Running E2E without `npm run serve`**: Playwright config starts a web server
  automatically (`ws -d . -p 9229`), but if port 9229 is already in use, it reuses
  the existing server. Make sure the server is serving the correct build.

- **Stale example builds**: E2E tests serve compiled JS from `examples/`. If you changed
  TypeScript source, rebuild first: `npm run build-examples`

- **CDN cache staleness**: The CDN cache at `node_modules/.cache/test-cdn/` persists
  between runs. If a CDN module was updated upstream, delete the cache:
  `rm -rf node_modules/.cache/test-cdn/`

- **Snapshot platform mismatch**: Running on Linux will look for `chromium-linux/`
  baselines. If only `chromium-darwin/` exists, all tests will "fail" (creating new baselines).

- **Update mode "failures"**: Running `--update-snapshots` reports tests as "failed" when
  it creates new baselines where none existed before. This is expected Playwright behavior.

## Reference files

- `issues/open/test-snapshot-audit.md` -- latest comprehensive audit of all snapshots
- `issues/open/examples-needing-interactive-tests.md` -- examples with animations that
  need interactive test coverage beyond smoke
- `issues/open/playwright-tests-interaction.md` -- plan for interactive test expansion
- `scripts/check-test-coverage.mjs` -- verifies every example directory has a corresponding test

## Unit test details

Unit test files and what they cover:

| File | Subject |
|------|---------|
| `src/utils/shader-helpers.test.ts` | Shader string manipulation |
| `src/utils/browser-helpers.test.ts` | Browser utility functions |
| `src/utils/serialization.test.ts` | Serialization/deserialization |
| `src/utils/animation.test.ts` | Animation utilities |
| `src/core/object/incrementObjectCloneName.test.ts` | Object clone naming |
| `src/plugins/geometry/primitives/geometry-generators.test.ts` | Geometry generators |

All run in Node.js with polyfills from `tests/setup.ts`. No browser or WebGL required.

## Quick reference commands

```bash
# Full test suite
npm test                              # unit + e2e

# Unit only
npm run test:unit

# E2E subsets
npm run test:e2e                      # all 175
npm run test:e2e:smoke                # 160 smoke
npm run test:e2e:interactive          # 15 interactive
npx playwright test --grep "<name>"   # single test

# Analysis
cat test-results/.last-run.json       # last run status
npx playwright show-report            # open HTML report
npm run check-test-coverage           # verify all examples have tests

# Maintenance
npm run test:e2e:update               # regenerate all baselines
npm run test:e2e:precache             # pre-cache CDN modules
npm run test:e2e:precache -- --assets # also cache remote assets
bash tests/sync-snapshots.sh          # sync snapshot repo
```

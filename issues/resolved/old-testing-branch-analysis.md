# Analysis: Old `testing-old` Branch Testing Approach

**Created:** 2026-03-26
**Source files:** `tests/old-testing-branch-ref/` (example.spec.ts, playwright.config.ts, deterministic-injection.js, examples-diff.patch)
**Compared against:** Current `tests/example.spec.ts`, `playwright.config.ts`, `tests/deterministic-injection.js`

---

## 1. `window.TESTING` Usage

`window.TESTING = true` was set in `deterministic-injection.js` (line 88) and injected via `page.addInitScript()` before page load.

### Where examples consumed it

Three distinct patterns found in the patch:

**Pattern A: Disable GLTF animation autoplay (2 examples)**
```ts
// gltf-animation-plugin/script.ts, gltf-camera-animation/script.ts
if (!(window as any).TESTING) // todo: seek animation to a few seconds for testing.
    viewer.getPlugin(GLTFAnimationPlugin)!.autoplayOnLoad = true
```
The old branch later removed these checks (the diff shows them being deleted), switching to unconditionally enabling autoplay. This means the old branch relied on the spec's `beforeEach` to call `gltfAnim.setTime(0)` and `gltfAnim.pauseAnimation()` instead of preventing animation entirely.

**Pattern B: Reduce ProgressivePlugin iterations (2 examples)**
```ts
// progressive-plugin/script.ts, progressive-hdr-shadows-exp/script.ts
new ProgressivePlugin((window as any).TESTING ? 20 : 200)
```
These were NOT removed in the old branch -- they persisted. The idea was to reduce convergence time from 200 to 20 frames during testing so `convergedPromise` resolves faster.

**Pattern C: No other examples used `window.TESTING`**
Despite the injection being present in 165+ example pages, only 4 examples actually consumed the flag. The vast majority of examples were made test-compatible through the spec infrastructure (deterministic timers + `screenshotMatch` pausing) rather than per-example `window.TESTING` checks.

### Current state

Our current `deterministic-injection.js` also sets `window.TESTING = true` (line 65). The `examples-needing-interactive-tests.md` issue proposes using it more widely (6 PopmotionPlugin examples, 10 GLTF animation examples), which would go beyond what the old branch actually did.

---

## 2. Which Examples Had TESTING Checks Added

Only these 4 (in the old branch):
1. `gltf-animation-plugin` -- disable autoplay (later removed in same branch)
2. `gltf-camera-animation` -- disable autoplay (later removed in same branch)
3. `progressive-plugin` -- reduce iterations to 20
4. `progressive-hdr-shadows-exp` -- reduce iterations to 20

The old branch's strategy was clearly to keep examples unmodified and handle test determinism in the spec/injection layer.

---

## 3. Animated Examples: Test Patterns

### Old branch approach (screenshotMatch)

The old `screenshotMatch` function did 3 things our current version does NOT:

1. **Paused GLTF animations before screenshot:**
   ```ts
   const gltfAnim = viewer.getPlugin('GLTFAnimation')
   gltfAnim && gltfAnim.pauseAnimation()
   ```

2. **Waited for ProgressivePlugin convergence:**
   ```ts
   const progressivePlugin = viewer.getPlugin('ProgressivePlugin')
   if (progressivePlugin) await progressivePlugin.convergedPromise
   else await new Promise<void>(resolve => {viewer.doOnce('postFrame', ()=>resolve())})
   ```

3. **Resumed animations after screenshot:**
   ```ts
   gltfAnim && gltfAnim.playAnimation()
   ```

4. **Passed `animations: 'allow'` to Playwright** (for animated examples) vs `'disabled'` for static ones.

### Current approach (screenshotMatch)

Our current `screenshotMatch` is minimal:
```ts
const screenshotMatch = async(page: Page, _: TestInfo, name: string) => {
    await expect(page).toHaveScreenshot(name + '.png')
}
```
It relies entirely on `_testFinish` signaling that the page is stable. No explicit animation pausing, no progressive convergence wait, no animation resume.

### Gap analysis

The old branch's `beforeEach` also did:
- `gltfAnim.setTime(0)` -- reset animation to frame 0 (our current version does this too)
- 1000ms `waitForTimeout` after setup (our current version does this too)
- Take initial screenshot (our current version does this too)

**Missing from current: the pause/wait-for-convergence/resume cycle in screenshotMatch.** This is critical for examples with ProgressivePlugin or ongoing GLTF animations. Without it, screenshots may capture mid-convergence or mid-animation frames.

---

## 4. Infrastructure Not Yet Ported

### 4a. ProgressivePlugin convergence wait
The old spec explicitly waited for `progressivePlugin.convergedPromise` before taking screenshots. Our current spec does not. For examples using ProgressivePlugin (e.g., `progressive-plugin`, `progressive-hdr-shadows-exp`), this means we may capture screenshots before the progressive render has converged, leading to non-deterministic diffs.

### 4b. Animation pause/resume around screenshots
The old spec paused GLTF animations before every screenshot and resumed after. Our current spec does not (beyond the initial `setTime(0)` in `beforeEach`). For interactive tests that take multiple screenshots (e.g., `popmotion-plugin`), animations continue between captures.

### 4c. `animations` parameter in toHaveScreenshot
The old spec passed `{animations: animated ? 'allow' : 'disabled'}` to `toHaveScreenshot`. The `'disabled'` mode tells Playwright to freeze CSS animations. Our current spec does not pass this parameter. For examples with CSS transitions (e.g., loading screen fade), this could cause flakiness.

### 4d. Headed mode differentiation
The old spec generated separate snapshot filenames for headed vs headless mode:
```ts
(testInfo.project.use.headless === false ? '.headed.' : '') + testInfo.title + '-' + name + '.png'
```
Our current spec does not differentiate, which is fine for CI but means local headed debugging would overwrite headless baselines.

### 4e. `check-test-coverage.mjs` script
The old branch had a script that verified every example folder has a corresponding test entry and vice versa. Referenced in `testing-setup-plan.md` but not yet created. This is important to prevent examples from silently going untested.

### 4f. Multi-browser support
The old config had Chromium + Firefox + WebKit all active. Our current config only has Chromium (Firefox/WebKit commented out, noted as "Phase 3"). The old spec also had browser-specific logic (e.g., WebP export skipped on WebKit, WASM skipped on WebKit/win32).

### 4g. `download-file-hashes.json` per-browser keys
The old spec keyed download hashes by `testInfo.project.name` (browser name), allowing different hashes per browser. Our current spec keys by `platformId()` which includes project name, so this is actually covered.

---

## 5. Differences in Approach

| Aspect | Old Branch | Current Implementation |
|---|---|---|
| **screenshotMatch** | Pauses GLTF animations, waits for progressive convergence, resumes animations | Simple `toHaveScreenshot()` call |
| **Screenshot naming** | Includes headed/headless prefix, test title, name | Simple `name.png` |
| **Snapshot storage** | In-repo alongside spec file | Separate `tests/snapshots/<platform>/` directory tree |
| **Console capture** | Not implemented (empty `console-log-state.json` planned) | Implemented, saves per-test console.log file |
| **Remote cache** | None (2min timeout for downloads) | Full request interception with disk+memory cache |
| **Timeout handling** | 2min timeout, hard fail | 2min timeout, saves timeout screenshot, then fails with debug info |
| **`window.TESTING`** | Minimal use (4 examples, 2 later reverted) | Not consumed yet, but planned for wider use |
| **Test categories** | All in one flat list | Split into `interactive` and `smoke` describe blocks |
| **Browsers** | Chromium + Firefox + WebKit | Chromium only |
| **GPU rendering** | Default Playwright (SwiftShader) | Explicit SwiftShader flags + Alpine Linux support |
| **Update mode** | Not supported | Supported via `--update-snapshots` |
| **Total tests** | 51 (15 interactive + 36 smoke) | ~165 (16 interactive + ~149 smoke) |

---

## 6. Recommendations

### High priority
1. **Port the screenshotMatch convergence logic.** Add `convergedPromise` wait for ProgressivePlugin examples and GLTF animation pause/resume. This is the biggest functional gap between old and current.

2. **Create `check-test-coverage.mjs`.** Prevents examples from silently going untested as the codebase grows.

### Medium priority
3. **Be conservative with `window.TESTING` expansion.** The old branch's actual use was minimal (only ProgressivePlugin iteration reduction survived). The test spec's pause/resume approach is more maintainable than scattering `window.TESTING` checks across 30+ examples.

4. **Add `animations: 'disabled'` parameter** to `screenshotMatch` for non-animated examples to handle CSS transition flakiness.

### Low priority
5. **Multi-browser** (already planned for Phase 3).
6. **Headed mode snapshot separation** (only matters for local debugging).

# `@threepipe/plugin-tweakpane` 0.10.2 — release prep + cross-repo coupling

**Created:** 2026-06-05
**Status:** Open — release blocked on threepipe core LUTPlugin shipping; CHANGELOG also needs consolidation before merge
**Scope:** `@threepipe/plugin-tweakpane`

## Why this is filed

`package.json` is bumped `0.10.1 → 0.10.2`, so CI's `publish-check.mjs` already queues it for the next push to `master`. Audit (2026-06-05) surfaced three concerns that need handling before that publish can be allowed to fire.

## What actually changed (since 0.10.1)

Audited via `git diff HEAD -- plugins/tweakpane/` and reading `plugins/tweakpane/src/lutPreview.ts` (new) + `plugins/tweakpane/src/tpImageInputGenerator.ts` (modified).

All changes turn the existing `tpImageInputGenerator` image-slot UI into a working surface for the new core `LUTPlugin` (`src/plugins/postprocessing/LUTPlugin.ts`), whose `lutMap*` slots receive `LUTCubeTextureWrapper` instances loaded from `.cube` files via `LUTCubeLoader2`.

**New `plugins/tweakpane/src/lutPreview.ts`**
- Exports `lutPreviewDataUrl(wrapper, w=160, h=81)`. Reads `wrapper.texture3D?.image ?? wrapper.texture?.image` (handles `Uint8`/`Uint8Clamped`/`Float32` voxel data), trilinearly samples the LUT against a 3-band reference strip (grayscale luminance ramp top, desaturated midtone rainbow middle, saturated rainbow bottom), returns a PNG data URL.
- Returns `null` when voxel data isn't reachable so callers can fall back to the generic placeholder.
- Browser-only by design (`document.createElement('canvas')`, `canvas.toDataURL`).

**Modified `plugins/tweakpane/src/tpImageInputGenerator.ts`**
1. `proxyGetValue` LUT branch (`cc.domainMin`): prefers `cc.texture3D?.image || cc.texture?.image` (was only `cc.texture.image`); sets `image.tp_src = lutPreviewDataUrl(cc) ?? staticData.lutCubeTexImage`. Replaces a `todo` that admitted thumbnails were always the placeholder.
2. `proxyGetValue` end: generic `staticData.textureMap[ret] = cc` for any non-string `cc` whose lookup key isn't yet mapped. Needed because `tweakpane-image-plugin@1.1.404+` only transfers the source `<img>`'s `src`/`id` during drag-drop, so the destination has to resolve back to the original wrapper via this map.
3. `setterTex`: `.cube`-only slot guard. When `config.extensions === ['.cube']` and the incoming value is an object without `domainMin`, rejects with `renderer.alert?.('Only .cube LUT files are supported for this input.')`. Catches drag-drop, which bypasses the file-picker `accept` attribute.
4. `proxySetValue`: identity-check on `cc.image?.src === v.src` now guards on `v.src != null`. Without it, non-image `File` drops (`.src` undefined) onto wrapper-holding slots (`cc.image` undefined) hit `undefined === undefined`, falsely short-circuited as identity, silently dropped the assignment.
5. `params.extensions = (config as any).extensions ?? allowedImageExtensions`. Honours per-input override (e.g. `@uiImage('LUT', {extensions: ['.cube']})`).

**Modified `plugins/tweakpane/package.json`**
- `version`: `0.10.1` → `0.10.2`
- `devDependencies.tweakpane-image-plugin`: `1.1.404` → `1.1.405` (upstream MIME-check fix — `setValue(File)` now skips the `loadImage(createObjectURL)` wrap when MIME doesn't start with `image/`, so `.cube`/`.hdr`/`.exr`/`.ktx2`/custom-MIME files pass through to `proxySetValue` as `File` instances).

## ⚠️ Concerns blocking publish

### 1. CHANGELOG.md is inconsistent

`plugins/tweakpane/CHANGELOG.md` currently has BOTH `## [Unreleased]` and `## [0.10.2]` sections populated with different entries. Since `package.json` is bumped to `0.10.2`, all entries belong under `## [0.10.2]`; `## [Unreleased]` should be reset to `NA`. As shipped right now, the entries under `[Unreleased]` will be missing from the release notes (Discord/GitHub release will reference only the `[0.10.2]` block).

Date in the existing `[0.10.2]` header is `2026-05-04`. Needs updating to whatever date the release actually fires.

Missing `[0.10.2]` link footnote at the bottom of the CHANGELOG. Pattern: `[0.10.2]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-tweakpane-0.10.2`. (Per-existing CHANGELOG already lacks footnotes for 0.9.0, 0.10.0, 0.10.1 — pre-existing, but worth catching up.)

### 2. Cross-repo coupling — biggest concern

The new tweakpane code references `wrapper.texture3D`, `wrapper.domainMin`, `wrapper.size` from a `LUTCubeTextureWrapper` that lives in still-uncommitted threepipe core changes:
- `src/plugins/postprocessing/LUTPlugin.ts`
- `src/assetmanager/import/LUTCubeLoader2.ts`
- `src/plugins/postprocessing/shaders/LUTPlugin.glsl`

If `@threepipe/plugin-tweakpane@0.10.2` ships before the matching threepipe core version is published, the LUT branch falls back to the generic `staticData.lutCubeTexImage` placeholder for every consumer on stable threepipe. The fallback is graceful (no crash — the `texture3D ?? texture` short-circuit and `lutPreviewDataUrl(cc) ?? placeholder` handle it), but the feature is dead until threepipe matches.

**Recommended publishing order**: tweakpane 0.10.2 follows whichever threepipe core release introduces `LUTCubeTextureWrapper`.

### 3. `peerDependencies.threepipe` range was not bumped

Not strictly required because the new code degrades gracefully on older threepipe — `wrapper.texture3D` would be `undefined`, `lutPreviewDataUrl` returns `null`, branch falls back to placeholder. So leaving the range alone won't break installs on old threepipe.

If we want consumers to actually get the LUT preview behavior, the peer range should pin to whatever threepipe minor first ships `LUTCubeTextureWrapper`. Worth deciding when the matching core release is cut.

### Other notes

- **`tweakpane-image-plugin` pin is in `devDependencies`, not `dependencies`/`peerDependencies`** — pre-existing pattern. The 1.1.405 MIME fix only takes effect if downstream consumers resolve 1.1.405 themselves. Confirm whether bundling consumers (vite/webpack) will pick up the updated lock or if a peerDep entry is needed.
- **`plugins/tweakpane/test-results/`** — untracked Playwright artifact dir. Don't `git add` it (probably needs gitignore entry).
- **No tests added** for the LUT preview / drag-drop fixes. Flagged for awareness.

## Proposed final CHANGELOG entry (for when concerns above resolve)

```markdown
## [0.10.2] - <release date>

### Added

- `tpImageInputGenerator`: 3D LUT (`.cube`) thumbnail previews — renders a 3-band reference strip (grayscale luminance ramp, desaturated midtone rainbow, saturated rainbow) trilinearly sampled through the LUT voxel grid so distinct LUTs produce visibly distinct thumbnails. Supports `Uint8`/`Float32` voxel data and both `.texture3D` and legacy `.texture` 2D-fallback wrappers.
- `tpImageInputGenerator`: per-input extension override — `params.extensions` now honours `config.extensions` (e.g. `@uiImage('LUT', {extensions: ['.cube']})`) before falling back to the default image extensions list.
- `tpImageInputGenerator`: `.cube`-only slot guard in `setterTex` that rejects non-LUT values via `renderer.alert(...)`. Catches drag-drop, which bypasses the file-picker accept list.
- `tpImageInputGenerator.proxyGetValue`: generic `staticData.textureMap[ret] = cc` registration so non-`Texture` wrappers (e.g. `LUTCubeTextureWrapper`) survive inter-slot drag-drop recovery in `tweakpane-image-plugin@1.1.404+`.

### Fixed

- `tpImageInputGenerator.proxySetValue` identity-check shortcut on the `cc.image?.src === v.src` branch now guards on `v.src != null`. Prevents an `undefined === undefined` false-positive that turned non-image `File` drops onto a wrapper-holding slot into a silent no-op.

### Changed

- Bump `tweakpane-image-plugin` devDep `v1.1.404` → `v1.1.405` (upstream MIME-check fix lets non-`image/*` files pass through to `proxySetValue` as `File` instances).
```

## Proposed commit message (for when ready)

```
Add `.cube` LUT thumbnail previews and slot wiring to `@threepipe/plugin-tweakpane` `tpImageInputGenerator`

- New `lutPreview.ts`: builds a 160×81 PNG data URL by trilinearly sampling the
  LUT voxel grid against a 3-band reference strip (grayscale ramp, desaturated
  rainbow, saturated rainbow). Falls back to `null` if voxel data isn't
  reachable; supports `Uint8`/`Float32` data and `texture3D`/`texture` wrappers.
- `tpImageInputGenerator.proxyGetValue`: LUT branch uses `lutPreviewDataUrl(cc)
  ?? staticData.lutCubeTexImage`; generic `textureMap[ret] = cc` at the end so
  non-`Texture` wrappers survive drag-drop recovery in
  `tweakpane-image-plugin@1.1.404+`.
- `tpImageInputGenerator.setterTex`: `.cube`-only slot guard with
  `renderer.alert(...)` for drag-drop (which bypasses file-picker accept).
- `tpImageInputGenerator.proxySetValue`: identity-check shortcut on
  `cc.image?.src === v.src` now guards on `v.src != null` — fixes a silent
  no-op when dropping a non-image `File` onto a populated wrapper-holding slot.
- `tpImageInputGenerator`: `params.extensions = config.extensions ??
  allowedImageExtensions` honours per-input override
  (e.g. `@uiImage('LUT', {extensions: ['.cube']})`).
- Bump `tweakpane-image-plugin` devDep 1.1.404 → 1.1.405.
- Version 0.10.1 → 0.10.2.
```

## Action items

- [ ] Wait for core `LUTPlugin` / `LUTCubeLoader2` / `LUTCubeTextureWrapper` to land in a published threepipe version.
- [ ] Consolidate `plugins/tweakpane/CHANGELOG.md` — merge `[Unreleased]` content into `[0.10.2]`, reset `[Unreleased]` to `NA`, fix the date, add the `[0.10.2]` link footnote.
- [ ] Decide whether to bump `peerDependencies.threepipe` to the minimum version that ships `LUTCubeTextureWrapper`.
- [ ] Decide whether `tweakpane-image-plugin@^1.1.405` should be promoted from `devDependencies` to `dependencies` / `peerDependencies` so the upstream MIME fix actually reaches downstream consumers.
- [ ] Add `plugins/tweakpane/test-results/` to `.gitignore` (or confirm it's already covered).
- [ ] Run `cd plugins/tweakpane && npm run new:pack` to verify the published tarball contents before pushing.

## References

- `plugins/tweakpane/src/lutPreview.ts` (new file)
- `plugins/tweakpane/src/tpImageInputGenerator.ts` (modified)
- `plugins/tweakpane/CHANGELOG.md` (needs consolidation)
- `plugins/tweakpane/package.json` — `version`, `devDependencies.tweakpane-image-plugin`
- Core dependencies (uncommitted): `src/plugins/postprocessing/LUTPlugin.ts`, `src/assetmanager/import/LUTCubeLoader2.ts`, `src/plugins/postprocessing/shaders/LUTPlugin.glsl`, `examples/tweakpane-editor/ThreeEditor.ts`
- CI surfacing this release: `scripts/ci/publish-check.mjs` already detects `0.10.1 → 0.10.2`.
- Publishing process: `website/guide/publishing.md`

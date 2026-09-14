# RoughnessMaskPlugin — mask-driven roughness remap (MaterialX standard_surface port)

Status: **implemented + verified (e2e, chromium-linux)**, started 2026-07-14. **Blocked on one thing: CDN texture upload.** Not committed.

Port of the AMD GPUOpen "Pale Pink Carrara Marble" MaterialX material into a threepipe MaterialExtension.
Source: https://matlib.gpuopen.com/main/materials/all?material=2949ebe0-bbda-4ba8-839e-1b5733adb90b

## What the MaterialX graph actually reduces to

The `standard_surface` + `NG_Pale_Pink_Carrara_Marble` nodegraph looks big but collapses to almost nothing custom:

- `texcoord(0) * UVScale(2)` → shared uv for all three `<image>` nodes. Maps to `texture.repeat.set(2,2)` + `RepeatWrapping` (the images are `uaddressmode/vaddressmode = "periodic"`).
- `specular_roughness = <mix>(fg = RoughnessMax, bg = RoughnessMin, mix = <extract index=0>(maskImage))`.
  MaterialX `<mix>` is `fg*mix + bg*(1-mix)`, so this is exactly GLSL `mix(min, max, mask.r)`. **This is the only part three.js can't already do** — the built-in roughness map *multiplies* `roughness` by the green channel, it can't do a two-point remap. Hence the extension.
- Everything else is default and maps straight onto `PhysicalMaterial`: `base=0.8` (→ `material.color.setScalar(0.8)`), `base_color` = sRGB image → `map`, `normal` = `<normalmap>` image → `normalMap`, `metalness=0`, `specular=1`, `specular_IOR=1.5` → `ior`, `coat=0`, `sheen=0`.
  `coat_normal` / `tangent` just pass through the world-space geometric normal/tangent and `coat=0`, so the coat and anisotropy branches are inert — no custom lighting code needed.

## Findings about the source asset (verified against the actual pixels, via `sharp`)

- **`Normal.png` is a no-op.** Constant `(127,127,255)` across all 1024×1024 → tangent-space `(0,0,1)` everywhere, zero normal detail. It's bound in the example to stay faithful to the graph, but it perturbs nothing. (Suspect the 1k/8b export dropped it; a higher-res variant may carry real detail.)
- **`Mask.png` only carries data in R** — R ranges 36–155 (mean 58.9), G is constant 127 and B constant 255 (the same flat-normal padding). So the graph's `<extract index=0>` (= `.r`) is the only meaningful channel.
- Therefore `roughness = mix(0, 0.915, mask.r)` lands in **0.129 … 0.556**, mean ≈ **0.211**.
- The mask `<image>` node has **no `colorspace` attribute** (unlike baseColor's `colorspace="srgb_texture"`) → it is raw data and must be sampled linearly. The plugin forces `NoColorSpace` on assignment. Sampling it as sRGB would skew the remap.
- **The `.mtlx` pasted as a data-URI had `RoughnessMin` corrupted** — declared `type="float"` but with the *mask filename* as its value. The real file in the zip has `value="0.0"`. Worth knowing if more of these get pasted around; the download is the source of truth.

## Implementation

- `src/plugins/material/RoughnessMaskPlugin.ts` — `AViewerPluginSync` owning a `MaterialExtension`, modelled directly on `CustomBumpMapPlugin` (the closest precedent: texture uniform + per-material `userData` state + own uv transform + UI).
  - Per-material state in `userData`: `_hasRoughnessMask`, `_roughnessMaskMap`, `_roughnessMaskMin`, `_roughnessMaskMax`, `_roughnessMaskChannel` (`'r'|'g'|'b'|'a'`).
  - `enableRoughnessMask(material, map, min, max, channel)` helper; forces `NoColorSpace` on the map.
  - Uniforms held as stable `{value}` refs on the plugin, `Object.assign`ed into `extraUniforms` in the constructor, mutated in `onObjectRender` (the codebase convention — do NOT recreate uniform objects per frame).
  - Own `roughnessMaskUvTransform` mat3 + `vRoughnessMaskUv` varying, so the mask's `repeat`/`offset` work independently of the other maps. Sets `shader.defines.USE_UV = ''`.
  - `computeCacheKey` includes the texture uuid + channel so swapping either recompiles.
  - Channel is a define (`ROUGHNESS_MASK_CHANNEL`, substituted as a swizzle), not a branch.
- `src/plugins/material/shaders/RoughnessMaskPlugin.pars.glsl` + `.patch.glsl`.
  - Patch is appended after `#include <roughnessmap_fragment>` — that chunk declares `float roughnessFactor = roughness;` and runs before `lights_physical_fragment`, so overwriting `roughnessFactor` there is the correct anchor.
- `src/plugins/index.ts` — exports `RoughnessMaskPlugin` + `RoughnessMaskChannel`.
- `examples/roughness-mask-plugin/` — `index.html`, `script.ts`, and the source `Pale_Pink_Carrara_Marble.mtlx` for reference.
- `tests/extras.spec.ts` — smoke test `roughness-mask-plugin`.

### Bug hit during implementation (fixed)

The `.glsl` rollup loader **strips newlines**. Appending the patch at `#include <roughnessmap_fragment>` without a leading `\n` produced `#endif#if defined(ROUGHNESS_MASK_ENABLED)...` on one line → `ERROR: 0:1567: '#' : unexpected token after conditional expression`. The existing plugins already do `'\n' + PATCH` for exactly this reason (see `FragmentClippingExtensionPlugin`). Fixed; shader now compiles clean.

## Verified (2026-07-14, chromium-linux, built dist)

- `npm run build`, `npm run build-examples` — clean (tsc typechecks the example, so the `threepipe` exports used all resolve).
- `npm run test:e2e -- --grep "roughness-mask-plugin"` — passed, `console.log` clean (zero shader errors), snapshot stable across runs.
- `npm run check-test-coverage` — passes.
- **A/B proof that the mask actually drives roughness** (temporary 3-sphere build, since a passing snapshot only proves stability, not correctness):
  - **A** — no extension, constant `roughness = 0.21` (the *predicted* mean of the remap): uniformly glossy, sharp sun highlight.
  - **B** — the real `mix(0, 0.915, mask.r)`: same overall gloss level as A (confirming the predicted mean is right) but gloss **varies spatially along the veining**.
  - **C** — `min == max == 0.915`, so the mask cannot vary anything: uniformly matte, **sun highlight gone**.
  - C proves the min/max uniforms are bound and driving `roughnessFactor`; B-vs-A proves the mask's spatial variation reaches it. Example restored to the single faithful sphere afterwards.

## Textures (resolved)

Hosted on the CDN at `https://samples.threepipe.org/textures/Pale_Pink_Carrara_Marble_{baseColor,Normal,Mask}.png`
(note: `/textures/`, not `/minimal/…`). Local copies deleted — `examples/` still tracks **zero** binary assets, and
`tests/precache-cdn.mjs` auto-discovers `samples.threepipe.org` URLs by scanning `examples/*/script.ts`, so there is no list to maintain.

Verified 2026-07-14: all three return 200 with byte sizes identical to the source zip (1741912 / 1287 / 695935), and
`npm run test:e2e -- --grep "roughness-mask-plugin"` passes **against the snapshot that was generated from the local
files** — i.e. the CDN bytes render pixel-identically. Console clean.

## TODO

- [ ] macOS (`chromium-darwin`) snapshot baseline still needs generating — snapshots are platform-specific.
- [ ] Not committed (per instruction).

## Possible follow-ups (not done)

- glTF extension (`WEBGI_materials_roughness_mask`) for import/export + serialization, the way `CustomBumpMapPlugin` does. Skipped to keep this focused; the plugin works without it but the settings won't survive a glb roundtrip.
- A general MaterialX nodegraph → GLSL converter (parse the XML, walk the `image`/`multiply`/`mix`/`extract`/`normalmap`/`texcoord` DAG, emit GLSL). This material would be its first test case. Explicitly deferred — this task only needed the one extension.

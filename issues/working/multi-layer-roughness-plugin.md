# MultiLayerRoughnessPlugin — multi-lobe specular ("reflection tail-off")

Status: **core implemented + verified (dev server)**, started 2026-07-13.

Blend multiple GGX specular lobes with different roughness/weight on one PhysicalMaterial — the "reflection tail-off" seen on real metal (sharp core reflection + rougher, fainter falloff lobes from sub-pixel micro scratches). Source idea: "Forgotten Metal Knowledge" video (youtube r3bkGPobpTw); prior art: ILM Iron Man two-lobe shaders (Ben Snow SIGGRAPH 2010, Christophe Hery), RenderMan PxrSurface Rough Specular, Unreal DualSpecularGGX, Unity HDRP StackLit dual base lobe, O3DE dual specular.

## Design (approved)

- Core plugin `src/plugins/material/MultiLayerRoughnessPlugin.ts` + `shaders/MultiLayerRoughnessPlugin.pars.glsl`.
- Per material `userData._multiLayerRoughness = {enabled, blendMode, layers: [{weight, roughness, baseInfluence}]}`, max 4 layers.
  - effective lobe roughness = `clamp(roughness + baseRoughness * baseInfluence, 0.0525, 1)`.
- Blend modes resolved to per-lobe weights on CPU (no shader branching): `mix` (normalized, energy conserving, default), `additive` (ILM style), `chain` (Blender mix-shader chain semantics: `w_i' = w_i * Π_{j>i}(1-w_j)`).
- Shader (patched via material extension, priority 8 — after webgi AnisotropyPlugin at 10, before SSCS at 5):
  - Direct: per-lobe `BRDF_GGX` with a `PhysicalMaterial` struct copy (or per-lobe roughness arg into `BRDF_GGX_Anisotropy` when the aniso plugin patched the line first). Shared F0/Fresnel across lobes (UE/StackLit/O3DE convention).
  - IBL: per-lobe `getIBLRadiance` env sample (+ bent normal if aniso), per-lobe `computeMultiscattering`, indirect diffuse rebalanced by weighted total scattering.
- glTF: `WEBGI_materials_multi_layer_roughness` (ThreeSerialization of the userData object, no textures).

## Verified (2026-07-13, via vite dev server + system chromium on Alpine ARM64)

- Example renders, no shader compile errors, UI works (add/remove layers, blend mode).
- A/B toggle on the same sphere: 23829/57600 px changed in sphere crop (41%) — sharp core reflection retained + soft falloff, matches the video's target look. Extreme values (w=1, r=0.9) fully roughen — uniforms/defines reactive.
- Composition with webgi AnisotropyPlugin on one material: lobes automatically use `BRDF_GGX_Anisotropy` + bent-normal IBL (per-layer anisotropy for free), no errors, renders correctly.
- glb export/import roundtrip preserves layers exactly.
- `npm run test:unit` 113/113 pass, `npm run check-test-coverage` passes, eslint clean.

## Remaining / TODO

- [x] `npm run build` (lib + dist) — done 2026-07-13 after host freed RAM (needs ~2GB+; OOM-killed at ≤1.2GB available). `npm run build-examples` passes; e2e snapshot baseline generated at `tests/snapshots/chromium-linux/multi-layer-roughness-plugin/` and the smoke test passes against the built dist (existing `clearcoat-tint-plugin` also passes, so rendering matches pinned baselines).
  - Note: the darwin baseline still needs to be generated on macOS (snapshots are platform-specific).
  - Fixed pre-existing e2e blocker along the way: playwright's default testMatch also picks up `.test.ts`, so it loaded `tests/unit/dracojs-adapter.test.ts` (vitest) and crashed every run with `Cannot redefine property: Symbol($$jest-matchers-object)`. Added `'**/tests/unit/**'` to `testIgnore` in `playwright.config.ts`.
- [x] Example improvement (done 2026-07-14): 4×4 sphere grid — row 1 single-roughness control sweep, row 2 tail weight sweep, row 3 tail roughness sweep, row 4 blend modes (mix/additive/chain) + 3-lobe cascade. Dark `studio_small_01` env (0.7 intensity) on `#101214` background so the tail-off reads like the video; 3D text labels (geometry-generator, slightly emissive) instead of an HTML legend. Not yet shown: `baseInfluence` with an actual roughness map — fold into the complex-scene example.
- [x] Complex scene example (initial version, 2026-07-14): `multi-layer-roughness-scene` — elevator/fridge door panels (vertical brushed aniso + 2 tail layers), cooking pot + lid (aniso + layers, reflects the neon), pristine sphere, emissive neon sign ("TAIL OFF" + cyan ring) with Bloom, glossy floor with SSReflectionPlugin (inline), `peppermint_powerplant_2` (Poly Haven CC0, the video's probable env) at 0.5 intensity, rgbm + TAA + stableNoise. Verified: no console errors, snapshot baseline generated, plugin composition (MLR+Aniso+SSR+Bloom on one material set) compiles and renders. Possible polish later: before/after toggle, roughness-mapped `baseInfluence` demo, camera orbit intro.
- [ ] Docs: check iframe/example renders on website build; gltf extension spec page (docs link in plugin header is a placeholder todo like other plugins).
- [ ] Phase 2 ideas (from research):
  - Per-layer anisotropy controls (own direction/strength per lobe, beyond inheriting material anisotropy). Needs coordination with webgi AnisotropyPlugin.
  - Hazy-gloss parametrization (Barla et al., StackLit HazeMapping): expose `haziness`/`hazeExtent` that derive lobe params — friendlier artist control.
  - `chain` mode could use view-dependent directional-albedo attenuation (Kulla-Conty / EEVEE `weight *= 1 - reflectance`) instead of scalar weights.
  - Optional "fast IBL" mode: single env sample at mix-weighted roughness (approximation, for low-end).
  - Presets: UE skin-style (0.85/0.15, r×0.75/×1.3), PxrSurface bands (spec 0.1–0.4 / rough spec 0.6).

## Known limitations (documented in plugin docs)

- SSR/SSGI (GBuffer roughness) see only the base roughness — extra lobes don't appear in screen-space reflections. Same class of limitation as anisotropy.
- Rect area lights (LTC) evaluate only the base lobe.

## Files touched

- `src/plugins/material/MultiLayerRoughnessPlugin.ts` (new), `src/plugins/material/shaders/MultiLayerRoughnessPlugin.pars.glsl` (new)
- `src/plugins/index.ts` (exports)
- `examples/multi-layer-roughness-plugin/` (new), `examples/index.html`, `examples/tweakpane-editor/ThreeEditor.ts` + `script.ts`
- `website/plugin/MultiLayerRoughnessPlugin.md` (new), `website/.vitepress/config.ts`, `website/guide/core-plugins.md`, `website/plugin/ParallaxMappingPlugin.md`, `website/plugin/CanvasSnapshotPlugin.md`
- `README.md`, `CHANGELOG.md`, `tests/extras.spec.ts`, `CLAUDE.md` (package.json-scripts rule)

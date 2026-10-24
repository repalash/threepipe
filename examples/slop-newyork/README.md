# New York with ThreePipe + WebGI

A WebGL2 port of [mrdoob/slop-newyork](https://github.com/mrdoob/slop-newyork), running in `ThreeViewer` with temporal SSGI, denoised SSR, velocity-buffer TAA and HDR bloom. The original Manhattan geography, procedural buildings and landmarks, traffic, walking/cycling/driving/flying controllers, touch input, eleven cameras, minimap and full map are retained.

## Run

From the repository root:

```sh
npm ci
npm run dev:slop-newyork
```

Open `/examples/slop-newyork/`. The dedicated Vite configuration resolves **both ThreePipe and WebGI to this checkout**, including the unpublished rendering work. It does not load the older npm WebGI build.

```sh
npm run build:slop-newyork
npm run test:slop-newyork
npm run test:slop-newyork-materials
```

The standalone build is in `dist-slop-newyork/`; serve that directory and open `/examples/slop-newyork/`. To run the smoke test with an existing Chromium installation, set `CHROMIUM_PATH`. The smoke test uses SwiftShader and disables shadow maps to make a full-city check practical without a hardware GPU. Set `SLOP_QUERY` to override its query string and `SLOP_SCREENSHOT` to capture the result.

The ordinary examples site also works after building ThreePipe and `plugins/webgi-plugins`. Its import map points to the local built plugin package.

## Controls and rendering

- WASD/arrows to move; Shift to boost; 1–4 to walk, drive, cycle or fly; V cycles cameras; M opens the map; H hides the HUD.
- The Rendering panel toggles SSGI, SSR, TAA and bloom independently.
- `?scale=1` sets render density. The default follows display density, capped at 2x and approximately 4.2 megapixels.
- `?gi=off`, `?ssr=off` and `?shadows=off` are useful for comparisons and slower GPUs.
- `?camera=fifthAve`, `?camera=timesSquare`, `?camera=drone`, `?mode=helicopter`, and `?time=midnight` select the initial view.
- `?gi=rc` enables the experimental radiance-cascades method. `?envocc=1` enables the experimental world environment-occlusion/far-bounce volume. Both come from WebGI PR 13 and remain opt-in: a fixed-density scene-wide probe grid is a poor default for a city extending tens of kilometres, and its initial BVH bake can block the main thread.
- `?debug=1` logs construction phases and shader compilation.

## Port

`script.js` loads the upstream city modules in their dependency order. `runtime.js` owns the viewer, sky/IBL, moving directional shadow frustum, rendering plugins and their UI. `tsl-glsl.js` compiles the **specific TSL expression subset used by this example** into GLSL material extensions; it is not a general TSL implementation. The original procedural facade grids, apartment interiors, vehicle surfaces, animated vegetation, water and steam are evaluated in the shaders. Materials with the same graph share programs independently of their uniform values.

Custom G-buffer materials preserve procedural normals, alpha cutouts, animated positions and per-pixel roughness for GI and SSR. Velocity overrides use the same positions and coverage and retain previous instance matrices for moving traffic. Crowd poses are uploaded through bounded 2D float textures rather than WebGPU storage buffers. The previous-frame pose and wind deformation are not retained separately; their velocity uses the current deformed surface with the previous rigid transform. This is a remaining source of temporal error on moving limbs and leaves.

The lighting implementation uses WebGL `Sky`/PMREM, exponential fog and a camera-following shadow map in place of the source's newer WebGPU atmospheric nodes, cascaded SunLight and clustered lights. Forward local lights are bounded to twelve spots and six points across the nearby street, shop and vehicle pools; distant lamp emission remains. The MaterialX roof-noise calls use deterministic value noise, and the source's custom foliage lighting model is approximated by standard physical shading. These are rendering differences, not visual parity claims. Hardware performance has not been benchmarked.

## Material and lighting validation

Shader entry-point injection accepts compact/minified `void main(){` as well as spaced source. Previously the G-buffer and velocity shaders could skip procedural initialization, producing invalid normals. A browser readback guard compares custom and standard G-buffer normal bytes.

The recovery corrects TSL `colorNode` replacement semantics: the node replaces the
material's base color/map instead of multiplying them. A rendered pixel comparison
with a conflicting red base and green node verifies the translated output matches
the green reference. A second browser assertion renders a dark reference through every time preset, verifies its shadow values survive, and checks that restoring contrast 1.08 reproduces black clipping.

Curtain-wall glazing, asphalt, concrete and water are dielectrics; metalness is
reserved for the facade framing. Water uses IOR 1.333. Window reflections are no
longer painted into albedo: the sun, environment and SSR provide specular lighting.
The height-based canyon AO multiplier is neutral: it otherwise darkened street-level indirect light to about 34% before SSGI visibility was applied. Material-local cavity terms remain.

ACES contrast stays neutral because ThreePipe's post-tone contrast offset clips
low light values; the upstream scene-linear contrast curve was not equivalent.
The SSGI reference is WebGI PR 12, snapshot
`a7f3685c0ff1504b95828221ce4640ec395c0dc5`, especially its worlds `stage.ts`,
`grade.ts` and `goldenCity.ts`. The city retains a 32-metre GI trace radius rather
than using a fraction of the entire metropolitan scene diameter.

This remains a procedural city with simplified vehicle meshes, shader-based
window interiors and approximate foliage. Correcting PBR inputs does not establish
photorealistic asset quality or parity with the reference scenes.

## Pinned sources and licenses

- City code and generated geographic data: `mrdoob/slop-newyork` at [`0049a497be6e36c79f854771f3018f8f41f07fab`](https://github.com/mrdoob/slop-newyork/commit/0049a497be6e36c79f854771f3018f8f41f07fab). The code is MIT; its notice is retained in [LICENSE-MIT](LICENSE-MIT). `js/` and `css/` are the vendored source, with the rendering adaptations described above.
- Geographic sources: [NYC Open Data](https://opendata.cityofnewyork.us/) and [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. The source dataset/generator is available in the pinned upstream repository's `tools/` directory. Runtime data is local and requires no API key.
- WebGI package/layout + temporal SSGI + worlds fixes + experimental world GI: `repalash/threepipe-webgi` PRs [1](https://github.com/repalash/threepipe-webgi/pull/1), [9](https://github.com/repalash/threepipe-webgi/pull/9), [12](https://github.com/repalash/threepipe-webgi/pull/12), [13](https://github.com/repalash/threepipe-webgi/pull/13), snapshot `e4c031030250db3f8af8b2863c162226678292f5`.
- Temporal SSR: WebGI [PR 11](https://github.com/repalash/threepipe-webgi/pull/11), snapshot `e3c1834eb882b931f12d2b40034f3e6153feadda`. Its SSR passes and shared denoiser are combined with the newer finite-sample guards from PR 12/13. PR 13's SSGI/world-GI implementation is retained.

The WebGI source is a development snapshot under its own [license](../../plugins/webgi-plugins/LICENSE) and [third-party notices](../../plugins/webgi-plugins/THIRD_PARTY_NOTICES.md), not a new package release. ThreePipe's G-buffer normal fix from PR 46 is already in the `dev` base of this example.

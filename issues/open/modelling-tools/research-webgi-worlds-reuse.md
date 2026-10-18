# Reuse from the webgi SSGI worlds (threepipe-webgi PR #12) for Track R and Track 2

Source: branch `claude/zen-clarke-ba9gzo` of `repalash/threepipe-webgi` (PR #12, "SSGI worlds: demo scenes,
miniature worlds kit and the Peaks game"), checked out read-only at `.repos/webgi-worlds`. Surveyed
2026-10-18 at Palash's request ("see the miniature procedural worlds work ... for the parts thing, if
something can be used from there"). Spot-checked by the parent: the Golden Temple `Mesher` emits real quads
(`hall-lib.js:85`), `riad/mosaic.ts` is pure and Node-safe, `W/goldentemple/LICENSE` is MIT (Leon Lin).

## Decisions (parent)

1. **Parts library (R3)** takes the *parameterisations and profile data*, not the triangle output. Almost
   everything there is triangle soup merged per material (no groups, often no UVs). Parts are rebuilt on the
   kernel (lathe, sweep, extrude, inset, bevel, booleans) so they come out as editable n-gon `MeshData` with
   material slots. Directly reusable as code: the Golden Temple `Mesher` primitives (`cbox`, `beam`, `lathe`,
   `extrude` with holes, `sweep`, `bar`, `warp`), which already track quads - adapt them to emit kernel faces.
   Keep the MIT notice on anything derived from Golden Temple.
2. **Architecture parts** start from: moulding profiles in `cathedral/build.ts` (Attic base torus-scotia-torus,
   bell capital), `pointedArch`/`lancetOutline` (`cathedral/geom.ts`), the mitred plan sweep
   (`goldentemple/world/buildings-kit.js:293`) for cornices, the opening model of `riad/geo.ts` (flat /
   horseshoe / lobed / pointed) and the window/door joinery of `cyclades/village.ts:90`, and `FacadeSpec`
   (`kit/architecture.ts:116`) as the parameter model for facade bays (Track 2's GN family).
3. **Materials (R4)**: one preset system built from `cyclades/proc.ts` (cleanest `MaterialExtension`), with
   `riad/shader.ts`'s height hook and `kit/surface.ts`'s local frame + triplanar merged in; parameters as
   uniforms, a serialisable description, optional bake to textures. Generic presets to lift: lime wash, paint
   with wear, marble, rubble masonry, timber, bronze, terracotta, glass mosaic, plaster/tadelakt, zellige,
   stucco, cedar, brass, roof tile, fabric. `riad/mosaic.ts` + `patterns.ts` is the texture generator.
4. **Render presets (R4)**: `kit/stage.ts` `studioBackdrop` (product studio), `litSky` + `alignSky` +
   `kelvinToColor` + height fog + room probes (architectural daylight), `kit/grade.ts` (41 lines, pure
   threepipe). DOF stays a webgi option.
5. **Track 2**: `kit/erosion.ts` (pure, seeded, typed; Beyer / Lague, MIT) is the implementation for the
   erosion extension node ([A5] in `15-procedural-on-kernel.md`); `kit/scatter.ts`, `kit/terrain.ts`,
   `kit/strata.ts` and the tiles are references and demo material for the procedural families. Blender GN
   nodes stay Blender ports.
6. **Licences**: the threepipe-webgi repo is under the webgi Free Forever License; Palash owns the examples.
   Code derived from Golden Temple keeps its MIT notice. Assets with restrictive licences (Sun Temple CC
   BY-NC-SA) are not used.

## Bugs noticed in the PR #12 code (for that PR, not fixed here)

- `kit/architecture.ts:277-279`: roof slabs are rotated after their UVs are computed (stale UVs).
- `cathedral/build.ts:448`: global `ribKeys` set never cleared, so a rebuild skips ribs.
- `riad/shader.ts:4`: reads `?rdbg` from the URL at module load.
- `kit/heightFog.ts`, `kit/areaLights.ts:11`: overwrite global `ShaderChunk`s (affects every material on the page).
- `kit/architecture.ts:17`: imports `polyHavenTexture` from the showcase (DOM/network) into a geometry module.

---

## The survey (verbatim)

# Reusable parts in webgi-worlds for `@threepipe/modelling-parts`

All paths are relative to `/Users/palash/Projects/threepipe/.repos/webgi-worlds/examples/`. `W/` means `ssgi-demo/worlds/`. I only read code; nothing was modified.

**Shared caveats that apply to almost everything below:**
- **Triangle soup, not quads.** Nearly every generator builds on three.js `ExtrudeGeometry`, `LatheGeometry` or `BoxGeometry`. Results go through a per-scene `Batch` that drops UVs, often converts to non-indexed, and merges into **one mesh per material**.
- **No material slots.** Nothing uses `geometry.groups`. Each `Batch` is a `Map<material, geometries[]>` (`W/cyclades/geo.ts:181`, `W/cathedral/geom.ts:33`, `W/riad/geo.ts:25`, `W/kit/batch.ts:9`), so changing it to emit groups is a small job.
- **UVs.** Most materials work from world position, so geometry carries position and normal only. The exceptions are the riad and `kit/architecture.ts`, which compute planar UVs from the dominant normal axis.
- **Seeding.** Seeded with mulberry32 (`W/kit/noise.ts:7` `rng`, `:18` `Noise2`). Watch for module-level state: `wobble` in `cyclades/geo.ts:31` always uses `Noise2(41)`; `cathedral/build.ts:448` keeps a global `ribKeys` set that is never cleared; `chamferBox` in `goldentemple/world/buildings-kit.js:80` keeps a global cache.

## 1. Geometry generators, ranked for the parts library

| # | Item | file:line | Params / output | Topology | Self-contained? |
|---|---|---|---|---|---|
| 1 | **Golden Temple `Mesher` + `Acc` primitives** | `W/goldentemple/world/hall-lib.js:28` (Mesher), `:146` (Acc). Primitives: `cbox(ms,X,hx,hy,hz,c,{taper,skip})` `:213`, `beam(p0,p1,w,h,c,up)` `:269`, `lathe(ms,X,profile,seg,{hardDeg,phase,arc})` `:282`, `extrude(ms,X,outer,holes,z0,z1)` `:339`, `sweep(ms,path,profile,{closed,smooth,caps,ups})` `:375`, `bar` `:446` | Indexed geometry with growable buffers, one mesher per material. Emits real `quadN()` quads, keeps a mirroring flag, and has `warp(fn)` (`:105`), which deforms vertices and fixes normals with an inverse-transpose Jacobian. | **Closest thing here to clean quad topology**: quads are tracked as quads, with split normals at hard corners. No UVs (optional `aLoc` attribute instead). | Imports only `three`. MIT (Golden Temple). |
| 2 | **Profile sweep for mouldings** | `W/cathedral/geom.ts:145` `sweep(path,profile,normalAt,caps,scaleAt)`; `rollProfile` `:196`; `pointedArch` `:68`; `lancetOutline` `:84` | Sweeps any 2D profile (b,n) along a 3D polyline using a supplied normal frame. Indexed grid, fan caps. | Grid of quads as triangle pairs, but becomes **non-indexed soup once capped** (`:189`). | Pure `three`. |
| 3 | **Mitred plan sweep** | `W/goldentemple/world/buildings-kit.js:293` `sweep(path,profile,{closed,smooth,caps,outward,miter,inside})`; `rectProfile` / `roundProfile` `:372` | Gravity-aligned profile swept along a plan path, with **mitre scaling at corners** and loops oriented outward. | Indexed. | Pure. Best base for "cornice swept along a footprint". |
| 4 | **Walls with arched openings** | `W/riad/geo.ts:168` `wallGeometry(x0,x1,y0,y1,depth,openings,bevel)`; `Opening` `{x,w,spring,sill,kind:'flat'\|'horseshoe'\|'lobed'\|'pointed',shoe,lobes}` `:98`; `archHead` `:113`; `archBand` `:281`; `bevelSpan` `:255`; `extrudeShape` `:213`; `smoothNormals(g,deg)` `:227` | The outline walks around doors that cut the bottom edge; windows become holes; optional chamfer. | Extrude soup with crease-smoothed normals. | Pure. `planarUV` `:78` gives metre-scaled UVs. |
| 5 | **Lime-architecture kit** | `W/cyclades/geo.ts`: `softBox(w,h,d,r,k)` `:38`, `holePath` `:82`, `archShape(w,h,arch)` `:100`, `extrudeSoft(shape,depth,bevel)` `:118`, barrel `vault(w,rise,len)` `:135`, `dome(r,hk)` `:149`, `wobble` `:69` | Rounded box built like RoundedBoxGeometry (indexed, grid quads); rounded-bevel extrude with creased normals. | `softBox` is clean; the extrudes are soup. | Pure except `Batch.build`, which needs a `ThreeViewer`. |
| 6 | **Window/door joinery** | `W/cyclades/village.ts:90` `wallWithOpenings` (door leaves with raised panels, threshold, window frame, mullion/transom, sill, louvred shutters open or closed, fanlights); `parapet` `:143`; `house` `:163`; courtyard **stair with parapet** `:242`; `bellWall` `:265`; lathed `bell` `:310` | A parametric opening list. Uses the `Builder` class in the same file (`:44`). | Boxes plus extrudes, soup. | Tied to `VillageMaterials` and a plot frame; needs extracting. |
| 7 | **Facade bays** | `W/kit/architecture.ts:155` `facade(BoxBatch, FacadeSpec, frame)`; `FacadeSpec` `:116` | Bays, ground floor (shops, doors, plain, or arcade with column bases and capitals), recessed windows, curtains, shutters, balconies with balusters, string course, two-tier cornice, pitched roof with gables. Seeded. | All boxes, merged per material; planar UVs (`BoxBatch` `:56`). | Imports `polyHavenTexture` from `../../showcase/build` (DOM/network) at `:17`. **Bug:** the roof slabs are rotated after their UVs are computed (`:277-279`), so their UVs are stale. |
| 8 | **Columns, bases, capitals** | `W/cathedral/build.ts`: Attic base `baseProfile` (torus–scotia–torus) `:93`, `bellProfile` `:98`, `pier()` (core, colonnettes, crockets, leaves, octagonal abacus) `:120`, `crockets` `:62`, `leaves` `:37`; `column` with base stone and bands `W/goldentemple/world/buildings-arch.js:275` | Lathe profiles: ready-made data for torus, scotia and astragal mouldings. | Lathe soup. | Uses `Builder` and layout constants; profiles are easy to lift. |
| 9 | **Vaults** | `W/cathedral/build.ts`: `vault()` quadripartite rib vault `:488`, `cell()` web grid `:463`, `rib()` `:434`, `boss` `:456`, RIB/TRANSVERSE profiles `:429-430`; `W/riad/house.ts:365` `muqarnas` | Parametric (span, rise, profile function). | Grid soup. | Layout-coupled; the global `ribKeys` dedup set is never cleared, so a rebuild skips ribs. |
| 10 | **Railings / balustrades** | `stairBalustrade(acc,mats,posts,newel)` `W/goldentemple/world/hall-stair.js:13`; `railing(lb,pts,y0,S)` `W/goldentemple/world/buildings-arch.js:491`; also `buildRail` `W/tiles/alpine/props.ts:158`, `railFence` `W/tiles/mesa/props.ts:359`, `buildRailFence` `W/tiles/autumn/props.ts:190` | Post spacing along a polyline; top, mid and bottom rails; struts. | Chamfer boxes plus bars. | Japanese style; needs a generic profile set. |
| 11 | **Tiled roofs** | `roofSurface(faces,T,lift)` `W/goldentemple/world/buildings-kit.js:432`; `tileParams` `:387`; corner up-sweep `makeLift` `:545`; `W/goldentemple/world/hall-roof.js:205` `buildTiles`, `:265` `buildEaves`; `roundTileGeo` / `flatTileGeo` `W/goldentemple/world/pagoda-parts.js:221,235` | Displaces a parametric roof surface with a round/pan tile pattern; vertex colour carries AO. | Indexed zipper strips. | Pure. Hongawara-specific but generalisable. |
| 12 | **Product-ish primitives** | `chamferBox` `W/goldentemple/world/buildings-kit.js:104`; `taper` `:127`; `polyRing` / `polyStack` (stacked rounded-polygon rings: rect buttons, bezels) `W/goldentemple/world/props-geo.js:166,208`; `superLathe` (superellipse lathe, rounded-square bodies) `:573`; `taperTube` `:407`; `loft(sections)` `W/goldentemple/world/pagoda-parts.js:312`; `cubeSphere`, parallel-transport `tube` `W/kit/tileGeo.ts:6,60`; `iBeam` / `angleIron` `W/tiles/oilfield/props.ts:72,230`; bevelled `slabGeometry` `W/goldentemple/world/terrain-stonegeo.js:7` | — | — | Pure. `polyStack` is the best seed for rect buttons and bezels. |

**Nothing to port for:** knurling, grip bands, detent dials, screws, bayonet mounts, hot shoes, eyecups, lens stacks, chimneys or dormers. The nearest things are a small rooftop chimney box (`W/cyclades/village.ts:206-208`) and the vehicle `Batch` / `palette` in `peaks/vehicle/geo.ts:7`.

## 2. Procedural families (geometry-node candidates)

- **Heightfield terrain:** `W/kit/terrain.ts:355` `buildTerrain`. Height function, `paint(sample, weights, tint)` rule writing splat weights per vertex, adaptive `mesh.x/z` warp (`focusAxis` `:496`), diorama sides. Texture loading needs the DOM (`:75` canvas).
- **Erosion:** `W/kit/erosion.ts:49` `erode(hs, n1, step, opts)`. Droplet hydraulic plus thermal erosion, returns flow/deposit/eroded/talus masks. Pure, seeded. **Most portable piece here.**
- **Strata:**
  - `W/kit/strata.ts`: `strataAt` / `strataColor` / `strataRelief` `:62-88`; `buildCutFaces` (marching-squares outline) `:154`; `buildCliffBand` `:438`; matching GLSL `STRATA_GLSL` `:104`.
  - `W/kit/strataSides.ts:252`; `W/kit/beds.ts:209,278` (bed kinds: turf, till, columnar, …).
  - The JS and GLSL compute the same function, so geometry relief and shading line up.
- **Scatter:** `W/kit/scatter.ts:124` `scatterOnTerrain(rule)`. Rejection sampling with a density function and spacing; O(n²) distance check.
- **Paths:** `W/kit/path.ts:8` `GroundPath` (Catmull-Rom spline with nearest-point queries).
- **Trees:**
  - `W/kit/conifer.ts:393`, `W/kit/broadleaf.ts:365`: instanced templates with leaf/needle cards.
  - `W/goldentemple/world/vegetation-tree.js`: `growCurve` `:73`, `genMaple` `:242`, `genCherry` `:419`, `genTiered` `:525`, `genPine` `:800`; skeleton-then-bark-tube approach.
  - `W/cyclades/plants.ts:227`.
- **Grass:** `W/kit/grassTufts.ts:43,209`; `W/kit/tufts.ts:125`.
- **Rocks:**
  - `rockGeometry` (plane cuts blended with noisy ellipsoid) `W/goldentemple/world/pond-stone.js:16`.
  - `rockGeometry(seed, …)` `W/tiles/mesa/props.ts:495`.
- **Water:** `W/kit/waterBody.ts:326` with presets `WATER_LOOKS` `:35`; `W/kit/freshwater.ts:36,141` (pond, creek); `W/kit/lava.ts:42,115,141`. The refraction relies on the G-buffer and SSR, so these are not portable as geometry.
- **Backdrop land:** `W/kit/vista.ts:33`, `W/kit/farRidges.ts:29`.
- **SDF field:** `createField` in `W/goldentemple/world/terrain-field.js:88`.
- **Villages / plots:** rim-frame plots with per-plot seeds in `buildVillage` `W/cyclades/village.ts:432` (plot frame `:39`).
- **Peaks game:** per-chunk biome scatter specs (`peaks/biomes/types.ts`); the track generator `peaks/track/procedural.ts` is game-specific.

## 3. Materials

There are four parallel implementations of the same hook pattern. Each one inserts GLSL after three.js shader chunks (`color_fragment`, `roughnessmap_fragment`, `metalnessmap_fragment`, `normal_fragment_maps`, `emissivemap_fragment`), using world-position varyings and a derivative-based bump.

1. **`W/cyclades/proc.ts`**: `procExtension` `:127`, `procMaterial(params, hooks)` `:177`, `NOISE` `:25` (MIT notice inline). It is a threepipe `MaterialExtension` with a hashed cache key. **This is the cleanest base.**
2. **`W/riad/shader.ts:123`** `proc()`: adds a `height` hook with a finite-difference bump that avoids blotches on some GPUs, `fragEnd`, and vertex hooks. It reads `?rdbg` from the URL at module load (`:4`), which has to go.
3. **`W/kit/surface.ts:74`** `surfaceExtension`: adds the mesh's local frame (`vSfL`), a per-instance seed and triplanar sampling (`sfTri`). Needed for wood grain that follows each plank.
4. **`W/cathedral/materials.ts:33`**: `stoneAlbedo` / `floorAlbedo` / `woodAlbedo` / `GLASS` in `W/cathedral/glsl.ts:531,572,612,67`. It patches `lights_fragment_begin` for the coloured "glass cookie", which is scene-specific.

**Generic presets worth lifting:**
- From `W/cyclades/mats.ts`: lime wash `:15`, paint with wear parameter `:53`, marble paving `:75`, rubble masonry `:105`, timber along an axis `:127`, bronze with patina `:148`, terracotta `:166`, glass mosaic `:182`, lit windows `:199`.
- From `W/riad/materials.ts`: plaster/tadelakt `:29`, zellige `:95`, stucco `:119`, cedar `:141`, brass `:173`, marble `:196`, roof tile `:235`, fabric `:343`, pierced brass `:380`.
- From Golden Temple `PROC` (`W/goldentemple/core/materials.js:181`, via `onBeforeCompile` `patch()` `:111`): lacquer, gold, bronze, roof tile, plaster, granite, wood.
- From the tiles: per-tile material files (e.g. `W/tiles/*/materials.ts`, `W/tiles/savanna/props.ts`) cover shingles, siding, brick, asphalt, concrete, rusted and painted steel, corrugated roof, thatch, render. Note that mesa, oilfield and savanna materials and the bayou, falls and terraces scenes fetch Poly Haven textures over the network.

**Scene-specific (not presets):** stained glass, whitewash grime that depends on `FOOT_LEVEL`, cliff rock.

**Procedural texture generator:** `W/riad/mosaic.ts:115` `mosaic()` plus `hankin` `:265` / `tiling488` `:306` and the patterns in `W/riad/patterns.ts`. It is explicitly *"Pure functions, no DOM: the same code runs in the page and in node"*, and outputs albedo, normal and roughness as RGBA bytes. **Directly usable for the texture generators and decals.**

**webgi dependency:** none of the materials need webgi plugins; they use only threepipe's `MaterialExtension` and `PhysicalMaterial`. To turn them into a preset library you would need to:
- Merge the four hook systems into one.
- Expose parameters as uniforms instead of values baked into the GLSL string (`paint(wear)` at `W/cyclades/mats.ts:63` and `FOOT_LEVEL` currently get recompiled per value).
- Add a Node-side description so presets serialise (they are GLSL strings, which glTF export cannot carry).
- Optionally add a bake path to textures.

## 4. Render and lighting tools in `kit/`

**Generic and reusable:**
- **`W/kit/stage.ts`**:
  - `WorldLook` `:25` and `stageWorld` `:81`: sky fill, sun, background, ACES exposure, fog, grade, vignette, autofocus DOF.
  - `studioBackdrop` (radial "product sweep") `:64`.
  - `litSky` `:285`: paints a ground below the horizon and trims saturation. **A strong idea for architectural daylight.**
  - `hdriSun` / `alignSky` `:207/231`: find the sun in the HDRI and rotate the sky to match the scene sun.
  - `applyTime` `:177`.
  - Dependencies: `DepthOfFieldPlugin` (webgi), the showcase `configure` / `polyHavenHdri`, and `LightingRig` from `ssgi-demo/lighting.ts` (which also has `kelvinToColor`).
- **`W/kit/grade.ts:8`** `ColorGradePlugin` (split tone plus saturation): pure threepipe, 41 lines.
- **`W/kit/heightFog.ts:25`**: exponential height fog. It overwrites the global `ShaderChunk`, so it affects the whole page.
- **`W/kit/probe.ts:55`** `envProbe` (box-projected cube probe, two bounces) and `roomProbes` `:197`. SSGI is only used to scale intensity (`:207`), so the dependency is optional.

**Demo-specific:**
- `W/kit/areaLights.ts:71` `emissiveLights` (emissive patches sampled as jittered spots; patches the global chunk at `:11`).
- `W/kit/gbuffer.ts:9`, a workaround for a threepipe G-buffer bug.
- `W/kit/vista.ts`.

**Mapping to the planned presets:**
- *Product studio:* `studioBackdrop`, the grade plugin, DOF autofocus, and the `palette()` clearcoat/matte/metal set in `peaks/vehicle/geo.ts:7`.
- *Architectural daylight:* `litSky` + `alignSky` + `kelvinToColor` sun + height fog + room probes.

## 5. Licences and provenance

- **Golden Temple by Leon Lin, MIT**, upstream `github.com/Leonxlnx/golden-temple` commit 97fd9ec.
  - Vendored as `W/goldentemple/{core,world,shotkeys,layout.js,shots.js}`; licence text in `W/goldentemple/LICENSE`. Every change is marked "port" (listed in `W/goldentemple/port.js:1-14`).
  - Derived from it, with attribution: `W/cyclades/proc.ts` (licence text inline `:5-24`), `W/riad/shader.ts` header, `W/cathedral/glsl.ts:7`, `W/goldentemple/tonemap.ts`, `W/goldentemple/shafts.ts`. The "after the Golden Temple" materials in `W/cyclades/mats.ts:126,147` are derived too.
- **Noise inside it:** Ashima Arts / Stefan Gustavson simplex (MIT) and Dave Hoskins hash.
- **meshoptimizer 0.18**, Arseny Kapoulkine, MIT: `W/goldentemple/vendor/meshopt_simplifier.module.js`.
- **Erosion:** ported from Beyer's thesis and Sebastian Lague's defaults (MIT, `W/kit/erosion.ts:9-11`).
- **Assets, not code:** Poly Haven (CC0), EZ-Tree (MIT), Sketchfab models (CC BY 4.0), Sun Temple (**CC BY-NC-SA**, `W/suntemple.ts:8`), ORCA scenes and Blender demo files (CC BY / CC0).
- **Peaks:** depends on planck.js and box3d-wasm.
- **Repo licence:** the repo itself is under the *"webgi Free Forever License"* (`LICENSE`), which names the plugins folder. You own the copyright on the examples, but anything derived from Golden Temple must keep its MIT notice when it moves into threepipe.

## 6. Quality and porting effort (top 10)

| Item | Note | Port effort |
|---|---|---|
| `hall-lib.js` Mesher / primitives | Dense but sound: real quads, Jacobian normal warp, mirroring. Plain JS, no types. | **Small–medium** (add types; emit faces for the modelling kernel). |
| `riad/mosaic.ts` + `patterns.ts` | Pure, Node-safe, well documented. | **Small.** |
| `kit/erosion.ts` | Pure, seeded, typed. | **Small.** |
| `riad/geo.ts` wall and openings | Clean and typed. The `'pointed'` branch has dead terms (`:133`). | **Small.** |
| `cyclades/geo.ts` | Clean; `softBox` is good. The global wobble noise needs to become a parameter. | **Small.** |
| `cathedral/geom.ts` sweep + profiles | Simple and correct; soup at the caps. | **Small.** |
| `buildings-kit.js` mitred sweep + `roofSurface` | Robust mitres; the roof generator is complex. | **Medium.** |
| `kit/architecture.ts` facade | Good parametric spec, all boxes. Has the DOM import and the stale roof-UV bug. | **Medium** (rebuild on the opening and moulding parts). |
| `cyclades/village.ts` window/door joinery | Rich detail, but coupled to the village `Builder` and materials. | **Medium.** |
| `cyclades/proc.ts` + presets, unified with `riad/shader.ts` and `kit/surface.ts` | Clean extensions; values baked into GLSL; four copies of the same system. | **Medium** (preset library); **large** if presets must serialise or bake. |
# Blend importer — fidelity audit vs Blender source + glTF-IO (line-by-line)

**Date:** 2026-06-11
**Method:** Each loader module compared line-by-line against its reference by a dedicated Opus subagent, then the high-impact claims re-verified by hand against source. References (pulled to latest): `.repos/blender` (`main e4e6c79a`), `.repos/gltf-blender-io` (`main c766228`), `.repos/gl-catmull-clark`, `.repos/js-blend-dev`. Per-module detail with exact citations: `tmp/blend-audit/01..08-*.md`.

## ✅ Fixes applied (2026-06-11, in progress)

Quick-wins from "Suggested order of attack" #1, all built (RC=0) + regression-verified on the brick:
- **Lights** (`light.ts`): proper `LA_*` type table (spot/area no longer collapse to point); watt→photometric conversion (`energy/(4π)·683` candela for point/spot, `energy·683` lux for sun, ×`2^exposure`) per `lights.py` SPEC; sun→`DirectionalLight2`, spot→`SpotLight2` (`angle=spotsize/2`, `penumbra=spotblend`); area→point scaled by emitter area; linear-RGB color (no 8-bit packing); sun/spot directionality via the target-child + the −90° X correction now extended to lamps in `setTransform`. **Verified**: brick's 6 sun rig now lights the scene (was invisible) from correct directions.
- **Camera** (`camera.ts`): near/far from `clip_start`/`clip_end` (was `clipsta`/`clipend` → always 0.1/1000); removed duplicate `shiftX` line; ortho `ortho_scale`→max-dimension mapping (default 6); sensor_fit-aware vertical FOV. *(Precise HORIZONTAL-fit FOV/ortho still needs Scene render resolution — TODO with active-camera designation.)*
- **Parser** (`parser.js`): `length = struct[i+2]` in `setData` — was never assigned → inline-struct array members got NaN addresses.
- **Transforms** (`index.ts`): childMap now keyed by the **parent** (deferred children re-nest correctly); **axis-angle** rotmode (-1) handled via `rotAxis`/`rotAngle`.
- **Transforms — full composition** (`index.ts`, `setTransform` rewritten matrix-based): faithful port of Blender's `BKE_object_to_mat4` + `solve_parenting` — `world = parent · parentinv · T(loc+dloc)·(Rδ·R)·S(size·dscale)`, converted as `C·(parentinv·local)·C⁻¹` (C = Rx(−90°)). Now folds in **parentinv** (all parented objects — was dropped → mis-placed) and **delta transforms**. **Verified numerically**: (a) composed world == Blender's stored `obmat` for every brick object incl. the parented camera (≤3e-8); (b) new path == old component-swizzle for unparented objects (≤4e-8, no regression); (c) parentinv layout proven on **12 non-identity** cases from the splash file (≤3e-6). Runtime regression clean.

- **Modifier stack** (`mesh.ts` restructured + new `mirror.ts`): now **iterates the full modifier stack in order** (was: only Subsurf, silently). Applies Subsurf + **Mirror** + **Array** + **Solidify** (faithful port of `MOD_mirror.cc` — per-axis reflect across the object plane, reversed winding, on-plane vertex **merge** within `tolerance`, UV `MIRROR_U/V`); **skips render-disabled modifiers** (`eModifierMode_Render`); **warns loudly** naming each unsupported modifier so missing geometry isn't silent; caches the **base** geometry per-datablock and applies modifiers per-object (fixes the per-data subsurf cache bug for linked duplicates). **Verified**: Mirror unit-tested (synthetic quad → merge 6 verts / no-merge 8, symmetric ±1, winding/normals correct); brick subsurf intact; splash file emits 69 correct warnings (GeometryNodes, Screw) and still loads. **Array** (`array.ts`, port of `MOD_array.cc`): offset = const + relative×bbox, `count` copies (FIXEDCOUNT/FITLENGTH), per-copy UV offset; OBJ-offset/fit-curve/caps/merge warned. Unit-tested (relative ×3 → copies at X 0/1/2; const {2,0,0} ×2 → X 0/2). **Solidify** (`solidify.ts`, simple/extrude port of `MOD_solidify_extrude.cc`): two shells offset along vertex normals by `ofs_orig`/`ofs_new` (from `offset`/`offset_fac`), inner shell reversed, **rim** on open boundary edges; non-manifold/even/vgroup/crease warned. Unit-tested (plane → **watertight** slab, thickness honored) **and end-to-end on the splash (46 Solidify objects apply, no warnings/crash)**. *(Remaining modifiers — Boolean/Bevel/Displace/GeometryNodes — still unsupported but now flagged; each needs its own port + a test fixture.)*

- **Material — Mapping node / texture transform** (`material.ts` `applyMapping` + `BlendLoadPlugin.ts`): an Image Texture's `Vector` input is now traced (through Reroutes) to a Mapping node, and its `Scale`/`Location`/`Rotation.z` are applied as three.js `texture.repeat`/`offset`/`rotation` (the Blender Mapping "Point" compose scale→rotate→translate matches three's UV matrix at center 0). Previously ignored → all tiled/offset/rotated materials rendered at 1:1. The transform is preserved across the external-texture `copy()` (alongside wrap). **Verified**: the mechanism detects+reads the Mapping node for all 4 brick textures (debug-confirmed), brick identity Mapping → `repeat (1,1)` (no regression); a non-1 Scale runs the same `repeat.set(...)`. *(Non-identity end-to-end render not shown — the splash's tiled materials feed images through node chains the loader can't yet trace; see the node-tracing item below.)*

- **Material — node-tracing for textures** (`material.ts` `imageNodeFeeding` made recursive): an Image Texture is now found through a bounded recursive walk of common pass-through relays (Normal Map, **Separate Color/RGB**, **Mix/MixRGB**, Math/MapRange, Gamma/Bright-Contrast/Hue-Sat/Invert/Curves, Color Ramp), not just a single Normal Map hop. Unblocks packed-ORM (Separate Color → image → roughnessMap/.g + metalnessMap/.b) and texture×factor/mix setups. Unknown nodes stop the walk (no stray-image grab). **Verified**: 5-case unit test (direct / MixRGB / SeparateColor / NormalMap / unknown→null all pass); brick (direct links) unchanged. *(Caveat: not exercised by a real fixture here — the splash wraps its Principled in custom **node groups**, which need separate group-tracing; that's the next material gap.)*

- **Subdivision — `subdivType` (Simple vs Catmull-Clark)** (`subdivide.ts` + `mesh.ts`): a `SUBSURF_TYPE_SIMPLE` (1) modifier now does **linear** subdivision (original verts kept, plain edge midpoints, no smoothing) instead of always smoothing — a Simple-subsurf cube stays a cube. Catmull-Clark (0) keeps the existing (Loop-approximation) smoothing. Unit-tested (cube ×2: Simple bboxMax 1.000 preserved vs smooth 0.902 rounded); brick (Catmull-Clark) unchanged. *(The Catmull-Clark path is still a Loop approximation — a faithful Catmull-Clark still needs the n-gon-cage restructure.)*

- **Catmull-Clark — DONE & LIVE** (`catmull.ts`, NEW; wired into `mesh.ts`): faithful port of `gl-catmull-clark` (the Wikipedia scheme — face points, edge points, vertex points `(F+2R+(n-3)P)/n`, n-gon→n quads), operating on a polygon cage (`positions`/`cells`). A Subsurf modifier with `subdivType==0` (Catmull-Clark) now subdivides the n-gon cage with **real Catmull-Clark** instead of the Loop approximation; Loop remains the fallback for Simple-subsurf and any mesh without a cage, and a try/catch falls back to Loop if the cage subdivider throws. **End-to-end verified on the real brick in Node** (`tmp/cc-brick-verify.ts`, loads via `createObjects` — the exact live path — 10/10): the **Plane** (4-vert cage → 1089-vert CC grid) keeps its bbox **exactly** (`[2,0,2]` → `[2,0,2]`, perfectly flat, full square — the original "plane clipped to the sphere interior" bug is fixed at the algorithm level, since Loop rounded it and CC keep-corners holds it); the **Sphere** (2143 → 32889 verts) is correctly pulled *slightly inward* to the CC limit surface (`2.0064 → 2.0004`) and its wrap-around **UV seam `[-0.5,1.5,0,1]` is preserved exactly** (face-varying CC, no smear); both keep smooth normals and consume the cage. **Browser render** confirms the plane renders as a full flat square extending beyond the sphere on all sides, sphere smooth (`tmp/pbr-render/_cc_brick_clean.png`). Built into `dist` (RC=0). Build-up history (all unit-verified along the way):
  - ✅ **CC core** (`catmull.ts`) — verified analytically (cube corners → ±5/9).
  - ✅ **Cage extraction** (`geometry.ts` mid path → `geometry.userData.__cage` = {positions, n-gon faces, per-corner UVs}) — verified on the brick (Plane: 1 quad / 4 verts; Sphere: 1986 verts, 2048 faces of sizes [3,4] = quads + pole tri-fans, with UVs).
  - ✅ **Boundary handling** (`catmull.ts`): boundary edges (one adjacent face) now use the cubic-B-spline boundary rule — edge point = endpoint midpoint, vertex point = 1/8·prev + 6/8·self + 1/8·next, with sharp/non-manifold corners **pinned** (the same "Keep Corners" rule the Loop subdivider uses, so a flat plane keeps its right-angle corners instead of shrinking into a disc). Closed meshes are unaffected (no boundary edges). Unit-verified (`tmp/cc-test.ts`, 19/19): closed cube unchanged (corners still →±5/9, 26 pos/24 quads); flat unit square at L1/L2/L3 stays **planar** (all z=0), **doesn't shrink** (bbox exactly 0..1), corners pinned, quad count 4^L; open box (no top face) keeps its rim corners pinned at ±1.
  - ✅ **Face-varying UV interpolation + triangulation + smooth normals** (`catmull.ts` `subdivideCage(cage, ctx, levels)`): builds a *parallel* uv mesh whose points are `(vertex, uv)` corners — continuous corners share a uv-point (smoothed like the interior), a **seam** (same vertex, different uv) splits into separate uv-points so the seam edges become boundaries in uv space → each side's UVs interpolate as a boundary curve and **don't smear across the seam** (Blender's default "Keep Corners" uv smooth). Both meshes share face structure → CC yields index-aligned cells, so position-points zip with uv-points per output-quad corner. Quads triangulated `[d,a,b,c]→(d,a,b),(d,b,c)`; **normals computed on the position mesh (welded by position index) and copied to the seam-split copies**, so a UV seam introduces no shading crease. Unit-verified (`tmp/cc-cage-test.ts`, 11/11): flat square (planar, +z normals, pos & uv bbox 0..1, no spurious seams); two-quad strip with a UV seam down the shared edge → **5 split positions each carrying 2 distinct uvs but identical smooth normals** (no crease), neither side's uv smears past its own [0,1] square, position stays continuous (bbox 0..2×0..1).
  - ✅ **Material groups through the cage** (`geometry.ts` carries per-face `materialIndices` into `__cage`; `subdivideCage` propagates per-output-quad material in CC cell order and re-emits coalesced `geometry.groups`) — so multi-material subsurf meshes keep their per-slot face assignment (not just single-material). Unit-verified (`tmp/cc-cage-test.ts`: two-quad strip, slot 0 / slot 1 → two groups of 24 indices each; single-slot → no groups). A triangle-budget cap (≤400k tris, matching the Loop path) reduces levels with a warning if a dense cage at high levels would explode.
  - ✅ **Wired into `mesh.ts` + end-to-end brick verification** (Node `createObjects` 10/10 + browser render) — see the LIVE summary above. The Loop path stays as the Simple/no-cage/throw fallback.

Remaining (task #43): mesh custom-normals + tangents; material node-tracing/AO/Mapping (group-internals); scene scoping + world + active camera (needs viewer-integration design — flagged for approval); harder modifiers (Boolean/Bevel/Displace/GeometryNodes). ~~Catmull-Clark~~ ✅ DONE & LIVE (see above).

---

**Bottom line:** the *foundation* is solid and faithful — file parsing, decompression, the Z-up→Y-up math, and the texture pipeline are correct (often more spec-faithful than the upstream js-blend). The *fidelity gaps* are concentrated in **lights, cameras, the modifier stack, subdivision, object transforms, and mesh normals/triangulation** — these are where loaded scenes visibly diverge from Blender.

---

## Verified CORRECT (don't touch)

- **Decompression** (`decompress.ts`): gzip `1f 8b 08`, zstd `28 b5 2f fd`, zstd skippable-frame, `BLENDER` literal — byte-exact vs Blender `fileops_c.cc:259-287`. No version assumption; truncation guard correct.
- **Parser core** (`parser.js`): BHead4 / SmallBHead8 / LargeBHead8 match `BLO_core_bhead.hh:34-52`; v0+v1 header + SDNA parsing match `dna_genfile.cc`; **no inter-block align** (correct — the TS upstream's `align4` is the documented "regressed 5 files" bug); the `pointerProp2` full-block multi-material fix is present and correct; robustness guards close the two known RangeError/unknown-magic issues.
- **Transform math** (`index.ts`): location `(x,z,-y)`, scale `(x,z,y)`, quaternion `(qx,qz,-qy,qw)`, euler-order string reversal, and the camera −90°-about-X correction are all numerically exact (errors ~1e-16) vs the glTF exporter and a proper −90° basis change.
- **Geometry** (`geometry.ts`): Z-up mapping, the "don't flip V" reasoning (three defaults `flipY=true` ≙ Blender bottom-left), Blender-5.0 attribute enums (AttrType 3/6/7, Corner=3) and mid-path CD type tags (49/11), per-corner UV seam expansion, material-index→groups.
- **Material** (`material.ts`): `applyWrap` extension→wrap (0/1/2/3), base-color clamp01, `MA_BL_CULL_BACKFACE=1<<2` + double-sided default, `MA_BM_CLIP=3`, emission peak-split, `normalScale` from Normal-Map Strength, reroute skipping.
- **External-texture pipeline** (`BlendLoadPlugin.ts`): deferred import (avoids root-context clobber), `isData`-from-path, wrap preserved across `copy`, DataTexture row-flip into a private Source.

---

## HIGH — broken / visibly wrong

### Lights are essentially non-functional (`loader/light.ts`)
- **No watt→intensity conversion.** `light.ts:18` passes raw `ldata.energy`. Exporter: point/spot `energy/(4π)·683`, sun `energy·683` lux (`lights.py:175-183`, `PBR_WATTS_TO_LUMENS=683`). Default 1000 W point → should be ≈54,350 cd; loader gives **1000** (~54× too dim under three r155+ physical units). `exposure` also ignored.
- **Type table collapses spot/hemi/area to 0.** `light.ts:4-10` maps `spot/hemi/area` all to `0`; DNA is `LA_LOCAL=0, LA_SUN=1, LA_SPOT=2, LA_AREA=4`. So **spot(2) and area(4) lights hit `default` → no light at all** (just a warning).
- **Sun → PointLight** (`light.ts:30`) instead of `DirectionalLight2` — omnidirectional, loses sun direction (rotation is applied by `setTransform` but meaningless on a point light).
- **Color packed to 8-bit int** (`light.ts:17`) — `r*255<<16|...` overflows for energy-baked colors >1 and conflates linear/sRGB.
- Area-light shape/size, custom distance/range (hardcoded 0), and shadow settings all ignored.

### Cameras: near/far and FOV wrong (`loader/camera.ts`)
- **near/far ignored.** Reads `cdata.clipsta`/`clipend` (`camera.ts:23-24,39-40`); current DNA is `clip_start`/`clip_end` (`DNA_camera_types.h:218`) → `undefined` → silently falls back to 0.1/1000.
- **FOV ignores `sensor_fit` + render aspect.** `camera.ts:18` always uses vertical sensor `2·atan(sensor_y/2lens)`. Blender default `sensor_fit=AUTO` fits the larger (usually horizontal) axis and divides by render aspect (`cameras.py:130`, `conversion.py:223`). Wrong for the common landscape case and for `VERTICAL`.
- **Duplicate line** `camera.ts:26-27` (shiftX set twice; `:27` was presumably meant to be removed).
- Ortho mag uses sensor aspect, not render resolution; pano/custom → default perspective; lens shift only stashed in userData.

### Only the Subsurf modifier is applied (`loader/mesh.ts:27`)
The entire rest of the depsgraph-evaluated stack is dropped. Blender/glTF export the fully-evaluated mesh (`nodes.py:323-325`). Concrete breakage: **Mirror** (half shows), **Solidify** (zero-thickness → invisible back-cull), **Array** (1 of N), **Boolean** (raw operands), **Bevel** (hard edges), **Displace** (flat — and the `mesh.ts:24` comment about subsurf giving density for displacement is moot: no Displace modifier exists), **Triangulate/Weld**, and **Geometry Nodes** (`eModifierType_Nodes=57`) → GN-only objects render empty/base. Also: a render-disabled Subsurf is still applied (`mesh.ts:27` ignores `modifier.mode & eModifierMode_Render`).

### Subdivision uses the wrong scheme (`loader/subdivide.ts`)
Loop (triangle) subdivision where Blender uses **Catmull-Clark** (`OSD_SCHEME_CATMARK`). Input is pre-triangulated (`mesh.ts:30`), so each quad is split on an arbitrary diagonal before Loop runs → asymmetric, mismatched-from-Blender limit surface. Also: `subdivType` ignored (Simple=1 should be bilinear/no-smoothing; loader rounds it); silent triangle-budget cap (`subdivide.ts:135`) yields fewer levels than Blender with no warning; `boundary_smooth`/`uv_smooth`/creases ignored (and the `subdivide.ts:48` comment "keep-corners is the Blender default" is **wrong** — DNA default is `SUBSURF_BOUNDARY_SMOOTH_ALL`). *(The Loop arithmetic itself is correct; the recently-added corner guard fixed the flat-plane→disc bug, but the scheme is still not Blender's.)*

### Object transforms drop parentinv / deltas / axis-angle (`loader/index.ts`)
- **`parentinv` ignored.** Blender world = `parent · parentinv · localTRS` (`object.cc:3455`). `setTransform` uses basis TRS only → any object parented while the parent wasn't at identity is mis-placed (common).
- **`childMap` key bug** (`index.ts:62-65`): writes pending children under the **child** key but reads by the **parent** key → children that appear before their parent are never re-nested; they fall through to the root dump (`:73-77`) with only local TRS (no parent transform).
- **Axis-angle rotmode (-1) unhandled** (`:97-106`): falls into the euler branch, reads zeroed `rot[]` instead of `rotAxis`/`rotAngle` → rotation lost silently.
- Delta transforms (`dloc/dscale/drot/dquat`) and constraints ignored. *Fix direction: mirror the exporter — decompose `parent_world.inverted() @ child_world` from `obmat`/`object_to_world`.*

### Mesh normals & triangulation (`loader/geometry.ts`)
- **Custom/split normals discarded** — all paths `computeVertexNormals()` (`:181,444,550`). Blender's corner-domain normals (sharp_face/sharp_edge/custom) are ignored → flat-shaded/hard-surface/custom-normal meshes render over-smoothed.
- **No tangents** generated → normal-mapped materials fall back to three's derivative tangents (different/wrong).
- **Concave/n-gon triangulation** — fan triangulation (`:144`, mid `vAt`, etc.) is wrong for concave or non-planar n-gons and concave quads (Blender ear-clips + flips the quad diagonal). Triangle count right, shape wrong → CAD/boolean/text geometry self-overlaps.
- **Legacy `createBufferGeometryOld` under-triangulates n-gons ≥5** (`:534`, `indexi += 2` → `ceil((len-1)/2)` tris → holes for pentagons+) and **over-allocates** the index buffer to `floor(totloop*3/2)` → odd-corner faces leave trailing 0-index slots → a degenerate triangle at the buffer origin. *(N-gon hole already tracked as deferred item #7; the over-allocation/degenerate-tri is a new regression vs upstream.)*

---

## MEDIUM — incomplete

- **Material node-graph tracing** (`material.ts`): `imageNodeFeeding` only hops a NormalMap node; the exporter recursively walks Separate-Color / Math / Mix / node groups (`search_node_tree.py`). Packed ORM, group-wrapped Principled, texture×factor setups missed.
- **Occlusion/AO** entirely unhandled (no `aoMap`).
- **`is_active_output` dead code** (`material.ts:140,279`): always `undefined` → always `outputs[0]`. Fine for single-output (common), wrong for multi-output. Correct read: `node.flag & 64`.
- **Mapping node / KHR_texture_transform ignored** — offset/rotation/scale dropped (three supports `texture.offset/repeat/rotation`).
- **Factor × texture dropped** (`material.ts:184-200`): forces base color (1,1,1), never sets roughness/metalness factors when a map is present.
- **Alpha mode from legacy `blend_method`** not the node graph; 4.2+ deprecates `blend_method` → node-driven cutouts left at SOLID are missed.
- **Material slots ignore `matbits`/`object.mat`** (`mesh.ts:39`) → Alt+D linked-dupes with per-object overrides get the wrong material (data is parseable, just unused).
- **Geometry cache keyed by `object.data`** folds in object-level subsurf → linked dupes with different subsurf levels get whichever built first.
- **Scene scoping:** `index.ts:19` emits *every* `Object` datablock (all scenes + orphans), not the active scene's master collection (`gather.py` scopes to one scene). Likely the "11 objects" surprise.
- **World/environment not imported** (background color / env-texture node tree parsed but unused → no `setEnvironmentMap`/scene background).
- **Active camera not designated** (`Scene.camera` ignored → loading doesn't restore the view).
- **Packed textures bypass the AssetImporter** (`material.ts:69-93`): no `userData.mimeType`/`_sourceImgBuffer` → non-deterministic canvas re-encode on GLB export; also **not awaited** → first-frame flash.
- Sampler interpolation (Closest/Linear/Cubic) → three min/mag filters not mapped; UV active-render-map vs first; single UV set only.

---

## LOW — latent / minor

- **Parser `setData` never assigns `length`** (`parser.js` setData loop reads `struct[i]/[i+1]/[i+3]/[i+4]/[i+5]` but **not `[i+2]`**) → inline-struct array members get `__data_address__ = NaN` / `__byte_length__ = NaN`. Limited blast radius (hot paths use primitive/pointer arrays) but a real landmine. **One-line fix:** `length = struct[i + 2]`.
- Parser dead `getPointer` (module-level) uses a different 64-bit key format than the live one — never called; delete to remove the footgun.
- No big-endian byte-swap (acceptable — Blender itself dropped big-endian).
- Vertex colors dropped.

---

## Suggested order of attack

1. **Quick wins (one-liners, high value):** light type table + watt conversion; sun→DirectionalLight2; camera `clip_start`/`clip_end` + remove duplicate shiftX; parser `length = struct[i+2]`; childMap key fix; axis-angle rotmode.
2. **Transform correctness:** consume `obmat` (or `parent⁻¹·child`) incl. parentinv/deltas — fixes a broad class of mis-placements.
3. **Camera FOV** via `sensor_fit` + render aspect; **light intensity** factors verified against `lights.py`.
4. **Modifier stack:** at minimum Mirror/Array/Solidify/Triangulate; flag Geometry Nodes as unsupported loudly.
5. **Mesh normals/tangents:**
   - ✅ **Flat shading via `sharp_face`** (`geometry.ts` `readFaceSharp` + `applySharpFaceNormals`, wired into the mid path 2026-06-13): a face Blender marks flat (`sharp_face` bool, Face domain — the inverted legacy `ME_SMOOTH`; default false=smooth) now takes its area-weighted **face normal** on all its corners; smooth corners keep the vertex normal averaged over **smooth faces only**; vertices are welded by `(vertex, quantized normal)` so smooth regions stay shared and split cleanly at flat/smooth seams (same weld pattern as UV seams). `sharp_face` is read the same proven way as `material_index` (a `pdata` `CD_PROP_BOOL` layer, or `attribute_storage` Bool in 5.0). **Strictly safe-by-default**: `triFace`/normal-split are built ONLY when the mesh actually has flat faces, so every all-smooth mesh (all current fixtures) takes the unchanged `computeVertexNormals` path. **Verified**: algorithm unit test (`tmp/sharp-normals-test.ts`, 7/7 — all-flat cube → 24 split verts each carrying its face normal; **all-smooth → byte-identical to `computeVertexNormals`**; mixed → only the flat face's corners split + carry its normal); brick end-to-end regression (`tmp/cc-brick-verify.ts`, 10/10 — brick has no `sharp_face`, so Plane/Sphere are bit-for-bit unchanged). Note: applies to the **non-subsurf** output (subsurf meshes use the CC path, which smooths).
   - ⏳ **Still needs a fixture:** `sharp_edge` (splits a smooth fan between two smooth faces — deferred; ignoring it just leaves those edges smooth, no worse than before), full custom split normals (`CD_CUSTOMLOOPNORMAL` clnors short[2] decode), and tangent generation. None of the probed fixtures (cube, brick, archiviz, splash, AC, Cable_Small) carry sharp-edge/custom-normal data, so these can't be implemented-and-verified without a `.blend` that has them. (probe: `tmp/normals-probe.ts`.)
6. ~~**Subdivision:** real Catmull-Clark (port, don't approximate) + subdivType/Simple~~ — ✅ **DONE & LIVE** (`catmull.ts` `subdivideCage`, wired into `mesh.ts`; face-varying UVs, boundary keep-corners, smooth normals, material groups; brick-verified).
7. **Material depth:** node-graph tracing, AO, Mapping/texture-transform, factor×texture.
8. **Scene/world:** scope to active scene's collection; import world env; mark active camera.

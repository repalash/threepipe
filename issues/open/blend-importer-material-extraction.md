# Blend importer: material extraction — glTF-exporter-faithful port + follow-ups

**Created:** 2026-06-05
**Status:** PBR mapping ported from Blender's glTF exporter; complex/external-texture cases are follow-ups.
**Scope:** `@threepipe/plugin-blend-importer` (`src/loader/material.ts`)

## Reference

Ported from Blender's official glTF exporter (canonical Principled-BSDF → glTF-PBR mapping), since
threepipe is glTF-first. Source at `.repos/gltf-blender-io/addons/io_scene_gltf2/blender/exp/material/`
(`pbr_metallic_roughness.py`, `materials.py`, `search_node_tree.py`, `extensions/*`). A precise
file:line mapping spec was extracted before porting (surface-output resolution, per-socket names with
3.x/4.x fallbacks, base-color clamp, emission strength split, ORM channel semantics, colour spaces,
default-omit rules). The implementation resolves the shader feeding the **active Material Output**
(not just any Principled BSDF), matching the exporter's `check_if_is_linked_to_active_output`.

## Done

`createMaterial` walks the material's shader node tree (`mat.nodetree.nodes`/`links` ListBases),
resolves the Principled BSDF feeding the active Material Output (falls back to any Principled), and maps:
- **Base Color** (Float3 RGBA) → `material.color` (linear, no conversion — Blender base color and
  three.js `setRGB` are both linear), clamped to [0,1]
- **Roughness**, **Metallic**, **Alpha** (→ opacity/transparent), **IOR**
- **Emission Color** (4.x+) / **Emission** (≤3.x) + a dedicated Emission node, with the exporter's
  strength/colour split: `peak>1 → emissiveIntensity = peak`, `emissive = colour/peak`
- **Transmission** (`Transmission Weight`/`Transmission`) → `transmission`
- **Clearcoat** (`Coat Weight`/`Clearcoat`, `Coat Roughness`/`Clearcoat Roughness`) → `clearcoat`/`clearcoatRoughness`
- **Sheen** (`Sheen Weight`/`Sheen` gate, `Sheen Tint`, `Sheen Roughness`) → `sheen`/`sheenColor`/`sheenRoughness`
- **Specular IOR Level**/`Specular` (×2, clamped) → `specularIntensity`

**Textures** for base colour / roughness / metallic / normal (via the Normal Map node, + `Strength` →
`normalScale`) / emissive / alpha, when linked to a *packed* Image Texture. Loaded synchronously with
async decode via Blob + `Image` (the three.js TextureLoader pattern — `needsUpdate` flips on load), so
no async threading through the loader was needed. Correct colour space per glTF convention: sRGB for
base/emissive, linear for roughness/metallic/normal. PNG/JPEG/BMP/WebP detected by magic bytes.

Falls back to the legacy `mat.r/g/b` viewport diffuse color (0.8 grey) when there's no Principled BSDF.

Verified: buildify_1.0 renders its real palette (navy ground, brown/orange crates), jiggly_pudding's
plate/pudding tones, the Blender 5.0 cube. Packed textures decode in-browser: radial_tiling 1/1,
blender-3.5-splash 6/6, GeometryNodesFrenchHous 3/3. Zero regressions on the 42-fixture harness.

Prevalence (from fixture scan): modern files are mostly Principled (buildify 8/8, jiggly 2/2,
Blender-282 32/46); artistic files (4.0 splash) are mostly procedural (45/68 have no Principled BSDF).

## Follow-ups (not done)

1. ~~**External (file-path) textures.**~~ **DONE (2026-06-05).** Image Texture nodes referencing an
   external file (`IMA_SRC_FILE`, `source === 1`, path in `Image.name`) load via `new TextureLoader(this.manager)`
   — the loader's `LoadingManager` is the AssetImporter's, which prepends the `.blend`'s base URL to relative
   paths (`_urlModifier`/`_rootContext`, `AssetImporter.ts:648,385`), so cache + dropped-sibling remap apply.
   Blender's `//` prefix and `\` separators are normalised; loads are awaited (`Promise.all(pending)` inside
   `loadAsync`, while `_rootContext` is active — the GLTFLoader pattern); missing files warn + skip (no throw);
   skipped in Node (no DOM). Threaded via an optional `ctx.loadExternalTexture(path, srgb)` provided by
   `BlendLoadPlugin`; `material.ts` `imageNodeTexture` tries packed bytes first, then external.
   Verified: detection + path-cleaning on real Blender-282 data (13/13 — `//greasepencil/tram/x.jpg` →
   `greasepencil/tram/x.jpg`, all 4 station images flagged external); load through the real viewer's
   LoadingManager (1024² sRGB texture decoded); graceful missing-file (returns Texture, no throw);
   packed-texture regression clean (splash 6/6, radial 1/1, French house 6/6).
   **Note:** no bundled fixture routes an external image *directly* to a traced socket — Blender-282's
   externals feed a custom node Group (toon shader), which the simple tracer doesn't follow (see procedural
   materials, #6). So the full graph→external→render chain isn't covered by one fixture; each part is
   verified independently. A `.blend` with `Image Texture → Base Color` (external) would exercise it end-to-end.

2. ~~**ORM-packed textures + channel semantics + AO.**~~ **DEFERRED (2026-06-07) — zero-value for the
   fixture set.** Probe (`tmp/blend-parser-work/probe-orm.mjs`, 314 Principled materials): **0** route
   Roughness/Metallic through a Separate Color node (no packed ORM anywhere), **0** have a glTF-Settings/
   Occlusion node (no AO). Roughness is constant in 273/314 and Metallic in 312/314 (already handled); the
   remaining few are procedural (`ValToRGB`/`MapRange`/`Mix`/Groups) — the can't-do graph-eval bucket (#6),
   not channel routing. Revisit only if a glTF-authored `.blend` with a real ORM/Separate-Color setup appears.

3. ~~**Alpha mode (MASK / clip).**~~ **DONE (2026-06-05).** Mapped from the material's Eevee
   `blend_method` (DNA): `MA_BM_CLIP (3)` → `material.alphaTest = alpha_threshold || 0.5` (cutout);
   `HASHED (4)` / `BLEND (5)` / `SOLID (0)` → alpha blend. Gated on the material actually having an alpha
   input (constant `Alpha < 1` or an alpha texture) so opaque materials are never made transparent — the
   default material reports `HASHED` but is opaque at `Alpha = 1`, and 16/433 probed materials had a
   non-SOLID `blend_method`. Verified: blender-3.5-splash → 2 clip materials get alpha test, 1056 stay
   opaque, default-general's HASHED material stays opaque, 6/6 textures intact. Remaining (low value): the
   4.2+ node-graph clip detection (`detect_alpha_clip`, `Math:Round`/`X<cutoff`) for files where
   `blend_method` is deprecated; and the ≤4.1 `SOLID`-with-`Alpha<1` case (2 synthetic fixtures) which we
   still render as blend rather than Blender's opaque (would need the file version to disambiguate).

4. ~~**Double-sided** = NOT `use_backface_culling` (`materials.py:289`).~~ **DONE (2026-06-05).**
   `material.side = (blend_flag & MA_BL_CULL_BACKFACE) ? FrontSide : DoubleSide`. The `blend_flag` bit is
   `MA_BL_CULL_BACKFACE = 1<<2` (NOT `MA_BL_HIDE_BACKFACE` 1<<0 — the earlier note guessed wrong; confirmed
   via `rna_material.cc:1136` where the `use_backface_culling` RNA property binds that exact bit). Probed
   across fixtures: values are 64/0/1/16, none with bit 2 set → all double-sided, matching Blender's
   culling-off default. Verified through the built plugin (every material loads DoubleSide, 0 FrontSide;
   buildify palette unchanged). Meshes with no material slot also default to DoubleSide (`mesh.ts`).

5. **Older socket struct layout (≤ Blender 2.82).** The `bNodeSocketValue*` `default_value` block in old
   files doesn't expose `.value` through our parser (resolves to an empty struct) — those materials fall
   back to the legacy grey. Investigate the older socket value DNA layout if old-file fidelity matters.

6. **Procedural / non-Principled materials** (Fresnel/Mix/Noise → Material Output, e.g. the 4.0 splash
   "Bush.001"). No single base colour exists — would require evaluating/flattening the shader graph (the
   exporter bakes these to textures via Blender's renderer; we can't). Falls back to grey. Low priority.

7. **Vertex colors** — `ShaderNodeVertexColor` / `ShaderNodeAttribute` (Color Attribute) nodes + the
   mesh's colour attribute → geometry `color` attribute + `material.vertexColors`.

   **DEFERRED (2026-06-05) — low value for the current fixture set, unsafe to enable naively.** Deeper
   investigation (`tmp/blend-parser-work/{inspect-colors,trace-vcol,probe-mloopcol}.mjs`):
   - The colour DATA is readable: legacy meshes expose `mesh.mloopcol[i].{r,g,b,a}` as sRGB bytes 0-255
     via getters (e.g. curve_bevel "Plane.001": 256 loops, values like 124/160/181 — note: greyscale,
     i.e. a baked AO/mask, not vertex *paint*). 5.0 would be `attribute_storage` ColorByte(9)/Float(10).
   - But across ALL vertex-colour fixtures, the colour attribute feeds **procedural** inputs —
     `Mix.Fac`, `Mix.B`, `VectorMath`, `Reroute`, or is unused — **never Base Color as a simple multiply**
     (the only thing three.js `material.vertexColors` can reproduce: it multiplies the colour attribute
     into base colour). So enabling `vertexColors` would be WRONG (it'd tint/darken meshes that use the
     colour as a mix factor / vector input). The faithful rule (`gather_color_info`: enable only when a
     colour-attrib node feeds base colour, directly or via a multiply) yields **no visible change** on any
     current fixture, because none do that. Correctly reproducing the procedural usage needs full
     shader-graph evaluation — which we can't do (the exporter bakes those via Blender's renderer).
   - Revisit only with a fixture that uses `Color Attribute → Base Color` (vertex paint as albedo).

   Original feasibility scan (`tmp/blend-parser-work/scan-vcolor.mjs`, 2026-06-05) — **8 fixtures use a
   vertex-colour node** in a material: GeometryNodesFrenchHous, archiviz, blender-4.0-splash,
   blender-4.5-splash, candy_bounce, curve_bevel_profile, flower_scattering, jiggly_pudding. But the
   first-pass scan found **no backing colour attribute** for any of them, so **step 1 is locating the
   colour data**, which spans two storage paths and must be done before wiring `vertexColors`:
   - **Blender 5.0** `attribute_storage`: `AttrType.ColorByte = 9` (4×uint8, **sRGB-encoded**) /
     `ColorFloat = 10` (4×float32, **linear**), on `Point` (0) or `Corner` (3) domain. Read alongside
     position/UV in `geometry.ts createBufferGeometryFromAttributes` (same `readAttrArray` path).
   - **Blender ≤4.x** legacy CustomData: colour layers live in `vdata` (Point) or `ldata` (Corner) as
     `CD_PROP_BYTE_COLOR`/`CD_PROP_COLOR` — the scan's `type === 17 || 47` guess matched nothing, so
     the actual CustomData type numbers must be confirmed from Blender `BKE_customdata.hh` first.

   Then: `ColorByte` → sRGB→linear convert (glTF COLOR_0 is linear); Corner domain → per-vertex assign
   like UVs; set `geometry.attributes.color`. In `material.ts`, set `material.vertexColors = true` only
   when a `ShaderNodeVertexColor`/`ShaderNodeAttribute` actually feeds the surface (else a mesh with a
   stray colour attribute would be wrongly tinted). Guard in `mesh.ts`: a material wanting vertex colours
   applied to a geometry that lacks a `color` attribute must NOT keep `vertexColors=true` (three.js would
   render it black) — clone the cached material to a non-vertex-colour variant for that mesh.
   NB: the scan OOMs on one large fixture; cap per-file work / run in chunks when re-scanning.

## References

- `plugins/blend-importer/src/loader/material.ts` — the implementation (glTF-exporter-faithful).
- `.repos/gltf-blender-io/addons/io_scene_gltf2/blender/exp/material/` — the canonical reference:
  `pbr_metallic_roughness.py`, `materials.py`, `search_node_tree.py`, `texture_info.py`, `extensions/*`.
- `.repos/blender/source/blender/makesdna/DNA_node_types.h` — bNode/bNodeSocket/bNodeSocketValue* structs.

# Changelog for @threepipe/plugin-blend-importer

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- NA

## [0.4.0] - 2026-11-26

Works with threepipe 0.3.0 and later: every name the build imports from threepipe is exported by 0.3.0. The `onBlendLoad` callback and the parsed file it receives are unchanged (`blend.thumbnail`, `blend.objects`, the raw DNA structs such as `Object.modifiers.first`/`.next` and `ModifierData.type`).

### Added

- **Plain three.js entry point: `@threepipe/plugin-blend-importer/three`.** Exports `BlendLoader`, a three.js loader (`load`/`loadAsync`/`parse`/`parseAsync`, `LoadingManager`, `setPath`/`setResourcePath`/`setCrossOrigin`) that resolves with `{scene, blend}`, for projects that don't use threepipe. It imports only `three` (as a namespace, with runtime checks for APIs that changed between versions, such as `colorSpace` vs `encoding`), so it works with the project's own three.js; tested on r125, r137, r150, r160, r170 and r187. fflate, fzstd and the parser are bundled. External textures load with three's `TextureLoader` (TGA with a built-in decoder); `setTextureLoader(fn)` plugs in EXR/HDR/other loaders. ES module (`dist/threejs.mjs`) and UMD (`dist/threejs.js`, global `BlendLoader`) builds.
- **Modifier stack.** Subdivision Surface (Catmull-Clark on the n-gon cage, as Blender's OpenSubdiv; Simple; capped to a triangle budget), Mirror, Array and Solidify are evaluated per object, in stack order. "Smooth by Angle" (Blender 4.1+ Auto Smooth) is applied through the normals. Other modifiers are reported once per object. A modifier that throws is skipped and the object keeps its geometry from before it, as Blender continues past a modifier that errors.
- **`BlendLoadPlugin.evaluationMode`** (`'viewport'` default, or `'render'`). Blender evaluates every modifier stack in one of two modes, and the mode decides which modifiers run (`eModifierMode_Realtime` vs `eModifierMode_Render`, `mesh_data_update.cc:303`) and which Subsurf level is used (`levels` vs `renderLevels`, `MOD_subsurf.cc:86`). The importer used to mix them, running modifiers by their render flag at their render level. It now follows one mode, defaulting to the viewport like Blender's own exporters (`IO_wavefront_obj.hh:53`). On the 171 MB bugatti test car, whose densest parts are authored Subsurf viewport 0 / render 2, that is 10.2M triangles instead of 12.3M.
- **Blender-accurate normals.** Flat-shaded faces, Auto Smooth (`Mesh.flag`/`smoothresh` before 4.1, the "Smooth by Angle" modifier from 4.1), sharp edges and sharp faces are now honoured. Normals are angle-weighted per corner like Blender's, and vertices are split at hard edges and UV seams. Previously every mesh got three.js `computeVertexNormals` (or Blender's smooth vertex normals), so hard-surface models looked blobby, with shading smeared across their edges. Checked against Blender 5.3's evaluated corner normals: 0.00° error on a Blender 3.0 scene and on a 5.x test file (flat cube, smooth sphere, sharp edges, Smooth by Angle modifier, concave n-gons). The error was 29° on average before.
- **Object transforms ported from Blender** (`BKE_object_to_mat4` and `solve_parenting`): parent inverse matrices, delta transforms and every rotation mode, so parented and delta-transformed objects land where Blender puts them. Cameras and lights get the glTF exporter's forward-axis correction.
- **Lights and cameras like Blender's glTF exporter:** sun, spot and area lights, watts converted to three's physical units (r155+), spot cone and blend; perspective/orthographic cameras with sensor fit and `clip_start`/`clip_end`, lens shift in `userData`.
- **Mapping node** in front of an Image Texture sets the texture's repeat, offset and rotation.
- **TGA textures**, packed or external. Browsers can't decode TGA, so a packed one used to fall back to its file path (usually missing) and an external one had no loader. A decoder taken from three's TGALoader (`src/loader/tga.js`) now reads them; `BlendLoadPlugin` registers a `.tga` importer with the AssetImporter when none is registered.
- **Emission and Background shaders** wired straight into the output now load as an unlit material (Color × Strength, with the texture as `map`), as Blender's glTF exporter does. Before, they rendered as lit 0.8 grey with the emission added on top. **Diffuse BSDF** outputs map to a fully rough, non-specular material.
- Pre-2.63 meshes (`MFace` only) load instead of coming out empty.

### Fixed

- **Missing triangles on n-gons.** Pre-4.0 files (`MPoly`) were triangulated with a step-2 strip that dropped triangles from every face with 5+ corners, and padded the index with zeros. All mesh layouts now share one triangulation that matches Blender's: quads split like `is_quad_flip_v3_first_third_fast`, and n-gons are ear-clipped in their plane, so concave faces are no longer filled across their gaps.
- **Pre-3.6 files with a Subsurf modifier failed to load.** A Blender 2.7x car (171 MB) loaded on 0.2.0 and, with the modifier stack, worked for ~80 s and then `load()` resolved empty. Four defects stacked: (1) the `MPoly` path sized its buffers as `floor(totloop * 3 / 2)` and triangulated with a step-2 strip, so the index was padded with zeros, was usually not a whole number of triangles, and every face of five or more corners lost the triangles the strip missed - 0.2.0 rendered that car ~389k triangles short; now a fan with exact `n - 2` sizing, triangles and quads unchanged. (2) Subsurf read that index three at a time and ran off its end; `subdivideGeometry` now rejects such a buffer with a message that says so. (3) One failing modifier failed the whole file; each now runs in isolation, and a failure is logged and the geometry from before it kept, as Blender continues past a modifier that errors. (4) The `MPoly` path had no Catmull-Clark cage, so Subsurf fell back to Loop on a per-corner buffer that it could not smooth and whose boundary pass was quadratic; it now builds the same cage as the 3.6-4.x path, and the boundary pass is linear (output bit-identical).
- **Blender 5.x files with more than one mesh showed the same geometry everywhere.** Blender 5.x writes per-datablock pointer addresses, so the same address recurs in every mesh. The parser kept one global address map, so each mesh resolved to the last mesh's attribute arrays. Pointers now resolve within the owning ID's DATA blocks first, as Blender's reader does.
- **Fields after a 3-D array in a struct were read from the wrong offset.** The parser only understood two array dimensions, so in Blender 3.0+ `Image` (`*gputexture[3][2][2]`) `source`, `packedfile` and `packedfiles` were misread, and packed textures fell back to loading a file that isn't there.
- **Missing images are one warning per file.** An external image that isn't there, or whose format no importer reads, used to log several AssetImporter errors each. The plugin now checks first (the importer's registered extensions, and a `HEAD` request for http(s) URLs) and reports what it left out in one warning when the import finishes; packed images in formats it can't decode (HDR, EXR) are in the same warning. Objects of types that aren't imported (curves, armatures, light probes...) are listed in one warning too, instead of a warning per object.
- Multi-material meshes get one geometry group per material slot, not one per run of faces.
- **Meshes without faces crashed three's renderer.** A mesh with only loose edges or points (common as a geometry-nodes input, e.g. in Blender's hexgrid demo) became a `BufferGeometry` with no `position` attribute, and three's `WebGLRenderer` throws on that every frame. It now gets an empty `position` and draws nothing, as in Blender.

### Changed

- The loader core (`src/loader/`) no longer imports from threepipe at runtime: three.js classes and constants come through `Ctx` (`createCtx(threeNamespace, overrides)`), which `BlendLoadPlugin` fills with threepipe's classes. `decompressBlend` takes the gunzip function as an argument. No change for threepipe users.
- `three` is an optional peer dependency (>= 0.125), and so is `threepipe`: install the one you use.
- The geometry is indexed: corners are welded into shared vertices and split only at hard edges and UV seams, so meshes have fewer vertices than before (1.35M instead of 3.1M on Blender's Mr Elephant demo, for the same faces).

## [0.3.1] - 2026-10-24

### Fixed

- **Metallic textures had no effect.** A texture linked to the Principled BSDF Metallic input set `metalnessMap` but left `metalness` at 0, and three.js multiplies the map by that factor, so the surface stayed non-metallic. `metalness` is now 1 when the map is set.
- **Emission textures were not applied.** The emission texture was loaded and used to pick the emissive color, but never assigned to `emissiveMap`, so the surface emitted a flat color (white with Blender's default black factor) instead of the texture pattern. It is now set as `emissiveMap`.

## [0.3.0] - 2026-10-23

### Added

- **Blender 5.0 (file format version 1) support.** Reads the new 17-byte header (`BLENDER17-01v0500`) and the reordered 32-byte `LargeBHead8` block layout (64-bit lengths, `SDNAnr`/`len` swapped). Added `int8_t`/`int16_t`/`int32_t`/`int64_t`/`uint*` explicit-width SDNA field types (Blender 5.0 DNA uses them widely). Verified against the bundled Blender 5.0 startup file and 3 geometry-nodes scenes; all 41 legacy fixtures (Blender 1.69 → 4.5) remain byte-identical.
- **Blender 5.0 mesh geometry via `attribute_storage`.** Blender 5.0 moved mesh data out of CustomData (`vdata`/`ldata`) into a new `AttributeStorage` of named attributes. The loader now reads `position` (Float3) and `.corner_vert` (Int32) from it, using each attribute's stored `AttributeArray.size` (the Mesh `tot*` fields are runtime/post-geometry-nodes counts that don't match the stored arrays). NaN/Inf verts are sanitized; out-of-range face indices are skipped.
- **UV extraction** from the first user `UVMap` (Float2 corner-domain attribute) on the Blender 5.0 path. Per-vertex assignment (exact away from UV seams).
- **PBR materials, ported from Blender's glTF exporter mapping.** `createMaterial` resolves the shader feeding the active Material Output (not just any Principled BSDF) and maps its sockets to `MeshPhysicalMaterial` following [glTF-Blender-IO](https://github.com/KhronosGroup/glTF-Blender-IO)'s Principled-BSDF → glTF-PBR logic (threepipe is glTF-first): Base Color (clamped), Roughness, Metallic, Normal (+ strength from the Normal Map node), Alpha, IOR, Emission (with the `>1` strength/colour split), plus Transmission / Clearcoat / Sheen / Specular. Socket names handle both Blender 4.x and 3.x (e.g. `Emission Color`/`Emission`, `Transmission Weight`/`Transmission`, `Coat Weight`/`Clearcoat`). Previously only the legacy `mat.r/g/b` viewport colour (0.8 grey for most files) was used, so every loaded `.blend` rendered flat grey. Falls back to the legacy colour for procedural materials with no Principled BSDF.
- **Packed textures** for base colour, roughness, metallic, normal, emissive and alpha inputs. When a socket is linked to an Image Texture node whose image is packed into the `.blend`, the embedded image (PNG/JPEG/BMP/WebP) is decoded into the matching `material.*Map` with the correct colour space (sRGB for base/emissive, linear for data maps).
- **External (file-path) textures.** Image Texture nodes whose image is a file reference (Blender `IMA_SRC_FILE`, path in `Image.name`, e.g. `//textures/wood.png`) are now loaded too — resolved relative to the `.blend`'s directory through threepipe's `LoadingManager` (so the asset cache, dropped-sibling-file remap and progress tracking all apply), matching how the glTF/OBJ importers resolve sibling resources. Blender's `//` (blend-relative) prefix and Windows separators are normalised; the loads are awaited before the scene is returned, and a missing file logs a warning and is skipped rather than failing the import. Skipped in Node (no DOM).
- **Multiple materials per mesh.** Meshes with more than one material slot now render each face with its assigned material instead of only slot 0's. Per-face material index is mapped to `BufferGeometry` groups and `mesh.ts` hands three.js the full material-slot array. In a 56-file fixture scan **33% of meshes use >1 slot**, so this fixes a common, visible gap (e.g. an air-conditioner model whose black fan housing and orange knobs previously rendered flat grey). Covers all three storage layouts: legacy `mpoly.mat_nr`, the Blender 3.6–4.x `corner_vert` path (`pdata` `material_index` layer), and the 5.0 `attribute_storage` path (`material_index` Face attribute). Even a single-slot run is grouped, so a mesh whose faces all use slot 2 renders `material[2]`, not `material[0]`.
- **Double-sided rendering.** Blender materials default to backface culling OFF, i.e. they render double-sided; the glTF exporter maps this as `doubleSided = not use_backface_culling`. The loader now sets `material.side = DoubleSide` unless the material's `blend_flag` has the "Backface Culling" bit (`MA_BL_CULL_BACKFACE`) set (and for meshes with no material slot, which use Blender's double-sided default material). Previously everything was three.js `FrontSide`, so thin/open geometry (planes, leaves, interiors) was invisible from behind.
- **Alpha cutout (clip) mode.** Materials with the Eevee `blend_method` set to `CLIP` now use `material.alphaTest` (from the material's `alpha_threshold`, default 0.5) instead of alpha blending — the correct treatment for cutout foliage/decals. `HASHED`/`BLEND` still map to alpha blend. The alpha mode is only applied when the material actually has an alpha input (a constant `Alpha < 1` or an alpha texture), so opaque materials are never turned see-through — including the default material, which reports `HASHED` but is opaque at `Alpha = 1`. Verified on blender-3.5-splash (2 clip materials → alpha test, 1056 stay opaque, 6/6 textures intact).

### Fixed

- **Textured meshes had no UVs on the Blender 3.6–4.x path.** The mid `corner_vert` geometry path (files newer than `mpoly` but pre-5.0 — a very common range) extracted positions and faces but never read the UV layer, so any textured mesh got its `material.map` but no `uv` attribute → the texture sampled a single texel and surfaces rendered flat/untextured (e.g. a labelled bottle rendering plain white). It now reads the `UVMap` Float2 corner layer (`CD_PROP_FLOAT2`) from `ldata` and assigns per-vertex UVs, matching the 5.0 `attribute_storage` and legacy `mpoly` paths. Verified: the WaterBottle sample's wrapped label and a `pbrMetallicRoughness` decal now map correctly.
- **Parser dropped material slots after an empty one.** The `Type**` pointer-array reader (`pointerProp2`) walked the array until the first NULL pointer and stopped, so a mesh with an empty material slot before a used one (e.g. `[null, Material.007]`) read as `[]`/truncated — losing the later materials. Combined with multi-material grouping this rendered those faces invisibly (verified: 7 meshes in blender-3.5-splash). It now reads the whole allocated array (block length ÷ pointer size), preserving null/empty slots, and uses the file's pointer size instead of a hard-coded 8 (also fixing 32-bit pointer files). `mesh.ts` pads the material array defensively so an out-of-range `material_index` can never make a face invisible.
- **Emission textures rendered no light.** When an image was wired into a Principled "Emission Color" socket whose stored default is black (Blender's default), the black factor multiplied the emissive map to zero. A connected emission texture with a missing/black colour factor is now treated as white so the map shows.
- **Alpha-cutout textures used the wrong channel.** When the Alpha input is the same image as Base Color (the usual `Image.Color→Base Color`, `Image.Alpha→Alpha` foliage setup), the loader no longer also assigns a `material.alphaMap` — three.js samples `alphaMap` from the GREEN channel, which is not the mask. The base `material.map` (RGBA) already supplies per-pixel opacity from the texture's alpha channel, so cutouts (grass/leaves) are now correct.
- Packed-image decoding bounds-checks `PackedFile.size`/address against the buffer, so a corrupt embedded image is skipped instead of throwing an uncaught `RangeError` that failed the whole import. External-texture loading resolves (never rejects) on a synchronous loader error too, preserving the "one bad path doesn't fail the import" guarantee.
- `ERROR` is module-global in the parser and wasn't reset between parses — a failed parse (e.g. an unsupported big-endian file) leaked its error onto the next successful parse. Now reset per parse.
- Big-endian `.blend` files (ancient Blender < 2.0) are rejected with a clear message instead of producing garbage geometry.
- Alignment-safe TypedArray reads (`alignedTypedArray` + `BLENDER_FILE.readTypedArray`) — Blender packs blocks with no padding, so on Blender 5.0 (and some older files) attribute payloads land at unaligned offsets where a direct `new Float32Array(buf, oddOffset, n)` threw `RangeError`.

## [0.2.0] - 2026-06-05

### Added

- Support for compressed `.blend` files: gzip (Blender ≤ 2.93) via fflate, and zstd (Blender 3.0+ default save format) via [fzstd](https://github.com/101arrowz/fzstd). Magic-byte detection mirrors Blender's own `BLO_file_reader_uncompressed`. Verified end-to-end against 13 official Blender demo files spanning v1.69 → v4.5.
- Typed `BlendFile` and `BlendLoadOptions` interfaces exported from the plugin entry, with JSDoc and a worked example. The existing `onBlendLoad` callback was already wired in but undiscoverable; consumers can now use it to access Blender's embedded preview thumbnail (`blend.thumbnail`, RGBA8 `{width, height, data: Uint32Array}` — typically 128×128, present in ~9 of 10 real .blend files) and the raw parsed DNA tree without re-parsing. Not put on `userData` to avoid round-tripping the typed array through serialization / export.

### Changed

- Loader now rejects files whose first bytes don't match `BLENDER`, gzip, or zstd magic, with a diagnostic error including the offending bytes in hex. Previously such inputs reached the parser and produced a logged warning + empty scene; the new behavior surfaces the failure clearly to callers.

### Fixed

- Bounds guard added to the parser's SDNA-search loop. On certain Blender 4.x geometry-nodes files the DNA1 search walked past EOF and `DataView.getInt32` threw `RangeError` synchronously, killing the entire `viewer.load(...)` promise. Now sets `ERROR` softly and lets the parser return a partial result, matching the soft-error pattern already used in the main block loop.

## [0.1.0] - 2025-09-03

### Fixed

- Fix `peerDependency` issue on npm.

## [0.0.9] - 2025-09-01

### Changed

- Update [threepipe](https://threepipe.org/) `peerDependency` to [0.1.0](https://github.com/repalash/threepipe/releases/tag/v0.1.0)

[unreleased]: https://github.com/repalash/threepipe/tree/dev/plugins/blend-importer
[0.3.1]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-blend-importer-0.3.1
[0.3.0]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-blend-importer-0.3.0
[0.2.0]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-blend-importer-0.2.0
[0.1.0]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-blend-importer-0.1.0
[0.0.9]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-blend-importer-0.0.9

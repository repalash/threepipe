# Changelog for @threepipe/plugin-blend-importer

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- **Blender 5.0 (file format version 1) support.** Reads the new 17-byte header (`BLENDER17-01v0500`) and the reordered 32-byte `LargeBHead8` block layout (64-bit lengths, `SDNAnr`/`len` swapped). Added `int8_t`/`int16_t`/`int32_t`/`int64_t`/`uint*` explicit-width SDNA field types (Blender 5.0 DNA uses them widely). Verified against the bundled Blender 5.0 startup file and 3 geometry-nodes scenes; all 41 legacy fixtures (Blender 1.69 → 4.5) remain byte-identical.
- **Blender 5.0 mesh geometry via `attribute_storage`.** Blender 5.0 moved mesh data out of CustomData (`vdata`/`ldata`) into a new `AttributeStorage` of named attributes. The loader now reads `position` (Float3) and `.corner_vert` (Int32) from it, using each attribute's stored `AttributeArray.size` (the Mesh `tot*` fields are runtime/post-geometry-nodes counts that don't match the stored arrays). NaN/Inf verts are sanitized; out-of-range face indices are skipped.
- **UV extraction** from the first user `UVMap` (Float2 corner-domain attribute) on the Blender 5.0 path. Per-vertex assignment (exact away from UV seams).
- **PBR materials, ported from Blender's glTF exporter mapping.** `createMaterial` resolves the shader feeding the active Material Output (not just any Principled BSDF) and maps its sockets to `MeshPhysicalMaterial` following [glTF-Blender-IO](https://github.com/KhronosGroup/glTF-Blender-IO)'s Principled-BSDF → glTF-PBR logic (threepipe is glTF-first): Base Color (clamped), Roughness, Metallic, Normal (+ strength from the Normal Map node), Alpha, IOR, Emission (with the `>1` strength/colour split), plus Transmission / Clearcoat / Sheen / Specular. Socket names handle both Blender 4.x and 3.x (e.g. `Emission Color`/`Emission`, `Transmission Weight`/`Transmission`, `Coat Weight`/`Clearcoat`). Previously only the legacy `mat.r/g/b` viewport colour (0.8 grey for most files) was used, so every loaded `.blend` rendered flat grey. Falls back to the legacy colour for procedural materials with no Principled BSDF.
- **Packed textures** for base colour, roughness, metallic, normal, emissive and alpha inputs. When a socket is linked to an Image Texture node whose image is packed into the `.blend`, the embedded image (PNG/JPEG/BMP/WebP) is decoded into the matching `material.*Map` with the correct colour space (sRGB for base/emissive, linear for data maps).
- **External (file-path) textures.** Image Texture nodes whose image is a file reference (Blender `IMA_SRC_FILE`, path in `Image.name`, e.g. `//textures/wood.png`) are now loaded too — resolved relative to the `.blend`'s directory through threepipe's `LoadingManager` (so the asset cache, dropped-sibling-file remap and progress tracking all apply), matching how the glTF/OBJ importers resolve sibling resources. Blender's `//` (blend-relative) prefix and Windows separators are normalised; the loads are awaited before the scene is returned, and a missing file logs a warning and is skipped rather than failing the import. Skipped in Node (no DOM).
- **Double-sided rendering.** Blender materials default to backface culling OFF, i.e. they render double-sided; the glTF exporter maps this as `doubleSided = not use_backface_culling`. The loader now sets `material.side = DoubleSide` unless the material's `blend_flag` has the "Backface Culling" bit (`MA_BL_CULL_BACKFACE`) set (and for meshes with no material slot, which use Blender's double-sided default material). Previously everything was three.js `FrontSide`, so thin/open geometry (planes, leaves, interiors) was invisible from behind.
- **Alpha cutout (clip) mode.** Materials with the Eevee `blend_method` set to `CLIP` now use `material.alphaTest` (from the material's `alpha_threshold`, default 0.5) instead of alpha blending — the correct treatment for cutout foliage/decals. `HASHED`/`BLEND` still map to alpha blend. The alpha mode is only applied when the material actually has an alpha input (a constant `Alpha < 1` or an alpha texture), so opaque materials are never turned see-through — including the default material, which reports `HASHED` but is opaque at `Alpha = 1`. Verified on blender-3.5-splash (2 clip materials → alpha test, 1056 stay opaque, 6/6 textures intact).

### Fixed

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
[0.2.0]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-blend-importer-0.2.0
[0.1.0]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-blend-importer-0.1.0
[0.0.9]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-blend-importer-0.0.9

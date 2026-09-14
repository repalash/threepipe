# Blend importer: multiple materials per mesh

**Created:** 2026-06-07
**Status:** DONE across all three geometry paths (legacy `mpoly`, mid `corner_vert`, 5.0 `attribute_storage`). One optional perf optimisation remains (sort triangles by slot to minimise group count).
**Scope:** `@threepipe/plugin-blend-importer` (`src/loader/mesh.ts`, `src/loader/geometry.ts`)

## Why

A mesh in Blender has a material-slot array (`Mesh.mat`, length `totcol`) and each face references a slot by
index. The loader previously used only `object.data.mat[0]`, so **every face rendered with the first slot's
material**. Fixture scan (`tmp/blend-parser-work/probe-multimat.mjs`, 56 files, 2021 meshes with geometry):
**665 meshes (33%) have >1 slot** — totcol distribution `{1:1288, 2:537, 3:66, 4:54, 5:6, 6:1, 21:1}`. Of those,
155 legacy `mpoly` meshes have genuinely *mixed* `mat_nr` (visibly multi-material). A common, visible gap.

## Done (legacy `mpoly` path)

- `geometry.ts createBufferGeometryOld`: when `totcol > 1`, reads per-face `mat_nr`, and since faces are
  emitted in order (contiguous index ranges), merges consecutive same-slot faces into `BufferGeometry`
  groups via `geometry.addGroup(start, count, mat_nr)`. Groups are emitted whenever the multi-slot path runs
  (even a single run — so a mesh whose faces all use slot 2 renders `material[2]`, not `material[0]`).
- `mesh.ts`: builds one material per slot (`object.data.mat.map(createMaterial)`); hands three.js the array
  when the geometry has groups, else a single material (the common case). Empty slots → Blender's default
  double-sided material. Per-blender-material caching preserved.

Verified: AC.blend "Cube.004" (4 slots LightGrey/Grey/Black/Orange) renders all four — black fan housing +
orange knobs/pipes, previously flat grey (1 mesh → 14 groups). Character.blend → 4 multi-material meshes,
143 groups. buildify (mid path) unaffected — 0 groups, no regression.

## Done (mid `corner_vert` + 5.0 `attribute_storage` paths)

Both build **indexed** geometry (fan triangulation) in `geometry.ts`; a shared `mergeGroupRun(runs, start,
count, mat)` helper tags each face's emitted triangle range with its slot and merges contiguous same-slot
faces into `geometry.addGroup` calls. `mesh.ts` already builds the material array once groups exist.

1. **5.0 `attribute_storage` path** (`createBufferGeometryFromAttributes`). `material_index` is a Face-domain
   `Int32` (AttrType 3) attribute, read via the existing `readAttrArray`/`attrSize` infra. **Verified:**
   `raycast-line.blend` (5.0, totcol=3 meshes) → 12 meshes grouped, scene loads (83 meshes), no error.

2. **Mid `corner_vert` path** (main `createBufferGeometry` body). `material_index` resolved: it IS in `pdata`
   as a layer named `material_index` (CD_PROP_INT32, type 11), one int per face, resolving to plain ints (not
   `{address}` placeholders) — accessed via the existing `getLayer` helper (`pdata.layers` is a single object
   when `totlayer===1`, an array otherwise). New `readFaceMaterialIndex(meshData, faceCount)` helper. The
   earlier `probe-matidx.mjs` "not found" was a single-layer access bug, not a missing layer. **Verified:**
   `buildify_1.0` 0→7 multi-material meshes (renders correctly), `blender-3.5-splash` 80 meshes / 381 groups
   (textures 6/6 intact), `uploads_files_5611471_iso5` 8 meshes. No geometry/texture regressions.

## Parser fix this depended on (2026-06-09)

Multi-material exposed a latent **parser bug**: `pointerProp2` (the `Type**` array reader) broke at the
first NULL pointer, so a `Material**mat` array with an empty slot before a used one (e.g. `[null, mat]`)
read as truncated/empty → faces referencing the later slot rendered invisibly (7 meshes in
blender-3.5-splash). Fixed to read the full allocated array (block length ÷ pointer size), preserve null
slots, and use the file's pointer size (not hard-coded 8). `mesh.ts` also pads the material array so an
out-of-range index can't make a face invisible. See CHANGELOG + `blend-importer-code-review-followups.md`.

## Remaining (optional perf)

- **Minimise group count by sorting triangles by slot.** Per-run grouping keeps the index buffer in face
  order, so heavily-interleaved meshes get many small groups (e.g. buildify ~1118 groups, splash 381). Correct
  but more draw calls. Optionally sort triangles by `material_index` before writing the index buffer → exactly
  ≤`totcol` groups per mesh. Low priority (correctness is unaffected).

## References

- `plugins/blend-importer/src/loader/geometry.ts` (`createBufferGeometryOld` groups), `src/loader/mesh.ts`.
- `tmp/blend-parser-work/probe-multimat.mjs`, `probe-matidx.mjs`, `probe-mixed-matnr.mjs`.

# Blend importer: code-review follow-ups (deferred items)

**Created:** 2026-06-09 (from the xhigh `/code-review` of the material/multi-material work)
**Scope:** `@threepipe/plugin-blend-importer`

The review surfaced 14 candidates. **6 correctness/cleanup items were fixed** (parser pointer-array
truncation → invisible faces; emission black-default kills the map; alphaMap green-channel cutouts;
packed-texture `RangeError`; external-texture sync-throw; `(this as any).manager` cast). The items below
were **deliberately deferred** — each with the reason a naive fix is wrong or the cost outweighs the value
right now. Re-evaluate when picking up the loader again.

## Fixed (2026-06-11) — EXR/HDR data-map flipY mismatch

**Symptom:** on materials mixing a raster base color (jpg/png) with EXR/HDR normal/roughness/displacement
maps (e.g. Poly Haven `medieval_red_brick`), the normal map appeared not to work — surface relief looked
flat and "painted on", fighting the diffuse instead of reinforcing it.

**Root cause:** the AssetImporter loads rasters as image textures (`flipY=true`) but EXR/HDR as
`DataTexture`s (`flipY=false`). WebGL's `UNPACK_FLIP_Y_WEBGL` only applies to DOM/ImageBitmap uploads, not
to `ArrayBufferView` (DataTexture) uploads — so the data map samples **vertically mirrored** vs the raster
maps on the same UVs. The normal/rough/disp detail landed upside-down and misaligned with the diffuse.

**Fix:** `BlendLoadPlugin.importExternalTexture` now pre-flips imported `flipY=false` DataTextures' rows into
a **private copy** (`flipDataTextureRowsY`, fresh typed array + `Source`, so the AssetImporter-cached source
is never mutated — the same EXR is reused across materials). After the flip a data map samples identically to
a `flipY=true` raster; three + Blender share the OpenGL (`nor_gl`) green-up convention so `normalScale` stays
positive (no green negation). Verified by render: full PBR relief now aligns + reads convex; isolated
normal-only render shows correct brick relief at faithful `normalScale (1,1)`.

Decode itself was already correct — the EXRLoader DWA single-channel fix (separate work) makes the EXR
normal decode to valid tangent-space data (B≈1, R/G≈0.5); this was purely an orientation bug.

## Fixed (2026-06-11) — texture wrap mode ignored (back-of-sphere "stretched" smear)

**Symptom:** a UV-mapped mesh whose UVs fall outside [0,1] (tiled materials; the Poly Haven preview sphere's
unwrap is raw U∈[-0.5,1.5], verified) showed the texture **smeared into horizontal stripes** on the regions
where U left [0,1] (e.g. the back of the sphere).

**Root cause:** `imageNodeTexture` never set `wrapS/wrapT`, so textures kept three.js's default
`ClampToEdgeWrapping`. Blender's Image Texture defaults to **"Repeat"** (`NodeTexImage.extension == 0`), so
out-of-[0,1] UVs that should TILE instead clamped to the edge texel → stretch. (The Mapping node here is
identity, and the UV is read correctly — it really is a >1 / <0 unwrap that must tile.)

**Fix:** `applyWrap()` maps `NodeTexImage.extension` → wrap (0 Repeat→`RepeatWrapping` default, 1 Extend / 2
Clip→`ClampToEdge`, 3 Mirror→`MirroredRepeat`), applied to packed + external textures in `material.ts`.
`importExternalTexture` now preserves the wrap across `texture.copy(imported)` (copy would reset it to the
importer's ClampToEdge default). Verified: the sphere tiles correctly all the way around.

## Fixed (2026-06-11) — Subsurf rounded a flat plane into a shrunken disc (plane hidden inside sphere)

**Symptom:** a scene with a Plane + Sphere coincident at the origin (Poly Haven preview — both identity
transform, verified) showed only the sphere; the plane appeared "clipped to inside the sphere".

**Root cause:** the Subsurf step (`subdivide.ts`, Loop subdivision) applied the smooth boundary rule to the
plane's open boundary, pulling every 90° corner inward. Over the render levels the 2×2 square rounded into a
disc of radius ~1.06 — smaller than the sphere (1.16) — so it was entirely swallowed. (A correct square has
corners at ~1.63 that poke out past the sphere and stay visible.) Also shrank the plane's UVs to [0.04,0.96].

**Fix:** Blender Subsurf's default **"Keep Corners"** boundary behaviour — a boundary vertex whose two
boundary edges meet at a sharp angle (cos > -0.866, ~150°) is pinned instead of smoothed. The flat plane now
stays a full ±1.16 square with UV [0,1]; its corners are visible past the sphere.

## Fixed (2026-06-11) — per-corner UV vertex expansion (seam-correct UVs; the documented last-write-wins TODO)

`createBufferGeometry` (mid vdata/ldata path) assigned one UV per Blender vertex (last-write-wins), so a
vertex on a UV seam got a single UV and faces across the seam interpolated the texture over the seam → smear.
Now expands to one vertex per unique `(blenderVert, uv)` (`cornerToVert`/`vAt`), splitting seams. Coincident
split verts stay welded under Subsurf (same positions → same repositioning), so no crack. Closes the TODO at
the old `geometry.ts:163`. (Independent of the wrap fix above; both are real UV-correctness fixes.)

## Fixed (2026-06-11) — EXR/HDR placeholder class wrong on drop (blob: URL extension hidden in #fragment)

**Symptom:** dropping a `.blend` + its `textures/` **folder** into the editor (tweakpane-editor) showed the
diffuse but left the **normalMap/roughnessMap slots empty**, with console errors:
`THREE.WebGLState: texSubImage2D … Overload resolution failed` (GPU upload) and, in the material panel,
`putImageData … parameter 1 is not of type 'ImageData'` (preview). The maps *resolved* (1024²) but were broken.

**Root cause:** `resolveExternalTexture` picked the placeholder class (EXR/HDR → `DataTexture`, else `Texture`)
by testing the **resolved url**: `/\.(exr|hdr|rgbe)$/i.test(url.split(/[?#]/)[0])`. A dropped/registered file
(`AssetImporter.importFiles` → `registerFile`) resolves to a **blob: URL with the real path in the
`#fragment`** — `blob:…uuid#/dir/x.exr`. Splitting on `#` leaves `blob:…uuid` (no extension) → EXR got a plain
`Texture` placeholder. `importExternalTexture`'s `req.texture.copy(imported)` then copied half-float data onto a
non-data texture: WebGL can't `texSubImage2D` a `Uint16Array` as a regular texture (broken render), and
`textureToCanvas` sees `isDataTexture===false` → feeds raw `{data}` to `putImageData` (blank slot). Over HTTP the
url ends in `.exr`, so it never reproduced there.

**Fix:** detect from the **Blender path** (always carries the true extension), not the resolved url:
`/\.(exr|hdr|rgbe)$/i.test(path.split(/[?#]/)[0])`. Verified by reproducing the folder-drop through the real
`importFiles`→`loadImported` path: EXR maps now load as `DataTexture` (isData=true), upload cleanly, preview
generates, and render matches the HTTP path.

**Follow-up (deferred):** the copy-onto-placeholder design is fragile — it requires guessing the imported
texture's class up front. A robust version would hand `importExternalTexture` the material+property and
**reassign** the actual imported texture (applying colorSpace + the flipY row-flip) instead of copying onto a
pre-typed placeholder. Larger change; the extension fix is correct and sufficient for now.

## Fixed (2026-06-11) — EXR/HDR data-map flipY mismatch

1. **Constant `Alpha < 1` under `blend_method == SOLID` is forced transparent.** Blender's Eevee "Opaque"
   (SOLID) ignores the alpha value, so such a material should render opaque; we currently make it
   transparent. **Why deferred:** the naive fix (skip alpha when SOLID) would *regress* Blender **4.2+**
   files, where `blend_method` is deprecated and always SOLID while the alpha is genuinely real. Correctly
   distinguishing the two eras needs the file's Blender version (header) to gate on. Low prevalence (2
   synthetic test prims in the fixture set). Fix together with version-aware alpha handling.

2. **Packed textures bypass threepipe's asset pipeline.** `packedTexture` decodes embedded images directly
   via `Blob`/`URL`/`<img>`, not through the `LoadingManager`/`TextureLoader2` the external path uses — so
   no URL/cache dedup, and (critically) no `source._sourceImgBuffer`/`userData.mimeType`, which
   `GLTFWriter2`'s fast path needs for deterministic GLB re-export. **Why deferred:** routing packed images
   through `TextureLoader2` means threading the `LoadingManager` (or a decode hook) into `material.ts` via
   `ctx` — a real refactor. Pairs with #3 below.

3. **Packed textures are not awaited.** External textures are collected in `pending` and awaited before the
   scene returns; packed textures are fire-and-forget (`<img>.onload → needsUpdate`). So an immediate
   screenshot/export after `viewer.load` can capture packed-textured materials untextured (first-frame
   flash). **Why deferred:** needs the same `ctx` decode/await hook as #2 — do them together.

4. **Per-run grouping → many draw calls.** `mergeGroupRun` only coalesces *adjacent* same-slot faces, so
   meshes with interleaved material slots get one group per run (measured: buildify ~1118 groups, splash
   381) → that many draw calls/mesh. **Why deferred:** correctness is unaffected; this is a perf
   optimisation. Fix = counting-sort triangles by slot before writing the index buffer → ≤`totcol` groups.
   Already tracked in `blend-importer-multi-material.md` ("Remaining (optional perf)").

5. **Triangulation + group loop duplicated across the 3 geometry builders.** The fan-triangulate +
   `mergeGroupRun` + `addGroup` body is inlined in `createBufferGeometryFromAttributes`,
   `createBufferGeometry`, and `createBufferGeometryOld`. `mergeGroupRun`/`GroupRun` are shared, but the
   per-face loop is not. **Why deferred:** unifying the three format-specific builders into one
   `triangulate(faceVertCounts, emitTriangle, perFaceSlot)` routine is an architectural change to the
   geometry layer — worth doing, but as a focused refactor, not bundled with bug fixes.

6. **`imageMime` magic-byte table is a 3rd copy** (vs `TextureLoader2.rasterMimeByExt` and `AssetManager`),
   and only covers png/jpeg/bmp/webp — a packed AVIF/TIFF/GIF is silently dropped though threepipe supports
   it. **Why deferred:** low prevalence (embedded AVIF/TIFF in `.blend` is rare); the right fix is a shared
   mime helper, tied to the #2 pipeline routing (which would remove this sniffer entirely).

7. **N-gon (≥5-vertex faces) under-triangulation in `createBufferGeometryOld`** (pre-existing, in a function
   the diff touched). The legacy strip loop (`indexi += 2`) emits only `floor((len-1)/2)` triangles, so a
   pentagon yields 2 triangles instead of 3 — a hole. **Why deferred:** pre-existing and legacy-`mpoly`
   only; changing the working quad/tri triangulation is risky and unrelated to this work. Port the proper
   fan (k = 1..len-2) like the indexed paths when revisiting the legacy builder.

## Also noted (limitations, not regressions)

- **Object-linked materials (matbits).** Materials linked to the *object* (not mesh data) via `matbits`
  are not read — linked-duplicate objects (Alt+D) sharing mesh data show the data-level materials. The
  parser fix recovers data-linked slots (the common case, and the invisible-face fix); object-linked slots
  fall back to a default material. Wire `object.mat` + `object.matbits` per slot if instanced/linked-dup
  fidelity is needed.
- **Distinct alpha image (not the base image)** still assigned as `alphaMap` (green channel) — correct only
  for greyscale masks. Rare; the common same-image cutout case is fixed (see CHANGELOG).

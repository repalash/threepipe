# Sample asset catalog scripts

They fill threepipe cloud's asset catalog (`threepipe_assets` and `threepipe_asset_links` in `services/cloud/teenybase.ts`).
How the catalog is queried and used: [Sample Asset Catalog](https://threepipe.org/guide/asset-catalog.html)
(`website/guide/asset-catalog.md`). This file is for adding assets. Each script's header lists its options.

## Sources (`npm run assets:catalog -- --set <set>`)

| Set | What | Files |
|---|---|---|
| `khronos` | [glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) (licences from its REUSE.toml) | copied |
| `gltf-research-scenes` | [glTF research scenes](https://github.com/ErfanMo77/gltf-research-scenes) | copied |
| `bucket` | the models already in the samples bucket (`demos`, `minimal`, `tests`) | linked where they are |
| `poly-haven` | models picked from Poly Haven, packed to one GLB with WebP textures | copied |
| `lists` | hand-picked files of any format, from `lists/*.json` (the 3D Viewer's samples: `lists/viewer-samples.json`) | copied, or zipped |
| `poly-haven-hdris`, `poly-haven-materials` | every HDRI and material of Poly Haven | linked |
| `ambientcg-hdris`, `ambientcg-materials` | every HDRI and material of ambientCG | linked |

- **glTF** is read here with gltf-transform: counts, cameras, clips, and a row with a thumbnail for each embedded texture.
- **Any other format** is copied as it is. The render page counts what it loads: triangles, points, meshes, materials,
  textures and clips. A 3D tileset gets no counts, because what it loads depends on the view.
- **Zips:** a file is zipped (`<file name>.zip`) when the zip is at most 75% of its size, or when it saves requests
  (a model with its textures). threepipe loads the zip and opens the file in it. These are never zipped:
  - containers and compressed formats: 3mf, usdz, drc, ktx2, zip;
  - 3D tiles, because the renderer fetches each tile.
- **HDRIs and materials** are linked to the source's files:
  - `url` is the default file: a 2k HDR (or 2K zip) for an HDRI; a 1k Poly Haven glTF or a 1K-JPG ambientCG zip for a
    material.
  - Every other resolution and format is in `metadata.files`.
  - `load_as` gives the extension to load with: `phmatgltf` for a Poly Haven material, `acgzip` for an ambientCG zip
    (`PolyhavenMaterialLoadPlugin` and `AmbientCGLoadPlugin` of `@threepipe/plugins-extra-importers`).
  - ambientCG's own download link redirects without a CORS header, so the file URL it redirects to is stored instead.
- **Licences:** each source's own. A list entry gives its licence as an SPDX id, or `null` with a `license_note` when it
  isn't known. A row with no licence shows up in the build's summary.

### A list entry

```json
{"set": "threejs", "label": "Stormtrooper", "url": "https://…/stormtrooper.dae", "files": ["Stormtrooper_D.jpg"],
 "license": "CC-BY-4.0", "authors": ["StrykerDoesAnimation"], "source_url": "https://sketchfab.com/strykerdoesgames"}
```

- **Required:** `set`, `label`, and where the file is. That's `url`, or `zip` plus `entry` for a file inside the
  source's zip, or `encode: "draco"` to make a Draco file from the STL at `url`.
- **Optional:**
  - `name`, when two files would get the same one;
  - `files`, the files next to it;
  - `crawl: "tileset"`, to fetch every tile of a 3D tileset;
  - `links`, `changes`, `tags`.
- The list's `tag` goes on every row.

## Steps

1. **Build:** `npm run assets:catalog -- --set <set> --out <out> [--src <cache>] [--only Name] [--limit N]`. This writes
   `<out>/catalog.json`, the files to host in `<out>/samples/` and the source screenshots in `<out>/p/samples/`.
   Nothing is uploaded.
2. **Render the previews on a GPU** (a Mac; see `render-catalog.mjs`'s header for the options): run the dev server and
   `npm run assets:render -- --out <out> --page <dev server> [--models <URL of out>] --video-sizes 512,1024 --hevc-host local`.
   - **Models:** stills at 512 and 1024; turntables on `#000000` (`video-<size>-dark.mp4`), on `#ffffff` (`-light`),
     and with alpha (WebM, and HEVC `.mov` on a Mac).
   - **HDRIs:** chrome and matte balls in front of the HDRI. It is their background, so there is one video per size.
   - **Materials:** a sphere under the studio HDRI.
   - A finished render writes `.rendered` in its folder, with the counts for formats read on the page. A rerun skips
     what is done (`--force` redoes it), and a rebuilt `catalog.json` gets the URLs and counts back from the folders.
3. **Look at the results** before anything goes to the samples bucket. Files there can't be overwritten.
4. **Upload:**
   - `npm run cloud:upload -- <out>/samples samples/`: models. This is write-once and needs the maintainer's OK.
   - `npm run cloud:upload -- <out>/p/samples p/samples/`: previews and screenshots. These can be redone.
5. **Write the rows:** `npm run assets:insert -- --out <out> --token-file <.prod.vars> --apply`. Without `--apply` it
   is a dry run. It checks the JSON columns, and that every file is in `<out>`. With `--remote`, it checks each URL on
   the CDN instead, for a catalog whose previews were rendered and uploaded on another machine.
6. **Old previews:** after a new render is uploaded and the rows are written, delete the files that no row uses with
   `DELETE /api/v1/uploads/<path>` and the cloud key. They then answer 410.

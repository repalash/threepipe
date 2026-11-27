---
prev:
    text: 'Loading Files'
    link: './loading-files'

next:
    text: 'Materials Guide'
    link: './materials'
---

# Sample Asset Catalog

threepipe cloud keeps a public catalog of sample assets: models from the
[Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets), the
[glTF research scenes](https://github.com/ErfanMo77/gltf-research-scenes), [Poly Haven](https://polyhaven.com) and threepipe's own
demos, and the textures inside them. Each one comes with a rendered thumbnail and turntable videos, its licence and
credit, and counts to filter on (size, triangles). HDRIs and materials from Poly Haven and ambientCG are next.

The catalog is two database tables you can query from any app, script or agent, with no key. They hold no files,
only URLs: you find assets with a query, then load each file from its URL.

As of November 2026 it holds 1,133 assets: 199 models and 934 textures embedded in them.

## Finding assets

Query the table `threepipe_assets` at `https://cloud.threepipe.org/api/v1/table/threepipe_assets`:

| Endpoint | Returns |
|---|---|
| `GET …/select?where=…&select=…&order=…&limit=…&offset=…` | an array of rows |
| `GET …/list?…` (the same parameters) | `{items, total}`: a page of rows and the number of rows that match |
| `GET …/view/<id>` | one row |

```ts
const API = 'https://cloud.threepipe.org/api/v1/table/threepipe_assets'
const query = new URLSearchParams({
    where: "kind == 'model' & license == 'CC0-1.0' & json_contains(tags, 'animated')",
    select: 'set_name,name,label,url,thumb_url,video_url,license,authors',
    order: 'size', // smallest first; '-size' for largest first
    limit: '20',
})
const rows = await fetch(`${API}/select?${query}`).then(r => r.json())

const model = await viewer.load(rows[0].url) // a model: load it like any other file
```

From a shell, let curl encode the parameters (`where` has spaces, quotes and `&`):

```bash
curl -sG https://cloud.threepipe.org/api/v1/table/threepipe_assets/select \
  --data-urlencode "where=kind == 'model' & triangles < 100000 & !json_contains(tags, 'broken')" \
  --data-urlencode "select=set_name,name,triangles,url" --data-urlencode "order=-triangles" --data-urlencode "limit=10"
```

### `where`

Columns compare with `==`, `!=`, `<`, `<=`, `>`, `>=`; combine with `&` (and), `|` (or), `!` (not) and parentheses.
Strings go in single quotes, and `null` is an empty value. `~` is SQL `LIKE` (`%` matches anything):

| Find | `where` |
|---|---|
| Models | `kind == 'model'` |
| Under 100k triangles | `kind == 'model' & triangles < 100000` |
| Low poly (under 50k triangles) | `poly == 'low'` (`mid`: under 500k, `high`: more) |
| By tag | `json_contains(tags, 'transmission')` |
| Leave out models that don't load right | `!json_contains(tags, 'broken')` |
| Free to use without credit | `license == 'CC0-1.0'` |
| CC0 or CC BY | `(license == 'CC0-1.0' \| license == 'CC-BY-4.0')` |
| By name | `name ~ 'Damaged%'`, or `label ~ '%helmet%'` (the label is the source's own name) |
| One set | `set_name == 'poly-haven'` |
| By author | `json_contains(authors, 'Rico Cilliers (All)')` |

`select` lists the columns to return (all of them without it), `order` sorts by one or more columns
(`order=set_name,name`; a `-` sorts that column largest first), `limit` and `offset` page through.

## A row

| Column | |
|---|---|
| `kind` | `model` or `texture` now; `hdri`, `material` and `scene` later |
| `set_name`, `name` | where it comes from (`khronos`, `gltf-research-scenes`, `poly-haven`, `demos`, `minimal`, `tests`) and its name there. Together they name the asset: `khronos/DamagedHelmet` |
| `label` | the name to show |
| `url` | the file to load |
| `thumb_url` | a square still, 512 px (models) |
| `video_url` | a 512 px turntable video on black (models) |
| `size` | bytes of the file to load (all its files, for a glTF with separate files) |
| `triangles`, `poly` | triangle count, and `low` / `mid` / `high` |
| `tags` | JSON array: what's in it and what it needs (below) |
| `license` | an [SPDX](https://spdx.org/licenses/) expression like `CC-BY-4.0`, or `CC-BY-4.0 AND CC0-1.0` for an asset whose parts have different licences. Empty when not known |
| `authors` | JSON array of the credits, as the source gives them |
| `source_url` | where it comes from |
| `metadata` | JSON object with the rest (below) |

`tags`, `authors` and `metadata` come back as JSON **text**: parse them (`JSON.parse(row.tags)`).

### Tags

- **What the model uses:** `textured`, `animated`, `skinned`, `morph`, `camera` (it has its own cameras), `lights`,
  `unlit`, `variants` (glTF material variants), and the glTF material extensions by name: `transmission`, `volume`,
  `ior`, `specular`, `clearcoat`, `sheen`, `iridescence`, `anisotropy`, `dispersion`, `emissive_strength`,
  `diffuse_transmission`, `pbrSpecularGlossiness`.
- **How the file is compressed:** `draco`, `meshopt`, `quantized`, `ktx2`; `lods` when `metadata.files` has levels
  of detail.
- **From the source:** Khronos's own tags (`core`, `showcase`, `testing`, `pbrtest`, `video`, `written`, `issues`,
  `extension`), `research` for the research scenes, Poly Haven's categories.
- **Status:** `broken` (it doesn't load or render right; why in `metadata.broken`) and `wip` (not final).
- **Textures:** `embedded`, and what the texture is used for: `baseColor`, `normal`, `metallicRoughness`,
  `occlusion`, `emissive`.

### `metadata`

| Key | |
|---|---|
| `files` | every file of the asset, the default (`url`) first: `[{default, format, url, size, triangles, resolution, lod, version, label}]`. Other formats, resolutions and levels of detail, ours or the source's |
| `thumbnails` | `[{url, width, height, size}]`: the stills at 512 and 1024 px |
| `videos` | `[{url, size, background, color, …}]`: the turntables (below) |
| `screenshots` | `[{label, url}]`: images that came with the source |
| `views` | the model's own cameras `[{name, position, target, yfov, …}]`; the first one is the view of the thumbnail |
| `animations`, `play` | the clips and their lengths, and the ones the video plays |
| `vertices`, `meshes`, `materials`, `textures`, `extensions` | more counts, and the glTF extensions used |
| `changes` | what we changed from the source (for example compressed to fit the upload limit) |
| `broken` | why it is tagged `broken` |
| `version`, `versions` | for assets we author: the version of `url`, and `[{version, url, date}]` for the others |

A `where` can read inside `metadata` with `->`, compared with JSON text: `metadata -> '$.version' == '"2"'`. `->>`
matches nothing (a teenybase bug), and neither uses an index, so it reads every row.

### Previews

A model's previews are in one folder, `https://files.threepipe.org/p/samples/<set>/<model>/`:

| File | |
|---|---|
| `thumb-512.webp`, `thumb-1024.webp` | the still, on a transparent background |
| `video-512-dark.mp4`, `video-512-light.mp4` | the turntable on `#000000` and `#ffffff` (also at 1024) |
| `video-512-alpha.webm` | with transparency (VP9; Chrome, Firefox) |
| `video-512-alpha.mov` | with transparency for Safari (HEVC) |
| `video-512.mp4` | only this, for a model that has its own background |

The background of the solid videos is added after rendering, so nothing in the model reflects it. Previews may be
rendered again (a new threepipe, a better camera), so link to the row rather than to a preview file.

### Textures

A texture row is a texture found inside a model, so its `url` is the model's file: the image is inside it. It has a
256 px `thumb_url`, its size in pixels in `metadata.width` and `metadata.height`, and a link to the models that use it
(below). One texture used by several models of a set is one row.

## Links between assets

`threepipe_asset_links` (the same API, `…/table/threepipe_asset_links/select`) has one row per link: `from_asset`,
`relation`, `to_asset`, each asset named `<set_name>/<name>`. Read it from either side:

```bash
# what khronos/Fox uses
curl -sG https://cloud.threepipe.org/api/v1/table/threepipe_asset_links/select --data-urlencode "where=from_asset == 'khronos/Fox'"
# the models that use a texture
… --data-urlencode "where=to_asset == 'khronos/texture-61c8b109ee7f' & relation == 'uses'"
```

Today every link is a model that `uses` a texture. Later: a material `part_of`, an optimized file `optimized_from`
its original, a scene that `uses` its parts and is `generated_by` its generator, a variant `derived_from` its origin.

## Licences and credit

Check `license` before you use an asset in something public:

- `CC0-1.0`: no conditions.
- `CC-BY-*`: give visible credit, from `authors` and `source_url`.
- Some are non-commercial (`*-NC-*`) or limited to testing (`LicenseRef-…`, like the CRYENGINE and 3DRT models).
- An expression with `AND` has parts under each licence; all of them apply.
- An empty `license` is not known yet: don't use those in public work.

## Where the files are

- Models we host are on `https://samples.threepipe.org/<set>/<file name of the source>`: a GLB directly, a glTF of
  several files in a folder with the source's own layout. Files there never change; a new version gets a new path.
- Previews are on `https://files.threepipe.org/p/samples/…`, and can be rendered again.
- Some files are linked from their source instead (the larger versions of Poly Haven's models, in `metadata.files`).
- All of them answer with CORS, so a page on any site can load them.

## Adding assets

Assets are added by the threepipe maintainers with the scripts in
[`scripts/sample-assets`](https://github.com/repalash/threepipe/tree/master/scripts/sample-assets): they read the
sources, render the previews with threepipe on a GPU, upload them, and write the rows with the cloud's admin token.
The steps are in its README. Only the admin token can write the tables; anyone can read them.

The tables are defined in
[`services/cloud/teenybase.ts`](https://github.com/repalash/threepipe/blob/master/services/cloud/teenybase.ts)
(`threepipe_assets`, `threepipe_asset_links`).

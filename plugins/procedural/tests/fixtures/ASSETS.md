# Third-party Blender assets used by the procedural tests

The asset parity tests (`tests/parity/assets.test.ts`, `reactivity.test.ts`) and the browser examples run on six
geometry-nodes `.blend` files made by other people. The maintainer has confirmed they may be used, commercially
and non-commercially (2026-10-18).

What is in git and what is not:
- **Not in git:** the `.blend` files (about 60 MB) and the evaluated Blender dumps or bundles (`tmp/gt-5.2.2/<name>/`,
  `tmp/bundles/<name>/`). Tests that need them skip.
- **In git, when small and gzipped:** dumps and ground truth derived from them. Today that is only
  `dumps-v1/flower_scattering.json.gz` (the v1 importer test). The derived files carry the source's licence.

To run the asset tests locally:
1. Put each file at `<repo>/tmp/<file name>`.
2. Dump it with Blender 5.2.2:
   `blender --background --factory-startup tmp/<file>.blend --python plugins/procedural/porting/blender/dump_blend.py -- --out tmp/gt-5.2.2/<name>`
3. For the examples, bundle the dump: `python3 -I plugins/procedural/porting/blender/bundle_dump.py tmp/gt-5.2.2/<name> tmp/bundles/<name>`.

Each table below gives the licence as the source states it. "Embedded" is the credit text stored inside the `.blend`
itself. Sizes and SHA-256 prefixes are those of the files the dumps were made from. They are given so a new download can
be checked against them.

## flower_scattering.blend

| | |
|---|---|
| Title | Flower Scattering (Blender demo files, Geometry Nodes / Fields) |
| Author | Blender Studio: "File by Simon Thommes", "Grass and Flower Assets by Andy Goralczyk" |
| Licence | CC0 (demo-files page: "6MB — CC0"). Embedded: "CC-BY-0" |
| Download | https://www.blender.org/download/demo/geometry-nodes/fields/flower_scattering.blend (listed on https://www.blender.org/download/demo-files/) |
| File | 6 251 483 bytes, sha256 `a22fc66c7bcaad45…` |

## pebble_scattering.blend

| | |
|---|---|
| Title | Scattering Pebbles (Blender demo files, Geometry Nodes / Fields) |
| Author | Blender Studio: "File by Simon Thommes" |
| Licence | CC0 (demo-files page: "400KB — CC0"). Embedded: "CC-BY-0" |
| Download | https://www.blender.org/download/demo/geometry-nodes/fields/pebble_scattering.blend |
| File | 474 460 bytes, sha256 `94570a5ede2b4a74…` |

## candy_bounce.blend

| | |
|---|---|
| Title | Candy Bounce (Blender demo files, Geometry Nodes / Fields) |
| Author | James Redmond (twitter.com/redjam_9) |
| Licence | CC-BY. The demo-files page says "800KB — CC-BY" and names no version. Embedded: "CC-BY \| Creator: James Redmond". Its HDRI is from HDRI Haven, CC0. Attribution is required. |
| Download | https://www.blender.org/download/demo/geometry-nodes/fields/candy_bounce.blend |
| File | 857 495 bytes, sha256 `7d0df4ba1bb1bf00…` |

## repeat_zone_flower_by_MiRA.blend

| | |
|---|---|
| Title | Repeat Zone – Flower (Blender demo files, Geometry Nodes, requires Blender 4.0) |
| Author | MiRA |
| Licence | CC-BY-SA. The demo-files page says "220KB – CC-BY-SA" and names no version. No credit text is embedded. Attribution and share-alike apply to derivatives. |
| Download | https://www.blender.org/download/demo/geometry-nodes/repeat_zone_flower_by_MiRA.blend |
| File | 219 458 bytes, sha256 `3e69ae3f0001fc87…` |

## buildify_1.0.blend

| | |
|---|---|
| Title | Buildify 1.0 (geometry-nodes building generator, July 2022) |
| Author | Pavel Oliva |
| Licence | Gumroad listing, verbatim: "Buildify is completely free to be used even in commercial projects (you are not allowed to sell the graph itself or it's derivatives!)." Pay what you want ($0+). |
| Download | https://paveloliva.gumroad.com/l/buildify |
| File | 5 290 579 bytes, sha256 `ee1f40b004d6f271…` |

The file also contains kit models from BlenderKit by other authors; the embedded credits include "Sheyanov Matwey" and
"The Doctor". Their terms are BlenderKit's.

Note for the maintainer: the listing forbids selling the graph or its derivatives. The ported graph dumps are
derivatives, so they must not be sold or bundled into a paid product.

## blender-procedural-buildings.blend

| | |
|---|---|
| Title | Procedural buildings ("Building 1", "Building 2", ...; saved by Blender 4.0.0) |
| Author | Felipe Del Rio. Embedded: "Artwork by Felipe Del Rio - License CC-BY-SA", instagram.com/delriofe, twitter.com/delriofe |
| Licence | Embedded: CC-BY-SA (no version). No public download page was found to confirm it. Per maintainer: OK for commercial use. Attribution and share-alike apply to derivatives. |
| Download | Not found online (searched 2026-10-18). Ask the maintainer for the file. |
| File | 5 318 710 bytes, sha256 `2260f179b76a62e5…` |

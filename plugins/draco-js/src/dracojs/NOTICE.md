# Vendored decoder: mrdoob/draco.js — attribution

`DRACOLoader.js` is a copy of the build output (`build/DRACOLoader.js`, the readable build) of
[mrdoob/draco.js](https://github.com/mrdoob/draco.js) (commit `700d1fb`, 2026-09-25), vendored here
so its `import … from 'three'` binds to threepipe's single three instance at build time. Upstream has
no tags, releases or npm package, so it is pinned by commit.

This software includes third-party code under the following licenses:

- **mrdoob/draco.js** — MIT, © Mr.doob (Ricardo Cabello). See [`LICENSE`](./LICENSE).
- **Google Draco** — Apache License 2.0, © The Draco Authors. See
  [`LICENSE-Apache-2.0`](./LICENSE-Apache-2.0). draco.js's decoder (`src/` of the upstream repo) is a
  port of Google Draco (https://github.com/google/draco) from C++ to JavaScript by Mr.doob; this
  file is the bundled output of that port.

**Modifications** (per Apache-2.0 §4(b)): `DRACOLoader.js` is the verbatim upstream build except for
its top `import … from 'three'` line — the two constants `SRGBColorSpace` / `LinearSRGBColorSpace`,
which threepipe does not re-export, are defined locally (as their stable values `'srgb'` /
`'srgb-linear'`) instead of imported, so the package stays self-contained. No decoder logic is changed.

The enclosing package `@threepipe/plugin-draco-js` is licensed Apache-2.0, compatible with both of
the above. No NOTICE file is published by upstream Google Draco; this file provides the required
attribution for the Apache-2.0 portion.

## Scope / limits

draco.js is **decode-only** and decodes **triangle meshes in Draco bitstream version 2.2** (what
current Draco encoders and glTF exporters write), with EdgeBreaker or sequential connectivity.
Geometry metadata is parsed and discarded. Point clouds (sequential and KD-tree) and bitstreams older
than 2.2 are not implemented and are rejected with an error; `DRACOLoader2Pure` falls back to the WASM
decoder for those. Pinned to upstream commit `700d1fb`.

draco.js is written against a newer three.js than threepipe uses: its sRGB vertex color conversion
(standalone `.drc` files) calls `ColorManagement.colorSpaceToWorking`. `DRACOLoader2Pure` replaces
that one method on the decoder instance with the conversion of the three.js `DRACOLoader` it extends,
the vendored file itself is not changed for this.

## Updating

Build upstream at the new commit (`npm install && npm run build`), copy `build/DRACOLoader.js` here,
re-apply the import modification above, update the commit and date in this file, and re-check
`DRACOLoader2Pure.isJsDecodable` and `DRACOLoader.d.ts` against what the new build decodes and exports.

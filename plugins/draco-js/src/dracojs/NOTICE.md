# Vendored decoder: mrdoob/draco.js — attribution

`DRACOLoader.js` is a verbatim copy of the build output of
[mrdoob/draco.js](https://github.com/mrdoob/draco.js) (commit `bcbbcf3`, 2026-06-03), vendored here
so its `import … from 'three'` binds to threepipe's single three instance at build time.

This software includes third-party code under the following licenses:

- **mrdoob/draco.js** — MIT, © Mr.doob (Ricardo Cabello). See [`LICENSE`](./LICENSE).
- **Google Draco** — Apache License 2.0, © The Draco Authors. See
  [`LICENSE-Apache-2.0`](./LICENSE-Apache-2.0). draco.js's decoder (`src/` of the upstream repo) is a
  port of Google Draco (https://github.com/google/draco) from C++ to JavaScript by Mr.doob; this
  file is the bundled output of that port.

**Modifications** (per Apache-2.0 §4(b)): `DRACOLoader.js` is the verbatim upstream build except for
its top `import … from 'three'` line — the two unused-by-threepipe constants `SRGBColorSpace` /
`LinearSRGBColorSpace` are defined locally (as their stable values `'srgb'` / `'srgb-linear'`)
instead of imported, so the package stays self-contained. No decoder logic is changed.

The enclosing package `@threepipe/plugin-draco-js` is licensed Apache-2.0, compatible with both of
the above. No NOTICE file is published by upstream Google Draco; this file provides the required
attribution for the Apache-2.0 portion.

## Scope / limits

draco.js is **decode-only** and implements **only the EdgeBreaker triangle-mesh path** — exactly the
subset glTF `KHR_draco_mesh_compression` uses. Sequential connectivity, point-cloud, KD-tree, and
metadata are non-functional; `DRACOLoader2Pure` falls back to the WASM decoder for those. Pinned to
upstream commit `bcbbcf3`.

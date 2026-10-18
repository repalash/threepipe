# @threepipe/plugin-procedural

Blender geometry nodes for [threepipe](https://threepipe.org/), ported from the Blender **5.2 LTS** source
(tag `v5.2.2`), evaluated live in Node and in the browser on `@threepipe/mesh-kernel`'s `MeshData` - the
same mesh the modelling tools edit.

```bash
npm i @threepipe/plugin-procedural
```

- **Data model**: `GeometrySet` with mesh, point cloud, curves and instances components; attributes on
  the point / edge / face / corner / curve / instance domains with Blender's implicit interpolation;
  fields evaluated lazily on a domain.
- **Runtime**: Blender-shaped node trees, evaluated lazily (only what an output needs) and reactively
  (changing an input re-runs only what depends on it).
- **Graph as code**: a typed TypeScript DSL (`geometryNodes(name, g => ...)`, `n.*`), printed back with `toCode`;
  imports node-tree dumps from Blender (`porting/blender/dump_blend.py`, `importBlenderDump`).
- **Viewer side** (`@threepipe/plugin-procedural/plugin`): `ProceduralPlugin` registers a `geometryNodes`
  modifier type in `@threepipe/plugin-modelling`'s stack and adds the `nodeGroup` and `blendAsset` commands.
- **Extension nodes**: `ThreepipeErosion` (hydraulic and thermal erosion of a grid), not a Blender node.

Subdivision is not in this package: the Subdivide Mesh and Subdivision Surface nodes call the kernel's port of
OpenSubdiv and `bke::subdiv` (`mesh-kernel/src/subdiv/`). The Blender support code they share (`f32`, `libm`,
`blenderSystem`, most of the math) moved to the kernel too; the files for it in `src/blender/` re-export it from there.

Documentation: [threepipe.org/package/plugin-procedural](https://threepipe.org/package/plugin-procedural.html).
Status and plan: `issues/open/modelling-tools/15-procedural-on-kernel.md`. Every port cites the Blender
file and line it follows; parity is checked against output exported from Blender 5.2.2
(`porting/blender/`). How to port a node: `porting/CONVENTIONS.md`.

Blender evaluates in single precision and is built with `-ffp-contract=off`; this package rounds to
float32 per operation where Blender does, so results match bit for bit except where a libm function
(`sin`, `atan2`, ...) differs in the last place.

## Licence notes

Reference cases in `tests/parity/geonodes-kit/` are Blender 5.2.2 output collected by
[geonodes-kit](https://github.com/vibegameengine/geonodes-kit) (MIT); see `NOTICE` there.

The asset tests and the bundle examples use six third-party `.blend` files that are not in git. Their sources,
authors and licences, and how to make the dumps locally, are in `tests/fixtures/ASSETS.md`.

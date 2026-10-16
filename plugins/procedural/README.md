# @threepipe/plugin-procedural

Blender geometry nodes for [threepipe](https://threepipe.org/), ported from the Blender **5.2 LTS** source
(tag `v5.2.2`), evaluated live in Node and in the browser on `@threepipe/mesh-kernel`'s `MeshData` - the
same mesh the modelling tools edit.

- **Data model**: `GeometrySet` with mesh, point cloud, curves and instances components; attributes on
  the point / edge / face / corner / curve / instance domains with Blender's implicit interpolation;
  fields evaluated lazily on a domain.
- **Runtime**: Blender-shaped node trees, evaluated lazily (only what an output needs) and reactively
  (changing an input re-runs only what depends on it).
- **Graph as code**: a typed TypeScript DSL; imports node-tree dumps from Blender.
- **Modifier**: a `geometryNodes` modifier in `@threepipe/plugin-modelling`'s stack.

Status and plan: `issues/open/modelling-tools/15-procedural-on-kernel.md`. Every port cites the Blender
file and line it follows; parity is checked against output exported from Blender 5.2.2
(`porting/blender/`).

Blender evaluates in single precision and is built with `-ffp-contract=off`; this package rounds to
float32 per operation where Blender does, so results match bit for bit except where a libm function
(`sin`, `atan2`, ...) differs in the last place.

## Licence notes

Reference cases in `tests/parity/geonodes-kit/` are Blender 5.2.2 output collected by
[geonodes-kit](https://github.com/vibegameengine/geonodes-kit) (MIT); see `NOTICE` there.

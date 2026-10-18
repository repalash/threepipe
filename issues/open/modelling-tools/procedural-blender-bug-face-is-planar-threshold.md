# Blender 5.2.2 bug: Is Face Planar reads freed memory when Threshold is a field

Found while porting `GeometryNodeInputMeshFaceIsPlanar` to `@threepipe/plugin-procedural`
(`plugins/procedural/src/nodes/geometry/meshTopologyInputs.ts`), parity case
`tests/parity/cases/meshInputs.ts` → `input-face-is-planar-field-threshold` (marked `blenderBug`).

## What Blender does

`source/blender/nodes/geometry/nodes/node_geo_input_mesh_face_is_planar.cc`, `PlanarFieldInput::get_varray_for_context`
(:40-76):

```cpp
const bke::MeshFieldContext context{mesh, AttrDomain::Face};
fn::FieldEvaluator evaluator{context, faces.size()};        // :50, local
evaluator.add(threshold_);
evaluator.evaluate();
const VArray<float> thresholds = evaluator.get_evaluated<float>(0);   // :53
auto planar_fn = [positions, faces, corner_verts, thresholds, face_normals](const int i) -> bool {
  ...
  return max - min < thresholds[i] / 2.0f;                  // :71
};
return mesh.attributes().adapt_domain<bool>(
    VArray<bool>::from_func(faces.size(), planar_fn), AttrDomain::Face, domain);   // :74
```

For a threshold that is a field (not a single value), `get_evaluated` returns a span-backed `VArray` pointing into
the evaluator's `ResourceScope`. The lambda copies that `VArray` (a non-owning view), `VArray::from_func` makes the
result lazy, and the function returns: the evaluator and its buffer are destroyed, and every later read of
`thresholds[i]` (when the caller materialises the returned varray) reads freed memory. A single-value threshold is
stored inline in the `VArray` and works.

## Observed

`input-face-is-planar-field-threshold`: threshold = `index * 0 + 10` (10 for every face, so every face is planar).
Blender 5.2.2 (macOS arm64) returns `false` for 21 of the 23 faces of the test meshes (only the two triangles, which
return early, are `true`): the thresholds it read were 0 / garbage. The same graph with a single threshold
(`input-face-is-planar`, default 0.01 and 0.3) is bit-exact.

## In the port

The port evaluates the thresholds and keeps them for the comparison, i.e. the intended behaviour. The parity case is
marked `blenderBug`, so the suite asserts that the port still differs from Blender's output; it fails (and should be
re-examined) when a Blender version fixes this.

## Fix in Blender (for reference)

Evaluate into an owned array (`Array<float> thresholds(faces.size()); evaluator.add_with_destination(threshold_,
thresholds.as_mutable_span())`) or compute the planarity eagerly into a `VArray::from_container`.

# Track 2 — Geometry nodes on the mesh kernel (subplan)

**Status**: approved 2026-10-16; in progress (progress in §12). Parent: [13-roadmap-2026-10](./13-roadmap-2026-10.md)
§1.2, §3 "Track 2", §5 "Launch". Branch `track2-procedural` (worktree `.repos/threepipe-track2-procedural`,
off `modelling-editor` `d7a15f4`). Comm: `.repos/threepipe-editor/tmp/agent-comm/track2-procedural/`.

Goal, unchanged from the roadmap: Blender geometry nodes, ported from **Blender 5.2.2 LTS** source, evaluated
live in the browser and in Node on the same `MeshData` the modelling tools edit, exposed as a modifier in
`plugin-modelling`'s stack and as a typed TS graph API that agents write as code.

Decisions needed from the parent are marked **[A1]…[A7]** and collected in §11. Requests to the maintainer's
Blender are **[B1]…[B3]** in §7.4, with the scripts already in `plugins/procedural/porting/blender/`.

---

## 0. What I found before planning (facts that change the roadmap's assumptions)

1. **The Blender source we had is not 5.2 LTS.** `.repos/blender-gn-source` is `main` at 2026-03-22,
   `BLENDER_VERSION 502`, `CYCLE alpha`. I fetched tag `v5.2.2` (`d13f752e3b9c`, "Release: Bump to 5.2.2
   release", the same build geonodes-kit pins) into a sparse worktree **`.repos/blender-5.2.2`** (blenkernel,
   blenlib, functions, geometry, nodes, bmesh, makesdna, makesrna, python, blenloader, cycles svm). All
   citations below are to that tree; every port cites `file:line` there.
2. **GN nodes do not run on BMesh.** Blender's geometry nodes operate on `Mesh` arrays through
   `source/blender/geometry/intern/*.cc` and the node files themselves, never through `bmesh/operators`.
   Element order differs between the two paths (e.g. `mesh_primitive_grid.cc` vs `bmo_create_grid_exec`,
   `node_geo_extrude_mesh.cc` vs `bmo_extrude_face_region`, `mesh_merge_verts.cc`/`point_merge.cc` vs
   `bmo_remove_doubles`). Parity is checked on element order, so **the roadmap's "reuse the kernel
   generators / extrude / mergeByDistance for the mesh nodes" does not hold**: the kernel's
   `generate/primitives.ts` is a port of `bmo_primitive.cc`. What we reuse from the kernel is `MeshData`,
   `AttributeStorage`, the math, the normals already ported in `bake.ts` (`mesh_normals.cc`), and BMesh only
   where Blender's GN node itself goes through BMesh (Ico Sphere, `node_geo_mesh_primitive_ico_sphere.cc:79`;
   Mesh Boolean's Float solver, `geometry/intern/mesh_boolean.cc:984`).
3. **Ground truth on disk** (all exported with Blender 5.0.1 or older; none with 5.2):
   - node-tree dumps (`extract_geo_nodes.py` format) only for `tmp/flower_scattering_node_graph.json`,
     `tmp/candy_bounce_node_graph.json`, `tmp/raycast_node_graph.json`. **No dump exists for Buildify,
     pebble, the rose or the grid buildings**; the `proc` examples hard-coded what the dump would have said
     (`buildify-demo-4/graph.ts` hard-codes the footprint, the curve traversal order `SEG_ORDER` and 21 roof
     placements `ROOF_SCATTER` — pre-baked outputs, which the new runtime must compute).
   - evaluated outputs: `buildify-demo-4/ground_truth.json` (238 instance matrices + names),
     `flower-demo/ground_truth.json` (7392 world vertices), `pebble-scatter/ground_truth.json` (14.4 MB),
     `tmp/flower_scattering_ground_truth.json` (117 343 instances, **truncated to 500**),
     `tmp/candy_bounce_gt`, `tmp/raycast_ground_truth`.
   - the `.blend` sources: `tmp/buildify_1.0.blend` (saved by 4.0.3), `flower_scattering.blend`,
     `pebble_scattering.blend`, `candy_bounce.blend`, `repeat_zone_flower_by_MiRA.blend` (zstd, 3.x/4.0),
     `blender-procedural-buildings.blend` (4.0.0).
   - The old exporter could not name instances created inside node groups (`porting/references/
     learnings.md`, "Nested geometry node instances lose source identity"). Blender 5.2 has
     `Object.evaluated_geometry()` → `GeometrySet.instances_pointcloud()` + `instance_references()`
     (`source/blender/python/intern/bpy_geometry_set.cc:178-245`), which exposes the exact per-instance
     transform and reference. The new exporter uses it, so names are exact.
   - Scatter GT never matched point-for-point because the scatter source came from glTF, whose triangle
     order is not Blender's (`learnings.md`, "GLB triangle ordering"). The new pipeline dumps the modifier's
     **input mesh in Blender order** from Blender itself, so distribution can match exactly.
4. **Prior art read** (cloned read-only: `.repos/geonodes-kit`, `.repos/ProceduralBuildingsThreeJS`):
   - geonodes-kit pins the same build (5.2.2 `d13f752e3b9c`), has a 360-node inventory
     (`coverage/nodes-5.2.2.json`: sockets, defaults, enum items per node) and **340 reference cases
     evaluated by Blender 5.2.2** (`reference/cases/*.json`, 2.6 MB, MIT): small trees covering 50 node
     types (Math 66 cases, Boolean Math 36, Compare 32, Separate 17, Random Value 17, Extrude 15, Grid 12,
     Switch 11, Object/Collection Info 18, Join 11, Instance on Points 9, Realize 8, fields 9 …), with full
     mesh topology and every attribute on every domain. Its own code is 2 nodes in. Its case format
     (`{nodes:[{name,type,properties,inputs}], links:[{from:[n,s],to:[n,s]}], output}`) is the simplest
     useful fixture format; I use the same shape for our own cases.
   - ProceduralBuildingsThreeJS: per-asset hand ports plus a generic evaluator for the NYC building, verified
     to the float32 bit for instance positions. Three more real-world `.blend` files there (French, NYC,
     Chinese buildings) are stretch acceptance targets after Buildify.
5. **Blender evaluates in float32.** Hash-based nodes read float bits (`noise::hash_float` reinterprets the
   float, `blenlib/intern/noise.cc`), so a double-precision port drifts at every `floor`/`int()`/hash.
   Policy in §2.6.
6. **Container**: aarch64 Linux, no Blender (no official Linux arm64 build; Debian's is 3.4). All Blender
   evaluation goes through the maintainer (§7.4). Host disk is 98 % full (28 GB free) — large GT stays out
   of git and out of tmp sprawl.

---

## 1. Data model

Mirrors `blenkernel/BKE_geometry_set.hh:151` (`GeometrySet`) and its components; one attribute vocabulary
with the kernel.

### 1.1 `GeometrySet`

```ts
class GeometrySet {
  mesh?: MeshComponent           // wraps kernel MeshData            (BKE_geometry_set.hh:490)
  pointCloud?: PointCloudComponent // PointCloud: Point domain only   (:547)
  curves?: CurveComponent        // CurvesGeometry: Point + Curve     (:603, BKE_curves.hh)
  instances?: InstancesComponent // Instances: Instance domain         (:655, BKE_instances.hh:115)
  name: string                   // GeometrySet::name (Set Geometry Name, Collection Info sets it)
}
```
Volume and Grease Pencil components are out of scope (no OpenVDB; GP is not a launch need); nodes that need
them are reported as unsupported, never stubbed.

Values flowing through the graph are **immutable**. `GeometrySet.copy()` is shallow; components carry a
shared flag and `getForWrite()` clones on first write (Blender's implicit sharing, `BLI_implicit_sharing.hh`).
First version clones the whole `MeshData` on write; per-attribute sharing is a later optimisation that needs
a kernel change (**[A1b]**, deferred).

### 1.2 Attributes and domains

- Domains: Blender's `AttrDomain` (`BKE_attribute_enums.hh:40-56`): Point 0, Edge 1, Face 2, Corner 3,
  **Curve 4, Instance 5** (Layer 6 not needed).
- Types: Blender's `AttrType` (`:23-38`). The kernel has bool, int8, int16x2, int32, int32x2, float, float2,
  float3, float4, byteColor, quaternion. Missing for GN: **float4x4** (instance transforms, Matrix sockets)
  and later String (string attributes are rare; not in the first subset).
- **[A1] Kernel change, additive (needs approval):** add `AttrDomain.Curve = 4` and `AttrDomain.Instance = 5`
  with Blender's values, size `AttributeStorage.domainSizes` for all six, keep `ATTR_DOMAINS` as the *mesh*
  domain list (it is only used in `attributes.ts` constructor/clone; those switch to an `ALL_DOMAINS` list),
  add `'float4x4'` to `AttrType` (16 × Float32). `MeshData` is untouched. Reason: `PointCloud`,
  `CurvesGeometry` and `Instances` then use the same `AttributeStorage`, attribute names and types as
  meshes, so Store Named Attribute, Capture, domain interpolation, propagation through Realize/Join and the
  glTF/`.blend` paths are one code path, not two. The alternative (a parallel storage in the new package)
  duplicates `attributes.ts` and every type table — the roadmap's "no second geometry representation".
- New container types live **in the new package**, not the kernel: `PointCloud`, `CurvesGeometry`,
  `Instances`, `GeometrySet`, components. Only GN produces or consumes them today; when the editor gets
  curve editing, `CurvesGeometry` can move into the kernel unchanged.
- Built-in attributes follow Blender names: `position`, `radius` (point cloud/curves), `id`, `.reference_index`
  + `instance_transform` (instances, `instances.cc`), `curve_type`, `cyclic`, `resolution`,
  `handle_left/right`, `handle_type_left/right`, `nurbs_weight`, `tilt`, `material_index`, `sharp_face`,
  `sharp_edge` (`curves_geometry.cc`, `instances_attributes.cc`, `mesh_attributes.cc` provider tables).

### 1.3 Domain interpolation (implicit adaptation)

Ported, not designed:
- mesh: `blenkernel/intern/mesh_attributes.cc:25-660` (`adapt_mesh_domain_point_to_face`, `…corner_to_point`,
  `…edge_to_point`, `…face_to_corner`, …, dispatcher `adapt_mesh_attribute_domain` `:582`), including the
  boolean special cases (point→face is "all points", face→point is "any face" etc., as written there);
- curves: `curves_geometry.cc` `adapt_curve_domain_point_to_curve` / `…curve_to_point`;
- mixers: `blenkernel/BKE_attribute_math.hh` (`DefaultMixer`, `SimpleMixer`, `BooleanPropagationMixer`,
  `mix2/mix3/mix4` used by interpolation in distribute/extrude/subdivide) and `attribute_math.cc`.

### 1.4 Fields

Mirrors `functions/FN_field.hh` and `blenkernel/BKE_geometry_fields.hh`:

```ts
type Field<T> = FieldConstant<T> | FieldInput<T> | FieldOperation<T>   // FN_field.hh:54-200, :336, :384
interface FieldContext { domain, component, size }                    // GeometryFieldContext
evaluateFields(context, fields[], mask?) → TypedArray[]               // field_evaluation.cc:296
```
- Field inputs ported one by one from `blenkernel/intern/geometry_fields.cc`: `AttributeFieldInput` (:404,
  named and anonymous attributes, with domain adaptation), `AttributeExistsFieldInput` (:442),
  `IDAttributeFieldInput` (:531: `id` if present, else index), `EvaluateAtIndexInput` (:621),
  `EvaluateOnDomainInput` (:757), `NormalFieldInput` (:833), plus each node's own inputs (Index, Edge Angle,
  Face Area, Mesh Island, Edge Neighbors, Spline Length, Spline Parameter, Endpoint Selection, …).
- Field operations are the multi-function nodes (Math, Compare, …). Evaluation is element-wise into
  typed arrays (float → `Float32Array`, so every intermediate is float32 like Blender's MF buffers).
- Per-evaluation memoisation of field inputs (one Position read per context), as `evaluate_fields`
  deduplicates (`field_evaluation.cc`).

### 1.5 Anonymous attributes and the ID attribute

- Fields that a geometry node outputs (Extrude Top/Side, Distribute Normal/Rotation, Capture Attribute,
  Curve to Points Tangent, …) are anonymous attributes: stored on the output geometry under a generated
  internal name (Blender 4.1+ uses strings, `anonymous_attribute_id.cc`) and read back by an
  `AnonymousAttributeFieldInput`.
- Propagation: first version propagates **all** attributes (Blender's `AttributeFilter` only *removes*
  anonymous attributes that nothing downstream reads, `geometry_nodes_reference_set_inferencing.cc`; the
  values of what remains are the same). At the modifier output anonymous attributes are removed, exactly
  as `remove_anonymous_attributes` does (`nodes/intern/geometry_nodes_execute.cc:453`, called `:669`). The
  reference-set inference is a later performance item, listed in M11.

### 1.6 Instances and external references

- `Instances` = `references: InstanceReference[]` (None | Object | Collection | GeometrySet,
  `BKE_instances.hh:56`) + Instance-domain attributes (`.reference_index`, `instance_transform` float4x4,
  `id`, user attributes).
- Object / Collection references resolve through a **`SceneProvider`** the host supplies
  (`getObject(name) → {transform, geometry: GeometrySet}`, `getCollection(name) → {children, objects,
  instanceOffset}`). Hosts: the modelling document (its entries), an example's asset loader (`.blend`
  import via the blend importer or GLB → `MeshData`), and test fixtures. Collection Info child order is
  `BLI_strcasecmp_natural` (`node_geo_collection_info.cc:136`), which is ported.
- Realize Instances: `geometry/intern/realize_instances.cc` (attribute gathering order, `id` remap with
  `noise::hash` when ids collide). Rendering keeps instances as instances (§8.3).

### 1.7 Curves

`CurvesGeometry` (`BKE_curves.hh`, `curves_geometry.cc`): `curve_offsets`, types Poly / Bezier /
Catmull-Rom / NURBS, cyclic, resolution, evaluated points (`curve_poly.cc`, `curve_bezier.cc`,
`curve_catmull_rom.cc`, `curve_nurbs.cc`), lengths. First subset: Poly, Bezier, Catmull-Rom; NURBS in M11.

---

## 2. Runtime

### 2.1 Recommendation

**Replace the `proc` runtime** (`src/graph/graph.ts`, `runtime.ts`: topologically sorted push evaluation of
*all* dirty nodes, values are plain JS objects, typed only by TS generics) **with a Blender-shaped node tree
and a lazy pull evaluator that keeps `proc`'s good idea — dirty propagation with cached outputs.** Reasons:
- `proc` evaluates every dirty node whether or not an output needs it, has no notion of fields, of
  single-value vs field sockets, of implicit conversions, muted nodes, reroutes, multi-input sockets,
  groups or zones; its nodes were whole node *groups* hand-written in TS, which is what made pre-baking
  possible. None of that survives a generic evaluator.
- Blender's `lf::Graph` executor (`functions/FN_lazy_function_graph_executor.hh`, `nodes/intern/
  geometry_nodes_lazy_function.cc`, 4403 lines) exists for multithreading, side effects, logging and
  partial re-execution of nodes whose inputs arrive asynchronously. Its **semantics** are what we need:
  a node runs only if an output needs it, and a node can request inputs conditionally (Switch requests
  only the selected branch, `node_geo_switch.cc`). A synchronous recursive pull with memoisation gives
  identical results (node functions are pure), runs in Node, and is a fraction of the code. I port the
  semantics node-by-node, citing the lazy-function class each one mirrors (`LazyFunctionForGeometryNode`
  :124, `LazyFunctionForMultiFunctionNode` :703, `LazyFunctionForMutedNode` :631, `LazyFunctionForRerouteNode`
  :344, `LazyFunctionForMultiInput` :310, `LazyFunctionForGroupNode` :1140, `LazyFunctionForImplicitConversion`
  :573, `LazyFunctionForSwitchSocketUsage` :1318), not the scheduler.

### 2.2 Shape

```ts
// Canonical tree (JSON-serialisable; what the DSL emits and the importers produce)
interface NodeTreeJSON { name, interface: {inputs: InterfaceSocket[], outputs: InterfaceSocket[]},
  nodes: {name, type, properties?, inputs?: {[identifier]: value}, mute?, items?}[],
  links: {from: [node, socket], to: [node, socket], muted?, sortId?}[] }
interface NodeGroupLibrary { [name: string]: NodeTreeJSON }

const ev = new GeometryNodesEvaluator(library, 'Buildify', {scene: provider})
ev.setInput('Floors', 6)                  // marks the Group Input's dependents dirty
const out: GeometrySet = ev.evaluate(inputGeometry)   // re-executes only dirty nodes an output needs
ev.lastStats   // {executed: 12, cached: 388}
```
- **Node types** are a registry of `NodeType`s: `declare(props) → sockets` (ported from each node's
  `node_declare`, dynamic on properties as in Blender ≥ 4.0), `execute(params)` for geometry nodes or a
  multi-function for field nodes. Unknown node types are an error naming the node and type — never a
  silent pass-through.
- **Values**: `SocketValue = single value | Field` (Blender's `SocketValueVariant`). A multi-function node
  with only single inputs computes a single value; with any field input it outputs a `FieldOperation`
  (`execute_multi_function_on_value_variant`, `geometry_nodes_lazy_function.cc:502`).
- **Implicit conversions**: `blenkernel/intern/type_conversions.cc` table (float↔int↔bool↔vector↔color↔
  rotation↔matrix), applied on links between different socket types, single and field.
- **Groups** evaluate as nested evaluators with their own cache, keyed by call site (Blender's compute
  context, `BKE_compute_contexts.hh`), so two instances of one group cache separately.
- **Zones**: Repeat zone in M11 (`geometry_nodes_repeat_zone.cc`); Simulation, For-Each, closures, bundles,
  lists after the first subset (5.3's list sockets are why the socket value type is a tagged union).
- **Reactivity**: every node output is cached with a dirty flag. `setInput`, `setNodeProperty`,
  `setSocketDefault`, `setScene*` (an external object/collection changed) mark the affected nodes and
  everything downstream dirty; `evaluate()` pulls from the group output and re-executes only dirty nodes on
  the requested path. Switching a Switch back to a cached branch costs nothing.
- **UI**: an interface description (name, type, subtype, default, min/max, soft range, description, menu
  items, panels) from the group interface, turned into a threepipe `uiConfig` by the plugin layer (Tweakpane
  and the editor's properties pane both consume `uiConfig`). This replaces `proc`'s `graphUiConfig`.
- **Node-safe**: all of the above is pure TS over typed arrays; no DOM. The SVG visualiser from `proc` is
  dropped from the core (the editor gets a node view later; out of scope).

### 2.3 What is kept from `proc`

Kept after re-verification, moved into `src/blender/` with fresh citations against 5.2.2:
`noise.ts` (Jenkins `hash`/`hash_to_float`, port of `blenlib/intern/noise.cc` — matches), `random_value.ts`
(argument orders, `node_fn_random_value.cc` — to re-verify per type), the RNG/`round_probabilistic`/KD
elimination of `distribute_points_on_faces.ts` (re-based on `MeshData` and Blender's `corner_tris`), the
color ramp and float curve evaluators (after fixing the audited `handle_type` bug and porting
`BKE_curvemapping_evaluateF` exactly). Not kept: `PrimGen`, `MeshOps`, `points/*`, `geo/*`, generators,
`graph/*` (replaced), `subdivision_surface.ts` (an approximation of OpenSubdiv, see M11).

### 2.4 Audited divergences — fixed in the port

All five `issues/open/audit-procgen-*` are resolved by porting the 5.2.2 source, with a unit test per item:
Math MODULO=`fmodf`, PINGPONG, SMOOTH_MIN/MAX (`smoothminf`), SQRT/POWER/LOGARITHM safe forms, COMPARE
epsilon (`blenlib/intern/math_base_safe_inline.cc`, `math_base_inline.cc`, registered in
`functions/intern/multi_function_common.cc`/`nodes/shader/nodes/node_shader_math.cc`); Map Range STEPPED
clamp + `clamp_range` swap (`node_shader_map_range.cc`); `mat3_normalized_to_eul` two-solution pick;
Float Curve handle types; the Buildify `round`/`floor` and hard-coded floors disappear because Resample
Curve is ported and the floors come from the graph. The issues move to `resolved/` when their tests pass.

### 2.5 Errors and warnings

Blender's node warnings (`NodeWarningType`, `geometry_nodes_warning.cc`) are collected per node per
evaluation (e.g. "Input geometry has unsupported type") and exposed on the evaluator; the editor shows them
on the modifier. Field-into-single-value-socket links are rejected at build time with Blender's message.

### 2.6 Float32 policy

Attributes are `Float32Array` (rounding is implicit). Single values are rounded with `Math.fround` at every
node output. Where Blender makes a discrete decision on a float — `floor`/`int()` casts, comparisons
feeding counts, hash inputs that reinterpret float bits — the port evaluates the expression with float32
rounding of each intermediate, as C does. Parity tolerances: topology, ints, ids, reference names, element
order exact; positions/transforms ≤ 1e-5 absolute (≤ 4 ulp relative for large coordinates); any looser
tolerance is a filed issue, not a constant.

**Measured (2026-10-18, `tests/parity/cases/textures.status.json`):** 126 texture cases against Blender 5.2.2
on the maintainer's Mac (arm64): 108 bit-exact. The other 18 are exactly the cases that call `powf`
(Voronoi Minkowski), `sinf` (Wave SIN profile) or `atan2f` (Gradient radial): Apple's libm is not correctly
rounded for these, while JS computes them in double and rounds once (`f32(Math.sin(x))`), so single results
differ by 1 ulp and grow where later arithmetic cancels (up to ~1e-6 absolute). These can't be bit-exact
without reproducing a platform libm (Blender on Linux/Windows would differ from macOS too); they pass at
1e-5 and the status file records the ulp distance per case.

**libm boundaries (measured 2026-10-18 on the reference Mac, `porting/blender/libm_probe.py`):** macOS arm64's float
`acosf(-1)` = 3.1415925, `asinf(+-1)` = +-1.5707962 and `atan2f` = +-3.1415925 wherever the correctly rounded result
is +-float(pi) (e.g. `atan2f(+-0, x < 0)`), one ulp below the correctly rounded values. Unlike other libm ulps these
change branches (`vec_to_quat` flips a near-zero cosine's sign and returns a different rotation for axis-aligned
normals), so `src/blender/libm.ts` models exactly these measured results (`blenderSystem.libm = 'apple-arm64'`,
switchable to `'correctly-rounded'`) and every `acosf`/`asinf`/`atan2f` call site uses it.

---

## 3. First subset — nodes in dependency order

Chosen by what the three launch demos and the existing ground truth use (node idnames taken from the
`.blend` files and dumps; Buildify alone uses 47 GN node types), not by the roadmap's round "~40". It is
**~75 node types**; each is one port with a test. Source paths are under `.repos/blender-5.2.2/source/blender/`.

| # | Node(s) | Blender source | Needs / reuses |
|---|---|---|---|
| **R** | Group Input/Output, Reroute, Frame, Group, muted nodes, implicit conversion | `nodes/intern/geometry_nodes_lazy_function.cc`, `blenkernel/intern/type_conversions.cc` | runtime |
| **F1** | Value, Integer, Boolean, Vector, Rotation, Color inputs | `nodes/function/nodes/node_fn_input_*.cc`, `nodes/shader/nodes/node_shader_value.cc` | — |
| F2 | Math (all 40 ops + clamp) | `nodes/shader/nodes/node_shader_math.cc`, `nodes/NOD_math_functions.hh`, `blenlib/intern/math_base*_inline.cc` | fixes H05–H07, M14 |
| F3 | Vector Math, Integer Math, Boolean Math, Compare (all data types/modes) | `node_shader_vector_math.cc`, `node_fn_integer_math.cc`, `node_fn_boolean_math.cc`, `node_fn_compare.cc` | — |
| F4 | Map Range (float/vector, 4 modes), Clamp, Mix (float/vector/color modes), Combine/Separate XYZ, Combine/Separate Color | `node_shader_map_range.cc`, `node_shader_clamp.cc`, `node_shader_mix.cc`, `node_shader_sepcomb_xyz.cc`, `node_fn_combine_color.cc` | fixes M13 |
| F5 | Random Value, Hash Value | `node_fn_random_value.cc`, `node_fn_hash_value.cc`, `blenlib/intern/noise.cc` | `proc` hash |
| F6 | Euler to Rotation, Rotate Euler, Align Euler to Vector, Rotate Rotation, Axis Angle to Rotation, Rotation to Euler, Combine/Separate Transform | `nodes/function/nodes/node_fn_*.cc`, `blenlib/intern/math_rotation*.cc` | fixes mat3ToEul |
| F7 | Float Curve, Color Ramp | `node_shader_curves.cc`, `blenkernel/intern/colortools.cc`, `node_shader_color_ramp.cc`, `blenkernel/intern/colorband.cc` | fixes handle bug |
| F8 | Noise Texture (Perlin fBM/multifractal/hetero/ridged/hybrid, 1–4D), White Noise, Voronoi (F1/F2/smooth/edge/radius, 1–4D), Gradient, Wave | `nodes/shader/nodes/node_shader_tex_*.cc`, `blenlib/intern/noise.cc` | terrain |
| **G1** | Position, Normal, Index, ID, Named Attribute, Attribute exists, Radius, Shade Smooth inputs | `node_geo_input_*.cc`, `blenkernel/intern/geometry_fields.cc` | fields |
| G2 | Mesh topology inputs: Edge Angle, Edge Neighbors, Edge Vertices, Face Area, Face Neighbors, Mesh Island, Vertex Neighbors, Edge Smooth | `node_geo_input_mesh_*.cc` | kernel normals (`bake.ts` ports `mesh_normals.cc`) |
| G3 | Capture Attribute, Store Named Attribute, Remove Attribute, Evaluate on Domain, Evaluate at Index, Accumulate Field, Field at Index, Attribute Statistic, Domain Size | `node_geo_attribute_capture.cc`, `node_geo_store_named_attribute.cc`, `node_geo_evaluate_*.cc`, `node_geo_accumulate_field.cc`, `node_geo_attribute_statistic.cc` | anonymous attrs |
| G4 | Mesh primitives: Grid, Cube, Line, Circle, Cylinder, Cone, UV Sphere, Ico Sphere | `geometry/intern/mesh_primitive_{grid,cuboid,line,cylinder_cone,uv_sphere}.cc`, `node_geo_mesh_primitive_*.cc` (Ico Sphere goes through BMesh `bmo_create_icosphere`: kernel `createIcoSphere` reused) | **not** kernel generators except Ico Sphere |
| G5 | Set Position, Transform Geometry, Join Geometry, Separate Geometry, Delete Geometry, Separate Components, Bounding Box, Set ID, Set Material, Set Material Index, Set Shade Smooth, Points, Mesh to Points, Points to Vertices | `node_geo_set_position.cc`, `geometry/intern/transform.cc`, `geometry/intern/join_geometries.cc`, `geometry/intern/separate_geometry.cc`, `geometry/intern/mesh_copy_selection.cc`, … | |
| G6 | Extrude Mesh (vertices/edges/faces/individual), Split Edges, Subdivide Mesh (simple scheme), Merge by Distance, Flip Faces, Triangulate, Scale Elements | `node_geo_extrude_mesh.cc`, `geometry/intern/mesh_split_edges.cc`, `node_geo_mesh_subdivide.cc` + `blenkernel/intern/subdiv_*.cc` (simple = bilinear ptex patches, no OpenSubdiv needed), `geometry/intern/mesh_merge_verts.cc`/`point_merge.cc`, `node_geo_triangulate.cc` → `geometry/intern/mesh_triangulate.cc` (Mesh arrays + `BLI_polyfill_2d`/`_beautify`, see [A1c]) | |
| G7 | Sample Index, Sample Nearest, Sample Nearest Surface, Raycast, Proximity | `node_geo_sample_*.cc`, `node_geo_raycast.cc`, `node_geo_proximity.cc`, `blenlib/intern/kdtree_impl.h`, `blenlib/intern/BLI_kdopbvh.cc` | ports of KD-tree and BVH nearest (tie order matters) |
| **I1** | Distribute Points on Faces (Random, Poisson) | `node_geo_distribute_points_on_faces.cc`, `blenkernel/intern/mesh_tessellate.cc` (corner tris), `blenlib/intern/rand.cc` | `proc` port re-based; [A1c] |
| I2 | Instance on Points, Realize Instances, Translate/Rotate/Scale Instances, Set Instance Transform, Instances to Points, Geometry to Instance, instance inputs (Transform, Rotation, Scale, Reference) | `node_geo_instance_on_points.cc`, `geometry/intern/realize_instances.cc`, `node_geo_*_instances.cc` | |
| I3 | Object Info, Collection Info, Self Object, Image Texture, Image Info | `node_geo_object_info.cc`, `node_geo_collection_info.cc`, `node_geo_image_texture.cc` (`image_texture` sampling, `BKE_image` interpolation) | `SceneProvider`, image provider |
| **C1** | Curve Line, Curve Circle, Bezier Segment, Quadrilateral, Star, Spiral, Arc | `node_geo_curve_primitive_*.cc` | |
| C2 | Mesh to Curve, Curve to Mesh, Curve to Points, Resample Curve, Trim Curve, Reverse Curve, Fill Curve (later), Subdivide Curve | `geometry/intern/mesh_to_curve_convert.cc`, `blenkernel/intern/curve_to_mesh_convert.cc`, `node_geo_curve_to_points.cc`, `geometry/intern/resample_curves.cc`, `geometry/intern/trim_curves.cc`, `geometry/intern/subdivide_curves.cc` | |
| C3 | Spline Length, Spline Parameter, Endpoint Selection, Curve Length, Set Spline Type/Cyclic/Resolution, Set Curve Radius/Tilt, Duplicate Elements (all domains), Sample Curve | `node_geo_input_spline_*.cc`, `node_geo_curve_endpoint_selection.cc`, `node_geo_duplicate_elements.cc`, `node_geo_curve_sample.cc` | |
| **S** | Switch, Index Switch, Menu Switch | `node_geo_switch.cc`, `node_geo_index_switch.cc`, `node_geo_menu_switch.cc` | lazy inputs |
| B | Mesh Boolean (Manifold solver; Exact solver later) | `node_geo_boolean.cc`, `geometry/intern/mesh_boolean_manifold.cc` | `manifold-3d` (approved D6) |

Buildify's list (from `tmp/buildify_1.0.blend`): Math, Delete Geometry, Compare, Random Value, Boolean Math,
Combine XYZ, Join, Instance on Points, Collection Info, Capture Attribute, Spline Length, ID, Align Euler to
Vector, Set Position, Set ID, Mesh to Curve, Set Shade Smooth, Sample Nearest Surface, Mesh to Points,
Normal, Edge Neighbors, Extrude Mesh, Duplicate Elements, Curve to Mesh, Trim Curve, Switch, Subdivide Mesh,
Store Named Attribute, Split Edges, Separate Geometry, Resample Curve, Shade Smooth, Named Attribute, Edge
Angle, Vector, Euler to Rotation, Translate Instances, Set Material, Sample Nearest, Sample Index, Instances
to Points, Mesh Island, Face Area, Edge Smooth, Endpoint Selection, Attribute Statistic, Rotate Euler, Map
Range. Flower scatter adds Distribute, Image Texture, Noise Texture, Color Ramp; pebble adds Object Info.

---

## 4. Graph as code (the TS DSL) and JSON import

### 4.1 DSL shape (mirrors nodebpy's: typed node classes, explicit sockets, operator helpers)

```ts
import {geometryNodes, n} from '@threepipe/plugin-procedural'

export const terrain = geometryNodes('Terrain', g => {
    const size = g.input.float('Size', {default: 20, min: 1, subtype: 'DISTANCE'})
    const res = g.input.int('Resolution', {default: 128, min: 2, max: 1024})
    const height = g.input.float('Height', {default: 3})
    const seed = g.input.float('Seed', {default: 0})

    const grid = n.MeshGrid({sizeX: size, sizeY: size, verticesX: res, verticesY: res})
    const noise = n.NoiseTexture({noiseDimensions: '4D', vector: n.Position(), w: seed, scale: 0.15, detail: 6})
    const lifted = n.SetPosition({geometry: grid.mesh, offset: n.CombineXYZ({z: noise.fac.mul(height)})})
    g.output.geometry('Geometry', lifted.geometry)
})
terrain.json   // NodeGroupLibrary (the group and every group it uses), the only thing the runtime reads
terrain.toCode() // back to this text (also works on imported Blender trees: toCode(library, name))
```
- Node classes are PascalCase Blender UI names; input keys are camelCase socket names (`'Size X'` → `sizeX`,
  identifier used when names repeat, e.g. Math `value`, `value1`, `value2`); properties are camelCase RNA
  identifiers with Blender's RNA enum strings as literal unions (`operation: 'MULTIPLY'`, D15).
- Typed sockets: `FloatSocket`, `IntSocket`, `BoolSocket`, `VectorSocket`, `ColorSocket`, `RotationSocket`,
  `MatrixSocket`, `GeometrySocket`, `ObjectSocket`, … Implicit conversions that Blender allows type-check
  (number → vector, int → float, …); the rest is a compile error. Field-ness is checked at build time
  (a field into a single-value socket throws Blender's message).
- Operator helpers on sockets create the corresponding nodes: `.add .sub .mul .div .pow .min .max .abs
  .floor .gt .lt .eq .and .or .not` (Math / Compare / Boolean Math), `.dot .cross .length .normalize .scale`
  (Vector Math), `.x .y .z` (Separate XYZ). No hidden nodes beyond these.
- Node classes and their typings are generated from the ported declarations (one source of truth, the
  registry); a unit test checks the registry against geonodes-kit's `nodes-5.2.2.json` inventory (socket
  identifiers, types, defaults, enum items) as a cross-check — the inventory is Blender output, read, not
  vendored as code.
- **Agents write this DSL** in their session scripts (constrained: typed nodes, no raw link JSON), the
  research finding in `research-ai-3d-ecosystem.md` §3.7. The `nodeGroup` command (§5) accepts the JSON
  the DSL emits and validates it against the registry; raw hand-written JSON passes the same validation.

### 4.2 Import

- `importBlenderDump(json)`: the `extract_geo_nodes.py` format (`trees[].nodes[].{bl_idname, properties,
  inputs{identifier: {default_value, is_linked}}}`, `links[].{from_node, from_socket, to_node, to_socket}`,
  `group_inputs`, nested `sub_tree` with `_deduped`, `modifiers[].input_overrides`) → `NodeGroupLibrary`
  + modifier inputs. The v2 dumper (§7.4) adds what v1 misses: multi-input link order
  (`NodeLink.multi_input_sort_id`; Join Geometry's input order depends on it), muted links, socket
  availability, item collections (capture/repeat/menu/index-switch items), zone pairing, panels.
- `importCase(json)`: the geonodes-kit/our case format (single tree, `{from:[n,s], to:[n,s]}` links).
- `.blend` direct import of node trees through the blend importer's DNA reader (`bNodeTree`, `custom1/2`,
  `storage` structs → RNA names) is possible and would remove Blender from tree extraction, but it is a
  per-node DNA→RNA mapping table; **not in the first subset**, noted as M12.

---

## 5. Modifier integration

- **[A2] `plugin-modelling` change, additive (needs approval)**:
  1. a modifier-type registry, `registerModifierType(type, {check, describe, evaluate, schema})`, which the
     existing `array`/`mirror`/`wireframe` keep using internally; `plugin-procedural` registers
     `geometryNodes`, so `plugin-modelling` does not depend on the procedural package;
  2. `ModifierSpec` gains `{type: 'geometryNodes', group: string, inputs: Record<string, value>}`;
  3. node groups live on the document (`doc.nodeGroups: NodeGroupLibrary`), in snapshots (undo) and in the
     glTF topology extension (`gltf/`), so a saved file reopens with its graphs;
  4. an entry's evaluation result becomes `{mesh: MeshData, geometry?: GeometrySet}`: `evaluated` stays the
     realized mesh component (everything that reads `evaluated` today — measure, inspect, picking — keeps
     working), `geometry` carries instances / points / curves for rendering;
  5. new commands only: `nodeGroup` (`{op: 'nodeGroup', name, tree}` create/replace, list, remove,
     `describe` returning the interface), and `modifier add {type: 'geometryNodes', group, inputs}`,
     `modifier update {index, update: {inputs: {...}}}` through the existing `modifier` command (new type,
     same command shape). No existing command changes shape.
- Evaluation: the GN modifier gets the previous stack output as its input geometry (as Blender does), a
  `SceneProvider` backed by the document, and keeps a `GeometryNodesEvaluator` per entry+modifier so an
  input change re-executes only the dirty part.
- **Apply** = Blender's: realize instances, keep the mesh component (Blender's apply converts the evaluated
  geometry to a mesh; point clouds/curves become loose verts/edges per `BKE_mesh_new_from_object`
  conversion rules — ported in M10), bake into `mesh`.
- Rendering (plugin layer, browser only): mesh → existing bake; instances → one `InstancedMesh` per
  (reference, material) with per-instance matrices (the `proc` viewer's `InstancedMesh2` path,
  re-implemented on `GeometrySet`); point clouds → `Points`; curves → line segments of evaluated points.
- Editor: the Modifiers tab shows a `geometryNodes` modifier's interface inputs as editable fields
  (number/int/bool/vector/color/menu/object/collection pickers from the interface `uiConfig`), each change
  a `modifier update` command, so it is undoable and agent-visible. A read-only "show as code" button
  prints `toCode()`.

---

## 6. Package

- `plugins/procedural` → **`@threepipe/plugin-procedural`**. Same layout and scripts as `mesh-kernel`
  (`build`, `typecheck`, `test` with vitest beside sources, `docs`), deps `@threepipe/mesh-kernel` (file),
  peer `threepipe`; `manifold-3d` optional peer for Mesh Boolean (dynamic import at call time).
  Root scripts: `test:unit:procedural`, and `typecheck:plugins` gains the package.
- Entry points: `.` (everything, Node-safe), `./plugin` (threepipe viewer plugin + renderer + UI; DOM only at
  call time). Built `dist/` for both — fixes `proc`'s P3 "subpath points at `.ts`".
- Layout:
  ```
  src/geometry/   GeometrySet, components, PointCloud, CurvesGeometry, Instances, attribute accessors,
                  domain adaptation, attribute_math, propagation, realize/join
  src/fields/     Field, inputs, operations, evaluator, GeometryFieldContext
  src/runtime/    tree model, socket types, conversions, evaluator, groups, zones, warnings, interface/UI
  src/nodes/      one file per Blender node: function/, shader/, geometry/ — declaration + exec + tests
  src/blender/    ported helpers: noise, rand, math_base, rotation, kdtree, bvh, polyfill (if not kernel),
                  mesh primitives, curves evaluation, strcasecmp_natural
  src/dsl/        generated node classes, socket helpers, toCode, importers
  src/plugin/     ProceduralPlugin, GeometrySet → three objects, modifier registration, uiConfig
  porting/        blender/*.py (§7.4), compare tools, the porting skill (rewritten for the generic runtime)
  ```
- **Examples** (21 on `proc`): all move into `examples/procedural-*` and run on the new runtime.
  - Blender-backed (load the dumped tree + Blender-order source meshes, evaluate generically, no
    hand-written graph logic): `procedural-buildify` (replaces buildify-demo-1, -2, -4 — same `.blend`),
    `procedural-grid-buildings` (demo-3, `blender-procedural-buildings.blend`), `procedural-flower-scatter`
    (replaces flower-scatter-v4 and -v5), `procedural-pebble-scatter`, `procedural-rose` (flower-demo,
    `repeat_zone_flower_by_MiRA.blend`, needs Repeat zone + Subdivision Surface, M11),
    `procedural-candy-bounce` (needs Subdivision Surface, Proximity), `procedural-flowers-on-building`.
  - Code generators (the 11 `procedural-*` ones built on `PrimGen`/non-Blender noise) are rewritten as DSL
    graphs — they become the DSL's showcase: terrain basic/advanced/showcase → the terrain demo graph;
    noise visualizer → Noise/Voronoi/White Noise on a grid; vegetation scatter, flower meadow, stone path,
    asteroid field, building, building-modular → DSL graphs. Terrain erosion has no Blender node: it becomes
    a clearly named threepipe extension node (`ThreepipeErosion`, ported from `.repos/hydraulic-erosion-lague`
    with citations), not passed off as Blender (**[A5]**).
  - Asset sizes: buildify-demo-3 1.8 MB (largest file 190 KB), flower-scatter 9.4 MB (largest 1.6 MB; v4/v5
    are byte-identical copies, kept once), pebble `ground.glb` 3.7 MB, candy-bounce 0.76 MB,
    procedural-building-modular 2.0 MB. Only `pebble-scatter/ground_truth.json` (14.4 MB) is over 5 MB: it is
    replaced by the v2 export in binary float32 (~2.6 MB for 40 k instances) or kept outside git with a
    content hash in the fixture (**[A6]**). Scatter source meshes come from the Blender dump, not glTF.
- Licence: the package, like `mesh-kernel`, is a source port of GPL Blender code under an Apache-2.0
  package licence. That is the maintainer's existing decision for the kernel; noted once, not re-litigated.

---

## 7. Verification

### 7.1 Per node

- `*.test.ts` beside each node: formulas and edge cases from the source (NaN, zero sizes, empty geometry,
  out-of-range indices), each citing the C++ line it checks.
- **Parity fixtures**: a case runner evaluates `{tree, expected geometry}` and compares every component,
  every attribute on every domain, instance transforms and references (tolerances §2.6).
  - **[A3]** vendor geonodes-kit's 340 Blender 5.2.2 reference cases (MIT data, 2.6 MB, with its licence
    file and attribution) into `plugins/procedural/tests/parity/geonodes-kit/` as an immediate corpus for
    ~30 node types. Their code is not used. If declined, the same coverage comes from [B2] one batch later.
  - our own cases (`tests/parity/cases/<milestone>.json`, written with the DSL, exported as case JSON),
    evaluated by the maintainer's Blender with `run_cases.py` ([B2]) and committed with the result.

### 7.2 Per graph (assets)

- `compare` tool: evaluates an imported library with the dumped modifier inputs and the dumped source
  meshes, compares with the dumped evaluated geometry (instance count, per-instance reference name and
  matrix in order, mesh topology/attributes), prints a report like `compare_graph.ts` did, exits non-zero
  on mismatch. Ported nodes only; an unported node in a tree is reported as the blocker.
- **Reactivity perturbation test per graph**: for every interface input, perturb it (float ±10 % or +1,
  int +1, bool flip, seed +1, menu next item), re-evaluate, assert the output hash changes — or that
  Blender's socket-usage inference (`nodes/intern/socket_usage_inference.cc`, ported for the UI anyway)
  says the input is unused under the current values, in which case it must *not* change. Also assert the
  re-evaluation executed only dirty nodes (cache works) and that a revert restores the original hash.
- **No pre-baking check**: graph modules may load only the tree dump, source meshes/images and modifier
  inputs; a test greps example/graph sources for evaluated-output files.

### 7.3 Ground truth inventory

| Demo | Have | Need ([B1]) |
|---|---|---|
| Buildify (`buildify_1.0.blend`) | 238 matrices (5.0.1, names partly unresolved), modules GLB in `tmp/buildify_modules` | 5.2.2 tree dump, modifier input mesh, module object meshes, evaluated instances with exact references; 3 perturbed configs (floors, module width, seed) |
| Flower scatter | 5.0.1 dump, 500 of 117 343 instances | 5.2.2 dump, full instance list (binary), ground input mesh in Blender order, the two images, 2 perturbed configs at lower density |
| Pebble scatter | 14.4 MB GT from glTF-ordered ground | 5.2.2 dump, input mesh, full instances (binary) |
| Terrain | nothing (old terrain was not Blender) | our DSL tree → `run_cases.py` evaluates it in Blender → GT; 3 configs |
| Grid buildings / rose / candy bounce (M11) | 1149 matrices / 7392 verts / candy GT (5.0.1) | 5.2.2 dumps + evaluated output |

### 7.4 What the maintainer runs (scripts in `plugins/procedural/porting/blender/`)

All with Blender **5.2.2** (`blender --version` must print `5.2.2`), from the repo root of this worktree.

- **[B1] Dump a `.blend`** (tree library, modifier inputs, modifier input mesh in Blender order, referenced
  objects/collections with meshes and transforms, images, evaluated output via `evaluated_geometry()`,
  big arrays as `.bin` beside a JSON header):
  ```sh
  for f in buildify_1.0 flower_scattering pebble_scattering blender-procedural-buildings candy_bounce repeat_zone_flower_by_MiRA; do
    blender --background --factory-startup "tmp/$f.blend" \
      --python plugins/procedural/porting/blender/dump_blend.py -- --out "tmp/gt-5.2.2/$f"
  done
  ```
  Then per demo the perturbed configurations:
  ```sh
  blender --background --factory-startup tmp/buildify_1.0.blend \
    --python plugins/procedural/porting/blender/dump_blend.py -- --out tmp/gt-5.2.2/buildify_1.0-floors8 \
    --set "Buildify building:GeometryNodes:Max floors=8"
  ```
  (`--set object:modifier:input name=value`, repeatable; the exact input names are printed by the first run.)
- **[B2] Evaluate our cases** (one run per milestone batch):
  ```sh
  blender --background --factory-startup --python plugins/procedural/porting/blender/run_cases.py -- \
    plugins/procedural/tests/parity/cases/M3.json tmp/gt-5.2.2/cases/M3
  ```
- **[B3] Once**: `blender --background --factory-startup --python plugins/procedural/porting/blender/inventory.py
  -- tmp/gt-5.2.2/inventory.json` — our own node inventory (sockets, defaults, enums, dynamic layouts for
  each enum value of the main property), to cross-check declarations against Blender itself, not only
  against geonodes-kit's file.

The outputs (`tmp/gt-5.2.2/`) are copied into the worktree's `plugins/procedural/tests/parity/` (small) or
kept in `tmp/` and referenced by content hash (anything over 5 MB).

---

## 8. Milestones ("done" is a test result, not a claim)

| M | Content | Done when |
|---|---|---|
| **M0** | Package skeleton, scripts wired, [A1] kernel change with its tests, porting scripts [B1–B3] written | `npm run typecheck:plugins`, `test:unit:mesh-kernel` (1842 + new) and `test:unit:procedural` pass |
| **M1** | Data model: GeometrySet + components, PointCloud, Instances, CurvesGeometry (storage only), attribute accessors, domain adaptation (§1.3), fields + evaluator, anonymous attributes, ID | unit tests per adapt function and mixer against hand-computed Blender formulas; geonodes-kit `fields-*`, `attr-*`, `gs-*` cases that need no other nodes pass ([A3]) |
| **M2** | Runtime: tree model, registry, conversions, lazy evaluator, groups, mute/reroute, Switch laziness, cache/dirty, interface + uiConfig; DSL v0 + `toCode`; importers (dump v1/v2, case) | flower_scattering dump imports and reports exactly its unported nodes; evaluator tests (laziness counters, cache hits, dirty propagation, group call-site caching) |
| **M3** | Function nodes F1–F8 + Switch family | all geonodes-kit math/bool/compare/rv/switch cases pass; [B2] batch M3 (vector math, map range, mix, noise/voronoi/white noise per dimension, rotations, curves) passes; the 5 audit issues resolved |
| **M4** | Geometry core G1–G6 | geonodes-kit grid/extrude/separate/join/set/transform/edge/is/position cases pass; [B2] batch M4 passes |
| **M5** | Modifier integration [A2] + `ProceduralPlugin` rendering + editor panel + `examples/procedural-terrain` (DSL graph) with an e2e test | e2e: add GN modifier via command, change an input, assert evaluated counts and a screenshot; undo restores; apply bakes |
| **M6** | Instances & points I1–I3, G7 | geonodes-kit iop/realize/object/collection/translate cases pass; pebble scatter matches [B1] GT exactly (count, ids, order, matrices); reactivity test passes |
| **M7** | Curves C1–C3 | [B2] batch M7 passes |
| **M8** | **Buildify** (`examples/procedural-buildify`) | default + 3 perturbed configs: instance count, per-instance reference and matrix match the 5.2.2 GT 100 %; the old 238-matrix GT also matches (or each difference explained by a 5.0→5.2 change in the source); reactivity test passes |
| **M9** | **Flower scatter** (`examples/procedural-flower-scatter`) | full instance list matches [B1] (count, order, references, matrices ≤ 1e-5); lower-density configs too; reactive |
| **M10** | **Terrain** demo at parity + Apply semantics + remaining Blender-backed examples | terrain GT from [B2] matches; the launch demos run in the editor's modifier panel |
| **M11** | Repeat zone, Subdivision Surface (**[A4]**), Mesh Boolean (manifold-3d), NURBS, reference-set inference (perf), rose / candy bounce / grid buildings, code-generator examples rewritten in the DSL | each with its GT |
| M12 | Later: Simulation/For-Each/closures/bundles/lists, `.blend` node-tree import without Blender, stretch targets (French/NYC/Chinese buildings) | — |

Acceptance for the launch (§5 of the roadmap): **M8, M9, M10** — Buildify, flower scatter, terrain, each at
parity, reactive in the browser and in the modifier panel.

---

## 9. How an agent writes a graph (for the Track 1 SKILL.md)

1. Write a DSL module (`geometryNodes(...)`) in the session script; `group.json` (a NodeGroupLibrary) is what
   goes to the document.
2. `{op: 'nodeGroup', library: group.json}` (or `{op: 'nodeGroup', name, tree}` for one tree) then
   `{op: 'modifier', object, add: {type: 'geometryNodes', group, inputs}}`.
3. Iterate with `{op: 'modifier', object, index, update: {inputs: {Seed: 4}}}` — only the dirty part re-runs;
   `measure`/`look` read the evaluated result.
4. Validation errors name the node, the socket and Blender's rule (type mismatch, field into single value,
   unknown enum value). `toCode()` on an imported Blender tree gives the agent editable DSL.

---

## 10. Risks

- **Subdivision Surface** is OpenSubdiv limit-surface evaluation (`blenkernel/intern/subdiv_eval.cc` calls
  the OpenSubdiv C API); parity needs OpenSubdiv's Far patch tables, not a Catmull-Clark averaging pass
  (`proc`'s `catmullClark` matched the rose to 0.002 only). Not in the launch demos; [A4].
- **Sample Nearest Surface / Raycast** depend on BVH traversal order for ties; ported from `BLI_kdopbvh.cc`
  as far as tie order is observable, verified with [B2] cases built to have ties.
- **Image Texture** in GN samples `ImBuf` pixels with Blender's colour management; parity needs the image's
  raw bytes as Blender reads them (PNG 8-bit, non-color vs sRGB) — the dump exports them.
- Size: ~75 nodes, each a port with tests; I report coverage as "ported / verified (with which cases)" per
  node in `plugins/procedural/COVERAGE.md`, generated by a script from the registry and the test results.

---

## 11. Decisions requested (recommendations in bold)

- **[A1] Kernel**: add `AttrDomain.Curve/Instance` (Blender values), six domain sizes in `AttributeStorage`,
  `AttrType 'float4x4'`. **Yes** (additive, ~30 lines + tests). [A1b] per-attribute copy-on-write in
  `AttributeStorage`: **later**, only if profiling shows whole-mesh copies matter. [A1c] port
  `BLI_polyfill_2d` + `polyfill_2d_beautify` and `mesh_tessellate.cc` (`corner_tris`) **into the kernel**
  (closes `kernel-triangulate-ngon-polyfill`; Distribute, Sample Nearest Surface, Raycast, Triangulate need
  Blender's exact triangles).
- **[A2] plugin-modelling**: modifier-type registry, `geometryNodes` spec, `doc.nodeGroups` (+ snapshots
  and glTF extension), `{mesh, geometry}` evaluation result, `nodeGroup` command. **Yes**.
- **[A3]** Vendor geonodes-kit's 340 Blender reference cases as test data (MIT, attributed). **Yes**.
- **[A4]** Subdivision Surface: **out of the first subset**; then port OpenSubdiv's Far refinement +
  patch evaluation subset (Apache-2.0, C++ in `extern/` of Blender is not in our sparse tree; would clone
  `PixarAnimationStudios/OpenSubdiv`) rather than ship a WASM build.
- **[A5]** Example migration as in §6 (merge the duplicate buildify-1/2/4 and flower-scatter-v4/v5; rewrite
  the 11 code generators as DSL graphs in M11; erosion as a named threepipe extension node). **Yes**.
- **[A6]** Large GT: binary float32 under 5 MB in git; anything bigger stays in `tmp/` referenced by hash.
- **[A7]** Blender pin: **v5.2.2** (`.repos/blender-5.2.2`), not `.repos/blender-gn-source` (5.2 alpha).

---

## 12. Progress (2026-10-18)

Numbers are test results in `plugins/procedural` (`npm run test`), statuses in `tests/parity/*.status.json`.

**Runtime and data model (M0-M2)**: done as planned (§1-§2), plus Blender's mesh built-in table for procedural
meshes (kernel `AttributeStorage.setBuiltins`, additive), measured libm boundaries (`src/blender/libm.ts`,
`blenderSystem.libm`), `blenderSystem.threadCount` for thread-count-dependent orders. Dump importer v1/v2 and
runtime bundles (`porting/blender/bundle_dump.py`: the dump without evaluated output; unorm8 images).

**Nodes** (counts against Blender 5.2.2's 318 geometry/function node types, `node_geo_*.cc` / `node_fn_*.cc`):
211 are ported, plus the Repeat and For Each Geometry Element zones and the `ThreepipeErosion` extension node
([A5]). That covers all of §3 (F, S, G1-G7, I1-I3, C1-C3): Subdivide Mesh, Triangulate, Dual Mesh, Scale/Sort/Split
elements, edge paths and face groups, Raycast, Proximity, Index of Nearest, Blur Attribute, every curve node except
grease-pencil and font ones (Fill/Fillet/Interpolate/Subdivide/Sample Curve, Curve to Points, primitives, handles,
spline types), Convex Hull (Bullet port), the string and matrix function nodes, Merge Points and the Cluster nodes.
Not ported, by group:
- volumes and grids (OpenVDB, ~35 nodes), grease pencil (8), lists / closures / bundles (12, a runtime value kind),
  Simulation and Bake zones, tool-context nodes (9), file import (6), Viewer, gizmos;
- in work by the sub-agent: Ico Sphere (exact BMesh path), Sample UV Surface, UV Unwrap / Pack Islands;
- blocked on decisions: Subdivision Surface (one OpenSubdiv port, see below), Set Mesh Normal (custom normals in
  the kernel), Mesh Boolean (the realism track's Manifold port; Exact solver is a separate large port), Mesh Bevel;
- remaining smaller nodes: Transfer Attributes (needs lists), Image Info (needs image channel info in bundles),
  Input Menu, Integer Vector, Format/Split String, String to Value, Matrix SVD (Eigen JacobiSVD), UV Tangent, Cube
  Grid Topology, Distribute Points in Grid, Camera Info, Collection Children (lists), String to Curves (fonts).

**Parity** (Blender 5.2.2, run through `run_cases.py` on the maintainer's Mac):
- geonodes-kit corpus: 323 pass / 16 skip (13 need operator-built scene objects, Ico Sphere, 2 volumes) / 0 fail.
- own case sets (52 sets, about 1000 cases): bit-exact except libm ulps (Apple `sinf`/`cosf`/`acosf`/`atan2f`/
  `asinf`/`__sincosf_stret`, proven by substitution, `procedural-libm-atan2f-sincos.md`), 1 ulp from Blender's single-
  value attribute storage (`procedural-single-value-attribute-storage.md`), 2 reproduced Blender bugs (realize
  material slots, For Each main items), 1 `blenderBug` (Face Is Planar), 3 `blocked` (float4x4 mix2 = Eigen
  JacobiSVD; Scale Elements' large-island grouping order = TBB/libc++ unstable sort; NURBS custom knots).
- assets (whole graphs vs Blender's evaluated output): Blender procedural buildings 3/3 bit-exact; Buildify 14/15
  bit-exact. `building_base` evaluates fully and matches except one attribute: a vertex group and a face attribute
  share the name `building:levels` (known gap, `procedural-vertex-groups.md`, a kernel data-model decision). Flower
  and pebble scatter are within 1e-5, candy bounce jumpers <= 16 ulp, well <= 4 ulp. Candy floor and rose wait for
  Subdivision Surface.
- reactivity (§7.2): `tests/parity/reactivity.test.ts` perturbs every modifier input of every evaluable asset.

**Modifier, editor, examples (M5)**: `geometryNodes` modifier type and `nodeGroup` command (`./plugin`), editable
modifier fields in the editor's Properties > Modifiers (any modifier type, `modifierFields`), node group as code.
Examples: `procedural-terrain` (DSL), `procedural-editor` (editor + DSL group), `procedural-blend-asset` (a
bundle of any dumped .blend: evaluates, draws instances as `InstancedMesh2` per referenced mesh, live inputs;
bundles are local, see below). e2e: `tests/procedural.spec.ts`.

**Blockers / decisions for the maintainer**
- OpenSubdiv: Subdivide Mesh is exact on this branch's OSD port (`src/blender/opensubdiv/`, uniform refinement,
  TOST-1.0). The realism branch has a second, kernel-side OSD port whose adaptive patch evaluation (needed by
  Subdivision Surface) is still to come (S6b). Recommendation: one port in the kernel. Move this branch's evaluator
  stack there and add adaptive refinement to it. The GN Subdivision Surface node then calls it.
- Vertex groups (`procedural-vertex-groups.md`) and single-value attributes (`procedural-single-value-attribute-
  storage.md`): two kernel data-model additions that exact parity needs.
- Asset bundles are derived from third-party .blend files (Buildify, flower/pebble scatter, candy bounce): they
  stay out of git (`tmp/bundles`) until their licences and hosting are decided ([A6]); the flower bundle is 40 MB.
- Eigen (float4x4 interpolate / invert / determinant): licence decision in `procedural-eigen-port-licence.md`.

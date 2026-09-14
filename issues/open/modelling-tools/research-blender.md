# Blender mesh-editing architecture — research for a TypeScript port

Source: `/Users/palash/Projects/threepipe/.repos/blender` @ `e4e6c79a84` (2026-06-11), `BLENDER_VERSION 503` (5.3 alpha, `source/blender/blenkernel/BKE_blender_version.h:23`). The clone is a sparse, blob-less checkout (`source/blender`, `scripts/addons_core/io_scene_gltf2`); Python keymap/operator files were read with `git show HEAD:<path>` (fetched on demand).

All paths below are relative to `source/blender/` unless they start with `/` or `scripts/`. Line numbers are from this commit.

---

## 1. Mesh (DNA) vs BMesh

### 1.1 `Mesh` — struct-of-arrays, offset-indexed n-gons

`makesdna/DNA_mesh_types.h:144` `struct Mesh` (ID datablock). Topology is four counts plus one offsets array; everything else is a named attribute on one of four domains:

| Field (line) | Meaning |
|---|---|
| `verts_num / edges_num / faces_num / corners_num` (:165-171) | sizes of the Point / Edge / Face / Corner domains |
| `int *face_offset_indices` (:179) | `faces_num + 1` ints; face `i` owns corners `[off[i], off[i+1])`. Shared (implicit sharing) |
| `AttributeStorage attribute_storage` (:184) | generic attributes (5.x); `CustomData vert_data/edge_data/face_data/corner_data` (:187-190) still hold "non-generic" layers (deform verts, shape keys, multires, …) |
| `MSelect *mselect; int totselect` (:215-218) | selection **history** (ordered), `MSelect{int index; eMSelect_Type type}` — `DNA_meshdata_types.h:58`, types `ME_VSEL/ME_ESEL/ME_FSEL` |
| `int act_face` (:229) | active face index |
| `char *active_uv_map_attribute / default_uv_map_attribute` (:269-275) | UV maps are referenced by name |
| `bke::MeshRuntime *runtime` (:342) | caches: normals, bounds, loose verts/edges, BVH, `edit_mesh` (BMEditMesh), `wrapper_type`, `edit_data` (deformed cage positions) |

Accessors (all spans over attributes): `vert_positions()` (:347), `edges()` → `Span<int2>` (:356), `faces()`/`face_offsets()` → `OffsetIndices<int>` (:370), `corner_verts()` (:383), `corner_edges()` (:392).

**Built-in attribute names** (verified in `blenkernel/intern/mesh.cc:618-624` and `bmesh/intern/bmesh_mesh_convert.cc:118-140`):

| name | domain | type | notes |
|---|---|---|---|
| `position` | Point | Float3 | required |
| `.edge_verts` | Edge | Int32_2D | required; unordered vert pair |
| `.corner_vert` | Corner | Int32 | required |
| `.corner_edge` | Corner | Int32 | required; edge from `corner_vert[i]` to `corner_vert[next in face]` |
| `.select_vert / .select_edge / .select_poly` | Point/Edge/Face | Bool | edit selection (only written when any true, `bmesh_mesh_convert.cc:1746`) |
| `.hide_vert / .hide_edge / .hide_poly` | Point/Edge/Face | Bool | |
| `sharp_edge` | Edge | Bool | inverse of BMesh `BM_ELEM_SMOOTH` on edges |
| `sharp_face` | Face | Bool | inverse of `BM_ELEM_SMOOTH` on faces (flat shading) |
| `uv_seam` | Edge | Bool | BMesh `BM_ELEM_SEAM` |
| `material_index` | Face | Int32 | |
| `custom_normal` | Corner Int16_2D (fan-encoded, classic) **or** Point/Face/Corner Float3 (5.x "free normals") | see §7 |
| `crease_vert`, `crease_edge`, `bevel_weight_edge` | Point/Edge | Float | plain named float attributes (draw code reads them by name, `draw_cache_extract_mesh_render_data.cc:467-478`) |
| UV maps | Corner | Float2 | any name; `CD_PROP_FLOAT2` in BMesh `ldata` |
| `.uv_select_vert/.uv_select_edge/.uv_select_face` | Corner/Corner/Face | Bool | UV sync selection (5.x) |

`BKE_mesh_attribute_required(name)` (`mesh.cc:531`) = `position, .corner_vert, .corner_edge, .edge_verts`.

Enums: `AttrDomain {Point=0, Edge=1, Face=2, Corner=3, Curve=4, ...}` and `AttrType {Bool, Int8, Int16_2D, Int32, Int32_2D, Float, Float2, Float3, Float4x4, ColorByte, ColorFloat, Quaternion, String, Float4}` — `blenkernel/BKE_attribute_enums.hh:23-52`.

Cache invalidation is explicit: `Mesh::tag_positions_changed()`, `tag_sharpness_changed()`, `tag_custom_normals_changed()`, `tag_face_winding_changed()`, `tag_edges_split()`, `tag_topology_changed()`, `tag_visibility_changed()`, `tag_material_index_changed()` (`DNA_mesh_types.h:553-571`).

Derived data: `vert_normals()`, `face_normals()`, `corner_normals()`, `normals_domain()` (:505-539), `loose_edges()`, `loose_verts()`, `bvh_*()`, `corner_tris()` (tessellation) — lazily computed `SharedCache`s in `MeshRuntime`.

### 1.2 BMesh — pointer-linked, half-edge-like ("radial edge") structure

`bmesh/bmesh_class.hh`. Every element starts with `BMHeader` (:53): `void *data` (CustomData block), `int index` (lazy, see below), `char htype` (`BM_VERT=1, BM_EDGE=2, BM_LOOP=4, BM_FACE=8`, :443-446), `char hflag` (header flags), `char api_flag` (internal).

```
BMVert  (:94)  { head; float co[3]; float no[3]; BMEdge *e; }            // e = any edge in the disk cycle
BMEdge  (:124) { head; BMVert *v1,*v2; BMLoop *l;                        // l = any loop in the radial cycle
                 BMDiskLink v1_disk_link, v2_disk_link; }               // {next,prev} edge around v1 / around v2
BMLoop  (:158) { head; BMVert *v; BMEdge *e; BMFace *f;
                 BMLoop *radial_next,*radial_prev;                       // other loops (faces) using e
                 BMLoop *next,*prev; }                                   // loop cycle = face boundary, defines winding
BMFace  (:277) { head; BMLoop *l_first; int len; float no[3]; short mat_nr; }
BMesh   (:320) { totvert,totedge,totloop,totface; totvertsel,totedgesel,totfacesel;
                 char elem_index_dirty, elem_table_dirty;               // bitmask of BM_VERT|BM_EDGE|BM_FACE|BM_LOOP
                 BMVert **vtable; BMEdge **etable; BMFace **ftable;     // random-access tables (lazy)
                 bool use_toolflags; int toolflag_index; int totflags;  // operator flag layers (§2.2)
                 CustomData vdata, edata, ldata, pdata;                 // per-element attribute layout
                 MLoopNorSpaceArray *lnor_spacearr; char spacearr_dirty;
                 short selectmode; int shapenr;
                 ListBaseT<BMEditSelection> selected;                    // selection history
                 BMFace *act_face; ListBaseT<BMOpError> errorstack; }
```

Three cycles (all circular doubly-linked, no head):
- **Disk cycle** — edges around a vertex. Each edge stores two `BMDiskLink`s (one per endpoint); `bmesh_disk_edge_append` (`bmesh/intern/bmesh_structure.cc:139`), `bmesh_disk_edge_remove` (:164), `bmesh_disk_edge_exists(v1,v2)` (:186) = "does an edge between these verts exist" (walks v1's disk), `bmesh_disk_count` (:202).
- **Radial cycle** — loops (one per face) using an edge; `bmesh_radial_loop_append` (:377), `bmesh_radial_loop_remove` (:401), `bmesh_radial_length` (:468). Edge manifoldness = radial length (1 boundary, 2 manifold, >2 non-manifold).
- **Loop cycle** — loops of a face in winding order; `BM_FACE_FIRST_LOOP(f)` then `l->next`.

Header flags `hflag` (:527-554): `BM_ELEM_SELECT(1), BM_ELEM_HIDDEN(2), BM_ELEM_SEAM(4), BM_ELEM_SMOOTH(8), BM_ELEM_TAG(16), BM_ELEM_SELECT_UV(32), BM_ELEM_TAG_ALT(64), BM_ELEM_INTERNAL_TAG(128)`. Tool/operator flags are **not** in the header: they live in `BMFlagLayer` arrays (`BMVert_OFlag{BMVert base; BMFlagLayer *oflags}` :111) allocated only when `use_toolflags`, one layer per nested operator (§2.2).

CustomData access is by byte offset into `head.data`: `BM_ELEM_CD_GET_FLOAT2_P(l, cd_uv_offset)` etc. (:571-689). Offsets are obtained once per operation with `CustomData_get_offset(&bm->ldata, CD_PROP_FLOAT2)`.

Indices: `head.index` is only valid when the matching bit in `bm->elem_index_dirty` is clear; `BM_mesh_elem_index_ensure(bm, htype)` (`bmesh/intern/bmesh_mesh.cc:453`) renumbers in pool order. `BM_mesh_elem_table_ensure(bm, htype)` (:565) builds `vtable/etable/ftable` for `BM_vert_at_index`. Creating any element sets both dirty bits (`bmesh_core.cc:181-182`). `BM_mesh_remap` (:736) physically reorders (used by `bmesh.ops`/`sort`).

Kernel ("Euler") operators, `bmesh/intern/bmesh_core.cc` (documented in `bmesh_core.hh`):
- `BM_vert_create(bm, co, v_example, flag)` :141, `BM_edge_create(bm, v1, v2, e_example, flag)` :224 (with `BM_CREATE_NO_DOUBLE` returns the existing edge), `BM_face_create(bm, verts[], edges[], len, f_example, flag)` :527 (creates loops, appends each to its edge's radial cycle, links loop cycle), `BM_face_create_verts` :596 (creates missing edges).
- `BM_vert_kill` :1079 (kills all edges/faces using it), `BM_edge_kill` :1067, `BM_face_kill` :968, `BM_face_kill_loose` :1012.
- `bmesh_kernel_split_face_make_edge` (SFME) :1507 — new edge between two loops of one face → two faces; `bmesh_kernel_split_edge_make_vert` (SEMV) :1646 — insert vertex in edge, splitting all radial loops; `bmesh_kernel_join_edge_kill_vert` (JEKV) :1799 — inverse of SEMV (valence-2 vertex); `bmesh_kernel_join_vert_kill_edge` (JVKE) :1966 — edge collapse merging surrounding data; `bmesh_kernel_join_face_kill_edge` (JFKE) :2049 — dissolve edge between two faces; `bmesh_kernel_unglue_region_make_vert` (URMV) :2746 — rip a vertex from a face region; `BM_faces_join` :1263 — merge n faces into an n-gon (returns `r_double` if a duplicate face would result); `BM_vert_splice` :2395 — merge two verts; `BM_vert_separate` :2583; `BM_edge_splice` :2678; `bmesh_kernel_loop_reverse` :1105 (flip face).
- Higher-level mods in `bmesh_mods.cc` (906 lines): `BM_vert_dissolve` :22, `BM_disk_dissolve` :53, `BM_vert_collapse_faces`, `BM_vert_collapse_edge`, `BM_edge_split`, `BM_face_split`, `BM_face_split_n`, `BM_edge_rotate` (+ `_check`, `_check_degenerate` :670, `_check_beauty` :758), `BM_edge_verts_swap` :601.

Iterators (`bmesh/intern/bmesh_iterators.hh:38-58`): `BM_VERTS_OF_MESH, BM_EDGES_OF_MESH, BM_FACES_OF_MESH, BM_EDGES_OF_VERT, BM_FACES_OF_VERT, BM_LOOPS_OF_VERT, BM_VERTS_OF_EDGE, BM_FACES_OF_EDGE, BM_VERTS_OF_FACE, BM_EDGES_OF_FACE, BM_LOOPS_OF_FACE, BM_LOOPS_OF_LOOP, BM_LOOPS_OF_EDGE`; macros `BM_ITER_MESH`, `BM_ITER_ELEM`, `BM_ITER_MESH_MUTABLE`.

Queries (`bmesh_query.cc`, 2505 lines): `BM_edge_exists`, `BM_face_exists`, `BM_vert_edge_count` :619, `BM_edge_face_count` :641, `BM_vert_is_manifold` :717, `BM_vert_is_boundary` :930, `BM_vert_is_wire` :700, `BM_edge_is_manifold/boundary/wire` (inline), `BM_edge_face_pair` :550, `BM_edge_calc_face_angle` :1352, `BM_loop_calc_face_normal` :1284, `BM_loop_calc_face_tangent` :1313, `BM_vert_calc_shell_factor` :1435, `BM_mesh_calc_face_groups` :2111, `BM_mesh_calc_edge_groups` :2267, `BM_mesh_calc_volume` :2093. Polygon math in `bmesh_polygon.cc` (1528): `BM_face_calc_normal` :824 (tri/quad fast paths, Newell for n-gons), `BM_face_calc_area` :213, `BM_face_calc_center_median` :654, `BM_face_calc_center_bounds` :617, `BM_face_calc_tangent_*` :389-590, `BM_face_triangulate` :1103, `BM_face_splits_check_legal` :1335, `BM_face_normal_flip` :1075.

Attribute interpolation (`bmesh_interp.cc`, 1333): `BM_data_interp_from_verts` :75, `BM_data_interp_from_edges` :85, `BM_face_interp_from_face` :176, `BM_loop_interp_from_face` :694, `BM_vert_interp_from_face` :750, `BM_data_layer_add_named` :867, `BM_elem_attrs_copy` (`bmesh_construct.cc:333-389`). These are what keep UVs/colors/weights correct through every topological op.

### 1.3 Conversion `Mesh ⇄ BMesh`

`bmesh/intern/bmesh_mesh_convert.cc`.

`BM_mesh_bm_from_me(bm, mesh, params)` :311 (params `BMeshFromMeshParams{calc_face_normal, calc_vert_normal, add_key_index, use_shapekey, active_shapekey, cd_mask_extra}` `bmesh_mesh_convert.hh:27`):
1. Build per-domain CustomData layouts from Mesh attributes (`get_mesh_to_bm_custom_data`, :281), excluding the "stored in BMesh built-in" names (`BM_attribute_stored_in_bmesh_builtin`, :118 — the flag/topology attributes in the table above).
2. Verts (:534-568): `BM_vert_create` per position, `BM_elem_index_set(v, i)`, `.hide_vert`→`BM_ELEM_HIDDEN`, `.select_vert`→`BM_vert_select_set`, copy custom data block, shape keys into `CD_SHAPEKEY` layers; clears `elem_index_dirty & BM_VERT`.
3. Edges (:571-595): `BM_edge_create(vtable[e[0]], vtable[e[1]])`; `uv_seam`→SEAM, hide, select, `!sharp_edge`→`BM_ELEM_SMOOTH`.
4. Faces (:599-681): `bm_face_create_from_mpoly(corner_verts.slice(face), corner_edges.slice(face))` (:141); `!sharp_face`→SMOOTH; hide; select; `i == act_face`→`bm->act_face`; loop indices set sequentially; optional face normal calc.
5. Selection history from `mselect` (:692-719) via `BM_select_history_store_notest`.

`BM_mesh_bm_to_me(bmain, bm, mesh, params)` :1650 (params `BMeshToMeshParams{calc_object_remap, update_shapekey_indices, active_shapekey_to_mvert, cd_mask_extra}` `.hh:51`):
1. `BKE_mesh_clear_geometry`, set counts from `bm->tot*`.
2. In parallel build `vert_table/edge_table/face_table/loop_table` (:1684-1710) while detecting whether any select/hide/sharp/seam/material attribute is needed (`need_select_vert` … so all-false layers are not written).
3. Allocate those bool/int attributes only when needed (:1746-1790).
4. In parallel write positions, edges (`int2`), face offsets + material index + sharp_face, loops (`.corner_vert/.corner_edge`), custom data blocks → arrays (:1809-1860); `act_face` from `bm->act_face` index; `mselect` from `bm->selected` (:1867-1887).

Fast path for evaluation: `BM_mesh_bm_to_me_for_eval` :2175 → `BM_mesh_bm_to_me_compact(bm, mesh, mask, /*need_select*/ true)` :1928, used by `BKE_mesh_from_bmesh_for_eval_nomain` (`blenkernel/intern/mesh.cc:1590`) and the mesh wrapper (§9).

Mode switching (`editors/mesh/editmesh_utils.cc`): `EDBM_mesh_make_from_mesh` :299 (enter edit mode: `BKE_mesh_to_bmesh` with `use_toolflags = true`, wrap in `BMEditMesh`, `EDBM_selectmode_flush`); `EDBM_mesh_load_ex` :330 (exit: `BM_mesh_bm_to_me` with `calc_object_remap = true`).

### 1.4 `BMEditMesh` and looptris

`blenkernel/BKE_editmesh.hh:27`:
```
struct BMEditMesh { BMesh *bm; Array<std::array<BMLoop*,3>> looptris; short selectmode; short mat_nr;
                    int mirror_cdlayer; char needs_flush_to_id; };
```
`selectmode` is a bitmask of `SCE_SELECT_VERTEX=1, SCE_SELECT_EDGE=2, SCE_SELECT_FACE=4` (`makesdna/DNA_scene_types.h:1987-1989`).

`BKE_editmesh_looptris_calc(em)` → `BM_mesh_calc_tessellation` (`bmesh/intern/bmesh_mesh_tessellate.cc:268`), per face `bmesh_calc_tessellation_for_face_impl` (:40-135): tri → itself; quad → `(0,1,2),(0,2,3)` flipped to `(0,1,3),(1,2,3)` if `is_quad_flip_v3_first_third_fast` (concave/degenerate); n-gon → project to the dominant axis plane of `f->no` (`axis_dominant_v3_to_m3_negate`) and ear-clip with `BLI_polyfill_calc_arena` (`blenlib/intern/polyfill_2d.cc`). Threaded above `BM_FACE_TESSELLATE_THREADED_LIMIT`. The looptris array has `sum(len-2)` entries; face `i`'s tris start at `loop_index(l_first) - 2*face_index` (partial-update trick, :325-353). Partial variants `BKE_editmesh_looptris_calc_with_partial` + `BKE_editmesh_looptris_and_normals_calc_with_partial` (used by transform).

### 1.5 Drawing the edit mesh (brief)

`draw/intern/draw_cache_extract_mesh_render_data.cc:409` `mesh_render_data_create(...)`. In edit mode `MeshRenderData` (`draw/intern/mesh_extractors/extract_mesh.hh:50-125`) points at `bm`, `edit_bmesh`, the active vert/edge/face, CustomData offsets for crease/bweight/freestyle, and chooses `MeshExtractType::BMesh` (extract straight from BMesh, no modifiers) or `::Mesh` (evaluated cage/final Mesh + `CD_ORIGINDEX` maps back to BMesh elements for flags) (:480-501).

All VBOs are **corner-indexed** (`corners_num` entries, then `2*loose_edges`, then `loose_verts`). Extractors (`draw/intern/mesh_extractors/`, 31 files, 6.6k lines): `extract_mesh_vbo_pos.cc` (`Position`), `_vbo_vnor.cc` (`VertexNormal`, packed SNORM_10_10_10_2), `_vbo_lnor.cc` (`CornerNormal`, by `normals_domain`), `_vbo_edit_data.cc` (`EditData` = `EditLoopData{uchar v_flag, e_flag, crease, bweight}` :216), `_vbo_fdots_pos/nor.cc` (face-dot position/normal), `_vbo_select_idx.cc` (`IndexVert/IndexEdge/IndexFace/IndexFaceDot`, uint32 element ids for GPU picking), `_vbo_edge_fac.cc`, `_vbo_uv.cc`, `_vbo_weights.cc`, `_vbo_attributes.cc`; IBOs `_ibo_tris.cc` (from looptris), `_ibo_lines.cc` (+loose), `_ibo_points.cc`, `_ibo_fdots.cc`.

Flag bits (`draw/intern/draw_cache_impl.hh:292-316`): `e_flag`: `VFLAG_VERT_ACTIVE=1, VFLAG_VERT_SELECTED=2, VFLAG_EDGE_ACTIVE=8, VFLAG_EDGE_SELECTED=16, VFLAG_EDGE_SEAM=32, VFLAG_EDGE_SHARP=64, VFLAG_EDGE_FREESTYLE=128`; `v_flag`: `VFLAG_FACE_ACTIVE=1, VFLAG_FACE_SELECTED=2, VFLAG_FACE_FREESTYLE=4, VFLAG_VERT_UV_SELECT=8, VFLAG_VERT_UV_PINNED=16, VFLAG_EDGE_UV_SELECT=32, VFLAG_FACE_UV_ACTIVE=64, VFLAG_FACE_UV_SELECT=128`. Producers: `mesh_render_data_edge_flag` (`extract_mesh_vbo_edit_data.cc:19`, note: in vertex select mode an edge is drawn selected only when both verts are), `mesh_render_data_vert_flag` :82, `mesh_render_data_face_flag` (`extract_mesh.cc:25`). Batches (`draw_cache_impl_mesh.cc:1399-1533`): `edit_triangles` (Tris: Position+EditData), `edit_vertices` (Points), `edit_edges` (Lines: CornerNormal+Position+EditData), `edit_vnor`, `edit_lnor`, `edit_fdots`, `edit_selection_{verts,edges,faces,fdots}`.

### 1.6 Recommendation for TypeScript

How Blender itself splits the work:
- **Mesh (SoA)** is the storage, file, undo, modifier, geometry-nodes, and draw format. Every non-edit-mode algorithm added since ~2.9 (`geometry/GEO_*.hh`, `nodes/geometry/nodes/node_geo_extrude_mesh.cc`, `mesh_merge_verts.cc`, `mesh_bevel.cc` SoA port) is written on arrays.
- **BMesh** is the edit-mode working copy: every interactive operator (`bmo_*`, `editmesh_*`, transform, knife, undo restore) runs on it, because insert/delete/split with per-element attribute interpolation is O(1) per element and adjacency (disk/radial cycles) is always up to date.
- The two are bridged only at mode switch, undo push/pop, and evaluation (`BKE_mesh_wrapper_ensure_mdata` flattens BMesh → Mesh on demand, §9). Blender pays a full `bm_to_me` per undo step and per evaluated frame while editing, and accepts it.

**Recommendation: hybrid — SoA `Mesh`-shaped arrays as the canonical/serialized representation, plus a BMesh-shaped topology object that is the only thing operators touch.** Concretely:

1. `EditableMesh` (SoA, Node-safe, JSON/glTF-extras friendly): typed arrays exactly mirroring Blender Mesh — `positions: Float32Array(3n)`, `edgeVerts: Int32Array(2e)`, `cornerVerts: Int32Array(c)`, `cornerEdges: Int32Array(c)`, `faceOffsets: Int32Array(f+1)`, plus a generic attribute table `{name, domain, type, data}` with the same built-in names (`.select_vert`, `sharp_edge`, `material_index`, `custom_normal`, UV maps …). This is a 1:1 image of what the blend importer already reads and of what `bm_to_me` writes, so `bm_from_me/bm_to_me` port directly. It is also the natural input for a modifier stack and for building `BufferGeometry` (positions gathered by corner, index from a tessellation — the same corner-indexed layout the draw extractors use).
2. `BMesh` (pointer/handle-linked): port the four element classes and the three cycles literally. In TS use classes with object references (a `BMLoop` is 8 references; V8 handles millions fine), keep `head.index` + dirty bits + lazy `vtable/etable/ftable` so that `bm.verts.at(i)` and index-based buffers work. Do **not** try to run Blender's operators on SoA arrays: `bmo_extrude/inset/bevel/dissolve/subdivide/knife` are written against `l->radial_next`, `v->e`, `BM_faces_join`, `BM_face_split`, `BM_data_interp_*`; re-deriving them on offsets arrays means re-deriving Blender (the geometry-nodes extrude in `node_geo_extrude_mesh.cc` is 1.5k lines for one op and lacks attribute interpolation across new faces).
3. Lifecycle identical to Blender: enter edit → `bmFromMesh`; every operator mutates the BMesh; after each operator/tool commit → `bmToMesh` into the SoA object (this is the undo snapshot and the render source); render buffers are rebuilt from the SoA arrays + looptris. For interactive drags (transform, modal inset/bevel preview) rebuild only positions/normals from BMesh directly (partial update, like `BM_mesh_normals_update_with_partial`), not the full SoA.
4. Undo = SoA snapshots with chunk dedup (§6) — no need to make BMesh itself undoable.

A lazily-built adjacency on SoA (vert→faces map etc.) is what Blender's `geometry/` module uses, and is fine for read-only queries and simple SoA ops (merge by distance, split edges, normals), but not for the interactive operator set. Keep both.

---

## 2. BMesh operators (bmo) — the kernel API

### 2.1 Slot system

`bmesh/intern/bmesh_operator_api.hh`. Design notes (:10-53): operators are "logical, executable mesh modules"; all topological operations go through them; they nest; each has input/output **slots**; operators must not read header flags directly — callers put selected elements into slots.

```
enum eBMOpSlotType (:186)  BOOL=1, INT=2, FLT=3, PTR=4, MAT=5, VEC=8, ELEMENT_BUF=9, MAPPING=10
subtypes (:208-234)        ELEM: VERT|EDGE|FACE bitmask (+ ELEM_IS_SINGLE = single element, not a buffer)
                           MAP:  EMPTY (a set), ELEM, FLT, INT, BOOL, INTERNAL
                           PTR:  BMESH, SCENE, OBJECT, MESH, STRUCT
                           INT:  ENUM (string-named), FLAG (bitset)
struct BMOpSlot (:252)     { const char *slot_name; type; subtype; int len; union { int i; float f; void *p; float vec[3]; void **buf; GHash *ghash; {int _i; BMO_FlagSet *flags} enum_data } data; }
struct BMOpDefine (:328)   { opname; BMOSlotType slot_types_in[21]; slot_types_out[21]; init(op); exec(bm, op); BMOpTypeFlag type_flag; }
struct BMOperator (:303)   { slots_in[21]; slots_out[21]; exec; MemArena *arena; int type; type_flag; int flag /* BMO_FLAG_RESPECT_HIDE */; }
BMOpTypeFlag (:292)        UNTAN_MULTIRES, NORMALS_CALC, SELECT_FLUSH, SELECT_VALIDATE, INVALIDATE_CLNOR_ALL
BMO_OP_MAX_SLOTS 21 (:289)
```

Slot-name conventions (`bmesh_opdefines.cc:14-36`): inputs `verts`/`edges`/`faces`/`geom` (mixed); outputs `<type>.out` / `geom.out`; maps `*.out` with `map` in the name.

Filling/reading slots (`bmesh_operators.cc`): `BMO_slot_buffer_from_enabled_hflag(bm, op, slots, name, htype, hflag)` :871 (e.g. all selected faces), `_from_enabled_flag` :1039 (from an operator flag layer), `BMO_slot_buffer_from_single` :891, `BMO_slot_buffer_from_array` :906, `BMO_slot_buffer_from_all` :742; `BMO_slot_buffer_hflag_enable/disable` :1059/1093 (e.g. select everything in `faces.out`), `BMO_slot_buffer_flag_enable` :1126 (tag with oflag); `BMO_slot_map_insert` :646; scalar get/set :312-491; `BMO_slot_copy(op_src, slots_src, name, op_dst, slots_dst, name)` :503 (chain slot → slot); `BMO_ITER(ele, &iter, op->slots_in, "faces", BM_FACE)` iteration.

Format-string entry point (`:400-462` doc): `BMO_op_callf(bm, BMO_FLAG_DEFAULTS, "delete geom=%hv context=%i", BM_ELEM_SELECT, DEL_ONLYFACES)`. Codes: `%b %i %f %p %m3 %m4 %v` scalars; `%s/%S` copy a slot in/out of another op; `%e` single elem, `%eb` array; `%av/ae/af` all; `%hv/he/hf` header-flagged (`%Hv` = flag off); `%fv/fe/ff` oflag-flagged (`%Fv` = off); suffixes combine (`%hvef`). Parser: `BMO_op_vinitf` :1608.

### 2.2 Execution and flag layers

```
BMO_op_init(bm, op, flag, opname)   :133   look up bmo_opdefines[opcode], zero slots, alloc arena, run init()
BMO_op_exec(bm, op)                 :168   BM_mesh_elem_toolflags_ensure; BMO_push (toolflag_index++, alloc a new BMFlagLayer per element :1183)
                                           if toolflag_index==1: bmesh_edit_begin(bm, type_flag)
                                           op->exec(bm, op)
                                           if toolflag_index==1: bmesh_edit_end(bm, type_flag)   // NORMALS_CALC → BM_mesh_normals_update,
                                                                                                   // SELECT_VALIDATE → BM_select_history_validate,
                                                                                                   // SELECT_FLUSH → BM_mesh_select_mode_flush
                                           BMO_pop (free the layer, toolflag_index--)
BMO_op_finish(bm, op)               :187   free slots + arena
```
Because each nested op gets its own flag layer, an operator can freely `BMO_elem_flag_enable(bm, e, EXT_DEL)` on private bits (`BMO_elem_flag_*` :72-89 index `oflags[bm->toolflag_index]`) without clobbering the caller's flags. Errors: `BMO_error_raise(bm, op, level, msg)` :1475 with `BMO_ERROR_CANCEL / WARN / FATAL` (`bmesh_error.hh:22`); the UI layer pops them (`EDBM_op_finish`).

Deletion is itself an op with a **context**: `delete geom=… context=DEL_VERTS|DEL_EDGES|DEL_ONLYFACES|DEL_EDGESFACES|DEL_FACES|DEL_FACES_KEEP_BOUNDARY|DEL_ONLYTAGGED` (`bmesh_operator_api.hh:523-531`, impl `bmesh_delete.cc:274 BM_mesh_delete_hflag_context`) — this is what "Delete → Vertices/Edges/Faces/Only faces…" maps to.

### 2.3 Composition example — `extrude_face_region` (`bmesh/operators/bmo_extrude.cc:319-640`)

```
flag input edges+faces EXT_INPUT
if !use_keep_orig: for each EXT_INPUT edge: if it has a non-input face neighbour → delorig=true;
                   if it has >1 input faces and no non-input face → EXT_DEL (interior edge)
                   verts whose every edge is input&EXT_DEL and every face is input → EXT_DEL
                   all input faces → EXT_DEL
dupeop = BMO_op_initf("duplicate use_select_history=%b");  BMO_slot_copy(op,"geom" → dupeop,"geom");  BMO_op_exec(dupeop)
   (bmo_dupe.cc: copies verts/edges/faces with attrs; outputs geom.out, vert_map/edge_map/face_map,
    boundary_map.out = original boundary edge → duplicated edge, isovert_map.out = isolated vert → dup)
act_face = face_map[act_face]
if delorig: BMO_op_exec("delete geom=%fvef context=DEL_ONLYTAGGED", EXT_DEL)   // remove interior originals
else if !skip_input_flip: flip every input face (kept originals face inward)
for (e, e_new) in boundary_map:
    if e in edges_exclude: (kill wire edge) continue
    decide winding from e_new->l (or e->l), honour use_normal_flip / use_normal_from_adjacent
    f = BM_face_create_verts([e.v1, e.v2, e_new.v2, e_new.v1]) (or with explicit edges reusing hflags of neighbours)
    bm_extrude_copy_face_loop_attributes(f)     // UV/colour from adjacent loops
    if use_dissolve_ortho_edges && e is boundary && adjacent face is coplanar with average normal: JFKE join
for (v, v2) in isovert_map: BM_edge_create(v, v2)      // extrude wire/isolated verts
copy dupeop.geom.out → op.geom.out;  finish sub-ops
```
Same pattern everywhere: `spin` = repeated `extrude_face_region`/`duplicate` + `rotate` (`bmo_dupe.cc`), `solidify` = `reverse_faces` + `extrude_face_region use_keep_orig=1` (`bmo_extrude.cc:836`), `create_uvsphere` = circle of edges + `extrude_edge_only` × segments + `rotate` + `remove_doubles` (`bmo_primitive.cc:845`), `create_icosphere` = 20 tris + `subdivide_edges use_sphere=1` (:965), `create_cone` caps = tri fans + `dissolve_faces` unless `cap_tris` (:1363).

### 2.4 Operator table (`bmesh/intern/bmesh_opdefines.cc`, 83 operators)

Format: `name(in…) → out… — description [impl file]`. Element-buffer slots accept the listed htypes; `geom` = verts|edges|faces.

**Transform / smooth / shape (`bmo_utils.cc` 772, `bmo_smooth_laplacian.cc` 500, `bmo_circularize.cc` 747, `bmo_flatten.cc` 128, `bmo_planar_faces.cc` 134, `bmo_space_edge_loops_evenly.cc` 415)**
- `smooth_vert(verts, factor, mirror_clip_x/y/z, clip_dist, use_axis_x/y/z)` — vertex smooth (average of neighbours).
- `smooth_laplacian_vert(verts, lambda_factor, lambda_border, use_x/y/z, preserve_volume)`.
- `translate(vec, space, verts, use_shapekey)`, `scale(vec, space, verts, use_shapekey)`, `rotate(cent, matrix, verts, space, use_shapekey)`, `transform(matrix, space, verts, use_shapekey)`.
- `planar_faces(faces, iterations, factor) → geom.out` — make faces planar.
- `circularize(geom, factor, custom_radius, angle, fit_method, flatten, regular, lock_x/y/z, mirror_x/y/z)` (5.x); `flatten(geom, factor, method, view_normal, lock_x/y/z)` (5.x); `space_edge_loops_evenly(geom[edges], interpolation, factor, lock_x/y/z)` (5.x).
- `create_vert(co) → vert.out`.

**Normals / winding (`bmo_normals.cc` 303, `bmo_utils.cc`)**
- `recalc_face_normals(faces)` — make consistent (outside). `reverse_faces(faces, flip_multires)`. `flip_quad_tessellation(faces)`.
- `rotate_uvs(faces, use_ccw)`, `reverse_uvs(faces)`, `rotate_colors(faces, use_ccw, color_index)`, `reverse_colors(faces, color_index)`.

**Selection-ish**
- `region_extend(geom, use_contract, use_faces, use_face_step) → geom.out` — select more/less core.

**Edges (`bmo_rotate_edges.cc` 271, `bmo_split_edges.cc` 36, `bmo_subdivide.cc` 1447, `bmo_subdivide_edgering.cc` 1255, `bmo_unsubdivide.cc` 47, `bmo_offset_edgeloops.cc` 271)**
- `rotate_edges(edges, use_ccw) → edges.out`.
- `split_edges(edges, verts, use_verts) → edges.out` — rip/edge split (disconnect faces along edges).
- `bisect_edges(edges, cuts, edge_percents{map edge→float}) → geom_split.out` — cut edges without face fill.
- `subdivide_edges(edges, smooth, smooth_falloff, fractal, along_normal, cuts, seed, custom_patterns, edge_percents, quad_corner_type, use_grid_fill, use_single_edge, use_only_quads, use_sphere, use_smooth_even) → geom_inner.out, geom_split.out, geom.out` — the general subdivide **and** the loop-cut backend (`use_only_quads`).
- `subdivide_edgering(edges, interp_mode, smooth, cuts, profile_shape, profile_shape_factor) → faces.out`.
- `unsubdivide(verts, iterations)`.
- `offset_edgeloops(edges, use_cap_endpoint) → edges.out`.
- `collapse(edges, uvs)`, `collapse_uvs(edges)`.

**Vertices / merging (`bmo_removedoubles.cc` 930)**
- `find_doubles(verts, keep_verts, use_connected, dist) → targetmap.out{vert→vert}`; `remove_doubles(verts, use_connected, dist)`; `weld_verts(targetmap, use_centroid, average_vert_data)`; `pointmerge(verts, merge_co, vert_target)`; `pointmerge_facedata(verts, vert_target)`; `average_vert_facedata(verts)`.

**Connect / fill / create (`bmo_connect*.cc` 220/214/174/745, `bmo_create.cc` 299, `bmo_bridge.cc` 668, `bmo_fill_*.cc`, `bmo_edgenet.cc` 239, `bmo_triangulate.cc` 295, `bmo_join_triangles.cc` 1149, `bmo_beautify.cc` 73, `bmo_hull.cc` 606)**
- `connect_verts(verts, faces_exclude, check_degenerate) → edges.out` (J with two verts on a face); `connect_vert_pair(verts, verts_exclude, faces_exclude) → edges.out` (vert connect path across faces); `connect_verts_concave(faces) → edges.out, faces.out`; `connect_verts_nonplanar(angle_limit, faces) → edges.out, faces.out`.
- `contextual_create(geom, mat_nr, use_smooth) → faces.out, edges.out` — the **F** key: edge from 2 verts, face from loop, n-gon, edge-net.
- `bridge_loops(edges, use_pairs, use_cyclic, use_merge, merge_factor, twist_offset) → faces.out, edges.out`.
- `grid_fill(edges, mat_nr, use_smooth, use_interp_simple) → faces.out`; `holes_fill(edges, sides) → faces.out`; `edgeloop_fill(edges, mat_nr, use_smooth) → faces.out`; `edgenet_fill(edges, mat_nr, use_smooth, sides) → faces.out`; `edgenet_prepare(edges) → edges.out`; `face_attribute_fill(faces, use_normals, use_data) → faces_fail.out`.
- `triangle_fill(use_beauty, use_dissolve, edges, normal) → geom.out`; `triangulate(faces, quad_method, ngon_method) → edges.out, faces.out, face_map.out, face_map_double.out`; `join_triangles(faces, cmp_seam, cmp_sharp, cmp_uvs, cmp_vcols, cmp_materials, angle_face_threshold, angle_shape_threshold, topology_influence, deselect_joined, merge_limit, neighbor_debug) → faces.out`; `beautify_fill(faces, edges, use_restrict_tag, method) → geom.out`.
- `convex_hull(input, use_existing_faces) → geom.out, geom_interior.out, geom_unused.out, geom_holes.out`.

**Extrude / duplicate / delete (`bmo_extrude.cc` 866, `bmo_dupe.cc` 747)**
- `extrude_face_region(geom, edges_exclude{set}, use_keep_orig, use_normal_flip, use_normal_from_adjacent, use_dissolve_ortho_edges, use_select_history, skip_input_flip) → geom.out`.
- `extrude_discrete_faces(faces, use_normal_flip, use_select_history) → faces.out`; `extrude_edge_only(edges, use_normal_flip, use_select_history) → geom.out`; `extrude_vert_indiv(verts, use_select_history) → edges.out, verts.out`.
- `duplicate(geom, dest, use_select_history, use_edge_flip_from_face) → geom_orig.out, geom.out, vert_map.out, edge_map.out, face_map.out, boundary_map.out, isovert_map.out`; `split(geom, dest, use_only_faces) → geom.out, boundary_map.out, isovert_map.out` (Y key); `spin(geom, cent, axis, dvec, angle, space, steps, use_merge, use_normal_flip, use_duplicate) → geom_last.out`.
- `delete(geom, context)`.
- `solidify(geom, thickness) → geom.out`.

**Dissolve (`bmo_dissolve.cc` 969)**
- `dissolve_verts(verts, use_face_split, use_boundary_tear)`; `dissolve_edges(edges, use_verts, use_face_split, angle_threshold, use_preserve_quads) → region.out`; `dissolve_faces(faces, use_verts) → region.out`; `dissolve_limit(angle_limit, use_dissolve_boundaries, verts, edges, delimit) → region.out`; `dissolve_degenerate(dist, edges)`.

**Inset / bevel / poke / wireframe (`bmo_inset.cc` 1372, `bmo_bevel.cc` 96 → `bmesh/tools/bmesh_bevel.cc` 8485, `bmo_poke.cc` 135, `bmo_wireframe.cc` 55 → `tools/bmesh_wireframe.cc` 590)**
- `inset_individual(faces, thickness, depth, use_even_offset, use_interpolate, use_relative_offset) → faces.out`; `inset_region(faces, faces_exclude, use_boundary, use_even_offset, use_interpolate, use_relative_offset, use_edge_rail, thickness, depth, use_outset) → faces.out`.
- `bevel(geom, offset, offset_type, profile_type, segments, profile, affect, clamp_overlap, material, loop_slide, mark_seam, mark_sharp, harden_normals, face_strength_mode, miter_outer, miter_inner, spread, custom_profile, vmesh_method) → faces.out, edges.out, verts.out`.
- `poke(faces, offset, center_mode, use_relative_offset) → verts.out, faces.out`; `wireframe(faces, thickness, offset, use_replace, use_boundary, use_even_offset, use_crease, crease_weight, use_relative_offset, material_offset) → faces.out`.

**Cut / mirror / symmetry (`bmo_bisect_plane.cc` 98 → `tools/bmesh_bisect_plane.cc` 544, `bmo_mirror.cc` 110, `bmo_symmetrize.cc` 104)**
- `bisect_plane(geom, dist, plane_co, plane_no, use_snap_center, clear_outer, clear_inner) → geom_cut.out, geom.out`; `mirror(geom, matrix, merge_dist, axis, mirror_u, mirror_v, mirror_udim, use_shapekey) → geom.out`; `symmetrize(input, direction, dist, use_shapekey) → geom.out`.

**Primitives (`bmo_primitive.cc` 1736)** — `create_grid(x_segments, y_segments, size, matrix, calc_uvs)`, `create_uvsphere(u_segments, v_segments, radius, matrix, calc_uvs)`, `create_icosphere(subdivisions, radius, matrix, calc_uvs)`, `create_monkey(matrix, calc_uvs)`, `create_cone(cap_ends, cap_tris, segments, radius1, radius2, depth, matrix, calc_uvs)`, `create_circle(cap_ends, cap_tris, segments, radius, matrix, calc_uvs)`, `create_cube(size, matrix, calc_uvs)` — all `→ verts.out`. (§10)

**Glue (`bmo_mesh_convert.cc`)** — `object_load_bmesh(scene, object)`, `bmesh_to_mesh(mesh, object)`, `mesh_to_bmesh(mesh, object, use_shapekey)`.

Shared algorithm libraries in `bmesh/tools/` (20.2k lines) used by both bmo ops and modifiers: `bmesh_bevel.cc` 8485, `bmesh_intersect.cc` 1670 (knife-project / boolean core), `bmesh_decimate_collapse.cc` 1549, `bmesh_region_match.cc` 1462, `bmesh_intersect_edges.cc` 1057 (auto-merge & split), `bmesh_path.cc` 596 + `bmesh_path_region.cc` 482 (shortest path / region), `bmesh_wireframe.cc` 590, `bmesh_decimate_dissolve.cc` 578, `bmesh_bisect_plane.cc` 544, `bmesh_boolean.cc` 496, `bmesh_edgenet.cc` 482, `bmesh_beautify.cc` 399, `bmesh_decimate_unsubdivide.cc` 305, `bmesh_triangulate.cc` 159, `bmesh_edgesplit.cc` 120, `bmesh_separate.cc` 110.

---

## 3. Edit-mesh (window-manager) operators

### 3.1 The wrapper layer — `editors/mesh/editmesh_utils.cc`

```
EDBM_op_init(em, &bmop, op, fmt, ...)   :101  BMO_op_vinitf with BMO_FLAG_DEFAULTS; parse error → report
EDBM_op_finish(em, &bmop, op, do_report):119  BMO_op_finish; pop BMO errors → RPT_INFO/WARNING/ERROR; returns "changed"
EDBM_op_callf(em, op, fmt, ...)         :182  init + exec + finish in one call
EDBM_op_call_and_selectf(...)           :233  same, then select the named output slot
EDBM_op_call_silentf                    :247  no reports
EDBM_update(mesh, EDBMUpdate_Params{calc_looptris, calc_normals, is_destructive}) :1776
     DEG tag + notifier; looptris and/or normals recompute (fused when both); clnor spaces invalidated if BMO_SET
EDBM_redo_state_store / _restore / _restore_and_free / _free   :56-93   = full BM_mesh_copy backup (BMBackup{BMesh *bmcopy}, ED_mesh.hh:562)
EDBM_selectmode_flush / EDBM_select_more / EDBM_select_less / EDBM_flag_disable_all   :385-461
EDBM_mesh_normals_update                :1740
EDBM_verts_mirror_cache_begin/apply/end :1315-1519  (X-mirror editing)
EDBM_mesh_hide / EDBM_mesh_reveal       :1545/1618
EDBM_automerge / EDBM_automerge_and_split (editmesh_automerge.cc)
```

### 3.2 `wmOperatorType` (`windowmanager/WM_types.hh:1085-1199`)

`name, idname ("MESH_OT_inset"), description, undo_group; exec(C, op); check(C, op); invoke(C, op, event); cancel(C, op); modal(C, op, event); poll(C); poll_property; ui(C, op) /* redo panel layout */; get_name; get_description; depends_on_cursor; StructRNA *srna /* properties */; ListBaseT<wmOperatorTypeMacro> macro; flag`. Flags (:184-224): `OPTYPE_REGISTER` (appears in redo/last-operator), `OPTYPE_UNDO`, `OPTYPE_BLOCKING`, `OPTYPE_MACRO`, `OPTYPE_GRAB_CURSOR_XY`, `OPTYPE_PRESET`, `OPTYPE_INTERNAL`, `OPTYPE_LOCK_BYPASS`, `OPTYPE_UNDO_GROUPED`, `OPTYPE_DEPENDS_ON_CURSOR`. Properties are declared with `RNA_def_boolean/float/int/enum(ot->srna, "name", default, ui_name, desc)` and read with `RNA_*_get(op->ptr, "name")`.

Return values: `OPERATOR_FINISHED | CANCELLED | RUNNING_MODAL | PASS_THROUGH`.

### 3.3 Pattern A — plain `exec` operator

`MESH_OT_extrude_region` (`editors/mesh/editmesh_extrude.cc:458`): `ot->exec = edbm_extrude_region_exec` (:430), `ot->poll = ED_operator_editmesh`, flags `REGISTER|UNDO`, props `use_normal_flip`, `use_dissolve_ortho_edges` + `transform::properties_register(ot, P_NO_DEFAULTS|P_MIRROR_DUMMY)`. The exec loops over all edit-mode objects, calls `edbm_extrude_mesh` (:358) which picks a strategy from `selectmode` and counts (`VERT_ONLY` → `extrude_vert_indiv`, `EDGE_ONLY` → `extrude_edge_only`, else `extrude_face_region` via `edbm_extrude_ex` :212 which flags input by hflag, runs the op, deselects all, selects `geom.out`), then `EDBM_update{looptris, normals, destructive}`. The WM pushes undo after `exec` returns (`wm_event_system.cc:1282 wm_operator_finished` → `ED_undo_push_op` :1308 when `OPTYPE_UNDO`).

### 3.4 Pattern B — `invoke`/`modal` with re-execution from a backup (inset, bevel, bisect, loop-cut)

`editors/mesh/editmesh_inset.cc`:
- `InsetData` (:54): `old_thickness, old_depth, modify_depth, initial_length, pixel_size, is_modal, shift, shift_amount, max_obj_scale, NumInput num_input, ob_store[{ob, BMBackup mesh_backup}], launch_event, mcenter[2]`.
- `edbm_inset_invoke` (:342): `edbm_inset_init(is_modal=true)` (stores `EDBM_redo_state_store(em)` per object), computes pivot via `transform::calculateTransformCenter(V3D_AROUND_CENTER_MEDIAN)` and `initial_length = |mcenter - mval|`, `pixel_size = ED_view3d_pixel_size(rv3d, center_3d)`; runs `edbm_inset_calc` once; `WM_event_add_modal_handler`; returns `RUNNING_MODAL`.
- `edbm_inset_calc(op)` (:237) — **the redo body, used by exec, modal and the redo panel**: for each object `EDBM_redo_state_restore(backup)` (if modal), `EDBM_op_init("inset_region faces=%hf use_boundary=%b … thickness=%f depth=%f …", BM_ELEM_SELECT, …)`, `BMO_op_exec`, deselect all + select `faces.out` (or the inputs), `EDBM_op_finish`, `EDBM_update{looptris, !normals, destructive}`.
- `edbm_inset_modal` (:378): numeric input first (`hasNumInput/handleNumInput/applyNumInput` → set RNA `thickness/depth` → recalc); `MOUSEMOVE` → `amount = old ± (|mcenter-mval| - initial_length) * pixel_size` (Shift = 0.1× fine, Ctrl = toggle depth vs thickness), write RNA prop, `edbm_inset_calc`; `LEFTMOUSE/RET/PADENTER` → calc + exit → `FINISHED`; `ESC/RIGHTMOUSE` → `edbm_inset_cancel` (restore backups) → `CANCELLED`; `O` toggles `use_outset`; `I` toggles individual.
- `edbm_inset_exec` (:327): `init(is_modal=false)`, `calc`, `exit`.

`editors/mesh/editmesh_bevel.cc` is the same with four value channels (`OFFSET_VALUE, OFFSET_VALUE_PERCENT, PROFILE_VALUE, SEGMENTS_VALUE`, :59-72, per-kind snap increments/clamps/`value_scale_per_inch`), a modal keymap (`BEV_MODAL_*` :106, mapped keys A/P/S/M/… declared via `WM_modalkeymap_ensure` in `MESH_OT_bevel`), status-bar text, and `edbm_bevel_calc` (:328) calling `EDBM_op_init("bevel geom=%hvef offset=%f segments=%i affect=%i …")`.

`editors/mesh/editmesh_loopcut.cc`: `RingSelOpData` (:61) holds `EditMesh_PreSelEdgeRing *presel_edgering` (the preview drawn with a region draw handler `ringsel_draw` :91), `vc`, `bases`, `eed` (edge under cursor), `NumInput num`, `extend`, `do_cut`. `loopcut_mouse_move` (:341) → `EDBM_edge_find_nearest_ex` → `ringsel_find_edge` (:137) → `EDBM_preselect_edgering_update_from_edge`; wheel/`PageUp` change `number_cuts`; confirm → `ringsel_finish` (:158): `edgering_select` walks `BMW_EDGERING` from `eed` selecting the ring (:99-133), then `EDBM_op_init("subdivide_edges edges=%he cuts=%i smooth=%f smooth_falloff=%i use_only_quads=%b …")`, selects `geom_inner.out` and flushes; the macro `MESH_OT_loopcut_slide` then invokes `TRANSFORM_OT_edge_slide`.

### 3.5 Pattern C — a full modal tool with its own data model (knife)

`editors/mesh/editmesh_knife.cc` (4932 lines). `KnifeTool_OpData` (:221-326): its own `KnifeVert/KnifeEdge` mempools mapped from BMesh (`origvertmap`, `origedgemap`, `kedgefacemap`), a BVH over looptris (`knife_bvh_init` :1172) for ray-casts, `curr/prev/init` `KnifePosData` (snapped cursor states), `linehits`, undo stack of `KnifeUndoFrame` (:3779 `knifetool_undo`), angle/axis constraints, `KnifeMode {IDLE, DRAGGING, CONNECT, PANNING}` (:217), a modal keymap `KNF_MODAL_*` (:328). Cuts are only applied to the BMesh at confirm: `knifetool_finish` (:4139) → `knife_make_cuts` (:2205) → `knife_make_face_cuts` (:2070) which uses `BM_face_split_edgenet` / `BM_edge_split` / `BM_face_split`. This is the template for any tool that needs preview geometry that isn't the mesh.

### 3.6 Macro operators & transform chaining

`editors/mesh/mesh_ops.cc:215-362 ED_operatormacros_mesh` (`WM_operatortype_append_macro` + `WM_operatortype_macro_define`). The macro runs sub-operators in sequence; the last one (`TRANSFORM_OT_translate` / `_shrink_fatten` / `_edge_slide`) is **invoked modally** with pre-set properties (`RNA_boolean_set(otmacro->ptr, "use_proportional_edit", false); … "mirror", false`):

| macro | = |
|---|---|
| `MESH_OT_extrude_region_move` (:263) | `extrude_region` + `translate` |
| `MESH_OT_extrude_manifold` (:272) | `extrude_region(use_dissolve_ortho_edges)` + `translate(use_automerge_and_split)` |
| `MESH_OT_extrude_context_move` (:284) | `extrude_context` + `translate` |
| `MESH_OT_extrude_region_shrink_fatten` (:293) | `extrude_region` + `shrink_fatten` (extrude along normals) |
| `MESH_OT_extrude_faces_move` (:302) | `extrude_faces_indiv` + `shrink_fatten` |
| `MESH_OT_extrude_edges_move` (:311), `_vertices_move` (:320) | + `translate` |
| `MESH_OT_duplicate_move` (:236), `rip_move` (:245), `rip_edge_move` (:254) | + `translate` |
| `MESH_OT_loopcut_slide` (:221), `offset_edge_loops_slide` (:228) | + `edge_slide` |

The **E** key is bound to the Python operator `view3d.edit_mesh_extrude_move_normal` (`scripts/startup/bl_operators/view3d.py:83-145`), which inspects `mesh.total_face_sel/total_edge_sel` and dispatches to `extrude_region_shrink_fatten` (faces, along normals) or `extrude_region_move(TRANSFORM_OT_translate={orient_type:'NORMAL', constraint_axis:(False,False,True)})` (single face / edges) etc. — i.e. "extrude along normal" is just translate constrained to local Z of the NORMAL orientation.

### 3.7 "Adjust Last Operation" (redo panel)

`wm_operator_finished` (`windowmanager/intern/wm_event_system.cc:1282`) registers the operator with its final properties when `OPTYPE_REGISTER` (`wm_operator_register` :1342, `WM_operator_last_properties_store` :1300). The HUD panel (`editors/interface/regions/interface_region_hud.cc:110-172`) draws `WM_operator_last_redo(C)`'s properties using `ot->ui` (or auto layout); any change calls `ED_undo_operator_repeat(C, op)` (`editors/undo/ed_undo.cc:651`): `WM_operator_repeat_check && poll` → `ED_undo_pop_op(C, op)` (undo to before the op) → `WM_operator_repeat(C, op)` (re-run **`exec`** with the edited properties; modal ops therefore must have an `exec` that reproduces the modal result from properties) → on failure `ED_undo_redo`. For modal transform this is why `saveTransform` writes `values_final`, constraint axes, orientation, snap and proportional settings back into the operator (`editors/transform/transform.cc:1744`).

### 3.8 Operator catalogue

`MESH_OT_*` registrations (`mesh_ops.cc:26-199`), grouped. Implementations: `editmesh_tools.cc` (10064 lines) holds most; others noted.

- Add: `primitive_plane/cube/circle/cylinder/cone/grid/monkey/uv_sphere/ico_sphere_add` (`editmesh_add.cc`), `primitive_cube_add_gizmo`.
- Selection: `select_all, select_more, select_less, select_linked, select_linked_pick, select_mode, loop_select, edgering_select, select_edge_loop_multi, select_edge_ring_multi, select_boundary_loop_multi, shortest_path_pick, shortest_path_select, loop_to_region, region_to_loop, select_similar, select_similar_region, select_random, select_nth, select_mirror, select_axis, select_face_by_sides, select_by_pole_count, select_loose, select_non_manifold, select_interior_faces, faces_select_linked_flat, edges_select_sharp, select_ungrouped, select_by_attribute, select_next_item, select_prev_item` (`editmesh_select.cc`, `editmesh_path.cc`, `editmesh_select_similar.cc`).
- Visibility: `hide, reveal`.
- Extrude family: `extrude_region, extrude_context, extrude_faces_indiv, extrude_edges_indiv, extrude_verts_indiv, extrude_repeat, dupli_extrude_cursor, spin, screw, solidify, wireframe, offset_edge_loops`.
- Topology: `merge, remove_doubles, subdivide, subdivide_edgering, unsubdivide, duplicate, split, separate, edge_rotate, edge_face_add (F), edge_split, edge_collapse, fill, fill_grid, fill_holes, beautify_fill, quads_convert_to_tris, tris_convert_to_quads, bevel (editmesh_bevel.cc), inset (editmesh_inset.cc), bridge_edge_loops, loopcut (editmesh_loopcut.cc), poke, knife_tool (editmesh_knife.cc), knife_project, bisect (editmesh_bisect.cc), intersect, intersect_boolean, face_split_by_edges (editmesh_intersect.cc), convex_hull, vert_connect, vert_connect_path, vert_connect_concave, vert_connect_nonplanar, face_make_planar, rip (editmesh_rip.cc), rip_edge (editmesh_rip_edge.cc), circularize, flatten, space_edge_loops_evenly`.
- Delete / dissolve: `delete, delete_loose, delete_edgeloop, dissolve_verts, dissolve_edges, dissolve_faces, dissolve_mode, dissolve_limited, dissolve_degenerate, decimate, sort_elements, reorder_vertices_spatial`.
- Normals / shading: `normals_make_consistent, flip_normals, faces_shade_smooth, faces_shade_flat, set_sharpness_by_angle, mark_sharp, mark_seam, point_normals, merge_normals, split_normals, normals_tools, set_normals_from_faces, average_normals, smooth_normals, mod_weighted_strength, flip_quad_tessellation`.
- Smoothing / shape keys: `vertices_smooth, vertices_smooth_laplacian, blend_from_shape, shape_propagate_to_all, symmetrize, symmetry_snap`.
- UV / colour / attributes: `attribute_set, uvs_rotate, uvs_reverse, colors_rotate, colors_reverse, uv_texture_add/remove, customdata_*`.
- Poly-build tool: `polybuild_face_at_cursor, polybuild_split_at_cursor, polybuild_dissolve_at_cursor, polybuild_transform_at_cursor, polybuild_delete_at_cursor` (+ `_move` macros).

### 3.9 Default edit-mesh keymap (`scripts/presets/keyconfig/keymap_data/blender_default.py`, `km_edit_mesh` at :5524-5688)

| key | operator |
|---|---|
| G / R / S | `transform.translate / rotate / resize`; Shift+W bend, Ctrl+M mirror, Shift+Alt+S to-sphere, Shift+Ctrl+Alt+S shear (`_template_items_transform_actions`) |
| 1 / 2 / 3 (+Shift extend, +Ctrl expand) | `mesh.select_mode type=VERT/EDGE/FACE` |
| A / Alt+A / Ctrl+I | `mesh.select_all` SELECT (or TOGGLE) / DESELECT / INVERT |
| Alt+click, Shift+Alt+click | `mesh.loop_select` (toggle) ; Ctrl+Alt+click `mesh.edgering_select` |
| Ctrl+click, Shift+Ctrl+click | `mesh.shortest_path_pick` (use_fill) |
| Ctrl+Numpad+ / − | `mesh.select_more / select_less` |
| L / Shift+L / Ctrl+L | `mesh.select_linked_pick` (deselect) / `select_linked` |
| Shift+Ctrl+M | `mesh.select_mirror`; Shift+G similar menu |
| H / Shift+H / Alt+H | `mesh.hide` / hide unselected / `mesh.reveal` |
| E / Alt+E | `view3d.edit_mesh_extrude_move_normal` / extrude menu |
| I | `mesh.inset` ; Ctrl+B `mesh.bevel affect=EDGES` ; Shift+Ctrl+B bevel VERTICES |
| Ctrl+R / Shift+Ctrl+R | `mesh.loopcut_slide` / `offset_edge_loops_slide` |
| K / Shift+K | `mesh.knife_tool` (occlude) / only_selected |
| F / Alt+F | `mesh.edge_face_add` / `mesh.fill` |
| Ctrl+T / Shift+Ctrl+T / Alt+J | tris (beauty / fixed) / `tris_convert_to_quads` |
| V / Alt+V / Alt+D | `mesh.rip_move` / rip fill / `rip_edge_move` |
| M / Alt+M | merge menu / split menu ; Y `mesh.split` ; P `mesh.separate` |
| J | `mesh.vert_connect_path` |
| Shift+D | `mesh.duplicate_move` ; Shift+A add menu |
| X / Del / Ctrl+X | delete menu / `mesh.dissolve_mode` |
| Shift+N / Shift+Ctrl+N | `normals_make_consistent` (inside) ; Alt+N normals menu |
| Alt+S / Shift+V / Shift+E | `transform.shrink_fatten` / `vert_slide` / `edge_crease` |
| Ctrl+E / Ctrl+F / Ctrl+V | edge / face / vertex menus ; U uv map menu |
| O / Shift+O / Alt+O | proportional toggle / falloff pie / connected toggle |
| Ctrl+click (action mouse) | `mesh.dupli_extrude_cursor` |

Transform modal keymap (`km_transform_modal_map` :6152): `CONFIRM` LMB/Ret/NumpadEnter/Space; `CANCEL` RMB/Esc; `AXIS_X/Y/Z` X/Y/Z; `PLANE_X/Y/Z` Shift+X/Y/Z; `CONS_OFF` C; `TRANSLATE` G, `VERT_EDGE_SLIDE` G(again), `ROTATE` R, `TRACKBALL` R(again), `RESIZE` S, `ROTATE_NORMALS` N; `SNAP_TOGGLE` Shift+Tab; `SNAP_INV_ON/OFF` Ctrl press/release; `ADD_SNAP` A / Ctrl+A, `REMOVE_SNAP` Alt+A; `PROPORTIONAL_SIZE_UP/DOWN` PageUp/PageDown, wheel; `PRECISION` Shift; `AUTOCONSTRAINT` MMB, `AUTOCONSTRAINTPLANE` Shift+MMB; `PASSTHROUGH_NAVIGATE` Alt.

---

## 4. Transform system (`editors/transform/`)

### 4.1 Data structures (`transform.hh`)

- `TransDataBasic` (:400): `void *extra` (the `BMVert*`), `float *loc` (**pointer into `v->co`**, mutated in place), `iloc[3]` (initial), `center[3]` (element/island pivot), `*val/ival`, `flag` (`TD_SELECTED`, `TD_SKIP`, `TD_MIRROR_X/Y/Z`, `TD_MIRROR_EDGE_*`, …).
- `TransData : TransDataBasic` (:509): `dist` (topological distance, prop-edit connected), `rdist` (euclidean), **`factor`** (prop-edit falloff 0..1), `mtx[3][3]` (data→global), `smtx[3][3]` (global→data), `axismtx[3][3]` (element orientation; `[2]` = vertex normal), `protectflag`.
- `TransDataExtension` (:424): rotation/scale channels; for meshes only allocated for `TFM_SHRINKFATTEN` (`iscale[0]` = shell factor).
- `TransDataContainer` (:674): one per edit object — `data[]`, `data_ext[]`, `data_mirror[]`, `obedit`, `mat/imat/mat3`, `center_local[3]`, `use_mirror_axis_*`, `custom` (mode data e.g. `EdgeSlideData`), `sorted_index_map` (selected first).
- `TransInfo` (:808): containers; `mode` (`eTfmMode`), `mode_info` (`TransModeInfo`); `options` (`eTContext`), `flag` (`eTFlag`: `T_EDIT, T_POINTS, T_PROP_EDIT, T_PROP_CONNECTED, T_MODAL, T_RELEASE_CONFIRM, T_NO_MIRROR, T_AUTOMERGE, T_AUTOSPLIT, T_ALT_TRANSFORM, T_CLNOR_REBUILD…`), `modifiers` (`MOD_PRECISION, MOD_SNAP, MOD_SNAP_INVERT, MOD_CONSTRAINT_SELECT_AXIS/PLANE…`), **`state` (`TRANS_STARTING=0, RUNNING=1, CONFIRM=2, CANCEL=3`, :246)**, `redraw` (`TREDRAW_NOTHING/SOFT/HARD`); `TransCon con`; `TransSnap tsnap`; `NumInput num`; `MouseInput mouse`; `prop_size, prop_mode`; `center_global[3], center2d[2]`; `around` (pivot); `spacemtx[3][3]/spacemtx_inv` (**orientation matrix**), `orient[3]{type, matrix}` + `orient_curr` (default / scene / set-by-key), `values[4]` (raw mouse), `values_modal_offset[4]`, `values_final[4]` (what gets saved for redo), `orient_axis`, `launch_event`, `mval`, `zfac`.
- `TransCon` (:577): `pmtx[3][3]` (projection), `mode` (`CON_APPLY|CON_AXIS0|CON_AXIS1|CON_AXIS2|CON_SELECT|CON_USER`), function pointers `applyVec/applySize/applyRot/drawExtra`.
- `TransSnap` (:541): `mode` (`eSnapMode` INCREMENT/GRID/VERTEX/EDGE/EDGE_MIDPOINT/EDGE_PERPENDICULAR/EDGE_ENDPOINT/FACE/FACE_MIDPOINT/VOLUME + INDIVIDUAL_PROJECT/NEAREST), `source_operation` (CLOSEST/CENTER/MEDIAN/ACTIVE), `target_operation`, `snap_source[3], snap_target[3], snapNormal[3]`, multi-point list, `snap_target_fn/snap_source_fn`, `SnapObjectContext*`.
- `MouseInput` (:609): `apply(t, mi, mval, out)`, `post`, `imval`, `center` (pivot in screen), `factor`, `precision_factor` (0.1, angle 1/30), `precision`, custom points. Modes set with `initMouseInputMode(t, mi, INPUT_VECTOR | INPUT_SPRING_FLIP | INPUT_ANGLE | INPUT_VERTICAL_ABSOLUTE | INPUT_CUSTOM_RATIO(_FLIP) | …)` (`transform_input.cc`).
- `NumInput` (`editors/include/ED_numinput.hh:23`): `idx_max`, `unit_sys/unit_type[3]`, `flag` (`NUM_AFFECT_ALL`), `val_flag[3]` (`NUM_NULL_ONE, NUM_NO_NEGATIVE, NUM_NO_ZERO, NUM_NO_FRACTION, NUM_EDITED`), `val[3]`, `val_inc[3]`, `idx`, `str[64]`.
- `TransModeInfo` (`transform_mode.hh:28`): `flags; init_fn(t, op); transform_fn(t); transform_matrix_fn; handle_event_fn(t, event); snap_distance_fn; snap_apply_fn; draw_fn`. Table lookup `mode_info_get` (`transform_mode.cc:1131`), `transform_mode_init` :1207.
- `TransConvertTypeInfo TransConvertType_Mesh` (`transform_convert_mesh.cc:2751`) = `{flags T_EDIT|T_POINTS, create_trans_data = createTransEditVerts, recalc_data = recalcData_mesh, special_aftertrans_update = special_aftertrans_update__mesh}`.

### 4.2 State machine

```
transform_invoke (transform_ops.cc:539)
  initTransform (transform.cc:1970):
    state = STARTING; launch_event; unit spacemtx
    initTransInfo (transform_generics.cc:122): T_MODAL, around, release_confirm, mirror, prop-edit flags/size/mode from op props/toolsettings
    create_trans_data → createTransEditVerts   (0 elements → CANCELLED)
    initSnapping; calculatePropRatio; calculateCenter; initMouseInput(center2d, mval)
    transform_mode_init(mode) → mode init_fn (mouse input mode, idx_max, increments, unit types)
    constraint from op props (orient_type / constraint_axis) → setUserConstraint
    applyMouseInput(imval) → values (zero delta)
  if "value" prop given & no event → exec path; else add modal handler, apply once if values_modal_offset ≠ 0

transform_modal (transform_ops.cc:412) per event:
  transformEvent (transform.cc:1070):
    1 numeric input active → handleNumInput → HARD
    2 MOUSEMOVE → mval; HARD; STARTING→RUNNING; applyMouseInput → values; handleSnapping
    3 EVT_MODAL_MAP (TFM_MODAL_*, transform.hh:288-341):
        CANCEL → state=CANCEL; CONFIRM → state=CONFIRM
        TRANSLATE/ROTATE/RESIZE/TRACKBALL/VERT_EDGE_SLIDE → restoreTransObjects; resetTransModal; transform_mode_init(new)  (G→G = slide, R→R = trackball)
        AXIS_X/Y/Z, PLANE_X/Y/Z → transform_event_modal_constraint (:943): axis = CON_AXISn, plane = the other two;
                                   same key again cycles orient_curr (default → scene → …), back to 0 = stopConstraint
        CONS_OFF → stopConstraint; SNAP_TOGGLE/SNAP_INV_ON/OFF → modifiers; ADD/REMOVE_SNAP;
        PROPSIZE(_UP/_DOWN) → prop_size *=/÷= 1.1 (1.01 precise) → calculatePropRatio
        AUTOCONSTRAINT(PLANE) (MMB) → initSelectConstraint → nearest screen axis
        PRECISION press/release → MOD_PRECISION, mouse.precision
    4 raw keys: Alt+C connected toggle, Shift+O falloff cycle, Alt = T_ALT_TRANSFORM
    5 KM_RELEASE of launch_event while T_RELEASE_CONFIRM → CONFIRM   (drag-to-transform)
    6 mode_info->handle_event_fn (e.g. edge slide E/F/C, shrink-fatten Alt)
  transformApply (transform.cc:2243): if HARD { selectConstraint; mode_info->transform_fn(t) }  // ends in recalc_data
  transformEnd (transform.cc:2268): CANCEL → restoreTransObjects (loc=iloc…) + recalc → CANCELLED
                                     CONFIRM → (clnor rebuild) FINISHED
                                     both → special_aftertrans_update; postTrans; redraw
```

### 4.3 Mesh TransData creation and recalculation (`transform_convert_mesh.cc`)

`createTransEditVerts` (:1484): count = selected non-hidden verts (or all non-hidden when prop-edit); optional island data (`transform_convert_mesh_islands_calc` :738) when pivot = individual origins; `mtx = obmat3`, `smtx = pseudoinverse(mtx)`; if `T_PROP_CONNECTED` → `transform_convert_mesh_connectivity_distance` (:1006; BFS/Dijkstra over edges from selected verts, records nearest selected index); X-mirror → `transform_convert_mesh_mirrordata_calc` (:1198), mirrored verts become `TransDataMirror{loc, loc_src}`; per vert `VertsToTransData` (:1435): `td->loc = eve->co; iloc = co; center = island center or iloc; axismtx[2] = eve->no` (or `createSpaceNormal`), `TD_SELECTED` if selected, `dist = dists[i]` or `FLT_MAX`, `transform_convert_mesh_crazyspace_transdata_set` (:1372; folds deform-modifier "crazy space" into `mtx/smtx`); `BKE_editmesh_looptris_calc` if stale.

Unconnected prop-edit distance: `set_prop_dist` (`transform_convert.cc:218`) KD-tree of selected positions → `rdist`; `sort_trans_data_dist` (:140).

`recalcData_mesh` (:2065): if not cancelling → `transform_snap_project_individual_apply`, clip-mirror-modifier, `mesh_transdata_mirror_apply` (:2030), `mesh_customdatacorrect_apply` (UV/multires correction, `T_CORRECT_UV`); then `mesh_partial_update` (:1970): all-selected → `BKE_editmesh_looptris_and_normals_calc`, else `BKE_editmesh_looptris_calc_with_partial_ex` + `BM_mesh_normals_update_with_partial_ex` over a `BMPartialUpdate` built from the moved verts (`bmesh_mesh_partial_update.cc`).

`special_aftertrans_update__mesh` (:2113): edge/vert slide → final `mesh_customdatacorrect_apply(tc, true)`; `T_AUTOMERGE/T_AUTOSPLIT` → `EDBM_automerge(_and_split)`; selection flush; mirror table end.

### 4.4 Modes

Common `transform_fn` shape: read `values` (+`values_modal_offset`) or `applyNumInput`; `transform_snap_mixed_apply` else `transform_snap_increment` (`r = step * round(v/step)`, step × `increment_precision` under Shift); `con.applyVec/applySize/applyRot`; store `values_final`; parallel loop over TransData skipping `TD_SKIP`, scaling by `td->factor`; `recalc_data`; header text.

- Translate (`transform_mode_translate.cc`): `initTranslation` :582 (`INPUT_VECTOR`, `idx_max = 2`, `increment = snap_spatial`, `B_UNIT_LENGTH`, orientation GLOBAL); `applyTranslation` :497; per element (:69): `tvec = con.applyVec(vec); tvec = smtx·tvec; tvec *= factor; loc = iloc + tvec`.
- Rotate (`transform_mode_rotate.cc`): `INPUT_ANGLE`, `idx_max = 0`, orientation VIEW; axis = `con.applyRot` or `spacemtx[orient_axis]`; per element `ElementRotation_ex` (`transform_mode.cc:593`): `smat = smtx·(mat·mtx); loc = smat·(iloc − center) + center` with `center = td->center` (individual origins) else `tc->center_local`.
- Resize (`transform_mode_resize.cc`): `INPUT_SPRING_FLIP`, `T_NULL_ONE`, `NUM_AFFECT_ALL`; `size_to_mat3(values_final)` → `con.applySize` (unconstrained axes forced to 1) → `ElementResize` (`transform_mode.cc:967`) lerps scaled offset by `factor`.
- Shrink/Fatten (`transform_mode_shrink_fatten.cc`): `T_NO_CONSTRAINT`, `INPUT_VERTICAL_ABSOLUTE`; per element (:57) `loc = iloc + axismtx[2] * distance * factor * (even ? iscale[0] : 1)` — i.e. move along the vertex normal, optionally scaled by `BM_vert_calc_shell_factor` for even thickness; Alt/`RESIZE` key toggles even.
- Edge slide (`transform_mode_edge_slide.cc`): `transform_mesh_edge_slide_data_create` (`transform_convert_mesh.cc:2301`) validates each selected vert has 1–2 selected edges, groups into loops (`loop_nr`), and computes `dir_side[0/1]` (the two slide directions from the neighbouring faces' loops) per `TransDataEdgeSlideVert{td, dir_side[2], edge_len, loop_nr}` (`transform_convert.hh:64`); mouse mapping via custom points (`calcEdgeSlide_mval_range` :223) with `INPUT_CUSTOM_RATIO_FLIP`; apply (`edge_slide_apply_elem` :685) `loc = iloc + dir_side[side] * perc` (clamped) or interpolated for even mode; keys E even, F flip, C clamp.
- Vert slide (`transform_mode_vert_slide.cc`): per selected vert all linked verts' positions as targets (`TransDataVertSlideVert{td, co_link_orig_3d, co_link_curr}` `transform_convert.hh:80`); `update_active_edges` (:91) picks the target best matching mouse direction; apply = lerp `iloc → target`.
- Others in `transform_mode_*.cc`: trackball, bend, shear, to-sphere, push-pull, tilt, edge crease, bevel weight, mirror, rotate normals, skin resize, etc.

### 4.5 Constraints and orientations (`transform_constraints.cc`, `transform_orientations.cc`)

- `projection_matrix_calc` (:51): identity with unconstrained rows zeroed, then `pmtx = spacemtx · P · spacemtx_inv`.
- `setUserConstraint(t, mode, fmt)` (:678): picks the current orientation; LOCAL/GIMBAL → `setLocalConstraint`; NORMAL with per-element axes → `setAxisMatrixConstraint` (uses `td->axismtx`); else `setConstraint` (:636) installing `applyAxisConstraintVec/Size/Rot`.
- `transform_constraint_get_nearest` (:374): axis (1 dim) → `axisProjection` (:165, project the mouse ray onto the axis line, with view-aligned correction); plane (2 dims) → `planeProjection` (:334, intersect view ray with the plane).
- `applyAxisConstraintSize` (:497): unconstrained diagonal → 1, `spacemtx·smat·spacemtx_inv`; `applyAxisConstraintRot` (:584): single axis or plane normal.
- `setNearestAxis` (:1174): MMB auto-constraint picks the screen-space nearest axis of the current orientation.
- Orientations `calc_orientation_from_type_ex` (`transform_orientations.cc:667`): GLOBAL identity; LOCAL object axes; VIEW `normalize(viewinv 3×3)`; GIMBAL; PARENT; CURSOR; CUSTOM; **NORMAL** → `ED_getTransformOrientationMatrix` (:1546) → `getTransformOrientation_ex` (:952): active element normal/plane if pivot = active, else accumulated selected face normals + best tangent (`:1001-1049`), else 3 verts → triangle normal, else edge/2-vert/1-vert fallbacks; `createSpaceNormalTangent(mat, normal, plane)` (:411) yields `mat[2] = normal, mat[1] = plane`.
- `transform_orientations_current_set(t, i)` (:859) copies `t->orient[i].matrix` into `spacemtx`.

### 4.6 Pivot, numeric input, snapping, proportional

- `calculateCenter` (`transform_generics.cc:1215`) → `calculateCenter_FromAround` (:1150): `V3D_AROUND_CENTER_BOUNDS` → `calculateCenterBound` :1074; `CENTER_MEDIAN` → :1046; `CURSOR` → :944; `ACTIVE` → `calculateCenterActive` :1101 (falls back to median); `LOCAL_ORIGINS` → median for the helpline, but each element uses its own `td->center` (`transdata_check_local_center`, `transform_mode.cc:58`). Then `calculateCenterLocal` (:930) and `calculateCenter2D` (:924, project to screen), `calculateZfac` (:1187).
- Numeric input (`editors/util/numinput.cc`): `hasNumInput` :188; `applyNumInput(n, vec)` :207 (fills `vec[0..idx_max]`, honouring `NUM_AFFECT_ALL/NULL_ONE/NO_NEGATIVE/NO_ZERO/NO_FRACTION`; returns false and stores `vec` as the org value when not editing); `handleNumInput` :344 (digits and `-+*/()` start editing, Backspace, arrows, **Tab cycles component**, Ctrl+C/V); `user_string_to_number` :284 evaluates units (`BKE_unit_replace_string`, `2cm`) and Python expressions (`BPY_run_string_as_number`); modes set `num.unit_type[i]` (`B_UNIT_LENGTH / ROTATION / NONE`) and `num.val_inc = increment`.
- Snapping (`transform_snap.cc`): `transform_snap_mixed_apply` :594 (throttled 10 ms) → `snap_target_fn` (`snap_target_view3d_fn` :1343 → `snapObjectsTransform` pixel-radius search through `SnapObjectContext`, `transform_snap_object.cc` / `_editmesh.cc` BVH over the edit mesh excluding selected geometry `bm_edge_is_snap_target` :653) → `snap_source_fn` (closest :1516 / center :1478 / median :1506 / active :1489) → `mode_info->snap_apply_fn`. Increment: `transform_snap_increment_ex` :1773. Per-vertex face projection: `transform_snap_project_individual_apply` :543. `SCE_SNAP` active when exactly one of `MOD_SNAP`/`MOD_SNAP_INVERT` (Ctrl inverts) :120.
- Proportional (`transform_generics.cc:1290 calculatePropRatio`): `d = clamp((prop_size − dist)/prop_size, 0, 1)`; `SHARP d²`, `SMOOTH 3d²−2d³`, `ROOT √d`, `LIN d`, `CONST 1`, `SPHERE √(2d−d²)`, `RANDOM rng·d`, `INVSQUARE d(2−d)`; selected → 1, beyond radius → 0 (+`restoreElement`). `dist` = connected (topological) or `rdist` (euclidean) per `T_PROP_CONNECTED`.

### 4.7 `TRANSFORM_OT_translate` properties (`transform_ops.cc:850`, `properties_register` :637)

`value[3]`; `orient_type` (enum GLOBAL/LOCAL/NORMAL/GIMBAL/VIEW/CURSOR/PARENT/custom), `orient_matrix[3][3]`, `orient_matrix_type`; `constraint_axis[3]`; `mirror`; `use_proportional_edit`, `proportional_edit_falloff`, `proportional_size`, `use_proportional_connected`, `use_proportional_projected`; `snap`, `snap_elements`, `use_snap_project`, `snap_target`, `use_snap_self/edit/nonedit/selectable`, `snap_point[3]`, `snap_align`, `snap_normal[3]`; `gpencil_strokes`, `cursor_transform`, `texture_space`, `remove_on_cancel`, `use_duplicated_keyframes`, `view2d_edge_pan`; `release_confirm`, `use_accurate`; `use_automerge_and_split`; `translate_origin`. Rotate adds `orient_axis`; shear `orient_axis_ortho`; slides `correct_uv`. `TRANSFORM_OT_edge_slide` has no `exec` (invoke only).

---

## 5. Selection

### 5.1 Flags, counters, flushing (`bmesh/intern/bmesh_marking.cc`)

- `BM_vert_select_set(bm, v, sel)` :622 — ignores hidden; maintains `totvertsel`. `BM_edge_select_set` :644 — selects both verts; on deselect, in non-vertex mode a vert stays selected if another selected edge uses it (`bm_vert_is_edge_select_any_other` :157); in vertex mode both verts deselect. `BM_face_select_set` :684 — analogous over loops (edges kept if another selected face uses them, `bm_edge_is_face_select_any_other` :200). `_noflush` variants :763/:785. Generic `BM_elem_select_set` :924.
- `BM_mesh_select_mode_flush_ex(bm, selectmode, flag)` :502 — **down** (optional, `BMSelectFlushFlag::Down`): edge mode → `edge_to_vert` (:429), face mode → `face_to_vert_and_edge` (:464); **always up**: vertex mode → `vert_to_edge` (:392: edge selected iff both verts), vertex|edge mode → `edge_to_face` (:408: face selected iff all edges); then `BM_select_history_validate` and optional recount. `BM_mesh_select_mode_flush` :543 = default. `BM_mesh_select_flush_from_verts` :550. `BM_mesh_select_mode_clean` :256 (drop selection not representable in the mode). `BM_mesh_select_is_mixed` :245.
- Hide: `BM_vert_hide_set` :1520 (hides adjacent edges/faces), `BM_edge_hide_set` :1546, `BM_face_hide_set` :1575 — hidden elements are deselected.
- Counting: `BM_mesh_elem_hflag_count_enabled/disabled` :908/916; `BM_mesh_elem_hflag_enable/disable_all/_test` :1359-1491.

Editor level (`editors/mesh/editmesh_select.cc`): `EDBM_selectmode_set(em, mode)` :2985 — strips history entries of types not in the new mode (`edbm_strip_selections` :2949), then vertex → `EDBM_select_flush_from_verts`; edge → deselect all verts, re-select from selected edges, flush; face → deselect edges, re-select from faces. `EDBM_selectmode_convert` :3048 (explicit up/down conversion incl. "expand"). `EDBM_selectmode_toggle_multi` :3159 (1/2/3 keys with Shift = extend mode bitmask, Ctrl = expand). `EDBM_select_more/less` (`editmesh_utils.cc:402/425`) → `region_extend` op. `EDBM_select_pick(C, mval, params)` :2711 — `unified_findnearest` then per-type select/toggle/extend, `BM_select_history_store`, `EDBM_selectmode_flush`, active face set.

### 5.2 Selection history & active element

`BMEditSelection{next, prev; BMElem *ele; char htype}` (`bmesh_marking.hh:18`), stored on `bm->selected` (ordered). API: `BM_select_history_store/_notest/_remove/_clear` :1210, `BM_select_history_validate` :1215 (drop deselected), `BM_select_history_active_get(bm, &ese)` :1240 (last entry = active), `BM_select_history_map_create` :1276, `BM_select_history_merge_from_targetmap` :1291 (remap after merges). Geometric helpers used by orientations/tools: `BM_editselection_center` :1044, `_normal` :1060, `_plane` :1088. Active face additionally in `bm->act_face` (`BM_mesh_active_face_set` :942, used for face UV/active material). Serialized as `Mesh.mselect[]`.

### 5.3 Walkers (`bmesh/intern/bmesh_walkers.cc`, `_impl.cc` 2079 lines)

`BMW_init(walker, bm, type, mask_vert, mask_edge, mask_face, BMW_FLAG_TEST_HIDDEN, layer, delimit)` :51 → `BMW_begin(walker, start)`, `BMW_step`, `BMW_end` :113; DFS/BFS (`BMWOrder`), visited sets, per-walker state stack. Types (`bmesh_walkers.hh:172-191`): `BMW_VERT_SHELL` (connected verts via edges, "select linked"), `BMW_LOOP_SHELL` / `_WIRE`, `BMW_FACE_SHELL`, **`BMW_EDGELOOP`** (:840 — edge loop: continue across a 4-valence vertex to the opposite edge; delimiters `BMW_DELIMIT_EDGE_LOOP_INNER/OUTER_CORNERS`, `_NGONS`, `_MARK_SEAM`, `_MARK_SHARP`, `FACE_MARK_MATERIAL`), **`BMW_FACELOOP`** (:1222 — faces across quads), **`BMW_EDGERING`** (:1400 — opposite edges across quads; `BMW_DELIMIT_EDGE_RING_NGONS`), **`BMW_EDGEBOUNDARY`** (:1583), `BMW_EDGELOOP_NONMANIFOLD` (:1777), `BMW_LOOPDATA_ISLAND` (UV islands), `BMW_ISLANDBOUND`, `BMW_ISLAND`, `BMW_ISLAND_MANIFOLD`, `BMW_CONNECTED_VERTEX`. Loop/ring selection in `editmesh_select.cc`: `mouse_mesh_loop_edge` :2075 (edge loop; boundary loop if the edge is boundary), `mouse_mesh_loop_edge_ring` :2042, `mouse_mesh_loop_face` :2033, `edbm_select_loop_or_ring_by_edge` :2146; multi versions :1733-1864.

### 5.4 Shortest path (`editors/mesh/editmesh_path.cc`, `bmesh/tools/bmesh_path.cc`)

`mouse_mesh_shortest_path_vert/edge/face` :178/:379/:528 — from the active history element to the picked one: `BM_mesh_calc_path_vert/edge/face(bm, src, dst, BMCalcPathParams{use_topology_distance, use_step_face}, filter_cb)` (Dijkstra with `BLI_heapsimple`, `bmesh_path.cc`), or `BM_mesh_calc_path_region_*` (`bmesh_path_region.cc`) when `use_fill`; then select the path, update history so repeated Ctrl+click chains.

### 5.5 Picking: GPU select buffer vs projected search

`unified_findnearest(vc, bases, …)` (`editmesh_select.cc:1038`): with `dist = ED_view3d_select_dist_px()`, try faces (if face mode; `EDBM_face_find_nearest_ex` :881, also returns the face **under** the cursor `efa_zbuf`), then edges (`EDBM_edge_find_nearest_ex` :669, also `eed_zbuf`), then verts (`EDBM_vert_find_nearest_ex` :441); verts/edges get a `dist_margin = dist/2` advantage (dots beat lines) and a "use_select_bias/cycle" so repeated clicks cycle overlapping elements (static `prev_select`). Priority: vert > edge > face; fallback to the z-buffered edge/face if nothing within distance. Returns exactly one element.

Two backends inside `EDBM_*_find_nearest_ex`:
1. **Select-ID buffer** (default, not X-ray): `DRW_select_buffer_context_create(depsgraph, bases, SCE_SELECT_VERTEX|EDGE|FACE)` (`draw/intern/draw_select_buffer.cc:465`) → the select engine draws element ids (`extract_mesh_vbo_select_idx.cc`, offsets per object `DRW_select_buffer_context_offset_for_object_elem` :435) into an offscreen framebuffer (`DRW_draw_select_id`, read back with `GPU_framebuffer_read_color` :102-104); `DRW_select_buffer_find_nearest_to_point(depsgraph, region, v3d, mval, min, max, &dist)` :350 spirals outward from the cursor; `DRW_select_buffer_elem_get(sel_id, &base_index, &elem_index, &elem_type)` :400; `edbm_select_id_bm_elem_get` maps id → `BMVert*` via `vtable`. Occlusion for free; used also by box/lasso/circle (`view3d_select.cc` `edbm_backbuf_check_and_select_verts/edges/faces` :249-323 reading an `EditSelectBuf_Cache{BLI_bitmap *select_bitmap}` :199).
2. **Projected CPU search** (X-ray / no depth): `mesh_foreachScreenVert/Edge/Face(vc, callback, data, clip_flag)` (`editors/mesh/editmesh_utils.cc` / `ED_view3d_project_*`) with callbacks `findnearestvert__doClosest` :408 (Manhattan pixel distance, select bias), `find_nearest_edge__doClosest` :601 (distance to screen segment), `findnearestface__doClosest` :848 (face centre). Box/lasso use `do_mesh_box_select__doSelectVert/Face` (`view3d_select.cc:3961/4046`).

Ray-cast alternative for poly-build: `EDBM_unified_findnearest_from_raycast` :1190 (BVH ray into the edit mesh, then nearest vert/edge of the hit face). Knife and snapping also use BVH ray-casts over looptris, not the select buffer.

3D-cursor: transform pivot `V3D_AROUND_CURSOR` and `mesh.dupli_extrude_cursor` (`editmesh_extrude.cc:692`) use `scene->cursor.location`, unprojected mouse depth from `ED_view3d_win_to_3d` at the selection centre depth (`zfac`).

---

## 6. Undo

`editors/mesh/editmesh_undo.cc` (1341 lines) — a **snapshot** system: each step stores a complete Mesh per edit object, deduplicated at chunk level. No diffs.

- `UndoMesh` (:149): `Mesh *mesh` (a real Mesh copy, may own `mesh->key`), `char selectmode`, `int shapenr`, `store{BArrayCustomData *vdata,*edata,*ldata,*pdata; BArrayState *face_offset_indices; BArrayState **keyblocks; BArrayState *mselect}`, `local_next/prev` (chain of live undo meshes used to find the previous state of the same mesh by `id.session_uid`, `mesh_undostep_reference_elems_from_objects` :882).
- Encode `undomesh_from_editmesh` (:931): `BM_mesh_bm_to_me(nullptr, em->bm, um->mesh, {calc_object_remap=false, update_shapekey_indices=false, active_shapekey_to_mvert=true, cd_mask_extra=SHAPE_KEYINDEX})`, copy vertex-group names, `selectmode`, `shapenr`; then (in a background `TaskPool`, `USE_ARRAY_STORE_THREAD` :75) `um_arraystore_compact(um, um_ref)` (:533): for every CustomData layer / attribute on the four domains, `face_offset_indices`, each shape-key block and `mselect`: `BLI_array_store_state_add(store, data, size, reference_state)` and free the Mesh's own copy. Stores are keyed by (domain, byte stride) (`BLI_array_store_at_size_ensure`, :198-224); `CD_PROP_BOOL` layers are RLE-encoded first (`USE_ARRAY_STORE_RLE` :99, because selection booleans have too little entropy for chunk hashing).
- Chunking (`blenlib/intern/array_store.cc`, 2050 lines; API `BLI_array_store.h`): `BLI_array_store_create(stride, chunk_count)`; chunk element count `= max(256, 65536 / next_pow2(stride))` (`array_chunk_size_calc` :117, `ARRAY_CHUNK_SIZE_IN_BYTES 65536` :72); `BLI_array_store_state_add` with a reference state runs `bchunk_list_from_data_merge` (:1275) — rolling hash of the new data against the reference's chunk table, reuse identical chunks (ref-counted `BChunk{data, data_len, users, key}` :351), allocate new chunks for changed spans, merge small runs. Result: an edit that moves 10 verts shares all chunks except those containing the touched positions.
- Decode `undomesh_to_editmesh` (:1026): wait for compaction, `um_arraystore_expand` (materialise arrays from states), `EDBM_mesh_free_data`, `BM_mesh_create(use_toolflags)`, `BM_mesh_bm_from_me(bm, um->mesh, {active_shapekey = shapenr})`, `BKE_editmesh_create`, `BKE_editmesh_looptris_and_normals_calc` (looptris/normals are never stored), restore `selectmode`, `spacearr_dirty = ALL`, `um_arraystore_expand_clear`. Selection history comes back through `mselect`; per-element selection through the `.select_*` attributes.
- Step type `ED_mesh_undosys_type` (:1324): `poll` = an edit-mesh object in context; `step_encode` (:1173) snapshots **all** objects in edit mode; `step_decode` (:1234) re-enters edit mode for those objects and restores; `flags = UNDOTYPE_FLAG_NEED_CONTEXT_FOR_ENCODE`. Generic stack: `blenkernel/intern/undo_system.cc` (`UndoStack{steps, step_active…}`, `UndoStep{name, type, data_size, skip, use_memfile_step, use_old_bmain_data, is_applied}`, `UndoType{poll, step_encode_init, step_encode, step_decode, step_free, step_foreach_ID_ref, flags, step_size}` `BKE_undo_system.hh:52-185`); `BKE_undosys_step_push_with_type` :525 truncates redo, inserts a hidden memfile step first if the type references IDs and none was written yet (:558-580).
- Memfile undo (`memfile_undo.cc`): object-mode undo = serialized `.blend` in memory with per-datablock diffing; edit-mesh steps interleave with it. The WM pushes after any `OPTYPE_UNDO` operator (`wm_event_system.cc:1307`), including after a modal op finishes; `EDBM_update` never pushes.

**TS equivalent**: after each committed operator, `bmToMesh` into the SoA object and push `{arrays per attribute}` into a store that content-hashes fixed-size chunks (e.g. 64 KiB / stride) against the previous step's chunk list — a straightforward port of `BLI_array_store` (rolling hash + hash table of reference chunks). Restore = `bmFromMesh(snapshot)`. Store looptris/normals never. This also gives cheap "redo state" for modal previews (Blender uses a full `BM_mesh_copy` for that, `EDBM_redo_state_store`).

---

## 7. Normals, sharp edges, custom normals

### 7.1 Mesh side (`blenkernel/intern/mesh_normals.cc`, decls `BKE_mesh.hh:92-179`)

- Face normals `normals_calc_faces` :180 — Newell's method per face (`normal_calc_ngon` :123). (`face_normal_calc` :143 has tri/quad fast paths.)
- Vertex normals `normals_calc_verts` :194 — **corner-angle weighted**: for each face around the vertex, `factor = safe_acos_approx(dot(dir_prev, dir_next))` (:216), `n += face_normal * factor`, normalise; loose verts → `normalize(position)`. Needs `vert_to_face_map`.
- `Mesh::normals_domain()` :301 → `Point` (all smooth), `Face` (all sharp), `Corner` (mixed or custom); `vert_normals()` :349, `face_normals()` :415, `corner_normals()` :468 dispatch on it (Corner → `normals_calc_corners`).
- `normals_calc_corners(...)` :1239 — vertex-parallel fan splitting: per vertex collect its corners (`collect_corner_info` :950), mark fan boundaries where `sharp_edges[e]` or either face is `sharp_faces` or the edge is non-manifold (`calc_connecting_edge_info` :1060; `mesh_edges_sharp_tag` :836 also handles angle threshold), walk each smooth fan (`traverse_fan_local_corners` :1097) and `accumulate_fan_normal` :1162 (angle-weighted sum of the fan's face normals; single-corner fan = face normal verbatim); optional `CornerNormalSpaceArray` (`BKE_mesh.hh:158`: `spaces{vec_lnor, vec_ref, vec_ortho, ref_alpha, ref_beta}`, `corner_space_indices`) for custom-normal editing; `short2` custom normals decoded per space (`corner_space_custom_data_to_normal` :711).
- Sharp from angle: `edges_sharp_from_angle_set` :903 / `mesh_sharp_edges_set_from_angle(mesh, angle, keep)` (`mesh.cc:1882`) — the replacement for the removed auto-smooth (4.1+); "Smooth by Angle" is a geometry-nodes modifier writing `sharp_edge`.
- Custom normals `"custom_normal"`: Corner `Int16_2D` (fan-space encoded, `is_corner_fan_normals` :1720; set via `mesh_set_custom_normals*` :1694-1716 which also writes `sharp_edge`) or free `Float3` on Point/Face/Corner (5.x). `BKE_mesh_has_custom_loop_normals` (`mesh.cc:568`) checks `CD_PROP_INT16_2D "custom_normal"` in `bm->ldata` when in edit mode.

### 7.2 BMesh side (`bmesh/intern/bmesh_mesh_normals.cc`, 2394 lines)

- `BM_mesh_normals_update(bm)` :257 → parallel `BM_face_calc_normal` for all faces then `bm_mesh_verts_calc_normals` :209 → per vertex `bm_vert_calc_normals_impl` :85: walk the disk cycle, for each radial loop with `l->v == v` accumulate `f->no * safe_acos_approx(-dot(e1, e2))` (`bm_vert_calc_normals_accum_loop` :66, with an XOR sign fix because `BMEdge` direction is arbitrary). Same weighting as the Mesh path.
- Partial: `BM_mesh_normals_update_with_partial(bm, BMPartialUpdate{verts, faces})` :297 (`bmesh_mesh_partial_update.cc`: `BM_mesh_partial_create_from_verts` :51 collects the moved verts, their faces and the faces' other verts) — used every frame by transform.
- `BM_face_calc_normal` (`bmesh_polygon.cc:824`): 3 → `normal_tri_v3`, 4 → `normal_quad_v3`, else Newell.
- Loop normals in edit mode: `BM_loops_calc_normal_vcos(bm, vcos, vnos, fnos, use_split_normals, r_lnos, r_lnors_spacearr, clnors_data, cd_offset, do_rebuild)` :1684; `BM_lnorspace_update` :1933 / `BM_lnorspace_rebuild` :1805 / `BM_lnorspace_invalidate` :1735 maintain `bm->lnor_spacearr` (dirty flags `BM_SPACEARR_DIRTY_ALL`, `BM_SPACEARR_BMO_SET`); `BMLoopNorEditDataArray` (`bmesh_class.hh:449-467`, `BM_loop_normal_editdata_array_init_with_htype` :2239) is the working set for `MESH_OT_point_normals / merge / split / average / smooth_normals` (`editmesh_tools.cc:8931-9927`).
- Face `BM_ELEM_SMOOTH` ↔ `!sharp_face`; edge `BM_ELEM_SMOOTH` ↔ `!sharp_edge` (conversion §1.3).

### 7.3 Draw path

`extract_mesh_vbo_lnor.cc` `extract_normals_bm` :165 picks per `normals_domain`: Face → `f->no` for all corners; Point → `v->no`; else loop normals from `bm->lnor_spacearr`/`BM_loops_calc_normal_vcos` results (`mr.bm_loop_normals`) — computed in `mesh_render_data_create` when custom normals or sharp edges exist. `extract_mesh_vbo_vnor.cc` writes `v->no` per corner for the vertex-normal overlay. So render normals for a TS port = `normals_calc_corners` over the SoA arrays (or its BMesh twin), packed per corner.

---

## 8. Python API as design reference

### 8.1 `bmesh` module (`python/bmesh/`, `bmesh_py_types.cc` 5715 lines)

Shape:
- `bmesh.new(use_operators=True)`, `bmesh.from_edit_mesh(mesh)` (wraps the live edit BMesh), `bmesh.update_edit_mesh(mesh, loop_triangles=True, destructive=True)` (→ `EDBM_update_extern`), `bm.from_mesh(mesh)`, `bm.to_mesh(mesh)`, `bm.free()`, `bm.copy()`, `bm.normal_update()`, `bm.transform(matrix, filter)`, `bm.calc_volume()`, `bm.calc_loop_triangles()`, `bm.select_mode {'VERT','EDGE','FACE'}`, `bm.select_history` (ordered set: `active, add, remove, discard, validate, clear`), `bm.select_flush(select)`, `bm.select_flush_mode(flush_down=False)`.
- Sequences `bm.verts/edges/faces` (`BMVertSeq` :4240 etc.): `new(co|verts, source=None)` (copies attributes from `source`), `remove(elem)`, `get(verts, fallback)` (edges/faces by verts), `index_update()`, **`ensure_lookup_table()`** (= `BM_mesh_elem_table_ensure`; `seq[i]` raises `IndexError: outdated internal index table` when `elem_table_dirty` :4457), `sort(key, reverse)` (= `BM_mesh_remap`), `.layers.<type>` (`float, int, bool, string, float_vector, float_color, color, deform, shape, skin, uv` per domain; `new/verify/remove/get/keys/items`, `layers.uv["UVMap"]`, `layers.uv.active`), `faces.active`.
- Elements: `BMVert{co, normal, select, hide, tag, index, link_edges, link_faces, link_loops, is_manifold, is_wire, is_boundary, is_valid; select_set, hide_set, copy_from, calc_edge_angle, calc_shell_factor, normal_update}`; `BMEdge{verts, link_faces, link_loops, seam, smooth, is_manifold, is_contiguous, is_convex, is_wire, is_boundary; other_vert, calc_length, calc_face_angle(_signed), calc_tangent}`; `BMFace{verts, edges, loops, normal, material_index, smooth; copy(verts, edges), calc_area, calc_perimeter, calc_center_median(_weighted), calc_center_bounds, calc_tangent_*, normal_update, normal_flip}`; `BMLoop{vert, edge, face, link_loops, link_loop_next/prev, link_loop_radial_next/prev, is_convex; calc_angle, calc_normal, calc_tangent, copy_from_face_interp}`; `elem[layer]` get/set for custom data.
- `bmesh.ops.<opname>(bm, **slot_kwargs) -> dict` (`bmesh_py_ops.cc`, `bmesh_py_ops_call.cc:760`): generated from `bmo_opdefines` (`__dir__` lists all 83); every kwarg optional (defaults from `BMO_op_init`); element buffers accept any sequence of elements or a whole `bm.verts`; enum slots take strings, flag slots sets of strings, mappings dicts; returns `{out_slot_without_.out: [elems] | dict | value}`; fatal BMO errors → `RuntimeError`. Requires `use_operators=True` (tool flags).
- `bmesh.utils` — direct kernel wrappers returning elements: `vert_collapse_edge, vert_collapse_faces, vert_dissolve, vert_splice, vert_separate, edge_split, edge_rotate, face_split, face_split_edgenet, face_join, face_vert_separate, face_flip, loop_separate`.
- `bmesh.geometry.intersect_face_point`.

### 8.2 `bpy.ops.mesh.*`

`python/intern/bpy_operator_function.cc:235-370`: kwargs → RNA props (`pyrna_pydict_to_props`), `WM_operator_call_py(C, ot, context, ptr, reports, is_undo)`; returns `{'FINISHED'}`-style sets; needs a context (3D view, edit object) to poll. Macros take nested dicts: `bpy.ops.mesh.extrude_region_move(TRANSFORM_OT_translate={"value": (0,0,1), "orient_type": 'NORMAL', "constraint_axis": (False,False,True)})`.

### 8.3 What to mirror in TS (humans + agents)

1. Two layers, as Blender: a **kernel** (`BMesh` + `ops.*` generated from a slot table) and a **tool** layer (`mesh.*` operations with UI semantics: selection-driven input, selection-updated output, undo push, redo props). Agents should mostly use the kernel with explicit element sets; humans use tools via keymap.
2. `ops.extrudeFaceRegion(bm, { geom, useNormalFlip: false, … })` → `{ geom: BMElem[] }`: kwargs object with defaults from the table, returned **object of output buffers** (strip `.out`), enum slots as string-literal unions, flag slots as `Set<…>`/arrays, mappings as `Map<BMElem, T>`. Generate `.d.ts` + runtime defaults from one op-definition table so `dir()`/docs/typing are free.
3. Element buffers accept iterables of elements or whole sequences; validate htype and same-BMesh ownership (Blender's `bpy_slot_from_py_elem_check`).
4. Explicit invalidation, not implicit recompute: `elem.select` is a plain flag; `bm.selectFlush()/selectFlushMode()`, `bm.normalUpdate()`, `bm.verts.indexUpdate()`, `ensureLookupTable()` are explicit calls (make `bm.verts.at(i)` auto-rebuild lazily instead of throwing).
5. `select → op → select output → next op` chaining is the native idiom (`EDBM_op_call_and_selectf`); expose `selectOnly(elems)` helpers and `bm.selectHistory` as an ordered set with `.active`.
6. Skip the `bpy.ops` plumbing (context overrides, poll, report lists, execution-context strings, `{'FINISHED'}`); keep only the concept of an operator descriptor `{id, props with defaults, exec(ctx, props), invoke/modal optional}` so the redo panel and undo grouping work.

---

## 9. Modifiers & evaluation (brief)

- Stack evaluation lives in `blenkernel/intern/mesh_data_update.cc` (1355 lines): `mesh_data_update` :1103 → `mesh_calc_modifiers` :271 (object mode) or `editbmesh_calc_modifiers` :739 (edit mode). Edit mode starts from `BKE_mesh_wrapper_from_editmesh(edit_mesh, mask, mesh_input)` :783 — a `Mesh` with `runtime->wrapper_type = ME_WRAPPER_TYPE_BMESH` that is **not** converted until a modifier needs arrays (`BKE_mesh_wrapper_ensure_mdata`, `mesh_wrapper.cc:79` → `BM_mesh_bm_to_me_for_eval`); deform-only modifiers with `deform_verts_EM` operate on `runtime->edit_data->vert_positions` (deformed cage) without flattening (:838-848). The cage index (`eModifierMode_OnCage`, `BKE_modifiers_get_cage_index`, `modifier.cc:474`) decides which intermediate result is drawn as the editable cage (`mesh_cage`) vs the final (`mesh_final`).
- `ModifierTypeInfo` (`BKE_modifier.hh:187`): `type` (`OnlyDeform | Constructive | Nonconstructive | NonGeometrical`), flags (`SupportsEditmode`, `EnableInEditmode`, `SupportsMapping`, `RequiresOriginalData`, **`AcceptsBMesh` :129**), callbacks `deform_verts`, `deform_verts_EM`, `modify_mesh(md, ctx, Mesh*) -> Mesh*`, `modify_geometry_set`. `BKE_modifier_modify_mesh` (`modifier.cc:963`) flattens the BMesh wrapper unless `AcceptsBMesh`.
- Accessors: `BKE_object_get_evaluated_mesh` (`object.cc:4369`), `BKE_object_get_pre_modified_mesh` :4377 (`runtime->data_orig`).
- Representation per modifier: Mesh arrays — subsurf (`MOD_subsurf.cc` → `subdiv_mesh.cc`, OpenSubdiv), mirror (`BKE_mesh_mirror_apply_mirror_on_axis_for_modifier` + `geometry::mesh_merge_verts`), array, solidify (`MOD_solidify_extrude.cc` 1155 / `_nonmanifold.cc` 2694, zero BMesh), weld (`geometry::mesh_merge_by_distance_*`), screw, smooth, displace, nodes (GeometrySet). **BMesh internally** — bevel (`BM_mesh_bevel`, though `geometry/intern/mesh_bevel.cc` is an 8.2k-line SoA port now), triangulate (`BM_mesh_triangulate`; SoA `GEO_mesh_triangulate.hh`), edge split (`BM_mesh_edgesplit`; SoA `geometry::split_edges`), decimate (`BM_mesh_decimate_*`), wireframe (`BM_mesh_wireframe`), boolean (BMesh solver via `BM_mesh_boolean`; exact/manifold via `geometry::boolean::mesh_boolean`).
- `geometry/GEO_*.hh` is the SoA algorithm module (merge verts, triangulate, split edges, bevel, boolean, primitives cuboid/cylinder-cone/grid/uv-sphere/line, copy selection, reorder, join/separate/realize). The geometry-nodes extrude (`nodes/geometry/nodes/node_geo_extrude_mesh.cc`, 1575 lines) is the reference for an SoA extrude if one is ever needed: grow all domains in place (`expand_mesh` :132), classify boundary vs inner edges, allocate contiguous ranges for new verts/edges/side faces, re-point the selected faces' corners to the new ring, build side quads with winding from the adjacent face (`fill_quad_consistent_direction` :484), gather/mix attributes.

Plan implication: a TS modifier stack should run on the SoA `EditableMesh` (Mesh-like), with modifiers declaring `deform` vs `constructive` and an "on cage" flag; BMesh-based algorithms (bevel/wireframe/decimate) can be exposed to the stack by `bmFromMesh → op → bmToMesh` exactly like `MOD_bevel.cc`.

---

## 10. Primitives (`bmesh/operators/bmo_primitive.cc`, 1736 lines)

All ops take `matrix` (applied to every vertex) and `calc_uvs` (writes the active UV layer, `BM_mesh_calc_uvs_*`), mark created verts with a tool flag and output `verts.out`; `editmesh_add.cc` wraps them as `MESH_OT_primitive_*_add` (:271-813) with `ED_object_add_generic_props` (location/rotation/scale/align) and enters/extends edit mode.

- **Cube** `bmo_create_cube_exec` :1617 — 8 verts from `x,y,z ∈ {-1,+1} * size/2`, 6 quads with a fixed corner table `faces[6][4] = {{0,1,3,2},{2,3,7,6},{6,7,5,4},{4,5,1,0},{2,6,4,0},{7,3,1,5}}`; UVs `BM_mesh_calc_uvs_cube` :1677 (cross layout).
- **Grid** :719 — `(x_segments+1)*(y_segments+1)` verts in `[-size/2, size/2]`, quads per cell; UVs :783.
- **Circle** :1246 — `segments` verts on radius, wire edges; `cap_ends` → n-gon (tri fan + `dissolve_faces` unless `cap_tris`); UVs :1327.
- **Cone / cylinder** :1363 — two rings (`radius1`, `radius2`, `depth`), side quads (`BM_face_create_quad_tri`), caps as tri fans around centre verts dissolved into n-gons unless `cap_tris`; cylinder = cone with equal radii (`MESH_OT_primitive_cylinder_add` :474); UVs :1512.
- **UV sphere** :845 — half-circle of `v_segments` edges built from `sin_cos_from_fraction`, then `u_segments` × (`extrude_edge_only` + `rotate` about Z), `remove_doubles` at the poles (`dist = min(len, len2)/3`); UVs :1124.
- **Ico sphere** :965 — 12 `icovert` :29 / 20 `icoface` :44 triangles, then `subdivide_edges cuts=(1<<(subdiv-1))-1 use_grid_fill=1 use_sphere=1` (projects new verts to the sphere), radius applied after; UVs via `bm_mesh_calc_uvs_sphere_face` :1056.
- **Monkey** :1165 — data tables `monkeyv[271][3]` :71 (signed char, decoded `v = (mv+127)/128`, axes remapped y↔−z :1180-1182) and `monkeyf[250][4]` :129 (relative indices; tris when `[3]` unused), mirrored across X (`monkeyo`); 500 faces.

Port these tables verbatim for topology parity with Blender (important for tests against blend-file imports).

---

## Port plan implications

### Data structure

```ts
// canonical / serialized / render source (mirror of Blender Mesh) — Node-safe
interface MeshData {
  vertsNum: number; edgesNum: number; facesNum: number; cornersNum: number;
  faceOffsets: Int32Array;            // facesNum + 1
  attributes: Attribute[];            // { name, domain: 'point'|'edge'|'face'|'corner', type, data: TypedArray }
  //   required: position Float32Array(3n), .edge_verts Int32Array(2e), .corner_vert Int32Array(c), .corner_edge Int32Array(c)
  //   builtin optional: .select_vert/.select_edge/.select_poly (Uint8), .hide_*, sharp_edge, sharp_face, uv_seam,
  //   material_index Int32, custom_normal (corner Int16x2 or float3), crease_*, bevel_weight_edge, UV maps float2, colours
  select: { history: {type: 'vert'|'edge'|'face'; index: number}[]; activeFace: number; selectMode: number };
  // runtime caches (not serialized): faceNormals, vertNormals, cornerNormals, looseEdges/Verts, vertToFace map, bounds, tessellation
}

// edit-mode working copy (mirror of BMesh) — the only thing operators touch
class BMVert { co: Vec3; no: Vec3; e: BMEdge|null; hflag: number; index: number; data: CDBlock; oflags: Int16Array }
class BMEdge { v1: BMVert; v2: BMVert; l: BMLoop|null; v1Disk: {next, prev}; v2Disk: {next, prev}; hflag; index; data; oflags }
class BMLoop { v: BMVert; e: BMEdge; f: BMFace; radialNext; radialPrev; next; prev; hflag; index; data }
class BMFace { lFirst: BMLoop; len: number; no: Vec3; matNr: number; hflag; index; data; oflags }
class BMesh  { totvert/totedge/totloop/totface; totvertsel/…; elemIndexDirty; elemTableDirty; vtable/etable/ftable;
               vdata/edata/ldata/pdata: CustomDataLayout; selectMode; selected: BMEditSelection[]; actFace;
               toolflagIndex; errorStack }
```
`CDBlock` = one `Float32Array`/`ArrayBuffer` per element sized by the domain's layout (offset-based like Blender), so `BM_ELEM_CD_GET_*` ports as `view[offset]`, interpolation ports as-is, and `bmToMesh` is a gather into attribute arrays. Header flags as in Blender (`SELECT=1, HIDDEN=2, SEAM=4, SMOOTH=8, TAG=16`); operator flags in per-op layers (`oflags[toolflagIndex]`).

Render: `BufferGeometry` built from `MeshData` — position gathered per corner (or per split-normal group), index from tessellation (port `bmesh_calc_tessellation_for_face_impl`: tri/quad/ear-clip via a `polyfill_2d` port), normals from `normals_calc_corners`; overlay buffers (`EditData`-style per-corner flag bytes, face dots, select ids) exactly like `extract_mesh_vbo_edit_data.cc`.

### Operator / slot API

- One table `opDefs` mirroring `bmo_opdefines.cc` (`name, slotsIn, slotsOut, exec, typeFlags`), slot types `bool|int|float|vec3|mat3|mat4|elems(V|E|F, single?)|map(elem→elem|float|int|bool|set)|enum|flags`.
- Runtime `ops.call(bm, name, args)` = `opInit` (defaults) → fill slots (validate htype/same-bm) → `opExec` (push flag layer; at depth 1 `editBegin/editEnd` handling `NORMALS_CALC`, `SELECT_FLUSH`, `SELECT_VALIDATE`) → collect outputs → `opFinish`. Generated typed wrappers `ops.extrudeFaceRegion(bm, {...}): {geom: BMElem[]}`.
- Composition inside ops uses the same API (`ops.duplicate(bm, {geom})` returning maps), never header flags.
- Kernel functions (`vertCreate/edgeCreate/faceCreate/kill*`, `splitFaceMakeEdge`, `splitEdgeMakeVert`, `joinEdgeKillVert`, `joinVertKillEdge`, `joinFaceKillEdge`, `facesJoin`, `vertSplice/Separate`, `edgeSplice`, `loopReverse`), mods (`faceSplit`, `edgeSplit`, `edgeRotate`, `vertCollapse*`, `vertDissolve`), queries, walkers, interp — ported from `bmesh/intern`.

### Modal tool state machine (transform-style, reusable by inset/bevel/loop-cut)

```
Tool { state: STARTING|RUNNING|CONFIRM|CANCEL; props (redo-able); backup (MeshData snapshot or BMesh copy);
       numInput; modifiers {precision, snap, snapInvert}; constraint {axes, orientation}; pivot; propEdit }
invoke(event): init from selection (TransData: loc ref, iloc, center, axismtx, factor); mode.init(); apply once
event(e):  numeric input → | mousemove → mode.input(mval) → values | modal keymap (X/Y/Z, Shift+XYZ, C, G/R/S switch, Shift precision,
           Ctrl snap invert, wheel prop size, Alt options) | release of launch key with releaseConfirm → CONFIRM | mode.handleEvent
apply():   selectConstraint; mode.transform(values → values_final via snap/constraint/numinput) → per-element update (× factor) → recalc (partial normals/looptris) → redraw
end():     CANCEL → restore iloc (or restore backup for topology tools) ; CONFIRM → aftertrans (automerge, uv correct), commit → bmToMesh → undo push, register props for redo
redo(props): undo pop → exec(props) (every modal tool needs a pure exec)
```
Inset/bevel/loop-cut follow the "restore backup, re-run op with current props" loop (`edbm_inset_calc`) instead of TransData.

### Undo strategy

`MeshData` snapshot per committed operator (all attribute arrays + offsets + select history + selectMode + active), stored through a chunked, content-hashed array store ported from `BLI_array_store` (chunk = 64 KiB / stride, RLE for boolean layers, reference = previous snapshot of the same mesh). Restore = rebuild BMesh from the snapshot; looptris/normals recomputed. Redo panel = undo pop + re-exec with props (`ED_undo_operator_repeat`).

### Selection model

Per-element flags on BMesh + counters; `selectMode` bitmask (vert/edge/face, combinable); `vertSelectSet/edgeSelectSet/faceSelectSet` with Blender's down-propagation rules; `selectModeFlush` (up: vert→edge iff both, edge→face iff all; down only on mode change); ordered `selectHistory` with `active`; hidden elements never selectable; mode switch = strip history + re-flush (`EDBM_selectmode_set`). Picking: nearest-in-screen-space with vert>edge>face priority and a pixel margin, plus a select-id render target (per-element ids in a vertex attribute → offscreen render → readback) for occluded picking, box/lasso/circle; ray-cast (BVH over looptris) for knife/poly-build/snapping.

### Prioritised port order (`wc -l`, `bmesh/operators/`, tools in `bmesh/tools/`)

Foundation first (`bmesh/intern`, ~34k lines total; the essential subset): `bmesh_core.cc` 3021, `bmesh_structure.cc` 573, `bmesh_mesh.cc` 1368, `bmesh_iterators.cc` 661, `bmesh_query.cc` 2505, `bmesh_polygon.cc` 1528, `bmesh_construct.cc` 714, `bmesh_interp.cc` 1333, `bmesh_marking.cc` 1639, `bmesh_delete.cc` 365, `bmesh_mods.cc` 906, `bmesh_mesh_convert.cc` 2188, `bmesh_mesh_tessellate.cc` 567 (+ `blenlib/intern/polyfill_2d.cc`), `bmesh_mesh_normals.cc` 2394 (vertex/face part first), `bmesh_operators.cc` 1912 + `bmesh_opdefines.cc` 3001 (slot machinery + table), `bmesh_walkers.cc` + `_impl.cc` 2079, `bmesh_edgeloop.cc` 803.

Then operators, in order of user value / dependency:
1. `bmo_utils.cc` 772 (translate/rotate/scale/smooth/reverse/region_extend) + `bmo_dupe.cc` 747 (duplicate/split/delete/spin) — needed by almost everything.
2. `bmo_extrude.cc` 866 (all extrudes, solidify) + `bmo_primitive.cc` 1736 (Add Mesh).
3. `bmo_create.cc` 299 (F key) + `bmo_removedoubles.cc` 930 (merge, remove doubles, collapse) + `bmo_dissolve.cc` 969 (dissolve/limited) + `bmo_split_edges.cc` 36 (rip/edge split).
4. `bmo_inset.cc` 1372 + `bmo_subdivide.cc` 1447 (subdivide + loop-cut backend) + `bmo_connect*.cc` (220/745/214/174: J, vert connect path) + `bmo_rotate_edges.cc` 271 + `bmo_normals.cc` 303 (recalc outside) + `bmo_triangulate.cc` 295 + `bmo_join_triangles.cc` 1149.
5. `bmo_bridge.cc` 668, `bmo_fill_holes.cc` 70 (+ `bmo_edgenet.cc` 239, `bmo_fill_edgeloop.cc` 142, `bmo_fill_grid.cc` 734), `bmo_poke.cc` 135, `bmo_offset_edgeloops.cc` 271, `bmo_subdivide_edgering.cc` 1255, `bmo_mirror.cc` 110 / `bmo_symmetrize.cc` 104, `bmo_bisect_plane.cc` 98 + `tools/bmesh_bisect_plane.cc` 544.
6. `bmo_bevel.cc` 96 + `tools/bmesh_bevel.cc` 8485 (large but self-contained; the single most-used modelling tool after extrude/inset).
7. `tools/bmesh_path.cc` 596 / `bmesh_path_region.cc` 482 (Ctrl+click path), `tools/bmesh_intersect_edges.cc` 1057 (auto-merge & split), `tools/bmesh_edgenet.cc` 482, `tools/bmesh_beautify.cc` 399, `tools/bmesh_triangulate.cc` 159, `tools/bmesh_edgesplit.cc` 120, `tools/bmesh_separate.cc` 110.
8. Later: `bmo_wireframe.cc` + `tools/bmesh_wireframe.cc` 590, `bmo_hull.cc` 606, `bmo_smooth_laplacian.cc` 500, `bmo_circularize.cc` 747 / `bmo_flatten.cc` 128 / `bmo_space_edge_loops_evenly.cc` 415 / `bmo_planar_faces.cc` 134, `tools/bmesh_decimate_*.cc` (1549+578+305), `tools/bmesh_intersect.cc` 1670 + `bmesh_boolean.cc` 496, `tools/bmesh_region_match.cc` 1462, `bmo_unsubdivide.cc` 47, `bmo_fill_attribute.cc` 160.

Editor-layer sources to port alongside (`editors/mesh/`): `editmesh_utils.cc` 2118 (EDBM_* wrappers), `editmesh_select.cc` 6671 (pick/loop/ring/more-less/linked/mode switching), `editmesh_path.cc` 990, `editmesh_extrude.cc` 933, `editmesh_inset.cc` 634, `editmesh_bevel.cc` 1269, `editmesh_loopcut.cc` 780 (+ `editmesh_preselect_edgering.cc`), `editmesh_rip.cc` 1151, `editmesh_knife.cc` 4932, `editmesh_bisect.cc`, `editmesh_add.cc`, `editmesh_tools.cc` 10064 (one operator at a time), `editmesh_undo.cc` 1341 + `blenlib/intern/array_store.cc` 2050; and `editors/transform/` (`transform.cc`, `transform_generics.cc`, `transform_convert.cc`, `transform_convert_mesh.cc`, `transform_constraints.cc`, `transform_orientations.cc`, `transform_input.cc`, `transform_snap*.cc`, `transform_mode_{translate,rotate,resize,shrink_fatten,edge_slide,vert_slide}.cc`, `editors/util/numinput.cc`).

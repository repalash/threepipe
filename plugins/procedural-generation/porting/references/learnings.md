# General Porting Learnings

Read this reference for common pitfalls encountered across multiple .blend file ports.

## Table of Contents
- [Asset references](#asset-references-live-on-the-modifier-not-the-node)
- [Hidden assets](#hidden-assets-need-view-layer-linking-for-export)
- [Instance identity](#nested-geometry-node-instances-lose-source-identity)
- [Socket defaults](#extraction-script-socket-defaults-may-be-misleading)
- [GLB geometry transforms](#glb-geometry-does-not-include-node-transforms)
- [GLB triangle ordering](#glb-triangle-ordering-differs-from-blenders-internal-order)
- [Subdivision topology](#subdivision-surface-requires-original-quad-topology)
- [Blender 5.0 changes](#blender-50-gltf-exporter-changes)
- [AProceduralGenerator vs GraphModule](#procedural-mesh-generators-use-aproveceduralgenerator-not-graphmodule)
- [Graph output types](#graph-outputs-instances-or-mesh-vertex-data)

## Asset references live on the modifier, not the node

ObjectInfo and CollectionInfo nodes in the graph often have empty `pointer_refs` -- the actual object/collection is assigned via the modifier's input overrides, not on the node socket default. The extraction script's JSON captures these in `modifiers[].input_overrides` as `{"_ref": "OBJECT", "name": "..."}`. Always check both the node tree AND modifier overrides when discovering referenced assets.

## Hidden assets need view layer linking for export

Assets referenced by geometry nodes are often in collections not linked to the scene's active view layer. Blender's glTF exporter requires objects to be selectable (in the view layer). The export script temporarily links collections/objects to the scene collection before export and unlinks them after. Without this, `obj.select_set(True)` throws `RuntimeError: Object cannot be selected because it is not in View Layer`.

## Nested geometry node instances lose source identity

Blender's depsgraph Python API cannot access instance domain attributes. When geometry nodes use ObjectInfo -> Instance on Points -> Join Geometry, the depsgraph reports the parent object name for all joined instances instead of the individual module names.

**Impact:** The ground truth export captures correct positions/rotations/matrices for all instances, but `object_name` may show the parent object (e.g. "Building 1") instead of the actual module (e.g. "B1 Window") for instances created inside geometry nodes.

**What still works:**
- Collection-instanced objects (extras, props) get correct source names
- All instance positions, rotations, and scales are accurate
- Instance count is accurate

**Verification strategy:** For instances with unresolved source names, verify positions only. The module assignment is deterministic from the procedural logic -- if positions match, modules match.

## Extraction script socket defaults may be misleading

The extraction script captures each socket's `default_value` field. For unlinked sockets, this IS the value used. But the `default_value` shown may be Blender's **UI socket default** (e.g. 0.5 for ShaderNodeMath ADD.Value_001), not the value the user typed in.

**Workaround:** Don't trust socket defaults for critical formulas. Derive them empirically from the ground truth by solving for the unknown value. Or temporarily link the socket to the Group Output and evaluate.

## GLB geometry does NOT include node transforms

When loading a GLB via three.js GLTFLoader, `mesh.geometry` contains raw vertex data in the mesh node's LOCAL space. Transforms like the Z->Y coordinate conversion, object positions, and rotations are stored in the node hierarchy (`mesh.matrixWorld`), NOT in the vertex buffer. If you extract geometry for computation (scatter, distance calculations, etc.), you MUST apply the world matrix first:
```typescript
obj.updateMatrixWorld(true)
const geom = child.geometry.clone()  // clone to avoid mutating shared/cached buffer
geom.applyMatrix4(child.matrixWorld)
```
Without this, scatter positions will be in the wrong coordinate frame -- rotated, offset, or both. The `loadAssets` function in GraphViewer.ts handles this automatically.

## GLB triangle ordering differs from Blender's internal order

The glTF exporter reorders vertices and faces for GPU cache optimization. Scatter algorithms seeded per-triangle (`hash2(tri_i, seed)`) will produce different individual positions than Blender, even with identical RNG. For scatter-based systems (grass, flowers), this is acceptable -- the density distribution matches but specific positions differ. For exact position matching, you would need to export mesh data in Blender's internal order (custom Python export, not glTF).

## Subdivision Surface requires original quad topology

GLB export triangulates all faces, which changes the result of Catmull-Clark subdivision (different edge topology -> different face/edge points -> different vertex positions). When a node tree uses SubdivisionSurface on a mesh with quads, export the **original topology** (positions + quad face indices) separately. Use a Blender Python snippet to dump `mesh.vertices[].co` and `mesh.polygons[].vertices` to JSON, then convert to a TypeScript data file. This is source data (artist-authored mesh topology), not pre-baked computed output -- it's equivalent to exporting a GLB.

Use `catmullClark(positions, faces, level)` from the library with the original topology, not `subdivisionSurface(geometry, level)` on a GLB-loaded BufferGeometry.

## Blender 5.0 glTF exporter changes

The `export_colors` parameter was removed from `bpy.ops.export_scene.gltf()` in Blender 5.0. Distro-packaged Blender (e.g. Alpine) may not bundle `numpy` which the glTF exporter requires -- install it separately if you get `ModuleNotFoundError: No module named 'numpy'`. Official Blender downloads bundle numpy.

## Procedural mesh generators use AProceduralGenerator, not GraphModule

Generators that create mesh geometry (like the flower) should use `AProceduralGenerator` with `ProceduralGeneratorPlugin` -- not `GraphModule` with `GeneratedInstance[]`. `AProceduralGenerator` provides auto-UI, dirty-flag regeneration, and the Generate dropdown. The graph system (`GraphModule`) is for instance-placement generators where selective recompute between independent nodes matters.

For **composing** both types (e.g., flowers on a building), use a graph where:
- Building nodes output `GeneratedInstance[]` (placed from GLB assets)
- Procedural mesh nodes output plain vertex data (Node-safe arrays)
- The viewer renders both via runtime type detection

See `examples/flowers-on-building/graph.ts` for a complete example.

## Graph outputs: instances or mesh vertex data

The `OutputRef` in `GraphModule.graphs[].outputs` is type-agnostic -- it points to any node output. The viewer and comparison script detect the type at runtime:
- `GeneratedInstance[]` (array with `world_matrix`) -> placed from loaded GLB assets
- Plain data object with `rings` (vertex arrays + placement positions) -> built into BufferGeometry
- `null` -> skipped

All outputs should be **plain data** (no three.js types) so they work in both Node.js (comparison) and browser (rendering).

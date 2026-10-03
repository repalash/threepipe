# Edit mode on a document mesh: vertices carry the Select flag but `tot*sel` is 0, so Select All is a no-op

**Found**: 2026-10-03, while building the editor shell (`plugins/modelling-editor`), in the browser.

## Repro

```js
// examples/modelling-editor (or any scene where ModellingPlugin provides the mesh)
await engine.run('add.cube')          // ModellingPlugin `primitive` command
engine.setMode('edit')                // MeshEditPlugin.enter() -> EditMeshState.fromMeshData(entry.mesh.clone())
const bm = engine.meshEdit.state.bm
;[...bm.verts].map(v => v.hflag)      // [1, 1, 1, 1, 1, 1, 1, 1]  (ElemFlag.Select already set on every vertex)
bm.totvertsel                         // 0
engine.meshEdit.selectAllElements()
bm.totvertsel                         // still 0  (vertSelectSet sees the flag already set and does not count)
```

The same cube built from `BoxGeometry` (triangle-weld path, `examples/mesh-edit-plugin`) selects fine:
`tests/interactive.spec.ts` `mesh-edit-plugin` gets 48 selected faces after `selectAllElements()`.

## Where

- `plugins/mesh-kernel`: building a `BMesh` from `MeshData` (`EditMeshState.fromMeshData` →
  `meshDataToBMesh` or equivalent) copies element flags but does not recompute `totvertsel` /
  `totedgesel` / `totfacesel` from them. Blender's `BM_mesh_bm_from_me` calls
  `BM_mesh_select_mode_flush` / recounts after loading flags.
- Alternatively the `primitive` command's `MeshData` should not have every vertex flagged selected
  (Blender's primitives do select the new geometry, so keeping the flag and recounting is the
  faithful fix).

## Effect

In the editor, `Select All` / `A` reports `0/8` vertices selected, the status bar and the face
highlight never change, and every operator that polls `totvertsel > 0` (extrude, move, merge,
delete) refuses with "select some elements first" on a freshly added primitive until the user
clicks a vertex, which deselects all (`selectNone` resets the counters) and selects one.

## Suggested fix

After the flags are loaded, recount: iterate verts/edges/faces and set the three counters from
`hflag & ElemFlag.Select`, then `selectFlushMode`. Add a unit test in `plugins/mesh-kernel` that
round-trips a `MeshData` with selected elements and asserts the counters.

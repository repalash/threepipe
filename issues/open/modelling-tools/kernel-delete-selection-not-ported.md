# kernel: `deleteSelection` and `mergeVerts` are not ports of Blender's delete and point-merge

**Found**: 2026-10-18, track0-followups (wiring Merge At Cursor / Collapse and Delete Loose).

`plugins/mesh-kernel/src/ops/duplicate.ts`:

- `deleteSelection(bm, context)` cites `BM_mesh_delete_hflag_context` but its `faces` context is its own
  walk (kill the faces, then any touched edge left without a face, then any touched vertex left without an
  edge), not Blender's `DEL_FACES` marking (mark every edge and vertex of the flagged faces, unmark those of
  unflagged faces and of unflagged edges, kill the rest). They differ for wire edges and loose vertices
  touching the deleted faces. It is still used by the editor's X / Delete (`MeshEditPlugin.deleteSelected`)
  and plugin-modelling's `deleteElements`.
- `mergeVerts` / `mergeSelectedVerts` cite `bmo_pointmerge_exec` but merge by hand (keep `verts[0]`, kill
  collapsing faces) instead of `weld_verts`. The editor no longer uses them: Merge is `mergeSelection`
  (`ops/collapse.ts`, `merge_target` / `merge_firstlast` / `bmo_pointmerge_exec` / `bmo_collapse_exec`,
  parity-tested against Blender 5.2.2). Only their own unit tests call them.

**Fix**: the faithful `BM_mesh_delete_hflag_context` is now `bmesh/delete.ts` (`meshDeleteHflagContext`);
port `edbm_delete_exec` (`editmesh_tools.cc:445`) over it (with `BMO_mesh_delete_oflag_context` for the
operator contexts it uses), move `deleteSelected` and plugin-modelling's `deleteElements` onto it with a
Blender fixture, and retire `mergeVerts` / `mergeSelectedVerts` (or make them call `pointmerge`).

# mesh-edit: the edit session does not keep normals current

**Found**: 2026-10-03, merging p3-fill and p3-loop.

Blender's edit mesh has current face and vertex normals whenever an operator starts: `EDBM_update`
recalculates them after every operator, and `bmesh_edit_end` does so for every bmesh operator whose
`type_flag` has `BMO_OPTYPE_FLAG_NORMALS_CALC`. Several ported operators read normals on entry:
- Subdivide Edge-Ring's surface blend;
- Bridge;
- Grid Fill;
- the smoothing in Subdivide and Loop Cut;
- Bevel and Inset.

`MeshEditPlugin` does not maintain them. Each caller refreshes them itself:
- `ops/bevel-bmquery.ts` `normalsUpdate` and `ops/inset.ts`, on entry, documented as a deliberate side effect;
- `loopOps.ts`, before Subdivide and Loop Cut;
- `fillOps.ts` `runSession`, before every fill operator.

There are two refresh functions as well: `bmesh/normals.ts` `meshNormalsUpdate` and
`ops/bevel-bmquery.ts` `normalsUpdate`.

**Fix**: refresh the normals in the session, wherever Blender's `EDBM_update` would run:
- after `commit` and `revert`;
- after a transform ends;
- on entering edit mode.

Then remove the per-operator calls and keep one `meshNormalsUpdate`.

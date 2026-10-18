# plugin-procedural: Blender writes shared loose-edge end points from parallel tasks (a data race)

**Found by**: track2-procedural, 2026-10-18, case `subdivSurface/ss-uniform-l2` ("pass (<= 1 ulp)": 1 of 1893 position values).

`subdiv_foreach_vertices_of_loose_edges_task` (`subdiv_foreach.cc:1628`) runs per coarse loose edge with
`BLI_task_parallel_range` (:1808). It calls `vert_of_loose_edge` for **every** point of the edge, including the end
points, `u = 0` and `u = 1`. For smooth (Catmull-Clark) subdivision, `subdiv_mesh_vert_of_loose_edge` (`subdiv_mesh.cc:1462`)
then writes the end vertex's position from `mesh_interpolate_position_on_edge`. That is a B-spline through the edge
and its neighbours, so at `u = 0` it is not the coarse position.

When two loose edges share a vertex, both tasks write that vertex. Their B-spline neighbourhoods differ, so the two
values differ in the last bits, and the result is whichever thread writes last.
- In `ss-uniform-l2` the vertex is shared by edges 36 and 51.
- This port runs the edges in ascending order, so edge 51's value is final.
- On the reference run, edge 36's value was final.

The port is not wrong. Blender's result depends on scheduling. Options:
1. Accept 1 ulp on such vertices. This is the current status.
2. Report it upstream: the end points should be skipped, or written once.

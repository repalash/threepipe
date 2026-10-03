"""
Ground truth for the edge slide port (`transform/slide.ts`), written by Blender.

    xvfb-run -a blender --factory-startup --python plugins/mesh-edit/tests/fixtures/gen-slide-fixtures.py

Edge slide reads the 3D view (it projects the slide directions to pick the reference vertex and to
orient several loops alike), so this runs with a window under Xvfb, not `--background`, and calls
`bpy.ops.transform.edge_slide` with a `temp_override` on the startup file's 3D viewport. Each case
records the view's matrices and region size so the test can rebuild the same `TransformView`; exec
runs with the cursor at the region's corner (`mval = (0, 0)`, `initTransInfo` without an event).

A case is a mesh from explicit coordinates and faces (`Mesh.from_pydata`), its edges in Blender's
order (the kernel creates a face's edges in a different order, see
`issues/open/mesh-kernel-face-create-edge-order.md`, so the test creates these first), the selected
edges as vertex-index pairs, the operator's properties, and every vertex position afterwards.

Blender here is 3.4.1, whose slide data creation predates the 4.x rewrite this port follows
(`SlideTempDataMesh` in `transform_convert_mesh.cc:2414`, with the #144270 cone check). 3.4.1 builds
the directions with `get_next_loop` (`transform_mode_edge_slide.c:204` in 3.4.1): at a corner of the
selected path it averages the edge vectors instead of intersecting the neighbouring targets, and beside
an n-gon it slides along `cross(f->no, tdir)` scaled to the opposite edge's distance instead of to the
opposite edge's point. So the cases are only the topologies where both give the same directions: quad
loops, open and closed, boundary loops, and two loops (the per-loop orientation from the view). Corners
and n-gon sides are tested by hand from the current source in `slide.test.ts`.

Nothing in the output is hand-written; rerun this script to regenerate `slide.json` beside it.
"""

import bpy
import bmesh
import json
import os
import sys


def grid(xs, ys, lift=None):
    co = []
    for y, yy in enumerate(ys):
        for x, xx in enumerate(xs):
            co.append([xx, yy, lift.get((x, y), 0.0) if lift else 0.0])
    faces = []
    n = len(xs)
    for y in range(len(ys) - 1):
        for x in range(n - 1):
            a = y * n + x
            faces.append([a, a + 1, a + n + 1, a + n])
    return co, faces


def column_edges(nx, ny, x):
    return [[y * nx + x, (y + 1) * nx + x] for y in range(ny - 1)]


def row_edges(nx, y):
    return [[y * nx + x, y * nx + x + 1] for x in range(nx - 1)]


# A box with a horizontal ring at an uneven height: the ring is a closed quad loop.
RING_CO = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 0.2], [1, -1, 0.2], [1, 1, 0.2], [-1, 1, 0.2],
    [-1.2, -1.1, 1], [1.1, -0.9, 1], [1, 1.2, 1], [-1, 1, 1.1],
]
RING_FACES = [
    [0, 3, 2, 1],
    [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
    [4, 5, 9, 8], [5, 6, 10, 9], [6, 7, 11, 10], [7, 4, 8, 11],
    [8, 9, 10, 11],
]
RING_SEL = [[4, 5], [5, 6], [6, 7], [7, 4]]

GRID_XS = [0.0, 1.0, 1.6, 3.0, 3.5]
GRID_YS = [0.0, 0.7, 2.0, 2.4]
GRID_CO, GRID_FACES = grid(GRID_XS, GRID_YS, {(2, 1): 0.4, (1, 2): -0.3})
NX, NY = len(GRID_XS), len(GRID_YS)
# The same grid with each row's faces created as columns 0, 1, 3, 2: an edge's first radial loop is
# the last face created on it (`bmesh_radial_loop_append`), so column 1's edges start on their right
# face and column 3's on their left, and the two loops' sides come out opposite until
# `calcEdgeSlide_mval_range` lines them up with the view.
GRID_FACES_MIXED = [GRID_FACES[r * (NX - 1) + c] for r in range(NY - 1) for c in (0, 1, 3, 2)]

SLIDE_PROPS = [
    {'value': 0.5},
    {'value': -0.3},
    {'value': 1.5},
    {'value': 0.4, 'use_even': True},
    {'value': 0.4, 'use_even': True, 'flipped': True},
    {'value': -0.6, 'use_even': True},
    {'value': 1.5, 'use_clamp': False},
    {'value': -1.3, 'use_clamp': False},
]

CASES = [
    ('ring', RING_CO, RING_FACES, RING_SEL),
    ('grid-column', GRID_CO, GRID_FACES, column_edges(NX, NY, 2)),
    ('grid-boundary-row', GRID_CO, GRID_FACES, row_edges(NX, 0)),
    ('grid-two-columns', GRID_CO, GRID_FACES, column_edges(NX, NY, 1) + column_edges(NX, NY, 3)),
    ('grid-two-columns-mixed', GRID_CO, GRID_FACES_MIXED, column_edges(NX, NY, 1) + column_edges(NX, NY, 3)),
]


def view_context():
    win = bpy.context.window_manager.windows[0]
    area = [a for a in win.screen.areas if a.type == 'VIEW_3D'][0]
    region = [r for r in area.regions if r.type == 'WINDOW'][0]
    return win, area, region


def col_major(m):
    return [m[r][c] for c in range(4) for r in range(4)]


def run_case(name, co, faces, sel, props):
    me = bpy.data.meshes.new(name)
    me.from_pydata(co, [], faces)
    me.update()
    mesh_edges = [list(e.vertices) for e in me.edges]
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type='EDGE')
    bpy.ops.mesh.select_all(action='DESELECT')
    bm = bmesh.from_edit_mesh(me)
    bm.verts.ensure_lookup_table()
    for a, b in sel:
        e = bm.edges.get([bm.verts[a], bm.verts[b]])
        assert e is not None, (name, a, b)
        e.select = True
    bm.select_flush(True)
    bmesh.update_edit_mesh(me)

    win, area, region = view_context()
    with bpy.context.temp_override(window=win, area=area, region=region):
        result = bpy.ops.transform.edge_slide(**props)

    bm = bmesh.from_edit_mesh(me)
    out = [[round(c, 6) for c in v.co] for v in bm.verts]
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(me)
    return {
        'name': name,
        'props': props,
        'result': list(result),
        'input': {'positions': co, 'faces': faces, 'meshEdges': mesh_edges, 'selected': sel},
        'positions': out,
    }


def main():
    win, area, region = view_context()
    rv3d = region.data
    view = {
        'viewMatrix': col_major(rv3d.view_matrix),
        'windowMatrix': col_major(rv3d.window_matrix),
        'isPersp': rv3d.is_perspective,
        'winx': region.width,
        'winy': region.height,
        'xray': area.spaces.active.shading.show_xray,
    }
    cases = []
    for name, co, faces, sel in CASES:
        for props in SLIDE_PROPS:
            cases.append(run_case(name, co, faces, sel, props))
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'slide.json')
    # One case per line, so a regeneration diffs readably.
    with open(path, 'w') as f:
        f.write('{"blender": %s,\n "view": %s,\n "cases": [\n' % (json.dumps(bpy.app.version_string), json.dumps(view)))
        f.write(',\n'.join('  ' + json.dumps(c, separators=(',', ':')) for c in cases))
        f.write('\n]}\n')
    print('WROTE', path, len(cases))
    sys.stdout.flush()


main()
bpy.ops.wm.quit_blender()

"""
Ground truth for the `editMeshLoopCut` port (`ringsel_finish`, `editmesh_loopcut.cc:158`), written by Blender.

    xvfb-run -a blender --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-bmesh-ops-loopcut-fixtures.py

Each case runs `bpy.ops.mesh.loopcut` non-interactively (`loopcut_exec`, the redo path: the edge comes
from `edge_index`; with no event it is not interactive even in a 3D view, which the operator's poll
needs in 3.4.1, hence the window under Xvfb and the `temp_override`) in edit mode on a mesh from explicit coordinates, with a start select mode, and
records the mesh, the selection and the select mode afterwards. The operator alone is not a macro, so
`is_macro` is false. The loop cut only creates elements, so Blender's element order is creation order
and the port is expected to reproduce it. Nothing in the output is hand-written; rerun this script to
regenerate `bmesh-ops-loopcut.json` beside it.
"""

import bpy
import bmesh
import json
import os

CUBE_CO = [
    [-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1],
    [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1],
]
CUBE_FACES = [[0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]]

# A 3x2 grid of quads, uneven, with a lifted vertex (as the subdivide fixtures').
GRID_CO = []
for y, yy in enumerate([0.0, 0.7, 2.0]):
    for x, xx in enumerate([0.0, 1.0, 1.6, 3.0]):
        GRID_CO.append([xx, yy, 0.4 if (x, y) == (1, 1) else 0.0])
GRID_FACES = []
for y in range(2):
    for x in range(3):
        a = y * 4 + x
        GRID_FACES.append([a, a + 1, a + 5, a + 4])
# The same with the last quad of the first row merged with its neighbour above into a hexagon: the
# ring stops at the n-gon (`BMW_DELIMIT_EDGE_RING_NGONS`).
GRID_NGON_FACES = [GRID_FACES[0], GRID_FACES[1], [2, 3, 7, 11, 10, 6], GRID_FACES[3], GRID_FACES[4]]

# A strip of two quads ending in a triangle on each side, and a fan of triangles.
STRIP_CO = [[0, 0, 0], [1, 0, 0], [2, 0, 0.2], [0, 1, 0], [1, 1, 0.1], [2, 1, 0], [-0.8, 0.5, 0], [2.8, 0.5, 0]]
STRIP_FACES = [[0, 1, 4, 3], [1, 2, 5, 4], [6, 0, 3], [2, 7, 5]]
FAN_CO = [[0, 0, 0], [1, 0, 0], [0.7, 0.8, 0.1], [-0.3, 1, 0], [-1, 0.2, 0]]
FAN_FACES = [[0, 1, 2], [0, 2, 3], [0, 3, 4]]

# A quad with a loose edge hanging off it.
WIRE_CO = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 2, 0.5]]
WIRE_FACES = [[0, 1, 2, 3]]
WIRE_EDGES = [[2, 4]]

cases = []


def dump(bm):
    bm.verts.index_update()
    bm.edges.index_update()
    bm.faces.index_update()
    return {
        'positions': [[round(c, 6) for c in v.co] for v in bm.verts],
        'faces': [[v.index for v in f.verts] for f in bm.faces],
        'edges': [[e.verts[0].index, e.verts[1].index] for e in bm.edges],
    }


MODES = {'VERT': {'VERT'}, 'EDGE': {'EDGE'}, 'FACE': {'FACE'}}


def case(name, co, faces, edge_pair, props, select_mode='EDGE', loose_edges=()):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(co, list(loose_edges), faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type=select_mode)
    bpy.ops.mesh.select_all(action='DESELECT')
    bm = bmesh.from_edit_mesh(mesh)
    bm.verts.ensure_lookup_table()
    bm.edges.index_update()
    input_edges = [[e.verts[0].index, e.verts[1].index] for e in bm.edges]
    e = bm.edges.get([bm.verts[edge_pair[0]], bm.verts[edge_pair[1]]])
    assert e is not None, edge_pair
    edge_index = e.index
    win = bpy.context.window_manager.windows[0]
    area = [a for a in win.screen.areas if a.type == 'VIEW_3D'][0]
    region = [r for r in area.regions if r.type == 'WINDOW'][0]
    with bpy.context.temp_override(window=win, area=area, region=region):
        result = bpy.ops.mesh.loopcut(object_index=0, edge_index=edge_index, **props)
    bm = bmesh.from_edit_mesh(mesh)
    out = dump(bm)
    sel = {
        'verts': [v.index for v in bm.verts if v.select],
        'edges': [x.index for x in bm.edges if x.select],
        'faces': [f.index for f in bm.faces if f.select],
    }
    mode_after = [m for m, on in zip(('VERT', 'EDGE', 'FACE'), bpy.context.tool_settings.mesh_select_mode) if on]
    bpy.ops.object.mode_set(mode='OBJECT')
    cases.append({
        'name': name,
        'params': props,
        'selectMode': select_mode,
        'result': list(result),
        'input': {'positions': co, 'faces': faces, 'edge': edge_pair, 'meshEdges': input_edges},
        'output': out,
        'selected': sel,
        'selectModeAfter': mode_after,
    })
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(mesh)


for mode in ('VERT', 'EDGE', 'FACE'):
    for n in (1, 3):
        case(f'cube vertical edge cuts {n} {mode}', CUBE_CO, CUBE_FACES, [0, 1], dict(number_cuts=n), mode)
case('cube cuts 2 smoothness 1', CUBE_CO, CUBE_FACES, [1, 3], dict(number_cuts=2, smoothness=1.0))
for fo in ('SMOOTH', 'SPHERE', 'ROOT', 'SHARP', 'LINEAR', 'INVERSE_SQUARE'):
    case(f'cube cuts 3 smoothness 0.8 falloff {fo}', CUBE_CO, CUBE_FACES, [1, 3],
         dict(number_cuts=3, smoothness=0.8, falloff=fo))
case('cube cuts 1 smoothness -0.5', CUBE_CO, CUBE_FACES, [2, 6], dict(number_cuts=1, smoothness=-0.5))
for n in (1, 2):
    case(f'grid row edge cuts {n}', GRID_CO, GRID_FACES, [1, 5], dict(number_cuts=n))
    case(f'grid column edge cuts {n}', GRID_CO, GRID_FACES, [4, 5], dict(number_cuts=n))
case('grid ngon stops the ring', GRID_CO, GRID_NGON_FACES, [1, 5], dict(number_cuts=2))
case('strip quads end at triangles', STRIP_CO, STRIP_FACES, [1, 4], dict(number_cuts=2))
case('fan triangle edge (single)', FAN_CO, FAN_FACES, [0, 2], dict(number_cuts=2))
case('fan triangle edge (single) vertex mode', FAN_CO, FAN_FACES, [0, 2], dict(number_cuts=1), 'VERT')
case('wire edge', WIRE_CO, WIRE_FACES, [2, 4], dict(number_cuts=3), 'EDGE', WIRE_EDGES)

out = {
    'generator': 'gen-bmesh-ops-loopcut-fixtures.py',
    'blender': bpy.app.version_string,
    'cases': cases,
}
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bmesh-ops-loopcut.json')
with open(path, 'w') as fh:
    # One case per line: small enough to commit, and a regeneration diffs case by case.
    fh.write('{"generator": %s, "blender": %s, "cases": [\n' % (json.dumps(out['generator']), json.dumps(out['blender'])))
    fh.write(',\n'.join(json.dumps(c, separators=(',', ':')) for c in cases))
    fh.write('\n]}\n')
print('wrote', path, len(cases), 'cases')
bpy.ops.wm.quit_blender()

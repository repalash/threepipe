"""
Ground truth for `mergeByDistanceSelection` (edit-mode Merge by Distance), written by Blender:

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-bmesh-ops-mergebydistance.py

Each case builds a mesh object from explicit data, enters edit mode with a select mode and a
selection, runs `bpy.ops.mesh.remove_doubles` and dumps the result (geometry, every edge, the
selection). Blender 3.4.1 predates `use_centroid` (its weld keeps the target vertex where it is), so
these cases are the `use_centroid=False` behaviour of the current source.

Writes `bmesh-ops-mergebydistance.json` beside this file.
"""

import os
import sys

import bmesh
import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bmesh_fixture_util import build, dump, write  # noqa: E402

# A 2x1 strip of quads whose right quad was "separated": its two left corners are copies of the
# left quad's right corners, nudged by 3e-5 (inside the default threshold).
E = 3e-5
STRIP_CO = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],          # left quad 0-3
    [1 + E, 0, 0], [2, 0, 0], [2, 1, 0.2], [1, 1 + E, 0],  # right quad 4-7, 4~1 and 7~2
]
STRIP_FACES = [[0, 1, 2, 3], [4, 5, 6, 7]]

# The same with a 0.05 gap, and two coincident unselected wire vertices off to the side (8, 9 on
# edges to 10, 11): with `use_unselected` the unselected ones are kept, so they must not merge with
# each other, and a selected vertex merges *into* its unselected partner even when it has the lower
# index.
G = 0.05
GAP_CO = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [1 + G, 0, 0], [2, 0, 0], [2, 1, 0.2], [1, 1 + G, 0],
    [5, 5, 0], [5, 5, 0], [6, 5, 0], [5, 6, 0],
]
GAP_EDGES = [[8, 10], [9, 11]]

# Three near-coincident vertices on the tips of three wire edges, plus a far one: a cluster of
# three picks the vertex nearest the centroid (`deduplicate_target_calc_fn`).
CLUSTER_CO = [[0, 0, 0], [0.004, 0, 0], [0, 0.005, 0], [3, 0, 0],
              [-1, 0, 0], [1, -1, 0], [0, 1, 1], [3, 1, 0]]
CLUSTER_EDGES = [[0, 4], [1, 5], [2, 6], [3, 7]]

# A cube with a duplicate of its top face sitting 0.02 above it.
CUBE_CO = [[-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1], [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1]]
CUBE_FACES = [[0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]]
LID_CO = CUBE_CO + [[-1, -1, 1.02], [-1, 1, 1.02], [1, 1, 1.02], [1, -1, 1.02]]
LID_FACES = CUBE_FACES + [[8, 11, 10, 9]]

MODES = {'VERT': (True, False, False), 'EDGE': (False, True, False), 'FACE': (False, False, True)}

cases = []


def case(name, co, faces, edges, select, mode, props, hide=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    me = bpy.data.meshes.new('m')
    ob = bpy.data.objects.new('o', me)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bm = build(co, faces, edges, select)
    for i in (hide or ()):
        bm.verts[i].hide = True
    bm.to_mesh(me)
    bm.free()
    bpy.context.tool_settings.mesh_select_mode = MODES[mode]
    bpy.ops.object.mode_set(mode='EDIT')
    # The selection as edit mode holds it, after Blender's own conversion and flushing: the TS
    # side starts from exactly this.
    entered = dump(bmesh.from_edit_mesh(me))['selected']
    result = bpy.ops.mesh.remove_doubles(**props)
    bm = bmesh.from_edit_mesh(me)
    out = dump(bm)
    bpy.ops.object.mode_set(mode='OBJECT')
    cases.append({
        'name': name,
        'mode': mode,
        'props': props,
        'input': {'positions': co, 'faces': faces, 'edges': edges, 'select': select, 'hide': hide or []},
        'entered': entered,
        'result': list(result),
        'output': out,
    })


ALL8 = {'verts': list(range(8))}
case('strip all selected default threshold', STRIP_CO, STRIP_FACES, [], ALL8, 'VERT', {})
case('strip threshold below the gap', STRIP_CO, STRIP_FACES, [], ALL8, 'VERT', {'threshold': 1e-5})
case('strip only the right quad selected', STRIP_CO, STRIP_FACES, [], {'verts': [4, 5, 6, 7]}, 'VERT', {})
case('strip right quad selected, unselected targets', STRIP_CO, STRIP_FACES, [], {'verts': [4, 5, 6, 7]}, 'VERT',
     {'use_unselected': True})
case('strip face mode, right face selected, unselected', STRIP_CO, STRIP_FACES, [], {'faces': [1]}, 'FACE',
     {'use_unselected': True})
case('gap strip, left quad selected, unselected targets', GAP_CO, STRIP_FACES, GAP_EDGES, {'verts': [0, 1, 2, 3]},
     'VERT', {'threshold': 0.1, 'use_unselected': True})
case('gap strip, all selected', GAP_CO, STRIP_FACES, GAP_EDGES, {'verts': list(range(12))}, 'VERT', {'threshold': 0.1})
case('cluster of three', CLUSTER_CO, [], CLUSTER_EDGES, {'verts': list(range(8))}, 'VERT', {'threshold': 0.01})
case('cluster pair only', CLUSTER_CO, [], CLUSTER_EDGES, {'verts': [0, 1, 3]}, 'VERT', {'threshold': 0.01})
case('cube lid welded', LID_CO, LID_FACES, [], {'verts': list(range(12))}, 'VERT', {'threshold': 0.05})
case('cube lid edge mode', LID_CO, LID_FACES, [], {'edges': [[8, 11], [11, 10], [10, 9], [9, 8], [1, 3]]}, 'EDGE',
     {'threshold': 0.05})
case('cube lid hidden vertex kept apart', LID_CO, LID_FACES, [], {'verts': list(range(12))}, 'VERT',
     {'threshold': 0.05}, hide=[8])
case('nothing selected', STRIP_CO, STRIP_FACES, [], None, 'VERT', {})

write(__file__, 'bmesh-ops-mergebydistance.json', cases)

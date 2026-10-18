"""
Ground truth for the edit-mode operator wrappers in `src/ops/editmeshTools.ts` (Poke, Triangulate,
Beautify, Wireframe, Fill, Mark Seam / Sharp, Flip / Recalculate Normals, Delete Loose, ...), written
by Blender itself:

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-editmesh-tools.py

Every case builds an object from explicit data, enters edit mode with a select mode, records the
selection edit mode held on entering (`entered`, after Blender's own conversion and flush), runs
`bpy.ops.mesh.<op>(**props)` and records the mesh, the selection, the seams and the sharp edges
afterwards. Nothing in the output is hand-written; rerun this script to regenerate it.

Writes `editmesh-tools.json` beside this file.
"""

import math
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from bmesh_fixture_util import build, dump, edge_lookup, write  # noqa: E402

MODES = {'VERT': (True, False, False), 'EDGE': (False, True, False), 'FACE': (False, False, True)}

CUBE_CO = [[-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1], [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1]]
CUBE_FACES = [[0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]]
# the cube with faces 1 and 4 wound inwards
CUBE_FLIPPED_FACES = [[0, 1, 3, 2], [6, 7, 3, 2], [6, 7, 5, 4], [4, 5, 1, 0], [0, 4, 6, 2], [7, 3, 1, 5]]

# A 3x2 grid of quads, open, uneven spacing, one lifted vertex so the normals differ.
GRID_CO = []
for y, yy in enumerate([0.0, 0.7, 2.0]):
    for x, xx in enumerate([0.0, 1.0, 1.6, 3.0]):
        GRID_CO.append([xx, yy, 0.4 if (x, y) == (1, 1) else 0.0])
GRID_FACES = []
for y in range(2):
    for x in range(3):
        a = y * 4 + x
        GRID_FACES.append([a, a + 1, a + 5, a + 4])

# The grid triangulated along the "wrong" diagonals, for beautify.
TRI_FACES = []
for y in range(2):
    for x in range(3):
        a = y * 4 + x
        TRI_FACES.append([a, a + 1, a + 4])
        TRI_FACES.append([a + 1, a + 5, a + 4])

# A non-convex closed loop of wire edges (an L), for Fill.
L_CO = [[0, 0, 0], [2, 0, 0], [2, 0.5, 0], [0.6, 0.5, 0], [0.6, 1.8, 0], [0, 1.8, 0], [1.2, 0.2, 0.0]]
L_EDGES = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]]

# A hexagon n-gon and a pentagon, for the n-gon triangulation methods.
NGON_CO = [[math.cos(i * math.pi / 3) * (1 + 0.3 * (i % 2)), math.sin(i * math.pi / 3), 0.1 * i] for i in range(6)]
NGON_FACES = [[0, 1, 2, 3, 4, 5]]

# Loose bits next to a quad: a lone vertex, a wire edge chain, a loose triangle, a triangle on the quad.
LOOSE_CO = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [3, 3, 3], [2, 0, 0], [2, 1, 0], [2, 2, 0],
            [4, 0, 0], [5, 0, 0], [4, 1, 0], [1, 2, 0]]
LOOSE_FACES = [[0, 1, 2, 3], [8, 9, 10], [3, 2, 11]]
LOOSE_EDGES = [[5, 6], [6, 7]]

cases = []


def dump_flags(bm):
    """Seams and sharp edges as vertex index pairs (after `dump`, so indices are current)."""
    return {
        'seams': [[e.verts[0].index, e.verts[1].index] for e in bm.edges if e.seam],
        'sharp': [[e.verts[0].index, e.verts[1].index] for e in bm.edges if not e.smooth],
    }


def edit_case(name, geo, mode, opname, props, select, extras=None):
    co, faces, edges = geo
    bpy.ops.wm.read_factory_settings(use_empty=True)
    me = bpy.data.meshes.new('m')
    ob = bpy.data.objects.new('o', me)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bm = build(co, faces, edges, select)
    extras = extras or {}
    for e in edge_lookup(bm, extras.get('seams', [])):
        e.seam = True
    for e in edge_lookup(bm, extras.get('sharp', [])):
        e.smooth = False
    bm.to_mesh(me)
    bm.free()
    bpy.context.tool_settings.mesh_select_mode = MODES[mode]
    bpy.ops.object.mode_set(mode='EDIT')
    entered = dump(bmesh.from_edit_mesh(me))['selected']
    result = getattr(bpy.ops.mesh, opname)(**props)
    ebm = bmesh.from_edit_mesh(me)
    out = dump(ebm)
    out.update(dump_flags(ebm))
    bpy.ops.object.mode_set(mode='OBJECT')
    cases.append({
        'name': name, 'mode': mode, 'op': opname, 'props': props,
        'input': {'positions': co, 'faces': faces, 'edges': edges, 'select': select},
        'extras': extras,
        'entered': entered,
        'result': list(result),
        'output': out,
    })


CUBE = (CUBE_CO, CUBE_FACES, [])
GRID = (GRID_CO, GRID_FACES, [])
TRIS = (GRID_CO, TRI_FACES, [])
LOOP = (L_CO, [], L_EDGES)
NGON = (NGON_CO, NGON_FACES, [])
LOOSE = (LOOSE_CO, LOOSE_FACES, LOOSE_EDGES)
ALL_CUBE = {'faces': list(range(6))}
ALL_GRID = {'faces': list(range(6))}

# --- mesh.poke (MESH_OT_poke, editmesh_tools.cc:5405) ----------------------------------------------
edit_case('poke cube one face', CUBE, 'FACE', 'poke', {}, {'faces': [0]})
edit_case('poke cube all', CUBE, 'FACE', 'poke', {}, ALL_CUBE)
edit_case('poke grid offset relative median', GRID, 'FACE', 'poke',
          {'offset': 0.3, 'use_relative_offset': True, 'center_mode': 'MEDIAN'}, {'faces': [1, 4]})
edit_case('poke grid bounds offset', GRID, 'FACE', 'poke', {'offset': -0.2, 'center_mode': 'BOUNDS'}, {'faces': [0, 1, 2]})
edit_case('poke ngon vertex mode', NGON, 'VERT', 'poke', {}, {'verts': list(range(6))})

# --- mesh.quads_convert_to_tris (MESH_OT_quads_convert_to_tris, :5510) -----------------------------
edit_case('triangulate cube all', CUBE, 'FACE', 'quads_convert_to_tris', {}, ALL_CUBE)
for qm in ('BEAUTY', 'FIXED', 'FIXED_ALTERNATE', 'SHORTEST_DIAGONAL', 'LONGEST_DIAGONAL'):
    edit_case('triangulate grid ' + qm, GRID, 'FACE', 'quads_convert_to_tris', {'quad_method': qm}, {'faces': [0, 1, 4]})
for nm in ('BEAUTY', 'CLIP'):
    edit_case('triangulate ngon ' + nm, NGON, 'FACE', 'quads_convert_to_tris', {'ngon_method': nm}, {'faces': [0]})

# --- mesh.beautify_fill (MESH_OT_beautify_fill, :5319) ---------------------------------------------
edit_case('beautify tris all', TRIS, 'FACE', 'beautify_fill', {}, {'faces': list(range(12))})
edit_case('beautify tris some', TRIS, 'FACE', 'beautify_fill', {}, {'faces': [0, 1, 2, 3]})
edit_case('beautify tris angle limit', TRIS, 'FACE', 'beautify_fill', {'angle_limit': math.radians(10)}, {'faces': list(range(12))})

# --- mesh.wireframe (MESH_OT_wireframe, :7682) -----------------------------------------------------
edit_case('wireframe cube all', CUBE, 'FACE', 'wireframe', {}, ALL_CUBE)
edit_case('wireframe grid some', GRID, 'FACE', 'wireframe', {'thickness': 0.1}, {'faces': [0, 1]})
edit_case('wireframe grid keep no boundary', GRID, 'FACE', 'wireframe',
          {'thickness': 0.08, 'offset': 0.5, 'use_boundary': False, 'use_replace': False, 'use_even_offset': False,
           'use_relative_offset': True}, ALL_GRID)

# --- mesh.fill (MESH_OT_fill, :4742) ---------------------------------------------------------------
edit_case('fill L loop beauty', LOOP, 'EDGE', 'fill', {}, {'edges': L_EDGES})
edit_case('fill L loop plain', LOOP, 'EDGE', 'fill', {'use_beauty': False}, {'edges': L_EDGES})
edit_case('fill grid rim beauty', (GRID_CO, [], [[0, 1], [1, 2], [2, 3], [3, 7], [7, 11], [11, 10], [10, 9], [9, 8], [8, 4], [4, 0]]),
          'EDGE', 'fill', {}, {'edges': [[0, 1], [1, 2], [2, 3], [3, 7], [7, 11], [11, 10], [10, 9], [9, 8], [8, 4], [4, 0]]})

# --- mesh.mark_seam / mesh.mark_sharp (:1088, :1161) -----------------------------------------------
edit_case('mark seam cube edges', CUBE, 'EDGE', 'mark_seam', {}, {'edges': [[0, 1], [1, 3]]})
edit_case('clear seam cube', CUBE, 'EDGE', 'mark_seam', {'clear': True}, {'edges': [[0, 1]]}, {'seams': [[0, 1], [1, 3]]})
edit_case('mark sharp cube edges', CUBE, 'EDGE', 'mark_sharp', {}, {'edges': [[0, 1], [1, 3]]})
edit_case('clear sharp cube', CUBE, 'EDGE', 'mark_sharp', {'clear': True}, {'edges': [[1, 3]]}, {'sharp': [[0, 1], [1, 3]]})
edit_case('mark sharp from vertices', CUBE, 'VERT', 'mark_sharp', {'use_verts': True}, {'verts': [7]})
edit_case('clear sharp from vertices', CUBE, 'VERT', 'mark_sharp', {'use_verts': True, 'clear': True}, {'verts': [1]},
          {'sharp': [[0, 1], [1, 3], [1, 5], [3, 7]]})

# --- mesh.flip_normals / mesh.normals_make_consistent (:2371, :2710) --------------------------------
edit_case('flip two faces', CUBE, 'FACE', 'flip_normals', {}, {'faces': [0, 2]})
edit_case('recalc outside', (CUBE_CO, CUBE_FLIPPED_FACES, []), 'FACE', 'normals_make_consistent', {}, ALL_CUBE)
edit_case('recalc inside', (CUBE_CO, CUBE_FLIPPED_FACES, []), 'FACE', 'normals_make_consistent', {'inside': True}, ALL_CUBE)
edit_case('recalc outside partial', (CUBE_CO, CUBE_FLIPPED_FACES, []), 'FACE', 'normals_make_consistent', {}, {'faces': [1, 2]})

# --- mesh.delete_loose (MESH_OT_delete_loose, :663) ------------------------------------------------
LOOSE_ALL = {'verts': list(range(12))}
edit_case('delete loose defaults', LOOSE, 'VERT', 'delete_loose', {}, LOOSE_ALL)
edit_case('delete loose with faces', LOOSE, 'VERT', 'delete_loose', {'use_faces': True}, LOOSE_ALL)
edit_case('delete loose verts only partial', LOOSE, 'VERT', 'delete_loose', {'use_edges': False}, {'verts': [4, 5, 6, 0]})

write(__file__, 'editmesh-tools.json', cases)

"""
Ground truth for the connect ports - `connectVerts` (`bmesh.ops.connect_verts`), `connectVertPair`
(`bmesh.ops.connect_vert_pair`), `vertConnectSelection` (`bpy.ops.mesh.vert_connect`) and
`vertConnectPathSelection` (`bpy.ops.mesh.vert_connect_path`, J) - written by Blender:

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-bmesh-ops-connect.py

`bmesh.ops` cases build the input with `build` (normals refreshed), run the operator and record the
mesh, the selection and `edges.out`. Edit-mode cases build an object, enter edit mode with a select
mode, a selection, hidden faces and a select history, run the operator and record the operator result
(or its error report), the mesh, the selection and the select history afterwards. The selection and
hidden state edit mode actually held on entry are recorded too (`entered`), so the TypeScript side
starts from exactly that.

Writes `bmesh-ops-connect.json` beside this file.
"""

import math
import os
import sys

import bmesh
import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bmesh_fixture_util import build, dump, write  # noqa: E402

# --- meshes -------------------------------------------------------------------------------------

# A slightly non-planar quad.
QUAD_CO = [[0, 0, 0], [2, 0, 0], [2.2, 1.5, 0.3], [0, 1.4, 0]]
QUAD_FACES = [[0, 1, 2, 3]]

# An irregular convex hexagon, a little non-planar.
HEX_CO = [[0, 0, 0], [2, -0.3, 0.05], [3.2, 1, 0], [2.6, 2.4, -0.05], [0.8, 2.7, 0], [-0.6, 1.3, 0.02]]
HEX_FACES = [[0, 1, 2, 3, 4, 5]]

# A "C": the cut between its tips (2 and 5) runs across the opening, outside the face, without
# crossing any of its edges.
C_CO = [[0, 0, 0], [4, 0, 0], [4, 1, 0], [1, 1, 0], [1, 3, 0], [4, 3, 0], [4, 4, 0], [0, 4, 0]]
C_FACES = [[0, 1, 2, 3, 4, 5, 6, 7]]

# An "L": the cut 1-5 leaves the face across the notch (and crosses edge 2-3).
L_CO = [[0, 0, 0], [3, 0, 0], [3, 1, 0], [1, 1, 0], [1, 3, 0], [0, 3, 0]]
L_FACES = [[0, 1, 2, 3, 4, 5]]

# A "U" (two pillars on a bar) whose outline passes through (0, 0) and (4, 0) at straight corners
# and touches y = 0 at the notch corners (1, 0) and (3, 0). The cut (0, 0)-(4, 0) starts inside the
# face at both ends but runs through the notch, touching the outline only at those two vertices.
# Blender 3.4.1 rejects it (its midpoint is outside); the current source's corner-angle test keeps it.
U_CO = [[0, 2, 0], [0, 0, 0], [0, -2, 0], [4, -2, 0], [4, 0, 0], [4, 2, 0], [3, 2, 0], [3, 0, 0], [3, -1, 0],
        [1, -1, 0], [1, 0, 0], [1, 2, 0]]
U_FACES = [list(range(12))]

# The U with a quad hung under its bar (sharing edge 2-3), whose corner 13 is the target of a cut
# from the U's reflex notch corner 9: the cutting plane leaves corner 9 into the U on both sides, and
# the nearer crossing (up the left pillar) is a dead end - `MinDistDir` keeps both directions.
UQ_CO = U_CO + [[0, -3, 0], [3.5, -3, 0]]
UQ_FACES = [list(range(12)), [12, 13, 3, 2]]

# Two faces sharing only the vertices 0 and 2 (non-manifold): a flat square and a folded quad. A cut
# 0-2 suits the flat one better (`BM_vert_pair_share_face_by_angle`); whichever face is split first
# makes edge 0-2, and the other face then skips the pair (`EDGE_OUT`).
TWO_CO = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [1, -0.5, 0.8], [-0.5, 1, -0.8]]
TWO_FACES = [[0, 1, 2, 3], [0, 4, 2, 5]]

# A quad with a triangle over its half 0-1-2 (non-manifold): edge 0-2 exists already, so the cut 0-2
# reuses it and the half that duplicates the triangle is removed (`BM_face_find_double`, #70287).
DUP_CO = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
DUP_FACES = [[0, 1, 2, 3], [0, 1, 2]]

# A 4x3 grid of quads with uneven spacing and one lifted vertex, so no two paths tie.
GX = [0.0, 1.0, 2.1, 3.0, 4.2]
GY = [0.0, 0.9, 2.0, 3.1]
GRID_CO = []
for iy, y in enumerate(GY):
    for ix, x in enumerate(GX):
        GRID_CO.append([x, y, 0.15 if (ix, iy) == (2, 1) else 0.0])
GRID_FACES = []
for iy in range(3):
    for ix in range(4):
        a = iy * 5 + ix
        GRID_FACES.append([a, a + 1, a + 6, a + 5])


def g(ix, iy):
    return iy * 5 + ix


# An open tube: 8 segments, 3 rings, outward normals. The rings are not evenly spaced and the
# radius varies a little, so paths around either side never tie exactly.
CYL_CO = []
for r, (z, rad) in enumerate([(0.0, 1.0), (0.8, 1.05), (2.0, 0.95)]):
    for s in range(8):
        a = 2 * math.pi * s / 8 + 0.07 * r
        CYL_CO.append([round(rad * math.cos(a), 6), round(rad * math.sin(a), 6), z])
CYL_FACES = []
for r in range(2):
    for s in range(8):
        CYL_FACES.append([r * 8 + s, r * 8 + (s + 1) % 8, (r + 1) * 8 + (s + 1) % 8, (r + 1) * 8 + s])

# Two separate quads: no face path between them.
ISLANDS_CO = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [3, 0, 0], [4, 0, 0], [4, 1, 0], [3, 1, 0]]
ISLANDS_FACES = [[0, 1, 2, 3], [4, 5, 6, 7]]

# A quad and a triangle sharing an edge.
TRIQ_CO = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 0.5, 0]]
TRIQ_FACES = [[0, 1, 2, 3], [1, 4, 2]]

# Loose vertices and a wire chain beside a quad (for the wire branch of the path operator).
WIRE_CO = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [3, 0, 0], [4, 0.5, 0], [3.5, 1.5, 0], [2.8, 1, 0]]
WIRE_FACES = [[0, 1, 2, 3]]

cases = []


def edges_out(bm, out_edges):
    """`edges.out` as vertex index pairs (indices valid after `dump`)."""
    return [[e.verts[0].index, e.verts[1].index] for e in out_edges]


def bmo_case(name, op, co, faces, verts, params=None, faces_exclude=(), verts_exclude=()):
    params = params or {}
    bm = build(co, faces)
    vs = [bm.verts[i] for i in verts]
    kw = dict(params)
    if faces_exclude:
        kw['faces_exclude'] = [bm.faces[i] for i in faces_exclude]
    if verts_exclude:
        kw['verts_exclude'] = [bm.verts[i] for i in verts_exclude]
    res = getattr(bmesh.ops, op)(bm, verts=vs, **kw)
    out = dump(bm)
    cases.append({
        'name': name,
        'kind': 'bmo',
        'op': op,
        'params': params,
        'verts': verts,
        'facesExclude': list(faces_exclude),
        'vertsExclude': list(verts_exclude),
        'input': {'positions': co, 'faces': faces},
        'output': out,
        'edgesOut': edges_out(bm, res['edges']),
    })
    bm.free()


MODES = {'VERT': (True, False, False), 'EDGE': (False, True, False), 'FACE': (False, False, True)}


def hidden(bm):
    return {
        'verts': [v.index for v in bm.verts if v.hide],
        'edges': [[e.verts[0].index, e.verts[1].index] for e in bm.edges if e.hide],
        'faces': [f.index for f in bm.faces if f.hide],
    }


def history(bm):
    out = []
    for ese in bm.select_history:
        if isinstance(ese, bmesh.types.BMVert):
            out.append({'type': 'V', 'verts': [ese.index]})
        elif isinstance(ese, bmesh.types.BMEdge):
            out.append({'type': 'E', 'verts': [ese.verts[0].index, ese.verts[1].index]})
        else:
            out.append({'type': 'F', 'verts': [v.index for v in ese.verts]})
    return out


def edit_case(name, op, co, faces, select, hist, mode='VERT', edges=(), hide_faces=()):
    """
    `hist` is a list of ('V', i) / ('E', a, b) / ('F', i) entries, stored in order with
    `bm.select_history.add` after entering edit mode (and after hiding `hide_faces`).
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    me = bpy.data.meshes.new('m')
    ob = bpy.data.objects.new('o', me)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bm = build(co, faces, edges, select)
    bm.to_mesh(me)
    bm.free()
    bpy.context.tool_settings.mesh_select_mode = MODES[mode]
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(me)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    for i in hide_faces:
        bm.faces[i].hide_set(True)
    bm.select_history.clear()
    for h in hist:
        if h[0] == 'V':
            bm.select_history.add(bm.verts[h[1]])
        elif h[0] == 'E':
            bm.select_history.add(bm.edges.get((bm.verts[h[1]], bm.verts[h[2]])))
        else:
            bm.select_history.add(bm.faces[h[1]])
    bmesh.update_edit_mesh(me)
    bm = bmesh.from_edit_mesh(me)
    entered = dump(bm)
    entered_hist = history(bm)
    entered_hidden = hidden(bm)
    error = None
    try:
        result = list(getattr(bpy.ops.mesh, op)())
    except RuntimeError as ex:
        result = ['CANCELLED']
        error = str(ex).strip()
    bm = bmesh.from_edit_mesh(me)
    out = dump(bm)
    out_hist = history(bm)
    bpy.ops.object.mode_set(mode='OBJECT')
    cases.append({
        'name': name,
        'kind': 'edit',
        'op': op,
        'mode': mode,
        'input': {'positions': co, 'faces': faces, 'edges': [list(e) for e in edges]},
        'entered': entered['selected'],
        'enteredHidden': entered_hidden,
        'enteredHistory': entered_hist,
        'result': result,
        'error': error,
        'output': out,
        'history': out_hist,
    })


# --- bmesh.ops.connect_verts ----------------------------------------------------------------------

CV = 'connect_verts'
bmo_case('quad opposite corners', CV, QUAD_CO, QUAD_FACES, [0, 2], {'check_degenerate': False})
bmo_case('quad opposite corners, check_degenerate', CV, QUAD_CO, QUAD_FACES, [0, 2], {'check_degenerate': True})
bmo_case('quad adjacent corners (edges.out only)', CV, QUAD_CO, QUAD_FACES, [0, 1], {'check_degenerate': True})
bmo_case('hexagon three verts', CV, HEX_CO, HEX_FACES, [0, 2, 4], {'check_degenerate': False})
bmo_case('hexagon three verts, check_degenerate', CV, HEX_CO, HEX_FACES, [0, 2, 4], {'check_degenerate': True})
bmo_case('hexagon four verts with adjacent pairs', CV, HEX_CO, HEX_FACES, [0, 1, 3, 4], {'check_degenerate': True})
bmo_case('hexagon contiguous run', CV, HEX_CO, HEX_FACES, [0, 1, 2], {'check_degenerate': False})
bmo_case('hexagon single vert', CV, HEX_CO, HEX_FACES, [3], {'check_degenerate': True})
bmo_case('C tips, check_degenerate (cut outside rejected)', CV, C_CO, C_FACES, [2, 5], {'check_degenerate': True})
bmo_case('C tips, no check (cut made)', CV, C_CO, C_FACES, [2, 5], {'check_degenerate': False})
bmo_case('C inner corner pair, check_degenerate', CV, C_CO, C_FACES, [0, 3], {'check_degenerate': True})
bmo_case('C three cuts, check_degenerate', CV, C_CO, C_FACES, [0, 3, 4, 7], {'check_degenerate': True})
bmo_case('U cut through the notch, check_degenerate (version difference)', CV, U_CO, U_FACES, [1, 4],
         {'check_degenerate': True})
bmo_case('two faces sharing a diagonal, no check (best face split)', CV, TWO_CO, TWO_FACES, [0, 2],
         {'check_degenerate': False})
bmo_case('two faces sharing a diagonal, check_degenerate (last face first)', CV, TWO_CO, TWO_FACES, [0, 2],
         {'check_degenerate': True})
bmo_case('quad with a triangle over its half (duplicate removed)', CV, DUP_CO, DUP_FACES, [0, 2],
         {'check_degenerate': False})
bmo_case('L three verts, check_degenerate', CV, L_CO, L_FACES, [1, 3, 5], {'check_degenerate': True})
bmo_case('L three verts, no check', CV, L_CO, L_FACES, [1, 3, 5], {'check_degenerate': False})
bmo_case('grid verts over several faces', CV, GRID_CO, GRID_FACES,
         [g(0, 0), g(1, 1), g(2, 0), g(3, 1), g(4, 3), g(2, 2)], {'check_degenerate': True})
bmo_case('grid verts, faces_exclude', CV, GRID_CO, GRID_FACES,
         [g(0, 0), g(1, 1), g(2, 0), g(3, 1), g(4, 3), g(2, 2)], {'check_degenerate': True}, faces_exclude=[1, 6])
bmo_case('triangle is skipped', CV, TRIQ_CO, TRIQ_FACES, [1, 4, 2, 3], {'check_degenerate': False})
bmo_case('cylinder ring verts', CV, CYL_CO, CYL_FACES, [0, 9, 2, 11, 4], {'check_degenerate': True})

# --- bmesh.ops.connect_vert_pair ------------------------------------------------------------------

CP = 'connect_vert_pair'
bmo_case('pair grid across faces', CP, GRID_CO, GRID_FACES, [g(0, 0), g(4, 2)])
bmo_case('pair grid reversed', CP, GRID_CO, GRID_FACES, [g(4, 2), g(0, 0)])
bmo_case('pair grid along a row (existing edges)', CP, GRID_CO, GRID_FACES, [g(0, 2), g(4, 2)])
bmo_case('pair grid short hop', CP, GRID_CO, GRID_FACES, [g(1, 0), g(3, 1)])
bmo_case('pair grid same face', CP, GRID_CO, GRID_FACES, [g(1, 1), g(2, 2)])
bmo_case('pair grid interior to boundary', CP, GRID_CO, GRID_FACES, [g(1, 1), g(4, 3)])
bmo_case('pair grid, faces_exclude blocks the path', CP, GRID_CO, GRID_FACES, [g(0, 0), g(4, 2)], faces_exclude=[5])
bmo_case('pair grid, verts_exclude', CP, GRID_CO, GRID_FACES, [g(0, 2), g(4, 2)], verts_exclude=[g(2, 2)])
bmo_case('pair cylinder up and around', CP, CYL_CO, CYL_FACES, [0, 19])
bmo_case('pair cylinder around one ring', CP, CYL_CO, CYL_FACES, [8, 13])
bmo_case('pair cylinder bottom to top', CP, CYL_CO, CYL_FACES, [1, 22])
bmo_case('pair islands (no path)', CP, ISLANDS_CO, ISLANDS_FACES, [0, 6])
bmo_case('pair from a reflex corner across a concave face', CP, UQ_CO, UQ_FACES, [9, 13])

# --- bpy.ops.mesh.vert_connect --------------------------------------------------------------------

VC = 'vert_connect'
edit_case('vert_connect quad two corners', VC, QUAD_CO, QUAD_FACES, {'verts': [0, 2]}, [])
edit_case('vert_connect grid pair across faces', VC, GRID_CO, GRID_FACES, {'verts': [g(0, 0), g(4, 2)]}, [])
edit_case('vert_connect grid four verts', VC, GRID_CO, GRID_FACES,
          {'verts': [g(1, 0), g(2, 1), g(3, 0), g(3, 2)]}, [])
edit_case('vert_connect grid three verts, first two apart', VC, GRID_CO, GRID_FACES,
          {'verts': [g(0, 0), g(3, 1), g(4, 2)]}, [])
edit_case('vert_connect C tips (shared face, no degenerate check)', VC, C_CO, C_FACES, {'verts': [2, 5]}, [])
edit_case('vert_connect one vert', VC, GRID_CO, GRID_FACES, {'verts': [g(1, 1)]}, [])
edit_case('vert_connect pair, hidden face blocks', VC, GRID_CO, GRID_FACES, {'verts': [g(0, 0), g(4, 2)]}, [],
          hide_faces=[5])
edit_case('vert_connect pair, hidden face beside', VC, GRID_CO, GRID_FACES, {'verts': [g(0, 0), g(4, 2)]}, [],
          hide_faces=[9])
edit_case('vert_connect edge mode, one edge', VC, GRID_CO, GRID_FACES, {'edges': [[g(1, 1), g(2, 1)]]}, [], 'EDGE')
edit_case('vert_connect islands', VC, ISLANDS_CO, ISLANDS_FACES, {'verts': [0, 6]}, [])
edit_case('vert_connect cylinder pair (no path)', VC, CYL_CO, CYL_FACES, {'verts': [1, 22]}, [])
edit_case('vert_connect cylinder pair around a ring', VC, CYL_CO, CYL_FACES, {'verts': [8, 13]}, [])

# --- bpy.ops.mesh.vert_connect_path ---------------------------------------------------------------

VP = 'vert_connect_path'
P4 = [g(0, 0), g(2, 1), g(4, 1), g(3, 3)]
edit_case('path grid four verts', VP, GRID_CO, GRID_FACES, {'verts': P4}, [('V', i) for i in P4])
P5 = [g(0, 3), g(1, 1), g(2, 3), g(3, 1), g(4, 3)]
edit_case('path grid five verts zigzag', VP, GRID_CO, GRID_FACES, {'verts': P5}, [('V', i) for i in P5])
P3 = [g(4, 0), g(0, 1), g(4, 3)]
edit_case('path grid three verts back and forth', VP, GRID_CO, GRID_FACES, {'verts': P3}, [('V', i) for i in P3])
edit_case('path pair ignores history', VP, GRID_CO, GRID_FACES, {'verts': [g(0, 0), g(4, 2)]},
          [('V', g(4, 2))])
PC = [g(1, 1), g(2, 1), g(2, 2)]
edit_case('path along existing edges closes the loop', VP, GRID_CO, GRID_FACES, {'verts': PC},
          [('V', i) for i in PC])
PCY = [0, 11, 21, 6]
edit_case('path cylinder', VP, CYL_CO, CYL_FACES, {'verts': PCY}, [('V', i) for i in PCY])
edit_case('path wire verts', VP, WIRE_CO, WIRE_FACES, {'verts': [4, 5, 6, 7]},
          [('V', 4), ('V', 6), ('V', 5), ('V', 7)], edges=[(4, 5)])
edit_case('path wire chain closes', VP, WIRE_CO, WIRE_FACES, {'verts': [4, 5, 6]},
          [('V', 4), ('V', 5), ('V', 6)], edges=[(4, 5), (5, 6)])
edit_case('path loose and face verts', VP, WIRE_CO, WIRE_FACES, {'verts': [0, 2, 7]},
          [('V', 0), ('V', 2), ('V', 7)])
edit_case('path edge history (two opposite edges)', VP, GRID_CO, GRID_FACES,
          {'edges': [[g(0, 1), g(0, 2)], [g(3, 1), g(3, 2)]]},
          [('E', g(0, 1), g(0, 2)), ('E', g(3, 1), g(3, 2))], 'EDGE')
edit_case('path edge history (three edges)', VP, GRID_CO, GRID_FACES,
          {'edges': [[g(1, 0), g(2, 0)], [g(1, 2), g(2, 2)], [g(3, 3), g(4, 3)]]},
          [('E', g(1, 0), g(2, 0)), ('E', g(1, 2), g(2, 2)), ('E', g(3, 3), g(4, 3))], 'EDGE')
edit_case('path edge history (parallel edges sharing faces)', VP, GRID_CO, GRID_FACES,
          {'edges': [[g(1, 1), g(1, 2)], [g(2, 1), g(2, 2)], [g(3, 1), g(3, 2)]]},
          [('E', g(1, 1), g(1, 2)), ('E', g(2, 1), g(2, 2)), ('E', g(3, 1), g(3, 2))], 'EDGE')
# Row-0 edges run left to right, the edges above were made as the top edge of the face below and
# run right to left: the side flips between the first two (shared face 1).
edit_case('path edge history (stacked edges, winding flips)', VP, GRID_CO, GRID_FACES,
          {'edges': [[g(1, 0), g(2, 0)], [g(1, 1), g(2, 1)], [g(1, 2), g(2, 2)]]},
          [('E', g(1, 0), g(2, 0)), ('E', g(1, 1), g(2, 1)), ('E', g(1, 2), g(2, 2))], 'EDGE')
edit_case('path invalid order (history misses a vert)', VP, GRID_CO, GRID_FACES,
          {'verts': [g(0, 0), g(2, 1), g(4, 2)]}, [('V', g(0, 0)), ('V', g(4, 2))])
edit_case('path nothing selected', VP, GRID_CO, GRID_FACES, None, [])
edit_case('path hiding deselects a path vert', VP, GRID_CO, GRID_FACES, {'verts': P4}, [('V', i) for i in P4],
          hide_faces=[2])
PH = [g(0, 0), g(4, 3), g(4, 0)]
edit_case('path cuts through a hidden face', VP, GRID_CO, GRID_FACES, {'verts': PH}, [('V', i) for i in PH],
          hide_faces=[5])

write(__file__, 'bmesh-ops-connect.json', cases)

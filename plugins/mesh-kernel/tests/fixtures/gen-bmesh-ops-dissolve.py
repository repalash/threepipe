"""
Ground truth for the dissolve ports (`dissolveVerts`, `dissolveEdges`, `dissolveFaces`, `dissolveLimit`
and their edit-mode selection functions), written by Blender itself:

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-bmesh-ops-dissolve.py

Two kinds of case:
- `bmesh.ops.dissolve_verts / dissolve_edges / dissolve_faces / dissolve_limit` on a mesh built from
  explicit data (`kind: 'op'`), with the operator's `region` output where it has one.
- the edit-mode operators `bpy.ops.mesh.dissolve_verts / _edges / _faces / _mode / _limited` on an
  object in edit mode (`kind: 'edit'`), recording the selection edit mode held on entering
  (`entered`, after Blender's own conversion and flush) and the selection afterwards.

Extra per-case data (`extras`): seams and sharp edges (vertex pairs), face material indices, and a UV
map (one [u, v] per face corner, in face order).

Blender 3.4.1 predates `angle_threshold` / `use_preserve_quads` and has an older `dissolve_edges`
vertex marking and `BM_faces_join`; the TypeScript suite documents the cases where that shows.

Writes `bmesh-ops-dissolve.json` beside this file.
"""

import math
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bmesh_fixture_util import build, dump, edge_lookup, write  # noqa: E402

import bmesh  # noqa: E402
import bpy  # noqa: E402

# --- geometry -------------------------------------------------------------------------------------

# A 3x3 grid of quads (4x4 verts, index y*4+x), uneven spacing, two interior verts lifted/sunk so
# the surface is not planar.
GRID_CO = []
for y, yy in enumerate([0.0, 0.8, 2.0, 2.6]):
    for x, xx in enumerate([0.0, 1.0, 1.7, 3.0]):
        z = 0.3 if (x, y) == (1, 1) else (-0.2 if (x, y) == (2, 2) else 0.0)
        GRID_CO.append([xx, yy, z])
GRID_FACES = []
for y in range(3):
    for x in range(3):
        a = y * 4 + x
        GRID_FACES.append([a, a + 1, a + 5, a + 4])

# The same grid, flat (for limited dissolve / delimits).
FLAT_CO = [[c[0], c[1], 0.0] for c in GRID_CO]

CUBE_CO = [[-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1], [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1]]
CUBE_FACES = [[0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]]

# A fan of six triangles around a raised centre (0), ring 1..6.
FAN_CO = [[0, 0, 0.1]] + [[math.cos(i * math.pi / 3) * (1 + 0.1 * i), math.sin(i * math.pi / 3) * (1 + 0.1 * i), 0]
                          for i in range(6)]
FAN_FACES = [[0, 1 + i, 1 + (i + 1) % 6] for i in range(6)]

# A strip of three quads with a loop cut along its middle: 4x3 verts (index y*4+x); the cut is the
# middle row of edges 4-5-6-7.
STRIP_CO = []
for y, yy in enumerate([0.0, 0.5, 1.2]):
    for x, xx in enumerate([0.0, 1.0, 2.1, 3.0]):
        STRIP_CO.append([xx, yy, 0.05 * x * y])
STRIP_FACES = []
for y in range(2):
    for x in range(3):
        a = y * 4 + x
        STRIP_FACES.append([a, a + 1, a + 5, a + 4])

# A loop cut that ends in a T: two quads on the left stacked (cut 1-4), one pentagon on the right whose
# left side passes through the T vertex 4.
#   6---7---8
#   |   |   |
#   3---4   |
#   |   |   |
#   0---1---2
T_CO = [[0, 0, 0], [1, 0, 0], [2.2, 0, 0], [0, 1, 0], [1, 1, 0], [3.0, 0.5, 0], [0, 2, 0], [1, 2, 0], [2.2, 2, 0]]
T_FACES = [[0, 1, 4, 3], [3, 4, 7, 6], [1, 2, 8, 7, 4]]
# vertex 5 is unused by faces but sits on a wire edge from 2, so it is a loose spur
T_EDGES = [[2, 5]]

# A quad split into two triangles along 0-2, inside a strip so the diagonal's ends have other edges.
TRIS_CO = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 0, 0], [2, 1, 0]]
TRIS_FACES = [[0, 1, 2], [0, 2, 3], [1, 4, 5, 2]]

# An isolated quad split into two triangles.
QUADTRI_CO = [[0, 0, 0], [1, 0, 0], [1, 1, 0.1], [0, 1, 0]]
QUADTRI_FACES = [[0, 1, 2], [0, 2, 3]]

# An open tube, irregular so no two folds are alike (Limited Dissolve orders its work by fold angle,
# and equal folds would leave the order to float rounding noise): 8 segments at uneven angles, 3 rings
# at uneven heights (24 verts, index ring*8+i), 16 quads.
TUBE_ANGLES = [0, 40, 85, 140, 175, 222, 268, 318]
TUBE_CO = []
for r, z in enumerate([0.0, 0.7, 1.5]):
    for a in TUBE_ANGLES:
        TUBE_CO.append([math.cos(math.radians(a)), math.sin(math.radians(a)), z])
TUBE_FACES = []
for r in range(2):
    for i in range(8):
        TUBE_FACES.append([r * 8 + i, r * 8 + (i + 1) % 8, (r + 1) * 8 + (i + 1) % 8, (r + 1) * 8 + i])

# A gently curved, slightly twisted strip: 6 quads in a row; the bottom row's segments turn by 1.3,
# 3.1, 2.2, 4.4 and 0.7 degrees, the top row's by 0.7 of that, so the quads twist (folds 1.12, 2.77,
# 2.49, 4.56, 3.40 degrees). All different and none at (or, merged, near) a tested limit, so the
# dissolve order and outcome are decided by geometry, not by rounding noise; and no face normal is
# perpendicular to y, so no boundary row projects onto a straight line (where the degenerate-ear test
# would be decided by noise). 7x2 verts, index y*7+x.
BENT_STEPS = [0.0, 1.3, 3.1, 2.2, 4.4, 0.7]
BENT_CO = []
for y, scale in ((0, 1.0), (1, 0.7)):
    ang = 0.0
    px, pz = 0.0, 0.0
    row = [[0.0, float(y), 0.0]]
    for x in range(1, 7):
        ang += math.radians(BENT_STEPS[x - 1] * scale)
        px += math.cos(ang)
        pz += math.sin(ang)
        row.append([px, float(y), pz])
    BENT_CO.extend(row)
BENT_FACES = [[x, x + 1, 7 + x + 1, 7 + x] for x in range(6)]

# A fin: three faces sharing the edge 0-1 (non-manifold).
FIN_CO = [[0, 0, 0], [0, 1, 0], [1, 0.5, 0], [-1, 0.5, 0], [0, 0.5, 1]]
FIN_FACES = [[0, 1, 2], [1, 0, 3], [0, 1, 4]]

# The flat grid with a corner face wound the other way (its normal points down). A corner, not the
# centre: a delimited island in the middle makes the last join around it fail (the ring would have a
# hole), and which join that is depends on the order of equal costs - rounding noise in Blender.
FLIP_FACES = [f if i != 8 else list(reversed(f)) for i, f in enumerate(GRID_FACES)]

ALL_GRID_V = list(range(16))
GRID_INNER_E = [[1, 5], [2, 6], [4, 5], [5, 6], [6, 7], [5, 9], [6, 10], [8, 9], [9, 10], [10, 11], [9, 13], [10, 14]]


def grid_edges_all():
    out = []
    for f in GRID_FACES:
        for i in range(4):
            a, b = f[i], f[(i + 1) % 4]
            k = [min(a, b), max(a, b)]
            if k not in out:
                out.append(k)
    return out


GRID_ALL_E = grid_edges_all()
# UVs: every corner gets its vertex's (x, y) / 3, except the right column's (faces 2, 5, 8), shifted
# by 0.5 in u: a UV island boundary along x = 1.7 (not around one face, see FLIP_FACES).
GRID_UV = [[[GRID_CO[v][0] / 3 + (0.5 if fi in (2, 5, 8) else 0), GRID_CO[v][1] / 3] for v in f]
           for fi, f in enumerate(GRID_FACES)]

# UVs for the strip: every face its own UV island (corner (x/3 + 0.25 * face, y)), so which corner's
# data survives a join or a collapse is visible.
STRIP_UV = [[[STRIP_CO[v][0] / 3 + 0.25 * fi, STRIP_CO[v][1]] for v in f] for fi, f in enumerate(STRIP_FACES)]

# A lone triangle (dissolving a corner leaves a two-sided face, which is killed).
TRI_CO = [[0, 0, 0], [1, 0, 0], [0.2, 1, 0]]
TRI_FACES = [[0, 1, 2]]

# Two triangles over a quad that already exists on the same four vertices: joining the triangles
# makes a double of the quad (`BM_faces_join` reuses the existing face; 3.4.1 kept both).
DOUBLE_CO = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
DOUBLE_FACES = [[0, 1, 2], [0, 2, 3], [0, 1, 2, 3]]

# The strip with an extra vertex 12 on the cut edge 4-5 (a two-edge vertex, so 12-5 and 4-12 form an
# edge chain): selecting only 12-5 must still treat 4 as the chain's end (`bmo_find_end_of_chain`).
STRIPX_CO = STRIP_CO + [[0.5, 0.5, 0.0]]
STRIPX_FACES = [[0, 1, 5, 12, 4], [1, 2, 6, 5], [2, 3, 7, 6], [4, 12, 5, 9, 8], [5, 6, 10, 9], [6, 7, 11, 10]]

# A 2x2 grid folded 30 degrees along its middle row 3-4-5, with vertex 4 pulled 0.0875 back along y
# so the fold line bends by 10 degrees there (and the two upper quads meet at a 2.4 degree fold):
# Limited Dissolve weighs that bend by the fold angle (10 * 28.8 / 90 = 3.2 degrees) - under a 5
# degree limit vertex 4 dissolves, although its bend alone would keep it. At 2 degrees the upper
# quads do not even join.
_FC, _FS = math.cos(math.radians(30)), math.sin(math.radians(30))
FOLD_CO = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1 - 0.0875, 0], [2, 1, 0],
           [0, 1 + _FC, _FS], [1, 1 + _FC, _FS], [2, 1 + _FC, _FS]]
FOLD_FACES = [[0, 1, 4, 3], [1, 2, 5, 4], [3, 4, 7, 6], [4, 5, 8, 7]]
FOLD_EDGES_ALL = [[0, 1], [1, 4], [4, 3], [3, 0], [1, 2], [2, 5], [5, 4], [4, 7], [7, 6], [6, 3], [5, 8], [8, 7]]

# Grid faces 1 and 4 (sharing edge 5-6) plus a fin face on that edge: joining 1 and 4 cannot delete
# edge 5-6 (it has a third face), so the two faces survive the join and are removed by the
# `delete ... context=DEL_FACES` pass.
FINJ_CO = GRID_CO + [[1.35, 1.4, 1.0]]
FINJ_FACES = GRID_FACES + [[5, 6, 16]]

MODES = {'VERT': (True, False, False), 'EDGE': (False, True, False), 'FACE': (False, False, True)}

cases = []


def apply_extras(bm, extras):
    if not extras:
        return
    for e in edge_lookup(bm, extras.get('seams', [])):
        e.seam = True
    for e in edge_lookup(bm, extras.get('sharp', [])):
        e.smooth = False
    for i, m in enumerate(extras.get('mat', [])):
        bm.faces[i].material_index = m
    if 'uv' in extras:
        layer = bm.loops.layers.uv.new('UVMap')
        for fi, uvs in enumerate(extras['uv']):
            for l, uv in zip(bm.faces[fi].loops, uvs):
                l[layer].uv = uv
    bm.normal_update()


def dump_uvs(bm):
    """Every face's corner UVs (face order and corner order as `dump`), when the mesh has a UV map."""
    layer = bm.loops.layers.uv.active
    if layer is None:
        return None
    return [[[round(c, 6) for c in l[layer].uv] for l in f.loops] for f in bm.faces]


def op_case(name, geo, op, params, sel, extras=None):
    co, faces, edges = geo
    bm = build(co, faces, edges)
    apply_extras(bm, extras)
    args = {}
    if op in ('dissolve_verts', 'dissolve_limit'):
        args['verts'] = [bm.verts[i] for i in sel.get('verts', [])]
    if op in ('dissolve_edges', 'dissolve_limit'):
        args['edges'] = edge_lookup(bm, sel.get('edges', []))
    if op == 'dissolve_faces':
        args['faces'] = [bm.faces[i] for i in sel.get('faces', [])]
    call = dict(params)
    if 'delimit' in call:
        call['delimit'] = set(call['delimit'])
    res = getattr(bmesh.ops, op)(bm, **args, **call)
    out = dump(bm)
    out['uvs'] = dump_uvs(bm)
    region = None
    if res and 'region' in res:
        region = [f.index for f in res['region']]
    cases.append({
        'kind': 'op', 'name': name, 'op': op, 'params': params, 'sel': sel,
        'input': {'positions': co, 'faces': faces, 'edges': edges},
        'extras': extras or {},
        'region': region,
        'output': out,
    })
    bm.free()


def edit_case(name, geo, mode, opname, props, select, hide=None, extras=None, materials=0):
    co, faces, edges = geo
    bpy.ops.wm.read_factory_settings(use_empty=True)
    me = bpy.data.meshes.new('m')
    ob = bpy.data.objects.new('o', me)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    for k in range(materials):
        me.materials.append(bpy.data.materials.new('mat%d' % k))
    bm = build(co, faces, edges, select)
    apply_extras(bm, extras)
    for i in (hide or ()):
        bm.verts[i].hide_set(True)
    bm.to_mesh(me)
    bm.free()
    bpy.context.tool_settings.mesh_select_mode = MODES[mode]
    bpy.ops.object.mode_set(mode='EDIT')
    entered = dump(bmesh.from_edit_mesh(me))['selected']
    call = dict(props)
    if 'delimit' in call:
        call['delimit'] = set(call['delimit'])
    result = getattr(bpy.ops.mesh, opname)(**call)
    out = dump(bmesh.from_edit_mesh(me))
    out['uvs'] = dump_uvs(bmesh.from_edit_mesh(me))
    bpy.ops.object.mode_set(mode='OBJECT')
    cases.append({
        'kind': 'edit', 'name': name, 'mode': mode, 'op': opname, 'props': props,
        'input': {'positions': co, 'faces': faces, 'edges': edges, 'select': select, 'hide': hide or []},
        'extras': extras or {},
        'entered': entered,
        'result': list(result),
        'output': out,
    })


GRID = (GRID_CO, GRID_FACES, [])
FLAT = (FLAT_CO, GRID_FACES, [])
CUBE = (CUBE_CO, CUBE_FACES, [])
FAN = (FAN_CO, FAN_FACES, [])
STRIP = (STRIP_CO, STRIP_FACES, [])
TJ = (T_CO, T_FACES, T_EDGES)
TRIS = (TRIS_CO, TRIS_FACES, [])
QUADTRI = (QUADTRI_CO, QUADTRI_FACES, [])
TUBE = (TUBE_CO, TUBE_FACES, [])
BENT = (BENT_CO, BENT_FACES, [])
FIN = (FIN_CO, FIN_FACES, [])
FLIP = (FLAT_CO, FLIP_FACES, [])
# the grid with a wire edge hanging off interior vertex 5 to an extra vertex 16
GRIDW = (GRID_CO + [[1.0, 0.8, 1.0]], GRID_FACES, [[5, 16]])

# --- bmesh.ops.dissolve_verts ---------------------------------------------------------------------
for fs in (False, True):
    for bt in (False, True):
        p = {'use_face_split': fs, 'use_boundary_tear': bt}
        tag = 'split' if fs else 'nosplit'
        tag += ' tear' if bt else ''
        op_case('verts grid inner 5 ' + tag, GRID, 'dissolve_verts', p, {'verts': [5]})
        op_case('verts grid inner 5,10 ' + tag, GRID, 'dissolve_verts', p, {'verts': [5, 10]})
        op_case('verts grid boundary 1,2,4 ' + tag, GRID, 'dissolve_verts', p, {'verts': [1, 2, 4]})
        op_case('verts grid corner 0 and edge 8 ' + tag, GRID, 'dissolve_verts', p, {'verts': [0, 8]})
        op_case('verts cube corner 7 ' + tag, CUBE, 'dissolve_verts', p, {'verts': [7]})
        op_case('verts fan centre ' + tag, FAN, 'dissolve_verts', p, {'verts': [0]})
        op_case('verts strip loop cut ' + tag, STRIP, 'dissolve_verts', p, {'verts': [4, 5, 6, 7]})
        op_case('verts T-junction 4 ' + tag, TJ, 'dissolve_verts', p, {'verts': [4]})
op_case('verts grid wire spur at 5', GRIDW, 'dissolve_verts', {}, {'verts': [5]})
op_case('verts T spur end 5 and 2', TJ, 'dissolve_verts', {}, {'verts': [5, 2]})
op_case('verts grid all inner', GRID, 'dissolve_verts', {}, {'verts': [5, 6, 9, 10]})
op_case('verts tube middle ring', TUBE, 'dissolve_verts', {'use_face_split': True}, {'verts': list(range(8, 16))})

op_case('verts triangle corner', (TRI_CO, TRI_FACES, []), 'dissolve_verts', {}, {'verts': [1]})
op_case('verts strip loop cut with UVs', STRIP, 'dissolve_verts', {}, {'verts': [4, 5, 6, 7]}, {'uv': STRIP_UV})
op_case('verts strip boundary pair with UVs', STRIP, 'dissolve_verts', {}, {'verts': [1, 2]}, {'uv': STRIP_UV})

# --- bmesh.ops.dissolve_edges ---------------------------------------------------------------------
for uv in (False, True):
    for fs in (False, True):
        p = {'use_verts': uv, 'use_face_split': fs}
        tag = ('verts' if uv else 'noverts') + (' split' if fs else '')
        op_case('edges cube one edge ' + tag, CUBE, 'dissolve_edges', p, {'edges': [[3, 7]]})
        op_case('edges strip loop cut ' + tag, STRIP, 'dissolve_edges', p, {'edges': [[4, 5], [5, 6], [6, 7]]})
        op_case('edges strip partial cut ' + tag, STRIP, 'dissolve_edges', p, {'edges': [[5, 6]]})
        op_case('edges grid cross ' + tag, GRID, 'dissolve_edges', p, {'edges': [[4, 5], [5, 6], [6, 7], [1, 5], [5, 9], [9, 13]]})
        op_case('edges T cut ' + tag, TJ, 'dissolve_edges', p, {'edges': [[3, 4]]})
        op_case('edges grid all inner ' + tag, GRID, 'dissolve_edges', p, {'edges': GRID_INNER_E})
        op_case('edges fan spokes ' + tag, FAN, 'dissolve_edges', p, {'edges': [[0, 1], [0, 3], [0, 5]]})
op_case('edges grid boundary only (no faces join)', GRID, 'dissolve_edges', {'use_verts': True}, {'edges': [[0, 1]]})
op_case('edges grid corner-touching pair', GRID, 'dissolve_edges', {'use_verts': True}, {'edges': [[5, 6], [6, 10]]})
op_case('edges tris diagonal', TRIS, 'dissolve_edges', {'use_verts': True}, {'edges': [[0, 2]]})
op_case('edges quad-tri diagonal', QUADTRI, 'dissolve_edges', {'use_verts': True}, {'edges': [[0, 2]]})
op_case('edges tube ring', TUBE, 'dissolve_edges', {'use_verts': True},
        {'edges': [[8 + i, 8 + (i + 1) % 8] for i in range(8)]})
op_case('edges fin', FIN, 'dissolve_edges', {'use_verts': True}, {'edges': [[0, 1]]})

op_case('edges strip loop cut with UVs', STRIP, 'dissolve_edges', {'use_verts': True},
        {'edges': [[4, 5], [5, 6], [6, 7]]}, {'uv': STRIP_UV})
op_case('edges strip vertical pair with UVs', STRIP, 'dissolve_edges', {'use_verts': True},
        {'edges': [[1, 5], [5, 9]]}, {'uv': STRIP_UV})

op_case('edges strip chain, one chain edge', (STRIPX_CO, STRIPX_FACES, []), 'dissolve_edges', {'use_verts': True},
        {'edges': [[12, 5]]})
op_case('edges strip chain, whole cut', (STRIPX_CO, STRIPX_FACES, []), 'dissolve_edges', {'use_verts': True},
        {'edges': [[4, 12], [12, 5], [5, 6], [6, 7]]})

# --- bmesh.ops.dissolve_faces ---------------------------------------------------------------------
for uv in (False, True):
    p = {'use_verts': uv}
    tag = 'verts' if uv else 'noverts'
    op_case('faces grid all ' + tag, GRID, 'dissolve_faces', p, {'faces': list(range(9))})
    op_case('faces grid two regions and a single ' + tag, GRID, 'dissolve_faces', p, {'faces': [0, 1, 3, 8, 6]})
    op_case('faces grid L region ' + tag, GRID, 'dissolve_faces', p, {'faces': [0, 3, 6, 7, 8]})
    op_case('faces cube three ' + tag, CUBE, 'dissolve_faces', p, {'faces': [0, 1, 4]})
    op_case('faces fan all ' + tag, FAN, 'dissolve_faces', p, {'faces': list(range(6))})
    op_case('faces strip all ' + tag, STRIP, 'dissolve_faces', p, {'faces': list(range(6))})
    op_case('faces T all ' + tag, TJ, 'dissolve_faces', p, {'faces': [0, 1, 2]})
    op_case('faces fin ' + tag, FIN, 'dissolve_faces', p, {'faces': [0, 1, 2]})
    op_case('faces tube ring ' + tag, TUBE, 'dissolve_faces', p, {'faces': list(range(8))})
op_case('faces strip all with UVs', STRIP, 'dissolve_faces', {'use_verts': True}, {'faces': list(range(6))},
        {'uv': STRIP_UV})
op_case('faces two triangles over an existing quad', (DOUBLE_CO, DOUBLE_FACES, []), 'dissolve_faces', {},
        {'faces': [0, 1]})
op_case('faces pair with a fin on the shared edge', (FINJ_CO, FINJ_FACES, []), 'dissolve_faces', {}, {'faces': [1, 4]})
op_case('faces pair with a fin on the shared edge, verts', (FINJ_CO, FINJ_FACES, []), 'dissolve_faces',
        {'use_verts': True}, {'faces': [1, 4]})
op_case('faces grid ring around centre (hole)', GRID, 'dissolve_faces', {}, {'faces': [0, 1, 2, 3, 5, 6, 7, 8]})

# --- bmesh.ops.dissolve_limit ---------------------------------------------------------------------
ALLV = {'verts': ALL_GRID_V, 'edges': GRID_ALL_E}
for deg in (1, 5, 20, 40, 90):
    for bnd in (False, True):
        p = {'angle_limit': math.radians(deg), 'use_dissolve_boundaries': bnd, 'delimit': []}
        tag = '%d deg%s' % (deg, ' boundaries' if bnd else '')
        op_case('limit grid ' + tag, GRID, 'dissolve_limit', p, ALLV)
        op_case('limit tube ' + tag, TUBE, 'dissolve_limit', p,
                {'verts': list(range(24)), 'edges': sorted({tuple(sorted((f[i], f[(i + 1) % 4]))) for f in TUBE_FACES for i in range(4)})})
        op_case('limit bent strip ' + tag, BENT, 'dissolve_limit', p,
                {'verts': list(range(14)), 'edges': sorted({tuple(sorted((f[i], f[(i + 1) % 4]))) for f in BENT_FACES for i in range(4)})})
for deg in (2, 5):
    op_case('limit fold %d' % deg, (FOLD_CO, FOLD_FACES, []), 'dissolve_limit',
            {'angle_limit': math.radians(deg), 'delimit': []}, {'verts': list(range(9)), 'edges': FOLD_EDGES_ALL})
op_case('limit flat grid edges only', FLAT, 'dissolve_limit', {'angle_limit': math.radians(5), 'delimit': []},
        {'verts': [], 'edges': GRID_ALL_E})
op_case('limit flat grid verts only', FLAT, 'dissolve_limit', {'angle_limit': math.radians(5), 'delimit': []},
        {'verts': ALL_GRID_V, 'edges': []})
op_case('limit flat grid subset', FLAT, 'dissolve_limit', {'angle_limit': math.radians(5), 'delimit': []},
        {'verts': [5, 6], 'edges': [[5, 6], [1, 5], [4, 5]]})
op_case('limit cube 90', CUBE, 'dissolve_limit', {'angle_limit': math.radians(90), 'delimit': []},
        {'verts': list(range(8)), 'edges': [[0, 1], [1, 3], [3, 2], [2, 0], [3, 7], [7, 6], [6, 2]]})
op_case('limit fan 5', FAN, 'dissolve_limit', {'angle_limit': math.radians(5), 'delimit': []},
        {'verts': list(range(7)), 'edges': [[0, i] for i in range(1, 7)]})
op_case('limit fan 10', FAN, 'dissolve_limit', {'angle_limit': math.radians(10), 'delimit': []},
        {'verts': list(range(7)), 'edges': [[0, i] for i in range(1, 7)]})
# delimits on the flat grid
SEAMS = [[1, 5], [5, 9], [9, 13]]
SHARP = [[4, 5], [5, 6], [6, 7]]
MAT = [0, 0, 1, 0, 0, 1, 0, 0, 1]
for dl, ex in (('NORMAL', {}), ('SEAM', {'seams': SEAMS}), ('SHARP', {'sharp': SHARP}),
               ('MATERIAL', {'mat': MAT}), ('UV', {'uv': GRID_UV})):
    for with_flag in (False, True):
        p = {'angle_limit': math.radians(5), 'delimit': [dl] if with_flag else []}
        op_case('limit flat delimit %s %s' % (dl, 'on' if with_flag else 'off'), FLAT, 'dissolve_limit', p, ALLV, ex)
op_case('limit flipped corner, delimit NORMAL', FLIP, 'dissolve_limit',
        {'angle_limit': math.radians(5), 'delimit': ['NORMAL']}, ALLV)
op_case('limit flipped corner, no delimit', FLIP, 'dissolve_limit',
        {'angle_limit': math.radians(5), 'delimit': []}, ALLV)
op_case('limit flat all delimits', FLAT, 'dissolve_limit',
        {'angle_limit': math.radians(5), 'delimit': ['SEAM', 'SHARP', 'MATERIAL', 'UV', 'NORMAL']}, ALLV,
        {'seams': [[2, 6]], 'sharp': [[9, 10]], 'mat': [0, 0, 0, 0, 0, 0, 1, 1, 1], 'uv': GRID_UV})

# --- edit mode ------------------------------------------------------------------------------------
edit_case('edit verts grid inner pair', GRID, 'VERT', 'dissolve_verts', {}, {'verts': [5, 6]})
edit_case('edit verts grid inner pair face split', GRID, 'VERT', 'dissolve_verts', {'use_face_split': True}, {'verts': [5, 6]})
edit_case('edit verts grid boundary tear', GRID, 'VERT', 'dissolve_verts', {'use_boundary_tear': True}, {'verts': [1, 2, 7]})
edit_case('edit verts strip loop cut', STRIP, 'VERT', 'dissolve_verts', {}, {'verts': [4, 5, 6, 7]})
edit_case('edit verts grid hidden neighbour', GRID, 'VERT', 'dissolve_verts', {}, {'verts': [5, 10]}, hide=[6])
edit_case('edit verts nothing selected', GRID, 'VERT', 'dissolve_verts', {}, None)
edit_case('edit edges cube one edge', CUBE, 'EDGE', 'dissolve_edges', {}, {'edges': [[3, 7]]})
edit_case('edit edges strip loop cut', STRIP, 'EDGE', 'dissolve_edges', {}, {'edges': [[4, 5], [5, 6], [6, 7]]})
edit_case('edit edges strip loop cut no verts', STRIP, 'EDGE', 'dissolve_edges', {'use_verts': False},
          {'edges': [[4, 5], [5, 6], [6, 7]]})
edit_case('edit edges grid cross face split', GRID, 'EDGE', 'dissolve_edges', {'use_face_split': True},
          {'edges': [[4, 5], [5, 6], [6, 7], [1, 5], [5, 9], [9, 13]]})
edit_case('edit edges T cut', TJ, 'EDGE', 'dissolve_edges', {}, {'edges': [[3, 4]]})
edit_case('edit edges boundary only', GRID, 'EDGE', 'dissolve_edges', {}, {'edges': [[0, 1]]})
edit_case('edit faces grid region', GRID, 'FACE', 'dissolve_faces', {}, {'faces': [0, 1, 3, 4]})
edit_case('edit faces grid region use verts', GRID, 'FACE', 'dissolve_faces', {'use_verts': True}, {'faces': [0, 1, 3, 4]})
edit_case('edit faces two regions', GRID, 'FACE', 'dissolve_faces', {}, {'faces': [0, 1, 7, 8, 5]})
edit_case('edit mode vert', GRID, 'VERT', 'dissolve_mode', {}, {'verts': [5, 6]})
edit_case('edit mode edge', STRIP, 'EDGE', 'dissolve_mode', {}, {'edges': [[4, 5], [5, 6], [6, 7]]})
edit_case('edit mode face', GRID, 'FACE', 'dissolve_mode', {}, {'faces': [0, 1, 3, 4]})
edit_case('edit mode face use verts', GRID, 'FACE', 'dissolve_mode', {'use_verts': True}, {'faces': [0, 1, 3, 4]})
edit_case('edit mode vert tear', GRID, 'VERT', 'dissolve_mode', {'use_boundary_tear': True}, {'verts': [1, 2]})
edit_case('edit limited grid all vert mode', GRID, 'VERT', 'dissolve_limited', {}, {'verts': ALL_GRID_V})
edit_case('edit limited flat all vert mode', FLAT, 'VERT', 'dissolve_limited', {}, {'verts': ALL_GRID_V})
edit_case('edit limited flat faces subset face mode', FLAT, 'FACE', 'dissolve_limited', {}, {'faces': [0, 1, 3, 4]})
edit_case('edit limited bent 10 deg boundaries', BENT, 'VERT', 'dissolve_limited',
          {'angle_limit': math.radians(10), 'use_dissolve_boundaries': True}, {'verts': list(range(14))})
edit_case('edit limited bent 10 deg', BENT, 'VERT', 'dissolve_limited', {'angle_limit': math.radians(10)},
          {'verts': list(range(14))})
edit_case('edit limited tube 50 deg', TUBE, 'VERT', 'dissolve_limited', {'angle_limit': math.radians(50)},
          {'verts': list(range(24))})
edit_case('edit limited strip UV delimit', STRIP, 'VERT', 'dissolve_limited', {'delimit': ['UV']},
          {'verts': list(range(12))}, extras={'uv': STRIP_UV})
edit_case('edit verts strip loop cut with UVs', STRIP, 'VERT', 'dissolve_verts', {}, {'verts': [4, 5, 6, 7]},
          extras={'uv': STRIP_UV})
edit_case('edit limited fold', (FOLD_CO, FOLD_FACES, []), 'VERT', 'dissolve_limited', {}, {'verts': list(range(9))})
edit_case('edit edges strip chain, one chain edge', (STRIPX_CO, STRIPX_FACES, []), 'EDGE', 'dissolve_edges', {},
          {'edges': [[12, 5]]})
edit_case('edit limited flat material delimit', FLAT, 'VERT', 'dissolve_limited', {'delimit': ['MATERIAL']},
          {'verts': ALL_GRID_V}, extras={'mat': MAT}, materials=2)
edit_case('edit limited flat seam+sharp delimit', FLAT, 'EDGE', 'dissolve_limited', {'delimit': ['SEAM', 'SHARP']},
          {'verts': ALL_GRID_V, 'edges': GRID_ALL_E}, extras={'seams': SEAMS, 'sharp': [[8, 9], [9, 10]]})

write(__file__, 'bmesh-ops-dissolve.json', cases)

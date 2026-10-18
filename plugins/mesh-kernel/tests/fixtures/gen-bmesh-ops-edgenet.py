"""
Ground truth for the Fill port (`src/ops/fill.ts`, `src/ops/edgenet.ts`), written by Blender:

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-bmesh-ops-edgenet.py

Two kinds of case:
- `edit`: a mesh object in edit mode with a select mode and a selection runs
  `bpy.ops.mesh.edge_face_add` (`F`); recorded are the selection right after entering edit mode
  (`entered`, the TS side starts from it), the operator's return, and the result.
- `bmo`: a BMesh runs `bmesh.ops.<op>` directly (`contextual_create`, `edgenet_fill`,
  `edgenet_prepare`, `edgeloop_fill`) with explicit slots.

Beside the shared `dump`, every result records per-face smooth flags, material indices, hidden
flags and the select history (`extra`).

Writes `bmesh-ops-edgenet.json` beside this file.
"""

import os
import sys

import bmesh
import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bmesh_fixture_util import build, dump, edge_lookup, write  # noqa: E402

MODES = {'VERT': (True, False, False), 'EDGE': (False, True, False), 'FACE': (False, False, True)}


def extra(bm):
    uv = bm.loops.layers.uv.active
    bm.verts.index_update()
    bm.edges.index_update()
    bm.faces.index_update()
    hist = []
    for ele in bm.select_history:
        if isinstance(ele, bmesh.types.BMVert):
            hist.append({'vert': ele.index})
        elif isinstance(ele, bmesh.types.BMEdge):
            hist.append({'edge': [ele.verts[0].index, ele.verts[1].index]})
        else:
            hist.append({'face': ele.index})
    return {
        'smooth': [f.index for f in bm.faces if f.smooth],
        'mat': [f.material_index for f in bm.faces],
        'hidden': {
            'verts': [v.index for v in bm.verts if v.hide],
            'edges': [[e.verts[0].index, e.verts[1].index] for e in bm.edges if e.hide],
            'faces': [f.index for f in bm.faces if f.hide],
        },
        'history': hist,
        # Per face, the UV of each corner in loop order (only when the mesh has a UV layer).
        'uv': [[[round(l[uv].uv[0], 6), round(l[uv].uv[1], 6)] for l in f.loops] for f in bm.faces] if uv else None,
    }


def prep(bm, smooth=(), mat=None, hide_faces=(), uv=False):
    bm.faces.ensure_lookup_table()
    if uv:
        # Each input face its own UV island: (x/10 + face index, y/10).
        layer = bm.loops.layers.uv.new('uv')
        for fi, f in enumerate(bm.faces):
            for l in f.loops:
                l[layer].uv = (l.vert.co.x * 0.1 + fi, l.vert.co.y * 0.1)
    for i in smooth:
        bm.faces[i].smooth = True
    if mat:
        for i, m in enumerate(mat):
            bm.faces[i].material_index = m
    for i in hide_faces:
        bm.faces[i].hide = True


cases = []


def edit_case(name, co, faces, edges, select, mode, smooth=(), mat=None, hide_faces=(), active_mat=0, uv=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    me = bpy.data.meshes.new('m')
    ob = bpy.data.objects.new('o', me)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    if active_mat:
        for k in range(active_mat + 1):
            me.materials.append(bpy.data.materials.new('mat%d' % k))
        ob.active_material_index = active_mat
    bm = build(co, faces, edges, select)
    prep(bm, smooth, mat, hide_faces, uv)
    bm.to_mesh(me)
    bm.free()
    bpy.context.tool_settings.mesh_select_mode = MODES[mode]
    bpy.ops.object.mode_set(mode='EDIT')
    ebm = bmesh.from_edit_mesh(me)
    entered = dump(ebm)['selected']
    # Hidden flags as edit mode holds them (after the Mesh round trip): the TS side starts from these.
    entered_hidden = extra(ebm)['hidden']
    result = bpy.ops.mesh.edge_face_add()
    ebm = bmesh.from_edit_mesh(me)
    out = dump(ebm)
    out_extra = extra(ebm)
    bpy.ops.object.mode_set(mode='OBJECT')
    cases.append({
        'kind': 'edit',
        'name': name,
        'mode': mode,
        'activeMat': active_mat,
        'input': {'positions': co, 'faces': faces, 'edges': edges, 'select': select,
                  'smooth': list(smooth), 'mat': mat, 'hideFaces': list(hide_faces), 'uv': uv},
        'entered': entered,
        'enteredHidden': entered_hidden,
        'result': sorted(result),
        'output': out,
        'extra': out_extra,
    })


def bmo_case(name, co, faces, edges, op, slots, select=None, smooth=(), mat=None, select_mode='VERT'):
    """`slots` names input elements: 'geom' (dict verts/edges/faces) or 'edges' (vertex pairs)."""
    bm = build(co, faces, edges, select)
    prep(bm, smooth, mat)
    bm.select_mode = {select_mode}
    kw = {}
    for k, val in slots.items():
        if k == 'edges':
            kw['edges'] = edge_lookup(bm, val)
        elif k == 'geom':
            g = [bm.verts[i] for i in val.get('verts', ())]
            g += edge_lookup(bm, val.get('edges', ()))
            g += [bm.faces[i] for i in val.get('faces', ())]
            kw['geom'] = g
        else:
            kw[k] = val
    res = getattr(bmesh.ops, op)(bm, **kw)
    bm.verts.index_update()
    bm.edges.index_update()
    bm.faces.index_update()
    outs = {}
    for k, v in res.items():
        outs[k] = len(v)
    cases.append({
        'kind': 'bmo',
        'name': name,
        'op': op,
        'slots': slots,
        'selectMode': select_mode,
        'input': {'positions': co, 'faces': faces, 'edges': edges, 'select': select,
                  'smooth': list(smooth), 'mat': mat},
        'outLens': outs,
        'output': dump(bm),
        'extra': extra(bm),
    })
    bm.free()


def grid(nx, ny, z=None, skip=()):
    """(nx+1)*(ny+1) vertices row-major, quads (CCW seen from +Z) except those in `skip`."""
    co = []
    for j in range(ny + 1):
        for i in range(nx + 1):
            co.append([float(i), float(j), 0.0 if z is None else z(i, j)])
    fs = []
    for j in range(ny):
        for i in range(nx):
            if (i, j) in skip:
                continue
            a = j * (nx + 1) + i
            fs.append([a, a + 1, a + nx + 2, a + nx + 1])
    return co, fs


def grid_edges(nx, ny):
    """Every edge of an nx*ny grid as vertex pairs (for wire nets)."""
    es = []
    for j in range(ny + 1):
        for i in range(nx + 1):
            a = j * (nx + 1) + i
            if i < nx:
                es.append([a, a + 1])
            if j < ny:
                es.append([a, a + nx + 1])
    return es


def loop_edges(idx):
    return [[idx[k], idx[(k + 1) % len(idx)]] for k in range(len(idx))]


# --- 2 verts -> edge ----------------------------------------------------------------------------
G1_CO, G1_F = grid(2, 1)
edit_case('two verts make an edge', G1_CO, G1_F, [], {'verts': [0, 5]}, 'VERT')
edit_case('two verts already joined: nothing', G1_CO, G1_F, [], {'verts': [0, 1]}, 'VERT')
edit_case('nothing selected', G1_CO, G1_F, [], None, 'VERT')

# --- chain + free vertex ------------------------------------------------------------------------
PENT = [[0, 0, 0], [1, 0, 0], [1.5, 1, 0], [0.5, 1.7, 0], [-0.5, 1, 0]]
edit_case('open chain and a free vertex', PENT, [], [[0, 1], [1, 2], [2, 3]],
          {'verts': [0, 1, 2, 3, 4], 'edges': [[0, 1], [1, 2], [2, 3]]}, 'VERT')
HEX = [[0, 0, 0], [1, 0, 0], [1.6, 0.8, 0], [1, 1.6, 0.3], [0, 1.6, 0], [-0.6, 0.8, -0.2]]
edit_case('open chain of five and a free vertex, non-planar', HEX, [],
          [[0, 1], [1, 2], [2, 3], [3, 4]], {'verts': [0, 1, 2, 3, 4, 5]}, 'VERT')

# --- wire edge nets -----------------------------------------------------------------------------
SQ = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
edit_case('wire square', SQ, [], loop_edges([0, 1, 2, 3]), {'verts': [0, 1, 2, 3]}, 'VERT')
edit_case('wire square, active material 1', SQ, [], loop_edges([0, 1, 2, 3]), {'verts': [0, 1, 2, 3]},
          'VERT', active_mat=1)
W21_CO, _ = grid(2, 1)
edit_case('wire 2x1 net: two holes', W21_CO, [], grid_edges(2, 1), {'verts': list(range(6))}, 'VERT')
W32_CO, _ = grid(3, 2, z=lambda i, j: 0.1 * i * j)
edit_case('wire 3x2 net, non-planar: six holes and the outline', W32_CO, [], grid_edges(3, 2),
          {'verts': list(range(12))}, 'VERT')
# Edge mode keeps the edges unselected when only vertices were selected: a vertex cloud.
edit_case('wire 3x2 net, only verts selected in edge mode', W32_CO, [], grid_edges(3, 2),
          {'verts': list(range(12))}, 'EDGE')
TWO_SQ = SQ + [[3, 0, 0], [4, 0, 0.5], [4, 1, 0], [3, 1, 0]]
edit_case('two separate wire squares', TWO_SQ, [], loop_edges([0, 1, 2, 3]) + loop_edges([4, 5, 6, 7]),
          {'verts': list(range(8))}, 'VERT')
edit_case('wire square with a dangling branch', SQ + [[2, 2, 0]], [], loop_edges([0, 1, 2, 3]) + [[2, 4]],
          {'verts': [0, 1, 2, 3, 4]}, 'VERT')
NP5 = [[0, 0, 0], [1, 0, 0.4], [1.4, 0.9, 0], [0.5, 1.5, 0.5], [-0.4, 0.9, 0]]
edit_case('non-planar wire pentagon', NP5, [], loop_edges([0, 1, 2, 3, 4]), {'verts': list(range(5))}, 'VERT')

# --- partial nets that need edgenet_prepare -------------------------------------------------------
edit_case('open U chain (prepare closes it)', SQ, [], [[0, 1], [1, 2], [2, 3]],
          {'edges': [[0, 1], [1, 2], [2, 3]]}, 'EDGE')
# Two disconnected chains: prepare bridges their ends, choosing the pairing without a bow-tie.
PAR = [[0, 0, 0], [2, 0, 0], [0, 1, 0], [2, 1, 0]]
edit_case('two parallel edges, same direction', PAR, [], [[0, 1], [2, 3]], {'edges': [[0, 1], [2, 3]]}, 'EDGE')
edit_case('two parallel edges, opposite direction', PAR, [], [[0, 1], [3, 2]], {'edges': [[0, 1], [3, 2]]}, 'EDGE')
CH2 = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1.2, 0.3], [1, 1.4, 0], [2, 1.1, -0.2]]
edit_case('two chains of two', CH2, [], [[0, 1], [1, 2], [5, 4], [4, 3]],
          {'edges': [[0, 1], [1, 2], [4, 3], [5, 4]]}, 'EDGE')
# A skewed pair where both pairings are plausible and the planarity test decides.
SKEW = [[0, 0, 0], [2, 0, 0], [1.6, 1.2, 0.9], [0.2, 1.0, -0.6]]
edit_case('two skew edges', SKEW, [], [[0, 1], [2, 3]], {'edges': [[0, 1], [2, 3]]}, 'EDGE')

# Version difference: 3.4.1 swapped the second pair when the two triangle normals pointed apart;
# the current source (#143905) keeps the more planar pairing. Here 3.4.1 swaps and current does not.
BOWTIE = [[0, 0, 0], [2, 0, 0], [1, 1, -1], [2, 1, 1]]
edit_case('two edges where the bow-tie test changed', BOWTIE, [], [[0, 1], [2, 3]], {'edges': [[0, 1], [2, 3]]}, 'EDGE')
bmo_case('edgenet_prepare where the bow-tie test changed', BOWTIE, [], [[0, 1], [2, 3]], 'edgenet_prepare',
         {'edges': [[0, 1], [2, 3]]})

# --- holes in existing geometry -----------------------------------------------------------------
H_CO, H_F = grid(3, 3, skip={(1, 1)})
HOLE = [[5, 6], [6, 10], [10, 9], [9, 5]]
edit_case('hole in a grid (edge loop selected)', H_CO, H_F, [], {'edges': HOLE}, 'EDGE')
edit_case('hole in a smooth grid with materials', H_CO, H_F, [], {'edges': HOLE}, 'EDGE',
          smooth=range(8), mat=[0, 1, 2, 0, 1, 2, 0, 1], active_mat=2)
edit_case('hole next to a hidden face', H_CO, H_F, [], {'edges': HOLE}, 'EDGE', hide_faces=[3])
edit_case('hole in a grid with a UV island per face', H_CO, H_F, [], {'edges': HOLE}, 'EDGE', uv=True)
edit_case('hole split by a wire edge', H_CO, H_F, [[5, 10]], {'edges': HOLE + [[5, 10]]}, 'EDGE')
H2_CO, H2_F = grid(4, 3, skip={(1, 1), (2, 1)})
edit_case('two-quad hole in a grid', H2_CO, H2_F, [],
          {'edges': [[6, 7], [7, 8], [8, 13], [13, 12], [12, 11], [11, 6]]}, 'EDGE')

edit_case('two-quad hole split by a wire edge, with UVs', H2_CO, H2_F, [[7, 12]],
          {'edges': [[6, 7], [7, 8], [8, 13], [13, 12], [12, 11], [11, 6], [7, 12]]}, 'EDGE', uv=True)
X_CO, X_F = grid(4, 4, skip={(1, 1), (2, 1), (1, 2), (2, 2)})
edit_case('2x2 hole split by a wire cross, with UVs', X_CO, X_F, [[7, 12], [12, 17], [11, 12], [12, 13]],
          {'edges': [[6, 7], [7, 8], [8, 13], [13, 18], [18, 17], [17, 16], [16, 11], [11, 6],
                     [7, 12], [12, 17], [11, 12], [12, 13]]}, 'EDGE', uv=True)

# --- faces selected -> dissolve -------------------------------------------------------------------
edit_case('two faces dissolve', G1_CO, G1_F, [], {'faces': [0, 1]}, 'FACE')
G22_CO, G22_F = grid(2, 2)
edit_case('three faces of a 2x2 grid dissolve', G22_CO, G22_F, [], {'faces': [0, 1, 2]}, 'FACE')
edit_case('single face: existing face, nothing', G1_CO, G1_F, [], {'faces': [0]}, 'FACE')
edit_case('all verts of an existing quad: nothing', G1_CO, G1_F, [], {'verts': [0, 1, 4, 3]}, 'VERT')

# --- edge loop fill (around existing geometry) ----------------------------------------------------
BOX_CO = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
          [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
          [0, 0, 2], [1, 0, 2], [1, 1, 2], [0, 1, 2]]
BOX_F = [[0, 3, 2, 1], [8, 9, 10, 11],
         [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
         [4, 5, 9, 8], [5, 6, 10, 9], [6, 7, 11, 10], [7, 4, 8, 11]]
edit_case('middle loop of a tall box (edgeloop_fill)', BOX_CO, BOX_F, [],
          {'edges': loop_edges([4, 5, 6, 7])}, 'EDGE', smooth=range(10))

# --- vertex cloud ---------------------------------------------------------------------------------
CLOUD = [[0, 0, 0], [2, 0.1, 0], [2.2, 1.9, 0.1], [-0.1, 2, 0], [1, 2.8, 0.05]]
edit_case('vertex cloud of five', CLOUD, [], [], {'verts': [0, 1, 2, 3, 4]}, 'VERT')
edit_case('vertex cloud of three', CLOUD[:3], [], [], {'verts': [0, 1, 2]}, 'VERT')
CLOUD_NP = [[0, 0, 0], [2, 0, 0.6], [2.4, 1.5, 0], [1, 2.5, 0.7], [-0.5, 1.5, -0.4], [0.9, 1.1, 1.2]]
edit_case('non-planar vertex cloud of six', CLOUD_NP, [], [], {'verts': list(range(6))}, 'VERT')
# Version difference: the current source refines the cloud normal (all vertices in radial order),
# 3.4.1 does not; for this non-planar cloud the radial order of the face changes.
CLOUD_REFINE = [[3, 0, 0], [2, 2, 1], [2, 3, 0], [-3, 3, 0], [2, 1, 1]]
edit_case('vertex cloud where the normal refine changed the order', CLOUD_REFINE, [], [], {'verts': [0, 1, 2, 3, 4]}, 'VERT')
# A triangle against a smooth quad: the shared edge votes the winding and the smoothness.
TRI_CO = SQ + [[0.5, -1, 0]]
edit_case('cloud triangle against a smooth quad', TRI_CO, [[0, 1, 2, 3]], [], {'verts': [0, 1, 4]}, 'VERT',
          smooth=[0])

edit_case('cloud triangle against a quad with UVs', TRI_CO, [[0, 1, 2, 3]], [], {'verts': [0, 1, 4]}, 'VERT', uv=True)
edit_case('cloud triangle against a clockwise smooth quad', TRI_CO, [[0, 3, 2, 1]], [], {'verts': [0, 1, 4]}, 'VERT',
          smooth=[0])

# --- face attributes from a hidden neighbour --------------------------------------------------------
HID_CO = SQ + [[2, 0, 0], [2, 1, 0]]
edit_case('wire square next to a hidden face', HID_CO, [[0, 1, 2, 3]], [[1, 4], [4, 5], [5, 2]],
          {'edges': [[1, 4], [4, 5], [5, 2], [1, 2]]}, 'EDGE', hide_faces=[0])

# --- a path around an existing face (overlap test) ------------------------------------------------
PENT_A = SQ + [[0.5, 1.8, 0], [0.1, 2.6, 0], [0.9, 2.6, 0]]
edit_case('pentagon path around a quad', PENT_A, [[0, 1, 2, 3]], [[2, 4], [4, 3]],
          {'edges': [[0, 1], [1, 2], [2, 4], [4, 3], [3, 0]]}, 'EDGE')
edit_case('pentagon path around a quad, triangle at the apex', PENT_A, [[0, 1, 2, 3], [4, 5, 6]], [[2, 4], [4, 3]],
          {'edges': [[0, 1], [1, 2], [2, 4], [4, 3], [3, 0]]}, 'EDGE')

# --- tricky extend --------------------------------------------------------------------------------
L_CO, L_F = grid(2, 2, skip={(1, 1)})
edit_case('tricky: inner corner vertex of an L', L_CO, L_F, [], {'verts': [4]}, 'VERT')
edit_case('tricky: vertex between two wire edges', SQ, [], [[0, 1], [1, 2]], {'verts': [1]}, 'VERT')
edit_case('tricky: wire corner with the closing edge present', SQ, [], [[0, 1], [1, 2], [0, 2]],
          {'verts': [1]}, 'VERT')
N_CO, N_F = grid(3, 2, skip={(1, 1)})
edit_case('tricky: notch bottom edge', N_CO, N_F, [], {'edges': [[5, 6]]}, 'EDGE')
edit_case('tricky: notch bottom edge, top edge exists', N_CO, N_F, [[9, 10]], {'edges': [[5, 6]]}, 'EDGE')
edit_case('tricky: notch bottom edge in vertex mode', N_CO, N_F, [], {'edges': [[5, 6]]}, 'VERT')
WB = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, -1, 0], [1, -1, 0]]
edit_case('tricky: boundary edge with wire edges at both ends', WB, [[4, 5, 1, 0]], [[0, 3], [1, 2]],
          {'edges': [[0, 1]]}, 'EDGE')
edit_case('tricky: edge between two wire edges', SQ, [], [[0, 1], [1, 2], [3, 0]], {'edges': [[0, 1]]}, 'EDGE')
edit_case('tricky: single vertex with nothing to extend', L_CO, L_F, [], {'verts': [0]}, 'VERT')

# --- bmesh.ops directly ---------------------------------------------------------------------------
bmo_case('contextual_create on a wire square, mat_nr and use_smooth', SQ, [], loop_edges([0, 1, 2, 3]),
         'contextual_create', {'geom': {'verts': [0, 1, 2, 3], 'edges': loop_edges([0, 1, 2, 3])},
                               'mat_nr': 3, 'use_smooth': True})
# The verts are selected, the edges are not: the operator's select flush (SELECT_FLUSH) selects them.
bmo_case('contextual_create with only the verts selected (select flush)', SQ, [], loop_edges([0, 1, 2, 3]),
         'contextual_create', {'geom': {'verts': [0, 1, 2, 3], 'edges': loop_edges([0, 1, 2, 3])}},
         select={'verts': [0, 1, 2, 3]})
bmo_case('contextual_create on a vertex cloud, mat_nr and use_smooth', CLOUD, [], [],
         'contextual_create', {'geom': {'verts': [0, 1, 2, 3, 4]}, 'mat_nr': 2, 'use_smooth': True})
bmo_case('edgenet_fill on a wire 3x2 net, mat_nr and use_smooth', W32_CO, [], grid_edges(3, 2), 'edgenet_fill',
         {'edges': grid_edges(3, 2), 'mat_nr': 1, 'use_smooth': True})
bmo_case('edgenet_fill in a grid hole, mat_nr and use_smooth', H_CO, H_F, [], 'edgenet_fill',
         {'edges': HOLE, 'mat_nr': 4, 'use_smooth': True}, smooth=[0, 2], mat=[1, 1, 1, 2, 2, 2, 3, 3])
bmo_case('edgenet_fill on part of a net', W21_CO, [], grid_edges(2, 1), 'edgenet_fill',
         {'edges': [[0, 1], [1, 4], [4, 3], [3, 0], [1, 2]]})
bmo_case('edgenet_prepare on two skew edges', SKEW, [], [[0, 1], [2, 3]], 'edgenet_prepare',
         {'edges': [[0, 1], [2, 3]]})
bmo_case('edgenet_prepare on two chains of two', CH2, [], [[0, 1], [1, 2], [5, 4], [4, 3]], 'edgenet_prepare',
         {'edges': [[0, 1], [1, 2], [4, 3], [5, 4]]})
bmo_case('edgenet_prepare on a closed loop: nothing', SQ, [], loop_edges([0, 1, 2, 3]), 'edgenet_prepare',
         {'edges': loop_edges([0, 1, 2, 3])})
bmo_case('edgenet_prepare on a branch: nothing', SQ + [[2, 2, 0]], [], [[0, 1], [1, 2], [1, 4]],
         'edgenet_prepare', {'edges': [[0, 1], [1, 2], [1, 4]]})
bmo_case('edgeloop_fill on two loops, mat_nr and use_smooth', TWO_SQ, [], loop_edges([0, 1, 2, 3]) + loop_edges([4, 5, 6, 7]),
         'edgeloop_fill', {'edges': loop_edges([0, 1, 2, 3]) + loop_edges([4, 5, 6, 7]), 'mat_nr': 2, 'use_smooth': True})
bmo_case('edgeloop_fill on a box middle loop', BOX_CO, BOX_F, [], 'edgeloop_fill', {'edges': loop_edges([4, 5, 6, 7])})
bmo_case('edgeloop_fill on a chain: nothing', SQ, [], [[0, 1], [1, 2], [2, 3]], 'edgeloop_fill',
         {'edges': [[0, 1], [1, 2], [2, 3]]})

write(__file__, 'bmesh-ops-edgenet.json', cases)

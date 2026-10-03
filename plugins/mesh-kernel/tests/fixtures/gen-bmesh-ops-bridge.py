"""
Ground truth for the Bridge Edge Loops and Subdivide Edge-Ring ports (`src/ops/bridge.ts`,
`src/ops/subdivideEdgering.ts`), written by Blender:

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-bmesh-ops-bridge.py

Two kinds of case:
- `bmesh.ops.bridge_loops` / `bmesh.ops.subdivide_edgering` on a BMesh built from explicit data
  (`kind: 'bmo'`). The input edges are given as vertex pairs. A new BMesh has every vertex index at
  -1 (`BM_vert_create`), which the beautify pass of an uneven bridge reads; the TS side builds the
  same way.
- the edit-mode operators `bpy.ops.mesh.bridge_edge_loops` / `bpy.ops.mesh.subdivide_edgering`
  (`kind: 'edit'`) on an object entered into edit mode with a select mode and a selection. The
  selection as edit mode holds it right after entering is recorded as `entered`, and the TS side
  starts from exactly that.

Every case records the whole mesh afterwards (positions, faces with winding, every edge, the
selection). Nothing here is hand-written; rerun to regenerate.

Writes `bmesh-ops-bridge.json` beside this file.
"""

import math
import os
import sys

import bmesh
import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bmesh_fixture_util import build, dump, edge_lookup, write  # noqa: E402

MODES = {'VERT': (True, False, False), 'EDGE': (False, True, False), 'FACE': (False, False, True)}


# --- geometry -------------------------------------------------------------------------------------

class Geo:
    """Explicit mesh data: positions, faces, wire edges, and named vertex-index groups."""

    def __init__(self):
        self.co = []
        self.faces = []
        self.edges = []
        self.groups = {}

    def ring(self, name, n, r, z, phase=0.0, cx=0.0, cy=0.0, wobble=0.0, closed=True, wire=True, rx=None):
        start = len(self.co)
        for i in range(n):
            a = phase + 2 * math.pi * i / n
            self.co.append([round(cx + (rx if rx is not None else r) * math.cos(a), 6),
                            round(cy + r * math.sin(a), 6),
                            round(z + (wobble * math.sin(3 * a + 0.4) if wobble else 0.0), 6)])
        idx = list(range(start, start + n))
        self.groups[name] = idx
        if wire:
            for i in range(n if closed else n - 1):
                self.edges.append([idx[i], idx[(i + 1) % n]])
        return idx

    def chain(self, name, pts, wire=True):
        start = len(self.co)
        for p in pts:
            self.co.append([round(c, 6) for c in p])
        idx = list(range(start, start + len(pts)))
        self.groups[name] = idx
        if wire:
            for i in range(len(idx) - 1):
                self.edges.append([idx[i], idx[i + 1]])
        return idx

    def band(self, a, b, closed=True):
        """Quads between two equal index lists (a -> b), wound so the normal points outwards for rings."""
        n = len(a)
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            self.faces.append([a[i], a[j], b[j], b[i]])

    def loop_edges(self, idx, closed=True):
        n = len(idx)
        return [[idx[i], idx[(i + 1) % n]] for i in range(n if closed else n - 1)]


def tube(n, zs, r=1.0, phases=None, radii=None, wobble=0.0):
    """Rings at heights `zs` joined by quad bands."""
    g = Geo()
    rings = []
    for k, z in enumerate(zs):
        rings.append(g.ring('r%d' % k, n, radii[k] if radii else r, z,
                            phase=(phases[k] if phases else 0.0), wobble=wobble, wire=False))
    for k in range(len(rings) - 1):
        g.band(rings[k], rings[k + 1])
    return g, rings


cases = []


def uv_of(vi, fi):
    """A distinct UV per face corner, so a corner copied from the wrong loop shows."""
    return [round(vi * 0.1 + fi * 0.013, 4), round(fi * 0.1 + vi * 0.007, 4)]


def add_uvs(bm):
    """Give every face corner of the input `uv_of(vertex index, face index)` in a UV layer, and every
    face material index `face index % 3`."""
    bm.verts.index_update()
    bm.faces.index_update()
    uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        f.material_index = f.index % 3
        for l in f.loops:
            l[uv].uv = uv_of(l.vert.index, f.index)


def dump_uvs(bm):
    """Per face (in `dump`'s order), the UV of each corner, then `[material_index]`."""
    uv = bm.loops.layers.uv.active
    if uv is None:
        return None
    return [[[round(c, 5) for c in l[uv].uv] for l in f.loops] + [[f.material_index]] for f in bm.faces]


def bmo_case(name, op, geo, edges, params, select=None, mode='VERT', uv=False):
    """`bmesh.ops.<op>` with `edges` (vertex pairs) as input."""
    bm = build(geo.co, geo.faces, geo.edges, select)
    if uv:
        add_uvs(bm)
    in_uvs = dump_uvs(bm)
    bm.select_mode = {mode}
    edges_in = edge_lookup(bm, edges)
    assert all(e is not None for e in edges_in), name
    out = getattr(bmesh.ops, op)(bm, edges=edges_in, **params)
    bm.normal_update()
    rec = {
        'name': name, 'kind': 'bmo', 'op': op, 'params': params, 'mode': mode,
        'input': {'positions': geo.co, 'faces': geo.faces, 'edges': geo.edges, 'select': select},
        'inputEdges': edges,
        'outCounts': {k.replace('.out', ''): len(v) for k, v in out.items()},
        'output': dump(bm),
        'uv': uv,
        'inputUvs': in_uvs,
        'outputUvs': dump_uvs(bm),
    }
    cases.append(rec)
    bm.free()


def edit_case(name, op, geo, select, mode, props, uv=False):
    """`bpy.ops.mesh.<op>` in edit mode on an object built from `geo` with `select`."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    me = bpy.data.meshes.new('m')
    ob = bpy.data.objects.new('o', me)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bm = build(geo.co, geo.faces, geo.edges, select)
    if uv:
        add_uvs(bm)
    in_uvs = dump_uvs(bm)
    bm.to_mesh(me)
    bm.free()
    bpy.context.tool_settings.mesh_select_mode = MODES[mode]
    bpy.ops.object.mode_set(mode='EDIT')
    entered = dump(bmesh.from_edit_mesh(me))['selected']
    result = getattr(bpy.ops.mesh, op)(**props)
    bm = bmesh.from_edit_mesh(me)
    out = dump(bm)
    out_uvs = dump_uvs(bm)
    bpy.ops.object.mode_set(mode='OBJECT')
    cases.append({
        'name': name, 'kind': 'edit', 'op': op, 'props': props, 'mode': mode,
        'input': {'positions': geo.co, 'faces': geo.faces, 'edges': geo.edges, 'select': select},
        'entered': entered,
        'result': list(result),
        'output': out,
        'uv': uv,
        'inputUvs': in_uvs,
        'outputUvs': out_uvs,
    })


# =================================================================================================
# bridge_loops (bmesh.ops)
# =================================================================================================

# Two closed wire rings of 8, the second smaller, rotated by 10 degrees and wobbly (non-planar).
G = Geo()
A = G.ring('a', 8, 1.0, 0.0)
B = G.ring('b', 8, 0.8, 2.0, phase=math.radians(10), wobble=0.15)
RINGS8 = (G, A, B)
E_AB = G.loop_edges(A) + G.loop_edges(B)
bmo_case('bmo two rings of 8', 'bridge_loops', G, E_AB, {})
bmo_case('bmo two rings of 8 twist 1', 'bridge_loops', G, E_AB, {'twist_offset': 1})
bmo_case('bmo two rings of 8 twist -2', 'bridge_loops', G, E_AB, {'twist_offset': -2})
bmo_case('bmo two rings of 8 twist 11', 'bridge_loops', G, E_AB, {'twist_offset': 11})
bmo_case('bmo two rings of 8 merge 0.5', 'bridge_loops', G, E_AB, {'use_merge': True, 'merge_factor': 0.5})
bmo_case('bmo two rings of 8 merge 0', 'bridge_loops', G, E_AB, {'use_merge': True, 'merge_factor': 0.0})
bmo_case('bmo two rings of 8 merge 0.3', 'bridge_loops', G, E_AB, {'use_merge': True, 'merge_factor': 0.3})
bmo_case('bmo two rings of 8 selected (flush)', 'bridge_loops', G, E_AB, {},
         select={'verts': A + B, 'edges': E_AB})
bmo_case('bmo one ring only (refused)', 'bridge_loops', G, G.loop_edges(A), {})

# Concentric rings in one plane (no depth between the loops).
G = Geo()
A = G.ring('a', 6, 1.0, 0.0)
B = G.ring('b', 6, 0.5, 0.0, phase=0.2)
bmo_case('bmo concentric planar rings', 'bridge_loops', G, G.loop_edges(A) + G.loop_edges(B), {})

# Different counts: 8 and 5, and 9 and 4 (expand more than double).
G = Geo()
A = G.ring('a', 8, 1.0, 0.0)
B = G.ring('b', 5, 0.7, 1.5, phase=0.3, wobble=0.1)
bmo_case('bmo rings 8 and 5', 'bridge_loops', G, G.loop_edges(A) + G.loop_edges(B), {})
bmo_case('bmo rings 8 and 5 twist 2', 'bridge_loops', G, G.loop_edges(A) + G.loop_edges(B), {'twist_offset': 2})
bmo_case('bmo rings 8 and 5 merge (refused)', 'bridge_loops', G, G.loop_edges(A) + G.loop_edges(B),
         {'use_merge': True, 'merge_factor': 0.5})
G = Geo()
A = G.ring('a', 9, 1.2, 0.0, phase=0.1)
B = G.ring('b', 4, 0.6, 1.0, phase=0.5)
bmo_case('bmo rings 9 and 4', 'bridge_loops', G, G.loop_edges(A) + G.loop_edges(B), {})

# Open chains: equal, reversed, and different counts.
G = Geo()
A = G.chain('a', [[0, 0, 0], [1, 0, 0.1], [2, 0, 0], [3, 0, -0.2], [4, 0, 0]])
B = G.chain('b', [[4.2, 2, 0.5], [3.1, 2, 0.4], [2, 2.1, 0.5], [0.9, 2, 0.6], [0, 2, 0.5]])
bmo_case('bmo open chains of 5 (reversed)', 'bridge_loops', G, G.loop_edges(A, False) + G.loop_edges(B, False), {})
bmo_case('bmo open chains of 5 merge 0.5', 'bridge_loops', G, G.loop_edges(A, False) + G.loop_edges(B, False),
         {'use_merge': True, 'merge_factor': 0.5})
G = Geo()
A = G.chain('a', [[0, 0, 0], [1, 0, 0], [2, 0, 0.3], [3, 0, 0], [4, 0, 0], [5, 0, 0.1]])
B = G.chain('b', [[0, 1.5, 1], [2.5, 1.5, 1.2], [5, 1.5, 1]])
bmo_case('bmo open chains 6 and 3', 'bridge_loops', G, G.loop_edges(A, False) + G.loop_edges(B, False), {})
# Chains aligned with the direction between them (#43013 corner case).
G = Geo()
A = G.chain('a', [[0, 0, 0], [1, 0, 0], [2, 0, 0]])
B = G.chain('b', [[3, 0, 0], [4, 0, 0], [5, 0, 0]])
bmo_case('bmo collinear chains', 'bridge_loops', G, G.loop_edges(A, False) + G.loop_edges(B, False), {})

# Mixed: a closed ring and an open chain of the same count (bridged as open).
G = Geo()
A = G.ring('a', 6, 1.0, 0.0)
B = G.ring('b', 6, 1.0, 1.5, closed=False, phase=0.25)
bmo_case('bmo closed ring and open chain', 'bridge_loops', G, G.loop_edges(A) + G.loop_edges(B, False), {})

# Branching input: a ring with a spur makes a vertex with three input edges, so no loop there.
G = Geo()
A = G.ring('a', 6, 1.0, 0.0)
S = G.chain('s', [[2.0, 0, 0]], wire=False)
G.edges.append([A[0], S[0]])
B = G.ring('b', 6, 1.0, 2.0)
bmo_case('bmo branching ring and a ring (one loop)', 'bridge_loops', G,
         G.loop_edges(A) + [[A[0], S[0]]] + G.loop_edges(B), {})

# Three and four loops: sequence, cyclic, pairs.
G = Geo()
L = [G.ring('l%d' % k, 6, 1.0 - 0.1 * k, 1.2 * k, phase=0.1 * k, wobble=0.05 * k) for k in range(4)]
E4 = sum((G.loop_edges(l) for l in L), [])
bmo_case('bmo four rings in sequence', 'bridge_loops', G, E4, {})
bmo_case('bmo four rings pairs', 'bridge_loops', G, E4, {'use_pairs': True})
bmo_case('bmo four rings merge', 'bridge_loops', G, E4, {'use_merge': True, 'merge_factor': 0.5})
E3 = sum((G.loop_edges(l) for l in L[:3]), [])
bmo_case('bmo three rings pairs (refused)', 'bridge_loops', G, E3, {'use_pairs': True})
# Rings around a circle (torus sections), cyclic.
G = Geo()
T = []
for k in range(4):
    ang = 2 * math.pi * k / 4 + 0.15
    cx, cy = 3 * math.cos(ang), 3 * math.sin(ang)
    start = len(G.co)
    for i in range(6):
        a = 2 * math.pi * i / 6
        rr = 3 + 0.8 * math.cos(a)
        G.co.append([round(rr * math.cos(ang), 6), round(rr * math.sin(ang), 6), round(0.8 * math.sin(a), 6)])
    idx = list(range(start, start + 6))
    T.append(idx)
    G.edges += G.loop_edges(idx)
ET = sum((G.loop_edges(l) for l in T), [])
bmo_case('bmo four torus sections cyclic', 'bridge_loops', G, ET, {'use_cyclic': True})
bmo_case('bmo four torus sections not cyclic', 'bridge_loops', G, ET, {})
bmo_case('bmo three torus sections cyclic', 'bridge_loops', G, sum((G.loop_edges(l) for l in T[:3]), []),
         {'use_cyclic': True})

# Loops that are the open ends of two tubes (winding votes from the surrounding faces).
G, R = tube(8, [0.0, 1.0], r=1.0)
off = len(G.co)
G2, R2 = tube(8, [2.5, 3.5], r=0.9, phases=[0.2, 0.2])
for c in G2.co:
    G.co.append(c)
for f in G2.faces:
    G.faces.append([i + off for i in f])
R2 = [[i + off for i in r] for r in R2]
TUBES = (G, R, R2)
bmo_case('bmo two tube ends', 'bridge_loops', G, G.loop_edges(R[1]) + G.loop_edges(R2[0]), {})
bmo_case('bmo two tube outer ends', 'bridge_loops', G, G.loop_edges(R[0]) + G.loop_edges(R2[1]), {})
bmo_case('bmo two tube ends twist 3', 'bridge_loops', G, G.loop_edges(R[1]) + G.loop_edges(R2[0]),
         {'twist_offset': 3})
G, R = tube(8, [0.0, 1.0], r=1.0)
off = len(G.co)
G2, R2 = tube(6, [2.5, 3.5], r=0.7, phases=[0.3, 0.3])
for c in G2.co:
    G.co.append(c)
for f in G2.faces:
    G.faces.append([i + off for i in f])
R2 = [[i + off for i in r] for r in R2]
TUBES86 = (G, R, R2)
bmo_case('bmo tube ends 8 and 6', 'bridge_loops', G, G.loop_edges(R[1]) + G.loop_edges(R2[0]), {})
bmo_case('bmo tube ends 8 and 6 uv', 'bridge_loops', G, G.loop_edges(R[1]) + G.loop_edges(R2[0]), {}, uv=True)
G, R, R2 = TUBES
bmo_case('bmo two tube ends uv', 'bridge_loops', G, G.loop_edges(R[1]) + G.loop_edges(R2[0]), {}, uv=True)
bmo_case('bmo two tube ends merge uv', 'bridge_loops', G, G.loop_edges(R[1]) + G.loop_edges(R2[0]),
         {'use_merge': True, 'merge_factor': 0.4}, uv=True)

# Very uneven loops, where beautify could rotate an edge into a chord of one loop
# (`use_restrict_tag` forbids it).
G = Geo()
A = G.ring('a', 12, 1.0, 0.0)
B = G.ring('b', 3, 0.25, 0.05, phase=0.4)
bmo_case('bmo rings 12 and 3 nearly planar', 'bridge_loops', G, G.loop_edges(A) + G.loop_edges(B), {})
G = Geo()
A = G.ring('a', 10, 1.0, 0.0, wobble=0.3)
B = G.ring('b', 4, 0.5, 0.6, phase=0.2, cx=0.6)
bmo_case('bmo rings 10 and 4 offset', 'bridge_loops', G, G.loop_edges(A) + G.loop_edges(B), {})
G = Geo()
A = G.chain('a', [[x * 0.5, 0, 0.4 * math.sin(x * 1.3)] for x in range(9)])
B = G.chain('b', [[0.3, 1.0, 0.2], [3.7, 1.2, -0.1]])
bmo_case('bmo open chains 9 and 2', 'bridge_loops', G, G.loop_edges(A, False) + G.loop_edges(B, False), {})

# =================================================================================================
# subdivide_edgering (bmesh.ops)
# =================================================================================================

# A closed band (rings at z = -1, 0, 1, 2) so the ring between z=0 and z=1 has faces outside it.
G, R = tube(8, [-1.0, 0.0, 1.0, 2.0], r=1.0, radii=[1.3, 1.0, 1.0, 0.7], wobble=0.08)
BAND = (G, R)
RING01 = [[R[1][i], R[2][i]] for i in range(8)]
for interp in ('LINEAR', 'PATH', 'SURFACE'):
    for cuts in (1, 2, 3):
        bmo_case('bmo subdiv band %s cuts %d' % (interp, cuts), 'subdivide_edgering', G, RING01,
                 {'interp_mode': interp, 'cuts': cuts, 'smooth': 1.0})
bmo_case('bmo subdiv band PATH smooth 0.4', 'subdivide_edgering', G, RING01,
         {'interp_mode': 'PATH', 'cuts': 3, 'smooth': 0.4})
bmo_case('bmo subdiv band SURFACE smooth 2', 'subdivide_edgering', G, RING01,
         {'interp_mode': 'SURFACE', 'cuts': 2, 'smooth': 2.0})
for shape, fac in (('SMOOTH', 0.5), ('SPHERE', -0.4), ('ROOT', 0.8), ('INVERSE_SQUARE', 0.3), ('SHARP', -0.6),
                   ('LINEAR', 1.0)):
    for interp in ('LINEAR', 'PATH', 'SURFACE'):
        bmo_case('bmo subdiv band %s profile %s %g' % (interp, shape, fac), 'subdivide_edgering', G, RING01,
                 {'interp_mode': interp, 'cuts': 3, 'smooth': 1.0, 'profile_shape': shape,
                  'profile_shape_factor': fac})
# Two adjacent rings (three rims): the multi-pair path.
RING012 = RING01 + [[R[2][i], R[3][i]] for i in range(8)]
for interp in ('LINEAR', 'PATH', 'SURFACE'):
    bmo_case('bmo subdiv two rings %s' % interp, 'subdivide_edgering', G, RING012,
             {'interp_mode': interp, 'cuts': 2, 'smooth': 1.0})
# An open strip: a 5x3 grid, the middle row's rungs.
G = Geo()
rows = []
for y, yy in enumerate([0.0, 1.0, 2.2]):
    rows.append(G.chain('row%d' % y, [[x * 1.0, yy, 0.3 * math.sin(x + y)] for x in range(5)], wire=False))
for y in range(2):
    G.band(rows[y], rows[y + 1], closed=False)
STRIP = (G, rows)
RUNGS = [[rows[0][x], rows[1][x]] for x in range(5)]
bmo_case('bmo subdiv band SURFACE uv', 'subdivide_edgering', BAND[0], RING01,
         {'interp_mode': 'SURFACE', 'cuts': 2, 'smooth': 1.0}, uv=True)
for interp in ('LINEAR', 'PATH', 'SURFACE'):
    bmo_case('bmo subdiv open strip %s' % interp, 'subdivide_edgering', G, RUNGS,
             {'interp_mode': interp, 'cuts': 2, 'smooth': 1.0})
bmo_case('bmo subdiv open strip profile', 'subdivide_edgering', G, RUNGS,
         {'interp_mode': 'SURFACE', 'cuts': 3, 'smooth': 1.0, 'profile_shape': 'SMOOTH', 'profile_shape_factor': 0.5})
bmo_case('bmo subdiv no ring (refused)', 'subdivide_edgering', G, [[rows[0][0], rows[0][1]]],
         {'interp_mode': 'PATH', 'cuts': 2, 'smooth': 1.0})

# =================================================================================================
# edit mode: bridge_edge_loops
# =================================================================================================

G, A, B = RINGS8
E_AB = G.loop_edges(A) + G.loop_edges(B)
edit_case('edit two rings defaults', 'bridge_edge_loops', G, {'edges': E_AB}, 'EDGE', {})
edit_case('edit two rings vertex mode', 'bridge_edge_loops', G, {'verts': A + B}, 'VERT', {})
edit_case('edit two rings twist 2', 'bridge_edge_loops', G, {'edges': E_AB}, 'EDGE', {'twist_offset': 2})
edit_case('edit two rings merge 0.25', 'bridge_edge_loops', G, {'edges': E_AB}, 'EDGE',
          {'use_merge': True, 'merge_factor': 0.25})
edit_case('edit one ring (refused)', 'bridge_edge_loops', G, {'edges': G.loop_edges(A)}, 'EDGE', {})
edit_case('edit nothing selected', 'bridge_edge_loops', G, None, 'EDGE', {})
for interp in ('LINEAR', 'PATH', 'SURFACE'):
    for cuts in (1, 2, 3):
        edit_case('edit two rings %s cuts %d' % (interp, cuts), 'bridge_edge_loops', G, {'edges': E_AB}, 'EDGE',
                  {'number_cuts': cuts, 'interpolation': interp})

G, R, R2 = TUBES
ET = G.loop_edges(R[1]) + G.loop_edges(R2[0])
for interp in ('LINEAR', 'PATH', 'SURFACE'):
    for cuts in (1, 3):
        edit_case('edit tube ends %s cuts %d' % (interp, cuts), 'bridge_edge_loops', G, {'edges': ET}, 'EDGE',
                  {'number_cuts': cuts, 'interpolation': interp})
edit_case('edit tube ends PATH smoothness 0.3', 'bridge_edge_loops', G, {'edges': ET}, 'EDGE',
          {'number_cuts': 3, 'interpolation': 'PATH', 'smoothness': 0.3})
edit_case('edit tube ends SURFACE smoothness 1.8', 'bridge_edge_loops', G, {'edges': ET}, 'EDGE',
          {'number_cuts': 3, 'interpolation': 'SURFACE', 'smoothness': 1.8})
for shape, fac in (('SMOOTH', 0.6), ('SPHERE', -0.5), ('ROOT', 0.4), ('INVERSE_SQUARE', 0.7), ('SHARP', 1.2),
                   ('LINEAR', -0.3)):
    edit_case('edit tube ends profile %s %g' % (shape, fac), 'bridge_edge_loops', G, {'edges': ET}, 'EDGE',
              {'number_cuts': 3, 'interpolation': 'SURFACE', 'profile_shape': shape, 'profile_shape_factor': fac})
edit_case('edit tube ends PATH profile', 'bridge_edge_loops', G, {'edges': ET}, 'EDGE',
          {'number_cuts': 2, 'interpolation': 'PATH', 'profile_shape': 'SMOOTH', 'profile_shape_factor': 0.5})
edit_case('edit tube ends LINEAR profile', 'bridge_edge_loops', G, {'edges': ET}, 'EDGE',
          {'number_cuts': 2, 'interpolation': 'LINEAR', 'profile_shape': 'SPHERE', 'profile_shape_factor': 0.5})
edit_case('edit tube ends twist -1 cuts 2', 'bridge_edge_loops', G, {'edges': ET}, 'EDGE',
          {'twist_offset': -1, 'number_cuts': 2})
edit_case('edit tube ends SURFACE cuts 2 uv', 'bridge_edge_loops', G, {'edges': ET}, 'EDGE',
          {'number_cuts': 2, 'interpolation': 'SURFACE'}, uv=True)
G, R, R2 = TUBES86
edit_case('edit tube ends 8 and 6 uv', 'bridge_edge_loops', G, {'edges': G.loop_edges(R[1]) + G.loop_edges(R2[0])},
          'EDGE', {}, uv=True)
edit_case('edit tube ends 8 and 6', 'bridge_edge_loops', G, {'edges': G.loop_edges(R[1]) + G.loop_edges(R2[0])},
          'EDGE', {})
edit_case('edit tube ends 8 and 6 cuts 2', 'bridge_edge_loops', G,
          {'edges': G.loop_edges(R[1]) + G.loop_edges(R2[0])}, 'EDGE', {'number_cuts': 2})

# Loops of four: CLOSED and PAIRS from edit mode.
G = Geo()
L = [G.ring('l%d' % k, 6, 1.0 - 0.1 * k, 1.2 * k, phase=0.1 * k, wobble=0.05 * k) for k in range(4)]
E4 = sum((G.loop_edges(l) for l in L), [])
edit_case('edit four rings CLOSED', 'bridge_edge_loops', G, {'edges': E4}, 'EDGE', {'type': 'CLOSED'})
edit_case('edit four rings PAIRS', 'bridge_edge_loops', G, {'edges': E4}, 'EDGE', {'type': 'PAIRS'})
edit_case('edit four rings SINGLE', 'bridge_edge_loops', G, {'edges': E4}, 'EDGE', {'type': 'SINGLE'})
edit_case('edit four rings PAIRS cuts 1', 'bridge_edge_loops', G, {'edges': E4}, 'EDGE',
          {'type': 'PAIRS', 'number_cuts': 1})

# Faces selected: a cube with the top and bottom faces selected (two holes bridged through it).
CUBE_CO = [[-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1], [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1]]
CUBE_FACES = [[0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]]
G = Geo()
G.co = CUBE_CO
G.faces = CUBE_FACES
edit_case('edit cube top and bottom faces', 'bridge_edge_loops', G, {'faces': [4, 5]}, 'FACE', {})
edit_case('edit cube top and bottom faces cuts 2', 'bridge_edge_loops', G, {'faces': [4, 5]}, 'FACE',
          {'number_cuts': 2, 'interpolation': 'LINEAR'})
edit_case('edit cube top and bottom faces uv', 'bridge_edge_loops', G, {'faces': [4, 5]}, 'FACE', {}, uv=True)
edit_case('edit cube left and right faces twist 1', 'bridge_edge_loops', G, {'faces': [0, 2]}, 'FACE',
          {'twist_offset': 1})
edit_case('edit cube all faces (refused, faces deleted)', 'bridge_edge_loops', G,
          {'faces': list(range(6))}, 'FACE', {})
edit_case('edit cube one face (refused)', 'bridge_edge_loops', G, {'faces': [4]}, 'FACE', {})
# A cylinder with n-gon caps, both caps selected.
G, R = tube(8, [0.0, 2.0], r=1.0, wobble=0.0)
G.faces.append(list(reversed(R[0])))
G.faces.append(list(R[1]))
edit_case('edit cylinder caps', 'bridge_edge_loops', G, {'faces': [8, 9]}, 'FACE', {})
edit_case('edit cylinder caps cuts 3 SURFACE', 'bridge_edge_loops', G, {'faces': [8, 9]}, 'FACE',
          {'number_cuts': 3, 'interpolation': 'SURFACE'})
# A grid with two separated face islands selected (a 2x1 patch and a 1x1 patch).
G = Geo()
rows = []
for y in range(4):
    rows.append(G.chain('row%d' % y, [[x * 1.0, y * 1.0, 0.0] for x in range(6)], wire=False))
for y in range(3):
    G.band(rows[y], rows[y + 1], closed=False)
# faces are row-major, 5 per row
edit_case('edit grid two face patches', 'bridge_edge_loops', G, {'faces': [0, 1, 13]}, 'FACE', {})

# =================================================================================================
# edit mode: subdivide_edgering
# =================================================================================================

G, R = BAND
RING01 = [[R[1][i], R[2][i]] for i in range(8)]
edit_case('edit subdiv band defaults', 'subdivide_edgering', G, {'edges': RING01}, 'EDGE', {})
edit_case('edit subdiv band vertex mode', 'subdivide_edgering', G, {'verts': R[1] + R[2]}, 'VERT',
          {'number_cuts': 2})
for interp in ('LINEAR', 'PATH', 'SURFACE'):
    edit_case('edit subdiv band %s cuts 4' % interp, 'subdivide_edgering', G, {'edges': RING01}, 'EDGE',
              {'number_cuts': 4, 'interpolation': interp, 'smoothness': 0.7,
               'profile_shape': 'ROOT', 'profile_shape_factor': 0.3})
G, rows = STRIP
edit_case('edit subdiv strip', 'subdivide_edgering', G,
          {'edges': [[rows[0][x], rows[1][x]] for x in range(5)]}, 'EDGE', {'number_cuts': 3})
edit_case('edit subdiv nothing to do (refused)', 'subdivide_edgering', G,
          {'edges': [[rows[0][0], rows[0][1]]]}, 'EDGE', {})

# =================================================================================================
# triangulate / beautify_fill (bmesh.ops), the operators bridge runs nested
# =================================================================================================

def bmof_case(name, op, geo, faces, params, select=None, vtags=(), uv=False):
    """`bmesh.ops.<op>` with input `faces` (indices) and, for beautify, every edge."""
    bm = build(geo.co, geo.faces, geo.edges, select)
    # `bmesh.new()` has had `selectmode = SCE_SELECT_VERTEX` since 3.5 (`bmesh_py_api.cc:62`); 3.4.1
    # left it 0, so `bmesh_edit_end`'s flush did nothing. Set it, to record the current behaviour.
    bm.select_mode = {'VERT'}
    if uv:
        add_uvs(bm)
    in_uvs = dump_uvs(bm)
    bm.faces.ensure_lookup_table()
    for i in vtags:
        bm.verts[i].tag = True
    fin = [bm.faces[i] for i in faces]
    if op == 'beautify_fill':
        out = bmesh.ops.beautify_fill(bm, faces=fin, edges=bm.edges[:], **params)
    else:
        out = getattr(bmesh.ops, op)(bm, faces=fin, **params)
    cases.append({
        'name': name, 'kind': 'bmof', 'op': op, 'params': params, 'mode': 'VERT',
        'input': {'positions': geo.co, 'faces': geo.faces, 'edges': geo.edges, 'select': select},
        'inputFaces': faces, 'vtags': list(vtags),
        'outCounts': {k.replace('.out', ''): len(v) for k, v in out.items() if isinstance(v, list)},
        'output': dump(bm), 'uv': uv, 'inputUvs': in_uvs, 'outputUvs': dump_uvs(bm),
    })
    bm.free()


G = Geo()
G.co = [[0, 0, 0], [2, 0, 0], [2.2, 1.1, 0.3], [0, 1, 0],          # 0-3 a nearly flat quad
        [3, 0, 0], [5, 0, 0], [4, 0.4, 0], [3.9, 2, 0],            # 4-7 a dart (concave at 6)
        [6, 0, 0], [6.3, 0, 0], [6.3, 3, 0.2], [6, 3.1, -0.4],     # 8-11 long and thin, non-planar
        [7, 0, 0], [8, 0, 1], [9, 0, 0], [8, 1, -1]]               # 12-15 strongly folded
G.faces = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]]
QUADS = G
for qm in ('BEAUTY', 'FIXED', 'ALTERNATE', 'SHORT_EDGE', 'LONG_EDGE'):
    bmof_case('triangulate quads %s' % qm, 'triangulate', G, [0, 1, 2, 3], {'quad_method': qm, 'ngon_method': 'BEAUTY'})
bmof_case('triangulate quads BEAUTY uv, selected', 'triangulate', G, [0, 1, 3], {'quad_method': 'BEAUTY'},
          select={'faces': [0, 1]}, uv=True)

# Fans: a convex hexagon and a non-planar octagon, triangulated from one corner.
G = Geo()
hexa = G.ring('h', 6, 1.0, 0.0, rx=1.8)
G.faces = [[hexa[0], hexa[i], hexa[i + 1]] for i in range(1, 5)]
# Irregular heights: a `wobble` ring is antisymmetric (z(a + pi) = -z(a)), which makes some quads of
# its vertices coplanar, so a rotation costs exactly zero and float and double round it to opposite
# signs.
OCT_Z = [0.1, -0.25, 0.3, 0.05, -0.15, 0.22, -0.3, 0.12]
oct_ = G.chain('o', [[4.0 + math.cos(2 * math.pi * i / 8), math.sin(2 * math.pi * i / 8) * 1.1, OCT_Z[i]]
                     for i in range(8)], wire=False)
G.faces += [[oct_[0], oct_[i], oct_[i + 1]] for i in range(1, 7)]
FANS = G
NF = len(G.faces)
for method in ('AREA', 'ANGLE'):
    bmof_case('beautify fans %s' % method, 'beautify_fill', G, list(range(NF)),
              {'use_restrict_tag': False, 'method': method})
bmof_case('beautify fans AREA uv', 'beautify_fill', G, list(range(NF)), {'use_restrict_tag': False, 'method': 'AREA'},
          uv=True)
bmof_case('beautify fans restricted', 'beautify_fill', G, list(range(NF)), {'use_restrict_tag': True, 'method': 'AREA'},
          vtags=hexa[:3] + oct_[:4])
bmof_case('beautify fans subset', 'beautify_fill', G, [0, 1, 4, 5, 6], {'use_restrict_tag': False, 'method': 'ANGLE'})

# =================================================================================================
# BM_edge_rotate (`bmesh.utils.edge_rotate(edge, ccw)` is `BM_edge_rotate(bm, e, ccw, 0)`)
# =================================================================================================

def rot_case(name, co, faces, edge, ccw, smooth, select_faces=()):
    bm = build(co, faces)
    bm.select_mode = {'VERT'}  # see `bmof_case`
    for i, f in enumerate(bm.faces):
        f.smooth = bool(smooth[i])
    for i in select_faces:
        bm.faces[i].select = True
    e = edge_lookup(bm, [edge])[0]
    en = bmesh.utils.edge_rotate(e, ccw)
    bm.verts.index_update()
    out = dump(bm)
    cases.append({
        'name': name, 'kind': 'rot', 'ccw': ccw,
        'input': {'positions': co, 'faces': faces, 'edges': [], 'select': None},
        'smooth': smooth, 'selectFaces': list(select_faces), 'inputEdges': [edge],
        'newEdge': [en.verts[0].index, en.verts[1].index, en.link_loops[0].vert.index] if en else None,
        'output': out,
        'faceSmooth': [f.smooth for f in bm.faces],
        'faceSelect': [f.select for f in bm.faces],
    })
    bm.free()


TRI2 = [[0, 0, 0], [2, 0, 0.3], [2.2, 1.7, 0], [0.1, 1.5, -0.2]]
rot_case('rotate two triangles', TRI2, [[0, 1, 2], [0, 2, 3]], [0, 2], False, [1, 0], [0])
rot_case('rotate two triangles ccw', TRI2, [[0, 1, 2], [0, 2, 3]], [0, 2], True, [0, 1], [1])
rot_case('rotate two triangles wound apart', TRI2, [[0, 1, 2], [0, 3, 2]], [0, 2], False, [1, 0], [0])
rot_case('rotate two triangles wound apart ccw', TRI2, [[0, 1, 2], [0, 3, 2]], [0, 2], True, [1, 0], [])
QUAD2 = [[0, 0, 0], [1, 0, 0], [2, 0, 0.2], [2, 1, 0], [1, 1, 0.1], [0, 1, 0]]
rot_case('rotate between two quads', QUAD2, [[0, 1, 4, 5], [1, 2, 3, 4]], [1, 4], False, [0, 1], [1])
rot_case('rotate between two quads ccw', QUAD2, [[0, 1, 4, 5], [1, 2, 3, 4]], [1, 4], True, [1, 0], [0])
rot_case('rotate between two quads wound apart', QUAD2, [[0, 1, 4, 5], [1, 4, 3, 2]], [1, 4], False, [0, 1], [])
# Two triangles sharing two edges (a degenerate pair): no valid rotation.
rot_case('rotate refused (faces share two edges)', [[0, 0, 0], [1, 0, 0], [0.5, 1, 0], [0.5, 0.3, 0.5]],
         [[0, 1, 2], [0, 2, 1, 3]], [0, 2], False, [0, 0])

# =================================================================================================
# vec_to_quat (`Vector.to_track_quat(track, up)` is `vec_to_quat(-v, track, up)`)
# =================================================================================================
from mathutils import Vector  # noqa: E402
TRACKS = {'X': 0, 'Y': 1, 'Z': 2, '-X': 3, '-Y': 4, '-Z': 5}
UPS = {'X': 0, 'Y': 1, 'Z': 2}
quats = []
for v in ([0.3, -0.5, 0.8], [0.0, 0.0, 1.0], [0.0, 0.0, -2.0], [1.0, 0.0, 0.0], [0.0, -1.0, 0.0], [-0.7, 0.2, -0.1]):
    for tn, t in TRACKS.items():
        for un, u in UPS.items():
            if t % 3 == u:
                continue
            q = Vector(v).to_track_quat(tn, un)
            quats.append({'vec': [-c for c in v], 'axis': t, 'upflag': u, 'quat': [round(c, 6) for c in q]})
cases.append({'name': 'vec_to_quat', 'kind': 'math', 'quats': quats})

write(__file__, 'bmesh-ops-bridge.json', cases)

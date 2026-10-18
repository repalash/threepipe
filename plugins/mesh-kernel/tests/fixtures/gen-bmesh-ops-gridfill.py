"""
Ground truth for `gridFill` (`bmesh.ops.grid_fill`) and `gridFillSelection` (edit-mode
`bpy.ops.mesh.fill_grid`), written by Blender:

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-bmesh-ops-gridfill.py

Each case builds its input from explicit data (positions, faces, wire edges, and optionally a UV
map given per face corner and a float vertex layer `w`, so the corner and vertex interpolation is
checked too), runs the operator and dumps every vertex, face (with winding), edge and the selection,
plus per face its smooth flag, material index and corner UVs, and per vertex `w`. Failures record
the operator's error message (bmesh.ops raises it) and the unchanged mesh.

Blender 3.4.1 has no split-join path (Grid Fill over selected faces) and calculates the span
differently; see `bmesh-ops-gridfill-parity.test.ts` for how those are handled.

Writes `bmesh-ops-gridfill.json` beside this file.
"""

import math
import os
import sys

import bmesh
import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bmesh_fixture_util import build, dump, write  # noqa: E402

cases = []


# region shapes

def lattice(nx, ny, zf=lambda x, y: 0.0, sx=1.0, sy=1.0):
    """An nx * ny vertex lattice, index y * nx + x, and its quads wound counter-clockwise (+Z)."""
    co = [[x * sx, y * sy, zf(x, y)] for y in range(ny) for x in range(nx)]
    faces = []
    for y in range(ny - 1):
        for x in range(nx - 1):
            a = y * nx + x
            faces.append([a, a + 1, a + nx + 1, a + nx])
    return co, faces


def ring(nx, ny, zf=lambda x, y: 0.0, sx=1.0, sy=1.0):
    """
    Only the boundary of an nx * ny lattice, as a closed chain of wire edges (bottom row left to
    right, right column up, top row right to left, left column down). Returns the positions, the
    edges, and `at(x, y)` -> vertex index.
    """
    pts = [(x, 0) for x in range(nx)] + [(nx - 1, y) for y in range(1, ny)] \
        + [(x, ny - 1) for x in range(nx - 2, -1, -1)] + [(0, y) for y in range(ny - 2, 0, -1)]
    index = {p: i for i, p in enumerate(pts)}
    co = [[x * sx, y * sy, zf(x, y)] for x, y in pts]
    edges = [[i, (i + 1) % len(pts)] for i in range(len(pts))]
    return co, edges, (lambda x, y: index[(x, y)])


def chain(idx):
    """Edges along a vertex index chain."""
    return [[idx[i], idx[i + 1]] for i in range(len(idx) - 1)]


def corner_uvs(co, faces):
    """A UV per face corner, different per face (so a seam-like jump at every edge)."""
    return [[[round(0.3 * co[v][0] + 0.07 * fi, 6), round(0.25 * co[v][1] + 0.11 * co[v][2] + 0.05 * ci, 6)]
             for ci, v in enumerate(f)] for fi, f in enumerate(faces)]


def vert_w(co):
    return [round(0.1 * i + 0.5 * c[2], 6) for i, c in enumerate(co)]


def wave(x, y):
    return round(0.3 * math.sin(0.9 * x) + 0.05 * y * y, 6)


def bump(x, y):
    return round(0.2 * math.sin(0.7 * x + 0.3) * math.cos(0.5 * y), 6)

# endregion


# region build / dump with layers

def add_layers(bm, uvs, w, smooth=None):
    if smooth:
        bm.faces.ensure_lookup_table()
        for i in smooth:
            bm.faces[i].smooth = True
    if uvs is not None:
        uv = bm.loops.layers.uv.new('UVMap')
        bm.faces.ensure_lookup_table()
        for f, fuv in zip(bm.faces, uvs):
            for l, u in zip(f.loops, fuv):
                l[uv].uv = u
    if w is not None:
        lw = bm.verts.layers.float.new('w')
        bm.verts.ensure_lookup_table()
        for v, x in zip(bm.verts, w):
            v[lw] = x


def dump_all(bm):
    out = dump(bm)
    out['smooth'] = [bool(f.smooth) for f in bm.faces]
    out['mat'] = [f.material_index for f in bm.faces]
    uv = bm.loops.layers.uv.active
    if uv is not None:
        out['uv'] = [[[round(c, 5) for c in l[uv].uv] for l in f.loops] for f in bm.faces]
    lw = bm.verts.layers.float.get('w')
    if lw is not None:
        out['w'] = [round(v[lw], 5) for v in bm.verts]
    return out

# endregion


def op_case(name, co, faces, edges, fill_edges, params, uvs=None, w=None, smooth=None):
    """`bmesh.ops.grid_fill` on the edges `fill_edges` (vertex index pairs)."""
    bm = build(co, faces, edges)
    add_layers(bm, uvs, w, smooth)
    bm.verts.ensure_lookup_table()
    sel = [bm.edges.get((bm.verts[a], bm.verts[b])) for a, b in fill_edges]
    assert all(sel), name
    error = None
    nfaces = 0
    try:
        res = bmesh.ops.grid_fill(bm, edges=sel, **params)
        nfaces = len(res['faces'])
    except RuntimeError as ex:
        error = str(ex)
    cases.append({
        'name': name,
        'kind': 'op',
        'params': params,
        'input': {'positions': co, 'faces': faces, 'edges': edges, 'uv': uvs, 'w': w, 'smooth': smooth},
        'fillEdges': fill_edges,
        'error': error,
        'facesOut': nfaces,
        'output': dump_all(bm),
    })
    bm.free()
    print(name, '->', error or ('%d faces' % nfaces))



# region the span calculation, 3.4.1 vs current (only to name the equivalent explicit case)

def selected_loops(bm):
    """`BM_mesh_edgeloops_find` (`bmesh_edgeloop.cc:112`) with the selection test, in Blender's order."""
    tagged_e = [e for e in bm.edges if e.select]
    tagged_e_set = set(tagged_e)
    tagged_v = set(v for e in tagged_e for v in e.verts)
    loops = []
    for e in tagged_e:
        if e not in tagged_e_set:
            continue
        store = []
        closed = [False]

        def loop_build(v_prev, v, d):
            v_first = v
            if v not in tagged_v:
                return True
            while v is not None:
                if d == 1:
                    store.insert(0, v)
                else:
                    store.append(v)
                tagged_v.discard(v)
                count, e_next = 0, None
                for ee in v.link_edges:
                    if ee in tagged_e_set and ee.other_vert(v) != v_prev:
                        e_next = ee
                        count += 1
                if count == 1:
                    v_next = e_next.other_vert(v)
                    tagged_e_set.discard(e_next)
                    if v_next == v_first:
                        closed[0] = True
                        v_next = None
                elif count == 0:
                    v_next = None
                else:
                    return False
                v_prev, v = v, v_next
            return True

        if loop_build(e.verts[0], e.verts[1], 1) and loop_build(e.verts[1], e.verts[0], -1) and len(store) > 1:
            loops.append((store, closed[0]))
    return loops


def angle_v3v3v3(a, b, c):
    v1 = (b - a).normalized()
    v2 = (b - c).normalized()
    if v1.dot(v2) >= 0:
        return 2 * math.asin(min(1.0, (v1 - v2).length / 2))
    return math.pi - 2 * math.asin(min(1.0, (v1 + v2).length / 2))


def span_choices(bm, offset, active):
    """
    The rails `edbm_fill_grid_prepare` picks when the span is calculated, in 3.4.1 and in the current
    source, as (span, first rail edge) relative to the start vertex (active or sharpest) - a
    transliteration of the two versions' span blocks (`editmesh_tools.c:5060` in 3.4.1,
    `editmesh_tools.cc:4874-4921` now). None when the selection is not one closed even loop.
    """
    loops = selected_loops(bm)
    if len(loops) != 1 or not loops[0][1] or len(loops[0][0]) % 2:
        return None
    verts = loops[0][0]
    n = len(verts)
    loop_edges = set(e for e in bm.edges if e.select)

    def score(v):
        pair = [e.other_vert(v) for e in v.link_edges if e in loop_edges]
        return abs(math.pi - angle_v3v3v3(pair[0].co, v.co, pair[1].co))

    if active is not None and active in verts:
        k0 = verts.index(active)
    else:
        k0, best = -1, -1.0
        for k, v in enumerate(verts):
            if score(v) > best or k0 < 0:
                k0, best = k, score(v)
    rot = verts[k0:] + verts[:k0]
    off = offset % n
    rot = rot[off:] + rot[:off]
    sc = [score(v) for v in rot]

    cur = [(0.0 if k in (0, n // 2) else sc[k], k) for k in range(n)]
    cur.sort(key=lambda t: -t[0])  # stable, as glibc's qsort
    span = n // 4
    if cur[0][0] - cur[n - 3][0] > 1e-3:
        span = cur[0][1]
    start = 0
    if span > n // 2:
        span = n - span
        start = n // 2 - span

    old = sorted([(sc[k], k) for k in range(n)], key=lambda t: -t[0])
    span41 = n // 4
    if old[2][0] - old[n - 1][0] > 1e-3:
        tags = set(t[1] for t in old[:4])
        for k in range(n // 2):
            if k in tags and k != 0:
                span41 = k
                break
    return {'current': [span, off + start], 'v341': [span41, off]}

# endregion

MODES = {'VERT': (True, False, False), 'EDGE': (False, True, False), 'FACE': (False, False, True)}


def edit_case(name, co, faces, edges, select, props, mode='VERT', uvs=None, w=None, active=None, smooth=None):
    """`bpy.ops.mesh.fill_grid` in edit mode, the selection set before entering."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    me = bpy.data.meshes.new('m')
    ob = bpy.data.objects.new('o', me)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bm = build(co, faces, edges, select)
    add_layers(bm, uvs, w, smooth)
    bm.to_mesh(me)
    bm.free()
    bpy.context.tool_settings.mesh_select_mode = MODES[mode]
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(me)
    entered = dump(bm)['selected']
    if active is not None:
        bm.verts.ensure_lookup_table()
        bm.select_history.add(bm.verts[active])
    choices = None
    if 'span' not in props:
        bm.verts.ensure_lookup_table()
        choices = span_choices(bm, props.get('offset', 0), bm.verts[active] if active is not None else None)
    result = bpy.ops.mesh.fill_grid(**props)
    bm = bmesh.from_edit_mesh(me)
    out = dump_all(bm)
    bpy.ops.object.mode_set(mode='OBJECT')
    cases.append({
        'name': name,
        'kind': 'edit',
        'mode': mode,
        'props': props,
        'input': {'positions': co, 'faces': faces, 'edges': edges, 'select': select, 'uv': uvs, 'w': w,
                  'smooth': smooth},
        'active': active,
        'entered': entered,
        'result': list(result),
        'output': out,
    })
    print(name, '->', len(out['faces']), 'faces', choices or '')
    if choices and choices['current'] != choices['v341']:
        # The versions pick different rails: also run the current source's rails explicitly.
        span, offset = choices['current']
        equivalent = '%s [current rails: span %d offset %d]' % (name, span, offset)
        cases[-1]['currentEquivalent'] = equivalent
        edit_case(equivalent, co, faces, edges, select, {**props, 'span': span, 'offset': offset}, mode, uvs, w, active,
                  smooth)


# region bmesh.ops.grid_fill

# Two rows joined by wire rails: the boundary of a lattice, the bottom and top rows as the loops.
for nx, ny, zf, label in [(4, 4, lambda x, y: 0.0, 'square planar'), (6, 4, wave, 'rect curved')]:
    co, edges, at = ring(nx, ny, zf)
    bottom = chain([at(x, 0) for x in range(nx)])
    top = chain([at(x, ny - 1) for x in range(nx)])
    op_case('rails %s' % label, co, [], edges, bottom + top, {})
    op_case('rails %s, simple' % label, co, [], edges, bottom + top, {'use_interp_simple': True})
co, edges, at = ring(6, 4, wave)
op_case('rails rect curved, mat 2 smooth', co, [], edges,
        chain([at(x, 0) for x in range(6)]) + chain([at(x, 3) for x in range(6)]),
        {'mat_nr': 2, 'use_smooth': True})
# The left and right columns as the loops instead: the loops run along y.
op_case('rails rect curved, columns as loops', co, [], edges,
        chain([at(0, y) for y in range(4)]) + chain([at(5, y) for y in range(4)]), {})

# The same ring with the top row's wire edges created right to left (edge order and direction
# decide which end each found chain starts at, so which rail pairing is tried first).
co, edges, at = ring(5, 4, wave)
rev_edges = [e for e in edges if not (at(0, 3) in e or any(at(x, 3) in e and at(x + 1, 3) in e for x in range(4)))]
top_rev = [[at(x + 1, 3), at(x, 3)] for x in range(3, -1, -1)]
rev_edges = top_rev + rev_edges + [[at(0, 2), at(0, 3)]]
op_case('rails, top row reversed', co, [], rev_edges,
        chain([at(x, 0) for x in range(5)]) + top_rev, {})

# Unequal loops: 5 verts at the bottom, 3 at the top (BM_edgeloop_expand, then the collapse).
co = [[0, 0, 0], [1, 0, 0.1], [2, 0, 0], [3, 0, -0.1], [4, 0, 0],      # 0-4 bottom
      [4, 1, 0], [4, 2, 0.2],                                          # 5-6 right
      [4, 3, 0], [2, 3, 0.3], [0, 3, 0],                               # 7-9 top
      [0, 2, 0], [0, 1, 0]]                                            # 10-11 left
edges = [[i, (i + 1) % 12] for i in range(12)]
op_case('unequal loops 5 and 3', co, [], edges, chain([0, 1, 2, 3, 4]) + chain([7, 8, 9]), {})
op_case('unequal loops 5 and 3, simple', co, [], edges, chain([0, 1, 2, 3, 4]) + chain([7, 8, 9]),
        {'use_interp_simple': True})

# Unequal rails: 4 verts on the left, 3 on the right.
co = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0],                      # 0-3 bottom
      [3, 1.5, 0.2],                                                   # 4 right
      [3, 3, 0], [2, 3, 0], [1, 3, 0], [0, 3, 0],                      # 5-8 top
      [0, 2, 0.1], [0, 1, -0.1]]                                       # 9-10 left
edges = [[i, (i + 1) % 11] for i in range(11)]
op_case('unequal rails 4 and 3', co, [], edges, chain([0, 1, 2, 3]) + chain([5, 6, 7, 8]), {})

# Very unequal: 7 verts at the bottom, 2 at the top (doubling, then the sparse fill-in).
co = [[x, 0, 0.05 * x * x] for x in range(7)] + [[6, 1, 0], [6, 2, 0], [4, 3, 0], [2, 3, 0], [0, 2, 0], [0, 1, 0]]
edges = [[i, (i + 1) % 13] for i in range(13)]
op_case('unequal loops 7 and 2', co, [], edges, chain(list(range(7))) + [[9, 10]], {})

# A hole in a grid: 6 x 6 vertices, the middle 3 x 3 faces removed. Bottom and top side of the hole
# as the loops; rails along the hole's boundary edges; corner and vertex data from the faces around.
gco, gfaces = lattice(6, 6, bump)
hole = [f for i, f in enumerate(gfaces) if not (1 <= i % 5 <= 3 and 1 <= i // 5 <= 3)]
huv = corner_uvs(gco, hole)
hw = vert_w(gco)
loop_bottom = chain([6 * 1 + x for x in range(1, 5)])
loop_top = chain([6 * 4 + x for x in range(1, 5)])
op_case('hole in grid, uv and w', gco, hole, [], loop_bottom + loop_top, {}, huv, hw)
op_case('hole in grid, uv and w, simple', gco, hole, [], loop_bottom + loop_top, {'use_interp_simple': True}, huv, hw)
op_case('hole in grid, uv and w, smooth mat 1', gco, hole, [], loop_bottom + loop_top,
        {'use_smooth': True, 'mat_nr': 1}, huv, hw)
# The faces round the hole smooth: with corner data to interpolate, each grid face first copies the
# attributes of a boundary face (`BM_elem_attrs_copy`, smooth flag included), so the grid comes out
# smooth even with use_smooth off; the material is then set from mat_nr.
op_case('hole in grid, smooth neighbours copied', gco, hole, [], loop_bottom + loop_top, {'mat_nr': 1}, huv, hw,
        smooth=list(range(len(hole))))
# Without corner data there is nothing copied: flat.
op_case('hole in grid, smooth neighbours, no uv', gco, hole, [], loop_bottom + loop_top, {}, smooth=list(range(len(hole))))

# Corner data from the loops only ('X'): a strip of faces below the bottom loop and above the top
# loop, wire rails.
co = [[x, -1, 0] for x in range(5)] + [[x, 0, 0.1 * x] for x in range(5)] \
    + [[x, 3, 0.1 * x] for x in range(5)] + [[x, 4, 0] for x in range(5)] \
    + [[0, 1, 0], [0, 2, 0], [4, 1, 0.4], [4, 2, 0.4]]                # 20-23 rail midpoints
faces = [[x, x + 1, x + 6, x + 5] for x in range(4)] + [[10 + x, 11 + x, 16 + x, 15 + x] for x in range(4)]
edges = [[5, 20], [20, 21], [21, 10], [9, 22], [22, 23], [23, 14]]
# Both strips wound +Z: the first edge of each strip makes the bottom chain run 5 -> 9 and the top
# one 14 -> 10, so the first rail search (5 to 14) walks round the top strip's boundary and the two
# rails share it: Blender refuses ("Connecting edge loops overlap").
op_case('strips on the loops, rails run round the strip', co, faces, edges,
        chain([5, 6, 7, 8, 9]) + chain([10, 11, 12, 13, 14]), {}, corner_uvs(co, faces), vert_w(co))
# The top strip wound the other way: the top chain runs 10 -> 14 and the short rails are found.
faces = [[x, x + 1, x + 6, x + 5] for x in range(4)] + [[11 + x, 10 + x, 15 + x, 16 + x] for x in range(4)]
op_case('strips on the loops (X interp)', co, faces, edges, chain([5, 6, 7, 8, 9]) + chain([10, 11, 12, 13, 14]), {},
        corner_uvs(co, faces), vert_w(co))

# Only the top strip has faces: the bottom loop's pairs are copied from the top's
# (`bm_loop_pair_test_copy`), so the corner data still comes in ('X').
faces_top = [[11 + x, 10 + x, 15 + x, 16 + x] for x in range(4)]
# (The bottom chain's wire edges run 9 -> 5 so the found chain starts at 5, next to the top chain's
# start 10; the other way round the first rail search walks round the strip, as above.)
op_case('strip above the top loop only (pair copy)', co, faces_top, edges + chain([9, 8, 7, 6, 5]),
        chain([5, 6, 7, 8, 9]) + chain([10, 11, 12, 13, 14]), {}, corner_uvs(co, faces_top), vert_w(co))

# Corner data from the rails only ('Y'): strips of faces left and right, wire loops.
co = [[-1, y, 0] for y in range(4)] + [[0, y, 0.05 * y] for y in range(4)] \
    + [[4, y, 0.05 * y] for y in range(4)] + [[5, y, 0] for y in range(4)] \
    + [[1, 0, 0], [2, 0, 0.1], [3, 0, 0], [1, 3, 0], [2, 3, -0.1], [3, 3, 0]]   # 16-21 loop midpoints
faces = [[y, y + 4, y + 5, y + 1] for y in range(3)] + [[8 + y, 12 + y, 13 + y, 9 + y] for y in range(3)]
loop_a = [4, 16, 17, 18, 8]
loop_b = [7, 19, 20, 21, 11]
edges = chain(loop_a) + chain(loop_b)
op_case('strips on the rails (Y interp)', co, faces, edges, chain(loop_a) + chain(loop_b), {},
        corner_uvs(co, faces), vert_w(co))

# Refusals.
co, edges, at = ring(5, 4)
op_case('one loop only', co, [], edges, chain([at(x, 0) for x in range(5)]), {})
op_case('three loops', co, [], edges,
        chain([at(x, 0) for x in range(2)]) + chain([at(x, 0) for x in range(3, 5)]) + chain([at(x, 3) for x in range(5)]), {})
sq = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [3, 0, 0], [4, 0, 0], [4, 1, 0], [3, 1, 0]]
sq_edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4]]
op_case('closed loops', sq, [], sq_edges, sq_edges, {})
op_case('loops not connected', [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 3, 0], [1, 3, 0], [2, 3, 0]], [],
        [[0, 1], [1, 2], [3, 4], [4, 5]], [[0, 1], [1, 2], [3, 4], [4, 5]], {})
op_case('rails overlap', [[0, 0, 0], [1, 0, 0], [0, 2, 0], [1, 2, 0], [0.5, 1, 0]], [],
        [[0, 1], [2, 3], [0, 4], [4, 2], [1, 4], [4, 3]], [[0, 1], [2, 3]], {})
op_case('single edge', [[0, 0, 0], [1, 0, 0]], [], [[0, 1]], [[0, 1]], {})

# endregion

# region bpy.ops.mesh.fill_grid

def ring_select(edges):
    return {'edges': edges}


# A closed wire loop, the rectangle 6 x 4 (16 vertices): span calculated, then given.
co, edges, at = ring(6, 4, wave)
edit_case('closed rect curved, span auto', co, [], edges, ring_select(edges), {})
edit_case('closed rect curved, span 2 offset 1', co, [], edges, ring_select(edges), {'span': 2, 'offset': 1})
edit_case('closed rect curved, span 3 offset -2 simple', co, [], edges, ring_select(edges),
          {'span': 3, 'offset': -2, 'use_interp_simple': True})
edit_case('closed rect curved, span 40 (clamped to 7)', co, [], edges, ring_select(edges), {'span': 40})
edit_case('closed rect curved, offset 21', co, [], edges, ring_select(edges), {'offset': 21})
edit_case('closed rect, active vertex', co, [], edges, ring_select(edges), {}, active=at(2, 0))
co_p, edges_p, _ = ring(6, 4)
edit_case('closed rect planar, span auto', co_p, [], edges_p, ring_select(edges_p), {})

# A non-planar circle of 12: every angle even, so the span is 12 / 4 = 3.
circ = [[round(math.cos(i * math.pi / 6), 6), round(math.sin(i * math.pi / 6), 6), round(0.2 * math.sin(i * math.pi / 3), 6)]
        for i in range(12)]
circ_edges = [[i, (i + 1) % 12] for i in range(12)]
edit_case('circle of 12, span auto', circ, [], circ_edges, ring_select(circ_edges), {})
# Flat: every corner scores the same (up to rounding), below `eps_even`, so the span stays 12 / 4.
circ_flat = [[c[0], c[1], 0] for c in circ]
edit_case('flat circle of 12, span auto', circ_flat, [], circ_edges, ring_select(circ_edges), {})
# Equiangular but not regular: sides alternate 1 and 1.6, every turn is 30 degrees. All corners
# score alike, so the even span (12 / 4) from the start is used; a corner picked from the rounding
# noise would give other rails, and a different grid, since the shape only repeats every 2 steps.
eq = [[0.0, 0.0, 0.0]]
for k in range(11):
    L = 1.0 if k % 2 == 0 else 1.6
    eq.append([round(eq[-1][0] + L * math.cos(k * math.pi / 6), 6), round(eq[-1][1] + L * math.sin(k * math.pi / 6), 6), 0.0])
edit_case('equiangular 12-gon, span auto', eq, [], circ_edges, ring_select(circ_edges), {})
edit_case('circle of 12, span 2 offset 4', circ, [], circ_edges, ring_select(circ_edges), {'span': 2, 'offset': 4})

# The hole in the grid, its whole boundary selected.
hole_loop = chain([6 + x for x in range(1, 5)]) + chain([6 * y + 4 for y in range(1, 5)]) \
    + chain([24 + x for x in range(4, 0, -1)]) + chain([6 * y + 1 for y in range(4, 0, -1)])
edit_case('hole in grid, span auto', gco, hole, [], ring_select(hole_loop), {}, uvs=huv, w=hw)
edit_case('hole in grid, offset 2', gco, hole, [], ring_select(hole_loop), {'offset': 2}, uvs=huv, w=hw)
edit_case('hole in grid, span 1 simple', gco, hole, [], ring_select(hole_loop), {'span': 1, 'use_interp_simple': True},
          uvs=huv, w=hw)
edit_case('hole in grid, active vertex', gco, hole, [], ring_select(hole_loop), {}, uvs=huv, w=hw, active=6 * 2 + 1)
# Most selected edges' faces are smooth: `edbm_add_edge_face__smooth_get` turns use_smooth on.
edit_case('hole in grid, smooth neighbours', gco, hole, [], ring_select(hole_loop), {'span': 3}, smooth=list(range(len(hole))))
edit_case('hole in grid, edge mode', gco, hole, [], ring_select(hole_loop), {}, mode='EDGE', uvs=huv, w=hw)

# Two open loops selected: the prepare pass finds two loops and hands the selection on as it is.
co, edges, at = ring(5, 4, wave)
edit_case('two open loops selected', co, [], edges,
          ring_select(chain([at(x, 0) for x in range(5)]) + chain([at(x, 3) for x in range(5)])), {})

# A loop whose sharpest corners after the excluded pair lie in the second half: 3.4.1 and the
# current source pick different rails (see the test). The second case is the current source's
# choice expressed as an explicit span and offset, which both versions run the same way.
quad = [[0, 0, 0], [2.5, -0.2, 0], [5, 0, 0], [5.6, 1.5, 0], [6, 3, 0], [3, 3.6, 0], [0.8, 4, 0], [0.4, 2, 0]]
quad_edges = [[i, (i + 1) % 8] for i in range(8)]
for i, v in enumerate(quad):
    p, n = quad[i - 1], quad[(i + 1) % 8]
    a = [p[0] - v[0], p[1] - v[1]]
    b = [n[0] - v[0], n[1] - v[1]]
    ang = math.acos((a[0] * b[0] + a[1] * b[1]) / math.hypot(*a) / math.hypot(*b))
    print('quad corner', i, 'interior', round(math.degrees(ang), 2), 'score', round(abs(math.pi - ang), 4))
edit_case('quad of 8, span auto (3.4.1 differs)', quad, [], quad_edges, ring_select(quad_edges), {})
edit_case('quad of 8, span 2 offset 2', quad, [], quad_edges, ring_select(quad_edges), {'span': 2, 'offset': 2})
edit_case('quad of 8, span 2 offset 0', quad, [], quad_edges, ring_select(quad_edges), {'span': 2, 'offset': 0})

# Refusals: nothing changes.
odd = [[round(math.cos(i * 2 * math.pi / 7), 6), round(math.sin(i * 2 * math.pi / 7), 6), 0] for i in range(7)]
odd_edges = [[i, (i + 1) % 7] for i in range(7)]
edit_case('odd closed loop of 7', odd, [], odd_edges, ring_select(odd_edges), {})
co, edges, at = ring(5, 4)
edit_case('one open loop', co, [], edges, ring_select(chain([at(x, 0) for x in range(5)])), {})
edit_case('single edge', co, [], edges, ring_select([[at(0, 0), at(1, 0)]]), {})
edit_case('nothing selected', co, [], edges, None, {})
# A closed loop inside a grid (around the middle 2 x 2 faces): its edges have two faces each, so
# no rails of wire/boundary edges exist.
mco, mfaces = lattice(5, 5)
edit_case('closed loop inside faces', mco, mfaces, [], ring_select(chain([6, 7, 8, 13, 18, 17, 16, 11, 6])), {})

# endregion

write(__file__, 'bmesh-ops-gridfill.json', cases)

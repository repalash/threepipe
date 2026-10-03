"""
Ground truth for the `triangleFill` (scan-fill) and `faceAttributeFill` ports, written by Blender itself.

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-triangle-fill-fixtures.py

Each case builds its input mesh from explicit coordinates, creating the edges first in the listed
order and then the faces (so every vertex's disk cycle - which triangle_fill's zero-normal estimate
walks - is built in an order the TypeScript test can reproduce exactly), runs
`bmesh.ops.triangle_fill(bm, use_beauty=False, ...)` on the listed edges and, for some cases,
`bmesh.ops.face_attribute_fill(...)` on the faces it made. It records every vertex position, every face
in mesh order (vertex indices, starting at the face's first loop), each face's material index and smooth
flag, the corner UVs when the case has a UV layer, and the operator's `geom.out` / `faces_fail.out`.
Nothing in the output is hand-written; rerun this script to regenerate it.

`strictOrder` marks cases whose face order and first-loop vertices are expected to match exactly.
It is off for dissolve cases (Blender's mempool reuses freed face slots, so face order is not creation
order) and for the one multi-island case where Blender 3.4.1 (the installed reference, which sorts
islands by bound before filling) and Blender main (ported, fills in connectivity order) emit the
islands in a different order.

Writes `triangle-fill.json` beside this file.
"""

import bpy
import bmesh
import json
import os


def loop_edges(idx):
    """Consecutive pairs of a closed loop of vertex indices."""
    return [[idx[i], idx[(i + 1) % len(idx)]] for i in range(len(idx))]


def face_edges(faces):
    """Edges of a face list in the order Blender's own BM_face_create_verts would make them."""
    out = []
    seen = set()
    for f in faces:
        for a, b in [[f[i - 1], f[i]] for i in range(len(f))]:
            k = (min(a, b), max(a, b))
            if k not in seen:
                seen.add(k)
                out.append([a, b])
    return out


cases = []


def build(c):
    bm = bmesh.new()
    verts = [bm.verts.new(co) for co in c['positions']]
    bm.verts.ensure_lookup_table()
    edges = [bm.edges.new((verts[a], verts[b])) for a, b in c['edges']]
    for i, f in enumerate(c['faces']):
        face = bm.faces.new([verts[i] for i in f])
        if c.get('materials'):
            face.material_index = c['materials'][i]
        if c.get('smooth'):
            face.smooth = bool(c['smooth'][i])
    if c.get('uvs'):
        uv = bm.loops.layers.uv.new('UVMap')
        for face, fuv in zip(bm.faces, c['uvs']):
            for loop, co in zip(face.loops, fuv):
                loop[uv].uv = co
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    return bm, verts, edges


def dump(bm, has_uv):
    bm.verts.index_update()
    out = {
        'positions': [[round(x, 6) for x in v.co] for v in bm.verts],
        'faces': [[v.index for v in f.verts] for f in bm.faces],
        'materials': [f.material_index for f in bm.faces],
        'smooth': [1 if f.smooth else 0 for f in bm.faces],
    }
    if has_uv:
        uv = bm.loops.layers.uv['UVMap']
        out['uvs'] = [[[round(x, 6) for x in l[uv].uv] for l in f.loops] for f in bm.faces]
    return out


def case(name, positions, fill_edges, faces=(), normal=(0, 0, 0), use_dissolve=False, attr_fill=None,
         strict_order=True, materials=None, smooth=None, uvs=None, extra_edges=()):
    """`fill_edges` are the loops to fill (indices pairs); `faces` existing faces; `extra_edges`
    other edges that exist but are not filled."""
    faces = [list(f) for f in faces]
    all_edges = []
    seen = set()
    for a, b in list(fill_edges) + face_edges(faces) + list(extra_edges):
        k = (min(a, b), max(a, b))
        if k not in seen:
            seen.add(k)
            all_edges.append([a, b])
    c = {
        'name': name,
        'positions': [list(map(float, p)) for p in positions],
        'edges': all_edges,
        'faces': faces,
        'fillEdges': [list(e) for e in fill_edges],
        'normal': list(map(float, normal)),
        'useDissolve': use_dissolve,
        'attrFill': attr_fill,
        'strictOrder': strict_order,
        'materials': materials,
        'smooth': smooth,
        'uvs': uvs,
    }
    bm, verts, edges = build(c)
    lookup = {(min(a, b), max(a, b)): e for (a, b), e in zip(c['edges'], edges)}
    sel = [lookup[(min(a, b), max(a, b))] for a, b in c['fillEdges']]
    res = bmesh.ops.triangle_fill(bm, use_beauty=False, use_dissolve=use_dissolve, edges=sel, normal=normal)
    bm.verts.index_update()
    geom_faces = [[v.index for v in g.verts] for g in res['geom'] if isinstance(g, bmesh.types.BMFace)]
    geom_edges = [[g.verts[0].index, g.verts[1].index] for g in res['geom'] if isinstance(g, bmesh.types.BMEdge)]
    fail = None
    if attr_fill is not None:
        new_faces = [g for g in res['geom'] if isinstance(g, bmesh.types.BMFace)]
        r2 = bmesh.ops.face_attribute_fill(bm, faces=new_faces, use_normals=attr_fill['use_normals'],
                                           use_data=attr_fill['use_data'])
        bm.verts.index_update()
        fail = [[v.index for v in f.verts] for f in r2['faces_fail']]
    c['output'] = dump(bm, bool(uvs))
    c['output']['geomFaces'] = geom_faces
    c['output']['geomEdges'] = geom_edges
    c['output']['facesFail'] = fail
    cases.append(c)
    bm.free()


# --- shapes (all coordinates exact in binary so float32 and double agree) ---

# Irregular convex hexagon, z = 0.
HEX = [[0, 0, 0], [2, -0.5, 0], [3.5, 0.5, 0], [3, 2, 0], [1, 2.5, 0], [-0.5, 1.25, 0]]
# L shape (concave), z = 0.
L = [[0, 0, 0], [3, 0, 0], [3, 1, 0], [1, 1, 0], [1, 3, 0], [0, 3, 0]]
# 5-point star (concave), integer-ish coordinates, z = 0.
STAR = [[0, 4, 0], [1, 1.5, 0], [4, 1.25, 0], [1.5, -0.5, 0], [2.5, -3.5, 0],
        [0, -1.5, 0], [-2.5, -3.5, 0], [-1.5, -0.5, 0], [-4, 1.25, 0], [-1, 1.5, 0]]
# Unit-ish square: all edges the same length, so the zero-normal estimate's sign depends on disk order.
SQ = [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]]


def offset(pts, d):
    return [[p[0] + d[0], p[1] + d[1], p[2] + d[2]] for p in pts]


def rng(a, n):
    return list(range(a, a + n))


case('convex hexagon, zero normal', HEX, loop_edges(rng(0, 6)))
case('convex hexagon, zero normal, dissolve', HEX, loop_edges(rng(0, 6)), use_dissolve=True, strict_order=False)
case('concave L, zero normal', L, loop_edges(rng(0, 6)))
case('concave L, zero normal, dissolve', L, loop_edges(rng(0, 6)), use_dissolve=True, strict_order=False)
case('concave L, normal +Z', L, loop_edges(rng(0, 6)), normal=(0, 0, 1))
case('concave L, normal -Z', L, loop_edges(rng(0, 6)), normal=(0, 0, -1))
case('concave L, tilted normal', L, loop_edges(rng(0, 6)), normal=(0.25, -0.5, 1))
case('star, zero normal', STAR, loop_edges(rng(0, 10)))
case('star, normal -Z, dissolve', STAR, loop_edges(rng(0, 10)), normal=(0, 0, -1), use_dissolve=True,
     strict_order=False)
case('square, zero normal (equal edge lengths)', SQ, loop_edges(rng(0, 4)))
case('square, reversed edge order, zero normal', SQ, loop_edges([3, 2, 1, 0]))

# Loop in a tilted plane z = 0.5 x (non axis-aligned projection), zero normal.
TILT = [[p[0], p[1], 0.5 * p[0]] for p in L]
case('concave L in tilted plane, zero normal', TILT, loop_edges(rng(0, 6)))

# One hole: outer 6x6 square with an inner 2x2 square, both as loops (inner wound the same way).
OUT = [[0, 0, 0], [6, 0, 0], [6, 6, 0], [0, 6, 0]]
IN1 = [[2, 2, 0], [4, 2, 0], [4, 4, 0], [2, 4, 0]]
case('one hole, zero normal', OUT + IN1, loop_edges(rng(0, 4)) + loop_edges(rng(4, 4)))
case('one hole, normal +Z', OUT + IN1, loop_edges(rng(0, 4)) + loop_edges(rng(4, 4)), normal=(0, 0, 1))
case('one hole, zero normal, dissolve', OUT + IN1, loop_edges(rng(0, 4)) + loop_edges(rng(4, 4)),
     use_dissolve=True, strict_order=False)

# Two separate holes in a wider outer loop.
OUT2 = [[0, 0, 0], [10, 0, 0], [10, 5, 0], [0, 5, 0]]
HA = [[1, 1, 0], [3, 1, 0], [3, 3.5, 0], [1, 3.5, 0]]
HB = [[6, 1.5, 0], [8.5, 1, 0], [8, 4, 0], [6.5, 3.5, 0]]
case('two separate holes, zero normal', OUT2 + HA + HB,
     loop_edges(rng(0, 4)) + loop_edges(rng(4, 4)) + loop_edges(rng(8, 4)))
case('two separate holes, normal -Z', OUT2 + HA + HB,
     loop_edges(rng(0, 4)) + loop_edges(rng(4, 4)) + loop_edges(rng(8, 4)), normal=(0, 0, -1))

# Nested: outer, a hole, and an island inside the hole.
N1 = [[0, 0, 0], [8, 0, 0], [8, 8, 0], [0, 8, 0]]
N2 = [[1.5, 1.5, 0], [6.5, 1.5, 0], [6.5, 6.5, 0], [1.5, 6.5, 0]]
N3 = [[3, 3, 0], [5, 3, 0], [5.5, 5, 0], [3, 5, 0]]
case('nested hole + island, zero normal', N1 + N2 + N3,
     loop_edges(rng(0, 4)) + loop_edges(rng(4, 4)) + loop_edges(rng(8, 4)))

# Two separate loops. 3.4.1 fills islands in ascending order of their *projected* bound minimum;
# the projection for a +Z normal is mirrored (axis_dominant_v3_to_m3_negate gives x' = -x), so the
# island with the larger 3D x comes first there, while main fills the first-listed island first.
# First listed loop on the right: both orders agree.
case('two separate loops (first is rightmost), zero normal', offset(HEX, (6, 0, 0)) + L,
     loop_edges(rng(0, 6)) + loop_edges(rng(6, 6)))
# First listed loop on the left: 3.4.1 fills the right one first, main the first-listed one.
case('two separate loops (first is leftmost), zero normal', HEX + offset(L, (6, 0, 0)),
     loop_edges(rng(0, 6)) + loop_edges(rng(6, 6)), strict_order=False)
case('two separate loops, dissolve', HEX + offset(L, (6, 0, 0)),
     loop_edges(rng(0, 6)) + loop_edges(rng(6, 6)), use_dissolve=True, strict_order=False)

# Square with an internal diagonal edge (a vertex with three marked edges), and with a loose tail
# (removed by BLI_SCANFILL_CALC_LOOSE).
case('square with diagonal, zero normal', SQ, loop_edges(rng(0, 4)) + [[0, 2]])
case('square with loose tail, zero normal', SQ + [[3, -1, 0], [4, -1.5, 0]], loop_edges(rng(0, 4)) + [[1, 4], [4, 5]])
case('single edge (nothing to fill)', [[0, 0, 0], [1, 0, 0]], [[0, 1]])

# Open box (no top): the rim is filled with zero normal, so calc_winding votes from the side faces.
BOX = [[0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0], [0, 0, 2], [2, 0, 2], [2, 3, 2], [0, 3, 2]]
BOX_OUT = [[0, 3, 2, 1], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]  # outward normals
BOX_IN = [list(reversed(f)) for f in BOX_OUT]                                   # inward normals
RIM = loop_edges([4, 5, 6, 7])
case('open box rim, outward box, zero normal (winding votes)', BOX, RIM, faces=BOX_OUT)
case('open box rim, inward box, zero normal (winding votes)', BOX, RIM, faces=BOX_IN)
case('open box rim, reversed rim order, outward box, zero normal', BOX, loop_edges([7, 6, 5, 4]), faces=BOX_OUT)
case('open box rim, outward box, zero normal, dissolve', BOX, RIM, faces=BOX_OUT, use_dissolve=True,
     strict_order=False)

# A 3x3 grid of quads with the centre face missing: fill the hole, votes come from four neighbours.
GRID = [[x, y, 0] for y in (0, 1, 2.5, 3.5) for x in (0, 1.5, 2.5, 4)]
GRID_FACES = []
for gy in range(3):
    for gx in range(3):
        if (gx, gy) == (1, 1):
            continue
        a = gy * 4 + gx
        GRID_FACES.append([a, a + 1, a + 5, a + 4])
case('grid hole, zero normal (winding votes)', GRID, loop_edges([5, 6, 10, 9]), faces=GRID_FACES)

# face_attribute_fill: fill the box rim with a given normal (so no winding vote) in both directions,
# one of which winds against the box, then let face_attribute_fill copy winding, material, smooth and
# UVs from the side faces.
MATS = [0, 1, 2, 3, 4]
SMOOTH = [0, 1, 1, 0, 1]
UVS = [[[0.0, 0.0], [0.0, 1.0], [1.0, 1.0], [1.0, 0.0]],
       [[0.0, 0.0], [0.25, 0.0], [0.25, 0.5], [0.0, 0.5]],
       [[0.25, 0.0], [0.5, 0.0], [0.5, 0.5], [0.25, 0.5]],
       [[0.5, 0.0], [0.75, 0.0], [0.75, 0.5], [0.5, 0.5]],
       [[0.75, 0.0], [1.0, 0.0], [1.0, 0.5], [0.75, 0.5]]]
for sign in (1, -1):
    case('open box rim, normal %sZ, then face_attribute_fill' % ('+' if sign > 0 else '-'), BOX, RIM,
         faces=BOX_OUT, normal=(0, 0, sign), attr_fill={'use_normals': True, 'use_data': True},
         materials=MATS, smooth=SMOOTH, uvs=UVS)
case('open box rim, normal -Z, dissolve, then face_attribute_fill normals only', BOX, RIM, faces=BOX_OUT,
     normal=(0, 0, -1), use_dissolve=True, attr_fill={'use_normals': True, 'use_data': False},
     materials=MATS, smooth=SMOOTH, strict_order=False)
case('grid hole, normal -Z, then face_attribute_fill', GRID, loop_edges([5, 6, 10, 9]), faces=GRID_FACES,
     normal=(0, 0, -1), attr_fill={'use_normals': True, 'use_data': True},
     materials=[i for i in range(8)], smooth=[i % 2 for i in range(8)])
# Unreachable faces: filling a free-standing loop leaves nothing adjacent, so every face fails.
case('hexagon, face_attribute_fill with no neighbours (all fail)', HEX, loop_edges(rng(0, 6)),
     attr_fill={'use_normals': True, 'use_data': True})

out = {
    'generator': 'gen-triangle-fill-fixtures.py',
    'blender': bpy.app.version_string,
    'cases': cases,
}
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'triangle-fill.json')
with open(path, 'w') as fh:
    json.dump(out, fh, indent=1)
print('wrote', path, len(cases), 'cases')

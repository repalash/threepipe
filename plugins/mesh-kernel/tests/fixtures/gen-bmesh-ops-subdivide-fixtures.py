"""
Ground truth for the `subdivideEdges` / `meshEsubdivide` port (`bmo_subdivide.cc`), written by Blender.

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-bmesh-ops-subdivide-fixtures.py

Two kinds of case:

- `op`: `bmesh.ops.subdivide_edges` on a mesh built from explicit coordinates, with the edges given
  as vertex-index pairs. Normals are refreshed first (`bm.normal_update()`), as edit mode keeps them.
  Records every vertex (in Blender's element order), every face, and the `geom_inner` / `geom_split`
  outputs as index lists.
- `edit`: `bpy.ops.mesh.subdivide` in edit mode with the given edges selected (edge select mode), so
  `BM_mesh_esubdivide`'s selection handling (`SUBDIV_SELECT_ORIG`) is in the result too. Records the
  mesh plus the selected vertices, edges and faces.

Subdivide never kills an element, so Blender's element order is creation order and the port is
expected to reproduce it exactly. Nothing in the output is hand-written; rerun this script to
regenerate it. Writes `bmesh-ops-subdivide.json` beside this file.
"""

import bpy
import bmesh
import json
import math
import os

CUBE_CO = [
    [-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1],
    [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1],
]
CUBE_FACES = [[0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]]

# A 3x2 grid of quads, open, uneven spacing and a lifted vertex so the normals differ.
GRID_CO = []
for y, yy in enumerate([0.0, 0.7, 2.0]):
    for x, xx in enumerate([0.0, 1.0, 1.6, 3.0]):
        GRID_CO.append([xx, yy, 0.4 if (x, y) == (1, 1) else 0.0])
GRID_FACES = []
for y in range(2):
    for x in range(3):
        a = y * 4 + x
        GRID_FACES.append([a, a + 1, a + 5, a + 4])

# A single irregular quad and a single triangle, non-planar enough for the smooth branch.
QUAD_CO = [[0, 0, 0], [2, 0, 0.2], [2.3, 1.7, 0], [-0.2, 1.5, -0.1]]
QUAD_FACES = [[0, 1, 2, 3]]
TRI_CO = [[0, 0, 0], [2, 0, 0.1], [0.7, 1.8, -0.2]]
TRI_FACES = [[0, 1, 2]]

# An irregular pentagon next to a quad: the no-pattern two-edge case.
PENT_CO = [[0, 0, 0], [2.0, 0, 0.1], [2.6, 1.2, 0.0], [1.0, 2.2, -0.2], [-0.4, 1.0, 0.05], [3.5, 0.2, 0.3], [3.8, 1.6, 0.1]]
PENT_FACES = [[0, 1, 2, 3, 4], [1, 5, 6, 2]]

# Half an octahedron-ish dome of triangles and quads: curved, so smoothing does something.
DOME_CO = [[1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0], [0, 0, 1], [0.7, 0.7, 0.5], [-0.7, -0.7, 0.5]]
DOME_FACES = [[0, 5, 4], [5, 1, 4], [1, 2, 4], [2, 6, 4], [6, 3, 4], [3, 0, 4]]


def build(co, faces):
    bm = bmesh.new()
    verts = [bm.verts.new(c) for c in co]
    bm.verts.ensure_lookup_table()
    for f in faces:
        bm.faces.new([verts[i] for i in f])
    bm.faces.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.verts.index_update()
    bm.edges.index_update()
    bm.normal_update()
    return bm


def edges_of(bm, pairs):
    out = []
    for a, b in pairs:
        e = bm.edges.get([bm.verts[a], bm.verts[b]])
        assert e is not None, (a, b)
        out.append(e)
    return out


def all_pairs(bm):
    return [[e.verts[0].index, e.verts[1].index] for e in bm.edges]


def dump(bm):
    bm.verts.index_update()
    bm.edges.index_update()
    bm.faces.index_update()
    return {
        'positions': [[round(c, 6) for c in v.co] for v in bm.verts],
        'faces': [[v.index for v in f.verts] for f in bm.faces],
        'edges': [[e.verts[0].index, e.verts[1].index] for e in bm.edges],
    }


def geom_ids(geom):
    return {
        'verts': sorted(e.index for e in geom if isinstance(e, bmesh.types.BMVert)),
        'edges': sorted(e.index for e in geom if isinstance(e, bmesh.types.BMEdge)),
        'faces': sorted(e.index for e in geom if isinstance(e, bmesh.types.BMFace)),
    }


cases = []


def op_case(name, co, faces, pairs, params):
    bm = build(co, faces)
    # `faces.new` creates each face's edges starting from (last, first) (`BM_edges_from_verts_ensure`,
    # `bmesh_construct.cc:57`); record the order and direction so the TypeScript build matches it.
    mesh_edges = all_pairs(bm)
    if pairs == 'all':
        pairs = mesh_edges
    edges = edges_of(bm, pairs)
    p = dict(params)
    percents = p.pop('edge_percents', None)
    if percents is not None:
        p['edge_percents'] = {edges[i]: f for i, f in percents}
    res = bmesh.ops.subdivide_edges(bm, edges=edges, **p)
    out = dump(bm)
    cases.append({
        'name': name,
        'kind': 'op',
        'params': params,
        'input': {'positions': co, 'faces': faces, 'edges': pairs, 'meshEdges': mesh_edges},
        'output': out,
        'inner': geom_ids(res['geom_inner']),
        'split': geom_ids(res['geom_split']),
    })
    bm.free()


def edit_case(name, co, faces, pairs, props):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(co, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(mesh)
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    bm.edges.index_update()
    # `from_pydata` orders the edges its own way, not as `faces.new` would; record that order so the
    # TypeScript build creates the edges in it before the faces.
    input_edges = all_pairs(bm)
    bm.select_mode = {'EDGE'}
    for e in bm.edges:
        e.select_set(False)
    for f in bm.faces:
        f.select_set(False)
    for e in edges_of(bm, pairs):
        e.select_set(True)
    bm.select_flush_mode()
    bmesh.update_edit_mesh(mesh)
    bpy.ops.mesh.select_mode(type='EDGE')
    bpy.ops.mesh.subdivide(**props)
    bm = bmesh.from_edit_mesh(mesh)
    out = dump(bm)
    sel = {
        'verts': [v.index for v in bm.verts if v.select],
        'edges': [e.index for e in bm.edges if e.select],
        'faces': [f.index for f in bm.faces if f.select],
    }
    bpy.ops.object.mode_set(mode='OBJECT')
    cases.append({
        'name': name,
        'kind': 'edit',
        'params': props,
        'input': {'positions': co, 'faces': faces, 'edges': pairs, 'meshEdges': input_edges},
        'output': out,
        'selected': sel,
    })
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(mesh)


GRID = dict(use_grid_fill=True)

# --- grid fill (quad_4edge, tri_3edge), straight ---
for n in (1, 2, 3):
    op_case(f'cube all edges cuts {n} grid', CUBE_CO, CUBE_FACES, 'all', dict(cuts=n, **GRID))
op_case('triangle all edges cuts 3 grid', TRI_CO, TRI_FACES, 'all', dict(cuts=3, **GRID))
op_case('dome all edges cuts 2 grid', DOME_CO, DOME_FACES, 'all', dict(cuts=2, **GRID))
# Without grid fill, all-cut faces have no pattern and are left as n-gons.
op_case('cube all edges cuts 2 no grid', CUBE_CO, CUBE_FACES, 'all', dict(cuts=2))

# --- smoothing (alter_co, dual-sphere blend) ---
op_case('cube all edges cuts 2 smooth 1', CUBE_CO, CUBE_FACES, 'all', dict(cuts=2, smooth=1.0, **GRID))
op_case('dome all edges cuts 3 smooth 0.6', DOME_CO, DOME_FACES, 'all', dict(cuts=3, smooth=0.6, **GRID))
for fo in ('SMOOTH', 'SPHERE', 'ROOT', 'SHARP', 'LINEAR', 'INVERSE_SQUARE'):
    op_case(f'dome cuts 2 smooth 1 falloff {fo}', DOME_CO, DOME_FACES, 'all',
            dict(cuts=2, smooth=1.0, smooth_falloff=fo, **GRID))
op_case('dome cuts 2 smooth 1 even', DOME_CO, DOME_FACES, 'all',
        dict(cuts=2, smooth=1.0, use_smooth_even=True, **GRID))
op_case('grid all edges cuts 1 smooth 0.5', GRID_CO, GRID_FACES, 'all', dict(cuts=1, smooth=0.5, **GRID))

# --- sphere (the icosphere's call) ---
op_case('dome all edges cuts 2 sphere', DOME_CO, DOME_FACES, 'all',
        dict(cuts=2, smooth=1.5, use_sphere=True, **GRID))

# --- single edge (quad_1edge, tri_1edge) ---
for n in (1, 2, 3, 4):
    op_case(f'quad one edge cuts {n} single', QUAD_CO, QUAD_FACES, [[1, 2]], dict(cuts=n, use_single_edge=True))
    op_case(f'tri one edge cuts {n} single', TRI_CO, TRI_FACES, [[2, 0]], dict(cuts=n, use_single_edge=True))
op_case('quad one edge cuts 2 no single', QUAD_CO, QUAD_FACES, [[1, 2]], dict(cuts=2))

# --- two adjacent edges of a quad (quad_2edge_*) ---
for corner in ('INNER_VERT', 'PATH', 'FAN', 'STRAIGHT_CUT'):
    for n in (1, 2, 3):
        op_case(f'quad corner {corner} cuts {n}', QUAD_CO, QUAD_FACES, [[0, 1], [1, 2]],
                dict(cuts=n, quad_corner_type=corner))

# --- three edges of a quad (quad_3edge) ---
for n in (1, 2, 3, 4):
    op_case(f'quad three edges cuts {n}', QUAD_CO, QUAD_FACES, [[0, 1], [1, 2], [2, 3]], dict(cuts=n))

# --- two opposite edges (no pattern: the loop cut case) ---
for n in (1, 2, 3):
    op_case(f'grid ring cuts {n}', GRID_CO, GRID_FACES, [[0, 4], [1, 5], [2, 6], [3, 7]], dict(cuts=n))
op_case('pentagon two edges cuts 2', PENT_CO, PENT_FACES, [[0, 1], [2, 3]], dict(cuts=2))
op_case('pentagon and quad shared edge cuts 1', PENT_CO, PENT_FACES, [[1, 2], [5, 6], [3, 4]], dict(cuts=1))

# --- edge percents and only-quads ---
op_case('grid ring edge percents', GRID_CO, GRID_FACES, [[0, 4], [1, 5], [2, 6], [3, 7]],
        dict(cuts=1, edge_percents=[[0, 0.25], [1, 0.25], [2, 0.8], [3, 0.5]]))
op_case('dome all edges only quads', DOME_CO, DOME_FACES, 'all', dict(cuts=1, use_only_quads=True, **GRID))
op_case('grid all edges cuts 2 only quads', GRID_CO, GRID_FACES, 'all', dict(cuts=2, use_only_quads=True, **GRID))

# --- the edit-mode operator: BM_mesh_esubdivide with SUBDIV_SELECT_ORIG ---
edit_case('edit cube one face edges cuts 1', CUBE_CO, CUBE_FACES, [[0, 1], [1, 3], [3, 2], [2, 0]],
          dict(number_cuts=1))
edit_case('edit cube all cuts 2 smooth', CUBE_CO, CUBE_FACES,
          [[0, 1], [1, 3], [3, 2], [2, 0], [2, 6], [3, 7], [6, 7], [6, 4], [7, 5], [4, 5], [5, 1], [4, 0]],
          dict(number_cuts=2, smoothness=0.5))
edit_case('edit grid ring cuts 2', GRID_CO, GRID_FACES, [[0, 4], [1, 5], [2, 6], [3, 7]], dict(number_cuts=2))
edit_case('edit quad corner no ngon', QUAD_CO, QUAD_FACES, [[0, 1], [1, 2]], dict(number_cuts=2, ngon=False))
edit_case('edit quad corner fan', QUAD_CO, QUAD_FACES, [[0, 1], [1, 2]], dict(number_cuts=1, quadcorner='FAN'))

out = {
    'generator': 'gen-bmesh-ops-subdivide-fixtures.py',
    'blender': bpy.app.version_string,
    'cases': cases,
}
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bmesh-ops-subdivide.json')
with open(path, 'w') as fh:
    # One case per line: small enough to commit, and a regeneration diffs case by case.
    fh.write('{"generator": %s, "blender": %s, "cases": [\n' % (json.dumps(out['generator']), json.dumps(out['blender'])))
    fh.write(',\n'.join(json.dumps(c, separators=(',', ':')) for c in cases))
    fh.write('\n]}\n')
print('wrote', path, len(cases), 'cases')

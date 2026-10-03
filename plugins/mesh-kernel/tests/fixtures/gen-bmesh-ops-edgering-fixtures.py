"""
Ground truth for the `subdivideEdgeRing` port (`bmo_subdivide_edgering.cc`), written by Blender.

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-bmesh-ops-edgering-fixtures.py

Two kinds of case, as in `gen-bmesh-ops-subdivide-fixtures.py`:

- `op`: `bmesh.ops.subdivide_edgering` on a mesh built from explicit coordinates (`faces.new`, normals
  refreshed), the ring given as vertex-index pairs. Records every vertex, edge and face in Blender's
  element order and the `faces` output, or the operator's error.
- `edit`: `bpy.ops.mesh.subdivide_edgering` in edit mode with the ring selected (edge select mode).
  Records the mesh and the selection afterwards.

The edge-ring subdivide only creates elements, so Blender's element order is creation order and the
port is expected to reproduce it. Nothing in the output is hand-written; rerun this script to
regenerate `bmesh-ops-edgering.json` beside it.
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
# The four vertical edges: the rims are the top and bottom face boundaries (closed).
CUBE_RING = [[0, 1], [2, 3], [4, 5], [6, 7]]

# An open 8-sided tube that bulges: rings at z 0, 1, 2, 3 with radii 1, 1.4, 1.4, 1 and a slight
# twist, so the surface blend and the path's frames both have something to follow.
SIDES = 8
BARREL_Z = [0.0, 1.0, 2.0, 3.0]
BARREL_R = [1.0, 1.4, 1.4, 1.0]
BARREL_CO = []
for k, (z, r) in enumerate(zip(BARREL_Z, BARREL_R)):
    for i in range(SIDES):
        a = 2 * math.pi * i / SIDES + 0.1 * k
        BARREL_CO.append([round(r * math.cos(a), 6), round(r * math.sin(a), 6), z])
BARREL_FACES = []
for k in range(len(BARREL_Z) - 1):
    for i in range(SIDES):
        a, b = k * SIDES + i, k * SIDES + (i + 1) % SIDES
        BARREL_FACES.append([a, b, b + SIDES, a + SIDES])


def band(k):
    """The ring edges between ring k and ring k + 1."""
    return [[k * SIDES + i, (k + 1) * SIDES + i] for i in range(SIDES)]


# An open 3x2 grid of quads with uneven spacing and a lifted vertex (as the subdivide fixtures').
GRID_CO = []
for y, yy in enumerate([0.0, 0.7, 2.0]):
    for x, xx in enumerate([0.0, 1.0, 1.6, 3.0]):
        GRID_CO.append([xx, yy, 0.4 if (x, y) == (1, 1) else 0.0])
GRID_FACES = []
for y in range(2):
    for x in range(3):
        a = y * 4 + x
        GRID_FACES.append([a, a + 1, a + 5, a + 4])
GRID_RING = [[0, 4], [1, 5], [2, 6], [3, 7]]

# The grid with the middle face of the cut row wound the other way: `bm_face_slice` must keep slicing
# the larger remainder (`l_new->radial_next` when the new loop landed in the smaller part).
GRID_FACES_FLIPPED = [list(reversed(f)) if i == 1 else f for i, f in enumerate(GRID_FACES)]


def renumber(co, faces, pairs, perm):
    """The same mesh with vertex `i` renumbered to `perm[i]`."""
    out = [None] * len(co)
    for i, c in enumerate(co):
        out[perm[i]] = c
    return out, [[perm[i] for i in f] for f in faces], [[perm[a], perm[b]] for a, b in pairs]


# The grid with its second row numbered right to left, and the barrel with its second ring numbered
# the other way round: the two rims of the ring then run opposite ways, which `bm_edgering_pair_order`
# corrects (`BM_edgeloop_flip` for open rims, `bm_edgering_pair_order_is_flipped` for closed ones).
GRID_REV = renumber(GRID_CO, GRID_FACES, GRID_RING, [i if i // 4 != 1 else 4 + (3 - i % 4) for i in range(12)])
BARREL_REV = renumber(BARREL_CO, BARREL_FACES, [[SIDES + i, 2 * SIDES + i] for i in range(SIDES)],
                      [i if i // SIDES != 2 else 2 * SIDES + (SIDES - i % SIDES) % SIDES for i in range(len(BARREL_CO))])


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


cases = []


def op_case(name, co, faces, pairs, params):
    bm = build(co, faces)
    # `faces.new` creates each face's edges starting from (last, first); record the order and
    # direction so the TypeScript build matches it (issues/open/mesh-kernel-face-create-edge-order.md).
    mesh_edges = all_pairs(bm)
    edges = edges_of(bm, pairs)
    case = {
        'name': name,
        'kind': 'op',
        'params': params,
        'input': {'positions': co, 'faces': faces, 'edges': pairs, 'meshEdges': mesh_edges},
    }
    try:
        res = bmesh.ops.subdivide_edgering(bm, edges=edges, **params)
        bm.faces.index_update()
        case['facesOut'] = sorted(f.index for f in res['faces'])
        case['output'] = dump(bm)
    except RuntimeError as err:
        case['error'] = str(err)
        case['output'] = dump(bm)
    cases.append(case)
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
    # `from_pydata` orders the edges its own way; record it so the TypeScript build matches.
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
    result = bpy.ops.mesh.subdivide_edgering(**props)
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
        'result': list(result),
        'input': {'positions': co, 'faces': faces, 'edges': pairs, 'meshEdges': input_edges},
        'output': out,
        'selected': sel,
    })
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(mesh)


MODES = [
    dict(interp_mode='LINEAR', cuts=1),
    dict(interp_mode='LINEAR', cuts=3),
    dict(interp_mode='PATH', cuts=2, smooth=1.0),
    dict(interp_mode='PATH', cuts=3, smooth=0.5),
    dict(interp_mode='SURFACE', cuts=2, smooth=1.0),
    dict(interp_mode='SURFACE', cuts=3, smooth=2.0),
    dict(interp_mode='PATH', cuts=3, smooth=1.0, profile_shape='SPHERE', profile_shape_factor=0.5),
    dict(interp_mode='LINEAR', cuts=3, profile_shape='SMOOTH', profile_shape_factor=-0.4),
    dict(interp_mode='SURFACE', cuts=2, smooth=1.0, profile_shape='ROOT', profile_shape_factor=0.3),
]


def label(p):
    return ' '.join(f'{k}={v}' for k, v in p.items())


for p in MODES:
    op_case('cube ring ' + label(p), CUBE_CO, CUBE_FACES, CUBE_RING, p)
    op_case('barrel band ' + label(p), BARREL_CO, BARREL_FACES, band(1), p)
    op_case('grid ring ' + label(p), GRID_CO, GRID_FACES, GRID_RING, p)
# Three rims: two ring pairs (`bm_edgering_pair_calc`).
for p in (dict(interp_mode='PATH', cuts=2, smooth=1.0), dict(interp_mode='SURFACE', cuts=1, smooth=1.0),
          dict(interp_mode='LINEAR', cuts=2)):
    op_case('barrel two bands ' + label(p), BARREL_CO, BARREL_FACES, band(0) + band(1), p)
# Variants of the barrel whose rims' loops come out running opposite ways (the loop direction
# follows the first rim edge's `v1 -> v2`, which follows face creation order and winding).
BARREL_BANDS_REVERSED = [f for k in (2, 1, 0) for f in BARREL_FACES[k * SIDES:(k + 1) * SIDES]]
BARREL_BAND0_REWOUND = [list(reversed(f)) if i < SIDES else f for i, f in enumerate(BARREL_FACES)]
BARREL_BAND1_REWOUND = [list(reversed(f)) if SIDES <= i < 2 * SIDES else f for i, f in enumerate(BARREL_FACES)]
for nm, fs in (('bands reversed', BARREL_BANDS_REVERSED), ('band 0 rewound', BARREL_BAND0_REWOUND),
               ('band 1 rewound', BARREL_BAND1_REWOUND)):
    op_case(f'barrel {nm} PATH cuts 2', BARREL_CO, fs, band(1), dict(interp_mode='PATH', cuts=2, smooth=1.0))
# Mixed winding, and rims that run opposite ways.
for p in (dict(interp_mode='LINEAR', cuts=3), dict(interp_mode='PATH', cuts=2, smooth=1.0)):
    op_case('grid flipped face ' + label(p), GRID_CO, GRID_FACES_FLIPPED, GRID_RING, p)
    op_case('grid reversed row ' + label(p), *GRID_REV, p)
    op_case('barrel reversed ring ' + label(p), *BARREL_REV, p)
# Not a ring.
op_case('cube one edge', CUBE_CO, CUBE_FACES, [[0, 1]], dict(interp_mode='LINEAR', cuts=1))

# The edit-mode operator, with its defaults (10 cuts, blend path, smoothness 1) and with others.
edit_case('edit cube ring defaults', CUBE_CO, CUBE_FACES, CUBE_RING, {})
edit_case('edit barrel band surface', BARREL_CO, BARREL_FACES, band(1),
          dict(number_cuts=3, interpolation='SURFACE', smoothness=1.0))
edit_case('edit grid ring linear', GRID_CO, GRID_FACES, GRID_RING, dict(number_cuts=2, interpolation='LINEAR'))

out = {
    'generator': 'gen-bmesh-ops-edgering-fixtures.py',
    'blender': bpy.app.version_string,
    'cases': cases,
}
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bmesh-ops-edgering.json')
with open(path, 'w') as fh:
    # One case per line: small enough to commit, and a regeneration diffs case by case.
    fh.write('{"generator": %s, "blender": %s, "cases": [\n' % (json.dumps(out['generator']), json.dumps(out['blender'])))
    fh.write(',\n'.join(json.dumps(c, separators=(',', ':')) for c in cases))
    fh.write('\n]}\n')
print('wrote', path, len(cases), 'cases')

"""
Ground truth for `subdivisionSurface` (`src/subdiv/`), written by Blender's Subdivision Surface modifier:

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-subsurf-fixtures.py

Each case builds a mesh object from explicit data (`Mesh.from_pydata`), optionally with `crease_edge` /
`crease_vert` and a UV map, adds a Subdivision Surface modifier with the case's settings, evaluates it and records
the evaluated mesh: positions, edges, faces (vertex indices, winding order), loose edges, and the UV map per corner.
Floats are written exactly (float32 values as JSON doubles). The input's edges are recorded in Blender's order
(`mesh_calc_edges` hash order after `from_pydata`) because `subdiv_foreach` numbers the output by coarse edge, so the
TypeScript side can rebuild the same input and compare the output index for index.

Writes `subsurf.json` beside this file.
"""

import json
import math
import os

import bpy


def cube():
    co = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
    faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    return co, faces


def grid(n=3):
    co = [[-1 + 2 * x / n, -1 + 2 * y / n, 0.15 * math.sin(x + 2 * y)] for y in range(n + 1) for x in range(n + 1)]
    faces = [[y * (n + 1) + x, y * (n + 1) + x + 1, (y + 1) * (n + 1) + x + 1, (y + 1) * (n + 1) + x] for y in range(n) for x in range(n)]
    return co, faces


def panel():
    # a pentagon fanned by quads and a triangle: n-gon, quads and a triangle in one closed-ish open mesh
    co = [[0, 0, 0], [1, 0, 0], [1.5, 1, 0.2], [0.5, 1.6, 0], [-0.5, 1, -0.1], [2, 0, 0.3], [2.4, 1.1, 0], [1.2, 2.4, 0.1]]
    return co, [[0, 1, 2, 3, 4], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4]]


def tetra():
    co = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]
    return co, [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]


def fins():
    co = [[0, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, 1], [-0.5, 0.866, 0], [-0.5, 0.866, 1], [-0.5, -0.866, 0], [-0.5, -0.866, 1]]
    return co, [[0, 2, 3, 1], [1, 5, 4, 0], [0, 6, 7, 1]]


def cylinder(n=8):
    # an n-gon capped prism: n-gons, valence-3 rims
    co = [[math.cos(2 * math.pi * i / n), math.sin(2 * math.pi * i / n), z] for z in (-1, 1) for i in range(n)]
    faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    faces += [list(reversed(range(n))), [n + i for i in range(n)]]
    return co, faces


def run(name, data, mod, edge_crease=None, vert_crease=None, loose_edges=(), uv=False):
    co, faces = data
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    me = bpy.data.meshes.new(name)
    me.from_pydata(co, list(loose_edges), faces)
    me.update()
    if edge_crease:
        attr = me.attributes.new('crease_edge', 'FLOAT', 'EDGE')
        want = {tuple(sorted(p)): v for p, v in edge_crease}
        for e in me.edges:
            attr.data[e.index].value = want.get(tuple(sorted(e.vertices)), 0.0)
    if vert_crease:
        attr = me.attributes.new('crease_vert', 'FLOAT', 'POINT')
        for i, v in vert_crease:
            attr.data[i].value = v
    if uv:
        layer = me.uv_layers.new(name='UVMap')
        # a per-face layout with seams: each face gets its own unit square, so every edge is a UV boundary,
        # except faces 0 and 1 of a strip that share their edge continuously
        for f in me.polygons:
            n = len(f.loop_indices)
            for k, li in enumerate(f.loop_indices):
                a = 2 * math.pi * k / n
                layer.data[li].uv = (f.index * 1.5 + 0.5 + 0.5 * math.cos(a), 0.5 + 0.5 * math.sin(a))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    m = ob.modifiers.new('Subsurf', 'SUBSURF')
    m.levels = mod.get('levels', 1)
    m.render_levels = m.levels
    m.quality = mod.get('quality', 3)
    m.use_limit_surface = mod.get('limit', True)
    m.use_creases = mod.get('creases', True)
    m.boundary_smooth = mod.get('boundary', 'ALL')
    m.uv_smooth = mod.get('uv_smooth', 'PRESERVE_BOUNDARIES')
    m.subdivision_type = mod.get('type', 'CATMULL_CLARK')
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    out = ev.to_mesh()
    res = {
        'name': name,
        'input': {'positions': co, 'faces': faces, 'looseEdges': [list(e) for e in loose_edges],
                  'edges': [list(e.vertices) for e in me.edges],
                  'edgeCrease': [[list(p), v] for p, v in (edge_crease or [])], 'vertCrease': [list(x) for x in (vert_crease or [])], 'uv': uv},
        'modifier': {'levels': m.levels, 'quality': m.quality, 'useLimitSurface': m.use_limit_surface, 'useCreases': m.use_creases,
                     'boundarySmooth': m.boundary_smooth, 'uvSmooth': m.uv_smooth, 'type': m.subdivision_type},
        'positions': [list(v.co) for v in out.vertices],
        'edges': [list(e.vertices) for e in out.edges],
        'faces': [list(p.vertices) for p in out.polygons],
        'looseEdges': [list(e.vertices) for e in out.edges if e.is_loose],
    }
    if uv and out.uv_layers:
        res['uv'] = [list(d.uv) for d in out.uv_layers[0].data]
    ev.to_mesh_clear()
    return res


C = cube()
cases = [
    run('cube-l1-nolimit', C, {'levels': 1, 'limit': False}),
    run('cube-l2-nolimit', C, {'levels': 2, 'limit': False}),
    run('cube-l1-limit', C, {'levels': 1}),
    run('cube-l2-limit', C, {'levels': 2}),
    run('cube-l3-limit-q2', C, {'levels': 3, 'quality': 2}),
    run('cube-crease-full-l2', C, {'levels': 2}, edge_crease=[((0, 1), 1.0), ((1, 2), 1.0), ((2, 3), 1.0), ((3, 0), 1.0)]),
    run('cube-crease-semi-l2-nolimit', C, {'levels': 2, 'limit': False}, edge_crease=[((0, 1), 0.5), ((1, 2), 0.5), ((4, 5), 0.3)]),
    run('cube-crease-semi-l2-limit', C, {'levels': 2}, edge_crease=[((0, 1), 0.5), ((1, 2), 0.5), ((4, 5), 0.3)]),
    run('cube-crease-high-l1-limit', C, {'levels': 1}, edge_crease=[((0, 1), 0.9)]),
    run('cube-crease-off', C, {'levels': 1, 'creases': False}, edge_crease=[((0, 1), 1.0)]),
    run('cube-vert-crease-l2', C, {'levels': 2}, vert_crease=[(6, 0.7)]),
    run('grid-all-l2-nolimit', grid(), {'levels': 2, 'limit': False}),
    run('grid-all-l2-limit', grid(), {'levels': 2}),
    run('grid-corners-l2-nolimit', grid(), {'levels': 2, 'limit': False, 'boundary': 'PRESERVE_CORNERS'}),
    run('grid-corners-l2-limit', grid(), {'levels': 2, 'boundary': 'PRESERVE_CORNERS'}),
    run('panel-l2-nolimit', panel(), {'levels': 2, 'limit': False}),
    run('panel-l2-limit', panel(), {'levels': 2}),
    run('tetra-l2-limit', tetra(), {'levels': 2}),
    run('fins-l1-nolimit', fins(), {'levels': 1, 'limit': False}),
    run('fins-l2-limit', fins(), {'levels': 2}),
    run('loose-edge-l1', ([*C[0], [2, 2, 2]], C[1]), {'levels': 1}, loose_edges=[(6, 8)]),
    run('simple-l2', C, {'levels': 2, 'type': 'SIMPLE'}),
    # harder mixes, added after the adaptive-patch port (S6b)
    run('cylinder-ngon-caps-creased-uv-l2', cylinder(), {'levels': 2}, edge_crease=[((i, (i + 1) % 8), 1.0) for i in range(8)], uv=True),
    run('cylinder-ngon-caps-semi-l2-q2', cylinder(), {'levels': 2, 'quality': 2}, edge_crease=[((8 + i, 8 + (i + 1) % 8), 0.6) for i in range(8)]),
    run('panel-semi-uv-l2', panel(), {'levels': 2, 'uv_smooth': 'SMOOTH_ALL'}, edge_crease=[((1, 2), 0.7), ((2, 3), 0.4)], uv=True),
    run('panel-l3-q1', panel(), {'levels': 3, 'quality': 1}),
    run('cube-uv-islands-l2', C, {'levels': 2, 'uv_smooth': 'PRESERVE_CORNERS'}, vert_crease=[(0, 0.5)], uv=True),
    run('fins-crease-l2', fins(), {'levels': 2, 'boundary': 'PRESERVE_CORNERS'}, edge_crease=[((0, 1), 0.5)]),
] + [
    run(f'uv-{mode.lower()}', ([[-1, -1, 0], [0, -1, 0.2], [1, -1, 0], [-1, 0, 0.1], [0, 0, 0.4], [1, 0, 0], [-1, 1, 0], [0, 1, 0.1], [1, 1, 0]],
                                [[0, 1, 4, 3], [1, 2, 5, 4], [3, 4, 7, 6], [4, 5, 8, 7]]),
        {'levels': 1, 'uv_smooth': mode}, uv=True)
    for mode in ['NONE', 'PRESERVE_CORNERS', 'PRESERVE_CORNERS_AND_JUNCTIONS', 'PRESERVE_CORNERS_JUNCTIONS_AND_CONCAVE', 'PRESERVE_BOUNDARIES', 'SMOOTH_ALL']
]

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'subsurf.json')
def write(path, blender, cases):
    # one case per line, compact
    head = json.dumps({'blender': blender, 'generator': 'gen-subsurf-fixtures.py'})[:-1]
    with open(path, 'w') as fp:
        fp.write(head + ', "cases": [\n' + ',\n'.join(json.dumps(c, separators=(',', ':')) for c in cases) + '\n]}\n')


write(out, bpy.app.version_string, cases)
print('wrote', out, len(cases), 'cases')

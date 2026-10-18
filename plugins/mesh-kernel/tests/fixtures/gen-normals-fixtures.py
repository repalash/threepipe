"""
Ground truth for `src/normals.ts` (corner normals, custom normals), written by Blender:

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-normals-fixtures.py

Each case builds a mesh from explicit data, optionally tags sharp edges / faces, optionally sets custom normals
(`normals_split_custom_set`, `normals_split_custom_set_from_vertices`, or a free `custom_normal` float vector
attribute on a domain), and records `corner_normals`, `vertex_normals`, `polygon_normals`, the normals domain, the
stored `custom_normal` data and the sharp edges afterwards.

Writes `normals.json` beside this file.
"""

import json
import math
import os

import bpy


def cube():
    co = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
    faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    return co, faces


def noisy_grid(n=4):
    co = [[x, y, 0.3 * math.sin(1.7 * x + 0.3) * math.cos(1.3 * y - 0.2)] for y in range(n + 1) for x in range(n + 1)]
    faces = [[y * (n + 1) + x, y * (n + 1) + x + 1, (y + 1) * (n + 1) + x + 1, (y + 1) * (n + 1) + x] for y in range(n) for x in range(n)]
    return co, faces


def panel():
    co = [[0, 0, 0], [1, 0, 0], [1.5, 1, 0.2], [0.5, 1.6, 0], [-0.5, 1, -0.1], [2, 0, 0.3], [2.4, 1.1, 0], [1.2, 2.4, 0.1]]
    return co, [[0, 1, 2, 3, 4], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4]]


def flipped():
    return [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 0, 0], [2, 1, 0.3]], [[0, 1, 2, 3], [1, 2, 5, 4]]


def fins():
    co = [[0, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, 1], [-0.5, 0.866, 0], [-0.5, 0.866, 1], [-0.5, -0.866, 0], [-0.5, -0.866, 1]]
    return co, [[0, 2, 3, 1], [1, 5, 4, 0], [0, 6, 7, 1]]


def uv_sphere(seg=8, rings=5):
    co = [[0, 0, -1]]
    for j in range(1, rings):
        t = math.pi * j / rings - math.pi / 2
        for i in range(seg):
            a = 2 * math.pi * i / seg
            co.append([math.cos(t) * math.cos(a), math.cos(t) * math.sin(a), math.sin(t)])
    co.append([0, 0, 1])
    top = len(co) - 1
    ring = lambda j, i: 1 + (j - 1) * seg + i % seg
    faces = [[0, ring(1, i + 1), ring(1, i)] for i in range(seg)]
    for j in range(1, rings - 1):
        faces += [[ring(j, i), ring(j, i + 1), ring(j + 1, i + 1), ring(j + 1, i)] for i in range(seg)]
    faces += [[top, ring(rings - 1, i), ring(rings - 1, i + 1)] for i in range(seg)]
    return co, faces


def wobble(k, i):
    # a deterministic direction, not too far from +-z
    return [0.4 * math.sin(1.3 * i + k), 0.4 * math.cos(0.7 * i - k), 1.0 if (i + k) % 3 else -1.0]


def run(name, data, sharp_edges=(), sharp_faces=None, custom=None, custom_verts=None, free=None, extra_loose_vert=False):
    co, faces = data
    co = list(co)
    if extra_loose_vert:
        co.append([5, 5, 5])
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    me = bpy.data.meshes.new(name)
    me.from_pydata(co, [], faces)
    me.update()
    # from_pydata makes flat faces (sharp_face on every face); these cases start smooth
    me.shade_smooth()
    if sharp_edges:
        attr = me.attributes.new('sharp_edge', 'BOOLEAN', 'EDGE')
        want = {tuple(sorted(p)) for p in sharp_edges}
        for e in me.edges:
            attr.data[e.index].value = tuple(sorted(e.vertices)) in want
    if sharp_faces is not None:
        attr = me.attributes.new('sharp_face', 'BOOLEAN', 'FACE')
        for i, v in enumerate(sharp_faces):
            attr.data[i].value = bool(v)
    custom_in = None
    if custom is not None:
        custom_in = [custom(i) for i in range(len(me.loops))]
        me.normals_split_custom_set(custom_in)
    if custom_verts is not None:
        custom_in = [custom_verts(i) for i in range(len(me.vertices))]
        me.normals_split_custom_set_from_vertices(custom_in)
    if free is not None:
        domain, fn = free
        n = {'POINT': len(me.vertices), 'FACE': len(me.polygons), 'CORNER': len(me.loops)}[domain]
        attr = me.attributes.new('custom_normal', 'FLOAT_VECTOR', domain)
        custom_in = [fn(i) for i in range(n)]
        for i, v in enumerate(custom_in):
            attr.data[i].vector = v
    me.update()
    stored = None
    if 'custom_normal' in me.attributes:
        a = me.attributes['custom_normal']
        if a.data_type == 'INT16_2D':
            stored = {'type': 'int16x2', 'domain': a.domain, 'data': [list(d.value) for d in a.data]}
        else:
            stored = {'type': 'float3', 'domain': a.domain, 'data': [list(d.vector) for d in a.data]}
    se = me.attributes.get('sharp_edge')
    return {
        'name': name,
        'input': {'positions': co, 'faces': faces, 'sharpEdges': [list(p) for p in sharp_edges], 'sharpFaces': sharp_faces,
                  'custom': custom_in, 'customFromVerts': custom_verts is not None, 'free': free[0] if free else None},
        'normalsDomain': me.normals_domain,
        'cornerNormals': [list(n.vector) for n in me.corner_normals],
        'vertexNormals': [list(v.normal) for v in me.vertices],
        'faceNormals': [list(p.normal) for p in me.polygons],
        'customNormal': stored,
        'sharpEdges': sorted([sorted(e.vertices) for e in me.edges if se and se.data[e.index].value]) if se else [],
    }


cases = [
    run('cube-smooth', cube()),
    run('cube-some-sharp', cube(), sharp_edges=[(0, 1), (1, 2), (5, 6)]),
    run('cube-flat', cube(), sharp_faces=[1] * 6),
    run('cube-one-flat-face', cube(), sharp_faces=[1, 0, 0, 0, 0, 0]),
    run('grid-sharp-diagonal', noisy_grid(), sharp_edges=[(6, 7), (7, 12), (12, 13), (13, 18)]),
    run('panel-ngon', panel()),
    run('flipped-winding', flipped()),
    run('fins', fins()),
    run('loose-vertex', cube(), extra_loose_vert=True),
    run('cube-custom-corners', cube(), custom=lambda i: wobble(1, i)),
    run('grid-custom-corners-sharp', noisy_grid(), sharp_edges=[(6, 7), (7, 12)], custom=lambda i: wobble(2, i)),
    run('sphere-custom-from-verts', uv_sphere(), custom_verts=lambda i: [0, 0, 0] if i % 4 == 0 else wobble(3, i)),
    run('panel-custom-zero-and-set', panel(), custom=lambda i: [0, 0, 0] if i % 3 == 0 else wobble(4, i)),
    run('cube-free-point', cube(), free=('POINT', lambda i: wobble(5, i))),
    run('cube-free-face', cube(), free=('FACE', lambda i: wobble(6, i))),
    run('cube-free-corner', cube(), free=('CORNER', lambda i: wobble(7, i))),
    run('sphere-smooth', uv_sphere()),
]

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'normals.json')
with open(out, 'w') as fp:
    json.dump({'blender': bpy.app.version_string, 'generator': 'gen-normals-fixtures.py', 'cases': cases}, fp, indent=1)
print('wrote', out, len(cases), 'cases')

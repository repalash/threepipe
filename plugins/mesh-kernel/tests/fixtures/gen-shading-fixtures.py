"""
Ground truth for `shadeFlat` / `shadeSmooth` / `shadeSmoothByAngle` (`src/shading.ts`), written by Blender:

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-shading-fixtures.py

Each case builds a mesh object from explicit data (`Mesh.from_pydata`, so vertex and face order are the
input's), optionally tags `sharp_edge` / `sharp_face` on it, runs one of `bpy.ops.object.shade_flat`,
`shade_smooth`, `shade_smooth_by_angle`, and records which edges (as vertex pairs) and faces end up sharp.
Edge order is Blender's own, so the TypeScript side compares edges by vertex pair.

Writes `shading.json` beside this file.
"""

import json
import math
import os

import bpy


def cube():
    co = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
    faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    return co, faces


def prism(n, r=1.0, h=2.0, tri_caps=False):
    co = []
    for z in (-h / 2, h / 2):
        for i in range(n):
            a = 2 * math.pi * i / n
            co.append([r * math.cos(a), r * math.sin(a), z])
    faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    if tri_caps:
        co += [[0, 0, -h / 2], [0, 0, h / 2]]
        b, t = 2 * n, 2 * n + 1
        faces += [[b, (i + 1) % n, i] for i in range(n)] + [[t, n + i, n + (i + 1) % n] for i in range(n)]
    else:
        faces += [list(reversed(range(n))), list(range(n, 2 * n))]
    return co, faces


def uv_sphere(seg=16, rings=8):
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


def noisy_grid(n=8):
    # deterministic bumps: many dihedral angles fall near any threshold
    co = [[x, y, 0.35 * math.sin(1.7 * x + 0.3) * math.cos(1.3 * y - 0.2) + 0.05 * ((x * 7 + y * 13) % 5)] for y in range(n + 1) for x in range(n + 1)]
    faces = [[y * (n + 1) + x, y * (n + 1) + x + 1, (y + 1) * (n + 1) + x + 1, (y + 1) * (n + 1) + x] for y in range(n) for x in range(n)]
    return co, faces


def fins(third):
    co = [[0, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, 1], [-0.5, 0.866, 0], [-0.5, 0.866, 1], [-1, 0, 0], [-1, 0, 1]] + third
    return co, [[0, 2, 3, 1], [1, 5, 4, 0], [0, 8, 9, 1]]


def flipped():
    return [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 0, 0], [2, 1, 0.3]], [[0, 1, 2, 3], [1, 2, 5, 4]]


def run(name, data, op, angle=None, keep=True, sharp_edges=(), sharp_faces=None):
    co, faces = data
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    me = bpy.data.meshes.new(name)
    me.from_pydata(co, [], faces)
    me.update()
    if sharp_edges:
        attr = me.attributes.new('sharp_edge', 'BOOLEAN', 'EDGE')
        want = {tuple(sorted(p)) for p in sharp_edges}
        for e in me.edges:
            attr.data[e.index].value = tuple(sorted(e.vertices)) in want
    if sharp_faces is not None:
        attr = me.attributes.new('sharp_face', 'BOOLEAN', 'FACE')
        for i, v in enumerate(sharp_faces):
            attr.data[i].value = bool(v)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    if op == 'smooth_by_angle':
        bpy.ops.object.shade_smooth_by_angle(angle=angle, keep_sharp_edges=keep)
    elif op == 'smooth':
        bpy.ops.object.shade_smooth(keep_sharp_edges=keep)
    else:
        bpy.ops.object.shade_flat(keep_sharp_edges=keep)
    me = ob.data
    se = me.attributes.get('sharp_edge')
    sf = me.attributes.get('sharp_face')
    return {
        'name': name,
        'input': {'positions': co, 'faces': faces, 'sharpEdges': [list(p) for p in sharp_edges], 'sharpFaces': sharp_faces},
        'op': op, 'angle': angle, 'keepSharpEdges': keep,
        'sharpEdges': sorted([sorted(e.vertices) for e in me.edges if se and se.data[e.index].value]) if se else None,
        'sharpFaces': [bool(d.value) for d in sf.data] if sf else None,
    }


D = math.pi / 180
cases = [
    run('cube-30', cube(), 'smooth_by_angle', 30 * D, keep=False),
    run('cube-91', cube(), 'smooth_by_angle', 91 * D, keep=False),
    run('octagon-45', prism(8), 'smooth_by_angle', 45 * D, keep=False),
    run('octagon-44.99', prism(8), 'smooth_by_angle', 44.99 * D, keep=False),
    run('cylinder-tri-caps-30', prism(32, tri_caps=True), 'smooth_by_angle', 30 * D, keep=False),
    run('uv-sphere-20', uv_sphere(), 'smooth_by_angle', 20 * D, keep=False),
    run('uv-sphere-25', uv_sphere(), 'smooth_by_angle', 25 * D, keep=False),
    run('noisy-grid-10', noisy_grid(), 'smooth_by_angle', 10 * D, keep=False),
    run('noisy-grid-20', noisy_grid(), 'smooth_by_angle', 20 * D, keep=False),
    run('keep-tags', prism(16), 'smooth_by_angle', 30 * D, keep=True, sharp_edges=[(0, 16), (3, 4)]),
    run('drop-tags', prism(16), 'smooth_by_angle', 30 * D, keep=False, sharp_edges=[(0, 16), (3, 4)]),
    run('flat-face-input', cube(), 'smooth_by_angle', 100 * D, keep=True, sharp_faces=[1, 0, 0, 0, 0, 0]),
    run('fins-120', fins([[-0.5, -0.866, 0], [-0.5, -0.866, 1]]), 'smooth_by_angle', 30 * D, keep=False),
    run('fins-coplanar-then-third', ([[0, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, 1], [-1, 0, 0], [-1, 0, 1], [0, 1, 0], [0, 1, 1]],
                                     [[0, 2, 3, 1], [1, 5, 4, 0], [0, 6, 7, 1]]), 'smooth_by_angle', 30 * D, keep=False),
    run('flipped', flipped(), 'smooth_by_angle', 30 * D, keep=False),
    run('flat-keep', prism(8), 'flat', keep=True, sharp_edges=[(0, 8)]),
    run('flat-drop', prism(8), 'flat', keep=False, sharp_edges=[(0, 8)]),
    run('smooth-keep', prism(8), 'smooth', keep=True, sharp_edges=[(0, 8)], sharp_faces=[1] * 10),
    run('smooth-drop', prism(8), 'smooth', keep=False, sharp_edges=[(0, 8)], sharp_faces=[1] * 10),
]

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shading.json')
with open(out, 'w') as fp:
    json.dump({'blender': bpy.app.version_string, 'generator': 'gen-shading-fixtures.py', 'cases': cases}, fp, indent=1)
print('wrote', out, len(cases), 'cases')

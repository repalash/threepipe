"""
Ground truth for `meshBooleanManifold` (`src/boolean/`), written by Blender's Boolean modifier with the Manifold solver:

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-boolean-fixtures.py

Each case builds a target and one or more operand objects from explicit data (`Mesh.from_pydata`), with a face
attribute (`material_index`), a point float attribute (`w`) and a UV map on every input, places the operands with a
location / rotation / scale, adds a Boolean modifier (solver MANIFOLD; OBJECT operand, or COLLECTION for several),
evaluates it and records the result: positions, faces (vertex indices, winding order), and the attributes per
domain. The TypeScript side compares geometry and attributes as multisets keyed by position.

Writes `boolean.json` beside this file.
"""

import json
import math
import os

import bpy


def box(sx=1, sy=1, sz=1):
    co = [[-sx, -sy, -sz], [sx, -sy, -sz], [sx, sy, -sz], [-sx, sy, -sz], [-sx, -sy, sz], [sx, -sy, sz], [sx, sy, sz], [-sx, sy, sz]]
    faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    return co, faces


def cylinder(r=0.3, h=2, n=16):
    # n-gon caps (the polyfill path for n > 4), axis z
    co = [[r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), z] for z in (-h, h) for i in range(n)]
    faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    faces += [list(reversed(range(n))), [n + i for i in range(n)]]
    return co, faces


def plane(s=3, z=0.0):
    return [[-s, -s, z], [s, -s, z], [s, s, z], [-s, s, z]], [[0, 1, 2, 3]]


def tri_sheet():
    return [[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 2]]


def make(name, data, mat, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    co, faces = data
    me = bpy.data.meshes.new(name)
    me.from_pydata(co, [], faces)
    me.update()
    m = me.attributes.new('material_index', 'INT', 'FACE')
    for f in me.polygons:
        m.data[f.index].value = mat
    w = me.attributes.new('w', 'FLOAT', 'POINT')
    for v in me.vertices:
        w.data[v.index].value = 0.1 * mat + 0.01 * v.index
    uv = me.uv_layers.new(name='UVMap')
    for f in me.polygons:
        n = len(f.loop_indices)
        for k, li in enumerate(f.loop_indices):
            a = 2 * math.pi * k / n
            uv.data[li].uv = (0.5 + 0.5 * math.cos(a), 0.5 + 0.5 * math.sin(a))
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.rotation_euler = rot
    ob.scale = scale
    bpy.context.scene.collection.objects.link(ob)
    return ob, {'positions': co, 'faces': faces, 'material': mat, 'location': list(loc), 'rotation': list(rot), 'scale': list(scale)}


def run(name, target, operands, operation):
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    t, tin = make(name + '-target', target, 0)
    ins = []
    obs = []
    for i, (data, loc, rot, scale) in enumerate(operands):
        o, oin = make(f'{name}-op{i}', data, i + 1, loc, rot, scale)
        o.hide_set(True)
        obs.append(o)
        ins.append(oin)
    mod = t.modifiers.new('Boolean', 'BOOLEAN')
    mod.solver = 'MANIFOLD'
    mod.operation = operation
    if len(obs) == 1:
        mod.operand_type = 'OBJECT'
        mod.object = obs[0]
    else:
        coll = bpy.data.collections.new(name + '-cutters')
        for o in obs:
            bpy.context.scene.collection.objects.unlink(o)
            coll.objects.link(o)
        mod.operand_type = 'COLLECTION'
        mod.collection = coll
    dg = bpy.context.evaluated_depsgraph_get()
    ev = t.evaluated_get(dg)
    out = ev.to_mesh()
    res = {
        'name': name,
        'operation': operation,
        'target': tin,
        'operands': ins,
        'positions': [list(v.co) for v in out.vertices],
        'faces': [list(p.vertices) for p in out.polygons],
        'edges': [list(e.vertices) for e in out.edges],
    }
    if 'material_index' in out.attributes:
        res['material_index'] = [d.value for d in out.attributes['material_index'].data]
    if 'w' in out.attributes:
        res['w'] = [d.value for d in out.attributes['w'].data]
    if out.uv_layers:
        res['uv'] = [list(d.uv) for d in out.uv_layers[0].data]
    ev.to_mesh_clear()
    return res


B = box()
cases = [
    run('box-minus-box-corner', B, [(box(), (1, 1, 1), (0, 0, 0), (1, 1, 1))], 'DIFFERENCE'),
    run('box-union-box-side', B, [(box(), (1, 0, 0), (0, 0, 0), (1, 1, 1))], 'UNION'),
    run('box-intersect-box-side', B, [(box(), (1, 0, 0), (0, 0, 0), (1, 1, 1))], 'INTERSECT'),
    run('box-minus-rotated-box', B, [(box(0.5, 0.5, 2), (0.3, 0.2, 0), (0.3, 0.2, 0.7), (1, 1, 1))], 'DIFFERENCE'),
    run('box-drilled-by-cylinder', B, [(cylinder(), (0.4, 0.1, 0), (0, 0, 0), (1, 1, 1))], 'DIFFERENCE'),
    run('box-recess-by-cylinder', B, [(cylinder(0.5, 0.5, 24), (0, 0, 1), (0, 0, 0), (1, 1, 1))], 'DIFFERENCE'),
    run('box-trim-by-plane', B, [(plane(3, 0.0), (0, 0, 0.5), (0.2, 0, 0), (1, 1, 1))], 'DIFFERENCE'),
    run('box-minus-two-cylinders', B, [(cylinder(), (-0.4, 0, 0), (0, 0, 0), (1, 1, 1)),
                                       (cylinder(0.2, 2, 12), (0, 0, 0), (math.pi / 2, 0, 0), (1, 1, 1))], 'DIFFERENCE'),
    run('box-union-three', B, [(box(0.5, 0.5, 0.5), (1, 0, 0), (0, 0, 0), (1, 1, 1)),
                               (box(0.5, 0.5, 0.5), (0, 1, 0), (0, 0, 0.4), (1, 1, 1))], 'UNION'),
    run('box-non-manifold-operand', B, [(tri_sheet(), (0, 0, 0), (0, 0, 0), (1, 1, 1))], 'UNION'),
]

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'boolean.json')
with open(out, 'w') as fp:
    json.dump({'blender': bpy.app.version_string, 'generator': 'gen-boolean-fixtures.py', 'cases': cases}, fp, indent=1)
print('wrote', out, len(cases), 'cases')

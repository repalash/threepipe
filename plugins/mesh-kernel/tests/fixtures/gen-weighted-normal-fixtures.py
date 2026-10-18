"""
Ground truth for `weightedNormal` (`src/weightedNormal.ts`), written by Blender's Weighted Normal modifier:

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-weighted-normal-fixtures.py

The input meshes are built here (a box beveled with `bmesh.ops.bevel`, a cylinder with a beveled rim) and stored
as plain positions / faces, so the TypeScript side starts from exactly the same mesh. Each case adds a Weighted
Normal modifier with the case's settings and records the evaluated corner normals, the `custom_normal` data and
the sharp edges.

Writes `weighted-normal.json` beside this file.
"""

import json
import math
import os

import bmesh
import bpy


def beveled_box(offset=0.15, segments=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=offset, segments=segments, affect='EDGES', profile=0.5)
    bm.verts.index_update()
    co = [list(v.co) for v in bm.verts]
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return co, faces


def beveled_cylinder(n=12):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=n, radius1=1.0, radius2=1.0, depth=1.0)
    rim = [e for e in bm.edges if len(e.link_faces) == 2 and abs(e.link_faces[0].normal.z) > 0.9 or (len(e.link_faces) == 2 and abs(e.link_faces[1].normal.z) > 0.9)]
    bmesh.ops.bevel(bm, geom=rim, offset=0.1, segments=1, affect='EDGES', profile=0.5)
    bm.verts.index_update()
    co = [list(v.co) for v in bm.verts]
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return co, faces


def run(name, data, mode='FACE_AREA', weight=50, thresh=0.01, keep_sharp=False, face_influence=False, sharp_edges=(), face_strength=None):
    co, faces = data
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    me = bpy.data.meshes.new(name)
    me.from_pydata(co, [], faces)
    me.update()
    me.shade_smooth()
    if sharp_edges:
        attr = me.attributes.new('sharp_edge', 'BOOLEAN', 'EDGE')
        want = {tuple(sorted(p)) for p in sharp_edges}
        for e in me.edges:
            attr.data[e.index].value = tuple(sorted(e.vertices)) in want
    if face_strength is not None:
        attr = me.attributes.new('__mod_weightednormals_faceweight', 'INT', 'FACE')
        for i, v in enumerate(face_strength):
            attr.data[i].value = v
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    m = ob.modifiers.new('WN', 'WEIGHTED_NORMAL')
    m.mode = mode
    m.weight = weight
    m.thresh = thresh
    m.keep_sharp = keep_sharp
    m.use_face_influence = face_influence
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    out = ev.to_mesh()
    a = out.attributes.get('custom_normal')
    se = out.attributes.get('sharp_edge')
    res = {
        'name': name,
        'input': {'positions': co, 'faces': faces, 'sharpEdges': [list(p) for p in sharp_edges], 'faceStrength': face_strength},
        'modifier': {'mode': mode, 'weight': weight, 'thresh': thresh, 'keepSharp': keep_sharp, 'useFaceInfluence': face_influence},
        'cornerNormals': [list(n.vector) for n in out.corner_normals],
        'customNormal': [list(d.value) for d in a.data] if a else None,
        'sharpEdges': sorted([sorted(e.vertices) for e in out.edges if se and se.data[e.index].value]) if se else [],
    }
    ev.to_mesh_clear()
    return res


box = beveled_box()
cyl = beveled_cylinder()
box_faces = len(box[1])
cases = [
    run('box-area-50', box),
    run('box-area-75', box, weight=75),
    run('box-area-100', box, weight=100),
    run('box-angle-50', box, mode='CORNER_ANGLE'),
    run('box-area-angle-90', box, mode='FACE_AREA_WITH_ANGLE', weight=90),
    run('box-area-1', box, weight=1),
    run('cyl-area-100', cyl, weight=100),
    run('cyl-area-keep-sharp', cyl, weight=100, keep_sharp=True, sharp_edges=[(0, 1), (1, 2), (2, 3)]),
    run('box-face-influence', box, weight=60, face_influence=True,
        face_strength=[16384 if i % 3 == 0 else (0 if i % 3 == 1 else -16384) for i in range(box_faces)]),
    run('cyl-angle-thresh', cyl, mode='CORNER_ANGLE', weight=70, thresh=0.5),
]

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'weighted-normal.json')
with open(out, 'w') as fp:
    json.dump({'blender': bpy.app.version_string, 'generator': 'gen-weighted-normal-fixtures.py', 'cases': cases}, fp, indent=1)
print('wrote', out, len(cases), 'cases')

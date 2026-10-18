"""
Ground truth for bevel's `harden_normals` and `face_strength_mode` (`src/ops/bevel-harden.ts`), written by
`bmesh.ops.bevel` in Blender:

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-bevel-harden-fixtures.py

Each case builds a mesh from explicit data (smooth or flat), bevels the listed edges with the case's options and
records the result: positions, faces, the corner normals the mesh shades with, the `custom_normal` data and the
face strength layer.

Writes `bevel-harden.json` beside this file.
"""

import json
import math
import os

import bmesh
import bpy


def cube():
    co = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
    faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    return co, faces


def prism(n=8):
    co = [[math.cos(2 * math.pi * i / n), math.sin(2 * math.pi * i / n), z] for z in (-1, 1) for i in range(n)]
    faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    faces += [list(reversed(range(n))), [n + i for i in range(n)]]
    return co, faces


def run(name, data, edges, offset=0.2, segments=2, smooth=True, harden=True, strength='NONE'):
    co, faces = data
    me = bpy.data.meshes.new(name)
    me.from_pydata(co, [], faces)
    me.update()
    if smooth:
        me.shade_smooth()
    bm = bmesh.new()
    bm.from_mesh(me)
    want = {tuple(sorted(p)) for p in edges} if edges != 'all' else None
    geom = [e for e in bm.edges if want is None or tuple(sorted((e.verts[0].index, e.verts[1].index))) in want]
    bmesh.ops.bevel(bm, geom=geom, offset=offset, offset_type='OFFSET', profile_type='SUPERELLIPSE', segments=segments,
                    profile=0.5, affect='EDGES', clamp_overlap=False, loop_slide=True, mark_seam=False, mark_sharp=False,
                    harden_normals=harden, face_strength_mode=strength, miter_outer='SHARP', miter_inner='SHARP')
    out = bpy.data.meshes.new(name + '-out')
    bm.to_mesh(out)
    bm.free()
    out.update()
    a = out.attributes.get('custom_normal')
    fs = out.attributes.get('__mod_weightednormals_faceweight')
    se = out.attributes.get('sharp_edge')
    return {
        'name': name,
        'input': {'positions': co, 'faces': faces, 'edges': edges, 'smooth': smooth},
        'options': {'offset': offset, 'segments': segments, 'harden': harden, 'faceStrength': strength},
        'positions': [list(v.co) for v in out.vertices],
        'faces': [list(p.vertices) for p in out.polygons],
        'cornerNormals': [list(n.vector) for n in out.corner_normals],
        'customNormal': [list(d.value) for d in a.data] if a else None,
        'faceStrength': [d.value for d in fs.data] if fs else None,
        'sharpEdges': sorted([sorted(e.vertices) for e in out.edges if se and se.data[e.index].value]) if se else [],
    }


cases = [
    run('cube-all-s2', cube(), 'all'),
    run('cube-all-s1', cube(), 'all', segments=1),
    run('cube-all-s3-flat', cube(), 'all', segments=3, smooth=False),
    run('cube-corner-three-s2', cube(), [(1, 2), (2, 6), (2, 3)], strength='NEW'),
    run('cube-ring-s2-affected', cube(), [(4, 5), (5, 6), (6, 7), (7, 4)], strength='AFFECTED'),
    run('prism-rims-s2-all', prism(), [(i, (i + 1) % 8) for i in range(8)] + [(8 + i, 8 + (i + 1) % 8) for i in range(8)], offset=0.1, strength='ALL'),
    run('cube-strength-only', cube(), 'all', harden=False, strength='ALL'),
]

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bevel-harden.json')
with open(out, 'w') as fp:
    json.dump({'blender': bpy.app.version_string, 'generator': 'gen-bevel-harden-fixtures.py', 'cases': cases}, fp, indent=1)
print('wrote', out, len(cases), 'cases')

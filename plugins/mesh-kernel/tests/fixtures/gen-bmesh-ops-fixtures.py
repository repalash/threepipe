"""
Ground truth for the `poke` and `wireframe` ports, written by Blender itself.

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-bmesh-ops-fixtures.py

Each case builds its input mesh from explicit coordinates (so the TypeScript test can build exactly
the same one), refreshes normals the way edit mode keeps them current (`bm.normal_update()`), runs the
`bmesh.ops` operator and records every resulting vertex position and face (as vertex indices into
that list). Nothing in the output is hand-written; rerun this script to regenerate it.

Writes `bmesh-ops-poke-wireframe.json` beside this file.
"""

import bpy
import bmesh
import json
import os

CUBE_CO = [
    [-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1],
    [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1],
]
CUBE_FACES = [[0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]]

# A 3x2 grid of quads, open, with an uneven spacing and a lifted vertex so normals are not all equal.
GRID_CO = []
for y, yy in enumerate([0.0, 0.7, 2.0]):
    for x, xx in enumerate([0.0, 1.0, 1.6, 3.0]):
        GRID_CO.append([xx, yy, 0.4 if (x, y) == (1, 1) else 0.0])
GRID_FACES = []
for y in range(2):
    for x in range(3):
        a = y * 4 + x
        GRID_FACES.append([a, a + 1, a + 5, a + 4])

# An irregular, non-planar pentagon: the three centre modes all give different points here.
PENT_CO = [[0, 0, 0], [2.0, 0, 0.1], [2.6, 1.2, 0.0], [1.0, 2.2, -0.2], [-0.4, 1.0, 0.05]]
PENT_FACES = [[0, 1, 2, 3, 4]]

# A tapered open box: four trapezoid sides of a frustum, no caps. The shape of one tower panel.
FRUST_CO = [[-2, 0, -2], [2, 0, -2], [2, 0, 2], [-2, 0, 2],
            [-1.2, 3, -1.2], [1.2, 3, -1.2], [1.2, 3, 1.2], [-1.2, 3, 1.2]]
FRUST_FACES = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]


def build(co, faces):
    bm = bmesh.new()
    verts = [bm.verts.new(c) for c in co]
    bm.verts.ensure_lookup_table()
    for f in faces:
        bm.faces.new([verts[i] for i in f])
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    return bm


def dump(bm):
    bm.verts.index_update()
    return {
        'positions': [[round(c, 6) for c in v.co] for v in bm.verts],
        'faces': [[v.index for v in f.verts] for f in bm.faces],
    }


cases = []


def case(name, co, faces, op, params, face_subset=None):
    bm = build(co, faces)
    sel = [bm.faces[i] for i in (face_subset if face_subset is not None else range(len(faces)))]
    if op == 'poke':
        getattr(bmesh.ops, op)(bm, faces=sel, **params)
    elif op == 'poke+wireframe':
        out = bmesh.ops.poke(bm, faces=sel, **params.get('poke', {}))
        bm.normal_update()
        bmesh.ops.wireframe(bm, faces=out['faces'], **params.get('wireframe', {}))
    else:
        getattr(bmesh.ops, op)(bm, faces=sel, **params)
    cases.append({
        'name': name,
        'op': op,
        'params': params,
        'input': {'positions': co, 'faces': faces},
        'faceSubset': face_subset,
        'output': dump(bm),
    })
    bm.free()


# --- poke ---
case('poke cube mean-weighted offset', CUBE_CO, CUBE_FACES, 'poke',
     {'offset': 0.3, 'center_mode': 'MEAN_WEIGHTED', 'use_relative_offset': False})
case('poke pentagon mean', PENT_CO, PENT_FACES, 'poke',
     {'offset': 0.0, 'center_mode': 'MEAN', 'use_relative_offset': False})
case('poke pentagon mean-weighted', PENT_CO, PENT_FACES, 'poke',
     {'offset': 0.0, 'center_mode': 'MEAN_WEIGHTED', 'use_relative_offset': False})
case('poke pentagon bounds relative', PENT_CO, PENT_FACES, 'poke',
     {'offset': 0.25, 'center_mode': 'BOUNDS', 'use_relative_offset': True})
case('poke grid subset', GRID_CO, GRID_FACES, 'poke',
     {'offset': -0.1, 'center_mode': 'MEAN_WEIGHTED', 'use_relative_offset': False}, [1, 4])

# --- wireframe ---
WF = dict(thickness=0.1, offset=0.01, use_replace=True, use_boundary=True, use_even_offset=True,
          use_relative_offset=False, use_crease=False, crease_weight=0.01)
case('wireframe cube defaults', CUBE_CO, CUBE_FACES, 'wireframe', dict(WF))
case('wireframe grid boundary', GRID_CO, GRID_FACES, 'wireframe', dict(WF, thickness=0.2, offset=-0.5))
case('wireframe grid no boundary no even', GRID_CO, GRID_FACES, 'wireframe',
     dict(WF, thickness=0.15, use_boundary=False, use_even_offset=False))
case('wireframe grid relative', GRID_CO, GRID_FACES, 'wireframe',
     dict(WF, thickness=0.1, offset=1.0, use_relative_offset=True))
case('wireframe grid subset keep', GRID_CO, GRID_FACES, 'wireframe',
     dict(WF, thickness=0.12, use_replace=True), [0, 1, 4])
case('wireframe grid subset no replace', GRID_CO, GRID_FACES, 'wireframe',
     dict(WF, thickness=0.12, use_replace=False), [0, 4])
case('wireframe thickness zero offset', CUBE_CO, CUBE_FACES, 'wireframe', dict(WF, thickness=0.0))
case('poke then wireframe frustum', FRUST_CO, FRUST_FACES, 'poke+wireframe',
     {'poke': {'offset': 0.0, 'center_mode': 'MEAN_WEIGHTED'},
      'wireframe': dict(WF, thickness=0.08, offset=0.0)})

out = {
    'generator': 'gen-bmesh-ops-fixtures.py',
    'blender': bpy.app.version_string,
    'cases': cases,
}
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bmesh-ops-poke-wireframe.json')
with open(path, 'w') as fh:
    json.dump(out, fh, indent=1)
print('wrote', path, len(cases), 'cases')

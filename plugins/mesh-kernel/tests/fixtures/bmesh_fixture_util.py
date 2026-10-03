"""
Shared helpers for the operator fixture generators (`gen-bmesh-ops-*.py`), run inside Blender:

    blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-bmesh-ops-<op>.py

A generator builds each input mesh from explicit data with `build`, runs a `bmesh.ops` operator (or
an edit-mode operator through `bpy.ops` on an object built with `build_object`), and records the
result with `dump`. The TypeScript side (`../parity-util.ts`) builds the identical input and compares
geometry, faces (as cyclic sequences, so winding counts), every edge, and the selection.

Nothing in a fixture is hand-written; rerun the generator to regenerate it.
"""

import bmesh
import json
import os


def build(co, faces, edges=(), select=None):
    """
    A BMesh with vertices `co`, faces `faces` (vertex index lists, in winding order) and extra wire
    edges `edges` (vertex index pairs). `select` is an optional dict with 'verts' / 'edges' / 'faces'
    index lists; edges are addressed by their vertex pair, so `select['edges']` holds pairs too.
    """
    bm = bmesh.new()
    verts = [bm.verts.new(c) for c in co]
    bm.verts.ensure_lookup_table()
    for f in faces:
        bm.faces.new([verts[i] for i in f])
    for a, b in edges:
        if bm.edges.get((verts[a], verts[b])) is None:
            bm.edges.new((verts[a], verts[b]))
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    if select:
        for i in select.get('verts', ()):
            bm.verts[i].select = True
        for a, b in select.get('edges', ()):
            bm.edges.get((verts[a], verts[b])).select = True
        for i in select.get('faces', ()):
            bm.faces[i].select = True
    return bm


def edge_lookup(bm, pairs):
    """The BMEdges joining each vertex index pair."""
    bm.verts.ensure_lookup_table()
    return [bm.edges.get((bm.verts[a], bm.verts[b])) for a, b in pairs]


def dump(bm):
    """Every vertex position, every face (vertex indices, winding order), every edge, and the selection."""
    bm.verts.index_update()
    bm.edges.index_update()
    bm.faces.index_update()
    return {
        'positions': [[round(c, 6) for c in v.co] for v in bm.verts],
        'faces': [[v.index for v in f.verts] for f in bm.faces],
        'edges': [[e.verts[0].index, e.verts[1].index] for e in bm.edges],
        'selected': {
            'verts': [v.index for v in bm.verts if v.select],
            'edges': [[e.verts[0].index, e.verts[1].index] for e in bm.edges if e.select],
            'faces': [f.index for f in bm.faces if f.select],
        },
    }


def write(script_file, name, cases):
    """Write `cases` to `<name>` beside the generator."""
    import bpy
    out = {
        'generator': os.path.basename(script_file),
        'blender': bpy.app.version_string,
        'cases': cases,
    }
    path = os.path.join(os.path.dirname(os.path.abspath(script_file)), name)
    with open(path, 'w') as fh:
        json.dump(out, fh, indent=1)
    print('wrote', path, len(cases), 'cases')

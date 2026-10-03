# Generates Blender ground-truth fixtures for the knife and bisect ports
# (`src/ops/knife/`, `src/ops/bisectPlane.ts`), read by `../knife-bisect-parity.test.ts`.
#
# Knife cuts are made with `bpy.ops.mesh.knife_project` (the non-interactive `EDBM_mesh_knife` path in
# editors/mesh/editmesh_knife.cc) from a curve polyline projected through a 3D view, so Blender needs a
# window: run it under Xvfb, not in --background mode, with a context override for the operator:
#
#   xvfb-run -a -s "-screen 0 1280x1024x24" blender --factory-startup \
#       --python plugins/mesh-kernel/tests/fixtures/gen-knife-bisect-fixtures.py
#
# Output goes to `knife-bisect/` next to this script (or the directory given after `--`).
#
# Bisects use `bpy.ops.mesh.bisect` (bmo_bisect_plane.cc). Each fixture stores the input mesh, the view
# matrices and region size, the screen-space polylines (as Blender computed them), the operator options,
# and the resulting mesh. Vertex order in the result is Blender's; tests compare topology by coordinates.
import bpy, json, os, sys, traceback
from mathutils import Quaternion, Vector
from bpy_extras.view3d_utils import location_3d_to_region_2d

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'knife-bisect')

TOP = (1.0, 0.0, 0.0, 0.0)
FRONT = tuple(Quaternion((1.0, 0.0, 0.0), 1.5707963))  # look along +Y
ISO = (0.7160, 0.4390, 0.2910, 0.4590)  # roughly the startup view

# name, mesh, view, polylines (world-space points; projected through the view), cut_through
KNIFE_CASES = [
    ('knife-cube-top-line', 'cube', dict(persp='ORTHO', rot=TOP, dist=6), [[(-2.0, 0.3, 5.0), (2.0, -0.3, 5.0)]], False),
    ('knife-cube-top-line-through', 'cube', dict(persp='ORTHO', rot=TOP, dist=6), [[(-2.0, 0.3, 5.0), (2.0, -0.3, 5.0)]], True),
    ('knife-cube-top-bent', 'cube', dict(persp='ORTHO', rot=TOP, dist=6), [[(-2.0, 0.3, 5.0), (0.1, -0.2, 5.0), (0.4, 2.0, 5.0)]], False),
    ('knife-cube-top-vertex-to-edge', 'cube', dict(persp='ORTHO', rot=TOP, dist=6), [[(1.0, 1.0, 5.0), (-1.0, -0.25, 5.0)]], False),
    ('knife-cube-top-inner-square', 'cube', dict(persp='ORTHO', rot=TOP, dist=6),
     [[(-0.4, -0.4, 5.0), (0.4, -0.4, 5.0), (0.4, 0.4, 5.0), (-0.4, 0.4, 5.0), (-0.4, -0.4, 5.0)]], False),
    ('knife-cube-top-face-to-edge', 'cube', dict(persp='ORTHO', rot=TOP, dist=6), [[(0.0, 0.0, 5.0), (2.0, 0.2, 5.0)]], False),
    ('knife-grid-polyline', 'grid', dict(persp='ORTHO', rot=TOP, dist=6), [[(-1.3, -0.4, 1.0), (0.2, 0.1, 1.0), (1.3, 0.7, 1.0)]], False),
    ('knife-cube-persp-line', 'cube', dict(persp='PERSP', rot=ISO, dist=7), [[(-2.0, 0.3, 1.5), (2.0, -0.3, 1.5)]], False),
    ('knife-cube-persp-through', 'cube', dict(persp='PERSP', rot=ISO, dist=7), [[(-2.0, 0.3, 1.5), (2.0, -0.3, 1.5)]], True),
    ('knife-cube-front-diagonal', 'cube', dict(persp='ORTHO', rot=FRONT, dist=6), [[(-1.5, -5.0, -0.6), (1.5, -5.0, 0.8)]], False),
]

# name, mesh, plane_co, plane_no, clear_inner, clear_outer, use_fill, threshold
BISECT_CASES = [
    ('bisect-cube-x', 'cube', (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), False, False, False, 0.0001),
    ('bisect-cube-x-offset', 'cube', (0.3, 0.0, 0.0), (1.0, 0.0, 0.0), False, False, False, 0.0001),
    ('bisect-cube-diag', 'cube', (0.0, 0.0, 0.0), (1.0, 1.0, 0.0), False, False, False, 0.0001),
    ('bisect-cube-tilted', 'cube', (0.1, 0.2, 0.0), (0.3, 0.5, 1.0), False, False, False, 0.0001),
    ('bisect-cube-clear-inner', 'cube', (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), True, False, False, 0.0001),
    ('bisect-cube-clear-outer-fill', 'cube', (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), False, True, True, 0.0001),
    ('bisect-cube-fill', 'cube', (0.2, 0.0, 0.0), (0.4, 0.3, 1.0), False, False, True, 0.0001),
    ('bisect-cube-through-verts', 'cube', (0.0, 0.0, 0.0), (1.0, 1.0, 0.0), False, False, False, 0.0001),
    ('bisect-grid-diag', 'grid', (0.0, 0.0, 0.0), (1.0, 0.4, 0.0), False, False, False, 0.0001),
    ('bisect-cylinder-fill', 'cylinder', (0.0, 0.0, 0.2), (0.2, 0.0, 1.0), False, False, True, 0.0001),
]


def make_mesh(kind):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    if kind == 'cube':
        bpy.ops.mesh.primitive_cube_add(size=2.0)
    elif kind == 'grid':
        bpy.ops.mesh.primitive_grid_add(x_subdivisions=2, y_subdivisions=2, size=2.0)
    elif kind == 'cylinder':
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=1.0, depth=2.0)
    ob = bpy.context.active_object
    return ob


def dump_mesh(ob):
    me = ob.data
    return {
        'verts': [[round(c, 6) for c in v.co] for v in me.vertices],
        'faces': [list(p.vertices) for p in me.polygons],
        'edges': [list(e.vertices) for e in me.edges],
    }


def find_view():
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == 'VIEW_3D')
    region = next(r for r in area.regions if r.type == 'WINDOW')
    return win, area, region, area.spaces.active


def set_view(space, region, view):
    r3d = space.region_3d
    r3d.view_perspective = view['persp']
    r3d.view_rotation = view['rot']
    r3d.view_location = (0.0, 0.0, 0.0)
    r3d.view_distance = view['dist']
    # A perspective view with Blender's default clip_start (0.01) is badly conditioned in float32:
    # `ED_view3d_win_to_vector` unprojects NDC z = -0.5, which then lies ~0.013 units from the eye,
    # so the pick ray carries ~1e-4 rad of rounding and a cut point inside a face lands ~5e-4 units
    # (0.03 px) off the cursor ray. That is float32 noise, not knife logic (the port runs in doubles
    # and lands on the ray), so the fixtures use a near plane that keeps Blender's own error < 1e-5.
    space.clip_start = 0.5 if view['persp'] == 'PERSP' else 0.01
    space.clip_end = 1000.0
    return r3d


def view_json(space, region, r3d):
    return {
        'persp': r3d.view_perspective,
        'is_persp': r3d.is_perspective,
        'winx': region.width, 'winy': region.height,
        'clip_start': space.clip_start, 'clip_end': space.clip_end,
        # row-major rows as mathutils prints them
        'persmat': [list(r) for r in r3d.perspective_matrix],
        'viewmat': [list(r) for r in r3d.view_matrix],
        'winmat': [list(r) for r in r3d.window_matrix],
    }


def run_knife(name, mesh, view, polys, cut_through):
    ob = make_mesh(mesh)
    win, area, region, space = find_view()
    r3d = set_view(space, region, view)
    curves = []
    for pts in polys:
        cu = bpy.data.curves.new('cut', 'CURVE'); cu.dimensions = '3D'
        sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
        for p, co in zip(sp.points, pts):
            p.co = (co[0], co[1], co[2], 1.0)
        cob = bpy.data.objects.new('cut', cu); bpy.context.scene.collection.objects.link(cob)
        curves.append(cob)
    for o in bpy.data.objects: o.select_set(False)
    ob.select_set(True)
    for c in curves: c.select_set(True)
    bpy.context.view_layer.objects.active = ob
    ov = {'window': win, 'screen': win.screen, 'area': area, 'region': region, 'scene': bpy.context.scene,
          'view_layer': bpy.context.view_layer, 'active_object': ob, 'edit_object': ob,
          'selected_objects': [ob] + curves, 'selected_editable_objects': [ob] + curves}
    fx = {'name': name, 'kind': 'knife', 'blender': bpy.app.version_string, 'mesh': mesh, 'cut_through': cut_through}
    fx['input'] = dump_mesh(ob)
    with bpy.context.temp_override(window=win, area=area, region=region):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.wm.redraw_timer(type='DRAW_WIN_SWAP', iterations=1)
        fx['view'] = view_json(space, region, r3d)
        fx['polys_world'] = [[list(p) for p in pts] for pts in polys]
        fx['polys'] = [[list(location_3d_to_region_2d(region, r3d, Vector(p))) for p in pts] for pts in polys]
        bpy.ops.mesh.knife_project(ov, cut_through=cut_through)
        bpy.ops.object.mode_set(mode='OBJECT')
    fx['output'] = dump_mesh(ob)
    return fx


def run_bisect(name, mesh, co, no, clear_inner, clear_outer, use_fill, threshold):
    ob = make_mesh(mesh)
    win, area, region, space = find_view()
    fx = {'name': name, 'kind': 'bisect', 'blender': bpy.app.version_string, 'mesh': mesh,
          'plane_co': list(co), 'plane_no': list(no), 'clear_inner': clear_inner, 'clear_outer': clear_outer,
          'use_fill': use_fill, 'threshold': threshold}
    fx['input'] = dump_mesh(ob)
    with bpy.context.temp_override(window=win, area=area, region=region):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.bisect(plane_co=co, plane_no=no, clear_inner=clear_inner, clear_outer=clear_outer,
                            use_fill=use_fill, threshold=threshold)
        bpy.ops.object.mode_set(mode='OBJECT')
    fx['output'] = dump_mesh(ob)
    return fx


def main():
    os.makedirs(OUT, exist_ok=True)
    report = []
    for case in KNIFE_CASES:
        try:
            fx = run_knife(*case)
            with open(os.path.join(OUT, case[0] + '.json'), 'w') as f:
                json.dump(fx, f, indent=1)
            report.append('ok %s faces=%d' % (case[0], len(fx['output']['faces'])))
        except Exception:
            report.append('FAIL %s\n%s' % (case[0], traceback.format_exc()))
    for case in BISECT_CASES:
        try:
            fx = run_bisect(*case)
            with open(os.path.join(OUT, case[0] + '.json'), 'w') as f:
                json.dump(fx, f, indent=1)
            report.append('ok %s faces=%d' % (case[0], len(fx['output']['faces'])))
        except Exception:
            report.append('FAIL %s\n%s' % (case[0], traceback.format_exc()))
    print('FIXTURE_REPORT\n' + '\n'.join(report))
    sys.stdout.flush()
    bpy.ops.wm.quit_blender()
    return None


bpy.app.timers.register(main, first_interval=1.0)

# Ground truth for the *interactive* knife (`src/ops/knife/knife.ts`, `KnifeTool.modal`), written by
# Blender's own modal knife (`MESH_OT_knife_tool`, editmesh_knife.cc) driven by simulated input - and
# for bisect's line gesture (`MESH_OT_bisect` invoked without a plane: `mesh_bisect_interactive_calc`,
# `bisectPlaneFromScreenLine` in the port), recorded the same way.
#
#   xvfb-run -a -s "-screen 0 1280x1024x24" blender --factory-startup --enable-event-simulate \
#       --python plugins/mesh-kernel/tests/fixtures/gen-knife-interactive-fixtures.py
#
# Each case builds a mesh, sets a 3D view, invokes `mesh.knife_tool` (INVOKE_DEFAULT with a context
# override - simulated key presses are queued but never dispatched to the keymap headless, while a
# running modal operator does receive them), then feeds it mouse moves, clicks and modal keys with
# `Window.event_simulate`, one event per main-loop iteration. Cursor positions are world points
# projected to region pixels and rounded, plus an optional pixel offset (to land *near* an element and
# exercise snapping).
#
# Recorded per case: the input mesh, the view (matrices, region size, clip range), the preference
# scale factor the snapping distances use (`UI_SCALE_FAC`), every event as Blender's region
# coordinates (bottom-left origin) and the resulting mesh. `../knife-bisect-parity.test.ts` replays the
# events through the Knife Tool Modal Map (`blender_default.py:6404`) into `KnifeTool.modal`.
#
# Output: `knife-interactive/` next to this script (or the directory given after `--`).
import bpy, json, os, sys, traceback
from mathutils import Quaternion, Vector
from bpy_extras.view3d_utils import location_3d_to_region_2d

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'knife-interactive')

TOP = (1.0, 0.0, 0.0, 0.0)
ISO = (0.7160, 0.4390, 0.2910, 0.4590)
VIEW_TOP = dict(persp='ORTHO', rot=TOP, dist=6)
VIEW_ISO = dict(persp='PERSP', rot=ISO, dist=7)

# Actions: ('move', world_point, (dx, dy)), ('click', world_point, (dx, dy)), ('press'|'release', key),
# ('drag', [points...]) = press at the first, moves through the rest, release at the last.
# Keys are Blender event types; a key 'tap' is a press then a release.
CASES = [
    ('iknife-cube-edge-to-edge', 'cube', VIEW_TOP, [
        ('click', (-1.0, 0.3, 1.0), (0, 0)), ('click', (1.0, -0.3, 1.0), (0, 0)), ('tap', 'RET')]),
    ('iknife-cube-snap-verts', 'cube', VIEW_TOP, [
        ('click', (1.0, 1.0, 1.0), (4, -3)), ('click', (-1.0, -1.0, 1.0), (-3, 4)), ('tap', 'RET')]),
    ('iknife-cube-snap-edge-near', 'cube', VIEW_TOP, [
        ('click', (-1.0, 0.5, 1.0), (5, 0)), ('click', (0.2, -1.0, 1.0), (0, 6)), ('tap', 'RET')]),
    ('iknife-cube-midpoints', 'cube', VIEW_TOP, [
        ('press', 'LEFT_SHIFT'),
        ('click', (-1.0, 0.6, 1.0), (0, 0)), ('click', (1.0, -0.2, 1.0), (0, 0)),
        ('release', 'LEFT_SHIFT'), ('tap', 'RET')]),
    ('iknife-cube-face-points', 'cube', VIEW_TOP, [
        ('click', (-0.5, -0.4, 1.0), (0, 0)), ('click', (0.4, -0.3, 1.0), (0, 0)),
        ('click', (0.1, 0.5, 1.0), (0, 0)), ('tap', 'RET')]),
    ('iknife-cube-closed-triangle', 'cube', VIEW_TOP, [
        ('click', (-0.5, -0.4, 1.0), (0, 0)), ('click', (0.4, -0.3, 1.0), (0, 0)),
        ('click', (0.1, 0.5, 1.0), (0, 0)), ('click', (-0.5, -0.4, 1.0), (0, 0)), ('tap', 'RET')]),
    ('iknife-cube-cut-through', 'cube', VIEW_TOP, [
        ('tap', 'C'),
        ('click', (-1.0, 0.3, 1.0), (0, 0)), ('click', (1.0, -0.3, 1.0), (0, 0)), ('tap', 'RET')]),
    ('iknife-cube-undo-segment', 'cube', VIEW_TOP, [
        ('click', (-1.0, 0.3, 1.0), (0, 0)), ('click', (0.2, -1.0, 1.0), (0, 0)),
        ('click', (1.0, 0.4, 1.0), (0, 0)),
        ('press', 'LEFT_CTRL'), ('tap', 'Z'), ('release', 'LEFT_CTRL'),
        ('click', (0.5, 1.0, 1.0), (0, 0)), ('tap', 'RET')]),
    ('iknife-cube-ignore-snap', 'cube', VIEW_TOP, [
        ('press', 'LEFT_CTRL'),
        ('click', (1.0, 1.0, 1.0), (-6, -4)), ('click', (-0.3, -1.0, 1.0), (0, 0)),
        ('release', 'LEFT_CTRL'), ('tap', 'RET')]),
    ('iknife-cube-new-cut', 'cube', VIEW_TOP, [
        ('click', (-1.0, 0.6, 1.0), (0, 0)), ('click', (1.0, 0.6, 1.0), (0, 0)),
        ('tap', 'RIGHTMOUSE'),
        ('click', (-1.0, -0.6, 1.0), (0, 0)), ('click', (1.0, -0.5, 1.0), (0, 0)), ('tap', 'RET')]),
    ('iknife-cube-axis-x', 'cube', VIEW_TOP, [
        ('click', (-1.0, 0.25, 1.0), (0, 0)), ('tap', 'X'),
        ('move', (0.6, 0.55, 1.0), (0, 0)), ('click', (0.6, 0.55, 1.0), (0, 0)), ('tap', 'RET')]),
    ('iknife-cube-angle-snap', 'cube', VIEW_TOP, [
        ('click', (-1.0, -0.2, 1.0), (0, 0)), ('tap', 'A'),
        ('move', (0.7, 0.9, 1.0), (0, 0)), ('click', (0.7, 0.9, 1.0), (0, 0)), ('tap', 'RET')]),
    ('iknife-cube-drag', 'cube', VIEW_TOP, [
        ('drag', [(-1.3, 0.2, 1.0), (-0.5, 0.0, 1.0), (0.2, 0.1, 1.0), (0.8, -0.2, 1.0), (1.3, -0.3, 1.0)]),
        ('tap', 'RET')]),
    ('iknife-cube-persp-two-faces', 'cube', VIEW_ISO, [
        ('click', (-1.0, 0.2, 1.0), (0, 0)), ('click', (0.3, -1.0, 1.0), (0, 0)),
        ('click', (0.6, -1.0, -0.5), (0, 0)), ('tap', 'RET')]),
    ('iknife-grid-zigzag', 'grid', VIEW_TOP, [
        ('click', (-1.0, -0.8, 0.0), (0, 0)), ('click', (-0.2, 0.7, 0.0), (0, 0)),
        ('click', (0.4, -0.6, 0.0), (0, 0)), ('click', (1.0, 0.9, 0.0), (0, 0)), ('tap', 'RET')]),
    ('iknife-cube-along-edge', 'cube', VIEW_TOP, [
        ('click', (1.0, 1.0, 1.0), (0, 0)), ('click', (1.0, -1.0, 1.0), (0, 0)),
        ('click', (-1.0, -1.0, 1.0), (0, 0)), ('tap', 'RET')]),
]


# Bisect drags (`MESH_OT_bisect` invoked without a plane: the straight-line gesture, then
# `mesh_bisect_interactive_calc`). name, mesh, view, view_location, drag start, drag end (world points).
BISECT_CASES = [
    ('ibisect-cube-top-ortho', 'cube', VIEW_TOP, (0.0, 0.0, 0.0), (-1.6, -0.9, 1.0), (1.4, 1.1, 1.0)),
    ('ibisect-cube-iso-persp', 'cube', VIEW_ISO, (0.0, 0.0, 0.0), (-1.8, 0.4, 0.3), (1.6, -0.6, 0.1)),
    ('ibisect-cube-iso-offset-pivot', 'cube', VIEW_ISO, (0.4, -0.3, 0.2), (-1.5, 1.2, 0.6), (1.2, -1.5, -0.4)),
    ('ibisect-grid-top-ortho', 'grid', VIEW_TOP, (0.0, 0.0, 0.0), (-1.3, 0.35, 0.0), (1.2, -0.45, 0.0)),
]


def make_mesh(kind):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    if kind == 'cube':
        bpy.ops.mesh.primitive_cube_add(size=2.0)
    elif kind == 'grid':
        bpy.ops.mesh.primitive_grid_add(x_subdivisions=3, y_subdivisions=3, size=2.0)
    return bpy.context.active_object


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


def view_json(space, region, r3d):
    return {
        'persp': r3d.view_perspective,
        'is_persp': r3d.is_perspective,
        'winx': region.width, 'winy': region.height,
        'clip_start': space.clip_start, 'clip_end': space.clip_end,
        'persmat': [list(r) for r in r3d.perspective_matrix],
        'viewmat': [list(r) for r in r3d.view_matrix],
        'winmat': [list(r) for r in r3d.window_matrix],
    }


def run_case(case, results):
    name, mesh, view, actions = case
    ob = make_mesh(mesh)
    win, area, region, space = find_view()
    r3d = space.region_3d
    r3d.view_perspective = view['persp']
    r3d.view_rotation = view['rot']
    r3d.view_location = (0.0, 0.0, 0.0)
    r3d.view_distance = view['dist']
    # See gen-knife-bisect-fixtures.py: a 0.01 near plane makes Blender's float32 pick ray noisy.
    space.clip_start = 0.5 if view['persp'] == 'PERSP' else 0.01
    space.clip_end = 1000.0
    fx = {'name': name, 'kind': 'knife-interactive', 'blender': bpy.app.version_string, 'mesh': mesh}
    fx['input'] = dump_mesh(ob)
    with bpy.context.temp_override(window=win, area=area, region=region):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.wm.redraw_timer(type='DRAW_WIN_SWAP', iterations=1)
    fx['view'] = view_json(space, region, r3d)
    prefs = bpy.context.preferences
    # `UI_SCALE_FAC` (`U.scale_factor`): the knife's snap distances are `KMAXDIST = 10 * UI_SCALE_FAC`.
    fx['ui_scale_fac'] = prefs.system.dpi * prefs.system.pixel_size / 72.0

    def px(p, off=(0, 0)):
        s = location_3d_to_region_2d(region, r3d, Vector(p))
        return int(round(s.x)) + off[0], int(round(s.y)) + off[1]

    events = []

    def ev(type, value, rx, ry, **mods):
        events.append({'type': type, 'value': value, 'mval': [rx, ry], **mods})
        return dict(type=type, value=value, x=rx + region.x, y=ry + region.y, **mods)

    first = next(a for a in actions if a[0] in ('click', 'move', 'drag'))
    cur = px(first[1] if first[0] != 'drag' else first[1][0])
    mods = {'shift': False, 'ctrl': False}
    yield dict(type='MOUSEMOVE', value='NOTHING', x=cur[0] + region.x, y=cur[1] + region.y)
    with bpy.context.temp_override(window=win, area=area, region=region, screen=win.screen):
        r = bpy.ops.mesh.knife_tool('INVOKE_DEFAULT', use_occlude_geometry=True, only_selected=False)
    if r != {'RUNNING_MODAL'}:
        raise RuntimeError('knife did not start: %r' % (r,))
    for act in actions:
        kind = act[0]
        if kind in ('move', 'click'):
            p = px(act[1], act[2])
            cur = p
            yield ev('MOUSEMOVE', 'NOTHING', p[0], p[1], **mods)
            if kind == 'click':
                yield ev('LEFTMOUSE', 'PRESS', p[0], p[1], **mods)
                yield ev('LEFTMOUSE', 'RELEASE', p[0], p[1], **mods)
        elif kind == 'drag':
            pts = [px(q) for q in act[1]]
            yield ev('MOUSEMOVE', 'NOTHING', pts[0][0], pts[0][1], **mods)
            yield ev('LEFTMOUSE', 'PRESS', pts[0][0], pts[0][1], **mods)
            for a, b in zip(pts, pts[1:]):
                # Several moves per leg, as a real drag delivers them.
                for i in range(1, 5):
                    q = (round(a[0] + (b[0] - a[0]) * i / 4), round(a[1] + (b[1] - a[1]) * i / 4))
                    yield ev('MOUSEMOVE', 'NOTHING', q[0], q[1], **mods)
            cur = pts[-1]
            yield ev('LEFTMOUSE', 'RELEASE', cur[0], cur[1], **mods)
        elif kind in ('press', 'release', 'tap'):
            key = act[1]
            if kind in ('press', 'tap'):
                if key == 'LEFT_SHIFT':
                    mods['shift'] = True
                if key == 'LEFT_CTRL':
                    mods['ctrl'] = True
                yield ev(key, 'PRESS', cur[0], cur[1], **mods)
            if kind in ('release', 'tap'):
                if key == 'LEFT_SHIFT':
                    mods['shift'] = False
                if key == 'LEFT_CTRL':
                    mods['ctrl'] = False
                yield ev(key, 'RELEASE', cur[0], cur[1], **mods)
    # Let the operator finish, then read the mesh back.
    yield dict(type='MOUSEMOVE', value='NOTHING', x=cur[0] + region.x, y=cur[1] + region.y)
    with bpy.context.temp_override(window=win, area=area, region=region):
        bpy.ops.object.mode_set(mode='OBJECT')
    fx['events'] = events
    fx['output'] = dump_mesh(ob)
    results.append(fx)


def run_bisect_case(case, results):
    name, mesh, view, location, a, b = case
    ob = make_mesh(mesh)
    win, area, region, space = find_view()
    r3d = space.region_3d
    r3d.view_perspective = view['persp']
    r3d.view_rotation = view['rot']
    r3d.view_location = location
    r3d.view_distance = view['dist']
    space.clip_start = 0.5 if view['persp'] == 'PERSP' else 0.01
    space.clip_end = 1000.0
    fx = {'name': name, 'kind': 'bisect-interactive', 'blender': bpy.app.version_string, 'mesh': mesh}
    fx['input'] = dump_mesh(ob)
    with bpy.context.temp_override(window=win, area=area, region=region):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.wm.redraw_timer(type='DRAW_WIN_SWAP', iterations=1)
    fx['view'] = view_json(space, region, r3d)
    # `rv3d->ofs` is the negated `view_location`.
    fx['view_location'] = list(r3d.view_location)

    def px(p):
        s = location_3d_to_region_2d(region, r3d, Vector(p))
        return int(round(s.x)), int(round(s.y))

    pa, pb = px(a), px(b)
    yield dict(type='MOUSEMOVE', value='NOTHING', x=pa[0] + region.x, y=pa[1] + region.y)
    with bpy.context.temp_override(window=win, area=area, region=region, screen=win.screen):
        r = bpy.ops.mesh.bisect('INVOKE_DEFAULT')
    if r != {'RUNNING_MODAL'}:
        raise RuntimeError('bisect did not start: %r' % (r,))
    yield dict(type='MOUSEMOVE', value='NOTHING', x=pa[0] + region.x, y=pa[1] + region.y)
    yield dict(type='LEFTMOUSE', value='PRESS', x=pa[0] + region.x, y=pa[1] + region.y)
    for i in range(1, 7):
        q = (round(pa[0] + (pb[0] - pa[0]) * i / 6), round(pa[1] + (pb[1] - pa[1]) * i / 6))
        yield dict(type='MOUSEMOVE', value='NOTHING', x=q[0] + region.x, y=q[1] + region.y)
    yield dict(type='LEFTMOUSE', value='RELEASE', x=pb[0] + region.x, y=pb[1] + region.y)
    yield dict(type='MOUSEMOVE', value='NOTHING', x=pb[0] + region.x, y=pb[1] + region.y)
    op = bpy.context.window_manager.operators[-1]
    if op.bl_idname != 'MESH_OT_bisect':
        raise RuntimeError('last operator is %s' % op.bl_idname)
    p = op.properties
    fx['props'] = {
        'xstart': p.xstart, 'ystart': p.ystart, 'xend': p.xend, 'yend': p.yend, 'flip': p.flip,
        'plane_co': list(p.plane_co), 'plane_no': list(p.plane_no), 'threshold': p.threshold,
        'use_fill': p.use_fill, 'clear_inner': p.clear_inner, 'clear_outer': p.clear_outer,
    }
    with bpy.context.temp_override(window=win, area=area, region=region):
        bpy.ops.object.mode_set(mode='OBJECT')
    fx['output'] = dump_mesh(ob)
    results.append(fx)


def main_iter(report):
    os.makedirs(OUT, exist_ok=True)
    for case in BISECT_CASES:
        results = []
        try:
            yield from run_bisect_case(case, results)
            fx = results[0]
            with open(os.path.join(OUT, case[0] + '.json'), 'w') as f:
                json.dump(fx, f, indent=1)
            report.append('ok %s faces=%d' % (case[0], len(fx['output']['faces'])))
        except Exception:
            report.append('FAIL %s\n%s' % (case[0], traceback.format_exc()))
            yield dict(type='ESC', value='PRESS', x=10, y=10)
            yield dict(type='ESC', value='RELEASE', x=10, y=10)
    for case in CASES:
        results = []
        try:
            yield from run_case(case, results)
            fx = results[0]
            with open(os.path.join(OUT, case[0] + '.json'), 'w') as f:
                json.dump(fx, f, indent=1)
            report.append('ok %s faces=%d' % (case[0], len(fx['output']['faces'])))
        except Exception:
            report.append('FAIL %s\n%s' % (case[0], traceback.format_exc()))
            # Leave edit mode / modal state behind for the next case.
            yield dict(type='ESC', value='PRESS', x=10, y=10)
            yield dict(type='ESC', value='RELEASE', x=10, y=10)


report = []
it = main_iter(report)


def step():
    win = bpy.context.window_manager.windows[0]
    try:
        val = next(it)
    except StopIteration:
        print('FIXTURE_REPORT\n' + '\n'.join(report))
        sys.stdout.flush()
        bpy.app.use_event_simulate = False
        bpy.ops.wm.quit_blender()
        return None
    win.event_simulate(**val)
    return 0.0


bpy.context.preferences.view.smooth_view = 0
bpy.app.timers.register(step, first_interval=1.0, persistent=True)

/**
 * Ground-truth parity for the knife (`src/ops/knife/`) and bisect (`src/ops/bisectPlane.ts`) ports
 * against Blender itself.
 *
 * Every case in `fixtures/knife-bisect/` was written by Blender 3.4.1 running
 * `fixtures/gen-knife-bisect-fixtures.py`: the input mesh as edit mode sees it, the operator's inputs and
 * the mesh Blender produced.
 * - Knife cases run `bpy.ops.mesh.knife_project`, Blender's non-interactive knife (`EDBM_mesh_knife`):
 *   the same line-hit, cut and edge-net code as the interactive tool, with snapping off. They carry the
 *   3D view's matrices and region size, and the screen polylines Blender cut along.
 * - Bisect cases run `bpy.ops.mesh.bisect` with the plane given (`mesh_bisect_exec`).
 *
 * The input is rebuilt the way `BM_mesh_bm_from_me` builds edit mode's BMesh - vertices, then edges in
 * Blender's edge order, then faces over those edges - so disk-cycle order, which the edge-net walk
 * reads, is Blender's. The comparison is order-free: Blender's vertex order is not even stable across
 * its own runs (it iterates pointer-keyed maps when splitting edges), so vertices are paired by
 * position (1e-4, Blender being float32 and the fixture rounded to 6 places), faces compared as cyclic
 * vertex sequences (which checks winding), and the edge sets compared as vertex pairs.
 */

import {describe, expect, it} from 'vitest'
import {BMesh} from '../src/bmesh/BMesh'
import {BMEdge} from '../src/bmesh/types'
import {selectAll} from '../src/bmesh/marking'
import {KMAXDIST, KnifeEvent, knifeProject, KnifeTool} from '../src/ops/knife/knife'
import {bisectSelection} from '../src/ops/bisectPlane'
import {triangleFill} from '../src/ops/triangleFill'
import {faceAttributeFill} from '../src/ops/faceAttributeFill'
import {buildFromBlender, compareMeshes, dumpMesh, Fixture, fixtures, fixtureView, interactiveFixtures, RecordedEvent, faceFindNearestCpu} from './knifeBisectFixtures'

function runKnife(fx: Fixture): BMesh {
    const bm = buildFromBlender(fx.input)
    selectAll(bm)
    knifeProject(bm, fixtureView(fx), fx.polys! as [number, number][][], {cutThrough: fx.cut_through, useTag: true})
    return bm
}

/** `mesh_bisect_exec`'s fill: `triangle_fill use_dissolve=true` then `face_attribute_fill`. */
function bisectFill(bm: BMesh, edges: BMEdge[], normal: [number, number, number]) {
    const filled = triangleFill(bm, edges, {normal, useDissolve: true})
    faceAttributeFill(bm, filled.faces, {useNormals: true, useData: true})
    return filled.faces
}

function runBisect(fx: Fixture): BMesh {
    const bm = buildFromBlender(fx.input)
    selectAll(bm)
    bisectSelection(bm, {
        planeCo: fx.plane_co as [number, number, number], planeNo: fx.plane_no as [number, number, number],
        clearInner: fx.clear_inner, clearOuter: fx.clear_outer, useFill: fx.use_fill, threshold: fx.threshold,
    }, bisectFill)
    return bm
}

/**
 * A recorded event through Blender's Knife Tool Modal Map (`blender_default.py:6404`), as
 * `wm_event_modalkeymap` turns it into a modal item: LMB (any modifiers) is ADD_CUT with the press or
 * release in `prev_val`, Shift/Ctrl press and release toggle midpoint snap and ignore-snap, Ctrl+Z is
 * UNDO while a bare Z is the Z axis lock, and so on. Unmapped events (key releases) reach the modal as
 * plain events and change nothing, so they are dropped.
 */
function toKnifeEvent(e: RecordedEvent): KnifeEvent | null {
    const mval = e.mval
    if (e.type === 'MOUSEMOVE') return {type: 'mousemove', mval}
    const press = e.value === 'PRESS'
    const modal = (item: Extract<KnifeEvent, {type: 'modal'}>['item'], release = false): KnifeEvent => ({type: 'modal', item, release, mval})
    switch (e.type) {
    case 'LEFTMOUSE': return modal('ADD_CUT', !press)
    case 'LEFT_SHIFT': case 'RIGHT_SHIFT': return modal(press ? 'SNAP_MIDPOINTS_ON' : 'SNAP_MIDPOINTS_OFF')
    case 'LEFT_CTRL': case 'RIGHT_CTRL': return modal(press ? 'IGNORE_SNAP_ON' : 'IGNORE_SNAP_OFF')
    }
    if (!press) return null
    const bare = !e.ctrl && !e.shift
    switch (e.type) {
    case 'ESC': return modal('CANCEL')
    case 'RET': case 'NUMPAD_ENTER': case 'SPACE': return modal('CONFIRM')
    case 'RIGHTMOUSE': return bare ? modal('NEW_CUT') : null
    case 'Z': return e.ctrl && !e.shift ? modal('UNDO') : bare ? modal('Z_AXIS') : null
    case 'X': return bare ? modal('X_AXIS') : null
    case 'Y': return bare ? modal('Y_AXIS') : null
    case 'A': return bare ? modal('ANGLE_SNAP_TOGGLE') : null
    case 'R': return bare ? modal('CYCLE_ANGLE_SNAP_EDGE') : null
    case 'C': return bare ? modal('CUT_THROUGH_TOGGLE') : null
    case 'S': return bare ? modal('SHOW_DISTANCE_ANGLE_TOGGLE') : null
    case 'V': return bare ? modal('DEPTH_TEST_TOGGLE') : null
    }
    return null
}

/** Replay a recorded session into `KnifeTool.modal`, as `MESH_OT_knife_tool` ran it in Blender. */
function runKnifeInteractive(fx: Fixture): BMesh {
    const bm = buildFromBlender(fx.input)
    selectAll(bm)
    // `knifetool_invoke`: use_occlude_geometry=True, only_selected=False, xray default.
    const view = fixtureView(fx)
    const kcd = new KnifeTool(bm, {
        view, cutThrough: false, onlySelect: false, isInteractive: true, uiScale: fx.ui_scale_fac,
        // `EDBM_face_find_nearest(&vc, &dist)` with `dist = KMAXDIST` (`:3088`, `:3108`).
        findNearestFace: faceFindNearestCpu(bm, view, KMAXDIST * (fx.ui_scale_fac ?? 1)),
    })
    for (const e of fx.events!) {
        const ev = toKnifeEvent(e)
        if (!ev) continue
        const status = kcd.modal(ev)
        if (status === 'finished' || status === 'cancelled') break
    }
    return bm
}

describe('interactive knife matches Blender', () => {
    it('has the fixtures', () => {
        expect(interactiveFixtures.length).toBeGreaterThanOrEqual(15)
    })
    for (const fx of interactiveFixtures) {
        it(`${fx.name} (Blender ${fx.blender})`, () => {
            const bm = runKnifeInteractive(fx)
            expect(bm.validate()).toEqual([])
            expect(compareMeshes(dumpMesh(bm), fx.output)).toEqual([])
        })
    }
})

describe('knife and bisect match Blender', () => {
    it('has the fixtures', () => {
        expect(fixtures.filter(f => f.kind === 'knife').length).toBeGreaterThanOrEqual(10)
        expect(fixtures.filter(f => f.kind === 'bisect').length).toBeGreaterThanOrEqual(10)
    })
    for (const fx of fixtures) {
        it(`${fx.name} (Blender ${fx.blender})`, () => {
            const bm = fx.kind === 'knife' ? runKnife(fx) : runBisect(fx)
            expect(bm.validate()).toEqual([])
            expect(compareMeshes(dumpMesh(bm), fx.output)).toEqual([])
        })
    }
})

/**
 * The modal transform against values worked from Blender's `editors/transform/` sources.
 *
 * The view is an orthographic camera 8 units wide over an 800x600 region looking down -Z, so
 * `ED_view3d_win_to_delta` has a closed form (1 px = 0.01 units) and every expected number below can
 * be derived by hand from the cited functions.
 */

import {describe, expect, it} from 'vitest'
import {OrthographicCamera, PerspectiveCamera} from 'three'
import {
    BMesh,
    bmFromMesh,
    ElemFlag,
    faceSelectSet,
    primitiveCube,
    selectAll,
    selectHistoryStore,
    selectModeSet,
    SelectMode,
    selectNone,
    vertSelectSet,
} from '@threepipe/mesh-kernel'
import {TransformView} from '../src/transform/view'
import {ModalTransform, ModalTransformOptions} from '../src/transform'
import {
    applyNumInput,
    calcFloatPrecision,
    evaluateExpression,
    handleNumInput,
    hasNumInput,
    initNumInput,
    NUM_AFFECT_ALL,
    NUM_NULL_ONE,
    NumInput,
    outputNumInput,
} from '../src/transform/numinput'
import {applyMouseInput, initMouseInput, initMouseInputMode, MouseInput} from '../src/transform/input'
import {CON_AXIS0, CON_AXIS2, T_PROP_EDIT} from '../src/transform/types'
import {SnapContext} from '../src/snap/snap'
import {snapTargetFromBMesh, snapTargetFromGeometry} from '../src/snap/targets'
import {getTransformOrientationMatrix} from '../src/transform/orientation'
import {meshNormalsUpdate} from '../src/transform/bmeshQuery'
import {TransInfo} from '../src/transform/TransInfo'
import {geodesicDistancePropagateAcrossTriangle} from '../src/transform/math'
import {propFalloffText} from '../src/transform/proportional'

// region fixtures

/** An orthographic view 8 units wide over 800x600 px, looking down -Z from z = 10. */
function orthoView(): TransformView {
    const cam = new OrthographicCamera(-4, 4, 3, -3, 0.1, 100)
    cam.position.set(0, 0, 10)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld(true)
    cam.updateProjectionMatrix()
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert()
    return TransformView.fromCamera(cam, 800, 600)
}

function perspView(): TransformView {
    const cam = new PerspectiveCamera(90, 800 / 600, 0.1, 100)
    cam.position.set(0, 0, 10)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld(true)
    cam.updateProjectionMatrix()
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert()
    return TransformView.fromCamera(cam, 800, 600)
}

/** Blender's default cube: vertices at +-1. */
function cube(): BMesh {
    return bmFromMesh(primitiveCube())
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function start(bm: BMesh, mode: 'translate' | 'rotate' | 'resize', extra: Partial<ModalTransformOptions> = {}, view = orthoView()): ModalTransform {
    return new ModalTransform({
        mode,
        view,
        // Region pixels, y up: the pivot (0, 0, 0) projects to the centre (400, 300).
        mval: [500, 300],
        around: 'median',
        orientation: 'global',
        bm,
        objectMatrix: IDENTITY,
        random: () => 0.5,
        ...extra,
    })
}

function verts(bm: BMesh): [number, number, number][] {
    return [...bm.verts].map(v => [v.x, v.y, v.z])
}

function vertAt(bm: BMesh, x: number, y: number, z: number) {
    return [...bm.verts].find(v => Math.abs(v.x - x) < 1e-6 && Math.abs(v.y - y) < 1e-6 && Math.abs(v.z - z) < 1e-6)!
}

function expectV(actual: ArrayLike<number>, expected: number[], digits = 6): void {
    for (let i = 0; i < expected.length; i++) expect(actual[i]).toBeCloseTo(expected[i], digits)
}

function key(k: string, mods: {shift?: boolean, ctrl?: boolean, alt?: boolean} = {}) {
    const code = k.length === 1 && k >= '0' && k <= '9' ? 'Digit' + k
        : k.length === 1 && /[a-z]/i.test(k) ? 'Key' + k.toUpperCase()
            : k === '.' ? 'Period' : k === '-' ? 'Minus' : k === '/' ? 'Slash' : k === '=' ? 'Equal' : k
    return {key: k, code, ctrl: !!mods.ctrl, shift: !!mods.shift, alt: !!mods.alt, press: true}
}

// endregion

describe('TransformView (view3d_project.cc)', () => {
    it('ED_view3d_win_to_delta: 80 px is 0.8 units in an 8-unit-wide orthographic view', () => {
        const view = orthoView()
        expectV(view.winToDelta(80, 0, view.calcZfac([0, 0, 0])), [0.8, 0, 0])
        expectV(view.winToDelta(0, 60, view.calcZfac([0, 0, 0])), [0, 0.6, 0])
        expectV(view.projectFloatViewOrCenter([0, 0, 0]), [400, 300])
        expectV(view.projectFloatViewOrCenter([1, 1, 0]), [500, 400])
    })

    it('scales a pixel delta by the depth factor in perspective (ED_view3d_calc_zfac)', () => {
        const view = perspView()
        // At distance 10 with a 90 degree vertical fov, the view is 20 units tall: 600 px -> 20 units.
        const zfac = view.calcZfac([0, 0, 0])
        expectV(view.winToDelta(0, 600, zfac), [0, 20, 0], 4)
        expectV(view.winToDelta(800, 0, zfac), [20 * 800 / 600, 0, 0], 4)
        // Twice as close, half the size.
        const near = view.calcZfac([0, 0, 5])
        expectV(view.winToDelta(0, 600, near), [0, 10, 0], 4)
    })

    it('view_vector_calc: towards the viewer', () => {
        expectV(orthoView().viewVector([3, 2, 0]), [0, 0, 1])
        expectV(perspView().viewVector([0, 0, 0]), [0, 0, 1])
    })
})

describe('NumInput (numinput.cc)', () => {
    function num(idxMax = 0): NumInput {
        const n = new NumInput()
        initNumInput(n)
        n.idxMax = idxMax
        return n
    }

    it('types a decimal and applies it', () => {
        const n = num()
        for (const k of ['1', '.', '5']) expect(handleNumInput(n, key(k))).toBe(true)
        expect(hasNumInput(n)).toBe(true)
        const v = [0]
        expect(applyNumInput(n, v)).toBe(true)
        expect(v[0]).toBe(1.5)
        expect(outputNumInput(n)[0]).toBe('[1.5|] = 1.5')
    })

    it('rejects letters in simple mode, so modal keys still work', () => {
        const n = num()
        expect(handleNumInput(n, key('x'))).toBe(false)
        expect(hasNumInput(n)).toBe(false)
    })

    it('- negates and / inverts (NUM_NEGATE, NUM_INVERSE)', () => {
        const n = num()
        handleNumInput(n, key('4'))
        handleNumInput(n, key('-'))
        expect(n.val[0]).toBe(-4)
        handleNumInput(n, key('/'))
        expect(n.val[0]).toBe(-0.25)
        expect(outputNumInput(n)[0]).toBe('[-1/(4|)] = -0.25')
    })

    it('Tab moves to the next value, so "1 Tab 2" is (1, 2, 0)', () => {
        const n = num(2)
        handleNumInput(n, key('1'))
        handleNumInput(n, key('Tab'))
        expect(n.idx).toBe(1)
        handleNumInput(n, key('2'))
        const v = [0, 0, 0]
        applyNumInput(n, v)
        expect(v).toEqual([1, 2, 0])
    })

    it('NUM_AFFECT_ALL + NUM_NULL_ONE spread one typed value over every axis (resize)', () => {
        const n = num(2)
        n.flag |= NUM_AFFECT_ALL
        n.valFlag = [NUM_NULL_ONE, NUM_NULL_ONE, NUM_NULL_ONE]
        handleNumInput(n, key('2'))
        const v = [1, 1, 1]
        applyNumInput(n, v)
        expect(v).toEqual([2, 2, 2])
    })

    it('= enters full editing where expressions are evaluated', () => {
        const n = num()
        expect(handleNumInput(n, key('='))).toBe(true)
        for (const k of ['2', '*', 'p', 'i', '/', '4']) handleNumInput(n, key(k))
        expect(n.val[0]).toBeCloseTo(Math.PI / 2, 9)
        expect(evaluateExpression('(1+sqrt(4))^2')).toBe(9)
        expect(evaluateExpression('2**3')).toBe(8)
        expect(evaluateExpression('1+')).toBeNull()
    })

    it('rotation input is degrees unless radians are typed (user_string_to_number)', () => {
        const n = num()
        n.unitType = ['rotation', 'none', 'none']
        handleNumInput(n, key('9'))
        handleNumInput(n, key('0'))
        expect(n.val[0]).toBeCloseTo(Math.PI / 2, 9)
        expect(n.valNoUnits[0]).toBe(90)
        const r = num()
        r.unitType = ['rotation', 'none', 'none']
        handleNumInput(r, key('='))
        for (const k of ['1', 'r']) handleNumInput(r, key(k))
        expect(r.val[0]).toBe(1)
        expect(outputNumInput(n)[0]).toBe('[90|] = 90°')
    })

    it('Backspace with nothing typed resets to the original value (NUM_FAKE_EDITED)', () => {
        const n = num()
        const v = [0.37]
        applyNumInput(n, v) // stores val_org
        expect(handleNumInput(n, key('Backspace'))).toBe(true)
        expect(hasNumInput(n)).toBe(true)
        const out = [0]
        applyNumInput(n, out)
        expect(out[0]).toBe(0.37)
    })

    it('calc_float_precision shows small values', () => {
        expect(calcFloatPrecision(2, 0.00001)).toBeGreaterThan(2)
        expect(calcFloatPrecision(2, 10.0001)).toBe(2)
    })
})

describe('MouseInput (transform_input.cc)', () => {
    it('InputSpringFlip: distance ratio to the pivot, negative past it', () => {
        const mi = new MouseInput()
        initMouseInput(mi, [100, 100], [200, 100], false)
        initMouseInputMode(mi, 'springFlip')
        expect(mi.factor).toBe(100)
        const ctx = {convertViewVec: () => [0, 0, 0] as [number, number, number]}
        expect(applyMouseInput(ctx, mi, [300, 100])[0]).toBe(2)
        expect(applyMouseInput(ctx, mi, [150, 100])[0]).toBe(0.5)
        expect(applyMouseInput(ctx, mi, [0, 100])[0]).toBe(-1)
    })

    it('InputAngle accumulates the swept angle about the pivot and stays continuous past 180', () => {
        const mi = new MouseInput()
        initMouseInput(mi, [0, 0], [1, 0], false)
        initMouseInputMode(mi, 'angle')
        const ctx = {convertViewVec: () => [0, 0, 0] as [number, number, number]}
        // Counter-clockwise on screen (y up) is negative, Blender's sign.
        expect(applyMouseInput(ctx, mi, [0, 1])[0]).toBeCloseTo(-Math.PI / 2, 9)
        expect(applyMouseInput(ctx, mi, [-1, 0])[0]).toBeCloseTo(-Math.PI, 9)
        expect(applyMouseInput(ctx, mi, [0, -1])[0]).toBeCloseTo(-1.5 * Math.PI, 9)
    })

    it('precision moves a virtual cursor at a tenth of the real one (applyMouseInput)', () => {
        const mi = new MouseInput()
        initMouseInput(mi, [0, 0], [0, 0], false)
        initMouseInputMode(mi, 'vector')
        const ctx = {convertViewVec: (dx: number, dy: number) => [dx, dy, 0] as [number, number, number]}
        expectV(applyMouseInput(ctx, mi, [100, 0]), [100, 0, 0])
        mi.precision = true
        expectV(applyMouseInput(ctx, mi, [200, 0]), [110, 0, 0])
        mi.precision = false
        // Letting go of Shift never jumps: the accumulated offset stays.
        expectV(applyMouseInput(ctx, mi, [300, 0]), [210, 0, 0])
    })
})

describe('translate (transform_mode_translate.cc)', () => {
    it('moves the selection by the screen delta converted at the pivot depth', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'translate')
        t.setMousePosition(580, 360)
        const moved = verts(bm)
        expect(moved.every(v => Math.abs(Math.abs(v[0] - 0.8) - 1) < 1e-6)).toBe(true)
        expect(moved.every(v => Math.abs(Math.abs(v[1] - 0.6) - 1) < 1e-6)).toBe(true)
        expect(t.status).toBe('Dx:  0.8000   Dy:  0.6000   Dz:  0.0000 (1.0000)')
        t.cancel()
        expect(verts(bm).every(v => Math.abs(Math.abs(v[0]) - 1) < 1e-9)).toBe(true)
    })

    it('axisProjection: a Y constraint keeps only the motion that reads as Y on screen', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'translate')
        t.setAxis(1)
        expect(t.t.con.text).toBe(' along global Y')
        t.setMousePosition(580, 360)
        const v = vertAt(bm, 1, 1.6, 1)
        expect(v).toBeDefined()
        expect(verts(bm).every(p => Math.abs(Math.abs(p[0]) - 1) < 1e-9)).toBe(true)
        expect(t.status).toBe('D:  0.6000 (0.6000) along global Y')
    })

    it('a plane constraint drops the locked axis (Shift+Z)', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'translate')
        t.setAxis(2, true)
        expect(t.t.con.text).toBe(' locking global Z')
        t.setMousePosition(580, 360)
        expect(vertAt(bm, 1.8, 1.6, 1)).toBeDefined()
    })

    it('pressing the axis key again cycles global, local, off (transform_event_modal_constraint)', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'translate')
        t.setAxis(0)
        expect(t.t.con.text).toBe(' along global X')
        t.setAxis(0)
        expect(t.t.con.text).toBe(' along local X')
        t.setAxis(0)
        expect(t.t.con.text).toBe('')
        expect(t.t.con.mode & 1).toBe(0)
    })

    it('typed numbers are exact: G 2 Tab 3', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'translate')
        t.setMousePosition(700, 500)
        for (const k of ['2', 'Tab', '3']) t.handleNumericKey(k)
        expect(vertAt(bm, 3, 4, 1)).toBeDefined()
        expect(t.status).toBe('Dx: 2   Dy: [3|] = 3   Dz: NONE (3.6056)')
        t.confirm()
        expect(t.isDone).toBe(true)
    })

    it('a typed number under a constraint goes along that axis', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'translate')
        t.setAxis(2)
        t.handleNumericKey('5')
        expect(vertAt(bm, 1, 1, 6)).toBeDefined()
        expect(t.status).toBe('D: [5|] = 5 (5.0000) along global Z')
    })

    it('Shift precision moves a tenth as far', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'translate')
        t.precision = true
        t.setMousePosition(580, 300)
        expect(vertAt(bm, 1.08, 1, 1)).toBeDefined()
        expect(t.status).toBe('Dx:  0.080000   Dy:  0.000000   Dz:  0.000000 (0.080000)')
    })

    it('Ctrl snaps to the grid step, which is zoom dependent in an axis view (ED_view3d_grid_view_scale)', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'translate')
        // 12 / (800 * 0.25) = 0.06, so the step is the first grid level above: 0.1.
        expect(t.t.snapSpatial[0]).toBe(0.1)
        t.handleModal('snapInvOn')
        t.setMousePosition(583, 300)
        expect(vertAt(bm, 1.8, 1, 1)).toBeDefined()
        t.handleModal('snapInvOff')
        expect(vertAt(bm, 1.83, 1, 1)).toBeDefined()
    })

    it('increments are 1 unit in perspective and 0.1 with precision (transform_snap_increment)', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'translate', {snap: {enabled: true}}, perspView())
        expect(t.t.snapSpatial[0]).toBe(1)
        // 800 px span 26.67 units at the pivot depth: 69 px is 2.3 units, which rounds to 2.
        t.setMousePosition(569, 300)
        expect(vertAt(bm, 3, 1, 1)).toBeDefined()
        t.precision = true
        // Precision steps are a tenth: the virtual cursor is now at 2.3 + 0.1 * 0.333.
        t.setMousePosition(579, 300)
        expect(t.t.valuesFinal[0]).toBeCloseTo(2.3, 9)
    })

    it('MMB picks the axis the cursor moves along (setNearestAxis3d), Shift+MMB the plane', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'translate')
        t.handleModal('autoConstraint')
        t.setMousePosition(500, 360)
        expect(t.t.con.text).toBe(' along global Y axis')
        t.handleModal('autoConstraint') // release confirms the pick
        t.setMousePosition(580, 360)
        expect(vertAt(bm, 1, 1.6, 1)).toBeDefined()
        expect(verts(bm).every(p => Math.abs(Math.abs(p[0]) - 1) < 1e-9)).toBe(true)

        const t2 = start(cube(), 'translate')
        t2.handleModal('autoConstraintPlane')
        t2.setMousePosition(580, 300)
        expect(t2.t.con.text).toBe(' locking global X axis')
    })

    it('G then R switches mode from the same drag (TFM_MODAL_ROTATE)', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'translate')
        t.setMousePosition(500, 400)
        t.switchMode('rotate')
        expect(t.mode).toBe('rotate')
        // Positions were restored and the angle input re-applied from the press point: the cursor
        // is 45 degrees counter-clockwise from where the drag began, so the cube turns by that.
        expect(t.t.valuesFinal[0]).toBeCloseTo(-Math.PI / 4, 9)
        expect(vertAt(bm, 0, Math.SQRT2, 1)).toBeDefined()
    })
})

describe('rotate (transform_mode_rotate.cc)', () => {
    it('rotates about the pivot by the angle swept on screen, counter-clockwise for a counter-clockwise drag', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'rotate')
        // From the right of the pivot to above it: a quarter turn counter-clockwise on screen.
        t.setMousePosition(400, 400)
        expect(t.t.valuesFinal[0]).toBeCloseTo(-Math.PI / 2, 9)
        const v = vertAt(bm, -1, 1, 1)
        expect(v).toBeDefined()
        expect(t.status).toBe('Rotation: -90.00 ')
    })

    it('R 90 is an exact quadrant (axis_angle_normalized_to_mat3_with_quadrant)', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'rotate')
        t.setMousePosition(430, 330)
        for (const k of ['9', '0']) t.handleNumericKey(k)
        // The view axis points into the screen, so a positive angle turns clockwise: (1, 1) -> (1, -1).
        const v = [...bm.verts].find(p => p.x === 1 && p.y === -1 && p.z === 1)
        expect(v).toBeDefined()
        expect(t.status).toBe('Rotation: [90|] = 90° ')
    })

    it('a constrained axis rotates about it with the sign that matches the drag', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'rotate')
        t.setAxis(2)
        t.setMousePosition(400, 400)
        expect(t.t.valuesFinal[0]).toBeCloseTo(Math.PI / 2, 9)
        expect(vertAt(bm, -1, 1, 1)).toBeDefined()
        expect(t.status).toBe('Rotation: 90.00 along global Z ')
    })

    it('Ctrl snaps to 5 degree steps, 1 degree with Shift (initSnapAngleIncrements)', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'rotate')
        t.handleModal('snapInvOn')
        t.setMousePosition(500, 312)
        expect(t.t.valuesFinal[0] * 180 / Math.PI).toBeCloseTo(-5, 9)
        t.precision = true
        t.setMousePosition(500, 320)
        expect(t.t.valuesFinal[0] * 180 / Math.PI).toBeCloseTo(-7, 6)
    })
})

describe('resize (transform_mode_resize.cc)', () => {
    it('scales by the ratio of the cursor distances to the pivot, flipping past it', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'resize')
        t.setMousePosition(600, 300)
        expect(vertAt(bm, 2, 2, 2)).toBeDefined()
        expect(t.status).toBe('Scale X: 2.0000   Y: 2.0000  Z: 2.0000 ')
        t.setMousePosition(300, 300)
        expect(vertAt(bm, -1, -1, -1)).toBeDefined()
        expect(t.t.valuesFinal[0]).toBe(-1)
    })

    it('S X 2 scales one axis; the typed value spreads with NUM_AFFECT_ALL otherwise', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'resize')
        t.setAxis(0)
        t.handleNumericKey('2')
        expect(vertAt(bm, 2, 1, 1)).toBeDefined()
        expect(t.status).toBe('Scale: [2|] = 2 along global X ')
        t.clearConstraint()
        expect(vertAt(bm, 2, 2, 2)).toBeDefined()
    })

    it('Ctrl snaps the factor to 0.1 steps', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'resize')
        t.handleModal('snapInvOn')
        t.setMousePosition(603, 300)
        expect(t.t.valuesFinal[0]).toBeCloseTo(2, 9)
    })
})

describe('pivot (transform_generics.cc, transform_convert_mesh.cc)', () => {
    it('scales about the 3D cursor', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'resize', {around: 'cursor', cursor: [1, 1, 1]})
        expectV(t.pivot, [1, 1, 1])
        t.handleNumericKey('2')
        expect(vertAt(bm, -3, -3, -3)).toBeDefined()
        expect(vertAt(bm, 1, 1, 1)).toBeDefined()
    })

    it('bounds centre differs from the median for an uneven selection', () => {
        const bm = cube()
        selectNone(bm)
        const a = vertAt(bm, 1, 1, 1), b = vertAt(bm, -1, 1, 1), c = vertAt(bm, -1, -1, 1)
        for (const v of [a, b, c]) vertSelectSet(bm, v, true)
        expectV(start(bm, 'resize').pivot, [-1 / 3, 1 / 3, 1])
        expectV(start(bm, 'resize', {around: 'bounds'}).pivot, [0, 0, 1])
    })

    it('the active element is the pivot with "active"', () => {
        const bm = cube()
        selectNone(bm)
        const a = vertAt(bm, 1, 1, 1), b = vertAt(bm, -1, -1, 1)
        vertSelectSet(bm, a, true)
        vertSelectSet(bm, b, true)
        selectHistoryStore(bm, b)
        expectV(start(bm, 'resize', {around: 'active'}).pivot, [-1, -1, 1])
    })

    it('individual origins scale each island about its own centre', () => {
        const bm = cube()
        selectModeSet(bm, SelectMode.Face)
        selectNone(bm)
        const top = [...bm.faces].find(f => f.nz > 0.5 || [...f.eachLoop()].every(l => l.v.z === 1))!
        const bottom = [...bm.faces].find(f => [...f.eachLoop()].every(l => l.v.z === -1))!
        faceSelectSet(bm, top, true)
        faceSelectSet(bm, bottom, true)
        const t = start(bm, 'resize', {around: 'individual'})
        t.handleNumericKey('.')
        t.handleNumericKey('5')
        expect(vertAt(bm, 0.5, 0.5, 1)).toBeDefined()
        expect(vertAt(bm, -0.5, -0.5, -1)).toBeDefined()
    })
})

describe('orientation (transform_orientations.cc)', () => {
    it('the normal orientation of a face puts Z along its normal', () => {
        const bm = cube()
        meshNormalsUpdate(bm)
        selectModeSet(bm, SelectMode.Face)
        selectNone(bm)
        const px = [...bm.faces].find(f => [...f.eachLoop()].every(l => l.v.x === 1))!
        faceSelectSet(bm, px, true)
        const m = getTransformOrientationMatrix(bm, IDENTITY, 'median')
        expectV(m[2], [1, 0, 0])
        expect(Math.abs(m[0][0])).toBeLessThan(1e-6)
        expect(Math.abs(m[1][0])).toBeLessThan(1e-6)
    })

    it('extrude-style: translate with orient NORMAL constrained to Z moves along the face normal', () => {
        const bm = cube()
        selectModeSet(bm, SelectMode.Face)
        selectNone(bm)
        const px = [...bm.faces].find(f => [...f.eachLoop()].every(l => l.v.x === 1))!
        faceSelectSet(bm, px, true)
        const t = start(bm, 'translate', {orientationSet: 'normal', constraint: CON_AXIS2})
        // An operator-set constraint is named by its space only (`initTransform`, `transform.cc:2195`).
        expect(t.t.con.text).toBe(' normal')
        t.handleNumericKey('2')
        expect(vertAt(bm, 3, 1, 1)).toBeDefined()
        expect(vertAt(bm, 3, -1, -1)).toBeDefined()
        // Pressing X leaves the normal for the scene orientation.
        t.setAxis(0)
        expect(t.t.con.text).toBe(' along global X')
    })

    it('view orientation follows the camera', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'translate', {orientation: 'view'})
        t.setAxis(0)
        expect(t.t.con.text).toBe(' along view X')
        t.handleNumericKey('1')
        expect(vertAt(bm, 2, 1, 1)).toBeDefined()
    })
})

describe('proportional editing (calculatePropRatio, connectivity distance)', () => {
    const falloffs: [string, number][] = [
        ['smooth', 3 * 0.2 * 0.2 - 2 * 0.2 ** 3],
        ['sphere', Math.sqrt(2 * 0.2 - 0.2 * 0.2)],
        ['root', Math.sqrt(0.2)],
        ['sharp', 0.04],
        ['linear', 0.2],
        ['constant', 1],
        ['inverseSquare', 0.2 * 1.8],
    ]

    for (const [falloff, factor] of falloffs) {
        it(`${falloff}: neighbours 2 units away inside a 2.5 radius move by ${factor.toFixed(4)}`, () => {
            const bm = cube()
            selectNone(bm)
            vertSelectSet(bm, vertAt(bm, 1, 1, 1), true)
            const t = start(bm, 'translate', {proportional: {enabled: true, size: 2.5, falloff: falloff as never}})
            expect(t.t.flag & T_PROP_EDIT).not.toBe(0)
            t.handleNumericKey('1')
            expect(vertAt(bm, 2, 1, 1)).toBeDefined()
            expect(vertAt(bm, -1 + factor, 1, 1)).toBeDefined()
            expect(vertAt(bm, 1 + factor, -1, 1)).toBeDefined()
            // The far corner is 3.46 away: outside the circle, untouched.
            expect(vertAt(bm, -1, -1, -1)).toBeDefined()
            expect(t.status).toContain(`Proportional Size ${propFalloffText(falloff as never)}: 2.5000   `)
        })
    }

    it('connected uses the distance along the surface', () => {
        const bm = cube()
        selectNone(bm)
        vertSelectSet(bm, vertAt(bm, 1, 1, 1), true)
        const t = start(bm, 'translate', {proportional: {enabled: true, connected: true, size: 3, falloff: 'linear'}})
        t.handleNumericKey('1')
        // Along an edge: 2 units -> (3 - 2) / 3.
        expect(vertAt(bm, -1 + 1 / 3, 1, 1)).toBeDefined()
        // Across a face diagonal the geodesic is 2.83: (3 - 2.828) / 3.
        const d = Math.sqrt(8)
        expect(vertAt(bm, -1 + (3 - d) / 3, -1, 1)).toBeDefined()
    })

    it('geodesic propagation across a triangle is the straight line through the virtual source', () => {
        // Equilateral-ish: v1 at the source, v2 one unit away; v0 opposite - the distance is a straight line.
        const d = geodesicDistancePropagateAcrossTriangle([1, 1, 0], [0, 0, 0], [2, 0, 0], 0, 2)
        expect(d).toBeCloseTo(Math.SQRT2, 9)
    })

    it('the wheel resizes the circle by 10 percent, 1 percent with Shift', () => {
        const bm = cube()
        selectNone(bm)
        vertSelectSet(bm, vertAt(bm, 1, 1, 1), true)
        const t = start(bm, 'translate', {proportional: {enabled: true, size: 1}})
        t.proportionalSize(true)
        expect(t.t.propSize).toBeCloseTo(1.1, 9)
        t.precision = true
        t.proportionalSize(true)
        expect(t.t.propSize).toBeCloseTo(1.1 * 1.01, 9)
        t.precision = false
        t.proportionalSize(false)
        expect(t.t.propSize).toBeCloseTo(1.1 * 1.01 / 1.1, 9)
    })
})

describe('snapping (transform_snap_object.cc, transform_snap.cc)', () => {
    function triangleTarget(): SnapContext {
        const ctx = new SnapContext()
        ctx.targets.push(snapTargetFromGeometry([0, 0, 0, 2, 0, 0, 0, 2, 0], [0, 1, 2], IDENTITY))
        return ctx
    }

    it('vertex: the nearest projected vertex within 30 px', () => {
        const ctx = triangleTarget()
        const view = orthoView()
        const r = ctx.project(view, [600 + 10, 300 - 12], new Set(['vertex']), 30, {occlusion: false})
        expect(r?.type).toBe('vertex')
        expectV(r!.loc, [2, 0, 0])
        expect(r!.distPx).toBeCloseTo(Math.hypot(10, 12), 6)
        expect(ctx.project(view, [700, 300], new Set(['vertex']), 30, {occlusion: false})).toBeNull()
    })

    it('edge and edge midpoint: the point on the edge under the cursor, or its middle', () => {
        const ctx = triangleTarget()
        const view = orthoView()
        const edge = ctx.project(view, [430, 290], new Set(['edge']), 30, {occlusion: false})
        expect(edge?.type).toBe('edge')
        expectV(edge!.loc, [0.3, 0, 0])
        // The midpoint itself has to be within the search radius (`snap_edge_points` resets `dist_px_sq`).
        const mid = ctx.project(view, [490, 295], new Set(['edgeMidpoint']), 30, {occlusion: false})
        expect(mid?.type).toBe('edgeMidpoint')
        expectV(mid!.loc, [1, 0, 0])
        expect(ctx.project(view, [450, 295], new Set(['edgeMidpoint']), 30, {occlusion: false})).toBeNull()
    })

    it('face: the ray hit on the surface', () => {
        const ctx = triangleTarget()
        const r = ctx.project(orthoView(), [450, 340], new Set(['face']), 30, {occlusion: false})
        expect(r?.type).toBe('face')
        expectV(r!.loc, [0.5, 0.4, 0])
        expectV(r!.no, [0, 0, 1])
    })

    it('occlusion: a vertex behind the surface under the cursor is not a target', () => {
        const ctx = triangleTarget()
        // A second vertex straight behind the triangle's interior.
        ctx.targets.push(snapTargetFromGeometry([0.5, 0.5, -1, 0.6, 0.5, -1, 0.5, 0.6, -1], [0, 1, 2], IDENTITY))
        const view = orthoView()
        // With occlusion the front face hides it and nothing else is within reach; through it, it snaps.
        expect(ctx.project(view, [450, 350], new Set(['vertex']), 30, {occlusion: true})).toBeNull()
        const through = ctx.project(view, [450, 350], new Set(['vertex']), 30, {occlusion: false})
        expect(through?.loc[2]).toBe(-1)
        // A visible vertex is still found with occlusion on.
        const front = ctx.project(view, [410, 310], new Set(['vertex']), 30, {occlusion: true})
        expectV(front!.loc, [0, 0, 0])
    })

    it('the edited mesh excludes its moving selection from the targets', () => {
        const bm = cube()
        selectNone(bm)
        vertSelectSet(bm, vertAt(bm, 1, 1, 1), true)
        const target = snapTargetFromBMesh(bm, IDENTITY)
        const i = vertAt(bm, 1, 1, 1).index
        expect(target.vertOk[i]).toBe(0)
        expect([...target.vertOk].filter(x => x === 1).length).toBe(7)
        // Every edge and face touching the selected vertex is out too: 3 edges, 3 faces.
        expect([...target.edgeOk].filter(x => x === 0).length).toBe(3)
        expect([...target.triOk].filter(x => x === 0).length).toBe(6)
    })

    it('G with vertex snapping lands the moving vertex on the target vertex (closest source)', () => {
        const bm = cube()
        selectNone(bm)
        vertSelectSet(bm, vertAt(bm, 1, 1, 1), true)
        const ctx = new SnapContext()
        ctx.targets.push(snapTargetFromGeometry([3, 2, 1, 3.5, 2, 1, 3, 2.5, 1], [0, 1, 2], IDENTITY))
        const t = start(bm, 'translate', {snap: {enabled: true, targets: ['vertex']}, snapContext: ctx})
        // The cursor near the target vertex (3, 2) -> (700, 500); the pivot (1, 1) started at (500, 300).
        t.setMousePosition(712, 490)
        expect(t.t.tsnap.targetType).toBe('vertex')
        expectV([vertAt(bm, 3, 2, 1)?.x ?? NaN, vertAt(bm, 3, 2, 1)?.y ?? NaN], [3, 2])
        t.handleModal('snapInvOn')
        // Ctrl inverts the header setting: snapping off, the vertex follows the cursor.
        expect(t.t.snapIsActive()).toBe(false)
        expect(vertAt(bm, 3, 2, 1)).toBeUndefined()
    })

    it('grid: the ray hit on the ground plane rounded to the grid step (snap_grid)', () => {
        const ctx = new SnapContext()
        const view = orthoView()
        // Looking down Z the view plane is the only one the ray crosses; the current position sits on it.
        const r = ctx.project(view, [537, 329], new Set(['grid']), 30, {occlusion: false, currCo: [0, 0, 0], gridSize: 0.5})
        expect(r?.type).toBe('grid')
        expectV(r!.loc, [1.5, 0.5, 0])
        // Absolute grid snapping through the transform: Ctrl rounds to the world grid, not to the start.
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'translate', {snap: {enabled: true, targets: ['increment'], absoluteGrid: true}})
        t.t.snapSpatial = [0.5, 0.5, 0.5]
        t.t.increment = [0.5, 0.5, 0.5]
        t.setMousePosition(537, 329)
        // The pivot (0,0,0) is on the grid already, so the offset is the rounded delta: (0.5, 0.5).
        expect(vertAt(bm, 1.5, 1.5, 1)).toBeDefined()
    })

    it('increment snapping rounds a rotation and a scale too', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'rotate', {snap: {enabled: true, targets: ['vertex'], affect: {translate: true, rotate: false, resize: false}}})
        // Rotation is not affected by vertex snapping, so it falls back to increments.
        expect([...t.t.tsnap.mode]).toEqual(['increment'])
        t.setMousePosition(500, 320)
        expect(t.t.valuesFinal[0] * 180 / Math.PI).toBeCloseTo(-10, 9)
    })
})

describe('object mode (transform_convert_object.cc)', () => {
    it('rotates objects about the pivot and reports world rotation and position', () => {
        const t = new TransInfo({
            mode: 'rotate',
            view: orthoView(),
            mval: [500, 300],
            around: 'cursor',
            cursor: [0, 0, 0],
            orientation: 'global',
            objects: [{id: 'a', matrixWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1], parentMatrixWorld: IDENTITY, localScale: [1, 1, 1]}],
        })
        t.handleEvent({type: 'modal', item: 'axisZ'})
        t.handleEvent({type: 'key', event: key('9')})
        t.handleEvent({type: 'key', event: key('0')})
        const r = t.objectResults()[0]
        expectV(r.loc, [0, 1, 0])
        expectV(r.rotWorld[0], [0, 1, 0])
        expectV(r.rotWorld[1], [-1, 0, 0])
    })

    it('scales objects by the ratio, keeping the local scale', () => {
        const t = new TransInfo({
            mode: 'resize',
            view: orthoView(),
            mval: [500, 300],
            around: 'median',
            orientation: 'global',
            objects: [{id: 'a', matrixWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1], parentMatrixWorld: IDENTITY, localScale: [1, 2, 1]}],
        })
        t.handleEvent({type: 'key', event: key('3')})
        const r = t.objectResults()[0]
        expectV(r.scale, [3, 6, 3])
        // One object: the pivot is its own origin, so it does not move.
        expectV(r.loc, [2, 0, 0])
    })

    it('a translate constraint in object mode uses the gizmo axis', () => {
        const t = new TransInfo({
            mode: 'translate',
            view: orthoView(),
            mval: [500, 300],
            around: 'median',
            orientation: 'global',
            constraint: CON_AXIS0,
            objects: [{id: 'a', matrixWorld: IDENTITY, parentMatrixWorld: IDENTITY, localScale: [1, 1, 1]}],
        })
        t.handleEvent({type: 'mousemove', mval: [580, 360]})
        expectV(t.objectResults()[0].loc, [0.8, 0, 0])
    })
})

describe('ElemFlag sanity', () => {
    it('the kernel keeps the selection on the moved vertices', () => {
        const bm = cube()
        selectAll(bm)
        const t = start(bm, 'translate')
        t.handleNumericKey('1')
        expect([...bm.verts].every(v => v.hflag & ElemFlag.Select)).toBe(true)
    })
})

describe('redo: saveTransform then initTransInfo with T_INPUT_IS_VALUES_FINAL (transform.cc:1744, transform_generics.cc:364)', () => {
    /** Run interactively, save, put the mesh back, run again non-modally from the saved props. */
    function roundTrip(prepare: (bm: BMesh) => void, drive: (t: ModalTransform) => void, mode: 'translate' | 'rotate' | 'resize', extra: Partial<ModalTransformOptions> = {}) {
        const bm = cube()
        prepare(bm)
        const original = verts(bm)
        const t = start(bm, mode, extra, perspView())
        drive(t)
        t.confirm()
        const interactive = verts(bm)
        const saved = t.saved()

        // Back to the start, then the redo panel's re-run.
        ;[...bm.verts].forEach((v, i) => v.setCo(original[i][0], original[i][1], original[i][2]))
        const repeat = new ModalTransform({
            mode, view: perspView(), mval: [0, 0], around: 'median', orientation: 'global', bm, objectMatrix: IDENTITY,
            random: () => 0.5, modal: false, value: saved.value, orientType: saved.orientType,
            orientMatrix: saved.orientMatrix, orientMatrixType: saved.orientMatrixType, orientAxis: saved.orientAxis,
            constraintAxis: saved.constraintAxis, proportional: saved.proportional, ...extra,
        })
        repeat.confirm()
        return {interactive, repeated: verts(bm), saved}
    }

    it('a constrained typed move repeats exactly', () => {
        const {interactive, repeated, saved} = roundTrip(selectAll, t => {
            t.setAxis(0)
            for (const k of '1.5') t.handleNumericKey(k)
        }, 'translate')
        expect(saved.constraintAxis).toEqual([true, false, false])
        for (let i = 0; i < interactive.length; i++) expectV(repeated[i], interactive[i])
        expect(interactive[0][0] - (-1)).not.toBe(0)
    })

    it('a free mouse move repeats exactly, in perspective', () => {
        const {interactive, repeated} = roundTrip(selectAll, t => t.setMousePosition(640, 420), 'translate')
        for (let i = 0; i < interactive.length; i++) expectV(repeated[i], interactive[i])
    })

    it('a view-axis rotation repeats about the same axis, from the stored orientation', () => {
        const {interactive, repeated, saved} = roundTrip(selectAll, t => {
            for (const k of '30') t.handleNumericKey(k)
        }, 'rotate')
        expect(saved.value[0]).toBeCloseTo(30 * Math.PI / 180, 6)
        expect(saved.orientMatrix).not.toBeNull()
        for (let i = 0; i < interactive.length; i++) expectV(repeated[i], interactive[i])
    })

    it('a scale constrained to Z in normal orientation repeats exactly', () => {
        const {interactive, repeated} = roundTrip(bm => {
            selectNone(bm)
            const top = [...bm.faces].find(f => [...f.eachLoop()].every(l => Math.abs(l.v.z - 1) < 1e-6))!
            faceSelectSet(bm, top, true)
        }, t => {
            t.setAxis(2)
            for (const k of '2') t.handleNumericKey(k)
        }, 'resize', {orientationSet: 'normal'})
        for (let i = 0; i < interactive.length; i++) expectV(repeated[i], interactive[i])
    })

    it('a proportional move repeats with the same falloff', () => {
        const {interactive, repeated, saved} = roundTrip(bm => {
            selectNone(bm)
            vertSelectSet(bm, vertAt(bm, 1, 1, 1), true)
        }, t => {
            t.setAxis(2)
            for (const k of '1') t.handleNumericKey(k)
        }, 'translate', {proportional: {enabled: true, size: 2.5, falloff: 'smooth'}})
        expect(saved.proportional.enabled).toBe(true)
        for (let i = 0; i < interactive.length; i++) expectV(repeated[i], interactive[i])
    })
})

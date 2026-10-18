/**
 * Axis and plane constraints, ported from `editors/transform/transform_constraints.cc`.
 *
 * A constraint is a set of allowed axes (`CON_AXIS0..2`) in the current orientation space
 * (`spacemtx`). The free motion is not simply zeroed on the locked axes: it is projected along the
 * view onto the allowed line or plane (`axisProjection`, `planeProjection`), so a constrained drag
 * follows the cursor at any camera angle. Pressing the same axis key again cycles the orientation
 * (global, then local, then off), as `transform_event_modal_constraint` does.
 */

import {
    addV3,
    angleV3V3,
    copyV3,
    crossV3,
    dotV3,
    invertM3,
    isectRayPlaneV3Factor,
    isectRayRayV3,
    isZeroV3,
    lenV3,
    m4Col,
    maddV3,
    Mat3,
    mulM3M3,
    mulM3V3,
    mulV3Fl,
    normalizeV3,
    normalizeV3Length,
    projectV3V3V3,
    subV3,
    unitM3,
    Vec3,
} from './math'
import {
    CON_APPLY,
    CON_AXIS0,
    CON_AXIS1,
    CON_AXIS2,
    CON_SELECT,
    CON_USER,
    MOD_CONSTRAINT_SELECT_AXIS,
    MOD_CONSTRAINT_SELECT_PLANE,
    O_DEFAULT,
    O_SCENE,
    T_EDIT,
    T_NO_CONSTRAINT,
    T_NULL_ONE,
    TransData,
    TransDataContainer,
} from './types'
import type {TransInfo} from './TransInfo'
import {orientationSpaceName} from './orientation'

const CONSTRAIN_EPSILON = 0.0001

export type ConstraintKind = 'none' | 'axis' | 'object'

/** `TransCon` (`transform.hh`). */
export interface TransCon {
    mode: number
    /** The header text, e.g. ` along global X`. */
    text: string
    /** Projection onto the allowed axes, in global space (`projection_matrix_calc`). */
    pmtx: Mat3
    /** Which callback family applies: per-transform axes, or each element's own `axismtx`. */
    kind: ConstraintKind
}

export function newTransCon(): TransCon {
    return {mode: 0, text: '', pmtx: unitM3(), kind: 'none'}
}

/** `projection_matrix_calc` (`transform_constraints.cc:51`). */
export function projectionMatrixCalc(t: TransInfo): Mat3 {
    const pm = unitM3()
    if (!(t.con.mode & CON_AXIS0)) pm[0] = [0, 0, 0]
    if (!(t.con.mode & CON_AXIS1)) pm[1] = [0, 0, 0]
    if (!(t.con.mode & CON_AXIS2)) pm[2] = [0, 0, 0]
    const mat = mulM3M3(pm, t.spacemtxInv)
    return mulM3M3(t.spacemtx, mat)
}

/** `constraint_plane_normal_calc` (`transform_constraints.cc:75`). */
function constraintPlaneNormalCalc(t: TransInfo): Vec3 {
    const vectors: Vec3[] = []
    for (let i = 0; i < 3; i++) {
        if (t.con.mode & CON_AXIS0 << i) {
            vectors.push(t.spacemtx[i])
            if (vectors.length === 2) break
        }
    }
    const no = crossV3(vectors[0], vectors[1])
    normalizeV3(no)
    return no
}

/** `constraintNumInput` (`transform_constraints.cc:93`): spread typed values over the constrained axes. */
export function constraintNumInput(t: TransInfo, vec: Vec3): void {
    const mode = t.con.mode
    if (mode & CON_APPLY) {
        const nval = t.flag & T_NULL_ONE ? 1 : 0
        const dims = getConstraintSpaceDimension(t)
        if (dims === 2) {
            const axis = mode & (CON_AXIS0 | CON_AXIS1 | CON_AXIS2)
            if (axis === (CON_AXIS0 | CON_AXIS1)) {
                vec[2] = nval
            } else if (axis === (CON_AXIS1 | CON_AXIS2)) {
                vec[2] = vec[1]
                vec[1] = vec[0]
                vec[0] = nval
            } else if (axis === (CON_AXIS0 | CON_AXIS2)) {
                vec[2] = vec[1]
                vec[1] = nval
            }
        } else if (dims === 1) {
            if (mode & CON_AXIS0) {
                vec[1] = nval
                vec[2] = nval
            } else if (mode & CON_AXIS1) {
                vec[1] = vec[0]
                vec[0] = nval
                vec[2] = nval
            } else if (mode & CON_AXIS2) {
                vec[2] = vec[0]
                vec[0] = nval
                vec[1] = nval
            }
        }
    }
}

/** `viewAxisCorrectCenter` (`transform_constraints.cc:138`): keep the centre in front of the near plane. */
function viewAxisCorrectCenter(t: TransInfo, center: Vec3): Vec3 {
    const minDist = 1.0
    const eye = t.view.viewinvCol(3)
    const viewZ = t.view.viewinvCol(2)
    let dir = subV3(center, eye)
    if (dotV3(dir, viewZ) < 0) dir = mulV3Fl(dir, -1)
    dir = projectV3V3V3(dir, viewZ)
    const l = lenV3(dir)
    if (l < minDist) {
        const diff = normalizeV3Length(viewZ, minDist - l)
        return subV3(center, diff)
    }
    return center
}

/** `axisProjection` (`transform_constraints.cc:165`): the motion along `axis` the cursor implies. */
function axisProjection(t: TransInfo, axis: Vec3, input: Vec3): Vec3 {
    if (isZeroV3(input)) return [0, 0, 0]

    const conCenter = viewAxisCorrectCenter(t, copyV3(t.centerGlobal))
    const viewZ = t.view.viewinvCol(2)

    let angle = Math.abs(angleV3V3(axis, viewZ))
    if (angle > Math.PI / 2) angle = Math.PI - angle

    // When the view is parallel to the constraint, take vertical motion in 3D space and apply it
    // to the constraint axis. Nice for camera grab + MMB.
    if (angle < 5 * Math.PI / 180) {
        const viewY = t.view.viewinvCol(1)
        const vec = projectV3V3V3(input, viewY)
        let factor = dotV3(viewY, vec) * 2
        // Since camera distance is quite relative, use a quadratic relationship.
        factor = factor < 0 ? -factor * factor : factor * factor
        return normalizeV3Length(axis, -factor)
    }

    const normCenter = t.view.viewVector(conCenter)
    const plane = crossV3(normCenter, axis)
    let vec = projectV3V3V3(input, plane)
    vec = subV3(input, vec)
    const v = addV3(vec, conCenter)
    const norm = t.view.viewVector(v)

    // Give an arbitrarily large value if projection is impossible.
    const factor = dotV3(axis, norm)
    if (1 - Math.abs(factor) < 0.0002) {
        return mulV3Fl(axis, factor > 0 ? 1000000000 : -1000000000)
    }
    // Ray-ray intersection instead of line-line, for precision with small values added to large ones.
    const isect = isectRayRayV3(conCenter, axis, v, norm)
    const out: Vec3 = isect ? mulV3Fl(axis, isect.lambdaA) : [0, 0, 0]
    for (let i = 0; i < 3; i++) if (!Number.isFinite(out[i])) out[i] = 0
    return out
}

/** `isPlaneProjectionViewAligned` (`transform_constraints.cc:324`). */
function isPlaneProjectionViewAligned(t: TransInfo, planeNo: Vec3): boolean {
    const viewToPlane = t.view.viewVector(t.centerGlobal)
    return Math.abs(dotV3(planeNo, viewToPlane)) < 0.001
}

/** `planeProjection` (`transform_constraints.cc:334`): project along the view onto the plane. */
function planeProjection(t: TransInfo, planeNo: Vec3, input: Vec3): Vec3 {
    const pos = addV3(input, t.centerGlobal)
    const viewVec = t.view.viewVector(pos)
    const factor = isectRayPlaneV3Factor(pos, viewVec, t.centerGlobal, planeNo)
    if (factor === null) return input
    return maddV3(input, viewVec, factor)
}

/** `transform_constraint_snap_axis_to_edge` (`transform_constraints.cc:290`). */
export function constraintSnapAxisToEdge(t: TransInfo, axis: Vec3, fallback: Vec3): Vec3 {
    const edgeSnapPoint = t.tsnap.snapTarget
    const edgeDir = t.tsnap.snapNormal
    const isAligned = Math.abs(dotV3(axis, edgeDir)) > 1 - CONSTRAIN_EPSILON
    if (!isAligned) {
        const isect = isectRayRayV3(t.tsnap.snapSource, axis, edgeSnapPoint, edgeDir)
        if (isect) return mulV3Fl(axis, isect.lambdaA)
    }
    return fallback
}

/** `transform_constraint_snap_axis_to_face` (`transform_constraints.cc:305`). */
export function constraintSnapAxisToFace(t: TransInfo, axis: Vec3, fallback: Vec3): Vec3 {
    const faceSnapPoint = t.tsnap.snapTarget
    const faceNormal = t.tsnap.snapNormal
    const isAligned = Math.abs(dotV3(axis, faceNormal)) < CONSTRAIN_EPSILON
    if (!isAligned) {
        const lambda = isectRayPlaneV3Factor(t.tsnap.snapSource, axis, faceSnapPoint, faceNormal)
        if (lambda !== null) return mulV3Fl(axis, lambda)
    }
    return fallback
}

/** `constraint_snap_plane_to_edge` (`transform_constraints.cc:259`). */
function constraintSnapPlaneToEdge(t: TransInfo, planeNo: Vec3, fallback: Vec3): Vec3 {
    const edgeSnapPoint = t.tsnap.snapTarget
    const edgeDir = t.tsnap.snapNormal
    const isAligned = Math.abs(dotV3(edgeDir, planeNo)) < CONSTRAIN_EPSILON
    if (!isAligned) {
        const lambda = isectRayPlaneV3Factor(edgeSnapPoint, edgeDir, t.tsnap.snapSource, planeNo)
        if (lambda !== null) return subV3(maddV3(edgeSnapPoint, edgeDir, lambda), t.tsnap.snapSource)
    }
    return fallback
}

/** `transform_constraint_get_nearest` (`transform_constraints.cc:374`). */
export function transformConstraintGetNearest(t: TransInfo, vec: Vec3): Vec3 {
    let isSnapToPoint = false, isSnapToEdge = false, isSnapToFace = false
    if (t.snapIsActive() && t.validSnap()) {
        isSnapToEdge = t.tsnap.targetType === 'edge' || t.tsnap.targetType === 'edgeMidpoint'
        isSnapToFace = t.tsnap.targetType === 'face'
        isSnapToPoint = !isSnapToEdge && !isSnapToFace
    }

    // Fallback for when axes are aligned.
    let out = mulM3V3(t.con.pmtx, vec)

    if (isSnapToPoint) {
        // With snap points, a projection is alright, no adjustments needed.
        return out
    }
    const dims = getConstraintSpaceDimension(t)
    if (dims === 2) {
        if (!isZeroV3(out)) {
            const planeNo = constraintPlaneNormalCalc(t)
            if (isSnapToEdge) {
                out = constraintSnapPlaneToEdge(t, planeNo, out)
            } else if (isSnapToFace) {
                // Disabled, as it has not proven to be really useful (#82386).
            } else if (!isPlaneProjectionViewAligned(t, planeNo)) {
                out = planeProjection(t, planeNo, vec)
            }
        }
    } else if (dims === 1) {
        const c = t.con.mode & CON_AXIS0 ? t.spacemtx[0] : t.con.mode & CON_AXIS1 ? t.spacemtx[1] : t.spacemtx[2]
        if (isSnapToEdge) {
            out = constraintSnapAxisToEdge(t, c, out)
        } else if (isSnapToFace) {
            out = constraintSnapAxisToFace(t, c, out)
        } else {
            out = axisProjection(t, c, vec)
        }
    }
    return out
}

/** `transform_object_axismtx_get`: the element's own axes. */
function transformObjectAxismtxGet(td: TransData): Mat3 {
    return td.axismtx
}

/** `applyAxisConstraintVec` (`transform_constraints.cc:447`): only the whole-transform call projects. */
function applyAxisConstraintVec(t: TransInfo, td: TransData | null, input: Vec3): Vec3 {
    if (td || !(t.con.mode & CON_APPLY)) return copyV3(input)
    return transformConstraintGetNearest(t, input)
}

/** `applyObjectConstraintVec` (`transform_constraints.cc:471`). */
function applyObjectConstraintVec(t: TransInfo, tc: TransDataContainer | null, td: TransData | null, input: Vec3): Vec3 {
    if (!td) return applyAxisConstraintVec(t, td, input)
    let out = copyV3(input)
    if (t.con.mode & CON_APPLY) {
        out = mulM3V3(t.spacemtxInv, out)
        out = mulM3V3(transformObjectAxismtxGet(td), out)
        if (t.flag & T_EDIT && tc) out = mulM3V3(tc.mat3Unit, out)
    }
    return out
}

/** `t->con.applyVec`. */
export function conApplyVec(t: TransInfo, tc: TransDataContainer | null, td: TransData | null, input: Vec3): Vec3 {
    if (t.con.kind === 'object') return applyObjectConstraintVec(t, tc, td, input)
    return applyAxisConstraintVec(t, td, input)
}

/** `applyAxisConstraintSize` (`transform_constraints.cc:497`). */
function applyAxisConstraintSize(t: TransInfo, td: TransData | null, smat: Mat3): Mat3 {
    if (!td && t.con.mode & CON_APPLY) {
        const r = [[...smat[0]], [...smat[1]], [...smat[2]]] as Mat3
        if (!(t.con.mode & CON_AXIS0)) r[0][0] = 1
        if (!(t.con.mode & CON_AXIS1)) r[1][1] = 1
        if (!(t.con.mode & CON_AXIS2)) r[2][2] = 1
        const tmat = mulM3M3(r, t.spacemtxInv)
        return mulM3M3(t.spacemtx, tmat)
    }
    return smat
}

/** `applyObjectConstraintSize` (`transform_constraints.cc:523`). */
function applyObjectConstraintSize(t: TransInfo, _tc: TransDataContainer | null, td: TransData | null, smat: Mat3): Mat3 {
    if (td && t.con.mode & CON_APPLY) {
        const axismtx = transformObjectAxismtxGet(td)
        const imat = invertM3(axismtx)
        const r = [[...smat[0]], [...smat[1]], [...smat[2]]] as Mat3
        if (!(t.con.mode & CON_AXIS0)) r[0][0] = 1
        if (!(t.con.mode & CON_AXIS1)) r[1][1] = 1
        if (!(t.con.mode & CON_AXIS2)) r[2][2] = 1
        const tmat = mulM3M3(r, imat)
        // Blender multiplies `r_smat` by `mat3_unit` in edit mode here, then overwrites it with
        // `axismtx * tmat` on the next line (`transform_constraints.cc:546-549`); the port keeps the
        // effective result.
        return mulM3M3(axismtx, tmat)
    }
    return smat
}

/** `t->con.applySize`. */
export function conApplySize(t: TransInfo, tc: TransDataContainer | null, td: TransData | null, smat: Mat3): Mat3 {
    if (t.con.kind === 'object') return applyObjectConstraintSize(t, tc, td, smat)
    return applyAxisConstraintSize(t, td, smat)
}

/** `constraints_rotation_impl` (`transform_constraints.cc:553`): a single axis, or a plane's normal. */
function constraintsRotationImpl(t: TransInfo, axismtx: Mat3): Vec3 {
    const mode = t.con.mode & (CON_AXIS0 | CON_AXIS1 | CON_AXIS2)
    switch (mode) {
    case CON_AXIS0:
    case CON_AXIS1 | CON_AXIS2:
        return copyV3(axismtx[0])
    case CON_AXIS1:
    case CON_AXIS0 | CON_AXIS2:
        return copyV3(axismtx[1])
    case CON_AXIS2:
    case CON_AXIS0 | CON_AXIS1:
        return copyV3(axismtx[2])
    default:
        return [0, 0, 1]
    }
}

/** `t->con.applyRot` (`applyAxisConstraintRot` / `applyObjectConstraintRot`). Null when not constrained. */
export function conApplyRot(t: TransInfo, tc: TransDataContainer | null, td: TransData | null): Vec3 | null {
    if (!(t.con.mode & CON_APPLY)) return null
    if (t.con.kind === 'object') {
        // On the setup call, use the first element.
        if (!td) {
            tc = t.containers[0] ?? null
            td = tc?.data[0] ?? null
            if (!td) return constraintsRotationImpl(t, t.spacemtx)
        }
        let axismtx = transformObjectAxismtxGet(td)
        if (t.flag & T_EDIT && tc) axismtx = mulM3M3(tc.mat3Unit, axismtx)
        return constraintsRotationImpl(t, axismtx)
    }
    if (td) return null
    return constraintsRotationImpl(t, t.spacemtx)
}

/** `getConstraintSpaceDimension` (`transform_constraints.cc:1239`). */
export function getConstraintSpaceDimension(t: TransInfo): number {
    let n = 0
    if (t.con.mode & CON_AXIS0) n++
    if (t.con.mode & CON_AXIS1) n++
    if (t.con.mode & CON_AXIS2) n++
    return n
}

/** `startConstraint` (`transform_constraints.cc:1023`). */
export function startConstraint(t: TransInfo): void {
    t.con.mode |= CON_APPLY
    if (!t.con.text.startsWith(' ')) t.con.text = ' ' + t.con.text
    const dims = getConstraintSpaceDimension(t)
    t.num.idxMax = dims > 0 ? Math.min(dims - 1, t.idxMax) : t.idxMax
}

/** `stopConstraint` (`transform_constraints.cc:1036`). */
export function stopConstraint(t: TransInfo): void {
    if (t.orientCurr !== O_DEFAULT) t.orientationsCurrentSet(O_DEFAULT)
    t.con.mode &= ~(CON_APPLY | CON_SELECT)
    t.con.text = ''
    t.num.idxMax = t.idxMax
}

/** `setConstraint` (`transform_constraints.cc:636`). */
export function setConstraint(t: TransInfo, mode: number, text: string): void {
    t.con.text = text
    t.con.mode = mode
    t.con.pmtx = projectionMatrixCalc(t)
    startConstraint(t)
    t.con.kind = 'axis'
}

/** `setAxisMatrixConstraint` (`transform_constraints.cc:651`). */
export function setAxisMatrixConstraint(t: TransInfo, mode: number, text: string): void {
    t.con.text = text
    t.con.mode = mode
    t.con.pmtx = projectionMatrixCalc(t)
    startConstraint(t)
    t.con.kind = 'object'
}

/** `setLocalConstraint` (`transform_constraints.cc:666`). */
export function setLocalConstraint(t: TransInfo, mode: number, text: string): void {
    if (t.flag & T_EDIT || t.dataLenAll === 1) {
        // In edit mode each object has its local space, but use the active object's orientation.
        setConstraint(t, mode, text)
    } else {
        setAxisMatrixConstraint(t, mode, text)
    }
}

/** `checkUseAxisMatrix` (`transform.cc:2309`): per-island axes with individual origins in edit mode. */
export function checkUseAxisMatrix(t: TransInfo): boolean {
    return (t.flag & T_EDIT) !== 0 && t.around === 'individual' && t.isEditMesh
}

/** `setUserConstraint` (`transform_constraints.cc:678`). `textFmt` has `%s` for the space name. */
export function setUserConstraint(t: TransInfo, mode: number, textFmt: string): void {
    const orientation = t.orient[t.orientCurr].type
    const text = textFmt.replace('%s', orientationSpaceName(orientation))
    switch (orientation) {
    case 'local':
        setLocalConstraint(t, mode, text)
        break
    case 'normal':
        if (checkUseAxisMatrix(t)) {
            setAxisMatrixConstraint(t, mode, text)
            break
        }
        setConstraint(t, mode, text)
        break
    default:
        setConstraint(t, mode, text)
        break
    }
    t.con.mode |= CON_USER
}

export type ModalConstraintType = 'axisX' | 'axisY' | 'axisZ' | 'planeX' | 'planeY' | 'planeZ'

/**
 * `transform_event_modal_constraint` (`transform.cc:943`): an axis or plane key. A repeated press
 * cycles the orientation slots (scene, then the alternative, then off).
 */
export function transformEventModalConstraint(t: TransInfo, modalType: ModalConstraintType): boolean {
    if (t.flag & T_NO_CONSTRAINT) return false

    let constraintCurr = -1
    if (t.modifiers & (MOD_CONSTRAINT_SELECT_AXIS | MOD_CONSTRAINT_SELECT_PLANE)) {
        t.modifiers &= ~(MOD_CONSTRAINT_SELECT_AXIS | MOD_CONSTRAINT_SELECT_PLANE)
        // Avoid changing orientation in this case.
        constraintCurr = -2
    } else if (t.con.mode & CON_APPLY) {
        constraintCurr = t.con.mode & (CON_AXIS0 | CON_AXIS1 | CON_AXIS2)
    }

    let constraintNew: number
    let msg: string
    switch (modalType) {
    case 'axisX':
        msg = 'along %s X'
        constraintNew = CON_AXIS0
        break
    case 'axisY':
        msg = 'along %s Y'
        constraintNew = CON_AXIS1
        break
    case 'axisZ':
        msg = 'along %s Z'
        constraintNew = CON_AXIS2
        break
    case 'planeX':
        msg = 'locking %s X'
        constraintNew = CON_AXIS1 | CON_AXIS2
        break
    case 'planeY':
        msg = 'locking %s Y'
        constraintNew = CON_AXIS0 | CON_AXIS2
        break
    case 'planeZ':
        msg = 'locking %s Z'
        constraintNew = CON_AXIS0 | CON_AXIS1
        break
    default:
        return false
    }

    let orientIndex = 1
    if (t.orientCurr === O_DEFAULT || constraintCurr === -1 || constraintCurr === constraintNew) {
        // Successive presses on the existing axis cycle the orientation modes.
        orientIndex = (t.orientCurr + 1) % t.orient.length
    }
    t.orientationsCurrentSet(orientIndex)
    if (orientIndex === 0) {
        stopConstraint(t)
    } else {
        setUserConstraint(t, constraintNew, msg)
    }
    return true
}

/** `setNearestAxis3d` (`transform_constraints.cc:1095`): the axis the mouse moved along, for MMB. */
function setNearestAxis3d(t: TransInfo): void {
    t.con.mode &= ~(CON_AXIS0 | CON_AXIS1 | CON_AXIS2)

    const mvec: Vec3 = [t.mval[0] - t.mouse.imval[0], t.mval[1] - t.mouse.imval[1], 0]

    // Correct the axis length for the current zoom level: the length of two points 30 pixels apart.
    let zfac = t.view.calcZfac(t.centerGlobal)
    zfac = lenV3(m4Col(t.view.persinv, 0)) * 2 / t.view.winx * zfac * 30

    const len = [0, 0, 0]
    for (let i = 0; i < 3; i++) {
        let axis = mulV3Fl(t.spacemtx[i], zfac)
        axis = addV3(axis, t.centerGlobal)
        const axis2d = t.view.projectFloatViewOrCenter(axis)
        axis = [axis2d[0] - t.center2d[0], axis2d[1] - t.center2d[1], 0]
        if (normalizeV3(axis) > 1e-3) {
            const proj = projectV3V3V3(mvec, axis)
            const rest = subV3(mvec, proj)
            len[i] = normalizeV3(rest)
        } else {
            len[i] = 1e10
        }
    }

    const plane = (t.modifiers & MOD_CONSTRAINT_SELECT_PLANE) !== 0
    const name = t.spacename
    if (len[0] <= len[1] && len[0] <= len[2]) {
        t.con.mode |= plane ? CON_AXIS1 | CON_AXIS2 : CON_AXIS0
        t.con.text = plane ? ` locking ${name} X axis` : ` along ${name} X axis`
    } else if (len[1] <= len[0] && len[1] <= len[2]) {
        t.con.mode |= plane ? CON_AXIS0 | CON_AXIS2 : CON_AXIS1
        t.con.text = plane ? ` locking ${name} Y axis` : ` along ${name} Y axis`
    } else {
        t.con.mode |= plane ? CON_AXIS0 | CON_AXIS1 : CON_AXIS2
        t.con.text = plane ? ` locking ${name} Z axis` : ` along ${name} Z axis`
    }
}

/** `setNearestAxis` (`transform_constraints.cc:1206`). */
export function setNearestAxis(t: TransInfo): void {
    const modePrev = t.con.mode
    setNearestAxis3d(t)
    if (modePrev !== t.con.mode) t.con.pmtx = projectionMatrixCalc(t)
}

/** `initSelectConstraint` (`transform_constraints.cc:1053`): MMB pressed, pick the axis from motion. */
export function initSelectConstraint(t: TransInfo): void {
    if (t.orientCurr === O_DEFAULT) t.orientationsCurrentSet(O_SCENE)
    setUserConstraint(t, CON_APPLY | CON_SELECT, '%s')
}

/** `selectConstraint` (`transform_constraints.cc:1062`). */
export function selectConstraint(t: TransInfo): void {
    if (t.con.mode & CON_SELECT) {
        setNearestAxis(t)
        startConstraint(t)
    }
}

/** `postSelectConstraint` (`transform_constraints.cc:1070`). */
export function postSelectConstraint(t: TransInfo): void {
    if (!(t.con.mode & CON_SELECT)) return
    t.con.mode &= ~CON_SELECT
    setNearestAxis(t)
    startConstraint(t)
}

/** `constraintModeToIndex` (`transform_constraints.cc:1196`): the single axis a constraint maps to, or -1. */
export function constraintModeToIndex(t: TransInfo): number {
    if (!(t.con.mode & CON_APPLY)) return -1
    switch (t.con.mode & (CON_AXIS0 | CON_AXIS1 | CON_AXIS2)) {
    case CON_AXIS0:
    case CON_AXIS1 | CON_AXIS2:
        return 0
    case CON_AXIS1:
    case CON_AXIS0 | CON_AXIS2:
        return 1
    case CON_AXIS2:
    case CON_AXIS0 | CON_AXIS1:
        return 2
    default:
        return -1
    }
}

/** `isLockConstraint` (`transform_constraints.cc:1220`): true for a plane (two axes). */
export function isLockConstraint(t: TransInfo): boolean {
    const mode = t.con.mode
    if ((mode & (CON_AXIS0 | CON_AXIS1)) === (CON_AXIS0 | CON_AXIS1)) return true
    if ((mode & (CON_AXIS1 | CON_AXIS2)) === (CON_AXIS1 | CON_AXIS2)) return true
    if ((mode & (CON_AXIS0 | CON_AXIS2)) === (CON_AXIS0 | CON_AXIS2)) return true
    return false
}

/** The constrained axes as world directions, for drawing the constraint lines. */
export function constraintAxisLines(t: TransInfo): Vec3[] {
    const out: Vec3[] = []
    if (!(t.con.mode & CON_APPLY)) return out
    if (t.con.mode & CON_AXIS0) out.push(t.spacemtx[0])
    if (t.con.mode & CON_AXIS1) out.push(t.spacemtx[1])
    if (t.con.mode & CON_AXIS2) out.push(t.spacemtx[2])
    return out
}

/**
 * Transform orientations, ported from `editors/transform/transform_orientations.cc`.
 *
 * An orientation is a 3x3 basis in world space: `global` is the identity, `local` the object's
 * axes, `view` the camera's, `normal` a frame built from the selection (Z along the averaged
 * normal, Y along an edge or tangent), `cursor` the 3D cursor's rotation. The modal transform uses
 * it as `spacemtx`, the space axis keys constrain to.
 */

import {BMEdge, BMesh, BMVert, ElemFlag} from '@threepipe/mesh-kernel'
import {
    addV3,
    copyM3,
    crossV3,
    dotV3,
    invertM3,
    isZeroV3,
    lenSquaredV3,
    m3FromM4,
    Mat3,
    Mat4,
    mulM3V3,
    negV3,
    normalizeM3,
    normalizeV3,
    normalizedV3,
    normalTriV3,
    orthoV3V3,
    projectPlaneNormalizedV3V3V3,
    subV3,
    transposeM3,
    unitM3,
    Vec3,
    axisDominantV3ToM3,
} from './math'
import {
    BMEditElem,
    edgeCalcLengthSquared,
    edgeExists,
    edgeIsBoundary,
    edgeOrderedVerts,
    editselectionNormal,
    editselectionPlane,
    faceCalcTangentPairAuto,
    faceNo,
    vertCo,
    vertEdgePair,
    vertNo,
    vertTriCalcTangentFromEdge,
} from './bmeshQuery'
import type {OrientationType, PivotType} from './types'
import type {TransformView} from './view'

export const ORIENTATION_NONE = 0
export const ORIENTATION_NORMAL = 1
export const ORIENTATION_VERT = 2
export const ORIENTATION_EDGE = 3
export const ORIENTATION_FACE = 4

/** `transform_orientations_create_from_axis` (`transform_orientations.cc:340`). */
export function orientationsCreateFromAxis(x: Vec3 | null, y: Vec3 | null, z: Vec3 | null): {mat: Mat3, ok: boolean} {
    const isZero = [true, true, true]
    const mat: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    if (x) {
        mat[0] = [x[0], x[1], x[2]]
        isZero[0] = normalizeV3(mat[0]) === 0
    }
    if (y) {
        mat[1] = [y[0], y[1], y[2]]
        isZero[1] = normalizeV3(mat[1]) === 0
    }
    if (z) {
        mat[2] = [z[0], z[1], z[2]]
        isZero[2] = normalizeV3(mat[2]) === 0
    }
    const zeroAxis = (isZero[0] ? 1 : 0) + (isZero[1] ? 1 : 0) + (isZero[2] ? 1 : 0)
    if (zeroAxis === 0) return {mat, ok: true}
    if (zeroAxis === 1) {
        const axis = isZero[0] ? 0 : isZero[1] ? 1 : 2
        mat[axis] = crossV3(mat[(axis + 1) % 3], mat[(axis + 2) % 3])
        if (normalizeV3(mat[axis]) !== 0) return {mat, ok: true}
    } else if (zeroAxis === 2) {
        const axis = !isZero[0] ? 0 : !isZero[1] ? 1 : 2
        const a = (axis + 1) % 3
        const b = (axis + 2) % 3
        mat[a] = [0, 0, 0]
        mat[b] = [0, 0, 0]
        mat[a][a] = 1
        mat[b][b] = 1
        mat[a] = projectPlaneNormalizedV3V3V3(mat[a], mat[axis])
        mat[b] = projectPlaneNormalizedV3V3V3(mat[b], mat[axis])
        if (normalizeV3(mat[a]) !== 0 && normalizeV3(mat[b]) !== 0) return {mat, ok: true}
    }
    return {mat: unitM3(), ok: false}
}

/** `createSpaceNormal` (`transform_orientations.cc:388`): a frame with Z along `normal`. */
export function createSpaceNormal(normal: Vec3): Mat3 | null {
    const mat: Mat3 = [[0, 0, 0], [0, 0, 0], [normal[0], normal[1], normal[2]]]
    if (normalizeV3(mat[2]) === 0) return null
    let tangent: Vec3 = [0, 0, 1]
    mat[0] = crossV3(mat[2], tangent)
    if (isZeroV3(mat[0])) {
        tangent = [1, 0, 0]
        mat[0] = crossV3(tangent, mat[2])
    }
    mat[1] = crossV3(mat[2], mat[0])
    return normalizeM3(mat)
}

/** `createSpaceNormalTangent` (`transform_orientations.cc:411`). Both inputs unit length. */
export function createSpaceNormalTangent(normal: Vec3, tangent: Vec3): Mat3 | null {
    if (isZeroV3(normal)) return null
    const mat: Mat3 = [[0, 0, 0], [0, 0, 0], [normal[0], normal[1], normal[2]]]
    // Negate so we can use values from the matrix as input.
    mat[1] = negV3(tangent)
    if (isZeroV3(mat[1])) mat[1][2] = 1
    mat[0] = crossV3(mat[2], mat[1])
    if (normalizeV3(mat[0]) === 0) return null
    // Make the tangent orthogonal.
    mat[1] = crossV3(mat[2], mat[0])
    if (normalizeV3(mat[1]) === 0) return null
    return mat
}

/** `createSpaceNormalTangent_or_fallback` (`transform_orientations.cc:451`). */
export function createSpaceNormalTangentOrFallback(normal: Vec3, tangent: Vec3): Mat3 {
    const m = createSpaceNormalTangent(normal, tangent)
    if (m) return m
    if (!isZeroV3(normal)) return invertM3(axisDominantV3ToM3(normal))
    return unitM3()
}

function selectedVertsN(bm: BMesh, n: number): BMVert[] {
    const out: BMVert[] = []
    for (const v of bm.verts) {
        if (v.hflag & ElemFlag.Select) {
            out.push(v)
            if (out.length === n) break
        }
    }
    return out
}

function selectedEdgesN(bm: BMesh, n: number): BMEdge[] {
    const out: BMEdge[] = []
    for (const e of bm.edges) {
        if (e.hflag & ElemFlag.Select) {
            out.push(e)
            if (out.length === n) break
        }
    }
    return out
}

/** The active element: the last entry of the selection history, if it is still selected. */
export function selectHistoryActiveGet(bm: BMesh): BMEditElem | null {
    const h = bm.selectHistory
    if (!h.length) return null
    const elem = h[h.length - 1].elem
    return elem.hflag & ElemFlag.Select ? elem : null
}

/** The element before the active one in the history, for `BM_editselection_plane`. */
function selectHistoryPrev(bm: BMesh): BMEditElem | null {
    const h = bm.selectHistory
    return h.length >= 2 ? h[h.length - 2].elem : null
}

/**
 * `getTransformOrientation_ex` for an edit mesh (`transform_orientations.cc:952-1228`,
 * then `:1446` for the world-space conversion). Returns the orientation kind with the normal and
 * plane (tangent) in world space.
 */
export function getTransformOrientation(bm: BMesh, objectMatrix: Mat4, around: PivotType): {type: number, normal: Vec3, plane: Vec3} {
    let result = ORIENTATION_NONE
    const activeOnly = around === 'active'
    let normal: Vec3 = [0, 0, 0]
    let plane: Vec3 = [0, 0, 0]

    // We need the transpose of the inverse for a normal.
    const mat = transposeM3(invertM3(m3FromM4(objectMatrix)))

    const active = activeOnly ? selectHistoryActiveGet(bm) : null
    if (active) {
        normal = editselectionNormal(active)
        plane = editselectionPlane(active, selectHistoryPrev(bm))
        result = active instanceof BMVert ? ORIENTATION_VERT : active instanceof BMEdge ? ORIENTATION_EDGE : ORIENTATION_FACE
    } else if (bm.totfacesel >= 1) {
        let no: Vec3 = [0, 0, 0]
        const planePair: [Vec3, Vec3] = [[0, 0, 0], [0, 0, 0]]
        let faceCount = 0
        for (const efa of bm.faces) {
            if (!(efa.hflag & ElemFlag.Select)) continue
            const [ta, tb] = faceCalcTangentPairAuto(efa)
            no = addV3(no, faceNo(efa))
            planePair[0] = addV3(planePair[0], ta)
            planePair[1] = addV3(planePair[1], tb)
            faceCount++
        }
        // Pick the best plane (least likely to be co-linear), see #96535.
        let planeIndex: number
        if (faceCount === 1) {
            // A single face always matches the active-element orientation, see #134948.
            planeIndex = 0
        } else {
            const normalUnit = normalizedV3(no)
            const p0 = normalizedV3(planePair[0])
            const p1 = normalizedV3(planePair[1])
            const o0 = crossV3(normalUnit, p0)
            const o1 = crossV3(normalUnit, p1)
            planeIndex = lenSquaredV3(o0) > lenSquaredV3(o1) ? 0 : 1
        }
        normal = addV3(normal, no)
        plane = addV3(plane, planePair[planeIndex])
        result = ORIENTATION_FACE
    } else if (bm.totvertsel === 3) {
        const vTri = selectedVertsN(bm, 3) as [BMVert, BMVert, BMVert]
        normal = normalTriV3(vertCo(vTri[0]), vertCo(vTri[1]), vertCo(vTri[2]))
        // Check if the normal is pointing opposite to vert normals.
        const noTest = addV3(addV3(vertNo(vTri[0]), vertNo(vTri[1])), vertNo(vTri[2]))
        if (dotV3(noTest, normal) < 0) normal = negV3(normal)

        let e: BMEdge | null = null
        let eLength = 0
        if (bm.totedgesel >= 1) {
            // Find an edge that is part of the triangle (the longest selected one).
            for (let j = 0; j < 3; j++) {
                const eTest = edgeExists(vTri[j], vTri[(j + 1) % 3])
                if (eTest && eTest.hflag & ElemFlag.Select) {
                    const l = edgeCalcLengthSquared(eTest)
                    if (e === null || eLength < l) {
                        e = eTest
                        eLength = l
                    }
                }
            }
        }
        if (e) {
            const vPair = edgeIsBoundary(e) ? edgeOrderedVerts(e) : [e.v1, e.v2]
            plane = subV3(vertCo(vPair[0]), vertCo(vPair[1]))
        } else {
            plane = vertTriCalcTangentFromEdge(vTri)
        }
        result = ORIENTATION_FACE
    } else if (bm.totedgesel === 1 || bm.totvertsel === 2) {
        let vPair: [BMVert, BMVert] | null = null
        let eed: BMEdge | null = null
        if (bm.totedgesel === 1) {
            eed = selectedEdgesN(bm, 1)[0] ?? null
            if (eed) vPair = [eed.v1, eed.v2]
        } else {
            const vs = selectedVertsN(bm, 2)
            if (vs.length === 2) vPair = [vs[0], vs[1]]
        }
        if (vPair) {
            // Point the Y axis along the edge (towards the active vertex); Z outwards along the normals.
            let swap = false
            const activeVert = selectHistoryActiveGet(bm)
            if (activeVert instanceof BMVert && activeVert === vPair[1]) {
                swap = true
            } else if (eed && edgeIsBoundary(eed)) {
                // Predictable direction for boundary edges.
                if (eed.l!.v !== vPair[0]) swap = true
            }
            if (swap) vPair = [vPair[1], vPair[0]]

            normal = addV3(vertNo(vPair[1]), vertNo(vPair[0]))
            plane = subV3(vertCo(vPair[1]), vertCo(vPair[0]))
            if (normalizeV3(plane) !== 0) {
                // For edges it is important the matrix can rotate around the edge.
                normal = projectPlaneNormalizedV3V3V3(normal, plane)
                if (normalizeV3(normal) === 0) normal = orthoV3V3(plane)
            }
        }
        result = ORIENTATION_EDGE
    } else if (bm.totvertsel === 1) {
        const v = selectedVertsN(bm, 1)[0]
        if (v) {
            normal = vertNo(v)
            const pair = vertEdgePair(v)
            if (pair) {
                let swap = false
                let vPair: [BMVert, BMVert] = [pair[0].otherVert(v), pair[1].otherVert(v)]
                if (edgeIsBoundary(pair[0])) {
                    if (pair[0].l!.v !== v) swap = true
                } else if (edgeCalcLengthSquared(pair[0]) < edgeCalcLengthSquared(pair[1])) {
                    swap = true
                }
                if (swap) vPair = [vPair[1], vPair[0]]
                const d0 = normalizedV3(subV3(vertCo(v), vertCo(vPair[0])))
                const d1 = normalizedV3(subV3(vertCo(vPair[1]), vertCo(v)))
                plane = addV3(d0, d1)
            }
        }
        result = isZeroV3(plane) ? ORIENTATION_VERT : ORIENTATION_EDGE
    } else if (bm.totvertsel > 3) {
        normal = [0, 0, 0]
        for (const v of bm.verts) if (v.hflag & ElemFlag.Select) normal = addV3(normal, vertNo(v))
        normalizeV3(normal)
        result = ORIENTATION_VERT
    }

    // Not needed but this matches 2.68 and older behavior.
    plane = negV3(plane)

    // Into world space (`transform_orientations.cc:1446`).
    normal = mulM3V3(mat, normal)
    plane = mulM3V3(mat, plane)
    normalizeV3(normal)
    normalizeV3(plane)
    return {type: result, normal, plane}
}

/**
 * `ED_getTransformOrientationMatrix` (`transform_orientations.cc:1546`): the normal orientation of
 * an edit-mesh selection as a world-space basis.
 */
export function getTransformOrientationMatrix(bm: BMesh, objectMatrix: Mat4, around: PivotType): Mat3 {
    const r = getTransformOrientation(bm, objectMatrix, around)
    let type = r.type
    // Fallback, when the plane can't be calculated.
    if ((type === ORIENTATION_EDGE || type === ORIENTATION_FACE || type === ORIENTATION_NORMAL) && isZeroV3(r.plane)) {
        type = ORIENTATION_VERT
    }
    let mat: Mat3 | null = null
    switch (type) {
    case ORIENTATION_NORMAL:
    case ORIENTATION_EDGE:
    case ORIENTATION_FACE:
        mat = createSpaceNormalTangent(r.normal, r.plane)
        break
    case ORIENTATION_VERT:
        mat = createSpaceNormal(r.normal)
        break
    default:
        break
    }
    return mat ?? unitM3()
}

export interface OrientationContext {
    /** The object's world matrix (column-major 4x4). */
    objectMatrix: Mat4
    view: TransformView
    /** The edit mesh, for `normal`. */
    bm?: BMesh | null
    around: PivotType
    /** The 3D cursor's rotation, for `cursor`. */
    cursorMatrix?: Mat3
    /** A caller-supplied basis, for `custom`. */
    customMatrix?: Mat3
    /** In object mode `normal` means `local`, as `calc_orientation_from_type_ex` falls through. */
    objectMode?: boolean
}

/**
 * `calc_orientation_from_type_ex` (`transform_orientations.cc:667`): the world-space basis of an
 * orientation type.
 */
export function calcOrientationFromType(type: OrientationType, ctx: OrientationContext): Mat3 {
    switch (type) {
    case 'normal':
        if (ctx.bm && !ctx.objectMode) return getTransformOrientationMatrix(ctx.bm, ctx.objectMatrix, ctx.around)
        // In object mode 'normal' is 'local'.
        return calcOrientationFromType('local', ctx)
    case 'local': {
        const m = m3FromM4(ctx.objectMatrix)
        return orientationsCreateFromAxis(m[0], m[1], m[2]).mat
    }
    case 'view': {
        const m = m3FromM4(ctx.view.viewinv)
        return normalizeM3(m)
    }
    case 'cursor':
        return ctx.cursorMatrix ? copyM3(ctx.cursorMatrix) : unitM3()
    case 'custom':
        return ctx.customMatrix ? copyM3(ctx.customMatrix) : unitM3()
    case 'global':
    default:
        return unitM3()
    }
}

/** `transform_orientations_spacename_get`: the word the header uses. */
export function orientationSpaceName(type: OrientationType): string {
    switch (type) {
    case 'global': return 'global'
    case 'local': return 'local'
    case 'normal': return 'normal'
    case 'view': return 'view'
    case 'cursor': return 'cursor'
    case 'custom': return 'custom'
    }
}

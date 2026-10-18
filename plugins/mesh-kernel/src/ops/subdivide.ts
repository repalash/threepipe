/**
 * Edge subdivision with Blender's fill patterns.
 *
 * Port of `source/blender/bmesh/operators/bmo_subdivide.cc`: `bmo_subdivide_edges_exec` and
 * `BM_mesh_esubdivide`, with every pattern (`quad_1edge`, `quad_2edge_path`, `quad_2edge_innervert`,
 * `quad_2edge_fan`, `quad_3edge`, `quad_4edge`, `tri_1edge`, `tri_3edge`), the no-pattern two-edge
 * case for n-gons, `alter_co`'s sphere and smooth branches (dual-sphere slerp blend, falloff,
 * `use_smooth_even`), `edge_percents` and the four `SUBDIV_SELECT_*` selection results. Line numbers
 * in the comments are into that file. `BM_vert_pair_share_face_by_len` comes from `bmesh_query.cc`.
 *
 * Not ported yet, and said so rather than approximated:
 * - `use_fractal` (`alter_co`, `:323`): the displacement needs `BLI_noise_generic_turbulence`
 *   (`blenlib/intern/noise.cc`) and `BLI_rng` for the seed offset. Plan 12 scopes fractal out of
 *   track L; passing a non-zero `fractal` throws instead of silently ignoring it.
 * - shape keys: the kernel has no `CD_SHAPEKEY` layers; the temporary layer Blender adds for staging
 *   is {@link SubDParams.staged}, and the "apply the difference to the other keys" loop (`:355`) has
 *   nothing to apply to.
 *
 * Operator flags (`SUBD_SPLIT`, `EDGE_PERCENT`, `FACE_CUSTOMFILL`, `ELE_INNER`, `ELE_SPLIT`) are a
 * per-run map rather than Blender's tool-flag layer, cleared when the function returns.
 */

import {BMEdge, BMElemAny, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {splitFaceMakeEdge} from '../bmesh/euler'
import {edgeSplit} from '../bmesh/mods'
import {edgeSelectSet, elemSelectSet, selectFlushFromVerts, selectNone} from '../bmesh/marking'
import {AttrName, ElemFlag} from '../constants'
import {Vec3, v3add, v3cross, v3dot, v3lerp, v3mul, v3normalize, v3sub} from '../math'
import {
    interpV3V3V3Slerp,
    isectPlanePlanePlaneV3,
    lenSquaredV3V3,
    normalizeV3Len,
    normalizeV3Length,
    planeFromPointNormalV3,
    projectV3Plane,
    reflectV3V3V3,
    shellV3V3MidNormalizedToDist,
} from '../math/geom'
import {setComponent} from '../bmesh/customdata'

/** `SUBD_FALLOFF_*` (`bmesh_operators.hh:29`), by their Python names. */
export type SubdFalloff = 'smooth' | 'sphere' | 'root' | 'sharp' | 'linear' | 'inverseSquare'

/** `bmesh_subd_falloff_calc` (`bmesh_query.cc:2477`). */
export function subdFalloffCalc(falloff: SubdFalloff, val: number): number {
    switch (falloff) {
    case 'smooth': return 3 * val * val - 2 * val * val * val
    case 'sphere': return Math.sqrt(2 * val - val * val)
    case 'root': return Math.sqrt(val)
    case 'sharp': return val * val
    case 'linear': return val
    case 'inverseSquare': return val * (2 - val)
    }
}

/** `SUBD_CORNER_*` (`bmesh_operators.hh:22`): what a quad with two adjacent cut edges does at the corner. */
export type SubdQuadCornerType = 'straightCut' | 'innerVert' | 'path' | 'fan'

/** `SUBDIV_SELECT_*` (`bmesh_operators.hh:39`): what `BM_mesh_esubdivide` leaves selected. */
export type SubdivideSelectType = 'none' | 'orig' | 'inner' | 'loopcut'

export interface SubdivideEdgesOptions {
    /** `cuts`: vertices inserted per edge. */
    cuts: number
    /** `smooth`: displacement towards a sphere through the edge's vertex normals; 0 for straight. */
    smooth?: number
    /** `smooth_falloff`: how the smoothing fades towards the edge ends. Default `linear` (= no fade). */
    smoothFalloff?: SubdFalloff
    /** `use_smooth_even`: scale the smoothing by the normals' shell distance. */
    useSmoothEven?: boolean
    /** `fractal`: **not ported** - must be 0. */
    fractal?: number
    /** `along_normal`: only read with fractal. */
    alongNormal?: number
    /** `seed`: only read with fractal. */
    seed?: number
    /** `quad_corner_type`. Default `straightCut` (no two-edge quad pattern). */
    quadCornerType?: SubdQuadCornerType
    /** `use_grid_fill`: fill quads with all four edges cut and triangles with all three as grids. */
    useGridFill?: boolean
    /** `use_single_edge`: fan a quad or triangle with one cut edge. */
    useSingleEdge?: boolean
    /** `use_only_quads`: match patterns on quads only. */
    useOnlyQuads?: boolean
    /** `use_sphere`: project onto a sphere of radius `smooth` (the icosphere). */
    useSphere?: boolean
    /** `edge_percents`: with one cut, where along the edge (0..1 from `v1`) to put it. */
    edgePercents?: Map<BMEdge, number>
    /** `custom_patterns`: force a pattern on a face; it must still match the face's cut edges. */
    customPatterns?: Map<BMFace, SubdPatternName>
}

export interface SubdivideGeom {
    verts: BMVert[]
    edges: BMEdge[]
    faces: BMFace[]
}

export interface SubdivideEdgesResult {
    /** `geom_inner.out`: the vertices, edges and faces created inside the faces (`ELE_INNER`). */
    inner: SubdivideGeom
    /** `geom_split.out`: the vertices and edge halves made by the edge splits (`ELE_SPLIT`). */
    split: SubdivideGeom
    /** `geom.out`: everything the operator touched, the input edges included. */
    geom: SubdivideGeom
}

export type SubdPatternName =
    | 'quad_1edge' | 'quad_2edge_path' | 'quad_2edge_innervert' | 'quad_2edge_fan' | 'quad_3edge' | 'quad_4edge'
    | 'tri_1edge' | 'tri_3edge'

// Flags for all elements share a common bit-field space (`:95`).
const SUBD_SPLIT = 1
const EDGE_PERCENT = 2
const FACE_CUSTOMFILL = 4
const ELE_INNER = 8
const ELE_SPLIT = 16

/** A value of 0.00005 means we get face splits at a little under 1.0 degrees, see #32665. */
const FLT_FACE_SPLIT_EPSILON = 0.00005

/** A vertex's position and normal frozen at a point in time: Blender's `v1_tmp = *edge->v1` copies. */
interface VertSnapshot {
    co: Vec3
    no: Vec3
}

const snapshotOf = (v: BMVert): VertSnapshot => ({co: [v.x, v.y, v.z], no: [v.nx, v.ny, v.nz]})
const liveOf = (v: BMVert): VertSnapshot => snapshotOf(v)

/** `SubDParams` (`:30`) plus the per-run flag map and the staged-coordinate layer. */
interface SubDParams {
    numcuts: number
    smooth: number
    smoothFalloff: SubdFalloff
    useSmooth: boolean
    useSmoothEven: boolean
    useSphere: boolean
    edgePercents: Map<BMEdge, number> | undefined
    oflag: Map<BMElemAny, number>
    /** The temporary `CD_SHAPEKEY` layer: altered coordinates, flushed to `v.co` at Blender's two points. */
    staged: Map<BMVert, Vec3>
}

const flagTest = (p: SubDParams, el: BMElemAny, f: number): boolean => ((p.oflag.get(el) ?? 0) & f) !== 0
const flagEnable = (p: SubDParams, el: BMElemAny, f: number): void => { p.oflag.set(el, (p.oflag.get(el) ?? 0) | f) }

// region queries (`bmesh_query.cc`)

/** Every loop that points at `v`: Blender's `BM_LOOPS_OF_VERT` iterator (`bmesh_iterators.cc`). */
function* loopsOfVert(v: BMVert): Generator<BMLoop> {
    if (!v.e) return
    let e: BMEdge = v.e
    do {
        if (e.l) {
            let l: BMLoop = e.l
            do {
                if (l.v === v) yield l
                l = l.radialNext!
            } while (l !== e.l)
        }
        e = e.diskNext(v)!
    } while (e !== v.e)
}

/** The loop of `f` at `v`, or null. Port of `BM_face_vert_share_loop`. */
function faceVertShareLoop(f: BMFace, v: BMVert): BMLoop | null {
    for (const l of f.eachLoop()) if (l.v === v) return l
    return null
}

/** `BM_loop_is_adjacent` (`bmesh_query_inline.hh:127`): are two loops of a face neighbours? */
function loopIsAdjacent(a: BMLoop, b: BMLoop): boolean {
    return b === a.next || b === a.prev
}

/** `BM_vert_in_face`. */
function vertInFace(v: BMVert, f: BMFace): boolean {
    return faceVertShareLoop(f, v) !== null
}

/** `BM_edge_share_vert_check`. */
function edgeShareVertCheck(e1: BMEdge, e2: BMEdge): boolean {
    return e1.v1 === e2.v1 || e1.v1 === e2.v2 || e1.v2 === e2.v1 || e1.v2 === e2.v2
}

/**
 * The smallest face both vertices belong to, with the loop of each.
 *
 * Port of `BM_vert_pair_share_face_by_len` (`bmesh_query.cc:176`). "Smallest" matters: a vertex pair
 * can be shared by several faces once a grid fill is under way, and splitting the smallest is what
 * keeps `connect_smallest_face` cutting the cell it just made rather than the whole triangle again.
 */
export function vertPairShareFaceByLen(
    vA: BMVert, vB: BMVert, allowAdjacent: boolean,
): {f: BMFace, lA: BMLoop, lB: BMLoop} | null {
    let fCur: BMFace | null = null
    let lCurA: BMLoop | null = null
    let lCurB: BMLoop | null = null
    if (vA.e && vB.e) {
        for (const lA of loopsOfVert(vA)) {
            if (fCur === null || lA.f.len < fCur.len) {
                const lB = faceVertShareLoop(lA.f, vB)
                if (lB && (allowAdjacent || !loopIsAdjacent(lA, lB))) {
                    fCur = lA.f
                    lCurA = lA
                    lCurB = lB
                }
            }
        }
    }
    return fCur ? {f: fCur, lA: lCurA!, lB: lCurB!} : null
}

// endregion

/**
 * `connect_smallest_face` (`:126`): split the smallest face the two vertices share along a new edge.
 * Blender allows adjacent loops in the query and then asserts they are not adjacent, so a degenerate
 * split is a bug in the caller rather than something to swallow; `splitFaceMakeEdge` raises it.
 */
function connectSmallestFace(bm: BMesh, vA: BMVert, vB: BMVert): {e: BMEdge, fNew: BMFace} | null {
    const share = vertPairShareFaceByLen(vA, vB, true)
    if (!share) return null
    const {fNew, lNew} = splitFaceMakeEdge(bm, share.f, share.lA, share.lB)
    return {e: lNew.e!, fNew}
}

/**
 * `interp_slerp_co_no_v3` (`:159`): specialized slerp that uses a sphere defined by each point's
 * normal. `noDir` is the normalised `co_a - co_b`, which the caller already knows.
 */
function interpSlerpCoNoV3(coA: Vec3, noA: Vec3, coB: Vec3, noB: Vec3, noDir: Vec3, fac: number): Vec3 {
    // Center of the sphere defined by both normals.
    let center: Vec3 | null = null
    {
        const noMid = v3add(noA, noB)
        normalizeV3Len(noMid)

        // Axis of slerp.
        const noOrtho = v3cross(noMid, noDir)
        if (normalizeV3Len(noOrtho) !== 0) {
            // Create planes.
            let vANoOrtho = v3cross(noOrtho, noA)
            let vBNoOrtho = v3cross(noOrtho, noB)
            vANoOrtho = projectV3Plane(vANoOrtho, noOrtho, vANoOrtho)
            vBNoOrtho = projectV3Plane(vBNoOrtho, noOrtho, vBNoOrtho)

            const planeA = planeFromPointNormalV3(coA, vANoOrtho)
            const planeB = planeFromPointNormalV3(coB, vBNoOrtho)
            const planeC = planeFromPointNormalV3(coB, noOrtho)

            // Find the sphere center from 3 planes.
            center = isectPlanePlanePlaneV3(planeA, planeB, planeC)
        }
        if (center === null) center = v3mul(v3add(coA, coB), 0.5)
    }

    // Calculate the final output.
    const ofsA = v3sub(coA, center)
    const ofsB = v3sub(coB, center)
    const distA = normalizeV3Len(ofsA)
    const distB = normalizeV3Len(ofsB)

    const ofsSlerp = interpV3V3V3Slerp(ofsA, ofsB, fac)
    if (ofsSlerp) {
        // `interpf(dist_b, dist_a, fac)` = `(dist_b * fac) + (dist_a * (1 - fac))`.
        const r = distB * fac + distA * (1 - fac)
        return [center[0] + ofsSlerp[0] * r, center[1] + ofsSlerp[1] * r, center[2] + ofsSlerp[2] * r]
    }
    return v3lerp(coA, coB, fac)
}

/**
 * `alter_co` (`:238`): the sphere, smooth and (not ported) fractal displacement of a vertex, written
 * to the staged layer rather than the vertex.
 */
function alterCo(v: BMVert, params: SubDParams, perc: number, vA: VertSnapshot, vB: VertSnapshot): void {
    let co: Vec3 = [v.x, v.y, v.z]

    if (params.useSphere) {
        // Subdivide sphere.
        normalizeV3Length(co, params.smooth)
    } else if (params.useSmooth) {
        // Calculating twice and blending gives smoother results, removing visible seams
        // (`USE_SPHERE_DUAL_BLEND`).
        const epsUnitVec = 1e-5
        const noDir = v3sub(vA.co, vB.co)
        normalizeV3Len(noDir)

        // Sphere-a.
        let noReflect = reflectV3V3V3(vA.no, noDir)
        let coA: Vec3
        if (lenSquaredV3V3(vA.no, noReflect) < epsUnitVec) {
            coA = v3lerp(vA.co, vB.co, perc)
        } else {
            coA = interpSlerpCoNoV3(vA.co, vA.no, vB.co, noReflect, noDir, perc)
        }

        // Sphere-b.
        noReflect = reflectV3V3V3(vB.no, noDir)
        let coB: Vec3
        if (lenSquaredV3V3(vB.no, noReflect) < epsUnitVec) {
            coB = v3lerp(vA.co, vB.co, perc)
        } else {
            coB = interpSlerpCoNoV3(vA.co, noReflect, vB.co, vB.no, noDir, perc)
        }

        // Blend both spheres.
        co = v3lerp(coA, coB, perc)

        // Apply falloff.
        let smooth: number
        if (params.smoothFalloff === 'linear') {
            smooth = 1
        } else {
            smooth = Math.abs(1 - 2 * Math.abs(0.5 - perc))
            smooth = 1 + subdFalloffCalc(params.smoothFalloff, smooth)
        }

        if (params.useSmoothEven) {
            smooth *= shellV3V3MidNormalizedToDist(vA.no, vB.no)
        }

        smooth *= params.smooth
        if (smooth !== 1) {
            const coFlat = v3lerp(vA.co, vB.co, perc)
            co = v3lerp(coFlat, co, smooth)
        }
    }

    params.staged.set(v, co)
}

/**
 * `bm_subdivide_edge_addvert` (`:373`): split the edge at `factorEdgeSplit` from its `v1`, flag the
 * vertex inner, displace it and give it the interpolated normal.
 */
function subdivideEdgeAddvert(
    bm: BMesh, edge: BMEdge, params: SubDParams, factorEdgeSplit: number, factorSubd: number,
    vA: VertSnapshot, vB: VertSnapshot,
): {v: BMVert, e: BMEdge} {
    // `BM_edge_split` (`bmesh_mods.cc:478`): the new half takes the edge's header flags raw,
    // selection included (`:518`).
    const {vNew, eNew} = edgeSplit(bm, edge, edge.v1, factorEdgeSplit)

    flagEnable(params, vNew, ELE_INNER)

    // Offset for smooth or sphere or fractal.
    alterCo(vNew, params, factorSubd, vA, vB)

    const no = v3normalize(v3lerp(vA.no, vB.no, factorSubd))
    vNew.nx = no[0]
    vNew.ny = no[1]
    vNew.nz = no[2]

    return {v: vNew, e: eNew}
}

/** `subdivide_edge_num` (`:413`): the `curpoint`-th of `totpoint` cuts along `edge`. */
function subdivideEdgeNum(
    bm: BMesh, edge: BMEdge, curpoint: number, totpoint: number, params: SubDParams,
    vA: VertSnapshot, vB: VertSnapshot,
): {v: BMVert, e: BMEdge} {
    let factorEdgeSplit: number
    let factorSubd: number
    if (flagTest(params, edge, EDGE_PERCENT) && totpoint === 1) {
        factorEdgeSplit = params.edgePercents!.get(edge)!
        factorSubd = 0
    } else {
        factorEdgeSplit = 1 / (totpoint + 1 - curpoint)
        factorSubd = (curpoint + 1) / (totpoint + 1)
    }
    return subdivideEdgeAddvert(bm, edge, params, factorEdgeSplit, factorSubd, vA, vB)
}

/**
 * `bm_subdivide_multicut` (`:440`). Blender keeps splitting the *same* edge object: `BM_edge_split`
 * hands the near half to the new edge and leaves the far half in `eed`, which therefore walks along
 * the original edge as the factor `1 / (numcuts + 1 - i)` shrinks it. The endpoints are copied first
 * so every cut interpolates the original, un-displaced edge.
 */
function subdivideMulticut(bm: BMesh, edge: BMEdge, params: SubDParams, vA: VertSnapshot, vB: VertSnapshot): void {
    const eed = edge
    const v1 = edge.v1
    const v2 = edge.v2
    const v1Tmp = snapshotOf(v1)
    const v2Tmp = snapshotOf(v2)
    const numcuts = params.numcuts

    for (let i = 0; i < numcuts; i++) {
        const {v, e: eNew} = subdivideEdgeNum(bm, eed, i, params.numcuts, params, vA, vB)
        flagEnable(params, v, SUBD_SPLIT | ELE_SPLIT)
        flagEnable(params, eed, SUBD_SPLIT | ELE_SPLIT)
        flagEnable(params, eNew, SUBD_SPLIT | ELE_SPLIT)
    }

    alterCo(v1, params, 0, v1Tmp, v2Tmp)
    alterCo(v2, params, 1, v1Tmp, v2Tmp)
}

// region patterns (`:470-890`)
//
// The patterns are rotated as necessary to match the input geometry; they are based on the pre-split
// state of the face. `verts` starts at the first new vert cut, not the first vert in the face.

type PatternFill = (bm: BMesh, face: BMFace, verts: BMVert[], params: SubDParams) => void

interface SubDPattern {
    name: SubdPatternName
    /** Selected edges mask, for splitting. */
    seledges: number[]
    connectexec: PatternFill
    /** Total number of verts, before any subdivision. */
    len: number
}

/**
 * <pre>
 *  v3---------v2
 *  |          |
 *  v4---v0---v1
 * </pre>
 * `quad_1edge_split` (`:484`).
 */
const quad1edgeSplit: PatternFill = (bm, _face, verts, params) => {
    const numcuts = params.numcuts
    let add: number
    // If it's odd, the middle face is a quad, otherwise it's a triangle.
    if (numcuts % 2 === 0) {
        add = 2
        for (let i = 0; i < numcuts; i++) {
            if (i === numcuts / 2) add -= 1
            connectSmallestFace(bm, verts[i], verts[numcuts + add])
        }
    } else {
        add = 2
        for (let i = 0; i < numcuts; i++) {
            connectSmallestFace(bm, verts[i], verts[numcuts + add])
            if (i === Math.trunc(numcuts / 2)) {
                add -= 1
                connectSmallestFace(bm, verts[i], verts[numcuts + add])
            }
        }
    }
}

/**
 * <pre>
 *  v6--------v5
 *  |          |
 *  |          |v4s
 *  |          |v3s
 *  |   s  s   |
 *  v7-v0--v1-v2
 * </pre>
 * `quad_2edge_split_path` (`:530`).
 */
const quad2edgeSplitPath: PatternFill = (bm, _face, verts, params) => {
    const numcuts = params.numcuts
    for (let i = 0; i < numcuts; i++) {
        connectSmallestFace(bm, verts[i], verts[numcuts + (numcuts - i)])
    }
    connectSmallestFace(bm, verts[numcuts * 2 + 3], verts[numcuts * 2 + 1])
}

/** `quad_2edge_split_innervert` (`:560`), same layout. */
const quad2edgeSplitInnervert: PatternFill = (bm, _face, verts, params) => {
    const numcuts = params.numcuts
    let vLast = verts[numcuts]

    for (let i = numcuts - 1; i >= 0; i--) {
        const e = connectSmallestFace(bm, verts[i], verts[numcuts + (numcuts - i)])!.e

        const {v} = subdivideEdgeAddvert(bm, e, params, 0.5, 0.5, liveOf(e.v1), liveOf(e.v2))

        if (i !== numcuts - 1) connectSmallestFace(bm, vLast, v)

        vLast = v
    }

    connectSmallestFace(bm, vLast, verts[numcuts * 2 + 2])
}

/** `quad_2edge_split_fan` (`:604`), same layout. */
const quad2edgeSplitFan: PatternFill = (bm, _face, verts, params) => {
    const numcuts = params.numcuts
    for (let i = 0; i < numcuts; i++) {
        connectSmallestFace(bm, verts[i], verts[numcuts * 2 + 2])
        connectSmallestFace(bm, verts[numcuts + (numcuts - i)], verts[numcuts * 2 + 2])
    }
}

/**
 * <pre>
 *      s   s
 *  v8--v7--v6-v5
 *  |          |
 *  |          v4 s
 *  |          |
 *  |          v3 s
 *  |   s  s   |
 *  v9-v0--v1-v2
 * </pre>
 * `quad_3edge_split` (`:639`).
 */
const quad3edgeSplit: PatternFill = (bm, _face, verts, params) => {
    const numcuts = params.numcuts
    let add = 0
    for (let i = 0; i < numcuts; i++) {
        if (i === Math.trunc(numcuts / 2)) {
            if (numcuts % 2 !== 0) {
                connectSmallestFace(bm, verts[numcuts - i - 1 + add], verts[i + numcuts + 1])
            }
            add = numcuts * 2 + 2
        }
        connectSmallestFace(bm, verts[numcuts - i - 1 + add], verts[i + numcuts + 1])
    }

    for (let i = 0; i < Math.trunc(numcuts / 2) + 1; i++) {
        connectSmallestFace(bm, verts[i], verts[numcuts - i + numcuts * 2 + 1])
    }
}

/**
 * <pre>
 *            v8--v7-v6--v5
 *            |     s    |
 *            |v9 s     s|v4
 * first line |          |   last line
 *            |v10s s   s|v3
 *            v11-v0--v1-v2
 *
 *            it goes from bottom up
 * </pre>
 * `quad_4edge_subdivide` (`:680`).
 */
const quad4edgeSubdivide: PatternFill = (bm, _face, verts, params) => {
    const numcuts = params.numcuts
    const s = numcuts + 2
    // A 2-dimensional array of verts, containing every vert (and all new ones) in the face.
    const lines: (BMVert | null)[] = new Array(s * s).fill(null)

    // First line.
    for (let i = 0; i < numcuts + 2; i++) {
        lines[i] = verts[numcuts * 3 + 2 + (numcuts - i + 1)]
    }

    // Last line.
    for (let i = 0; i < numcuts + 2; i++) {
        lines[(s - 1) * s + i] = verts[numcuts + i]
    }

    // First and last members of middle lines.
    for (let i = 0; i < numcuts; i++) {
        const a = i
        const b = numcuts + 1 + numcuts + 1 + (numcuts - i - 1)

        const made = connectSmallestFace(bm, verts[a], verts[b])
        if (!made) continue
        const e = made.e

        flagEnable(params, e, ELE_INNER)
        flagEnable(params, made.fNew, ELE_INNER)

        const v1 = lines[(i + 1) * s] = verts[a]
        const v2 = lines[(i + 1) * s + s - 1] = verts[b]

        // `e_tmp = *e` copies the edge for `alter_co`'s (unused) `e_orig`; the endpoints are live.
        for (let k = 0; k < numcuts; k++) {
            const {v, e: eNew} = subdivideEdgeNum(bm, e, k, numcuts, params, liveOf(v1), liveOf(v2))
            flagEnable(params, eNew, ELE_INNER)
            lines[(i + 1) * s + k + 1] = v
        }
    }

    for (let i = 1; i < numcuts + 2; i++) {
        for (let j = 1; j <= numcuts; j++) {
            const a = i * s + j
            const b = (i - 1) * s + j
            const made = connectSmallestFace(bm, lines[a]!, lines[b]!)
            if (!made) continue
            flagEnable(params, made.e, ELE_INNER)
            flagEnable(params, made.fNew, ELE_INNER)
        }
    }
}

/**
 * <pre>
 *        v3
 *       / \
 *  v4--v0--v1--v2
 *      s    s
 * </pre>
 * `tri_1edge_split` (`:764`).
 */
const tri1edgeSplit: PatternFill = (bm, _face, verts, params) => {
    const numcuts = params.numcuts
    for (let i = 0; i < numcuts; i++) {
        connectSmallestFace(bm, verts[i], verts[numcuts + 1])
    }
}

/**
 * <pre>
 *         v5
 *        / \
 *   s v6/---\ v4 s
 *      / \ / \
 *  sv7/---v---\ v3 s
 *    /  \/  \/ \
 *   v8--v0--v1--v2
 *      s    s
 * </pre>
 * `tri_3edge_subdivide` (`:792`).
 */
const tri3edgeSubdivide: PatternFill = (bm, _face, verts, params) => {
    const numcuts = params.numcuts
    // Rows of the triangular grid; row 0 is the apex, row numcuts+1 the base.
    const lines: (BMVert | null)[][] = new Array(numcuts + 2)
    lines[0] = [verts[numcuts * 2 + 1]]

    lines[numcuts + 1] = new Array(numcuts + 2).fill(null)
    for (let i = 0; i < numcuts; i++) lines[numcuts + 1][i + 1] = verts[i]
    lines[numcuts + 1][0] = verts[numcuts * 3 + 2]
    lines[numcuts + 1][numcuts + 1] = verts[numcuts]

    for (let i = 0; i < numcuts; i++) {
        lines[i + 1] = new Array(2 + i).fill(null)
        const a = numcuts * 2 + 2 + i
        const b = numcuts + numcuts - i
        const made = connectSmallestFace(bm, verts[a], verts[b])
        if (!made) return
        const e = made.e

        flagEnable(params, e, ELE_INNER)
        flagEnable(params, made.fNew, ELE_INNER)

        lines[i + 1][0] = verts[a]
        lines[i + 1][i + 1] = verts[b]

        // Blender copies the row ends into `v1_tmp`/`v2_tmp` for `e_tmp`, the unused `e_orig`, and
        // passes the live `verts[a]`/`verts[b]` to `alter_co`; neither moves while the row is cut.
        for (let j = 0; j < i; j++) {
            const {v, e: eNew} = subdivideEdgeNum(bm, e, j, i, params, liveOf(verts[a]), liveOf(verts[b]))
            lines[i + 1][j + 1] = v
            flagEnable(params, eNew, ELE_INNER)
        }
    }

    for (let i = 1; i <= numcuts; i++) {
        for (let j = 0; j < i; j++) {
            let made = connectSmallestFace(bm, lines[i][j]!, lines[i + 1][j + 1]!)!
            flagEnable(params, made.e, ELE_INNER)
            flagEnable(params, made.fNew, ELE_INNER)

            made = connectSmallestFace(bm, lines[i][j + 1]!, lines[i + 1][j + 1]!)!
            flagEnable(params, made.e, ELE_INNER)
            flagEnable(params, made.fNew, ELE_INNER)
        }
    }
}

const PATTERNS: Record<SubdPatternName, SubDPattern> = {
    quad_1edge: {name: 'quad_1edge', seledges: [1, 0, 0, 0], connectexec: quad1edgeSplit, len: 4},
    quad_2edge_path: {name: 'quad_2edge_path', seledges: [1, 1, 0, 0], connectexec: quad2edgeSplitPath, len: 4},
    quad_2edge_innervert: {name: 'quad_2edge_innervert', seledges: [1, 1, 0, 0], connectexec: quad2edgeSplitInnervert, len: 4},
    quad_2edge_fan: {name: 'quad_2edge_fan', seledges: [1, 1, 0, 0], connectexec: quad2edgeSplitFan, len: 4},
    quad_3edge: {name: 'quad_3edge', seledges: [1, 1, 1, 0], connectexec: quad3edgeSplit, len: 4},
    quad_4edge: {name: 'quad_4edge', seledges: [1, 1, 1, 1], connectexec: quad4edgeSubdivide, len: 4},
    tri_1edge: {name: 'tri_1edge', seledges: [1, 0, 0], connectexec: tri1edgeSplit, len: 3},
    tri_3edge: {name: 'tri_3edge', seledges: [1, 1, 1], connectexec: tri3edgeSubdivide, len: 3},
}

// endregion

/** `SubDFaceData` (`:903`). */
interface SubDFaceData {
    start: BMVert | null
    pat: SubDPattern | null
    /** Only used if `pat` is null, e.g. no pattern was found. */
    totedgesel: number
    face: BMFace
}

/**
 * `bmo_subdivide_edges_exec` (`:910`): cut every edge `cuts` times, then fill each face by the
 * pattern its cut edges match.
 */
export function subdivideEdges(bm: BMesh, edgesIn: readonly BMEdge[], opts: SubdivideEdgesOptions): SubdivideEdgesResult {
    const numcuts = Math.max(0, Math.trunc(opts.cuts))
    const smooth = opts.smooth ?? 0
    const fractal = opts.fractal ?? 0
    if (fractal !== 0) {
        throw new Error('mesh-kernel: subdivideEdges fractal displacement is not ported (BLI_noise_generic_turbulence); pass fractal: 0')
    }
    const cornertype = opts.quadCornerType ?? 'straightCut'
    const useSingleEdge = !!opts.useSingleEdge
    const useGridFill = !!opts.useGridFill
    const useOnlyQuads = !!opts.useOnlyQuads
    const useSphere = !!opts.useSphere

    const params: SubDParams = {
        numcuts,
        smooth,
        smoothFalloff: opts.smoothFalloff ?? 'linear',
        useSmooth: smooth !== 0,
        useSmoothEven: !!opts.useSmoothEven,
        useSphere,
        edgePercents: opts.edgePercents,
        oflag: new Map(),
        staged: new Map(),
    }

    // `BMO_slot_buffer_flag_enable(..., "edges", BM_EDGE, SUBD_SPLIT)`.
    for (const e of edgesIn) flagEnable(params, e, SUBD_SPLIT)

    // The pattern table (`:892`), with the slots the options fill (`:940-970`).
    const patterns: (SubDPattern | null)[] = [
        useSingleEdge ? PATTERNS.quad_1edge : null,
        // Straight cut is patterns[1] == null.
        cornertype === 'path' ? PATTERNS.quad_2edge_path
            : cornertype === 'innerVert' ? PATTERNS.quad_2edge_innervert
                : cornertype === 'fan' ? PATTERNS.quad_2edge_fan : null,
        useSingleEdge ? PATTERNS.tri_1edge : null,
        useGridFill ? PATTERNS.quad_4edge : null,
        PATTERNS.quad_3edge,
        useGridFill ? PATTERNS.tri_3edge : null,
    ]

    // The temporary shape-key layer starts as a copy of every coordinate; here only the altered
    // vertices are staged, and the flush writes only those - the rest would be copied unchanged.

    // First go through and tag edges: `BMO_slot_buffer_from_enabled_flag` rebuilds the input from the
    // flag, in mesh order, which is also the order the edges are split in.
    const einput: BMEdge[] = []
    for (const e of bm.edges) if (flagTest(params, e, SUBD_SPLIT)) einput.push(e)

    if (opts.customPatterns) for (const f of opts.customPatterns.keys()) flagEnable(params, f, FACE_CUSTOMFILL)
    if (opts.edgePercents) for (const e of opts.edgePercents.keys()) flagEnable(params, e, EDGE_PERCENT)

    const facedata: SubDFaceData[] = []

    for (const face of bm.faces) {
        let e1: BMEdge | null = null
        let e2: BMEdge | null = null
        let matched = false

        // Skip non-quads if requested.
        if (useOnlyQuads && face.len !== 4) continue

        // Figure out which pattern to use.
        const verts: BMVert[] = []
        const edges: BMEdge[] = []
        let totesel = 0
        for (const l of face.eachLoop()) {
            edges.push(l.e!)
            verts.push(l.v)
            if (flagTest(params, l.e!, SUBD_SPLIT)) {
                if (!e1) e1 = l.e!
                else e2 = l.e!
                totesel++
            }
        }

        // Make sure the two edges have a valid angle to each other.
        if (totesel === 2 && edgeShareVertCheck(e1!, e2!)) {
            const vec1 = v3normalize(v3sub([e1!.v2.x, e1!.v2.y, e1!.v2.z], [e1!.v1.x, e1!.v1.y, e1!.v1.z]))
            const vec2 = v3normalize(v3sub([e2!.v2.x, e2!.v2.y, e2!.v2.z], [e2!.v1.x, e2!.v1.y, e2!.v1.z]))
            if (Math.abs(v3dot(vec1, vec2)) > 1 - FLT_FACE_SPLIT_EPSILON) totesel = 0
        }

        if (flagTest(params, face, FACE_CUSTOMFILL)) {
            const pat = PATTERNS[opts.customPatterns!.get(face)!]
            for (let i = 0; i < pat.len; i++) {
                matched = true
                for (let j = 0; j < pat.len; j++) {
                    const a = (j + i) % pat.len
                    if (flagTest(params, edges[a], SUBD_SPLIT) !== !!pat.seledges[j]) {
                        matched = false
                        break
                    }
                }
                if (matched) {
                    facedata.push({pat, start: verts[i], face, totedgesel: totesel})
                    flagEnable(params, face, SUBD_SPLIT)
                    break
                }
            }
            // Obviously don't test for other patterns matching.
            continue
        }

        let a = 0
        for (const pat of patterns) {
            if (!pat) continue
            if (pat.len === face.len) {
                for (a = 0; a < pat.len; a++) {
                    matched = true
                    for (let b = 0; b < pat.len; b++) {
                        const j = (b + a) % pat.len
                        if (flagTest(params, edges[j], SUBD_SPLIT) !== !!pat.seledges[b]) {
                            matched = false
                            break
                        }
                    }
                    if (matched) break
                }
                if (matched) {
                    flagEnable(params, face, SUBD_SPLIT)
                    facedata.push({pat, start: verts[a], face, totedgesel: totesel})
                    break
                }
            }
        }

        if (!matched && totesel) {
            flagEnable(params, face, SUBD_SPLIT)
            facedata.push({start: null, pat: null, totedgesel: totesel, face})
        }
    }

    // Go through and split edges.
    for (const edge of einput) {
        subdivideMulticut(bm, edge, params, liveOf(edge.v1), liveOf(edge.v2))
    }

    // Copy original-geometry displacements to current coordinates.
    flushStaged(params)

    // Blender pops the stack, so the faces are filled last-matched first.
    for (let fi = facedata.length - 1; fi >= 0; fi--) {
        const fd = facedata[fi]
        const face = fd.face
        const pat = fd.pat

        if (!pat && fd.totedgesel === 2) {
            // Ok, no pattern. We still may be able to do something: for the case of two edges,
            // connecting them shouldn't be too hard.
            const loops: BMLoop[] = [...face.eachLoop()]
            const vlen = loops.length

            // Find the boundary of one of the split edges.
            let a: number
            for (a = 0; a < vlen; a++) {
                if (!flagTest(params, loops[a ? a - 1 : vlen - 1].v, ELE_INNER) && flagTest(params, loops[a].v, ELE_INNER)) break
            }
            // Failure to break means there is an internal error.
            if (a >= vlen) throw new Error('mesh-kernel: subdivideEdges could not find the boundary of a split edge')

            let b: number
            if (flagTest(params, loops[(a + numcuts + 1) % vlen].v, ELE_INNER)) {
                b = (a + numcuts + 1) % vlen
            } else {
                // Find the boundary of the other edge.
                b = 0
                for (let j = 0; j < vlen; j++) {
                    b = (j + a + numcuts + 1) % vlen
                    if (!flagTest(params, loops[b === 0 ? vlen - 1 : b - 1].v, ELE_INNER) && flagTest(params, loops[b].v, ELE_INNER)) break
                }
            }

            b += numcuts - 1

            const loopsSplit: ([BMLoop, BMLoop] | null)[] = []
            for (let j = 0; j < numcuts; j++) {
                let ok = true

                // Check for special case, see: #32500. This edge pair could be used by more than one
                // face; in this case it used to (2.63) split both faces along the same verts. It's
                // ambiguous, so skip them as exceptional cases rather than guessing which face to cut.
                // Do the verts of each share a face besides the one we are subdividing (but not connect
                // to make an edge of that face)?
                for (const otherLoop of loopsOfVert(loops[a].v)) {
                    if (otherLoop.f !== face) {
                        if (vertInFace(loops[b].v, otherLoop.f)) {
                            ok = false
                            break
                        }
                    }
                }

                loopsSplit.push(ok ? [loops[a], loops[b]] : null)

                // `b = (b - 1) % vlen` is C's remainder: negative stays negative, which indexes nothing
                // Blender reaches because `b` has at least `numcuts - 1` to spend.
                b = (b - 1) % vlen
                a = (a + 1) % vlen
            }

            // Since these are newly created vertices, we don't need to worry about them being legal.
            for (const split of loopsSplit) {
                if (split) {
                    const {lNew} = splitFaceMakeEdge(bm, face, split[0], split[1])
                    flagEnable(params, lNew.e!, ELE_INNER)
                }
            }
            continue
        }
        if (!pat) continue

        // Rebuild `verts` from the face's loop cycle, starting one past `fd->start`.
        const loops = [...face.eachLoop()]
        let a = 0
        for (let j = 0; j < loops.length; j++) {
            if (loops[j].v === fd.start) {
                a = j + 1
                break
            }
        }
        const verts: BMVert[] = new Array(face.len)
        for (let j = 0; j < loops.length; j++) {
            verts[(j - a + face.len) % face.len] = loops[j].v
        }

        pat.connectexec(bm, face, verts, params)
    }

    // Copy original-geometry displacements to current coordinates.
    flushStaged(params)

    // Vertex creases should not be interpolated when subdividing edges. See: #154814 (`:1301`).
    const creaseVert = bm.vdata.get(AttrName.creaseVert)
    if (creaseVert) {
        for (const v of bm.verts) if (flagTest(params, v, ELE_INNER)) setComponent(v, bm.vdata, creaseVert, 0, 0)
    }

    // `BMO_slot_buffer_from_enabled_flag(..., BM_ALL_NOLOOP, flag)`: vertices, edges, then faces, each
    // in mesh order.
    const collect = (flag: number): SubdivideGeom => ({
        verts: [...bm.verts].filter(v => flagTest(params, v, flag)),
        edges: [...bm.edges].filter(e => flagTest(params, e, flag)),
        faces: [...bm.faces].filter(f => flagTest(params, f, flag)),
    })
    return {
        inner: collect(ELE_INNER),
        split: collect(ELE_SPLIT),
        geom: collect(ELE_INNER | ELE_SPLIT | SUBD_SPLIT),
    }
}

function flushStaged(params: SubDParams): void {
    for (const [v, co] of params.staged) v.setCo(co[0], co[1], co[2])
    params.staged.clear()
}

export interface MeshEsubdivideOptions extends Omit<SubdivideEdgesOptions, 'edgePercents' | 'customPatterns'> {
    /** `seltype`: what to leave selected. Default `orig`. */
    selectType?: SubdivideSelectType
}

/**
 * `BM_mesh_esubdivide` (`:1324`) on the selected edges: run the operator and set the selection the
 * way the edit-mode operators (Subdivide, Loop Cut) expect. `use_sphere` isn't exposed, as there.
 */
export function meshEsubdivide(bm: BMesh, opts: MeshEsubdivideOptions): SubdivideEdgesResult {
    // `edges=%he` with `BMO_FLAG_RESPECT_HIDE` (`bmesh_operators.cc:811`): selected, not hidden.
    const edges = [...bm.edges].filter(e => (e.hflag & ElemFlag.Select) && !(e.hflag & ElemFlag.Hidden))
    const result = subdivideEdges(bm, edges, {...opts, useSphere: false})

    switch (opts.selectType ?? 'orig') {
    case 'none':
        break
    case 'orig':
        // Set the newly created data to be selected.
        for (const v of result.inner.verts) elemSelectSet(bm, v, true)
        for (const e of result.inner.edges) elemSelectSet(bm, e, true)
        for (const f of result.inner.faces) elemSelectSet(bm, f, true)
        selectFlushFromVerts(bm, true)
        break
    case 'inner':
        for (const v of result.inner.verts) elemSelectSet(bm, v, true)
        for (const e of result.inner.edges) elemSelectSet(bm, e, true)
        break
    case 'loopcut':
        // Deselect input.
        selectNone(bm)
        for (const e of result.inner.edges) edgeSelectSet(bm, e, true)
        break
    }
    return result
}

/** The properties of `MESH_OT_subdivide` (`editmesh_tools.cc:150`), by their RNA names. */
export interface EditMeshSubdivideProps {
    /** `number_cuts`, 1..100. Default 1. */
    numberCuts?: number
    /** `smoothness`, 0..1000. Default 0. */
    smoothness?: number
    /** `ngon`: allow n-gons; off limits new faces to triangles and quads. Default true. */
    ngon?: boolean
    /** `quadcorner`. Default `straightCut`. */
    quadcorner?: SubdQuadCornerType
    /** `fractal`: **not ported** - must be 0. */
    fractal?: number
    /** `fractal_along_normal`. */
    fractalAlongNormal?: number
    /** `seed`. */
    seed?: number
}

/**
 * The `subdivide_edges` options `edbm_subdivide_exec` (`editmesh_tools.cc:89`) builds from
 * `MESH_OT_subdivide`'s properties, for a caller that passes its own edges rather than the selection.
 */
export function editMeshSubdivideOptions(props: EditMeshSubdivideProps = {}): MeshEsubdivideOptions {
    const cuts = props.numberCuts ?? 1
    const smooth = props.smoothness ?? 0
    const fractal = (props.fractal ?? 0) / 2.5
    const alongNormal = props.fractalAlongNormal ?? 0
    const useQuadTri = !(props.ngon ?? true)

    let quadCornerType = props.quadcorner ?? 'straightCut'
    if (useQuadTri && quadCornerType === 'straightCut') quadCornerType = 'innerVert'
    const seed = props.seed ?? 0

    return {
        smooth,
        smoothFalloff: 'linear',
        useSmoothEven: false,
        fractal,
        alongNormal,
        cuts,
        selectType: 'orig',
        quadCornerType,
        useSingleEdge: useQuadTri,
        useGridFill: true,
        useOnlyQuads: false,
        seed,
    }
}

/**
 * `edbm_subdivide_exec` (`editmesh_tools.cc:89`) for one edit mesh: Subdivide in the edit-mode Edge
 * menu, on the selected edges. Returns null when nothing is selected, as Blender skips the object.
 */
export function editMeshSubdivide(bm: BMesh, props: EditMeshSubdivideProps = {}): SubdivideEdgesResult | null {
    if (!(bm.totedgesel || bm.totfacesel)) return null
    return meshEsubdivide(bm, editMeshSubdivideOptions(props))
}

/**
 * Subdivide every edge of a set of triangles `numCuts` times, grid-fill the interiors, and project
 * every vertex the pass touches onto a sphere of `radius`: the icosphere's call
 * (`bmo_primitive.cc`, `subdivide_edges ... use_grid_fill=%b use_sphere=%b smooth=%f`).
 */
export function subdivideTrisOnSphere(bm: BMesh, edges: readonly BMEdge[], numCuts: number, radius: number): void {
    subdivideEdges(bm, edges, {cuts: numCuts, useGridFill: true, useSphere: true, smooth: radius})
}

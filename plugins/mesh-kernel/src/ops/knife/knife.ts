/**
 * The knife: cut new edges into a mesh by drawing on it.
 *
 * A port of `source/blender/editors/mesh/editmesh_knife.cc` (Blender main e4e6c79a) without its GPU
 * drawing and window-manager glue. Everything that decides *where* a cut goes and *what topology it
 * makes* is here, line for line: the knife's own vertex/edge graph built while cutting
 * (`KnifeVert`/`KnifeEdge`), snapping to vertices, edges and midpoints, angle and axis constraints,
 * cut-through, the screen-line hit search, per-segment undo, and the final conversion of the graph
 * into real edges and faces (`knife_make_cuts` -> `BM_face_split_edgenet`). It runs in Node: the view
 * is a {@link KnifeView}, the mesh a kernel {@link BMesh}.
 *
 * {@link KnifeTool.modal} is `knifetool_modal` (`:4220`): a caller feeds it the same modal-keymap
 * items Blender's `Knife Tool Modal Map` produces (`blender_default.py:6404`) and mouse moves, and
 * draws {@link KnifeTool.drawData} (what `knifetool_draw`, `:832`, draws). {@link knifeProject} is
 * `EDBM_mesh_knife` (`:4751`), the non-interactive entry used by Knife Project - and by the tests,
 * against Blender's own output.
 *
 * Mapping from Blender's structures:
 * - `ListBaseT<LinkData>` lists are arrays (`BLI_addtail` = `push`); mempools of knife verts/edges are
 *   arrays in allocation order, which is the order `BLI_mempool_iter` visits them (nothing is freed
 *   while the tool runs).
 * - One edited object: `ob_index` is 0, or -1 for "in space". `cage` coordinates are world space,
 *   `co` the mesh's own; `objectMatrix` maps one to the other, as `object_to_world()` does.
 * - The triangle BVH (`knife_bvh_*`, `BLI_bvhtree_ray_cast`, `BLI_bvhtree_intersect_plane`) is a scan
 *   over the tessellation in triangle order with the same leaf tests and the same nearest-hit rule
 *   (strict `<`). Results differ only when two triangles are hit at exactly the same depth.
 * - `em->looptris`: triangles and quads are tessellated exactly as `bmesh_mesh_tessellate.cc` does;
 *   n-gons use the kernel's ear clipping instead of `BLI_polyfill_calc`. For a planar n-gon any
 *   triangulation gives the same ray hits; for a non-planar one the hit can differ by the bend.
 * - `EDBM_face_find_nearest` (the back-buffer fallback in `knife_find_closest_face`) is an optional
 *   callback, {@link KnifeToolOptions.findNearestFace}; the GPU selection buffer lives in mesh-edit.
 * - Measurements (`knifetool_draw_dist_angle`) and the header text are left to the caller.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../../bmesh/types'
import {BMesh} from '../../bmesh/BMesh'
import {ElemFlag} from '../../constants'
import {diskEdgeExists} from '../../bmesh/structure'
import {edgeInFace, faceEdgeShareLoop, splitEdgeMakeVert} from '../../bmesh/euler'
import {faceNormalUpdate} from '../../bmesh/polygon'
import {edgeSelectSet, selectFlushMode, selectModeFlush} from '../../bmesh/marking'
import {tessellatePolygon} from '../../bake'
import {
    angleSignedOnAxisV3V3V3,
    axisDominantV3ToM3,
    closestRayToSegmentV3,
    closestToLineSegmentV2,
    compare3,
    cross3,
    distSignedSquaredToCorner,
    distSignedSquaredToPlane,
    distSquaredToLineSegmentV2,
    distSquaredToPlane,
    dot3,
    dotM4V3RowZ,
    equals3,
    FLT_EPSILON,
    FLT_MAX,
    interp3,
    interpV3V3V3Uv,
    invertM4,
    isectLinePlaneV3,
    isectPointPolyV2,
    isectRayLineV3,
    isectRayPlaneV3,
    isectRayRayV3,
    isectRayTriEpsilonV3,
    isectRayTriWatertightPrecalc,
    isectRayTriWatertightV3,
    isectSegSegV2PointEx,
    isQuadFlipV3FirstThirdFast,
    isZero2,
    isZero3,
    lenSqV2V2,
    lenSqV3V3,
    lenV2V2,
    lenV3V3,
    linePointFactorV3,
    M4,
    madd3,
    mid2,
    mid3,
    mulM4V3,
    mulProjectM4V3Zfac,
    mulTransposedMat3M4V3,
    mulV2M3V3,
    normalize3,
    normalTriV3,
    planeFromPointNormal,
    projectPlaneNormalized,
    rotateNormalizedV3,
    sub3,
    transformPointBySegV3,
    V2,
    V3,
    V4,
} from './geom'
import {KnifeView} from './view'
import {faceSplitEdgenet, faceSplitEdgenetConnectIslands} from './edgenet'

// region constants (`editmesh_knife.cc:74-92`)

/** `USE_NET_ISLAND_CONNECT`: detect isolated holes and fill them. */
const USE_NET_ISLAND_CONNECT = true
/** `KMAXDIST`: max mouse distance from edge before not detecting it (pixels, `UI_SCALE_FAC` 1). */
export const KMAXDIST = 10
// WARNING: Knife float precision is fragile (#43229, #42864, #42459, #41164).
const KNIFE_FLT_EPS = 0.00001
const KNIFE_FLT_EPS_SQUARED = KNIFE_FLT_EPS * KNIFE_FLT_EPS
const KNIFE_FLT_EPSBIG = 0.0005
const KNIFE_FLT_EPS_PX_VERT = 0.5
const KNIFE_FLT_EPS_PX_EDGE = 0.05
const KNIFE_FLT_EPS_PX_FACE = 0.05
export const KNIFE_DEFAULT_ANGLE_SNAPPING_INCREMENT = 30
const KNIFE_MIN_ANGLE_SNAPPING_INCREMENT = 0
const KNIFE_MAX_ANGLE_SNAPPING_INCREMENT = 180

const DEG2RAD = Math.PI / 180

// endregion

// region data (`:108-215`)

/** `KnifeVert` (`:109`). */
export interface KnifeVert {
    /** Non-null if this is an original vert. */
    v: BMVert | null
    edges: KnifeEdge[]
    faces: BMFace[]
    /** -1 represents the absence of an object. */
    obIndex: number
    /** Vertex position in the original mesh. Equivalent to `BMVert::co`. */
    co: V3
    /** Vertex position in the cage mesh, world space. */
    cageco: V3
    /** Along a cut created by user input (will draw too). */
    isCut: boolean
    isInvalid: boolean
    /** Created when an edge was split. */
    isSplitting: boolean
}

/** `KnifeEdge` (`:125`). */
export interface KnifeEdge {
    v1: KnifeVert
    v2: KnifeVert
    /** Face to restrict face fill to. */
    basef: BMFace | null
    faces: BMFace[]
    /** Non-null if this is an original edge. */
    e: BMEdge | null
    /** Along a cut created by user input (will draw too). */
    isCut: boolean
    isInvalid: boolean
    /** Number of times this edge has been split. */
    splits: number
}

/** `KnifeLineHit` (`:136`). Exactly one of `kfe`, `v`, `f` is set when the hit is made. */
export interface KnifeLineHit {
    hit: V3
    cagehit: V3
    /** Screen coordinates for `cagehit`. */
    schit: V2
    /** Lambda along cut line. */
    l: number
    /** Depth front-to-back. */
    m: number
    kfe: KnifeEdge | null
    v: KnifeVert | null
    f: BMFace | null
    obIndex: number
}

/** `KnifePosData` (`:154`). At most one of `vert`, `edge`, `bmface` is set; none means "in space". */
export interface KnifePosData {
    cage: V3
    vert: KnifeVert | null
    edge: KnifeEdge | null
    bmface: BMFace | null
    /** -1 represents the absence of an object. */
    obIndex: number
    /** Mouse screen position (may be non-integral if snapped to something). */
    mval: V2
}

const isSpace = (p: KnifePosData) => p.obIndex === -1

/** `KnifeMeasureData` (`:176`). */
export interface KnifeMeasureData {
    cage: V3
    mval: V2
    isStored: boolean
}

/** `KnifeUndoFrame` (`:182`). */
interface KnifeUndoFrame {
    /** Line hits cause multiple edges/cuts to be created at once. */
    cuts: number
    /** Number of edges split. */
    splits: number
    pos: KnifePosData
    mdata: KnifeMeasureData
}

/** `KnifeMode` (`:217`). */
export type KnifeMode = 'idle' | 'dragging' | 'connect' | 'panning'

/** Angle snapping modes, `KNF_CONSTRAIN_ANGLE_MODE_*` (`:350`). */
export enum KnifeAngleSnap { None = 0, Screen = 1, Relative = 2 }

/** Axis constraint, `KNF_CONSTRAIN_AXIS_*` (`:356`). */
export enum KnifeAxis { None = 0, X = 1, Y = 2, Z = 3 }

/** `KNF_CONSTRAIN_AXIS_MODE_*` (`:363`). */
export enum KnifeAxisMode { None = 0, Global = 1, Local = 2 }

/** `KNF_MEASUREMENT_*` (`:369`). */
export enum KnifeMeasurement { None = 0, Both = 1, Distance = 2, Angle = 3 }

/**
 * The knife modal keymap items, `KNF_MODAL_*` (`:328`) by their keymap names (`knifetool_modal_keymap`,
 * `:4157`).
 */
export type KnifeModalItem =
    | 'CANCEL' | 'CONFIRM' | 'UNDO'
    | 'SNAP_MIDPOINTS_ON' | 'SNAP_MIDPOINTS_OFF'
    | 'NEW_CUT'
    | 'IGNORE_SNAP_ON' | 'IGNORE_SNAP_OFF'
    | 'ADD_CUT'
    | 'ANGLE_SNAP_TOGGLE' | 'CYCLE_ANGLE_SNAP_EDGE'
    | 'CUT_THROUGH_TOGGLE'
    | 'SHOW_DISTANCE_ANGLE_TOGGLE' | 'DEPTH_TEST_TOGGLE'
    | 'PANNING'
    | 'X_AXIS' | 'Y_AXIS' | 'Z_AXIS'
    | 'ADD_CUT_CLOSED'

/** One event for {@link KnifeTool.modal}. */
export type KnifeEvent =
    /** A modal keymap item. `release` is Blender's `event->prev_val == KM_RELEASE` (or `val` for PANNING). */
    | {type: 'modal', item: KnifeModalItem, release?: boolean, mval: V2}
    /** `MOUSEMOVE`, region pixels (bottom-left origin). */
    | {type: 'mousemove', mval: V2}

/** What {@link KnifeTool.modal} returns, as `wmOperatorStatus`. */
export type KnifeStatus = 'running' | 'finished' | 'cancelled' | 'passThrough'

export interface KnifeToolOptions {
    view: KnifeView
    /** The mesh's object-to-world matrix, column-major. Default identity. */
    objectMatrix?: M4
    /** `only_selected`: only cut selected faces. Default false. */
    onlySelect?: boolean
    /** `!use_occlude_geometry`: cut through hidden faces too. Default false. */
    cutThrough?: boolean
    /** `xray` (inverted in Blender's invoke: the preview's depth test). Default: depth test on. */
    depthTest?: boolean
    /** `visible_measurements`. */
    visibleMeasurements?: KnifeMeasurement
    /** `angle_snapping`. */
    angleSnapping?: KnifeAngleSnap
    /** `angle_snapping_increment` in degrees. Default 30. */
    angleSnappingIncrement?: number
    /** False for the non-interactive knife project, with its own tolerances. Default true. */
    isInteractive?: boolean
    /**
     * `EDBM_face_find_nearest` with `dist` = {@link KMAXDIST}: the face under or near the cursor from the
     * selection buffer, used when the ray misses (`knife_find_closest_face`, `:3097`). Interactive only.
     */
    findNearestFace?: (mval: V2) => BMFace | null
    /**
     * The orientation matrix for an axis constraint in the given mode (`calc_orientation_from_type_ex`
     * via `knife_constrain_axis`, `:3590`): rows are the X/Y/Z axes. Default: global is the identity,
     * local the object's normalised axes.
     */
    orientationMatrix?: (mode: KnifeAxisMode) => [V3, V3, V3]
    /** Blender's `em->selectmode`, used for `select_result` (`:3958`). Default: not face-only. */
    selectModeIsFaceOnly?: boolean
    /**
     * `UI_SCALE_FAC`: scales the snapping distances (`KMAXDIST = 10 * UI_SCALE_FAC`, `:77`). Default 1.
     * Pass the device pixel ratio when region pixels are device pixels.
     */
    uiScale?: number
}

/** A triangle of the tessellation, with what the BVH callbacks read from it. */
interface KnifeTri {
    f: BMFace
    /** The face's three loops' verts (`ltri[i]->v`). */
    verts: [BMVert, BMVert, BMVert]
    /** World-space cage positions (`knife_bm_tri_cagecos_get_worldspace`). */
    cos: [V3, V3, V3]
    /** Leaf bound for `tree_intersect_plane_test`: the AABB inflated by the tree epsilon. */
    min: V3
    max: V3
}

// endregion

const clonePos = (p: KnifePosData): KnifePosData => ({
    cage: [p.cage[0], p.cage[1], p.cage[2]], vert: p.vert, edge: p.edge, bmface: p.bmface, obIndex: p.obIndex, mval: [p.mval[0], p.mval[1]],
})
const emptyPos = (): KnifePosData => ({cage: [0, 0, 0], vert: null, edge: null, bmface: null, obIndex: -1, mval: [0, 0]})
const coOf = (v: BMVert): V3 => [v.x, v.y, v.z]
const fnoOf = (f: BMFace): V3 => [f.nx, f.ny, f.nz]

/** `BM_face_vert_share_loop`. */
function faceVertShareLoop(f: BMFace, v: BMVert): BMLoop | null {
    let l = f.lFirst
    do {
        if (l.v === v) return l
    } while ((l = l.next) !== f.lFirst)
    return null
}

/** `BM_loop_is_adjacent`. */
const loopIsAdjacent = (a: BMLoop, b: BMLoop) => a.next === b || a.prev === b

/** `BM_face_point_inside_test` (`bmesh_polygon.cc:1081`). */
function facePointInsideTest(f: BMFace, co: readonly number[]): boolean {
    const axisMat = axisDominantV3ToM3(fnoOf(f))
    const co2d = mulV2M3V3(axisMat, co)
    const projverts: V2[] = []
    let l = f.lFirst
    for (let i = 0; i < f.len; i++, l = l.next) projverts.push(mulV2M3V3(axisMat, coOf(l.v)))
    return isectPointPolyV2(co2d, projverts, f.len)
}

/** `BM_loop_point_side_of_loop_test` (`bmesh_query.cc:244`). */
const loopPointSideOfLoopTest = (l: BMLoop, co: readonly number[]): number =>
    distSignedSquaredToCorner(co, coOf(l.prev.v), coOf(l.v), coOf(l.next.v), fnoOf(l.f))

/** `BM_loop_point_side_of_edge_test` (`bmesh_query.cc:250`). */
function loopPointSideOfEdgeTest(l: BMLoop, co: readonly number[]): number {
    const axis = fnoOf(l.f)
    const dir = sub3(coOf(l.next.v), coOf(l.v))
    const p = cross3(axis, dir)
    const plane: V4 = [p[0], p[1], p[2], -dot3(p, coOf(l.v))]
    return distSignedSquaredToPlane(co, plane)
}

/** `BM_vert_in_face`. */
function vertInFace(v: BMVert, f: BMFace): boolean {
    let l = f.lFirst
    do {
        if (l.v === v) return true
    } while ((l = l.next) !== f.lFirst)
    return false
}

/** `BM_FACES_OF_EDGE`: the radial cycle from `e.l`. */
function facesOfEdge(e: BMEdge): BMFace[] {
    const out: BMFace[] = []
    const l0 = e.l
    if (!l0) return out
    let l: BMLoop = l0
    do {
        out.push(l.f)
    } while ((l = l.radialNext!) !== l0)
    return out
}

/** `BM_FACES_OF_VERT` (`bmiter__face_of_vert_*`): the disk cycle from `v.e`, each radial from `e.l`. */
function facesOfVert(v: BMVert): BMFace[] {
    const out: BMFace[] = []
    if (!v.e) return out
    const e0 = v.e
    let e: BMEdge = e0
    do {
        const l0 = e.l
        if (l0) {
            let l: BMLoop = l0
            do {
                if (l.v === v) out.push(l.f)
            } while ((l = l.radialNext!) !== l0)
        }
    } while ((e = e.diskNext(v)!) !== e0)
    return out
}

/** `BM_EDGES_OF_FACE`. */
function edgesOfFace(f: BMFace): BMEdge[] {
    const out: BMEdge[] = []
    let l = f.lFirst
    do {
        out.push(l.e!)
    } while ((l = l.next) !== f.lFirst)
    return out
}

/** `BM_edge_is_boundary`. */
const edgeIsBoundary = (e: BMEdge) => !!e.l && e.l.radialNext === e.l
/** `BM_edge_is_wire`. */
const edgeIsWire = (e: BMEdge) => e.l === null

/** `coinciding_edges` (`:2552`): do e1 and e2 go between exactly the same coordinates? */
function coincidingEdges(e1: BMEdge, e2: BMEdge): boolean {
    const co11 = coOf(e1.v1), co12 = coOf(e1.v2), co21 = coOf(e2.v1), co22 = coOf(e2.v2)
    return (equals3(co11, co21) && equals3(co12, co22)) || (equals3(co11, co22) && equals3(co12, co21))
}

type BMElemAny = BMVert | BMEdge | BMFace

/**
 * `bm_ray_cast_cb_elem_not_in_face_check` (`:2573`): exclude hits on faces that are, contain, or butt
 * up against the hitting element (#44492).
 */
function elemNotInFaceCheck(f: BMFace, elem: BMElemAny): boolean {
    if (elem instanceof BMFace) return elem !== f
    if (elem instanceof BMEdge) {
        let ans = !edgeInFace(elem, f)
        if (ans && edgeIsBoundary(elem)) {
            // Is it a boundary edge, coincident with a split edge?
            for (const e2 of edgesOfFace(f)) {
                if (coincidingEdges(elem, e2)) {
                    ans = false
                    break
                }
            }
        }
        return ans
    }
    return !vertInFace(elem, f)
}

/**
 * The knife's state for one session: `KnifeTool_OpData` (`:220`) and the functions over it.
 *
 * Create it on a mesh with current face normals (edit mode keeps them; {@link KnifeTool} recomputes
 * them on construction), feed it {@link modal} events, and read {@link drawData} for the preview.
 * {@link modal} returns `'finished'` once the cut has been applied to the mesh.
 */
export class KnifeTool {
    readonly bm: BMesh
    view: KnifeView
    readonly objectMatrix: M4
    readonly worldToObject: M4

    // `KnifeObjectInfo` (`:202`)
    /** `positions_cage`, world space. */
    private _positionsCage = new Map<BMVert, V3>()
    /** `em->looptris` in face order, with each face's first triangle index (`facetrimap`). */
    private _tris: KnifeTri[] = []
    private _faceTriStart = new Map<BMFace, number>()
    /** The BVH's triangle set (`knife_bvh_init` `test_fn`), as indices into `_tris`. */
    private _bvhTris: number[] = []

    private _origVertMap = new Map<BMVert, KnifeVert>()
    private _origEdgeMap = new Map<BMEdge, KnifeEdge>()
    private _kedgeFaceMap = new Map<BMFace, KnifeEdge[]>()

    readonly kverts: KnifeVert[] = []
    readonly kedges: KnifeEdge[] = []
    /** A cut has not been made yet. */
    noCuts = true

    private _undoStack: KnifeUndoFrame[] = []
    /** Edge splits by `knife_split_edge`, pairs pushed `kfe` then `newkfe`. */
    private _splitStack: KnifeEdge[] = []

    vthresh = KMAXDIST - 1
    ethresh = KMAXDIST

    /** Used for drag-cutting. */
    linehits: KnifeLineHit[] = []

    /** Current point under the cursor. */
    curr: KnifePosData = emptyPos()
    /** Last added cut (a line draws from the cursor to this). */
    prev: KnifePosData = emptyPos()
    /** The first point in the cut-list, used for closing the loop. */
    init: KnifePosData = emptyPos()

    readonly isInteractive: boolean
    cutThrough: boolean
    readonly onlySelect: boolean
    readonly selectResult: boolean

    isOrtho = false
    orthoExtent = 0
    orthoExtentCenter: V3 = [0, 0, 0]
    clipsta = 0
    clipend = 0

    mode: KnifeMode = 'idle'
    isDragHold = false
    prevmode: KnifeMode = 'idle'
    snapMidpoints = false
    ignoreEdgeSnapping = false
    ignoreVertSnapping = false

    /** Degrees. */
    angleSnappingIncrement: number
    angleSnappingMode: KnifeAngleSnap
    /** Currently dragging an angle snapped line. */
    isAngleSnapping = false
    angleSnapping: boolean
    angle = 0
    /** Relative angle snapping reference edge. */
    snapRefEdge: KnifeEdge | null = null
    snapRefEdgesCount = 0
    /** Used by `CYCLE_ANGLE_SNAP_EDGE` to choose an edge for snapping. */
    snapEdge = 0

    constrainAxis: KnifeAxis = KnifeAxis.None
    constrainAxisMode: KnifeAxisMode = KnifeAxisMode.None
    axisConstrained = false
    axisString = ' '

    distAngleMode: KnifeMeasurement
    showDistAngle: boolean
    /** Data for distance and angle drawing calculations. */
    mdata: KnifeMeasureData = {cage: [0, 0, 0], mval: [0, 0], isStored: false}

    /** Current undo frame. */
    private _undo: KnifeUndoFrame | null = null
    isDragUndo = false

    depthTest: boolean

    private _findNearestFace?: (mval: V2) => BMFace | null
    private _orientationMatrix: (mode: KnifeAxisMode) => [V3, V3, V3]

    /** `knifetool_init` (`:3924`) and `knifetool_init_obinfo` (`:3860`). */
    constructor(bm: BMesh, opts: KnifeToolOptions) {
        this.bm = bm
        this.view = opts.view
        this.objectMatrix = opts.objectMatrix ? Array.from(opts.objectMatrix) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        this.worldToObject = invertM4(this.objectMatrix)
        this.isInteractive = opts.isInteractive ?? true
        this.cutThrough = !!opts.cutThrough
        this.onlySelect = !!opts.onlySelect
        // Can't usefully select resulting edges in face mode.
        this.selectResult = !opts.selectModeIsFaceOnly
        this.depthTest = opts.depthTest ?? true
        this.distAngleMode = opts.visibleMeasurements ?? KnifeMeasurement.None
        this.showDistAngle = this.distAngleMode !== KnifeMeasurement.None
        this.angleSnappingMode = opts.angleSnapping ?? KnifeAngleSnap.None
        this.angleSnapping = this.angleSnappingMode !== KnifeAngleSnap.None
        this.angleSnappingIncrement = opts.angleSnappingIncrement ?? KNIFE_DEFAULT_ANGLE_SNAPPING_INCREMENT
        this._findNearestFace = opts.findNearestFace
        const uiScale = opts.uiScale ?? 1
        this.vthresh = KMAXDIST * uiScale - 1
        this.ethresh = KMAXDIST * uiScale
        this._orientationMatrix = opts.orientationMatrix ?? (mode => this._defaultOrientation(mode))

        // Edit mode keeps face normals current; the knife reads them throughout.
        for (const f of bm.faces) faceNormalUpdate(f)
        for (const v of bm.verts) this._positionsCage.set(v, mulM4V3(this.objectMatrix, coOf(v)))
        this._tessellate()
        this._bvhInit()
        this.recalcOrtho()
    }

    // region tessellation and BVH (`:1115-1390`)

    /** `BM_mesh_calc_tessellation` order: faces in mesh order, triangles per face contiguous. */
    private _tessellate(): void {
        const eps = FLT_EPSILON * 2
        const add = (f: BMFace, a: BMLoop, b: BMLoop, c: BMLoop) => {
            const verts: [BMVert, BMVert, BMVert] = [a.v, b.v, c.v]
            const cos = verts.map(v => this._positionsCage.get(v)!) as [V3, V3, V3]
            const min: V3 = [Infinity, Infinity, Infinity]
            const max: V3 = [-Infinity, -Infinity, -Infinity]
            for (const p of cos) for (let i = 0; i < 3; i++) {
                min[i] = Math.min(min[i], p[i] - eps)
                max[i] = Math.max(max[i], p[i] + eps)
            }
            this._tris.push({f, verts, cos, min, max})
        }
        for (const f of this.bm.faces) {
            this._faceTriStart.set(f, this._tris.length)
            const l0 = f.lFirst
            if (f.len === 3) {
                // `0 1 2` -> `0 1 2` (`bmesh_mesh_tessellate.cc`)
                add(f, l0, l0.next, l0.next.next)
            } else if (f.len === 4) {
                // `0 1 2 3` -> (`0 1 2`, `0 2 3`), flipped out of a degenerate 0-2 state.
                const a = [l0, l0.next, l0.next.next]
                const b = [l0, l0.next.next, l0.next.next.next]
                if (isQuadFlipV3FirstThirdFast(coOf(a[0].v), coOf(a[1].v), coOf(a[2].v), coOf(b[2].v))) {
                    a[2] = b[2]
                    b[0] = a[1]
                }
                add(f, a[0], a[1], a[2])
                add(f, b[0], b[1], b[2])
            } else {
                const loops = f.loops()
                const pts: number[] = []
                for (const l of loops) pts.push(l.v.x, l.v.y, l.v.z)
                const idx: number[] = []
                tessellatePolygon(pts, idx)
                for (let i = 0; i < idx.length; i += 3) add(f, loops[idx[i]], loops[idx[i + 1]], loops[idx[i + 2]])
            }
        }
    }

    /** `knife_bvh_init` (`:1172`). */
    private _bvhInit(): void {
        const test = (this.onlySelect && this.cutThrough)
            ? (f: BMFace) => (f.hflag & ElemFlag.Select) !== 0
            : (f: BMFace) => (f.hflag & ElemFlag.Hidden) === 0
        this._bvhTris = []
        for (let i = 0; i < this._tris.length; i++) if (test(this._tris[i].f)) this._bvhTris.push(i)
    }

    /**
     * `knife_bvh_raycast` (`:1333`) / `knife_bvh_raycast_filter` (`:1371`) with `knife_bvh_raycast_cb`
     * (`:1262`). `co` is world space. Returns the nearest face hit closer than `dist`.
     */
    private _bvhRaycast(co: readonly number[], dir: readonly number[], radius: number, dist = FLT_MAX,
        filter?: (f: BMFace) => boolean): {f: BMFace, dist: number, cagehit: V3} | null {
        let hitDist = dist
        let hitIndex = -1
        let hitCo: V3 = [0, 0, 0]
        const [d] = normalize3(dir)
        const pre = radius > 0 ? null : isectRayTriWatertightPrecalc(d)
        for (const i of this._bvhTris) {
            const tri = this._tris[i]
            if (filter && !filter(tri.f)) continue
            const r = radius > 0
                ? isectRayTriEpsilonV3(co, d, tri.cos[0], tri.cos[1], tri.cos[2], radius)
                : isectRayTriWatertightV3(co, pre!, tri.cos[0], tri.cos[1], tri.cos[2])
            if (r && r[0] < hitDist) {
                hitCo = madd3(co, d, r[0])
                hitDist = r[0]
                hitIndex = i
            }
        }
        if (hitIndex !== -1 && hitDist !== dist) return {f: this._tris[hitIndex].f, dist: hitDist, cagehit: hitCo}
        return null
    }

    /**
     * `BLI_bvhtree_intersect_plane` (`kdopbvh.cc:1502`) with `tree_intersect_plane_test` (`:1468`):
     * the triangles whose bound straddles the plane.
     */
    private _bvhIntersectPlane(plane: V4): number[] {
        const out: number[] = []
        for (const i of this._bvhTris) {
            const t = this._tris[i]
            // `aabb_get_near_far_from_plane`
            const near: V3 = [0, 0, 0]
            const far: V3 = [0, 0, 0]
            for (let k = 0; k < 3; k++) {
                if (plane[k] < 0) {
                    near[k] = t.max[k]
                    far[k] = t.min[k]
                } else {
                    near[k] = t.min[k]
                    far[k] = t.max[k]
                }
            }
            if ((dot3(plane, near) + plane[3] > 0) !== (dot3(plane, far) + plane[3] > 0)) out.push(i)
        }
        return out
    }

    // endregion

    // region geometry utils (`:1398-1478`)

    /** `knife_project_v2` (`:1398`). */
    private _project(co: readonly number[]): V2 {
        return this.view.projectFloatGlobal(co)
    }

    /** `knife_verts_edge_in_face` (`:1431`). */
    private _vertsEdgeInFace(v1: KnifeVert | null, v2: KnifeVert | null, f: BMFace | null): boolean {
        if (!f || !v1 || !v2) return false
        const l1 = v1.v ? faceVertShareLoop(f, v1.v) : null
        const l2 = v2.v ? faceVertShareLoop(f, v2.v) : null
        // Boundary-case, always false to avoid edge-in-face checks below.
        if (l1 && l2 && loopIsAdjacent(l1, l2)) return false
        // Find out if v1 and v2, if set, are part of the face.
        const v1Inface = l1 !== null
        const v2Inface = l2 !== null
        // BM_face_point_inside_test uses best-axis projection so this isn't most accurate test...
        const v1Inside = v1Inface ? false : facePointInsideTest(f, v1.co)
        const v2Inside = v2Inface ? false : facePointInsideTest(f, v2.co)
        if ((v1Inface && v2Inside) || (v2Inface && v1Inside) || (v1Inside && v2Inside)) return true
        if (v1Inface && v2Inface) {
            // Can have case where v1 and v2 are on shared chain between two faces; use a simple
            // "is the midpoint in the face" test.
            return facePointInsideTest(f, mid3(v1.co, v2.co))
        }
        return false
    }

    /** `knife_recalc_ortho` (`:1472`). */
    recalcOrtho(): void {
        const r = this.view.clipRangeGet(true)
        this.isOrtho = r.isOrtho
        this.clipsta = r.clipStart
        this.clipend = r.clipEnd
    }

    // endregion

    // region element utils (`:1486-1790`)

    /** `bm_elem_from_knife_vert` (`:1486`). */
    private _bmElemFromKnifeVert(kfv: KnifeVert, wantKfe: boolean): {elem: BMElemAny | null, kfe: KnifeEdge | null} {
        let kfe: KnifeEdge | null = null
        let eleTest: BMElemAny | null = kfv.v
        let rKfe: KnifeEdge | null = null
        if (wantKfe || eleTest === null) {
            if (kfv.v === null) {
                for (const ref of kfv.edges) {
                    kfe = ref
                    if (kfe.e) {
                        if (wantKfe) rKfe = kfe
                        break
                    }
                }
            }
        }
        // edge?
        if (eleTest === null && kfe) eleTest = kfe.e
        // face?
        if (eleTest === null) {
            if (kfe!.faces.length === 1) eleTest = kfe!.faces[0]
        }
        return {elem: eleTest, kfe: rKfe}
    }

    /** `bm_elem_from_knife_edge` (`:1525`). */
    private _bmElemFromKnifeEdge(kfe: KnifeEdge): BMElemAny | null {
        return kfe.e ?? kfe.basef
    }

    /** `knife_find_common_face` (`:1600`). */
    private _findCommonFace(faces1: BMFace[], faces2: BMFace[]): BMFace | null {
        for (const f1 of faces1) for (const f2 of faces2) if (f1 === f2) return f1
        return null
    }

    /** `new_knife_vert` (`:1618`). */
    private _newKnifeVert(co: readonly number[], cageco: readonly number[]): KnifeVert {
        const kfv: KnifeVert = {
            v: null, edges: [], faces: [], obIndex: 0, co: [co[0], co[1], co[2]], cageco: [cageco[0], cageco[1], cageco[2]],
            isCut: false, isInvalid: false, isSplitting: false,
        }
        this.kverts.push(kfv)
        return kfv
    }

    /** `new_knife_edge` (`:1630`). */
    private _newKnifeEdge(): KnifeEdge {
        const kfe: KnifeEdge = {
            v1: null as unknown as KnifeVert, v2: null as unknown as KnifeVert, basef: null, faces: [], e: null,
            isCut: false, isInvalid: false, splits: 0,
        }
        this.kedges.push(kfe)
        return kfe
    }

    /** `get_bm_knife_vert` (`:1638`): a KnifeVert wrapper for an existing BMVert. */
    private _getBmKnifeVert(v: BMVert): KnifeVert {
        let kfv = this._origVertMap.get(v)
        if (!kfv) {
            const cagecoWs = this._positionsCage.get(v) ?? mulM4V3(this.objectMatrix, coOf(v))
            kfv = this._newKnifeVert(coOf(v), cagecoWs)
            kfv.v = v
            kfv.obIndex = 0
            this._origVertMap.set(v, kfv)
            for (const f of facesOfVert(v)) kfv.faces.push(f)
        }
        return kfv
    }

    /** `get_bm_knife_edge` (`:1672`): a KnifeEdge wrapper for an existing BMEdge. */
    private _getBmKnifeEdge(e: BMEdge): KnifeEdge {
        let kfe = this._origEdgeMap.get(e)
        if (!kfe) {
            kfe = this._newKnifeEdge()
            kfe.e = e
            kfe.v1 = this._getBmKnifeVert(e.v1)
            kfe.v2 = this._getBmKnifeVert(e.v2)
            this._addToVertEdges(kfe)
            this._origEdgeMap.set(e, kfe)
            for (const f of facesOfEdge(e)) kfe.faces.push(f)
        }
        return kfe
    }

    /** `knife_get_face_kedges` (`:1696`). */
    private _getFaceKedges(f: BMFace): KnifeEdge[] {
        let list = this._kedgeFaceMap.get(f)
        if (!list) {
            list = []
            for (const e of edgesOfFace(f)) list.push(this._getBmKnifeEdge(e))
            this._kedgeFaceMap.set(f, list)
        }
        return list
    }

    /** `knife_add_to_vert_edges` (`:1581`). */
    private _addToVertEdges(kfe: KnifeEdge): void {
        kfe.v1.edges.push(kfe)
        kfe.v2.edges.push(kfe)
    }

    /** `knife_edge_append_face` (`:1716`). */
    private _edgeAppendFace(kfe: KnifeEdge, f: BMFace): void {
        this._getFaceKedges(f).push(kfe)
        kfe.faces.push(f)
    }

    /** `knife_split_edge` (`:1722`). Returns the new vertex and the new edge (`r_kfe`). */
    private _splitEdge(kfe: KnifeEdge, co: readonly number[], cageco: readonly number[]): KnifeVert {
        const newkfe = this._newKnifeEdge()
        newkfe.v1 = kfe.v1
        newkfe.v2 = this._newKnifeVert(co, cageco)
        newkfe.v2.obIndex = kfe.v1.obIndex
        newkfe.v2.isCut = true
        if (kfe.e) {
            // `knife_add_edge_faces_to_vert`: no checks for duplicates.
            for (const f of facesOfEdge(kfe.e)) newkfe.v2.faces.push(f)
        } else {
            // kfe cuts across an existing face. If v1 and v2 are in multiple faces together (e.g. if
            // they are in doubled polys) then this arbitrarily chooses one of them.
            const f = this._findCommonFace(kfe.v1.faces, kfe.v2.faces)
            if (f) newkfe.v2.faces.push(f)
        }
        newkfe.basef = kfe.basef

        const i = kfe.v1.edges.indexOf(kfe)
        kfe.v1.edges.splice(i, 1)
        kfe.v1 = newkfe.v2
        kfe.v1.isSplitting = true
        kfe.v1.edges.push(kfe)

        for (const f of [...kfe.faces]) this._edgeAppendFace(newkfe, f)

        this._addToVertEdges(newkfe)

        newkfe.isCut = kfe.isCut
        newkfe.e = kfe.e

        newkfe.splits++
        kfe.splits++

        this._undo!.splits++

        this._splitStack.push(kfe)
        this._splitStack.push(newkfe)

        return newkfe.v2
    }

    /** `knife_join_edge` (`:1780`): rejoin two edges split by `knife_split_edge`. */
    private _joinEdge(newkfe: KnifeEdge, kfe: KnifeEdge): void {
        newkfe.isInvalid = true
        newkfe.v2.isInvalid = true
        kfe.v1 = newkfe.v1
        kfe.splits--
        kfe.v1.isSplitting = false
        kfe.v2.isSplitting = false
    }

    // endregion

    // region cut / hit utils (`:1807-2380`)

    /**
     * `knife_start_cut` (`:1807`): the first click, or the first after a new cut (E / RMB). Copy the
     * current position data into prev.
     */
    startCut(mval: V2): void {
        const ray = this.view.winToRayClipped(mval)
        this._snapCurr(mval, ray.start, ray.dir, null, null)
        this.prev = clonePos(this.curr)
        this.mdata.isStored = false
    }

    /** `prepare_linehits_for_cut` (`:1860`): sort and remove duplicates. */
    private _prepareLinehitsForCut(): void {
        let isDouble = false
        if (!this.linehits.length) return

        // `linehit_compare` (`:1832`): lambda along cut, then depth, then the snapped vert. Vert
        // pointers compare by allocation order here.
        const vIndex = (v: KnifeVert | null) => v ? this.kverts.indexOf(v) : -1
        this.linehits.sort((a, b) => (a.l - b.l) || (a.m - b.m) || (vIndex(a.v) - vIndex(b.v)))

        // Remove any edge hits that are preceded or followed by a vertex hit that is very near. Mark
        // such edge hits using l == -1 and then do another pass to actually remove. Also remove all
        // but one of a series of vertex hits for the same vertex.
        const total = this.linehits.length
        for (let i = 0; i < total; i++) {
            const lhi = this.linehits[i]
            if (lhi.v === null) continue
            for (let j = i - 1; j >= 0; j--) {
                const lhj = this.linehits[j]
                if (!lhj.kfe || Math.abs(lhi.l - lhj.l) > KNIFE_FLT_EPSBIG || Math.abs(lhi.m - lhj.m) > KNIFE_FLT_EPSBIG) break
                if (lhi.kfe === lhj.kfe) {
                    lhj.l = -1
                    isDouble = true
                }
            }
            for (let j = i + 1; j < total; j++) {
                const lhj = this.linehits[j]
                if (Math.abs(lhi.l - lhj.l) > KNIFE_FLT_EPSBIG || Math.abs(lhi.m - lhj.m) > KNIFE_FLT_EPSBIG) break
                if ((lhj.kfe && lhi.kfe === lhj.kfe) || lhi.v === lhj.v) {
                    lhj.l = -1
                    isDouble = true
                }
            }
        }

        if (isDouble) {
            // Delete-in-place loop: copying from pos j to pos i+1.
            let i = 0
            let j = 1
            const lh = this.linehits
            while (j < total) {
                if (lh[j].l === -1) {
                    j++ // Skip copying this one.
                } else {
                    // Copy unless a no-op.
                    if (lh[i].l === -1) {
                        // Could happen if linehits[0] is being deleted.
                        lh[i] = {...lh[j]}
                    } else {
                        if (i + 1 !== j) lh[i + 1] = {...lh[j]}
                        i++
                    }
                    j++
                }
            }
            lh.length = i + 1
        }
    }

    /**
     * `knife_add_single_cut__is_linehit_outside_face` (`:1950`): if the linehit is connected to a real
     * edge/vert, true when `co` is outside the face.
     */
    private _isLinehitOutsideFace(f: BMFace, lh: KnifeLineHit, co: readonly number[]): boolean {
        if (lh.v && lh.v.v) {
            const l = faceVertShareLoop(f, lh.v.v)
            if (l && loopPointSideOfLoopTest(l, co) < 0) return true
        } else if (lh.kfe && lh.kfe.e) {
            const l = faceEdgeShareLoop(f, lh.kfe.e)
            if (l && loopPointSideOfEdgeTest(l, co) < 0) return true
        }
        return false
    }

    /** `knife_add_single_cut` (`:1975`). */
    private _addSingleCut(lh1: KnifeLineHit, lh2: KnifeLineHit, f: BMFace): void {
        if ((lh1.v && lh1.v === lh2.v) || (lh1.kfe && lh1.kfe === lh2.kfe)) return

        // If the cut is on an edge.
        if (lh1.v && lh2.v && lh1.v.v && lh2.v.v && diskEdgeExists(lh1.v.v, lh2.v.v)) return
        if (this._isLinehitOutsideFace(f, lh1, lh2.hit) || this._isLinehitOutsideFace(f, lh2, lh1.hit)) return

        // Check if edge actually lies within face (might not, if this face is concave).
        if ((lh1.v && !lh1.kfe) && (lh2.v && !lh2.kfe)) {
            if (!this._vertsEdgeInFace(lh1.v, lh2.v, f)) return
        }

        const kfe = this._newKnifeEdge()
        kfe.isCut = true
        kfe.basef = f

        if (lh1.v) {
            kfe.v1 = lh1.v
        } else if (lh1.kfe) {
            kfe.v1 = this._splitEdge(lh1.kfe, lh1.hit, lh1.cagehit)
            lh1.v = kfe.v1 // Record the KnifeVert for this hit.
        } else {
            kfe.v1 = this._newKnifeVert(lh1.hit, lh1.cagehit)
            kfe.v1.obIndex = lh1.obIndex
            kfe.v1.isCut = true
            kfe.v1.faces.push(lh1.f!)
            lh1.v = kfe.v1 // Record the KnifeVert for this hit.
        }

        if (lh2.v) {
            kfe.v2 = lh2.v
        } else if (lh2.kfe) {
            kfe.v2 = this._splitEdge(lh2.kfe, lh2.hit, lh2.cagehit)
            lh2.v = kfe.v2 // Future uses of lh2 won't split again.
        } else {
            kfe.v2 = this._newKnifeVert(lh2.hit, lh2.cagehit)
            kfe.v2.obIndex = lh2.obIndex
            kfe.v2.isCut = true
            kfe.v2.faces.push(lh2.f!)
            lh2.v = kfe.v2 // Record the KnifeVert for this hit.
        }

        this._addToVertEdges(kfe)

        if (kfe.basef && !kfe.faces.includes(kfe.basef)) this._edgeAppendFace(kfe, kfe.basef)

        // Update current undo frame cut count.
        this._undo!.cuts++
    }

    /** `knife_cut_face` (`:2056`): consecutive hits on one face, sorted by l then m. */
    private _cutFace(f: BMFace, hits: KnifeLineHit[]): void {
        if (hits.length < 2) return
        for (let i = 0; i + 1 < hits.length; i++) this._addSingleCut(hits[i], hits[i + 1], f)
    }

    /** `knife_make_face_cuts` (`:2070`). */
    private _makeFaceCuts(f: BMFace, kfedges: KnifeEdge[]): void {
        const bm = this.bm
        const edgeArray: BMEdge[] = []
        // Point to knife edges we've created edges in, edge_array aligned.
        const kfeArray: (KnifeEdge | null)[] = []
        const edgeVisit = new Set<BMEdge>()

        for (const kfe of kfedges) {
            let isNewEdge = false
            if (kfe.isInvalid) continue
            if (kfe.e === null) {
                if (kfe.v1.v && kfe.v2.v) kfe.e = diskEdgeExists(kfe.v1.v, kfe.v2.v)
            }
            if (kfe.e) {
                // Shouldn't happen, but in this case just ignore.
                if (edgeInFace(kfe.e, f)) continue
            } else {
                if (kfe.v1.v === null) kfe.v1.v = bm.vertCreate(kfe.v1.co[0], kfe.v1.co[1], kfe.v1.co[2])
                if (kfe.v2.v === null) kfe.v2.v = bm.vertCreate(kfe.v2.co[0], kfe.v2.co[1], kfe.v2.co[2])
                kfe.e = bm.edgeCreate(kfe.v1.v, kfe.v2.v)
                if (this.selectResult || (f.hflag & ElemFlag.Select)) edgeSelectSet(bm, kfe.e, true)
                isNewEdge = true
            }
            if (!edgeVisit.has(kfe.e)) {
                edgeVisit.add(kfe.e)
                kfeArray.push(isNewEdge ? kfe : null)
                edgeArray.push(kfe.e)
            }
        }

        if (edgeArray.length) {
            const edgeArrayLenOrig = edgeArray.length
            let net: BMEdge[] = edgeArray
            if (USE_NET_ISLAND_CONNECT) {
                const holes = faceSplitEdgenetConnectIslands(bm, f, edgeArray, true)
                if (holes) {
                    if (f.hflag & ElemFlag.Select) {
                        for (let i = edgeArray.length; i < holes.length; i++) edgeSelectSet(bm, holes[i], true)
                    }
                    net = holes
                }
            }
            faceSplitEdgenet(bm, f, net)

            // Remove dangling edges, not essential - but nice for users.
            for (let i = 0; i < edgeArrayLenOrig; i++) {
                const kfe = kfeArray[i]
                if (kfe === null) continue
                if (kfe.e && edgeIsWire(kfe.e)) {
                    bm.edgeKill(kfe.e)
                    kfe.e = null
                }
            }
        }
    }

    /** `knife_make_cuts` (`:2205`): turn the knife graph into real verts, edges and faces. */
    makeCuts(): void {
        const bm = this.bm
        const fhash = new Map<BMFace, KnifeEdge[]>()
        const ehash = new Map<BMEdge, KnifeVert[]>()

        // Put list of cutting edges for a face into fhash, keyed by face.
        for (const kfe of this.kedges) {
            if (kfe.isInvalid || kfe.v1.obIndex !== 0) continue
            // Select edges that lie directly on the cut.
            if (this.selectResult && kfe.e && kfe.isCut) edgeSelectSet(bm, kfe.e, true)
            const f = kfe.basef
            if (!f || kfe.e) continue
            let list = fhash.get(f)
            if (!list) fhash.set(f, list = [])
            list.push(kfe)
        }

        // Put list of splitting vertices for an edge into ehash, keyed by edge.
        for (const kfv of this.kverts) {
            if (kfv.v || kfv.isInvalid || kfv.obIndex !== 0) continue // Already have a BMVert.
            for (const kfe of kfv.edges) {
                const e = kfe.e
                if (!e) continue
                let list = ehash.get(e)
                if (!list) ehash.set(e, list = [])
                // There can be more than one kfe in kfv's list with same e.
                if (!list.includes(kfv)) list.push(kfv)
            }
        }

        // Split bmesh edges where needed.
        for (const [e, list] of ehash) {
            // `sort_verts_by_dist_cb` from `e->v1->co`, captured before splitting.
            const v1co = coOf(e.v1)
            list.sort((a, b) => lenSqV3V3(v1co, a.co) - lenSqV3V3(v1co, b.co))
            for (const kfv of list) {
                const pct = linePointFactorV3(kfv.co, coOf(e.v1), coOf(e.v2))
                // `BM_edge_split(bm, e, e->v1, &enew, pct)`
                kfv.v = splitEdgeMakeVert(bm, e, e.v1, pct).vNew
            }
        }

        if (this.onlySelect) {
            // `EDBM_flag_disable_all(em, BM_ELEM_SELECT)`
            for (const v of bm.verts) v.hflag &= ~ElemFlag.Select
            for (const e of bm.edges) e.hflag &= ~ElemFlag.Select
            for (const f of bm.faces) f.hflag &= ~ElemFlag.Select
            bm.totvertsel = bm.totedgesel = bm.totfacesel = 0
        }

        // Do cuts for each face.
        for (const [f, list] of fhash) this._makeFaceCuts(f, list)
    }

    /**
     * `knife_add_cut` (`:2299`): add all knife cuts implied by the line from prev to curr. If that line
     * crossed edges then `linehits` is non-empty. Make all of the KnifeVerts and KnifeEdges implied.
     */
    addCut(): void {
        // Allocate new undo frame on stack, unless cut is being dragged.
        if (!this.isDragUndo) {
            this._undo = {pos: clonePos(this.prev), cuts: 0, splits: 0, mdata: {...this.mdata, cage: [...this.mdata.cage] as V3, mval: [...this.mdata.mval] as V2}}
            this._undoStack.push(this._undo)
            this.isDragUndo = true
        }

        // Save values for angle drawing calculations.
        this.mdata.cage = [...this.prev.cage] as V3
        this.mdata.mval = [...this.prev.mval] as V2
        this.mdata.isStored = true

        this._prepareLinehitsForCut()
        if (!this.linehits.length) {
            if (!this.isDragHold) this.prev = clonePos(this.curr)
            return
        }

        // Consider most recent linehit in angle drawing calculations.
        if (this.linehits.length >= 2) this.mdata.cage = [...this.linehits[this.linehits.length - 2].cagehit] as V3

        // Make facehits: map face -> list of linehits touching it (`add_hit_to_facehits`, no dups).
        const facehits = new Map<BMFace, KnifeLineHit[]>()
        const addHit = (f: BMFace, lh: KnifeLineHit) => {
            let list = facehits.get(f)
            if (!list) facehits.set(f, list = [])
            if (!list.includes(lh)) list.push(lh)
        }
        for (const lh of this.linehits) {
            if (lh.f) addHit(lh.f, lh)
            if (lh.v) for (const f of lh.v.faces) addHit(f, lh)
            if (lh.kfe) for (const f of lh.kfe.faces) addHit(f, lh)
        }

        // NOTE: as the following loop progresses, the 'v' fields of the linehits are filled in (as
        // edges are split or in-face verts made), so both v and kfe/f may end up set.
        for (const [f, list] of facehits) this._cutFace(f, list)

        // Set up for next cut.
        this.prev = clonePos(this.curr)
        if (this.prev.bmface) {
            // Was "in face" but now we have a KnifeVert it is snapped to.
            const lh = this.linehits[this.linehits.length - 1]
            this.prev.vert = lh.v
            this.prev.bmface = null
        }
        if (this.isDragHold) {
            const lh = this.linehits[this.linehits.length - 1]
            // `linehit_to_knifepos` (`:1819`)
            this.prev.bmface = lh.f
            this.prev.vert = lh.v
            this.prev.edge = lh.kfe
            this.prev.cage = [...lh.cagehit] as V3
            this.prev.mval = [...lh.schit] as V2
        }
        this.linehits = []
    }

    /** `knife_finish_cut` (`:2377`). */
    finishCut(): void {
        this.linehits = []
    }

    // endregion

    // region screen line hits (`:2396-3055`)

    /**
     * `knife_ray_intersect_face` (`:2438`): intersection of v1-v2 with face f, at least
     * `face_tol_sq` (screen space) from the face's edges. Coplanar counts as no intersection.
     */
    private _rayIntersectFace(s: V2, v1: V3, v2: V3, f: BMFace, faceTolSq: number): {co: V3, cage: V3} | null {
        const [raydir] = normalize3(sub3(v2, v1))
        let triI = this._faceTriStart.get(f)!
        for (; triI < this._tris.length; triI++) {
            const tri = this._tris[triI]
            if (tri.f !== f) break
            const tc = tri.cos
            // Epsilon test in case the ray is directly through an internal tessellation edge; hits
            // near real edges are excluded by a later test.
            const r = isectRayTriEpsilonV3(v1, raydir, tc[0], tc[1], tc[2], KNIFE_FLT_EPS)
            if (!r) continue
            // Check if line coplanar with tri.
            const triNorm = normalTriV3(tc[0], tc[1], tc[2])
            const triPlane = planeFromPointNormal(tc[0], triNorm)
            if (distSquaredToPlane(v1, triPlane) < KNIFE_FLT_EPS && distSquaredToPlane(v2, triPlane) < KNIFE_FLT_EPS) return null
            const hitCage = interpV3V3V3Uv(tc[0], tc[1], tc[2], r[1], r[2])
            // Now check that far enough away from verts and edges.
            for (const kfe of this._getFaceKedges(f)) {
                if (kfe.isInvalid) continue
                const se1 = this._project(kfe.v1.cageco)
                const se2 = this._project(kfe.v2.cageco)
                if (distSquaredToLineSegmentV2(s, se1, se2) < faceTolSq) return null
            }
            const hitCo = interpV3V3V3Uv(coOf(tri.verts[0]), coOf(tri.verts[1]), coOf(tri.verts[2]), r[1], r[2])
            return {co: hitCo, cage: hitCage}
        }
        return null
    }

    /** `calc_ortho_extent` (`:2516`): centre and maximum excursion of the mesh. */
    private _calcOrthoExtent(): void {
        const min: V3 = [Infinity, Infinity, Infinity]
        const max: V3 = [-Infinity, -Infinity, -Infinity]
        for (const ws of this._positionsCage.values()) {
            for (let i = 0; i < 3; i++) {
                min[i] = Math.min(min[i], ws[i])
                max[i] = Math.max(max[i], ws[i])
            }
        }
        this.orthoExtent = lenV3V3(min, max) / 2
        this.orthoExtentCenter = mid3(min, max)
    }

    /**
     * `point_is_visible` (`:2615`): is `p` not clipped and not occluded by another face. `s` is the
     * screen projection of p. Faces matching `eleTest` (or connected to it) are ignored.
     */
    pointIsVisible(p: V3, s: V2, eleTest: BMElemAny | null): boolean {
        // Reject points that lie behind the viewpoint (perspective views only).
        if (!this.isOrtho && mulProjectM4V3Zfac(this.view.persmat, p) <= 0) return false
        // If not cutting through, make sure no face is in front of p.
        if (!this.cutThrough) {
            const viewPt = this.view.unprojectV3(s[0], s[1], 0)
            if (!viewPt) return true
            // Make p_ofs a little towards view, so ray doesn't hit p's face.
            let [view, dist] = normalize3(sub3(viewPt, p))
            const pOfs: V3 = [p[0], p[1], p[2]]
            // Avoid projecting behind the viewpoint.
            if (this.isOrtho) dist = this.view.clipEnd * 2
            // See if there's a face hit between p1 and the view.
            const hit = eleTest
                ? this._bvhRaycast(pOfs, view, KNIFE_FLT_EPS, dist, f => elemNotInFaceCheck(f, eleTest))
                : this._bvhRaycast(pOfs, view, KNIFE_FLT_EPS, dist)
            void view
            if (hit) return false
        }
        return true
    }

    /** `clip_to_ortho_planes` (`:2691`). */
    private _clipToOrthoPlanes(v1: V3, v2: V3, center: V3, d: number): [V3, V3] {
        const [dir] = normalize3(sub3(v1, v2))
        // could be v1 or v2
        const closest = projectPlaneNormalized(sub3(v1, center), dir)
        const c: V3 = [closest[0] + center[0], closest[1] + center[1], closest[2] + center[2]]
        return [madd3(c, dir, d), madd3(c, dir, -d)]
    }

    /** `knife_linehit_set` (`:2707`). */
    private _linehitSet(s1: V2, s2: V2, sco: V2, cage: V3, obIndex: number, v: KnifeVert | null, kfe: KnifeEdge | null): KnifeLineHit {
        const hit: KnifeLineHit = {
            hit: [0, 0, 0], cagehit: [cage[0], cage[1], cage[2]], schit: [sco[0], sco[1]],
            // Find position along screen line, used for sorting.
            l: lenV2V2(sco, s1) / lenV2V2(s2, s1),
            // `persmatob`: Blender multiplies the world-space cage point by `persmat * obmat`.
            m: dotM4V3RowZ(this.view.persmatob(this.objectMatrix), cage),
            v,
            // If this isn't from an existing BMVert, it may have been added to a BMEdge originally.
            // Knowing if the hit comes from an edge matters for edge-in-face checks later (#42611).
            kfe,
            f: null,
            obIndex,
        }
        if (v) hit.hit = [v.co[0], v.co[1], v.co[2]]
        else if (kfe) hit.hit = transformPointBySegV3(cage, kfe.v1.co, kfe.v2.co, kfe.v1.cageco, kfe.v2.cageco)
        return hit
    }

    /** `knife_linehit_face_test` (`:2743`). */
    private _linehitFaceTest(s1: V2, s2: V2, sco: V2, rayStart: V3, rayEnd: V3, f: BMFace, faceTolSq: number): KnifeLineHit | null {
        const r = this._rayIntersectFace(sco, rayStart, rayEnd, f, faceTolSq)
        if (!r) return null
        if (!this.pointIsVisible(r.cage, sco, f)) return null
        const hit = this._linehitSet(s1, s2, sco, r.cage, 0, null, null)
        hit.hit = r.co
        hit.f = f
        return hit
    }

    /** `knife_find_line_hits` (`:2769`): visible (or all, cutting through) hits of the drag line. */
    private _findLineHits(): void {
        this.linehits = []
        let v1: V3 = [...this.prev.cage] as V3
        let v2: V3 = [...this.curr.cage] as V3

        // Project screen line's 3d coordinates back into 2d.
        const s1 = this._project(v1)
        const s2 = this._project(v2)

        if (this.isInteractive) {
            if (lenSqV2V2(s1, s2) < 1) return
        } else {
            if (lenSqV2V2(s1, s2) < KNIFE_FLT_EPS_SQUARED) return
        }

        let plane: V4
        {
            let n: V3
            if (this.isOrtho) {
                n = cross3(sub3(v2, v1), this.view.viewinvCol(2))
            } else {
                const orig = this.view.viewinvCol(3)
                n = cross3(sub3(v1, orig), sub3(v2, orig))
            }
            plane = planeFromPointNormal(v1, n)
        }

        // First use BVH tree to find faces, knife edges, and knife verts that might intersect the cut
        // plane. This de-duplicates the candidates before doing more expensive intersection tests.
        const results = this._bvhIntersectPlane(plane)
        if (!results.length) return

        const faces = new Set<BMFace>()
        const kfes = new Set<KnifeEdge>()
        const kfvs = new Set<KnifeVert>()

        for (const ti of results) {
            const f = this._tris[ti].f
            // Occlude but never cut unselected faces (when only_select is used).
            if (this.onlySelect && !(f.hflag & ElemFlag.Select)) continue
            if (faces.has(f)) continue
            faces.add(f)
            for (const kfe of this._getFaceKedges(f)) {
                if (kfe.isInvalid) continue
                if (kfes.has(kfe)) continue
                kfes.add(kfe)
                kfvs.add(kfe.v1)
                kfvs.add(kfe.v2)
            }
        }

        // These tolerances, in screen space, are for intermediate hits, as ends are already snapped.
        let vertTol: number, lineTol: number, faceTol: number
        if (this.isInteractive) {
            vertTol = KNIFE_FLT_EPS_PX_VERT
            lineTol = KNIFE_FLT_EPS_PX_EDGE
            faceTol = KNIFE_FLT_EPS_PX_FACE
        } else {
            // Use 1/100th of a pixel, see #43896 (too big), #47910 (too small).
            vertTol = lineTol = faceTol = 0.5
        }
        const vertTolSq = vertTol * vertTol
        const lineTolSq = lineTol * lineTol
        const faceTolSq = faceTol * faceTol

        // First look for vertex hits.
        const linehits: KnifeLineHit[] = []
        for (const v of [...kfvs]) {
            let kfeHit: KnifeEdge | null = null
            let kfvIsInCut = false
            let s: V2
            if (v === this.prev.vert || v === this.curr.vert) {
                // This KnifeVert was captured by the snap system. Since the tolerance distance can
                // be different, add this vertex directly.
                kfeHit = this._bmElemFromKnifeVert(v, true).kfe
                s = v === this.prev.vert ? [...this.prev.mval] as V2 : [...this.curr.mval] as V2
                kfvIsInCut = true
            } else {
                s = this._project(v.cageco)
                const d = distSquaredToLineSegmentV2(s, s1, s2)
                if (d <= vertTolSq) {
                    const r = this._bmElemFromKnifeVert(v, true)
                    kfeHit = r.kfe
                    if (this.pointIsVisible(v.cageco, s, r.elem)) kfvIsInCut = true
                }
            }
            if (kfvIsInCut) {
                linehits.push(this._linehitSet(s1, s2, s, v.cageco, v.obIndex, v, kfeHit))
            } else {
                // This vertex isn't used so remove from `kfvs`.
                kfvs.delete(v)
            }
        }

        // Now edge hits; don't add if a vertex at end of edge should have hit.
        for (const kfe of kfes) {
            // If we intersect any of the vertices, don't attempt to intersect the edge.
            if (kfvs.has(kfe.v1) || kfvs.has(kfe.v2)) continue
            const se1 = this._project(kfe.v1.cageco)
            const se2 = this._project(kfe.v2.cageco)
            let pCage: V3 = [0, 0, 0]
            let pCageSs: V2 = [0, 0]
            let kfeIsInCut = false
            if (kfe === this.prev.edge) {
                // This KnifeEdge was captured by the snap system.
                pCage = [...this.prev.cage] as V3
                pCageSs = [...this.prev.mval] as V2
                kfeIsInCut = true
            } else if (kfe === this.curr.edge) {
                pCage = [...this.curr.cage] as V3
                pCageSs = [...this.curr.mval] as V2
                kfeIsInCut = true
            } else {
                let [isectKind, p] = isectSegSegV2PointEx(s1, s2, se1, se2, 0)
                if (p) pCageSs = p
                if (isectKind === -1) {
                    // isect_seg_seg_v2_point doesn't do tolerance test around ends of s1-s2.
                    pCageSs = closestToLineSegmentV2(s1, se1, se2)
                    if (lenSqV2V2(pCageSs, s1) <= lineTolSq) {
                        isectKind = 1
                    } else {
                        pCageSs = closestToLineSegmentV2(s2, se1, se2)
                        if (lenSqV2V2(pCageSs, s2) <= lineTolSq) isectKind = 1
                    }
                }
                if (isectKind === 1) {
                    const d1 = lenV2V2(pCageSs, se1)
                    const d2 = lenV2V2(se2, se1)
                    if (!(d1 <= lineTol || d2 <= lineTol || Math.abs(d1 - d2) <= lineTol)) {
                        // Can't just interpolate between ends of `kfe`: that doesn't work with
                        // perspective transformation.
                        const kfeDir = sub3(kfe.v2.cageco, kfe.v1.cageco)
                        const lambda = isectRayPlaneV3(kfe.v1.cageco, kfeDir, plane, false)
                        if (lambda !== null) {
                            pCage = madd3(kfe.v1.cageco, kfeDir, lambda)
                            if (this.pointIsVisible(pCage, pCageSs, this._bmElemFromKnifeEdge(kfe))) {
                                if (this.snapMidpoints) {
                                    // Choose intermediate point snap too.
                                    pCage = mid3(kfe.v1.cageco, kfe.v2.cageco)
                                    pCageSs = mid2(se1, se2)
                                }
                                kfeIsInCut = true
                            }
                        }
                    }
                }
            }
            if (kfeIsInCut) linehits.push(this._linehitSet(s1, s2, pCageSs, pCage, kfe.v1.obIndex, null, kfe))
        }

        // Now face hits; don't add if a vertex or edge in face should have hit, except when cutting
        // through, where skipping them would leave incomplete cuts (#158104).
        const useHitPrev = (this.prev.vert === null && this.prev.edge === null) || this.cutThrough
        const useHitCurr = ((this.curr.vert === null && this.curr.edge === null) || this.cutThrough) && !this.isDragHold
        if (useHitPrev || useHitCurr) {
            // Unproject screen line.
            const seg1 = this.view.winToSegmentClipped(s1)
            const seg2 = this.view.winToSegmentClipped(s2)
            v1 = seg1.start
            let v3 = seg1.end
            v2 = seg2.start
            let v4 = seg2.end
            // Numeric error, 'v1' -> 'v2', 'v2' -> 'v4' can end up being ~2000 units apart with an
            // orthogonal perspective: limit the distance between these points.
            if (this.isOrtho) {
                if (this.orthoExtent === 0) this._calcOrthoExtent()
                ;[v1, v3] = this._clipToOrthoPlanes(v1, v3, this.orthoExtentCenter, this.orthoExtent + 10)
                ;[v2, v4] = this._clipToOrthoPlanes(v2, v4, this.orthoExtentCenter, this.orthoExtent + 10)
            }
            for (const f of faces) {
                if (useHitPrev) {
                    const h = this._linehitFaceTest(s1, s2, s1, v1, v3, f, faceTolSq)
                    if (h) linehits.push(h)
                }
                if (useHitCurr) {
                    const h = this._linehitFaceTest(s1, s2, s2, v2, v4, f, faceTolSq)
                    if (h) linehits.push(h)
                }
            }
        }
        this.linehits = linehits
    }

    // endregion

    // region snapping (`:3079-3771`)

    /** `knife_find_closest_face` (`:3079`). */
    private _findClosestFace(mval: V2, rayOrig: V3, rayDir: V3, r: KnifePosData): boolean {
        const hit = this._bvhRaycast(rayOrig, rayDir, 0)
        let f: BMFace | null = hit ? hit.f : null
        let cage: V3 = hit ? hit.cagehit : [0, 0, 0]
        if (f && this.onlySelect && !(f.hflag & ElemFlag.Select)) f = null
        if (f === null && this.isInteractive && this._findNearestFace) {
            // Try the back-buffer selection method if ray casting failed.
            f = this._findNearestFace([Math.trunc(mval[0]), Math.trunc(mval[1])])
            // Cheat for now; just put in the origin instead of a true coordinate on the face. This
            // just puts a point 1.0f in front of the view.
            if (f) cage = [rayOrig[0] + rayDir[0], rayOrig[1] + rayDir[1], rayOrig[2] + rayDir[2]]
        }
        if (f) {
            r.cage = cage
            r.bmface = f
            r.obIndex = 0
            r.mval = [mval[0], mval[1]]
            return true
        }
        return false
    }

    /** `knife_sample_screen_density_from_closest_face` (`:3140`). */
    private _sampleScreenDensity(radius: number, f: BMFace, cageco: V3): number {
        const radiusSq = radius * radius
        let c = 0
        const sco = this._project(cageco)
        for (const kfe of this._getFaceKedges(f)) {
            if (kfe.isInvalid) continue
            for (const kfv of [kfe.v1, kfe.v2]) {
                if (kfv.isInvalid) continue
                const kfvSco = this._project(kfv.cageco)
                if (lenSqV2V2(kfvSco, sco) < radiusSq) c++
            }
        }
        return c
    }

    /** `knife_snap_size` (`:3193`): snapping distance scaled by the screen density of the mesh. */
    private _snapSize(maxsize: number): number {
        let density = 0
        if (!isSpace(this.curr)) density = this._sampleScreenDensity(maxsize * 2, this.curr.bmface!, this.curr.cage)
        return density ? Math.min(maxsize / (density * 0.5), maxsize) : maxsize
    }

    /** `knife_closest_constrain_to_edge` (`:3211`). */
    private _closestConstrainToEdge(cutOrigin: V3, cutDir: V3, kfv1: V3, kfv2: V3): V3 | null {
        // If snapping, check we're in bounds.
        const lambda = isectRayLineV3(cutOrigin, cutDir, kfv1, kfv2)
        if (lambda === null) return null
        // Be strict when constrained within edge.
        if (lambda < 0 - KNIFE_FLT_EPSBIG || lambda > 1 + KNIFE_FLT_EPSBIG) return null
        return interp3(kfv1, kfv2, lambda)
    }

    /** `knife_find_closest_edge_of_face` (`:3233`): `r.cage` is the closest point on the edge. */
    private _findClosestEdgeOfFace(f: BMFace, currCageSs: V2, currCageConstrain: V3 | null, rayOrig: V3, rayDir: V3, r: KnifePosData): boolean {
        let maxdist: number
        if (this.isInteractive) {
            maxdist = this._snapSize(this.ethresh)
            if (this.ignoreVertSnapping) maxdist *= 0.5
        } else {
            maxdist = KNIFE_FLT_EPS
        }
        const maxdistSq = maxdist * maxdist
        let curDistSq = maxdistSq
        let hasHit = false

        const cutOrigin = this.prev.cage
        const [cutDir] = normalize3(sub3(currCageConstrain ?? this.curr.cage, this.prev.cage))

        // Look through all edges associated with this face.
        for (const kfe of this._getFaceKedges(f)) {
            if (kfe.isInvalid) continue
            let testCagep: V3 | null
            // Get the closest point on the edge.
            if ((this.isAngleSnapping || this.axisConstrained) && kfe !== this.prev.edge && this.mode === 'dragging') {
                // Check if it is within the edges' bounds.
                testCagep = this._closestConstrainToEdge(cutOrigin, cutDir, kfe.v1.cageco, kfe.v2.cageco)
                if (!testCagep) continue
            } else {
                testCagep = closestRayToSegmentV3(rayOrig, rayDir, kfe.v1.cageco, kfe.v2.cageco)
            }
            // Check if we're close enough.
            const closestSs = this._project(testCagep)
            const disSq = lenSqV2V2(closestSs, currCageSs)
            if (disSq >= curDistSq) continue
            curDistSq = disSq
            r.edge = kfe
            if (this.snapMidpoints) {
                r.cage = mid3(kfe.v1.cageco, kfe.v2.cageco)
                r.mval = this._project(r.cage)
            } else {
                r.cage = testCagep
                r.mval = closestSs
            }
            hasHit = true
        }
        return hasHit
    }

    /** `knife_find_closest_vert_of_edge` (`:3322`): a vertex near the mouse cursor, if it exists. */
    private _findClosestVertOfEdge(kfe: KnifeEdge, cageSs: V2, r: KnifePosData): boolean {
        let maxdist: number
        if (this.isInteractive) {
            maxdist = this._snapSize(this.vthresh)
            if (this.ignoreVertSnapping) maxdist *= 0.5
        } else {
            maxdist = KNIFE_FLT_EPS
        }
        const maxdistSq = maxdist * maxdist
        let curv: KnifeVert | null = null
        let curKfvSco: V2 = [0, 0]
        let curdisSq = FLT_MAX
        for (const kfv of [kfe.v1, kfe.v2]) {
            const kfvSco = this._project(kfv.cageco)
            // Be strict when in a constrained mode, the vertex needs to be very close to the cut line.
            if ((this.isAngleSnapping || this.axisConstrained) && this.mode === 'dragging') {
                if (distSquaredToLineSegmentV2(kfvSco, this.prev.mval, this.curr.mval) > KNIFE_FLT_EPSBIG) continue
            }
            const disSq = lenSqV2V2(kfvSco, cageSs)
            if (disSq < curdisSq && disSq < maxdistSq) {
                curv = kfv
                curdisSq = disSq
                curKfvSco = kfvSco
            }
        }
        if (curv) {
            r.cage = [...curv.cageco] as V3
            r.vert = curv
            // Update mouse coordinates to the snapped-to vertex's screen coordinates; angle snap uses
            // the previous mouse position.
            r.mval = curKfvSco
            return true
        }
        return false
    }

    /** `knife_snap_v3_angle` (`:3389`). */
    private _snapV3Angle(dvec: V3, vecx: V3, axis: V3, angleSnap: number): {r: V3, angle: number} {
        const angle = angleSignedOnAxisV3V3V3(dvec, vecx, axis)
        const angleDelta = (Math.round(angle / angleSnap) * angleSnap) - angle
        return {r: rotateNormalizedV3(dvec, axis, angleDelta), angle: angle + angleDelta}
    }

    /** `knife_snap_angle_impl` (`:3398`). */
    private _snapAngleImpl(vecX: V3, axis: V3, rayOrig: V3, rayDir: V3): {cage: V3, angle: number} | null {
        const currCageProjected = isectLinePlaneV3(rayOrig, madd3(rayOrig, rayDir, 1), this.prev.cage, axis)
        if (!currCageProjected) return null
        const dvec = sub3(currCageProjected, this.prev.cage)
        // Currently user can input any float between 0 and 180.
        const snapStep = (this.angleSnappingIncrement > KNIFE_MIN_ANGLE_SNAPPING_INCREMENT && this.angleSnappingIncrement <= KNIFE_MAX_ANGLE_SNAPPING_INCREMENT)
            ? this.angleSnappingIncrement * DEG2RAD : KNIFE_DEFAULT_ANGLE_SNAPPING_INCREMENT * DEG2RAD
        // `is_zero_v2(dvec)`: Blender tests only the first two components.
        if (isZero2(dvec)) return null
        const {r, angle} = this._snapV3Angle(dvec, vecX, axis, snapStep)
        return {cage: [this.prev.cage[0] + r[0], this.prev.cage[1] + r[1], this.prev.cage[2] + r[2]], angle}
    }

    /** `knife_snap_angle_screen` (`:3435`). */
    private _snapAngleScreen(rayOrig: V3, rayDir: V3): {cage: V3, angle: number} | null {
        return this._snapAngleImpl(this.view.viewinvCol(0), this.view.viewinvCol(2), rayOrig, rayDir)
    }

    /** `knife_snap_angle_relative` (`:3447`): snap along the plane of the face nearest to prev. */
    private _snapAngleRelative(rayOrig: V3, rayDir: V3): {cage: V3, angle: number} | null {
        const fcurr = this._bvhRaycast(rayOrig, rayDir, 0)?.f ?? null
        if (!fcurr) return null

        // Calculate a reference vector using previous cut segment, edge or vertex.
        let refv: V3 | null = null
        if (this.prev.vert) {
            let count = 0
            for (const kfe of this.prev.vert.edges) {
                if (kfe.isInvalid) continue
                if (kfe.e && !edgeInFace(kfe.e, fcurr)) continue
                if (count === this.snapEdge) {
                    const kfv = compare3(kfe.v1.cageco, this.prev.cage, KNIFE_FLT_EPSBIG) ? kfe.v2 : kfe.v1
                    refv = sub3(kfv.cageco, this.prev.cage)
                    this.snapRefEdge = kfe
                    break
                }
                count++
            }
        } else if (this.prev.edge) {
            const kfv = compare3(this.prev.edge.v1.cageco, this.prev.cage, KNIFE_FLT_EPSBIG) ? this.prev.edge.v2 : this.prev.edge.v1
            refv = sub3(kfv.cageco, this.prev.cage)
            this.snapRefEdge = this.prev.edge
        } else {
            return null
        }
        // Blender reads an unset `refv` here when no edge matched `snap_edge`; there is nothing to
        // snap against then.
        if (!refv) return null

        // Choose best face for plane.
        let fprev: BMFace | null = null
        if (this.prev.vert && this.prev.vert.v) {
            for (const f of this.prev.vert.faces) if (f === fcurr) fprev = f
        } else if (this.prev.edge) {
            for (const f of this.prev.edge.faces) if (f === fcurr) fprev = f
        } else {
            // Cut segment was started in a face.
            const ray = this.view.winToRayClipped(this.prev.mval)
            fprev = this._bvhRaycast(ray.start, ray.dir, 0)?.f ?? null
        }
        if (!fprev || fprev !== fcurr) return null

        // Use normal global direction.
        const [noGlobal] = normalize3(mulTransposedMat3M4V3(this.worldToObject, fnoOf(fprev)))
        return this._snapAngleImpl(refv, noGlobal, rayOrig, rayDir)
    }

    /** `knife_calculate_snap_ref_edges` (`:3544`). */
    private _calculateSnapRefEdges(rayOrig: V3, rayDir: V3): number {
        const fcurr = this._bvhRaycast(rayOrig, rayDir, 0)?.f ?? null
        let count = 0
        if (!fcurr) return count
        if (this.prev.vert) {
            for (const kfe of this.prev.vert.edges) {
                if (kfe.isInvalid) continue
                if (kfe.e && !edgeInFace(kfe.e, fcurr)) continue
                count++
            }
        } else if (this.prev.edge) {
            return 1
        }
        return count
    }

    private _defaultOrientation(mode: KnifeAxisMode): [V3, V3, V3] {
        if (mode === KnifeAxisMode.Local) {
            const m = this.objectMatrix
            return [normalize3([m[0], m[1], m[2]])[0], normalize3([m[4], m[5], m[6]])[0], normalize3([m[8], m[9], m[10]])[0]]
        }
        return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    }

    /** `knife_constrain_axis` (`:3590`): constrain the current cut to an axis. */
    private _constrainAxis(rayOrig: V3, rayDir: V3): V3 | null {
        const mat = this._orientationMatrix(this.constrainAxisMode)
        const constrainDir = mat[this.constrainAxis - 1]
        const lambda = isectRayRayV3(this.prev.cage, constrainDir, rayOrig, rayDir)
        if (lambda === null) return null
        const cageDir: V3 = [constrainDir[0] * lambda, constrainDir[1] * lambda, constrainDir[2] * lambda]
        if (isZero3(cageDir)) return null
        return [this.prev.cage[0] + cageDir[0], this.prev.cage[1] + cageDir[1], this.prev.cage[2] + cageDir[2]]
    }

    /**
     * `knife_snap_curr` (`:3641`). `currCageConstrain` is `curr.cage` with constraints applied (snapping
     * recalculates coordinates in 3D); `fallback` is used when no geometry is found.
     */
    private _snapCurr(mval: V2, rayOrig: V3, rayDir: V3, currCageConstrain: V3 | null, fallback: V3 | null): void {
        this.curr = emptyPos()
        if (this._findClosestFace(mval, rayOrig, rayDir, this.curr)) {
            if (!this.ignoreEdgeSnapping || !this.ignoreVertSnapping) {
                const kposTmp = clonePos(this.curr)
                if (this._findClosestEdgeOfFace(this.curr.bmface!, this.curr.mval, currCageConstrain, rayOrig, rayDir, kposTmp)) {
                    if (!this.ignoreEdgeSnapping) this.curr = clonePos(kposTmp)
                    if (!this.ignoreVertSnapping) this._findClosestVertOfEdge(kposTmp.edge!, kposTmp.mval, this.curr)
                }
            }
        }
        if (this.curr.vert || this.curr.edge || this.curr.bmface) return

        this.curr.mval = [mval[0], mval[1]]
        if (fallback) {
            // If no geometry was found, use the fallback point.
            this.curr.cage = [...fallback] as V3
            return
        }
        // If no hits are found this would normally default to (0, 0, 0) so instead get a point at the
        // mouse ray closest to the previous point.
        const p = isectLinePlaneV3(rayOrig, madd3(rayOrig, rayDir, 1), this.prev.cage, this.view.viewinvCol(2))
        // Should never fail!
        this.curr.cage = p ?? [...this.prev.cage] as V3
    }

    /** `knife_snap_update_from_mval` (`:3705`). */
    snapUpdateFromMval(mval: V2): void {
        // Mouse and ray with snapping applied.
        const ray = this.view.winToRayClipped(mval)
        let rayOrig = ray.start
        let rayDir = ray.dir
        let mvalConstrain: V2 = [mval[0], mval[1]]

        this.curr = emptyPos()
        // view matrix may have changed, reproject
        this.prev.mval = this._project(this.prev.cage)

        let isConstrained = false
        this.isAngleSnapping = false
        if (this.mode === 'dragging') {
            if (this.angleSnapping) {
                if (this.angleSnappingMode === KnifeAngleSnap.Screen) {
                    const r = this._snapAngleScreen(rayOrig, rayDir)
                    if (r) {
                        this.curr.cage = r.cage
                        this.angle = r.angle
                    }
                    this.isAngleSnapping = !!r
                } else if (this.angleSnappingMode === KnifeAngleSnap.Relative) {
                    const r = this._snapAngleRelative(rayOrig, rayDir)
                    if (r) {
                        this.curr.cage = r.cage
                        this.angle = r.angle
                    }
                    this.isAngleSnapping = !!r
                    if (this.isAngleSnapping) this.snapRefEdgesCount = this._calculateSnapRefEdges(rayOrig, rayDir)
                }
            }
            if (this.isAngleSnapping) {
                isConstrained = true
            } else if (this.axisConstrained) {
                const c = this._constrainAxis(rayOrig, rayDir)
                if (c) this.curr.cage = c
                isConstrained = true
            }
        }

        let fallback: V3 | null = null
        let currCageConstrain: V3 | null = null
        if (isConstrained) {
            // Update ray and `mval_constrain`.
            if (this.isOrtho) {
                const l1 = sub3(this.curr.cage, rayDir)
                // `isect_line_plane_v3(ray_orig, l1, curr.cage, ray_orig, ray_dir)`: the line l1 ->
                // curr.cage against the plane through the old ray origin, written into `ray_orig`.
                const o = isectLinePlaneV3(l1, this.curr.cage, rayOrig, rayDir)
                // Should never fail!
                rayOrig = o ?? l1
            } else {
                rayDir = normalize3(sub3(this.curr.cage, rayOrig))[0]
            }
            mvalConstrain = this._project(this.curr.cage)
            currCageConstrain = [...this.curr.cage] as V3
            fallback = [...this.curr.cage] as V3
        }
        this._snapCurr(mvalConstrain, rayOrig, rayDir, currCageConstrain, fallback)
    }

    /**
     * `knifetool_undo` (`:3779`): undo the most recent cut segment. Assumes the most recent cut is the
     * last valid KnifeEdge, as Blender does.
     */
    private _knifetoolUndo(): void {
        const undo = this._undoStack[this._undoStack.length - 1]
        // Undo edge splitting.
        for (let i = 0; i < undo.splits; i++) {
            const newkfe = this._splitStack.pop()!
            const kfe = this._splitStack.pop()!
            this._joinEdge(newkfe, kfe)
        }
        for (let i = 0; i < undo.cuts; i++) {
            let lastkfe: KnifeEdge | null = null
            for (const kfe of this.kedges) {
                if (!kfe.isCut || kfe.isInvalid || kfe.splits) continue
                lastkfe = kfe
            }
            if (lastkfe) {
                lastkfe.isInvalid = true
                const v1 = lastkfe.v1
                const v2 = lastkfe.v2
                // Only remove first vertex if it is the start segment of the cut.
                if (!v1.isInvalid && !v1.isSplitting) {
                    v1.isInvalid = true
                    // If the first vertex is touching any other cut edges don't remove it.
                    for (const kfe of v1.edges) {
                        if (kfe.isCut && !kfe.isInvalid) {
                            v1.isInvalid = false
                            break
                        }
                    }
                }
                // Only remove second vertex if it is the end segment of the cut.
                if (!v2.isInvalid && !v2.isSplitting) {
                    v2.isInvalid = true
                    for (const kfe of v2.edges) {
                        if (kfe.isCut && !kfe.isInvalid) {
                            v2.isInvalid = false
                            break
                        }
                    }
                }
            }
        }
        if (this.mode === 'dragging' || this.mode === 'idle') {
            // Restore prev.
            this.prev = clonePos(undo.pos)
        }
        // Restore data for distance and angle measurements.
        this.mdata = undo.mdata
        this._undoStack.pop()
    }

    // endregion

    // region updates and finish (`:4078-4137`)

    /** `knife_update_active` (`:4078`). */
    updateActive(mval: V2): void {
        this.snapUpdateFromMval(mval)
        if (this.mode === 'dragging') this._findLineHits()
    }

    /** `knifetool_update_mval` (`:4088`). */
    updateMval(mval: V2): void {
        this.recalcOrtho()
        this.updateActive(mval)
    }

    /**
     * Apply the cut to the mesh: `knifetool_finish_ex` (`:4126`) - `knife_make_cuts` then
     * `knifetool_finish_single_post` (`EDBM_selectmode_flush`, normals).
     */
    finish(): void {
        this.makeCuts()
        selectModeFlush(this.bm)
        for (const f of this.bm.faces) faceNormalUpdate(f)
    }

    /** True while there is anything to undo with Ctrl+Z inside the tool. */
    get canUndo(): boolean {
        return this._undoStack.length > 0
    }

    /** `kcd->totkvert != 0`: whether confirming changes the mesh at all. */
    get totkvert(): number {
        return this.kverts.length
    }

    /** `knifetool_disable_angle_snapping` (`:4205`). */
    private _disableAngleSnapping(): void {
        this.angleSnappingMode = KnifeAngleSnap.None
        this.angleSnapping = false
        this.isAngleSnapping = false
    }

    /** `knifetool_disable_orientation_locking` (`:4213`). */
    private _disableOrientationLocking(): void {
        this.constrainAxis = KnifeAxis.None
        this.constrainAxisMode = KnifeAxisMode.None
        this.axisConstrained = false
    }

    /**
     * `knifetool_modal` (`:4220`). `defaultAngleSnappingIncrement` is the operator property Blender
     * re-reads on `ANGLE_SNAP_TOGGLE` (degrees). Number input for the angle increment is the caller's
     * (set {@link angleSnappingIncrement} and call {@link updateActive}).
     */
    modal(event: KnifeEvent, defaultAngleSnappingIncrement = KNIFE_DEFAULT_ANGLE_SNAPPING_INCREMENT): KnifeStatus {
        if (this.mode === 'panning') this.mode = this.prevmode
        const mval = event.mval

        if (event.type === 'modal') {
            switch (event.item) {
            case 'CANCEL':
                return 'cancelled'
            case 'CONFIRM': {
                const changed = this.totkvert !== 0
                this.finish()
                // Cancel to prevent undo push for empty cuts.
                return changed ? 'finished' : 'cancelled'
            }
            case 'UNDO':
                if (!this._undoStack.length) return 'cancelled'
                this._knifetoolUndo()
                this.updateActive(mval)
                break
            case 'SNAP_MIDPOINTS_ON':
                this.snapMidpoints = true
                this.recalcOrtho()
                this.updateActive(mval)
                break
            case 'SNAP_MIDPOINTS_OFF':
                this.snapMidpoints = false
                this.recalcOrtho()
                this.updateActive(mval)
                break
            case 'IGNORE_SNAP_ON':
                this.ignoreVertSnapping = this.ignoreEdgeSnapping = true
                break
            case 'IGNORE_SNAP_OFF':
                this.ignoreVertSnapping = this.ignoreEdgeSnapping = false
                break
            case 'ANGLE_SNAP_TOGGLE':
                if (this.angleSnappingMode !== KnifeAngleSnap.Relative) {
                    this.angleSnappingMode++
                    this.snapRefEdgesCount = 0
                    this.snapEdge = 0
                } else {
                    this.angleSnappingMode = KnifeAngleSnap.None
                }
                this.angleSnapping = this.angleSnappingMode !== KnifeAngleSnap.None
                this.angleSnappingIncrement = defaultAngleSnappingIncrement
                this._disableOrientationLocking()
                this.updateActive(mval)
                break
            case 'CYCLE_ANGLE_SNAP_EDGE':
                if (this.angleSnapping && this.angleSnappingMode === KnifeAngleSnap.Relative && this.snapRefEdgesCount) {
                    this.snapEdge = (this.snapEdge + 1) % this.snapRefEdgesCount
                    this.snapUpdateFromMval(this.curr.mval)
                }
                break
            case 'CUT_THROUGH_TOGGLE':
                this.cutThrough = !this.cutThrough
                this.updateActive(mval)
                break
            case 'SHOW_DISTANCE_ANGLE_TOGGLE':
                if (this.distAngleMode !== KnifeMeasurement.Angle) this.distAngleMode++
                else this.distAngleMode = KnifeMeasurement.None
                this.showDistAngle = this.distAngleMode !== KnifeMeasurement.None
                break
            case 'DEPTH_TEST_TOGGLE':
                this.depthTest = !this.depthTest
                break
            case 'NEW_CUT':
                // If no cuts have been made, exit. Preserves the right click cancel workflow most
                // tools use, but stops accidentally deleting entire cuts with right click.
                if (this.noCuts) return 'cancelled'
                this.finishCut()
                this.mode = 'idle'
                break
            case 'ADD_CUT':
                this.noCuts = false
                this.recalcOrtho()
                if (!event.release) {
                    if (this.mode === 'dragging') {
                        this.addCut()
                    } else if (this.mode !== 'panning') {
                        this.startCut(mval)
                        this.mode = 'dragging'
                        this.init = clonePos(this.curr)
                    }
                    // Freehand drawing is incompatible with cut-through.
                    if (!this.cutThrough) {
                        this.isDragHold = true
                        // No edge snapping while dragging (edges are too sticky when cuts are immediate).
                        this.ignoreEdgeSnapping = true
                    }
                } else {
                    this.isDragHold = false
                    this.ignoreEdgeSnapping = false
                    this.isDragUndo = false
                    // Needed because the last face 'hit' is ignored when dragging.
                    this.updateMval(this.curr.mval)
                }
                break
            case 'ADD_CUT_CLOSED':
                if (this.mode === 'dragging') {
                    // Shouldn't be possible with default key-layout, just in case.
                    if (this.isDragHold) {
                        this.isDragHold = false
                        this.isDragUndo = false
                        this.updateMval(this.curr.mval)
                    }
                    this.prev = clonePos(this.curr)
                    this.curr = clonePos(this.init)
                    this.curr.mval = this._project(this.curr.cage)
                    this.updateMval(this.curr.mval)
                    this.addCut()
                    // KNF_MODAL_NEW_CUT
                    this.finishCut()
                    this.mode = 'idle'
                }
                break
            case 'PANNING':
                if (!event.release) {
                    if (this.mode !== 'panning') {
                        this.prevmode = this.mode
                        this.mode = 'panning'
                    }
                } else {
                    this.mode = this.prevmode
                }
                return 'passThrough'
            case 'X_AXIS':
            case 'Y_AXIS':
            case 'Z_AXIS': {
                // Constrain axes with X,Y,Z keys (`:4524`).
                const axis = event.item === 'X_AXIS' ? KnifeAxis.X : event.item === 'Y_AXIS' ? KnifeAxis.Y : KnifeAxis.Z
                if (this.constrainAxis !== axis) {
                    this.constrainAxis = axis
                    this.constrainAxisMode = KnifeAxisMode.Global
                    this.axisString = 'XYZ'[axis - 1]
                } else {
                    // Cycle through modes with repeated key presses.
                    if (this.constrainAxisMode !== KnifeAxisMode.Local) {
                        this.constrainAxisMode++
                        this.axisString = this.axisString.toLowerCase()
                    } else {
                        this.constrainAxis = KnifeAxis.None
                        this.constrainAxisMode = KnifeAxisMode.None
                    }
                }
                this.axisConstrained = this.constrainAxis !== KnifeAxis.None
                this._disableAngleSnapping()
                // Needed so changes to constraints are re-evaluated without any cursor motion.
                this.updateMval(mval)
                break
            }
            }
        } else {
            // MOUSEMOVE: mouse moved somewhere to select another loop.
            if (this.mode !== 'panning') {
                this.updateMval(mval)
                if (this.isDragHold && this.linehits.length >= 2) this.addCut()
            }
        }
        return 'running'
    }

    // endregion

    // region draw data (`knifetool_draw`, `:832`)

    /** What `knifetool_draw` draws, in world space (cage coordinates). */
    drawData(): KnifeDrawData {
        const cutVerts: V3[] = []
        for (const kfv of this.kverts) if (kfv.isCut && !kfv.isInvalid) cutVerts.push(kfv.cageco)
        const cutEdges: [V3, V3][] = []
        for (const kfe of this.kedges) if (kfe.isCut && !kfe.isInvalid) cutEdges.push([kfe.v1.cageco, kfe.v2.cageco])
        return {
            prev: this.mode === 'dragging' || this.prev.vert || this.prev.edge || this.prev.bmface ? {
                cage: this.prev.cage, kind: this.prev.vert ? 'vert' : this.prev.edge ? 'edge' : this.prev.bmface ? 'face' : 'space',
            } : null,
            curr: {cage: this.curr.cage, kind: this.curr.vert ? 'vert' : this.curr.edge ? 'edge' : this.curr.bmface ? 'face' : 'space'},
            currEdge: this.curr.vert ? null : this.curr.edge ? [this.curr.edge.v1.cageco, this.curr.edge.v2.cageco] : null,
            line: this.mode === 'dragging' ? [this.prev.cage, this.curr.cage] : null,
            cutVerts,
            cutEdges,
            snapRefEdge: this.isAngleSnapping && this.angleSnappingMode === KnifeAngleSnap.Relative && this.snapRefEdge
                ? [this.snapRefEdge.v1.cageco, this.snapRefEdge.v2.cageco] : null,
            linehits: this.linehits.map(h => ({cage: h.cagehit, snappedToVert: !!h.v})),
            depthTest: this.depthTest,
        }
    }

    // endregion
}

/** What the knife preview shows (see `knifetool_draw`, `editmesh_knife.cc:832`). */
export interface KnifeDrawData {
    /** The last placed point: a big dot on a vertex, a smaller one on an edge or face. */
    prev: {cage: V3, kind: 'vert' | 'edge' | 'face' | 'space'} | null
    /** The point under the cursor. */
    curr: {cage: V3, kind: 'vert' | 'edge' | 'face' | 'space'}
    /** The edge under the cursor when snapped to an edge (highlighted). */
    currEdge: [V3, V3] | null
    /** The line from the last point to the cursor while cutting. */
    line: [V3, V3] | null
    /** Points and edges of the cut so far. */
    cutVerts: V3[]
    cutEdges: [V3, V3][]
    /** Relative angle snapping's reference edge. */
    snapRefEdge: [V3, V3] | null
    /** Where the current line would cut: vertex hits large, others small. */
    linehits: {cage: V3, snappedToVert: boolean}[]
    /** Whether the cut lines are depth tested (V toggles X-ray). */
    depthTest: boolean
}

/**
 * `EDBM_mesh_knife` (`editmesh_knife.cc:4751`): cut along screen-space polylines without interaction,
 * as Knife Project does. `polys` are region pixels (bottom-left origin); a closed loop repeats its
 * first point at the end. With `useTag`, faces inside the polylines are tagged with
 * {@link ElemFlag.Tag} (the selection Knife Project makes); returns the tagged faces.
 */
export function knifeProject(bm: BMesh, view: KnifeView, polys: readonly (readonly V2[])[], opts: {
    cutThrough?: boolean, useTag?: boolean, objectMatrix?: M4,
} = {}): BMFace[] {
    const kcd = new KnifeTool(bm, {
        view, objectMatrix: opts.objectMatrix, onlySelect: false, cutThrough: !!opts.cutThrough,
        depthTest: false, visibleMeasurements: KnifeMeasurement.None, angleSnapping: KnifeAngleSnap.None,
        angleSnappingIncrement: KNIFE_DEFAULT_ANGLE_SNAPPING_INCREMENT, isInteractive: false,
    })
    kcd.ignoreEdgeSnapping = true
    kcd.ignoreVertSnapping = true

    // Execute. (`BLI_linklist_prepend` in knifeproject_poly_from_object: the list is newest first.)
    kcd.recalcOrtho()
    for (const mvalFl of polys) {
        if (!mvalFl.length) continue
        kcd.startCut(mvalFl[0])
        kcd.mode = 'dragging'
        for (let i = 1; i < mvalFl.length; i++) {
            kcd.updateMval(mvalFl[i] as V2)
            kcd.addCut()
        }
        kcd.finishCut()
        kcd.mode = 'idle'
    }

    // Finish.
    if (opts.useTag) for (const e of bm.edges) e.hflag |= ElemFlag.Tag
    kcd.makeCuts()

    const tagged: BMFace[] = []
    if (opts.useTag) {
        tagged.push(...tagFacesInside(bm, kcd, view, polys, opts.objectMatrix))
    }
    // `knifetool_finish_single_post`
    selectModeFlush(bm)
    for (const f of bm.faces) faceNormalUpdate(f)
    void selectFlushMode
    return tagged
}

/** The face-tagging half of `EDBM_mesh_knife` (`:4824-4911`). */
function tagFacesInside(bm: BMesh, kcd: KnifeTool, view: KnifeView, polys: readonly (readonly V2[])[], objectMatrix?: M4): BMFace[] {
    const obmat = objectMatrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    // `edbm_mesh_knife_point_isect` (`:4733`)
    const pointIsect = (cent: V2) => {
        let isect = 0
        for (const p of polys) isect += isectPointPolyV2(cent, p as V2[], p.length - 1) ? 1 : 0
        return isect % 2 === 1
    }
    // Use face-loop tag to store if we have intersected.
    const unknown = new Set<BMFace>()
    for (const f of bm.faces) {
        unknown.add(f)
        f.hflag &= ~ElemFlag.Tag
    }
    const centSs = (f: BMFace): V2 => view.projectFloatGlobal(mulM4V3(obmat, faceCalcPointInFace(f)))

    // Tag all faces linked to cut edges.
    for (const e of bm.edges) {
        // Tagged: an original edge.
        if (e.hflag & ElemFlag.Tag) continue
        for (const f of facesOfEdge(e)) if (pointIsect(centSs(f))) f.hflag |= ElemFlag.Tag
    }
    // Expand tags for faces which are not cut, but are inside the polys.
    let keepSearch: boolean
    do {
        keepSearch = false
        for (const f of bm.faces) {
            if ((f.hflag & ElemFlag.Tag) || !unknown.has(f)) continue
            // Am I connected to a tagged face via an un-tagged edge (ie, not across a cut)?
            let found = false
            let l = f.lFirst
            do {
                if (l.e!.hflag & ElemFlag.Tag) {
                    let lr = l.radialNext!
                    if (lr !== l) {
                        do {
                            if (lr.f.hflag & ElemFlag.Tag) found = true
                        } while ((lr = lr.radialNext!) !== l && !found)
                    }
                }
            } while ((l = l.next) !== f.lFirst && !found)
            if (found) {
                const cent = mulM4V3(obmat, faceCalcPointInFace(f))
                const cs = view.projectFloatGlobal(cent)
                if ((kcd.cutThrough || kcd.pointIsVisible(cent, cs, f)) && pointIsect(cs)) {
                    f.hflag |= ElemFlag.Tag
                    keepSearch = true
                } else {
                    // Don't lose time on this face again, set it as outside.
                    unknown.delete(f)
                }
            }
        }
    } while (keepSearch)
    return [...bm.faces].filter(f => f.hflag & ElemFlag.Tag)
}

/**
 * `BM_face_calc_point_in_face` (`bmesh_polygon.cc:175`): the centre of the largest triangle of the
 * face's tessellation (the kernel's ear clipping stands in for `BM_face_calc_tessellation`).
 */
function faceCalcPointInFace(f: BMFace): V3 {
    const loops = f.loops()
    const pts: number[] = []
    for (const l of loops) pts.push(l.v.x, l.v.y, l.v.z)
    const idx: number[] = []
    if (f.len === 3) idx.push(0, 1, 2)
    else tessellatePolygon(pts, idx)
    let best: V3 = [loops[0].v.x, loops[0].v.y, loops[0].v.z]
    let bestArea = -1
    for (let i = 0; i < idx.length; i += 3) {
        const a = coOf(loops[idx[i]].v), b = coOf(loops[idx[i + 1]].v), c = coOf(loops[idx[i + 2]].v)
        const area = lenV3V3([0, 0, 0], cross3(sub3(b, a), sub3(c, a)))
        if (area > bestArea) {
            bestArea = area
            best = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]
        }
    }
    return best
}

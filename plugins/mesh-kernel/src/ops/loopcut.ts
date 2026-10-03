/**
 * Loop Cut: the cut half of Blender's Loop Cut and Slide, and the ring preview drawn while hovering.
 *
 * Ported from `source/blender/editors/mesh/editmesh_loopcut.cc` (`edgering_select`, `ringsel_finish`)
 * and `editmesh_preselect_edgering.cc` (`EDBM_preselect_edgering_update_from_edge`). Both are editor
 * code in Blender, but neither touches the view: the cut is a ring select plus `BM_mesh_esubdivide`,
 * the preview is geometry. The modal around them (hover, wheel for the cut count, click) is in
 * `@threepipe/plugin-mesh-edit`.
 */

import {BMEdge, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {radialLoops} from '../bmesh/structure'
import {walkEdgeRingIter} from '../bmesh/walkers'
import {edgeSelectSet, selectModeFlush, selectModeFlushEx, selectModeSet, selectNone, vertSelectSet} from '../bmesh/marking'
import {SelectMode, SelectModeMask} from '../constants'
import {Vec3} from '../math'
import {meshEsubdivide, SubdFalloff, SubdivideEdgesResult} from './subdivide'

/** `MESH_OT_loopcut`'s properties (`editmesh_loopcut.cc:721`). */
export interface LoopCutProps {
    /** `number_cuts`, at least 1. Default 1. */
    numberCuts?: number
    /** `smoothness`. Default 0. */
    smoothness?: number
    /** `falloff`. Default `inverseSquare` (`PROP_INVSQUARE`). */
    falloff?: SubdFalloff
    /**
     * Run as part of Loop Cut and Slide (`is_macro`, `op->opm != nullptr`): with several cuts in vertex
     * select mode, switch to edge mode, as the slide that follows needs edges.
     */
    isMacro?: boolean
}

export interface LoopCutResult {
    /** The subdivision's output. */
    subdivide: SubdivideEdgesResult
    /** `is_single`: the edge has no quad, so a single edge was cut rather than a ring. */
    isSingle: boolean
    /** The select mode before, when the cut changed it (`EDBM_selectmode_disable`). */
    selectModeBefore: SelectModeMask | null
}

/**
 * `edgering_select` (`editmesh_loopcut.cc:99`) without extend: deselect everything, then select the
 * edge ring through `edge` (`BMW_EDGERING`, hidden elements skipped, stopping at n-gons).
 */
export function edgeringSelect(bm: BMesh, edge: BMEdge): void {
    // `EDBM_flag_disable_all(em, BM_ELEM_SELECT)`.
    selectNone(bm)
    for (const e of walkEdgeRingIter(edge, {testHidden: true, delimitNgons: true})) edgeSelectSet(bm, e, true)
}

/** `BM_edge_is_any_face_len_test` (`bmesh_query.cc:2033`). */
function edgeIsAnyFaceLenTest(e: BMEdge, len: number): boolean {
    for (const l of radialLoops(e)) if (l.f.len === len) return true
    return false
}

/** `EDBM_selectmode_disable` (`editmesh_select.cc:3415`): leave `disable` for `fallback` when it is on. */
function selectmodeDisable(bm: BMesh, disable: SelectModeMask, fallback: SelectModeMask): boolean {
    // Not essential, but switch out of vertex mode since the selected regions won't be nicely
    // isolated after flushing.
    if (!(bm.selectMode & disable)) return false
    const mode = bm.selectMode === disable ? fallback : bm.selectMode & ~disable
    selectModeSet(bm, mode)
    return true
}

/**
 * `ringsel_finish` with `do_cut` (`editmesh_loopcut.cc:158`): select the edge ring through `edge` and
 * subdivide it, leaving the new loops selected for the edge slide; or, when the edge has no quad,
 * cut just that edge. May switch the select mode to edges (returned in `selectModeBefore`).
 */
export function editMeshLoopCut(bm: BMesh, edge: BMEdge, props: LoopCutProps = {}): LoopCutResult {
    const cuts = Math.max(1, Math.trunc(props.numberCuts ?? 1))
    const smoothness = props.smoothness ?? 0
    const smoothFalloff = props.falloff ?? 'inverseSquare'
    const isMacro = !!props.isMacro
    const vEedOrig: [BMVert, BMVert] = [edge.v1, edge.v2]

    edgeringSelect(bm, edge)

    // a single edge (rare, but better support)
    const isEdgeWire = edge.l === null
    const isSingle = isEdgeWire || !edgeIsAnyFaceLenTest(edge, 4)
    const selectType = isEdgeWire ? 'inner' : isSingle ? 'none' : 'loopcut'

    // Enable grid-fill, so that intersecting loop-cut works as one would expect. Note though that it
    // will break edge-slide in this specific case. See #31939.
    const subdivide = meshEsubdivide(bm, {
        cuts,
        smooth: smoothness,
        smoothFalloff,
        useSmoothEven: true,
        fractal: 0,
        alongNormal: 0,
        quadCornerType: 'path',
        useSingleEdge: false,
        useGridFill: true,
        useOnlyQuads: false,
        seed: 0,
        selectType,
    })

    const before = bm.selectMode
    let selectModeBefore: SelectModeMask | null = null
    if (isSingle) {
        // de-select endpoints
        vertSelectSet(bm, vEedOrig[0], false)
        vertSelectSet(bm, vEedOrig[1], false)
        selectModeFlushEx(bm, SelectMode.Vertex, false)
    } else if (isMacro && cuts > 1 && bm.selectMode & SelectMode.Vertex) {
        // We can't slide multiple edges in vertex select mode, force edge select mode.
        selectmodeDisable(bm, SelectMode.Vertex, SelectMode.Edge)
        selectModeBefore = before
    } else if (selectmodeDisable(bm, SelectMode.Face, SelectMode.Edge)) {
        // Force edge slide to edge select mode in face select mode; the change will flush selection.
        selectModeBefore = before
    } else {
        // else flush explicitly
        selectModeFlush(bm)
    }
    return {subdivide, isSingle, selectModeBefore}
}

// region preview (`editmesh_preselect_edgering.cc`)

/** `EditMesh_PreSelEdgeRing`: the preview lines (pairs of points) and points, object space. */
export interface EdgeRingPreview {
    edges: [Vec3, Vec3][]
    verts: Vec3[]
}

const coOf = (v: BMVert): Vec3 => [v.x, v.y, v.z]
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** `BM_edge_in_face`. */
function edgeInFace(e: BMEdge, f: BMLoop['f']): boolean {
    for (const l of f.eachLoop()) if (l.e === e) return true
    return false
}

/** `BM_loop_other_edge_loop` (`bmesh_query.cc`): the loop on the face's other edge at `v`. */
function loopOtherEdgeLoop(l: BMLoop, v: BMVert): BMLoop {
    return l.v === v ? l.prev : l.next
}

/**
 * `edgering_find_order` (`editmesh_preselect_edgering.cc:84`): given two opposite edges of a face,
 * order `eed`'s vertices (into `v[0]`) so the preview lines to `eed_last` (`v[1]`) don't cross.
 */
function edgeringFindOrder(eedLast: BMEdge, eed: BMEdge, eveLast: BMVert, v: [[BMVert | null, BMVert | null], [BMVert | null, BMVert | null]]): void {
    let l: BMLoop | null = eed.l
    // find correct order for v[1]
    if (!(edgeInFace(eed, l!.f) && edgeInFace(eedLast, l!.f))) {
        // `BM_ITER_ELEM (l, &liter, l, BM_LOOPS_OF_LOOP)`: the other loops of the radial cycle; null when
        // none matches.
        const start: BMLoop = l!
        let found: BMLoop | null = null
        for (let it = start.radialNext!; it !== start; it = it.radialNext!) {
            if (edgeInFace(eed, it.f) && edgeInFace(eedLast, it.f)) {
                found = it
                break
            }
        }
        l = found
    }

    // this should never happen
    if (!l) {
        v[0][0] = eed.v1
        v[0][1] = eed.v2
        v[1][0] = eedLast.v1
        v[1][1] = eedLast.v2
        return
    }

    let lOther = loopOtherEdgeLoop(l, eed.v1)
    const rev = lOther === l.prev
    while (lOther.v !== eedLast.v1 && lOther.v !== eedLast.v2) lOther = rev ? lOther.prev : lOther.next

    if (lOther.v === eveLast) {
        v[0][0] = eed.v1
        v[0][1] = eed.v2
    } else {
        v[0][0] = eed.v2
        v[0][1] = eed.v1
    }
}

/** `BM_edge_share_quad_check` (`bmesh_query.cc:1068`). */
function edgeShareQuadCheck(e1: BMEdge, e2: BMEdge): boolean {
    if (!e1.l || !e2.l) return false
    for (const l of radialLoops(e1)) if (l.f.len === 4 && edgeInFace(e2, l.f)) return true
    return false
}

/**
 * `EDBM_preselect_edgering_update_from_edge` (`editmesh_preselect_edgering.cc:347`): the lines a loop
 * cut with `previewlines` cuts would make through the ring of `eedStart`, or the points it would put
 * on `eedStart` alone when the edge has no quad.
 */
export function edgeringPreviewFromEdge(eedStart: BMEdge, previewlines: number): EdgeRingPreview {
    if (!edgeIsAnyFaceLenTest(eedStart, 4)) {
        // `view3d_preselect_mesh_edgering_update_verts_from_edge` (`:212`).
        const verts: Vec3[] = []
        const a = coOf(eedStart.v1), b = coOf(eedStart.v2)
        for (let i = 1; i <= previewlines; i++) verts.push(lerp(a, b, i / (previewlines + 1)))
        return {edges: [], verts}
    }

    // `view3d_preselect_mesh_edgering_update_edges_from_edge` (`:237`).
    const edgeStack: BMEdge[] = []
    for (const eed of walkEdgeRingIter(eedStart, {testHidden: true, delimitNgons: true})) edgeStack.push(eed)
    // The last edge walked; `eed_last` held the first, but only for the allocation size.
    eedStart = edgeStack[edgeStack.length - 1]

    const edges: [Vec3, Vec3][] = []
    const v: [[BMVert | null, BMVert | null], [BMVert | null, BMVert | null]] = [[null, null], [null, null]]
    let eveLast: BMVert | null = null
    let eedLast: BMEdge | null = null

    while (edgeStack.length) {
        const eed = edgeStack.pop()!
        if (eedLast) {
            if (eveLast) {
                v[1][0] = v[0][0]
                v[1][1] = v[0][1]
            } else {
                v[1][0] = eedLast.v1
                v[1][1] = eedLast.v2
                eveLast = eedLast.v1
            }
            edgeringFindOrder(eedLast, eed, eveLast, v)
            eveLast = v[0][0]
            for (let i = 1; i <= previewlines; i++) {
                const fac = i / (previewlines + 1)
                edges.push([lerp(coOf(v[0][0]!), coOf(v[0][1]!), fac), lerp(coOf(v[1][0]!), coOf(v[1][1]!), fac)])
            }
        }
        eedLast = eed
    }

    if (eedLast !== eedStart && edgeShareQuadCheck(eedLast!, eedStart)) {
        v[1][0] = v[0][0]
        v[1][1] = v[0][1]
        edgeringFindOrder(eedLast!, eedStart, eveLast!, v)
        for (let i = 1; i <= previewlines; i++) {
            const fac = i / (previewlines + 1)
            if (!v[0][0] || !v[0][1] || !v[1][0] || !v[1][1]) continue
            edges.push([lerp(coOf(v[0][0]), coOf(v[0][1]), fac), lerp(coOf(v[1][0]), coOf(v[1][1]), fac)])
        }
    }
    return {edges, verts: []}
}

// endregion

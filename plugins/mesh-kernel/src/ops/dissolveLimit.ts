/**
 * Limited Dissolve: dissolving the edges between (almost) coplanar faces and the vertices on
 * (almost) straight edge chains, cheapest first, up to an angle limit.
 *
 * Ported from `source/blender/bmesh/tools/bmesh_decimate_dissolve.cc` (`BM_mesh_decimate_dissolve_ex`,
 * `BM_mesh_decimate_dissolve` and every helper), `bmesh/operators/bmo_dissolve.cc`
 * (`bmo_dissolve_limit_exec`), `blenlib/intern/BLI_heap.cc` (the min-heap that orders the work) and
 * `editors/mesh/editmesh_tools.cc` (`edbm_dissolve_limited_exec`, `MESH_OT_dissolve_limited`).
 *
 * Blender's heap stores `float` values and its costs are computed in `float`; the costs here are
 * computed in double and rounded to float32 when they enter the heap, so equal costs tie the way
 * Blender's do (the tie order is the heap's, which is ported exactly). Costs that differ only below
 * float precision can still order differently - a known, documented limit of the port.
 *
 * Every delimiter is supported: the kernel has seams (`ElemFlag.Seam`), sharp edges (no
 * `ElemFlag.Smooth`), material slots (`BMFace.matNr`), face normals, and UV maps (every `float2`
 * corner layer, as Blender takes every `CD_PROP_FLOAT2` loop layer).
 *
 * `BM_ELEM_TAG` (wire edges before the dissolve) and the element indices Blender uses as heap-table
 * slots are local maps here; Blender leaves `BM_ELEM_TAG` set on the edges afterwards, which nothing
 * reads.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {edgeIsManifold, edgeIsWire} from '../bmesh/structure'
import {faceNormalUpdate} from '../bmesh/polygon'
import {BMLayerDef, getComponent} from '../bmesh/customdata'
import {selectCountsRecalc} from '../bmesh/marking'
import {elemsHflagEnable} from '../bmesh/hflag'
import {angleNormalizedV3V3, angleV3V3V3, axisDominantV3ToM3, crossTriV2, Mat3Rows, Vec2} from '../math/geom'
import {v3normalize, v3sub, Vec3} from '../math'
import {ElemFlag, ElemType, SelectMode, SelectModeMask} from '../constants'
import {normalsUpdate} from './bevel-bmquery'
import {bmeshEditEnd} from './edgenet'
import {
    DISSOLVE_EDIT_END,
    DissolveSelectionResult,
    elemsWithHflag,
    facesJoinPair,
    vertCollapseEdge,
    vertEdgePair,
    vertIsEdgePair,
} from './dissolve'

// region helpers

/** `FLT_MAX`, Blender's `COST_INVALID` (`bmesh_decimate_dissolve.cc:30`). */
const COST_INVALID = 3.4028234663852886e38
/** {@link COST_INVALID} as the heap stores it (`FLT_MAX` is exact in float32). */
const COST_INVALID_F = Math.fround(COST_INVALID)
/** `FLT_EPSILON`. */
const FLT_EPSILON = 1.1920928955078125e-7

/** `signum_i` (`math_base_inline.cc:552`). */
function signumI(a: number): number {
    if (a > 0) return 1
    if (a < 0) return -1
    return 0
}

/** `line_point_side_v2` (`math_vector_inline.cc:1090`). */
function linePointSideV2(l1: Vec2, l2: Vec2, pt: Vec2): number {
    return ((l1[0] - pt[0]) * (l2[1] - pt[1])) - ((l2[0] - pt[0]) * (l1[1] - pt[1]))
}

/** `isect_point_tri_v2_cw` (`math_geom.cc:1570`). */
function isectPointTriV2Cw(pt: Vec2, v1: Vec2, v2: Vec2, v3: Vec2): boolean {
    if (linePointSideV2(v1, v2, pt) >= 0) {
        if (linePointSideV2(v2, v3, pt) >= 0) {
            if (linePointSideV2(v3, v1, pt) >= 0) return true
        }
    }
    return false
}

/** `cos_v3v3v3` (`math_vector.cc:264`): cosine of the angle at `p2`. */
function cosV3V3V3(p1: Vec3, p2: Vec3, p3: Vec3): number {
    const vec1 = v3normalize(v3sub(p2, p1))
    const vec2 = v3normalize(v3sub(p2, p3))
    return vec1[0] * vec2[0] + vec1[1] * vec2[1] + vec1[2] * vec2[2]
}

/** `BM_edge_is_contiguous` (`bmesh_query_inline.hh:96`): manifold, and both faces wind the same way. */
export function edgeIsContiguous(e: BMEdge): boolean {
    const l = e.l
    let lOther: BMLoop | null
    return l !== null && (lOther = l.radialNext) !== l && lOther!.radialNext === l && lOther!.v !== l.v
}

/** `BM_vert_calc_edge_angle_ex` (`bmesh_query.cc:1411`): pi minus the angle at a two-edge vertex. */
export function vertCalcEdgeAngleEx(v: BMVert, fallback: number): number {
    let e1: BMEdge | null
    let e2: BMEdge | null
    if ((e1 = v.e) && (e2 = e1.diskNext(v)) && e1 !== e2 && e1 === e2.diskNext(v)) {
        const v1 = e1.otherVert(v)
        const v2 = e2.otherVert(v)
        return Math.PI - angleV3V3V3([v1.x, v1.y, v1.z], [v.x, v.y, v.z], [v2.x, v2.y, v2.z])
    }
    return fallback
}

/** `BM_edge_calc_face_angle_ex` (`bmesh_query.cc:1343`): the angle between the two face normals. */
export function edgeCalcFaceAngleEx(e: BMEdge, fallback: number): number {
    if (edgeIsManifold(e)) {
        const l1 = e.l!
        const l2 = l1.radialNext!
        return angleNormalizedV3V3([l1.f.nx, l1.f.ny, l1.f.nz], [l2.f.nx, l2.f.ny, l2.f.nz])
    }
    return fallback
}

/** A `HeapNode` (`BLI_heap.cc`). */
export interface HeapNode<T> {
    value: number
    index: number
    ptr: T
}

/**
 * `Heap` (`blenlib/intern/BLI_heap.cc`): Blender's binary min-heap, ported operation for operation so
 * equal values come out in Blender's order. Values are stored as float32, like `HeapNode::value`.
 */
export class BLIHeap<T> {
    private tree: HeapNode<T>[] = []

    /** `heap_swap` */
    private swap(i: number, j: number): void {
        const tree = this.tree
        const pi = tree[i], pj = tree[j]
        pi.index = j
        tree[j] = pi
        pj.index = i
        tree[i] = pj
    }

    /** `heap_down` */
    private down(i: number): void {
        const tree = this.tree
        const size = tree.length
        while (true) {
            const l = (i << 1) + 1
            const r = (i << 1) + 2
            let smallest = i
            if (l < size && tree[l].value < tree[smallest].value) smallest = l
            if (r < size && tree[r].value < tree[smallest].value) smallest = r
            if (smallest === i) break
            this.swap(i, smallest)
            i = smallest
        }
    }

    /** `heap_up` */
    private up(i: number): void {
        const tree = this.tree
        while (i > 0) {
            const p = (i - 1) >> 1
            if (tree[p].value < tree[i].value) break
            this.swap(p, i)
            i = p
        }
    }

    /** `BLI_heap_insert` */
    insert(value: number, ptr: T): HeapNode<T> {
        const node: HeapNode<T> = {value: Math.fround(value), index: this.tree.length, ptr}
        this.tree.push(node)
        this.up(node.index)
        return node
    }

    /** `BLI_heap_is_empty` */
    isEmpty(): boolean {
        return this.tree.length === 0
    }

    /** `BLI_heap_len` */
    get length(): number {
        return this.tree.length
    }

    /** `BLI_heap_top` */
    top(): HeapNode<T> {
        return this.tree[0]
    }

    /** `BLI_heap_pop_min` */
    popMin(): T {
        const ptr = this.tree[0].ptr
        const size = this.tree.length - 1
        if (size) {
            this.swap(0, size)
            this.tree.pop()
            this.down(0)
        } else {
            this.tree.pop()
        }
        return ptr
    }

    /** `BLI_heap_remove` */
    remove(node: HeapNode<T>): void {
        let i = node.index
        while (i > 0) {
            const p = (i - 1) >> 1
            this.swap(p, i)
            i = p
        }
        this.popMin()
    }

    /** `BLI_heap_node_value_update` */
    nodeValueUpdate(node: HeapNode<T>, value: number): void {
        value = Math.fround(value)
        if (value < node.value) {
            node.value = value
            this.up(node.index)
        } else if (value > node.value) {
            node.value = value
            this.down(node.index)
        }
    }
}

// endregion

/** `BMO_Delimit` (`bmesh_operator_api.hh:545`), the `delimit` flag set. */
export const DissolveDelimit = {
    /** "Normal": delimit by face directions. */
    Normal: 1 << 0,
    /** "Material": delimit by face material. */
    Material: 1 << 1,
    /** "Seam": delimit by edge seams. */
    Seam: 1 << 2,
    /** "Sharp": delimit by sharp edges. */
    Sharp: 1 << 3,
    /** "UVs": delimit by UV coordinates. */
    UV: 1 << 4,
} as const

/** `DelimitData` (`bmesh_decimate_dissolve.cc:34`): the UV layers to compare. */
interface DelimitData {
    uvLayers: BMLayerDef[]
}

/** `CustomData_data_equals(CD_PROP_FLOAT2, ..)`: `layerEqual_propfloat2` (`customdata.cc:1425`). */
function float2Equals(a: BMLoop, b: BMLoop, layer: BMLayerDef): boolean {
    const dx = getComponent(a, layer, 0) - getComponent(b, layer, 0)
    const dy = getComponent(a, layer, 1) - getComponent(b, layer, 1)
    return Math.fround(dx * dx + dy * dy) < Math.fround(0.00001)
}

/** `BM_edge_is_contiguous_loop_cd` (`bmesh_query.cc:887`) for one `float2` corner layer. */
function edgeIsContiguousLoopCd(e: BMEdge, layer: BMLayerDef): boolean {
    if (e.l && e.l.radialNext !== e.l) {
        const lBaseV1 = e.l
        const lBaseV2 = e.l.next
        let lIter = e.l.radialNext!
        do {
            let lIterV1: BMLoop
            let lIterV2: BMLoop
            if (lIter.v === lBaseV1.v) {
                lIterV1 = lIter
                lIterV2 = lIter.next
            } else {
                lIterV1 = lIter.next
                lIterV2 = lIter
            }
            if (!float2Equals(lBaseV1, lIterV1, layer) || !float2Equals(lBaseV2, lIterV2, layer)) {
                return false
            }
        } while ((lIter = lIter.radialNext!) !== e.l)
    }
    return true
}

/** `bm_edge_is_contiguous_loop_cd_all` (`bmesh_decimate_dissolve.cc:80`). */
function edgeIsContiguousLoopCdAll(e: BMEdge, delimitData: DelimitData): boolean {
    for (const layer of delimitData.uvLayers) {
        if (!edgeIsContiguousLoopCd(e, layer)) return false
    }
    return true
}

/** `bm_edge_is_delimiter` (`bmesh_decimate_dissolve.cc:95`). The caller ensures `e` is manifold. */
function edgeIsDelimiter(e: BMEdge, delimit: number, delimitData: DelimitData): boolean {
    if (delimit !== 0) {
        if (delimit & DissolveDelimit.Seam) {
            if (e.hflag & ElemFlag.Seam) return true
        }
        if (delimit & DissolveDelimit.Sharp) {
            if ((e.hflag & ElemFlag.Smooth) === 0) return true
        }
        if (delimit & DissolveDelimit.Material) {
            if (e.l!.f.matNr !== e.l!.radialNext!.f.matNr) return true
        }
        if (delimit & DissolveDelimit.Normal) {
            if (!edgeIsContiguous(e)) return true
        }
        if (delimit & DissolveDelimit.UV) {
            if (!edgeIsContiguousLoopCdAll(e, delimitData)) return true
        }
    }
    return false
}

/** `bm_vert_is_delimiter` (`bmesh_decimate_dissolve.cc:133`). */
function vertIsDelimiter(v: BMVert, delimit: number, delimitData: DelimitData): boolean {
    if (delimit !== 0) {
        const eFirst = v.e!
        let e = eFirst
        do {
            if (edgeIsManifold(e)) {
                if (edgeIsDelimiter(e, delimit, delimitData)) return true
            }
        } while ((e = e.diskNext(v)!) !== eFirst)
    }
    return false
}

/**
 * `bm_vert_edge_face_angle` (`bmesh_decimate_dissolve.cc:53`): the vertex's edge angle, multiplied
 * (as a fraction of 90 degrees) by its edge's face angle when that edge is manifold and the vertex is
 * not on a delimiter - so a corner between almost-planar faces does not survive.
 */
function vertEdgeFaceAngle(v: BMVert, delimit: number, delimitData: DelimitData): number {
    const UNIT_TO_ANGLE = Math.PI / 2
    const ANGLE_TO_UNIT = 1 / UNIT_TO_ANGLE
    const angle = vertCalcEdgeAngleEx(v, Math.PI / 2)
    // NOTE: could be either edge, it doesn't matter.
    if (v.e && edgeIsManifold(v.e)) {
        if (!vertIsDelimiter(v, delimit, delimitData)) {
            return ((angle * ANGLE_TO_UNIT) * (edgeCalcFaceAngleEx(v.e, Math.PI / 2) * ANGLE_TO_UNIT)) * UNIT_TO_ANGLE
        }
    }
    return angle
}

/** `bm_edge_calc_dissolve_error` (`bmesh_decimate_dissolve.cc:153`): minus the cosine of the fold. */
function edgeCalcDissolveError(e: BMEdge, delimit: number, delimitData: DelimitData): number {
    if (edgeIsManifold(e) && !edgeIsDelimiter(e, delimit, delimitData)) {
        const fa = e.l!.f
        const fb = e.l!.radialNext!.f
        let angleCosNeg = fa.nx * fb.nx + fa.ny * fb.ny + fa.nz * fb.nz
        if (edgeIsContiguous(e)) angleCosNeg *= -1
        return angleCosNeg
    }
    return COST_INVALID
}

/** `mul_v2_m3v3_center` (`bmesh_decimate_dissolve.cc:170`) for the row matrix of {@link axisDominantV3ToM3}. */
function mulV2M3V3Center(m: Mat3Rows, a: BMVert, center: BMVert): Vec2 {
    const c0 = a.x - center.x, c1 = a.y - center.y, c2 = a.z - center.z
    return [
        m[0][0] * c0 + m[0][1] * c1 + m[0][2] * c2,
        m[1][0] * c0 + m[1][1] * c1 + m[1][2] * c2,
    ]
}

/**
 * `bm_loop_collapse_is_degenerate` (`bmesh_decimate_dissolve.cc:185`): would removing the corner
 * `lEar` flip the neighbouring corners or swallow another vertex of the face?
 */
function loopCollapseIsDegenerate(lEar: BMLoop): boolean {
    // Calculate relative to the central vertex for higher precision.
    const center = lEar.v
    const axisMat = axisDominantV3ToM3([lEar.f.nx, lEar.f.ny, lEar.f.nz])
    const tri2d: [Vec2, Vec2, Vec2] = [
        mulV2M3V3Center(axisMat, lEar.prev.v, center),
        [0, 0],
        mulV2M3V3Center(axisMat, lEar.next.v, center),
    ]

    // check we're not flipping face corners before or after the ear
    if (!vertIsEdgePair(lEar.prev.v)) {
        const adjacent2d = mulV2M3V3Center(axisMat, lEar.prev.prev.v, center)
        if (signumI(crossTriV2(adjacent2d, tri2d[0], tri2d[1])) !== signumI(crossTriV2(adjacent2d, tri2d[0], tri2d[2]))) {
            return true
        }
    }
    if (!vertIsEdgePair(lEar.next.v)) {
        const adjacent2d = mulV2M3V3Center(axisMat, lEar.next.next.v, center)
        if (signumI(crossTriV2(adjacent2d, tri2d[2], tri2d[1])) !== signumI(crossTriV2(adjacent2d, tri2d[2], tri2d[0]))) {
            return true
        }
    }

    // check no existing verts are inside the triangle
    // triangle may be concave, if so - flip so we can use clockwise check
    if (crossTriV2(tri2d[0], tri2d[1], tri2d[2]) < 0) {
        const t = tri2d[1]
        tri2d[1] = tri2d[2]
        tri2d[2] = t
    }
    // skip l_ear and adjacent verts
    let lIter = lEar.next.next
    const lFirst = lEar.prev
    do {
        const co2d = mulV2M3V3Center(axisMat, lIter.v, center)
        if (isectPointTriV2Cw(co2d, tri2d[0], tri2d[1], tri2d[2])) return true
    } while ((lIter = lIter.next) !== lFirst)

    return false
}

/** `bm_vert_collapse_is_degenerate` (`bmesh_decimate_dissolve.cc:252`). Not a two-edge vertex: true. */
function vertCollapseIsDegenerate(v: BMVert): boolean {
    const ePair = vertEdgePair(v)
    if (ePair) {
        // allow wire edges
        if (edgeIsWire(ePair[0]) || edgeIsWire(ePair[1])) return false
        const vPair = [ePair[0].otherVert(v), ePair[1].otherVert(v)]
        if (Math.abs(cosV3V3V3([vPair[0].x, vPair[0].y, vPair[0].z], [v.x, v.y, v.z], [vPair[1].x, vPair[1].y, vPair[1].z]))
            < 1 - FLT_EPSILON) {
            const lFirst = ePair[1].l!
            let lIter = lFirst
            do {
                if (lIter.f.len > 3) {
                    const lPivot = lIter.v === v ? lIter : lIter.next
                    if (loopCollapseIsDegenerate(lPivot)) return true
                }
            } while ((lIter = lIter.radialNext!) !== lFirst)
        }
        return false
    }
    return true
}

/**
 * `BM_mesh_decimate_dissolve_ex` (`bmesh_decimate_dissolve.cc:286`).
 *
 * First the edges: each input edge goes into a min-heap keyed on how far its two faces are from
 * coplanar (minus the cosine of the angle between them, invalid at a delimiter or a non-manifold
 * edge); while the cheapest is below `-cos(angleLimit)` its faces are joined and the neighbouring
 * costs refreshed. Edges the joins left as wire (and their now-loose vertices) are removed, last edge
 * first. Then the vertices: with `doDissolveBoundaries` every input vertex left between two edges is
 * collapsed; otherwise they go through a second heap keyed on {@link vertEdgeFaceAngle}, skipping
 * collapses that would make a face degenerate.
 *
 * Face normals are read and must be current. Returns the faces made or kept by the joins (Blender
 * flags them `oflag_out`), as a set.
 */
export function meshDecimateDissolveEx(
    bm: BMesh, angleLimit: number, doDissolveBoundaries: boolean, delimit: number,
    vinput: readonly BMVert[], einput: readonly BMEdge[],
): Set<BMFace> {
    // `angle_limit` is a C `float`, and so is `-cosf(angle_limit)`: at 90 degrees the float limit is
    // just over pi/2, its negated cosine just over 0, and exactly perpendicular faces (cost -0) do join.
    angleLimit = Math.fround(angleLimit)
    const angleLimitCosNeg = Math.fround(-Math.cos(angleLimit))
    const delimitData: DelimitData = {uvLayers: []}
    const oflagOut = new Set<BMFace>()
    // `vinput_arr` is nulled in place by Blender; work on a copy.
    const vinputArr: (BMVert | null)[] = [...vinput]

    if (delimit & DissolveDelimit.UV) {
        // every `CD_PROP_FLOAT2` loop layer
        const layers = bm.ldata.layers.filter(l => l.type === 'float2')
        if (layers.length === 0) delimit &= ~DissolveDelimit.UV
        else delimitData.uvLayers = layers
    }

    // --- first edges ---
    {
        const eheapTable: (HeapNode<BMEdge> | null)[] = new Array(einput.length).fill(null)
        const eheap = new BLIHeap<BMEdge>()
        const edgeIndex = new Map<BMEdge, number>()

        // wire -> tag
        const edgeTag = new Set<BMEdge>()
        for (const e of bm.edges) if (edgeIsWire(e)) edgeTag.add(e)

        // build heap
        for (let i = 0; i < einput.length; i++) {
            const e = einput[i]
            const cost = edgeCalcDissolveError(e, delimit, delimitData)
            eheapTable[i] = eheap.insert(cost, e)
            edgeIndex.set(e, i)
        }

        let enodeTop: HeapNode<BMEdge>
        while (!eheap.isEmpty() && (enodeTop = eheap.top()).value < angleLimitCosNeg) {
            let fNew: BMFace | null = null
            const e = enodeTop.ptr
            const i = edgeIndex.get(e)!

            if (edgeIsManifold(e)) {
                // The `f_new` may be an existing face; it is still flagged as output so the selection
                // isn't "lost" when dissolving.
                fNew = facesJoinPair(bm, e.l!, e.l!.radialNext!, false)

                if (fNew) {
                    eheap.remove(enodeTop)
                    eheapTable[i] = null

                    // update normal
                    faceNormalUpdate(fNew)
                    oflagOut.add(fNew)

                    // re-calculate costs
                    const lFirst = fNew.lFirst
                    let lIter = lFirst
                    do {
                        const j = edgeIndex.get(lIter.e!) ?? -1
                        if (j !== -1 && eheapTable[j]) {
                            const cost = edgeCalcDissolveError(lIter.e!, delimit, delimitData)
                            eheap.nodeValueUpdate(eheapTable[j]!, cost)
                        }
                    } while ((lIter = lIter.next) !== lFirst)
                }
            }

            if (fNew === null) eheap.nodeValueUpdate(enodeTop, COST_INVALID)
        }

        // prepare for cleanup
        const vertReverseLookup = new Map<BMVert, number>()
        for (let i = 0; i < vinputArr.length; i++) vertReverseLookup.set(vinputArr[i]!, i)

        // --- cleanup ---
        const earray = [...bm.edges]
        // Remove all edges/verts left behind from dissolving, nulling the vertex array so we don't re-use.
        for (let i = earray.length - 1; i !== -1; i--) {
            const eIter = earray[i]
            if (edgeIsWire(eIter) && !edgeTag.has(eIter)) {
                // edge has become wire
                const v1 = eIter.v1
                const v2 = eIter.v2
                bm.edgeKill(eIter)
                if (v1.e === null) {
                    const vidxReverse = vertReverseLookup.get(v1) ?? -1
                    if (vidxReverse !== -1) vinputArr[vidxReverse] = null
                    bm.vertKill(v1)
                }
                if (v2.e === null) {
                    const vidxReverse = vertReverseLookup.get(v2) ?? -1
                    if (vidxReverse !== -1) vinputArr[vidxReverse] = null
                    bm.vertKill(v2)
                }
            }
        }
    }

    // --- second verts ---
    if (doDissolveBoundaries) {
        // simple version of the branch below, since we will dissolve _all_ verts that use 2 edges
        for (let i = 0; i < vinputArr.length; i++) {
            const v = vinputArr[i]
            if (v !== null && bm.verts.has(v) && vertIsEdgePair(v)) {
                vertCollapseEdge(bm, v.e!, v, true, true, true) // join edges
            }
        }
    } else {
        const vheapTable: (HeapNode<BMVert> | null)[] = new Array(vinputArr.length).fill(null)
        const vheap = new BLIHeap<BMVert>()
        const vertIndex = new Map<BMVert, number>()

        for (let i = 0; i < vinputArr.length; i++) {
            const v = vinputArr[i]
            if (v !== null) {
                const cost = vertEdgeFaceAngle(v, delimit, delimitData)
                vheapTable[i] = vheap.insert(cost, v)
                vertIndex.set(v, i)
            }
        }

        let vnodeTop: HeapNode<BMVert>
        while (!vheap.isEmpty() && (vnodeTop = vheap.top()).value < angleLimit) {
            let eNew: BMEdge | null = null
            const v = vnodeTop.ptr
            const i = vertIndex.get(v)!

            if (!vertCollapseIsDegenerate(v)) {
                eNew = vertCollapseEdge(bm, v.e!, v, true, true, true) // join edges

                if (eNew) {
                    vheap.remove(vnodeTop)
                    vheapTable[i] = null

                    // update normal
                    if (eNew.l) {
                        const lFirst = eNew.l
                        let lIter = lFirst
                        do {
                            faceNormalUpdate(lIter.f)
                        } while ((lIter = lIter.radialNext!) !== lFirst)
                    }

                    // re-calculate costs
                    for (const vIter of [eNew.v1, eNew.v2]) {
                        const j = vertIndex.get(vIter) ?? -1
                        if (j !== -1 && vheapTable[j]) {
                            const cost = vertEdgeFaceAngle(vIter, delimit, delimitData)
                            vheap.nodeValueUpdate(vheapTable[j]!, cost)
                        }
                    }

                    // dissolving a vertex may mean vertices we previously weren't able to dissolve
                    // can now be re-evaluated.
                    if (eNew.l) {
                        const lFirst = eNew.l
                        let lIter = lFirst
                        do {
                            // skip vertices part of this edge, evaluated above
                            let lCycleIter = lIter.next.next
                            const lCycleFirst = lIter.prev
                            do {
                                const j = vertIndex.get(lCycleIter.v) ?? -1
                                if (j !== -1 && vheapTable[j] && vheapTable[j]!.value === COST_INVALID_F) {
                                    const cost = vertEdgeFaceAngle(lCycleIter.v, delimit, delimitData)
                                    vheap.nodeValueUpdate(vheapTable[j]!, cost)
                                }
                            } while ((lCycleIter = lCycleIter.next) !== lCycleFirst)
                        } while ((lIter = lIter.radialNext!) !== lFirst)
                    }
                }
            }

            if (eNew === null) vheap.nodeValueUpdate(vnodeTop, COST_INVALID)
        }
    }

    return oflagOut
}

/** `BM_mesh_decimate_dissolve` (`bmesh_decimate_dissolve.cc:551`): every vertex and edge of the mesh. */
export function meshDecimateDissolve(bm: BMesh, angleLimit: number, doDissolveBoundaries: boolean, delimit: number): void {
    meshDecimateDissolveEx(bm, angleLimit, doDissolveBoundaries, delimit, [...bm.verts], [...bm.edges])
}

export interface DissolveLimitOptions {
    /** Total angle limit, radians (`angle_limit`; clamped to pi/2, `bmo_dissolve_limit_exec`). Default 0, the bmesh slot default. */
    angleLimit?: number
    /** Dissolve all vertices in between face boundaries (`use_dissolve_boundaries`). Default false. */
    useDissolveBoundaries?: boolean
    /** {@link DissolveDelimit} bit set (`delimit`). Default 0 (the bmesh slot default; the edit-mode operator defaults to Normal). */
    delimit?: number
}

/**
 * `bmo_dissolve_limit_exec` (`bmo_dissolve.cc:803`): Limited Dissolve over the given vertices and
 * edges. Returns `region.out`: the faces the joins produced (or kept), in mesh order.
 *
 * Face normals must be current (edit mode keeps them so; `dissolveLimitedSelection` refreshes them).
 */
export function dissolveLimit(bm: BMesh, verts: readonly BMVert[], edges: readonly BMEdge[], options: DissolveLimitOptions = {}): BMFace[] {
    // `min_ff(M_PI_2, angle_limit)`, both C floats.
    const angleMax = Math.fround(Math.PI / 2)
    const angleLimit = Math.min(angleMax, Math.fround(options.angleLimit ?? 0))
    const faceNew = meshDecimateDissolveEx(bm, angleLimit, options.useDissolveBoundaries ?? false, options.delimit ?? 0, verts, edges)
    const out: BMFace[] = []
    for (const f of bm.faces) if (faceNew.has(f)) out.push(f)
    return out
}

/** RNA properties of `MESH_OT_dissolve_limited` (`editmesh_tools.cc:6408`). */
export interface DissolveLimitedSelectionOptions {
    /** "Max Angle": angle limit, radians, 0..pi, default 5 degrees. */
    angleLimit?: number
    /** "All Boundaries": dissolve all vertices in between face boundaries. Default false. */
    useDissolveBoundaries?: boolean
    /** "Delimit": delimit dissolve operation, a {@link DissolveDelimit} set. Default Normal. */
    delimit?: number
}

/**
 * Edit-mode Limited Dissolve: `edbm_dissolve_limited_exec` (`editmesh_tools.cc:6331`). In face-only
 * select mode the input is the selection minus every vertex and edge of an unselected face (so only
 * the inside of the selected region dissolves); otherwise the selected visible vertices and edges.
 * The faces made are added to the selection.
 *
 * Face and vertex normals are refreshed first: edit mode keeps them current, the kernel does not.
 * Not ported: `BM_custom_loop_normals_to_vector_layer` / `_from_vector_layer` (see `dissolveFacesSelection`).
 */
export function dissolveLimitedSelection(
    bm: BMesh, options: DissolveLimitedSelectionOptions = {}, selectMode: SelectModeMask = bm.selectMode,
): DissolveSelectionResult {
    const angleLimit = options.angleLimit ?? 5 * Math.PI / 180
    const useDissolveBoundaries = options.useDissolveBoundaries ?? false
    const delimit = options.delimit ?? DissolveDelimit.Normal

    selectCountsRecalc(bm)
    if (bm.totvertsel === 0 && bm.totedgesel === 0 && bm.totfacesel === 0) return {ok: true, changed: false, regionOut: []}

    let verts: BMVert[]
    let edges: BMEdge[]
    if (selectMode === SelectMode.Face) {
        // flush selection to tags and untag edges/verts with partially selected faces
        const vTag = new Set<BMVert>()
        const eTag = new Set<BMEdge>()
        for (const v of bm.verts) if (v.hflag & ElemFlag.Select) vTag.add(v)
        for (const e of bm.edges) if (e.hflag & ElemFlag.Select) eTag.add(e)
        for (const f of bm.faces) {
            if (!(f.hflag & ElemFlag.Select)) {
                for (const l of f.eachLoop()) {
                    vTag.delete(l.v)
                    eTag.delete(l.e!)
                }
            }
        }
        // `%hv` / `%he` with `BM_ELEM_TAG`, hidden excluded
        verts = [...bm.verts].filter(v => vTag.has(v) && !(v.hflag & ElemFlag.Hidden))
        edges = [...bm.edges].filter(e => eTag.has(e) && !(e.hflag & ElemFlag.Hidden))
    } else {
        verts = elemsWithHflag(bm.verts, ElemFlag.Select)
        edges = elemsWithHflag(bm.edges, ElemFlag.Select)
    }

    normalsUpdate(bm)
    const regionOut = dissolveLimit(bm, verts, edges, {angleLimit, useDissolveBoundaries, delimit})
    bmeshEditEnd(bm, DISSOLVE_EDIT_END)
    // `EDBM_op_call_and_selectf(.., "region.out", true, ..)`
    elemsHflagEnable(bm, regionOut, ElemType.Face, ElemFlag.Select, true)
    selectCountsRecalc(bm)
    return {ok: true, changed: true, regionOut}
}


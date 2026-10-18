/**
 * `BLI_polyfill_beautify` - rotate the internal edges of a polygon fill until no rotation improves the
 * area-to-perimeter ratio of the two triangles it separates.
 *
 * Port of `blenlib/intern/polyfill_2d_beautify.cc` (Blender 5.2.2), float32 arithmetic as Blender's
 * (`Math.fround` on every operation; Blender is built with `-ffp-contract=off`). The edge heap is the
 * kernel's `BLI_heap` port, whose tie order matches Blender's.
 */

import {Heap, HeapNode} from './heap'
import {crossTriV2, lenV2V2} from '../tessellate/geomF32'

const f = Math.fround
const FLT_MAX = 3.4028234663852886e38
const UINT_MAX = 0xffffffff

/** `HalfEdge` (`:41`). */
interface HalfEdge {
    v: number
    eNext: number
    eRadial: number
    baseIndex: number
}

/** `is_boundary_edge` (`:85`). */
function isBoundaryEdge(a: number, b: number, coordLast: number): boolean {
    return a + 1 === b || (a === 0 && b === coordLast)
}

/**
 * `BLI_polyfill_beautify_quad_rotate_calc_ex` (`:91`) in float32: negative when replacing the (2-4)
 * diagonal by (1-3) improves the fill, `FLT_MAX` when the rotation is not allowed, `-FLT_MAX` to force
 * it. `ops/beautify.ts` has a double-precision port of the same function for BMesh beautify; this one
 * rounds like Blender because the polygon fill feeds parity-tested triangulations.
 */
function quadRotateCalcF32(
    v1: ArrayLike<number>, v2: ArrayLike<number>, v3: ArrayLike<number>, v4: ArrayLike<number>,
    lockDegenerate: boolean, rArea?: {area: number},
): number {
    const epsZeroArea = f(1e-12)
    const a234 = crossTriV2(v2, v3, v4)
    const a241 = crossTriV2(v2, v4, v1)
    const a123 = crossTriV2(v1, v2, v3)
    const a134 = crossTriV2(v1, v3, v4)
    if (rArea) {
        rArea.area = f(f(f(f(Math.abs(a234) + Math.abs(a241)) + Math.abs(a123)) + Math.abs(a134)) / 8)
    }
    if ((a123 >= 0) !== (a134 >= 0)) return FLT_MAX
    if (Math.abs(a123) <= epsZeroArea || Math.abs(a134) <= epsZeroArea) return FLT_MAX
    if ((a234 >= 0) !== (a241 >= 0)) {
        if (lockDegenerate) return FLT_MAX
        return -FLT_MAX
    }
    if (Math.abs(a234) <= epsZeroArea || Math.abs(a241) <= epsZeroArea) return -FLT_MAX

    const len12 = lenV2V2(v1, v2)
    const len23 = lenV2V2(v2, v3)
    const len34 = lenV2V2(v3, v4)
    const len41 = lenV2V2(v4, v1)
    const len13 = lenV2V2(v1, v3)
    const len24 = lenV2V2(v2, v4)

    let areaA = Math.abs(a234)
    let areaB = Math.abs(a241)
    let primA = f(f(len23 + len34) + len24)
    let primB = f(f(len41 + len12) + len24)
    const fac24 = f(f(areaA / primA) + f(areaB / primB))

    areaA = Math.abs(a123)
    areaB = Math.abs(a134)
    primA = f(f(len12 + len23) + len13)
    primB = f(f(len34 + len41) + len13)
    const fac13 = f(f(areaA / primA) + f(areaB / primB))

    return f(fac24 - fac13)
}

/** `polyedge_rotate_beauty_calc` (`:251`). */
function polyedgeRotateBeautyCalc(coords: Float32Array, edges: HalfEdge[], ea: number, rArea?: {area: number}): number {
    const eA = edges[ea]
    const eB = edges[eA.eRadial]
    const eAOther = edges[edges[eA.eNext].eNext]
    const eBOther = edges[edges[eB.eNext].eNext]
    const v = (i: number) => [coords[i * 2], coords[i * 2 + 1]]
    return quadRotateCalcF32(v(eAOther.v), v(eA.v), v(eBOther.v), v(eB.v), false, rArea)
}

/**
 * `BLI_polyfill_beautify(coords, coords_num, tris, arena, eheap)` (`:392`). `tris` (`(n - 2) * 3`
 * local indices from `polyfillCalc`) is rewritten in place.
 */
export function polyfillBeautify(coords: ArrayLike<number>, coordsNum: number, tris: Uint32Array | Int32Array): void {
    const c = coords instanceof Float32Array ? coords : Float32Array.from(coords as ArrayLike<number>)
    const coordLast = coordsNum - 1
    const trisLen = coordsNum - 2
    const halfEdgesLen = 3 * trisLen
    const halfEdges: HalfEdge[] = new Array(halfEdgesLen)
    const order: {v0: number, v1: number, eHalf: number}[] = []

    for (let i = 0; i < trisLen; i++) {
        for (let jCurr = 0, jPrev = 2; jCurr < 3; jPrev = jCurr++) {
            const ePrev = i * 3 + jPrev
            const eCurr = i * 3 + jCurr
            halfEdges[ePrev] = {v: tris[i * 3 + jPrev], eNext: eCurr, eRadial: UINT_MAX, baseIndex: UINT_MAX}
            let a = tris[i * 3 + jPrev], b = tris[i * 3 + jCurr]
            if (a > b) {
                const t = a
                a = b
                b = t
            }
            if (!isBoundaryEdge(a, b, coordLast)) order.push({v0: a, v1: b, eHalf: ePrev})
        }
    }
    // `oedge_cmp` (`:48`).
    order.sort((x, y) => x.v0 - y.v0 || x.v1 - y.v1 || x.eHalf - y.eHalf)
    for (let i = 0, base = 0; i < order.length; base++) {
        const a = order[i++]
        const b = order[i++]
        halfEdges[a.eHalf].eRadial = b.eHalf
        halfEdges[b.eHalf].eRadial = a.eHalf
        halfEdges[a.eHalf].baseIndex = base
        halfEdges[b.eHalf].baseIndex = base
    }

    const heap = new Heap<number>()
    const table: (HeapNode<number> | null)[] = new Array(Math.max(0, trisLen - 1)).fill(null)

    for (let i = 0; i < halfEdgesLen; i++) {
        const e = halfEdges[i]
        if (e.eRadial < i) {
            const cost = polyedgeRotateBeautyCalc(c, halfEdges, i)
            table[e.baseIndex] = cost < 0 ? heap.insert(cost, i) : null
        }
    }

    // `polyedge_beauty_cost_update_single` (`:270`).
    const updateSingle = (ei: number) => {
        const e = halfEdges[ei]
        const i = e.baseIndex
        const area = {area: 0}
        const cost = polyedgeRotateBeautyCalc(c, halfEdges, ei, area)
        if (cost < f(f(-1e-6) * Math.max(area.area, 1))) {
            // `BLI_heap_insert_or_update` (`BLI_heap.cc:261`); `value_update_ptr` sets the pointer first.
            const node = table[i]
            if (node) {
                node.ptr = ei
                heap.nodeValueUpdate(node, cost)
            } else {
                table[i] = heap.insert(cost, ei)
            }
        } else if (table[i]) {
            heap.remove(table[i]!)
            table[i] = null
        }
    }

    while (!heap.isEmpty()) {
        const ei = heap.popMin()
        const e = halfEdges[ei]
        table[e.baseIndex] = null
        polyedgeRotate(halfEdges, ei)
        // `polyedge_beauty_cost_update` (`:302`).
        const arr: number[] = []
        arr[0] = halfEdges[ei].eNext
        arr[1] = halfEdges[arr[0]].eNext
        const er = halfEdges[ei].eRadial
        arr[2] = halfEdges[er].eNext
        arr[3] = halfEdges[arr[2]].eNext
        for (let k = 0; k < 4; k++) {
            if (halfEdges[arr[k]].baseIndex !== UINT_MAX) updateSingle(arr[k])
        }
    }

    let tri = 0
    for (let i = 0; i < halfEdgesLen; i++) {
        let e = halfEdges[i]
        if (e.v !== UINT_MAX) {
            tris[tri * 3] = e.v
            e.v = UINT_MAX
            e = halfEdges[e.eNext]
            tris[tri * 3 + 1] = e.v
            e.v = UINT_MAX
            e = halfEdges[e.eNext]
            tris[tri * 3 + 2] = e.v
            e.v = UINT_MAX
            tri++
        }
    }
}

/** `polyedge_rotate` (`:325`). */
function polyedgeRotate(edges: HalfEdge[], e0: number): void {
    const idx = [e0, 0, 0, 0, 0, 0]
    idx[1] = edges[idx[0]].eNext
    idx[2] = edges[idx[1]].eNext
    idx[3] = edges[e0].eRadial
    idx[4] = edges[idx[3]].eNext
    idx[5] = edges[idx[4]].eNext
    const ed = idx.map(i => edges[i])
    ed[0].eNext = idx[2]
    ed[1].eNext = idx[3]
    ed[2].eNext = idx[4]
    ed[3].eNext = idx[5]
    ed[4].eNext = idx[0]
    ed[5].eNext = idx[1]
    ed[0].v = ed[5].v
    ed[3].v = ed[2].v
}

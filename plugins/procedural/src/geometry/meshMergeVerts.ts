/**
 * Vertex welding of the Merge by Distance node: `geometry/intern/mesh_merge_verts.cc` (the "weld" code) -
 * `weld_mesh_context_create` (:1229) with its edge (:335, :382), loop/face (:580, :696, :866) and duplicate-face
 * (:981, :1150) passes, `merge_customdata_all` (:1346) and `create_merged_mesh` (:1508), plus the two vertex maps
 * `mesh_merge_by_distance_all` (:1810) and `mesh_merge_by_distance_connected` (:1838).
 *
 * `WeldLoop::flag` and `WeldPoly::flag` are unions with the first member (`edge` / `poly_dst`); they are those fields
 * here. Attributes Blender stores as a single value are mixed like arrays (issues/open/modelling-tools/
 * procedural-attribute-single-storage.md).
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import {KDTree3} from '../blender/kdtree'
import {DATA_TYPES, DataType} from './dataTypes'
import {mixIndices} from './mixIndices'
import {newMesh} from './meshPrimitives'

const OUT_OF_CONTEXT = -1
const ELEM_COLLAPSED = -2

interface WeldEdge {
    edgeOrig: number
    vertA: number
    vertB: number
}

/** `WeldLoop` (:48); `flag` is `edge`. */
interface WeldLoop {
    edge: number
    vert: number
    loopOrig: number
    loopNext: number
}

/** `WeldPoly` (:61); `flag` is `polyDst`. */
interface WeldPoly {
    polyDst: number
    polyOrig: number
    loopStart: number
    loopEnd: number
    loopCtxStart: number
    loopCtxLen: number
}

interface WeldMesh {
    doubleVerts: number[]
    doubleEdges: number[]
    edgeDestMap: Int32Array
    vertDestMap: Int32Array
    wloop: WeldLoop[]
    wpoly: WeldPoly[]
    wpolyNewLen: number
    loopMap: Int32Array
    faceMap: Int32Array
    vertKillLen: number
    edgeKillLen: number
    loopKillLen: number
    faceKillLen: number
    maxFaceLen: number
}

/** `WeldLoopOfPolyIter` (:115) with `weld_iter_loop_of_poly_begin` (:545) / `_next` (:494). */
class LoopOfPolyIter {
    loopIter = 0
    loopEnd = 0
    loopCtxStart = 0
    loopCtxLen = 0
    groupLen = 0
    v = 0
    e = 0

    constructor(
        private readonly wloop: WeldLoop[], private readonly cornerVerts: Int32Array, private readonly cornerEdges: Int32Array,
        private readonly loopMap: Int32Array, readonly group: number[] | undefined,
    ) {}

    begin(wp: WeldPoly): boolean {
        if (wp.polyDst === ELEM_COLLAPSED) return false
        this.loopIter = wp.loopStart
        this.loopEnd = wp.loopEnd
        this.loopCtxStart = wp.loopCtxStart
        this.loopCtxLen = wp.loopCtxLen
        this.groupLen = 0
        return this.next()
    }

    next(): boolean {
        if (this.loopIter > this.loopEnd) return false
        const l = this.loopIter
        let lNext = l + 1
        const ctx = this.loopMap[l]
        if (ctx !== OUT_OF_CONTEXT) {
            const wl = this.wloop[ctx]
            this.v = wl.vert
            this.e = wl.edge
            // Allow the loop to break.
            if (wl.loopNext > l) lNext = wl.loopNext
            if (this.group) {
                this.groupLen = 0
                for (let k = 0; k < this.loopCtxLen; k++) {
                    const w = this.wloop[this.loopCtxStart + k]
                    if (w.vert === this.v) this.group[this.groupLen++] = w.loopOrig
                }
            }
        } else {
            this.v = this.cornerVerts[l]
            this.e = this.cornerEdges[l]
            if (this.group) {
                this.group[0] = l
                this.groupLen = 1
            }
        }
        this.loopIter = lNext
        return true
    }
}

/** `weld_vert_ctx_alloc_and_setup` (:301). */
function vertCtxAllocAndSetup(vertDestMap: Int32Array): number[] {
    const wvert: number[] = []
    for (let i = 0; i < vertDestMap.length; i++) {
        if (vertDestMap[i] === OUT_OF_CONTEXT) continue
        const dest = vertDestMap[i]
        wvert.push(i)
        if (vertDestMap[dest] !== dest) {
            vertDestMap[dest] = dest
            wvert.push(dest)
        }
    }
    return wvert
}

/** `weld_edge_ctx_alloc_and_find_collapsed` (:335). */
function edgeCtxAllocAndFindCollapsed(edges: Int32Array, vertDestMap: Int32Array, edgeDestMap: Int32Array): {wedge: WeldEdge[], collapsed: number} {
    let collapsed = 0
    const wedge: WeldEdge[] = []
    for (let i = 0; i < edges.length / 2; i++) {
        const v1 = edges[i * 2], v2 = edges[i * 2 + 1]
        const d1 = vertDestMap[v1], d2 = vertDestMap[v2]
        if (d1 === OUT_OF_CONTEXT && d2 === OUT_OF_CONTEXT) {
            edgeDestMap[i] = OUT_OF_CONTEXT
            continue
        }
        const a = d1 === OUT_OF_CONTEXT ? v1 : d1
        const b = d2 === OUT_OF_CONTEXT ? v2 : d2
        if (a === b) {
            edgeDestMap[i] = ELEM_COLLAPSED
            collapsed++
        } else {
            wedge.push({edgeOrig: i, vertA: a, vertB: b})
            edgeDestMap[i] = i
        }
    }
    return {wedge, collapsed}
}

/** `weld_edge_find_doubles` (:382). */
function edgeFindDoubles(wedges: WeldEdge[], vertsNum: number, edgeDestMap: Int32Array): number {
    let kill = 0
    if (!wedges.length) return 0
    const vLinks = new Int32Array(vertsNum + 1)
    for (const we of wedges) {
        vLinks[we.vertA]++
        vLinks[we.vertB]++
    }
    let linkLen = 0
    for (let i = 0; i < vertsNum; i++) {
        linkLen += vLinks[i]
        vLinks[i] = linkLen
    }
    vLinks[vertsNum] = linkLen
    const buffer = new Int32Array(linkLen)
    // Reverse so indices are assigned in ascending order.
    for (let i = wedges.length - 1; i >= 0; i--) {
        buffer[--vLinks[wedges[i].vertA]] = i
        buffer[--vLinks[wedges[i].vertB]] = i
    }
    for (let i = 0; i < wedges.length; i++) {
        const we = wedges[i]
        if (edgeDestMap[we.edgeOrig] !== we.edgeOrig) continue
        const linkA = vLinks[we.vertA], linkB = vLinks[we.vertB]
        let lenA = vLinks[we.vertA + 1] - linkA
        let lenB = vLinks[we.vertB + 1] - linkB
        const edgeOrig = we.edgeOrig
        if (lenA <= 1 || lenB <= 1) {
            edgeDestMap[edgeOrig] = OUT_OF_CONTEXT
            continue
        }
        let pa = linkA, pb = linkB
        const prev = kill
        for (; lenA--; pa++) {
            const eA = buffer[pa]
            if (eA === i) continue
            while (lenB && buffer[pb] < eA) {
                pb++
                lenB--
            }
            if (lenB === 0) break
            const eB = buffer[pb]
            if (eA === eB) {
                edgeDestMap[wedges[eB].edgeOrig] = edgeOrig
                kill++
            }
        }
        if (prev === kill) edgeDestMap[edgeOrig] = OUT_OF_CONTEXT
    }
    return kill
}

/** `weld_poly_loop_ctx_alloc` (:580). */
function polyLoopCtxAlloc(fo: Int32Array, facesNum: number, cornerVerts: Int32Array, cornerEdges: Int32Array, wm: WeldMesh): void {
    const vertDestMap = wm.vertDestMap, edgeDestMap = wm.edgeDestMap
    const loopMap = new Int32Array(cornerVerts.length)
    const faceMap = new Int32Array(facesNum)
    let wloopLen = 0, wpolyLen = 0, maxCtxPolyLen = 4
    const wloop: WeldLoop[] = [], wpoly: WeldPoly[] = []
    for (let i = 0; i < facesNum; i++) {
        const loopstart = fo[i], totloop = fo[i + 1] - fo[i]
        const loopEnd = loopstart + totloop - 1
        const vFirst = cornerVerts[loopstart]
        const vDestFirst = vertDestMap[vFirst]
        const isFirstCtx = vDestFirst !== OUT_OF_CONTEXT
        let vNext = vFirst, vDestNext = vDestFirst, isNextCtx = isFirstCtx
        const prevWloopLen = wloopLen
        for (let loopOrig = loopstart; loopOrig <= loopEnd; loopOrig++) {
            const v = vNext, vDest = vDestNext, isCtx = isNextCtx
            let loopNext: number
            if (loopOrig !== loopEnd) {
                loopNext = loopOrig + 1
                vNext = cornerVerts[loopNext]
                vDestNext = vertDestMap[vNext]
                isNextCtx = vDestNext !== OUT_OF_CONTEXT
            } else {
                loopNext = loopstart
                vNext = vFirst
                vDestNext = vDestFirst
                isNextCtx = isFirstCtx
            }
            if (isCtx || isNextCtx) {
                const e = cornerEdges[loopOrig]
                const eDest = edgeDestMap[e]
                wloop.push({vert: isCtx ? vDest : v, edge: eDest !== OUT_OF_CONTEXT ? eDest : e, loopOrig, loopNext})
                loopMap[loopOrig] = wloopLen++
            } else {
                loopMap[loopOrig] = OUT_OF_CONTEXT
            }
        }
        if (wloopLen !== prevWloopLen) {
            const loopCtxLen = wloopLen - prevWloopLen
            wpoly.push({polyDst: OUT_OF_CONTEXT, polyOrig: i, loopStart: loopstart, loopEnd, loopCtxStart: prevWloopLen, loopCtxLen})
            faceMap[i] = wpolyLen++
            if (totloop > 5 && loopCtxLen > 1) maxCtxPolyLen = Math.max(maxCtxPolyLen, totloop)
        } else {
            faceMap[i] = OUT_OF_CONTEXT
        }
    }
    wm.wloop = wloop
    wm.wpoly = wpoly
    wm.wpolyNewLen = 0
    wm.loopMap = loopMap
    wm.faceMap = faceMap
    wm.maxFaceLen = maxCtxPolyLen
}

/** `weld_poly_split_recursive` (:696). */
function polySplitRecursive(polyLoopLen: number, vertDestMap: Int32Array, wp: WeldPoly, wm: WeldMesh, kill: {poly: number, loop: number}): void {
    if (polyLoopLen < 3) return
    const loopMap = wm.loopMap, wloop = wm.wloop
    let loopKill = 0
    let loopEnd = wp.loopEnd
    const ctxEnd = loopMap[loopEnd]
    let wlaPrev: WeldLoop | null = ctxEnd !== OUT_OF_CONTEXT ? wloop[ctxEnd] : null
    let la = wp.loopStart
    do {
        const ctxA = loopMap[la]
        if (ctxA === OUT_OF_CONTEXT) {
            la++
            wlaPrev = null
            continue
        }
        let wla = wloop[ctxA]
        const vertA = wla.vert
        if (vertDestMap[vertA] === OUT_OF_CONTEXT) {
            // Only test vertices that will be merged.
            la = wla.loopNext
            wlaPrev = wla
            continue
        }
        let distA = 1
        let lbPrev = la
        let wlbPrev: WeldLoop | null = wla
        let lb = wla.loopNext
        let brokeInner = false
        do {
            const ctxB = loopMap[lb]
            if (ctxB === OUT_OF_CONTEXT) {
                distA++
                lbPrev = lb
                wlbPrev = null
                lb++
                continue
            }
            const wlb = wloop[ctxB]
            const vertB = wlb.vert
            if (vertA !== vertB) {
                distA++
                lbPrev = lb
                wlbPrev = wlb
                lb = wlb.loopNext
                continue
            }
            let distB = polyLoopLen - distA
            if (distA === 1 || distB === 1) {
                // One of the loops is already collapsed.
            } else if (distA === 2 && distB === 2) {
                // All loops are collapsed: flagging the face is enough.
                loopKill += 4
                distB = 0
                wp.polyDst = ELEM_COLLAPSED
                kill.poly += 1
                kill.loop += loopKill
                return
            } else {
                wlaPrev!.loopNext = lb
                wlbPrev!.loopNext = la
                if (wp.loopStart === la) wp.loopStart = lb
                if (distA === 2) {
                    wla.edge = ELEM_COLLAPSED
                    wlbPrev!.edge = ELEM_COLLAPSED
                    loopKill += 2
                } else if (distB === 2) {
                    wlb.edge = ELEM_COLLAPSED
                    wlaPrev!.edge = ELEM_COLLAPSED
                    loopKill += 2
                    wp.loopStart = la
                    wp.loopEnd = loopEnd = lbPrev
                    polyLoopLen = distA
                    brokeInner = true
                    break
                } else {
                    wm.wpolyNewLen++
                    const newTest: WeldPoly = {
                        polyDst: OUT_OF_CONTEXT, polyOrig: wp.polyOrig, loopStart: la, loopEnd: lbPrev,
                        loopCtxStart: wp.loopCtxStart, loopCtxLen: wp.loopCtxLen,
                    }
                    wm.wpoly.push(newTest)
                    polySplitRecursive(distA, vertDestMap, newTest, wm, kill)
                }
                la = lb
                wla = wlb
                polyLoopLen = distB
                distA = 1
            }
            wlbPrev = wlb
            lbPrev = lb
            lb = wlb.loopNext
        } while (lbPrev !== loopEnd)
        void brokeInner
        wlaPrev = wla
        if (la === loopEnd) break
        la = wla.loopNext
    } while (la !== loopEnd)
    kill.loop += loopKill
}

/** `weld_poly_loop_ctx_setup_collapsed_and_split` (:866). */
function polyLoopCtxSetupCollapsedAndSplit(remainEdgeCtxLen: number, wm: WeldMesh): void {
    if (remainEdgeCtxLen === 0) {
        wm.faceKillLen = wm.wpoly.length
        wm.loopKillLen = wm.wloop.length
        for (const wp of wm.wpoly) wp.polyDst = ELEM_COLLAPSED
        return
    }
    const wloop = wm.wloop, loopMap = wm.loopMap, vertDestMap = wm.vertDestMap
    const kill = {poly: 0, loop: 0}
    const originalLen = wm.wpoly.length
    for (let i = 0; i < originalLen; i++) {
        const wp = wm.wpoly[i]
        let polyLoopLen = wp.loopEnd - wp.loopStart + 1
        let wlPrev: WeldLoop | null = null
        let changLoopStart = false
        let l = wp.loopStart
        do {
            const ctx = loopMap[l]
            if (ctx === OUT_OF_CONTEXT) {
                wlPrev = null
                continue
            }
            const wl = wloop[ctx]
            if (wl.edge === ELEM_COLLAPSED) {
                if (polyLoopLen === 3) {
                    wp.polyDst = ELEM_COLLAPSED
                    kill.poly++
                    kill.loop += 3
                    polyLoopLen = 0
                    break
                }
                if (l === wp.loopStart) changLoopStart = true
                kill.loop++
                polyLoopLen--
            } else {
                if (changLoopStart) {
                    wp.loopStart = l
                    changLoopStart = false
                }
                if (wlPrev) wlPrev.loopNext = l
                wlPrev = wl
            }
        } while (l++ !== wp.loopEnd)
        if (polyLoopLen) {
            if (wlPrev) {
                wlPrev.loopNext = wp.loopStart
                wp.loopEnd = wlPrev.loopOrig
            }
            polySplitRecursive(polyLoopLen, vertDestMap, wp, wm, kill)
        }
    }
    wm.faceKillLen = kill.poly
    wm.loopKillLen = kill.loop
}

/** `poly_find_doubles` (:981). */
function polyFindDoubles(offs: Int32Array, polyNum: number, corners: number[], cornerIndexMax: number): {num: number, offsets: number[], buffer: Int32Array} {
    const linkedOffs = new Int32Array(cornerIndexMax + 1)
    for (const e of corners) linkedOffs[e]++
    let bufferLen = 0
    for (let e = 0; e < cornerIndexMax; e++) {
        bufferLen += linkedOffs[e]
        linkedOffs[e] = bufferLen
    }
    linkedOffs[cornerIndexMax] = bufferLen
    if (bufferLen === 0) return {num: 0, offsets: [0], buffer: new Int32Array(0)}
    const linked = new Int32Array(bufferLen)
    for (let f = polyNum - 1; f >= 0; f--) {
        if (offs[f + 1] === offs[f]) continue
        for (let c = offs[f + 1] - 1; c >= offs[f]; c--) linked[--linkedOffs[corners[c]]] = f
    }
    const doubles = new Int32Array(polyNum)
    const doublesOffsets = [0]
    const isDouble = new Uint8Array(polyNum)
    let doublesBufferNum = 0
    let doublesNum = 0
    // Intersection of two sorted index lists into `doubles` at `out` (in place when `a` is that buffer).
    const intersect = (aArr: Int32Array, aStart: number, aNum: number, bArr: Int32Array, bStart: number, bNum: number, out: number) => {
        let n = 0, ia = 0, ib = 0
        while (ia < aNum && ib < bNum) {
            const va = aArr[aStart + ia], vb = bArr[bStart + ib]
            if (va < vb) ia++
            else if (vb < va) ib++
            else {
                if (!isDouble[va]) doubles[out + n++] = va
                ia++
                ib++
            }
        }
        return n
    }
    for (let f = 0; f < polyNum; f++) {
        if (isDouble[f]) continue
        const cornerNum = offs[f + 1] - offs[f]
        if (cornerNum === 0) continue
        doubles[doublesBufferNum] = f
        const cornerFirst = offs[f]
        let elem = corners[cornerFirst]
        let linkOffs = linkedOffs[elem]
        let aNum = linkedOffs[elem + 1] - linkOffs
        if (aNum === 1) continue
        let aArr = linked, aStart = linkOffs
        let toTest: number
        // Skip polygons with lower index: they have been checked already.
        do {
            toTest = aArr[aStart]
            aStart++
            aNum--
        } while (toTest !== f)
        const isect = doublesBufferNum + 1
        for (let c = cornerFirst + 1; c < cornerFirst + cornerNum; c++) {
            elem = corners[c]
            linkOffs = linkedOffs[elem]
            let bNum = linkedOffs[elem + 1] - linkOffs
            let bStart = linkOffs
            do {
                toTest = linked[bStart]
                bStart++
                bNum--
            } while (toTest !== f)
            doublesNum = intersect(aArr, aStart, aNum, linked, bStart, bNum, isect)
            if (doublesNum === 0) break
            aArr = doubles
            aStart = isect
            aNum = doublesNum
        }
        if (doublesNum) {
            for (let k = 0; k < doublesNum; k++) isDouble[doubles[isect + k]] = 1
            doublesBufferNum += doublesNum
            doublesOffsets.push(++doublesBufferNum)
            // The last slot is the remaining face: no intersection left to check.
            if (doublesBufferNum + 1 === polyNum) break
        }
    }
    return {num: doublesBufferNum - (doublesOffsets.length - 1), offsets: doublesOffsets, buffer: doubles}
}

/** `weld_poly_find_doubles` (:1150). */
function polyFindDoublesInWeld(cornerVerts: Int32Array, cornerEdges: Int32Array, edgesNum: number, wm: WeldMesh): void {
    if (wm.faceKillLen === wm.wpoly.length) return
    const faceLen = wm.wpoly.length
    const offs = new Int32Array(faceLen + 1)
    const newCornerEdges: number[] = []
    const iter = new LoopOfPolyIter(wm.wloop, cornerVerts, cornerEdges, wm.loopMap, undefined)
    wm.wpoly.forEach((wp, i) => {
        offs[i] = newCornerEdges.length
        if (!iter.begin(wp)) return
        if (wp.polyDst !== OUT_OF_CONTEXT) return
        do newCornerEdges.push(iter.e)
        while (iter.next())
    })
    offs[faceLen] = newCornerEdges.length
    const d = polyFindDoubles(offs, faceLen, newCornerEdges, edgesNum)
    if (d.num) {
        let loopKillNum = 0
        for (let i = 0; i < d.offsets.length - 1; i++) {
            const polyDst = wm.wpoly[d.buffer[d.offsets[i]]].polyOrig
            for (let o = d.offsets[i] + 1; o < d.offsets[i + 1]; o++) {
                const wpi = d.buffer[o]
                wm.wpoly[wpi].polyDst = polyDst
                loopKillNum += offs[wpi + 1] - offs[wpi]
            }
        }
        wm.faceKillLen += d.num
        wm.loopKillLen += loopKillNum
    }
}

/** `weld_mesh_context_create` (:1229). */
function weldMeshContextCreate(mesh: MeshData, vertDestMap: Int32Array, vertKillLen: number, getDoubles: boolean): WeldMesh {
    const edges = mesh.edgeVerts
    const wvert = vertCtxAllocAndSetup(vertDestMap)
    const wm: WeldMesh = {
        doubleVerts: [], doubleEdges: [], edgeDestMap: new Int32Array(mesh.edgesNum), vertDestMap, wloop: [], wpoly: [],
        wpolyNewLen: 0, loopMap: new Int32Array(0), faceMap: new Int32Array(0), vertKillLen, edgeKillLen: 0, loopKillLen: 0,
        faceKillLen: 0, maxFaceLen: 0,
    }
    const {wedge, collapsed} = edgeCtxAllocAndFindCollapsed(edges, vertDestMap, wm.edgeDestMap)
    const doubleKill = edgeFindDoubles(wedge, mesh.vertsNum, wm.edgeDestMap)
    wm.edgeKillLen = collapsed + doubleKill
    polyLoopCtxAlloc(mesh.faceOffsets, mesh.facesNum, mesh.cornerVerts, mesh.cornerEdges, wm)
    polyLoopCtxSetupCollapsedAndSplit(wedge.length - doubleKill, wm)
    polyFindDoublesInWeld(mesh.cornerVerts, mesh.cornerEdges, mesh.edgesNum, wm)
    if (getDoubles) {
        wm.doubleVerts = wvert
        for (const we of wedge) if (wm.edgeDestMap[we.edgeOrig] >= 0) wm.doubleEdges.push(we.edgeOrig)
    }
    return wm
}

/** `merge_groups_create` (:1301) into `offsets` (shared with the final map, as in Blender). */
function mergeGroupsCreate(destMap: Int32Array, doubleElems: number[], offsets: Int32Array): Int32Array {
    offsets.fill(0)
    for (const e of doubleElems) offsets[destMap[e]]++
    let offs = 0
    for (let i = 0; i < destMap.length; i++) {
        offs += offsets[i]
        offsets[i] = offs
    }
    offsets[destMap.length] = offs
    const buffer = new Int32Array(offs)
    for (let i = doubleElems.length - 1; i >= 0; i--) {
        const e = doubleElems[i]
        buffer[--offsets[destMap[e]]] = e
    }
    return buffer
}

/** `merge_customdata_all` (:1346): the final index of every source element and the sources of every result element. */
function mergeCustomdataAll(destMap: Int32Array, doubleElems: number[], destSize: number, doMixData: boolean): {finalMap: Int32Array, srcOffsets: number[], srcData: number[]} {
    const sourceSize = destMap.length
    const srcOffsets: number[] = [], srcData: number[] = []
    let finalMap: Int32Array
    let groupsBuffer: Int32Array = new Int32Array(0)
    if (doMixData) {
        // The group offsets live in the same buffer as the final map (:1366).
        finalMap = new Int32Array(sourceSize + 1)
        groupsBuffer = mergeGroupsCreate(destMap, doubleElems, finalMap)
    } else {
        finalMap = new Int32Array(sourceSize)
    }
    const offs = finalMap
    let finalize = false
    let destIndex = 0
    for (let i = 0; i < sourceSize; i++) {
        while (i < sourceSize && destMap[i] === OUT_OF_CONTEXT) {
            finalMap[i] = destIndex
            srcOffsets.push(srcData.length)
            srcData.push(i)
            destIndex++
            i++
        }
        if (i === sourceSize) break
        if (destMap[i] === i) {
            srcOffsets.push(srcData.length)
            if (doMixData) for (let k = offs[i]; k < offs[i + 1]; k++) srcData.push(groupsBuffer[k])
            else srcData.push(i)
            finalMap[i] = destIndex
            destIndex++
        } else if (destMap[i] === ELEM_COLLAPSED) {
            finalMap[i] = 0
        } else {
            const dest = destMap[i]
            if (dest < i) {
                finalMap[i] = finalMap[dest]
            } else {
                finalMap[i] = -dest
                finalize = true
            }
        }
    }
    if (finalize) {
        for (let i = 0; i < finalMap.length; i++) if (finalMap[i] < 0) finalMap[i] = finalMap[-finalMap[i]]
    }
    srcOffsets.push(srcData.length)
    if (destIndex !== destSize) throw new Error(`mesh_merge_verts: ${destIndex} merged elements, ${destSize} expected`)
    return {finalMap, srcOffsets, srcData}
}

/** `mix_attributes` (:1451) for one domain: `mix_groups` of every attribute but `skip`. */
function mixAttributes(src: MeshData, dst: MeshData, domain: AttrDomain, skip: readonly string[], offsets: number[], data: number[]): void {
    for (const layer of src.attributes.layersOnDomain(domain)) {
        if (skip.includes(layer.name)) continue
        const type = layer.type as DataType
        const out = (dst.attributes.get(layer.name) ?? dst.attributes.add({name: layer.name, domain, type})).data
        for (let d = 0; d < offsets.length - 1; d++) mixIndices(type, layer.data, data.slice(offsets[d], offsets[d + 1]), out, d)
    }
}

/** `create_merged_mesh` (:1508). */
function createMergedMesh(mesh: MeshData, vertDestMap: Int32Array, removedVertexCount: number, doMixData: boolean): MeshData {
    const srcFo = mesh.faceOffsets, srcCv = mesh.cornerVerts, srcCe = mesh.cornerEdges, srcEdges = mesh.edgeVerts
    const wm = weldMeshContextCreate(mesh, vertDestMap, removedVertexCount, doMixData)
    const nVerts = mesh.vertsNum - wm.vertKillLen
    const nEdges = mesh.edgesNum - wm.edgeKillLen
    const nLoops = mesh.cornersNum - wm.loopKillLen
    const nFaces = mesh.facesNum - wm.faceKillLen + wm.wpolyNewLen
    const result = newMesh(nVerts, nEdges, nFaces, nLoops)
    // `BKE_mesh_copy_parameters_for_eval`.
    result.materials = mesh.materials.slice()

    const verts = mergeCustomdataAll(vertDestMap, wm.doubleVerts, nVerts, doMixData)
    mixAttributes(mesh, result, AttrDomain.Point, [], verts.srcOffsets, verts.srcData)

    const edgesM = mergeCustomdataAll(wm.edgeDestMap, wm.doubleEdges, nEdges, doMixData)
    mixAttributes(mesh, result, AttrDomain.Edge, ['.edge_verts'], edgesM.srcOffsets, edgesM.srcData)
    const dstEdges = result.edgeVerts
    for (let d = 0; d < nEdges; d++) {
        const s = edgesM.srcData[edgesM.srcOffsets[d]]
        dstEdges[d * 2] = verts.finalMap[srcEdges[s * 2]]
        dstEdges[d * 2 + 1] = verts.finalMap[srcEdges[s * 2 + 1]]
    }

    // Faces and corners (:1625).
    const cornerOffsets: number[] = [], cornerData: number[] = []
    const dstCv = result.cornerVerts, dstCe = result.cornerEdges, dstFo = result.faceOffsets
    let ri = 0, loopCur = 0
    const unaffected: boolean[] = []
    const dstToSrcFaces: number[] = []
    const group: number[] = new Array(wm.maxFaceLen).fill(0)
    const iter = new LoopOfPolyIter(wm.wloop, srcCv, srcCe, wm.loopMap, group)
    const emit = () => {
        do {
            cornerOffsets.push(cornerData.length)
            for (let k = 0; k < iter.groupLen; k++) cornerData.push(group[k])
            dstCv[loopCur] = verts.finalMap[iter.v]
            dstCe[loopCur] = edgesM.finalMap[iter.e]
            loopCur++
        } while (iter.next())
    }
    for (let i = 0; i < mesh.facesNum; i++) {
        const loopStart = loopCur
        const ctx = wm.faceMap[i]
        if (ctx === OUT_OF_CONTEXT) {
            for (let l = srcFo[i]; l < srcFo[i + 1]; l++) {
                cornerOffsets.push(cornerData.length)
                cornerData.push(l)
                loopCur++
            }
            unaffected.push(true)
        } else {
            const wp = wm.wpoly[ctx]
            if (!iter.begin(wp)) continue
            if (wp.polyDst !== OUT_OF_CONTEXT) continue
            unaffected.push(false)
            emit()
        }
        dstToSrcFaces.push(i)
        dstFo[ri] = loopStart
        ri++
    }
    // New polygons (:1690).
    for (let i = wm.wpoly.length - wm.wpolyNewLen; i < wm.wpoly.length; i++) {
        const wp = wm.wpoly[i]
        const loopStart = loopCur
        if (!iter.begin(wp)) continue
        if (wp.polyDst !== OUT_OF_CONTEXT) continue
        emit()
        dstFo[ri] = loopStart
        ri++
    }
    if (ri !== nFaces || loopCur !== nLoops) {
        throw new Error(`mesh_merge_verts: wrote ${ri} faces / ${loopCur} corners for ${nFaces} / ${nLoops} (Blender only asserts this in debug builds)`)
    }
    dstFo[nFaces] = nLoops
    cornerOffsets.push(cornerData.length)

    // Face attributes: gathered; new polygons get the type's default value (:1735).
    for (const layer of mesh.attributes.layersOnDomain(AttrDomain.Face)) {
        const type = layer.type as DataType
        const c = DATA_TYPES[type].components
        const out = (result.attributes.get(layer.name) ?? result.attributes.add({name: layer.name, domain: AttrDomain.Face, type})).data
        dstToSrcFaces.forEach((s, d) => { for (let k = 0; k < c; k++) out[d * c + k] = layer.data[s * c + k] })
        const def = DATA_TYPES[type].defaultValue
        for (let d = dstToSrcFaces.length; d < nFaces; d++) for (let k = 0; k < c; k++) out[d * c + k] = def[k]
    }
    // Unaffected faces: corners through the final maps (:1766).
    unaffected.forEach((u, d) => {
        if (!u) return
        const s = dstToSrcFaces[d]
        for (let k = 0; k < srcFo[s + 1] - srcFo[s]; k++) {
            dstCv[dstFo[d] + k] = verts.finalMap[srcCv[srcFo[s] + k]]
            dstCe[dstFo[d] + k] = edgesM.finalMap[srcCe[srcFo[s] + k]]
        }
    })
    mixAttributes(mesh, result, AttrDomain.Corner, ['.corner_vert', '.corner_edge'], cornerOffsets, cornerData)
    return result
}

/** `mesh_merge_by_distance_all` (:1810): undefined when nothing merges. */
export function meshMergeByDistanceAll(mesh: MeshData, selection: number[], distance: number): MeshData | undefined {
    const vertDestMap = new Int32Array(mesh.vertsNum).fill(OUT_OF_CONTEXT)
    const tree = new KDTree3(selection.length)
    const p = mesh.positions
    for (const i of selection) tree.insert(i, p[i * 3], p[i * 3 + 1], p[i * 3 + 2])
    tree.balance()
    const killLen = tree.calcDuplicatesFast(distance, vertDestMap, true)
    if (killLen === 0) return undefined
    return createMergedMesh(mesh, vertDestMap, killLen, true)
}

/** `mesh_merge_by_distance_connected` (:1838) along edges; `selection` per vertex. */
export function meshMergeByDistanceConnected(mesh: MeshData, selection: Uint8Array, distance: number): MeshData | undefined {
    const positions = mesh.positions, edges = mesh.edgeVerts
    let killLen = 0
    const vertDestMap = new Int32Array(mesh.vertsNum)
    const co = Float32Array.from(positions)
    const merged = new Int32Array(mesh.vertsNum)
    const distSqMax = f32(distance * distance)
    for (let i = 0; i < mesh.vertsNum; i++) vertDestMap[i] = i
    for (let i = 0; i < mesh.edgesNum; i++) {
        let v1 = edges[i * 2], v2 = edges[i * 2 + 1]
        while (v1 !== vertDestMap[v1]) v1 = vertDestMap[v1]
        while (v2 !== vertDestMap[v2]) v2 = vertDestMap[v2]
        if (v1 === v2) continue
        if (!selection[v1] || !selection[v2]) continue
        if (v1 > v2) [v1, v2] = [v2, v1]
        const dir = [0, 1, 2].map(k => f32(co[v2 * 3 + k] - co[v1 * 3 + k]))
        const distSq = f32(f32(f32(dir[0] * dir[0]) + f32(dir[1] * dir[1])) + f32(dir[2] * dir[2]))
        if (distSq <= distSqMax) {
            const influence = f32((merged[v2] + 1) / (merged[v1] + merged[v2] + 2))
            for (let k = 0; k < 3; k++) co[v1 * 3 + k] = f32(co[v1 * 3 + k] + f32(dir[k] * influence))
            merged[v1] += merged[v2] + 1
            vertDestMap[v2] = v1
            killLen++
        }
    }
    if (killLen === 0) return undefined
    for (let i = 0; i < mesh.vertsNum; i++) {
        if (i === vertDestMap[i]) {
            vertDestMap[i] = OUT_OF_CONTEXT
        } else {
            let v = i
            while (v !== vertDestMap[v] && vertDestMap[v] !== OUT_OF_CONTEXT) v = vertDestMap[v]
            vertDestMap[v] = v
            vertDestMap[i] = v
        }
    }
    return createMergedMesh(mesh, vertDestMap, killLen, true)
}

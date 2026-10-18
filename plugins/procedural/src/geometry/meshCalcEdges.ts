/**
 * `bke::mesh_calc_edges` (`blenkernel/intern/mesh_calc_edges.cc`, Blender 5.2.2): edges from face corners,
 * in Blender's order - edges are distributed over `parallel_maps` insertion-ordered hash sets by
 * `v_low & mask` (:31, :63), each filled in face-corner order with the edge *ending* at the corner
 * (`face_corner_prev`, :91), and the sets are concatenated. The kernel's `MeshData.calculateEdges` uses a
 * different (first-seen) order, so geometry nodes use this port.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {blenderSystem, powerOf2MinI} from '../blender/system'
import {DATA_TYPES, DataType} from './dataTypes'

/** `VectorSet<OrderedEdge>`: insertion-ordered set of (low, high) vertex pairs. */
class EdgeMap {
    private readonly index = new Map<number, number>()
    readonly low: number[] = []
    readonly high: number[] = []

    constructor(private readonly vertsNum: number) {}

    private key(lo: number, hi: number): number {
        return lo * this.vertsNum + hi
    }

    add(lo: number, hi: number): void {
        const k = this.key(lo, hi)
        if (this.index.has(k)) return
        this.index.set(k, this.low.length)
        this.low.push(lo)
        this.high.push(hi)
    }

    indexOf(lo: number, hi: number): number {
        const i = this.index.get(this.key(lo, hi))
        if (i === undefined) throw new Error('procedural: mesh_calc_edges: edge not in its map')
        return i
    }

    contains(lo: number, hi: number): boolean {
        return this.index.has(this.key(lo, hi))
    }

    get size(): number {
        return this.low.length
    }
}

/** `get_parallel_maps_count` (:170). */
function parallelMapsCount(facesNum: number): number {
    if (facesNum < 1000) return 1
    return powerOf2MinI(Math.min(8, blenderSystem.threadCount))
}

/** Offsets from map sizes (`edge_map_offsets`, :54). */
function mapOffsets(maps: EdgeMap[]): number[] {
    const o = [0]
    for (const m of maps) o.push(o[o.length - 1] + m.size)
    return o
}

const ordered = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a])

/**
 * `bke::mesh_calc_edges(mesh, keep_existing_edges, select_new_edges)` (:197) with the default attribute
 * filter: edge attributes follow their edges (`src_to_dst_mask`), new edges get default values.
 */
export function meshCalcEdges(mesh: MeshData, keepExistingEdges: boolean, selectNewEdges: boolean): void {
    const edgesNum = mesh.edgesNum
    const cornersNum = mesh.cornersNum
    const vertsNum = Math.max(1, mesh.vertsNum)
    if (edgesNum === 0 && cornersNum === 0) return
    if (cornersNum === 0 && !keepExistingEdges) {
        mesh.resizeDomain(AttrDomain.Edge, 0)
        return
    }

    const parallelMaps = parallelMapsCount(mesh.facesNum)
    const mask = parallelMaps - 1
    const maps = Array.from({length: parallelMaps}, () => new EdgeMap(vertsNum))
    const originalEdges = mesh.edgeVerts.slice()

    let originalPrefix = new Array(parallelMaps + 1).fill(0)
    if (keepExistingEdges) {
        // `add_existing_edges_to_hash_maps` (:69): each map takes its edges in edge order.
        for (let e = 0; e < edgesNum; e++) {
            const [lo, hi] = ordered(originalEdges[e * 2], originalEdges[e * 2 + 1])
            maps[lo & mask].add(lo, hi)
        }
        originalPrefix = mapOffsets(maps)
    }
    const originalUniqueEdgeNum = originalPrefix[parallelMaps]
    const originalEdgesAreDistinct = originalUniqueEdgeNum === edgesNum
    if (cornersNum === 0 && keepExistingEdges && originalEdgesAreDistinct) return

    // `add_face_edges_to_hash_maps` (:86).
    const faceOffsets = mesh.faceOffsets
    const cornerVerts = mesh.cornerVerts
    for (let f = 0; f < mesh.facesNum; f++) {
        const start = faceOffsets[f], end = faceOffsets[f + 1]
        for (let c = start; c < end; c++) {
            const prev = c === start ? end - 1 : c - 1
            const [lo, hi] = ordered(cornerVerts[prev], cornerVerts[c])
            maps[lo & mask].add(lo, hi)
        }
    }
    const edgeOffsets = mapOffsets(maps)
    const resultEdgesNum = edgeOffsets[parallelMaps]
    const noNewEdges = resultEdgesNum === originalUniqueEdgeNum

    const mapIndex = (lo: number, hi: number) => edgeOffsets[lo & mask] + maps[lo & mask].indexOf(lo, hi)

    // `update_edge_indices_in_face_loops` (:137): the edge from each corner to the next.
    const cornerEdges = new Int32Array(cornersNum)
    const updateCornerEdges = () => {
        for (let f = 0; f < mesh.facesNum; f++) {
            const start = faceOffsets[f], end = faceOffsets[f + 1]
            for (let c = start; c < end; c++) {
                const next = c === end - 1 ? start : c + 1
                const [lo, hi] = ordered(cornerVerts[next], cornerVerts[c])
                cornerEdges[c] = mapIndex(lo, hi)
            }
        }
    }
    const gatherCornerEdges = (edgeMapToResult: ArrayLike<number>) => {
        for (let c = 0; c < cornersNum; c++) cornerEdges[c] = edgeMapToResult[cornerEdges[c]]
    }
    // `map_edge_to_span_index` (:226).
    const mapEdgeToSpanIndex = (count: number, out: Int32Array) => {
        const iter = new Array(parallelMaps).fill(0)
        for (let e = 0; e < count; e++) {
            const lo = Math.min(originalEdges[e * 2], originalEdges[e * 2 + 1])
            const m = lo & mask
            out[edgeOffsets[m] + iter[m]++] = e
        }
    }
    // `mask_first_distinct_edges` (:186): the first edge of each duplicate group, ascending.
    const maskFirstDistinctEdges = (toCheck: number[]): number[] => {
        if (!toCheck.length) return []
        const first = new Array(resultEdgesNum).fill(Number.MAX_SAFE_INTEGER)
        for (const e of toCheck) {
            const [lo, hi] = ordered(originalEdges[e * 2], originalEdges[e * 2 + 1])
            const i = mapIndex(lo, hi)
            first[i] = Math.min(first[i], e)
        }
        return toCheck.filter(e => {
            const [lo, hi] = ordered(originalEdges[e * 2], originalEdges[e * 2 + 1])
            return first[mapIndex(lo, hi)] === e
        })
    }
    // `serialize_and_initialize_deduplicated_edges` (:110) into `edgeVerts` from position `base`.
    const serialize = (edgeVerts: Int32Array, base: number) => {
        maps.forEach((m, t) => {
            const all = edgeOffsets[t + 1] - edgeOffsets[t]
            const prefixSize = originalPrefix[t + 1] - originalPrefix[t]
            if (all === 0 || prefixSize === all) return
            const begin = edgeOffsets[t] - originalPrefix[t]
            for (let k = prefixSize; k < m.size; k++) {
                const dst = base + begin + (k - prefixSize)
                edgeVerts[dst * 2] = m.low[k]
                edgeVerts[dst * 2 + 1] = m.high[k]
            }
        })
    }

    if (keepExistingEdges && originalEdgesAreDistinct && noNewEdges) {
        // :262-278: edges stay as they are; only corner edges are (re)computed.
        updateCornerEdges()
        const edgeMapToResult = new Int32Array(resultEdgesNum)
        mapEdgeToSpanIndex(edgesNum, edgeMapToResult)
        gatherCornerEdges(edgeMapToResult)
        mesh.cornerEdges.set(cornerEdges)
        return
    }

    let srcToDst: number[] = []
    let backStart: number
    const edgeVerts = new Int32Array(resultEdgesNum * 2)

    if (keepExistingEdges) {
        backStart = originalUniqueEdgeNum
        srcToDst = originalEdgesAreDistinct ? Array.from({length: originalUniqueEdgeNum}, (_, i) => i)
            : maskFirstDistinctEdges(Array.from({length: edgesNum}, (_, i) => i))
        srcToDst.forEach((src, dst) => {
            edgeVerts[dst * 2] = originalEdges[src * 2]
            edgeVerts[dst * 2 + 1] = originalEdges[src * 2 + 1]
        })
        const edgeMapToResult = new Int32Array(resultEdgesNum)
        if (originalEdgesAreDistinct) {
            mapEdgeToSpanIndex(edgesNum, edgeMapToResult)
        } else {
            srcToDst.forEach((src, dst) => {
                const [lo, hi] = ordered(originalEdges[src * 2], originalEdges[src * 2 + 1])
                edgeMapToResult[mapIndex(lo, hi)] = dst
            })
        }
        if (!noNewEdges) {
            // :366-381.
            for (let t = 0; t < parallelMaps; t++) {
                const prefixSize = originalPrefix[t + 1] - originalPrefix[t]
                const newStartPos = edgeOffsets[t] - originalPrefix[t]
                let next = originalUniqueEdgeNum + newStartPos
                for (let i = edgeOffsets[t] + prefixSize; i < edgeOffsets[t + 1]; i++) edgeMapToResult[i] = next++
            }
        }
        updateCornerEdges()
        gatherCornerEdges(edgeMapToResult)
        serialize(edgeVerts, originalUniqueEdgeNum)
    } else if (edgesNum !== 0) {
        // :396-455.
        const originalCornerEdges: number[] = []
        for (let e = 0; e < edgesNum; e++) {
            const [lo, hi] = ordered(originalEdges[e * 2], originalEdges[e * 2 + 1])
            if (maps[lo & mask].contains(lo, hi)) originalCornerEdges.push(e)
        }
        srcToDst = maskFirstDistinctEdges(originalCornerEdges)
        const oldCornerEdgesNum = srcToDst.length
        backStart = oldCornerEdgesNum
        if (srcToDst.length) {
            const edgeMapToResult = new Int32Array(resultEdgesNum).fill(1)
            for (const src of srcToDst) {
                const [lo, hi] = ordered(originalEdges[src * 2], originalEdges[src * 2 + 1])
                edgeMapToResult[mapIndex(lo, hi)] = 0
            }
            // `accumulate_counts_to_offsets(span, old_corner_edges_num)`: the last element becomes the total.
            let offset = oldCornerEdgesNum
            for (let i = 0; i < resultEdgesNum - 1; i++) {
                const count = edgeMapToResult[i]
                edgeMapToResult[i] = offset
                offset += count
            }
            if (resultEdgesNum) edgeMapToResult[resultEdgesNum - 1] = offset
            srcToDst.forEach((src, dst) => {
                const [lo, hi] = ordered(originalEdges[src * 2], originalEdges[src * 2 + 1])
                edgeMapToResult[mapIndex(lo, hi)] = dst
            })
            srcToDst.forEach((src, dst) => {
                edgeVerts[dst * 2] = originalEdges[src * 2]
                edgeVerts[dst * 2 + 1] = originalEdges[src * 2 + 1]
            })
            maps.forEach((m, t) => {
                for (let k = 0; k < m.size; k++) {
                    const dst = edgeMapToResult[edgeOffsets[t] + k]
                    edgeVerts[dst * 2] = m.low[k]
                    edgeVerts[dst * 2 + 1] = m.high[k]
                }
            })
            updateCornerEdges()
            gatherCornerEdges(edgeMapToResult)
        } else {
            updateCornerEdges()
            serialize(edgeVerts, 0)
        }
    } else {
        backStart = 0
        updateCornerEdges()
        serialize(edgeVerts, 0)
    }

    // :470-530: edge attributes follow `src_to_dst_mask`; new edges get the type's default value.
    const edgeLayers = mesh.attributes.layersOnDomain(AttrDomain.Edge).filter(l => l.name !== '.edge_verts')
    const old = edgeLayers.map(l => ({name: l.name, data: l.data.slice()}))
    mesh.resizeDomain(AttrDomain.Edge, resultEdgesNum)
    for (const {name, data} of old) {
        const layer = mesh.attributes.get(name)!
        const comps = DATA_TYPES[layer.type as DataType].components
        const def = DATA_TYPES[layer.type as DataType].defaultValue
        for (let i = 0; i < resultEdgesNum; i++) for (let k = 0; k < comps; k++) layer.data[i * comps + k] = def[k]
        srcToDst.forEach((src, dst) => {
            for (let k = 0; k < comps; k++) layer.data[dst * comps + k] = data[src * comps + k]
        })
    }
    mesh.edgeVerts.set(edgeVerts)
    mesh.cornerEdges.set(cornerEdges)

    if (selectNewEdges) {
        // :541-555.
        mesh.attributes.remove('.select_edge')
        const sel = mesh.attributes.add({name: '.select_edge', domain: AttrDomain.Edge, type: 'bool'}).data
        const backSize = resultEdgesNum - backStart
        if (backSize === 0 || backSize === resultEdgesNum) sel.fill(backSize === resultEdgesNum ? 1 : 0)
        else sel.fill(1, resultEdgesNum - backSize)
    }
}

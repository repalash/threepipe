/**
 * The construction, packing and flushing parts of `geometry::ParamHandle` (`geometry/intern/uv_parametrizer.cc`,
 * Blender 5.2.2): `uv_parametrizer_face_add` (with `p_add_ngon`), `uv_parametrizer_edge_set_seam`,
 * `uv_parametrizer_construct_end` (pairs, charts, boundary filling, pin/select UV loading), `uv_parametrizer_pack` and
 * `uv_parametrizer_flush`. Float32 throughout. The solvers (ABF++, LSCM, SLIM, stretch) are not here: they need Eigen's
 * SparseLU (see issues/open/modelling-tools/15c-eigen-sparselu-port.md).
 *
 * The C code threads its elements through singly linked lists (`nextlink`, new elements prepended) and a special hash
 * (`PHash`) that keeps all elements in one of those lists; both are ported as written because chart, face and edge order
 * follow them. Line numbers refer to `uv_parametrizer.cc`.
 */

import {geomF32, polyfillBeautify, polyfillCalc} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import {Heap, HeapNode} from '../blender/heap'
import {angleNormalizedV3V3, normalizeV3V3, sub3} from '../blender/math/vec'
import {mulV2M2AddV2V2, PackIsland, packIslands, PinMethod, UVPackIslandParams} from './uvPack'

const PVERT_PIN = 1, PVERT_SELECT = 2, PVERT_SPLIT = 16
const PEDGE_SEAM = 1, PEDGE_VERTEX_SPLIT = 2, PEDGE_PIN = 4, PEDGE_SELECT = 8, PEDGE_DONE = 16, PEDGE_FILLED = 32
const PFACE_CONNECTED = 1, PFACE_FILLED = 2

/** Elements share `nextlink` + `key` as the `PHashLink` header. */
interface Link {
    nextlink: Link | null
    key: number
}

class PVert implements Link {
    nextlink: PVert | null = null
    key = 0
    edge: PEdge | null = null
    co = new Float32Array(3)
    uv = new Float32Array(2)
    flag = 0
    weight = 1
}

class PEdge implements Link {
    nextlink: PEdge | null = null
    key = 0
    heaplink: HeapNode<PEdge> | null = null
    vert!: PVert
    pair: PEdge | null = null
    next!: PEdge
    face!: PFace
    /** Corner index into the caller's UV array (`float *orig_uv`), or -1 for filled edges. */
    origUv = -1
    oldUv = new Float32Array(2)
    flag = 0
}

class PFace implements Link {
    nextlink: PFace | null = null
    key = 0
    chart = 0
    edge!: PEdge
    flag = 0
}

class PChart {
    verts: PVert | null = null
    edges: PEdge | null = null
    faces: PFace | null = null
    nverts = 0
    nedges = 0
    nfaces = 0
    nboundaries = 0
    hasPins = false
}

const PHASH_SIZES = [1, 3, 5, 11, 17, 37, 67, 131, 257, 521, 1031, 2053, 4099, 8209, 16411, 32771, 65537, 131101, 262147, 524309, 1048583,
    2097169, 4194319, 8388617, 16777259, 33554467, 67108879, 134217757, 268435459]

/** `PHASH_edge` (:198) in `uintptr_t`; keys here stay below 2^32 / 39, so the products and XOR are exact as uint32. */
function phashEdge(v1: number, v2: number): number {
    if (v1 >= 110000000 || v2 >= 110000000) throw new Error('uv_parametrizer: vertex keys above 2^32 / 39 (64-bit PHASH_edge) are not ported')
    return (v1 < v2 ? ((v1 * 39) ^ (v2 * 31)) : ((v1 * 31) ^ (v2 * 39))) >>> 0
}

/** `PHash` (:202). `list` is the head of the construction chart's list it threads. */
class PHash<T extends Link> {
    size = 0
    cursizeId = 0
    cursize: number
    buckets: (T | null)[]
    constructor(private readonly getList: () => T | null, private readonly setList: (l: T | null) => void, sizehint: number) {
        while (PHASH_SIZES[this.cursizeId] < sizehint) this.cursizeId++
        this.cursize = PHASH_SIZES[this.cursizeId]
        this.buckets = new Array(this.cursize).fill(null)
    }

    private hash(key: number): number {
        return key % this.cursize
    }

    /** `phash_insert` (:234). */
    insert(link: T): void {
        const size = this.cursize
        const h = this.hash(link.key)
        const lookup = this.buckets[h]
        if (lookup === null) {
            this.buckets[h] = link
            link.nextlink = this.getList()
            this.setList(link)
        } else {
            link.nextlink = lookup.nextlink
            lookup.nextlink = link
        }
        this.size++
        if (this.size > size * 3) {
            let first = this.getList()
            this.cursize = PHASH_SIZES[++this.cursizeId]
            this.buckets = new Array(this.cursize).fill(null)
            this.size = 0
            this.setList(null)
            for (let l = first; l; ) {
                const next = l.nextlink as T | null
                this.insert(l)
                l = next
            }
            first = null
        }
    }

    /** `phash_lookup` (:270). */
    lookup(key: number): T | null {
        const h = this.hash(key)
        for (let l = this.buckets[h]; l; l = l.nextlink as T | null) {
            if (l.key === key) return l
            if (this.hash(l.key) !== h) return null
        }
        return null
    }

    /** `phash_next` (:287). */
    next(key: number, link: T): T | null {
        const h = this.hash(key)
        for (let l = link.nextlink as T | null; l; l = l.nextlink as T | null) {
            if (l.key === key) return l
            if (this.hash(l.key) !== h) return null
        }
        return null
    }
}

const wheelEdgeNext = (e: PEdge) => e.next.next.pair
const wheelEdgePrev = (e: PEdge) => (e.pair ? e.pair.next : null)
const boundaryEdgeNext = (e: PEdge) => e.next.vert.edge!
function boundaryEdgePrev(e: PEdge): PEdge {
    let we: PEdge | null = e, last: PEdge
    do {
        last = we!
        we = wheelEdgeNext(we!)
    } while (we && we !== e)
    return last.next.next
}

/** `len_v3v3`. */
function lenV3V3(a: ArrayLike<number>, b: ArrayLike<number>): number {
    const d = sub3(b, a)
    return f32(Math.sqrt(f32(f32(f32(d[0] * d[0]) + f32(d[1] * d[1])) + f32(d[2] * d[2]))))
}

/** `angle_v3v3v3` (`math_vector.cc:252`). */
function angleV3V3V3(a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>): number {
    return angleNormalizedV3V3(normalizeV3V3(sub3(b, a)), normalizeV3V3(sub3(b, c)))
}

export class ParamHandle {
    private readonly construction = new PChart()
    private hashVerts: PHash<PVert>
    private hashEdges: PHash<PEdge>
    private hashFaces: PHash<PFace>
    charts: PChart[] = []
    aspectY = 1
    blend = 0

    /** `uv` is the caller's float3 corner array (`mp_uv[i] = uv[corner]`, only x and y are written); `co` vertex positions. */
    constructor(private readonly uv: Float32Array, private readonly uvStride: number) {
        const c = this.construction
        this.hashVerts = new PHash<PVert>(() => c.verts, l => (c.verts = l), 1)
        this.hashEdges = new PHash<PEdge>(() => c.edges, l => (c.edges = l), 1)
        this.hashFaces = new PHash<PFace>(() => c.faces, l => (c.faces = l), 1)
    }

    private origUv(corner: number): [number, number] {
        return [this.uv[corner * this.uvStride], this.uv[corner * this.uvStride + 1]]
    }

    /** `p_vert_add` (:744) / `p_vert_lookup` (:773). */
    private vertLookup(key: number, co: ArrayLike<number>, weight: number, e: PEdge): PVert {
        const found = this.hashVerts.lookup(key)
        if (found) return found
        const v = new PVert()
        v.co.set(co)
        v.weight = weight
        for (let i = 0; i < 3; i++) if (!Number.isFinite(v.co[i])) v.co[i] = 0
        v.key = key
        v.edge = e
        this.hashVerts.insert(v)
        return v
    }

    /** `p_face_add` (:1101). */
    private faceAdd(): PFace {
        const f = new PFace()
        const e1 = new PEdge(), e2 = new PEdge(), e3 = new PEdge()
        f.edge = e1
        e1.face = e2.face = e3.face = f
        e1.next = e2
        e2.next = e3
        e3.next = e1
        return f
    }

    /** `p_face_add_construct` (:1124). */
    private faceAddConstruct(key: number, vkeys: number[], co: ArrayLike<number>[], uv: number[], i1: number, i2: number, i3: number, pin: boolean[], select: boolean[]): PFace {
        const f = this.faceAdd()
        const e1 = f.edge, e2 = e1.next, e3 = e2.next
        e1.vert = this.vertLookup(vkeys[i1], co[i1], 1, e1)
        e2.vert = this.vertLookup(vkeys[i2], co[i2], 1, e2)
        e3.vert = this.vertLookup(vkeys[i3], co[i3], 1, e3)
        e1.origUv = uv[i1]
        e2.origUv = uv[i2]
        e3.origUv = uv[i3]
        if (pin[i1]) e1.flag |= PEDGE_PIN
        if (pin[i2]) e2.flag |= PEDGE_PIN
        if (pin[i3]) e3.flag |= PEDGE_PIN
        if (select[i1]) e1.flag |= PEDGE_SELECT
        if (select[i2]) e2.flag |= PEDGE_SELECT
        if (select[i3]) e3.flag |= PEDGE_SELECT
        f.key = key
        this.hashFaces.insert(f)
        e1.key = phashEdge(vkeys[i1], vkeys[i2])
        e2.key = phashEdge(vkeys[i2], vkeys[i3])
        e3.key = phashEdge(vkeys[i3], vkeys[i1])
        this.hashEdges.insert(e1)
        this.hashEdges.insert(e2)
        this.hashEdges.insert(e3)
        return f
    }

    /** `p_face_exists` (:822). */
    private faceExists(vkeys: number[], i1: number, i2: number, i3: number): boolean {
        const key = phashEdge(vkeys[i1], vkeys[i2])
        let e = this.hashEdges.lookup(key)
        while (e) {
            if (e.vert.key === vkeys[i1] && e.next.vert.key === vkeys[i2]) {
                if (e.next.next.vert.key === vkeys[i3]) return true
            } else if (e.vert.key === vkeys[i2] && e.next.vert.key === vkeys[i1]) {
                if (e.next.next.vert.key === vkeys[i3]) return true
            }
            e = this.hashEdges.next(key, e)
        }
        return false
    }

    /** `p_add_ngon` (:3891). */
    private addNgon(key: number, vkeys: number[], co: ArrayLike<number>[], uv: number[], pin: boolean[], select: boolean[]): void {
        const n = vkeys.length
        const normal = [0, 0, 0]
        let prev = co[n - 1]
        for (let j = 0; j < n; j++) {
            geomF32.addNewellCrossV3V3(normal, prev, co[j])
            prev = co[j]
        }
        if (geomF32.normalizeV3(normal) === 0) normal[2] = 1
        const m = geomF32.axisDominantV3ToM3Negate(normal)
        const proj = new Float32Array(n * 2)
        for (let j = 0; j < n; j++) geomF32.mulV2M3V3(m, co[j], proj, j * 2)
        const tris = polyfillCalc(proj, n, 1)
        polyfillBeautify(proj, n, tris)
        for (let j = 0; j < n - 2; j++) {
            const t = [tris[j * 3], tris[j * 3 + 1], tris[j * 3 + 2]]
            this.faceAddPublic(key, t.map(i => vkeys[i]), t.map(i => co[i]), t.map(i => uv[i]), t.map(i => pin[i]), t.map(i => select[i]))
        }
    }

    /** `uv_parametrizer_face_add` (:3967); `uv` holds corner indices. Weights are always 1 here (no weight array). */
    faceAddPublic(key: number, vkeys: number[], co: ArrayLike<number>[], uv: number[], pin: boolean[], select: boolean[]): void {
        const nverts = vkeys.length
        if (nverts > 3) {
            const permute: number[] = Array.from({length: nverts}, (_, i) => i)
            for (let i = nverts - 1; i >= 0;) {
                const pm = permute.length
                const i0 = permute[i], i1 = permute[(i + 1) % pm], i2 = permute[(i + 2) % pm]
                if (!this.faceExists(vkeys, i0, i1, i2)) {
                    i--
                    continue
                }
                const iprev = permute[(i + pm - 1) % pm]
                this.faceAddConstruct(key, vkeys, co, uv, iprev, i0, i1, pin, select)
                permute.splice(i, 1)
                if (permute.length === 3) break
                i--
            }
            if (permute.length !== nverts) {
                this.addNgon(key, permute.map(j => vkeys[j]), permute.map(j => co[j]), permute.map(j => uv[j]),
                    permute.map(j => pin[j]), permute.map(j => select[j]))
                return
            }
        }
        if (nverts > 3) this.addNgon(key, vkeys, co, uv, pin, select)
        else if (!this.faceExists(vkeys, 0, 1, 2)) this.faceAddConstruct(key, vkeys, co, uv, 0, 1, 2, pin, select)
    }

    /** `p_edge_lookup` (:802). */
    private edgeLookup(k0: number, k1: number): PEdge | null {
        const key = phashEdge(k0, k1)
        let e = this.hashEdges.lookup(key)
        while (e) {
            if ((e.vert.key === k0 && e.next.vert.key === k1) || (e.vert.key === k1 && e.next.vert.key === k0)) return e
            e = this.hashEdges.next(key, e)
        }
        return null
    }

    /** `uv_parametrizer_edge_set_seam` (:4061). */
    edgeSetSeam(k0: number, k1: number): void {
        const e = this.edgeLookup(k0, k1)
        if (e) e.flag |= PEDGE_SEAM
    }

    /** `p_edge_implicit_seam` (:847). */
    private edgeImplicitSeam(e: PEdge, ep: PEdge): boolean {
        const limit = f32(0.00001)
        const uv1 = this.origUv(e.origUv), uv2 = this.origUv(e.next.origUv)
        let uvp1: [number, number], uvp2: [number, number]
        if (e.vert.key === ep.vert.key) {
            uvp1 = this.origUv(ep.origUv)
            uvp2 = this.origUv(ep.next.origUv)
        } else {
            uvp1 = this.origUv(ep.next.origUv)
            uvp2 = this.origUv(ep.origUv)
        }
        if (Math.abs(f32(uv1[0] - uvp1[0])) > limit || Math.abs(f32(uv1[1] - uvp1[1])) > limit ||
            Math.abs(f32(uv2[0] - uvp2[0])) > limit || Math.abs(f32(uv2[1] - uvp2[1])) > limit) {
            e.flag |= PEDGE_SEAM
            ep.flag |= PEDGE_SEAM
            return true
        }
        return false
    }

    /** `p_edge_has_pair` (:881). */
    private edgeHasPair(e: PEdge, topologyFromUvs: boolean): PEdge | null {
        const key1 = e.vert.key, key2 = e.next.vert.key
        if (e.flag & PEDGE_SEAM) return null
        const key = phashEdge(key1, key2)
        let pe = this.hashEdges.lookup(key)
        let pair: PEdge | null = null
        while (pe) {
            if (pe !== e) {
                const v1 = pe.vert, v2 = pe.next.vert
                if ((v1.key === key1 && v2.key === key2) || (v1.key === key2 && v2.key === key1)) {
                    if ((pe.flag & PEDGE_SEAM) || pair || (topologyFromUvs && this.edgeImplicitSeam(e, pe))) return null
                    pair = pe
                }
            }
            pe = this.hashEdges.next(key, pe)
        }
        if (pair && e.vert === pair.vert) {
            if (pair.next.pair || pair.next.next.pair) return null
        }
        return pair
    }

    /** `p_face_flip` (:593). */
    private static faceFlip(f: PFace): void {
        const e1 = f.edge, e2 = e1.next, e3 = e2.next
        const v1 = e1.vert, v2 = e2.vert, v3 = e3.vert
        const f1 = e1.flag, f2 = e2.flag, f3 = e3.flag
        const o1 = e1.origUv, o2 = e2.origUv, o3 = e3.origUv
        e1.vert = v2
        e1.next = e3
        e1.origUv = o2
        e1.flag = (f1 & ~PEDGE_PIN) | (f2 & PEDGE_PIN)
        e2.vert = v3
        e2.next = e1
        e2.origUv = o3
        e2.flag = (f2 & ~PEDGE_PIN) | (f3 & PEDGE_PIN)
        e3.vert = v1
        e3.next = e2
        e3.origUv = o1
        e3.flag = (f3 & ~PEDGE_PIN) | (f1 & PEDGE_PIN)
    }

    /** `p_edge_connect_pair` (:933). */
    private edgeConnectPair(e: PEdge, topologyFromUvs: boolean, stack: PEdge[]): boolean {
        if (!e.pair) {
            const pair = this.edgeHasPair(e, topologyFromUvs)
            if (pair) {
                if (e.vert === pair.vert) ParamHandle.faceFlip(pair.face)
                e.pair = pair
                pair.pair = e
                if (!(pair.face.flag & PFACE_CONNECTED)) stack.push(pair)
            }
        }
        return e.pair !== null
    }

    /** `p_connect_pairs` (:957). */
    private connectPairs(topologyFromUvs: boolean): number {
        let ncharts = 0
        for (let first = this.construction.faces; first; first = first.nextlink) {
            if (first.flag & PFACE_CONNECTED) continue
            const stack: PEdge[] = [first.edge]
            while (stack.length) {
                const e = stack.pop()!
                const e1 = e.next, e2 = e1.next
                const f = e.face
                f.flag |= PFACE_CONNECTED
                f.chart = ncharts
                if (!this.edgeConnectPair(e, topologyFromUvs, stack)) e.vert.edge = e
                if (!this.edgeConnectPair(e1, topologyFromUvs, stack)) e1.vert.edge = e1
                if (!this.edgeConnectPair(e2, topologyFromUvs, stack)) e2.vert.edge = e2
            }
            ncharts++
        }
        return ncharts
    }

    /** `p_split_vert` (:1007). */
    private static splitVert(chart: PChart, e: PEdge): void {
        let v = e.vert
        let copy = true
        if (e.flag & PEDGE_PIN) chart.hasPins = true
        if (e.flag & PEDGE_VERTEX_SPLIT) return
        let lastwe = e
        for (let we = wheelEdgePrev(e); we && we !== e; we = wheelEdgePrev(we)) lastwe = we
        for (let we: PEdge | null = lastwe; we; we = wheelEdgeNext(we)) {
            if (we.flag & PEDGE_VERTEX_SPLIT) break
            we.flag |= PEDGE_VERTEX_SPLIT
            if (we === v.edge) {
                copy = false
                v.nextlink = chart.verts
                chart.verts = v
                chart.nverts++
            }
        }
        if (copy) {
            v.flag |= PVERT_SPLIT
            const nv = new PVert()
            nv.co.set(v.co)
            nv.uv.set(v.uv)
            nv.key = v.key
            nv.edge = v.edge
            nv.flag = v.flag
            nv.weight = v.weight
            v = nv
            v.flag |= PVERT_SPLIT
            v.nextlink = chart.verts
            chart.verts = v
            chart.nverts++
            v.edge = lastwe
            let we: PEdge | null = lastwe
            do {
                we!.vert = v
                we = wheelEdgeNext(we!)
            } while (we && we !== lastwe)
        }
    }

    /** `p_split_charts` (:1064). */
    private splitCharts(ncharts: number): PChart[] {
        const charts = Array.from({length: ncharts}, () => new PChart())
        let f = this.construction.faces
        while (f) {
            const e1 = f.edge, e2 = e1.next, e3 = e2.next
            const nextf: PFace | null = f.nextlink
            const c = charts[f.chart]
            f.nextlink = c.faces
            c.faces = f
            e1.nextlink = c.edges
            c.edges = e1
            e2.nextlink = c.edges
            c.edges = e2
            e3.nextlink = c.edges
            c.edges = e3
            c.nfaces++
            c.nedges += 3
            ParamHandle.splitVert(c, e1)
            ParamHandle.splitVert(c, e2)
            ParamHandle.splitVert(c, e3)
            f = nextf
        }
        return charts
    }

    /** `p_chart_boundaries` (:1225): returns the outer (longest) boundary edge. */
    private static chartBoundaries(chart: PChart): PEdge | null {
        let maxlen = -1
        let outer: PEdge | null = null
        chart.nboundaries = 0
        for (let e = chart.edges; e; e = e.nextlink) {
            if (e.pair || (e.flag & PEDGE_DONE)) continue
            chart.nboundaries++
            let len = 0
            let be = e
            do {
                be.flag |= PEDGE_DONE
                len = f32(len + lenV3V3(be.vert.co, be.next.vert.co))
                be = be.next.vert.edge!
            } while (be !== e)
            if (len > maxlen) {
                outer = e
                maxlen = len
            }
        }
        for (let e = chart.edges; e; e = e.nextlink) e.flag &= ~PEDGE_DONE
        return outer
    }

    /** `p_edge_boundary_angle` (:1262). */
    private static edgeBoundaryAngle(e: PEdge): number {
        const v = e.vert
        let angle = f32(Math.PI)
        let we: PEdge | null = v.edge!
        do {
            const v1 = we!.next.vert, v2 = we!.next.next.vert
            angle = f32(angle - angleV3V3V3(v1.co, v.co, v2.co))
            we = we!.next.next.pair
        } while (we && we !== v.edge)
        return angle
    }

    /** `p_face_add_fill` (:1197). */
    private faceAddFill(chart: PChart, v1: PVert, v2: PVert, v3: PVert): PFace {
        const f = this.faceAdd()
        const e1 = f.edge, e2 = e1.next, e3 = e2.next
        e1.vert = v1
        e2.vert = v2
        e3.vert = v3
        e1.origUv = e2.origUv = e3.origUv = -1
        f.nextlink = chart.faces
        chart.faces = f
        e1.nextlink = chart.edges
        chart.edges = e1
        e2.nextlink = chart.edges
        chart.edges = e2
        e3.nextlink = chart.edges
        chart.edges = e3
        chart.nfaces++
        chart.nedges += 3
        return f
    }

    /** `p_chart_fill_boundary` (:1285). */
    private fillBoundary(chart: PChart, be: PEdge, nedges: number): void {
        const heap = new Heap<PEdge>()
        let e = be
        do {
            e.heaplink = heap.insert(ParamHandle.edgeBoundaryAngle(e), e)
            e = boundaryEdgeNext(e)
        } while (e !== be)
        if (nedges === 2) {
            e = be.next.vert.edge!
            e.pair = be
            be.pair = e
            heap.remove(e.heaplink!)
            heap.remove(be.heaplink!)
            return
        }
        while (nedges > 2) {
            e = heap.popMin()
            const e1 = boundaryEdgePrev(e)
            const e2 = boundaryEdgeNext(e)
            heap.remove(e1.heaplink!)
            heap.remove(e2.heaplink!)
            e.heaplink = e1.heaplink = e2.heaplink = null
            e.flag |= PEDGE_FILLED
            e1.flag |= PEDGE_FILLED
            const f = this.faceAddFill(chart, e.vert, e1.vert, e2.vert)
            f.flag |= PFACE_FILLED
            const ne = f.edge.next.next, ne1 = f.edge, ne2 = f.edge.next
            ne.flag = ne1.flag = ne2.flag = PEDGE_FILLED
            e.pair = ne
            ne.pair = e
            e1.pair = ne1
            ne1.pair = e1
            ne.vert = e2.vert
            ne1.vert = e.vert
            ne2.vert = e1.vert
            if (nedges === 3) {
                e2.pair = ne2
                ne2.pair = e2
            } else {
                ne2.vert.edge = ne2
                ne2.heaplink = heap.insert(ParamHandle.edgeBoundaryAngle(ne2), ne2)
                e2.heaplink = heap.insert(ParamHandle.edgeBoundaryAngle(e2), e2)
            }
            nedges--
        }
    }

    /** `p_chart_fill_boundaries` (:1362). */
    private fillBoundaries(chart: PChart, outer: PEdge | null): void {
        for (let e = chart.edges; e; e = e.nextlink) {
            if (e.pair || (e.flag & PEDGE_FILLED)) continue
            let nedges = 0
            let be = e
            do {
                be.flag |= PEDGE_FILLED
                be = be.next.vert.edge!
                nedges++
            } while (be !== e)
            if (e !== outer) this.fillBoundary(chart, e, nedges)
        }
    }

    /** `p_vert_load_pin_select_uvs` (:638). */
    private loadPinSelectUvs(v: PVert): void {
        let nedges = 0, npins = 0
        v.uv[0] = v.uv[1] = 0
        const pin = [0, 0]
        let e: PEdge | null = v.edge!
        do {
            if (e!.origUv !== -1) {
                const o = this.origUv(e!.origUv)
                if (e!.flag & PEDGE_SELECT) v.flag |= PVERT_SELECT
                if (e!.flag & PEDGE_PIN) {
                    pin[0] = f32(pin[0] + f32(o[0] * this.aspectY))
                    pin[1] = f32(pin[1] + o[1])
                    npins++
                } else {
                    v.uv[0] = f32(v.uv[0] + f32(o[0] * this.aspectY))
                    v.uv[1] = f32(v.uv[1] + o[1])
                }
                nedges++
            }
            e = wheelEdgeNext(e!)
        } while (e && e !== v.edge)
        if (npins > 0) {
            v.uv[0] = f32(pin[0] / npins)
            v.uv[1] = f32(pin[1] / npins)
            v.flag |= PVERT_PIN
        } else if (nedges > 0) {
            v.uv[0] = f32(v.uv[0] / nedges)
            v.uv[1] = f32(v.uv[1] / nedges)
        }
    }

    /** `uv_parametrizer_construct_end` (:4071). */
    constructEnd(fillHoles: boolean, topologyFromUvs: boolean): void {
        const ncharts = this.connectPairs(topologyFromUvs)
        const charts = this.splitCharts(ncharts)
        this.charts = []
        for (const chart of charts) {
            const outer = ParamHandle.chartBoundaries(chart)
            if (!topologyFromUvs && chart.nboundaries === 0) continue
            this.charts.push(chart)
            if (fillHoles && chart.nboundaries > 1) this.fillBoundaries(chart, outer)
            for (let v = chart.verts; v; v = v.nextlink) this.loadPinSelectUvs(v)
        }
    }

    /** `uv_parametrizer_pack` (:4232). */
    pack(params: UVPackIslandParams): void {
        if (!this.charts.length) return
        this.scaleX(f32(1 / this.aspectY))
        const islands: PackIsland[] = []
        this.charts.forEach((chart, i) => {
            if (params.pinMethod === PinMethod.NONE && chart.hasPins) return
            const island = new PackIsland()
            island.callerIndex = i
            island.aspectY = this.aspectY
            island.pinned = chart.hasPins
            for (let f = chart.faces; f; f = f.nextlink) island.addTriangle(f.edge.vert.uv, f.edge.next.vert.uv, f.edge.next.next.vert.uv)
            islands.push(island)
        })
        const scale = packIslands(islands, params)
        for (const island of islands) {
            const islandScale = island.canScale(params) ? scale : 1
            const chart = this.charts[island.callerIndex]
            const m = island.buildTransformation(islandScale, island.angle)
            for (let v = chart.verts; v; v = v.nextlink) v.uv.set(mulV2M2AddV2V2(m, v.uv, island.preTranslate))
            for (let v = chart.verts; v; v = v.nextlink) {
                v.uv[0] = f32(v.uv[0] + params.udimBaseOffset[0])
                v.uv[1] = f32(v.uv[1] + params.udimBaseOffset[1])
            }
        }
        this.scaleX(this.aspectY)
    }

    /** `uv_parametrizer_scale_x` (:476). */
    private scaleX(s: number): void {
        if (s === 1) return
        for (const chart of this.charts) for (let v = chart.verts; v; v = v.nextlink) v.uv[0] = f32(v.uv[0] * s)
    }

    /** `uv_parametrizer_flush` (:4460) / `p_flush_uvs` (:682). */
    flush(): void {
        const blend = this.blend
        const invblend = f32(1 - blend)
        const invblendX = f32(invblend / this.aspectY)
        for (const chart of this.charts) {
            for (let e = chart.edges; e; e = e.nextlink) {
                if (e.origUv === -1) continue
                const o = e.origUv * this.uvStride
                this.uv[o] = f32(f32(blend * e.oldUv[0]) + f32(invblendX * e.vert.uv[0]))
                this.uv[o + 1] = f32(f32(blend * e.oldUv[1]) + f32(invblend * e.vert.uv[1]))
            }
        }
    }
}

/**
 * A small exact BMesh (Blender 5.2.2 `bmesh/intern`): the element creation, disk / radial cycles and the two Euler splits
 * the primitive operators need, in float32, with Blender's element order.
 *
 * Element order: Blender iterates `BLI_mempool` storage. The pools here are only ever appended to (nothing is freed), and
 * a mempool that never frees hands out elements in allocation order and iterates them in that order (chunks are appended
 * at the tail, `BLI_mempool.cc` `mempool_chunk_add`), so creation-ordered arrays reproduce `BM_ITER_MESH` exactly. A kill
 * function would need the free-list reuse and is deliberately absent.
 *
 * Loop custom data: one float2 layer (the UV map) per loop, `uv`. Vertex custom data: the temporary shape key that
 * `bmo_subdivide_edges_exec` adds (`shape`).
 */

import {f32} from '../f32'

export class BMVert {
    index: number
    co: Float32Array
    /** The `CD_SHAPEKEY` temp layer of `bmo_subdivide_edges_exec`, when present. */
    shape: Float32Array
    e: BMEdge | null = null
    constructor(index: number, co: ArrayLike<number>) {
        this.index = index
        this.co = Float32Array.from(co as ArrayLike<number>)
        this.shape = new Float32Array(3)
    }
}

interface DiskLink {
    next: BMEdge | null
    prev: BMEdge | null
}

export class BMEdge {
    index: number
    v1: BMVert
    v2: BMVert
    l: BMLoop | null = null
    v1Disk: DiskLink = {next: null, prev: null}
    v2Disk: DiskLink = {next: null, prev: null}
    constructor(index: number, v1: BMVert, v2: BMVert) {
        this.index = index
        this.v1 = v1
        this.v2 = v2
    }
}

export class BMLoop {
    v: BMVert
    e: BMEdge | null
    f: BMFace
    next!: BMLoop
    prev!: BMLoop
    radialNext: BMLoop | null = null
    radialPrev: BMLoop | null = null
    uv = new Float32Array(2)
    constructor(v: BMVert, e: BMEdge | null, f: BMFace) {
        this.v = v
        this.e = e
        this.f = f
    }
}

export class BMFace {
    index: number
    lFirst!: BMLoop
    len = 0
    constructor(index: number) {
        this.index = index
    }
}

/** `bmesh_disk_edge_link_from_vert`. */
const diskLink = (e: BMEdge, v: BMVert): DiskLink => (v === e.v1 ? e.v1Disk : e.v2Disk)
/** `bmesh_disk_edge_next`. */
export const diskEdgeNext = (e: BMEdge, v: BMVert): BMEdge => diskLink(e, v).next!

/** `bmesh_disk_edge_append` (`bmesh_structure.cc:139`). */
function diskEdgeAppend(e: BMEdge, v: BMVert): void {
    if (!v.e) {
        const dl1 = diskLink(e, v)
        v.e = e
        dl1.next = dl1.prev = e
    } else {
        const dl1 = diskLink(e, v)
        const dl2 = diskLink(v.e, v)
        const dl3 = dl2.prev ? diskLink(dl2.prev, v) : null
        dl1.next = v.e
        dl1.prev = dl2.prev
        dl2.prev = e
        if (dl3) dl3.next = e
    }
}

/** `bmesh_disk_edge_remove` (`bmesh_structure.cc:162`). */
function diskEdgeRemove(e: BMEdge, v: BMVert): void {
    const dl1 = diskLink(e, v)
    if (dl1.prev) diskLink(dl1.prev, v).next = dl1.next
    if (dl1.next) diskLink(dl1.next, v).prev = dl1.prev
    if (v.e === e) v.e = e !== dl1.next ? dl1.next : null
    dl1.next = dl1.prev = null
}

/** `bmesh_disk_vert_replace` (`bmesh_structure.cc`) with `bmesh_disk_vert_swap`. */
function diskVertReplace(e: BMEdge, vDst: BMVert, vSrc: BMVert): void {
    diskEdgeRemove(e, vSrc)
    if (e.v1 === vSrc) {
        e.v1 = vDst
        e.v1Disk.next = e.v1Disk.prev = null
    } else if (e.v2 === vSrc) {
        e.v2 = vDst
        e.v2Disk.next = e.v2Disk.prev = null
    } else throw new Error('bmesh_disk_vert_swap: vertex not in edge')
    diskEdgeAppend(e, vDst)
}

/** `bmesh_radial_loop_append` (`bmesh_structure.cc`). */
function radialLoopAppend(e: BMEdge, l: BMLoop): void {
    if (e.l === null) {
        e.l = l
        l.radialNext = l.radialPrev = l
    } else {
        l.radialPrev = e.l
        l.radialNext = e.l.radialNext
        e.l.radialNext!.radialPrev = l
        e.l.radialNext = l
        e.l = l
    }
    if (l.e && l.e !== e) throw new Error('bmesh_radial_loop_append: loop is in another radial cycle')
    l.e = e
}

/** `bmesh_radial_loop_unlink`. */
function radialLoopUnlink(l: BMLoop): void {
    if (l.radialNext !== l) {
        l.radialNext!.radialPrev = l.radialPrev
        l.radialPrev!.radialNext = l.radialNext
    }
    l.radialNext = l.radialPrev = null
    l.e = null
}

export const edgeOtherVert = (e: BMEdge, v: BMVert): BMVert => (e.v1 === v ? e.v2 : e.v1)
const vertsInEdge = (a: BMVert, b: BMVert, e: BMEdge) => (e.v1 === a && e.v2 === b) || (e.v1 === b && e.v2 === a)

/** `BM_edge_exists` (`bmesh_query.cc`): walks the disk cycle of `a`. */
function edgeExists(a: BMVert, b: BMVert): BMEdge | null {
    if (!a.e || !b.e) return null
    let e = a.e
    do {
        if (edgeOtherVert(e, a) === b) return e
    } while ((e = diskEdgeNext(e, a)) !== a.e)
    return null
}

/** `BM_loop_is_adjacent`. */
export const loopIsAdjacent = (a: BMLoop, b: BMLoop) => a.next === b || a.prev === b

export class BMesh {
    readonly verts: BMVert[] = []
    readonly edges: BMEdge[] = []
    readonly faces: BMFace[] = []
    totloop = 0

    /** `BM_vert_create` (`bmesh_core.cc:44`); `example` copies the custom data. */
    vertCreate(co: ArrayLike<number>, example?: BMVert): BMVert {
        const v = new BMVert(this.verts.length, co)
        if (example) v.shape.set(example.shape)
        this.verts.push(v)
        return v
    }

    /** `BM_edge_create` (`bmesh_core.cc:129`). */
    edgeCreate(v1: BMVert, v2: BMVert, noDouble = false): BMEdge {
        if (v1 === v2) throw new Error('BM_edge_create: v1 == v2')
        if (noDouble) {
            const e = edgeExists(v1, v2)
            if (e) return e
        }
        const e = new BMEdge(this.edges.length, v1, v2)
        diskEdgeAppend(e, e.v1)
        diskEdgeAppend(e, e.v2)
        this.edges.push(e)
        return e
    }

    /** `bm_loop_create` (`bmesh_core.cc`): `example` copies the loop custom data block. */
    private loopCreate(v: BMVert, e: BMEdge | null, f: BMFace, example?: BMLoop): BMLoop {
        const l = new BMLoop(v, e, f)
        if (example) l.uv.set(example.uv)
        this.totloop++
        return l
    }

    private faceCreateInternal(): BMFace {
        const f = new BMFace(this.faces.length)
        this.faces.push(f)
        return f
    }

    /** `BM_face_create` (`bmesh_core.cc`) without `BM_CREATE_NO_DOUBLE`. */
    faceCreate(verts: BMVert[], edges: BMEdge[]): BMFace {
        const f = this.faceCreateInternal()
        // `bm_face_boundary_add`.
        const startl = this.loopCreate(verts[0], edges[0], f)
        radialLoopAppend(edges[0], startl)
        f.lFirst = startl
        let lastl = startl
        for (let i = 1; i < verts.length; i++) {
            const l = this.loopCreate(verts[i], null, f)
            radialLoopAppend(edges[i], l)
            l.prev = lastl
            lastl.next = l
            lastl = l
        }
        startl.prev = lastl
        lastl.next = startl
        f.len = verts.length
        return f
    }

    /** `BM_face_create_verts(..., create_edges = true)` with `BM_edges_from_verts_ensure` (`bmesh_construct.cc`). */
    faceCreateVerts(verts: BMVert[]): BMFace {
        const len = verts.length
        const edges: BMEdge[] = new Array(len)
        let iPrev = len - 1
        for (let i = 0; i < len; i++) {
            edges[iPrev] = this.edgeCreate(verts[iPrev], verts[i], true)
            iPrev = i
        }
        return this.faceCreate(verts, edges)
    }

    /** `bmesh_kernel_split_edge_make_vert` (`bmesh_core.cc`): returns the new vertex and edge. */
    private splitEdgeMakeVert(tv: BMVert, e: BMEdge): [BMVert, BMEdge] {
        const vNew = this.vertCreate(tv.co, tv)
        const eNew = this.edgeCreate(tv, vNew)
        diskEdgeRemove(eNew, tv)
        diskEdgeRemove(eNew, vNew)
        diskVertReplace(e, vNew, tv)
        diskEdgeAppend(eNew, vNew)
        diskEdgeAppend(eNew, tv)

        let lNext = e.l
        e.l = null
        if (lNext) {
            let isFirst = true
            while (lNext) {
                const l: BMLoop = lNext
                l.f.len++
                lNext = lNext !== lNext.radialNext ? lNext.radialNext : null
                radialLoopUnlink(l)
                const lNew = this.loopCreate(null as unknown as BMVert, null, l.f, l)
                lNew.prev = l
                lNew.next = l.next
                lNew.prev.next = lNew
                lNew.next.prev = lNew
                lNew.v = vNew
                if (vertsInEdge(lNew.v, lNew.next.v, e)) {
                    lNew.e = e
                    l.e = eNew
                } else if (vertsInEdge(lNew.v, lNew.next.v, eNew)) {
                    lNew.e = eNew
                    l.e = e
                } else throw new Error('bmesh_kernel_split_edge_make_vert: loop does not use either edge')
                if (isFirst) {
                    isFirst = false
                    l.radialNext = l.radialPrev = null
                }
                radialLoopAppend(lNew.e, lNew)
                radialLoopAppend(l.e, l)
            }
        }
        return [vNew, eNew]
    }

    /**
     * `BM_edge_split` (`bmesh_mods.cc`) without multires: the position is `v + (v_other - v) * fac` in float, loop custom
     * data by `BM_data_interp_face_vert_edge`. The vertex custom data (`BM_data_interp_from_verts`) is interpolated too.
     */
    edgeSplit(e: BMEdge, v: BMVert, fac: number): [BMVert, BMEdge] {
        const vOther = edgeOtherVert(e, v)
        const [vNew, eNew] = this.splitEdgeMakeVert(v, e)
        for (let k = 0; k < 3; k++) vNew.co[k] = f32(v.co[k] + f32(f32(vOther.co[k] - v.co[k]) * fac))
        interpFaceVertEdge(vOther, vNew, e, fac)
        // `BM_data_interp_from_verts` (`bmesh_interp.cc:38`): weights `1 - fac`, `fac` on the shape key (`layerInterp_shapekey`).
        if (fac <= 0) vNew.shape.set(v.shape)
        else if (fac >= 1) vNew.shape.set(vOther.shape)
        else {
            const w0 = f32(1 - fac)
            for (let k = 0; k < 3; k++) vNew.shape[k] = f32(f32(0 + f32(v.shape[k] * w0)) + f32(vOther.shape[k] * fac))
        }
        return [vNew, eNew]
    }

    /** `BM_face_split` (`bmesh_mods.cc`) / `bmesh_kernel_split_face_make_edge` (`bmesh_core.cc`); returns `[f_new, l_new]`. */
    faceSplit(f: BMFace, lV1: BMLoop, lV2: BMLoop): [BMFace, BMLoop] {
        if (loopIsAdjacent(lV1, lV2) || f !== lV1.f || f !== lV2.f) throw new Error('BM_face_split: adjacent loops or wrong face')
        const v1 = lV1.v, v2 = lV2.v
        const e = this.edgeCreate(v1, v2)
        // `bm_face_create__sfme`.
        const f2 = this.faceCreateInternal()
        const lF1 = this.loopCreate(v2, e, f, lV2)
        const lF2 = this.loopCreate(v1, e, f2, lV1)
        lF1.prev = lV2.prev
        lF2.prev = lV1.prev
        lV2.prev.next = lF1
        lV1.prev.next = lF2
        lF1.next = lV1
        lF2.next = lV2
        lV1.prev = lF1
        lV2.prev = lF2

        let firstLoopF1 = false
        let it = lF1
        do {
            if (it === f.lFirst) firstLoopF1 = true
        } while ((it = it.next) !== lF1)
        if (firstLoopF1) {
            if (f.lFirst.prev === lF1) f2.lFirst = lF2.prev
            else if (f.lFirst.next === lF1) f2.lFirst = lF2.next
            else f2.lFirst = lF2
        } else {
            f2.lFirst = f.lFirst
            if (f.lFirst.prev === lF2) f.lFirst = lF1.prev
            else if (f.lFirst.next === lF2) f.lFirst = lF1.next
            else f.lFirst = lF1
        }
        let f2len = 0
        it = f2.lFirst
        do {
            it.f = f2
            f2len++
        } while ((it = it.next) !== f2.lFirst)
        // The new loops already point at `e`; `bmesh_radial_loop_append` requires that.
        radialLoopAppend(e, lF1)
        radialLoopAppend(e, lF2)
        f2.len = f2len
        let f1len = 0
        it = f.lFirst
        do {
            f1len++
        } while ((it = it.next) !== f.lFirst)
        f.len = f1len
        return [f2, lF2]
    }
}

/** `BM_data_interp_face_vert_edge` (`bmesh_interp.cc`) for the float2 loop layer (`layerInterp_propfloat2`). */
function interpFaceVertEdge(vSrc1: BMVert, v: BMVert, e: BMEdge, fac: number): void {
    if (!e.l) return
    const w1 = f32(1 - fac), w0 = fac
    let it = e.l
    do {
        let lV1: BMLoop | null = null, lV: BMLoop | null = null, lV2: BMLoop | null = null
        if (it.v === vSrc1) {
            lV1 = it
            lV = lV1.next
            lV2 = lV.next
        } else if (it.v === v) {
            lV1 = it.next
            lV = it
            lV2 = it.prev
        }
        if (!lV1 || !lV2) return
        for (let k = 0; k < 2; k++) lV!.uv[k] = f32(f32(0 + f32(lV1.uv[k] * w0)) + f32(lV2.uv[k] * w1))
    } while ((it = it.radialNext!) !== e.l)
}

/** `BM_vert_pair_share_face_by_len` (`bmesh_query.cc`) with the `BM_LOOPS_OF_VERT` iterator (`bmesh_iterators.cc`). */
export function vertPairShareFaceByLen(vA: BMVert, vB: BMVert, allowAdjacent: boolean): [BMFace, BMLoop, BMLoop] | null {
    let fCur: BMFace | null = null, lCurA: BMLoop | null = null, lCurB: BMLoop | null = null
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
    return fCur ? [fCur, lCurA!, lCurB!] : null
}

/** `BM_face_vert_share_loop`. */
function faceVertShareLoop(f: BMFace, v: BMVert): BMLoop | null {
    let it = f.lFirst
    do {
        if (it.v === v) return it
    } while ((it = it.next) !== f.lFirst)
    return null
}

/** `bmiter__loop_of_vert_begin` / `_step`. */
function loopsOfVert(v: BMVert): BMLoop[] {
    const out: BMLoop[] = []
    // `bmesh_disk_facevert_count`.
    let count = 0
    if (v.e) {
        let e = v.e
        do {
            if (e.l) {
                let l = e.l
                do {
                    if (l.v === v) count++
                } while ((l = l.radialNext!) !== e.l)
            }
        } while ((e = diskEdgeNext(e, v)) !== v.e)
    }
    if (!count) return out
    // `bmesh_disk_faceloop_find_first`.
    let lFirst: BMLoop | null = null
    {
        let e = v.e!
        do {
            if (e.l !== null) {
                lFirst = e.l.v === v ? e.l : e.l.next
                break
            }
        } while ((e = diskEdgeNext(e, v)) !== v.e)
    }
    let eNext = lFirst!.e!
    let lNext: BMLoop | null = lFirst
    while (count) {
        const lCurr = lNext!
        count--
        lNext = radialFaceloopFindNext(lNext!, v)
        if (lNext === lFirst) {
            eNext = diskFaceedgeFindNext(eNext, v)
            lFirst = radialFaceloopFindFirst(eNext.l!, v)
            lNext = lFirst
        }
        out.push(lCurr)
    }
    return out
}

function radialFaceloopFindFirst(l: BMLoop, v: BMVert): BMLoop | null {
    let it = l
    do {
        if (it.v === v) return it
    } while ((it = it.radialNext!) !== l)
    return null
}

function radialFaceloopFindNext(l: BMLoop, v: BMVert): BMLoop {
    let it = l.radialNext!
    do {
        if (it.v === v) return it
    } while ((it = it.radialNext!) !== l)
    return l
}

function diskFaceedgeFindNext(e: BMEdge, v: BMVert): BMEdge {
    let eFind = diskEdgeNext(e, v)
    do {
        if (eFind.l && radialFaceloopFindFirst(eFind.l, v)) return eFind
    } while ((eFind = diskEdgeNext(eFind, v)) !== e)
    return e
}

/** Loops of a face from `l_first` (`BM_LOOPS_OF_FACE`). */
export function loopsOfFace(f: BMFace): BMLoop[] {
    const out: BMLoop[] = []
    let it = f.lFirst
    do {
        out.push(it)
    } while ((it = it.next) !== f.lFirst)
    return out
}

/**
 * BMesh element types - the linked-topology working copy that operators mutate.
 *
 * Ported from `source/blender/bmesh/bmesh_class.hh`. The field names follow Blender closely so that
 * operator ports read against the original, with two deliberate differences:
 *
 * 1. Blender's `BMDiskLink v1_disk_link, v2_disk_link` pair of structs becomes four fields on
 *    {@link BMEdge} plus the accessors {@link BMEdge.diskNext} / {@link BMEdge.diskPrev}. A JS object
 *    cannot hand out a mutable reference to a field pair, and allocating a link object per edge side
 *    would double the allocation count for no benefit. The algorithms are unchanged.
 * 2. Element ids are integers assigned by the mesh, not pointers. `head.index` is kept separately as
 *    Blender's lazily-validated index.
 *
 * Three circular doubly-linked cycles carry all adjacency:
 * - **disk cycle** - the edges around a vertex. Each edge is in two of them, one per endpoint.
 * - **radial cycle** - the loops (so the faces) around an edge. Its length is the edge's face count,
 *   which is how manifoldness is decided: 1 is a boundary, 2 is manifold, more is non-manifold.
 * - **loop cycle** - the corners around a face, in winding order.
 */

import {ElemFlag, ElemType} from '../constants'

/** Fields every element carries, mirroring Blender's `BMHeader`. */
export abstract class BMElem {
    /** Stable within one BMesh instance. Reused after an element is killed only by a fresh build. */
    readonly id: number
    /**
     * Header flags: select, hidden, seam, smooth, tag. See {@link ElemFlag}.
     * `Tag` and `InternalTag` are scratch bits for algorithms and must never be persisted.
     */
    hflag = 0
    /**
     * Blender's `head.index`. Only meaningful when the mesh's matching dirty bit is clear; use
     * `BMesh.elemIndexEnsure()` before relying on it.
     */
    index = -1
    /** Per-element attribute values, keyed by layer name. Sparse: absent means "layer default". */
    data: Map<string, number | number[]> | null = null

    protected constructor(id: number) {
        this.id = id
    }

    abstract get htype(): number

    get selected(): boolean {
        return (this.hflag & ElemFlag.Select) !== 0
    }

    get hidden(): boolean {
        return (this.hflag & ElemFlag.Hidden) !== 0
    }

    setFlag(flag: number, on: boolean): void {
        if (on) this.hflag |= flag
        else this.hflag &= ~flag
    }

    testFlag(flag: number): boolean {
        return (this.hflag & flag) !== 0
    }
}

export class BMVert extends BMElem {
    x = 0
    y = 0
    z = 0
    /** Vertex normal. Valid after a normals update. */
    nx = 0
    ny = 0
    nz = 0
    /**
     * Any one edge using this vertex, the entry point to its disk cycle. Null for a loose vertex.
     * Blender notes that higher-level code sometimes repoints this deliberately.
     */
    e: BMEdge | null = null

    constructor(id: number, x = 0, y = 0, z = 0) {
        super(id)
        this.x = x
        this.y = y
        this.z = z
    }

    get htype(): number {
        return ElemType.Vert
    }

    setCo(x: number, y: number, z: number): this {
        this.x = x
        this.y = y
        this.z = z
        return this
    }
}

export class BMEdge extends BMElem {
    /**
     * The two endpoints, unordered. Operations that create or subdivide edges should not flip the
     * order without a reason, because some callers rely on it (extruding from a wire edge).
     */
    v1: BMVert
    v2: BMVert
    /** Any one loop in this edge's radial cycle. Null for a wire edge. */
    l: BMLoop | null = null

    /** Disk cycle links for {@link v1}. Blender's `v1_disk_link`. */
    v1DiskNext: BMEdge | null = null
    v1DiskPrev: BMEdge | null = null
    /** Disk cycle links for {@link v2}. Blender's `v2_disk_link`. */
    v2DiskNext: BMEdge | null = null
    v2DiskPrev: BMEdge | null = null

    constructor(id: number, v1: BMVert, v2: BMVert) {
        super(id)
        this.v1 = v1
        this.v2 = v2
    }

    get htype(): number {
        return ElemType.Edge
    }

    /** True when this edge joins `v1` and `v2`, in either order. Blender's `BM_verts_in_edge`. */
    joins(a: BMVert, b: BMVert): boolean {
        return (this.v1 === a && this.v2 === b) || (this.v1 === b && this.v2 === a)
    }

    /** True when `v` is one of this edge's endpoints. */
    uses(v: BMVert): boolean {
        return this.v1 === v || this.v2 === v
    }

    /** The endpoint that is not `v`. Throws when `v` is not on this edge. */
    otherVert(v: BMVert): BMVert {
        if (this.v1 === v) return this.v2
        if (this.v2 === v) return this.v1
        throw new Error(`mesh-kernel: edge ${this.id} does not use vertex ${v.id}`)
    }

    /** Next edge around `v` in the disk cycle. Blender's `bmesh_disk_edge_next`. */
    diskNext(v: BMVert): BMEdge | null {
        if (this.v1 === v) return this.v1DiskNext
        if (this.v2 === v) return this.v2DiskNext
        throw new Error(`mesh-kernel: edge ${this.id} does not use vertex ${v.id}`)
    }

    /** Previous edge around `v` in the disk cycle. Blender's `bmesh_disk_edge_prev`. */
    diskPrev(v: BMVert): BMEdge | null {
        if (this.v1 === v) return this.v1DiskPrev
        if (this.v2 === v) return this.v2DiskPrev
        throw new Error(`mesh-kernel: edge ${this.id} does not use vertex ${v.id}`)
    }

    setDiskNext(v: BMVert, e: BMEdge | null): void {
        if (this.v1 === v) this.v1DiskNext = e
        else if (this.v2 === v) this.v2DiskNext = e
        else throw new Error(`mesh-kernel: edge ${this.id} does not use vertex ${v.id}`)
    }

    setDiskPrev(v: BMVert, e: BMEdge | null): void {
        if (this.v1 === v) this.v1DiskPrev = e
        else if (this.v2 === v) this.v2DiskPrev = e
        else throw new Error(`mesh-kernel: edge ${this.id} does not use vertex ${v.id}`)
    }
}

/**
 * One face-vertex incidence: Blender's loop, and the corner domain of {@link MeshData}.
 *
 * Per-corner data (UVs, split normals, colours) lives here, which is what lets a UV seam exist without
 * splitting the vertex. Loops are the only element with no operator-flag layer in Blender.
 */
export class BMLoop extends BMElem {
    /** The vertex this loop points at. Unique within its face's loop cycle. */
    v: BMVert
    /** The edge from {@link v} to `next.v`. */
    e: BMEdge | null
    /** The face this loop belongs to. */
    f: BMFace

    /** Radial cycle: the other loops using {@link e}. */
    radialNext: BMLoop | null = null
    radialPrev: BMLoop | null = null

    /** Loop cycle: the face boundary, in winding order. */
    next: BMLoop = null as unknown as BMLoop
    prev: BMLoop = null as unknown as BMLoop

    constructor(id: number, v: BMVert, e: BMEdge | null, f: BMFace) {
        super(id)
        this.v = v
        this.e = e
        this.f = f
    }

    get htype(): number {
        return ElemType.Loop
    }
}

export class BMFace extends BMElem {
    /** Any one loop of the face; the entry point to its loop cycle. */
    lFirst: BMLoop = null as unknown as BMLoop
    /** Number of loops, kept in step with the cycle. */
    len = 0
    /** Face normal. Valid after a normals update. */
    nx = 0
    ny = 0
    nz = 0
    /** Index into the mesh's material slot list. */
    matNr = 0

    constructor(id: number) {
        super(id)
    }

    get htype(): number {
        return ElemType.Face
    }

    /** Loops in winding order. Allocates; prefer {@link eachLoop} in hot paths. */
    loops(): BMLoop[] {
        const out: BMLoop[] = []
        if (!this.lFirst) return out
        let l = this.lFirst
        do {
            out.push(l)
            l = l.next
        } while (l !== this.lFirst)
        return out
    }

    /** Iterate loops in winding order without allocating an array. */
    * eachLoop(): Generator<BMLoop> {
        if (!this.lFirst) return
        let l = this.lFirst
        do {
            yield l
            l = l.next
        } while (l !== this.lFirst)
    }

    verts(): BMVert[] {
        return this.loops().map(l => l.v)
    }

    edges(): BMEdge[] {
        return this.loops().map(l => l.e!).filter(Boolean)
    }
}

export type BMElemAny = BMVert | BMEdge | BMLoop | BMFace

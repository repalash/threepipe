/**
 * The BMesh container and its element create/kill operations.
 *
 * Ported from `source/blender/bmesh/intern/bmesh_core.cc` (`BM_vert_create`, `BM_edge_create`,
 * `BM_face_create`, `BM_vert_kill`, `BM_edge_kill`, `BM_face_kill`) and `bmesh_mesh.cc`
 * (`BM_mesh_elem_index_ensure`, `BM_mesh_elem_table_ensure`).
 *
 * Creation and deletion are local and O(1); nothing renumbers. That is the whole reason this
 * representation exists alongside {@link MeshData}.
 */

import {BMEdge, BMElemAny, BMFace, BMLoop, BMVert} from './types'
import {
    diskEdgeAppend,
    diskEdgeExists,
    diskEdgeRemove,
    diskEdges,
    radialLoopAppend,
    radialLoopRemove,
    radialLoops,
    validateDisk,
    validateRadial,
} from './structure'
import {AttrType, ElemFlag, ElemType, SelectMode, SelectModeMask} from '../constants'
import {BMCustomDataLayout, copyElemAttrs} from './customdata'

/** Options for {@link BMesh.edgeCreate}. */
export interface EdgeCreateOptions {
    /** Return the existing edge between the two vertices instead of creating a duplicate. */
    noDouble?: boolean
}

/** One entry of the ordered selection history. Blender's `BMEditSelection`. */
export interface BMSelectHistoryEntry {
    elem: BMVert | BMEdge | BMFace
}

/**
 * A mesh in linked-topology form.
 *
 * Build one with {@link vertCreate}, {@link edgeCreate} and {@link faceCreate}, or convert from a
 * {@link MeshData}. Operators work here; conversion back produces the canonical arrays again.
 */
export class BMesh {
    readonly verts = new Set<BMVert>()
    readonly edges = new Set<BMEdge>()
    readonly faces = new Set<BMFace>()

    /** Loops are owned by their faces, but tracked so validation and counts can see them all. */
    readonly loops = new Set<BMLoop>()

    /**
     * Attribute layer layouts, one per domain. Blender's `bm->vdata/edata/ldata/pdata`.
     * `ldata` is the corner domain, where UVs and split normals live.
     */
    readonly vdata = new BMCustomDataLayout()
    readonly edata = new BMCustomDataLayout()
    readonly ldata = new BMCustomDataLayout()
    readonly pdata = new BMCustomDataLayout()

    /** Names of material slots, carried through from MeshData. */
    materials: string[] = []

    /** Bitmask of {@link SelectMode}. */
    selectMode: SelectModeMask = SelectMode.Vertex

    /** Ordered selection history; the last entry is the active element. */
    selectHistory: BMSelectHistoryEntry[] = []

    /** Active face, which drives active UV and material in Blender. */
    actFace: BMFace | null = null

    /**
     * Selection counters, kept in step by the functions in `marking.ts`. Blender maintains these
     * incrementally because recounting a multi-million-element mesh per frame is not viable.
     * `selectCountsRecalc` rebuilds them after bulk flag edits.
     */
    totvertsel = 0
    totedgesel = 0
    totfacesel = 0

    private _nextId = 0
    private _vertTable: BMVert[] | null = null
    private _edgeTable: BMEdge[] | null = null
    private _faceTable: BMFace[] | null = null

    get totvert(): number {
        return this.verts.size
    }

    get totedge(): number {
        return this.edges.size
    }

    get totface(): number {
        return this.faces.size
    }

    get totloop(): number {
        return this.loops.size
    }

    /** The layer layout for a domain, by the same names Blender uses. */
    layoutFor(domain: 'vert' | 'edge' | 'loop' | 'face'): BMCustomDataLayout {
        switch (domain) {
        case 'vert': return this.vdata
        case 'edge': return this.edata
        case 'loop': return this.ldata
        case 'face': return this.pdata
        }
    }

    /** Declare an attribute layer on a domain. Idempotent when the type matches. */
    addLayer(domain: 'vert' | 'edge' | 'loop' | 'face', name: string, type: AttrType) {
        return this.layoutFor(domain).add(name, type)
    }

    private _id(): number {
        return this._nextId++
    }

    /**
     * Allocate an element id. Public so the Euler operators, which build loops and faces directly
     * rather than through the create helpers, can stay consistent with the mesh's numbering.
     */
    nextId(): number {
        return this._id()
    }

    private _invalidateTables(): void {
        this._vertTable = null
        this._edgeTable = null
        this._faceTable = null
    }

    // region create

    /** Port of `BM_vert_create`. */
    vertCreate(x = 0, y = 0, z = 0, example?: BMVert): BMVert {
        const v = new BMVert(this._id(), x, y, z)
        if (example) {
            v.hflag = example.hflag & ~(ElemFlag.Tag | ElemFlag.InternalTag)
            copyElemAttrs(example, v, this.vdata)
        }
        this.verts.add(v)
        this._invalidateTables()
        return v
    }

    /**
     * Port of `BM_edge_create`. With `noDouble`, returns the existing edge if one already joins the
     * two vertices, which is what `BM_CREATE_NO_DOUBLE` does.
     */
    edgeCreate(v1: BMVert, v2: BMVert, example?: BMEdge, options: EdgeCreateOptions = {}): BMEdge {
        if (v1 === v2) throw new Error(`mesh-kernel: cannot create a degenerate edge on vertex ${v1.id}`)
        if (options.noDouble) {
            const existing = diskEdgeExists(v1, v2)
            if (existing) return existing
        }
        const e = new BMEdge(this._id(), v1, v2)
        if (example) {
            e.hflag = example.hflag & ~(ElemFlag.Tag | ElemFlag.InternalTag)
            copyElemAttrs(example, e, this.edata)
        } else {
            // Blender defaults new edges to smooth; sharpness is the opt-in.
            e.hflag |= ElemFlag.Smooth
        }
        this.edges.add(e)
        diskEdgeAppend(e, v1)
        diskEdgeAppend(e, v2)
        this._invalidateTables()
        return e
    }

    /**
     * Create a face from an ordered vertex loop, creating any missing edges.
     *
     * Port of `BM_face_create_verts` composed with `BM_face_create` (`bmesh_core.cc:527`). The winding
     * of `verts` defines the face normal.
     */
    faceCreate(verts: BMVert[], example?: BMFace): BMFace {
        const len = verts.length
        if (len < 3) throw new Error(`mesh-kernel: a face needs at least 3 vertices, got ${len}`)
        for (let i = 0; i < len; i++) {
            for (let j = i + 1; j < len; j++) {
                if (verts[i] === verts[j]) {
                    throw new Error(`mesh-kernel: vertex ${verts[i].id} appears twice in one face`)
                }
            }
        }

        const edges: BMEdge[] = new Array(len)
        for (let i = 0; i < len; i++) {
            edges[i] = this.edgeCreate(verts[i], verts[(i + 1) % len], undefined, {noDouble: true})
        }
        return this.faceCreateWithEdges(verts, edges, example)
    }

    /**
     * Create a face from matched vertex and edge arrays, where `edges[i]` joins `verts[i]` and
     * `verts[i + 1]`. Port of `BM_face_create`.
     */
    faceCreateWithEdges(verts: BMVert[], edges: BMEdge[], example?: BMFace): BMFace {
        const len = verts.length
        if (len < 3) throw new Error(`mesh-kernel: a face needs at least 3 vertices, got ${len}`)
        if (edges.length !== len) {
            throw new Error(`mesh-kernel: face has ${len} vertices but ${edges.length} edges`)
        }
        for (let i = 0; i < len; i++) {
            if (!edges[i].joins(verts[i], verts[(i + 1) % len])) {
                throw new Error(
                    `mesh-kernel: edge ${edges[i].id} does not join vertices ${verts[i].id} and ${verts[(i + 1) % len].id}`)
            }
        }

        const f = new BMFace(this._id())
        if (example) {
            f.hflag = example.hflag & ~(ElemFlag.Tag | ElemFlag.InternalTag)
            f.matNr = example.matNr
            copyElemAttrs(example, f, this.pdata)
        }
        // No `SMOOTH` default: `bm_face_create__internal` sets `f->head.hflag = 0`
        // (`bmesh_core.cc:493`), so a new face is flat unless something says otherwise. Edges are the
        // other way round - `e->head.hflag = BM_ELEM_SMOOTH` at `:250`, which `edgeCreate` matches.
        // This is why a generated cube renders faceted rather than looking inflated.

        let lastl: BMLoop | null = null
        let startl: BMLoop | null = null
        for (let i = 0; i < len; i++) {
            const l = new BMLoop(this._id(), verts[i], null, f)
            this.loops.add(l)
            radialLoopAppend(edges[i], l)
            if (i === 0) {
                startl = l
                f.lFirst = l
            } else {
                l.prev = lastl!
                lastl!.next = l
            }
            lastl = l
        }
        startl!.prev = lastl!
        lastl!.next = startl!

        f.len = len
        this.faces.add(f)
        this._invalidateTables()
        return f
    }

    // endregion

    // region kill

    /** Port of `BM_face_kill`. Removes the face and its loops; edges and vertices are untouched. */
    faceKill(f: BMFace): void {
        if (!this.faces.has(f)) return
        if (f.lFirst) {
            for (const l of f.loops()) {
                if (l.e) radialLoopRemove(l.e, l)
                this.loops.delete(l)
            }
        }
        if (this.actFace === f) this.actFace = null
        this.faces.delete(f)
        this._removeFromHistory(f)
        this._invalidateTables()
    }

    /** Port of `BM_edge_kill`. Kills every face using the edge first. */
    edgeKill(e: BMEdge): void {
        if (!this.edges.has(e)) return
        for (const l of [...radialLoops(e)]) this.faceKill(l.f)
        diskEdgeRemove(e, e.v1)
        diskEdgeRemove(e, e.v2)
        this.edges.delete(e)
        this._removeFromHistory(e)
        this._invalidateTables()
    }

    /** Port of `BM_vert_kill`. Kills every edge (and so every face) using the vertex. */
    vertKill(v: BMVert): void {
        if (!this.verts.has(v)) return
        for (const e of [...diskEdges(v)]) this.edgeKill(e)
        this.verts.delete(v)
        this._removeFromHistory(v)
        this._invalidateTables()
    }

    private _removeFromHistory(elem: BMElemAny): void {
        if (elem instanceof BMLoop) return
        const i = this.selectHistory.findIndex(h => h.elem === elem)
        if (i >= 0) this.selectHistory.splice(i, 1)
    }

    // endregion

    // region lookup tables

    /**
     * Assign `index` to every element of the requested types, in iteration order.
     * Port of `BM_mesh_elem_index_ensure`. Call before relying on `elem.index`.
     */
    elemIndexEnsure(mask = ElemType.Vert | ElemType.Edge | ElemType.Face | ElemType.Loop): void {
        if (mask & ElemType.Vert) {
            let i = 0
            for (const v of this.verts) v.index = i++
        }
        if (mask & ElemType.Edge) {
            let i = 0
            for (const e of this.edges) e.index = i++
        }
        if (mask & ElemType.Face) {
            let i = 0
            for (const f of this.faces) f.index = i++
        }
        if (mask & ElemType.Loop) {
            let i = 0
            for (const f of this.faces) for (const l of f.eachLoop()) l.index = i++
        }
    }

    /** Random access by index. Port of `BM_vert_at_index` and friends, rebuilding lazily. */
    vertAt(i: number): BMVert {
        if (!this._vertTable) this._vertTable = [...this.verts]
        return this._vertTable[i]
    }

    edgeAt(i: number): BMEdge {
        if (!this._edgeTable) this._edgeTable = [...this.edges]
        return this._edgeTable[i]
    }

    faceAt(i: number): BMFace {
        if (!this._faceTable) this._faceTable = [...this.faces]
        return this._faceTable[i]
    }

    // endregion

    /**
     * Check every cycle invariant. Port in spirit of `BM_mesh_validate`.
     * Returns human-readable problems; empty means consistent. For tests and debug builds.
     */
    validate(): string[] {
        const problems: string[] = []

        for (const v of this.verts) {
            problems.push(...validateDisk(v))
            if (v.e && !this.edges.has(v.e)) {
                problems.push(`vertex ${v.id} points at edge ${v.e.id}, which is not in the mesh`)
            }
        }

        for (const e of this.edges) {
            if (!this.verts.has(e.v1) || !this.verts.has(e.v2)) {
                problems.push(`edge ${e.id} uses a vertex that is not in the mesh`)
                continue
            }
            if (e.v1 === e.v2) problems.push(`edge ${e.id} is degenerate`)
            problems.push(...validateRadial(e))
        }

        for (const f of this.faces) {
            if (!f.lFirst) {
                problems.push(`face ${f.id} has no loops`)
                continue
            }
            let count = 0
            let l = f.lFirst
            do {
                if (l.f !== f) problems.push(`loop ${l.id} in face ${f.id} points at face ${l.f.id}`)
                if (!l.e) problems.push(`loop ${l.id} in face ${f.id} has no edge`)
                else if (!l.e.joins(l.v, l.next.v)) {
                    problems.push(`loop ${l.id} spans (${l.v.id}, ${l.next.v.id}) but its edge ${l.e.id} does not`)
                }
                if (l.next.prev !== l) problems.push(`face ${f.id} loop cycle is not doubly linked at loop ${l.id}`)
                if (!this.loops.has(l)) problems.push(`loop ${l.id} of face ${f.id} is not tracked by the mesh`)
                l = l.next
                if (++count > 1e6) {
                    problems.push(`face ${f.id} loop cycle does not terminate`)
                    break
                }
            } while (l !== f.lFirst)
            if (count !== f.len) problems.push(`face ${f.id} says len ${f.len} but its cycle has ${count} loops`)
        }

        for (const h of this.selectHistory) {
            const set = h.elem instanceof BMVert ? this.verts
                : h.elem instanceof BMEdge ? this.edges : this.faces
            if (!(set as Set<BMElemAny>).has(h.elem)) {
                problems.push(`selection history references element ${h.elem.id}, which is not in the mesh`)
            }
        }

        return problems
    }

    assertValid(): void {
        const problems = this.validate()
        if (problems.length) {
            throw new Error(`mesh-kernel: invalid BMesh:\n  ${problems.slice(0, 16).join('\n  ')}` +
                (problems.length > 16 ? `\n  ...and ${problems.length - 16} more` : ''))
        }
    }

    /** Compact summary for humans and agents. */
    describe(): string {
        return `verts ${this.totvert}, edges ${this.totedge}, faces ${this.totface}, loops ${this.totloop}`
    }
}

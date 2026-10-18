/**
 * `MeshData` - the canonical, serialisable, struct-of-arrays mesh.
 *
 * This is a direct image of Blender's `Mesh` (`makesdna/DNA_mesh_types.h`): four element counts, one
 * face-offsets array, and every other piece of information as a named attribute on one of the four
 * domains. It is what the blend importer produces, what undo snapshots, what serialises to glTF, and
 * what the render bake reads.
 *
 * It is deliberately *not* what operators mutate. Insertions and deletions renumber everything after
 * them, and adjacency is not stored, so interactive operators build a `BMesh` from this, work there,
 * and write back. That is the same split Blender uses.
 */

import {
    AttrDomain,
    AttrName,
    AttrType,
    ATTR_TYPE_INFO,
    REQUIRED_ATTRS,
    SelectMode,
    SelectModeMask,
} from './constants'
import {AttributeStorage} from './attributes'

/** One entry of the ordered selection history. Mirrors Blender's `MSelect`. */
export interface SelectHistoryEntry {
    type: 'vert' | 'edge' | 'face'
    index: number
}

export interface MeshDataSelectState {
    /** Ordered; the last entry is the active element. */
    history: SelectHistoryEntry[]
    /** Index of the active face, or -1. Drives active UV/material in Blender. */
    activeFace: number
    /** Bitmask of {@link SelectMode}. */
    mode: SelectModeMask
}

export interface MeshFromFacesInput {
    /** Flat xyz triples, length `3 * vertCount`. */
    positions: ArrayLike<number>
    /** One array of vertex indices per face, in winding order. Any length >= 3. */
    faces: ArrayLike<ArrayLike<number>>
    /** Optional per-face material slot index. */
    materialIndices?: ArrayLike<number>
}

const NO_EDGE = -1

/**
 * Struct-of-arrays polygon mesh with n-gon faces and per-domain attributes.
 *
 * Face `i` owns the corner range `[faceOffsets[i], faceOffsets[i + 1])`. Corner `c` uses vertex
 * `cornerVerts[c]`, and `cornerEdges[c]` is the edge running from that corner to the next corner of
 * the same face (wrapping at the end of the face).
 */
export class MeshData {
    readonly attributes: AttributeStorage

    /**
     * `facesNum + 1` entries. Always non-decreasing, starts at 0, ends at `cornersNum`.
     * An empty mesh still has one entry.
     */
    faceOffsets: Int32Array = new Int32Array(1)

    select: MeshDataSelectState = {history: [], activeFace: -1, mode: SelectMode.Vertex}

    /** Names of the material slots, in index order. `material_index` refers into this. */
    materials: string[] = []

    constructor() {
        this.attributes = new AttributeStorage()
        for (const {name, domain, type} of REQUIRED_ATTRS) this.attributes.add({name, domain, type})
    }

    get vertsNum(): number {
        return this.attributes.domainSizes[AttrDomain.Point]
    }

    get edgesNum(): number {
        return this.attributes.domainSizes[AttrDomain.Edge]
    }

    get facesNum(): number {
        return this.attributes.domainSizes[AttrDomain.Face]
    }

    get cornersNum(): number {
        return this.attributes.domainSizes[AttrDomain.Corner]
    }

    get isEmpty(): boolean {
        return this.vertsNum === 0 && this.facesNum === 0 && this.edgesNum === 0
    }

    // region required attribute accessors

    /** Flat xyz triples. */
    get positions(): Float32Array {
        return this.attributes.require(AttrName.position, AttrDomain.Point, 'float3').data as Float32Array
    }

    /** Flat vertex-index pairs, one per edge. Order within a pair is not meaningful. */
    get edgeVerts(): Int32Array {
        return this.attributes.require(AttrName.edgeVerts, AttrDomain.Edge, 'int32x2').data as Int32Array
    }

    /** Vertex index per corner. */
    get cornerVerts(): Int32Array {
        return this.attributes.require(AttrName.cornerVert, AttrDomain.Corner, 'int32').data as Int32Array
    }

    /** Edge index per corner: the edge from this corner to the next corner of the same face. */
    get cornerEdges(): Int32Array {
        return this.attributes.require(AttrName.cornerEdge, AttrDomain.Corner, 'int32').data as Int32Array
    }

    // endregion

    // region sizing

    /**
     * Set the number of elements on a domain, preserving existing data.
     * Growing the face domain also grows {@link faceOffsets}; the caller must then fill in the offsets.
     */
    resizeDomain(domain: AttrDomain, count: number): void {
        this.attributes.resizeDomain(domain, count)
        if (domain === AttrDomain.Face) {
            const next = new Int32Array(count + 1)
            const copy = Math.min(this.faceOffsets.length, next.length)
            next.set(this.faceOffsets.subarray(0, copy))
            // Keep the terminator meaningful when the mesh shrank.
            if (next.length > 0 && copy < next.length) next.fill(next[copy - 1] ?? 0, copy)
            this.faceOffsets = next
        }
    }

    resize(counts: {verts?: number, edges?: number, faces?: number, corners?: number}): void {
        if (counts.verts !== undefined) this.resizeDomain(AttrDomain.Point, counts.verts)
        if (counts.edges !== undefined) this.resizeDomain(AttrDomain.Edge, counts.edges)
        if (counts.faces !== undefined) this.resizeDomain(AttrDomain.Face, counts.faces)
        if (counts.corners !== undefined) this.resizeDomain(AttrDomain.Corner, counts.corners)
    }

    // endregion

    // region face/corner access

    /** First corner index of face `i`. */
    faceStart(i: number): number {
        return this.faceOffsets[i]
    }

    /** Number of corners (and so vertices, and edges) of face `i`. */
    faceSize(i: number): number {
        return this.faceOffsets[i + 1] - this.faceOffsets[i]
    }

    /** Corner indices of face `i` as a view. Do not retain across a topology change. */
    faceCorners(i: number): Int32Array {
        const start = this.faceOffsets[i]
        const end = this.faceOffsets[i + 1]
        return this.cornerVerts.subarray(start, end)
    }

    /** Copy of the vertex indices of face `i`. */
    faceVerts(i: number): number[] {
        const start = this.faceOffsets[i]
        const end = this.faceOffsets[i + 1]
        const cv = this.cornerVerts
        const out: number[] = new Array(end - start)
        for (let c = start; c < end; c++) out[c - start] = cv[c]
        return out
    }

    /** Iterate faces as `[faceIndex, startCorner, endCorner]` without allocating per face. */
    * eachFace(): Generator<[number, number, number]> {
        const n = this.facesNum
        for (let i = 0; i < n; i++) yield [i, this.faceOffsets[i], this.faceOffsets[i + 1]]
    }

    // endregion

    // region construction

    /**
     * Build a mesh from positions and n-gon face index lists. Edges and `.corner_edge` are derived.
     *
     * This is the convenience path for tests, primitives and importers that only know faces. Importers
     * that already have edge data (a `.blend` file does) should fill the attributes directly and call
     * {@link calculateCornerEdges} instead, so authored edge attributes survive.
     */
    static fromFaces(input: MeshFromFacesInput): MeshData {
        const mesh = new MeshData()
        const vertsNum = Math.floor(input.positions.length / 3)
        let cornersNum = 0
        for (let i = 0; i < input.faces.length; i++) cornersNum += input.faces[i].length

        mesh.resize({verts: vertsNum, faces: input.faces.length, corners: cornersNum})

        const positions = mesh.positions
        for (let i = 0; i < vertsNum * 3; i++) positions[i] = input.positions[i]

        const cornerVerts = mesh.cornerVerts
        const offsets = mesh.faceOffsets
        let corner = 0
        for (let f = 0; f < input.faces.length; f++) {
            offsets[f] = corner
            const face = input.faces[f]
            if (face.length < 3) throw new Error(`mesh-kernel: face ${f} has ${face.length} vertices, need at least 3`)
            for (let k = 0; k < face.length; k++) {
                const v = face[k]
                if (!Number.isInteger(v) || v < 0 || v >= vertsNum) {
                    throw new Error(`mesh-kernel: face ${f} references vertex ${v}, out of range 0..${vertsNum - 1}`)
                }
                cornerVerts[corner++] = v
            }
        }
        offsets[input.faces.length] = corner

        if (input.materialIndices) {
            const layer = mesh.attributes.ensure(AttrName.materialIndex, AttrDomain.Face, 'int32')
            const data = layer.data as Int32Array
            for (let f = 0; f < input.faces.length; f++) data[f] = input.materialIndices[f]
        }

        mesh.calculateEdges()
        return mesh
    }

    /**
     * Derive the edge domain from face corners, then fill `.corner_edge`.
     *
     * Replaces any existing edges, so edge-domain attributes are dropped: an edge set derived from
     * faces cannot be matched up with attributes belonging to a different edge set. Loose edges are
     * not preserved either. Equivalent in spirit to Blender's `mesh_calc_edges`.
     */
    calculateEdges(): void {
        const cornerVerts = this.cornerVerts
        const facesNum = this.facesNum
        const offsets = this.faceOffsets

        // Key on the ordered pair (min, max) so the two directions of an edge collapse to one.
        const seen = new Map<number, number>()
        const v1s: number[] = []
        const v2s: number[] = []
        const cornerEdgeOut: number[] = new Array(this.cornersNum).fill(NO_EDGE)
        const vertsNum = this.vertsNum

        for (let f = 0; f < facesNum; f++) {
            const start = offsets[f]
            const end = offsets[f + 1]
            const size = end - start
            for (let k = 0; k < size; k++) {
                const a = cornerVerts[start + k]
                const b = cornerVerts[start + (k + 1) % size]
                const lo = a < b ? a : b
                const hi = a < b ? b : a
                // Safe while vertsNum < 2^26 or so; validate() catches meshes past that.
                const key = lo * vertsNum + hi
                let e = seen.get(key)
                if (e === undefined) {
                    e = v1s.length
                    seen.set(key, e)
                    v1s.push(lo)
                    v2s.push(hi)
                }
                cornerEdgeOut[start + k] = e
            }
        }

        // Drop the old edge domain wholesale, then refill.
        const edgeLayers = this.attributes.layersOnDomain(AttrDomain.Edge)
        for (const layer of edgeLayers) if (layer.name !== AttrName.edgeVerts) this.attributes.remove(layer.name)
        this.resizeDomain(AttrDomain.Edge, v1s.length)

        const edgeVerts = this.edgeVerts
        for (let e = 0; e < v1s.length; e++) {
            edgeVerts[e * 2] = v1s[e]
            edgeVerts[e * 2 + 1] = v2s[e]
        }
        const cornerEdges = this.cornerEdges
        for (let c = 0; c < cornerEdgeOut.length; c++) cornerEdges[c] = cornerEdgeOut[c]
    }

    /**
     * Fill `.corner_edge` by looking up existing edges, without changing the edge domain.
     * Use after importing authored edges. Throws if a face uses a vertex pair that has no edge.
     */
    calculateCornerEdges(): void {
        const edgeVerts = this.edgeVerts
        const vertsNum = this.vertsNum
        const index = new Map<number, number>()
        for (let e = 0; e < this.edgesNum; e++) {
            const a = edgeVerts[e * 2]
            const b = edgeVerts[e * 2 + 1]
            const lo = a < b ? a : b
            const hi = a < b ? b : a
            index.set(lo * vertsNum + hi, e)
        }

        const cornerVerts = this.cornerVerts
        const cornerEdges = this.cornerEdges
        const offsets = this.faceOffsets
        for (let f = 0; f < this.facesNum; f++) {
            const start = offsets[f]
            const size = offsets[f + 1] - start
            for (let k = 0; k < size; k++) {
                const a = cornerVerts[start + k]
                const b = cornerVerts[start + (k + 1) % size]
                const lo = a < b ? a : b
                const hi = a < b ? b : a
                const e = index.get(lo * vertsNum + hi)
                if (e === undefined) throw new Error(`mesh-kernel: face ${f} uses edge (${a}, ${b}) which does not exist`)
                cornerEdges[start + k] = e
            }
        }
    }

    // endregion

    /** Deep copy. */
    clone(): MeshData {
        const out = Object.create(MeshData.prototype) as MeshData & {attributes: AttributeStorage}
        out.attributes = this.attributes.clone()
        out.faceOffsets = this.faceOffsets.slice()
        out.materials = [...this.materials]
        out.select = {
            history: this.select.history.map(h => ({...h})),
            activeFace: this.select.activeFace,
            mode: this.select.mode,
        }
        return out
    }

    /**
     * Structural checks. Returns human-readable problems; empty means the mesh is well formed.
     *
     * Ported in spirit from `BM_mesh_validate`: cheap invariants that catch a broken operator early
     * rather than three operations later. Call it in tests and behind a debug flag, not per frame.
     */
    validate(): string[] {
        const problems: string[] = this.attributes.validate()

        for (const {name, domain, type} of REQUIRED_ATTRS) {
            const layer = this.attributes.get(name)
            if (!layer) {
                problems.push(`missing required attribute '${name}'`)
            } else if (layer.domain !== domain || layer.type !== type) {
                problems.push(`required attribute '${name}' has wrong shape`)
            }
        }
        if (problems.length) return problems

        const {vertsNum, edgesNum, facesNum, cornersNum} = this

        if (this.faceOffsets.length !== facesNum + 1) {
            problems.push(`faceOffsets has ${this.faceOffsets.length} entries, expected ${facesNum + 1}`)
        } else {
            if (this.faceOffsets[0] !== 0) problems.push(`faceOffsets[0] is ${this.faceOffsets[0]}, expected 0`)
            if (this.faceOffsets[facesNum] !== cornersNum) {
                problems.push(`faceOffsets ends at ${this.faceOffsets[facesNum]}, expected cornersNum ${cornersNum}`)
            }
            for (let f = 0; f < facesNum; f++) {
                const size = this.faceOffsets[f + 1] - this.faceOffsets[f]
                if (size < 3) problems.push(`face ${f} has ${size} corners, expected at least 3`)
            }
        }

        const cornerVerts = this.cornerVerts
        for (let c = 0; c < cornersNum; c++) {
            const v = cornerVerts[c]
            if (v < 0 || v >= vertsNum) problems.push(`corner ${c} references vertex ${v}, out of range`)
        }

        const edgeVerts = this.edgeVerts
        for (let e = 0; e < edgesNum; e++) {
            const a = edgeVerts[e * 2]
            const b = edgeVerts[e * 2 + 1]
            if (a < 0 || a >= vertsNum || b < 0 || b >= vertsNum) {
                problems.push(`edge ${e} references vertices (${a}, ${b}), out of range`)
            } else if (a === b) {
                problems.push(`edge ${e} is degenerate (both ends are vertex ${a})`)
            }
        }

        // `.corner_edge` must name the edge between this corner's vertex and the next one in the face.
        const cornerEdges = this.cornerEdges
        for (let f = 0; f < facesNum && problems.length < 64; f++) {
            const start = this.faceOffsets[f]
            const size = this.faceOffsets[f + 1] - start
            for (let k = 0; k < size; k++) {
                const e = cornerEdges[start + k]
                if (e < 0 || e >= edgesNum) {
                    problems.push(`corner ${start + k} references edge ${e}, out of range`)
                    continue
                }
                const a = cornerVerts[start + k]
                const b = cornerVerts[start + (k + 1) % size]
                const ea = edgeVerts[e * 2]
                const eb = edgeVerts[e * 2 + 1]
                const matches = (ea === a && eb === b) || (ea === b && eb === a)
                if (!matches) {
                    problems.push(`corner ${start + k} of face ${f} says edge ${e} joins (${a}, ${b}) but it joins (${ea}, ${eb})`)
                }
            }
        }

        for (const entry of this.select.history) {
            const limit = entry.type === 'vert' ? vertsNum : entry.type === 'edge' ? edgesNum : facesNum
            if (entry.index < 0 || entry.index >= limit) {
                problems.push(`selection history references ${entry.type} ${entry.index}, out of range`)
            }
        }
        if (this.select.activeFace < -1 || this.select.activeFace >= facesNum) {
            problems.push(`activeFace is ${this.select.activeFace}, out of range`)
        }

        return problems
    }

    /** Throw if {@link validate} finds anything. Convenience for tests and debug builds. */
    assertValid(): void {
        const problems = this.validate()
        if (problems.length) {
            throw new Error(`mesh-kernel: invalid MeshData:\n  ${problems.slice(0, 16).join('\n  ')}` +
                (problems.length > 16 ? `\n  ...and ${problems.length - 16} more` : ''))
        }
    }

    /**
     * Compact, human- and agent-readable summary. Deliberately cheap: counts and flags only, no
     * geometry. The analogue of Blender's statistics overlay.
     */
    describe(): string {
        const attrs = this.attributes.layers()
            .filter(l => !l.name.startsWith('.'))
            .map(l => l.name)
        const parts = [
            `verts ${this.vertsNum}`,
            `edges ${this.edgesNum}`,
            `faces ${this.facesNum}`,
            `corners ${this.cornersNum}`,
        ]
        if (this.materials.length) parts.push(`materials ${this.materials.length}`)
        if (attrs.length) parts.push(`attributes [${attrs.join(', ')}]`)
        return parts.join(', ')
    }
}

/** Convenience for the common case of adding a typed attribute and getting its array straight back. */
export function ensureAttributeArray(
    mesh: MeshData, name: string, domain: AttrDomain, type: AttrType,
): {layer: ReturnType<AttributeStorage['ensure']>, components: number} {
    const layer = mesh.attributes.ensure(name, domain, type)
    return {layer, components: ATTR_TYPE_INFO[type].components}
}

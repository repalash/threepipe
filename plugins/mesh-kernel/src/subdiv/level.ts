/**
 * OpenSubdiv `Vtr::internal::Level`: one level of a refinement hierarchy - the six topological relations
 * (face-verts, face-edges, edge-verts, edge-faces, vert-faces, vert-edges, the last three with local indices),
 * sharpness and component tags. Ported from `opensubdiv/vtr/level.{h,cpp}`.
 *
 * Relations are stored as OpenSubdiv stores them: per component a count and an offset into one index array.
 */

import {Rule} from './sdc'
import type {FVarLevel} from './fvar'

/** `Level::VTag` bits (`level.h`). The rule is kept apart, in `vertRule`. */
export enum VTag {
    NonManifold = 1 << 0,
    Xordinary = 1 << 1,
    Boundary = 1 << 2,
    Corner = 1 << 3,
    InfSharp = 1 << 4,
    SemiSharp = 1 << 5,
    SemiSharpEdges = 1 << 6,
    Incomplete = 1 << 7,
    IncidIrregFace = 1 << 8,
    InfSharpEdges = 1 << 9,
    InfSharpCrease = 1 << 10,
    InfIrregular = 1 << 11,
}

/**
 * A vertex's tag bits with its rule above them (`VTag::_rule` is a bit field of `VTag` in OpenSubdiv), so tags of
 * several corners combine with a plain OR like `VTag::BitwiseOr` / `getFaceCompositeVTag`.
 */
export const RULE_SHIFT = 12
export const tagRule = (fullTag: number): number => fullTag >> RULE_SHIFT

/** `Level::VSpan` (`level.h:176`): the part of a vertex's ring that contributes to a patch. */
export class VSpan {
    numFaces = 0
    startFace = 0
    cornerInSpan = 0
    periodic = false
    sharp = false
    clear(): void { this.numFaces = 0; this.startFace = 0; this.cornerInSpan = 0; this.periodic = false; this.sharp = false }
    isAssigned(): boolean { return this.numFaces > 0 }
}

/** `Level::ETag` bits (`level.h`). */
export enum ETag {
    NonManifold = 1 << 0,
    Boundary = 1 << 1,
    InfSharp = 1 << 2,
    SemiSharp = 1 << 3,
}

/** A one-to-many relation: `counts[i]` members starting at `offsets[i]` in `indices` (and `local`). */
export class Relation {
    counts: Int32Array
    offsets: Int32Array
    indices: Int32Array
    local: Int32Array

    constructor(counts: Int32Array, offsets: Int32Array, indices: Int32Array, local?: Int32Array) {
        this.counts = counts
        this.offsets = offsets
        this.indices = indices
        this.local = local ?? new Int32Array(indices.length)
    }

    static empty(n = 0): Relation {
        return new Relation(new Int32Array(n), new Int32Array(n), new Int32Array(0))
    }

    /** Flatten per-component member lists, keeping member order (`DynamicRelation::compressMemberIndices`). */
    static fromLists(lists: number[][], localLists?: number[][]): Relation {
        const n = lists.length
        const counts = new Int32Array(n), offsets = new Int32Array(n)
        let total = 0
        for (let i = 0; i < n; i++) { counts[i] = lists[i].length; offsets[i] = total; total += lists[i].length }
        const indices = new Int32Array(total), local = new Int32Array(total)
        for (let i = 0; i < n; i++) {
            indices.set(lists[i], offsets[i])
            if (localLists) local.set(localLists[i], offsets[i])
        }
        return new Relation(counts, offsets, indices, local)
    }

    size(i: number): number { return this.counts[i] }
    get(i: number): Int32Array { return this.indices.subarray(this.offsets[i], this.offsets[i] + this.counts[i]) }
    getLocal(i: number): Int32Array { return this.local.subarray(this.offsets[i], this.offsets[i] + this.counts[i]) }
    /** The largest count. */
    max(): number { let m = 0; for (const c of this.counts) if (c > m) m = c; return m }
}

export class Level {
    depth = 0
    numVertices = 0
    numEdges = 0
    numFaces = 0

    /** Face-vertices; the same counts/offsets serve face-edges. */
    faceVerts: Relation = Relation.empty()
    faceEdges: Int32Array = new Int32Array(0)
    edgeVerts: Int32Array = new Int32Array(0)
    edgeFaces: Relation = Relation.empty()
    vertFaces: Relation = Relation.empty()
    vertEdges: Relation = Relation.empty()

    edgeSharpness: Float32Array = new Float32Array(0)
    vertSharpness: Float32Array = new Float32Array(0)
    edgeTags: Uint8Array = new Uint8Array(0)
    vertTags: Uint16Array = new Uint16Array(0)
    vertRule: Uint8Array = new Uint8Array(0)
    faceHole: Uint8Array = new Uint8Array(0)

    maxValence = 0
    maxEdgeFaces = 0
    /** Face-varying channels (UV maps), one {@link FVarLevel} per channel at this level. */
    fvarChannels: FVarLevel[] = []

    getFaceVertices(f: number): Int32Array { return this.faceVerts.get(f) }
    getFaceEdges(f: number): Int32Array {
        const o = this.faceVerts.offsets[f]
        return this.faceEdges.subarray(o, o + this.faceVerts.counts[f])
    }
    getEdgeVertices(e: number): Int32Array { return this.edgeVerts.subarray(2 * e, 2 * e + 2) }
    getEdgeFaces(e: number): Int32Array { return this.edgeFaces.get(e) }
    getEdgeFaceLocalIndices(e: number): Int32Array { return this.edgeFaces.getLocal(e) }
    getVertexFaces(v: number): Int32Array { return this.vertFaces.get(v) }
    getVertexFaceLocalIndices(v: number): Int32Array { return this.vertFaces.getLocal(v) }
    getVertexEdges(v: number): Int32Array { return this.vertEdges.get(v) }
    getVertexEdgeLocalIndices(v: number): Int32Array { return this.vertEdges.getLocal(v) }
    getVertexRule(v: number): Rule { return this.vertRule[v] as Rule }
    isEdgeNonManifold(e: number): boolean { return (this.edgeTags[e] & ETag.NonManifold) !== 0 }

    // region tag queries used by feature-adaptive refinement and patch building (level.cpp:540-760)

    getFVarLevel(c: number): FVarLevel { return this.fvarChannels[c] }
    isVertexNonManifold(v: number): boolean { return (this.vertTags[v] & VTag.NonManifold) !== 0 }
    /** The vertex tag with its rule (see {@link RULE_SHIFT}). */
    getVertexTag(v: number): number { return this.vertTags[v] | (this.vertRule[v] << RULE_SHIFT) }
    getFaceFVarValues(f: number, c: number): Int32Array { return this.fvarChannels[c].getFaceValues(f) }

    /** `Level::doesFaceFVarTopologyMatch` (`level.cpp:548`). */
    doesFaceFVarTopologyMatch(f: number, c: number): boolean {
        return !(this.fvarChannels[c].getFaceCompositeValueTag(f) & 1 /* FVTag.Mismatch */)
    }

    /** `Level::getFaceVTags` (`level.cpp:554`): per corner, combined with the channel's value tags when `fvc >= 0`. */
    getFaceVTags(f: number, out: number[], fvc = -1): number[] {
        const fVerts = this.getFaceVertices(f)
        out.length = fVerts.length
        if (fvc < 0) {
            for (let i = 0; i < fVerts.length; i++) out[i] = this.getVertexTag(fVerts[i])
        } else {
            const F = this.fvarChannels[fvc]
            const fValues = F.getFaceValues(f)
            for (let i = 0; i < fVerts.length; i++) {
                const vv = F.findVertexValueIndex(fVerts[i], fValues[i])
                out[i] = F.combineWithLevelVTag(F.vertValueTags[vv], this.getVertexTag(fVerts[i]))
            }
        }
        return out
    }

    /** `Level::getFaceETags` (`level.cpp:573`). */
    getFaceETags(f: number, out: number[], fvc = -1): number[] {
        const fEdges = this.getFaceEdges(f)
        out.length = fEdges.length
        if (fvc < 0) {
            for (let i = 0; i < fEdges.length; i++) out[i] = this.edgeTags[fEdges[i]]
        } else {
            const F = this.fvarChannels[fvc]
            for (let i = 0; i < fEdges.length; i++) out[i] = F.combineWithLevelETag(F.edgeTags[fEdges[i]], this.edgeTags[fEdges[i]])
        }
        return out
    }

    /** `Level::getFaceCompositeVTag` (`level.cpp:610, :619`). */
    getFaceCompositeVTag(f: number, fvc = -1): number {
        const fVerts = this.getFaceVertices(f)
        let bits = 0
        if (fvc < 0) {
            for (let i = 0; i < fVerts.length; i++) bits |= this.getVertexTag(fVerts[i])
        } else {
            const F = this.fvarChannels[fvc]
            const fValues = F.getFaceValues(f)
            for (let i = 0; i < fVerts.length; i++) {
                const vv = F.findVertexValueIndex(fVerts[i], fValues[i])
                bits |= F.combineWithLevelVTag(F.vertValueTags[vv], this.getVertexTag(fVerts[i]))
            }
        }
        return bits
    }

    /** `Level::getVertexCompositeFVarVTag` (`level.cpp:638`). */
    getVertexCompositeFVarVTag(v: number, fvc: number): number {
        const F = this.fvarChannels[fvc]
        const o = F.getVertexValueOffset(v), n = F.getNumVertexValues(v)
        const vTag = this.getVertexTag(v)
        if (F.vertValueTags[o] & 1 /* Mismatch */) {
            let bits = 0
            for (let i = 0; i < n; i++) bits |= F.combineWithLevelVTag(F.vertValueTags[o + i], vTag)
            return bits
        }
        return vTag
    }

    /** `Level::gatherQuadRegularRingAroundVertex` (`level.cpp:692`). */
    gatherQuadRegularRingAroundVertex(v: number, ring: number[], fvc = -1): number {
        const vEdges = this.getVertexEdges(v), vFaces = this.getVertexFaces(v), vInFaces = this.getVertexFaceLocalIndices(v)
        const isBoundary = vEdges.length > vFaces.length
        let n = 0
        for (let i = 0; i < vFaces.length; i++) {
            const fPoints = fvc < 0 ? this.getFaceVertices(vFaces[i]) : this.getFaceFVarValues(vFaces[i], fvc)
            const vIn = vInFaces[i]
            ring[n++] = fPoints[(vIn + 1) & 3]
            ring[n++] = fPoints[(vIn + 2) & 3]
            if (isBoundary && i === vFaces.length - 1) ring[n++] = fPoints[(vIn + 3) & 3]
        }
        return n
    }

    // endregion

    allocateTags(): void {
        this.edgeSharpness = new Float32Array(this.numEdges)
        this.vertSharpness = new Float32Array(this.numVertices)
        this.edgeTags = new Uint8Array(this.numEdges)
        this.vertTags = new Uint16Array(this.numVertices)
        this.vertRule = new Uint8Array(this.numVertices)
        this.faceHole = new Uint8Array(this.numFaces)
    }

    /** `Level::findEdge(v0, v1, v0Edges)` (`level.cpp:1597`). */
    findEdgeIn(v0: number, v1: number, v0Edges: ArrayLike<number>): number {
        if (v0 !== v1) {
            for (let j = 0; j < v0Edges.length; j++) {
                const e = v0Edges[j]
                if (this.edgeVerts[2 * e] === v1 || this.edgeVerts[2 * e + 1] === v1) return e
            }
        } else {
            for (let j = 0; j < v0Edges.length; j++) {
                const e = v0Edges[j]
                if (this.edgeVerts[2 * e] === this.edgeVerts[2 * e + 1]) return e
            }
        }
        return -1
    }

    findEdge(v0: number, v1: number): number { return this.findEdgeIn(v0, v1, this.getVertexEdges(v0)) }

    /**
     * A base level from face-vertices alone: `Level::completeTopologyFromFaceVertices` (`level.cpp:1623`).
     * Edges are discovered in face order; an edge used twice by one face, used by a third face, or used twice in
     * the same direction (opposite windings) is non-manifold, as are its vertices. Then the manifold vertices'
     * faces and edges are ordered counter-clockwise and the local indices filled in.
     */
    static fromFaceVertices(numVertices: number, faceSizes: ArrayLike<number>, faceVertIndices: ArrayLike<number>): Level {
        const L = new Level()
        L.numVertices = numVertices
        L.numFaces = faceSizes.length
        const fCounts = new Int32Array(L.numFaces), fOffsets = new Int32Array(L.numFaces)
        let total = 0, maxFaceSize = 0
        for (let f = 0; f < L.numFaces; f++) {
            fCounts[f] = faceSizes[f]; fOffsets[f] = total; total += faceSizes[f]
            if (faceSizes[f] > maxFaceSize) maxFaceSize = faceSizes[f]
        }
        L.faceVerts = new Relation(fCounts, fOffsets, Int32Array.from(faceVertIndices))
        L.faceEdges = new Int32Array(total)
        L.maxValence = maxFaceSize // OpenSubdiv initialises max valence with the max face size

        const edgeVertList: number[] = []
        const edgeFaceLists: number[][] = []
        const vertFaceLists: number[][] = Array.from({length: numVertices}, () => [])
        const vertEdgeLists: number[][] = Array.from({length: numVertices}, () => [])
        const nonManifoldEdges: number[] = []
        let edgeCount = 0

        for (let f = 0; f < L.numFaces; f++) {
            const fv = L.getFaceVertices(f)
            const fe = L.getFaceEdges(f)
            for (let i = 0; i < fv.length; i++) {
                const v0 = fv[i], v1 = fv[(i + 1) % fv.length]
                let e: number
                if (v0 !== v1) {
                    e = -1
                    for (const ce of vertEdgeLists[v0]) {
                        if (edgeVertList[2 * ce] === v1 || edgeVertList[2 * ce + 1] === v1) { e = ce; break }
                    }
                } else {
                    e = -1
                    nonManifoldEdges.push(edgeCount)
                }
                if (e >= 0) {
                    const ef = edgeFaceLists[e]
                    if (ef[ef.length - 1] === f) {
                        nonManifoldEdges.push(e)
                        nonManifoldEdges.push(edgeCount)
                        e = -1
                    } else if (ef.length > 1) {
                        nonManifoldEdges.push(e)
                    } else if (v0 === edgeVertList[2 * e]) {
                        nonManifoldEdges.push(e)
                    }
                }
                if (e < 0) {
                    e = edgeCount++
                    edgeVertList.push(v0, v1)
                    edgeFaceLists.push([])
                    vertEdgeLists[v0].push(e)
                    vertEdgeLists[v1].push(e)
                }
                edgeFaceLists[e].push(f)
                vertFaceLists[v0].push(f)
                fe[i] = e
            }
        }
        L.numEdges = edgeCount
        L.edgeVerts = Int32Array.from(edgeVertList)
        L.edgeFaces = Relation.fromLists(edgeFaceLists)
        L.vertFaces = Relation.fromLists(vertFaceLists)
        L.vertEdges = Relation.fromLists(vertEdgeLists)
        L.maxEdgeFaces = L.edgeFaces.max()
        L.maxValence = Math.max(L.maxValence, L.vertFaces.max(), L.vertEdges.max())
        L.allocateTags()

        for (const e of nonManifoldEdges) {
            L.edgeTags[e] |= ETag.NonManifold
            L.vertTags[L.edgeVerts[2 * e]] |= VTag.NonManifold
            L.vertTags[L.edgeVerts[2 * e + 1]] |= VTag.NonManifold
        }
        L.orientIncidentComponents()
        L.populateLocalIndices()
        return L
    }

    /** `Level::populateLocalIndices` (`level.cpp:1797`). */
    populateLocalIndices(): void {
        for (let v = 0; v < this.numVertices; v++) {
            const vFaces = this.getVertexFaces(v), vInFaces = this.getVertexFaceLocalIndices(v)
            let last = -1
            for (let i = 0; i < vFaces.length; i++) {
                const fv = this.getFaceVertices(vFaces[i])
                const start = vFaces[i] === last ? vInFaces[i - 1] + 1 : 0
                let k = start
                while (k < fv.length && fv[k] !== v) k++
                vInFaces[i] = k
                last = vFaces[i]
            }
        }
        for (let v = 0; v < this.numVertices; v++) {
            const vEdges = this.getVertexEdges(v), vInEdges = this.getVertexEdgeLocalIndices(v)
            for (let i = 0; i < vEdges.length; i++) {
                const ev0 = this.edgeVerts[2 * vEdges[i]], ev1 = this.edgeVerts[2 * vEdges[i] + 1]
                if (ev0 !== ev1) vInEdges[i] = v === ev1 ? 1 : 0
                else vInEdges[i] = i && vEdges[i] === vEdges[i - 1] ? 1 : 0
            }
            if (vEdges.length > this.maxValence) this.maxValence = vEdges.length
        }
        for (let e = 0; e < this.numEdges; e++) {
            const eFaces = this.getEdgeFaces(e), eInFaces = this.getEdgeFaceLocalIndices(e)
            let last = -1
            for (let i = 0; i < eFaces.length; i++) {
                const fe = this.getFaceEdges(eFaces[i])
                const start = eFaces[i] === last ? eInFaces[i - 1] + 1 : 0
                let k = start
                while (k < fe.length && fe[k] !== e) k++
                eInFaces[i] = k
                last = eFaces[i]
            }
        }
    }

    /** `Level::orientIncidentComponents` (`level.cpp:1877`). */
    orientIncidentComponents(): void {
        for (let v = 0; v < this.numVertices; v++) {
            if (!(this.vertTags[v] & VTag.NonManifold)) {
                if (!this.orderVertexFacesAndEdges(v)) this.vertTags[v] |= VTag.NonManifold
            }
        }
    }

    /** `Level::orderVertexFacesAndEdges(vIndex)` (`level.cpp:1899`, `:1997`): counter-clockwise faces and edges. */
    orderVertexFacesAndEdges(v: number): boolean {
        const vEdges = this.getVertexEdges(v), vFaces = this.getVertexFaces(v)
        const fCount = vFaces.length, eCount = vEdges.length
        if (fCount === 0 || eCount < 2 || eCount - fCount > 1) return false
        const indexOf = (a: Int32Array, x: number) => { let i = 0; while (i < a.length && a[i] !== x) i++; return i }

        let fStart = -1, eStart = -1, fvStart = 0
        if (eCount === fCount) {
            fStart = vFaces[0]
            fvStart = indexOf(this.getFaceVertices(fStart), v)
            eStart = this.getFaceEdges(fStart)[fvStart]
        } else {
            for (let i = 0; i < eCount; i++) {
                const eFaces = this.getEdgeFaces(vEdges[i])
                if (eFaces.length === 1) {
                    eStart = vEdges[i]
                    fStart = eFaces[0]
                    fvStart = indexOf(this.getFaceVertices(fStart), v)
                    if (eStart === this.getFaceEdges(fStart)[fvStart]) break
                }
            }
        }
        const facesOrdered = [fStart], edgesOrdered = [eStart]
        const eFirst = eStart
        while (edgesOrdered.length < eCount) {
            const fVerts = this.getFaceVertices(fStart), fEdges = this.getFaceEdges(fStart)
            const feNext = fvStart ? fvStart - 1 : fVerts.length - 1
            const eNext = fEdges[feNext]
            if (eNext === eStart || eNext === eFirst) return false
            edgesOrdered.push(eNext)
            if (facesOrdered.length < fCount) {
                const eFaces = this.getEdgeFaces(eNext)
                if (eFaces.length === 0) return false
                if (eFaces.length === 1 && eFaces[0] === fStart) return false
                fStart = eFaces[eFaces[0] === fStart ? 1 : 0]
                fvStart = indexOf(this.getFaceEdges(fStart), eNext)
                facesOrdered.push(fStart)
            }
            eStart = eNext
        }
        vFaces.set(facesOrdered)
        vEdges.set(edgesOrdered)
        return true
    }

    /** `Level::testVertexNonManifoldCrease` (`level.cpp:2016`). */
    testVertexNonManifoldCrease(v: number): boolean {
        const nonMan = [-1, -1]
        const vEdges = this.getVertexEdges(v)
        for (let i = 0; i < vEdges.length; i++) {
            if (this.isEdgeNonManifold(vEdges[i])) {
                if (nonMan[1] >= 0) return false
                nonMan[nonMan[0] >= 0 ? 1 : 0] = vEdges[i]
            } else if (this.edgeFaces.size(vEdges[i]) !== 2) {
                return false
            }
        }
        if (this.edgeFaces.size(nonMan[0]) !== this.edgeFaces.size(nonMan[1])) return false
        let traversed = 0
        for (let i = 0; i < 2; i++) {
            const e = nonMan[i], eStart = nonMan[i !== 0 ? 1 : 0], eEnd = nonMan[i === 0 ? 1 : 0]
            const eFaces = this.getEdgeFaces(e), eInFace = this.getEdgeFaceLocalIndices(e)
            for (let j = 0; j < eFaces.length; j++) {
                const fStart = eFaces[j]
                if (this.getFaceVertices(fStart)[eInFace[j]] !== v) continue
                let eNext = eStart, fNext = fStart
                while (eNext !== eEnd) {
                    if (eNext !== eStart) {
                        const pair = this.getEdgeFaces(eNext)
                        fNext = pair[pair[0] === fNext ? 1 : 0]
                    }
                    traversed++
                    const fEdges = this.getFaceEdges(fNext)
                    let iNext = 0
                    while (iNext < fEdges.length && fEdges[iNext] !== eNext) iNext++
                    eNext = fEdges[iNext ? iNext - 1 : fEdges.length - 1]
                    if (eNext === eStart) return false
                }
            }
        }
        return traversed === this.vertFaces.size(v)
    }
}

/**
 * Quad-split refinement of a {@link Level}: OpenSubdiv `Vtr::internal::Refinement` with `QuadRefinement`, ported from
 * `opensubdiv/vtr/{refinement.cpp, quadRefinement.cpp, sparseSelector.cpp}` (OpenSubdiv 3.7.0, Blender 5.2.2's pin),
 * both uniform (`RefineUniform`) and sparse (`RefineAdaptive`: only selected faces are refined, plus the
 * "neighboring" child components needed to define their limit, tagged incomplete).
 *
 * Child component numbering (`Refinement::populateParentChildIndices`, `refinement.cpp:209`), with
 * `orderVerticesFromFacesFirst = false` as Blender leaves it:
 * - child faces and the child edges inside parent faces: per parent face-vertex, in parent face order;
 * - then the two child edges of each parent edge;
 * - child vertices from parent vertices first, then from faces, then from edges.
 * In sparse refinement the unmarked entries are `-1` (`INDEX_INVALID`) and the rest are numbered in the same order.
 */

import {ETag, Level, Relation, VTag} from './level'
import {
    CreasingMethod, decrementSharpness, determineVertexVertexRuleFromCount, isSharp, Rule, SdcOptions, SHARPNESS_INFINITE,
    SHARPNESS_SMOOTH, subdivideEdgeSharpnessAtVertex,
} from './sdc'

export const INDEX_INVALID = -1
export const indexIsValid = (i: number) => i >= 0

/** `Refinement::SparseTag` / `ChildTag` packed: parent component selected / transitional bits. */
const SPARSE_NEIGHBOR = 1, SPARSE_SELECTED = 2

export class QuadRefinement {
    readonly parent: Level
    readonly child: Level
    readonly options: SdcOptions
    readonly regFaceSize = 4
    uniform = true

    // parent -> child (sized from the parent; quadRefinement.cpp:40 allocateParentChildIndices)
    faceChildFaceIndices: Int32Array
    faceChildEdgeIndices: Int32Array
    edgeChildEdgeIndices: Int32Array
    faceChildVert: Int32Array
    edgeChildVert: Int32Array
    vertChildVert: Int32Array

    // counts and first indices of child components by origin
    childFaceFromFaceCount = 0
    childEdgeFromFaceCount = 0
    childEdgeFromEdgeCount = 0
    childVertFromFaceCount = 0
    childVertFromEdgeCount = 0
    childVertFromVertCount = 0
    firstChildFaceFromFace = 0
    firstChildEdgeFromFace = 0
    firstChildEdgeFromEdge = 0
    firstChildVertFromFace = 0
    firstChildVertFromEdge = 0
    firstChildVertFromVert = 0

    // sparse selection tags on the parent (`SparseTag`)
    parentFaceSelected: Uint8Array = new Uint8Array(0)
    parentFaceTransitional: Uint8Array = new Uint8Array(0)
    parentEdgeSelected: Uint8Array = new Uint8Array(0)
    parentEdgeTransitional: Uint8Array = new Uint8Array(0)
    parentVertSelected: Uint8Array = new Uint8Array(0)

    // child -> parent (`ChildTag` and parent index)
    childFaceParent: Int32Array = new Int32Array(0)
    childFaceIncomplete: Uint8Array = new Uint8Array(0)
    childFaceIndexInParent: Uint8Array = new Uint8Array(0)
    childEdgeParent: Int32Array = new Int32Array(0)
    childEdgeIncomplete: Uint8Array = new Uint8Array(0)
    /** For child edges from parent edges: which end of the parent edge (`ChildTag::_indexInParent`). */
    childEdgeIndexInParent: Uint8Array = new Uint8Array(0)
    childVertParent: Int32Array = new Int32Array(0)
    childVertIncomplete: Uint8Array = new Uint8Array(0)

    constructor(parent: Level, child: Level, options: SdcOptions) {
        this.parent = parent
        this.child = child
        this.options = options
        child.depth = parent.depth + 1
        const total = parent.faceVerts.indices.length
        this.faceChildFaceIndices = new Int32Array(total)
        this.faceChildEdgeIndices = new Int32Array(total)
        this.edgeChildEdgeIndices = new Int32Array(2 * parent.numEdges)
        this.faceChildVert = new Int32Array(parent.numFaces)
        this.edgeChildVert = new Int32Array(parent.numEdges)
        this.vertChildVert = new Int32Array(parent.numVertices)
    }

    // region accessors

    /** `getFaceChildFaces(f)[j]`. */
    faceChildFace(f: number, j: number): number { return this.faceChildFaceIndices[this.parent.faceVerts.offsets[f] + j] }
    getFaceChildFaces(f: number): Int32Array {
        const o = this.parent.faceVerts.offsets[f]
        return this.faceChildFaceIndices.subarray(o, o + this.parent.faceVerts.counts[f])
    }
    /** `getFaceChildEdges(f)[j]`: the child edge inside face `f` perpendicular to its j-th edge. */
    faceChildEdge(f: number, j: number): number { return this.faceChildEdgeIndices[this.parent.faceVerts.offsets[f] + j] }
    getFaceChildEdges(f: number): Int32Array {
        const o = this.parent.faceVerts.offsets[f]
        return this.faceChildEdgeIndices.subarray(o, o + this.parent.faceVerts.counts[f])
    }
    /** `getEdgeChildEdges(e)[j]`: the child edge of `e` ending at its j-th vertex. */
    edgeChildEdge(e: number, j: number): number { return this.edgeChildEdgeIndices[2 * e + j] }
    isChildVertexComplete(v: number): boolean { return !this.childVertIncomplete[v] }

    // endregion

    // region sparse selection (SparseSelector, sparseSelector.cpp)

    /** `Refinement::initializeSparseSelectionTags`. */
    initializeSparseSelectionTags(): void {
        this.parentFaceSelected = new Uint8Array(this.parent.numFaces)
        this.parentFaceTransitional = new Uint8Array(this.parent.numFaces)
        this.parentEdgeSelected = new Uint8Array(this.parent.numEdges)
        this.parentEdgeTransitional = new Uint8Array(this.parent.numEdges)
        this.parentVertSelected = new Uint8Array(this.parent.numVertices)
    }

    // endregion

    /** `Refinement::refine` (`refinement.cpp:100`), full topology in the child (`_minimalTopology = false`). */
    refine(sparse = false): void {
        this.uniform = !sparse
        this.populateParentToChildMapping()
        this.initializeChildComponentCounts()
        this.populateChildToParentMapping()
        this.propagateComponentTags()
        this.subdivideTopology()
        this.subdivideSharpnessValues()
    }

    // region parent -> child

    private populateParentToChildMapping(): void {
        if (!this.uniform) {
            if (!this.parentVertSelected.length) throw new Error('subdivision: empty sparse refinement')
            this.markSparseChildComponentIndices()
        }
        this.populateParentChildIndices()
    }

    /** `Refinement::populateParentChildIndices` (`refinement.cpp:209`), vertices from vertices first. */
    private populateParentChildIndices(): void {
        const seq = this.uniform
            ? (a: Int32Array, base: number) => { for (let i = 0; i < a.length; i++) a[i] = base + i; return a.length }
            : (a: Int32Array, base: number) => {
                let n = 0
                for (let i = 0; i < a.length; i++) a[i] = a[i] !== 0 ? base + n++ : INDEX_INVALID
                return n
            }
        this.firstChildFaceFromFace = 0
        this.childFaceFromFaceCount = seq(this.faceChildFaceIndices, 0)
        this.firstChildEdgeFromFace = 0
        this.childEdgeFromFaceCount = seq(this.faceChildEdgeIndices, 0)
        this.firstChildEdgeFromEdge = this.childEdgeFromFaceCount
        this.childEdgeFromEdgeCount = seq(this.edgeChildEdgeIndices, this.firstChildEdgeFromEdge)
        this.firstChildVertFromVert = 0
        this.childVertFromVertCount = seq(this.vertChildVert, 0)
        this.firstChildVertFromFace = this.childVertFromVertCount
        this.childVertFromFaceCount = seq(this.faceChildVert, this.firstChildVertFromFace)
        this.firstChildVertFromEdge = this.firstChildVertFromFace + this.childVertFromFaceCount
        this.childVertFromEdgeCount = seq(this.edgeChildVert, this.firstChildVertFromEdge)
    }

    /** `Refinement::initializeChildComponentCounts`. */
    private initializeChildComponentCounts(): void {
        const C = this.child
        C.numFaces = this.childFaceFromFaceCount
        C.numEdges = this.childEdgeFromFaceCount + this.childEdgeFromEdgeCount
        C.numVertices = this.childVertFromFaceCount + this.childVertFromEdgeCount + this.childVertFromVertCount
    }

    /** `Refinement::markSparseChildComponentIndices` (`refinement.cpp:1121`). */
    private markSparseChildComponentIndices(): void {
        const P = this.parent
        // markSparseVertexChildren
        for (let v = 0; v < P.numVertices; v++) if (this.parentVertSelected[v]) this.vertChildVert[v] = SPARSE_SELECTED
        // markSparseEdgeChildren
        for (let e = 0; e < P.numEdges; e++) {
            const v0 = P.edgeVerts[2 * e], v1 = P.edgeVerts[2 * e + 1]
            if (this.parentEdgeSelected[e]) {
                this.edgeChildEdgeIndices[2 * e] = SPARSE_SELECTED
                this.edgeChildEdgeIndices[2 * e + 1] = SPARSE_SELECTED
                this.edgeChildVert[e] = SPARSE_SELECTED
            } else {
                if (this.parentVertSelected[v0]) {
                    this.edgeChildEdgeIndices[2 * e] = SPARSE_NEIGHBOR
                    this.edgeChildVert[e] = SPARSE_NEIGHBOR
                }
                if (this.parentVertSelected[v1]) {
                    this.edgeChildEdgeIndices[2 * e + 1] = SPARSE_NEIGHBOR
                    this.edgeChildVert[e] = SPARSE_NEIGHBOR
                }
            }
            const eFaces = P.getEdgeFaces(e)
            if (eFaces.length === 2) {
                this.parentEdgeTransitional[e] = this.parentFaceSelected[eFaces[0]] !== this.parentFaceSelected[eFaces[1]] ? 1 : 0
            } else if (eFaces.length < 2) {
                this.parentEdgeTransitional[e] = 0
            } else {
                const sel0 = this.parentFaceSelected[eFaces[0]]
                this.parentEdgeTransitional[e] = 0
                for (let i = 1; i < eFaces.length; i++) if (this.parentFaceSelected[eFaces[i]] !== sel0) { this.parentEdgeTransitional[e] = 1; break }
            }
        }
        // QuadRefinement::markSparseFaceChildren (quadRefinement.cpp:930)
        for (let f = 0; f < P.numFaces; f++) {
            const o = P.faceVerts.offsets[f], n = P.faceVerts.counts[f]
            const fVerts = P.getFaceVertices(f)
            if (this.parentFaceSelected[f]) {
                for (let i = 0; i < n; i++) {
                    this.faceChildFaceIndices[o + i] = SPARSE_SELECTED
                    this.faceChildEdgeIndices[o + i] = SPARSE_SELECTED
                }
                this.faceChildVert[f] = SPARSE_SELECTED
                this.parentFaceTransitional[f] = 0
            } else {
                let marked = false
                for (let i = 0; i < n; i++) {
                    if (this.parentVertSelected[fVerts[i]]) {
                        const iPrev = i ? i - 1 : n - 1
                        this.faceChildFaceIndices[o + i] = SPARSE_NEIGHBOR
                        this.faceChildEdgeIndices[o + i] = SPARSE_NEIGHBOR
                        this.faceChildEdgeIndices[o + iPrev] = SPARSE_NEIGHBOR
                        marked = true
                    }
                }
                if (marked) {
                    this.faceChildVert[f] = SPARSE_NEIGHBOR
                    const fEdges = P.getFaceEdges(f)
                    if (fEdges.length === 4 || fEdges.length === 3) {
                        let t = 0
                        for (let i = 0; i < fEdges.length; i++) t |= this.parentEdgeTransitional[fEdges[i]] << i
                        this.parentFaceTransitional[f] = t
                    } else {
                        let t = 0
                        for (let i = 0; i < fEdges.length; i++) t |= this.parentEdgeTransitional[fEdges[i]]
                        this.parentFaceTransitional[f] = t
                    }
                }
            }
        }
    }

    // endregion

    // region child -> parent (refinement.cpp:330-605)

    private populateChildToParentMapping(): void {
        const P = this.parent, C = this.child
        this.childFaceParent = new Int32Array(C.numFaces)
        this.childFaceIncomplete = new Uint8Array(C.numFaces)
        this.childFaceIndexInParent = new Uint8Array(C.numFaces)
        this.childEdgeParent = new Int32Array(C.numEdges)
        this.childEdgeIncomplete = new Uint8Array(C.numEdges)
        this.childEdgeIndexInParent = new Uint8Array(C.numEdges)
        this.childVertParent = new Int32Array(C.numVertices)
        this.childVertIncomplete = new Uint8Array(C.numVertices).fill(this.uniform ? 0 : 1)

        for (let f = 0; f < P.numFaces; f++) {
            const incomplete = this.uniform ? 0 : (this.parentFaceSelected[f] ? 0 : 1)
            const n = P.faceVerts.counts[f]
            const tooLarge = n > 4
            for (let j = 0; j < n; j++) {
                const cf = this.faceChildFace(f, j)
                if (cf >= 0) {
                    this.childFaceParent[cf] = f
                    this.childFaceIncomplete[cf] = incomplete
                    this.childFaceIndexInParent[cf] = tooLarge ? 0 : j
                }
                const ce = this.faceChildEdge(f, j)
                if (ce >= 0) {
                    this.childEdgeParent[ce] = f
                    this.childEdgeIncomplete[ce] = incomplete
                    this.childEdgeIndexInParent[ce] = tooLarge ? 0 : j
                }
            }
        }
        for (let e = 0; e < P.numEdges; e++) {
            const incomplete = this.uniform ? 0 : (this.parentEdgeSelected[e] ? 0 : 1)
            for (let j = 0; j < 2; j++) {
                const ce = this.edgeChildEdge(e, j)
                if (ce >= 0) {
                    this.childEdgeParent[ce] = e
                    this.childEdgeIncomplete[ce] = incomplete
                    this.childEdgeIndexInParent[ce] = j
                }
            }
        }
        for (let f = 0; f < P.numFaces; f++) {
            const cv = this.faceChildVert[f]
            if (cv < 0) continue
            if (!this.uniform && this.parentFaceSelected[f]) this.childVertIncomplete[cv] = 0
            this.childVertParent[cv] = f
        }
        for (let e = 0; e < P.numEdges; e++) {
            const cv = this.edgeChildVert[e]
            if (cv < 0) continue
            if (!this.uniform && this.parentEdgeSelected[e]) this.childVertIncomplete[cv] = 0
            this.childVertParent[cv] = e
        }
        for (let v = 0; v < P.numVertices; v++) {
            const cv = this.vertChildVert[v]
            if (cv < 0) continue
            if (!this.uniform && this.parentVertSelected[v]) this.childVertIncomplete[cv] = 0
            this.childVertParent[cv] = v
        }
    }

    // endregion

    /** `Refinement::propagateComponentTags` (`refinement.cpp:610-760`). */
    private propagateComponentTags(): void {
        const P = this.parent, C = this.child
        C.allocateTags()
        // faces inherit their parent's hole tag
        for (let c = 0; c < C.numFaces; c++) C.faceHole[c] = P.faceHole[this.childFaceParent[c]]
        // edges from faces: cleared (already zero); edges from edges: inherited
        for (let c = this.firstChildEdgeFromEdge; c < this.firstChildEdgeFromEdge + this.childEdgeFromEdgeCount; c++) {
            C.edgeTags[c] = P.edgeTags[this.childEdgeParent[c]]
        }
        // vertices from faces: smooth, extraordinary at depth 0 when the parent face is not a quad
        for (let cv = this.firstChildVertFromFace; cv < this.firstChildVertFromFace + this.childVertFromFaceCount; cv++) {
            C.vertTags[cv] = 0
            C.vertRule[cv] = Rule.Smooth
            if (P.depth === 0 && P.faceVerts.counts[this.childVertParent[cv]] !== this.regFaceSize) C.vertTags[cv] |= VTag.Xordinary
        }
        // vertices from edges
        for (let e = 0; e < P.numEdges; e++) {
            const cv = this.edgeChildVert[e]
            if (cv < 0) continue
            const et = P.edgeTags[e]
            const nonMan = (et & ETag.NonManifold) !== 0, boundary = (et & ETag.Boundary) !== 0
            const semi = (et & ETag.SemiSharp) !== 0, inf = (et & ETag.InfSharp) !== 0
            let t = 0
            if (nonMan) t |= VTag.NonManifold
            if (boundary) t |= VTag.Boundary
            if (semi) t |= VTag.SemiSharpEdges
            if (inf) t |= VTag.InfSharpEdges | VTag.InfSharpCrease
            if (inf && nonMan) t |= VTag.InfIrregular
            C.vertTags[cv] = t
            C.vertRule[cv] = semi || inf ? Rule.Crease : Rule.Smooth
        }
        // vertices from vertices: inherited, minus "incident irregular face"
        for (let cv = this.firstChildVertFromVert; cv < this.firstChildVertFromVert + this.childVertFromVertCount; cv++) {
            const v = this.childVertParent[cv]
            C.vertTags[cv] = P.vertTags[v] & ~VTag.IncidIrregFace
            C.vertRule[cv] = P.vertRule[v]
        }
        if (!this.uniform) {
            for (let cv = 0; cv < C.numVertices; cv++) if (this.childVertIncomplete[cv]) C.vertTags[cv] |= VTag.Incomplete
        }
    }

    /** `Refinement::subdivideTopology` (`refinement.cpp:774`) with the `QuadRefinement::populate*` methods. */
    private subdivideTopology(): void {
        const P = this.parent, C = this.child

        // face-verts and face-edges (quadRefinement.cpp:108, :178)
        const fvCounts = new Int32Array(C.numFaces).fill(4)
        const fvOffsets = Int32Array.from({length: C.numFaces}, (_, i) => i << 2)
        const faceVerts = new Int32Array(C.numFaces * 4)
        const faceEdges = new Int32Array(C.numFaces * 4)
        for (let pf = 0; pf < P.numFaces; pf++) {
            const pVerts = P.getFaceVertices(pf), pEdges = P.getFaceEdges(pf)
            const n = pVerts.length
            for (let j = 0; j < n; j++) {
                const cf = this.faceChildFace(pf, j)
                if (cf < 0) continue
                const jPrev = j ? j - 1 : n - 1
                const cVertOfFace = this.faceChildVert[pf]
                const cVertOfEPrev = this.edgeChildVert[pEdges[jPrev]]
                const cVertOfVert = this.vertChildVert[pVerts[j]]
                const cVertOfENext = this.edgeChildVert[pEdges[j]]

                const pPrevEdge = pEdges[jPrev], pNextEdge = pEdges[j]
                const ppv0 = P.edgeVerts[2 * pPrevEdge], ppv1 = P.edgeVerts[2 * pPrevEdge + 1]
                const pnv0 = P.edgeVerts[2 * pNextEdge], pnv1 = P.edgeVerts[2 * pNextEdge + 1]
                const corner = pVerts[j]
                const cornerInPrevEdge = ppv0 !== ppv1 ? (ppv0 !== corner ? 1 : 0) : 1
                const cornerInNextEdge = pnv0 !== pnv1 ? (pnv0 !== corner ? 1 : 0) : 0
                const cEdgeOfEdgePrev = this.edgeChildEdge(pPrevEdge, cornerInPrevEdge)
                const cEdgeOfEdgeNext = this.edgeChildEdge(pNextEdge, cornerInNextEdge)
                const cEdgePerpEdgePrev = this.faceChildEdge(pf, jPrev)
                const cEdgePerpEdgeNext = this.faceChildEdge(pf, j)

                const o = cf * 4
                if (n === 4) {
                    const jOpp = jPrev ? jPrev - 1 : 3
                    const jNext = jOpp ? jOpp - 1 : 3
                    faceVerts[o + j] = cVertOfVert; faceVerts[o + jNext] = cVertOfENext
                    faceVerts[o + jOpp] = cVertOfFace; faceVerts[o + jPrev] = cVertOfEPrev
                    faceEdges[o + j] = cEdgeOfEdgeNext; faceEdges[o + jNext] = cEdgePerpEdgeNext
                    faceEdges[o + jOpp] = cEdgePerpEdgePrev; faceEdges[o + jPrev] = cEdgeOfEdgePrev
                } else {
                    faceVerts[o] = cVertOfVert; faceVerts[o + 1] = cVertOfENext
                    faceVerts[o + 2] = cVertOfFace; faceVerts[o + 3] = cVertOfEPrev
                    faceEdges[o] = cEdgeOfEdgeNext; faceEdges[o + 1] = cEdgePerpEdgeNext
                    faceEdges[o + 2] = cEdgePerpEdgePrev; faceEdges[o + 3] = cEdgeOfEdgePrev
                }
            }
        }
        C.faceVerts = new Relation(fvCounts, fvOffsets, faceVerts)
        C.faceEdges = faceEdges

        // edge-verts (quadRefinement.cpp:271, :296)
        const edgeVerts = new Int32Array(C.numEdges * 2)
        for (let pf = 0; pf < P.numFaces; pf++) {
            const pEdges = P.getFaceEdges(pf)
            for (let j = 0; j < pEdges.length; j++) {
                const ce = this.faceChildEdge(pf, j)
                if (ce < 0) continue
                edgeVerts[2 * ce] = this.faceChildVert[pf]
                edgeVerts[2 * ce + 1] = this.edgeChildVert[pEdges[j]]
            }
        }
        for (let pe = 0; pe < P.numEdges; pe++) {
            for (let j = 0; j < 2; j++) {
                const ce = this.edgeChildEdge(pe, j)
                if (ce < 0) continue
                edgeVerts[2 * ce] = this.edgeChildVert[pe]
                edgeVerts[2 * ce + 1] = this.vertChildVert[P.edgeVerts[2 * pe + j]]
            }
        }
        C.edgeVerts = edgeVerts

        // edge-faces (quadRefinement.cpp:374, :428)
        const edgeFaces: number[][] = Array.from({length: C.numEdges}, () => [])
        const edgeFaceLocal: number[][] = Array.from({length: C.numEdges}, () => [])
        for (let pf = 0; pf < P.numFaces; pf++) {
            const n = P.faceVerts.counts[pf]
            for (let j = 0; j < n; j++) {
                const ce = this.faceChildEdge(pf, j)
                if (ce < 0) continue
                const jNext = j + 1 < n ? j + 1 : 0
                const cf0 = this.faceChildFace(pf, j), cf1 = this.faceChildFace(pf, jNext)
                if (cf0 >= 0) { edgeFaces[ce].push(cf0); edgeFaceLocal[ce].push(n === 4 ? jNext : 1) }
                if (cf1 >= 0) { edgeFaces[ce].push(cf1); edgeFaceLocal[ce].push(n === 4 ? (jNext + 2) & 3 : 2) }
            }
        }
        for (let pe = 0; pe < P.numEdges; pe++) {
            if (this.edgeChildEdge(pe, 0) < 0 && this.edgeChildEdge(pe, 1) < 0) continue
            const pEdgeFaces = P.getEdgeFaces(pe), pEdgeInFace = P.getEdgeFaceLocalIndices(pe)
            const ev0 = P.edgeVerts[2 * pe], ev1 = P.edgeVerts[2 * pe + 1]
            for (let j = 0; j < 2; j++) {
                const ce = this.edgeChildEdge(pe, j)
                if (ce < 0) continue
                for (let i = 0; i < pEdgeFaces.length; i++) {
                    const pf = pEdgeFaces[i], edgeInFace = pEdgeInFace[i]
                    const pFaceVerts = P.getFaceVertices(pf)
                    const childOfEdge = ev0 === ev1 ? j : (pFaceVerts[edgeInFace] !== (j ? ev1 : ev0) ? 1 : 0)
                    let childInFace = edgeInFace + childOfEdge
                    if (childInFace === pFaceVerts.length) childInFace = 0
                    const cf = this.faceChildFace(pf, childInFace)
                    if (cf >= 0) {
                        edgeFaces[ce].push(cf)
                        edgeFaceLocal[ce].push(pFaceVerts.length === 4 ? edgeInFace : (childOfEdge ? 3 : 0))
                    }
                }
            }
        }
        C.edgeFaces = Relation.fromLists(edgeFaces, edgeFaceLocal)
        C.maxEdgeFaces = Math.max(P.maxEdgeFaces, C.edgeFaces.max())

        // vertex-faces (quadRefinement.cpp:544, :579, :631), vertices from vertices first
        const vertFaces: number[][] = Array.from({length: C.numVertices}, () => [])
        const vertFaceLocal: number[][] = Array.from({length: C.numVertices}, () => [])
        for (let pv = 0; pv < P.numVertices; pv++) {
            const cv = this.vertChildVert[pv]
            if (cv < 0) continue
            const pVertFaces = P.getVertexFaces(pv), pVertInFace = P.getVertexFaceLocalIndices(pv)
            for (let i = 0; i < pVertFaces.length; i++) {
                const pf = pVertFaces[i], vInFace = pVertInFace[i]
                const cf = this.faceChildFace(pf, vInFace)
                if (cf >= 0) { vertFaces[cv].push(cf); vertFaceLocal[cv].push(P.faceVerts.counts[pf] === 4 ? vInFace : 0) }
            }
        }
        for (let pf = 0; pf < P.numFaces; pf++) {
            const cv = this.faceChildVert[pf]
            if (cv < 0) continue
            const n = P.faceVerts.counts[pf]
            for (let j = 0; j < n; j++) {
                const cf = this.faceChildFace(pf, j)
                if (cf >= 0) { vertFaces[cv].push(cf); vertFaceLocal[cv].push(n === 4 ? (j + 2) & 3 : 2) }
            }
        }
        for (let pe = 0; pe < P.numEdges; pe++) {
            const cv = this.edgeChildVert[pe]
            if (cv < 0) continue
            const pEdgeFaces = P.getEdgeFaces(pe), pEdgeInFace = P.getEdgeFaceLocalIndices(pe)
            for (let i = 0; i < pEdgeFaces.length; i++) {
                const pf = pEdgeFaces[i], edgeInFace = pEdgeInFace[i]
                const n = P.faceVerts.counts[pf]
                const fc0 = edgeInFace
                let fc1 = edgeInFace + 1
                if (fc1 === n) fc1 = 0
                const cf1 = this.faceChildFace(pf, fc1), cf0 = this.faceChildFace(pf, fc0)
                if (cf1 >= 0) { vertFaces[cv].push(cf1); vertFaceLocal[cv].push(n === 4 ? fc0 : 3) }
                if (cf0 >= 0) { vertFaces[cv].push(cf0); vertFaceLocal[cv].push(n === 4 ? fc1 : 1) }
            }
        }
        C.vertFaces = Relation.fromLists(vertFaces, vertFaceLocal)

        // vertex-edges (quadRefinement.cpp:731, :766, :853)
        const vertEdges: number[][] = Array.from({length: C.numVertices}, () => [])
        const vertEdgeLocal: number[][] = Array.from({length: C.numVertices}, () => [])
        for (let pv = 0; pv < P.numVertices; pv++) {
            const cv = this.vertChildVert[pv]
            if (cv < 0) continue
            const pVertEdges = P.getVertexEdges(pv), pVertInEdge = P.getVertexEdgeLocalIndices(pv)
            for (let i = 0; i < pVertEdges.length; i++) {
                const ce = this.edgeChildEdge(pVertEdges[i], pVertInEdge[i])
                if (ce >= 0) { vertEdges[cv].push(ce); vertEdgeLocal[cv].push(1) }
            }
        }
        for (let pf = 0; pf < P.numFaces; pf++) {
            const cv = this.faceChildVert[pf]
            if (cv < 0) continue
            const n = P.faceVerts.counts[pf]
            for (let j = 0; j < n; j++) {
                const jLeading = j ? j - 1 : n - 1
                const ce = this.faceChildEdge(pf, jLeading)
                if (ce >= 0) { vertEdges[cv].push(ce); vertEdgeLocal[cv].push(0) }
            }
        }
        for (let pe = 0; pe < P.numEdges; pe++) {
            const cv = this.edgeChildVert[pe]
            if (cv < 0) continue
            const pEdgeFaces = P.getEdgeFaces(pe), pEdgeInFace = P.getEdgeFaceLocalIndices(pe)
            const ev0 = P.edgeVerts[2 * pe], ev1 = P.edgeVerts[2 * pe + 1]
            const edges: number[] = [], local: number[] = []
            const c0 = this.edgeChildEdge(pe, 0), c1 = this.edgeChildEdge(pe, 1)
            if (c0 >= 0) { edges.push(c0); local.push(0) }
            if (c1 >= 0) { edges.push(c1); local.push(0) }
            for (let i = 0; i < pEdgeFaces.length; i++) {
                const pf = pEdgeFaces[i], edgeInFace = pEdgeInFace[i]
                const cEdgeOfFace = this.faceChildEdge(pf, edgeInFace)
                if (cEdgeOfFace < 0) continue
                edges.push(cEdgeOfFace); local.push(1)
                if (i === 0 && edges.length === 3) {
                    if (ev0 !== ev1 && P.getFaceVertices(pf)[edgeInFace] === ev0) {
                        [edges[0], edges[1]] = [edges[1], edges[0]];
                        [local[0], local[1]] = [local[1], local[0]]
                    }
                    [edges[1], edges[2]] = [edges[2], edges[1]];
                    [local[1], local[2]] = [local[2], local[1]]
                }
            }
            vertEdges[cv] = edges
            vertEdgeLocal[cv] = local
        }
        C.vertEdges = Relation.fromLists(vertEdges, vertEdgeLocal)

        C.maxValence = Math.max(P.maxValence, 4, 2 + P.maxEdgeFaces)
    }

    /** `Refinement::subdivideSharpnessValues` (`refinement.cpp:824`). */
    private subdivideSharpnessValues(): void {
        this.subdivideEdgeSharpness()
        this.subdivideVertexSharpness()
        this.reclassifySemisharpVertices()
    }

    /** `Refinement::subdivideEdgeSharpness` (`refinement.cpp:849`). */
    private subdivideEdgeSharpness(): void {
        const P = this.parent, C = this.child
        C.edgeSharpness.fill(SHARPNESS_SMOOTH)
        for (let c = this.firstChildEdgeFromEdge; c < this.firstChildEdgeFromEdge + this.childEdgeFromEdgeCount; c++) {
            const tag = C.edgeTags[c]
            if (tag & ETag.InfSharp) {
                C.edgeSharpness[c] = SHARPNESS_INFINITE
            } else if (tag & ETag.SemiSharp) {
                const pe = this.childEdgeParent[c]
                const ps = P.edgeSharpness[pe]
                let cs: number
                if (this.options.creasingMethod === CreasingMethod.Uniform) {
                    cs = decrementSharpness(ps) // Crease::SubdivideUniformSharpness
                } else {
                    const pVert = P.edgeVerts[2 * pe + this.childEdgeIndexInParent[c]]
                    const pVertEdges = P.getVertexEdges(pVert)
                    const s: number[] = []
                    for (let i = 0; i < pVertEdges.length; i++) s.push(P.edgeSharpness[pVertEdges[i]])
                    cs = subdivideEdgeSharpnessAtVertex(this.options, ps, pVertEdges.length, s)
                }
                C.edgeSharpness[c] = cs
                if (!isSharp(cs)) C.edgeTags[c] &= ~ETag.SemiSharp
            }
        }
    }

    /** `Refinement::subdivideVertexSharpness` (`refinement.cpp:909`). */
    private subdivideVertexSharpness(): void {
        const P = this.parent, C = this.child
        C.vertSharpness.fill(SHARPNESS_SMOOTH)
        for (let c = this.firstChildVertFromVert; c < this.firstChildVertFromVert + this.childVertFromVertCount; c++) {
            const tag = C.vertTags[c]
            if (tag & VTag.InfSharp) {
                C.vertSharpness[c] = SHARPNESS_INFINITE
            } else if (tag & VTag.SemiSharp) {
                const cs = decrementSharpness(P.vertSharpness[this.childVertParent[c]]) // Crease::SubdivideVertexSharpness
                C.vertSharpness[c] = cs
                if (!isSharp(cs)) C.vertTags[c] &= ~VTag.SemiSharp
            }
        }
    }

    /** `Refinement::reclassifySemisharpVertices` (`refinement.cpp:946`). */
    private reclassifySemisharpVertices(): void {
        const P = this.parent, C = this.child
        for (let c = this.firstChildVertFromEdge; c < this.firstChildVertFromEdge + this.childVertFromEdgeCount; c++) {
            if (!(C.vertTags[c] & VTag.SemiSharpEdges)) continue
            const pe = this.childVertParent[c]
            const ce0 = this.edgeChildEdge(pe, 0), ce1 = this.edgeChildEdge(pe, 1)
            if (this.childVertIncomplete[c]) {
                // one child edge likely missing: a crease if the remaining edge is semi-sharp
                const semi = (ce0 >= 0 && (C.edgeTags[ce0] & ETag.SemiSharp) !== 0) || (ce1 >= 0 && (C.edgeTags[ce1] & ETag.SemiSharp) !== 0)
                if (semi) C.vertTags[c] |= VTag.SemiSharpEdges; else C.vertTags[c] &= ~VTag.SemiSharpEdges
                C.vertRule[c] = semi ? Rule.Crease : Rule.Smooth
            } else {
                const n = ((C.edgeTags[ce0] & ETag.SemiSharp) ? 1 : 0) + ((C.edgeTags[ce1] & ETag.SemiSharp) ? 1 : 0)
                if (n > 0) C.vertTags[c] |= VTag.SemiSharpEdges; else C.vertTags[c] &= ~VTag.SemiSharpEdges
                C.vertRule[c] = determineVertexVertexRuleFromCount(0, n)
            }
        }
        for (let c = this.firstChildVertFromVert; c < this.firstChildVertFromVert + this.childVertFromVertCount; c++) {
            const pv = this.childVertParent[c]
            const pTag = P.vertTags[pv]
            if (!(pTag & VTag.SemiSharp) && !(pTag & VTag.SemiSharpEdges)) continue
            const decayed = (pTag & VTag.SemiSharp) !== 0 && !(C.vertTags[c] & VTag.SemiSharp)
            if ((pTag & VTag.SemiSharpEdges) || decayed) {
                let inf = 0, semi = 0
                const cEdges = C.getVertexEdges(c)
                for (let i = 0; i < cEdges.length; i++) {
                    const t = C.edgeTags[cEdges[i]]
                    if (t & ETag.InfSharp) inf++
                    if (t & ETag.SemiSharp) semi++
                }
                if (semi > 0) C.vertTags[c] |= VTag.SemiSharpEdges; else C.vertTags[c] &= ~VTag.SemiSharpEdges
                if (!(C.vertTags[c] & VTag.SemiSharp) && !(C.vertTags[c] & VTag.InfSharp)) {
                    C.vertRule[c] = determineVertexVertexRuleFromCount(0, inf + semi)
                }
            }
        }
    }
}

/**
 * `Vtr::internal::SparseSelector` (`sparseSelector.cpp`): marks parent components of a refinement for sparse
 * (feature-adaptive) refinement.
 */
export class SparseSelector {
    readonly refinement: QuadRefinement
    private selected = false

    constructor(refinement: QuadRefinement) { this.refinement = refinement }

    isSelectionEmpty(): boolean { return !this.selected }

    private initializeSelection(): void {
        if (!this.selected) {
            this.refinement.initializeSparseSelectionTags()
            this.selected = true
        }
    }

    selectVertex(v: number): void {
        this.initializeSelection()
        this.refinement.parentVertSelected[v] = 1
    }

    selectEdge(e: number): void {
        this.initializeSelection()
        const r = this.refinement
        if (!r.parentEdgeSelected[e]) {
            r.parentEdgeSelected[e] = 1
            r.parentVertSelected[r.parent.edgeVerts[2 * e]] = 1
            r.parentVertSelected[r.parent.edgeVerts[2 * e + 1]] = 1
        }
    }

    selectFace(f: number): void {
        this.initializeSelection()
        const r = this.refinement
        if (!r.parentFaceSelected[f]) {
            r.parentFaceSelected[f] = 1
            const fEdges = r.parent.getFaceEdges(f), fVerts = r.parent.getFaceVertices(f)
            for (let i = 0; i < fVerts.length; i++) {
                r.parentEdgeSelected[fEdges[i]] = 1
                r.parentVertSelected[fVerts[i]] = 1
            }
        }
    }
}

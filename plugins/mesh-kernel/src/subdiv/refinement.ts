/**
 * Uniform quad-split refinement of a {@link Level}: OpenSubdiv `Vtr::internal::Refinement` with
 * `QuadRefinement`, ported from `opensubdiv/vtr/{refinement.cpp, quadRefinement.cpp}` for the uniform case
 * (`Refinement::refine` with `_sparse = false`, `orderVerticesFromFacesFirst = false` as Blender's
 * `RefineUniform` leaves it, `evaluator_impl.cc:454`).
 *
 * Child component numbering (`Refinement::populateParentChildIndices`, `refinement.cpp:209`):
 * - child faces: parent face `f`'s j-th child is `faceVertOffset(f) + j`;
 * - child edges: first those inside parent faces (same indexing as child faces), then two per parent edge;
 * - child vertices: from parent vertices first (`v`), then faces (`V + f`), then edges (`V + F + e`).
 */

import {ETag, Level, Relation, VTag} from './level'
import {
    CreasingMethod, decrementSharpness, determineVertexVertexRuleFromCount, isSharp, Rule, SdcOptions, SHARPNESS_INFINITE,
    SHARPNESS_SMOOTH, subdivideEdgeSharpnessAtVertex,
} from './sdc'

export class QuadRefinement {
    readonly parent: Level
    readonly child: Level
    readonly options: SdcOptions

    /** First child edge from parent edges = the number of child edges from faces (= parent face-vert total). */
    firstChildEdgeFromEdge = 0
    firstChildVertFromVert = 0
    firstChildVertFromFace = 0
    firstChildVertFromEdge = 0

    /** Child vertex of each parent face / edge / vertex. */
    faceChildVert: Int32Array
    edgeChildVert: Int32Array
    vertChildVert: Int32Array

    /** Child component -> parent component (face, edge or vertex, by origin range). */
    childFaceParent: Int32Array = new Int32Array(0)
    childEdgeParent: Int32Array = new Int32Array(0)
    childVertParent: Int32Array = new Int32Array(0)
    /** For child edges from parent edges: which end of the parent edge (`ChildTag::_indexInParent`). */
    childEdgeIndexInParent: Uint8Array = new Uint8Array(0)

    constructor(parent: Level, child: Level, options: SdcOptions) {
        this.parent = parent
        this.child = child
        this.options = options
        child.depth = parent.depth + 1
        this.faceChildVert = new Int32Array(parent.numFaces)
        this.edgeChildVert = new Int32Array(parent.numEdges)
        this.vertChildVert = new Int32Array(parent.numVertices)
    }

    // region parent -> child

    /** Child faces of parent face `f` (one per face corner). */
    faceChildFace(f: number, j: number): number { return this.parent.faceVerts.offsets[f] + j }
    /** Child edges inside parent face `f`, the j-th perpendicular to the face's j-th edge. */
    faceChildEdge(f: number, j: number): number { return this.parent.faceVerts.offsets[f] + j }
    /** The two child edges of parent edge `e`, the j-th ending at the edge's j-th vertex. */
    edgeChildEdge(e: number, j: number): number { return this.firstChildEdgeFromEdge + 2 * e + j }

    // endregion

    /** `Refinement::refine` (`refinement.cpp:100`), uniform, all six relations. */
    refine(): void {
        const P = this.parent, C = this.child
        const faceVertTotal = P.faceVerts.indices.length

        // populateParentChildIndices (uniform, vertices from vertices first)
        this.firstChildEdgeFromEdge = faceVertTotal
        this.firstChildVertFromVert = 0
        this.firstChildVertFromFace = P.numVertices
        this.firstChildVertFromEdge = P.numVertices + P.numFaces
        for (let v = 0; v < P.numVertices; v++) this.vertChildVert[v] = v
        for (let f = 0; f < P.numFaces; f++) this.faceChildVert[f] = this.firstChildVertFromFace + f
        for (let e = 0; e < P.numEdges; e++) this.edgeChildVert[e] = this.firstChildVertFromEdge + e

        // initializeChildComponentCounts
        C.numFaces = faceVertTotal
        C.numEdges = faceVertTotal + 2 * P.numEdges
        C.numVertices = P.numVertices + P.numFaces + P.numEdges

        this.populateChildToParentMapping()
        C.allocateTags()
        this.propagateComponentTags()
        this.subdivideTopology()
        this.subdivideSharpnessValues()
    }

    /** `Refinement::populateChildToParentMapping` (`refinement.cpp:330`) and the face/edge/vertex variants. */
    private populateChildToParentMapping(): void {
        const P = this.parent, C = this.child
        this.childFaceParent = new Int32Array(C.numFaces)
        this.childEdgeParent = new Int32Array(C.numEdges)
        this.childEdgeIndexInParent = new Uint8Array(C.numEdges)
        this.childVertParent = new Int32Array(C.numVertices)
        for (let f = 0; f < P.numFaces; f++) {
            const n = P.faceVerts.counts[f]
            for (let j = 0; j < n; j++) {
                this.childFaceParent[this.faceChildFace(f, j)] = f
                this.childEdgeParent[this.faceChildEdge(f, j)] = f
            }
        }
        for (let e = 0; e < P.numEdges; e++) {
            for (let j = 0; j < 2; j++) {
                const c = this.edgeChildEdge(e, j)
                this.childEdgeParent[c] = e
                this.childEdgeIndexInParent[c] = j
            }
        }
        for (let v = 0; v < P.numVertices; v++) this.childVertParent[this.vertChildVert[v]] = v
        for (let f = 0; f < P.numFaces; f++) this.childVertParent[this.faceChildVert[f]] = f
        for (let e = 0; e < P.numEdges; e++) this.childVertParent[this.edgeChildVert[e]] = e
    }

    /** `Refinement::propagateComponentTags` (`refinement.cpp:610-760`). */
    private propagateComponentTags(): void {
        const P = this.parent, C = this.child
        // faces inherit their parent's hole tag
        for (let c = 0; c < C.numFaces; c++) C.faceHole[c] = P.faceHole[this.childFaceParent[c]]
        // edges from faces: cleared (already zero); edges from edges: inherited
        for (let c = this.firstChildEdgeFromEdge; c < C.numEdges; c++) C.edgeTags[c] = P.edgeTags[this.childEdgeParent[c]]
        // vertices from faces: smooth, extraordinary at depth 0 when the parent face is not a quad
        for (let f = 0; f < P.numFaces; f++) {
            const cv = this.faceChildVert[f]
            C.vertTags[cv] = 0
            C.vertRule[cv] = Rule.Smooth
            if (P.depth === 0 && P.faceVerts.counts[f] !== 4) C.vertTags[cv] |= VTag.Xordinary
        }
        // vertices from edges
        for (let e = 0; e < P.numEdges; e++) {
            const cv = this.edgeChildVert[e]
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
        for (let v = 0; v < P.numVertices; v++) {
            const cv = this.vertChildVert[v]
            C.vertTags[cv] = P.vertTags[v] & ~VTag.IncidIrregFace
            C.vertRule[cv] = P.vertRule[v]
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
                edgeVerts[2 * ce] = this.faceChildVert[pf]
                edgeVerts[2 * ce + 1] = this.edgeChildVert[pEdges[j]]
            }
        }
        for (let pe = 0; pe < P.numEdges; pe++) {
            for (let j = 0; j < 2; j++) {
                const ce = this.edgeChildEdge(pe, j)
                edgeVerts[2 * ce] = this.edgeChildVert[pe]
                edgeVerts[2 * ce + 1] = this.vertChildVert[P.edgeVerts[2 * pe + j]]
            }
        }
        C.edgeVerts = edgeVerts

        // edge-faces (quadRefinement.cpp:374, :428)
        const edgeFaces: number[][] = new Array(C.numEdges)
        const edgeFaceLocal: number[][] = new Array(C.numEdges)
        for (let pf = 0; pf < P.numFaces; pf++) {
            const n = P.faceVerts.counts[pf]
            for (let j = 0; j < n; j++) {
                const ce = this.faceChildEdge(pf, j)
                const jNext = j + 1 < n ? j + 1 : 0
                edgeFaces[ce] = [this.faceChildFace(pf, j), this.faceChildFace(pf, jNext)]
                edgeFaceLocal[ce] = [n === 4 ? jNext : 1, n === 4 ? (jNext + 2) & 3 : 2]
            }
        }
        for (let pe = 0; pe < P.numEdges; pe++) {
            const pEdgeFaces = P.getEdgeFaces(pe), pEdgeInFace = P.getEdgeFaceLocalIndices(pe)
            const ev0 = P.edgeVerts[2 * pe], ev1 = P.edgeVerts[2 * pe + 1]
            for (let j = 0; j < 2; j++) {
                const ce = this.edgeChildEdge(pe, j)
                const faces: number[] = [], local: number[] = []
                for (let i = 0; i < pEdgeFaces.length; i++) {
                    const pf = pEdgeFaces[i], edgeInFace = pEdgeInFace[i]
                    const pFaceVerts = P.getFaceVertices(pf)
                    const childOfEdge = ev0 === ev1 ? j : (pFaceVerts[edgeInFace] !== (j ? ev1 : ev0) ? 1 : 0)
                    let childInFace = edgeInFace + childOfEdge
                    if (childInFace === pFaceVerts.length) childInFace = 0
                    faces.push(this.faceChildFace(pf, childInFace))
                    local.push(pFaceVerts.length === 4 ? edgeInFace : (childOfEdge ? 3 : 0))
                }
                edgeFaces[ce] = faces
                edgeFaceLocal[ce] = local
            }
        }
        C.edgeFaces = Relation.fromLists(edgeFaces, edgeFaceLocal)
        C.maxEdgeFaces = Math.max(P.maxEdgeFaces, C.edgeFaces.max())

        // vertex-faces (quadRefinement.cpp:544, :579, :631)
        const vertFaces: number[][] = new Array(C.numVertices)
        const vertFaceLocal: number[][] = new Array(C.numVertices)
        for (let pf = 0; pf < P.numFaces; pf++) {
            const n = P.faceVerts.counts[pf]
            const faces: number[] = [], local: number[] = []
            for (let j = 0; j < n; j++) { faces.push(this.faceChildFace(pf, j)); local.push(n === 4 ? (j + 2) & 3 : 2) }
            vertFaces[this.faceChildVert[pf]] = faces
            vertFaceLocal[this.faceChildVert[pf]] = local
        }
        for (let pe = 0; pe < P.numEdges; pe++) {
            const pEdgeFaces = P.getEdgeFaces(pe), pEdgeInFace = P.getEdgeFaceLocalIndices(pe)
            const faces: number[] = [], local: number[] = []
            for (let i = 0; i < pEdgeFaces.length; i++) {
                const pf = pEdgeFaces[i], edgeInFace = pEdgeInFace[i]
                const n = P.faceVerts.counts[pf]
                const fc0 = edgeInFace
                let fc1 = edgeInFace + 1
                if (fc1 === n) fc1 = 0
                faces.push(this.faceChildFace(pf, fc1)); local.push(n === 4 ? fc0 : 3)
                faces.push(this.faceChildFace(pf, fc0)); local.push(n === 4 ? fc1 : 1)
            }
            vertFaces[this.edgeChildVert[pe]] = faces
            vertFaceLocal[this.edgeChildVert[pe]] = local
        }
        for (let pv = 0; pv < P.numVertices; pv++) {
            const pVertFaces = P.getVertexFaces(pv), pVertInFace = P.getVertexFaceLocalIndices(pv)
            const faces: number[] = [], local: number[] = []
            for (let i = 0; i < pVertFaces.length; i++) {
                const pf = pVertFaces[i], vInFace = pVertInFace[i]
                faces.push(this.faceChildFace(pf, vInFace))
                local.push(P.faceVerts.counts[pf] === 4 ? vInFace : 0)
            }
            vertFaces[this.vertChildVert[pv]] = faces
            vertFaceLocal[this.vertChildVert[pv]] = local
        }
        C.vertFaces = Relation.fromLists(vertFaces, vertFaceLocal)

        // vertex-edges (quadRefinement.cpp:731, :766, :853)
        const vertEdges: number[][] = new Array(C.numVertices)
        const vertEdgeLocal: number[][] = new Array(C.numVertices)
        for (let pf = 0; pf < P.numFaces; pf++) {
            const n = P.faceVerts.counts[pf]
            const edges: number[] = [], local: number[] = []
            for (let j = 0; j < n; j++) {
                const jLeading = j ? j - 1 : n - 1
                edges.push(this.faceChildEdge(pf, jLeading)); local.push(0)
            }
            vertEdges[this.faceChildVert[pf]] = edges
            vertEdgeLocal[this.faceChildVert[pf]] = local
        }
        for (let pe = 0; pe < P.numEdges; pe++) {
            const pEdgeFaces = P.getEdgeFaces(pe), pEdgeInFace = P.getEdgeFaceLocalIndices(pe)
            const ev0 = P.edgeVerts[2 * pe], ev1 = P.edgeVerts[2 * pe + 1]
            const edges = [this.edgeChildEdge(pe, 0), this.edgeChildEdge(pe, 1)]
            const local = [0, 0]
            for (let i = 0; i < pEdgeFaces.length; i++) {
                const pf = pEdgeFaces[i], edgeInFace = pEdgeInFace[i]
                edges.push(this.faceChildEdge(pf, edgeInFace)); local.push(1)
                if (i === 0 && edges.length === 3) {
                    if (ev0 !== ev1 && P.getFaceVertices(pf)[edgeInFace] === ev0) {
                        [edges[0], edges[1]] = [edges[1], edges[0]];
                        [local[0], local[1]] = [local[1], local[0]]
                    }
                    [edges[1], edges[2]] = [edges[2], edges[1]];
                    [local[1], local[2]] = [local[2], local[1]]
                }
            }
            vertEdges[this.edgeChildVert[pe]] = edges
            vertEdgeLocal[this.edgeChildVert[pe]] = local
        }
        for (let pv = 0; pv < P.numVertices; pv++) {
            const pVertEdges = P.getVertexEdges(pv), pVertInEdge = P.getVertexEdgeLocalIndices(pv)
            const edges: number[] = [], local: number[] = []
            for (let i = 0; i < pVertEdges.length; i++) { edges.push(this.edgeChildEdge(pVertEdges[i], pVertInEdge[i])); local.push(1) }
            vertEdges[this.vertChildVert[pv]] = edges
            vertEdgeLocal[this.vertChildVert[pv]] = local
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
        for (let c = this.firstChildEdgeFromEdge; c < C.numEdges; c++) {
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
        for (let pv = 0; pv < P.numVertices; pv++) {
            const c = this.vertChildVert[pv]
            const tag = C.vertTags[c]
            if (tag & VTag.InfSharp) {
                C.vertSharpness[c] = SHARPNESS_INFINITE
            } else if (tag & VTag.SemiSharp) {
                const ps = P.vertSharpness[pv]
                const cs = decrementSharpness(ps) // Crease::SubdivideVertexSharpness
                C.vertSharpness[c] = cs
                if (!isSharp(cs)) C.vertTags[c] &= ~VTag.SemiSharp
            }
        }
    }

    /** `Refinement::reclassifySemisharpVertices` (`refinement.cpp:965`). */
    private reclassifySemisharpVertices(): void {
        const P = this.parent, C = this.child
        for (let pe = 0; pe < P.numEdges; pe++) {
            const c = this.edgeChildVert[pe]
            if (!(C.vertTags[c] & VTag.SemiSharpEdges)) continue
            const n = ((C.edgeTags[this.edgeChildEdge(pe, 0)] & ETag.SemiSharp) ? 1 : 0)
                + ((C.edgeTags[this.edgeChildEdge(pe, 1)] & ETag.SemiSharp) ? 1 : 0)
            if (n > 0) C.vertTags[c] |= VTag.SemiSharpEdges; else C.vertTags[c] &= ~VTag.SemiSharpEdges
            C.vertRule[c] = determineVertexVertexRuleFromCount(0, n)
        }
        for (let pv = 0; pv < P.numVertices; pv++) {
            const pTag = P.vertTags[pv]
            if (!(pTag & VTag.SemiSharp) && !(pTag & VTag.SemiSharpEdges)) continue
            const c = this.vertChildVert[pv]
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

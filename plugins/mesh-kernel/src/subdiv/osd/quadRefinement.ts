/**
 * Port of OpenSubdiv v3_7_0 `opensubdiv/vtr/quadRefinement.h` and `vtr/quadRefinement.cpp` (Copyright 2014 DreamWorks
 * Animation LLC): the quad split (Catmark, Bilinear) - every face becomes one quad per corner.
 * Licensed under the Tomorrow Open Source Technology License 1.0 - see `OPENSUBDIV-LICENSE.txt` in this folder.
 */

import {Options, Split} from './sdc'
import {Level} from './level'
import {Refinement} from './refinement'
import {indexIsValid, resizeVector} from './vtrTypes'

const IndexSparseMaskNeighboring = 1 << 0
const IndexSparseMaskSelected = 1 << 1

export class QuadRefinement extends Refinement {
    /** `QuadRefinement::QuadRefinement` (:26). */
    constructor(parent: Level, child: Level, options: Options) {
        super(parent, child, options)
        this.splitType = Split.TO_QUADS
        this.regFaceSize = 4
    }

    /** `allocateParentChildIndices` (:40). */
    allocateParentChildIndices(): void {
        const p = this.parent
        this.faceChildFaceCountsAndOffsets = p.shareFaceVertCountsAndOffsets()
        this.faceChildEdgeCountsAndOffsets = p.shareFaceVertCountsAndOffsets()
        this.faceChildFaceIndices = new Array(p.faceVertIndices.length).fill(0)
        this.faceChildEdgeIndices = new Array(p.faceEdgeIndices.length).fill(0)
        this.edgeChildEdgeIndices = new Array(p.edgeVertIndices.length).fill(0)
        this.faceChildVertIndex = new Array(p.getNumFaces()).fill(0)
        this.edgeChildVertIndex = new Array(p.getNumEdges()).fill(0)
        this.vertChildVertIndex = new Array(p.getNumVertices()).fill(0)
    }

    /** `populateFaceVertexRelation` (:84). */
    populateFaceVertexRelation(): void {
        if (this.child.faceVertCountsAndOffsets.length === 0) this.populateFaceVertexCountsAndOffsets()
        resizeVector(this.child.faceVertIndices, this.child.getNumFaces() * 4)
        this.populateFaceVerticesFromParentFaces()
    }

    /** `populateFaceVertexCountsAndOffsets` (:95). */
    populateFaceVertexCountsAndOffsets(): void {
        const c = this.child
        resizeVector(c.faceVertCountsAndOffsets, c.getNumFaces() * 2)
        for (let i = 0; i < c.getNumFaces(); ++i) {
            c.faceVertCountsAndOffsets[i * 2] = 4
            c.faceVertCountsAndOffsets[i * 2 + 1] = i << 2
        }
    }

    /** `populateFaceVerticesFromParentFaces` (:106). */
    populateFaceVerticesFromParentFaces(): void {
        const p = this.parent
        for (let pFace = 0; pFace < p.getNumFaces(); ++pFace) {
            const pFaceVerts = p.getFaceVertices(pFace)
            const pFaceEdges = p.getFaceEdges(pFace)
            const pFaceChildren = this.getFaceChildFaces(pFace)
            const pFaceSize = pFaceVerts.size
            for (let j = 0; j < pFaceSize; ++j) {
                const cFace = pFaceChildren.get(j)
                if (!indexIsValid(cFace)) continue
                const jPrev = j ? j - 1 : pFaceSize - 1
                const cVertOfFace = this.faceChildVertIndex[pFace]
                const cVertOfEPrev = this.edgeChildVertIndex[pFaceEdges.get(jPrev)]
                const cVertOfVert = this.vertChildVertIndex[pFaceVerts.get(j)]
                const cVertOfENext = this.edgeChildVertIndex[pFaceEdges.get(j)]
                const cFaceVerts = this.child.getFaceVertices(cFace)
                if (pFaceSize === 4) {
                    const jOpp = jPrev ? jPrev - 1 : 3
                    const jNext = jOpp ? jOpp - 1 : 3
                    cFaceVerts.set(j, cVertOfVert)
                    cFaceVerts.set(jNext, cVertOfENext)
                    cFaceVerts.set(jOpp, cVertOfFace)
                    cFaceVerts.set(jPrev, cVertOfEPrev)
                } else {
                    cFaceVerts.set(0, cVertOfVert)
                    cFaceVerts.set(1, cVertOfENext)
                    cFaceVerts.set(2, cVertOfFace)
                    cFaceVerts.set(3, cVertOfEPrev)
                }
            }
        }
    }

    /** `populateFaceEdgeRelation` (:152). */
    populateFaceEdgeRelation(): void {
        if (this.child.faceVertCountsAndOffsets.length === 0) this.populateFaceVertexCountsAndOffsets()
        resizeVector(this.child.faceEdgeIndices, this.child.getNumFaces() * 4)
        this.populateFaceEdgesFromParentFaces()
    }

    /** `populateFaceEdgesFromParentFaces` (:163). */
    populateFaceEdgesFromParentFaces(): void {
        const p = this.parent
        for (let pFace = 0; pFace < p.getNumFaces(); ++pFace) {
            const pFaceVerts = p.getFaceVertices(pFace)
            const pFaceEdges = p.getFaceEdges(pFace)
            const pFaceChildFaces = this.getFaceChildFaces(pFace)
            const pFaceChildEdges = this.getFaceChildEdges(pFace)
            const pFaceSize = pFaceVerts.size
            for (let j = 0; j < pFaceSize; ++j) {
                const cFace = pFaceChildFaces.get(j)
                if (!indexIsValid(cFace)) continue
                const jPrev = j ? j - 1 : pFaceSize - 1
                const pPrevEdge = pFaceEdges.get(jPrev)
                const pPrevEdgeVerts = p.getEdgeVertices(pPrevEdge)
                const pNextEdge = pFaceEdges.get(j)
                const pNextEdgeVerts = p.getEdgeVertices(pNextEdge)
                const pCornerVert = pFaceVerts.get(j)
                const cornerInPrevEdge = pPrevEdgeVerts.get(0) !== pPrevEdgeVerts.get(1) ? (pPrevEdgeVerts.get(0) !== pCornerVert ? 1 : 0) : 1
                const cornerInNextEdge = pNextEdgeVerts.get(0) !== pNextEdgeVerts.get(1) ? (pNextEdgeVerts.get(0) !== pCornerVert ? 1 : 0) : 0
                const cEdgeOfEdgePrev = this.getEdgeChildEdges(pPrevEdge).get(cornerInPrevEdge)
                const cEdgeOfEdgeNext = this.getEdgeChildEdges(pNextEdge).get(cornerInNextEdge)
                const cEdgePerpEdgePrev = pFaceChildEdges.get(jPrev)
                const cEdgePerpEdgeNext = pFaceChildEdges.get(j)
                const cFaceEdges = this.child.getFaceEdges(cFace)
                if (pFaceSize === 4) {
                    const jOpp = jPrev ? jPrev - 1 : 3
                    const jNext = jOpp ? jOpp - 1 : 3
                    cFaceEdges.set(j, cEdgeOfEdgeNext)
                    cFaceEdges.set(jNext, cEdgePerpEdgeNext)
                    cFaceEdges.set(jOpp, cEdgePerpEdgePrev)
                    cFaceEdges.set(jPrev, cEdgeOfEdgePrev)
                } else {
                    cFaceEdges.set(0, cEdgeOfEdgeNext)
                    cFaceEdges.set(1, cEdgePerpEdgeNext)
                    cFaceEdges.set(2, cEdgePerpEdgePrev)
                    cFaceEdges.set(3, cEdgeOfEdgePrev)
                }
            }
        }
    }

    /** `populateEdgeVertexRelation` (:226). */
    populateEdgeVertexRelation(): void {
        const p = this.parent, c = this.child
        resizeVector(c.edgeVertIndices, c.getNumEdges() * 2)
        for (let pFace = 0; pFace < p.getNumFaces(); ++pFace) {
            const pFaceEdges = p.getFaceEdges(pFace)
            const pFaceChildEdges = this.getFaceChildEdges(pFace)
            for (let j = 0; j < pFaceEdges.size; ++j) {
                const cEdge = pFaceChildEdges.get(j)
                if (!indexIsValid(cEdge)) continue
                const v = c.getEdgeVertices(cEdge)
                v.set(0, this.faceChildVertIndex[pFace])
                v.set(1, this.edgeChildVertIndex[pFaceEdges.get(j)])
            }
        }
        for (let pEdge = 0; pEdge < p.getNumEdges(); ++pEdge) {
            const pEdgeVerts = p.getEdgeVertices(pEdge)
            const pEdgeChildren = this.getEdgeChildEdges(pEdge)
            for (let j = 0; j < 2; ++j) {
                const cEdge = pEdgeChildren.get(j)
                if (!indexIsValid(cEdge)) continue
                const v = c.getEdgeVertices(cEdge)
                v.set(0, this.edgeChildVertIndex[pEdge])
                v.set(1, this.vertChildVertIndex[pEdgeVerts.get(j)])
            }
        }
    }

    /** `populateEdgeFaceRelation` (:275) with `populateEdgeFacesFromParentFaces` (:298) and `...FromParentEdges` (:333). */
    populateEdgeFaceRelation(): void {
        const p = this.parent, c = this.child
        let estimate = p.faceVertIndices.length * 2 + p.edgeFaceIndices.length * 2
        resizeVector(c.edgeFaceCountsAndOffsets, c.getNumEdges() * 2)
        resizeVector(c.edgeFaceIndices, estimate)
        resizeVector(c.edgeFaceLocalIndices, estimate)
        c.maxEdgeFaces = p.maxEdgeFaces
        for (let pFace = 0; pFace < p.getNumFaces(); ++pFace) {
            const pFaceChildFaces = this.getFaceChildFaces(pFace)
            const pFaceChildEdges = this.getFaceChildEdges(pFace)
            const pFaceSize = pFaceChildFaces.size
            for (let j = 0; j < pFaceSize; ++j) {
                const cEdge = pFaceChildEdges.get(j)
                if (!indexIsValid(cEdge)) continue
                c.resizeEdgeFacesOf(cEdge, 2)
                const cEdgeFaces = c.getEdgeFaces(cEdge)
                const cEdgeInFace = c.getEdgeFaceLocalIndices(cEdge)
                const jNext = j + 1 < pFaceSize ? j + 1 : 0
                let count = 0
                if (indexIsValid(pFaceChildFaces.get(j))) {
                    cEdgeFaces.set(count, pFaceChildFaces.get(j))
                    cEdgeInFace.set(count, pFaceSize === 4 ? jNext : 1)
                    count++
                }
                if (indexIsValid(pFaceChildFaces.get(jNext))) {
                    cEdgeFaces.set(count, pFaceChildFaces.get(jNext))
                    cEdgeInFace.set(count, pFaceSize === 4 ? (jNext + 2) & 3 : 2)
                    count++
                }
                c.trimEdgeFaces(cEdge, count)
            }
        }
        for (let pEdge = 0; pEdge < p.getNumEdges(); ++pEdge) {
            const pEdgeChildEdges = this.getEdgeChildEdges(pEdge)
            if (!indexIsValid(pEdgeChildEdges.get(0)) && !indexIsValid(pEdgeChildEdges.get(1))) continue
            const pEdgeFaces = p.getEdgeFaces(pEdge)
            const pEdgeInFace = p.getEdgeFaceLocalIndices(pEdge)
            const pEdgeVerts = p.getEdgeVertices(pEdge)
            for (let j = 0; j < 2; ++j) {
                const cEdge = pEdgeChildEdges.get(j)
                if (!indexIsValid(cEdge)) continue
                c.resizeEdgeFacesOf(cEdge, pEdgeFaces.size)
                const cEdgeFaces = c.getEdgeFaces(cEdge)
                const cEdgeInFace = c.getEdgeFaceLocalIndices(cEdge)
                let count = 0
                for (let i = 0; i < pEdgeFaces.size; ++i) {
                    const pFace = pEdgeFaces.get(i)
                    const edgeInFace = pEdgeInFace.get(i)
                    const pFaceVerts = p.getFaceVertices(pFace)
                    const pFaceChildren = this.getFaceChildFaces(pFace)
                    const childOfEdge = pEdgeVerts.get(0) === pEdgeVerts.get(1) ? j : (pFaceVerts.get(edgeInFace) !== pEdgeVerts.get(j) ? 1 : 0)
                    let childInFace = edgeInFace + childOfEdge
                    if (childInFace === pFaceChildren.size) childInFace = 0
                    if (indexIsValid(pFaceChildren.get(childInFace))) {
                        cEdgeFaces.set(count, pFaceChildren.get(childInFace))
                        cEdgeInFace.set(count, pFaceVerts.size === 4 ? edgeInFace : (childOfEdge ? 3 : 0))
                        count++
                    }
                }
                c.trimEdgeFaces(cEdge, count)
            }
        }
        estimate = c.getNumEdgeFaces(c.getNumEdges() - 1) + c.getOffsetOfEdgeFaces(c.getNumEdges() - 1)
        resizeVector(c.edgeFaceIndices, estimate)
        resizeVector(c.edgeFaceLocalIndices, estimate)
    }

    /** `populateVertexFaceRelation` (:395). */
    populateVertexFaceRelation(): void {
        const p = this.parent, c = this.child
        let estimate = p.faceVertIndices.length + p.edgeFaceIndices.length * 2 + p.vertFaceIndices.length
        resizeVector(c.vertFaceCountsAndOffsets, c.getNumVertices() * 2)
        resizeVector(c.vertFaceIndices, estimate)
        resizeVector(c.vertFaceLocalIndices, estimate)
        if (this.getFirstChildVertexFromVertices() === 0) {
            this.populateVertexFacesFromParentVertices()
            this.populateVertexFacesFromParentFaces()
            this.populateVertexFacesFromParentEdges()
        } else {
            this.populateVertexFacesFromParentFaces()
            this.populateVertexFacesFromParentEdges()
            this.populateVertexFacesFromParentVertices()
        }
        estimate = c.getNumVertexFaces(c.getNumVertices() - 1) + c.getOffsetOfVertexFaces(c.getNumVertices() - 1)
        resizeVector(c.vertFaceIndices, estimate)
        resizeVector(c.vertFaceLocalIndices, estimate)
    }

    /** `populateVertexFacesFromParentFaces` (:426). */
    populateVertexFacesFromParentFaces(): void {
        const p = this.parent, c = this.child
        for (let pFace = 0; pFace < p.getNumFaces(); ++pFace) {
            const cVert = this.faceChildVertIndex[pFace]
            if (!indexIsValid(cVert)) continue
            const pFaceChildren = this.getFaceChildFaces(pFace)
            const pFaceSize = pFaceChildren.size
            c.resizeVertexFacesOf(cVert, pFaceSize)
            const cVertFaces = c.getVertexFaces(cVert)
            const cVertInFace = c.getVertexFaceLocalIndices(cVert)
            let count = 0
            for (let j = 0; j < pFaceSize; ++j) {
                if (indexIsValid(pFaceChildren.get(j))) {
                    cVertFaces.set(count, pFaceChildren.get(j))
                    cVertInFace.set(count, pFaceSize === 4 ? (j + 2) & 3 : 2)
                    count++
                }
            }
            c.trimVertexFaces(cVert, count)
        }
    }

    /** `populateVertexFacesFromParentEdges` (:454). */
    populateVertexFacesFromParentEdges(): void {
        const p = this.parent, c = this.child
        for (let pEdge = 0; pEdge < p.getNumEdges(); ++pEdge) {
            const cVert = this.edgeChildVertIndex[pEdge]
            if (!indexIsValid(cVert)) continue
            const pEdgeFaces = p.getEdgeFaces(pEdge)
            const pEdgeInFace = p.getEdgeFaceLocalIndices(pEdge)
            c.resizeVertexFacesOf(cVert, 2 * pEdgeFaces.size)
            const cVertFaces = c.getVertexFaces(cVert)
            const cVertInFace = c.getVertexFaceLocalIndices(cVert)
            let count = 0
            for (let i = 0; i < pEdgeFaces.size; ++i) {
                const pFace = pEdgeFaces.get(i)
                const edgeInFace = pEdgeInFace.get(i)
                const pFaceChildren = this.getFaceChildFaces(pFace)
                const pFaceSize = pFaceChildren.size
                const faceChild0 = edgeInFace
                let faceChild1 = edgeInFace + 1
                if (faceChild1 === pFaceChildren.size) faceChild1 = 0
                if (indexIsValid(pFaceChildren.get(faceChild1))) {
                    cVertFaces.set(count, pFaceChildren.get(faceChild1))
                    cVertInFace.set(count, pFaceSize === 4 ? faceChild0 : 3)
                    count++
                }
                if (indexIsValid(pFaceChildren.get(faceChild0))) {
                    cVertFaces.set(count, pFaceChildren.get(faceChild0))
                    cVertInFace.set(count, pFaceSize === 4 ? faceChild1 : 1)
                    count++
                }
            }
            c.trimVertexFaces(cVert, count)
        }
    }

    /** `populateVertexFacesFromParentVertices` (:501). */
    populateVertexFacesFromParentVertices(): void {
        const p = this.parent, c = this.child
        for (let pVert = 0; pVert < p.getNumVertices(); ++pVert) {
            const cVert = this.vertChildVertIndex[pVert]
            if (!indexIsValid(cVert)) continue
            const pVertFaces = p.getVertexFaces(pVert)
            const pVertInFace = p.getVertexFaceLocalIndices(pVert)
            c.resizeVertexFacesOf(cVert, pVertFaces.size)
            const cVertFaces = c.getVertexFaces(cVert)
            const cVertInFace = c.getVertexFaceLocalIndices(cVert)
            let count = 0
            for (let i = 0; i < pVertFaces.size; ++i) {
                const pFace = pVertFaces.get(i)
                const vertInFace = pVertInFace.get(i)
                const pFaceChildren = this.getFaceChildFaces(pFace)
                if (indexIsValid(pFaceChildren.get(vertInFace))) {
                    cVertFaces.set(count, pFaceChildren.get(vertInFace))
                    cVertInFace.set(count, pFaceChildren.size === 4 ? vertInFace : 0)
                    count++
                }
            }
            c.trimVertexFaces(cVert, count)
        }
    }

    /** `populateVertexEdgeRelation` (:535). */
    populateVertexEdgeRelation(): void {
        const p = this.parent, c = this.child
        let estimate = p.faceVertIndices.length + p.edgeFaceIndices.length + p.getNumEdges() * 2 + p.vertEdgeIndices.length
        resizeVector(c.vertEdgeCountsAndOffsets, c.getNumVertices() * 2)
        resizeVector(c.vertEdgeIndices, estimate)
        resizeVector(c.vertEdgeLocalIndices, estimate)
        if (this.getFirstChildVertexFromVertices() === 0) {
            this.populateVertexEdgesFromParentVertices()
            this.populateVertexEdgesFromParentFaces()
            this.populateVertexEdgesFromParentEdges()
        } else {
            this.populateVertexEdgesFromParentFaces()
            this.populateVertexEdgesFromParentEdges()
            this.populateVertexEdgesFromParentVertices()
        }
        estimate = c.getNumVertexEdges(c.getNumVertices() - 1) + c.getOffsetOfVertexEdges(c.getNumVertices() - 1)
        resizeVector(c.vertEdgeIndices, estimate)
        resizeVector(c.vertEdgeLocalIndices, estimate)
    }

    /** `populateVertexEdgesFromParentFaces` (:566). */
    populateVertexEdgesFromParentFaces(): void {
        const p = this.parent, c = this.child
        for (let pFace = 0; pFace < p.getNumFaces(); ++pFace) {
            const cVert = this.faceChildVertIndex[pFace]
            if (!indexIsValid(cVert)) continue
            const pFaceVerts = p.getFaceVertices(pFace)
            const pFaceChildEdges = this.getFaceChildEdges(pFace)
            c.resizeVertexEdgesOf(cVert, pFaceVerts.size)
            const cVertEdges = c.getVertexEdges(cVert)
            const cVertInEdge = c.getVertexEdgeLocalIndices(cVert)
            let count = 0
            for (let j = 0; j < pFaceVerts.size; ++j) {
                const jLeadingEdge = j ? j - 1 : pFaceVerts.size - 1
                if (indexIsValid(pFaceChildEdges.get(jLeadingEdge))) {
                    cVertEdges.set(count, pFaceChildEdges.get(jLeadingEdge))
                    cVertInEdge.set(count, 0)
                    count++
                }
            }
            c.trimVertexEdges(cVert, count)
        }
    }

    /** `populateVertexEdgesFromParentEdges` (:599). */
    populateVertexEdgesFromParentEdges(): void {
        const p = this.parent, c = this.child
        for (let pEdge = 0; pEdge < p.getNumEdges(); ++pEdge) {
            const cVert = this.edgeChildVertIndex[pEdge]
            if (!indexIsValid(cVert)) continue
            const pEdgeFaces = p.getEdgeFaces(pEdge)
            const pEdgeInFace = p.getEdgeFaceLocalIndices(pEdge)
            const pEdgeVerts = p.getEdgeVertices(pEdge)
            const pEdgeChildEdges = this.getEdgeChildEdges(pEdge)
            c.resizeVertexEdgesOf(cVert, pEdgeFaces.size + 2)
            const cVertEdges = c.getVertexEdges(cVert)
            const cVertInEdge = c.getVertexEdgeLocalIndices(cVert)
            let count = 0
            if (indexIsValid(pEdgeChildEdges.get(0))) {
                cVertEdges.set(count, pEdgeChildEdges.get(0))
                cVertInEdge.set(count, 0)
                count++
            }
            if (indexIsValid(pEdgeChildEdges.get(1))) {
                cVertEdges.set(count, pEdgeChildEdges.get(1))
                cVertInEdge.set(count, 0)
                count++
            }
            const swap = (a: number, b: number) => {
                const e = cVertEdges.get(a); cVertEdges.set(a, cVertEdges.get(b)); cVertEdges.set(b, e)
                const l = cVertInEdge.get(a); cVertInEdge.set(a, cVertInEdge.get(b)); cVertInEdge.set(b, l)
            }
            for (let i = 0; i < pEdgeFaces.size; ++i) {
                const pFace = pEdgeFaces.get(i)
                const edgeInFace = pEdgeInFace.get(i)
                const cEdgeOfFace = this.getFaceChildEdges(pFace).get(edgeInFace)
                if (indexIsValid(cEdgeOfFace)) {
                    cVertEdges.set(count, cEdgeOfFace)
                    cVertInEdge.set(count, 1)
                    count++
                    if (i === 0 && count === 3) {
                        if (pEdgeVerts.get(0) !== pEdgeVerts.get(1) && p.getFaceVertices(pFace).get(edgeInFace) === pEdgeVerts.get(0)) swap(0, 1)
                        swap(1, 2)
                    }
                }
            }
            c.trimVertexEdges(cVert, count)
        }
    }

    /** `populateVertexEdgesFromParentVertices` (:664). */
    populateVertexEdgesFromParentVertices(): void {
        const p = this.parent, c = this.child
        for (let pVert = 0; pVert < p.getNumVertices(); ++pVert) {
            const cVert = this.vertChildVertIndex[pVert]
            if (!indexIsValid(cVert)) continue
            const pVertEdges = p.getVertexEdges(pVert)
            const pVertInEdge = p.getVertexEdgeLocalIndices(pVert)
            c.resizeVertexEdgesOf(cVert, pVertEdges.size)
            const cVertEdges = c.getVertexEdges(cVert)
            const cVertInEdge = c.getVertexEdgeLocalIndices(cVert)
            let count = 0
            for (let i = 0; i < pVertEdges.size; ++i) {
                const child = this.getEdgeChildEdges(pVertEdges.get(i)).get(pVertInEdge.get(i))
                if (indexIsValid(child)) {
                    cVertEdges.set(count, child)
                    cVertInEdge.set(count, 1)
                    count++
                }
            }
            c.trimVertexEdges(cVert, count)
        }
    }

    /** `markSparseFaceChildren` (:700). */
    markSparseFaceChildren(): void {
        const p = this.parent
        for (let pFace = 0; pFace < p.getNumFaces(); ++pFace) {
            const fChildFaces = this.getFaceChildFaces(pFace)
            const fChildEdges = this.getFaceChildEdges(pFace)
            const fVerts = p.getFaceVertices(pFace)
            const pFaceTag = this.parentFaceTag[pFace]
            if (pFaceTag.selected) {
                for (let i = 0; i < fVerts.size; ++i) {
                    fChildFaces.set(i, IndexSparseMaskSelected)
                    fChildEdges.set(i, IndexSparseMaskSelected)
                }
                this.faceChildVertIndex[pFace] = IndexSparseMaskSelected
                pFaceTag.transitional = 0
            } else {
                let marked = false
                for (let i = 0; i < fVerts.size; ++i) {
                    if (this.parentVertexTag[fVerts.get(i)].selected) {
                        const iPrev = i ? i - 1 : fVerts.size - 1
                        fChildFaces.set(i, IndexSparseMaskNeighboring)
                        fChildEdges.set(i, IndexSparseMaskNeighboring)
                        fChildEdges.set(iPrev, IndexSparseMaskNeighboring)
                        marked = true
                    }
                }
                if (marked) {
                    this.faceChildVertIndex[pFace] = IndexSparseMaskNeighboring
                    const fEdges = p.getFaceEdges(pFace)
                    const t = (k: number) => this.parentEdgeTag[fEdges.get(k)].transitional
                    if (fEdges.size === 4) pFaceTag.transitional = (t(0) << 0) | (t(1) << 1) | (t(2) << 2) | (t(3) << 3)
                    else if (fEdges.size === 3) pFaceTag.transitional = (t(0) << 0) | (t(1) << 1) | (t(2) << 2)
                    else {
                        pFaceTag.transitional = 0
                        for (let i = 0; i < fEdges.size; ++i) pFaceTag.transitional |= t(i)
                    }
                }
            }
        }
    }
}

/**
 * Port of OpenSubdiv v3_7_0 `opensubdiv/vtr/fvarRefinement.h` and `vtr/fvarRefinement.cpp` (Copyright 2014 DreamWorks
 * Animation LLC): refinement of one face-varying channel alongside its level's refinement.
 * Licensed under the Tomorrow Open Source Technology License 1.0 - see `OPENSUBDIV-LICENSE.txt` in this folder.
 */

import {Crease} from './sdc'
import type {Level} from './level'
import {FET_MISMATCH, FVarLevel, FVT_CREASE, FVT_DEP_SHARP, FVT_MISMATCH, FVT_SEMI_SHARP} from './fvarLevel'
import type {Refinement} from './refinement'
import {ET_SEMI_SHARP, resizeVector, VT_INF_SHARP, VT_SEMI_SHARP, VT_SEMI_SHARP_EDGES} from './vtrTypes'

export class FVarRefinement {
    readonly parentLevel: Level
    readonly childLevel: Level
    childValueParentSource: number[] = []

    /** `FVarRefinement::FVarRefinement` (:34). */
    constructor(readonly refinement: Refinement, readonly parentFVar: FVarLevel, readonly childFVar: FVarLevel) {
        this.parentLevel = refinement.parent
        this.childLevel = refinement.child
    }

    getChildValueParentSource(v: number, sibling: number): number {
        return this.childValueParentSource[this.childFVar.getVertexValueOffset(v, sibling)]
    }

    /** `applyRefinement` (:58). */
    applyRefinement(): void {
        const c = this.childFVar, p = this.parentFVar
        c.options = p.options.clone()
        c.isLinear = p.isLinear
        c.hasLinearBoundaries = p.hasLinearBoundaries
        c.hasDependentSharpness = p.hasDependentSharpness
        this.estimateAndAllocateChildValues()
        this.populateChildValues()
        this.trimAndFinalizeChildValues()
        this.propagateEdgeTags()
        this.propagateValueTags()
        if (c.hasSmoothBoundaries()) {
            this.propagateValueCreases()
            this.reclassifySemisharpValues()
        }
        if (c.getNumValues() > this.childLevel.getNumVertices()) c.initializeFaceValuesFromVertexFaceSiblings()
        else c.initializeFaceValuesFromFaceVertices()
    }

    /** `estimateAndAllocateChildValues` (:101). */
    estimateAndAllocateChildValues(): void {
        const r = this.refinement
        let max = r.getNumChildVerticesFromFaces()
        for (let cVert = r.getFirstChildVertexFromEdges(), end = cVert + r.getNumChildVerticesFromEdges(); cVert < end; ++cVert) {
            const pEdge = r.getChildVertexParentIndex(cVert)
            max += this.parentFVar.edgeTopologyMatches(pEdge) ? 1 : this.parentLevel.getEdgeFaces(pEdge).size
        }
        for (let cVert = r.getFirstChildVertexFromVertices(), end = cVert + r.getNumChildVerticesFromVertices(); cVert < end; ++cVert) {
            max += this.parentFVar.getNumVertexValues(r.getChildVertexParentIndex(cVert))
        }
        this.childFVar.resizeComponents()
        resizeVector(this.childFVar.vertValueTags, max)
        resizeVector(this.childValueParentSource, max)
    }

    /** `trimAndFinalizeChildValues` (:131). */
    trimAndFinalizeChildValues(): void {
        const c = this.childFVar
        resizeVector(c.vertValueTags, c.valueCount)
        if (c.hasSmoothBoundaries()) {
            while (c.vertValueCreaseEnds.length < c.valueCount) c.vertValueCreaseEnds.push({startFace: 0, endFace: 0})
            c.vertValueCreaseEnds.length = c.valueCount
        }
        resizeVector(this.childValueParentSource, c.valueCount)
        resizeVector(c.vertValueIndices, c.valueCount)
        for (let i = 0; i < c.valueCount; ++i) c.vertValueIndices[i] = i
    }

    /** `populateChildValuesForEdgeVertex` (:148). */
    populateChildValuesForEdgeVertex(cVert: number, pEdge: number): number {
        const pEdgeFaces = this.parentLevel.getEdgeFaces(pEdge)
        if (pEdgeFaces.size === 1) return 1
        const cValueCount = pEdgeFaces.size
        const cValueOffset = this.childFVar.getVertexValueOffset(cVert)
        for (let i = 0; i < cValueCount; ++i) this.childValueParentSource[cValueOffset + i] = i
        const cVertFaces = this.childLevel.getVertexFaces(cVert)
        const cVertFaceSiblings = this.childFVar.getVertexFaceSiblings(cVert)
        for (let i = 0; i < cVertFaceSiblings.size; ++i) {
            const pFaceI = this.refinement.getChildFaceParentFace(cVertFaces.get(i))
            if (pEdgeFaces.size === 2) {
                if (pFaceI === pEdgeFaces.get(1)) cVertFaceSiblings.set(i, 1)
            } else {
                for (let j = 0; j < pEdgeFaces.size; ++j) if (pFaceI === pEdgeFaces.get(j)) cVertFaceSiblings.set(i, j)
            }
        }
        return cValueCount
    }

    /** `populateChildValuesForVertexVertex` (:193). */
    populateChildValuesForVertexVertex(cVert: number, pVert: number): number {
        const cValueCount = this.parentFVar.getNumVertexValues(pVert)
        if (cValueCount > 1) {
            const cValueIndex = this.childFVar.getVertexValueOffset(cVert)
            for (let j = 1; j < cValueCount; ++j) this.childValueParentSource[cValueIndex + j] = j
            const pSib = this.parentFVar.getVertexFaceSiblings(pVert)
            const cSib = this.childFVar.getVertexFaceSiblings(cVert)
            for (let j = 0; j < cSib.size; ++j) cSib.set(j, pSib.get(j))
        }
        return cValueCount
    }

    /** `populateChildValues` (:223) and the three passes (:240-290). */
    populateChildValues(): void {
        const r = this.refinement, c = this.childFVar, p = this.parentFVar
        c.valueCount = 0
        const fromFaces = () => {
            for (let cVert = r.getFirstChildVertexFromFaces(), end = cVert + r.getNumChildVerticesFromFaces(); cVert < end; ++cVert) {
                c.vertSiblingOffsets[cVert] = c.valueCount
                c.vertSiblingCounts[cVert] = 1
                c.valueCount++
            }
        }
        const fromEdges = () => {
            for (let cVert = r.getFirstChildVertexFromEdges(), end = cVert + r.getNumChildVerticesFromEdges(); cVert < end; ++cVert) {
                const pEdge = r.getChildVertexParentIndex(cVert)
                c.vertSiblingOffsets[cVert] = c.valueCount
                if (p.edgeTopologyMatches(pEdge)) {
                    c.vertSiblingCounts[cVert] = 1
                    c.valueCount++
                } else {
                    const n = this.populateChildValuesForEdgeVertex(cVert, pEdge)
                    c.vertSiblingCounts[cVert] = n & 0xffff
                    c.valueCount += n
                }
            }
        }
        const fromVerts = () => {
            for (let cVert = r.getFirstChildVertexFromVertices(), end = cVert + r.getNumChildVerticesFromVertices(); cVert < end; ++cVert) {
                const pVert = r.getChildVertexParentIndex(cVert)
                c.vertSiblingOffsets[cVert] = c.valueCount
                if (p.valueTopologyMatches(p.getVertexValueOffset(pVert))) {
                    c.vertSiblingCounts[cVert] = 1
                    c.valueCount++
                } else {
                    const n = this.populateChildValuesForVertexVertex(cVert, pVert)
                    c.vertSiblingCounts[cVert] = n & 0xffff
                    c.valueCount += n
                }
            }
        }
        if (r.hasFaceVerticesFirst()) {
            fromFaces()
            fromEdges()
            fromVerts()
        } else {
            fromVerts()
            fromFaces()
            fromEdges()
        }
    }

    /** `propagateEdgeTags` (:300). */
    propagateEdgeTags(): void {
        const r = this.refinement
        for (let e = 0; e < r.getNumChildEdgesFromFaces(); ++e) this.childFVar.edgeTags[e] = 0
        for (let e = r.getNumChildEdgesFromFaces(); e < this.childLevel.getNumEdges(); ++e) {
            this.childFVar.edgeTags[e] = this.parentFVar.edgeTags[r.getChildEdgeParentIndex(e)]
        }
    }

    /** `propagateValueTags` (:327). */
    propagateValueTags(): void {
        const r = this.refinement, c = this.childFVar, p = this.parentFVar
        const valTagMatch = 0
        let cVert = r.getFirstChildVertexFromFaces()
        let cVertValue = c.getVertexValueOffset(cVert)
        for (let end = cVert + r.getNumChildVerticesFromFaces(); cVert < end; ++cVert, ++cVertValue) c.vertValueTags[cVertValue] = valTagMatch
        const valTagMismatch = FVT_MISMATCH
        const valTagCrease = valTagMismatch | FVT_CREASE
        const valTagSplitEdge = p.hasSmoothBoundaries() ? valTagCrease : valTagMismatch
        for (let v = r.getFirstChildVertexFromEdges(), end = v + r.getNumChildVerticesFromEdges(); v < end; ++v) {
            const pEdge = r.getChildVertexParentIndex(v)
            const o = c.getVertexValueOffset(v), n = c.getNumVertexValues(v)
            const pEdgeTag = p.edgeTags[pEdge]
            const value = pEdgeTag & FET_MISMATCH || p.getEdgeTag(pEdge).linear ? valTagSplitEdge : valTagMatch
            for (let i = 0; i < n; i++) c.vertValueTags[o + i] = value
        }
        for (let v = r.getFirstChildVertexFromVertices(), end = v + r.getNumChildVerticesFromVertices(); v < end; ++v) {
            const pVert = r.getChildVertexParentIndex(v)
            const po = p.getVertexValueOffset(pVert), pn = p.getNumVertexValues(pVert)
            const co = c.getVertexValueOffset(v)
            for (let i = 0; i < pn; i++) c.vertValueTags[co + i] = p.vertValueTags[po + i]
        }
    }

    /** `propagateValueCreases` (:398). */
    propagateValueCreases(): void {
        const r = this.refinement, c = this.childFVar, p = this.parentFVar
        const incChildFacesPerEdge = r.getRegularFaceSize() === 4 ? 2 : 3
        for (let v = r.getFirstChildVertexFromEdges(), end = v + r.getNumChildVerticesFromEdges(); v < end; ++v) {
            const tags = c.getVertexValueTags(v)
            if (!tags[0].isMismatch()) continue
            if (!r.isChildVertexComplete(v)) continue
            const o = c.getVertexValueOffset(v)
            let creaseStartFace = 0
            let creaseEndFace = creaseStartFace + incChildFacesPerEdge - 1
            for (let i = 0; i < tags.length; ++i) {
                if (!tags[i].isInfSharp()) {
                    c.vertValueCreaseEnds[o + i].startFace = creaseStartFace & 0xffff
                    c.vertValueCreaseEnds[o + i].endFace = creaseEndFace & 0xffff
                }
                creaseStartFace += incChildFacesPerEdge
                creaseEndFace += incChildFacesPerEdge
            }
        }
        for (let v = r.getFirstChildVertexFromVertices(), end = v + r.getNumChildVerticesFromVertices(); v < end; ++v) {
            const tags = c.getVertexValueTags(v)
            if (!tags[0].isMismatch()) continue
            if (!r.isChildVertexComplete(v)) continue
            const pVert = r.getChildVertexParentIndex(v)
            const po = p.getVertexValueOffset(pVert), co = c.getVertexValueOffset(v)
            for (let j = 0; j < tags.length; ++j) {
                if (!tags[j].isInfSharp()) {
                    c.vertValueCreaseEnds[co + j].startFace = p.vertValueCreaseEnds[po + j].startFace
                    c.vertValueCreaseEnds[co + j].endFace = p.vertValueCreaseEnds[po + j].endFace
                }
            }
        }
    }

    /** `reclassifySemisharpValues` (:463). */
    reclassifySemisharpValues(): void {
        const r = this.refinement, c = this.childFVar
        const hasDependentSharpness = this.parentFVar.hasDependentSharpness
        for (let v = r.getFirstChildVertexFromVertices(), end = v + r.getNumChildVerticesFromVertices(); v < end; ++v) {
            const o = c.getVertexValueOffset(v), n = c.getNumVertexValues(v)
            if (!(c.vertValueTags[o] & FVT_MISMATCH)) continue
            if (!r.isChildVertexComplete(v)) continue
            const pVert = r.getChildVertexParentIndex(v)
            const pVertTags = this.parentLevel.getVertexTag(pVert)
            if (!(pVertTags & VT_SEMI_SHARP) && !(pVertTags & VT_SEMI_SHARP_EDGES)) continue
            const cVertTags = this.childLevel.getVertexTag(v)
            if ((cVertTags & VT_SEMI_SHARP) || (cVertTags & VT_INF_SHARP)) continue
            const toCrease = (j: number) => {
                c.vertValueTags[o + j] = (c.vertValueTags[o + j] & ~(FVT_SEMI_SHARP | FVT_DEP_SHARP)) | FVT_CREASE
            }
            if (!(cVertTags & VT_SEMI_SHARP) && !(cVertTags & VT_SEMI_SHARP_EDGES)) {
                for (let j = 0; j < n; ++j) if (c.vertValueTags[o + j] & FVT_SEMI_SHARP) toCrease(j)
                continue
            }
            let cVertEdges: number[]
            if (this.childLevel.getNumVertexEdgesTotal()) {
                cVertEdges = this.childLevel.getVertexEdges(v).toArray()
            } else {
                const pVertEdges = this.parentLevel.getVertexEdges(pVert)
                const pVertInEdge = this.parentLevel.getVertexEdgeLocalIndices(pVert)
                cVertEdges = []
                for (let i = 0; i < pVertEdges.size; ++i) cVertEdges[i] = r.getEdgeChildEdges(pVertEdges.get(i)).get(pVertInEdge.get(i))
            }
            const semi = (e: number) => (this.childLevel.getEdgeTag(e) & ET_SEMI_SHARP) !== 0
            for (let j = 0; j < n; ++j) {
                const t = c.vertValueTags[o + j]
                if ((t & FVT_SEMI_SHARP) && !(t & FVT_DEP_SHARP)) {
                    const vStartFace = c.vertValueCreaseEnds[o + j].startFace
                    const vEndFace = c.vertValueCreaseEnds[o + j].endFace
                    let isStillSemiSharp = false
                    if (vEndFace > vStartFace) {
                        for (let k = vStartFace + 1; !isStillSemiSharp && k <= vEndFace; ++k) isStillSemiSharp = semi(cVertEdges[k])
                    } else if (vStartFace > vEndFace) {
                        for (let k = vStartFace + 1; !isStillSemiSharp && k < cVertEdges.length; ++k) isStillSemiSharp = semi(cVertEdges[k])
                        for (let k = 0; !isStillSemiSharp && k <= vEndFace; ++k) isStillSemiSharp = semi(cVertEdges[k])
                    }
                    if (!isStillSemiSharp) toCrease(j)
                }
            }
            if (n === 2 && hasDependentSharpness) {
                const t0 = c.vertValueTags[o], t1 = c.vertValueTags[o + 1]
                if ((t0 & FVT_DEP_SHARP) && !(t1 & FVT_SEMI_SHARP)) c.vertValueTags[o] = t0 & ~FVT_DEP_SHARP
                else if ((t1 & FVT_DEP_SHARP) && !(t0 & FVT_SEMI_SHARP)) c.vertValueTags[o + 1] = t1 & ~FVT_DEP_SHARP
            }
        }
    }

    /** `getFractionalWeight` (:578). */
    getFractionalWeight(pVert: number, pSibling: number, cVert: number): number {
        const r = this.refinement
        const pVertEdges = this.parentLevel.getVertexEdges(pVert)
        let cVertEdges: number[]
        if (this.childLevel.getNumVertexEdgesTotal()) {
            cVertEdges = this.childLevel.getVertexEdges(cVert).toArray()
        } else {
            const pVertInEdge = this.parentLevel.getVertexEdgeLocalIndices(pVert)
            cVertEdges = []
            for (let i = 0; i < pVertEdges.size; ++i) cVertEdges[i] = r.getEdgeChildEdges(pVertEdges.get(i)).get(pVertInEdge.get(i))
        }
        const pEdgeSharpness: number[] = [], cEdgeSharpness: number[] = []
        const ends = this.parentFVar.vertValueCreaseEnds[this.parentFVar.getVertexValueOffset(pVert, pSibling)]
        const pStartFace = ends.startFace, pEndFace = ends.endFace
        let interiorEdgeCount = 0
        const take = (i: number) => {
            pEdgeSharpness[interiorEdgeCount] = this.parentLevel.getEdgeSharpness(pVertEdges.get(i))
            cEdgeSharpness[interiorEdgeCount] = this.childLevel.getEdgeSharpness(cVertEdges[i])
            interiorEdgeCount++
        }
        if (pEndFace > pStartFace) {
            for (let i = pStartFace + 1; i <= pEndFace; ++i) take(i)
        } else if (pStartFace > pEndFace) {
            for (let i = pStartFace + 1; i < pVertEdges.size; ++i) take(i)
            for (let i = 0; i <= pEndFace; ++i) take(i)
        }
        return new Crease(r.getOptions()).computeFractionalWeightAtVertex(this.parentLevel.getVertexSharpness(pVert), this.childLevel.getVertexSharpness(cVert),
            interiorEdgeCount, pEdgeSharpness, cEdgeSharpness)
    }
}


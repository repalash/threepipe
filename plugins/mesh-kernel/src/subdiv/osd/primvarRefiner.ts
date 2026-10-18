/**
 * Port of OpenSubdiv v3_7_0 `opensubdiv/far/primvarRefiner.h` (`PrimvarRefinerReal<float>`: `Interpolate`,
 * `InterpolateVarying`, `InterpolateFaceVarying`) and `opensubdiv/vtr/componentInterfaces.h` (Copyright 2014 DreamWorks
 * Animation LLC). The limit (`Limit`, `LimitFaceVarying`) and uniform-face interpolation are not ported (Blender
 * evaluates patches).
 * Licensed under the Tomorrow Open Source Technology License 1.0 - see `OPENSUBDIV-LICENSE.txt` in this folder.
 *
 * Instantiated by `StencilTableFactory::Create` inside the OpenSubdiv library (clang `-ffp-contract=on`): the masks it
 * computes (`sdc.ts`) fuse where clang fuses; the `AddWithWeight` sinks decide their own arithmetic.
 */

import {f32} from '../../blender/f32'
import {fmaf} from '../../blender/fma'
import {Crease, EdgeNeighborhood, FaceNeighborhood, Mask, Rule, Scheme, SchemeType, VertexNeighborhood} from './sdc'
import type {Level} from './level'
import type {TopologyRefiner} from './topologyRefiner'

/** A destination primvar element (`U` in `primvarRefiner.h`): `Clear` and `AddWithWeight(src, weight)`. */
export interface PrimvarElement<S> {
    clear(): void
    addWithWeight(src: S, weight: number): void
}

/** `src[i]` / `dst[i]` of `primvarRefiner.h`: element access by index. */
export interface PrimvarBuffer<E> {
    at(index: number): E
}

/** `PrimvarRefinerReal::Mask` (`primvarRefiner.h:195`). */
class PrimvarMask implements Mask {
    vCount = 0
    eCount = 0
    fCount = 0
    centers = false
    constructor(readonly v: number[], readonly e: number[], readonly f: number[]) {}
    setNumVertexWeights(n: number) { this.vCount = n }
    setNumEdgeWeights(n: number) { this.eCount = n }
    setNumFaceWeights(n: number) { this.fCount = n }
    getNumVertexWeights() { return this.vCount }
    getNumEdgeWeights() { return this.eCount }
    getNumFaceWeights() { return this.fCount }
    setFaceWeightsForFaceCenters(on: boolean) { this.centers = on }
    areFaceWeightsForFaceCenters() { return this.centers }
    vertexWeight(i: number) { return this.v[i] }
    edgeWeight(i: number) { return this.e[i] }
    faceWeight(i: number) { return this.f[i] }
    setVertexWeight(i: number, w: number) { this.v[i] = w }
    setEdgeWeight(i: number, w: number) { this.e[i] = w }
    setFaceWeight(i: number, w: number) { this.f[i] = w }
}

/** `Vtr::internal::FaceInterface` (`componentInterfaces.h:40`). */
class FaceInterface implements FaceNeighborhood {
    constructor(readonly vertCount: number) {}
    getNumVertices() { return this.vertCount }
}

/** `Vtr::internal::EdgeInterface` (`componentInterfaces.h:52`). */
class EdgeInterface implements EdgeNeighborhood {
    eIndex = 0
    constructor(readonly level: Level) {}
    setIndex(e: number) { this.eIndex = e }
    getNumFaces() { return this.level.getEdgeFaces(this.eIndex).size }
    getSharpness() { return this.level.getEdgeSharpness(this.eIndex) }
    getChildSharpnesses(_crease: Crease, s: number[]): void {
        s[0] = s[1] = f32(this.getSharpness() - 1)
    }
    getNumVerticesPerFace(vertsPerFace: number[]): void {
        const eFaces = this.level.getEdgeFaces(this.eIndex)
        for (let i = 0; i < eFaces.size; ++i) vertsPerFace[i] = this.level.getFaceVertices(eFaces.get(i)).size
    }
}

/** `Vtr::internal::VertexInterface` (`componentInterfaces.h:85`). */
class VertexInterface implements VertexNeighborhood {
    pIndex = 0
    cIndex = 0
    eCount = 0
    fCount = 0
    constructor(readonly parent: Level, readonly child: Level) {}
    setIndex(p: number, c: number): void {
        this.pIndex = p
        this.cIndex = c
        this.eCount = this.parent.getVertexEdges(p).size
        this.fCount = this.parent.getVertexFaces(p).size
    }
    getNumEdges() { return this.eCount }
    getNumFaces() { return this.fCount }
    getSharpness() { return this.parent.getVertexSharpness(this.pIndex) }
    getSharpnessPerEdge(out: number[]): number[] {
        const pEdges = this.parent.getVertexEdges(this.pIndex)
        for (let i = 0; i < this.eCount; ++i) out[i] = this.parent.getEdgeSharpness(pEdges.get(i))
        return out
    }
    getChildSharpness() { return this.child.getVertexSharpness(this.cIndex) }
    getChildSharpnessPerEdge(crease: Crease, out: number[]): number[] {
        const p = this.getSharpnessPerEdge(new Array(this.eCount).fill(0))
        crease.subdivideEdgeSharpnessesAroundVertex(this.eCount, p, out)
        return out
    }
}

/** `Far::PrimvarRefinerReal<float>` (`primvarRefiner.h:41`). */
export class PrimvarRefiner {
    constructor(readonly refiner: TopologyRefiner) {}

    /** `Interpolate` (:250). */
    interpolate<S>(level: number, src: PrimvarBuffer<S>, dst: PrimvarBuffer<PrimvarElement<S> & S>): void {
        if (this.refiner.getSchemeType() === SchemeType.LOOP) throw new Error('OpenSubdiv: the Loop scheme is not ported')
        this.interpFromFaces(level, src, dst)
        this.interpFromEdges(level, src, dst)
        this.interpFromVerts(level, src, dst)
    }

    /** `InterpolateFaceVarying` (:276). */
    interpolateFaceVarying<S>(level: number, src: PrimvarBuffer<S>, dst: PrimvarBuffer<PrimvarElement<S> & S>, channel: number): void {
        if (this.refiner.getSchemeType() === SchemeType.LOOP) throw new Error('OpenSubdiv: the Loop scheme is not ported')
        this.interpFVarFromFaces(level, src, dst, channel)
        this.interpFVarFromEdges(level, src, dst, channel)
        this.interpFVarFromVerts(level, src, dst, channel)
    }

    /** `InterpolateVarying` (:395). */
    interpolateVarying<S>(level: number, src: PrimvarBuffer<S>, dst: PrimvarBuffer<PrimvarElement<S> & S>): void {
        const refinement = this.refiner.getRefinement(level - 1)
        const parent = refinement.parent
        if (refinement.getNumChildVerticesFromFaces() > 0) {
            for (let face = 0; face < parent.getNumFaces(); ++face) {
                const cVert = refinement.getFaceChildVertex(face)
                if (cVert < 0) continue
                const fVerts = parent.getFaceVertices(face)
                const fVaryingWeight = f32(1 / fVerts.size)
                const d = dst.at(cVert)
                d.clear()
                for (let i = 0; i < fVerts.size; ++i) d.addWithWeight(src.at(fVerts.get(i)), fVaryingWeight)
            }
        }
        for (let edge = 0; edge < parent.getNumEdges(); ++edge) {
            const cVert = refinement.getEdgeChildVertex(edge)
            if (cVert < 0) continue
            const eVerts = parent.getEdgeVertices(edge)
            const d = dst.at(cVert)
            d.clear()
            d.addWithWeight(src.at(eVerts.get(0)), 0.5)
            d.addWithWeight(src.at(eVerts.get(1)), 0.5)
        }
        for (let vert = 0; vert < parent.getNumVertices(); ++vert) {
            const cVert = refinement.getVertexChildVertex(vert)
            if (cVert < 0) continue
            const d = dst.at(cVert)
            d.clear()
            d.addWithWeight(src.at(vert), 1)
        }
    }

    private scheme(): Scheme {
        return new Scheme(this.refiner.getSchemeType(), this.refiner.getSchemeOptions())
    }

    /** `interpFromFaces` (:458). */
    private interpFromFaces<S>(level: number, src: PrimvarBuffer<S>, dst: PrimvarBuffer<PrimvarElement<S> & S>): void {
        const refinement = this.refiner.getRefinement(level - 1)
        const parent = refinement.parent
        if (refinement.getNumChildVerticesFromFaces() === 0) return
        const scheme = this.scheme()
        const fVertWeights: number[] = []
        for (let face = 0; face < parent.getNumFaces(); ++face) {
            const cVert = refinement.getFaceChildVertex(face)
            if (cVert < 0) continue
            const fVerts = parent.getFaceVertices(face)
            const fMask = new PrimvarMask(fVertWeights, [], [])
            scheme.computeFaceVertexMask(new FaceInterface(fVerts.size), fMask)
            const d = dst.at(cVert)
            d.clear()
            for (let i = 0; i < fVerts.size; ++i) d.addWithWeight(src.at(fVerts.get(i)), fVertWeights[i])
        }
    }

    /** `interpFromEdges` (:496). */
    private interpFromEdges<S>(level: number, src: PrimvarBuffer<S>, dst: PrimvarBuffer<PrimvarElement<S> & S>): void {
        const refinement = this.refiner.getRefinement(level - 1)
        const parent = refinement.parent
        const child = refinement.child
        const scheme = this.scheme()
        const eHood = new EdgeInterface(parent)
        const eVertWeights = [0, 0]
        const eFaceWeights: number[] = []
        for (let edge = 0; edge < parent.getNumEdges(); ++edge) {
            const cVert = refinement.getEdgeChildVertex(edge)
            if (cVert < 0) continue
            const eVerts = parent.getEdgeVertices(edge)
            const eFaces = parent.getEdgeFaces(edge)
            const eMask = new PrimvarMask(eVertWeights, [], eFaceWeights)
            eHood.setIndex(edge)
            const pRule = parent.getEdgeSharpness(edge) > 0 ? Rule.CREASE : Rule.SMOOTH
            const cRule = child.getVertexRule(cVert)
            scheme.computeEdgeVertexMask(eHood, eMask, pRule, cRule)
            const d = dst.at(cVert)
            d.clear()
            d.addWithWeight(src.at(eVerts.get(0)), eVertWeights[0])
            d.addWithWeight(src.at(eVerts.get(1)), eVertWeights[1])
            if (eMask.getNumFaceWeights() > 0) {
                for (let i = 0; i < eFaces.size; ++i) {
                    if (eMask.areFaceWeightsForFaceCenters()) {
                        const cVertOfFace = refinement.getFaceChildVertex(eFaces.get(i))
                        d.addWithWeight(dst.at(cVertOfFace), eFaceWeights[i])
                    } else {
                        const pFace = eFaces.get(i)
                        const pFaceEdges = parent.getFaceEdges(pFace)
                        const pFaceVerts = parent.getFaceVertices(pFace)
                        let eInFace = 0
                        for (; pFaceEdges.get(eInFace) !== edge; ++eInFace);
                        let vInFace = eInFace + 2
                        if (vInFace >= pFaceVerts.size) vInFace -= pFaceVerts.size
                        d.addWithWeight(src.at(pFaceVerts.get(vInFace)), eFaceWeights[i])
                    }
                }
            }
        }
    }

    /** `interpFromVerts` (:566). */
    private interpFromVerts<S>(level: number, src: PrimvarBuffer<S>, dst: PrimvarBuffer<PrimvarElement<S> & S>): void {
        const refinement = this.refiner.getRefinement(level - 1)
        const parent = refinement.parent
        const child = refinement.child
        const scheme = this.scheme()
        const vHood = new VertexInterface(parent, child)
        for (let vert = 0; vert < parent.getNumVertices(); ++vert) {
            const cVert = refinement.getVertexChildVertex(vert)
            if (cVert < 0) continue
            const vEdges = parent.getVertexEdges(vert)
            const vFaces = parent.getVertexFaces(vert)
            const vVertWeight = [0], vEdgeWeights: number[] = [], vFaceWeights: number[] = []
            const vMask = new PrimvarMask(vVertWeight, vEdgeWeights, vFaceWeights)
            vHood.setIndex(vert, cVert)
            scheme.computeVertexVertexMask(vHood, vMask, parent.getVertexRule(vert), child.getVertexRule(cVert))
            const d = dst.at(cVert)
            d.clear()
            if (vMask.getNumFaceWeights() > 0) {
                for (let i = 0; i < vFaces.size; ++i) d.addWithWeight(dst.at(refinement.getFaceChildVertex(vFaces.get(i))), vFaceWeights[i])
            }
            if (vMask.getNumEdgeWeights() > 0) {
                for (let i = 0; i < vEdges.size; ++i) {
                    const eVerts = parent.getEdgeVertices(vEdges.get(i))
                    const pVertOppositeEdge = eVerts.get(0) === vert ? eVerts.get(1) : eVerts.get(0)
                    d.addWithWeight(src.at(pVertOppositeEdge), vEdgeWeights[i])
                }
            }
            d.addWithWeight(src.at(vert), vVertWeight[0])
        }
    }

    /** `interpFVarFromFaces` (:640). */
    private interpFVarFromFaces<S>(level: number, src: PrimvarBuffer<S>, dst: PrimvarBuffer<PrimvarElement<S> & S>, channel: number): void {
        const refinement = this.refiner.getRefinement(level - 1)
        if (refinement.getNumChildVerticesFromFaces() === 0) return
        const scheme = this.scheme()
        const parentLevel = refinement.parent, childLevel = refinement.child
        const parentFVar = parentLevel.getFVarLevel(channel), childFVar = childLevel.getFVarLevel(channel)
        const fValueWeights: number[] = []
        for (let face = 0; face < parentLevel.getNumFaces(); ++face) {
            const cVert = refinement.getFaceChildVertex(face)
            if (cVert < 0) continue
            const cVertValue = childFVar.getVertexValueOffset(cVert)
            const fValues = parentFVar.getFaceValues(face)
            scheme.computeFaceVertexMask(new FaceInterface(fValues.size), new PrimvarMask(fValueWeights, [], []))
            const d = dst.at(cVertValue)
            d.clear()
            for (let i = 0; i < fValues.size; ++i) d.addWithWeight(src.at(fValues.get(i)), fValueWeights[i])
        }
    }

    /** `interpFVarFromEdges` (:684). */
    private interpFVarFromEdges<S>(level: number, src: PrimvarBuffer<S>, dst: PrimvarBuffer<PrimvarElement<S> & S>, channel: number): void {
        const refinement = this.refiner.getRefinement(level - 1)
        const scheme = this.scheme()
        const parentLevel = refinement.parent, childLevel = refinement.child
        const refineFVar = refinement.getFVarRefinement(channel)
        const parentFVar = parentLevel.getFVarLevel(channel), childFVar = childLevel.getFVarLevel(channel)
        const eVertWeights = [0, 0]
        const eFaceWeights: number[] = []
        const eMask = new PrimvarMask(eVertWeights, [], eFaceWeights)
        const isLinearFVar = parentFVar.isLinear || this.refiner.getSchemeType() === SchemeType.BILINEAR
        if (isLinearFVar) {
            eMask.setNumVertexWeights(2)
            eMask.setNumEdgeWeights(0)
            eMask.setNumFaceWeights(0)
            eVertWeights[0] = 0.5
            eVertWeights[1] = 0.5
        }
        const eHood = new EdgeInterface(parentLevel)
        for (let edge = 0; edge < parentLevel.getNumEdges(); ++edge) {
            const cVert = refinement.getEdgeChildVertex(edge)
            if (cVert < 0) continue
            const cVertValues = childFVar.getVertexValues(cVert)
            if (childFVar.valueTopologyMatches(cVertValues.get(0))) {
                if (!isLinearFVar) {
                    eHood.setIndex(edge)
                    const pRule = parentLevel.getEdgeSharpness(edge) > 0 ? Rule.CREASE : Rule.SMOOTH
                    scheme.computeEdgeVertexMask(eHood, eMask, pRule, childLevel.getVertexRule(cVert))
                }
                const eVertValues = parentFVar.getEdgeFaceValues(edge, 0)
                const d = dst.at(cVertValues.get(0))
                d.clear()
                d.addWithWeight(src.at(eVertValues[0]), eVertWeights[0])
                d.addWithWeight(src.at(eVertValues[1]), eVertWeights[1])
                if (eMask.getNumFaceWeights() > 0) {
                    const eFaces = parentLevel.getEdgeFaces(edge)
                    for (let i = 0; i < eFaces.size; ++i) {
                        if (eMask.areFaceWeightsForFaceCenters()) {
                            const cVertOfFace = refinement.getFaceChildVertex(eFaces.get(i))
                            d.addWithWeight(dst.at(childFVar.getVertexValueOffset(cVertOfFace)), eFaceWeights[i])
                        } else {
                            const pFace = eFaces.get(i)
                            const pFaceEdges = parentLevel.getFaceEdges(pFace)
                            const pFaceVerts = parentLevel.getFaceVertices(pFace)
                            let eInFace = 0
                            for (; pFaceEdges.get(eInFace) !== edge; ++eInFace);
                            let vInFace = eInFace + 2
                            if (vInFace >= pFaceVerts.size) vInFace -= pFaceVerts.size
                            d.addWithWeight(src.at(parentFVar.getFaceValues(pFace).get(vInFace)), eFaceWeights[i])
                        }
                    }
                }
            } else {
                for (let i = 0; i < cVertValues.size; ++i) {
                    const eFaceIndex = refineFVar.getChildValueParentSource(cVert, i)
                    const eVertValues = parentFVar.getEdgeFaceValues(edge, eFaceIndex)
                    const d = dst.at(cVertValues.get(i))
                    d.clear()
                    d.addWithWeight(src.at(eVertValues[0]), 0.5)
                    d.addWithWeight(src.at(eVertValues[1]), 0.5)
                }
            }
        }
    }

    /** `interpFVarFromVerts` (:788). */
    private interpFVarFromVerts<S>(level: number, src: PrimvarBuffer<S>, dst: PrimvarBuffer<PrimvarElement<S> & S>, channel: number): void {
        const refinement = this.refiner.getRefinement(level - 1)
        const scheme = this.scheme()
        const parentLevel = refinement.parent, childLevel = refinement.child
        const refineFVar = refinement.getFVarRefinement(channel)
        const parentFVar = parentLevel.getFVarLevel(channel), childFVar = childLevel.getFVarLevel(channel)
        const isLinearFVar = parentFVar.isLinear || this.refiner.getSchemeType() === SchemeType.BILINEAR
        const vEdgeValues: number[] = []
        const vHood = new VertexInterface(parentLevel, childLevel)
        for (let vert = 0; vert < parentLevel.getNumVertices(); ++vert) {
            const cVert = refinement.getVertexChildVertex(vert)
            if (cVert < 0) continue
            const pVertValues = parentFVar.getVertexValues(vert)
            const cVertValues = childFVar.getVertexValues(cVert)
            const matches = childFVar.valueTopologyMatches(cVertValues.get(0))
            if (isLinearFVar && matches) {
                const d = dst.at(cVertValues.get(0))
                d.clear()
                d.addWithWeight(src.at(pVertValues.get(0)), 1)
                continue
            }
            if (matches) {
                const vEdges = parentLevel.getVertexEdges(vert)
                const vVertWeight = [0], vEdgeWeights: number[] = [], vFaceWeights: number[] = []
                const vMask = new PrimvarMask(vVertWeight, vEdgeWeights, vFaceWeights)
                vHood.setIndex(vert, cVert)
                scheme.computeVertexVertexMask(vHood, vMask, parentLevel.getVertexRule(vert), childLevel.getVertexRule(cVert))
                const d = dst.at(cVertValues.get(0))
                d.clear()
                if (vMask.getNumFaceWeights() > 0) {
                    const vFaces = parentLevel.getVertexFaces(vert)
                    for (let i = 0; i < vFaces.size; ++i) {
                        const cVertOfFace = refinement.getFaceChildVertex(vFaces.get(i))
                        d.addWithWeight(dst.at(childFVar.getVertexValueOffset(cVertOfFace)), vFaceWeights[i])
                    }
                }
                if (vMask.getNumEdgeWeights() > 0) {
                    parentFVar.getVertexEdgeValues(vert, vEdgeValues)
                    for (let i = 0; i < vEdges.size; ++i) d.addWithWeight(src.at(vEdgeValues[i]), vEdgeWeights[i])
                }
                d.addWithWeight(src.at(pVertValues.get(0)), vVertWeight[0])
            } else {
                const pValueTags = parentFVar.getVertexValueTags(vert)
                const cValueTags = childFVar.getVertexValueTags(cVert)
                for (let cSibling = 0; cSibling < cVertValues.size; ++cSibling) {
                    const pSibling = refineFVar.getChildValueParentSource(cVert, cSibling)
                    const pVertValue = pVertValues.get(pSibling)
                    const d = dst.at(cVertValues.get(cSibling))
                    d.clear()
                    if (isLinearFVar || cValueTags[cSibling].isCorner()) {
                        d.addWithWeight(src.at(pVertValue), 1)
                    } else {
                        const pEndValues = parentFVar.getVertexCreaseEndValues(vert, pSibling)
                        let vWeight = 0.75
                        let eWeight = 0.125
                        if (pValueTags[pSibling].isSemiSharp()) {
                            const wCorner = pValueTags[pSibling].isDepSharp()
                                ? refineFVar.getFractionalWeight(vert, pSibling ? 0 : 1, cVert)
                                : refineFVar.getFractionalWeight(vert, pSibling, cVert)
                            const wCrease = f32(1 - wCorner)
                            // `wCrease * 0.75f + wCorner` (fused).
                            vWeight = fmaf(wCrease, 0.75, wCorner)
                            eWeight = f32(wCrease * 0.125)
                        }
                        d.addWithWeight(src.at(pEndValues[0]), eWeight)
                        d.addWithWeight(src.at(pEndValues[1]), eWeight)
                        d.addWithWeight(src.at(pVertValue), vWeight)
                    }
                }
            }
        }
    }
}

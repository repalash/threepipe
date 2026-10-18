/**
 * Port of OpenSubdiv v3_7_0 `opensubdiv/vtr/fvarLevel.h` and `vtr/fvarLevel.cpp` (Copyright 2014 DreamWorks Animation
 * LLC): face-varying topology of one level. `validate` and `print` (debugging aids) are not ported.
 * Licensed under the Tomorrow Open Source Technology License 1.0 - see `OPENSUBDIV-LICENSE.txt` in this folder.
 */

import {FVarLinearInterpolation, Options, Rule, VtxBoundaryInterpolation} from './sdc'
import type {Level} from './level'
import {
    ET_BOUNDARY, ET_INF_SHARP, ET_SEMI_SHARP, IndexArray, resizeVector, VT_BOUNDARY, VT_CORNER, VT_INF_IRREGULAR, VT_INF_SHARP,
    VT_INF_SHARP_CREASE, VT_INF_SHARP_EDGES, VT_NON_MANIFOLD, VT_SEMI_SHARP, VT_XORDINARY, vtWithRule,
} from './vtrTypes'

// `FVarLevel::ETag` (`fvarLevel.h:83`) bits.
export const FET_MISMATCH = 1 << 0
export const FET_DISCTS_V0 = 1 << 1
export const FET_DISCTS_V1 = 1 << 2
export const FET_LINEAR = 1 << 3

/** `FVarLevel::ETag` (`fvarLevel.h:83`). */
export class FVarETag {
    constructor(readonly bits: number) {}
    get mismatch() { return (this.bits & FET_MISMATCH) !== 0 }
    get disctsV0() { return (this.bits & FET_DISCTS_V0) !== 0 }
    get disctsV1() { return (this.bits & FET_DISCTS_V1) !== 0 }
    get linear() { return (this.bits & FET_LINEAR) !== 0 }

    /** `combineWithLevelETag` (`fvarLevel.h:390`). */
    combineWithLevelETag(levelTag: number): number {
        if (this.mismatch) levelTag |= ET_BOUNDARY | ET_INF_SHARP
        return levelTag
    }
}

// `FVarLevel::ValueTag` (`fvarLevel.h:110`) bits.
export const FVT_MISMATCH = 1 << 0
export const FVT_XORDINARY = 1 << 1
export const FVT_NON_MANIFOLD = 1 << 2
export const FVT_CREASE = 1 << 3
export const FVT_SEMI_SHARP = 1 << 4
export const FVT_DEP_SHARP = 1 << 5
export const FVT_INF_SHARP_EDGES = 1 << 6
export const FVT_INF_IRREGULAR = 1 << 7

/** `FVarLevel::ValueTag` (`fvarLevel.h:110`). */
export class FVarValueTag {
    constructor(readonly bits: number) {}
    isMismatch() { return (this.bits & FVT_MISMATCH) !== 0 }
    isCrease() { return (this.bits & FVT_CREASE) !== 0 }
    isCorner() { return !this.isCrease() }
    isSemiSharp() { return (this.bits & FVT_SEMI_SHARP) !== 0 }
    isInfSharp() { return !this.isSemiSharp() && !this.isCrease() }
    isDepSharp() { return (this.bits & FVT_DEP_SHARP) !== 0 }
    hasCreaseEnds() { return this.isCrease() || this.isSemiSharp() }
    hasInfSharpEdges() { return (this.bits & FVT_INF_SHARP_EDGES) !== 0 }
    hasInfIrregularity() { return (this.bits & FVT_INF_IRREGULAR) !== 0 }
    get xordinary() { return (this.bits & FVT_XORDINARY) !== 0 }
    get nonManifold() { return (this.bits & FVT_NON_MANIFOLD) !== 0 }

    /** `combineWithLevelVTag` (`fvarLevel.h:400`). */
    combineWithLevelVTag(levelTag: number): number {
        if (this.isMismatch()) {
            levelTag = vtWithRule(levelTag, this.isCorner() ? Rule.CORNER : Rule.CREASE)
            if (this.isCrease() || this.isSemiSharp()) {
                levelTag &= ~VT_INF_SHARP
                levelTag |= VT_INF_SHARP_CREASE
                levelTag &= ~VT_CORNER
            } else {
                levelTag |= VT_INF_SHARP
                levelTag &= ~VT_INF_SHARP_CREASE
                const corner = !this.hasInfIrregularity() && !this.hasInfSharpEdges()
                levelTag = corner ? levelTag | VT_CORNER : levelTag & ~VT_CORNER
            }
            levelTag |= VT_INF_SHARP_EDGES
            levelTag = this.hasInfIrregularity() ? levelTag | VT_INF_IRREGULAR : levelTag & ~VT_INF_IRREGULAR
            levelTag |= VT_BOUNDARY
            levelTag = this.xordinary ? levelTag | VT_XORDINARY : levelTag & ~VT_XORDINARY
            if (this.nonManifold) levelTag |= VT_NON_MANIFOLD
        }
        return levelTag
    }
}

/** `FVarLevel::CreaseEndPair` (`fvarLevel.h:145`). */
export interface CreaseEndPair {
    startFace: number
    endFace: number
}

/** `FVarLevel::ValueSpan` (`fvarLevel.cpp:40`). */
interface ValueSpan {
    size: number
    start: number
    disctsEdgeCount: number
    semiSharpEdgeCount: number
    infSharpEdgeCount: number
}

const u16 = (x: number) => x & 0xffff

export class FVarLevel {
    options = new Options()
    isLinear = false
    hasLinearBoundaries = false
    hasDependentSharpness = false
    valueCount = 0

    faceVertValues: number[] = []
    edgeTags: number[] = []
    vertSiblingCounts: number[] = []
    vertSiblingOffsets: number[] = []
    vertFaceSiblings: number[] = []
    vertValueIndices: number[] = []
    vertValueTags: number[] = []
    vertValueCreaseEnds: CreaseEndPair[] = []

    constructor(readonly level: Level) {}

    getLevel() { return this.level }
    getNumValues() { return this.valueCount }
    getNumFaceValuesTotal() { return this.faceVertValues.length }
    hasSmoothBoundaries() { return !this.hasLinearBoundaries }
    hasCreaseEnds() { return this.hasSmoothBoundaries() }
    getOptions(): Options { return this.options }

    getFaceValues(f: number): IndexArray {
        return new IndexArray(this.faceVertValues, this.level.getOffsetOfFaceVertices(f), this.level.getNumFaceVertices(f))
    }
    getEdgeTag(e: number): FVarETag { return new FVarETag(this.edgeTags[e]) }
    edgeTopologyMatches(e: number) { return (this.edgeTags[e] & FET_MISMATCH) === 0 }
    getNumVertexValues(v: number) { return this.vertSiblingCounts[v] }
    getVertexValueOffset(v: number, i = 0) { return this.vertSiblingOffsets[v] + i }
    getVertexValue(v: number, i = 0) { return this.vertValueIndices[this.getVertexValueOffset(v, i)] }

    /** `findVertexValueIndex` (`fvarLevel.h:375`). */
    findVertexValueIndex(vertexIndex: number, valueIndex: number): number {
        if (this.level.getDepth() > 0) return valueIndex
        let vv = this.getVertexValueOffset(vertexIndex)
        while (this.vertValueIndices[vv] !== valueIndex) ++vv
        return vv
    }

    getVertexValues(v: number): IndexArray {
        return new IndexArray(this.vertValueIndices, this.getVertexValueOffset(v), this.getNumVertexValues(v))
    }
    getVertexValueTags(v: number): FVarValueTag[] {
        const o = this.getVertexValueOffset(v), n = this.getNumVertexValues(v)
        const out: FVarValueTag[] = []
        for (let i = 0; i < n; i++) out.push(new FVarValueTag(this.vertValueTags[o + i]))
        return out
    }
    setVertexValueTag(v: number, i: number, bits: number): void {
        this.vertValueTags[this.getVertexValueOffset(v) + i] = bits
    }
    getVertexValueCreaseEnds(v: number): CreaseEndPair[] {
        const o = this.getVertexValueOffset(v), n = this.getNumVertexValues(v)
        return this.vertValueCreaseEnds.slice(o, o + n)
    }
    getVertexFaceSiblings(v: number): IndexArray {
        return new IndexArray(this.vertFaceSiblings, this.level.getOffsetOfVertexFaces(v), this.level.getNumVertexFaces(v))
    }
    getValueTag(valueIndex: number): FVarValueTag { return new FVarValueTag(this.vertValueTags[valueIndex]) }
    valueTopologyMatches(valueIndex: number) { return (this.vertValueTags[valueIndex] & FVT_MISMATCH) === 0 }
    getValueCreaseEndPair(valueIndex: number): CreaseEndPair { return this.vertValueCreaseEnds[valueIndex] }

    setOptions(options: Options): void { this.options = options.clone() }

    /** `resizeComponents` (:66). */
    resizeComponents(): void {
        resizeVector(this.faceVertValues, this.level.getNumFaceVerticesTotal())
        resizeVector(this.edgeTags, this.level.getNumEdges())
        resizeVector(this.vertSiblingCounts, this.level.getNumVertices())
        resizeVector(this.vertSiblingOffsets, this.level.getNumVertices())
        resizeVector(this.vertFaceSiblings, this.level.getNumVertexFacesTotal())
    }

    /** `resizeVertexValues` (:83). */
    resizeVertexValues(count: number): void {
        resizeVector(this.vertValueIndices, count)
        resizeVector(this.vertValueTags, count)
        if (this.hasCreaseEnds()) {
            while (this.vertValueCreaseEnds.length < count) this.vertValueCreaseEnds.push({startFace: 0, endFace: 0})
            this.vertValueCreaseEnds.length = count
        }
    }

    resizeValues(count: number): void { this.valueCount = count }

    /** `completeTopologyFromFaceValues` (:105). */
    completeTopologyFromFaceValues(regularBoundaryValence: number): void {
        const level = this.level
        const geomOptions = this.options.vtxBoundaryInterpolation
        const fvarOptions = this.options.fvarLinearInterpolation
        this.isLinear = fvarOptions === FVarLinearInterpolation.ALL
        this.hasLinearBoundaries = fvarOptions === FVarLinearInterpolation.ALL || fvarOptions === FVarLinearInterpolation.BOUNDARIES
        this.hasDependentSharpness = fvarOptions === FVarLinearInterpolation.CORNERS_PLUS1 || fvarOptions === FVarLinearInterpolation.CORNERS_PLUS2
        const geomCornersAreSmooth = geomOptions !== VtxBoundaryInterpolation.EDGE_AND_CORNER
        const fvarCornersAreSharp = fvarOptions !== FVarLinearInterpolation.NONE
        const makeSmoothCornersSharp = geomCornersAreSmooth && fvarCornersAreSharp
        const sharpenBothIfOneCorner = fvarOptions === FVarLinearInterpolation.CORNERS_PLUS2
        const sharpenDarts = sharpenBothIfOneCorner || this.hasLinearBoundaries

        const vertexMismatch = new Array<number>(level.getNumVertices()).fill(0)
        resizeVector(this.vertFaceSiblings, level.getNumVertexFacesTotal())
        const uniqueValues: number[] = []
        const vValueSiblings: number[] = []
        const setEdgeTag = (e: number, v: number) => {
            const eVerts = level.getEdgeVertices(e)
            let t = this.edgeTags[e]
            t = eVerts.get(0) === v ? t | FET_DISCTS_V0 : t & ~FET_DISCTS_V0
            t = eVerts.get(1) === v ? t | FET_DISCTS_V1 : t & ~FET_DISCTS_V1
            t |= FET_MISMATCH
            t = this.hasLinearBoundaries ? t | FET_LINEAR : t & ~FET_LINEAR
            this.edgeTags[e] = t
        }
        let totalValueCount = 0
        for (let v = 0; v < level.getNumVertices(); ++v) {
            const vFaces = level.getVertexFaces(v)
            const vInFace = level.getVertexFaceLocalIndices(v)
            const vValues: number[] = []
            for (let i = 0; i < vFaces.size; ++i) vValues[i] = this.faceVertValues[level.getOffsetOfFaceVertices(vFaces.get(i)) + vInFace.get(i)]
            const vEdges = level.getVertexEdges(v)
            const vInEdge = level.getVertexEdgeLocalIndices(v)
            const vIsManifold = !(level.getVertexTag(v) & VT_NON_MANIFOLD)
            const vIsBoundary = (level.getVertexTag(v) & VT_BOUNDARY) !== 0
            if (vIsManifold) {
                for (let i = vIsBoundary ? 1 : 0; i < vFaces.size; ++i) {
                    const vFaceNext = i
                    const vFacePrev = i ? i - 1 : vFaces.size - 1
                    if (vValues[vFaceNext] !== vValues[vFacePrev]) {
                        const e = vEdges.get(i)
                        const eVerts = level.getEdgeVertices(e)
                        vertexMismatch[eVerts.get(0)] = 1
                        vertexMismatch[eVerts.get(1)] = 1
                        setEdgeTag(e, v)
                    }
                }
            } else if (vFaces.size > 0) {
                for (let i = 0; i < vEdges.size; ++i) {
                    const e = vEdges.get(i)
                    const eFaces = level.getEdgeFaces(e)
                    if (eFaces.size < 2) continue
                    const eInFace = level.getEdgeFaceLocalIndices(e)
                    const eVerts = level.getEdgeVertices(e)
                    const vertInEdge = vInEdge.get(i)
                    let markEdgeDiscts = false
                    let valueIndexInFace0 = 0
                    for (let j = 0; !markEdgeDiscts && j < eFaces.size; ++j) {
                        const f = eFaces.get(j)
                        const fVerts = level.getFaceVertices(f)
                        const fValues = this.getFaceValues(f)
                        const edgeInFace = eInFace.get(j)
                        const edgeReversed = eVerts.get(0) !== fVerts.get(edgeInFace) ? 1 : 0
                        let vertInFace = edgeInFace + (vertInEdge !== edgeReversed ? 1 : 0)
                        if (vertInFace === fVerts.size) vertInFace = 0
                        if (j === 0) valueIndexInFace0 = fValues.get(vertInFace)
                        else markEdgeDiscts = fValues.get(vertInFace) !== valueIndexInFace0
                    }
                    if (markEdgeDiscts) {
                        vertexMismatch[eVerts.get(0)] = 1
                        vertexMismatch[eVerts.get(1)] = 1
                        setEdgeTag(e, v)
                    }
                }
            }
            if (vIsBoundary && !vertexMismatch[v]) {
                if (this.hasLinearBoundaries && vFaces.size > 0) {
                    vertexMismatch[v] = 1
                    if (vIsManifold) {
                        this.edgeTags[vEdges.get(0)] |= FET_LINEAR
                        this.edgeTags[vEdges.get(vEdges.size - 1)] |= FET_LINEAR
                    } else {
                        for (let i = 0; i < vEdges.size; ++i) {
                            if (level.getEdgeTag(vEdges.get(i)) & ET_BOUNDARY) this.edgeTags[vEdges.get(i)] |= FET_LINEAR
                        }
                    }
                } else if (vFaces.size === 1) {
                    if (makeSmoothCornersSharp) vertexMismatch[v] = 1
                }
            }
            let uniqueValueCount = 1
            uniqueValues[0] = vValues[0]
            vValueSiblings[0] = 0
            for (let i = 1; i < vFaces.size; ++i) {
                if (vValues[i] === vValues[i - 1]) {
                    vValueSiblings[i] = vValueSiblings[i - 1]
                } else {
                    vValueSiblings[i] = uniqueValueCount
                    if (uniqueValueCount === 1) {
                        uniqueValues[uniqueValueCount++] = vValues[i]
                    } else if (uniqueValueCount === 2 && uniqueValues[0] !== vValues[i]) {
                        uniqueValues[uniqueValueCount++] = vValues[i]
                    } else {
                        let found = -1
                        for (let k = 0; k < uniqueValueCount; k++) {
                            if (uniqueValues[k] === vValues[i]) {
                                found = k
                                break
                            }
                        }
                        if (found < 0) uniqueValues[uniqueValueCount++] = vValues[i]
                        else vValueSiblings[i] = found
                    }
                }
            }
            if (!vIsManifold && !vertexMismatch[v]) vertexMismatch[v] = uniqueValueCount > 1 ? 1 : 0
            this.vertSiblingCounts[v] = u16(uniqueValueCount)
            this.vertSiblingOffsets[v] = totalValueCount
            totalValueCount += uniqueValueCount
            if (uniqueValueCount > 1) {
                const vFaceSiblings = this.getVertexFaceSiblings(v)
                for (let i = 0; i < vFaces.size; ++i) vFaceSiblings.set(i, vValueSiblings[i])
            }
        }
        this.resizeVertexValues(totalValueCount)

        for (let v = 0; v < level.getNumVertices(); ++v) {
            const vFaces = level.getVertexFaces(v)
            const vInFace = level.getVertexFaceLocalIndices(v)
            const vValues = this.getVertexValues(v)
            if (vFaces.size > 0) vValues.set(0, this.faceVertValues[level.getOffsetOfFaceVertices(vFaces.get(0)) + vInFace.get(0)])
            else vValues.set(0, 0)
            if (!vertexMismatch[v]) continue
            if (vValues.size > 1) {
                const vFaceSiblings = this.getVertexFaceSiblings(v)
                for (let i = 1, nextSibling = 1; i < vFaces.size; ++i) {
                    if (vFaceSiblings.get(i) === nextSibling) {
                        vValues.set(nextSibling++, this.faceVertValues[level.getOffsetOfFaceVertices(vFaces.get(i)) + vInFace.get(i)])
                    }
                }
            }
            const vTag = level.getVertexTag(v)
            let allCornersAreSharp = this.hasLinearBoundaries || (vTag & VT_INF_SHARP) !== 0 || (vTag & VT_NON_MANIFOLD) !== 0 ||
                (this.hasDependentSharpness && vValues.size > 2) || (sharpenDarts && vValues.size === 1 && !(vTag & VT_BOUNDARY))
            const vValueSpans: ValueSpan[] = []
            for (let i = 0; i < vValues.size; i++) vValueSpans.push({size: 0, start: 0, disctsEdgeCount: 0, semiSharpEdgeCount: 0, infSharpEdgeCount: 0})
            this.gatherValueSpans(v, vValueSpans)
            let hasDependentValuesToSharpen = false
            if (!allCornersAreSharp) {
                if (this.hasDependentSharpness && vValues.size === 2) {
                    allCornersAreSharp = !!(vValueSpans[0].infSharpEdgeCount || vValueSpans[1].infSharpEdgeCount ||
                        vValueSpans[0].disctsEdgeCount || vValueSpans[1].disctsEdgeCount)
                    if (sharpenBothIfOneCorner) allCornersAreSharp = allCornersAreSharp || vValueSpans[0].size === 1 || vValueSpans[1].size === 1
                    hasDependentValuesToSharpen = (vValueSpans[0].semiSharpEdgeCount > 0) !== (vValueSpans[1].semiSharpEdgeCount > 0)
                }
            }
            const offset = this.getVertexValueOffset(v)
            for (let i = 0; i < vValues.size; ++i) {
                let tag = FVT_MISMATCH
                const vSpan = vValueSpans[i]
                if (vSpan.disctsEdgeCount) {
                    this.vertValueTags[offset + i] = tag | FVT_NON_MANIFOLD
                    continue
                }
                const isInfSharp = allCornersAreSharp || vSpan.infSharpEdgeCount !== 0 || (vSpan.size === 1 && fvarCornersAreSharp)
                let xordinary: boolean
                if (vSpan.size === 1) xordinary = !isInfSharp
                else xordinary = vSpan.size !== regularBoundaryValence
                if (xordinary) tag |= FVT_XORDINARY
                if (vSpan.infSharpEdgeCount > 0) tag |= FVT_INF_SHARP_EDGES
                const infIrregular = vSpan.infSharpEdgeCount ? vSpan.size - vSpan.infSharpEdgeCount > 1 : (isInfSharp ? vSpan.size > 1 : xordinary)
                if (infIrregular) tag |= FVT_INF_IRREGULAR
                if (!isInfSharp) {
                    if (vSpan.semiSharpEdgeCount || (vTag & VT_SEMI_SHARP)) {
                        tag |= FVT_SEMI_SHARP
                    } else if (hasDependentValuesToSharpen) {
                        tag |= FVT_SEMI_SHARP | FVT_DEP_SHARP
                    } else {
                        tag |= FVT_CREASE
                    }
                    if (this.hasCreaseEnds()) {
                        const crease = this.vertValueCreaseEnds[offset + i]
                        crease.startFace = vSpan.start
                        if (i === 0 && vSpan.start !== 0) crease.endFace = u16(vSpan.start + vSpan.size - 1 - vFaces.size)
                        else crease.endFace = u16(vSpan.start + vSpan.size - 1)
                    }
                }
                this.vertValueTags[offset + i] = tag
            }
        }
    }

    /** `getVertexCreaseEndValues` (:567). */
    getVertexCreaseEndValues(v: number, sibling: number): [number, number] {
        const ends = this.vertValueCreaseEnds[this.getVertexValueOffset(v, sibling)]
        const vFaces = this.level.getVertexFaces(v)
        const vInFace = this.level.getVertexFaceLocalIndices(v)
        const vertFace0 = ends.startFace
        const vertFace1 = ends.endFace
        const face0Values = this.getFaceValues(vFaces.get(vertFace0))
        const face1Values = this.getFaceValues(vFaces.get(vertFace1))
        let endInFace0 = vInFace.get(vertFace0)
        let endInFace1 = vInFace.get(vertFace1)
        endInFace0 = endInFace0 === face0Values.size - 1 ? 0 : endInFace0 + 1
        endInFace1 = (endInFace1 ? endInFace1 : face1Values.size) - 1
        return [face0Values.get(endInFace0), face1Values.get(endInFace1)]
    }

    /** `initializeFaceValuesFromFaceVertices` (:700). */
    initializeFaceValuesFromFaceVertices(): void {
        const src = this.level.faceVertIndices
        for (let i = 0; i < src.length; i++) this.faceVertValues[i] = src[i]
    }

    /** `initializeFaceValuesFromVertexFaceSiblings` (:713). */
    initializeFaceValuesFromVertexFaceSiblings(): void {
        const fvIndices = this.level.faceVertIndices
        for (let i = 0; i < fvIndices.length; ++i) this.faceVertValues[i] = this.getVertexValueOffset(fvIndices[i])
        for (let v = 0; v < this.level.getNumVertices(); ++v) {
            if (this.getNumVertexValues(v) > 1) {
                const vFaces = this.level.getVertexFaces(v)
                const vInFace = this.level.getVertexFaceLocalIndices(v)
                const vSiblings = this.getVertexFaceSiblings(v)
                for (let j = 0; j < vFaces.size; ++j) {
                    if (vSiblings.get(j)) this.faceVertValues[this.level.getOffsetOfFaceVertices(vFaces.get(j)) + vInFace.get(j)] += vSiblings.get(j)
                }
            }
        }
    }

    /** `buildFaceVertexSiblingsFromVertexFaceSiblings` (:735). */
    buildFaceVertexSiblingsFromVertexFaceSiblings(): number[] {
        const fvSiblings = new Array<number>(this.level.getNumFaceVerticesTotal()).fill(0)
        for (let v = 0; v < this.level.getNumVertices(); ++v) {
            if (this.getNumVertexValues(v) > 1) {
                const vFaces = this.level.getVertexFaces(v)
                const vInFace = this.level.getVertexFaceLocalIndices(v)
                const vSiblings = this.getVertexFaceSiblings(v)
                for (let j = 0; j < vFaces.size; ++j) {
                    if (vSiblings.get(j) > 0) fvSiblings[this.level.getOffsetOfFaceVertices(vFaces.get(j)) + vInFace.get(j)] = vSiblings.get(j)
                }
            }
        }
        return fvSiblings
    }

    /** `getEdgeFaceValues` (:760). */
    getEdgeFaceValues(e: number, fIncToEdge: number): [number, number] {
        const eVerts = this.level.getEdgeVertices(e)
        if (this.getNumVertexValues(eVerts.get(0)) + this.getNumVertexValues(eVerts.get(1)) > 2) {
            const eFace = this.level.getEdgeFaces(e).get(fIncToEdge)
            const eInFace = this.level.getEdgeFaceLocalIndices(e).get(fIncToEdge)
            const fValues = this.getFaceValues(eFace)
            let a = fValues.get(eInFace)
            let b = fValues.get(eInFace + 1 < fValues.size ? eInFace + 1 : 0)
            if (eVerts.get(0) !== this.level.getFaceVertices(eFace).get(eInFace)) [a, b] = [b, a]
            return [a, b]
        }
        if (this.level.getDepth() > 0) return [this.getVertexValueOffset(eVerts.get(0)), this.getVertexValueOffset(eVerts.get(1))]
        return [this.getVertexValue(eVerts.get(0)), this.getVertexValue(eVerts.get(1))]
    }

    /** `getVertexEdgeValues` (:790). */
    getVertexEdgeValues(v: number, valuesPerEdge: number[]): void {
        const level = this.level
        const vEdges = level.getVertexEdges(v)
        const vInEdge = level.getVertexEdgeLocalIndices(v)
        const vFaces = level.getVertexFaces(v)
        const vInFace = level.getVertexFaceLocalIndices(v)
        const vIsBoundary = (level.getVertexTag(v) & VT_BOUNDARY) !== 0
        const vIsManifold = !(level.getVertexTag(v) & VT_NON_MANIFOLD)
        const isBaseLevel = level.getDepth() === 0
        for (let i = 0; i < vEdges.size; ++i) {
            const e = vEdges.get(i)
            const eVerts = level.getEdgeVertices(e)
            const vOther = eVerts.get(vInEdge.get(i) ? 0 : 1)
            if (this.getNumVertexValues(vOther) === 1) {
                valuesPerEdge[i] = isBaseLevel ? this.getVertexValue(vOther) : this.getVertexValueOffset(vOther)
            } else if (vIsManifold) {
                if (vIsBoundary && i === vEdges.size - 1) {
                    const fValues = this.getFaceValues(vFaces.get(i - 1))
                    const prevInFace = vInFace.get(i - 1) ? vInFace.get(i - 1) - 1 : fValues.size - 1
                    valuesPerEdge[i] = fValues.get(prevInFace)
                } else {
                    const fValues = this.getFaceValues(vFaces.get(i))
                    const nextInFace = vInFace.get(i) === fValues.size - 1 ? 0 : vInFace.get(i) + 1
                    valuesPerEdge[i] = fValues.get(nextInFace)
                }
            } else {
                const eFace0 = level.getEdgeFaces(e).get(0)
                const eInFace0 = level.getEdgeFaceLocalIndices(e).get(0)
                const fVerts = level.getFaceVertices(eFace0)
                const fValues = this.getFaceValues(eFace0)
                if (vOther === fVerts.get(eInFace0)) {
                    valuesPerEdge[i] = fValues.get(eInFace0)
                } else {
                    const valueInFace = eInFace0 === fValues.size - 1 ? 0 : eInFace0 + 1
                    valuesPerEdge[i] = fValues.get(valueInFace)
                }
            }
        }
    }

    /** `gatherValueSpans` (:860). */
    gatherValueSpans(v: number, spans: ValueSpan[]): void {
        const level = this.level
        const vEdges = level.getVertexEdges(v)
        const vFaces = level.getVertexFaces(v)
        const vFaceSiblings = this.getVertexFaceSiblings(v)
        const vHasSingleValue = this.getNumVertexValues(v) === 1
        const vIsBoundary = vEdges.size > vFaces.size
        const vIsNonManifold = (level.getVertexTag(v) & VT_NON_MANIFOLD) !== 0
        const levelETag = (e: number) => level.getEdgeTag(e)
        if (vIsNonManifold) {
            const n = this.getNumVertexValues(v)
            for (let i = 0; i < n; ++i) {
                spans[i].size = 0
                spans[i].disctsEdgeCount = 1
            }
        } else if (vHasSingleValue && !vIsBoundary) {
            spans[0].size = 0
            spans[0].start = 0
            for (let i = 0; i < vEdges.size; ++i) {
                const e = vEdges.get(i)
                if (this.edgeTags[e] & FET_MISMATCH) {
                    if (spans[0].size > 0) {
                        spans[0].disctsEdgeCount = 1
                        break
                    } else {
                        spans[0].size = u16(vFaces.size)
                        spans[0].start = u16(i)
                    }
                } else if (levelETag(e) & ET_INF_SHARP) {
                    spans[0].infSharpEdgeCount = u16(spans[0].infSharpEdgeCount + 1)
                } else if (levelETag(e) & ET_SEMI_SHARP) {
                    spans[0].semiSharpEdgeCount = u16(spans[0].semiSharpEdgeCount + 1)
                }
            }
            spans[0].size = u16(vFaces.size)
        } else {
            spans[0].size = 1
            spans[0].start = 0
            if (!vIsBoundary && vFaceSiblings.get(vFaces.size - 1) === 0) {
                const e = vEdges.get(0)
                if (this.edgeTags[e] & FET_MISMATCH) spans[0].disctsEdgeCount = u16(spans[0].disctsEdgeCount + 1)
                else if (levelETag(e) & ET_INF_SHARP) spans[0].infSharpEdgeCount = u16(spans[0].infSharpEdgeCount + 1)
                else if (levelETag(e) & ET_SEMI_SHARP) spans[0].semiSharpEdgeCount = u16(spans[0].semiSharpEdgeCount + 1)
            }
            for (let i = 1; i < vFaces.size; ++i) {
                const s = spans[vFaceSiblings.get(i)]
                if (vFaceSiblings.get(i) === vFaceSiblings.get(i - 1)) {
                    const e = vEdges.get(i)
                    if (this.edgeTags[e] & FET_MISMATCH) s.disctsEdgeCount = u16(s.disctsEdgeCount + 1)
                    else if (levelETag(e) & ET_INF_SHARP) s.infSharpEdgeCount = u16(s.infSharpEdgeCount + 1)
                    else if (levelETag(e) & ET_SEMI_SHARP) s.semiSharpEdgeCount = u16(s.semiSharpEdgeCount + 1)
                } else {
                    if (s.size > 0) s.disctsEdgeCount = u16(s.disctsEdgeCount + 1)
                    s.start = u16(i)
                }
                s.size = u16(s.size + 1)
            }
            if (vFaceSiblings.get(vFaces.size - 1) === 0 && !vIsBoundary) spans[0].disctsEdgeCount = u16(spans[0].disctsEdgeCount - 1)
        }
    }

    /** `getFaceValueTags` (:951). */
    getFaceValueTags(f: number): FVarValueTag[] {
        const faceValues = this.getFaceValues(f)
        const faceVerts = this.level.getFaceVertices(f)
        const out: FVarValueTag[] = []
        for (let i = 0; i < faceValues.size; ++i) out.push(new FVarValueTag(this.vertValueTags[this.findVertexValueIndex(faceVerts.get(i), faceValues.get(i))]))
        return out
    }

    /** `getFaceCompositeValueTag` (:965). */
    getFaceCompositeValueTag(f: number): FVarValueTag {
        const faceValues = this.getFaceValues(f)
        const faceVerts = this.level.getFaceVertices(f)
        let bits = 0
        for (let i = 0; i < faceValues.size; ++i) bits |= this.vertValueTags[this.findVertexValueIndex(faceVerts.get(i), faceValues.get(i))]
        return new FVarValueTag(bits)
    }
}

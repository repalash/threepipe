/**
 * Port of OpenSubdiv v3_7_0 `opensubdiv/far/patchBuilder.h/.cpp` (`PatchBuilder`, `SourcePatch`; Copyright 2018
 * DreamWorks Animation LLC), `far/catmarkPatchBuilder.cpp` (`CatmarkLimits`, `GregoryConverter`, the SparseMatrix
 * utilities and `CatmarkPatchBuilder`; Copyright 2018 DreamWorks Animation LLC) and `far/bilinearPatchBuilder.cpp`.
 * Licensed under the Tomorrow Open Source Technology License 1.0 - see `OPENSUBDIV-LICENSE.txt` in this folder.
 *
 * Scope: the quad schemes (Catmark, Bilinear). The triangle (Loop) paths throw. Of the Catmark conversions only the
 * Gregory basis is ported - Blender's evaluator asks for `ENDCAP_GREGORY_BASIS` (`evaluator_impl.cc`), so regular
 * patches stay B-spline and irregular ones become Gregory; the B-spline and linear end-cap conversions throw.
 *
 * Float exactness: `SparseMatrix<float>` (`patchPrecisionDouble` is off), compiled inside the OpenSubdiv library with
 * clang's default `-ffp-contract=on`: `fullRow[i] += s * w` is `fmaf(s, w, fullRow[i])`. `CatmarkLimits` computes in
 * double and rounds each weight to float where the source casts; `std::cos` / `std::sin` of one value in one block
 * become one `__sincos_stret` / `__sincosf_stret` call (`../../blender/libm.ts`).
 */

import {f32} from '../../blender/f32'
import {fmaf} from '../../blender/fma'
import {cos, sin, sincos, sincosf} from '../../blender/libm'
import {Rule, SchemeType, SchemeTypeTraits} from './sdc'
import {Level, newVSpan, VSpan} from './level'
import type {FVarLevel} from './fvarLevel'
import {PatchParam, PatchType, PtexIndices} from './patchTable'
import {SparseMatrix} from './sparseMatrix'
import type {TopologyRefiner} from './topologyRefiner'
import {
    ET_BOUNDARY, ET_INF_SHARP, ET_NON_MANIFOLD, IndexArray, INDEX_INVALID, VT_BOUNDARY, VT_CORNER, VT_INCID_IRREG_FACE, VT_INCOMPLETE,
    VT_INF_IRREGULAR, VT_INF_SHARP, VT_INF_SHARP_CREASE, VT_INF_SHARP_EDGES, VT_NON_MANIFOLD, VT_XORDINARY, vtRule,
} from './vtrTypes'

const fastMod4 = (x: number) => x & 0x3
const fastModN = (x: number, n: number) => (x < n ? x : x - n)
const isAssigned = (s: VSpan) => s.numFaces > 0
const clearVSpan = (s: VSpan) => { s.numFaces = 0; s.startFace = 0; s.cornerInSpan = 0; s.periodic = false; s.sharp = false }

// region topology helpers (`patchBuilder.cpp:31-505`)

/** `getSingularEdgeMask` (:65). */
function getSingularEdgeMask(includeAllInfSharpEdges = false): number {
    return ET_BOUNDARY | ET_NON_MANIFOLD | (includeAllInfSharpEdges ? ET_INF_SHARP : 0)
}

/** `isEdgeSingular` (:76). */
function isEdgeSingular(level: Level, fvarLevel: FVarLevel | undefined, eIndex: number, eTagMask: number): boolean {
    let eTag = level.getEdgeTag(eIndex)
    if (fvarLevel) eTag = fvarLevel.getEdgeTag(eIndex).combineWithLevelETag(eTag)
    return (eTag & eTagMask) > 0
}

/** `identifyManifoldCornerSpan` (:87). */
function identifyManifoldCornerSpan(level: Level, fIndex: number, fCorner: number, eTagMask: number, vSpan: VSpan, fvc = -1): void {
    const fvarLevel = fvc < 0 ? undefined : level.getFVarLevel(fvc)
    const fVerts = level.getFaceVertices(fIndex)
    const fEdges = level.getFaceEdges(fIndex)
    const vEdges = level.getVertexEdges(fVerts.get(fCorner))
    const nEdges = vEdges.size
    const iLeadingStart = vEdges.findIndex(fEdges.get(fCorner))
    const iTrailingStart = fastModN(iLeadingStart + 1, nEdges)
    clearVSpan(vSpan)
    vSpan.numFaces = 1
    vSpan.cornerInSpan = 0
    let iLeading = iLeadingStart
    while (!isEdgeSingular(level, fvarLevel, vEdges.get(iLeading), eTagMask)) {
        ++vSpan.numFaces
        ++vSpan.cornerInSpan
        iLeading = fastModN(iLeading + nEdges - 1, nEdges)
        if (iLeading === iTrailingStart) break
    }
    let iTrailing = iTrailingStart
    if (iTrailing !== iLeading) {
        while (!isEdgeSingular(level, fvarLevel, vEdges.get(iTrailing), eTagMask)) {
            ++vSpan.numFaces
            iTrailing = fastModN(iTrailing + 1, nEdges)
            if (iTrailing === iLeadingStart) break
        }
    }
    vSpan.startFace = iLeading
}

/** `identifyNonManifoldCornerSpan` (:126). */
function identifyNonManifoldCornerSpan(level: Level, fIndex: number, fCorner: number, eTagMask: number, vSpan: VSpan, fvc = -1): void {
    const fvarLevel = fvc < 0 ? undefined : level.getFVarLevel(fvc)
    let fEdges = level.getFaceEdges(fIndex)
    const eLeadingStart = fEdges.get(fCorner)
    const eTrailingStart = fEdges.get((fCorner + fEdges.size - 1) % fEdges.size)
    clearVSpan(vSpan)
    vSpan.numFaces = 1
    vSpan.cornerInSpan = 0
    let startFace = fIndex
    let startCorner = fCorner
    let fLeading = fIndex
    let eLeading = eLeadingStart
    while (!isEdgeSingular(level, fvarLevel, eLeading, eTagMask)) {
        ++vSpan.numFaces
        ++vSpan.cornerInSpan
        const eFaces = level.getEdgeFaces(eLeading)
        if (eFaces.size !== 2) throw new Error('identifyNonManifoldCornerSpan: expected two faces')
        fLeading = eFaces.get(0) === fLeading ? eFaces.get(1) : eFaces.get(0)
        fEdges = level.getFaceEdges(fLeading)
        startFace = fLeading
        startCorner = (fEdges.findIndex(eLeading) + 1) % fEdges.size
        eLeading = fEdges.get(startCorner)
        if (eLeading === eTrailingStart) {
            vSpan.periodic = !isEdgeSingular(level, fvarLevel, eLeading, eTagMask)
            break
        }
    }
    let fTrailing = fIndex
    let eTrailing = eTrailingStart
    if (eTrailing !== eLeading) {
        while (!isEdgeSingular(level, fvarLevel, eTrailing, eTagMask)) {
            ++vSpan.numFaces
            const eFaces = level.getEdgeFaces(eTrailing)
            if (eFaces.size !== 2) throw new Error('identifyNonManifoldCornerSpan: expected two faces')
            fTrailing = eFaces.get(0) === fTrailing ? eFaces.get(1) : eFaces.get(0)
            fEdges = level.getFaceEdges(fTrailing)
            eTrailing = fEdges.get((fEdges.findIndex(eTrailing) + fEdges.size - 1) % fEdges.size)
            if (eTrailing === eLeadingStart) {
                vSpan.periodic = !isEdgeSingular(level, fvarLevel, eTrailing, eTagMask)
                break
            }
        }
    }
    const vIndex = level.getFaceVertices(fIndex).get(fCorner)
    const vFaces = level.getVertexFaces(vIndex)
    const vInFaces = level.getVertexFaceLocalIndices(vIndex)
    vSpan.startFace = vFaces.size
    for (let i = 0; i < vFaces.size; ++i) {
        if (vFaces.get(i) === startFace && vInFaces.get(i) === startCorner) {
            vSpan.startFace = i
            break
        }
    }
    if (vSpan.startFace >= vFaces.size) throw new Error('identifyNonManifoldCornerSpan: start face not found')
}

function countManifoldCornerSpan(level: Level, fIndex: number, fCorner: number, eTagMask: number, fvc = -1): number {
    const vSpan = newVSpan()
    identifyManifoldCornerSpan(level, fIndex, fCorner, eTagMask, vSpan, fvc)
    return vSpan.numFaces
}

function countNonManifoldCornerSpan(level: Level, fIndex: number, fCorner: number, eTagMask: number, fvc = -1): number {
    const vSpan = newVSpan()
    identifyNonManifoldCornerSpan(level, fIndex, fCorner, eTagMask, vSpan, fvc)
    return vSpan.numFaces
}

/** `gatherRegularPartialRingAroundVertex` (:282). */
function gatherRegularPartialRingAroundVertex(level: Level, vIndex: number, span: VSpan, ringPoints: number[], fvarChannel: number): number {
    const isManifold = !level.isVertexNonManifold(vIndex)
    const vFaces = level.getVertexFaces(vIndex)
    const vInFaces = level.getVertexFaceLocalIndices(vIndex)
    const nFaces = span.numFaces
    const startFace = span.startFace
    let nextFace = vFaces.get(startFace)
    let vInNextFace = vInFaces.get(startFace)
    let ringIndex = 0
    for (let i = 0; i < nFaces; ++i) {
        const thisFace = nextFace
        const vInThisFace = vInNextFace
        const fPoints = getFacePoints(level, thisFace, fvarChannel)
        const isQuad = fPoints.size === 4
        if (isQuad) {
            ringPoints[ringIndex++] = fPoints.get(fastMod4(vInThisFace + 1))
            ringPoints[ringIndex++] = fPoints.get(fastMod4(vInThisFace + 2))
        } else {
            throw new Error('OpenSubdiv: PatchBuilder triangle rings (Loop scheme) are not ported')
        }
        if (i === nFaces - 1) {
            if (!span.periodic) ringPoints[ringIndex++] = fPoints.get(fastMod4(vInThisFace + 3))
        } else if (isManifold) {
            const iNext = fastModN(startFace + i + 1, vFaces.size)
            nextFace = vFaces.get(iNext)
            vInNextFace = vInFaces.get(iNext)
        } else {
            const nextInThisFace = fastModN(vInThisFace + fPoints.size - 1, fPoints.size)
            const nextEdge = level.getFaceEdges(thisFace).get(nextInThisFace)
            const eFaces = level.getEdgeFaces(nextEdge)
            nextFace = eFaces.get(0) === thisFace ? eFaces.get(1) : eFaces.get(0)
            vInNextFace = level.getFaceEdges(nextFace).findIndex(nextEdge)
        }
    }
    return ringIndex
}

/** `getNextFaceInVertFaces` (:417). */
function getNextFaceInVertFaces(level: Level, thisFaceInVFaces: number, vFaces: IndexArray, vInFaces: IndexArray, manifold: boolean, out: {vIn: number}): number {
    let nextFace: number
    if (manifold) {
        const nextFaceInVFaces = fastModN(thisFaceInVFaces + 1, vFaces.size)
        nextFace = vFaces.get(nextFaceInVFaces)
        out.vIn = vInFaces.get(nextFaceInVFaces)
    } else {
        const thisFace = vFaces.get(thisFaceInVFaces)
        const vInThisFace = vInFaces.get(thisFaceInVFaces)
        const fEdges = level.getFaceEdges(thisFace)
        const nextEdge = fEdges.get(fastModN(vInThisFace + fEdges.size - 1, fEdges.size))
        const eFaces = level.getEdgeFaces(nextEdge)
        if (eFaces.size !== 2) throw new Error('getNextFaceInVertFaces: expected two faces')
        nextFace = eFaces.get(0) === thisFace ? eFaces.get(1) : eFaces.get(0)
        out.vIn = level.getFaceEdges(nextFace).findIndex(nextEdge)
    }
    return nextFace
}

/** `getPrevFaceInVertFaces` (:450). */
function getPrevFaceInVertFaces(level: Level, thisFaceInVFaces: number, vFaces: IndexArray, vInFaces: IndexArray, manifold: boolean, out: {vIn: number}): number {
    let prevFace: number
    if (manifold) {
        const prevFaceInVFaces = (thisFaceInVFaces ? thisFaceInVFaces : vFaces.size) - 1
        prevFace = vFaces.get(prevFaceInVFaces)
        out.vIn = vInFaces.get(prevFaceInVFaces)
    } else {
        const thisFace = vFaces.get(thisFaceInVFaces)
        const vInThisFace = vInFaces.get(thisFaceInVFaces)
        const fEdges = level.getFaceEdges(thisFace)
        const prevEdge = fEdges.get(vInThisFace)
        const eFaces = level.getEdgeFaces(prevEdge)
        if (eFaces.size !== 2) throw new Error('getPrevFaceInVertFaces: expected two faces')
        prevFace = eFaces.get(0) === thisFace ? eFaces.get(1) : eFaces.get(0)
        const edgeInPrevFace = level.getFaceEdges(prevFace).findIndex(prevEdge)
        out.vIn = fastModN(edgeInPrevFace + 1, fEdges.size)
    }
    return prevFace
}

/** `getFacePoints` (:483). */
function getFacePoints(level: Level, faceIndex: number, fvarChannel: number): IndexArray {
    return fvarChannel < 0 ? level.getFaceVertices(faceIndex) : level.getFaceFVarValues(faceIndex, fvarChannel)
}

// endregion

// region SourcePatch (`patchBuilder.cpp:1400-1607`)

/** `SourcePatch::Corner` (`patchBuilder.h:66`). */
export interface SourcePatchCorner {
    numFaces: number
    patchFace: number
    boundary: number
    sharp: number
    dart: number
    sharesWithPrev: number
    sharesWithNext: number
    val2Interior: number
    val2Adjacent: number
}

const newCorner = (): SourcePatchCorner => ({numFaces: 0, patchFace: 0, boundary: 0, sharp: 0, dart: 0, sharesWithPrev: 0, sharesWithNext: 0, val2Interior: 0, val2Adjacent: 0})

/** `Far::SourcePatch` (`patchBuilder.h:61`). */
export class SourcePatch {
    corners: SourcePatchCorner[] = [newCorner(), newCorner(), newCorner(), newCorner()]
    numCorners = 0
    numSourcePoints = 0
    maxValence = 0
    maxRingSize = 0
    ringSizes = [0, 0, 0, 0]
    localRingSizes = [0, 0, 0, 0]
    localRingOffsets = [0, 0, 0, 0]

    getNumSourcePoints() { return this.numSourcePoints }
    getMaxValence() { return this.maxValence }
    getMaxRingSize() { return this.maxRingSize }
    getCornerRingSize(corner: number) { return this.ringSizes[corner] }

    /** `Finalize` (:1474). */
    finalize(size: number): void {
        const isQuad = size === 4 ? 1 : 0
        this.numCorners = size
        this.maxValence = 0
        this.maxRingSize = 0
        this.numSourcePoints = this.numCorners
        for (let cIndex = 0; cIndex < this.numCorners; ++cIndex) {
            const cPrev = fastModN(cIndex + 2 + isQuad, this.numCorners)
            const cNext = fastModN(cIndex + 1, this.numCorners)
            const prevIsVal2Interior = this.corners[cPrev].numFaces === 2 && !this.corners[cPrev].boundary ? 1 : 0
            const thisIsVal2Interior = this.corners[cIndex].numFaces === 2 && !this.corners[cIndex].boundary ? 1 : 0
            const nextIsVal2Interior = this.corners[cNext].numFaces === 2 && !this.corners[cNext].boundary ? 1 : 0
            const corner = this.corners[cIndex]
            corner.val2Interior = thisIsVal2Interior
            corner.val2Adjacent = prevIsVal2Interior || nextIsVal2Interior ? 1 : 0
            if (corner.numFaces + corner.boundary > 2) {
                if (corner.boundary) {
                    corner.sharesWithPrev = isQuad && corner.patchFace !== corner.numFaces - 1 ? 1 : 0
                    corner.sharesWithNext = corner.patchFace !== 0 ? 1 : 0
                } else if (corner.dart) {
                    const cP = this.corners[cPrev]
                    const cN = this.corners[cNext]
                    const cPrevOnDartEdge = cP.boundary && cP.patchFace === 0
                    const cNextOnDartEdge = cN.boundary && cN.patchFace === cN.numFaces - 1
                    corner.sharesWithPrev = isQuad && !cPrevOnDartEdge ? 1 : 0
                    corner.sharesWithNext = !cNextOnDartEdge ? 1 : 0
                } else {
                    corner.sharesWithPrev = isQuad
                    corner.sharesWithNext = 1
                }
                this.ringSizes[cIndex] = corner.numFaces * (1 + isQuad) + corner.boundary
                this.localRingSizes[cIndex] = this.ringSizes[cIndex] - (this.numCorners - 1) - corner.sharesWithPrev - corner.sharesWithNext
                if (corner.val2Adjacent && !corner.boundary) {
                    this.localRingSizes[cIndex] -= prevIsVal2Interior
                    this.localRingSizes[cIndex] -= nextIsVal2Interior && isQuad ? 1 : 0
                }
            } else {
                corner.sharesWithPrev = 0
                corner.sharesWithNext = 0
                if (corner.numFaces === 1) {
                    this.ringSizes[cIndex] = this.numCorners - 1
                    this.localRingSizes[cIndex] = 0
                } else {
                    this.ringSizes[cIndex] = 2 * (1 + isQuad)
                    this.localRingSizes[cIndex] = isQuad
                }
            }
            this.localRingOffsets[cIndex] = this.numSourcePoints
            this.maxValence = Math.max(this.maxValence, corner.numFaces + corner.boundary)
            this.maxRingSize = Math.max(this.maxRingSize, this.ringSizes[cIndex])
            this.numSourcePoints += this.localRingSizes[cIndex]
        }
    }

    /** `GetCornerRingPoints` (:1554). */
    getCornerRingPoints(corner: number, ringPoints: number[]): number {
        const isQuad = this.numCorners === 4 ? 1 : 0
        const cNext = fastModN(corner + 1, this.numCorners)
        const cOpp = fastModN(corner + 1 + isQuad, this.numCorners)
        const cPrev = fastModN(corner + 2 + isQuad, this.numCorners)
        let ringSize = 0
        ringPoints[ringSize++] = cNext
        if (isQuad) ringPoints[ringSize++] = cOpp
        ringPoints[ringSize++] = cPrev
        if (this.corners[cPrev].val2Interior && !this.corners[corner].boundary) ringPoints[ringSize++] = isQuad ? cOpp : cNext
        if (this.corners[corner].sharesWithPrev) ringPoints[ringSize++] = this.localRingOffsets[cPrev] + this.localRingSizes[cPrev] - 1
        for (let i = 0; i < this.localRingSizes[corner]; ++i) ringPoints[ringSize++] = this.localRingOffsets[corner] + i
        if (isQuad) {
            if (this.corners[corner].sharesWithNext) ringPoints[ringSize++] = this.localRingOffsets[cNext]
            if (this.corners[cNext].val2Interior && !this.corners[corner].boundary) ringPoints[ringSize++] = cOpp
        } else {
            if (this.corners[corner].sharesWithNext) {
                if (this.corners[cNext].val2Interior && !this.corners[corner].boundary) ringPoints[ringSize++] = cPrev
                else if (this.localRingSizes[cNext] === 0) ringPoints[ringSize++] = this.localRingOffsets[cPrev]
                else ringPoints[ringSize++] = this.localRingOffsets[cNext]
            }
        }
        if (ringSize !== this.ringSizes[corner]) throw new Error('SourcePatch::GetCornerRingPoints: ring size mismatch')
        if (this.corners[corner].patchFace) {
            // `std::rotate(first, first + rotationOffset, last)`.
            const rotationOffset = ringSize - (1 + isQuad) * this.corners[corner].patchFace
            const rotated = ringPoints.slice(rotationOffset, ringSize).concat(ringPoints.slice(0, rotationOffset))
            for (let i = 0; i < ringSize; ++i) ringPoints[i] = rotated[i]
        }
        return ringSize
    }
}

// endregion

/** `PatchBuilder::BasisType` (`patchBuilder.h:155`). */
export const enum BasisType {
    UNSPECIFIED = 0,
    REGULAR = 1,
    GREGORY = 2,
    LINEAR = 3,
    BEZIER = 4,
}

/** `PatchBuilder::Options` (`patchBuilder.h:168`). */
export interface PatchBuilderOptions {
    regBasisType: BasisType
    irregBasisType: BasisType
    fillMissingBoundaryPoints: boolean
    approxInfSharpWithSmooth: boolean
    approxSmoothCornerWithSharp: boolean
}

/** `PatchBuilder::SingleCreaseInfo`. */
export interface SingleCreaseInfo {
    creaseEdgeInFace: number
    creaseSharpness: number
}

/** `Far::PatchBuilder` (`patchBuilder.h:145`), the quad schemes. */
export abstract class PatchBuilder {
    readonly schemeType: SchemeType
    readonly schemeRegFaceSize: number
    readonly schemeIsLinear: boolean
    regPatchType = PatchType.NON_PATCH
    irregPatchType = PatchType.NON_PATCH
    nativePatchType = PatchType.NON_PATCH
    linearPatchType = PatchType.NON_PATCH

    /** `PatchBuilder::Create` (:492). */
    static create(refiner: TopologyRefiner, options: PatchBuilderOptions): PatchBuilder {
        switch (refiner.getSchemeType()) {
        case SchemeType.BILINEAR: return new BilinearPatchBuilder(refiner, options)
        case SchemeType.CATMARK: return new CatmarkPatchBuilder(refiner, options)
        default: throw new Error('OpenSubdiv: LoopPatchBuilder (Loop scheme) is not ported')
        }
    }

    /** `PatchBuilder::PatchBuilder` (:505). */
    protected constructor(readonly refiner: TopologyRefiner, readonly options: PatchBuilderOptions) {
        this.schemeType = refiner.getSchemeType()
        this.schemeRegFaceSize = SchemeTypeTraits.getRegularFaceSize(this.schemeType)
        this.schemeIsLinear = SchemeTypeTraits.getLocalNeighborhoodSize(this.schemeType) === 0
    }

    getRegularFaceSize() { return this.schemeRegFaceSize }
    getRegularPatchType() { return this.regPatchType }
    getIrregularPatchType() { return this.irregPatchType }
    getNativePatchType() { return this.nativePatchType }
    getLinearPatchType() { return this.linearPatchType }

    protected abstract convertToPatchType(sourcePatch: SourcePatch, patchType: PatchType, matrix: SparseMatrix): number

    /** `IsFaceAPatch` (:521). */
    isFaceAPatch(levelIndex: number, faceIndex: number): boolean {
        const level = this.refiner.getVtrLevel(levelIndex)
        if (this.refiner.getHasHoles() && level.isFaceHole(faceIndex)) return false
        if (levelIndex === 0) {
            if (this.schemeIsLinear) return level.getFaceVertices(faceIndex).size === this.schemeRegFaceSize
            return !(level.getFaceCompositeVTag(faceIndex) & VT_INCID_IRREG_FACE)
        }
        if (this.schemeRegFaceSize === 4) return !(level.getFaceCompositeVTag(faceIndex) & VT_INCOMPLETE)
        throw new Error('OpenSubdiv: PatchBuilder::IsFaceAPatch for triangles (Loop scheme) is not ported')
    }

    /** `IsFaceALeaf` (:549). */
    isFaceALeaf(levelIndex: number, faceIndex: number): boolean {
        if (levelIndex < this.refiner.getMaxLevel()) {
            if (this.refiner.getRefinement(levelIndex).getParentFaceSparseTag(faceIndex).selected) return false
        }
        return true
    }

    /** `IsPatchRegular` (:562). */
    isPatchRegular(levelIndex: number, faceIndex: number, fvc = -1): boolean {
        if (this.schemeIsLinear) return true
        const level = this.refiner.getVtrLevel(levelIndex)
        const vTags: number[] = []
        level.getFaceVTags(faceIndex, vTags, fvc)
        let fCompVTag = vTags[0]
        for (let i = 1; i < this.schemeRegFaceSize; ++i) fCompVTag |= vTags[i]
        if (!(fCompVTag & VT_INF_SHARP) && !(fCompVTag & VT_INF_SHARP_EDGES)) return !(fCompVTag & VT_XORDINARY)
        const testInfSharpFeatures = !this.options.approxInfSharpWithSmooth
        const irregFeatureMask = VT_NON_MANIFOLD | VT_XORDINARY | (testInfSharpFeatures ? VT_INF_IRREGULAR : 0)
        if ((fCompVTag & irregFeatureMask) === 0) return true
        const mayHaveIrregFaces = this.refiner.hasIrregFaces
        const needsExtraIsoLevel = (fCompVTag & VT_XORDINARY) && mayHaveIrregFaces ? 1 : 0
        const featureIsIsolated = levelIndex > needsExtraIsoLevel
        if (featureIsIsolated) {
            const featureRequiresFurtherInspection = !!(fCompVTag & VT_NON_MANIFOLD)
                || (this.options.approxSmoothCornerWithSharp && !!(fCompVTag & VT_XORDINARY) && !!(fCompVTag & VT_BOUNDARY))
                || (testInfSharpFeatures && !!(fCompVTag & VT_INF_IRREGULAR) && !!(fCompVTag & VT_INF_SHARP_EDGES))
            if (!featureRequiresFurtherInspection) {
                if (testInfSharpFeatures) return !(fCompVTag & VT_INF_IRREGULAR)
                else return !(fCompVTag & VT_XORDINARY)
            }
        }
        const nRegBoundaryFaces = this.schemeRegFaceSize === 4 ? 2 : 3
        for (let i = 0; i < this.schemeRegFaceSize; ++i) {
            const vTag = vTags[i]
            if ((vTag & irregFeatureMask) === 0) continue
            if (vTag & VT_NON_MANIFOLD) {
                const nSpanFaces = countNonManifoldCornerSpan(level, faceIndex, i, getSingularEdgeMask(testInfSharpFeatures), fvc)
                if (vTag & VT_INF_SHARP) {
                    if (nSpanFaces !== 1) return false
                } else {
                    if (nSpanFaces !== nRegBoundaryFaces) return false
                }
                continue
            }
            if (vTag & VT_XORDINARY) {
                if (!(vTag & VT_INF_SHARP_EDGES)) return false
                if (this.options.approxSmoothCornerWithSharp && vTag & VT_BOUNDARY && !(vTag & VT_INF_SHARP)) {
                    const eTags: number[] = []
                    level.getFaceETags(faceIndex, eTags, fvc)
                    const iPrev = i ? i - 1 : this.schemeRegFaceSize - 1
                    if (eTags[i] & ET_BOUNDARY && eTags[iPrev] & ET_BOUNDARY) continue
                }
                if (!testInfSharpFeatures) return false
            }
            if (vTag & VT_INF_IRREGULAR) {
                if (!(vTag & VT_INF_SHARP_EDGES)) return false
                if (vTag & VT_INF_SHARP_CREASE && vTag & VT_BOUNDARY) return false
                const nSpanFaces = countManifoldCornerSpan(level, faceIndex, i, getSingularEdgeMask(true), fvc)
                if (vTag & VT_INF_SHARP_CREASE) {
                    if (nSpanFaces !== nRegBoundaryFaces) return false
                } else {
                    if (nSpanFaces !== 1) return false
                }
            }
        }
        return true
    }

    /** `GetRegularPatchBoundaryMask` (:680). */
    getRegularPatchBoundaryMask(levelIndex: number, faceIndex: number, fvarChannel = -1): number {
        if (this.schemeIsLinear) return 0
        const level = this.refiner.getVtrLevel(levelIndex)
        const vTags: number[] = []
        const eTags: number[] = []
        level.getFaceVTags(faceIndex, vTags, fvarChannel)
        let fTag = vTags[0]
        for (let i = 1; i < this.schemeRegFaceSize; ++i) fTag |= vTags[i]
        if (!(fTag & VT_INF_SHARP_EDGES)) return 0
        level.getFaceETags(faceIndex, eTags, fvarChannel)
        const testInfSharpFeatures = !this.options.approxInfSharpWithSmooth
        const eFeatureMask = ET_BOUNDARY | (testInfSharpFeatures ? ET_INF_SHARP : 0) | ET_NON_MANIFOLD
        let eBits = ((eTags[0] & eFeatureMask) !== 0 ? 1 : 0) | ((eTags[1] & eFeatureMask) !== 0 ? 2 : 0) | ((eTags[2] & eFeatureMask) !== 0 ? 4 : 0)
        if (this.schemeRegFaceSize === 4) {
            eBits |= (eTags[3] & eFeatureMask) !== 0 ? 8 : 0
            return eBits
        }
        throw new Error('OpenSubdiv: triangular patch boundary masks (Loop scheme) are not ported')
    }

    /** `GetIrregularPatchCornerSpans` (:739). */
    getIrregularPatchCornerSpans(levelIndex: number, faceIndex: number, cornerSpans: VSpan[], fvarChannel = -1): void {
        const level = this.refiner.getVtrLevel(levelIndex)
        const vTags: number[] = []
        level.getFaceVTags(faceIndex, vTags, fvarChannel)
        const fvarTags = fvarChannel >= 0 ? level.getFVarLevel(fvarChannel).getFaceValueTags(faceIndex) : []
        const testInfSharpFeatures = !this.options.approxInfSharpWithSmooth
        const singularEdgeMask = getSingularEdgeMask(testInfSharpFeatures)
        for (let i = 0; i < this.schemeRegFaceSize; ++i) {
            const vTag = vTags[i]
            const isNonManifold = !!(vTag & VT_NON_MANIFOLD)
            const isFVarMisMatch = fvarChannel >= 0 && fvarTags[i].isMismatch()
            const testInfSharpEdges = testInfSharpFeatures && !!(vTag & VT_INF_SHARP_EDGES) && vtRule(vTag) !== Rule.DART
            if (testInfSharpEdges || isFVarMisMatch || isNonManifold) {
                if (isNonManifold) identifyNonManifoldCornerSpan(level, faceIndex, i, singularEdgeMask, cornerSpans[i], fvarChannel)
                else identifyManifoldCornerSpan(level, faceIndex, i, singularEdgeMask, cornerSpans[i], fvarChannel)
            } else {
                clearVSpan(cornerSpans[i])
            }
            if (vTag & VT_CORNER) {
                if (isFVarMisMatch) cornerSpans[i].sharp = cornerSpans[i].numFaces === 1 || isNonManifold
                else cornerSpans[i].sharp = true
            } else if (isNonManifold) {
                cornerSpans[i].sharp = !!(vTag & VT_INF_SHARP)
            } else if (testInfSharpFeatures) {
                cornerSpans[i].sharp = testInfSharpEdges ? !(vTag & VT_INF_SHARP_CREASE) : !!(vTag & VT_INF_SHARP)
            }
            const smoothCorner = !cornerSpans[i].sharp
            if (smoothCorner && this.options.approxSmoothCornerWithSharp && vTag & VT_XORDINARY && vTag & VT_BOUNDARY
                && !(vTag & VT_INF_SHARP) && !(vTag & VT_NON_MANIFOLD)) {
                const nFaces = isAssigned(cornerSpans[i]) ? cornerSpans[i].numFaces
                    : level.getVertexFaces(level.getFaceVertices(faceIndex).get(i)).size
                cornerSpans[i].sharp = nFaces === 1
            }
        }
    }

    /** `getRegularFacePoints` (:812). */
    private getRegularFacePoints(levelIndex: number, faceIndex: number, patchPoints: number[], fvarChannel: number): number {
        const level = this.refiner.getVtrLevel(levelIndex)
        const facePoints = getFacePoints(level, faceIndex, fvarChannel)
        for (let i = 0; i < facePoints.size; ++i) patchPoints[i] = facePoints.get(i)
        return facePoints.size
    }

    /** `getQuadRegularPatchPoints` (:827). */
    private getQuadRegularPatchPoints(levelIndex: number, faceIndex: number, regBoundaryMask: number, patchPoints: number[], fvarChannel: number): number {
        if (regBoundaryMask < 0) regBoundaryMask = this.getRegularPatchBoundaryMask(levelIndex, faceIndex)
        const interiorPatch = regBoundaryMask === 0
        const patchPointsPerCorner = [[5, 4, 0, 1], [6, 2, 3, 7], [10, 11, 15, 14], [9, 13, 12, 8]]
        const eMask = regBoundaryMask
        const level = this.refiner.getVtrLevel(levelIndex)
        const fVerts = level.getFaceVertices(faceIndex)
        const fPoints = getFacePoints(level, faceIndex, fvarChannel)
        let boundaryPoint = INDEX_INVALID
        if (!interiorPatch && this.options.fillMissingBoundaryPoints) boundaryPoint = fPoints.get(0)
        const vIn = {vIn: 0}
        for (let i = 0; i < 4; ++i) {
            const v = fVerts.get(i)
            const cornerPointIndices = patchPointsPerCorner[i]
            const vFaces = level.getVertexFaces(v)
            const vInFaces = level.getVertexFaceLocalIndices(v)
            const f = faceIndex
            const fInVFaces = vFaces.findIndex(f)
            const interiorCorner = interiorPatch || ((eMask & (1 << i)) | (eMask & (1 << fastMod4(i + 3)))) === 0
            if (interiorCorner) {
                const fOppInVFaces = fastMod4(fInVFaces + 2)
                const fOpp = vFaces.get(fOppInVFaces)
                const vInFOpp = vInFaces.get(fOppInVFaces)
                const fOppPoints = getFacePoints(level, fOpp, fvarChannel)
                patchPoints[cornerPointIndices[1]] = fOppPoints.get(fastMod4(vInFOpp + 1))
                patchPoints[cornerPointIndices[2]] = fOppPoints.get(fastMod4(vInFOpp + 2))
                patchPoints[cornerPointIndices[3]] = fOppPoints.get(fastMod4(vInFOpp + 3))
            } else if (eMask & (1 << i) && eMask & (1 << fastMod4(i + 3))) {
                patchPoints[cornerPointIndices[1]] = boundaryPoint
                patchPoints[cornerPointIndices[2]] = boundaryPoint
                patchPoints[cornerPointIndices[3]] = boundaryPoint
            } else if (eMask & (1 << i)) {
                const fNext = getNextFaceInVertFaces(level, fInVFaces, vFaces, vInFaces, !(level.getVertexTag(v) & VT_NON_MANIFOLD), vIn)
                const fNextPoints = getFacePoints(level, fNext, fvarChannel)
                patchPoints[cornerPointIndices[1]] = fNextPoints.get(fastMod4(vIn.vIn + 3))
                patchPoints[cornerPointIndices[2]] = boundaryPoint
                patchPoints[cornerPointIndices[3]] = boundaryPoint
            } else {
                const fPrev = getPrevFaceInVertFaces(level, fInVFaces, vFaces, vInFaces, !(level.getVertexTag(v) & VT_NON_MANIFOLD), vIn)
                const fPrevPoints = getFacePoints(level, fPrev, fvarChannel)
                patchPoints[cornerPointIndices[1]] = boundaryPoint
                patchPoints[cornerPointIndices[2]] = boundaryPoint
                patchPoints[cornerPointIndices[3]] = fPrevPoints.get(fastMod4(vIn.vIn + 1))
            }
            patchPoints[cornerPointIndices[0]] = fPoints.get(i)
        }
        return 16
    }

    /** `GetRegularPatchPoints` (:1012). */
    getRegularPatchPoints(levelIndex: number, faceIndex: number, regBoundaryMask: number, patchPoints: number[], fvarChannel = -1): number {
        if (this.schemeIsLinear) return this.getRegularFacePoints(levelIndex, faceIndex, patchPoints, fvarChannel)
        if (this.schemeRegFaceSize === 4) return this.getQuadRegularPatchPoints(levelIndex, faceIndex, regBoundaryMask, patchPoints, fvarChannel)
        throw new Error('OpenSubdiv: getTriRegularPatchPoints (Loop scheme) is not ported')
    }

    /** `assembleIrregularSourcePatch` (:1029). */
    private assembleIrregularSourcePatch(levelIndex: number, faceIndex: number, cornerSpans: VSpan[], sourcePatch: SourcePatch): number {
        const level = this.refiner.getVtrLevel(levelIndex)
        const fVerts = level.getFaceVertices(faceIndex)
        for (let corner = 0; corner < fVerts.size; ++corner) {
            const vTag = level.getVertexTag(fVerts.get(corner))
            const patchCorner = sourcePatch.corners[corner]
            if (isAssigned(cornerSpans[corner])) {
                patchCorner.numFaces = cornerSpans[corner].numFaces
                patchCorner.patchFace = cornerSpans[corner].cornerInSpan
                patchCorner.boundary = !cornerSpans[corner].periodic ? 1 : 0
            } else {
                const vFaces = level.getVertexFaces(fVerts.get(corner))
                patchCorner.numFaces = vFaces.size
                patchCorner.patchFace = vFaces.findIndex(faceIndex)
                patchCorner.boundary = vTag & VT_BOUNDARY ? 1 : 0
            }
            patchCorner.sharp = cornerSpans[corner].sharp ? 1 : 0
            patchCorner.dart = vtRule(vTag) === Rule.DART && vTag & VT_INF_SHARP_EDGES ? 1 : 0
        }
        sourcePatch.finalize(fVerts.size)
        return sourcePatch.getNumSourcePoints()
    }

    /** `gatherIrregularSourcePoints` (:1081). */
    private gatherIrregularSourcePoints(levelIndex: number, faceIndex: number, cornerSpans: VSpan[], sourcePatch: SourcePatch,
        patchVerts: number[], fvarChannel: number): number {
        const numSourceVerts = sourcePatch.getNumSourcePoints()
        const sourceRingVertices: number[] = []
        const patchRingPoints: number[] = []
        const level = this.refiner.getVtrLevel(levelIndex)
        const faceVerts = level.getFaceVertices(faceIndex)
        for (let corner = 0; corner < sourcePatch.numCorners; ++corner) {
            const cornerVertex = faceVerts.get(corner)
            let sourceRingSize: number
            if (isAssigned(cornerSpans[corner])) {
                sourceRingSize = gatherRegularPartialRingAroundVertex(level, cornerVertex, cornerSpans[corner], sourceRingVertices, fvarChannel)
            } else if (sourcePatch.numCorners === 4) {
                sourceRingSize = level.gatherQuadRegularRingAroundVertex(cornerVertex, sourceRingVertices, fvarChannel)
            } else {
                throw new Error('OpenSubdiv: gatherTriRegularRingAroundVertex (Loop scheme) is not ported')
            }
            const patchRingSize = sourcePatch.getCornerRingPoints(corner, patchRingPoints)
            if (patchRingSize !== sourceRingSize) throw new Error('PatchBuilder::gatherIrregularSourcePoints: ring size mismatch')
            for (let i = 0; i < patchRingSize; ++i) patchVerts[patchRingPoints[i]] = sourceRingVertices[i]
        }
        return numSourceVerts
    }

    /** `GetIrregularPatchSourcePoints` (:1125). */
    getIrregularPatchSourcePoints(levelIndex: number, faceIndex: number, cornerSpans: VSpan[], sourcePoints: number[], fvarChannel = -1): number {
        const sourcePatch = new SourcePatch()
        this.assembleIrregularSourcePatch(levelIndex, faceIndex, cornerSpans, sourcePatch)
        return this.gatherIrregularSourcePoints(levelIndex, faceIndex, cornerSpans, sourcePatch, sourcePoints, fvarChannel)
    }

    /** `GetIrregularPatchConversionMatrix<float>` (:1144). */
    getIrregularPatchConversionMatrix(levelIndex: number, faceIndex: number, cornerSpans: VSpan[], conversionMatrix: SparseMatrix): number {
        const sourcePatch = new SourcePatch()
        this.assembleIrregularSourcePatch(levelIndex, faceIndex, cornerSpans, sourcePatch)
        return this.convertToPatchType(sourcePatch, this.getIrregularPatchType(), conversionMatrix)
    }

    /** `IsRegularSingleCreasePatch` (:1165). */
    isRegularSingleCreasePatch(levelIndex: number, faceIndex: number): SingleCreaseInfo | undefined {
        if (this.schemeRegFaceSize !== 4) return undefined
        const r = this.refiner.getVtrLevel(levelIndex).isSingleCreasePatch(faceIndex)
        return r ? {creaseEdgeInFace: r.sharpEdgeInFace, creaseSharpness: r.sharpness} : undefined
    }

    /** `ComputePatchParam` (:1177) for the quad schemes. */
    computePatchParam(levelIndex: number, faceIndex: number, ptexIndices: PtexIndices, isRegular = true, boundaryMask = 0,
        computeTransitionMask = false): PatchParam {
        const depth = levelIndex
        let childIndexInParent = 0, u = 0, v = 0, ofs = 1
        const regFaceSize = this.schemeRegFaceSize
        if (regFaceSize === 3) throw new Error('OpenSubdiv: triangle patch parameterisation (Loop) is not ported')
        let irregBase = this.refiner.getVtrLevel(depth).getFaceVertices(faceIndex).size !== regFaceSize
        let childFaceIndex = faceIndex
        for (let i = depth; i > 0; --i) {
            const refinement = this.refiner.getRefinement(i - 1)
            const parentLevel = this.refiner.getVtrLevel(i - 1)
            const parentFaceIndex = refinement.getChildFaceParentFace(childFaceIndex)
            irregBase = parentLevel.getFaceVertices(parentFaceIndex).size !== regFaceSize
            if (!irregBase) {
                childIndexInParent = refinement.getChildFaceInParentFace(childFaceIndex)
                switch (childIndexInParent) {
                case 0: break
                case 1: u += ofs; break
                case 2: u += ofs; v += ofs; break
                case 3: v += ofs; break
                }
                ofs = (ofs << 1) & 0xffff
            } else {
                const children = refinement.getFaceChildFaces(parentFaceIndex)
                for (let j = 0; j < children.size; ++j) {
                    if (children.get(j) === childFaceIndex) {
                        childIndexInParent = j
                        break
                    }
                }
            }
            childFaceIndex = parentFaceIndex
        }
        const baseFaceIndex = childFaceIndex
        let ptexIndex = ptexIndices.getFaceId(baseFaceIndex)
        if (irregBase) ptexIndex += childIndexInParent
        let transitionMask = 0
        if (computeTransitionMask && levelIndex < this.refiner.getMaxLevel()) {
            transitionMask = this.refiner.getRefinement(levelIndex).getParentFaceSparseTag(faceIndex).transitional
        }
        return PatchParam.make(ptexIndex, u, v, depth, irregBase, boundaryMask, transitionMask, isRegular)
    }
}

// region CatmarkLimits (`catmarkPatchBuilder.cpp:46-293`)

/** `CatmarkLimits<REAL>::computeCoefficient` (:66). */
function computeCoefficient(valence: number): number {
    const efTable = [
        0.0, 0.0, 0.0,
        8.1281572906372312e-01, 0.5, 3.6364406329142801e-01,
        2.8751379706077085e-01, 2.3868786685851678e-01, 2.0454364190756097e-01,
        1.7922903958061159e-01, 1.5965737079986253e-01, 1.4404233443011302e-01,
        1.3127568415883017e-01, 1.2063172212675841e-01, 1.1161437506676930e-01,
        1.0387245516114274e-01, 9.7150019090724835e-02, 9.1255917505950648e-02,
        8.6044378511602668e-02, 8.1402211336798411e-02, 7.7240129516184072e-02,
        7.3486719751997026e-02, 7.0084157479797987e-02, 6.6985104030725440e-02,
        6.4150420569810074e-02, 6.1547457638637268e-02, 5.9148757447233989e-02,
        5.6931056818776957e-02, 5.4874512279256417e-02, 5.2962091433796134e-02,
    ]
    if (valence < 30) return efTable[valence]
    const invValence = 1.0 / valence
    const cosT = cos(2.0 * Math.PI * invValence)
    const divisor = (cosT + 5.0) + Math.sqrt((cosT + 9.0) * (cosT + 1.0))
    return 16.0 * invValence / divisor
}

/** `CatmarkLimits<float>::ComputeInteriorPointWeights` (:94). Weights are floats; intermediates double. */
function computeInteriorPointWeights(valence: number, faceInRing: number, pWeights: number[], epWeights: number[] | undefined,
    emWeights: number[] | undefined): void {
    const computeEdgePoints = !!(epWeights && emWeights)
    const fValence = valence
    const oneOverValence = 1.0 / fValence
    const oneOverValPlus5 = 1.0 / (fValence + 5.0)
    const pCoeff = oneOverValence * oneOverValPlus5
    const tanCoeff = computeCoefficient(valence) * 0.5 * oneOverValPlus5
    const faceAngle = 2.0 * Math.PI * oneOverValence
    const weightWidth = 1 + 2 * valence
    const tanWeights = new Array<number>(weightWidth).fill(0)
    pWeights[0] = f32(fValence * oneOverValPlus5)
    // `pW = &pWeights[1]`, `tW = &tanWeights[1]`.
    for (let i = 0; i < valence; ++i) {
        pWeights[1 + 2 * i] = f32(pCoeff * 4.0)
        pWeights[1 + 2 * i + 1] = f32(pCoeff)
        if (computeEdgePoints) {
            const iPrev = (i + valence - 1) % valence
            const iNext = (i + 1) % valence
            const cosICoeff = tanCoeff * cos(faceAngle * i)
            tanWeights[1 + 2 * iPrev] = f32(tanWeights[1 + 2 * iPrev] + f32(cosICoeff * 2.0))
            tanWeights[1 + 2 * iPrev + 1] = f32(tanWeights[1 + 2 * iPrev + 1] + f32(cosICoeff))
            tanWeights[1 + 2 * i] = f32(tanWeights[1 + 2 * i] + f32(cosICoeff * 4.0))
            tanWeights[1 + 2 * i + 1] = f32(tanWeights[1 + 2 * i + 1] + f32(cosICoeff))
            tanWeights[1 + 2 * iNext] = f32(tanWeights[1 + 2 * iNext] + f32(cosICoeff * 2.0))
        }
    }
    if (computeEdgePoints) {
        const epOffset = 2 * ((valence - faceInRing) % valence)
        const emOffset = 2 * ((valence - faceInRing - 1 + valence) % valence)
        epWeights![0] = pWeights[0]
        emWeights![0] = pWeights[0]
        for (let i = 1; i < weightWidth; ++i) {
            let ip = i + epOffset
            if (ip >= weightWidth) ip -= weightWidth - 1
            let im = i + emOffset
            if (im >= weightWidth) im -= weightWidth - 1
            epWeights![i] = f32(pWeights[i] + tanWeights[ip])
            emWeights![i] = f32(pWeights[i] + tanWeights[im])
        }
    }
}

/** `CatmarkLimits<float>::ComputeBoundaryPointWeights` (:186). */
function computeBoundaryPointWeights(valence: number, faceInRing: number, pWeights: number[], epWeights: number[], emWeights: number[]): void {
    const numFaces = valence - 1
    const faceAngle = Math.PI / numFaces
    const weightWidth = 2 * valence
    const N = weightWidth - 1
    for (let i = 0; i < weightWidth; ++i) pWeights[i] = 0
    pWeights[0] = f32(4.0 / 6.0)
    pWeights[1] = f32(1.0 / 6.0)
    pWeights[N] = f32(1.0 / 6.0)
    const tBoundaryCoeff1 = 1.0 / 6.0
    const tBoundaryCoeffN = -1.0 / 6.0
    const tanWeights = new Array<number>(weightWidth).fill(0)
    {
        const k = numFaces
        const theta = faceAngle
        // `std::cos(theta)` and `std::sin(theta)` in one block: one `__sincos_stret`.
        const [s, c] = sincos(theta)
        const div3 = 1.0 / 3.0
        // `1.0f / (3.0f * k + c)`: contracted to `fma(3, k, c)`; `3 * k` is exact for a valence.
        const div3kc = 1.0 / (3.0 * k + c)
        const gamma = -4.0 * s * div3kc
        // `1.0f + 2.0f * c`: contracted, `2 * c` is exact.
        const alpha0k = -((1.0 + 2.0 * c) * Math.sqrt(1.0 + c)) * div3kc / Math.sqrt(1.0 - c)
        const beta0 = s * div3kc
        tanWeights[0] = f32(gamma * div3)
        tanWeights[1] = f32(alpha0k * div3)
        tanWeights[2] = f32(beta0 * div3)
        tanWeights[N] = f32(alpha0k * div3)
        for (let i = 1; i < valence - 1; ++i) {
            const sinThetaI = sin(theta * i)
            const sinThetaIplus1 = sin(theta * (i + 1))
            const alpha = 4.0 * sinThetaI * div3kc
            const beta = (sinThetaI + sinThetaIplus1) * div3kc
            tanWeights[1 + 2 * i] = f32(alpha * div3)
            tanWeights[1 + 2 * i + 1] = f32(beta * div3)
        }
    }
    if (faceInRing === 0) {
        for (let i = 0; i < weightWidth; ++i) epWeights[i] = 0
        epWeights[0] = f32(2.0 / 3.0)
        epWeights[1] = f32(1.0 / 3.0)
    } else {
        const iEdgeNext = faceInRing
        const faceAngleNext = faceAngle * iEdgeNext
        const [sinAngleNext, cosAngleNext] = sincos(faceAngleNext)
        for (let i = 0; i < weightWidth; ++i) epWeights[i] = f32(tanWeights[i] * sinAngleNext)
        epWeights[0] = f32(epWeights[0] + pWeights[0])
        epWeights[1] = f32(epWeights[1] + f32(pWeights[1] + f32(tBoundaryCoeff1 * cosAngleNext)))
        epWeights[N] = f32(epWeights[N] + f32(pWeights[N] + f32(tBoundaryCoeffN * cosAngleNext)))
    }
    if (faceInRing === numFaces - 1) {
        for (let i = 0; i < weightWidth; ++i) emWeights[i] = 0
        emWeights[0] = f32(2.0 / 3.0)
        emWeights[N] = f32(1.0 / 3.0)
    } else {
        const iEdgePrev = (faceInRing + 1) % valence
        const faceAnglePrev = faceAngle * iEdgePrev
        const [sinAnglePrev, cosAnglePrev] = sincos(faceAnglePrev)
        for (let i = 0; i < weightWidth; ++i) emWeights[i] = f32(tanWeights[i] * sinAnglePrev)
        emWeights[0] = f32(emWeights[0] + pWeights[0])
        emWeights[1] = f32(emWeights[1] + f32(pWeights[1] + f32(tBoundaryCoeff1 * cosAnglePrev)))
        emWeights[N] = f32(emWeights[N] + f32(pWeights[N] + f32(tBoundaryCoeffN * cosAnglePrev)))
    }
}

// endregion

// region SparseMatrix utilities (`catmarkPatchBuilder.cpp:306-545`)

/** `SparseMatrixRow<REAL>` (:308): a row of a matrix, by offset into its arrays. */
class SparseMatrixRow {
    readonly size: number
    readonly offset: number
    constructor(readonly matrix: SparseMatrix, row: number) {
        this.size = matrix.getRowSize(row)
        this.offset = matrix.rowOffset(row)
    }

    getSize() { return this.size }
    index(i: number) { return this.matrix.columns[this.offset + i] }
    weight(i: number) { return this.matrix.elements[this.offset + i] }

    assign(rowEntry: number, index: number, weight: number): void {
        this.matrix.columns[this.offset + rowEntry] = index
        this.matrix.elements[this.offset + rowEntry] = weight
    }

    copy(other: SparseMatrixRow): void {
        if (other.size !== this.size) throw new Error('SparseMatrixRow::Copy: size mismatch')
        for (let i = 0; i < this.size; ++i) {
            this.matrix.columns[this.offset + i] = other.matrix.columns[other.offset + i]
            this.matrix.elements[this.offset + i] = other.matrix.elements[other.offset + i]
        }
    }
}

/** `_resizeMatrix` (:388). */
function resizeMatrix(matrix: SparseMatrix, numRows: number, numColumns: number, numElements: number, rowSizes: number[]): void {
    matrix.resize(numRows, numColumns, numElements)
    for (let i = 0; i < numRows; ++i) matrix.setRowSize(i, rowSizes[i])
    if (matrix.getNumElements() !== numElements) throw new Error('GregoryConverter: matrix size mismatch')
}

/** `_addSparsePointToFullRow` (:400): `fullRow[index] += s * w` contracts to an FMA. */
function addSparsePointToFullRow(fullRow: number[], p: SparseMatrixRow, s: number, indexMask: number[]): void {
    for (let i = 0; i < p.getSize(); ++i) {
        const index = p.index(i)
        fullRow[index] = fmaf(s, p.weight(i), fullRow[index])
        indexMask[index] = 1 + index
    }
}

/** `_removeValence2Duplicates` (:476). */
function removeValence2Duplicates(M: SparseMatrix): void {
    const regFaceSize = 4
    const T = new SparseMatrix()
    T.resize(M.getNumRows(), M.getNumColumns(), M.getNumElements())
    const nRows = M.getNumRows()
    for (let row = 0; row < nRows; ++row) {
        const srcRowSize = M.getRowSize(row)
        const srcOffset = M.rowOffset(row)
        const cornerUsed = [false, false, false, false]
        let srcDupCount = 0
        for (let i = 0; i < srcRowSize; ++i) {
            const srcIndex = M.columns[srcOffset + i]
            if (srcIndex < regFaceSize) {
                srcDupCount += cornerUsed[srcIndex] ? 1 : 0
                cornerUsed[srcIndex] = true
            }
        }
        T.setRowSize(row, srcRowSize - srcDupCount)
        let dst = T.rowOffset(row)
        if (srcDupCount) {
            const cornerDst = [-1, -1, -1, -1]
            for (let i = 0; i < srcRowSize; ++i) {
                const srcIndex = M.columns[srcOffset + i]
                const srcWeight = M.elements[srcOffset + i]
                if (srcIndex < regFaceSize) {
                    if (cornerDst[srcIndex] >= 0) {
                        T.elements[cornerDst[srcIndex]] = f32(T.elements[cornerDst[srcIndex]] + srcWeight)
                        continue
                    } else {
                        cornerDst[srcIndex] = dst
                    }
                }
                T.columns[dst] = srcIndex
                T.elements[dst] = srcWeight
                dst++
            }
        } else {
            for (let i = 0; i < srcRowSize; ++i) {
                T.columns[dst + i] = M.columns[srcOffset + i]
                T.elements[dst + i] = M.elements[srcOffset + i]
            }
        }
    }
    M.swap(T)
}

// endregion

// region GregoryConverter (`catmarkPatchBuilder.cpp:584-1384`)

/** `GregoryConverter<REAL>::CornerTopology` (:615). */
interface CornerTopology {
    isBoundary: number
    isSharp: number
    isDart: number
    isRegular: boolean
    isVal2Int: number
    epOnBoundary: boolean
    emOnBoundary: boolean
    fpIsRegular: boolean
    fmIsRegular: boolean
    fpIsCopied: boolean
    fmIsCopied: boolean
    valence: number
    numFaces: number
    faceInRing: number
    faceAngle: number
    cosFaceAngle: number
    sinFaceAngle: number
    ringPoints: number[]
}

/** `GregoryConverter<float>` (:585): the change of basis from a SourcePatch's points to the 20 Gregory points. */
class GregoryConverter {
    private numSourcePoints = 0
    private maxValence = 0
    private isIsolatedInteriorPatch = false
    private hasVal2InteriorCorner = false
    private isolatedCorner = 0
    private isolatedValence = 0
    private readonly corners: CornerTopology[] = []

    /** `GregoryConverter(sourcePatch, matrix)` (:703). */
    constructor(sourcePatch: SourcePatch, matrix: SparseMatrix) {
        this.initialize(sourcePatch)
        this.convert(matrix)
    }

    /** `Initialize` (:712). */
    private initialize(sourcePatch: SourcePatch): void {
        const width = sourcePatch.getNumSourcePoints()
        this.numSourcePoints = width
        this.maxValence = sourcePatch.getMaxValence()
        let boundaryCount = 0, irregularCount = 0, irregularCorner = -1, irregularValence = -1, sharpCount = 0, val2IntCount = 0
        for (let cIndex = 0; cIndex < 4; ++cIndex) {
            const srcCorner = sourcePatch.corners[cIndex]
            const corner = {} as CornerTopology
            this.corners[cIndex] = corner
            corner.isBoundary = srcCorner.boundary
            corner.isSharp = srcCorner.sharp
            corner.isDart = srcCorner.dart
            corner.numFaces = srcCorner.numFaces
            corner.faceInRing = srcCorner.patchFace
            corner.isVal2Int = srcCorner.val2Interior
            corner.valence = corner.numFaces + corner.isBoundary
            corner.isRegular = (corner.numFaces << corner.isBoundary) === 4 && !corner.isSharp
            if (corner.isRegular) {
                corner.faceAngle = f32(Math.PI / 2)
                corner.cosFaceAngle = 0
                corner.sinFaceAngle = 1
            } else {
                // `(isBoundary ? REAL(M_PI) : (2.0f * REAL(M_PI))) / REAL(numFaces)` in float.
                const fPi = f32(Math.PI)
                corner.faceAngle = f32((corner.isBoundary ? fPi : f32(2 * fPi)) / corner.numFaces)
                // `std::cos` and `std::sin` of one float in one block: one `__sincosf_stret`.
                const [s, c] = sincosf(corner.faceAngle)
                corner.cosFaceAngle = c
                corner.sinFaceAngle = s
            }
            corner.ringPoints = []
            sourcePatch.getCornerRingPoints(cIndex, corner.ringPoints)
            corner.ringPoints.length = sourcePatch.getCornerRingSize(cIndex)
            boundaryCount += corner.isBoundary
            if (!corner.isRegular) {
                irregularCount++
                irregularCorner = cIndex
                irregularValence = corner.valence
            }
            sharpCount += corner.isSharp
            val2IntCount += corner.isVal2Int
        }
        for (let cIndex = 0; cIndex < 4; ++cIndex) {
            const corner = this.corners[cIndex]
            const cNext = (cIndex + 1) & 0x3
            const cPrev = (cIndex + 3) & 0x3
            corner.epOnBoundary = false
            corner.emOnBoundary = false
            corner.fpIsRegular = corner.isRegular && this.corners[cNext].isRegular
            corner.fmIsRegular = corner.isRegular && this.corners[cPrev].isRegular
            corner.fpIsCopied = false
            corner.fmIsCopied = false
            if (corner.isBoundary) {
                corner.epOnBoundary = corner.faceInRing === 0
                corner.emOnBoundary = corner.faceInRing === corner.numFaces - 1
                if (corner.numFaces > 1) {
                    if (corner.epOnBoundary) {
                        corner.fpIsRegular = corner.fmIsRegular
                        corner.fpIsCopied = !corner.fpIsRegular
                    }
                    if (corner.emOnBoundary) {
                        corner.fmIsRegular = corner.fpIsRegular
                        corner.fmIsCopied = !corner.fmIsRegular
                    }
                } else {
                    corner.fpIsRegular = true
                    corner.fmIsRegular = true
                }
            }
        }
        this.isIsolatedInteriorPatch = irregularCount === 1 && boundaryCount === 0 && irregularValence > 2 && sharpCount === 0
        if (this.isIsolatedInteriorPatch) {
            this.isolatedCorner = irregularCorner
            this.isolatedValence = irregularValence
        }
        this.hasVal2InteriorCorner = val2IntCount > 0
    }

    /** `Convert` (:824). */
    private convert(matrix: SparseMatrix): void {
        if (this.isIsolatedInteriorPatch) this.resizeMatrixIsolatedIrregular(matrix, this.isolatedCorner, this.isolatedValence)
        else this.resizeMatrixUnisolated(matrix)
        const maxRingSize = 1 + 2 * this.maxValence
        const weightBufferSize = Math.max(3 * maxRingSize, 2 * this.numSourcePoints)
        const weightBuffer = new Array<number>(weightBufferSize).fill(0)
        const indexBuffer = new Array<number>(weightBufferSize).fill(0)
        for (let cIndex = 0; cIndex < 4; ++cIndex) {
            if (this.corners[cIndex].isRegular) this.assignRegularEdgePoints(cIndex, matrix)
            else this.computeIrregularEdgePoints(cIndex, matrix, weightBuffer)
        }
        for (let cIndex = 0; cIndex < 4; ++cIndex) {
            if (this.corners[cIndex].fpIsRegular || this.corners[cIndex].fmIsRegular) this.assignRegularFacePoints(cIndex, matrix)
            if (!this.corners[cIndex].fpIsRegular || !this.corners[cIndex].fmIsRegular) this.computeIrregularFacePoints(cIndex, matrix, weightBuffer, indexBuffer)
        }
        if (this.hasVal2InteriorCorner) removeValence2Duplicates(matrix)
    }

    /** `resizeMatrixIsolatedIrregular` (:872). */
    private resizeMatrixIsolatedIrregular(matrix: SparseMatrix, cornerIndex: number, cornerValence: number): void {
        const irregRingSize = 1 + 2 * cornerValence
        const irregCorner = cornerIndex
        const irregPlus = (cornerIndex + 1) & 0x3
        const irregOpposite = (cornerIndex + 2) & 0x3
        const irregMinus = (cornerIndex + 3) & 0x3
        const rowSizes = new Array<number>(20).fill(0)
        const put = (corner: number, sizes: number[]) => sizes.forEach((s, i) => { rowSizes[corner * 5 + i] = s })
        put(irregCorner, [irregRingSize, irregRingSize, irregRingSize, irregRingSize, irregRingSize])
        put(irregPlus, [9, 6, 6, 4, 3 + irregRingSize])
        put(irregOpposite, [9, 6, 6, 4, 4])
        put(irregMinus, [9, 6, 6, 3 + irregRingSize, 4])
        const numElements = 7 * irregRingSize + 85
        resizeMatrix(matrix, 20, this.numSourcePoints, numElements, rowSizes)
    }

    /** `resizeMatrixUnisolated` (:920). */
    private resizeMatrixUnisolated(matrix: SparseMatrix): void {
        const rowSizes = new Array<number>(20).fill(0)
        let numElements = 0
        for (let cIndex = 0; cIndex < 4; ++cIndex) {
            const r = cIndex * 5
            const corner = this.corners[cIndex]
            if (corner.isRegular) {
                if (!corner.isBoundary) {
                    rowSizes[r] = 9
                    rowSizes[r + 1] = 6
                    rowSizes[r + 2] = 6
                } else {
                    rowSizes[r] = 3
                    rowSizes[r + 1] = corner.epOnBoundary ? 2 : 6
                    rowSizes[r + 2] = corner.emOnBoundary ? 2 : 6
                }
            } else {
                if (corner.isSharp) {
                    rowSizes[r] = 1
                    rowSizes[r + 1] = 2
                    rowSizes[r + 2] = 2
                } else if (!corner.isBoundary) {
                    const ringSize = 1 + 2 * corner.valence
                    rowSizes[r] = ringSize
                    rowSizes[r + 1] = ringSize
                    rowSizes[r + 2] = ringSize
                } else if (corner.numFaces > 1) {
                    const ringSize = 1 + corner.valence + corner.numFaces
                    rowSizes[r] = 3
                    rowSizes[r + 1] = corner.epOnBoundary ? 2 : ringSize
                    rowSizes[r + 2] = corner.emOnBoundary ? 2 : ringSize
                } else {
                    rowSizes[r] = 3
                    rowSizes[r + 1] = 2
                    rowSizes[r + 2] = 2
                }
            }
            numElements += rowSizes[r] + rowSizes[r + 1] + rowSizes[r + 2]
            rowSizes[r + 3] = 4
            rowSizes[r + 4] = 4
            if (!corner.fpIsRegular || !corner.fmIsRegular) {
                const cNext = (cIndex + 1) & 0x3
                const cPrev = (cIndex + 3) & 0x3
                if (!corner.fpIsRegular) rowSizes[r + 3] = this.getIrregularFacePointSize(cIndex, corner.fpIsCopied ? cPrev : cNext)
                if (!corner.fmIsRegular) rowSizes[r + 4] = this.getIrregularFacePointSize(cIndex, corner.fmIsCopied ? cNext : cPrev)
            }
            numElements += rowSizes[r + 3] + rowSizes[r + 4]
        }
        resizeMatrix(matrix, 20, this.numSourcePoints, numElements, rowSizes)
    }

    /** `assignRegularEdgePoints` (:988). */
    private assignRegularEdgePoints(cIndex: number, matrix: SparseMatrix): void {
        const p = new SparseMatrixRow(matrix, 5 * cIndex + 0)
        const ep = new SparseMatrixRow(matrix, 5 * cIndex + 1)
        const em = new SparseMatrixRow(matrix, 5 * cIndex + 2)
        const corner = this.corners[cIndex]
        const cRing = corner.ringPoints
        if (!corner.isBoundary) {
            p.assign(0, cIndex, f32(4.0 / 9.0))
            p.assign(1, cRing[0], f32(1.0 / 9.0))
            p.assign(2, cRing[2], f32(1.0 / 9.0))
            p.assign(3, cRing[4], f32(1.0 / 9.0))
            p.assign(4, cRing[6], f32(1.0 / 9.0))
            p.assign(5, cRing[1], f32(1.0 / 36.0))
            p.assign(6, cRing[3], f32(1.0 / 36.0))
            p.assign(7, cRing[5], f32(1.0 / 36.0))
            p.assign(8, cRing[7], f32(1.0 / 36.0))
            const iEdgeEp = 2 * corner.faceInRing
            const iEdgeEm = 2 * ((corner.faceInRing + 1) & 0x3)
            const iEdgeOp = 2 * ((corner.faceInRing + 2) & 0x3)
            const iEdgeOm = 2 * ((corner.faceInRing + 3) & 0x3)
            ep.assign(0, cIndex, f32(4.0 / 9.0))
            ep.assign(1, cRing[iEdgeEp], f32(2.0 / 9.0))
            ep.assign(2, cRing[iEdgeEm], f32(1.0 / 9.0))
            ep.assign(3, cRing[iEdgeOm], f32(1.0 / 9.0))
            ep.assign(4, cRing[iEdgeEp + 1], f32(1.0 / 18.0))
            ep.assign(5, cRing[iEdgeOm + 1], f32(1.0 / 18.0))
            em.assign(0, cIndex, f32(4.0 / 9.0))
            em.assign(1, cRing[iEdgeEm], f32(2.0 / 9.0))
            em.assign(2, cRing[iEdgeEp], f32(1.0 / 9.0))
            em.assign(3, cRing[iEdgeOp], f32(1.0 / 9.0))
            em.assign(4, cRing[iEdgeEp + 1], f32(1.0 / 18.0))
            em.assign(5, cRing[iEdgeEm + 1], f32(1.0 / 18.0))
        } else {
            const eBoundary = corner.epOnBoundary ? ep : em
            const eInterior = corner.epOnBoundary ? em : ep
            const iBoundary = corner.epOnBoundary ? 0 : 4
            p.assign(0, cIndex, f32(2.0 / 3.0))
            p.assign(1, cRing[0], f32(1.0 / 6.0))
            p.assign(2, cRing[4], f32(1.0 / 6.0))
            eBoundary.assign(0, cIndex, f32(2.0 / 3.0))
            eBoundary.assign(1, cRing[iBoundary], f32(1.0 / 3.0))
            eInterior.assign(0, cIndex, f32(4.0 / 9.0))
            eInterior.assign(1, cRing[2], f32(2.0 / 9.0))
            eInterior.assign(2, cRing[0], f32(1.0 / 9.0))
            eInterior.assign(3, cRing[4], f32(1.0 / 9.0))
            eInterior.assign(4, cRing[1], f32(1.0 / 18.0))
            eInterior.assign(5, cRing[3], f32(1.0 / 18.0))
        }
    }

    /** `computeIrregularEdgePoints` (:1058). */
    private computeIrregularEdgePoints(cIndex: number, matrix: SparseMatrix, weightBuffer: number[]): void {
        const p = new SparseMatrixRow(matrix, 5 * cIndex + 0)
        const ep = new SparseMatrixRow(matrix, 5 * cIndex + 1)
        const em = new SparseMatrixRow(matrix, 5 * cIndex + 2)
        const corner = this.corners[cIndex]
        if (corner.isSharp) {
            p.assign(0, cIndex, 1)
            ep.assign(0, cIndex, f32(2.0 / 3.0))
            ep.assign(1, (cIndex + 1) & 0x3, f32(1.0 / 3.0))
            em.assign(0, cIndex, f32(2.0 / 3.0))
            em.assign(1, (cIndex + 3) & 0x3, f32(1.0 / 3.0))
        } else if (!corner.isBoundary) {
            this.computeIrregularInteriorEdgePoints(cIndex, p, ep, em, weightBuffer)
        } else if (corner.numFaces > 1) {
            this.computeIrregularBoundaryEdgePoints(cIndex, p, ep, em, weightBuffer)
        } else {
            p.assign(0, cIndex, f32(4.0 / 6.0))
            p.assign(1, (cIndex + 1) & 0x3, f32(1.0 / 6.0))
            p.assign(2, (cIndex + 3) & 0x3, f32(1.0 / 6.0))
            ep.assign(0, cIndex, f32(2.0 / 3.0))
            ep.assign(1, (cIndex + 1) & 0x3, f32(1.0 / 3.0))
            em.assign(0, cIndex, f32(2.0 / 3.0))
            em.assign(1, (cIndex + 3) & 0x3, f32(1.0 / 3.0))
        }
    }

    /** `computeIrregularInteriorEdgePoints` (:1119). */
    private computeIrregularInteriorEdgePoints(cIndex: number, p: SparseMatrixRow, ep: SparseMatrixRow, em: SparseMatrixRow, ringWeights: number[]): void {
        const corner = this.corners[cIndex]
        const valence = corner.valence
        const weightWidth = 1 + 2 * valence
        const pWeights: number[] = [], epWeights: number[] = [], emWeights: number[] = []
        computeInteriorPointWeights(valence, corner.faceInRing, pWeights, epWeights, emWeights)
        for (let i = 0; i < weightWidth; ++i) {
            ringWeights[i] = pWeights[i]
            ringWeights[weightWidth + i] = epWeights[i]
            ringWeights[2 * weightWidth + i] = emWeights[i]
        }
        p.assign(0, cIndex, pWeights[0])
        ep.assign(0, cIndex, epWeights[0])
        em.assign(0, cIndex, emWeights[0])
        for (let i = 1; i < weightWidth; ++i) {
            const pRingPoint = corner.ringPoints[i - 1]
            p.assign(i, pRingPoint, pWeights[i])
            ep.assign(i, pRingPoint, epWeights[i])
            em.assign(i, pRingPoint, emWeights[i])
        }
    }

    /** `computeIrregularBoundaryEdgePoints` (:1165). */
    private computeIrregularBoundaryEdgePoints(cIndex: number, p: SparseMatrixRow, ep: SparseMatrixRow, em: SparseMatrixRow, ringWeights: number[]): void {
        const corner = this.corners[cIndex]
        const valence = corner.valence
        const weightWidth = 1 + corner.valence + corner.numFaces
        const pWeights: number[] = [], epWeights: number[] = [], emWeights: number[] = []
        computeBoundaryPointWeights(valence, corner.faceInRing, pWeights, epWeights, emWeights)
        for (let i = 0; i < weightWidth; ++i) {
            ringWeights[i] = pWeights[i]
            ringWeights[weightWidth + i] = epWeights[i]
            ringWeights[2 * weightWidth + i] = emWeights[i]
        }
        const N = weightWidth - 1
        const p0 = cIndex
        const p1 = corner.ringPoints[0]
        const pN = corner.ringPoints[2 * (valence - 1)]
        p.assign(0, p0, pWeights[0])
        p.assign(1, p1, pWeights[1])
        p.assign(2, pN, pWeights[N])
        ep.assign(0, p0, epWeights[0])
        if (corner.epOnBoundary) {
            ep.assign(1, p1, epWeights[1])
        } else {
            for (let i = 1; i < weightWidth; ++i) ep.assign(i, corner.ringPoints[i - 1], epWeights[i])
        }
        em.assign(0, p0, emWeights[0])
        if (corner.emOnBoundary) {
            em.assign(1, pN, emWeights[N])
        } else {
            // The source loops `i <= weightWidth`: the extra write lands in entry 0 of the next row (this corner's Fp),
            // which `computeIrregularFacePoints` always rewrites (a boundary corner's Fp is irregular or copied).
            for (let i = 1; i < weightWidth; ++i) em.assign(i, corner.ringPoints[i - 1], emWeights[i])
        }
    }

    /** `getIrregularFacePointSize` (:1231). */
    private getIrregularFacePointSize(cIndexNear: number, cIndexFar: number): number {
        const corner = this.corners[cIndexNear]
        const adjCorner = this.corners[cIndexFar]
        if (corner.isSharp && adjCorner.isSharp) return 2
        const thisSize = corner.isSharp ? 6 : 1 + corner.ringPoints.length
        const adjSize = adjCorner.isRegular || adjCorner.isSharp ? 0 : 1 + adjCorner.ringPoints.length - 6
        return thisSize + adjSize
    }

    /** `computeIrregularFacePoint` (:1252). */
    private computeIrregularFacePoint(cIndexNear: number, edgeInNearCornerRing: number, cIndexFar: number, p: SparseMatrixRow,
        eNear: SparseMatrixRow, eFar: SparseMatrixRow, fNear: SparseMatrixRow, signForSideOfEdge: number, rowWeights: number[],
        columnMask: number[]): void {
        const cornerNear = this.corners[cIndexNear]
        const cornerFar = this.corners[cIndexFar]
        const valence = cornerNear.valence
        const cosNear = cornerNear.cosFaceAngle
        const cosFar = cornerFar.cosFaceAngle
        const pCoeff = f32(cosFar / 3)
        // `(3.0f - 2.0f * cosNear - cosFar) / 3.0f`: `3 - 2 * cosNear` contracts to an FMA; `2 * cosNear` is exact.
        const eNearCoeff = f32(f32(f32(3 - f32(2 * cosNear)) - cosFar) / 3)
        const eFarCoeff = f32(f32(2 * cosNear) / 3)
        const fullRowSize = this.numSourcePoints
        for (let i = 0; i < fullRowSize; ++i) {
            columnMask[i] = 0
            rowWeights[i] = 0
        }
        addSparsePointToFullRow(rowWeights, p, pCoeff, columnMask)
        addSparsePointToFullRow(rowWeights, eNear, eNearCoeff, columnMask)
        addSparsePointToFullRow(rowWeights, eFar, eFarCoeff, columnMask)
        const iEdgeInterior = edgeInNearCornerRing
        const iEdgePrev = (iEdgeInterior + valence - 1) % valence
        const iEdgeNext = (iEdgeInterior + 1) % valence
        const r = cornerNear.ringPoints
        rowWeights[r[2 * iEdgePrev]] = f32(rowWeights[r[2 * iEdgePrev]] + f32(-signForSideOfEdge / 9))
        rowWeights[r[2 * iEdgePrev + 1]] = f32(rowWeights[r[2 * iEdgePrev + 1]] + f32(-signForSideOfEdge / 18))
        rowWeights[r[2 * iEdgeInterior + 1]] = f32(rowWeights[r[2 * iEdgeInterior + 1]] + f32(signForSideOfEdge / 18))
        rowWeights[r[2 * iEdgeNext]] = f32(rowWeights[r[2 * iEdgeNext]] + f32(signForSideOfEdge / 9))
        let nWeights = 0
        for (let i = 0; i < fullRowSize; ++i) {
            if (columnMask[i]) fNear.assign(nWeights++, columnMask[i] - 1, rowWeights[i])
        }
        if (this.hasVal2InteriorCorner && nWeights < fNear.getSize()) {
            while (nWeights < fNear.getSize()) fNear.assign(nWeights++, cIndexNear, 0)
        }
        if (fNear.getSize() !== nWeights) throw new Error('GregoryConverter::computeIrregularFacePoint: row size mismatch')
    }

    /** `assignRegularFacePoints` (:1307). */
    private assignRegularFacePoints(cIndex: number, matrix: SparseMatrix): void {
        const fp = new SparseMatrixRow(matrix, 5 * cIndex + 3)
        const fm = new SparseMatrixRow(matrix, 5 * cIndex + 4)
        const corner = this.corners[cIndex]
        const cNext = (cIndex + 1) & 0x3
        const cOpp = (cIndex + 2) & 0x3
        const cPrev = (cIndex + 3) & 0x3
        if (corner.fpIsRegular) {
            fp.assign(0, cIndex, f32(4.0 / 9.0))
            fp.assign(1, cPrev, f32(2.0 / 9.0))
            fp.assign(2, cNext, f32(2.0 / 9.0))
            fp.assign(3, cOpp, f32(1.0 / 9.0))
        }
        if (corner.fmIsRegular) {
            fm.assign(0, cIndex, f32(4.0 / 9.0))
            fm.assign(1, cPrev, f32(2.0 / 9.0))
            fm.assign(2, cNext, f32(2.0 / 9.0))
            fm.assign(3, cOpp, f32(1.0 / 9.0))
        }
    }

    /** `computeIrregularFacePoints` (:1337). */
    private computeIrregularFacePoints(cIndex: number, matrix: SparseMatrix, rowWeights: number[], columnMask: number[]): void {
        const corner = this.corners[cIndex]
        const cNext = (cIndex + 1) & 0x3
        const cPrev = (cIndex + 3) & 0x3
        const epPrev = new SparseMatrixRow(matrix, 5 * cPrev + 1)
        const em = new SparseMatrixRow(matrix, 5 * cIndex + 2)
        const p = new SparseMatrixRow(matrix, 5 * cIndex + 0)
        const ep = new SparseMatrixRow(matrix, 5 * cIndex + 1)
        const emNext = new SparseMatrixRow(matrix, 5 * cNext + 2)
        const fp = new SparseMatrixRow(matrix, 5 * cIndex + 3)
        const fm = new SparseMatrixRow(matrix, 5 * cIndex + 4)
        if (!corner.fpIsRegular && !corner.fpIsCopied) {
            const iEdgeP = corner.faceInRing
            this.computeIrregularFacePoint(cIndex, iEdgeP, cNext, p, ep, emNext, fp, 1, rowWeights, columnMask)
        }
        if (!corner.fmIsRegular && !corner.fmIsCopied) {
            const iEdgeM = (corner.faceInRing + 1) % corner.valence
            this.computeIrregularFacePoint(cIndex, iEdgeM, cPrev, p, em, epPrev, fm, -1, rowWeights, columnMask)
        }
        if (corner.fpIsCopied) fp.copy(fm)
        if (corner.fmIsCopied) fm.copy(fp)
    }
}

// endregion

/** `patchTypeFromBasisArray` (`catmarkPatchBuilder.cpp:1913`). */
const CATMARK_PATCH_TYPE_FROM_BASIS = [PatchType.NON_PATCH, PatchType.REGULAR, PatchType.GREGORY_BASIS, PatchType.QUADS, PatchType.NON_PATCH]

/** `Far::CatmarkPatchBuilder` (`catmarkPatchBuilder.cpp:1960`). */
export class CatmarkPatchBuilder extends PatchBuilder {
    constructor(refiner: TopologyRefiner, options: PatchBuilderOptions) {
        super(refiner, options)
        this.regPatchType = CATMARK_PATCH_TYPE_FROM_BASIS[options.regBasisType]
        this.irregPatchType = options.irregBasisType === BasisType.UNSPECIFIED ? this.regPatchType : CATMARK_PATCH_TYPE_FROM_BASIS[options.irregBasisType]
        this.nativePatchType = CATMARK_PATCH_TYPE_FROM_BASIS[BasisType.REGULAR]
        this.linearPatchType = CATMARK_PATCH_TYPE_FROM_BASIS[BasisType.LINEAR]
    }

    /** `convertSourcePatch` (:1923). */
    protected convertToPatchType(sourcePatch: SourcePatch, patchType: PatchType, matrix: SparseMatrix): number {
        if (patchType === PatchType.GREGORY_BASIS) new GregoryConverter(sourcePatch, matrix)
        else if (patchType === PatchType.REGULAR) throw new Error('OpenSubdiv: BSplineConverter (ENDCAP_BSPLINE_BASIS) is not ported')
        else if (patchType === PatchType.QUADS) throw new Error('OpenSubdiv: LinearConverter (ENDCAP_BILINEAR_BASIS) is not ported')
        else throw new Error('Unknown or unsupported patch type')
        return matrix.getNumRows()
    }
}

/** `patchTypeFromBasisArray` (`bilinearPatchBuilder.cpp:30`). */
const BILINEAR_PATCH_TYPE_FROM_BASIS = [PatchType.NON_PATCH, PatchType.QUADS, PatchType.GREGORY_BASIS, PatchType.QUADS, PatchType.NON_PATCH]

/** `Far::BilinearPatchBuilder` (`bilinearPatchBuilder.cpp:39`). */
export class BilinearPatchBuilder extends PatchBuilder {
    constructor(refiner: TopologyRefiner, options: PatchBuilderOptions) {
        super(refiner, options)
        this.regPatchType = BILINEAR_PATCH_TYPE_FROM_BASIS[options.regBasisType]
        this.irregPatchType = options.irregBasisType === BasisType.UNSPECIFIED ? this.regPatchType : BILINEAR_PATCH_TYPE_FROM_BASIS[options.irregBasisType]
        this.nativePatchType = PatchType.QUADS
        this.linearPatchType = PatchType.QUADS
    }

    /** `convertSourcePatch` (:62): "Conversion from Bilinear patches to other bases not yet supported". */
    protected convertToPatchType(): number {
        throw new Error('OpenSubdiv: conversion from Bilinear patches to other bases is not supported (BilinearPatchBuilder)')
    }
}

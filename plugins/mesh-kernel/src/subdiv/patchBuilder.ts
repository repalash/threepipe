/**
 * Patches of a feature-adaptively refined Catmull-Clark surface: OpenSubdiv `Far::PatchBuilder`,
 * `Far::SourcePatch` (`far/patchBuilder.cpp`) and `Far::PtexIndices` (`far/ptexIndices.cpp`), OpenSubdiv 3.7.0.
 *
 * Options are fixed to what Blender's evaluator asks of `PatchTableFactory` (`evaluator_impl.cc:500-505`):
 * regular faces are B-spline patches, irregular ones Gregory-basis end caps (`ENDCAP_GREGORY_BASIS`),
 * `useInfSharpPatch` (so inf-sharp features are tested, not approximated), the factory's default
 * `generateLegacySharpCornerPatches` (a smooth boundary corner is approximated as sharp) and
 * `fillMissingBoundaryPoints`.
 */

import {ETag, Level, tagRule, VSpan, VTag} from './level'
import {FVarLevel, FVTag} from './fvar'
import {Rule} from './sdc'
import type {TopologyRefiner} from './refiner'

export const PATCH_REGULAR = 'REGULAR'
export const PATCH_GREGORY_BASIS = 'GREGORY_BASIS'
export const PATCH_QUADS = 'QUADS'
export type PatchType = typeof PATCH_REGULAR | typeof PATCH_GREGORY_BASIS | typeof PATCH_QUADS

/** `Far::PatchParam` (`patchParam.h`), unpacked. */
export interface PatchParam {
    faceId: number
    u: number
    v: number
    depth: number
    nonQuadRoot: boolean
    boundary: number
    transition: number
    regular: boolean
}

/** `PatchParam::Normalize` (`patchParam.h:254`): ptex (u, v) to the patch's own [0, 1]^2. */
export function normalizePatchCoord(p: PatchParam, u: number, v: number): [number, number] {
    const fracInv = 1 / (1 / (1 << (p.depth - (p.nonQuadRoot ? 1 : 0))))
    return [u * fracInv - p.u, v * fracInv - p.v]
}

/** `Far::PtexIndices`: the first ptex face of each base face (quads one, n-gons one per corner). */
export class PtexIndices {
    readonly first: Int32Array
    readonly numFaces: number
    constructor(base: Level) {
        this.first = new Int32Array(base.numFaces + 1)
        let id = 0
        for (let f = 0; f < base.numFaces; f++) {
            this.first[f] = id
            const n = base.faceVerts.counts[f]
            id += n === 4 ? 1 : n
        }
        this.first[base.numFaces] = id
        this.numFaces = id
    }
    getFaceId(f: number): number { return this.first[f] }
}

// region corner spans and rings (patchBuilder.cpp:33-470)

const fastMod4 = (x: number) => x & 3
const fastModN = (x: number, n: number) => (x < n ? x : x - n)

/** `getSingularEdgeMask`. */
const singularEdgeMask = (includeAllInfSharpEdges: boolean) =>
    ETag.Boundary | ETag.NonManifold | (includeAllInfSharpEdges ? ETag.InfSharp : 0)

function isEdgeSingular(level: Level, fvar: FVarLevel | null, e: number, mask: number): boolean {
    let tag = level.edgeTags[e]
    if (fvar) tag = fvar.combineWithLevelETag(fvar.edgeTags[e], tag)
    return (tag & mask) !== 0
}

const indexOf = (a: ArrayLike<number>, x: number) => { for (let i = 0; i < a.length; i++) if (a[i] === x) return i; return -1 }

/** `identifyManifoldCornerSpan` (`patchBuilder.cpp:92`). */
function identifyManifoldCornerSpan(level: Level, f: number, corner: number, mask: number, span: VSpan, fvc = -1): void {
    const fvar = fvc < 0 ? null : level.getFVarLevel(fvc)
    const fVerts = level.getFaceVertices(f), fEdges = level.getFaceEdges(f)
    const vEdges = level.getVertexEdges(fVerts[corner])
    const nEdges = vEdges.length
    const iLeadingStart = indexOf(vEdges, fEdges[corner])
    const iTrailingStart = fastModN(iLeadingStart + 1, nEdges)
    span.clear()
    span.numFaces = 1
    span.cornerInSpan = 0
    let iLeading = iLeadingStart
    while (!isEdgeSingular(level, fvar, vEdges[iLeading], mask)) {
        span.numFaces++
        span.cornerInSpan++
        iLeading = fastModN(iLeading + nEdges - 1, nEdges)
        if (iLeading === iTrailingStart) break
    }
    let iTrailing = iTrailingStart
    if (iTrailing !== iLeading) {
        while (!isEdgeSingular(level, fvar, vEdges[iTrailing], mask)) {
            span.numFaces++
            iTrailing = fastModN(iTrailing + 1, nEdges)
            if (iTrailing === iLeadingStart) break
        }
    }
    span.startFace = iLeading
}

/** `identifyNonManifoldCornerSpan` (`patchBuilder.cpp:131`). */
function identifyNonManifoldCornerSpan(level: Level, f: number, corner: number, mask: number, span: VSpan, fvc = -1): void {
    const fvar = fvc < 0 ? null : level.getFVarLevel(fvc)
    let fEdges = level.getFaceEdges(f)
    const eLeadingStart = fEdges[corner]
    const eTrailingStart = fEdges[(corner + fEdges.length - 1) % fEdges.length]
    span.clear()
    span.numFaces = 1
    span.cornerInSpan = 0
    let startFace = f, startCorner = corner
    let fLeading = f, eLeading = eLeadingStart
    while (!isEdgeSingular(level, fvar, eLeading, mask)) {
        span.numFaces++
        span.cornerInSpan++
        const eFaces = level.getEdgeFaces(eLeading)
        fLeading = eFaces[0] === fLeading ? eFaces[1] : eFaces[0]
        fEdges = level.getFaceEdges(fLeading)
        startFace = fLeading
        startCorner = (indexOf(fEdges, eLeading) + 1) % fEdges.length
        eLeading = fEdges[startCorner]
        if (eLeading === eTrailingStart) {
            span.periodic = !isEdgeSingular(level, fvar, eLeading, mask)
            break
        }
    }
    let fTrailing = f, eTrailing = eTrailingStart
    if (eTrailing !== eLeading) {
        while (!isEdgeSingular(level, fvar, eTrailing, mask)) {
            span.numFaces++
            const eFaces = level.getEdgeFaces(eTrailing)
            fTrailing = eFaces[0] === fTrailing ? eFaces[1] : eFaces[0]
            fEdges = level.getFaceEdges(fTrailing)
            eTrailing = fEdges[(indexOf(fEdges, eTrailing) + fEdges.length - 1) % fEdges.length]
            if (eTrailing === eLeadingStart) {
                span.periodic = !isEdgeSingular(level, fvar, eTrailing, mask)
                break
            }
        }
    }
    const v = level.getFaceVertices(f)[corner]
    const vFaces = level.getVertexFaces(v), vInFaces = level.getVertexFaceLocalIndices(v)
    span.startFace = vFaces.length
    for (let i = 0; i < vFaces.length; i++) {
        if (vFaces[i] === startFace && vInFaces[i] === startCorner) { span.startFace = i; break }
    }
}

const scratchSpan = new VSpan()
const countManifoldCornerSpan = (level: Level, f: number, corner: number, mask: number, fvc = -1) => {
    identifyManifoldCornerSpan(level, f, corner, mask, scratchSpan, fvc)
    return scratchSpan.numFaces
}
const countNonManifoldCornerSpan = (level: Level, f: number, corner: number, mask: number, fvc = -1) => {
    identifyNonManifoldCornerSpan(level, f, corner, mask, scratchSpan, fvc)
    return scratchSpan.numFaces
}

const facePoints = (level: Level, f: number, fvc: number) => (fvc < 0 ? level.getFaceVertices(f) : level.getFaceFVarValues(f, fvc))

/** `gatherRegularPartialRingAroundVertex` (`patchBuilder.cpp:277`). */
function gatherRegularPartialRingAroundVertex(level: Level, v: number, span: VSpan, ring: number[], fvc: number): number {
    const isManifold = !level.isVertexNonManifold(v)
    const vFaces = level.getVertexFaces(v), vInFaces = level.getVertexFaceLocalIndices(v)
    const nFaces = span.numFaces, startFace = span.startFace
    let nextFace = vFaces[startFace], vInNextFace = vInFaces[startFace]
    let n = 0
    for (let i = 0; i < nFaces; i++) {
        const thisFace = nextFace, vInThisFace = vInNextFace
        const fPoints = facePoints(level, thisFace, fvc)
        const isQuad = fPoints.length === 4
        if (isQuad) {
            ring[n++] = fPoints[fastMod4(vInThisFace + 1)]
            ring[n++] = fPoints[fastMod4(vInThisFace + 2)]
        } else {
            ring[n++] = fPoints[(vInThisFace + 1) % 3]
        }
        if (i === nFaces - 1) {
            if (!span.periodic) {
                if (isQuad) ring[n++] = fPoints[fastMod4(vInThisFace + 3)]
                else ring[n++] = fPoints[(vInThisFace + 2) % 3]
            }
        } else if (isManifold) {
            const iNext = fastModN(startFace + i + 1, vFaces.length)
            nextFace = vFaces[iNext]
            vInNextFace = vInFaces[iNext]
        } else {
            const nextInThisFace = fastModN(vInThisFace + fPoints.length - 1, fPoints.length)
            const nextEdge = level.getFaceEdges(thisFace)[nextInThisFace]
            const eFaces = level.getEdgeFaces(nextEdge)
            nextFace = eFaces[0] === thisFace ? eFaces[1] : eFaces[0]
            vInNextFace = indexOf(level.getFaceEdges(nextFace), nextEdge)
        }
    }
    return n
}

/** `getNextFaceInVertFaces` (`patchBuilder.cpp:408`): returns [face, vertex-in-face]. */
function getNextFaceInVertFaces(level: Level, thisFaceInVFaces: number, vFaces: Int32Array, vInFaces: Int32Array, manifold: boolean): [number, number] {
    if (manifold) {
        const i = fastModN(thisFaceInVFaces + 1, vFaces.length)
        return [vFaces[i], vInFaces[i]]
    }
    const thisFace = vFaces[thisFaceInVFaces], vInThisFace = vInFaces[thisFaceInVFaces]
    const fEdges = level.getFaceEdges(thisFace)
    const nextEdge = fEdges[fastModN(vInThisFace + fEdges.length - 1, fEdges.length)]
    const eFaces = level.getEdgeFaces(nextEdge)
    const nextFace = eFaces[0] === thisFace ? eFaces[1] : eFaces[0]
    return [nextFace, indexOf(level.getFaceEdges(nextFace), nextEdge)]
}

/** `getPrevFaceInVertFaces` (`patchBuilder.cpp:439`). */
function getPrevFaceInVertFaces(level: Level, thisFaceInVFaces: number, vFaces: Int32Array, vInFaces: Int32Array, manifold: boolean): [number, number] {
    if (manifold) {
        const i = (thisFaceInVFaces ? thisFaceInVFaces : vFaces.length) - 1
        return [vFaces[i], vInFaces[i]]
    }
    const thisFace = vFaces[thisFaceInVFaces], vInThisFace = vInFaces[thisFaceInVFaces]
    const fEdges = level.getFaceEdges(thisFace)
    const prevEdge = fEdges[vInThisFace]
    const eFaces = level.getEdgeFaces(prevEdge)
    const prevFace = eFaces[0] === thisFace ? eFaces[1] : eFaces[0]
    const edgeInPrevFace = indexOf(level.getFaceEdges(prevFace), prevEdge)
    // as in OpenSubdiv: the modulus uses this face's edge count
    return [prevFace, fastModN(edgeInPrevFace + 1, fEdges.length)]
}

// endregion

// region SourcePatch (patchBuilder.cpp:1360-1607)

export interface SourceCorner {
    numFaces: number
    patchFace: number
    boundary: boolean
    sharp: boolean
    dart: boolean
    sharesWithPrev: boolean
    sharesWithNext: boolean
    val2Interior: boolean
    val2Adjacent: boolean
}

export class SourcePatch {
    corners: SourceCorner[] = Array.from({length: 4}, () => ({
        numFaces: 0, patchFace: 0, boundary: false, sharp: false, dart: false,
        sharesWithPrev: false, sharesWithNext: false, val2Interior: false, val2Adjacent: false,
    }))
    numCorners = 0
    numSourcePoints = 0
    maxValence = 0
    maxRingSize = 0
    ringSizes = [0, 0, 0, 0]
    localRingSizes = [0, 0, 0, 0]
    localRingOffsets = [0, 0, 0, 0]

    /** `SourcePatch::Finalize` (`patchBuilder.cpp:1436`). */
    finalize(size: number): void {
        const isQuad = size === 4 ? 1 : 0
        this.numCorners = size
        this.maxValence = 0
        this.maxRingSize = 0
        this.numSourcePoints = this.numCorners
        for (let c = 0; c < this.numCorners; c++) {
            const cPrev = fastModN(c + 2 + isQuad, this.numCorners)
            const cNext = fastModN(c + 1, this.numCorners)
            const prevIsVal2Interior = this.corners[cPrev].numFaces === 2 && !this.corners[cPrev].boundary
            const thisIsVal2Interior = this.corners[c].numFaces === 2 && !this.corners[c].boundary
            const nextIsVal2Interior = this.corners[cNext].numFaces === 2 && !this.corners[cNext].boundary
            const corner = this.corners[c]
            corner.val2Interior = thisIsVal2Interior
            corner.val2Adjacent = prevIsVal2Interior || nextIsVal2Interior
            const boundary = corner.boundary ? 1 : 0
            if (corner.numFaces + boundary > 2) {
                if (corner.boundary) {
                    corner.sharesWithPrev = !!isQuad && corner.patchFace !== corner.numFaces - 1
                    corner.sharesWithNext = corner.patchFace !== 0
                } else if (corner.dart) {
                    const cP = this.corners[cPrev], cN = this.corners[cNext]
                    const cPrevOnDartEdge = cP.boundary && cP.patchFace === 0
                    const cNextOnDartEdge = cN.boundary && cN.patchFace === cN.numFaces - 1
                    corner.sharesWithPrev = !!isQuad && !cPrevOnDartEdge
                    corner.sharesWithNext = !cNextOnDartEdge
                } else {
                    corner.sharesWithPrev = !!isQuad
                    corner.sharesWithNext = true
                }
                this.ringSizes[c] = corner.numFaces * (1 + isQuad) + boundary
                this.localRingSizes[c] = this.ringSizes[c] - (this.numCorners - 1)
                    - (corner.sharesWithPrev ? 1 : 0) - (corner.sharesWithNext ? 1 : 0)
                if (corner.val2Adjacent && !corner.boundary) {
                    this.localRingSizes[c] -= prevIsVal2Interior ? 1 : 0
                    this.localRingSizes[c] -= nextIsVal2Interior && isQuad ? 1 : 0
                }
            } else {
                corner.sharesWithPrev = false
                corner.sharesWithNext = false
                if (corner.numFaces === 1) {
                    this.ringSizes[c] = this.numCorners - 1
                    this.localRingSizes[c] = 0
                } else {
                    this.ringSizes[c] = 2 * (1 + isQuad)
                    this.localRingSizes[c] = isQuad
                }
            }
            this.localRingOffsets[c] = this.numSourcePoints
            this.maxValence = Math.max(this.maxValence, corner.numFaces + boundary)
            this.maxRingSize = Math.max(this.maxRingSize, this.ringSizes[c])
            this.numSourcePoints += this.localRingSizes[c]
        }
    }

    getCornerRingSize(c: number): number { return this.ringSizes[c] }

    /** `SourcePatch::GetCornerRingPoints` (`patchBuilder.cpp:1534`). */
    getCornerRingPoints(corner: number, ring: number[]): number {
        const isQuad = this.numCorners === 4 ? 1 : 0
        const cNext = fastModN(corner + 1, this.numCorners)
        const cOpp = fastModN(corner + 1 + isQuad, this.numCorners)
        const cPrev = fastModN(corner + 2 + isQuad, this.numCorners)
        let n = 0
        ring[n++] = cNext
        if (isQuad) ring[n++] = cOpp
        ring[n++] = cPrev
        if (this.corners[cPrev].val2Interior && !this.corners[corner].boundary) ring[n++] = isQuad ? cOpp : cNext
        if (this.corners[corner].sharesWithPrev) ring[n++] = this.localRingOffsets[cPrev] + this.localRingSizes[cPrev] - 1
        for (let i = 0; i < this.localRingSizes[corner]; i++) ring[n++] = this.localRingOffsets[corner] + i
        if (isQuad) {
            if (this.corners[corner].sharesWithNext) ring[n++] = this.localRingOffsets[cNext]
            if (this.corners[cNext].val2Interior && !this.corners[corner].boundary) ring[n++] = cOpp
        } else if (this.corners[corner].sharesWithNext) {
            if (this.corners[cNext].val2Interior && !this.corners[corner].boundary) ring[n++] = cPrev
            else if (this.localRingSizes[cNext] === 0) ring[n++] = this.localRingOffsets[cPrev]
            else ring[n++] = this.localRingOffsets[cNext]
        }
        if (n !== this.ringSizes[corner]) throw new Error('subdivision: source patch ring size mismatch')
        if (this.corners[corner].patchFace) {
            const rot = n - (1 + isQuad) * this.corners[corner].patchFace
            const head = ring.slice(rot, n), tail = ring.slice(0, rot)
            for (let i = 0; i < head.length; i++) ring[i] = head[i]
            for (let i = 0; i < tail.length; i++) ring[head.length + i] = tail[i]
        }
        return n
    }
}

// endregion

/** `Far::PatchBuilder` for Catmark with Blender's options. */
export class PatchBuilder {
    readonly refiner: TopologyRefiner
    /** `approxInfSharpWithSmooth = !useInfSharpPatch`. */
    readonly approxInfSharpWithSmooth: boolean
    /** `generateLegacySharpCornerPatches`, PatchTableFactory's default. */
    readonly approxSmoothCornerWithSharp = true
    readonly fillMissingBoundaryPoints = true
    readonly schemeRegFaceSize = 4

    constructor(refiner: TopologyRefiner, useInfSharpPatch: boolean) {
        this.refiner = refiner
        this.approxInfSharpWithSmooth = !useInfSharpPatch
    }

    /** `PatchBuilder::IsFaceAPatch` (`patchBuilder.cpp:510`). */
    isFaceAPatch(levelIndex: number, f: number): boolean {
        const level = this.refiner.levels[levelIndex]
        if (level.faceHole[f]) return false
        if (levelIndex === 0) return !(level.getFaceCompositeVTag(f) & VTag.IncidIrregFace)
        return !(level.getFaceCompositeVTag(f) & VTag.Incomplete)
    }

    /** `PatchBuilder::IsFaceALeaf` (`patchBuilder.cpp:540`). */
    isFaceALeaf(levelIndex: number, f: number): boolean {
        if (levelIndex < this.refiner.maxLevel) {
            const r = this.refiner.refinements[levelIndex]
            if (r.parentFaceSelected.length && r.parentFaceSelected[f]) return false
        }
        return true
    }

    /** `PatchBuilder::IsPatchRegular` (`patchBuilder.cpp:552`). */
    isPatchRegular(levelIndex: number, f: number, fvc = -1): boolean {
        const level = this.refiner.levels[levelIndex]
        const vTags = level.getFaceVTags(f, [], fvc)
        let comp = 0
        for (let i = 0; i < 4; i++) comp |= vTags[i]
        if (!(comp & VTag.InfSharp) && !(comp & VTag.InfSharpEdges)) return !(comp & VTag.Xordinary)

        const testInfSharpFeatures = !this.approxInfSharpWithSmooth
        const irregMask = VTag.NonManifold | VTag.Xordinary | (testInfSharpFeatures ? VTag.InfIrregular : 0)
        if ((comp & irregMask) === 0) return true

        const needsExtraIsoLevel = (comp & VTag.Xordinary) && this.refiner.hasIrregFaces ? 1 : 0
        const featureIsIsolated = levelIndex > needsExtraIsoLevel
        if (featureIsIsolated) {
            const requiresInspection = (comp & VTag.NonManifold) !== 0
                || (this.approxSmoothCornerWithSharp && (comp & VTag.Xordinary) !== 0 && (comp & VTag.Boundary) !== 0)
                || (testInfSharpFeatures && (comp & VTag.InfIrregular) !== 0 && (comp & VTag.InfSharpEdges) !== 0)
            if (!requiresInspection) {
                return testInfSharpFeatures ? !(comp & VTag.InfIrregular) : !(comp & VTag.Xordinary)
            }
        }

        const nRegBoundaryFaces = 2
        for (let i = 0; i < 4; i++) {
            const t = vTags[i]
            if ((t & irregMask) === 0) continue
            if (t & VTag.NonManifold) {
                const nSpanFaces = countNonManifoldCornerSpan(level, f, i, singularEdgeMask(testInfSharpFeatures), fvc)
                if (t & VTag.InfSharp) { if (nSpanFaces !== 1) return false } else if (nSpanFaces !== nRegBoundaryFaces) return false
                continue
            }
            if (t & VTag.Xordinary) {
                if (!(t & VTag.InfSharpEdges)) return false
                if (this.approxSmoothCornerWithSharp && (t & VTag.Boundary) && !(t & VTag.InfSharp)) {
                    const eTags = level.getFaceETags(f, [], fvc)
                    const iPrev = i ? i - 1 : 3
                    if ((eTags[i] & ETag.Boundary) && (eTags[iPrev] & ETag.Boundary)) continue
                }
                if (!testInfSharpFeatures) return false
            }
            if (t & VTag.InfIrregular) {
                if (!(t & VTag.InfSharpEdges)) return false
                if ((t & VTag.InfSharpCrease) && (t & VTag.Boundary)) return false
                const nSpanFaces = countManifoldCornerSpan(level, f, i, singularEdgeMask(true), fvc)
                if (t & VTag.InfSharpCrease) { if (nSpanFaces !== nRegBoundaryFaces) return false } else if (nSpanFaces !== 1) return false
            }
        }
        return true
    }

    /** `PatchBuilder::GetRegularPatchBoundaryMask` (`patchBuilder.cpp:701`). */
    getRegularPatchBoundaryMask(levelIndex: number, f: number, fvc = -1): number {
        const level = this.refiner.levels[levelIndex]
        const vTags = level.getFaceVTags(f, [], fvc)
        let comp = 0
        for (let i = 0; i < 4; i++) comp |= vTags[i]
        if (!(comp & VTag.InfSharpEdges)) return 0
        const eTags = level.getFaceETags(f, [], fvc)
        const testInfSharpFeatures = !this.approxInfSharpWithSmooth
        const eMask = ETag.Boundary | ETag.NonManifold | (testInfSharpFeatures ? ETag.InfSharp : 0)
        let bits = 0
        for (let i = 0; i < 4; i++) if (eTags[i] & eMask) bits |= 1 << i
        return bits
    }

    /** `PatchBuilder::GetIrregularPatchCornerSpans` (`patchBuilder.cpp:763`). */
    getIrregularPatchCornerSpans(levelIndex: number, f: number, spans: VSpan[], fvc = -1): void {
        const level = this.refiner.levels[levelIndex]
        const vTags = level.getFaceVTags(f, [], fvc)
        let fvarTags: number[] | null = null
        if (fvc >= 0) {
            const F = level.getFVarLevel(fvc)
            const fVerts = level.getFaceVertices(f), fValues = F.getFaceValues(f)
            fvarTags = []
            for (let i = 0; i < fValues.length; i++) fvarTags.push(F.vertValueTags[F.findVertexValueIndex(fVerts[i], fValues[i])])
        }
        const testInfSharpFeatures = !this.approxInfSharpWithSmooth
        const mask = singularEdgeMask(testInfSharpFeatures)
        for (let i = 0; i < 4; i++) {
            const t = vTags[i]
            const isNonManifold = (t & VTag.NonManifold) !== 0
            const isFVarMisMatch = fvc >= 0 && (fvarTags![i] & FVTag.Mismatch) !== 0
            const testInfSharpEdges = testInfSharpFeatures && (t & VTag.InfSharpEdges) !== 0 && tagRule(t) !== Rule.Dart
            if (testInfSharpEdges || isFVarMisMatch || isNonManifold) {
                if (isNonManifold) identifyNonManifoldCornerSpan(level, f, i, mask, spans[i], fvc)
                else identifyManifoldCornerSpan(level, f, i, mask, spans[i], fvc)
            } else {
                spans[i].clear()
            }
            if (t & VTag.Corner) {
                spans[i].sharp = isFVarMisMatch ? (spans[i].numFaces === 1 || isNonManifold) : true
            } else if (isNonManifold) {
                spans[i].sharp = (t & VTag.InfSharp) !== 0
            } else if (testInfSharpFeatures) {
                spans[i].sharp = testInfSharpEdges ? !(t & VTag.InfSharpCrease) : (t & VTag.InfSharp) !== 0
            }
            // legacy option: a smooth corner is reinterpreted as sharp
            const smoothCorner = !spans[i].sharp
            if (smoothCorner && this.approxSmoothCornerWithSharp && (t & VTag.Xordinary) && (t & VTag.Boundary)
                && !(t & VTag.InfSharp) && !(t & VTag.NonManifold)) {
                const nFaces = spans[i].isAssigned() ? spans[i].numFaces : level.getVertexFaces(level.getFaceVertices(f)[i]).length
                spans[i].sharp = nFaces === 1
            }
        }
    }

    /** `PatchBuilder::getQuadRegularPatchPoints` (`patchBuilder.cpp:858`): 16 points, row-major from the corner. */
    getRegularPatchPoints(levelIndex: number, f: number, boundaryMask: number, points: number[], fvc = -1): number {
        const interiorPatch = boundaryMask === 0
        const perCorner = [[5, 4, 0, 1], [6, 2, 3, 7], [10, 11, 15, 14], [9, 13, 12, 8]]
        const level = this.refiner.levels[levelIndex]
        const fVerts = level.getFaceVertices(f), fPoints = facePoints(level, f, fvc)
        const boundaryPoint = !interiorPatch && this.fillMissingBoundaryPoints ? fPoints[0] : -1
        for (let i = 0; i < 4; i++) {
            const v = fVerts[i]
            const idx = perCorner[i]
            const vFaces = level.getVertexFaces(v), vInFaces = level.getVertexFaceLocalIndices(v)
            const fInVFaces = indexOf(vFaces, f)
            const interiorCorner = interiorPatch || ((boundaryMask & (1 << i)) | (boundaryMask & (1 << fastMod4(i + 3)))) === 0
            if (interiorCorner) {
                const fOppIn = fastMod4(fInVFaces + 2)
                const fOpp = vFaces[fOppIn], vInFOpp = vInFaces[fOppIn]
                const p = facePoints(level, fOpp, fvc)
                points[idx[1]] = p[fastMod4(vInFOpp + 1)]
                points[idx[2]] = p[fastMod4(vInFOpp + 2)]
                points[idx[3]] = p[fastMod4(vInFOpp + 3)]
            } else if ((boundaryMask & (1 << i)) && (boundaryMask & (1 << fastMod4(i + 3)))) {
                points[idx[1]] = boundaryPoint
                points[idx[2]] = boundaryPoint
                points[idx[3]] = boundaryPoint
            } else if (boundaryMask & (1 << i)) {
                const [fNext, vInFNext] = getNextFaceInVertFaces(level, fInVFaces, vFaces, vInFaces, !level.isVertexNonManifold(v))
                const p = facePoints(level, fNext, fvc)
                points[idx[1]] = p[fastMod4(vInFNext + 3)]
                points[idx[2]] = boundaryPoint
                points[idx[3]] = boundaryPoint
            } else {
                const [fPrev, vInFPrev] = getPrevFaceInVertFaces(level, fInVFaces, vFaces, vInFaces, !level.isVertexNonManifold(v))
                const p = facePoints(level, fPrev, fvc)
                points[idx[1]] = boundaryPoint
                points[idx[2]] = boundaryPoint
                points[idx[3]] = p[fastMod4(vInFPrev + 1)]
            }
            points[idx[0]] = fPoints[i]
        }
        return 16
    }

    /** `PatchBuilder::assembleIrregularSourcePatch` (`patchBuilder.cpp:1097`). */
    assembleIrregularSourcePatch(levelIndex: number, f: number, spans: VSpan[]): SourcePatch {
        const level = this.refiner.levels[levelIndex]
        const fVerts = level.getFaceVertices(f)
        const sp = new SourcePatch()
        for (let c = 0; c < fVerts.length; c++) {
            const vTag = level.getVertexTag(fVerts[c])
            const pc = sp.corners[c]
            if (spans[c].isAssigned()) {
                pc.numFaces = spans[c].numFaces
                pc.patchFace = spans[c].cornerInSpan
                pc.boundary = !spans[c].periodic
            } else {
                const vFaces = level.getVertexFaces(fVerts[c])
                pc.numFaces = vFaces.length
                pc.patchFace = indexOf(vFaces, f)
                pc.boundary = (vTag & VTag.Boundary) !== 0
            }
            pc.sharp = spans[c].sharp
            pc.dart = tagRule(vTag) === Rule.Dart && (vTag & VTag.InfSharpEdges) !== 0
        }
        sp.finalize(fVerts.length)
        return sp
    }

    /** `PatchBuilder::gatherIrregularSourcePoints` (`patchBuilder.cpp:1144`). */
    gatherIrregularSourcePoints(levelIndex: number, f: number, spans: VSpan[], sp: SourcePatch, out: number[], fvc = -1): number {
        const level = this.refiner.levels[levelIndex]
        const fVerts = level.getFaceVertices(f)
        const sourceRing: number[] = [], patchRing: number[] = []
        for (let c = 0; c < sp.numCorners; c++) {
            const v = fVerts[c]
            let n: number
            if (spans[c].isAssigned()) n = gatherRegularPartialRingAroundVertex(level, v, spans[c], sourceRing, fvc)
            else n = level.gatherQuadRegularRingAroundVertex(v, sourceRing, fvc)
            const m = sp.getCornerRingPoints(c, patchRing)
            if (m !== n) throw new Error('subdivision: irregular patch ring mismatch')
            for (let i = 0; i < m; i++) out[patchRing[i]] = sourceRing[i]
        }
        return sp.numSourcePoints
    }

    /** `PatchBuilder::ComputePatchParam` (`patchBuilder.cpp:1262`), quads. */
    computePatchParam(levelIndex: number, f: number, ptex: PtexIndices, isRegular: boolean, boundaryMask: number, computeTransitionMask: boolean): PatchParam {
        const depth = levelIndex
        let childIndexInParent = 0, u = 0, v = 0, ofs = 1
        let irregBase = this.refiner.levels[depth].faceVerts.counts[f] !== 4
        let childFace = f
        for (let i = depth; i > 0; i--) {
            const r = this.refiner.refinements[i - 1]
            const parentLevel = this.refiner.levels[i - 1]
            const parentFace = r.childFaceParent[childFace]
            irregBase = parentLevel.faceVerts.counts[parentFace] !== 4
            if (!irregBase) {
                childIndexInParent = r.childFaceIndexInParent[childFace]
                switch (childIndexInParent) {
                case 0: break
                case 1: u += ofs; break
                case 2: u += ofs; v += ofs; break
                case 3: v += ofs; break
                }
                ofs <<= 1
            } else {
                const children = r.getFaceChildFaces(parentFace)
                for (let j = 0; j < children.length; j++) if (children[j] === childFace) { childIndexInParent = j; break }
            }
            childFace = parentFace
        }
        let ptexIndex = ptex.getFaceId(childFace)
        if (irregBase) ptexIndex += childIndexInParent
        let transition = 0
        if (computeTransitionMask && levelIndex < this.refiner.maxLevel) {
            const r = this.refiner.refinements[levelIndex]
            transition = r.parentFaceTransitional.length ? r.parentFaceTransitional[f] : 0
        }
        return {faceId: ptexIndex, u, v, depth, nonQuadRoot: irregBase, boundary: boundaryMask, transition, regular: isRegular}
    }
}


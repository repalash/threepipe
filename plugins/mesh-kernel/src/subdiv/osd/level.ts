/**
 * Port of OpenSubdiv v3_7_0 `opensubdiv/vtr/level.h` and `vtr/level.cpp` (Copyright 2014 DreamWorks Animation LLC):
 * the topology of one refinement level. `print` and `validateTopology` (debugging aids Blender does not call - it sets
 * `validateFullTopology = false`) are not ported.
 * Licensed under the Tomorrow Open Source Technology License 1.0 - see `porting/opensubdiv-LICENSE.txt`.
 */

import {f32} from '../../blender/f32'
import {Rule} from './sdc'
import type {Options} from './sdc'
import type {FVarLevel} from './fvarLevel'
import {
    ET_NON_MANIFOLD, FT_HOLE, INDEX_INVALID, IndexArray, indexIsValid, resizeVector, VALENCE_LIMIT, VT_BOUNDARY, VT_NON_MANIFOLD,
    VT_XORDINARY, vtRule,
} from './vtrTypes'

/** `Level::VSpan` (`level.h:153`). */
export interface VSpan {
    numFaces: number
    startFace: number
    cornerInSpan: number
    periodic: boolean
    sharp: boolean
}

export function newVSpan(): VSpan {
    return {numFaces: 0, startFace: 0, cornerInSpan: 0, periodic: false, sharp: false}
}

const fastMod4 = (v: number) => v & 3

export class Level {
    faceCount = 0
    edgeCount = 0
    vertCount = 0
    depth = 0
    maxEdgeFaces = 0
    maxValence = 0

    faceVertCountsAndOffsets: number[] = []
    faceVertIndices: number[] = []
    faceEdgeIndices: number[] = []
    faceTags: number[] = []

    edgeVertIndices: number[] = []
    edgeFaceCountsAndOffsets: number[] = []
    edgeFaceIndices: number[] = []
    edgeFaceLocalIndices: number[] = []
    edgeSharpness: number[] = []
    edgeTags: number[] = []

    vertFaceCountsAndOffsets: number[] = []
    vertFaceIndices: number[] = []
    vertFaceLocalIndices: number[] = []
    vertEdgeCountsAndOffsets: number[] = []
    vertEdgeIndices: number[] = []
    vertEdgeLocalIndices: number[] = []
    vertSharpness: number[] = []
    vertTags: number[] = []

    fvarChannels: FVarLevel[] = []

    getDepth() { return this.depth }
    getNumVertices() { return this.vertCount }
    getNumFaces() { return this.faceCount }
    getNumEdges() { return this.edgeCount }
    getNumFaceVerticesTotal() { return this.faceVertIndices.length }
    getNumFaceEdgesTotal() { return this.faceEdgeIndices.length }
    getNumEdgeVerticesTotal() { return this.edgeVertIndices.length }
    getNumEdgeFacesTotal() { return this.edgeFaceIndices.length }
    getNumVertexFacesTotal() { return this.vertFaceIndices.length }
    getNumVertexEdgesTotal() { return this.vertEdgeIndices.length }
    getMaxValence() { return this.maxValence }
    getMaxEdgeFaces() { return this.maxEdgeFaces }

    // region relation access (`level.h:500-700`)
    getFaceVertices(f: number): IndexArray {
        return new IndexArray(this.faceVertIndices, this.faceVertCountsAndOffsets[f * 2 + 1], this.faceVertCountsAndOffsets[f * 2])
    }
    getFaceEdges(f: number): IndexArray {
        return new IndexArray(this.faceEdgeIndices, this.faceVertCountsAndOffsets[f * 2 + 1], this.faceVertCountsAndOffsets[f * 2])
    }
    getEdgeVertices(e: number): IndexArray {
        return new IndexArray(this.edgeVertIndices, e * 2, 2)
    }
    getEdgeFaces(e: number): IndexArray {
        return new IndexArray(this.edgeFaceIndices, this.edgeFaceCountsAndOffsets[e * 2 + 1], this.edgeFaceCountsAndOffsets[e * 2])
    }
    getEdgeFaceLocalIndices(e: number): IndexArray {
        return new IndexArray(this.edgeFaceLocalIndices, this.edgeFaceCountsAndOffsets[e * 2 + 1], this.edgeFaceCountsAndOffsets[e * 2])
    }
    getVertexFaces(v: number): IndexArray {
        return new IndexArray(this.vertFaceIndices, this.vertFaceCountsAndOffsets[v * 2 + 1], this.vertFaceCountsAndOffsets[v * 2])
    }
    getVertexFaceLocalIndices(v: number): IndexArray {
        return new IndexArray(this.vertFaceLocalIndices, this.vertFaceCountsAndOffsets[v * 2 + 1], this.vertFaceCountsAndOffsets[v * 2])
    }
    getVertexEdges(v: number): IndexArray {
        return new IndexArray(this.vertEdgeIndices, this.vertEdgeCountsAndOffsets[v * 2 + 1], this.vertEdgeCountsAndOffsets[v * 2])
    }
    getVertexEdgeLocalIndices(v: number): IndexArray {
        return new IndexArray(this.vertEdgeLocalIndices, this.vertEdgeCountsAndOffsets[v * 2 + 1], this.vertEdgeCountsAndOffsets[v * 2])
    }

    getNumFaceVertices(f: number) { return this.faceVertCountsAndOffsets[2 * f] }
    getOffsetOfFaceVertices(f: number) { return this.faceVertCountsAndOffsets[2 * f + 1] }
    getNumFaceEdges(f: number) { return this.getNumFaceVertices(f) }
    getOffsetOfFaceEdges(f: number) { return this.getOffsetOfFaceVertices(f) }
    getNumEdgeVertices() { return 2 }
    getOffsetOfEdgeVertices(e: number) { return 2 * e }
    getNumEdgeFaces(e: number) { return this.edgeFaceCountsAndOffsets[2 * e] }
    getOffsetOfEdgeFaces(e: number) { return this.edgeFaceCountsAndOffsets[2 * e + 1] }
    getNumVertexFaces(v: number) { return this.vertFaceCountsAndOffsets[2 * v] }
    getOffsetOfVertexFaces(v: number) { return this.vertFaceCountsAndOffsets[2 * v + 1] }
    getNumVertexEdges(v: number) { return this.vertEdgeCountsAndOffsets[2 * v] }
    getOffsetOfVertexEdges(v: number) { return this.vertEdgeCountsAndOffsets[2 * v + 1] }

    getEdgeSharpness(e: number) { return this.edgeSharpness[e] }
    setEdgeSharpness(e: number, s: number) { this.edgeSharpness[e] = f32(s) }
    getVertexSharpness(v: number) { return this.vertSharpness[v] }
    setVertexSharpness(v: number, s: number) { this.vertSharpness[v] = f32(s) }
    getVertexRule(v: number): Rule { return vtRule(this.vertTags[v]) as Rule }

    setFaceHole(f: number, b: boolean) { this.faceTags[f] = b ? this.faceTags[f] | FT_HOLE : this.faceTags[f] & ~FT_HOLE }
    isFaceHole(f: number) { return (this.faceTags[f] & FT_HOLE) !== 0 }
    setEdgeNonManifold(e: number, b: boolean) { this.edgeTags[e] = b ? this.edgeTags[e] | ET_NON_MANIFOLD : this.edgeTags[e] & ~ET_NON_MANIFOLD }
    isEdgeNonManifold(e: number) { return (this.edgeTags[e] & ET_NON_MANIFOLD) !== 0 }
    setVertexNonManifold(v: number, b: boolean) { this.vertTags[v] = b ? this.vertTags[v] | VT_NON_MANIFOLD : this.vertTags[v] & ~VT_NON_MANIFOLD }
    isVertexNonManifold(v: number) { return (this.vertTags[v] & VT_NON_MANIFOLD) !== 0 }

    getVertexTag(v: number) { return this.vertTags[v] }
    getEdgeTag(e: number) { return this.edgeTags[e] }
    getFaceTag(f: number) { return this.faceTags[f] }

    getNumFVarChannels() { return this.fvarChannels.length }
    getFVarLevel(channel: number): FVarLevel { return this.fvarChannels[channel] }
    // endregion

    // region resizing (`level.h:595-790`)
    resizeFaceVerticesOf(f: number, count: number): void {
        const o = f * 2
        this.faceVertCountsAndOffsets[o] = count
        this.faceVertCountsAndOffsets[o + 1] = f === 0 ? 0 : this.faceVertCountsAndOffsets[o - 2] + this.faceVertCountsAndOffsets[o - 1]
        this.maxValence = Math.max(this.maxValence, count)
    }
    resizeEdgeFacesOf(e: number, count: number): void {
        const o = e * 2
        this.edgeFaceCountsAndOffsets[o] = count
        this.edgeFaceCountsAndOffsets[o + 1] = e === 0 ? 0 : this.edgeFaceCountsAndOffsets[o - 2] + this.edgeFaceCountsAndOffsets[o - 1]
        this.maxEdgeFaces = Math.max(this.maxEdgeFaces, count)
    }
    trimEdgeFaces(e: number, count: number): void { this.edgeFaceCountsAndOffsets[e * 2] = count }
    resizeVertexFacesOf(v: number, count: number): void {
        const o = v * 2
        this.vertFaceCountsAndOffsets[o] = count
        this.vertFaceCountsAndOffsets[o + 1] = v === 0 ? 0 : this.vertFaceCountsAndOffsets[o - 2] + this.vertFaceCountsAndOffsets[o - 1]
    }
    trimVertexFaces(v: number, count: number): void { this.vertFaceCountsAndOffsets[v * 2] = count }
    resizeVertexEdgesOf(v: number, count: number): void {
        const o = v * 2
        this.vertEdgeCountsAndOffsets[o] = count
        this.vertEdgeCountsAndOffsets[o + 1] = v === 0 ? 0 : this.vertEdgeCountsAndOffsets[o - 2] + this.vertEdgeCountsAndOffsets[o - 1]
        this.maxValence = Math.max(this.maxValence, count)
    }
    trimVertexEdges(v: number, count: number): void { this.vertEdgeCountsAndOffsets[v * 2] = count }
    setMaxValence(valence: number): void { this.maxValence = valence }

    resizeFaces(faceCount: number): void {
        this.faceCount = faceCount
        resizeVector(this.faceVertCountsAndOffsets, 2 * faceCount)
        resizeVector(this.faceTags, faceCount)
        this.faceTags.fill(0)
    }
    resizeFaceVertices(total: number): void { resizeVector(this.faceVertIndices, total) }
    resizeFaceEdges(total: number): void { resizeVector(this.faceEdgeIndices, total) }
    resizeEdges(edgeCount: number): void {
        this.edgeCount = edgeCount
        resizeVector(this.edgeFaceCountsAndOffsets, 2 * edgeCount)
        resizeVector(this.edgeSharpness, edgeCount)
        resizeVector(this.edgeTags, edgeCount)
        if (edgeCount > 0) this.edgeTags.fill(0)
    }
    resizeEdgeVertices(): void { resizeVector(this.edgeVertIndices, 2 * this.edgeCount) }
    resizeEdgeFaces(total: number): void {
        resizeVector(this.edgeFaceIndices, total)
        resizeVector(this.edgeFaceLocalIndices, total)
    }
    resizeVertices(vertCount: number): void {
        this.vertCount = vertCount
        resizeVector(this.vertFaceCountsAndOffsets, 2 * vertCount)
        resizeVector(this.vertEdgeCountsAndOffsets, 2 * vertCount)
        resizeVector(this.vertSharpness, vertCount)
        resizeVector(this.vertTags, vertCount)
        this.vertTags.fill(0)
    }
    resizeVertexFaces(total: number): void {
        resizeVector(this.vertFaceIndices, total)
        resizeVector(this.vertFaceLocalIndices, total)
    }
    resizeVertexEdges(total: number): void {
        resizeVector(this.vertEdgeIndices, total)
        resizeVector(this.vertEdgeLocalIndices, total)
    }
    shareFaceVertCountsAndOffsets(): number[] {
        return this.faceVertCountsAndOffsets
    }
    // endregion

    // region fvar (`level.cpp:537-620`, :2105-2142)
    doesVertexFVarTopologyMatch(v: number, channel: number): boolean {
        const fvar = this.getFVarLevel(channel)
        return fvar.valueTopologyMatches(fvar.getVertexValueOffset(v))
    }
    doesEdgeFVarTopologyMatch(e: number, channel: number): boolean {
        return this.getFVarLevel(channel).edgeTopologyMatches(e)
    }
    doesFaceFVarTopologyMatch(f: number, channel: number): boolean {
        return !this.getFVarLevel(channel).getFaceCompositeValueTag(f).isMismatch()
    }

    /** `getFaceVTags` (:554). */
    getFaceVTags(f: number, vTags: number[], channel = -1): void {
        const fVerts = this.getFaceVertices(f)
        if (channel < 0) {
            for (let i = 0; i < fVerts.size; ++i) vTags[i] = this.vertTags[fVerts.get(i)]
        } else {
            const fvar = this.getFVarLevel(channel)
            const fValues = fvar.getFaceValues(f)
            for (let i = 0; i < fVerts.size; ++i) {
                const valueIndex = fvar.findVertexValueIndex(fVerts.get(i), fValues.get(i))
                vTags[i] = fvar.getValueTag(valueIndex).combineWithLevelVTag(this.vertTags[fVerts.get(i)])
            }
        }
    }

    /** `getFaceETags` (:573). */
    getFaceETags(f: number, eTags: number[], channel = -1): void {
        const fEdges = this.getFaceEdges(f)
        if (channel < 0) {
            for (let i = 0; i < fEdges.size; ++i) eTags[i] = this.edgeTags[fEdges.get(i)]
        } else {
            const fvar = this.getFVarLevel(channel)
            for (let i = 0; i < fEdges.size; ++i) eTags[i] = fvar.getEdgeTag(fEdges.get(i)).combineWithLevelETag(this.edgeTags[fEdges.get(i)])
        }
    }

    /** `getFaceCompositeVTag(fVerts)` (:609). */
    getFaceCompositeVTagOf(fVerts: IndexArray): number {
        let bits = this.vertTags[fVerts.get(0)]
        for (let i = 1; i < fVerts.size; ++i) bits |= this.vertTags[fVerts.get(i)]
        return bits
    }

    /** `getFaceCompositeVTag(fIndex, channel)` (:617). */
    getFaceCompositeVTag(f: number, channel = -1): number {
        const fVerts = this.getFaceVertices(f)
        if (channel < 0) return this.getFaceCompositeVTagOf(fVerts)
        const fvar = this.getFVarLevel(channel)
        const tags = fvar.getFaceValueTags(f)
        let bits = tags[0].combineWithLevelVTag(this.vertTags[fVerts.get(0)])
        for (let i = 1; i < fVerts.size; ++i) bits |= tags[i].combineWithLevelVTag(this.vertTags[fVerts.get(i)])
        return bits
    }

    /** `getVertexCompositeFVarVTag` (:638). */
    getVertexCompositeFVarVTag(v: number, channel: number): number {
        const fvar = this.getFVarLevel(channel)
        const fvTags = fvar.getVertexValueTags(v)
        const vTag = this.vertTags[v]
        if (fvTags[0].isMismatch()) {
            let bits = fvTags[0].combineWithLevelVTag(vTag)
            for (let i = 1; i < fvTags.length; ++i) bits |= fvTags[i].combineWithLevelVTag(vTag)
            return bits
        }
        return vTag
    }

    createFVarChannel(fvarValueCount: number, fvarOptions: Options, factory: (level: Level) => FVarLevel): number {
        const fvarLevel = factory(this)
        fvarLevel.setOptions(fvarOptions)
        fvarLevel.resizeValues(fvarValueCount)
        fvarLevel.resizeComponents()
        this.fvarChannels.push(fvarLevel)
        return this.fvarChannels.length - 1
    }
    destroyFVarChannel(channel: number): void { this.fvarChannels.splice(channel, 1) }
    getNumFVarValues(channel: number) { return this.fvarChannels[channel].getNumValues() }
    getFVarOptions(channel: number): Options { return this.fvarChannels[channel].getOptions() }
    getFaceFVarValues(f: number, channel: number): IndexArray { return this.fvarChannels[channel].getFaceValues(f) }
    completeFVarChannelTopology(channel: number, regBoundaryValence: number): void {
        this.fvarChannels[channel].completeTopologyFromFaceValues(regBoundaryValence)
    }
    // endregion

    // region patch point gathering (`level.cpp:647-1350`)
    private facePoints(f: number, channel: number): IndexArray {
        return channel < 0 ? this.getFaceVertices(f) : this.getFaceFVarValues(f, channel)
    }

    /** `gatherQuadRegularRingAroundVertex` (:647). */
    gatherQuadRegularRingAroundVertex(v: number, ringPoints: number[], channel = -1): number {
        const vEdges = this.getVertexEdges(v)
        const vFaces = this.getVertexFaces(v)
        const vInFaces = this.getVertexFaceLocalIndices(v)
        const isBoundary = vEdges.size > vFaces.size
        let ringIndex = 0
        for (let i = 0; i < vFaces.size; ++i) {
            const fPoints = this.facePoints(vFaces.get(i), channel)
            const vInThisFace = vInFaces.get(i)
            ringPoints[ringIndex++] = fPoints.get(fastMod4(vInThisFace + 1))
            ringPoints[ringIndex++] = fPoints.get(fastMod4(vInThisFace + 2))
            if (isBoundary && i === vFaces.size - 1) ringPoints[ringIndex++] = fPoints.get(fastMod4(vInThisFace + 3))
        }
        return ringIndex
    }

    /** `gatherQuadRegularPartialRingAroundVertex` (:675). */
    gatherQuadRegularPartialRingAroundVertex(v: number, span: VSpan, ringPoints: number[], channel = -1): number {
        const vFaces = this.getVertexFaces(v)
        const vInFaces = this.getVertexFaceLocalIndices(v)
        const nFaces = span.numFaces
        const startFace = span.startFace
        let ringIndex = 0
        for (let i = 0; i < nFaces; ++i) {
            const fIncident = (startFace + i) % vFaces.size
            const fPoints = this.facePoints(vFaces.get(fIncident), channel)
            const vInThisFace = vInFaces.get(fIncident)
            ringPoints[ringIndex++] = fPoints.get(fastMod4(vInThisFace + 1))
            ringPoints[ringIndex++] = fPoints.get(fastMod4(vInThisFace + 2))
            if (i === nFaces - 1 && !span.periodic) ringPoints[ringIndex++] = fPoints.get(fastMod4(vInThisFace + 3))
        }
        return ringIndex
    }

    /** `gatherQuadLinearPatchPoints` (:708). */
    gatherQuadLinearPatchPoints(f: number, patchPoints: number[], rotation = 0, channel = -1, offset = 0): number {
        const facePoints = this.facePoints(f, channel)
        for (let i = 0; i < 4; i++) patchPoints[offset + i] = facePoints.get((rotation + i) & 3)
        return 4
    }

    /** `gatherQuadRegularInteriorPatchPoints` (:733). */
    gatherQuadRegularInteriorPatchPoints(thisFace: number, patchPoints: number[], rotation = 0, channel = -1, offset = 0): number {
        const thisFaceVerts = this.getFaceVertices(thisFace)
        let facePoints = channel < 0 ? thisFaceVerts : this.getFaceFVarValues(thisFace, channel)
        for (let i = 0; i < 4; i++) patchPoints[offset + i] = facePoints.get((rotation + i) & 3)
        let pointIndex = 4
        for (let i = 0; i < 4; ++i) {
            const v = thisFaceVerts.get((rotation + i) & 3)
            const vFaces = this.getVertexFaces(v)
            const vInFaces = this.getVertexFaceLocalIndices(v)
            const thisFaceInVFaces = vFaces.findIndexIn4Tuple(thisFace)
            const intFaceInVFaces = fastMod4(thisFaceInVFaces + 2)
            const intFace = vFaces.get(intFaceInVFaces)
            const vInIntFace = vInFaces.get(intFaceInVFaces)
            facePoints = this.facePoints(intFace, channel)
            patchPoints[offset + pointIndex++] = facePoints.get(fastMod4(vInIntFace + 1))
            patchPoints[offset + pointIndex++] = facePoints.get(fastMod4(vInIntFace + 2))
            patchPoints[offset + pointIndex++] = facePoints.get(fastMod4(vInIntFace + 3))
        }
        return 16
    }

    /** `gatherQuadRegularBoundaryPatchPoints` (:787). */
    gatherQuadRegularBoundaryPatchPoints(face: number, patchPoints: number[], boundaryEdgeInFace: number, channel = -1, offset = 0): number {
        const interiorEdgeInFace = fastMod4(boundaryEdgeInFace + 2)
        const intV0InFace = interiorEdgeInFace
        const intV1InFace = fastMod4(interiorEdgeInFace + 1)
        const faceVerts = this.getFaceVertices(face)
        const v0 = faceVerts.get(intV0InFace)
        const v1 = faceVerts.get(intV1InFace)
        const v0Faces = this.getVertexFaces(v0)
        const v1Faces = this.getVertexFaces(v1)
        const v0InFaces = this.getVertexFaceLocalIndices(v0)
        const v1InFaces = this.getVertexFaceLocalIndices(v1)
        let boundaryFaceInV0Faces = -1
        let boundaryFaceInV1Faces = -1
        for (let i = 0; i < 4; ++i) {
            if (face === v0Faces.get(i)) boundaryFaceInV0Faces = i
            if (face === v1Faces.get(i)) boundaryFaceInV1Faces = i
        }
        const prevFaceInV0Faces = fastMod4(boundaryFaceInV0Faces + 1)
        const intFaceInV0Faces = fastMod4(boundaryFaceInV0Faces + 2)
        const intFaceInV1Faces = fastMod4(boundaryFaceInV1Faces + 2)
        const nextFaceInV1Faces = fastMod4(boundaryFaceInV1Faces + 3)
        const prevFace = v0Faces.get(prevFaceInV0Faces)
        const intV0Face = v0Faces.get(intFaceInV0Faces)
        const intV1Face = v1Faces.get(intFaceInV1Faces)
        const nextFace = v1Faces.get(nextFaceInV1Faces)
        const v0InPrevFace = v0InFaces.get(prevFaceInV0Faces)
        const v0InIntFace = v0InFaces.get(intFaceInV0Faces)
        const v1InIntFace = v1InFaces.get(intFaceInV1Faces)
        const v1InNextFace = v1InFaces.get(nextFaceInV1Faces)
        const thisFacePoints = channel < 0 ? faceVerts : this.getFaceFVarValues(face, channel)
        const prevFacePoints = this.facePoints(prevFace, channel)
        const intV0FacePoints = this.facePoints(intV0Face, channel)
        const intV1FacePoints = this.facePoints(intV1Face, channel)
        const nextFacePoints = this.facePoints(nextFace, channel)
        const p = patchPoints, o = offset
        p[o + 0] = thisFacePoints.get(fastMod4(boundaryEdgeInFace + 1))
        p[o + 1] = thisFacePoints.get(fastMod4(boundaryEdgeInFace + 2))
        p[o + 2] = thisFacePoints.get(fastMod4(boundaryEdgeInFace + 3))
        p[o + 3] = thisFacePoints.get(boundaryEdgeInFace)
        p[o + 4] = prevFacePoints.get(fastMod4(v0InPrevFace + 2))
        p[o + 5] = intV0FacePoints.get(fastMod4(v0InIntFace + 1))
        p[o + 6] = intV0FacePoints.get(fastMod4(v0InIntFace + 2))
        p[o + 7] = intV0FacePoints.get(fastMod4(v0InIntFace + 3))
        p[o + 8] = intV1FacePoints.get(fastMod4(v1InIntFace + 1))
        p[o + 9] = intV1FacePoints.get(fastMod4(v1InIntFace + 2))
        p[o + 10] = intV1FacePoints.get(fastMod4(v1InIntFace + 3))
        p[o + 11] = nextFacePoints.get(fastMod4(v1InNextFace + 2))
        return 12
    }

    /** `gatherQuadRegularCornerPatchPoints` (:879). */
    gatherQuadRegularCornerPatchPoints(face: number, patchPoints: number[], cornerVertInFace: number, channel = -1, offset = 0): number {
        const interiorFaceVert = fastMod4(cornerVertInFace + 2)
        const faceVerts = this.getFaceVertices(face)
        const intVert = faceVerts.get(interiorFaceVert)
        const intVertFaces = this.getVertexFaces(intVert)
        const intVertInFaces = this.getVertexFaceLocalIndices(intVert)
        let cornerFaceInIntVertFaces = -1
        for (let i = 0; i < intVertFaces.size; ++i) {
            if (face === intVertFaces.get(i)) {
                cornerFaceInIntVertFaces = i
                break
            }
        }
        const prevFaceInIntVertFaces = fastMod4(cornerFaceInIntVertFaces + 1)
        const intFaceInIntVertFaces = fastMod4(cornerFaceInIntVertFaces + 2)
        const nextFaceInIntVertFaces = fastMod4(cornerFaceInIntVertFaces + 3)
        const prevFace = intVertFaces.get(prevFaceInIntVertFaces)
        const intFace = intVertFaces.get(intFaceInIntVertFaces)
        const nextFace = intVertFaces.get(nextFaceInIntVertFaces)
        const intVertInPrevFace = intVertInFaces.get(prevFaceInIntVertFaces)
        const intVertInIntFace = intVertInFaces.get(intFaceInIntVertFaces)
        const intVertInNextFace = intVertInFaces.get(nextFaceInIntVertFaces)
        const thisFacePoints = channel < 0 ? faceVerts : this.getFaceFVarValues(face, channel)
        const prevFacePoints = this.facePoints(prevFace, channel)
        const intFacePoints = this.facePoints(intFace, channel)
        const nextFacePoints = this.facePoints(nextFace, channel)
        const p = patchPoints, o = offset
        p[o + 0] = thisFacePoints.get(cornerVertInFace)
        p[o + 1] = thisFacePoints.get(fastMod4(cornerVertInFace + 1))
        p[o + 2] = thisFacePoints.get(fastMod4(cornerVertInFace + 2))
        p[o + 3] = thisFacePoints.get(fastMod4(cornerVertInFace + 3))
        p[o + 4] = prevFacePoints.get(fastMod4(intVertInPrevFace + 2))
        p[o + 5] = intFacePoints.get(fastMod4(intVertInIntFace + 1))
        p[o + 6] = intFacePoints.get(fastMod4(intVertInIntFace + 2))
        p[o + 7] = intFacePoints.get(fastMod4(intVertInIntFace + 3))
        p[o + 8] = nextFacePoints.get(fastMod4(intVertInNextFace + 2))
        return 9
    }

    /** The triangle gathers (:956-1330) serve the Loop scheme only, which Blender does not use. */
    gatherTriRegularInteriorPatchPoints(): number {
        throw new Error('OpenSubdiv: Level::gatherTriRegular*PatchPoints (Loop scheme) is not ported')
    }
    // endregion

    /** `isSingleCreasePatch` (:1350). */
    isSingleCreasePatch(face: number): {sharpness: number, sharpEdgeInFace: number} | undefined {
        const fVerts = this.getFaceVertices(face)
        const allCornersTag = this.getFaceCompositeVTagOf(fVerts)
        const rule = vtRule(allCornersTag)
        if (!(rule & Rule.CREASE) || (rule & Rule.CORNER) || (rule & Rule.DART) || (allCornersTag & VT_BOUNDARY) ||
            (allCornersTag & VT_XORDINARY) || (allCornersTag & VT_NON_MANIFOLD)) return undefined
        const isCrease = (v: number) => (vtRule(this.vertTags[v]) === Rule.CREASE ? 1 : 0)
        const creaseCornerMask = (isCrease(fVerts.get(0)) << 0) | (isCrease(fVerts.get(1)) << 1) | (isCrease(fVerts.get(2)) << 2) | (isCrease(fVerts.get(3)) << 3)
        const sharpEdgeFromCreaseMask = [-1, -1, -1, 0, -1, -1, 1, -1, -1, 3, -1, -1, 2, -1, -1, -1]
        const sharpEdgeInFace = sharpEdgeFromCreaseMask[creaseCornerMask]
        if (sharpEdgeInFace < 0) return undefined
        const vAEdges = this.getVertexEdges(fVerts.get(sharpEdgeInFace))
        const vBEdges = this.getVertexEdges(fVerts.get(fastMod4(sharpEdgeInFace + 1)))
        const s = (e: number) => this.edgeSharpness[e]
        if (s(vAEdges.get(0)) !== s(vAEdges.get(2)) || s(vAEdges.get(1)) !== s(vAEdges.get(3)) ||
            s(vBEdges.get(0)) !== s(vBEdges.get(2)) || s(vBEdges.get(1)) !== s(vBEdges.get(3))) return undefined
        return {sharpness: this.edgeSharpness[this.getFaceEdges(face).get(sharpEdgeInFace)], sharpEdgeInFace}
    }

    // region topology completion (`level.cpp:1420-1800`)

    /** `findEdge(v0, v1, v0Edges)` (:1597). */
    findEdgeIn(v0: number, v1: number, v0Edges: IndexArray | number[]): number {
        const n = v0Edges instanceof IndexArray ? v0Edges.size : v0Edges.length
        const at = (j: number) => (v0Edges instanceof IndexArray ? v0Edges.get(j) : v0Edges[j])
        if (v0 !== v1) {
            for (let j = 0; j < n; ++j) {
                const eVerts = this.getEdgeVertices(at(j))
                if (eVerts.get(0) === v1 || eVerts.get(1) === v1) return at(j)
            }
        } else {
            for (let j = 0; j < n; ++j) {
                const eVerts = this.getEdgeVertices(at(j))
                if (eVerts.get(0) === eVerts.get(1)) return at(j)
            }
        }
        return INDEX_INVALID
    }

    /** `findEdge(v0, v1)` (:1620). */
    findEdge(v0: number, v1: number): number {
        return this.findEdgeIn(v0, v1, this.getVertexEdges(v0))
    }

    /** `completeTopologyFromFaceVertices` (:1624). */
    completeTopologyFromFaceVertices(): boolean {
        const vCount = this.getNumVertices()
        const fCount = this.getNumFaces()
        this.resizeVertices(vCount)
        this.resizeFaces(fCount)
        this.resizeEdges(0)
        resizeVector(this.faceEdgeIndices, this.getNumFaceVerticesTotal())
        const avgSize = 6
        const dynEdgeFaces = new DynamicRelation(this.edgeFaceCountsAndOffsets, this.edgeFaceIndices, 2)
        const dynVertFaces = new DynamicRelation(this.vertFaceCountsAndOffsets, this.vertFaceIndices, avgSize)
        const dynVertEdges = new DynamicRelation(this.vertEdgeCountsAndOffsets, this.vertEdgeIndices, avgSize)
        const nonManifoldEdges: number[] = []
        for (let fIndex = 0; fIndex < fCount; ++fIndex) {
            const fVerts = this.getFaceVertices(fIndex)
            const fEdges = this.getFaceEdges(fIndex)
            for (let i = 0; i < fVerts.size; ++i) {
                const v0Index = fVerts.get(i)
                const v1Index = fVerts.get((i + 1) % fVerts.size)
                let eIndex: number
                if (v0Index !== v1Index) {
                    eIndex = this.findEdgeIn(v0Index, v1Index, dynVertEdges.getCompMembers(v0Index))
                } else {
                    eIndex = INDEX_INVALID
                    nonManifoldEdges.push(this.edgeCount)
                }
                if (indexIsValid(eIndex)) {
                    const eFaces = dynEdgeFaces.getCompMembers(eIndex)
                    if (eFaces[eFaces.length - 1] === fIndex) {
                        nonManifoldEdges.push(eIndex)
                        nonManifoldEdges.push(this.edgeCount)
                        eIndex = INDEX_INVALID
                    } else if (eFaces.length > 1) {
                        nonManifoldEdges.push(eIndex)
                    } else if (v0Index === this.getEdgeVertices(eIndex).get(0)) {
                        nonManifoldEdges.push(eIndex)
                    }
                }
                if (!indexIsValid(eIndex)) {
                    eIndex = this.edgeCount
                    this.edgeCount++
                    this.edgeVertIndices.push(v0Index)
                    this.edgeVertIndices.push(v1Index)
                    dynEdgeFaces.appendComponent()
                    dynVertEdges.appendCompMember(v0Index, eIndex)
                    dynVertEdges.appendCompMember(v1Index, eIndex)
                }
                dynEdgeFaces.appendCompMember(eIndex, fIndex)
                dynVertFaces.appendCompMember(v0Index, fIndex)
                fEdges.set(i, eIndex)
            }
        }
        const maxEdgeFaces = dynEdgeFaces.compressMemberIndices()
        const maxVertFaces = dynVertFaces.compressMemberIndices()
        const maxVertEdges = dynVertEdges.compressMemberIndices()
        this.maxEdgeFaces = maxEdgeFaces
        this.maxValence = Math.max(maxVertFaces, this.maxValence)
        this.maxValence = Math.max(maxVertEdges, this.maxValence)
        if (this.maxValence > VALENCE_LIMIT) return false
        const eCount = this.getNumEdges()
        this.resizeEdges(eCount)
        for (const e of nonManifoldEdges) {
            this.edgeTags[e] |= ET_NON_MANIFOLD
            const eVerts = this.getEdgeVertices(e)
            this.vertTags[eVerts.get(0)] |= VT_NON_MANIFOLD
            this.vertTags[eVerts.get(1)] |= VT_NON_MANIFOLD
        }
        this.orientIncidentComponents()
        this.populateLocalIndices()
        return true
    }

    /** `populateLocalIndices` (:1800). */
    populateLocalIndices(): void {
        const eCount = this.getNumEdges()
        const vCount = this.getNumVertices()
        resizeVector(this.vertFaceLocalIndices, this.vertFaceIndices.length)
        resizeVector(this.vertEdgeLocalIndices, this.vertEdgeIndices.length)
        resizeVector(this.edgeFaceLocalIndices, this.edgeFaceIndices.length)
        for (let v = 0; v < vCount; ++v) {
            const vFaces = this.getVertexFaces(v)
            const vInFaces = this.getVertexFaceLocalIndices(v)
            let vFaceLast = INDEX_INVALID
            for (let i = 0; i < vFaces.size; ++i) {
                const fVerts = this.getFaceVertices(vFaces.get(i))
                const vStart = vFaces.get(i) === vFaceLast ? vInFaces.get(i - 1) + 1 : 0
                let k = vStart
                while (k < fVerts.size && fVerts.get(k) !== v) k++
                vInFaces.set(i, k & 0xffff)
                vFaceLast = vFaces.get(i)
            }
        }
        for (let v = 0; v < vCount; ++v) {
            const vEdges = this.getVertexEdges(v)
            const vInEdges = this.getVertexEdgeLocalIndices(v)
            for (let i = 0; i < vEdges.size; ++i) {
                const eVerts = this.getEdgeVertices(vEdges.get(i))
                if (eVerts.get(0) !== eVerts.get(1)) {
                    vInEdges.set(i, v === eVerts.get(1) ? 1 : 0)
                } else {
                    vInEdges.set(i, i && vEdges.get(i) === vEdges.get(i - 1) ? 1 : 0)
                }
            }
            this.maxValence = Math.max(this.maxValence, vEdges.size)
        }
        for (let e = 0; e < eCount; ++e) {
            const eFaces = this.getEdgeFaces(e)
            const eInFaces = this.getEdgeFaceLocalIndices(e)
            let eFaceLast = INDEX_INVALID
            for (let i = 0; i < eFaces.size; ++i) {
                const fEdges = this.getFaceEdges(eFaces.get(i))
                const eStart = eFaces.get(i) === eFaceLast ? eInFaces.get(i - 1) + 1 : 0
                let k = eStart
                while (k < fEdges.size && fEdges.get(k) !== e) k++
                eInFaces.set(i, k & 0xffff)
                eFaceLast = eFaces.get(i)
            }
        }
    }

    /** `orientIncidentComponents` (:1859). */
    orientIncidentComponents(): void {
        const vCount = this.getNumVertices()
        for (let v = 0; v < vCount; ++v) {
            if (!(this.vertTags[v] & VT_NON_MANIFOLD)) {
                if (!this.orderVertexFacesAndEdges(v)) this.vertTags[v] |= VT_NON_MANIFOLD
            }
        }
    }

    /** `orderVertexFacesAndEdges(vIndex, vFacesOrdered, vEdgesOrdered)` (:1884). */
    orderVertexFacesAndEdgesInto(v: number, vFacesOrdered: number[], vEdgesOrdered: number[]): boolean {
        const vEdges = this.getVertexEdges(v)
        const vFaces = this.getVertexFaces(v)
        const fCount = vFaces.size
        const eCount = vEdges.size
        if (fCount === 0 || eCount < 2 || eCount - fCount > 1) return false
        let fStart = INDEX_INVALID
        let eStart = INDEX_INVALID
        let fvStart = 0
        if (eCount === fCount) {
            fStart = vFaces.get(0)
            fvStart = this.getFaceVertices(fStart).findIndex(v)
            eStart = this.getFaceEdges(fStart).get(fvStart)
        } else {
            for (let i = 0; i < eCount; ++i) {
                const eFaces = this.getEdgeFaces(vEdges.get(i))
                if (eFaces.size === 1) {
                    eStart = vEdges.get(i)
                    fStart = eFaces.get(0)
                    fvStart = this.getFaceVertices(fStart).findIndex(v)
                    if (eStart === this.getFaceEdges(fStart).get(fvStart)) break
                }
            }
        }
        let eCountOrdered = 1
        let fCountOrdered = 1
        vFacesOrdered[0] = fStart
        vEdgesOrdered[0] = eStart
        const eFirst = eStart
        while (eCountOrdered < eCount) {
            const fVerts = this.getFaceVertices(fStart)
            const fEdges = this.getFaceEdges(fStart)
            const feStart = fvStart
            const feNext = feStart ? feStart - 1 : fVerts.size - 1
            const eNext = fEdges.get(feNext)
            if (eNext === eStart || eNext === eFirst) return false
            vEdgesOrdered[eCountOrdered++] = eNext
            if (fCountOrdered < fCount) {
                const eFaces = this.getEdgeFaces(eNext)
                if (eFaces.size === 0) return false
                if (eFaces.size === 1 && eFaces.get(0) === fStart) return false
                fStart = eFaces.get(eFaces.get(0) === fStart ? 1 : 0)
                fvStart = this.getFaceEdges(fStart).findIndex(eNext)
                vFacesOrdered[fCountOrdered++] = fStart
            }
            eStart = eNext
        }
        return true
    }

    /** `orderVertexFacesAndEdges(vIndex)` (:1968). */
    orderVertexFacesAndEdges(v: number): boolean {
        const vFaces = this.getVertexFaces(v)
        const vEdges = this.getVertexEdges(v)
        const facesOrdered: number[] = [], edgesOrdered: number[] = []
        if (this.orderVertexFacesAndEdgesInto(v, facesOrdered, edgesOrdered)) {
            for (let i = 0; i < vFaces.size; i++) vFaces.set(i, facesOrdered[i])
            for (let i = 0; i < vEdges.size; i++) vEdges.set(i, edgesOrdered[i])
            return true
        }
        return false
    }

    /** `testVertexNonManifoldCrease` (:1986). */
    testVertexNonManifoldCrease(v: number): boolean {
        const nonManEdges = [-1, -1]
        const vEdges = this.getVertexEdges(v)
        for (let i = 0; i < vEdges.size; ++i) {
            if (this.isEdgeNonManifold(vEdges.get(i))) {
                if (nonManEdges[1] >= 0) return false
                nonManEdges[nonManEdges[0] >= 0 ? 1 : 0] = vEdges.get(i)
            } else if (this.getEdgeFaces(vEdges.get(i)).size !== 2) {
                return false
            }
        }
        if (this.getEdgeFaces(nonManEdges[0]).size !== this.getEdgeFaces(nonManEdges[1]).size) return false
        let numFacesTraversed = 0
        for (let i = 0; i < 2; ++i) {
            const eIndex = nonManEdges[i]
            const eStart = nonManEdges[i !== 0 ? 1 : 0]
            const eEnd = nonManEdges[i === 0 ? 1 : 0]
            const eFaces = this.getEdgeFaces(eIndex)
            const eInFace = this.getEdgeFaceLocalIndices(eIndex)
            for (let j = 0; j < eFaces.size; ++j) {
                const fStart = eFaces.get(j)
                const fVerts = this.getFaceVertices(fStart)
                if (fVerts.get(eInFace.get(j)) !== v) continue
                for (let eNext = eStart, fNext = fStart; eNext !== eEnd;) {
                    if (eNext !== eStart) {
                        const fPair = this.getEdgeFaces(eNext)
                        fNext = fPair.get(fPair.get(0) === fNext ? 1 : 0)
                    }
                    numFacesTraversed++
                    const fEdges = this.getFaceEdges(fNext)
                    const iNext = fEdges.findIndex(eNext)
                    eNext = fEdges.get(iNext ? iNext - 1 : fEdges.size - 1)
                    if (eNext === eStart) return false
                }
            }
        }
        return numFacesTraversed === this.getVertexFaces(v).size
    }
    // endregion
}

/** `DynamicRelation` (`level.cpp:1440`): a relation built incrementally with an overflow map for irregular members. */
class DynamicRelation {
    compCount: number
    readonly irregIndices = new Map<number, number[]>()

    constructor(readonly countsAndOffsets: number[], readonly regIndices: number[], readonly memberCountPerComp: number) {
        this.compCount = countsAndOffsets.length / 2
        for (let i = 0; i < this.compCount; ++i) {
            countsAndOffsets[2 * i] = 0
            countsAndOffsets[2 * i + 1] = i * memberCountPerComp
        }
        resizeVector(regIndices, this.compCount * memberCountPerComp)
    }

    /** `getCompMembers` (:1478): a copy of the members (read only here). */
    getCompMembers(compIndex: number): number[] {
        const count = this.countsAndOffsets[2 * compIndex]
        if (count > this.memberCountPerComp) return this.irregIndices.get(compIndex)!.slice()
        const offset = this.countsAndOffsets[2 * compIndex + 1]
        return this.regIndices.slice(offset, offset + count)
    }

    /** `appendCompMember` (:1490). */
    appendCompMember(compIndex: number, memberValue: number): void {
        const count = this.countsAndOffsets[2 * compIndex]
        const offset = this.countsAndOffsets[2 * compIndex + 1]
        if (count < this.memberCountPerComp) {
            this.regIndices[offset + count] = memberValue
        } else {
            let irreg = this.irregIndices.get(compIndex)
            if (!irreg) this.irregIndices.set(compIndex, irreg = [])
            if (count > this.memberCountPerComp) {
                irreg.push(memberValue)
            } else {
                irreg.length = 0
                for (let k = 0; k < this.memberCountPerComp; k++) irreg.push(this.regIndices[offset + k])
                irreg.push(memberValue)
            }
        }
        this.countsAndOffsets[2 * compIndex]++
    }

    /** `appendComponent` (:1512). */
    appendComponent(): void {
        this.countsAndOffsets.push(0)
        this.countsAndOffsets.push(this.compCount * this.memberCountPerComp)
        ++this.compCount
        resizeVector(this.regIndices, this.compCount * this.memberCountPerComp)
    }

    /** `compressMemberIndices` (:1520): the members packed in order; returns the largest member count. */
    compressMemberIndices(): number {
        if (this.irregIndices.size === 0) {
            let memberCount = this.countsAndOffsets[0]
            let memberMax = this.countsAndOffsets[0]
            for (let i = 1; i < this.compCount; ++i) {
                const count = this.countsAndOffsets[2 * i]
                const offset = this.countsAndOffsets[2 * i + 1]
                for (let k = 0; k < count; k++) this.regIndices[memberCount + k] = this.regIndices[offset + k]
                this.countsAndOffsets[2 * i + 1] = memberCount
                memberCount += count
                memberMax = Math.max(memberMax, count)
            }
            resizeVector(this.regIndices, memberCount)
            return memberMax
        }
        let memberCount = this.countsAndOffsets[0]
        for (let i = 1; i < this.compCount; ++i) {
            this.countsAndOffsets[2 * i + 1] = memberCount
            memberCount += this.countsAndOffsets[2 * i]
        }
        const dst = new Array<number>(memberCount).fill(0)
        let memberMax = this.memberCountPerComp
        for (let i = 0; i < this.compCount; ++i) {
            const count = this.countsAndOffsets[2 * i]
            const dstOffset = this.countsAndOffsets[2 * i + 1]
            if (count <= this.memberCountPerComp) {
                for (let k = 0; k < count; k++) dst[dstOffset + k] = this.regIndices[i * this.memberCountPerComp + k]
            } else {
                const src = this.irregIndices.get(i)!
                for (let k = 0; k < count; k++) dst[dstOffset + k] = src[k]
                memberMax = Math.max(memberMax, count)
            }
        }
        this.regIndices.length = 0
        for (const x of dst) this.regIndices.push(x)
        return memberMax
    }
}

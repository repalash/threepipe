/**
 * Face-varying channels (UV maps): OpenSubdiv `Vtr::internal::FVarLevel` and `FVarRefinement`, ported from
 * `opensubdiv/vtr/{fvarLevel.h, fvarLevel.cpp, fvarRefinement.cpp}`, uniform and sparse refinement.
 *
 * A vertex has one "value" per distinct UV around it (its siblings); each value is tagged with how its span of
 * faces should be interpolated (matching the vertex, a smooth boundary "crease", a sharp "corner", semi-sharp, or
 * non-manifold). At level 0 values index the caller's value array; at deeper levels a value index is the vertex's
 * sibling offset plus the sibling (`trimAndFinalizeChildValues`).
 */

import {Level, VTag, ETag as LevelETag, RULE_SHIFT} from './level'
import {QuadRefinement} from './refinement'
import {computeFractionalWeightAtVertex, FVarLinearInterpolation, Rule, SdcOptions, VtxBoundaryInterpolation} from './sdc'

/** `FVarLevel::ETag` bits. */
export enum FETag { Mismatch = 1, DisctsV0 = 2, DisctsV1 = 4, Linear = 8 }

/** `FVarLevel::ValueTag` bits. */
export enum FVTag {
    Mismatch = 1, Xordinary = 2, NonManifold = 4, Crease = 8, SemiSharp = 16, DepSharp = 32, InfSharpEdges = 64, InfIrregular = 128,
}

export const valueIsCorner = (t: number) => !(t & FVTag.Crease)
export const valueIsSemiSharp = (t: number) => (t & FVTag.SemiSharp) !== 0
export const valueIsInfSharp = (t: number) => !(t & FVTag.SemiSharp) && !(t & FVTag.Crease)
export const valueIsDepSharp = (t: number) => (t & FVTag.DepSharp) !== 0

interface ValueSpan { size: number, start: number, disctsEdgeCount: number, semiSharpEdgeCount: number, infSharpEdgeCount: number }

export class FVarLevel {
    readonly level: Level
    options: SdcOptions
    isLinear = false
    hasLinearBoundaries = false
    hasDependentSharpness = false
    valueCount = 0

    /** Per face-vertex of the level. */
    faceVertValues: Int32Array
    edgeTags: Uint8Array
    vertSiblingCounts: Int32Array
    vertSiblingOffsets: Int32Array
    /** Aligned with `level.vertFaces.indices`. */
    vertFaceSiblings: Int32Array
    vertValueIndices: Int32Array = new Int32Array(0)
    vertValueTags: Uint8Array = new Uint8Array(0)
    creaseStart: Int32Array = new Int32Array(0)
    creaseEnd: Int32Array = new Int32Array(0)

    constructor(level: Level, options: SdcOptions) {
        this.level = level
        this.options = options
        this.faceVertValues = new Int32Array(level.faceVerts.indices.length)
        this.edgeTags = new Uint8Array(level.numEdges)
        this.vertSiblingCounts = new Int32Array(level.numVertices)
        this.vertSiblingOffsets = new Int32Array(level.numVertices)
        this.vertFaceSiblings = new Int32Array(level.vertFaces.indices.length)
    }

    get hasSmoothBoundaries(): boolean { return !this.hasLinearBoundaries }
    get hasCreaseEnds(): boolean { return this.hasSmoothBoundaries }

    getFaceValues(f: number): Int32Array {
        const o = this.level.faceVerts.offsets[f]
        return this.faceVertValues.subarray(o, o + this.level.faceVerts.counts[f])
    }
    getVertexFaceSiblings(v: number): Int32Array {
        const o = this.level.vertFaces.offsets[v]
        return this.vertFaceSiblings.subarray(o, o + this.level.vertFaces.counts[v])
    }
    getNumVertexValues(v: number): number { return this.vertSiblingCounts[v] }
    getVertexValueOffset(v: number, sibling = 0): number { return this.vertSiblingOffsets[v] + sibling }
    getVertexValue(v: number, sibling = 0): number { return this.vertValueIndices[this.vertSiblingOffsets[v] + sibling] }
    getVertexValues(v: number): Int32Array {
        const o = this.vertSiblingOffsets[v]
        return this.vertValueIndices.subarray(o, o + this.vertSiblingCounts[v])
    }
    valueTopologyMatches(valueIndex: number): boolean { return !(this.vertValueTags[valueIndex] & FVTag.Mismatch) }

    /** `FVarLevel::findVertexValueIndex` (`fvarLevel.h:356`). */
    findVertexValueIndex(v: number, value: number): number {
        if (this.level.depth > 0) return value
        let vv = this.getVertexValueOffset(v)
        while (this.vertValueIndices[vv] !== value) vv++
        return vv
    }

    /** `FVarLevel::getFaceCompositeValueTag` (`fvarLevel.cpp:1027`). */
    getFaceCompositeValueTag(f: number): number {
        const fValues = this.getFaceValues(f), fVerts = this.level.getFaceVertices(f)
        let bits = 0
        for (let i = 0; i < fValues.length; i++) bits |= this.vertValueTags[this.findVertexValueIndex(fVerts[i], fValues[i])]
        return bits
    }

    /** `FVarLevel::ETag::combineWithLevelETag` (`fvarLevel.h:371`). */
    combineWithLevelETag(fvarETag: number, levelETag: number): number {
        return fvarETag & FETag.Mismatch ? levelETag | LevelETag.Boundary | LevelETag.InfSharp : levelETag
    }

    /** `FVarLevel::ValueTag::combineWithLevelVTag` (`fvarLevel.h:380`), on a tag with its rule (`Level.getVertexTag`). */
    combineWithLevelVTag(valueTag: number, levelTag: number): number {
        if (!(valueTag & FVTag.Mismatch)) return levelTag
        let tag = levelTag & ((1 << RULE_SHIFT) - 1)
        const rule = valueIsCorner(valueTag) ? Rule.Corner : Rule.Crease
        if ((valueTag & FVTag.Crease) || (valueTag & FVTag.SemiSharp)) {
            tag &= ~(VTag.InfSharp | VTag.Corner)
            tag |= VTag.InfSharpCrease
        } else {
            tag |= VTag.InfSharp
            tag &= ~VTag.InfSharpCrease
            if (!(valueTag & FVTag.InfIrregular) && !(valueTag & FVTag.InfSharpEdges)) tag |= VTag.Corner
            else tag &= ~VTag.Corner
        }
        tag |= VTag.InfSharpEdges
        if (valueTag & FVTag.InfIrregular) tag |= VTag.InfIrregular; else tag &= ~VTag.InfIrregular
        tag |= VTag.Boundary
        if (valueTag & FVTag.Xordinary) tag |= VTag.Xordinary; else tag &= ~VTag.Xordinary
        if (valueTag & FVTag.NonManifold) tag |= VTag.NonManifold
        return tag | (rule << RULE_SHIFT)
    }
    edgeTopologyMatches(e: number): boolean { return !(this.edgeTags[e] & FETag.Mismatch) }

    private resizeVertexValues(n: number): void {
        this.vertValueIndices = new Int32Array(n)
        this.vertValueTags = new Uint8Array(n)
        if (this.hasCreaseEnds) { this.creaseStart = new Int32Array(n); this.creaseEnd = new Int32Array(n) }
    }

    /** `FVarLevel::completeTopologyFromFaceValues` (`fvarLevel.cpp:121`). */
    completeTopologyFromFaceValues(regularBoundaryValence: number): void {
        const L = this.level
        const geom = this.options.vtxBoundaryInterpolation, fvar = this.options.fvarLinearInterpolation
        this.isLinear = fvar === FVarLinearInterpolation.All
        this.hasLinearBoundaries = fvar === FVarLinearInterpolation.All || fvar === FVarLinearInterpolation.Boundaries
        this.hasDependentSharpness = fvar === FVarLinearInterpolation.CornersPlus1 || fvar === FVarLinearInterpolation.CornersPlus2
        const geomCornersAreSmooth = geom !== VtxBoundaryInterpolation.EdgeAndCorner
        const fvarCornersAreSharp = fvar !== FVarLinearInterpolation.None
        const makeSmoothCornersSharp = geomCornersAreSmooth && fvarCornersAreSharp
        const sharpenBothIfOneCorner = fvar === FVarLinearInterpolation.CornersPlus2
        const sharpenDarts = sharpenBothIfOneCorner || this.hasLinearBoundaries

        const vertexMismatch = new Uint8Array(L.numVertices)
        this.vertFaceSiblings.fill(0)
        let totalValueCount = 0
        const vValuesAll: number[][] = new Array(L.numVertices)

        for (let v = 0; v < L.numVertices; v++) {
            const vFaces = L.getVertexFaces(v), vInFace = L.getVertexFaceLocalIndices(v)
            const vValues: number[] = []
            for (let i = 0; i < vFaces.length; i++) vValues.push(this.faceVertValues[L.faceVerts.offsets[vFaces[i]] + vInFace[i]])
            vValuesAll[v] = vValues
            const vEdges = L.getVertexEdges(v), vInEdge = L.getVertexEdgeLocalIndices(v)
            const vIsManifold = !(L.vertTags[v] & VTag.NonManifold)
            const vIsBoundary = (L.vertTags[v] & VTag.Boundary) !== 0
            const tagDiscts = (e: number) => {
                const ev0 = L.edgeVerts[2 * e], ev1 = L.edgeVerts[2 * e + 1]
                vertexMismatch[ev0] = 1
                vertexMismatch[ev1] = 1
                let t = this.edgeTags[e] & ~(FETag.DisctsV0 | FETag.DisctsV1 | FETag.Linear)
                if (ev0 === v) t |= FETag.DisctsV0
                if (ev1 === v) t |= FETag.DisctsV1
                t |= FETag.Mismatch
                if (this.hasLinearBoundaries) t |= FETag.Linear
                this.edgeTags[e] = t
            }
            if (vIsManifold) {
                for (let i = vIsBoundary ? 1 : 0; i < vFaces.length; i++) {
                    const prev = i ? i - 1 : vFaces.length - 1
                    if (vValues[i] !== vValues[prev]) tagDiscts(vEdges[i])
                }
            } else if (vFaces.length > 0) {
                for (let i = 0; i < vEdges.length; i++) {
                    const e = vEdges[i]
                    const eFaces = L.getEdgeFaces(e)
                    if (eFaces.length < 2) continue
                    const eInFace = L.getEdgeFaceLocalIndices(e)
                    const ev0 = L.edgeVerts[2 * e]
                    const vertInEdge = vInEdge[i]
                    let markDiscts = false, value0 = 0
                    for (let j = 0; !markDiscts && j < eFaces.length; j++) {
                        const f = eFaces[j]
                        const fVerts = L.getFaceVertices(f), fValues = this.getFaceValues(f)
                        const edgeInFace = eInFace[j]
                        const edgeReversed = ev0 !== fVerts[edgeInFace] ? 1 : 0
                        let vertInFace = edgeInFace + (vertInEdge !== edgeReversed ? 1 : 0)
                        if (vertInFace === fVerts.length) vertInFace = 0
                        if (j === 0) value0 = fValues[vertInFace]
                        else markDiscts = fValues[vertInFace] !== value0
                    }
                    if (markDiscts) tagDiscts(e)
                }
            }
            if (vIsBoundary && !vertexMismatch[v]) {
                if (this.hasLinearBoundaries && vFaces.length > 0) {
                    vertexMismatch[v] = 1
                    if (vIsManifold) {
                        this.edgeTags[vEdges[0]] |= FETag.Linear
                        this.edgeTags[vEdges[vEdges.length - 1]] |= FETag.Linear
                    } else {
                        for (let i = 0; i < vEdges.length; i++) if (L.edgeTags[vEdges[i]] & LevelETag.Boundary) this.edgeTags[vEdges[i]] |= FETag.Linear
                    }
                } else if (vFaces.length === 1) {
                    if (makeSmoothCornersSharp) vertexMismatch[v] = 1
                }
            }
            // unique values and the sibling of each incident face
            const unique: number[] = [vValues[0]]
            const siblings: number[] = [0]
            for (let i = 1; i < vFaces.length; i++) {
                if (vValues[i] === vValues[i - 1]) siblings[i] = siblings[i - 1]
                else {
                    siblings[i] = unique.length
                    if (unique.length === 1) unique.push(vValues[i])
                    else if (unique.length === 2 && unique[0] !== vValues[i]) unique.push(vValues[i])
                    else {
                        const k = unique.indexOf(vValues[i])
                        if (k < 0) unique.push(vValues[i]); else siblings[i] = k
                    }
                }
            }
            if (!vIsManifold && !vertexMismatch[v]) vertexMismatch[v] = unique.length > 1 ? 1 : 0
            this.vertSiblingCounts[v] = vFaces.length ? unique.length : 1
            this.vertSiblingOffsets[v] = totalValueCount
            totalValueCount += this.vertSiblingCounts[v]
            if (unique.length > 1) this.getVertexFaceSiblings(v).set(siblings.slice(0, vFaces.length))
        }

        this.resizeVertexValues(totalValueCount)
        const spans: ValueSpan[] = []
        for (let v = 0; v < L.numVertices; v++) {
            const vFaces = L.getVertexFaces(v), vInFace = L.getVertexFaceLocalIndices(v)
            const vValues = this.getVertexValues(v)
            vValues[0] = vFaces.length > 0 ? this.faceVertValues[L.faceVerts.offsets[vFaces[0]] + vInFace[0]] : 0
            if (!vertexMismatch[v]) continue
            if (vValues.length > 1) {
                const sib = this.getVertexFaceSiblings(v)
                for (let i = 1, next = 1; i < vFaces.length; i++) {
                    if (sib[i] === next) vValues[next++] = this.faceVertValues[L.faceVerts.offsets[vFaces[i]] + vInFace[i]]
                }
            }
            const vTag = L.vertTags[v]
            const off = this.vertSiblingOffsets[v]
            let allCornersAreSharp = this.hasLinearBoundaries || (vTag & VTag.InfSharp) !== 0 || (vTag & VTag.NonManifold) !== 0
                || (this.hasDependentSharpness && vValues.length > 2) || (sharpenDarts && vValues.length === 1 && !(vTag & VTag.Boundary))
            spans.length = 0
            for (let i = 0; i < vValues.length; i++) spans.push({size: 0, start: 0, disctsEdgeCount: 0, semiSharpEdgeCount: 0, infSharpEdgeCount: 0})
            this.gatherValueSpans(v, spans)
            let hasDependentValuesToSharpen = false
            if (!allCornersAreSharp && this.hasDependentSharpness && vValues.length === 2) {
                allCornersAreSharp = spans[0].infSharpEdgeCount > 0 || spans[1].infSharpEdgeCount > 0
                    || spans[0].disctsEdgeCount > 0 || spans[1].disctsEdgeCount > 0
                if (sharpenBothIfOneCorner) allCornersAreSharp ||= spans[0].size === 1 || spans[1].size === 1
                hasDependentValuesToSharpen = (spans[0].semiSharpEdgeCount > 0) !== (spans[1].semiSharpEdgeCount > 0)
            }
            for (let i = 0; i < vValues.length; i++) {
                let tag = FVTag.Mismatch
                const span = spans[i]
                if (span.disctsEdgeCount) { this.vertValueTags[off + i] = tag | FVTag.NonManifold; continue }
                const isInfSharp = allCornersAreSharp || span.infSharpEdgeCount > 0 || (span.size === 1 && fvarCornersAreSharp)
                const xordinary = span.size === 1 ? !isInfSharp : span.size !== regularBoundaryValence
                if (xordinary) tag |= FVTag.Xordinary
                if (span.infSharpEdgeCount > 0) tag |= FVTag.InfSharpEdges
                const infIrregular = span.infSharpEdgeCount ? (span.size - span.infSharpEdgeCount) > 1 : (isInfSharp ? span.size > 1 : xordinary)
                if (infIrregular) tag |= FVTag.InfIrregular
                if (!isInfSharp) {
                    if (span.semiSharpEdgeCount || (vTag & VTag.SemiSharp)) tag |= FVTag.SemiSharp
                    else if (hasDependentValuesToSharpen) tag |= FVTag.SemiSharp | FVTag.DepSharp
                    else tag |= FVTag.Crease
                    if (this.hasCreaseEnds) {
                        this.creaseStart[off + i] = span.start
                        this.creaseEnd[off + i] = i === 0 && span.start !== 0
                            ? span.start + span.size - 1 - vFaces.length
                            : span.start + span.size - 1
                    }
                }
                this.vertValueTags[off + i] = tag
            }
        }
    }

    /** `FVarLevel::gatherValueSpans` (`fvarLevel.cpp:898`). */
    gatherValueSpans(v: number, spans: ValueSpan[]): void {
        const L = this.level
        const vEdges = L.getVertexEdges(v), vFaces = L.getVertexFaces(v), sib = this.getVertexFaceSiblings(v)
        const single = this.getNumVertexValues(v) === 1
        const boundary = vEdges.length > vFaces.length
        if (L.vertTags[v] & VTag.NonManifold) {
            for (const s of spans) { s.size = 0; s.disctsEdgeCount = 1 }
        } else if (single && !boundary) {
            spans[0].size = 0
            spans[0].start = 0
            for (let i = 0; i < vEdges.length; i++) {
                const e = vEdges[i]
                if (this.edgeTags[e] & FETag.Mismatch) {
                    if (spans[0].size > 0) { spans[0].disctsEdgeCount = 1; break }
                    spans[0].size = vFaces.length
                    spans[0].start = i
                } else if (L.edgeTags[e] & LevelETag.InfSharp) spans[0].infSharpEdgeCount++
                else if (L.edgeTags[e] & LevelETag.SemiSharp) spans[0].semiSharpEdgeCount++
            }
            spans[0].size = vFaces.length
        } else {
            spans[0].size = 1
            spans[0].start = 0
            const count = (s: ValueSpan, e: number) => {
                if (this.edgeTags[e] & FETag.Mismatch) s.disctsEdgeCount++
                else if (L.edgeTags[e] & LevelETag.InfSharp) s.infSharpEdgeCount++
                else if (L.edgeTags[e] & LevelETag.SemiSharp) s.semiSharpEdgeCount++
            }
            if (!boundary && sib[vFaces.length - 1] === 0) count(spans[0], vEdges[0])
            for (let i = 1; i < vFaces.length; i++) {
                const s = spans[sib[i]]
                if (sib[i] === sib[i - 1]) count(s, vEdges[i])
                else {
                    if (s.size > 0) s.disctsEdgeCount++
                    s.start = i
                }
                s.size++
            }
            if (sib[vFaces.length - 1] === 0 && !boundary) spans[0].disctsEdgeCount--
        }
    }

    /** `FVarLevel::getVertexCreaseEndValues` (`fvarLevel.cpp:552`). */
    getVertexCreaseEndValues(v: number, sibling: number): [number, number] {
        const L = this.level
        const vFaces = L.getVertexFaces(v), vInFace = L.getVertexFaceLocalIndices(v)
        const off = this.vertSiblingOffsets[v] + sibling
        const f0 = this.creaseStart[off], f1 = this.creaseEnd[off]
        const fv0 = this.getFaceValues(vFaces[f0]), fv1 = this.getFaceValues(vFaces[f1])
        let e0 = vInFace[f0], e1 = vInFace[f1]
        e0 = e0 === fv0.length - 1 ? 0 : e0 + 1
        e1 = (e1 ? e1 : fv1.length) - 1
        return [fv0[e0], fv1[e1]]
    }

    /** `FVarLevel::getEdgeFaceValues` (`fvarLevel.cpp:812`). */
    getEdgeFaceValues(e: number, fIncToEdge: number): [number, number] {
        const L = this.level
        const ev0 = L.edgeVerts[2 * e], ev1 = L.edgeVerts[2 * e + 1]
        if (this.getNumVertexValues(ev0) + this.getNumVertexValues(ev1) > 2) {
            const f = L.getEdgeFaces(e)[fIncToEdge], eInFace = L.getEdgeFaceLocalIndices(e)[fIncToEdge]
            const fValues = this.getFaceValues(f)
            let a = fValues[eInFace], b = fValues[eInFace + 1 < fValues.length ? eInFace + 1 : 0]
            if (ev0 !== L.getFaceVertices(f)[eInFace]) [a, b] = [b, a]
            return [a, b]
        }
        return L.depth > 0 ? [this.getVertexValueOffset(ev0), this.getVertexValueOffset(ev1)] : [this.getVertexValue(ev0), this.getVertexValue(ev1)]
    }

    /** `FVarLevel::getVertexEdgeValues` (`fvarLevel.cpp:841`). */
    getVertexEdgeValues(v: number, out: number[]): void {
        const L = this.level
        const vEdges = L.getVertexEdges(v), vInEdge = L.getVertexEdgeLocalIndices(v)
        const vFaces = L.getVertexFaces(v), vInFace = L.getVertexFaceLocalIndices(v)
        const boundary = (L.vertTags[v] & VTag.Boundary) !== 0, manifold = !(L.vertTags[v] & VTag.NonManifold)
        const base = L.depth === 0
        for (let i = 0; i < vEdges.length; i++) {
            const e = vEdges[i]
            const other = L.edgeVerts[2 * e + (vInEdge[i] ? 0 : 1)]
            if (this.getNumVertexValues(other) === 1) {
                out[i] = base ? this.getVertexValue(other) : this.getVertexValueOffset(other)
            } else if (manifold) {
                if (boundary && i === vEdges.length - 1) {
                    const fValues = this.getFaceValues(vFaces[i - 1])
                    const prev = vInFace[i - 1] ? vInFace[i - 1] - 1 : fValues.length - 1
                    out[i] = fValues[prev]
                } else {
                    const fValues = this.getFaceValues(vFaces[i])
                    const next = vInFace[i] === fValues.length - 1 ? 0 : vInFace[i] + 1
                    out[i] = fValues[next]
                }
            } else {
                const f0 = L.getEdgeFaces(e)[0], eIn0 = L.getEdgeFaceLocalIndices(e)[0]
                const fVerts = L.getFaceVertices(f0), fValues = this.getFaceValues(f0)
                out[i] = other === fVerts[eIn0] ? fValues[eIn0] : fValues[eIn0 === fValues.length - 1 ? 0 : eIn0 + 1]
            }
        }
    }

    /** `FVarLevel::initializeFaceValuesFromFaceVertices` / `FromVertexFaceSiblings` (`fvarLevel.cpp:770-800`). */
    initializeFaceValues(): void {
        const L = this.level
        if (this.valueCount > L.numVertices) {
            const fv = L.faceVerts.indices
            for (let i = 0; i < fv.length; i++) this.faceVertValues[i] = this.getVertexValueOffset(fv[i])
            for (let v = 0; v < L.numVertices; v++) {
                if (this.getNumVertexValues(v) <= 1) continue
                const vFaces = L.getVertexFaces(v), vInFace = L.getVertexFaceLocalIndices(v), sib = this.getVertexFaceSiblings(v)
                for (let j = 0; j < vFaces.length; j++) if (sib[j]) this.faceVertValues[L.faceVerts.offsets[vFaces[j]] + vInFace[j]] += sib[j]
            }
        } else {
            this.faceVertValues.set(L.faceVerts.indices)
        }
    }
}

/** `Vtr::internal::FVarRefinement` (`fvarRefinement.cpp`). */
export class FVarRefinement {
    readonly refinement: QuadRefinement
    readonly parentFVar: FVarLevel
    readonly childFVar: FVarLevel
    /** For each child value, which parent sibling (or edge face) it came from. */
    childValueParentSource: Int32Array = new Int32Array(0)

    constructor(refinement: QuadRefinement, parentFVar: FVarLevel) {
        this.refinement = refinement
        this.parentFVar = parentFVar
        this.childFVar = new FVarLevel(refinement.child, parentFVar.options)
    }

    getChildValueParentSource(cVert: number, sibling: number): number {
        return this.childValueParentSource[this.childFVar.getVertexValueOffset(cVert) + sibling]
    }

    /** `FVarRefinement::applyRefinement` (`fvarRefinement.cpp:47`). */
    apply(): FVarLevel {
        const r = this.refinement, P = r.parent, C = r.child, pF = this.parentFVar, cF = this.childFVar
        cF.isLinear = pF.isLinear
        cF.hasLinearBoundaries = pF.hasLinearBoundaries
        cF.hasDependentSharpness = pF.hasDependentSharpness

        // populateChildValues (fvarRefinement.cpp:241): vertex-vertices first, then face, then edge vertices,
        // the refinement's order, over the child vertices that exist (sparse refinement leaves gaps in the parents)
        const source: number[] = []
        cF.valueCount = 0
        for (let cv = r.firstChildVertFromVert; cv < r.firstChildVertFromVert + r.childVertFromVertCount; cv++) {
            const pv = r.childVertParent[cv]
            cF.vertSiblingOffsets[cv] = cF.valueCount
            if (pF.valueTopologyMatches(pF.getVertexValueOffset(pv))) {
                cF.vertSiblingCounts[cv] = 1
                source[cF.valueCount] = 0
                cF.valueCount++
            } else {
                // populateChildValuesForVertexVertex (:206): complete in feature-adaptive refinement
                const n = pF.getNumVertexValues(pv)
                for (let j = 0; j < n; j++) source[cF.valueCount + j] = j
                if (n > 1) cF.getVertexFaceSiblings(cv).set(pF.getVertexFaceSiblings(pv))
                cF.vertSiblingCounts[cv] = n
                cF.valueCount += n
            }
        }
        for (let cv = r.firstChildVertFromFace; cv < r.firstChildVertFromFace + r.childVertFromFaceCount; cv++) {
            cF.vertSiblingOffsets[cv] = cF.valueCount
            cF.vertSiblingCounts[cv] = 1
            source[cF.valueCount] = 0
            cF.valueCount++
        }
        for (let cv = r.firstChildVertFromEdge; cv < r.firstChildVertFromEdge + r.childVertFromEdgeCount; cv++) {
            const pe = r.childVertParent[cv]
            cF.vertSiblingOffsets[cv] = cF.valueCount
            if (pF.edgeTopologyMatches(pe)) {
                cF.vertSiblingCounts[cv] = 1
                source[cF.valueCount] = 0
                cF.valueCount++
            } else {
                // populateChildValuesForEdgeVertex (fvarRefinement.cpp:150): one value per incident face
                const pEdgeFaces = P.getEdgeFaces(pe)
                const n = pEdgeFaces.length
                for (let i = 0; i < n; i++) source[cF.valueCount + i] = n === 1 ? 0 : i
                if (n > 1) {
                    const cVertFaces = C.getVertexFaces(cv), sib = cF.getVertexFaceSiblings(cv)
                    for (let i = 0; i < cVertFaces.length; i++) {
                        const pFace = r.childFaceParent[cVertFaces[i]]
                        if (n === 2) { if (pFace === pEdgeFaces[1]) sib[i] = 1 }
                        else for (let j = 0; j < n; j++) if (pFace === pEdgeFaces[j]) sib[i] = j
                    }
                }
                cF.vertSiblingCounts[cv] = n
                cF.valueCount += n
            }
        }

        // trimAndFinalizeChildValues
        cF.vertValueTags = new Uint8Array(cF.valueCount)
        if (cF.hasSmoothBoundaries) { cF.creaseStart = new Int32Array(cF.valueCount); cF.creaseEnd = new Int32Array(cF.valueCount) }
        this.childValueParentSource = Int32Array.from(source)
        cF.vertValueIndices = Int32Array.from({length: cF.valueCount}, (_, i) => i)

        // propagateEdgeTags
        for (let ce = r.firstChildEdgeFromEdge; ce < C.numEdges; ce++) cF.edgeTags[ce] = pF.edgeTags[r.childEdgeParent[ce]]

        // propagateValueTags (:353): face values match (zero), edge values by the parent edge, vertex values inherited
        const splitTag = pF.hasSmoothBoundaries ? FVTag.Mismatch | FVTag.Crease : FVTag.Mismatch
        for (let cv = r.firstChildVertFromEdge; cv < r.firstChildVertFromEdge + r.childVertFromEdgeCount; cv++) {
            const t = pF.edgeTags[r.childVertParent[cv]]
            const o = cF.vertSiblingOffsets[cv], n = cF.vertSiblingCounts[cv]
            cF.vertValueTags.fill((t & FETag.Mismatch) || (t & FETag.Linear) ? splitTag : 0, o, o + n)
        }
        for (let cv = r.firstChildVertFromVert; cv < r.firstChildVertFromVert + r.childVertFromVertCount; cv++) {
            const pv = r.childVertParent[cv]
            const po = pF.vertSiblingOffsets[pv], co = cF.vertSiblingOffsets[cv], n = pF.getNumVertexValues(pv)
            for (let j = 0; j < n; j++) cF.vertValueTags[co + j] = pF.vertValueTags[po + j]
        }

        if (cF.hasSmoothBoundaries) {
            this.propagateValueCreases()
            this.reclassifySemisharpValues()
        }
        cF.initializeFaceValues()
        return cF
    }

    /** `FVarRefinement::propagateValueCreases` (`fvarRefinement.cpp:427`). */
    private propagateValueCreases(): void {
        const r = this.refinement, pF = this.parentFVar, cF = this.childFVar
        const incChildFacesPerEdge = 2
        for (let cv = r.firstChildVertFromEdge; cv < r.firstChildVertFromEdge + r.childVertFromEdgeCount; cv++) {
            const o = cF.vertSiblingOffsets[cv], n = cF.vertSiblingCounts[cv]
            if (!(cF.vertValueTags[o] & FVTag.Mismatch)) continue
            if (!r.isChildVertexComplete(cv)) continue
            let start = 0, end = incChildFacesPerEdge - 1
            for (let i = 0; i < n; i++) {
                if (!valueIsInfSharp(cF.vertValueTags[o + i])) { cF.creaseStart[o + i] = start; cF.creaseEnd[o + i] = end }
                start += incChildFacesPerEdge
                end += incChildFacesPerEdge
            }
        }
        for (let cv = r.firstChildVertFromVert; cv < r.firstChildVertFromVert + r.childVertFromVertCount; cv++) {
            const pv = r.childVertParent[cv]
            const o = cF.vertSiblingOffsets[cv], n = cF.vertSiblingCounts[cv], po = pF.vertSiblingOffsets[pv]
            if (!(cF.vertValueTags[o] & FVTag.Mismatch)) continue
            if (!r.isChildVertexComplete(cv)) continue
            for (let j = 0; j < n; j++) {
                if (!valueIsInfSharp(cF.vertValueTags[o + j])) { cF.creaseStart[o + j] = pF.creaseStart[po + j]; cF.creaseEnd[o + j] = pF.creaseEnd[po + j] }
            }
        }
    }

    /** `FVarRefinement::reclassifySemisharpValues` (`fvarRefinement.cpp:478`). */
    private reclassifySemisharpValues(): void {
        const r = this.refinement, P = r.parent, C = r.child, cF = this.childFVar
        for (let cv = r.firstChildVertFromVert; cv < r.firstChildVertFromVert + r.childVertFromVertCount; cv++) {
            const pv = r.childVertParent[cv]
            const o = cF.vertSiblingOffsets[cv], n = cF.vertSiblingCounts[cv]
            if (!(cF.vertValueTags[o] & FVTag.Mismatch)) continue
            if (!r.isChildVertexComplete(cv)) continue
            const pTag = P.vertTags[pv]
            if (!(pTag & VTag.SemiSharp) && !(pTag & VTag.SemiSharpEdges)) continue
            const cTag = C.vertTags[cv]
            if ((cTag & VTag.SemiSharp) || (cTag & VTag.InfSharp)) continue
            const toCrease = (k: number) => { cF.vertValueTags[k] = (cF.vertValueTags[k] & ~(FVTag.SemiSharp | FVTag.DepSharp)) | FVTag.Crease }
            if (!(cTag & VTag.SemiSharp) && !(cTag & VTag.SemiSharpEdges)) {
                for (let j = 0; j < n; j++) if (cF.vertValueTags[o + j] & FVTag.SemiSharp) toCrease(o + j)
                continue
            }
            const cVertEdges = C.getVertexEdges(cv)
            for (let j = 0; j < n; j++) {
                const t = cF.vertValueTags[o + j]
                if ((t & FVTag.SemiSharp) && !(t & FVTag.DepSharp)) {
                    const s = cF.creaseStart[o + j], e = cF.creaseEnd[o + j]
                    let still = false
                    if (e > s) {
                        for (let k = s + 1; !still && k <= e; k++) still = (C.edgeTags[cVertEdges[k]] & LevelETag.SemiSharp) !== 0
                    } else if (s > e) {
                        for (let k = s + 1; !still && k < cVertEdges.length; k++) still = (C.edgeTags[cVertEdges[k]] & LevelETag.SemiSharp) !== 0
                        for (let k = 0; !still && k <= e; k++) still = (C.edgeTags[cVertEdges[k]] & LevelETag.SemiSharp) !== 0
                    }
                    if (!still) toCrease(o + j)
                }
            }
            if (n === 2 && cF.hasDependentSharpness) {
                if ((cF.vertValueTags[o] & FVTag.DepSharp) && !(cF.vertValueTags[o + 1] & FVTag.SemiSharp)) cF.vertValueTags[o] &= ~FVTag.DepSharp
                else if ((cF.vertValueTags[o + 1] & FVTag.DepSharp) && !(cF.vertValueTags[o] & FVTag.SemiSharp)) cF.vertValueTags[o + 1] &= ~FVTag.DepSharp
            }
        }
    }

    /** `FVarRefinement::getFractionalWeight` (`fvarRefinement.cpp:585`). */
    getFractionalWeight(pVert: number, pSibling: number, cVert: number): number {
        const r = this.refinement, P = r.parent, C = r.child, pF = this.parentFVar
        const pVertEdges = P.getVertexEdges(pVert), cVertEdges = C.getVertexEdges(cVert)
        const po = pF.vertSiblingOffsets[pVert] + pSibling
        const s = pF.creaseStart[po], e = pF.creaseEnd[po]
        const ps: number[] = [], cs: number[] = []
        if (e > s) {
            for (let i = s + 1; i <= e; i++) { ps.push(P.edgeSharpness[pVertEdges[i]]); cs.push(C.edgeSharpness[cVertEdges[i]]) }
        } else if (s > e) {
            for (let i = s + 1; i < pVertEdges.length; i++) { ps.push(P.edgeSharpness[pVertEdges[i]]); cs.push(C.edgeSharpness[cVertEdges[i]]) }
            for (let i = 0; i <= e; i++) { ps.push(P.edgeSharpness[pVertEdges[i]]); cs.push(C.edgeSharpness[cVertEdges[i]]) }
        }
        return computeFractionalWeightAtVertex(r.options, P.vertSharpness[pVert], C.vertSharpness[cVert], ps.length, ps, cs)
    }
}

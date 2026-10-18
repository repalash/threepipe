/**
 * Port of OpenSubdiv v3_7_0 `opensubdiv/sdc/` (`types.h`, `typeTraits.cpp`, `options.h`, `crease.h`, `crease.cpp`,
 * `scheme.h`, `catmarkScheme.h`, `bilinearScheme.h`), Copyright 2014 DreamWorks Animation LLC.
 * Licensed under the Tomorrow Open Source Technology License 1.0 - see `porting/opensubdiv-LICENSE.txt`.
 *
 * Float exactness: `Weight` is `float` (the masks are instantiated by `Far::PrimvarRefinerReal<float>` inside the
 * OpenSubdiv library, which Blender's dependency build compiles with clang's default `-ffp-contract=on`), so
 * `a * b + c` within one expression is a fused multiply-add (`fmaf`, clang's `tryEmitFMulAdd`: the left operand's
 * product is fused first; `a - b * c` fuses as `fma(-b, c, a)`).
 */

import {f32} from '../f32'
import {fmaf} from '../fma'

// region types.h / typeTraits.cpp

export const enum SchemeType {
    BILINEAR = 0,
    CATMARK = 1,
    LOOP = 2,
}

export const enum Split {
    TO_QUADS = 0,
    TO_TRIS = 1,
    HYBRID = 2,
}

/** `SchemeTypeTraits` (`typeTraits.cpp:35`). */
export const SchemeTypeTraits = {
    getTopologicalSplitType: (t: SchemeType): Split => (t === SchemeType.LOOP ? Split.TO_TRIS : Split.TO_QUADS),
    getRegularFaceSize: (t: SchemeType) => (t === SchemeType.LOOP ? 3 : 4),
    getRegularVertexValence: (t: SchemeType) => (t === SchemeType.LOOP ? 6 : 4),
    getLocalNeighborhoodSize: (t: SchemeType) => (t === SchemeType.BILINEAR ? 0 : 1),
    getName: (t: SchemeType) => ['bilinear', 'catmark', 'loop'][t],
}
// endregion

// region options.h

export const enum VtxBoundaryInterpolation {
    NONE = 0,
    EDGE_ONLY = 1,
    EDGE_AND_CORNER = 2,
}

export const enum FVarLinearInterpolation {
    NONE = 0,
    CORNERS_ONLY = 1,
    CORNERS_PLUS1 = 2,
    CORNERS_PLUS2 = 3,
    BOUNDARIES = 4,
    ALL = 5,
}

export const enum CreasingMethod {
    UNIFORM = 0,
    CHAIKIN = 1,
}

export const enum TriangleSubdivision {
    CATMARK = 0,
    SMOOTH = 1,
}

/** `Sdc::Options` (`options.h:39`). */
export class Options {
    vtxBoundaryInterpolation = VtxBoundaryInterpolation.NONE
    fvarLinearInterpolation = FVarLinearInterpolation.ALL
    creasingMethod = CreasingMethod.UNIFORM
    triangleSubdivision = TriangleSubdivision.CATMARK

    clone(): Options {
        const o = new Options()
        o.vtxBoundaryInterpolation = this.vtxBoundaryInterpolation
        o.fvarLinearInterpolation = this.fvarLinearInterpolation
        o.creasingMethod = this.creasingMethod
        o.triangleSubdivision = this.triangleSubdivision
        return o
    }
}
// endregion

// region crease.h / crease.cpp

export const SHARPNESS_SMOOTH = 0
export const SHARPNESS_INFINITE = 10

export const enum Rule {
    UNKNOWN = 0,
    SMOOTH = 1 << 0,
    DART = 1 << 1,
    CREASE = 1 << 2,
    CORNER = 1 << 3,
}

export const isSmooth = (s: number) => s <= SHARPNESS_SMOOTH
export const isSharp = (s: number) => s > SHARPNESS_SMOOTH
export const isInfinite = (s: number) => s >= SHARPNESS_INFINITE
export const isSemiSharp = (s: number) => SHARPNESS_SMOOTH < s && s < SHARPNESS_INFINITE

/** `Sdc::Crease` (`crease.h:61`). */
export class Crease {
    constructor(readonly options: Options = new Options()) {}

    isUniform(): boolean {
        return this.options.creasingMethod === CreasingMethod.UNIFORM
    }

    /** `SharpenBoundaryEdge` (:175): boundary edges are always sharpened. */
    sharpenBoundaryEdge(_edgeSharpness: number): number {
        return SHARPNESS_INFINITE
    }

    /** `SharpenBoundaryVertex` (:186). */
    sharpenBoundaryVertex(vertexSharpness: number): number {
        return this.options.vtxBoundaryInterpolation === VtxBoundaryInterpolation.EDGE_AND_CORNER ? SHARPNESS_INFINITE : vertexSharpness
    }

    /** `decrementSharpness` (:196). */
    decrementSharpness(sharpness: number): number {
        if (isSmooth(sharpness)) return SHARPNESS_SMOOTH
        if (isInfinite(sharpness)) return SHARPNESS_INFINITE
        if (sharpness > 1) return f32(sharpness - 1)
        return SHARPNESS_SMOOTH
    }

    subdivideUniformSharpness(s: number): number {
        return this.decrementSharpness(s)
    }

    subdivideVertexSharpness(s: number): number {
        return this.decrementSharpness(s)
    }

    /** `GetSharpEdgePairOfCrease` (:213). */
    getSharpEdgePairOfCrease(incidentEdgeSharpness: ArrayLike<number>, incidentEdgeCount: number): [number, number] {
        let a = 0
        while (isSmooth(incidentEdgeSharpness[a])) ++a
        let b = incidentEdgeCount - 1
        while (isSmooth(incidentEdgeSharpness[b])) --b
        return [a, b]
    }

    /** `DetermineVertexVertexRule(vertexSharpness, sharpEdgeCount)` (`crease.cpp:42`). */
    determineVertexVertexRuleFromCount(vertexSharpness: number, sharpEdgeCount: number): Rule {
        if (isSharp(vertexSharpness)) return Rule.CORNER
        return sharpEdgeCount > 2 ? Rule.CORNER : (1 << sharpEdgeCount) as Rule
    }

    /** `DetermineVertexVertexRule(vertexSharpness, incidentEdgeCount, incidentEdgeSharpness)` (`crease.cpp:50`). */
    determineVertexVertexRule(vertexSharpness: number, incidentEdgeCount: number, incidentEdgeSharpness: ArrayLike<number>): Rule {
        if (isSharp(vertexSharpness)) return Rule.CORNER
        let sharpEdgeCount = 0
        for (let i = 0; i < incidentEdgeCount; ++i) sharpEdgeCount += isSharp(incidentEdgeSharpness[i]) ? 1 : 0
        return sharpEdgeCount > 2 ? Rule.CORNER : (1 << sharpEdgeCount) as Rule
    }

    /** `ComputeFractionalWeightAtVertex` (`crease.cpp:68`). */
    computeFractionalWeightAtVertex(parentVertexSharpness: number, childVertexSharpness: number, incidentEdgeCount: number,
        parentSharpness: ArrayLike<number>, childSharpness: ArrayLike<number> | undefined): number {
        let transitionCount = 0
        let transitionSum = 0
        if (isSharp(parentVertexSharpness) && isSmooth(childVertexSharpness)) {
            transitionCount = 1
            transitionSum = parentVertexSharpness
        }
        if (this.isUniform() || !childSharpness) {
            for (let i = 0; i < incidentEdgeCount; ++i) {
                if (isSharp(parentSharpness[i]) && parentSharpness[i] <= 1) {
                    transitionSum = f32(transitionSum + parentSharpness[i])
                    transitionCount++
                }
            }
        } else {
            for (let i = 0; i < incidentEdgeCount; ++i) {
                if (isSharp(parentSharpness[i]) && isSmooth(childSharpness[i])) {
                    transitionSum = f32(transitionSum + parentSharpness[i])
                    transitionCount++
                }
            }
        }
        if (transitionCount === 0) return 0
        const fractionalWeight = f32(transitionSum / transitionCount)
        return fractionalWeight > 1 ? 1 : fractionalWeight
    }

    /** `SubdivideEdgeSharpnessAtVertex` (`crease.cpp:111`). */
    subdivideEdgeSharpnessAtVertex(edgeSharpness: number, incEdgeCountAtVertex: number, incEdgeSharpness: ArrayLike<number>): number {
        if (this.isUniform() || incEdgeCountAtVertex < 2) return this.decrementSharpness(edgeSharpness)
        if (isSmooth(edgeSharpness)) return SHARPNESS_SMOOTH
        if (isInfinite(edgeSharpness)) return SHARPNESS_INFINITE
        let sharpSum = 0
        let sharpCount = 0
        for (let i = 0; i < incEdgeCountAtVertex; ++i) {
            if (isSemiSharp(incEdgeSharpness[i])) {
                sharpCount++
                sharpSum = f32(sharpSum + incEdgeSharpness[i])
            }
        }
        if (sharpCount > 1) {
            const avgSharpnessAtVertex = f32(f32(sharpSum - edgeSharpness) / (sharpCount - 1))
            // `(0.75f * edgeSharpness) + (0.25f * avg)`: the left product is fused.
            edgeSharpness = fmaf(0.75, edgeSharpness, f32(0.25 * avgSharpnessAtVertex))
        }
        edgeSharpness = f32(edgeSharpness - 1)
        return isSharp(edgeSharpness) ? edgeSharpness : SHARPNESS_SMOOTH
    }

    /** `SubdivideEdgeSharpnessesAroundVertex` (`crease.cpp:145`). */
    subdivideEdgeSharpnessesAroundVertex(edgeCount: number, parentSharpness: ArrayLike<number>, childSharpness: number[]): void {
        if (this.isUniform() || edgeCount < 2) {
            for (let i = 0; i < edgeCount; ++i) childSharpness[i] = this.decrementSharpness(parentSharpness[i])
            return
        }
        if (this.options.creasingMethod === CreasingMethod.CHAIKIN) {
            let sharpSum = 0
            let sharpCount = 0
            for (let i = 0; i < edgeCount; ++i) {
                if (isSemiSharp(parentSharpness[i])) {
                    sharpCount++
                    sharpSum = f32(sharpSum + parentSharpness[i])
                }
            }
            if (sharpCount === 0) {
                for (let i = 0; i < edgeCount; ++i) childSharpness[i] = parentSharpness[i]
            } else {
                for (let i = 0; i < edgeCount; ++i) {
                    const pSharp = parentSharpness[i]
                    if (isSmooth(pSharp)) {
                        childSharpness[i] = SHARPNESS_SMOOTH
                    } else if (isInfinite(pSharp)) {
                        childSharpness[i] = SHARPNESS_INFINITE
                    } else if (sharpCount === 1) {
                        childSharpness[i] = this.decrementSharpness(pSharp)
                    } else {
                        const pOtherAverage = f32(f32(sharpSum - pSharp) / (sharpCount - 1))
                        let c = f32(fmaf(0.75, pSharp, f32(0.25 * pOtherAverage)) - 1)
                        if (isSmooth(c)) c = SHARPNESS_SMOOTH
                        childSharpness[i] = c
                    }
                }
            }
        }
    }
}
// endregion

// region scheme.h

/** The writable mask a scheme fills (`MASK` in `scheme.h`). */
export interface Mask {
    setNumVertexWeights(n: number): void
    setNumEdgeWeights(n: number): void
    setNumFaceWeights(n: number): void
    getNumVertexWeights(): number
    getNumEdgeWeights(): number
    getNumFaceWeights(): number
    setFaceWeightsForFaceCenters(on: boolean): void
    areFaceWeightsForFaceCenters(): boolean
    vertexWeight(i: number): number
    edgeWeight(i: number): number
    faceWeight(i: number): number
    setVertexWeight(i: number, w: number): void
    setEdgeWeight(i: number, w: number): void
    setFaceWeight(i: number, w: number): void
}

/** The face neighbourhood of a face-vertex mask (`FACE`). */
export interface FaceNeighborhood {
    getNumVertices(): number
}

/** The edge neighbourhood of an edge-vertex mask (`EDGE`). */
export interface EdgeNeighborhood {
    getNumFaces(): number
    getSharpness(): number
    getNumVerticesPerFace(out: number[]): void
    getChildSharpnesses(crease: Crease, out: number[]): void
}

/** The vertex neighbourhood of a vertex-vertex mask (`VERTEX`). */
export interface VertexNeighborhood {
    getNumEdges(): number
    getNumFaces(): number
    getSharpness(): number
    getSharpnessPerEdge(out: number[]): number[]
    getChildSharpness(crease: Crease): number
    getChildSharpnessPerEdge(crease: Crease, out: number[]): number[]
}

/** `Scheme<SCHEME>::LocalMask` (`scheme.h:186`). */
export class LocalMask implements Mask {
    vCount = 0
    eCount = 0
    fCount = 0
    fWeightsForCenters = false
    readonly v: number[]
    readonly e: number[]
    readonly f: number[]

    constructor(valence: number) {
        this.v = [0]
        this.e = new Array(valence).fill(0)
        this.f = new Array(valence).fill(0)
    }

    setNumVertexWeights(n: number) { this.vCount = n }
    setNumEdgeWeights(n: number) { this.eCount = n }
    setNumFaceWeights(n: number) { this.fCount = n }
    getNumVertexWeights() { return this.vCount }
    getNumEdgeWeights() { return this.eCount }
    getNumFaceWeights() { return this.fCount }
    setFaceWeightsForFaceCenters(on: boolean) { this.fWeightsForCenters = on }
    areFaceWeightsForFaceCenters() { return this.fWeightsForCenters }
    vertexWeight(i: number) { return this.v[i] }
    edgeWeight(i: number) { return this.e[i] }
    faceWeight(i: number) { return this.f[i] }
    setVertexWeight(i: number, w: number) { this.v[i] = w }
    setEdgeWeight(i: number, w: number) { this.e[i] = w }
    setFaceWeight(i: number, w: number) { this.f[i] = w }

    /** `CombineVertexVertexMasks` (:221): `dst = dstCoeff * dst + thisCoeff * this` (the left product fused). */
    combineVertexVertexMasks(thisCoeff: number, dstCoeff: number, dst: Mask): void {
        dst.setVertexWeight(0, fmaf(dstCoeff, dst.vertexWeight(0), f32(thisCoeff * this.vertexWeight(0))))
        const edgeWeightCount = this.getNumEdgeWeights()
        if (edgeWeightCount) {
            if (dst.getNumEdgeWeights() === 0) {
                dst.setNumEdgeWeights(edgeWeightCount)
                for (let i = 0; i < edgeWeightCount; ++i) dst.setEdgeWeight(i, f32(thisCoeff * this.edgeWeight(i)))
            } else {
                for (let i = 0; i < edgeWeightCount; ++i) dst.setEdgeWeight(i, fmaf(dstCoeff, dst.edgeWeight(i), f32(thisCoeff * this.edgeWeight(i))))
            }
        }
        const faceWeightCount = this.getNumFaceWeights()
        if (faceWeightCount) {
            if (dst.getNumFaceWeights() === 0) {
                dst.setNumFaceWeights(faceWeightCount)
                dst.setFaceWeightsForFaceCenters(this.areFaceWeightsForFaceCenters())
                for (let i = 0; i < faceWeightCount; ++i) dst.setFaceWeight(i, f32(thisCoeff * this.faceWeight(i)))
            } else {
                for (let i = 0; i < faceWeightCount; ++i) dst.setFaceWeight(i, fmaf(dstCoeff, dst.faceWeight(i), f32(thisCoeff * this.faceWeight(i))))
            }
        }
    }
}

/**
 * `Sdc::Scheme<SCHEME_TYPE>` (`scheme.h:56`) with the Catmark (`catmarkScheme.h`) and Bilinear (`bilinearScheme.h`)
 * specialisations of the refinement masks. Limit masks are not ported (Blender evaluates patches instead).
 */
export class Scheme {
    constructor(readonly type: SchemeType, readonly options: Options = new Options()) {
        if (type === SchemeType.LOOP) throw new Error('OpenSubdiv: the Loop scheme is not ported (Blender only uses Catmark)')
    }

    getTopologicalSplitType(): Split { return SchemeTypeTraits.getTopologicalSplitType(this.type) }
    getRegularFaceSize(): number { return SchemeTypeTraits.getRegularFaceSize(this.type) }
    getRegularVertexValence(): number { return SchemeTypeTraits.getRegularVertexValence(this.type) }
    getLocalNeighborhoodSize(): number { return SchemeTypeTraits.getLocalNeighborhoodSize(this.type) }

    /** `assignCreaseMaskForEdge` (`scheme.h:290`). */
    private assignCreaseMaskForEdge(mask: Mask): void {
        mask.setNumVertexWeights(2)
        mask.setNumEdgeWeights(0)
        mask.setNumFaceWeights(0)
        mask.setFaceWeightsForFaceCenters(false)
        mask.setVertexWeight(0, 0.5)
        mask.setVertexWeight(1, 0.5)
    }

    /** `assignCornerMaskForVertex` (`scheme.h:303`). */
    private assignCornerMaskForVertex(mask: Mask): void {
        mask.setNumVertexWeights(1)
        mask.setNumEdgeWeights(0)
        mask.setNumFaceWeights(0)
        mask.setFaceWeightsForFaceCenters(false)
        mask.setVertexWeight(0, 1)
    }

    /** `ComputeFaceVertexMask` (`scheme.h:319`). */
    computeFaceVertexMask(face: FaceNeighborhood, mask: Mask): void {
        const vertCount = face.getNumVertices()
        mask.setNumVertexWeights(vertCount)
        mask.setNumEdgeWeights(0)
        mask.setNumFaceWeights(0)
        mask.setFaceWeightsForFaceCenters(false)
        const vWeight = f32(1 / vertCount)
        for (let i = 0; i < vertCount; ++i) mask.setVertexWeight(i, vWeight)
    }

    /** Catmark `assignSmoothMaskForEdge` (`catmarkScheme.h:61`). */
    private assignSmoothMaskForEdge(edge: EdgeNeighborhood, mask: Mask): void {
        if (this.type === SchemeType.BILINEAR) throw new Error('OpenSubdiv: bilinear smooth edge mask does not exist')
        const faceCount = edge.getNumFaces()
        mask.setNumVertexWeights(2)
        mask.setNumEdgeWeights(0)
        mask.setNumFaceWeights(faceCount)
        mask.setFaceWeightsForFaceCenters(true)
        let face0IsTri = false
        let face1IsTri = false
        let useTriangleOption = this.options.triangleSubdivision === TriangleSubdivision.SMOOTH
        if (useTriangleOption) {
            if (faceCount === 2) {
                const vertsPerFace = [0, 0]
                edge.getNumVerticesPerFace(vertsPerFace)
                face0IsTri = vertsPerFace[0] === 3
                face1IsTri = vertsPerFace[1] === 3
                useTriangleOption = face0IsTri || face1IsTri
            } else {
                useTriangleOption = false
            }
        }
        if (!useTriangleOption) {
            mask.setVertexWeight(0, 0.25)
            mask.setVertexWeight(1, 0.25)
            if (faceCount === 2) {
                mask.setFaceWeight(0, 0.25)
                mask.setFaceWeight(1, 0.25)
            } else {
                const fWeight = f32(0.5 / faceCount)
                for (let i = 0; i < faceCount; ++i) mask.setFaceWeight(i, fWeight)
            }
        } else {
            const TRI = f32(0.47)
            const f0Weight = face0IsTri ? TRI : 0.25
            const f1Weight = face1IsTri ? TRI : 0.25
            const fWeight = f32(0.5 * f32(f0Weight + f1Weight))
            // `0.5f * (1.0f - 2.0f * fWeight)`: the inner `1 - 2 * f` is fused.
            const vWeight = f32(0.5 * fmaf(-2, fWeight, 1))
            mask.setVertexWeight(0, vWeight)
            mask.setVertexWeight(1, vWeight)
            mask.setFaceWeight(0, fWeight)
            mask.setFaceWeight(1, fWeight)
        }
    }

    /** Catmark `assignCreaseMaskForVertex` (`catmarkScheme.h:131`). */
    private assignCreaseMaskForVertex(vertex: VertexNeighborhood, mask: Mask, creaseEnds: [number, number]): void {
        const valence = vertex.getNumEdges()
        mask.setNumVertexWeights(1)
        mask.setNumEdgeWeights(valence)
        mask.setNumFaceWeights(0)
        mask.setFaceWeightsForFaceCenters(false)
        mask.setVertexWeight(0, 0.75)
        for (let i = 0; i < valence; ++i) mask.setEdgeWeight(i, 0)
        mask.setEdgeWeight(creaseEnds[0], 0.125)
        mask.setEdgeWeight(creaseEnds[1], 0.125)
    }

    /** Catmark `assignSmoothMaskForVertex` (`catmarkScheme.h:155`). */
    private assignSmoothMaskForVertex(vertex: VertexNeighborhood, mask: Mask): void {
        const valence = vertex.getNumFaces()
        mask.setNumVertexWeights(1)
        mask.setNumEdgeWeights(valence)
        mask.setNumFaceWeights(valence)
        mask.setFaceWeightsForFaceCenters(true)
        const vWeight = f32((valence - 2) / valence)
        const fWeight = f32(1 / f32(valence * valence))
        mask.setVertexWeight(0, vWeight)
        for (let i = 0; i < valence; ++i) {
            mask.setEdgeWeight(i, fWeight)
            mask.setFaceWeight(i, fWeight)
        }
    }

    /** `ComputeEdgeVertexMask` (`scheme.h:340`; Bilinear `bilinearScheme.h:58`). */
    computeEdgeVertexMask(edge: EdgeNeighborhood, mask: Mask, parentRule: Rule = Rule.UNKNOWN, childRule: Rule = Rule.UNKNOWN): void {
        if (this.type === SchemeType.BILINEAR) {
            this.assignCreaseMaskForEdge(mask)
            return
        }
        if (parentRule === Rule.SMOOTH || (parentRule === Rule.UNKNOWN && edge.getSharpness() <= 0)) {
            this.assignSmoothMaskForEdge(edge, mask)
            return
        }
        if (childRule === Rule.CREASE) {
            this.assignCreaseMaskForEdge(mask)
            return
        }
        if (childRule === Rule.UNKNOWN) {
            const crease = new Crease(this.options)
            let childIsCrease = false
            if (parentRule === Rule.CREASE) {
                childIsCrease = true
            } else if (edge.getSharpness() >= 1) {
                childIsCrease = true
            } else if (crease.isUniform()) {
                childIsCrease = false
            } else {
                const c = [0, 0]
                edge.getChildSharpnesses(crease, c)
                childIsCrease = c[0] > 0 && c[1] > 0
            }
            if (childIsCrease) {
                this.assignCreaseMaskForEdge(mask)
                return
            }
        }
        this.assignSmoothMaskForEdge(edge, mask)
        const pWeight = edge.getSharpness()
        const cWeight = f32(1 - pWeight)
        mask.setVertexWeight(0, fmaf(pWeight, 0.5, f32(cWeight * mask.vertexWeight(0))))
        mask.setVertexWeight(1, fmaf(pWeight, 0.5, f32(cWeight * mask.vertexWeight(1))))
        const faceCount = mask.getNumFaceWeights()
        for (let i = 0; i < faceCount; ++i) mask.setFaceWeight(i, f32(mask.faceWeight(i) * cWeight))
    }

    /** `ComputeVertexVertexMask` (`scheme.h:398`; Bilinear `bilinearScheme.h:66`). */
    computeVertexVertexMask(vertex: VertexNeighborhood, mask: Mask, pRule: Rule = Rule.UNKNOWN, cRule: Rule = Rule.UNKNOWN): void {
        if (this.type === SchemeType.BILINEAR) {
            this.assignCornerMaskForVertex(mask)
            return
        }
        if (pRule === Rule.SMOOTH || pRule === Rule.DART) {
            this.assignSmoothMaskForVertex(vertex, mask)
            return
        }
        if (cRule === Rule.UNKNOWN && pRule !== Rule.UNKNOWN) cRule = pRule
        const valence = vertex.getNumEdges()
        let pEdgeSharpness: number[] = []
        let pVertexSharpness = 0
        const requireParentSharpness = pRule === Rule.UNKNOWN || pRule === Rule.CREASE || pRule !== cRule
        if (requireParentSharpness) {
            pVertexSharpness = vertex.getSharpness()
            pEdgeSharpness = vertex.getSharpnessPerEdge(new Array(valence).fill(0))
            if (pRule === Rule.UNKNOWN) pRule = new Crease(this.options).determineVertexVertexRule(pVertexSharpness, valence, pEdgeSharpness)
        }
        if (pRule === Rule.SMOOTH || pRule === Rule.DART) {
            this.assignSmoothMaskForVertex(vertex, mask)
            return
        } else if (pRule === Rule.CREASE) {
            this.assignCreaseMaskForVertex(vertex, mask, new Crease(this.options).getSharpEdgePairOfCrease(pEdgeSharpness, valence))
        } else {
            this.assignCornerMaskForVertex(mask)
        }
        if (cRule === pRule) return
        const crease = new Crease(this.options)
        const cEdgeSharpness = vertex.getChildSharpnessPerEdge(crease, new Array(valence).fill(0))
        const cVertexSharpness = vertex.getChildSharpness(crease)
        if (cRule === Rule.UNKNOWN) {
            cRule = crease.determineVertexVertexRule(cVertexSharpness, valence, cEdgeSharpness)
            if (cRule === pRule) return
        }
        const cMask = new LocalMask(valence)
        if (cRule === Rule.SMOOTH || cRule === Rule.DART) {
            this.assignSmoothMaskForVertex(vertex, cMask)
        } else if (cRule === Rule.CREASE) {
            this.assignCreaseMaskForVertex(vertex, cMask, new Crease(this.options).getSharpEdgePairOfCrease(cEdgeSharpness, valence))
        } else {
            this.assignCornerMaskForVertex(cMask)
        }
        const pWeight = crease.computeFractionalWeightAtVertex(pVertexSharpness, cVertexSharpness, valence, pEdgeSharpness, cEdgeSharpness)
        const cWeight = f32(1 - pWeight)
        cMask.combineVertexVertexMasks(cWeight, pWeight, mask)
    }
}
// endregion

/**
 * OpenSubdiv `Sdc` (subdivision core): options, creasing and the Catmull-Clark masks, ported from
 * `opensubdiv/sdc/{options.h, crease.h, crease.cpp, scheme.h, catmarkScheme.h}` (OpenSubdiv `ffffe6f`,
 * `.repos/OpenSubdiv`). Blender's Subdivision Surface runs on exactly this code
 * (`intern/opensubdiv/internal/topology/topology_refiner_factory.cc:308-311`).
 *
 * Only what Blender uses is ported: the Catmark scheme (Blender's "Simple" is Catmark with every edge and
 * vertex infinitely sharp, `subdiv_converter_mesh.cc` `BUGGY_SIMPLE_SCHEME_WORKAROUND`), `TRI_SUB_CATMARK`
 * triangle weights, and both creasing methods (Blender uses `CREASE_UNIFORM`). Weights are computed in double;
 * OpenSubdiv's are float, a difference far below the parity tolerance.
 */

// region options

/** `Sdc::Options::VtxBoundaryInterpolation` (`options.h:36`). */
export enum VtxBoundaryInterpolation { None = 0, EdgeOnly = 1, EdgeAndCorner = 2 }

/** `Sdc::Options::FVarLinearInterpolation` (`options.h:43`). */
export enum FVarLinearInterpolation { None = 0, CornersOnly = 1, CornersPlus1 = 2, CornersPlus2 = 3, Boundaries = 4, All = 5 }

/** `Sdc::Options::CreasingMethod` (`options.h:51`). */
export enum CreasingMethod { Uniform = 0, Chaikin = 1 }

export interface SdcOptions {
    vtxBoundaryInterpolation: VtxBoundaryInterpolation
    fvarLinearInterpolation: FVarLinearInterpolation
    creasingMethod: CreasingMethod
}

// endregion

// region crease

export const SHARPNESS_SMOOTH = 0
export const SHARPNESS_INFINITE = 10

export const isSmooth = (s: number) => s <= SHARPNESS_SMOOTH
export const isSharp = (s: number) => s > SHARPNESS_SMOOTH
export const isInfinite = (s: number) => s >= SHARPNESS_INFINITE
export const isSemiSharp = (s: number) => SHARPNESS_SMOOTH < s && s < SHARPNESS_INFINITE

/** `Sdc::Crease::Rule` (`crease.h:79`), bit values. */
export enum Rule { Unknown = 0, Smooth = 1, Dart = 2, Crease = 4, Corner = 8 }

/** `Crease::decrementSharpness` (`crease.h:194`). */
export function decrementSharpness(s: number): number {
    if (isSmooth(s)) return SHARPNESS_SMOOTH
    if (isInfinite(s)) return SHARPNESS_INFINITE
    if (s > 1) return s - 1
    return SHARPNESS_SMOOTH
}

/** `Crease::SharpenBoundaryVertex` (`crease.h:186`). */
export function sharpenBoundaryVertex(options: SdcOptions, vertexSharpness: number): number {
    return options.vtxBoundaryInterpolation === VtxBoundaryInterpolation.EdgeAndCorner ? SHARPNESS_INFINITE : vertexSharpness
}

/** `Crease::DetermineVertexVertexRule(float, int, float const*)` (`crease.cpp:26`). */
export function determineVertexVertexRule(vertexSharpness: number, edgeSharpness: ArrayLike<number>, count = edgeSharpness.length): Rule {
    if (isSharp(vertexSharpness)) return Rule.Corner
    let sharpEdgeCount = 0
    for (let i = 0; i < count; i++) sharpEdgeCount += isSharp(edgeSharpness[i]) ? 1 : 0
    return determineVertexVertexRuleFromCount(vertexSharpness, sharpEdgeCount)
}

/** `Crease::DetermineVertexVertexRule(float, int)` (`crease.h`, inline beside the above). */
export function determineVertexVertexRuleFromCount(vertexSharpness: number, sharpEdgeCount: number): Rule {
    if (isSharp(vertexSharpness)) return Rule.Corner
    return sharpEdgeCount > 2 ? Rule.Corner : (1 << sharpEdgeCount) as Rule
}

/** `Crease::ComputeFractionalWeightAtVertex` (`crease.cpp:39`). */
export function computeFractionalWeightAtVertex(
    options: SdcOptions, parentVertexSharpness: number, childVertexSharpness: number,
    count: number, parentSharpness: ArrayLike<number>, childSharpness: ArrayLike<number> | null,
): number {
    let transitionCount = 0
    let transitionSum = 0
    if (isSharp(parentVertexSharpness) && isSmooth(childVertexSharpness)) {
        transitionCount = 1
        transitionSum = parentVertexSharpness
    }
    if (options.creasingMethod === CreasingMethod.Uniform || !childSharpness) {
        for (let i = 0; i < count; i++) {
            if (isSharp(parentSharpness[i]) && parentSharpness[i] <= 1) { transitionSum += parentSharpness[i]; transitionCount++ }
        }
    } else {
        for (let i = 0; i < count; i++) {
            if (isSharp(parentSharpness[i]) && isSmooth(childSharpness[i])) { transitionSum += parentSharpness[i]; transitionCount++ }
        }
    }
    if (transitionCount === 0) return 0
    const w = transitionSum / transitionCount
    return w > 1 ? 1 : w
}

/** `Crease::SubdivideEdgeSharpnessAtVertex` (`crease.cpp:81`). */
export function subdivideEdgeSharpnessAtVertex(options: SdcOptions, edgeSharpness: number, count: number, incident: ArrayLike<number>): number {
    if (options.creasingMethod === CreasingMethod.Uniform || count < 2) return decrementSharpness(edgeSharpness)
    if (isSmooth(edgeSharpness)) return SHARPNESS_SMOOTH
    if (isInfinite(edgeSharpness)) return SHARPNESS_INFINITE
    let sharpSum = 0, sharpCount = 0
    for (let i = 0; i < count; i++) if (isSemiSharp(incident[i])) { sharpCount++; sharpSum += incident[i] }
    if (sharpCount > 1) {
        const avg = (sharpSum - edgeSharpness) / (sharpCount - 1)
        edgeSharpness = 0.75 * edgeSharpness + 0.25 * avg
    }
    edgeSharpness -= 1
    return isSharp(edgeSharpness) ? edgeSharpness : SHARPNESS_SMOOTH
}

/** `Crease::SubdivideEdgeSharpnessesAroundVertex` (`crease.cpp:112`). */
export function subdivideEdgeSharpnessesAroundVertex(options: SdcOptions, count: number, parent: ArrayLike<number>, child: number[]): void {
    if (options.creasingMethod === CreasingMethod.Uniform || count < 2) {
        for (let i = 0; i < count; i++) child[i] = decrementSharpness(parent[i])
        return
    }
    let sharpSum = 0, sharpCount = 0
    for (let i = 0; i < count; i++) if (isSemiSharp(parent[i])) { sharpCount++; sharpSum += parent[i] }
    if (sharpCount === 0) {
        for (let i = 0; i < count; i++) child[i] = parent[i]
        return
    }
    for (let i = 0; i < count; i++) {
        const p = parent[i]
        if (isSmooth(p)) child[i] = SHARPNESS_SMOOTH
        else if (isInfinite(p)) child[i] = SHARPNESS_INFINITE
        else if (sharpCount === 1) child[i] = decrementSharpness(p)
        else {
            const other = (sharpSum - p) / (sharpCount - 1)
            let c = 0.75 * p + 0.25 * other - 1
            if (isSmooth(c)) c = SHARPNESS_SMOOTH
            child[i] = c
        }
    }
}

/** `Crease::GetSharpEdgePairOfCrease` (`crease.h:212`). */
export function getSharpEdgePairOfCrease(edgeSharpness: ArrayLike<number>, count: number): [number, number] {
    let a = 0
    while (isSmooth(edgeSharpness[a])) a++
    let b = count - 1
    while (isSmooth(edgeSharpness[b])) b--
    return [a, b]
}

// endregion

// region masks

/**
 * A mask: weights on the parent vertex (or the face's vertices), the vertices opposite its incident edges, and
 * the incident faces (their centres, or for limit masks the vertex opposite in the quad).
 */
export class Mask {
    vertex: number[] = []
    edge: number[] = []
    face: number[] = []
    numVertex = 0
    numEdge = 0
    numFace = 0
    faceWeightsForFaceCenters = false

    set(nv: number, ne: number, nf: number, centers: boolean): this {
        this.numVertex = nv; this.numEdge = ne; this.numFace = nf; this.faceWeightsForFaceCenters = centers
        return this
    }
}

/** What a vertex-vertex mask needs of its neighbourhood (`Vtr::internal::VertexInterface`). */
export interface VertexNeighborhood {
    numEdges: number
    numFaces: number
    sharpness: number
    sharpnessPerEdge: ArrayLike<number>
    childSharpness: number
}

/** `Scheme::assignCreaseMaskForEdge` (`scheme.h:296`). */
function assignCreaseMaskForEdge(mask: Mask): void {
    mask.set(2, 0, 0, false)
    mask.vertex[0] = 0.5
    mask.vertex[1] = 0.5
}

/** `Scheme<CATMARK>::assignSmoothMaskForEdge` (`catmarkScheme.h:52`), `TRI_SUB_CATMARK` only. */
function assignSmoothMaskForEdge(faceCount: number, mask: Mask): void {
    mask.set(2, 0, faceCount, true)
    mask.vertex[0] = 0.25
    mask.vertex[1] = 0.25
    if (faceCount === 2) {
        mask.face[0] = 0.25
        mask.face[1] = 0.25
    } else {
        const w = 0.5 / faceCount
        for (let i = 0; i < faceCount; i++) mask.face[i] = w
    }
}

/** `Scheme::ComputeFaceVertexMask` (`scheme.h:329`). */
export function computeFaceVertexMask(vertCount: number, mask: Mask): void {
    mask.set(vertCount, 0, 0, false)
    const w = 1 / vertCount
    for (let i = 0; i < vertCount; i++) mask.vertex[i] = w
}

/**
 * `Scheme::ComputeEdgeVertexMask` (`scheme.h:374`) for Catmark. `sharpness` is the parent edge's; the child
 * sharpness for Chaikin is `EdgeInterface::GetChildSharpnesses` (`componentInterfaces.h`): sharpness - 1 for both.
 */
export function computeEdgeVertexMask(
    options: SdcOptions, faceCount: number, sharpness: number, mask: Mask, parentRule: Rule = Rule.Unknown, childRule: Rule = Rule.Unknown,
): void {
    if (parentRule === Rule.Smooth || (parentRule === Rule.Unknown && sharpness <= 0)) {
        assignSmoothMaskForEdge(faceCount, mask)
        return
    }
    if (childRule === Rule.Crease) {
        assignCreaseMaskForEdge(mask)
        return
    }
    if (childRule === Rule.Unknown) {
        let childIsCrease: boolean
        if (parentRule === Rule.Crease) childIsCrease = true
        else if (sharpness >= 1) childIsCrease = true
        else if (options.creasingMethod === CreasingMethod.Uniform) childIsCrease = false
        else {
            // EdgeInterface::GetChildSharpnesses: both child edges get sharpness - 1
            const child = sharpness - 1
            childIsCrease = child > 0 && child > 0
        }
        if (childIsCrease) {
            assignCreaseMaskForEdge(mask)
            return
        }
    }
    assignSmoothMaskForEdge(faceCount, mask)
    const pWeight = sharpness, cWeight = 1 - pWeight
    mask.vertex[0] = pWeight * 0.5 + cWeight * mask.vertex[0]
    mask.vertex[1] = pWeight * 0.5 + cWeight * mask.vertex[1]
    for (let i = 0; i < mask.numFace; i++) mask.face[i] *= cWeight
}

/** `Scheme::assignCornerMaskForVertex` (`scheme.h:310`). */
function assignCornerMaskForVertex(mask: Mask): void {
    mask.set(1, 0, 0, false)
    mask.vertex[0] = 1
}

/** `Scheme<CATMARK>::assignCreaseMaskForVertex` (`catmarkScheme.h:131`). */
function assignCreaseMaskForVertex(valence: number, mask: Mask, creaseEnds: [number, number]): void {
    mask.set(1, valence, 0, false)
    mask.vertex[0] = 0.75
    for (let i = 0; i < valence; i++) mask.edge[i] = 0
    mask.edge[creaseEnds[0]] = 0.125
    mask.edge[creaseEnds[1]] = 0.125
}

/** `Scheme<CATMARK>::assignSmoothMaskForVertex` (`catmarkScheme.h:156`). */
function assignSmoothMaskForVertex(valence: number, mask: Mask): void {
    mask.set(1, valence, valence, true)
    const v = (valence - 2) / valence
    const fw = 1 / (valence * valence)
    mask.vertex[0] = v
    for (let i = 0; i < valence; i++) { mask.edge[i] = fw; mask.face[i] = fw }
}

/** `LocalMask::CombineVertexVertexMasks` (`scheme.h:240`): `dst = dstCoeff * dst + thisCoeff * src`. */
function combineVertexVertexMasks(src: Mask, thisCoeff: number, dstCoeff: number, dst: Mask): void {
    dst.vertex[0] = dstCoeff * dst.vertex[0] + thisCoeff * src.vertex[0]
    const ne = src.numEdge
    if (ne) {
        if (dst.numEdge === 0) {
            dst.numEdge = ne
            for (let i = 0; i < ne; i++) dst.edge[i] = thisCoeff * src.edge[i]
        } else {
            for (let i = 0; i < ne; i++) dst.edge[i] = dstCoeff * dst.edge[i] + thisCoeff * src.edge[i]
        }
    }
    const nf = src.numFace
    if (nf) {
        if (dst.numFace === 0) {
            dst.numFace = nf
            dst.faceWeightsForFaceCenters = src.faceWeightsForFaceCenters
            for (let i = 0; i < nf; i++) dst.face[i] = thisCoeff * src.face[i]
        } else {
            for (let i = 0; i < nf; i++) dst.face[i] = dstCoeff * dst.face[i] + thisCoeff * src.face[i]
        }
    }
}

const scratchMask = new Mask()

/** `Scheme::ComputeVertexVertexMask` (`scheme.h:470`) for Catmark. */
export function computeVertexVertexMask(
    options: SdcOptions, vertex: VertexNeighborhood, mask: Mask, pRule: Rule = Rule.Unknown, cRule: Rule = Rule.Unknown,
): void {
    if (pRule === Rule.Smooth || pRule === Rule.Dart) {
        assignSmoothMaskForVertex(vertex.numFaces, mask)
        return
    }
    if (cRule === Rule.Unknown && pRule !== Rule.Unknown) cRule = pRule
    const valence = vertex.numEdges

    let pEdgeSharpness: ArrayLike<number> = []
    let pVertexSharpness = 0
    const requireParentSharpness = pRule === Rule.Unknown || pRule === Rule.Crease || pRule !== cRule
    if (requireParentSharpness) {
        pVertexSharpness = vertex.sharpness
        pEdgeSharpness = vertex.sharpnessPerEdge
        if (pRule === Rule.Unknown) pRule = determineVertexVertexRule(pVertexSharpness, pEdgeSharpness, valence)
    }
    if (pRule === Rule.Smooth || pRule === Rule.Dart) {
        assignSmoothMaskForVertex(vertex.numFaces, mask)
        return
    } else if (pRule === Rule.Crease) {
        assignCreaseMaskForVertex(valence, mask, getSharpEdgePairOfCrease(pEdgeSharpness, valence))
    } else {
        assignCornerMaskForVertex(mask)
    }
    if (cRule === pRule) return

    const cEdgeSharpness: number[] = []
    subdivideEdgeSharpnessesAroundVertex(options, valence, pEdgeSharpness, cEdgeSharpness)
    const cVertexSharpness = vertex.childSharpness
    if (cRule === Rule.Unknown) {
        cRule = determineVertexVertexRule(cVertexSharpness, cEdgeSharpness, valence)
        if (cRule === pRule) return
    }

    const cMask = scratchMask
    if (cRule === Rule.Smooth || cRule === Rule.Dart) assignSmoothMaskForVertex(vertex.numFaces, cMask)
    else if (cRule === Rule.Crease) assignCreaseMaskForVertex(valence, cMask, getSharpEdgePairOfCrease(cEdgeSharpness, valence))
    else assignCornerMaskForVertex(cMask)

    const pWeight = computeFractionalWeightAtVertex(options, pVertexSharpness, cVertexSharpness, valence, pEdgeSharpness, cEdgeSharpness)
    const cWeight = 1 - pWeight
    combineVertexVertexMasks(cMask, cWeight, pWeight, mask)
}

/** `Scheme<CATMARK>::assignCornerLimitMask` (`catmarkScheme.h:191`). */
function assignCornerLimitMask(mask: Mask): void {
    mask.set(1, 0, 0, false)
    mask.vertex[0] = 1
}

/** `Scheme<CATMARK>::assignCreaseLimitMask` (`catmarkScheme.h:204`). */
function assignCreaseLimitMask(valence: number, mask: Mask, creaseEnds: [number, number]): void {
    mask.set(1, valence, 0, false)
    mask.vertex[0] = 2 / 3
    for (let i = 0; i < valence; i++) mask.edge[i] = 0
    mask.edge[creaseEnds[0]] = 1 / 6
    mask.edge[creaseEnds[1]] = 1 / 6
}

/** `Scheme<CATMARK>::assignSmoothLimitMask` (`catmarkScheme.h:230`): face weights are on the opposite quad vertex. */
function assignSmoothLimitMask(valence: number, mask: Mask): void {
    if (valence === 2) { assignCornerLimitMask(mask); return }
    mask.set(1, valence, valence, false)
    if (valence === 4) {
        mask.vertex[0] = 4 / 9
        for (let i = 0; i < 4; i++) { mask.edge[i] = 1 / 9; mask.face[i] = 1 / 36 }
    } else {
        const fw = 1 / (valence * (valence + 5))
        const ew = 4 * fw
        mask.vertex[0] = 1 - valence * (ew + fw)
        for (let i = 0; i < valence; i++) { mask.edge[i] = ew; mask.face[i] = fw }
    }
}

/** `Scheme::ComputeVertexLimitMask(vertex, mask, rule)` (`scheme.h:580`). */
export function computeVertexLimitMask(vertex: VertexNeighborhood, mask: Mask, rule: Rule): void {
    if (rule === Rule.Smooth || rule === Rule.Dart) assignSmoothLimitMask(vertex.numFaces, mask)
    else if (rule === Rule.Crease) assignCreaseLimitMask(vertex.numEdges, mask, getSharpEdgePairOfCrease(vertex.sharpnessPerEdge, vertex.numEdges))
    else assignCornerLimitMask(mask)
}

// endregion

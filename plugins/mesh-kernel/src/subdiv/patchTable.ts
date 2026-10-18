/**
 * The limit surface Blender evaluates: OpenSubdiv's adaptive `Far::PatchTableFactory` (`far/patchTableFactory.cpp`
 * `PatchTableBuilder::identifyPatches` / `populatePatches`), patch evaluation (`far/patchBasis.cpp`), and Blender's
 * `PatchMap` (`intern/opensubdiv/internal/evaluator/patch_map.cc`), with `EvalOutputAPI::evaluateLimit` /
 * `evaluateFaceVarying` (`evaluator_impl.cc:249-311`) on top.
 *
 * Points are addressed as OpenSubdiv's stencil tables address them: the vertices (or face-varying values) of every
 * level of the refiner, level after level, then the local points of the Gregory end caps. Local points here are not
 * shared between adjacent patches (`shareEndCapPatchPoints`): a shared point is the same combination of the same
 * source points either way.
 */

import type {TopologyRefiner} from './refiner'
import {VSpan} from './level'
import {
    normalizePatchCoord, PATCH_GREGORY_BASIS, PATCH_QUADS, PATCH_REGULAR, PatchBuilder, PatchParam, PatchType, PtexIndices,
} from './patchBuilder'
import {gregoryConversionMatrix} from './gregory'
import {FVarLinearInterpolation} from './sdc'

/** A local point: a combination of level points (global indices). */
export interface LocalPoint { indices: number[], weights: number[] }

export interface PatchData {
    type: PatchType
    param: PatchParam
    /** Control points: global level-point indices, or `numLevelPoints + local` for end-cap points. */
    points: number[]
}

export interface PatchChannel {
    /** First global point of each level, and the total level points. */
    levelOffsets: number[]
    numLevelPoints: number
    localPoints: LocalPoint[]
}

export interface PatchTable {
    ptex: PtexIndices
    patches: PatchData[]
    vertex: PatchChannel
    /** Per FVar channel: the channel's points and each patch's face-varying patch. */
    fvar: {channel: PatchChannel, patches: PatchData[]}[]
}

/** `PatchTableFactory::Create` for an adaptively refined Catmark refiner, with Blender's options. */
export function buildPatchTable(refiner: TopologyRefiner, useInfSharpPatch: boolean): PatchTable {
    const builder = new PatchBuilder(refiner, useInfSharpPatch)
    const ptex = new PtexIndices(refiner.levels[0])
    const nFVar = refiner.numFVarChannels

    // identifyPatches (patchTableFactory.cpp:950): offsets, then leaves that are patches, breadth first
    const vertex: PatchChannel = {levelOffsets: [], numLevelPoints: 0, localPoints: []}
    const fvarChannels: PatchChannel[] = Array.from({length: nFVar}, () => ({levelOffsets: [], numLevelPoints: 0, localPoints: []}))
    for (const L of refiner.levels) {
        vertex.levelOffsets.push(vertex.numLevelPoints)
        vertex.numLevelPoints += L.numVertices
        for (let c = 0; c < nFVar; c++) {
            fvarChannels[c].levelOffsets.push(fvarChannels[c].numLevelPoints)
            fvarChannels[c].numLevelPoints += L.getFVarLevel(c).valueCount
        }
    }
    const tuples: [number, number][] = []
    for (let l = 0; l < refiner.levels.length; l++) {
        const n = refiner.levels[l].numFaces
        for (let f = 0; f < n; f++) if (builder.isFaceAPatch(l, f) && builder.isFaceALeaf(l, f)) tuples.push([l, f])
    }

    // populatePatches (:1015)
    const patches: PatchData[] = []
    const fvarPatches: PatchData[][] = Array.from({length: nFVar}, () => [])
    for (const [l, f] of tuples) {
        const info = identifyPatchTopology(builder, l, f, -1)
        const points = assignPatchPoints(builder, l, f, info, vertex, -1)
        const param = builder.computePatchParam(l, f, ptex, info.isRegular, info.paramBoundaryMask, true)
        patches.push({type: info.isRegular ? PATCH_REGULAR : PATCH_GREGORY_BASIS, param, points})
        for (let c = 0; c < nFVar; c++) {
            const level = refiner.levels[l]
            const F = level.getFVarLevel(c)
            const channel = fvarChannels[c]
            if (F.options.fvarLinearInterpolation === FVarLinearInterpolation.All) {
                // isFVarChannelLinear: QUADS from the face's values, with the vertex patch's param
                const values = Array.from(level.getFaceFVarValues(f, c), x => x + channel.levelOffsets[l])
                fvarPatches[c].push({type: PATCH_QUADS, param, points: values})
            } else {
                const matches = level.doesFaceFVarTopologyMatch(f, c)
                const fInfo = matches ? info : identifyPatchTopology(builder, l, f, c)
                const fPoints = assignPatchPoints(builder, l, f, fInfo, channel, c)
                fvarPatches[c].push({
                    type: fInfo.isRegular ? PATCH_REGULAR : PATCH_GREGORY_BASIS,
                    param: {...param, boundary: fInfo.paramBoundaryMask, regular: fInfo.isRegular},
                    points: fPoints,
                })
            }
        }
    }
    return {ptex, patches, vertex, fvar: fvarChannels.map((channel, c) => ({channel, patches: fvarPatches[c]}))}
}

interface PatchInfo {
    isRegular: boolean
    regBoundaryMask: number
    cornerSpans: VSpan[]
    paramBoundaryMask: number
    matrix: Float64Array[] | null
}

/** `PatchTableBuilder::identifyPatchTopology` (`patchTableFactory.cpp:469`). */
function identifyPatchTopology(builder: PatchBuilder, l: number, f: number, fvc: number): PatchInfo {
    const isRegular = builder.isPatchRegular(l, f, fvc)
    const info: PatchInfo = {isRegular, regBoundaryMask: 0, cornerSpans: [], paramBoundaryMask: 0, matrix: null}
    if (isRegular) {
        info.regBoundaryMask = builder.getRegularPatchBoundaryMask(l, f, fvc)
        info.paramBoundaryMask = info.regBoundaryMask
    } else {
        info.cornerSpans = [new VSpan(), new VSpan(), new VSpan(), new VSpan()]
        builder.getIrregularPatchCornerSpans(l, f, info.cornerSpans, fvc)
        const sp = builder.assembleIrregularSourcePatch(l, f, info.cornerSpans)
        info.matrix = gregoryConversionMatrix(sp)
        info.paramBoundaryMask = 0
    }
    return info
}

/** `PatchTableBuilder::assignPatchPointsAndStencils` (`patchTableFactory.cpp:541`). */
function assignPatchPoints(builder: PatchBuilder, l: number, f: number, info: PatchInfo, channel: PatchChannel, fvc: number): number[] {
    const offset = channel.levelOffsets[l]
    if (info.isRegular) {
        const pts: number[] = new Array(16)
        builder.getRegularPatchPoints(l, f, info.regBoundaryMask, pts, fvc)
        return pts.map(p => p + offset)
    }
    const source: number[] = []
    const sp = builder.assembleIrregularSourcePatch(l, f, info.cornerSpans)
    builder.gatherIrregularSourcePoints(l, f, info.cornerSpans, sp, source, fvc)
    const out: number[] = []
    for (const row of info.matrix!) {
        const lp: LocalPoint = {indices: [], weights: []}
        for (let j = 0; j < row.length; j++) {
            if (row[j] !== 0) { lp.indices.push(source[j] + offset); lp.weights.push(row[j]) }
        }
        out.push(channel.numLevelPoints + channel.localPoints.length)
        channel.localPoints.push(lp)
    }
    return out
}

// region evaluation

/** Values of every point of a channel: the level values (concatenated, `stride` each) and the local points. */
export function resolvePoints(channel: PatchChannel, levelValues: Float64Array, stride: number): Float64Array {
    const out = new Float64Array((channel.numLevelPoints + channel.localPoints.length) * stride)
    out.set(levelValues.subarray(0, channel.numLevelPoints * stride))
    for (let i = 0; i < channel.localPoints.length; i++) {
        const lp = channel.localPoints[i], d = (channel.numLevelPoints + i) * stride
        for (let j = 0; j < lp.indices.length; j++) {
            const s = lp.indices[j] * stride, w = lp.weights[j]
            for (let k = 0; k < stride; k++) out[d + k] += levelValues[s + k] * w
        }
    }
    return out
}

/** `evalBSplineCurve` (`patchBasis.cpp:113`). */
function bsplineCurve(t: number, w: number[]): void {
    const t2 = t * t, t3 = t * t2
    w[0] = (1 / 6) * (1 - 3 * (t - t2) - t3)
    w[1] = (1 / 6) * (4 - 6 * t2 + 3 * t3)
    w[2] = (1 / 6) * (1 + 3 * (t + t2 - t3))
    w[3] = (1 / 6) * t3
}

/** `evalBezierCurve` (`patchBasis.cpp:260`). */
function bezierCurve(t: number, w: number[]): void {
    const t2 = t * t, tC = 1 - t, tC2 = tC * tC
    w[0] = tC2 * tC
    w[1] = tC2 * t * 3
    w[2] = t2 * tC * 3
    w[3] = t2 * t
}

/** `adjustBSplineBoundaryWeights` (`patchBasis.cpp:137`). */
function adjustBSplineBoundaryWeights(boundary: number, w: number[]): void {
    if (boundary & 1) for (let i = 0; i < 4; i++) { w[i + 8] -= w[i]; w[i + 4] += w[i] * 2; w[i] = 0 }
    if (boundary & 2) for (let i = 0; i < 16; i += 4) { w[i + 1] -= w[i + 3]; w[i + 2] += w[i + 3] * 2; w[i + 3] = 0 }
    if (boundary & 4) for (let i = 0; i < 4; i++) { w[i + 4] -= w[i + 12]; w[i + 8] += w[i + 12] * 2; w[i + 12] = 0 }
    if (boundary & 8) for (let i = 0; i < 16; i += 4) { w[i + 2] -= w[i]; w[i + 1] += w[i] * 2; w[i] = 0 }
}

const GREGORY_BOUNDARY = [0, 1, 7, 5, 2, 6, 16, 12, 15, 17, 11, 10]
const GREGORY_BOUNDARY_S = [0, 1, 2, 3, 0, 3, 0, 3, 0, 1, 2, 3]
const GREGORY_BOUNDARY_T = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 3, 3]
const GREGORY_INTERIOR = [3, 4, 8, 9, 13, 14, 18, 19]
const GREGORY_INTERIOR_S = [1, 1, 2, 2, 2, 2, 1, 1]
const GREGORY_INTERIOR_T = [1, 1, 1, 1, 2, 2, 2, 2]

/** `EvaluatePatchBasis` (`patchBasis.cpp:1316`), positions only. */
export function evaluatePatchBasis(type: PatchType, param: PatchParam, s: number, t: number, w: number[]): number {
    [s, t] = normalizePatchCoord(param, s, t)
    if (type === PATCH_REGULAR) {
        const sw = [0, 0, 0, 0], tw = [0, 0, 0, 0]
        bsplineCurve(s, sw)
        bsplineCurve(t, tw)
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) w[4 * i + j] = sw[j] * tw[i]
        if (param.boundary) adjustBSplineBoundaryWeights(param.boundary, w)
        return 16
    }
    if (type === PATCH_GREGORY_BASIS) {
        const Bs = [0, 0, 0, 0], Bt = [0, 0, 0, 0]
        bezierCurve(s, Bs)
        bezierCurve(t, Bt)
        const sC = 1 - s, tC = 1 - t
        let df0 = s + t; df0 = df0 <= 0 ? 1 : 1 / df0
        let df1 = sC + t; df1 = df1 <= 0 ? 1 : 1 / df1
        let df2 = sC + tC; df2 = df2 <= 0 ? 1 : 1 / df2
        let df3 = s + tC; df3 = df3 <= 0 ? 1 : 1 / df3
        const G = [s * df0, 1 - s * df0, t * df1, 1 - t * df1, sC * df2, 1 - sC * df2, tC * df3, 1 - tC * df3]
        for (let i = 0; i < 12; i++) w[GREGORY_BOUNDARY[i]] = Bs[GREGORY_BOUNDARY_S[i]] * Bt[GREGORY_BOUNDARY_T[i]]
        for (let i = 0; i < 8; i++) w[GREGORY_INTERIOR[i]] = Bs[GREGORY_INTERIOR_S[i]] * Bt[GREGORY_INTERIOR_T[i]] * G[i]
        return 20
    }
    const sC = 1 - s, tC = 1 - t
    w[0] = sC * tC; w[1] = s * tC; w[2] = s * t; w[3] = sC * t
    return 4
}

/**
 * Blender's `PatchMap` (`patch_map.cc`): a quadtree per ptex face over the patches' (u, v) bits, and `FindPatch`
 * (`patch_map.h:206`), which sends a point on a split line to the upper quadrant.
 */
export class PatchMap {
    private readonly minFace: number
    private readonly maxDepth: number
    private readonly tree: {set: boolean, leaf: boolean, index: number}[][] = []

    constructor(params: PatchParam[]) {
        let minFace = Infinity, maxFace = -Infinity, maxDepth = 0
        for (const p of params) { minFace = Math.min(minFace, p.faceId); maxFace = Math.max(maxFace, p.faceId) }
        this.minFace = minFace
        const newNode = () => Array.from({length: 4}, () => ({set: false, leaf: false, index: 0}))
        for (let i = 0; i <= maxFace - minFace; i++) this.tree.push(newNode())
        params.forEach((p, handle) => {
            const depth = p.depth, rootDepth = p.nonQuadRoot ? 1 : 0
            maxDepth = Math.max(maxDepth, depth)
            let node = this.tree[p.faceId - minFace]
            if (depth === rootDepth) {
                for (const c of node) { c.set = true; c.leaf = true; c.index = handle }
                return
            }
            for (let j = rootDepth + 1; j <= depth; j++) {
                const uBit = (p.u >> (depth - j)) & 1, vBit = (p.v >> (depth - j)) & 1
                const quadrant = (vBit << 1) | uBit
                const isLeaf = j === depth
                if (isLeaf) {
                    node[quadrant] = {set: true, leaf: true, index: handle}
                } else if (node[quadrant].set) {
                    node = this.tree[node[quadrant].index]
                } else {
                    this.tree.push(newNode())
                    node[quadrant] = {set: true, leaf: false, index: this.tree.length - 1}
                    node = this.tree[this.tree.length - 1]
                }
            }
        })
        this.maxDepth = maxDepth
    }

    findPatch(face: number, u: number, v: number): number {
        let node = this.tree[face - this.minFace]
        if (!node || !node[0].set) return -1
        let median = 0.5
        for (let depth = 0; depth <= this.maxDepth; depth++, median *= 0.5) {
            const uHalf = u >= median ? 1 : 0
            if (uHalf) u -= median
            const vHalf = v >= median ? 1 : 0
            if (vHalf) v -= median
            const q = (vHalf << 1) | uHalf
            if (node[q].leaf) return node[q].index
            node = this.tree[node[q].index]
        }
        return -1
    }
}

/** Evaluate one patch of `patches` at ptex (u, v) from resolved point values. */
export function evaluatePatch(patch: PatchData, u: number, v: number, values: Float64Array, stride: number, out: Float64Array, o: number): void {
    const w: number[] = new Array(20).fill(0)
    const n = evaluatePatchBasis(patch.type, patch.param, u, v, w)
    for (let k = 0; k < stride; k++) out[o + k] = 0
    for (let i = 0; i < n; i++) {
        const p = patch.points[i]
        if (p < 0 || w[i] === 0) continue
        for (let k = 0; k < stride; k++) out[o + k] += w[i] * values[p * stride + k]
    }
}

// endregion

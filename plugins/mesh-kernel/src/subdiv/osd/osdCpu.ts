/**
 * Port of OpenSubdiv v3_7_0 `opensubdiv/osd/cpuKernel.cpp` (`CpuEvalStencils`, the scalar path), `osd/cpuEvaluator.cpp`
 * (`CpuEvaluator::EvalPatches` without derivatives), `osd/cpuPatchTable.cpp`, `osd/types.h` (`PatchCoord`,
 * `PatchArray`), `osd/bufferDescriptor.h` and the quad bases of `osd/patchBasis.h` / `osd/patchBasisTypes.h`
 * (`OsdEvaluatePatchBasis` - linear, B-spline, Gregory - and `OsdPatchParamNormalize`), Copyright 2013-2018 Pixar.
 * The SIMD stencil kernels (`ComputeStencilKernel<4|8>`, used only for 4- and 8-float primvars - Blender's are 3 and 2
 * floats), derivatives and the triangle bases are not ported.
 * Licensed under the Tomorrow Open Source Technology License 1.0 - see `OPENSUBDIV-LICENSE.txt` in this folder.
 *
 * Float exactness: compiled in the OpenSubdiv library with clang `-ffp-contract=on`, so `dst[k] += src[k] * weight` is
 * `fmaf(src, weight, dst)` and `uv * fracInv - U` is `fmaf(uv, fracInv, -U)`.
 */

import {f32} from '../../blender/f32'
import {fmaf} from '../../blender/fma'
import {PatchParam, PatchTable, PatchType, patchNumControlVertices} from './patchTable'
import type {StencilTable} from './stencilTable'

/** `Osd::BufferDescriptor` (`bufferDescriptor.h:40`). */
export interface BufferDescriptor {
    offset: number
    length: number
    stride: number
}

/** `CpuEvalStencils` (`cpuKernel.cpp:52`), scalar path: stencils `[start, end)` of `table` from `src` into `dst`. */
export function cpuEvalStencils(src: Float32Array, srcDesc: BufferDescriptor, dst: Float32Array, dstDesc: BufferDescriptor,
    table: StencilTable, start = 0, end = table.getNumStencils()): void {
    if (end <= start) return
    const sizes = table.sizes, offsets = table.offsets, indices = table.indices, weights = table.weights
    let idx = offsets[start] ?? 0
    const result = new Array<number>(srcDesc.length).fill(0)
    for (let i = 0; i < end - start; ++i) {
        result.fill(0)
        const size = sizes[start + i]
        for (let j = 0; j < size; ++j, ++idx) {
            const s = srcDesc.offset + indices[idx] * srcDesc.stride
            const w = weights[idx]
            for (let k = 0; k < srcDesc.length; ++k) result[k] = fmaf(src[s + k], w, result[k])
        }
        const d = dstDesc.offset + i * dstDesc.stride
        for (let k = 0; k < srcDesc.length; ++k) dst[d + k] = result[k]
    }
}

/** `Far::PatchTable::PatchHandle` (`patchTable.h`). */
export interface PatchHandle {
    arrayIndex: number
    patchIndex: number
    vertIndex: number
}

/** `Osd::PatchCoord` (`types.h:39`). */
export interface PatchCoord {
    handle: PatchHandle
    s: number
    t: number
}

/** `Osd::PatchArray` (`types.h:49`). */
export interface OsdPatchArray {
    regType: PatchType
    irregType: PatchType
    numPatches: number
    indexBase: number
    stride: number
    primitiveIdBase: number
}

/** `Osd::CpuPatchTable` (`cpuPatchTable.cpp:18`): patch arrays, index and param buffers (vertex and face-varying). */
export class CpuPatchTable {
    readonly patchArrays: OsdPatchArray[] = []
    readonly indexBuffer: number[] = []
    readonly patchParamBuffer: PatchParam[] = []
    readonly fvarPatchArrays: OsdPatchArray[][] = []
    readonly fvarIndexBuffers: number[][] = []
    readonly fvarParamBuffers: PatchParam[][] = []

    constructor(far: PatchTable) {
        for (let fvc = 0; fvc < far.getNumFVarChannels(); fvc++) {
            this.fvarPatchArrays.push([])
            this.fvarIndexBuffers.push([])
            this.fvarParamBuffers.push([])
        }
        for (let j = 0; j < far.getNumPatchArrays(); ++j) {
            const a = far.patchArrays[j]
            const nCV = patchNumControlVertices(a.type)
            this.patchArrays.push({regType: a.type, irregType: a.type, numPatches: a.numPatches, indexBase: this.indexBuffer.length,
                stride: nCV, primitiveIdBase: this.patchParamBuffer.length})
            for (let k = 0; k < a.numPatches * nCV; k++) this.indexBuffer.push(far.patchVerts[a.vertIndex + k])
            for (let fvc = 0; fvc < far.getNumFVarChannels(); ++fvc) {
                const ch = far.fvarChannels[fvc]
                const stride = Math.max(patchNumControlVertices(ch.regType), patchNumControlVertices(ch.irregType))
                this.fvarPatchArrays[fvc].push({regType: ch.regType, irregType: ch.irregType, numPatches: a.numPatches,
                    indexBase: this.fvarIndexBuffers[fvc].length, stride, primitiveIdBase: this.fvarParamBuffers[fvc].length})
                for (let k = 0; k < a.numPatches * ch.stride; k++) this.fvarIndexBuffers[fvc].push(ch.values[a.patchIndex * ch.stride + k])
                for (let k = 0; k < a.numPatches; k++) this.fvarParamBuffers[fvc].push(ch.params[a.patchIndex + k])
            }
            for (let k = 0; k < a.numPatches; k++) this.patchParamBuffer.push(far.paramTable[a.patchIndex + k])
        }
    }
}

/** `OsdPatchParamGetParamFraction` (`patchBasisTypes.h:349`). */
function paramFraction(p: PatchParam): number {
    return f32(1 / (1 << (p.getDepth() - (p.nonQuadRoot() ? 1 : 0))))
}

/** `OsdPatchParamNormalize` (`patchBasisTypes.h:372`): `uv * fracInv - U` contracts to an FMA. */
function normalize(param: PatchParam, s: number, t: number): [number, number] {
    const fracInv = f32(1 / paramFraction(param))
    return [fmaf(s, fracInv, -param.getU()), fmaf(t, fracInv, -param.getV())]
}

/** `Osd_EvalBasisLinear` (`patchBasis.h:39`), position weights. */
function evalBasisLinear(s: number, t: number, wP: number[]): number {
    const sC = f32(1 - s)
    const tC = f32(1 - t)
    wP[0] = f32(sC * tC)
    wP[1] = f32(s * tC)
    wP[2] = f32(s * t)
    wP[3] = f32(sC * t)
    return 4
}

const ONE_6TH = f32(1 / 6)

/**
 * `Osd_evalBSplineCurve` (`patchBasis.h:89`), position weights:
 * `one6th * (1.0f - 3.0f*(t - t2) - t3)` contracts its inner `1 - 3 * (t - t2)`;
 * `one6th * (4.0f - 6.0f*t2 + 3.0f*t3)` contracts both terms, `fma(3, t3, fma(-6, t2, 4))`;
 * `one6th * (1.0f + 3.0f*(t + t2 - t3))` contracts `1 + 3 * (...)`.
 */
function evalBSplineCurve(t: number, wP: number[]): void {
    const t2 = f32(t * t)
    const t3 = f32(t * t2)
    wP[0] = f32(ONE_6TH * f32(fmaf(-3, f32(t - t2), 1) - t3))
    wP[1] = f32(ONE_6TH * fmaf(3, t3, fmaf(-6, t2, 4)))
    wP[2] = f32(ONE_6TH * fmaf(3, f32(f32(t + t2) - t3), 1))
    wP[3] = f32(ONE_6TH * t3)
}

/** `Osd_EvalBasisBSpline` (`patchBasis.h:189`), position weights. */
function evalBasisBSpline(s: number, t: number, wP: number[]): number {
    const sWeights: number[] = [], tWeights: number[] = []
    evalBSplineCurve(s, sWeights)
    evalBSplineCurve(t, tWeights)
    for (let i = 0; i < 4; ++i) for (let j = 0; j < 4; ++j) wP[4 * i + j] = f32(sWeights[j] * tWeights[i])
    return 16
}

/** `Osd_adjustBSplineBoundaryWeights` (`patchBasis.h:121`): `w[a] += w[b] * 2.0f` contracts (exactly: `2 * w` is exact). */
function adjustBSplineBoundaryWeights(boundary: number, w: number[]): void {
    if ((boundary & 1) !== 0) {
        for (let i = 0; i < 4; ++i) {
            w[i + 8] = f32(w[i + 8] - w[i + 0])
            w[i + 4] = fmaf(w[i + 0], 2, w[i + 4])
            w[i + 0] = 0
        }
    }
    if ((boundary & 2) !== 0) {
        for (let i = 0; i < 16; i += 4) {
            w[i + 1] = f32(w[i + 1] - w[i + 3])
            w[i + 2] = fmaf(w[i + 3], 2, w[i + 2])
            w[i + 3] = 0
        }
    }
    if ((boundary & 4) !== 0) {
        for (let i = 0; i < 4; ++i) {
            w[i + 4] = f32(w[i + 4] - w[i + 12])
            w[i + 8] = fmaf(w[i + 12], 2, w[i + 8])
            w[i + 12] = 0
        }
    }
    if ((boundary & 8) !== 0) {
        for (let i = 0; i < 16; i += 4) {
            w[i + 2] = f32(w[i + 2] - w[i + 0])
            w[i + 1] = fmaf(w[i + 0], 2, w[i + 1])
            w[i + 0] = 0
        }
    }
}

/** `Osd_evalBezierCurve` (`patchBasis.h:282`), position weights. */
function evalBezierCurve(t: number, wP: number[]): void {
    const t2 = f32(t * t)
    const tC = f32(1 - t)
    const tC2 = f32(tC * tC)
    wP[0] = f32(tC2 * tC)
    wP[1] = f32(f32(tC2 * t) * 3)
    wP[2] = f32(f32(t2 * tC) * 3)
    wP[3] = f32(t2 * t)
}

const BOUNDARY_GREGORY = [0, 1, 7, 5, 2, 6, 16, 12, 15, 17, 11, 10]
const BOUNDARY_BEZ_S_COL = [0, 1, 2, 3, 0, 3, 0, 3, 0, 1, 2, 3]
const BOUNDARY_BEZ_T_ROW = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 3, 3]
const INTERIOR_GREGORY = [3, 4, 8, 9, 13, 14, 18, 19]
const INTERIOR_BEZ_S_COL = [1, 1, 2, 2, 2, 2, 1, 1]
const INTERIOR_BEZ_T_ROW = [1, 1, 1, 1, 2, 2, 2, 2]

/** `Osd_EvalBasisGregory` (`patchBasis.h:317`), position weights. `1.0f - s * df0` contracts to an FMA. */
function evalBasisGregory(s: number, t: number, wP: number[]): number {
    const Bs: number[] = [], Bt: number[] = []
    evalBezierCurve(s, Bs)
    evalBezierCurve(t, Bt)
    const sC = f32(1 - s)
    const tC = f32(1 - t)
    let df0 = f32(s + t); df0 = df0 <= 0 ? 1 : f32(1 / df0)
    let df1 = f32(sC + t); df1 = df1 <= 0 ? 1 : f32(1 / df1)
    let df2 = f32(sC + tC); df2 = df2 <= 0 ? 1 : f32(1 / df2)
    let df3 = f32(s + tC); df3 = df3 <= 0 ? 1 : f32(1 / df3)
    const G = [f32(s * df0), fmaf(-s, df0, 1), f32(t * df1), fmaf(-t, df1, 1), f32(sC * df2), fmaf(-sC, df2, 1), f32(tC * df3), fmaf(-tC, df3, 1)]
    for (let i = 0; i < 12; ++i) wP[BOUNDARY_GREGORY[i]] = f32(Bs[BOUNDARY_BEZ_S_COL[i]] * Bt[BOUNDARY_BEZ_T_ROW[i]])
    for (let j = 0; j < 8; ++j) wP[INTERIOR_GREGORY[j]] = f32(f32(Bs[INTERIOR_BEZ_S_COL[j]] * Bt[INTERIOR_BEZ_T_ROW[j]]) * G[j])
    return 20
}

/**
 * `OsdEvaluatePatchBasis` (`patchBasis.h:1541`) with `OsdEvaluatePatchBasisNormalized` (:1430), without derivatives,
 * for the quad patch types (linear, B-spline with its boundary mask, Gregory basis).
 */
export function osdEvaluatePatchBasis(patchType: PatchType, param: PatchParam, s: number, t: number, wP: number[]): number {
    if (patchType === PatchType.LOOP || patchType === PatchType.GREGORY_TRIANGLE || patchType === PatchType.TRIANGLES) {
        throw new Error(`OpenSubdiv: Osd triangle patch bases (type ${patchType}) are not ported`)
    }
    const [ns, nt] = normalize(param, s, t)
    const boundaryMask = param.getBoundary()
    switch (patchType) {
    case PatchType.REGULAR: {
        const n = evalBasisBSpline(ns, nt, wP)
        if (boundaryMask !== 0) adjustBSplineBoundaryWeights(boundaryMask, wP)
        return n
    }
    case PatchType.GREGORY_BASIS: return evalBasisGregory(ns, nt, wP)
    case PatchType.QUADS: return evalBasisLinear(ns, nt, wP)
    default: return 0
    }
}

/**
 * `CpuEvaluator::EvalPatches(src, srcDesc, dst, dstDesc, numPatchCoords, patchCoords, patchArrays, indices, params)`
 * (`cpuEvaluator.cpp:166`).
 */
export function cpuEvalPatches(src: Float32Array, srcDesc: BufferDescriptor, dst: Float32Array, dstDesc: BufferDescriptor,
    patchCoords: PatchCoord[], patchArrays: OsdPatchArray[], patchIndexBuffer: number[], patchParamBuffer: PatchParam[]): void {
    const wP: number[] = []
    for (let i = 0; i < patchCoords.length; ++i) {
        const coord = patchCoords[i]
        const array = patchArrays[coord.handle.arrayIndex]
        const param = patchParamBuffer[coord.handle.patchIndex]
        const patchType = param.isRegular() ? array.regType : array.irregType
        const nPoints = osdEvaluatePatchBasis(patchType, param, coord.s, coord.t, wP)
        const indexBase = array.indexBase + array.stride * (coord.handle.patchIndex - array.primitiveIdBase)
        const d = dstDesc.offset + i * dstDesc.stride
        for (let k = 0; k < dstDesc.length; ++k) dst[d + k] = 0
        for (let j = 0; j < nPoints; ++j) {
            const s = srcDesc.offset + patchIndexBuffer[indexBase + j] * srcDesc.stride
            for (let k = 0; k < dstDesc.length; ++k) dst[d + k] = fmaf(src[s + k], wP[j], dst[d + k])
        }
    }
}

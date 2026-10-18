/**
 * Port of OpenSubdiv v3_7_0 `opensubdiv/osd/cpuKernel.cpp` (`CpuEvalStencils`, the scalar path), `osd/cpuEvaluator.cpp`
 * (`CpuEvaluator::EvalPatches` without derivatives), `osd/cpuPatchTable.cpp`, `osd/types.h` (`PatchCoord`,
 * `PatchArray`), `osd/bufferDescriptor.h` and the linear part of `osd/patchBasis.h` / `osd/patchBasisTypes.h`
 * (`OsdEvaluatePatchBasis`, `Osd_EvalBasisLinear`, `OsdPatchParamNormalize`), Copyright 2013-2018 Pixar.
 * The SIMD stencil kernels (`ComputeStencilKernel<4|8>`, used only for 4- and 8-float primvars - Blender's are 3 and 2
 * floats) and the cubic bases are not ported.
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

/** `OsdEvaluatePatchBasis` (`patchBasis.h:1541`) without derivatives; only the linear quad basis is ported. */
export function osdEvaluatePatchBasis(patchType: PatchType, param: PatchParam, s: number, t: number, wP: number[]): number {
    if (patchType !== PatchType.QUADS) throw new Error(`OpenSubdiv: Osd patch basis for patch type ${patchType} is not ported (only QUADS)`)
    // `OsdPatchParamNormalize` (`patchBasisTypes.h:372`).
    const fracInv = f32(1 / paramFraction(param))
    s = fmaf(s, fracInv, -param.getU())
    t = fmaf(t, fracInv, -param.getV())
    // `Osd_EvalBasisLinear` (`patchBasis.h:39`).
    const sC = f32(1 - s)
    const tC = f32(1 - t)
    wP[0] = f32(sC * tC)
    wP[1] = f32(s * tC)
    wP[2] = f32(s * t)
    wP[3] = f32(sC * t)
    return 4
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

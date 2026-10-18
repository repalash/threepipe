/**
 * Port of OpenSubdiv v3_7_0 `opensubdiv/far/stencilBuilder.h/.cpp` (scalar weights), `far/stencilTable.h/.cpp`
 * (`StencilTableReal<float>`) and `far/stencilTableFactory.cpp` (`StencilTableFactoryReal<float>::Create`,
 * `AppendLocalPointStencilTable` / `...FaceVarying`), Copyright 2014 DreamWorks Animation LLC. Derivative weights and
 * limit stencils are not ported (Blender's evaluator does not build them).
 * Licensed under the Tomorrow Open Source Technology License 1.0 - see `OPENSUBDIV-LICENSE.txt` in this folder.
 *
 * Float exactness: the products `weight * weightFactor` and the accumulations `_weights[i] += w` are separate
 * expressions (a function argument, then a compound assignment in another function), so clang does not fuse them.
 */

import {f32} from '../../blender/f32'
import type {PrimvarBuffer, PrimvarElement} from './primvarRefiner'
import {PrimvarRefiner} from './primvarRefiner'
import type {TopologyRefiner} from './topologyRefiner'

/** `WeightTable<float>` (`stencilBuilder.cpp:132`) with the scalar accumulator. */
class WeightTable {
    dests: number[] = []
    sources: number[] = []
    weights: number[] = []
    indices: number[] = []
    sizes: number[] = []
    size = 0
    lastOffset = 0

    constructor(public coarseVertCount: number, genCtrlVertStencils: boolean, readonly compactWeights: boolean) {
        if (!genCtrlVertStencils) return
        for (let i = 0; i < coarseVertCount; i++) {
            this.indices[i] = i
            this.sizes[i] = 1
            this.dests[i] = i
            this.sources[i] = i
            this.weights[i] = 1
        }
        this.size = this.sources.length
        this.lastOffset = this.size - 1
    }

    /** `AddWithWeight` (:166). */
    addWithWeight(src: number, dest: number, weight: number): void {
        if (src < this.coarseVertCount) {
            this.merge(src, dest, weight, 1, this.lastOffset, this.size)
            return
        }
        const len = this.sizes[src]
        const start = this.indices[src]
        for (let i = start; i < start + len; i++) {
            this.merge(this.sources[i], dest, this.weights[i], weight, this.lastOffset, this.size)
        }
    }

    /** `merge` (:290). */
    private merge(src: number, dst: number, weight: number, weightFactor: number, lastOffset: number, tableSize: number): void {
        if (this.compactWeights && this.dests.length > 0 && this.dests[lastOffset] === dst) {
            for (let i = lastOffset; i < tableSize; i++) {
                if (this.sources[i] === src) {
                    this.weights[i] = f32(this.weights[i] + f32(weight * weightFactor))
                    return
                }
            }
        }
        this.add(src, dst, f32(weight * weightFactor))
    }

    /** `add` (:309). */
    private add(src: number, dst: number, weight: number): void {
        if (this.dests.length === 0 || dst !== this.dests[this.dests.length - 1]) {
            if (dst + 1 > this.indices.length) {
                while (this.indices.length < dst + 1) this.indices.push(0)
                while (this.sizes.length < dst + 1) this.sizes.push(0)
            }
            this.indices[dst] = this.sources.length
            this.sizes[dst] = 0
            this.lastOffset = this.sources.length
        }
        this.size++
        this.sizes[dst]++
        this.dests.push(dst)
        this.sources.push(src)
        this.weights.push(weight)
    }
}

/** `StencilBuilder<float>` (`stencilBuilder.h:40`). */
export class StencilBuilder {
    readonly table: WeightTable

    constructor(coarseVertCount: number, genCtrlVertStencils = true, compactWeights = true) {
        this.table = new WeightTable(coarseVertCount, genCtrlVertStencils, compactWeights)
    }

    setCoarseVertCount(n: number) { this.table.coarseVertCount = n }
    /** `GetNumVertsInStencil` (`stencilBuilder.cpp:421`). */
    getNumVertsInStencil(stencilIndex: number) { return stencilIndex > this.table.sizes.length - 1 ? 0 : this.table.sizes[stencilIndex] }
    getStencilOffsets() { return this.table.indices }
    getStencilSizes() { return this.table.sizes }
    getStencilSources() { return this.table.sources }
    getStencilWeights() { return this.table.weights }
}

/** `StencilBuilder<float>::Index` (`stencilBuilder.h:76`): a primvar element whose "value" is a stencil. */
export class StencilIndex implements PrimvarElement<StencilIndex> {
    constructor(readonly owner: StencilBuilder, readonly index: number) {}

    at(i: number): StencilIndex {
        return new StencilIndex(this.owner, this.index + i)
    }

    getOffset() { return this.index }
    clear(): void {}

    /** `Index::AddWithWeight(Index const&, REAL)` (`stencilBuilder.cpp:494`): zero weights are skipped. */
    addWithWeight(src: StencilIndex, weight: number): void {
        if (weight === 0) return
        this.owner.table.addWithWeight(src.index, this.index, weight)
    }

    /** `Index::AddWithWeight(StencilReal const&, REAL)` (`stencilBuilder.cpp:504`). */
    addWithWeightStencil(src: Stencil, weight: number): void {
        if (weight === 0) return
        for (let i = 0; i < src.size; ++i) {
            const w = src.table.weights[src.offset + i]
            if (w === 0) continue
            const srcIndex = src.table.indices[src.offset + i]
            // `REAL wgt = weight * w`.
            this.owner.table.addWithWeight(srcIndex, this.index, f32(weight * w))
        }
    }
}

/** `StencilReal<float>` (`stencilTable.h:40`): one stencil of a table. */
export interface Stencil {
    table: StencilTable
    size: number
    offset: number
}

/** `StencilTableReal<float>` (`stencilTable.h:110`). */
export class StencilTable {
    numControlVertices = 0
    sizes: number[] = []
    offsets: number[] = []
    indices: number[] = []
    weights: Float32Array = new Float32Array(0)

    getNumStencils() { return this.sizes.length }
    getNumControlVertices() { return this.numControlVertices }

    /** `GetStencil(i)` (`stencilTable.h:705`). */
    getStencil(i: number): Stencil {
        if (i < 0 || i >= this.sizes.length) throw new Error(`StencilTable::GetStencil: no stencil ${i}`)
        return {table: this, size: this.sizes[i], offset: this.offsets[i]}
    }

    /** A copy (`StencilTableReal(StencilTableReal const&)`). */
    clone(): StencilTable {
        const t = new StencilTable()
        t.numControlVertices = this.numControlVertices
        t.sizes = this.sizes.slice()
        t.offsets = this.offsets.slice()
        t.indices = this.indices.slice()
        t.weights = this.weights.slice()
        return t
    }

    /** `StencilTableReal(numControlVerts, offsets, sizes, sources, weights, includeCoarseVerts, firstOffset)` (`stencilTable.cpp:30-118`). */
    static fromBuilder(numControlVerts: number, offsets: number[], sizes: number[], sources: number[], weights: number[],
        includeCoarseVerts: boolean, firstOffset: number): StencilTable {
        const t = new StencilTable()
        t.numControlVertices = numControlVerts
        const start = includeCoarseVerts ? 0 : firstOffset
        let curOffset = 0
        const outWeights: number[] = []
        for (let i = start; i < offsets.length; i++) {
            if (includeCoarseVerts && i === numControlVerts) i = firstOffset
            const sz = sizes[i]
            const off = offsets[i]
            t.offsets.push(curOffset)
            t.sizes.push(sz)
            for (let k = 0; k < sz; k++) {
                t.indices.push(sources[off + k])
                outWeights.push(weights[off + k])
            }
            curOffset += sz
        }
        t.weights = Float32Array.from(outWeights)
        return t
    }

    /** `generateOffsets` (`stencilTable.h:661`). */
    generateOffsets(): void {
        let offset = 0
        this.offsets = []
        for (const s of this.sizes) {
            this.offsets.push(offset)
            offset += s
        }
    }
}

export const enum InterpolationMode {
    VERTEX = 0,
    VARYING = 1,
    FACE_VARYING = 2,
}

/** `StencilTableFactoryReal::Options` (`stencilTableFactory.h:44`). */
export interface StencilTableOptions {
    interpolationMode: InterpolationMode
    generateOffsets: boolean
    generateControlVerts: boolean
    generateIntermediateLevels: boolean
    factorizeIntermediateLevels: boolean
    maxLevel: number
    fvarChannel: number
}

export function stencilTableOptions(): StencilTableOptions {
    return {interpolationMode: InterpolationMode.VERTEX, generateOffsets: false, generateControlVerts: false, generateIntermediateLevels: true,
        factorizeIntermediateLevels: true, maxLevel: 10, fvarChannel: 0}
}

/** `StencilTableFactoryReal<float>::Create(refiner, options)` (`stencilTableFactory.cpp:60`). */
export function createStencilTable(refiner: TopologyRefiner, options: StencilTableOptions): StencilTable {
    const interpolateVertex = options.interpolationMode === InterpolationMode.VERTEX
    const interpolateVarying = options.interpolationMode === InterpolationMode.VARYING
    const interpolateFaceVarying = options.interpolationMode === InterpolationMode.FACE_VARYING
    const numControlVertices = !interpolateFaceVarying ? refiner.getLevel(0).getNumVertices() : refiner.getLevel(0).getNumFVarValues(options.fvarChannel)
    const maxlevel = Math.min(options.maxLevel, refiner.getMaxLevel())
    if (maxlevel === 0 && !options.generateControlVerts) {
        const result = new StencilTable()
        result.numControlVertices = numControlVertices
        return result
    }
    const builder = new StencilBuilder(numControlVertices, true, true)
    const primvarRefiner = new PrimvarRefiner(refiner)
    let srcIndex = new StencilIndex(builder, 0)
    let dstIndex = new StencilIndex(builder, numControlVertices)
    for (let level = 1; level <= maxlevel; ++level) {
        const src: PrimvarBuffer<StencilIndex> = srcIndex
        const dst: PrimvarBuffer<StencilIndex> = dstIndex
        if (interpolateVertex) primvarRefiner.interpolate(level, src, dst)
        else if (interpolateVarying) primvarRefiner.interpolateVarying(level, src, dst)
        else primvarRefiner.interpolateFaceVarying(level, src, dst, options.fvarChannel)
        if (options.factorizeIntermediateLevels) srcIndex = dstIndex
        const dstVertex = !interpolateFaceVarying ? refiner.getLevel(level).getNumVertices() : refiner.getLevel(level).getNumFVarValues(options.fvarChannel)
        dstIndex = dstIndex.at(dstVertex)
        if (!options.factorizeIntermediateLevels) builder.setCoarseVertCount(dstIndex.getOffset())
    }
    let firstOffset = numControlVertices
    if (!options.generateIntermediateLevels) firstOffset = srcIndex.getOffset()
    const result = StencilTable.fromBuilder(numControlVertices, builder.getStencilOffsets(), builder.getStencilSizes(), builder.getStencilSources(),
        builder.getStencilWeights(), options.generateControlVerts, firstOffset)
    return result
}

/**
 * `StencilTableFactoryReal<float>::appendLocalPointStencilTable` (`stencilTableFactory.cpp:241`), with the
 * `AppendLocalPointStencilTable` (channel -1) and `AppendLocalPointStencilTableFaceVarying` entry points: the base
 * stencils, then the local points' stencils factorized onto the control points. Undefined when there are no local
 * points.
 */
export function appendLocalPointStencilTable(refiner: TopologyRefiner, baseStencilTable: StencilTable | undefined,
    localPointStencilTable: StencilTable | undefined, channel = -1, factorize = true): StencilTable | undefined {
    if (!localPointStencilTable || localPointStencilTable.getNumStencils() === 0) return undefined
    const nControlVerts = channel < 0 ? refiner.getLevel(0).getNumVertices() : refiner.getLevel(0).getNumFVarValues(channel)
    if (!baseStencilTable || baseStencilTable.getNumStencils() === 0) {
        const result = localPointStencilTable.clone()
        result.numControlVertices = nControlVerts
        return result
    }
    let controlVertsIndexOffset = 0
    const nBaseStencils = baseStencilTable.getNumStencils()
    const nBaseStencilsElements = baseStencilTable.indices.length
    {
        const nverts = channel < 0 ? refiner.getNumVerticesTotal() : refiner.getNumFVarValuesTotal(channel)
        if (nBaseStencils === nverts) controlVertsIndexOffset = 0
        else if (nBaseStencils === nverts - nControlVerts) controlVertsIndexOffset = nControlVerts
        else throw new Error('StencilTableFactory::appendLocalPointStencilTable: the base stencils do not match the refiner')
    }
    const nLocalPointStencils = localPointStencilTable.getNumStencils()
    let nLocalPointStencilsElements = 0
    const builder = new StencilBuilder(nControlVerts, false, factorize)
    const origin = new StencilIndex(builder, 0)
    for (let i = 0; i < nLocalPointStencils; ++i) {
        const src = localPointStencilTable.getStencil(i)
        const dst = origin.at(i)
        for (let j = 0; j < src.size; ++j) {
            const index = localPointStencilTable.indices[src.offset + j]
            const weight = localPointStencilTable.weights[src.offset + j]
            if (weight === 0) continue
            if (factorize) {
                dst.addWithWeightStencil(baseStencilTable.getStencil(index - controlVertsIndexOffset), weight)
            } else {
                dst.addWithWeight(origin.at(index + controlVertsIndexOffset), weight)
            }
        }
        nLocalPointStencilsElements += builder.getNumVertsInStencil(i)
    }
    const result = new StencilTable()
    result.numControlVertices = nControlVerts
    result.sizes = baseStencilTable.sizes.slice(0, nBaseStencils)
    result.indices = baseStencilTable.indices.slice(0, nBaseStencilsElements)
    const weights = Array.from(baseStencilTable.weights.subarray(0, nBaseStencilsElements))
    for (let i = 0; i < nLocalPointStencils; ++i) {
        const size = builder.getNumVertsInStencil(i)
        const idx = builder.getStencilOffsets()[i]
        for (let j = 0; j < size; ++j) {
            result.indices.push(builder.getStencilSources()[idx + j])
            weights.push(builder.getStencilWeights()[idx + j])
        }
        result.sizes.push(size)
    }
    if (result.indices.length !== nBaseStencilsElements + nLocalPointStencilsElements) throw new Error('appendLocalPointStencilTable: size mismatch')
    result.weights = Float32Array.from(weights)
    result.generateOffsets()
    return result
}

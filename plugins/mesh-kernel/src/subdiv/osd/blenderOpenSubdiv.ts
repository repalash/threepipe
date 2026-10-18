/**
 * Port of Blender 5.2.2's OpenSubdiv glue, `intern/opensubdiv/`:
 * - `opensubdiv_converter_capi.hh` (`OpenSubdiv_Converter`, the mesh side of the refiner factory),
 * - `internal/topology/topology_refiner_factory.cc` (`TopologyRefinerFactory<TopologyRefinerData>` specialisations,
 *   `TopologyRefinerImpl::createFromConverter`; the `MeshTopology` copy kept for `isEqualToConverter` is not needed),
 * - `internal/evaluator/patch_map.h/.cc` (`PatchMap`, Pixar code modified by the Blender Foundation, Apache-2.0),
 * - `internal/evaluator/evaluator_impl.cc` (`openSubdiv_createEvaluatorFromTopologyRefiner`, `EvalOutputAPI`),
 * - `internal/evaluator/eval_output.h` (`VolatileEvalOutput`, `FaceVaryingVolatileEval`) for the CPU evaluator
 *   (`eval_output_cpu.h`).
 * The OpenSubdiv code it drives is ported under this folder (TOST-1.0, see `porting/opensubdiv-LICENSE.txt`).
 * Only uniform refinement is ported: adaptive refinement (`is_adaptive`, used by the Subdivision Surface modifier and
 * node) throws.
 */

import {cpuEvalPatches, cpuEvalStencils, CpuPatchTable, PatchCoord, PatchHandle} from './osdCpu'
import {createPatchTable, PatchTable, PatchType, patchNumControlVertices, patchTableOptions} from './patchTable'
import {FVarLinearInterpolation, Options, SchemeType, SHARPNESS_INFINITE, VtxBoundaryInterpolation, CreasingMethod} from './sdc'
import {createStencilTable, InterpolationMode, StencilTable, stencilTableOptions} from './stencilTable'
import {TopologyRefiner, TopologyRefinerFactory, TopologyRefinerFactoryMesh, uniformOptions} from './topologyRefiner'
import {INDEX_INVALID} from './vtrTypes'

/**
 * `OpenSubdiv_Converter` (`opensubdiv_converter_capi.hh`) as Blender's mesh converter fills it
 * (`subdiv_converter_mesh.cc:251`): the callbacks it leaves null are absent here.
 */
export interface OpenSubdivConverter {
    /** `faces`: the face offsets (`OffsetIndices<int>`), `facesNum + 1` entries. */
    faceOffsets: ArrayLike<number>
    facesNum: number
    getSchemeType(): SchemeType
    getVtxBoundaryInterpolation(): VtxBoundaryInterpolation
    getFVarLinearInterpolation(): FVarLinearInterpolation
    specifiesFullTopology(): boolean
    getNumEdges(): number
    getNumVertices(): number
    getFaceVertices(face: number, out: {set(i: number, v: number): void}): void
    getEdgeVertices(edge: number): [number, number]
    getEdgeSharpness(edge: number): number
    isInfiniteSharpVertex(vertex: number): boolean
    getVertexSharpness(vertex: number): number
    getNumUVLayers(): number
    precalcUVLayer(layer: number): void
    finishUVLayer(): void
    getNumUVCoordinates(): number
    getFaceCornerUVIndex(face: number, corner: number): number
}

/** `OpenSubdiv_TopologyRefinerSettings` (`opensubdiv_topology_refiner.hh`). */
export interface TopologyRefinerSettings {
    level: number
    isAdaptive: boolean
}

/** `TopologyRefinerImpl` (`opensubdiv_topology_refiner.hh`): the refiner and the settings it was created with. */
export interface TopologyRefinerImpl {
    topologyRefiner: TopologyRefiner
    settings: TopologyRefinerSettings
}

/** `TopologyRefinerFactory<TopologyRefinerData>` specialisations (`topology_refiner_factory.cc:26-243`). */
class ConverterRefinerData implements TopologyRefinerFactoryMesh {
    constructor(readonly converter: OpenSubdivConverter) {}

    /** `resizeComponentTopology` (:26). */
    resizeComponentTopology(refiner: TopologyRefiner, f: TopologyRefinerFactory): boolean {
        const c = this.converter
        f.setNumBaseVertices(refiner, c.getNumVertices())
        f.setNumBaseFaces(refiner, c.facesNum)
        for (let face = 0; face < c.facesNum; face++) f.setNumBaseFaceVertices(refiner, face, c.faceOffsets[face + 1] - c.faceOffsets[face])
        if (!c.specifiesFullTopology()) return true
        throw new Error('OpenSubdiv: converters that specify the full topology are not ported (Blender\'s mesh converter does not)')
    }

    /** `assignComponentTopology` (:82). */
    assignComponentTopology(refiner: TopologyRefiner, f: TopologyRefinerFactory): boolean {
        const c = this.converter
        for (let face = 0; face < c.facesNum; face++) c.getFaceVertices(face, f.getBaseFaceVertices(refiner, face))
        if (!c.specifiesFullTopology()) return true
        throw new Error('OpenSubdiv: converters that specify the full topology are not ported (Blender\'s mesh converter does not)')
    }

    /** `assignComponentTags` (:146). */
    assignComponentTags(refiner: TopologyRefiner, f: TopologyRefinerFactory): boolean {
        const c = this.converter
        const fullTopologySpecified = c.specifiesFullTopology()
        const numEdges = c.getNumEdges()
        for (let edge = 0; edge < numEdges; ++edge) {
            const sharpness = c.getEdgeSharpness(edge)
            if (sharpness < 1e-6) continue
            const ev = c.getEdgeVertices(edge)
            if (fullTopologySpecified) {
                f.setBaseEdgeSharpness(refiner, edge, sharpness)
            } else {
                const baseEdge = f.findBaseEdge(refiner, ev[0], ev[1])
                if (baseEdge === INDEX_INVALID) {
                    // `printf("OpenSubdiv Error: failed to find reconstructed edge\n")`.
                    return false
                }
                f.setBaseEdgeSharpness(refiner, baseEdge, sharpness)
            }
        }
        const numVertices = c.getNumVertices()
        const base = refiner.getVtrLevel(0)
        for (let vertex = 0; vertex < numVertices; ++vertex) {
            const vertexEdges = f.getBaseVertexEdges(refiner, vertex)
            if (c.isInfiniteSharpVertex(vertex)) {
                f.setBaseVertexSharpness(refiner, vertex, SHARPNESS_INFINITE)
                continue
            }
            let sharpness = c.getVertexSharpness(vertex)
            if (vertexEdges.size === 2) {
                const s0 = base.getEdgeSharpness(vertexEdges.get(0))
                const s1 = base.getEdgeSharpness(vertexEdges.get(1))
                sharpness = Math.fround(sharpness + Math.min(s0, s1))
                sharpness = Math.min(sharpness, 10)
            }
            f.setBaseVertexSharpness(refiner, vertex, sharpness)
        }
        return true
    }

    /** `assignFaceVaryingTopology` (:211). */
    assignFaceVaryingTopology(refiner: TopologyRefiner, f: TopologyRefinerFactory): boolean {
        const c = this.converter
        const numLayers = c.getNumUVLayers()
        if (numLayers <= 0) return true
        const numFaces = f.getNumBaseFaces(refiner)
        for (let layer = 0; layer < numLayers; ++layer) {
            c.precalcUVLayer(layer)
            const numUVs = c.getNumUVCoordinates()
            const channel = f.createBaseFVarChannel(refiner, numUVs)
            for (let face = 0; face < numFaces; ++face) {
                const dst = f.getBaseFaceFVarValues(refiner, face, channel)
                for (let corner = 0; corner < dst.size; ++corner) dst.set(corner, c.getFaceCornerUVIndex(face, corner))
            }
            c.finishUVLayer()
        }
        return true
    }
}

/** `TopologyRefinerImpl::createFromConverter` (`topology_refiner_factory.cc:283`) with `getSDCOptions` (:252). */
export function createTopologyRefinerFromConverter(converter: OpenSubdivConverter, settings: TopologyRefinerSettings): TopologyRefinerImpl | undefined {
    const options = new Options()
    options.vtxBoundaryInterpolation = converter.getVtxBoundaryInterpolation()
    options.creasingMethod = CreasingMethod.UNIFORM
    options.fvarLinearInterpolation = converter.getFVarLinearInterpolation()
    const refiner = TopologyRefinerFactory.create(new ConverterRefinerData(converter), {
        schemeType: converter.getSchemeType(), schemeOptions: options, validateFullTopology: false,
    })
    if (!refiner) return undefined
    return {topologyRefiner: refiner, settings: {...settings}}
}

// region patch_map.h / patch_map.cc

interface QuadNodeChild {
    isSet: boolean
    isLeaf: boolean
    index: number
}

class QuadNode {
    readonly children: QuadNodeChild[] = [0, 1, 2, 3].map(() => ({isSet: false, isLeaf: false, index: 0}))

    /** `SetChildren` (`patch_map.cc:31`). */
    setChildren(index: number): void {
        for (const c of this.children) {
            c.isSet = true
            c.isLeaf = true
            c.index = index
        }
    }

    /** `SetChild` (:42). */
    setChild(quadrant: number, index: number, isLeaf: boolean): void {
        const c = this.children[quadrant]
        c.isSet = true
        c.isLeaf = isLeaf
        c.index = index
    }
}

/** `transformUVToQuadQuadrant` (`patch_map.h:146`) on a mutable `[u, v]`. */
function transformUVToQuadQuadrant(median: number, uv: [number, number]): number {
    const uHalf = uv[0] >= median ? 1 : 0
    if (uHalf) uv[0] -= median
    const vHalf = uv[1] >= median ? 1 : 0
    if (vHalf) uv[1] -= median
    return (vHalf << 1) | uHalf
}

/** `blender::opensubdiv::PatchMap` (`patch_map.h:30`) for quad patches. */
export class PatchMap {
    minPatchFace = -1
    maxPatchFace = -1
    maxDepth = 0
    readonly patchesAreTriangular: boolean
    readonly handles: PatchHandle[] = []
    readonly quadtree: QuadNode[] = []

    /** `PatchMap(patchTable)` (`patch_map.cc:76`). */
    constructor(patchTable: PatchTable) {
        this.patchesAreTriangular = patchNumControlVertices(patchTable.varyingType) === 3
        if (this.patchesAreTriangular) throw new Error('OpenSubdiv: PatchMap for triangular patches (Loop) is not ported')
        if (patchTable.getNumPatchesTotal() > 0) {
            this.initializeHandles(patchTable)
            this.initializeQuadtree(patchTable)
        }
    }

    /** `initializeHandles` (:94). */
    private initializeHandles(patchTable: PatchTable): void {
        this.minPatchFace = patchTable.paramTable[0].getFaceId()
        this.maxPatchFace = this.minPatchFace
        let handleIndex = 0
        for (let pArray = 0; pArray < patchTable.getNumPatchArrays(); ++pArray) {
            const array = patchTable.patchArrays[pArray]
            const patchSize = patchNumControlVertices(array.type)
            for (let j = 0; j < array.numPatches; ++j, ++handleIndex) {
                this.handles[handleIndex] = {arrayIndex: pArray, patchIndex: handleIndex, vertIndex: j * patchSize}
                const faceId = patchTable.paramTable[array.patchIndex + j].getFaceId()
                this.minPatchFace = Math.min(this.minPatchFace, faceId)
                this.maxPatchFace = Math.max(this.maxPatchFace, faceId)
            }
        }
    }

    /** `assignLeafOrChildNode` (:56). */
    private assignLeafOrChildNode(node: QuadNode, isLeaf: boolean, quadrant: number, index: number): QuadNode {
        if (isLeaf) {
            node.setChild(quadrant, index, true)
            return node
        }
        if (node.children[quadrant].isSet) return this.quadtree[node.children[quadrant].index]
        const newChild = this.quadtree.length
        this.quadtree.push(new QuadNode())
        node.setChild(quadrant, newChild, false)
        return this.quadtree[newChild]
    }

    /** `initializeQuadtree` (:135). */
    private initializeQuadtree(patchTable: PatchTable): void {
        const nPatchFaces = this.maxPatchFace - this.minPatchFace + 1
        for (let i = 0; i < nPatchFaces; i++) this.quadtree.push(new QuadNode())
        const params = patchTable.paramTable
        for (let handle = 0; handle < this.handles.length; ++handle) {
            const param = params[handle]
            const depth = param.getDepth()
            const rootDepth = param.nonQuadRoot() ? 1 : 0
            this.maxDepth = Math.max(this.maxDepth, depth)
            let node = this.quadtree[param.getFaceId() - this.minPatchFace]
            if (depth === rootDepth) {
                node.setChildren(handle)
                continue
            }
            const u = param.getU(), v = param.getV()
            for (let j = rootDepth + 1; j <= depth; ++j) {
                const uBit = (u >> (depth - j)) & 1
                const vBit = (v >> (depth - j)) & 1
                const quadrant = (vBit << 1) | uBit
                node = this.assignLeafOrChildNode(node, j === depth, quadrant, handle)
            }
        }
    }

    /** `FindPatch` (`patch_map.h:202`): `u`, `v` are doubles. */
    findPatch(faceid: number, u: number, v: number): PatchHandle | undefined {
        if (faceid < this.minPatchFace || faceid > this.maxPatchFace) return undefined
        let node = this.quadtree[faceid - this.minPatchFace]
        if (!node.children[0].isSet) return undefined
        const uv: [number, number] = [u, v]
        let median = 0.5
        for (let depth = 0; depth <= this.maxDepth; ++depth, median *= 0.5) {
            const quadrant = transformUVToQuadQuadrant(median, uv)
            const child = node.children[quadrant]
            if (!child.isSet) throw new Error('OpenSubdiv PatchMap: quadrant not set')
            if (child.isLeaf) return this.handles[child.index]
            node = this.quadtree[child.index]
        }
        throw new Error('OpenSubdiv PatchMap: no leaf found')
    }
}

// endregion

// region evaluator_impl.cc / eval_output.h

/** `FaceVaryingVolatileEval` (`eval_output.h:186`) with the CPU evaluator. */
class FaceVaryingVolatileEval {
    readonly numCoarseFaceVaryingVertices: number
    readonly srcFaceVaryingData: Float32Array
    readonly srcFaceVaryingDesc = {offset: 0, length: 2, stride: 2}

    constructor(readonly channel: number, readonly stencils: StencilTable, faceVaryingWidth: number, readonly patchTable: CpuPatchTable) {
        this.srcFaceVaryingDesc = {offset: 0, length: faceVaryingWidth, stride: faceVaryingWidth}
        this.numCoarseFaceVaryingVertices = stencils.getNumControlVertices()
        // `EVAL_VERTEX_BUFFER::Create(2, num_total_face_varying_vertices)`.
        this.srcFaceVaryingData = new Float32Array(2 * (stencils.getNumControlVertices() + stencils.getNumStencils()))
    }

    updateData(src: ArrayLike<number>, startVertex: number, numVertices: number): void {
        this.srcFaceVaryingData.set(Array.prototype.slice.call(src, 0, numVertices * 2), startVertex * 2)
    }

    /** `refine` (:228). */
    refine(): void {
        const dst = {...this.srcFaceVaryingDesc}
        dst.offset += this.numCoarseFaceVaryingVertices * this.srcFaceVaryingDesc.stride
        cpuEvalStencils(this.srcFaceVaryingData, this.srcFaceVaryingDesc, this.srcFaceVaryingData, dst, this.stencils)
    }

    /** `evalPatches` (:243). */
    evalPatches(coords: PatchCoord[], out: Float32Array): void {
        // `get_src_varying_desc` (:285): uniform tables index face-varying values from the first refined value.
        const srcDesc = {...this.srcFaceVaryingDesc}
        srcDesc.offset += this.numCoarseFaceVaryingVertices * this.srcFaceVaryingDesc.stride
        const t = this.patchTable
        // `CpuEvaluator::EvalPatchesFaceVarying` (`cpuEvaluator.h:1019`).
        cpuEvalPatches(this.srcFaceVaryingData, srcDesc, out, {offset: 0, length: 2, stride: 2}, coords,
            t.fvarPatchArrays[this.channel], t.fvarIndexBuffers[this.channel], t.fvarParamBuffers[this.channel])
    }
}

/** `VolatileEvalOutput` (`eval_output.h:335`) as `CpuEvalOutput` (`eval_output_cpu.h`); no varying data, no vertex data. */
class CpuEvalOutput {
    readonly numCoarseVertices: number
    readonly srcData: Float32Array
    readonly srcDesc = {offset: 0, length: 3, stride: 3}
    readonly patchTable: CpuPatchTable
    readonly faceVaryingEvaluators: FaceVaryingVolatileEval[] = []

    constructor(readonly vertexStencils: StencilTable, allFaceVaryingStencils: StencilTable[], faceVaryingWidth: number, patchTable: PatchTable) {
        const numTotalVertices = vertexStencils.getNumControlVertices() + vertexStencils.getNumStencils()
        this.numCoarseVertices = vertexStencils.getNumControlVertices()
        this.srcData = new Float32Array(3 * numTotalVertices)
        this.patchTable = new CpuPatchTable(patchTable)
        allFaceVaryingStencils.forEach((s, channel) => this.faceVaryingEvaluators.push(new FaceVaryingVolatileEval(channel, s, faceVaryingWidth, this.patchTable)))
    }

    /** `updateSettings` (:404): `num_vertex_data` (orco) is never set by Subdivide Mesh. */
    updateSettings(numVertexData: number): void {
        if (numVertexData !== 0) throw new Error('OpenSubdiv evaluator: vertex data (orco) is not ported')
    }

    updateData(src: ArrayLike<number>, startVertex: number, numVertices: number): void {
        this.srcData.set(Array.prototype.slice.call(src, 0, numVertices * 3), startVertex * 3)
    }

    updateFaceVaryingData(channel: number, src: ArrayLike<number>, startVertex: number, numVertices: number): void {
        this.faceVaryingEvaluators[channel].updateData(src, startVertex, numVertices)
    }

    /** `refine` (:458): vertex stencils, then every face-varying channel (`hasVaryingData()` is false). */
    refine(): void {
        const dst = {...this.srcDesc}
        dst.offset += this.numCoarseVertices * this.srcDesc.stride
        cpuEvalStencils(this.srcData, this.srcDesc, this.srcData, dst, this.vertexStencils)
        for (const e of this.faceVaryingEvaluators) e.refine()
    }

    /** `evalPatches` (:506). */
    evalPatches(coords: PatchCoord[], out: Float32Array): void {
        const t = this.patchTable
        cpuEvalPatches(this.srcData, this.srcDesc, out, {offset: 0, length: 3, stride: 3}, coords, t.patchArrays, t.indexBuffer, t.patchParamBuffer)
    }

    evalPatchesFaceVarying(channel: number, coords: PatchCoord[], out: Float32Array): void {
        this.faceVaryingEvaluators[channel].evalPatches(coords, out)
    }
}

/** `EvalOutputAPI` (`evaluator_impl.cc:150`). */
export class EvalOutputAPI {
    private readonly p = new Float32Array(3)
    private readonly fv = new Float32Array(2)

    constructor(readonly implementation: CpuEvalOutput, readonly patchMap: PatchMap) {}

    setSettings(numVertexData: number): void {
        this.implementation.updateSettings(numVertexData)
    }

    setCoarsePositions(positions: ArrayLike<number>, startVertex: number, numVertices: number): void {
        this.implementation.updateData(positions, startVertex, numVertices)
    }

    setFaceVaryingData(channel: number, data: ArrayLike<number>, startVertex: number, numVertices: number): void {
        this.implementation.updateFaceVaryingData(channel, data, startVertex, numVertices)
    }

    refine(): void {
        this.implementation.refine()
    }

    /** `evaluateLimit` without derivatives (`evaluator_impl.cc:269`): `face_u`, `face_v` are floats. */
    evaluateLimit(ptexFace: number, u: number, v: number, out: number[]): void {
        const handle = this.patchMap.findPatch(ptexFace, u, v)
        if (!handle) throw new Error(`OpenSubdiv: no patch for ptex face ${ptexFace}`)
        this.implementation.evalPatches([{handle, s: u, t: v}], this.p)
        out[0] = this.p[0]
        out[1] = this.p[1]
        out[2] = this.p[2]
    }

    /** `evaluateFaceVarying` (`evaluator_impl.cc:319`). */
    evaluateFaceVarying(channel: number, ptexFace: number, u: number, v: number, out: number[]): void {
        const handle = this.patchMap.findPatch(ptexFace, u, v)
        if (!handle) throw new Error(`OpenSubdiv: no patch for ptex face ${ptexFace}`)
        this.implementation.evalPatchesFaceVarying(channel, [{handle, s: u, t: v}], this.fv)
        out[0] = this.fv[0]
        out[1] = this.fv[1]
    }
}

/** `OpenSubdiv_Evaluator`. */
export interface OpenSubdivEvaluator {
    evalOutput: EvalOutputAPI
}

/** `openSubdiv_createEvaluatorFromTopologyRefiner` (`evaluator_impl.cc:424`) for the CPU evaluator, without a cache. */
export function createEvaluatorFromTopologyRefiner(topologyRefiner: TopologyRefinerImpl): OpenSubdivEvaluator {
    const refiner = topologyRefiner.topologyRefiner
    const numFaceVaryingChannels = refiner.getNumFVarChannels()
    const hasFaceVaryingData = numFaceVaryingChannels !== 0
    const level = topologyRefiner.settings.level
    const isAdaptive = topologyRefiner.settings.isAdaptive
    const stencilGenerateIntermediateLevels = isAdaptive
    const stencilGenerateOffsets = true
    if (isAdaptive) throw new Error('OpenSubdiv: adaptive refinement (TopologyRefiner::RefineAdaptive) is not ported')
    refiner.refineUniform(uniformOptions(level))

    const vertexOptions = stencilTableOptions()
    vertexOptions.generateOffsets = stencilGenerateOffsets
    vertexOptions.generateIntermediateLevels = stencilGenerateIntermediateLevels
    const vertexStencils = createStencilTable(refiner, vertexOptions)

    const allFaceVaryingStencils: StencilTable[] = []
    for (let channel = 0; channel < numFaceVaryingChannels; ++channel) {
        const o = stencilTableOptions()
        o.generateOffsets = stencilGenerateOffsets
        o.generateIntermediateLevels = stencilGenerateIntermediateLevels
        o.interpolationMode = InterpolationMode.FACE_VARYING
        o.fvarChannel = channel
        allFaceVaryingStencils.push(createStencilTable(refiner, o))
    }

    // `PatchTableFactory::Options patch_options(level)`, ENDCAP_GREGORY_BASIS, `useInfSharpPatch`, FVar tables,
    // no legacy linear FVar patches. A uniform table has no local points, so the `Append*LocalPointStencilTable*`
    // calls (:508-541) return the stencil tables unchanged.
    const patchOptions = patchTableOptions(level)
    patchOptions.useInfSharpPatch = true
    patchOptions.generateFVarTables = hasFaceVaryingData
    patchOptions.generateFVarLegacyLinearPatches = false
    const patchTable = createPatchTable(refiner, patchOptions)
    if (patchTable.getLocalPointStencilTable() !== undefined) throw new Error('OpenSubdiv: local point stencils are not ported')
    if (patchTable.patchArrays.some(a => a.type !== PatchType.QUADS)) throw new Error('OpenSubdiv: only uniform QUADS patch tables are ported')

    // `face_varying_width = 2` (`evaluator_impl.cc:545`).
    const evalOutput = new CpuEvalOutput(vertexStencils, allFaceVaryingStencils, 2, patchTable)
    const patchMap = new PatchMap(patchTable)
    return {evalOutput: new EvalOutputAPI(evalOutput, patchMap)}
}

// endregion

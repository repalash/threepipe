/**
 * Port of OpenSubdiv v3_7_0 `opensubdiv/far/patchTableFactory.cpp` (Copyright 2013 Pixar): `PatchTableFactory::Create`
 * and the `PatchTableBuilder` for adaptive refiners (`BuildPatches`: `identifyPatches`, `populatePatches`, the
 * `LocalPointHelper` that turns end-cap conversion matrices into local-point stencils). Uniform refiners go to
 * `buildUniformPolygons` (`patchTable.ts`).
 * Licensed under the Tomorrow Open Source Technology License 1.0 - see `OPENSUBDIV-LICENSE.txt` in this folder.
 *
 * Not ported, and thrown on: the legacy Gregory end caps (`ENDCAP_LEGACY_GREGORY`), double-precision patches, regular
 * patches converted to another basis, and selected-face tables. Blender's evaluator uses none of them.
 */

import {FVarLinearInterpolation} from './sdc'
import {newVSpan, VSpan} from './level'
import {BasisType, PatchBuilder, PatchBuilderOptions} from './patchBuilder'
import {buildUniformPolygons, EndCapType, PatchParam, PatchTable, PatchTableOptions, PatchType, patchNumControlVertices, PtexIndices} from './patchTable'
import {SparseMatrix} from './sparseMatrix'
import {StencilTable} from './stencilTable'
import type {TopologyRefiner} from './topologyRefiner'
import {ET_BOUNDARY, INDEX_INVALID} from './vtrTypes'

/** `PatchTableFactory::Create(refiner, options)` (:1957). */
export function createPatchTable(refiner: TopologyRefiner, options: PatchTableOptions): PatchTable {
    // `options_generateNonLinearUniformPatches = false` (:438).
    if (refiner.getIsUniform()) return buildUniformPolygons(refiner, options)
    const builder = new PatchTableBuilder(refiner, options)
    builder.buildPatches()
    return builder.table
}

/** `PatchTableBuilder::PatchTuple` (:83). */
interface PatchTuple {
    faceIndex: number
    levelIndex: number
}

/** `PatchTableBuilder::PatchInfo` (:91): the float matrix only (`patchPrecisionDouble` is off). */
class PatchInfo {
    isRegular = false
    isRegSingleCrease = false
    regBoundaryMask = 0
    regSharpness = 0
    irregCornerSpans: VSpan[] = [newVSpan(), newVSpan(), newVSpan(), newVSpan()]
    paramBoundaryMask = 0
    fMatrix = new SparseMatrix()
}

/** `LocalPointHelper::Options` (:133). */
interface LocalPointOptions {
    shareLocalPoints: boolean
    reuseSourcePoints: boolean
    createStencilTable: boolean
    createVaryingTable: boolean
    doubleStencilTable: boolean
}

/** A stencil table under construction (`StencilTableReal<float>` with `_sizes`, `_indices`, `_weights` pushed to). */
class StencilTableBuilder {
    sizes: number[] = []
    indices: number[] = []
    weights: number[] = []

    /** `acquireStencilTable` (:1432): the finalized table, or undefined when empty. */
    acquire(): StencilTable | undefined {
        if (this.sizes.length === 0) return undefined
        const t = new StencilTable()
        t.numControlVertices = 0
        t.sizes = this.sizes
        t.indices = this.indices
        t.weights = Float32Array.from(this.weights)
        t.generateOffsets()
        return t
    }
}

const SHARE_CORNER = 0x10
const SHARE_EDGE_BEGIN = 0x20
const SHARE_EDGE_END = 0x40
const SHARE_EDGE = SHARE_EDGE_BEGIN | SHARE_EDGE_END
const SHARE_INDEX_MASK = 0x0f

/** `GetShareBitsPerType` (:1668). */
function getShareBitsPerType(type: PatchType): number[] | undefined {
    const linearQuadBits = [0x10, 0x11, 0x12, 0x13, SHARE_CORNER]
    const gregoryQuadBits = [0x10, 0x20, 0x43, 0, 0, 0x11, 0x21, 0x40, 0, 0, 0x12, 0x22, 0x41, 0, 0, 0x13, 0x23, 0x42, 0, 0, SHARE_CORNER | SHARE_EDGE]
    if (type === PatchType.QUADS) return linearQuadBits
    if (type === PatchType.GREGORY_BASIS) return gregoryQuadBits
    return undefined
}

/** `GetVaryingIndicesPerType` (:1615). */
function getVaryingIndicesPerType(type: PatchType): number[] | undefined {
    const linearIndices = [0, 1, 2, 3]
    const bsplineIndices = [0, 0, 1, 1, 0, 0, 1, 1, 3, 3, 2, 2, 3, 3, 2, 2]
    const boxsplineIndices = [0, 0, 1, 0, 0, 1, 1, 2, 2, 1, 2, 2]
    const gregoryIndices = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3]
    const gregoryTriIndices = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 0, 1, 2]
    switch (type) {
    case PatchType.GREGORY_BASIS: return gregoryIndices
    case PatchType.GREGORY_TRIANGLE: return gregoryTriIndices
    case PatchType.REGULAR: return bsplineIndices
    case PatchType.LOOP: return boxsplineIndices
    case PatchType.QUADS: return linearIndices
    case PatchType.TRIANGLES: return linearIndices
    default: return undefined
    }
}

/** `PatchTableBuilder::LocalPointHelper` (:129). */
class LocalPointHelper {
    private numLocalPoints = 0
    private readonly localPointOffset: number
    private sharedCornerPoints: number[][] = []
    private sharedEdgePoints: number[][] = []
    private stencilTable?: StencilTableBuilder
    private stencilTableVarying?: StencilTableBuilder

    /** `LocalPointHelper(refiner, options, fvarChannel, numLocalPointsExpected)` (:1390). */
    constructor(private readonly refiner: TopologyRefiner, private readonly options: LocalPointOptions, private readonly fvarChannel: number) {
        this.localPointOffset = fvarChannel < 0 ? refiner.getNumVerticesTotal() : refiner.getNumFVarValuesTotal(fvarChannel)
        if (options.createStencilTable) {
            if (options.doubleStencilTable) throw new Error('OpenSubdiv: double-precision local point stencils are not ported')
            // `initializeStencilTable` (:1409): the reservation estimate does not change the contents.
            this.stencilTable = new StencilTableBuilder()
            this.stencilTableVarying = options.createVaryingTable ? new StencilTableBuilder() : undefined
        }
    }

    getNumLocalPoints() { return this.numLocalPoints }
    acquireStencilTable() { return this.stencilTable?.acquire() }
    acquireStencilTableVarying() { return this.stencilTableVarying?.acquire() }

    /** `findSharedCornerPoint` (:1462). */
    private findSharedCornerPoint(levelIndex: number, vertIndex: number, localPointIndex: number): number {
        if (this.sharedCornerPoints.length === 0) {
            for (let i = 0; i < this.refiner.getNumLevels(); i++) this.sharedCornerPoints.push([])
        }
        const vertexPoints = this.sharedCornerPoints[levelIndex]
        if (vertexPoints.length === 0) {
            const level = this.refiner.getVtrLevel(levelIndex)
            const n = this.fvarChannel < 0 ? level.getNumVertices() : level.getNumFVarValues(this.fvarChannel)
            for (let i = 0; i < n; i++) vertexPoints.push(INDEX_INVALID)
        }
        if (vertexPoints[vertIndex] === INDEX_INVALID) vertexPoints[vertIndex] = localPointIndex
        return vertexPoints[vertIndex]
    }

    /** `findSharedEdgePoint` (:1487). */
    private findSharedEdgePoint(levelIndex: number, edgeIndex: number, edgeEnd: number, localPointIndex: number): number {
        if (this.sharedEdgePoints.length === 0) {
            for (let i = 0; i < this.refiner.getNumLevels(); i++) this.sharedEdgePoints.push([])
        }
        const edgePoints = this.sharedEdgePoints[levelIndex]
        if (edgePoints.length === 0) {
            const n = 2 * this.refiner.getLevel(levelIndex).getNumEdges()
            for (let i = 0; i < n; i++) edgePoints.push(INDEX_INVALID)
        }
        const k = 2 * edgeIndex + edgeEnd
        if (edgePoints[k] === INDEX_INVALID) edgePoints[k] = localPointIndex
        return edgePoints[k]
    }

    /** `appendLocalPointStencil` (:1510). */
    private appendLocalPointStencil(matrix: SparseMatrix, stencilRow: number, sourcePoints: number[], sourcePointOffset: number): void {
        const stencilSize = matrix.getRowSize(stencilRow)
        const o = matrix.rowOffset(stencilRow)
        const t = this.stencilTable!
        t.sizes.push(stencilSize)
        for (let i = 0; i < stencilSize; ++i) {
            t.weights.push(matrix.elements[o + i])
            t.indices.push(sourcePoints[matrix.columns[o + i]] + sourcePointOffset)
        }
    }

    /** `appendLocalPointStencils` (:1531). */
    private appendLocalPointStencils(matrix: SparseMatrix, sourcePoints: number[], sourcePointOffset: number): void {
        const t = this.stencilTable!
        for (let i = 0; i < matrix.getNumRows(); ++i) t.sizes.push(matrix.getRowSize(i))
        for (let i = 0; i < matrix.getNumElements(); ++i) t.indices.push(sourcePoints[matrix.columns[i]] + sourcePointOffset)
        for (let i = 0; i < matrix.getNumElements(); ++i) t.weights.push(matrix.elements[i])
    }

    /** `appendLocalPointVaryingStencil` (:1650). */
    private appendLocalPointVaryingStencil(varyingIndices: number[], patchPointIndex: number, sourcePoints: number[], sourcePointOffset: number): void {
        const varyingPoint = sourcePoints[varyingIndices[patchPointIndex]] + sourcePointOffset
        const t = this.stencilTableVarying!
        t.sizes.push(1)
        t.indices.push(varyingPoint)
        t.weights.push(1)
    }

    /** `AppendLocalPatchPoints` (:1694). */
    appendLocalPatchPoints(levelIndex: number, faceIndex: number, matrix: SparseMatrix, patchType: PatchType, sourcePoints: number[],
        sourcePointOffset: number, patchPoints: number[], patchPointsOffset: number): number {
        const numPatchPoints = matrix.getNumRows()
        const firstNewLocalPoint = this.localPointOffset + this.numLocalPoints
        let nextNewLocalPoint = firstNewLocalPoint
        const shareBitsPerPoint = this.options.shareLocalPoints ? getShareBitsPerType(patchType) : undefined
        const shareLocalPointsForThisPatch = shareBitsPerPoint !== undefined
        const varyingIndices = this.stencilTableVarying ? getVaryingIndicesPerType(patchType) : undefined
        const applyVertexStencils = this.stencilTable !== undefined
        const applyVaryingStencils = varyingIndices !== undefined
        if (!shareLocalPointsForThisPatch) {
            if (!this.options.reuseSourcePoints) {
                if (applyVertexStencils) {
                    this.appendLocalPointStencils(matrix, sourcePoints, sourcePointOffset)
                    if (applyVaryingStencils) {
                        for (let i = 0; i < numPatchPoints; ++i) this.appendLocalPointVaryingStencil(varyingIndices, i, sourcePoints, sourcePointOffset)
                    }
                }
                for (let i = 0; i < numPatchPoints; ++i) patchPoints[patchPointsOffset + i] = nextNewLocalPoint++
            } else {
                for (let i = 0; i < numPatchPoints; ++i) {
                    if (this.options.reuseSourcePoints && matrix.getRowSize(i) === 1) {
                        patchPoints[patchPointsOffset + i] = sourcePoints[matrix.columns[matrix.rowOffset(i)]] + sourcePointOffset
                        continue
                    }
                    if (applyVertexStencils) {
                        this.appendLocalPointStencil(matrix, i, sourcePoints, sourcePointOffset)
                        if (applyVaryingStencils) this.appendLocalPointVaryingStencil(varyingIndices, i, sourcePoints, sourcePointOffset)
                    }
                    patchPoints[patchPointsOffset + i] = nextNewLocalPoint++
                }
            }
        } else {
            const level = this.refiner.getVtrLevel(levelIndex)
            let fCorners: {get(i: number): number} | undefined
            let fEdges: {get(i: number): number, size: number} | undefined
            const fEdgeReversed: boolean[] = []
            const fEdgeBoundary: boolean[] = []
            const shareBitsForType = shareBitsPerPoint[numPatchPoints]
            if (shareBitsForType) {
                if (shareBitsForType & SHARE_CORNER) {
                    fCorners = this.fvarChannel < 0 ? level.getFaceVertices(faceIndex) : level.getFaceFVarValues(faceIndex, this.fvarChannel)
                }
                if (shareBitsForType & SHARE_EDGE) {
                    fEdges = level.getFaceEdges(faceIndex)
                    const fVerts = this.fvarChannel < 0 ? fCorners! : level.getFaceVertices(faceIndex)
                    const fEdgeTags: number[] = []
                    level.getFaceETags(faceIndex, fEdgeTags, this.fvarChannel)
                    for (let i = 0; i < fEdges.size; ++i) {
                        fEdgeReversed[i] = level.getEdgeVertices(fEdges.get(i)).get(0) !== fVerts.get(i)
                        fEdgeBoundary[i] = (fEdgeTags[i] & ET_BOUNDARY) !== 0
                    }
                }
            }
            for (let i = 0; i < numPatchPoints; ++i) {
                if (this.options.reuseSourcePoints && matrix.getRowSize(i) === 1) {
                    patchPoints[patchPointsOffset + i] = sourcePoints[matrix.columns[matrix.rowOffset(i)]] + sourcePointOffset
                    continue
                }
                let patchPoint = nextNewLocalPoint
                if (shareBitsPerPoint[i]) {
                    const index = shareBitsPerPoint[i] & SHARE_INDEX_MASK
                    if (shareBitsPerPoint[i] & SHARE_CORNER) {
                        patchPoint = this.findSharedCornerPoint(levelIndex, fCorners!.get(index), nextNewLocalPoint)
                    } else if (!fEdgeBoundary[index]) {
                        const edgeEnd = ((shareBitsPerPoint[i] & SHARE_EDGE_END) > 0) !== fEdgeReversed[index] ? 1 : 0
                        patchPoint = this.findSharedEdgePoint(levelIndex, fEdges!.get(index), edgeEnd, nextNewLocalPoint)
                    }
                }
                if (patchPoint === nextNewLocalPoint) {
                    if (applyVertexStencils) {
                        this.appendLocalPointStencil(matrix, i, sourcePoints, sourcePointOffset)
                        if (applyVaryingStencils) this.appendLocalPointVaryingStencil(varyingIndices, i, sourcePoints, sourcePointOffset)
                    }
                    nextNewLocalPoint++
                }
                patchPoints[patchPointsOffset + i] = patchPoint
            }
        }
        const numNewLocalPoints = nextNewLocalPoint - firstNewLocalPoint
        this.numLocalPoints += numNewLocalPoints
        return numNewLocalPoints
    }
}

/** `PatchTableBuilder` (:73) for adaptive refiners. */
class PatchTableBuilder {
    readonly table: PatchTable
    private readonly patchBuilder: PatchBuilder
    private readonly ptexIndices: PtexIndices
    private readonly fvarChannelIndices: number[] = []
    private readonly requiresLocalPoints: boolean
    private readonly requiresRegularLocalPoints: boolean
    private readonly requiresIrregularLocalPoints: boolean
    private readonly requiresSharpnessArray: boolean
    private readonly requiresFVarPatches: boolean
    private readonly requiresVaryingPatches: boolean
    private readonly requiresVaryingLocalPoints: boolean
    private readonly patches: PatchTuple[] = []
    private numRegularPatches = 0
    private numIrregularPatches = 0
    private readonly levelVertOffsets: number[] = []
    private readonly levelFVarValueOffsets: number[][] = []

    /** `PatchTableBuilder::PatchTableBuilder` (:362). */
    constructor(private readonly refiner: TopologyRefiner, private readonly options: PatchTableOptions) {
        this.ptexIndices = new PtexIndices(refiner)
        if (options.generateFVarTables) {
            for (let fvc = 0; fvc < refiner.getNumFVarChannels(); ++fvc) this.fvarChannelIndices[fvc] = fvc
        }
        if (options.endCapType === EndCapType.LEGACY_GREGORY) throw new Error('OpenSubdiv: legacy Gregory end caps (ENDCAP_LEGACY_GREGORY) are not ported')
        if (options.patchPrecisionDouble || options.fvarPatchPrecisionDouble) throw new Error('OpenSubdiv: double-precision patch tables are not ported')
        let irregBasisType: BasisType
        switch (options.endCapType) {
        case EndCapType.BILINEAR_BASIS: irregBasisType = BasisType.LINEAR; break
        case EndCapType.BSPLINE_BASIS: irregBasisType = BasisType.REGULAR; break
        case EndCapType.GREGORY_BASIS: irregBasisType = BasisType.GREGORY; break
        default: irregBasisType = BasisType.UNSPECIFIED; break
        }
        const patchOptions: PatchBuilderOptions = {
            regBasisType: BasisType.REGULAR,
            irregBasisType,
            fillMissingBoundaryPoints: true,
            approxInfSharpWithSmooth: !options.useInfSharpPatch,
            approxSmoothCornerWithSharp: options.generateLegacySharpCornerPatches,
        }
        this.patchBuilder = PatchBuilder.create(refiner, patchOptions)
        this.requiresRegularLocalPoints = patchOptions.regBasisType !== BasisType.REGULAR
        this.requiresIrregularLocalPoints = true
        this.requiresLocalPoints = this.requiresIrregularLocalPoints || this.requiresRegularLocalPoints
        this.requiresSharpnessArray = options.useSingleCreasePatch
        this.requiresFVarPatches = this.fvarChannelIndices.length > 0
        this.requiresVaryingPatches = options.generateVaryingTables
        this.requiresVaryingLocalPoints = options.generateVaryingTables && options.generateVaryingLocalPoints
        this.table = new PatchTable(refiner.getMaxValence())
        this.table.numPtexFaces = this.ptexIndices.getNumFaces()
        this.table.varyingType = this.patchBuilder.getLinearPatchType()
    }

    private getRefinerFVarChannel(fvcInTable: number) { return fvcInTable >= 0 ? this.fvarChannelIndices[fvcInTable] : -1 }

    /** `isFVarChannelLinear` (:268). */
    private isFVarChannelLinear(fvcInTable: number): boolean {
        if (this.options.generateFVarLegacyLinearPatches) return true
        return this.refiner.getFVarLinearInterpolation(this.getRefinerFVarChannel(fvcInTable)) === FVarLinearInterpolation.ALL
    }

    private doesFVarTopologyMatch(patch: PatchTuple, fvcInTable: number): boolean {
        return this.refiner.getVtrLevel(patch.levelIndex).doesFaceFVarTopologyMatch(patch.faceIndex, this.getRefinerFVarChannel(fvcInTable))
    }

    /** `identifyPatchTopology` (:462). */
    private identifyPatchTopology(patch: PatchTuple, patchInfo: PatchInfo, fvarInTable = -1): void {
        const patchLevel = patch.levelIndex
        const patchFace = patch.faceIndex
        const fvarInRefiner = this.getRefinerFVarChannel(fvarInTable)
        // The source passes the channel's index in the table here (identical to the refiner's with all channels).
        patchInfo.isRegular = this.patchBuilder.isPatchRegular(patchLevel, patchFace, fvarInTable)
        if (patchInfo.isRegular) {
            patchInfo.regBoundaryMask = this.patchBuilder.getRegularPatchBoundaryMask(patchLevel, patchFace, fvarInRefiner)
            patchInfo.isRegSingleCrease = false
            patchInfo.regSharpness = 0
            patchInfo.paramBoundaryMask = patchInfo.regBoundaryMask
            if (this.requiresSharpnessArray && patchInfo.regBoundaryMask === 0 && fvarInRefiner < 0) {
                if (patchLevel < this.options.maxIsolationLevel) {
                    const creaseInfo = this.patchBuilder.isRegularSingleCreasePatch(patchLevel, patchFace)
                    if (creaseInfo) {
                        creaseInfo.creaseSharpness = Math.min(creaseInfo.creaseSharpness, this.options.maxIsolationLevel - patchLevel)
                        patchInfo.isRegSingleCrease = true
                        patchInfo.regSharpness = creaseInfo.creaseSharpness
                        patchInfo.paramBoundaryMask = 1 << creaseInfo.creaseEdgeInFace
                    }
                }
            }
        } else if (this.requiresIrregularLocalPoints) {
            this.patchBuilder.getIrregularPatchCornerSpans(patchLevel, patchFace, patchInfo.irregCornerSpans, fvarInRefiner)
            this.patchBuilder.getIrregularPatchConversionMatrix(patchLevel, patchFace, patchInfo.irregCornerSpans, patchInfo.fMatrix)
            patchInfo.paramBoundaryMask = 0
        }
    }

    /** `assignPatchPointsAndStencils` (:535). */
    private assignPatchPointsAndStencils(patch: PatchTuple, patchInfo: PatchInfo, patchPoints: number[], patchPointsOffset: number,
        localHelper: LocalPointHelper, fvarInTable = -1): number {
        const fvarInRefiner = this.getRefinerFVarChannel(fvarInTable)
        const sourcePointOffset = fvarInTable < 0 ? this.levelVertOffsets[patch.levelIndex] : this.levelFVarValueOffsets[fvarInTable][patch.levelIndex]
        let numPatchPoints = 0
        if (patchInfo.isRegular) {
            if (!this.requiresRegularLocalPoints) {
                const points: number[] = []
                numPatchPoints = this.patchBuilder.getRegularPatchPoints(patch.levelIndex, patch.faceIndex, patchInfo.regBoundaryMask, points, fvarInRefiner)
                // `offsetIndices`: the PatchBuilder fills missing boundary points, so offset all.
                for (let i = 0; i < numPatchPoints; ++i) patchPoints[patchPointsOffset + i] = points[i] + sourcePointOffset
            } else {
                throw new Error('OpenSubdiv: regular patches converted to another basis are not ported')
            }
        } else if (this.requiresIrregularLocalPoints) {
            numPatchPoints = patchInfo.fMatrix.getNumRows()
            const sourcePoints: number[] = []
            this.patchBuilder.getIrregularPatchSourcePoints(patch.levelIndex, patch.faceIndex, patchInfo.irregCornerSpans, sourcePoints, fvarInRefiner)
            localHelper.appendLocalPatchPoints(patch.levelIndex, patch.faceIndex, patchInfo.fMatrix, this.patchBuilder.getIrregularPatchType(),
                sourcePoints, sourcePointOffset, patchPoints, patchPointsOffset)
        }
        return numPatchPoints
    }

    /** `assignFacePoints` (:635). */
    private assignFacePoints(patch: PatchTuple, patchPoints: number[], patchPointsOffset: number, fvarInTable = -1): number {
        const level = this.refiner.getVtrLevel(patch.levelIndex)
        const facePointOffset = fvarInTable < 0 ? this.levelVertOffsets[patch.levelIndex] : this.levelFVarValueOffsets[fvarInTable][patch.levelIndex]
        const fvarInRefiner = this.getRefinerFVarChannel(fvarInTable)
        const facePoints = fvarInRefiner < 0 ? level.getFaceVertices(patch.faceIndex) : level.getFaceFVarValues(patch.faceIndex, fvarInRefiner)
        for (let i = 0; i < facePoints.size; ++i) patchPoints[patchPointsOffset + i] = facePoints.get(i) + facePointOffset
        return facePoints.size
    }

    /** `BuildPatches` (:892). */
    buildPatches(): void {
        this.identifyPatches()
        this.populatePatches()
    }

    /** `appendPatch` (:904). */
    private appendPatch(levelIndex: number, faceIndex: number): void {
        this.patches.push({faceIndex, levelIndex})
        if (this.patchBuilder.isPatchRegular(levelIndex, faceIndex)) ++this.numRegularPatches
        else ++this.numIrregularPatches
    }

    /** `identifyPatches` (:943). */
    private identifyPatches(): void {
        this.levelVertOffsets.push(0)
        for (let fvc = 0; fvc < this.fvarChannelIndices.length; ++fvc) this.levelFVarValueOffsets[fvc] = [0]
        for (let levelIndex = 0; levelIndex < this.refiner.getNumLevels(); ++levelIndex) {
            const level = this.refiner.getVtrLevel(levelIndex)
            this.levelVertOffsets.push(this.levelVertOffsets[this.levelVertOffsets.length - 1] + level.getNumVertices())
            for (let fvc = 0; fvc < this.fvarChannelIndices.length; ++fvc) {
                const refinerChannel = this.fvarChannelIndices[fvc]
                const offsets = this.levelFVarValueOffsets[fvc]
                offsets.push(offsets[offsets.length - 1] + level.getNumFVarValues(refinerChannel))
            }
        }
        // No selected faces and a non-uniform refiner: breadth first through the levels.
        for (let levelIndex = 0; levelIndex < this.refiner.getNumLevels(); ++levelIndex) {
            const numFaces = this.refiner.getVtrLevel(levelIndex).getNumFaces()
            for (let faceIndex = 0; faceIndex < numFaces; ++faceIndex) {
                if (this.patchBuilder.isFaceAPatch(levelIndex, faceIndex) && this.patchBuilder.isFaceALeaf(levelIndex, faceIndex)) {
                    this.appendPatch(levelIndex, faceIndex)
                }
            }
        }
    }

    /** `allocateFVarChannels` (:693). */
    private allocateFVarChannels(): void {
        const npatches = this.table.getNumPatchesTotal()
        for (let fvc = 0; fvc < this.fvarChannelIndices.length; ++fvc) {
            const refinerChannel = this.fvarChannelIndices[fvc]
            const interpolation = this.refiner.getFVarLinearInterpolation(refinerChannel)
            let regType = this.patchBuilder.getLinearPatchType()
            let irregType = regType
            if (!this.isFVarChannelLinear(fvc)) {
                regType = this.patchBuilder.getRegularPatchType()
                irregType = this.patchBuilder.getIrregularPatchType()
            }
            const stride = Math.max(patchNumControlVertices(regType), patchNumControlVertices(irregType))
            this.table.fvarChannels[fvc] = {interpolation, regType, irregType, stride, values: new Array<number>(npatches * stride).fill(0),
                params: new Array<PatchParam>(npatches)}
        }
    }

    /** `populatePatches` (:1011). */
    private populatePatches(): void {
        interface ArrayBuilder { patchType: PatchType, numPatches: number, iptr: number, pptr: number, sptr: number, vptr: number, fptr: number[], fpptr: number[] }
        const newArrayBuilder = (): ArrayBuilder => ({patchType: PatchType.NON_PATCH, numPatches: 0, iptr: 0, pptr: 0, sptr: 0, vptr: 0, fptr: [], fpptr: []})
        const arrayBuilders = [newArrayBuilder(), newArrayBuilder(), newArrayBuilder()]
        const ARRAY_REGULAR = 0
        let ARRAY_IRREGULAR = 1
        arrayBuilders[ARRAY_REGULAR].patchType = this.patchBuilder.getRegularPatchType()
        arrayBuilders[ARRAY_REGULAR].numPatches = this.numRegularPatches
        let numPatchArrays = this.numRegularPatches > 0 ? 1 : 0
        if (this.numIrregularPatches > 0) {
            if (this.patchBuilder.getRegularPatchType() === this.patchBuilder.getIrregularPatchType()) {
                ARRAY_IRREGULAR = ARRAY_REGULAR
                numPatchArrays = 1
            } else {
                ARRAY_IRREGULAR = numPatchArrays
                numPatchArrays++
            }
            arrayBuilders[ARRAY_IRREGULAR].patchType = this.patchBuilder.getIrregularPatchType()
            arrayBuilders[ARRAY_IRREGULAR].numPatches += this.numIrregularPatches
        }
        const voffset = {v: 0}, poffset = {v: 0}
        for (let arrayIndex = 0; arrayIndex < numPatchArrays; ++arrayIndex) {
            const ab = arrayBuilders[arrayIndex]
            this.table.pushPatchArray(ab.patchType, ab.numPatches, voffset, poffset)
        }
        // `allocateVertexTables` (:663).
        let ncvs = 0, npatches = 0
        for (let i = 0; i < this.table.getNumPatchArrays(); ++i) {
            npatches += this.table.getNumPatches(i)
            ncvs += this.table.getNumControlVertices(i)
        }
        if (ncvs !== 0 && npatches !== 0) {
            this.table.patchVerts = new Array<number>(ncvs).fill(0)
            this.table.paramTable = new Array<PatchParam>(npatches)
            if (this.requiresVaryingPatches) this.table.varyingVerts = new Array<number>(npatches * patchNumControlVertices(this.patchBuilder.getLinearPatchType())).fill(0)
            if (this.requiresSharpnessArray) this.table.sharpnessIndices = new Array<number>(npatches).fill(INDEX_INVALID)
        }
        if (this.requiresFVarPatches) this.allocateFVarChannels()
        const varyingStride = patchNumControlVertices(this.patchBuilder.getLinearPatchType())
        for (let arrayIndex = 0; arrayIndex < numPatchArrays; ++arrayIndex) {
            const ab = arrayBuilders[arrayIndex]
            const pa = this.table.patchArrays[arrayIndex]
            ab.iptr = pa.vertIndex
            ab.pptr = pa.patchIndex
            ab.sptr = pa.patchIndex
            ab.vptr = pa.patchIndex * varyingStride
            for (let fvc = 0; fvc < this.fvarChannelIndices.length; ++fvc) {
                const pidx = pa.patchIndex
                ab.fptr[fvc] = pidx * this.table.getFVarValueStride(fvc)
                ab.fpptr[fvc] = pidx
            }
        }
        let vertexLocalPointHelper: LocalPointHelper | undefined
        const fvarLocalPointHelpers: LocalPointHelper[] = []
        if (this.requiresLocalPoints) {
            const opts: LocalPointOptions = {
                createStencilTable: true,
                createVaryingTable: this.requiresVaryingLocalPoints,
                doubleStencilTable: this.options.patchPrecisionDouble,
                shareLocalPoints: this.options.shareEndCapPatchPoints,
                reuseSourcePoints: this.patchBuilder.getIrregularPatchType() === this.patchBuilder.getNativePatchType(),
            }
            vertexLocalPointHelper = new LocalPointHelper(this.refiner, opts, -1)
            if (this.requiresFVarPatches) {
                const fopts = {...opts, createStencilTable: true, createVaryingTable: false, doubleStencilTable: this.options.fvarPatchPrecisionDouble}
                for (let fvc = 0; fvc < this.fvarChannelIndices.length; ++fvc) {
                    fvarLocalPointHelpers[fvc] = new LocalPointHelper(this.refiner, fopts, this.getRefinerFVarChannel(fvc))
                }
            }
        }
        const patchInfo = new PatchInfo()
        const fvarPatchInfo = new PatchInfo()
        const fvarPrecisionMatches = this.options.patchPrecisionDouble === this.options.fvarPatchPrecisionDouble
        for (let patchIndex = 0; patchIndex < this.patches.length; ++patchIndex) {
            const patch = this.patches[patchIndex]
            this.identifyPatchTopology(patch, patchInfo)
            const ab = arrayBuilders[patchInfo.isRegular ? ARRAY_REGULAR : ARRAY_IRREGULAR]
            ab.iptr += this.assignPatchPointsAndStencils(patch, patchInfo, this.table.patchVerts, ab.iptr, vertexLocalPointHelper!)
            if (this.requiresSharpnessArray) {
                // `assignSharpnessIndex` (:48).
                let index = this.table.sharpnessValues.indexOf(patchInfo.regSharpness)
                if (index < 0) {
                    this.table.sharpnessValues.push(patchInfo.regSharpness)
                    index = this.table.sharpnessValues.length - 1
                }
                this.table.sharpnessIndices[ab.sptr++] = index
            }
            const patchParam = this.patchBuilder.computePatchParam(patch.levelIndex, patch.faceIndex, this.ptexIndices, patchInfo.isRegular,
                patchInfo.paramBoundaryMask, true)
            this.table.paramTable[ab.pptr++] = patchParam
            for (let fvc = 0; fvc < this.fvarChannelIndices.length; ++fvc) {
                const channel = this.table.fvarChannels[fvc]
                if (this.isFVarChannelLinear(fvc)) {
                    this.assignFacePoints(patch, channel.values, ab.fptr[fvc], fvc)
                    channel.params[ab.fpptr[fvc]] = patchParam
                } else {
                    const fvcTopologyMatches = fvarPrecisionMatches && this.doesFVarTopologyMatch(patch, fvc)
                    const fvcPatchInfo = fvcTopologyMatches ? patchInfo : fvarPatchInfo
                    if (!fvcTopologyMatches) this.identifyPatchTopology(patch, fvcPatchInfo, fvc)
                    this.assignPatchPointsAndStencils(patch, fvcPatchInfo, channel.values, ab.fptr[fvc], fvarLocalPointHelpers[fvc], fvc)
                    channel.params[ab.fpptr[fvc]] = PatchParam.make(patchParam.getFaceId(), patchParam.getU(), patchParam.getV(), patchParam.getDepth(),
                        patchParam.nonQuadRoot(), fvcPatchInfo.paramBoundaryMask, patchParam.getTransition(), fvcPatchInfo.isRegular)
                }
                ab.fpptr[fvc]++
                ab.fptr[fvc] += this.table.getFVarValueStride(fvc)
            }
            if (this.requiresVaryingPatches) ab.vptr += this.assignFacePoints(patch, this.table.varyingVerts, ab.vptr)
        }
        if (this.requiresLocalPoints) {
            this.table.localPointStencils = vertexLocalPointHelper!.acquireStencilTable()
            if (this.requiresVaryingLocalPoints) this.table.localPointVaryingStencils = vertexLocalPointHelper!.acquireStencilTableVarying()
            if (this.requiresFVarPatches) {
                for (let fvc = 0; fvc < this.fvarChannelIndices.length; ++fvc) {
                    this.table.localPointFaceVaryingStencils[fvc] = fvarLocalPointHelpers[fvc].acquireStencilTable()
                }
            }
        }
    }
}

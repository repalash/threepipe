/**
 * Port of OpenSubdiv v3_7_0 `opensubdiv/far/patchDescriptor.h`, `far/patchParam.h`, `far/ptexIndices.cpp`,
 * `far/patchTable.h` (the arrays a uniform table uses), `far/patchTableFactory.cpp` (`PatchTableBuilder` constructor
 * and `BuildUniformPolygons`) and `far/patchBuilder.cpp` (`ComputePatchParam`), Copyright 2013-2018 Pixar /
 * DreamWorks Animation LLC. Adaptive patches (`BuildPatches`, end caps, local points, the patch builders' basis
 * conversions) are not ported: Blender's Subdivide Mesh builds a uniform table (issue 15b, Phase A).
 * Licensed under the Tomorrow Open Source Technology License 1.0 - see `porting/opensubdiv-LICENSE.txt`.
 */

import {SchemeType, SchemeTypeTraits} from './sdc'
import type {TopologyRefiner} from './topologyRefiner'

/** `PatchDescriptor::Type` (`patchDescriptor.h:31`). */
export const enum PatchType {
    NON_PATCH = 0,
    POINTS = 1,
    LINES = 2,
    QUADS = 3,
    TRIANGLES = 4,
    LOOP = 5,
    REGULAR = 6,
    GREGORY = 7,
    GREGORY_BOUNDARY = 8,
    GREGORY_BASIS = 9,
    GREGORY_TRIANGLE = 10,
}

/** `PatchDescriptor::GetNumControlVertices` (`patchDescriptor.h:130`). */
export function patchNumControlVertices(type: PatchType): number {
    switch (type) {
    case PatchType.REGULAR: return 16
    case PatchType.LOOP: return 12
    case PatchType.QUADS: return 4
    case PatchType.GREGORY: case PatchType.GREGORY_BOUNDARY: return 4
    case PatchType.GREGORY_BASIS: return 20
    case PatchType.GREGORY_TRIANGLE: return 18
    case PatchType.TRIANGLES: return 3
    case PatchType.LINES: return 2
    case PatchType.POINTS: return 1
    default: return -1
    }
}

const pack = (value: number, width: number, offset: number) => (((value & ((1 << width) - 1)) << offset) >>> 0)
const unpack = (value: number, width: number, offset: number) => (value >>> offset) & ((1 << width) - 1)

/** `Far::PatchParam` (`patchParam.h:120`): two packed 32-bit fields. */
export class PatchParam {
    field0 = 0
    field1 = 0

    /** `Set` (:236). */
    static make(faceid: number, u: number, v: number, depth: number, nonquad: boolean, boundary: number, transition: number, regular = false): PatchParam {
        const p = new PatchParam()
        p.field0 = (pack(faceid, 28, 0) | pack(transition, 4, 28)) >>> 0
        p.field1 = (pack(u, 10, 22) | pack(v, 10, 12) | pack(boundary, 5, 7) | pack(regular ? 1 : 0, 1, 5) | pack(nonquad ? 1 : 0, 1, 4) | pack(depth, 4, 0)) >>> 0
        return p
    }

    getFaceId() { return unpack(this.field0, 28, 0) }
    getU() { return unpack(this.field1, 10, 22) }
    getV() { return unpack(this.field1, 10, 12) }
    getTransition() { return unpack(this.field0, 4, 28) }
    getBoundary() { return unpack(this.field1, 5, 7) }
    nonQuadRoot() { return unpack(this.field1, 1, 4) !== 0 }
    getDepth() { return unpack(this.field1, 4, 0) }
    isRegular() { return unpack(this.field1, 1, 5) !== 0 }
}

/** `Far::PtexIndices` (`ptexIndices.cpp:30`). */
export class PtexIndices {
    readonly ptexIndices: number[] = []

    constructor(refiner: TopologyRefiner) {
        const regFaceSize = SchemeTypeTraits.getRegularFaceSize(refiner.getSchemeType())
        const coarse = refiner.getVtrLevel(0)
        const nfaces = coarse.getNumFaces()
        let ptexID = 0
        for (let i = 0; i < nfaces; ++i) {
            this.ptexIndices[i] = ptexID
            const n = coarse.getFaceVertices(i).size
            ptexID += n === regFaceSize ? 1 : n
        }
        this.ptexIndices[nfaces] = ptexID
    }

    getNumFaces() { return this.ptexIndices[this.ptexIndices.length - 1] }
    getFaceId(f: number) { return this.ptexIndices[f] }
}

/** `PatchTable::PatchArray` (`patchTable.h`): one patch type's run of patches. */
export interface PatchArrayInfo {
    type: PatchType
    numPatches: number
    vertIndex: number
    patchIndex: number
}

/** A face-varying channel of a patch table (`PatchTable::FVarPatchChannel`). */
export interface FVarPatchChannel {
    regType: PatchType
    irregType: PatchType
    stride: number
    values: number[]
    params: PatchParam[]
}

/** `Far::PatchTable` (`patchTable.h:58`): the parts a uniform table fills. */
export class PatchTable {
    isUniformLinear = false
    numPtexFaces = 0
    patchArrays: PatchArrayInfo[] = []
    patchVerts: number[] = []
    paramTable: PatchParam[] = []
    fvarChannels: FVarPatchChannel[] = []
    varyingType: PatchType = PatchType.NON_PATCH

    constructor(readonly maxValence: number) {}

    getNumPatchArrays() { return this.patchArrays.length }
    getNumPatches(array: number) { return this.patchArrays[array].numPatches }
    getNumPatchesTotal() { return this.paramTable.length }
    getPatchArrayType(array: number) { return this.patchArrays[array].type }
    getNumControlVertices(array: number) { return this.patchArrays[array].numPatches * patchNumControlVertices(this.patchArrays[array].type) }
    getNumFVarChannels() { return this.fvarChannels.length }
    getLocalPointStencilTable(): undefined { return undefined }

    /** `pushPatchArray` (`patchTable.cpp`). */
    pushPatchArray(type: PatchType, npatches: number, voffset: {v: number}, poffset: {v: number}): void {
        this.patchArrays.push({type, numPatches: npatches, vertIndex: voffset.v, patchIndex: poffset.v})
        voffset.v += npatches * patchNumControlVertices(type)
        poffset.v += npatches
    }
}

/** `PatchTableFactory::Options` (`patchTableFactory.h:46`) - the fields Blender sets. */
export interface PatchTableOptions {
    maxIsolationLevel: number
    generateAllLevels: boolean
    includeBaseLevelIndices: boolean
    includeFVarBaseLevelIndices: boolean
    triangulateQuads: boolean
    useInfSharpPatch: boolean
    generateFVarTables: boolean
    generateFVarLegacyLinearPatches: boolean
}

export function patchTableOptions(maxIsolation = 10): PatchTableOptions {
    return {maxIsolationLevel: maxIsolation & 0xf, generateAllLevels: false, includeBaseLevelIndices: true, includeFVarBaseLevelIndices: false,
        triangulateQuads: false, useInfSharpPatch: false, generateFVarTables: false, generateFVarLegacyLinearPatches: true}
}

/** `PatchBuilder::GetLinearPatchType` for the quad schemes (`bilinearPatchBuilder.cpp`, `catmarkPatchBuilder.cpp`): QUADS. */
function linearPatchType(scheme: SchemeType): PatchType {
    if (scheme === SchemeType.LOOP) return PatchType.TRIANGLES
    return PatchType.QUADS
}

/** `PatchBuilder::ComputePatchParam` (`patchBuilder.cpp:1256`) for the quad schemes. */
export function computePatchParam(refiner: TopologyRefiner, levelIndex: number, faceIndex: number, ptexIndices: PtexIndices, isRegular = true,
    boundaryMask = 0, computeTransitionMask = false): PatchParam {
    const regFaceSize = SchemeTypeTraits.getRegularFaceSize(refiner.getSchemeType())
    if (regFaceSize === 3) throw new Error('OpenSubdiv: triangle patch parameterisation (Loop) is not ported')
    const depth = levelIndex
    let childIndexInParent = 0, u = 0, v = 0, ofs = 1
    let irregBase = refiner.getVtrLevel(depth).getFaceVertices(faceIndex).size !== regFaceSize
    let childFaceIndex = faceIndex
    for (let i = depth; i > 0; --i) {
        const refinement = refiner.getRefinement(i - 1)
        const parentLevel = refiner.getVtrLevel(i - 1)
        const parentFaceIndex = refinement.getChildFaceParentFace(childFaceIndex)
        irregBase = parentLevel.getFaceVertices(parentFaceIndex).size !== regFaceSize
        if (!irregBase) {
            childIndexInParent = refinement.getChildFaceInParentFace(childFaceIndex)
            switch (childIndexInParent) {
            case 0: break
            case 1: u += ofs; break
            case 2: u += ofs; v += ofs; break
            case 3: v += ofs; break
            }
            ofs = (ofs << 1) & 0xffff
        } else {
            const children = refinement.getFaceChildFaces(parentFaceIndex)
            for (let j = 0; j < children.size; ++j) {
                if (children.get(j) === childFaceIndex) {
                    childIndexInParent = j
                    break
                }
            }
        }
        childFaceIndex = parentFaceIndex
    }
    const baseFaceIndex = childFaceIndex
    let ptexIndex = ptexIndices.getFaceId(baseFaceIndex)
    if (irregBase) ptexIndex += childIndexInParent
    let transitionMask = 0
    if (computeTransitionMask && levelIndex < refiner.getMaxLevel()) transitionMask = refiner.getRefinement(levelIndex).getParentFaceSparseTag(faceIndex).transitional
    return PatchParam.make(ptexIndex, u, v, depth, irregBase, boundaryMask, transitionMask, isRegular)
}

/** `PatchTableFactory::Create` (`patchTableFactory.cpp:1957`): uniform refiners only. */
export function createPatchTable(refiner: TopologyRefiner, options: PatchTableOptions): PatchTable {
    if (!refiner.getIsUniform()) throw new Error('OpenSubdiv: PatchTableFactory adaptive patches (BuildPatches) are not ported')
    return buildUniformPolygons(refiner, options)
}

/** `PatchTableBuilder::BuildUniformPolygons` (`patchTableFactory.cpp:728`) after the builder constructor (:362). */
function buildUniformPolygons(refiner: TopologyRefiner, options: PatchTableOptions): PatchTable {
    const ptexIndices = new PtexIndices(refiner)
    const fvarChannelIndices: number[] = []
    if (options.generateFVarTables) for (let c = 0; c < refiner.getNumFVarChannels(); c++) fvarChannelIndices.push(c)
    const table = new PatchTable(refiner.getMaxValence())
    table.numPtexFaces = ptexIndices.getNumFaces()
    const linearType = linearPatchType(refiner.getSchemeType())
    table.varyingType = linearType
    const includeBaseLevelIndices = options.includeBaseLevelIndices
    const includeBaseLevelFVarIndices = options.includeFVarBaseLevelIndices
    const triangulateQuads = options.triangulateQuads && SchemeTypeTraits.getRegularFaceSize(refiner.getSchemeType()) === 4
    if (triangulateQuads) throw new Error('OpenSubdiv: triangulated uniform quads (triangulateQuads) are not ported')
    const maxlevel = refiner.getMaxLevel()
    const firstlevel = options.generateAllLevels ? 1 : maxlevel
    const ptype = triangulateQuads ? PatchType.TRIANGLES : linearType
    table.isUniformLinear = true
    const voffset = {v: 0}, poffset = {v: 0}
    for (let level = firstlevel; level <= maxlevel; ++level) {
        const refLevel = refiner.getLevel(level)
        let npatches = refLevel.getNumFaces()
        if (refiner.getHasHoles()) for (let i = npatches - 1; i >= 0; --i) npatches -= refLevel.isFaceHole(i) ? 1 : 0
        if (triangulateQuads) npatches *= 2
        table.pushPatchArray(ptype, npatches, voffset, poffset)
    }
    // `allocateFVarChannels` (:693).
    for (let k = 0; k < fvarChannelIndices.length; k++) {
        const regType = triangulateQuads ? PatchType.TRIANGLES : linearType
        table.fvarChannels.push({regType, irregType: regType, stride: patchNumControlVertices(regType), values: [], params: []})
    }
    let levelVertOffset = includeBaseLevelIndices ? refiner.getLevel(0).getNumVertices() : 0
    const levelFVarVertOffsets = fvarChannelIndices.map(c => (includeBaseLevelFVarIndices ? refiner.getLevel(0).getNumFVarValues(c) : 0))
    for (let level = 1; level <= maxlevel; ++level) {
        const refLevel = refiner.getLevel(level)
        const nfaces = refLevel.getNumFaces()
        if (level >= firstlevel) {
            for (let face = 0; face < nfaces; ++face) {
                if (refiner.getHasHoles() && refLevel.isFaceHole(face)) continue
                const fverts = refLevel.getFaceVertices(face)
                for (let vert = 0; vert < fverts.size; ++vert) table.patchVerts.push(levelVertOffset + fverts.get(vert))
                const pparam = computePatchParam(refiner, level, face, ptexIndices)
                table.paramTable.push(pparam)
                fvarChannelIndices.forEach((refinerChannel, fvc) => {
                    const fvalues = refLevel.getFaceFVarValues(face, refinerChannel)
                    for (let vert = 0; vert < fvalues.size; ++vert) table.fvarChannels[fvc].values.push(levelFVarVertOffsets[fvc] + fvalues.get(vert))
                    table.fvarChannels[fvc].params.push(pparam)
                })
            }
        }
        if (options.generateAllLevels) {
            levelVertOffset += refiner.getLevel(level).getNumVertices()
            fvarChannelIndices.forEach((c, fvc) => { levelFVarVertOffsets[fvc] += refiner.getLevel(level).getNumFVarValues(c) })
        }
    }
    return table
}

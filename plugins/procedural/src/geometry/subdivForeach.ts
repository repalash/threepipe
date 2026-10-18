/**
 * `bke::subdiv::foreach_subdiv_geometry` (Blender 5.2.2 `blenkernel/intern/subdiv_foreach.cc`, callbacks of
 * `BKE_subdiv_foreach.hh`): walks the topology of the subdivided mesh - corner and edge vertices first (single
 * threaded, first face wins), then per coarse face the inner vertices, edges and corners, then loose vertices,
 * vertices of loose edges and the edges along coarse edges. Blender runs the per-face/per-element passes in
 * parallel; every callback writes only its own elements, so running them in order gives the same mesh.
 * The `use_optimal_display` setting only tags edges (`subdiv_mesh.cc`) and is not used here.
 */

import {MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import type {Subdiv} from './subdiv'
import {facePtexOffsetGet} from './subdiv'

/** `ORIGINDEX_NONE`. */
export const ORIGINDEX_NONE = -1

/** `bke::subdiv::ToMeshSettings` (`BKE_subdiv_mesh.hh`). */
export interface ToMeshSettings {
    resolution: number
    useOptimalDisplay: boolean
}

/** `ForeachContext` (`BKE_subdiv_foreach.hh:107`); `tls` is the per-task `SubdivMeshTLS`-like state. */
export interface ForeachContext<TLS> {
    topologyInfo?(numVertices: number, numEdges: number, numLoops: number, numFaces: number, subdivFaceOffset: Int32Array): boolean
    vertEveryCorner?(tls: TLS, ptexFace: number, u: number, v: number, coarseVert: number, coarseFace: number, coarseCorner: number, subdivVert: number): void
    vertEveryEdge?(tls: TLS, ptexFace: number, u: number, v: number, coarseEdge: number, coarseFace: number, coarseCorner: number, subdivVert: number): void
    vertCorner?(tls: TLS, ptexFace: number, u: number, v: number, coarseVert: number, coarseFace: number, coarseCorner: number, subdivVert: number): void
    vertEdge?(tls: TLS, ptexFace: number, u: number, v: number, coarseEdge: number, coarseFace: number, coarseCorner: number, subdivVert: number): void
    vertInner?(tls: TLS, ptexFace: number, u: number, v: number, coarseFace: number, coarseCorner: number, subdivVert: number): void
    vertLoose?(tls: TLS, coarseVert: number, subdivVert: number): void
    vertOfLooseEdge?(tls: TLS, coarseEdge: number, u: number, subdivVert: number): void
    edge?(tls: TLS, coarseEdge: number, subdivEdge: number, isLoose: boolean, v1: number, v2: number): void
    loop?(tls: TLS, ptexFace: number, u: number, v: number, coarseLoop: number, coarseFace: number, coarseCorner: number,
        subdivLoop: number, subdivVert: number, subdivEdge: number): void
    faces?(subdivFaceOffset: Int32Array): void
    /** A fresh copy of the initial TLS (`user_data_tls`), one per task. */
    makeTLS(): TLS
}

// region inline helpers (`subdiv_foreach.cc:29-57`)
const numPtexFacesPerFace = (size: number) => (size === 4 ? 1 : size)
const numEdgesPerPtexFace = (resolution: number) => 2 * (resolution - 1) * resolution
const numInnerEdgesPerPtexFace = (resolution: number) => (resolution < 2 ? 0 : (resolution - 2) * resolution + (resolution - 1) * (resolution - 1))
const numFacesPerPtex = (resolution: number) => (resolution - 1) * (resolution - 1)
const ptexFaceResolution = (size: number, resolution: number) => (size === 4 ? resolution : (resolution >> 1) + 1)
// endregion

/** `ForeachTaskContext` (`subdiv_foreach.cc:65`). */
class ForeachTaskContext<TLS> {
    readonly coarseEdges: Int32Array
    readonly faces: Int32Array
    readonly cornerVerts: Int32Array
    readonly cornerEdges: Int32Array
    numSubdivVertices = 0
    numSubdivEdges = 0
    numSubdivLoops = 0
    numSubdivFaces = 0
    verticesCornerOffset = 0
    verticesEdgeOffset = 0
    verticesInnerOffset = 0
    edgeBoundaryOffset = 0
    edgeInnerOffset = 0
    readonly subdivVertOffset: Int32Array
    readonly subdivEdgeOffset: Int32Array
    readonly subdivFaceOffset: Int32Array
    readonly facePtexOffset: Int32Array
    readonly coarseVerticesUsedMap: Uint8Array
    readonly coarseEdgesUsedMap: Uint8Array

    /** `subdiv_foreach_ctx_init` (:245). */
    constructor(subdiv: Subdiv, readonly coarse: MeshData, readonly settings: ToMeshSettings, readonly fc: ForeachContext<TLS>) {
        this.coarseEdges = coarse.edgeVerts
        this.faces = coarse.faceOffsets
        this.cornerVerts = coarse.cornerVerts
        this.cornerEdges = coarse.cornerEdges
        this.coarseVerticesUsedMap = new Uint8Array(coarse.vertsNum)
        this.coarseEdgesUsedMap = new Uint8Array(coarse.edgesNum)
        this.subdivVertOffset = new Int32Array(coarse.facesNum)
        this.subdivEdgeOffset = new Int32Array(coarse.facesNum)
        this.subdivFaceOffset = new Int32Array(coarse.facesNum + 1)
        this.initOffsets()
        this.count()
        this.facePtexOffset = facePtexOffsetGet(subdiv)
    }

    faceSize(f: number) { return this.faces[f + 1] - this.faces[f] }

    /** `subdiv_foreach_ctx_count` (:147). */
    private count(): void {
        const resolution = this.settings.resolution
        const noQuadPatchResolution = (resolution >> 1) + 1
        const numSubdivVerticesPerCoarseEdge = resolution - 2
        const numInnerVerticesPerQuad = (resolution - 2) * (resolution - 2)
        const numInnerVerticesPerNoquadPatch = (noQuadPatchResolution - 2) * (noQuadPatchResolution - 2)
        const coarse = this.coarse
        this.numSubdivVertices = coarse.vertsNum
        this.numSubdivEdges = coarse.edgesNum * (numSubdivVerticesPerCoarseEdge + 1)
        for (let f = 0; f < coarse.facesNum; f++) {
            const size = this.faceSize(f)
            const numPtex = numPtexFacesPerFace(size)
            if (numPtex === 1) {
                this.numSubdivVertices += numInnerVerticesPerQuad
                this.numSubdivEdges += numEdgesPerPtexFace(resolution - 2) + 4 * numSubdivVerticesPerCoarseEdge
                this.numSubdivFaces += numFacesPerPtex(resolution)
            } else {
                this.numSubdivVertices += 1 + numPtex * (noQuadPatchResolution - 2) + numPtex * numInnerVerticesPerNoquadPatch
                this.numSubdivEdges += numPtex * (numInnerEdgesPerPtexFace(noQuadPatchResolution - 1) + (noQuadPatchResolution - 2) + numSubdivVerticesPerCoarseEdge)
                if (noQuadPatchResolution >= 3) this.numSubdivEdges += size
                this.numSubdivFaces += numPtex * numFacesPerPtex(noQuadPatchResolution)
            }
        }
        this.numSubdivVertices += numSubdivVerticesPerCoarseEdge * coarse.edgesNum
        this.numSubdivLoops = this.numSubdivFaces * 4
    }

    /** `subdiv_foreach_ctx_init_offsets` (:196). */
    private initOffsets(): void {
        const coarse = this.coarse
        const resolution = this.settings.resolution
        const resolution2 = resolution - 2
        const resolution2Squared = resolution2 * resolution2
        const noQuadPatchResolution = (resolution >> 1) + 1
        const numIrregularVerticesPerPatch = (noQuadPatchResolution - 2) * (noQuadPatchResolution - 1)
        const numSubdivVerticesPerCoarseEdge = resolution - 2
        const numSubdivEdgesPerCoarseEdge = resolution - 1
        this.verticesCornerOffset = 0
        this.verticesEdgeOffset = coarse.vertsNum
        this.verticesInnerOffset = this.verticesEdgeOffset + coarse.edgesNum * numSubdivVerticesPerCoarseEdge
        this.edgeBoundaryOffset = 0
        this.edgeInnerOffset = this.edgeBoundaryOffset + coarse.edgesNum * numSubdivEdgesPerCoarseEdge
        let vertOffset = 0, edgeOffset = 0, faceOffset = 0
        for (let f = 0; f < coarse.facesNum; f++) {
            const size = this.faceSize(f)
            const numPtex = numPtexFacesPerFace(size)
            this.subdivVertOffset[f] = vertOffset
            this.subdivEdgeOffset[f] = edgeOffset
            this.subdivFaceOffset[f] = faceOffset
            if (numPtex === 1) {
                vertOffset += resolution2Squared
                edgeOffset += numEdgesPerPtexFace(resolution - 2) + 4 * numSubdivVerticesPerCoarseEdge
                faceOffset += numFacesPerPtex(resolution)
            } else {
                vertOffset += 1 + numPtex * numIrregularVerticesPerPatch
                edgeOffset += numPtex * (numInnerEdgesPerPtexFace(noQuadPatchResolution - 1) + (noQuadPatchResolution - 2) + numSubdivVerticesPerCoarseEdge)
                if (noQuadPatchResolution >= 3) edgeOffset += size
                faceOffset += numPtex * numFacesPerPtex(noQuadPatchResolution)
            }
        }
        this.subdivFaceOffset[coarse.facesNum] = faceOffset
    }

    /** `BLI_BITMAP_TEST_AND_SET_ATOMIC`. */
    static testAndSet(map: Uint8Array, i: number): boolean {
        const was = map[i] !== 0
        map[i] = 1
        return was
    }
}

type VertCornerCb<TLS> = NonNullable<ForeachContext<TLS>['vertCorner']>
type VertEdgeCb<TLS> = NonNullable<ForeachContext<TLS>['vertEdge']>

const CORNER_WEIGHTS = [[0, 0], [1, 0], [1, 1], [0, 1]]

/** `subdiv_foreach_corner_vertices_regular_do` (:276). */
function cornerVerticesRegularDo<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, face: number, cb: VertCornerCb<TLS>, checkUsage: boolean): void {
    const start = ctx.faces[face], size = ctx.faceSize(face)
    const ptex = ctx.facePtexOffset[face]
    for (let corner = 0; corner < size; corner++) {
        const coarseVert = ctx.cornerVerts[start + corner]
        if (checkUsage && ForeachTaskContext.testAndSet(ctx.coarseVerticesUsedMap, coarseVert)) continue
        cb(tls, ptex, CORNER_WEIGHTS[corner][0], CORNER_WEIGHTS[corner][1], coarseVert, face, 0, ctx.verticesCornerOffset + coarseVert)
    }
}

/** `subdiv_foreach_corner_vertices_special_do` (:315). */
function cornerVerticesSpecialDo<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, face: number, cb: VertCornerCb<TLS>, checkUsage: boolean): void {
    const start = ctx.faces[face], size = ctx.faceSize(face)
    let ptex = ctx.facePtexOffset[face]
    for (let corner = 0; corner < size; corner++, ptex++) {
        const coarseVert = ctx.cornerVerts[start + corner]
        if (checkUsage && ForeachTaskContext.testAndSet(ctx.coarseVerticesUsedMap, coarseVert)) continue
        cb(tls, ptex, 0, 0, coarseVert, face, corner, ctx.verticesCornerOffset + coarseVert)
    }
}

/** `subdiv_foreach_corner_vertices` (:351) / `subdiv_foreach_every_corner_vertices` (:379). */
function cornerVertices<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, face: number, cb: VertCornerCb<TLS>, checkUsage: boolean): void {
    if (ctx.faceSize(face) === 4) cornerVerticesRegularDo(ctx, tls, face, cb, checkUsage)
    else cornerVerticesSpecialDo(ctx, tls, face, cb, checkUsage)
}

/** `subdiv_foreach_edge_vertices_regular_do` (:397). */
function edgeVerticesRegularDo<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, face: number, cb: VertEdgeCb<TLS>, checkUsage: boolean): void {
    const start = ctx.faces[face], size = ctx.faceSize(face)
    const resolution = ctx.settings.resolution
    const invResolution1 = f32(1 / (resolution - 1))
    const numSubdivVerticesPerCoarseEdge = resolution - 2
    const ptex = ctx.facePtexOffset[face]
    for (let corner = 0; corner < size; corner++) {
        const coarseVert = ctx.cornerVerts[start + corner]
        const coarseEdge = ctx.cornerEdges[start + corner]
        if (checkUsage && ForeachTaskContext.testAndSet(ctx.coarseEdgesUsedMap, coarseEdge)) continue
        const flip = ctx.coarseEdges[coarseEdge * 2 + 1] === coarseVert
        let subdivVert = ctx.verticesEdgeOffset + coarseEdge * numSubdivVerticesPerCoarseEdge
        for (let vi = 0; vi < numSubdivVerticesPerCoarseEdge; vi++, subdivVert++) {
            let fac = f32((vi + 1) * invResolution1)
            if (flip) fac = f32(1 - fac)
            if (corner >= 2) fac = f32(1 - fac)
            let u: number, v: number
            if ((corner & 1) === 0) {
                u = fac
                v = corner === 2 ? 1 : 0
            } else {
                u = corner === 1 ? 1 : 0
                v = fac
            }
            cb(tls, ptex, u, v, coarseEdge, face, 0, subdivVert)
        }
    }
}

/** `subdiv_foreach_edge_vertices_special_do` (:461). */
function edgeVerticesSpecialDo<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, face: number, cb: VertEdgeCb<TLS>, checkUsage: boolean): void {
    const start = ctx.faces[face], size = ctx.faceSize(face)
    const resolution = ctx.settings.resolution
    const numSubdivVerticesPerCoarseEdge = resolution - 2
    const numVerticesPerPtexEdge = (resolution >> 1) + 1
    const invPtexResolution1 = f32(1 / (numVerticesPerPtexEdge - 1))
    const ptexStart = ctx.facePtexOffset[face]
    let ptex = ptexStart
    for (let corner = 0; corner < size; corner++, ptex++) {
        const coarseVert = ctx.cornerVerts[start + corner]
        const coarseEdge = ctx.cornerEdges[start + corner]
        if (checkUsage && ForeachTaskContext.testAndSet(ctx.coarseEdgesUsedMap, coarseEdge)) continue
        const flip = ctx.coarseEdges[coarseEdge * 2 + 1] === coarseVert
        let subdivVert = ctx.verticesEdgeOffset + coarseEdge * numSubdivVerticesPerCoarseEdge
        let vertDelta = 1
        if (flip) {
            subdivVert += numSubdivVerticesPerCoarseEdge - 1
            vertDelta = -1
        }
        for (let vi = 1; vi < numVerticesPerPtexEdge; vi++, subdivVert += vertDelta) {
            const u = f32(vi * invPtexResolution1)
            cb(tls, ptex, u, 0, coarseEdge, face, corner, subdivVert)
        }
        const nextCorner = (corner + 1) % size
        const nextPtex = ptexStart + nextCorner
        for (let vi = 1; vi < numVerticesPerPtexEdge - 1; vi++, subdivVert += vertDelta) {
            const v = f32(1 - f32(vi * invPtexResolution1))
            cb(tls, nextPtex, 0, v, coarseEdge, face, nextCorner, subdivVert)
        }
    }
}

/** `subdiv_foreach_edge_vertices` (:532) / `subdiv_foreach_every_edge_vertices` (:560). */
function edgeVertices<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, face: number, cb: VertEdgeCb<TLS>, checkUsage: boolean): void {
    if (ctx.faceSize(face) === 4) edgeVerticesRegularDo(ctx, tls, face, cb, checkUsage)
    else edgeVerticesSpecialDo(ctx, tls, face, cb, checkUsage)
}

/** `subdiv_foreach_inner_vertices_regular` (:578). */
function innerVerticesRegular<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, face: number): void {
    const resolution = ctx.settings.resolution
    const invResolution1 = f32(1 / (resolution - 1))
    const ptex = ctx.facePtexOffset[face]
    let subdivVert = ctx.verticesInnerOffset + ctx.subdivVertOffset[face]
    for (let y = 1; y < resolution - 1; y++) {
        const v = f32(y * invResolution1)
        for (let x = 1; x < resolution - 1; x++, subdivVert++) {
            const u = f32(x * invResolution1)
            ctx.fc.vertInner!(tls, ptex, u, v, face, 0, subdivVert)
        }
    }
}

/** `subdiv_foreach_inner_vertices_special` (:603). */
function innerVerticesSpecial<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, face: number): void {
    const resolution = ctx.settings.resolution
    const size = ctx.faceSize(face)
    const ptexRes = ptexFaceResolution(size, resolution)
    const inv = f32(1 / (ptexRes - 1))
    let ptex = ctx.facePtexOffset[face]
    let subdivVert = ctx.verticesInnerOffset + ctx.subdivVertOffset[face]
    ctx.fc.vertInner!(tls, ptex, 1, 1, face, 0, subdivVert)
    subdivVert++
    for (let corner = 0; corner < size; corner++, ptex++) {
        for (let y = 1; y < ptexRes - 1; y++) {
            const v = f32(y * inv)
            for (let x = 1; x < ptexRes; x++, subdivVert++) {
                const u = f32(x * inv)
                ctx.fc.vertInner!(tls, ptex, u, v, face, corner, subdivVert)
            }
        }
    }
}

/** `subdiv_foreach_vertices` (:654). */
function foreachVertices<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, face: number): void {
    if (!ctx.fc.vertInner) return
    if (ctx.faceSize(face) === 4) innerVerticesRegular(ctx, tls, face)
    else innerVerticesSpecial(ctx, tls, face)
}

/** `subdiv_foreach_edges_row` (:668). */
function edgesRow<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, coarseEdge: number, startSubdivEdge: number, startVert: number, numEdgesPerRow: number): number {
    let subdivEdge = startSubdivEdge
    let vert = startVert
    for (let e = 0; e < numEdgesPerRow - 1; e++, subdivEdge++) {
        ctx.fc.edge!(tls, coarseEdge, subdivEdge, false, vert, vert + 1)
        vert += 1
    }
    return subdivEdge
}

/** `subdiv_foreach_edges_column` (:688). */
function edgesColumn<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, coarseStartEdge: number, coarseEndEdge: number, startSubdivEdge: number,
    startVert: number, numEdgesPerRow: number): number {
    let subdivEdge = startSubdivEdge
    let vert = startVert
    for (let e = 0; e < numEdgesPerRow; e++, subdivEdge++) {
        let coarseEdge = ORIGINDEX_NONE
        if (e === 0) coarseEdge = coarseStartEdge
        else if (e === numEdgesPerRow - 1) coarseEdge = coarseEndEdge
        ctx.fc.edge!(tls, coarseEdge, subdivEdge, false, vert, vert + numEdgesPerRow)
        vert += 1
    }
    return subdivEdge
}

/** `subdiv_foreach_edges_all_patches_regular` (:733). */
function edgesAllPatchesRegular<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, face: number): void {
    const start = ctx.faces[face], size = ctx.faceSize(face)
    const resolution = ctx.settings.resolution
    const startVert = ctx.verticesInnerOffset + ctx.subdivVertOffset[face]
    const numSubdivVerticesPerCoarseEdge = resolution - 2
    let subdivEdge = ctx.edgeInnerOffset + ctx.subdivEdgeOffset[face]
    subdivEdge = edgesRow(ctx, tls, ORIGINDEX_NONE, subdivEdge, startVert, resolution - 2)
    for (let row = 0; row < resolution - 3; row++) {
        const startRowVert = startVert + row * (resolution - 2)
        subdivEdge = edgesColumn(ctx, tls, ORIGINDEX_NONE, ORIGINDEX_NONE, subdivEdge, startRowVert, resolution - 2)
        subdivEdge = edgesRow(ctx, tls, ORIGINDEX_NONE, subdivEdge, startRowVert + resolution - 2, resolution - 2)
    }
    for (let corner = 0; corner < size; corner++) {
        const coarseVert = ctx.cornerVerts[start + corner]
        const coarseEdge = ctx.cornerEdges[start + corner]
        const startEdgeVert = ctx.verticesEdgeOffset + coarseEdge * numSubdivVerticesPerCoarseEdge
        const flip = ctx.coarseEdges[coarseEdge * 2 + 1] === coarseVert
        let sideStart = startVert
        let sideStride = 0
        if (corner === 0) {
            sideStride = 1
        } else if (corner === 1) {
            sideStart += resolution - 3
            sideStride = resolution - 2
        } else if (corner === 2) {
            sideStart += numSubdivVerticesPerCoarseEdge * numSubdivVerticesPerCoarseEdge - 1
            sideStride = -1
        } else if (corner === 3) {
            sideStart += numSubdivVerticesPerCoarseEdge * (numSubdivVerticesPerCoarseEdge - 1)
            sideStride = -(resolution - 2)
        }
        for (let i = 0; i < resolution - 2; i++, subdivEdge++) {
            const v1 = flip ? startEdgeVert + (resolution - i - 3) : startEdgeVert + i
            const v2 = sideStart + sideStride * i
            ctx.fc.edge!(tls, ORIGINDEX_NONE, subdivEdge, false, v1, v2)
        }
    }
}

/** `subdiv_foreach_edges_all_patches_special` (:811). */
function edgesAllPatchesSpecial<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, face: number): void {
    const resolution = ctx.settings.resolution
    const start = ctx.faces[face], size = ctx.faceSize(face)
    const ptexRes = ptexFaceResolution(size, resolution)
    const ptexInner = ptexRes - 2
    const numInnerVerticesPerPtex = (ptexRes - 1) * (ptexRes - 2)
    const numSubdivVerticesPerCoarseEdge = resolution - 2
    const centerVert = ctx.verticesInnerOffset + ctx.subdivVertOffset[face]
    const startVert = centerVert + 1
    let subdivEdge = ctx.edgeInnerOffset + ctx.subdivEdgeOffset[face]
    for (let corner = 0; corner < size; corner++) {
        const startPtexFaceVert = startVert + corner * numInnerVerticesPerPtex
        subdivEdge = edgesRow(ctx, tls, ORIGINDEX_NONE, subdivEdge, startPtexFaceVert, ptexInner + 1)
        for (let row = 0; row < ptexInner - 1; row++) {
            const startRowVert = startPtexFaceVert + row * (ptexInner + 1)
            subdivEdge = edgesColumn(ctx, tls, ORIGINDEX_NONE, ORIGINDEX_NONE, subdivEdge, startRowVert, ptexInner + 1)
            subdivEdge = edgesRow(ctx, tls, ORIGINDEX_NONE, subdivEdge, startRowVert + ptexInner + 1, ptexInner + 1)
        }
    }
    for (let corner = 0; corner < size; corner++) {
        const nextCorner = (corner + 1) % size
        let currentPatchVert = startVert + corner * numInnerVerticesPerPtex + ptexInner
        let nextPatchVert = startVert + nextCorner * numInnerVerticesPerPtex + numInnerVerticesPerPtex - ptexRes + 1
        for (let row = 0; row < ptexInner; row++, subdivEdge++) {
            ctx.fc.edge!(tls, ORIGINDEX_NONE, subdivEdge, false, currentPatchVert, nextPatchVert)
            currentPatchVert += ptexInner + 1
            nextPatchVert += 1
        }
    }
    if (ptexRes >= 3) {
        for (let corner = 0; corner < size; corner++, subdivEdge++) {
            const currentPatchEndVert = startVert + corner * numInnerVerticesPerPtex + numInnerVerticesPerPtex - 1
            ctx.fc.edge!(tls, ORIGINDEX_NONE, subdivEdge, false, centerVert, currentPatchEndVert)
        }
    }
    let prevCorner = size - 1
    for (let corner = 0; corner < size; corner++) {
        const coarseVert = ctx.cornerVerts[start + corner]
        const coarseEdgeI = ctx.cornerEdges[start + corner]
        const coarsePrevEdge = ctx.cornerEdges[start + prevCorner]
        {
            const startEdgeVert = ctx.verticesEdgeOffset + coarseEdgeI * numSubdivVerticesPerCoarseEdge
            const flip = ctx.coarseEdges[coarseEdgeI * 2 + 1] === coarseVert
            const sideStart = ptexRes >= 3 ? startVert + numInnerVerticesPerPtex * corner : centerVert
            for (let i = 0; i < ptexRes - 1; i++, subdivEdge++) {
                const v1 = flip ? startEdgeVert + (resolution - i - 3) : startEdgeVert + i
                ctx.fc.edge!(tls, ORIGINDEX_NONE, subdivEdge, false, v1, sideStart + i)
            }
        }
        if (ptexRes >= 3) {
            const startEdgeVert = ctx.verticesEdgeOffset + coarsePrevEdge * numSubdivVerticesPerCoarseEdge
            const flip = ctx.coarseEdges[coarsePrevEdge * 2 + 1] === coarseVert
            const sideStart = startVert + numInnerVerticesPerPtex * corner
            for (let i = 0; i < ptexRes - 2; i++, subdivEdge++) {
                const v1 = flip ? startEdgeVert + (resolution - i - 3) : startEdgeVert + i
                ctx.fc.edge!(tls, ORIGINDEX_NONE, subdivEdge, false, v1, sideStart + (ptexInner + 1) * i)
            }
        }
        prevCorner = corner
    }
}

/** `subdiv_foreach_edges` (:936). */
function foreachEdges<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, face: number): void {
    if (ctx.faceSize(face) === 4) edgesAllPatchesRegular(ctx, tls, face)
    else edgesAllPatchesSpecial(ctx, tls, face)
}

/** `subdiv_foreach_boundary_edges` (:941). */
function boundaryEdges<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, coarseEdge: number): void {
    const resolution = ctx.settings.resolution
    const numSubdivVerticesPerCoarseEdge = resolution - 2
    const numSubdivEdgesPerCoarseEdge = resolution - 1
    const isLoose = !ctx.coarseEdgesUsedMap[coarseEdge]
    let subdivEdge = ctx.edgeBoundaryOffset + coarseEdge * numSubdivEdgesPerCoarseEdge
    let lastVert = ctx.verticesCornerOffset + ctx.coarseEdges[coarseEdge * 2]
    for (let i = 0; i < numSubdivEdgesPerCoarseEdge - 1; i++, subdivEdge++) {
        const v2 = ctx.verticesEdgeOffset + coarseEdge * numSubdivVerticesPerCoarseEdge + i
        ctx.fc.edge!(tls, coarseEdge, subdivEdge, isLoose, lastVert, v2)
        lastVert = v2
    }
    ctx.fc.edge!(tls, coarseEdge, subdivEdge, isLoose, lastVert, ctx.verticesCornerOffset + ctx.coarseEdges[coarseEdge * 2 + 1])
}

/** `rotate_indices` (:974). */
function rotateIndices(rot: number, a: number, b: number, c: number, d: number): [number, number, number, number] {
    const values = [a, b, c, d]
    return [values[(0 - rot + 4) % 4], values[(1 - rot + 4) % 4], values[(2 - rot + 4) % 4], values[(3 - rot + 4) % 4]]
}

/** `subdiv_foreach_loops_of_face` (:983). */
function loopsOfFace<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, subdivLoopStart: number, ptex: number, face: number, coarseCorner: number,
    rotation: number, v0: number, e0: number, v1: number, e1: number, v2: number, e2: number, v3: number, e3: number,
    u: number, v: number, du: number, dv: number): void {
    const vs = rotateIndices(rotation, v0, v1, v2, v3)
    const es = rotateIndices(rotation, e0, e1, e2, e3)
    const loop = ctx.fc.loop!
    const ud = f32(u + du), vd = f32(v + dv)
    loop(tls, ptex, u, v, ORIGINDEX_NONE, face, coarseCorner, subdivLoopStart + 0, vs[0], es[0])
    loop(tls, ptex, ud, v, ORIGINDEX_NONE, face, coarseCorner, subdivLoopStart + 1, vs[1], es[1])
    loop(tls, ptex, ud, vd, ORIGINDEX_NONE, face, coarseCorner, subdivLoopStart + 2, vs[2], es[2])
    loop(tls, ptex, u, vd, ORIGINDEX_NONE, face, coarseCorner, subdivLoopStart + 3, vs[3], es[3])
}

/** `subdiv_foreach_loops_corner_index` (:1051). */
function loopsCornerIndex(u: number, v: number, du: number, dv: number): number {
    if (f32(u + du) <= 0.5 && f32(v + dv) <= 0.5) return 0
    if (u >= 0.5 && f32(v + dv) <= 0.5) return 1
    if (u >= 0.5 && v >= 0.5) return 2
    return 3
}

/** `subdiv_foreach_loops_regular` (:1068). */
function loopsRegular<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, face: number): void {
    const resolution = ctx.settings.resolution
    const start = ctx.faces[face], size = ctx.faceSize(face)
    const ptexRes = ptexFaceResolution(size, resolution)
    const ptexInner = ptexRes - 2
    const numSubdivEdgesPerCoarseEdge = resolution - 1
    const numSubdivVerticesPerCoarseEdge = resolution - 2
    const inv = f32(1 / (ptexRes - 1))
    const ptex = ctx.facePtexOffset[face]
    const startVert = ctx.verticesInnerOffset + ctx.subdivVertOffset[face]
    const startEdge = ctx.edgeInnerOffset + ctx.subdivEdgeOffset[face]
    const startLoop = 4 * ctx.subdivFaceOffset[face]
    const du = inv, dv = inv
    let loop = startLoop
    for (let y = 1; y < ptexRes - 2; y++) {
        const v = f32(y * inv)
        const innerY = y - 1
        for (let x = 1; x < ptexRes - 2; x++, loop += 4) {
            const innerX = x - 1
            const u = f32(x * inv)
            const v0 = startVert + (innerY * ptexInner + innerX)
            const v1 = v0 + 1
            const v2 = v0 + ptexInner + 1
            const v3 = v0 + ptexInner
            const e0 = startEdge + (innerY * (2 * ptexInner - 1) + innerX)
            const e1 = e0 + ptexInner
            const e2 = e0 + (2 * ptexInner - 1)
            const e3 = e0 + ptexInner - 1
            loopsOfFace(ctx, tls, loop, ptex, face, loopsCornerIndex(u, v, du, dv), 0, v0, e0, v1, e1, v2, e2, v3, e3, u, v, du, dv)
        }
    }
    let prevCorner = size - 1
    for (let corner = 0; corner < size; corner++) {
        const coarseVert = ctx.cornerVerts[start + corner]
        const coarseEdgeI = ctx.cornerEdges[start + corner]
        const coarsePrevVert = ctx.cornerVerts[start + prevCorner]
        const coarsePrevEdge = ctx.cornerEdges[start + prevCorner]
        const startEdgeVert = ctx.verticesEdgeOffset + coarseEdgeI * numSubdivVerticesPerCoarseEdge
        const flip = ctx.coarseEdges[coarseEdgeI * 2 + 1] === coarseVert
        let sideStart = startVert
        let sideStride = 0
        let v0 = ctx.verticesCornerOffset + coarseVert
        let v3: number, e3: number
        let e2Offset = 0, e2Stride = 0
        let u = 0, v = 0, deltaU = 0, deltaV = 0
        if (coarsePrevVert === ctx.coarseEdges[coarsePrevEdge * 2]) {
            v3 = ctx.verticesEdgeOffset + coarsePrevEdge * numSubdivVerticesPerCoarseEdge + numSubdivVerticesPerCoarseEdge - 1
            e3 = ctx.edgeBoundaryOffset + coarsePrevEdge * numSubdivEdgesPerCoarseEdge + numSubdivEdgesPerCoarseEdge - 1
        } else {
            v3 = ctx.verticesEdgeOffset + coarsePrevEdge * numSubdivVerticesPerCoarseEdge
            e3 = ctx.edgeBoundaryOffset + coarsePrevEdge * numSubdivEdgesPerCoarseEdge
        }
        if (corner === 0) {
            sideStride = 1
            e2Offset = 0
            e2Stride = 1
            u = 0
            v = 0
            deltaU = du
            deltaV = 0
        } else if (corner === 1) {
            sideStart += resolution - 3
            sideStride = resolution - 2
            e2Offset = 2 * numSubdivEdgesPerCoarseEdge - 4
            e2Stride = 2 * numSubdivEdgesPerCoarseEdge - 3
            u = f32(1 - du)
            v = 0
            deltaU = 0
            deltaV = dv
        } else if (corner === 2) {
            sideStart += numSubdivVerticesPerCoarseEdge * numSubdivVerticesPerCoarseEdge - 1
            sideStride = -1
            e2Offset = numEdgesPerPtexFace(resolution - 2) - 1
            e2Stride = -1
            u = f32(1 - du)
            v = f32(1 - dv)
            deltaU = -du
            deltaV = 0
        } else if (corner === 3) {
            sideStart += numSubdivVerticesPerCoarseEdge * (numSubdivVerticesPerCoarseEdge - 1)
            sideStride = -(resolution - 2)
            e2Offset = numEdgesPerPtexFace(resolution - 2) - (2 * numSubdivEdgesPerCoarseEdge - 3)
            e2Stride = -(2 * numSubdivEdgesPerCoarseEdge - 3)
            u = 0
            v = f32(1 - dv)
            deltaU = 0
            deltaV = -dv
        }
        for (let i = 0; i < resolution - 2; i++, loop += 4) {
            const v1 = flip ? startEdgeVert + (resolution - i - 3) : startEdgeVert + i
            const v2 = sideStart + sideStride * i
            const e0 = flip
                ? ctx.edgeBoundaryOffset + coarseEdgeI * numSubdivEdgesPerCoarseEdge + numSubdivEdgesPerCoarseEdge - i - 1
                : ctx.edgeBoundaryOffset + coarseEdgeI * numSubdivEdgesPerCoarseEdge + i
            const e1 = startEdge + numEdgesPerPtexFace(resolution - 2) + corner * numSubdivVerticesPerCoarseEdge + i
            let e2: number
            if (i === 0) {
                e2 = startEdge + numEdgesPerPtexFace(resolution - 2) + ((corner - 1 + size) % size) * numSubdivVerticesPerCoarseEdge +
                    numSubdivVerticesPerCoarseEdge - 1
            } else {
                e2 = startEdge + e2Offset + e2Stride * (i - 1)
            }
            // `u + delta_u * i`: `float * int` then add.
            const loopU = f32(u + f32(deltaU * i))
            const loopV = f32(v + f32(deltaV * i))
            loopsOfFace(ctx, tls, loop, ptex, face, loopsCornerIndex(loopU, loopV, du, dv), corner, v0, e0, v1, e1, v2, e2, v3, e3, loopU, loopV, du, dv)
            v0 = v1
            v3 = v2
            e3 = e1
        }
        prevCorner = corner
    }
}

/** `subdiv_foreach_loops_special` (:1262). */
function loopsSpecial<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, face: number): void {
    const resolution = ctx.settings.resolution
    const start = ctx.faces[face], size = ctx.faceSize(face)
    const ptexRes = ptexFaceResolution(size, resolution)
    const ptexInner = ptexRes - 2
    const inv = f32(1 / (ptexRes - 1))
    const numInnerVerticesPerPtex = (ptexRes - 1) * (ptexRes - 2)
    const numInnerEdgesPerPtexFaceV = numInnerEdgesPerPtexFace(ptexInner + 1)
    const numSubdivVerticesPerCoarseEdge = resolution - 2
    const numSubdivEdgesPerCoarseEdge = resolution - 1
    const ptex = ctx.facePtexOffset[face]
    const centerVert = ctx.verticesInnerOffset + ctx.subdivVertOffset[face]
    const startVert = centerVert + 1
    const startInnerVert = centerVert + 1
    const startEdge = ctx.edgeInnerOffset + ctx.subdivEdgeOffset[face]
    const startLoop = 4 * ctx.subdivFaceOffset[face]
    const du = inv, dv = inv
    let loop = startLoop
    for (let corner = 0; corner < size; corner++) {
        const cornerVert = startVert + corner * numInnerVerticesPerPtex
        const cornerEdge = startEdge + corner * numInnerEdgesPerPtexFaceV
        for (let y = 1; y < ptexInner; y++) {
            const v = f32(y * inv)
            const innerY = y - 1
            for (let x = 1; x < ptexInner + 1; x++, loop += 4) {
                const innerX = x - 1
                const u = f32(x * inv)
                const v0 = cornerVert + (innerY * (ptexInner + 1) + innerX)
                const v1 = v0 + 1
                const v2 = v0 + ptexInner + 2
                const v3 = v0 + ptexInner + 1
                const e0 = cornerEdge + (innerY * (2 * ptexInner + 1) + innerX)
                const e1 = e0 + ptexInner + 1
                const e2 = e0 + (2 * ptexInner + 1)
                const e3 = e0 + ptexInner
                loopsOfFace(ctx, tls, loop, ptex + corner, face, corner, 0, v0, e0, v1, e1, v2, e2, v3, e3, u, v, du, dv)
            }
        }
    }
    for (let corner = 0; corner < size; corner++) {
        const nextCorner = (corner + 1) % size
        const cornerEdge = startEdge + corner * numInnerEdgesPerPtexFaceV
        const nextCornerEdge = startEdge + nextCorner * numInnerEdgesPerPtexFaceV
        let currentPatchVert = startInnerVert + corner * numInnerVerticesPerPtex + ptexInner
        let nextPatchVert = startInnerVert + nextCorner * numInnerVerticesPerPtex + numInnerVerticesPerPtex - ptexRes + 1
        let v0 = currentPatchVert
        let v1 = nextPatchVert
        currentPatchVert += ptexInner + 1
        nextPatchVert += 1
        let e0 = startEdge + size * numInnerEdgesPerPtexFaceV + corner * (ptexRes - 2)
        let e1 = nextCornerEdge + numInnerEdgesPerPtexFaceV - ptexRes + 2
        let e3 = cornerEdge + 2 * ptexRes - 4
        for (let row = 1; row < ptexInner; row++, loop += 4) {
            const v2 = nextPatchVert
            const v3 = currentPatchVert
            const e2 = e0 + 1
            const u = f32(row * du)
            const v = f32(1 - dv)
            loopsOfFace(ctx, tls, loop, ptex + nextCorner, face, nextCorner, 3, v0, e0, v1, e1, v2, e2, v3, e3, u, v, du, dv)
            currentPatchVert += ptexInner + 1
            nextPatchVert += 1
            v0 = v3
            v1 = v2
            e0 = e2
            e1 += 1
            e3 += 2 * ptexRes - 3
        }
    }
    if (ptexRes >= 3) {
        const startCenterEdge = startEdge + (numInnerEdgesPerPtexFaceV + ptexInner) * size
        const startBoundaryEdge = startEdge + size * numInnerEdgesPerPtexFaceV + ptexInner - 1
        for (let corner = 0, prevCorner = size - 1; corner < size; prevCorner = corner, corner++, loop += 4) {
            const cornerEdge = startEdge + corner * numInnerEdgesPerPtexFaceV
            const currentPatchEndVert = startVert + corner * numInnerVerticesPerPtex + numInnerVerticesPerPtex - 1
            const prevCurrentPatchEndVert = startVert + prevCorner * numInnerVerticesPerPtex + numInnerVerticesPerPtex - 1
            const v0 = centerVert
            const v1 = prevCurrentPatchEndVert
            const v2 = currentPatchEndVert - 1
            const v3 = currentPatchEndVert
            const e0 = startCenterEdge + prevCorner
            const e1 = startBoundaryEdge + prevCorner * ptexInner
            const e2 = cornerEdge + numInnerEdgesPerPtexFaceV - 1
            const e3 = startCenterEdge + corner
            const u = f32(1 - du)
            const v = f32(1 - dv)
            loopsOfFace(ctx, tls, loop, ptex + corner, face, corner, 2, v0, e0, v1, e1, v2, e2, v3, e3, u, v, du, dv)
        }
    }
    for (let prevCorner = size - 1, corner = 0; corner < size; prevCorner = corner, corner++) {
        const coarseVert = ctx.cornerVerts[start + corner]
        const coarseEdgeI = ctx.cornerEdges[start + corner]
        const coarsePrevVert = ctx.cornerVerts[start + prevCorner]
        const coarsePrevEdge = ctx.cornerEdges[start + prevCorner]
        const flip = ctx.coarseEdges[coarseEdgeI * 2 + 1] === coarseVert
        const startEdgeVert = ctx.verticesEdgeOffset + coarseEdgeI * numSubdivVerticesPerCoarseEdge
        const cornerVert = startVert + corner * numInnerVerticesPerPtex
        const cornerEdge = startEdge + corner * numInnerEdgesPerPtexFaceV
        let v0 = ctx.verticesCornerOffset + coarseVert
        let v3: number, e3: number
        if (coarsePrevVert === ctx.coarseEdges[coarsePrevEdge * 2]) {
            v3 = ctx.verticesEdgeOffset + coarsePrevEdge * numSubdivVerticesPerCoarseEdge + numSubdivVerticesPerCoarseEdge - 1
            e3 = ctx.edgeBoundaryOffset + coarsePrevEdge * numSubdivEdgesPerCoarseEdge + numSubdivEdgesPerCoarseEdge - 1
        } else {
            v3 = ctx.verticesEdgeOffset + coarsePrevEdge * numSubdivVerticesPerCoarseEdge
            e3 = ctx.edgeBoundaryOffset + coarsePrevEdge * numSubdivEdgesPerCoarseEdge
        }
        for (let i = 0; i <= ptexInner; i++, loop += 4) {
            const v1 = flip ? startEdgeVert + (resolution - i - 3) : startEdgeVert + i
            const v2 = ptexInner >= 1 ? cornerVert + i : centerVert
            const e0 = flip
                ? ctx.edgeBoundaryOffset + coarseEdgeI * numSubdivEdgesPerCoarseEdge + numSubdivEdgesPerCoarseEdge - i - 1
                : ctx.edgeBoundaryOffset + coarseEdgeI * numSubdivEdgesPerCoarseEdge + i
            let e1 = startEdge + corner * (2 * ptexInner + 1)
            if (ptexRes >= 3) e1 += size * (numInnerEdgesPerPtexFaceV + ptexInner + 1) + i
            let e2 = 0
            if (i === 0 && ptexRes >= 3) {
                e2 = startEdge + size * (numInnerEdgesPerPtexFaceV + ptexInner + 1) + corner * (2 * ptexInner + 1) + ptexInner + 1
            } else if (i === 0 && ptexRes < 3) {
                e2 = startEdge + prevCorner * (2 * ptexInner + 1)
            } else {
                e2 = cornerEdge + i - 1
            }
            const u = f32(du * i)
            loopsOfFace(ctx, tls, loop, ptex + corner, face, corner, 0, v0, e0, v1, e1, v2, e2, v3, e3, u, 0, du, dv)
            v0 = v1
            v3 = v2
            e3 = e1
        }
        const flipPrev = ctx.coarseEdges[coarsePrevEdge * 2 + 1] === coarseVert
        v0 = cornerVert
        if (coarsePrevVert === ctx.coarseEdges[coarsePrevEdge * 2]) {
            v3 = ctx.verticesEdgeOffset + coarsePrevEdge * numSubdivVerticesPerCoarseEdge + numSubdivVerticesPerCoarseEdge - 1
        } else {
            v3 = ctx.verticesEdgeOffset + coarsePrevEdge * numSubdivVerticesPerCoarseEdge
        }
        e3 = startEdge + size * (numInnerEdgesPerPtexFaceV + ptexInner + 1) + corner * (2 * ptexInner + 1) + ptexInner + 1
        for (let i = 0; i <= ptexInner - 1; i++, loop += 4) {
            let v1: number, e0: number, e1: number
            if (i === ptexInner - 1) {
                v1 = startVert + prevCorner * numInnerVerticesPerPtex + ptexInner
                e1 = startEdge + size * (numInnerEdgesPerPtexFaceV + ptexInner + 1) + prevCorner * (2 * ptexInner + 1) + ptexInner
                e0 = startEdge + size * numInnerEdgesPerPtexFaceV + prevCorner * ptexInner
            } else {
                v1 = v0 + ptexInner + 1
                e0 = cornerEdge + ptexInner + i * (2 * ptexInner + 1)
                e1 = e3 + 1
            }
            const v2 = flipPrev ? v3 - 1 : v3 + 1
            const e2 = flipPrev
                ? ctx.edgeBoundaryOffset + coarsePrevEdge * numSubdivEdgesPerCoarseEdge + numSubdivEdgesPerCoarseEdge - 2 - i
                : ctx.edgeBoundaryOffset + coarsePrevEdge * numSubdivEdgesPerCoarseEdge + 1 + i
            const v = f32(du * (i + 1))
            loopsOfFace(ctx, tls, loop, ptex + corner, face, corner, 1, v0, e0, v1, e1, v2, e2, v3, e3, 0, v, du, dv)
            v0 = v1
            v3 = v2
            e3 = e1
        }
    }
}

/** `subdiv_foreach_loops` (:1598). */
function foreachLoops<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, face: number): void {
    if (ctx.faceSize(face) === 4) loopsRegular(ctx, tls, face)
    else loopsSpecial(ctx, tls, face)
}

/** `subdiv_foreach_vertices_of_loose_edges_task` (:1628). */
function verticesOfLooseEdge<TLS>(ctx: ForeachTaskContext<TLS>, tls: TLS, coarseEdge: number): void {
    if (ctx.coarseEdgesUsedMap[coarseEdge]) return
    const resolution = ctx.settings.resolution
    const inv = f32(1 / (resolution - 1))
    const numSubdivVerticesPerCoarseEdge = resolution - 2
    const v1 = ctx.verticesCornerOffset + ctx.coarseEdges[coarseEdge * 2]
    const v2 = ctx.verticesCornerOffset + ctx.coarseEdges[coarseEdge * 2 + 1]
    const startVert = ctx.verticesEdgeOffset + coarseEdge * numSubdivVerticesPerCoarseEdge
    for (let i = 0; i < resolution; i++) {
        const u = f32(i * inv)
        const vert = i === 0 ? v1 : i === resolution - 1 ? v2 : startVert + (i - 1)
        ctx.fc.vertOfLooseEdge!(tls, coarseEdge, u, vert)
    }
}

/** `foreach_subdiv_geometry` (`subdiv_foreach.cc:1748`). */
export function foreachSubdivGeometry<TLS>(subdiv: Subdiv, fc: ForeachContext<TLS>, settings: ToMeshSettings, coarse: MeshData): boolean {
    const ctx = new ForeachTaskContext(subdiv, coarse, settings, fc)
    if (fc.topologyInfo) {
        if (!fc.topologyInfo(ctx.numSubdivVertices, ctx.numSubdivEdges, ctx.numSubdivLoops, ctx.numSubdivFaces, ctx.subdivFaceOffset.subarray(0, coarse.facesNum))) {
            return false
        }
    }
    // `subdiv_foreach_single_thread_tasks` (:1694).
    {
        const tls = fc.makeTLS()
        if (fc.vertEveryCorner) for (let f = 0; f < coarse.facesNum; f++) cornerVertices(ctx, tls, f, fc.vertEveryCorner, false)
        if (fc.vertEveryEdge) for (let f = 0; f < coarse.facesNum; f++) edgeVertices(ctx, tls, f, fc.vertEveryEdge, false)
        // `subdiv_foreach_single_geometry_vertices` (:1672).
        if (fc.vertCorner) {
            for (let f = 0; f < coarse.facesNum; f++) {
                cornerVertices(ctx, tls, f, fc.vertCorner, true)
                edgeVertices(ctx, tls, f, fc.vertEdge!, true)
            }
        }
        const isLooseGeometryTagged = fc.vertEveryEdge !== undefined && fc.vertEveryCorner !== undefined
        const isLooseGeometryTagsNeeded = fc.vertLoose !== undefined || fc.vertOfLooseEdge !== undefined
        if (isLooseGeometryTagged && isLooseGeometryTagsNeeded) {
            // `subdiv_foreach_mark_non_loose_geometry` (:1684).
            for (let c = 0; c < coarse.cornersNum; c++) {
                ctx.coarseVerticesUsedMap[ctx.cornerVerts[c]] = 1
                ctx.coarseEdgesUsedMap[ctx.cornerEdges[c]] = 1
            }
        }
    }
    if (fc.faces) fc.faces(ctx.subdivFaceOffset)
    {
        // `subdiv_foreach_task` (:1718) over the faces; one TLS for the whole range (each task copies the initial TLS,
        // and the TLS only caches interpolation data keyed by face and corner).
        const tls = fc.makeTLS()
        for (let f = 0; f < coarse.facesNum; f++) {
            foreachVertices(ctx, tls, f)
            if (fc.edge) foreachEdges(ctx, tls, f)
            if (fc.loop) foreachLoops(ctx, tls, f)
        }
    }
    if (fc.vertLoose) {
        const tls = fc.makeTLS()
        for (let v = 0; v < coarse.vertsNum; v++) {
            // `subdiv_foreach_loose_vertices_task` (:1614).
            if (ctx.coarseVerticesUsedMap[v]) continue
            fc.vertLoose(tls, v, ctx.verticesCornerOffset + v)
        }
    }
    if (fc.vertOfLooseEdge) {
        const tls = fc.makeTLS()
        for (let e = 0; e < coarse.edgesNum; e++) verticesOfLooseEdge(ctx, tls, e)
    }
    if (fc.edge) {
        const tls = fc.makeTLS()
        for (let e = 0; e < coarse.edgesNum; e++) boundaryEdges(ctx, tls, e)
    }
    return true
}

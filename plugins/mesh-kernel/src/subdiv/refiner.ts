/**
 * The topology refiner Blender drives: the base level built from a {@link MeshData} the way Blender's converter
 * hands a mesh to OpenSubdiv, uniform refinement, and primvar interpolation and limit evaluation.
 *
 * Base level (Blender 5.2.2 `blenkernel/intern/subdiv_converter_mesh.cc` and the glue in
 * `intern/opensubdiv/internal/topology/topology_refiner_factory.cc`, then OpenSubdiv's
 * `TopologyRefinerFactoryBase`, `far/topologyRefinerFactory.cpp`):
 * - loose vertices are left out and the vertices of loose edges are infinitely sharp (`initialize_manifold_indices`);
 * - only face-vertices are given (`specifies_full_topology` is false), so OpenSubdiv rebuilds edges and orientation
 *   (`Level::completeTopologyFromFaceVertices`);
 * - edge sharpness is `10 * crease^2` from `crease_edge` (`subdiv_inline.hh:116`), found on the rebuilt edges by
 *   vertex pair (`assignComponentTags`), vertex sharpness from `crease_vert`, and a vertex with exactly two edges
 *   adds the smaller of their sharpness (capped at 10);
 * - "Simple" subdivision sets every edge to 10 and every vertex infinitely sharp (`BUGGY_SIMPLE_SCHEME_WORKAROUND`);
 * - then `prepareComponentTagsAndSharpness` (`topologyRefinerFactory.cpp:151`): boundary and non-manifold edges
 *   become infinitely sharp, corners per the boundary option, rules and tags.
 *
 * Interpolation and limit: `far/primvarRefiner.h` `interpFromFaces` (`:458`), `interpFromEdges` (`:496`),
 * `interpFromVerts` (`:566`) and `limit` (`:1007`).
 */

import {MeshData} from '../MeshData'
import {AttrName} from '../constants'
import {ETag, Level, VTag} from './level'
import {QuadRefinement} from './refinement'
import {
    computeEdgeVertexMask, computeFaceVertexMask, computeVertexLimitMask, computeVertexVertexMask, determineVertexVertexRuleFromCount,
    isInfinite, isSemiSharp, isSharp, Mask, Rule, SdcOptions, SHARPNESS_INFINITE, VertexNeighborhood, VtxBoundaryInterpolation,
} from './sdc'

export interface BaseLevelSettings {
    useCreases: boolean
    simple: boolean
    /** Per-edge crease (0..1) overriding the `crease_edge` attribute, as the geometry-nodes input does. */
    edgeCrease?: ArrayLike<number> | null
    /** Per-vertex crease (0..1) overriding `crease_vert`. */
    vertexCrease?: ArrayLike<number> | null
}

export interface BaseLevel {
    level: Level
    /** Mesh vertex -> base vertex, -1 for loose vertices. */
    meshToBase: Int32Array
    /** Base vertex -> mesh vertex. */
    baseToMesh: Int32Array
}

/** `subdiv_inline.hh:116` `crease_to_sharpness`. */
export const creaseToSharpness = (c: number) => c * c * 10

/** Build OpenSubdiv's base level from a mesh, with Blender's converter semantics. */
export function createBaseLevel(mesh: MeshData, options: SdcOptions, settings: BaseLevelSettings): BaseLevel {
    const V = mesh.vertsNum, F = mesh.facesNum, E = mesh.edgesNum
    const offsets = mesh.faceOffsets, cornerVerts = mesh.cornerVerts, edgeVerts = mesh.edgeVerts

    // initialize_manifold_indices: vertices used by no face are dropped; loose edges' vertices go infinitely sharp
    const usedByFace = new Uint8Array(V)
    for (let c = 0; c < mesh.cornersNum; c++) usedByFace[cornerVerts[c]] = 1
    const meshToBase = new Int32Array(V).fill(-1)
    const baseToMeshList: number[] = []
    for (let v = 0; v < V; v++) if (usedByFace[v]) { meshToBase[v] = baseToMeshList.length; baseToMeshList.push(v) }
    const edgeInFace = new Uint8Array(E)
    const cornerEdges = mesh.cornerEdges
    for (let c = 0; c < mesh.cornersNum; c++) edgeInFace[cornerEdges[c]] = 1
    const infiniteSharpVert = new Uint8Array(V)
    for (let e = 0; e < E; e++) if (!edgeInFace[e]) { infiniteSharpVert[edgeVerts[2 * e]] = 1; infiniteSharpVert[edgeVerts[2 * e + 1]] = 1 }

    const sizes = new Int32Array(F)
    const faceVertIndices = new Int32Array(mesh.cornersNum)
    for (let f = 0; f < F; f++) {
        sizes[f] = offsets[f + 1] - offsets[f]
        for (let c = offsets[f]; c < offsets[f + 1]; c++) faceVertIndices[c] = meshToBase[cornerVerts[c]]
    }
    const level = Level.fromFaceVertices(baseToMeshList.length, sizes, faceVertIndices)

    // assignComponentTags (topology_refiner_factory.cc:179)
    const creaseEdge = settings.edgeCrease ?? (settings.useCreases ? mesh.attributes.get(AttrName.creaseEdge)?.data as Float32Array | undefined : undefined)
    const creaseVert = settings.vertexCrease ?? (settings.useCreases ? mesh.attributes.get(AttrName.creaseVert)?.data as Float32Array | undefined : undefined)
    for (let e = 0; e < E; e++) {
        if (!edgeInFace[e]) continue
        const sharpness = settings.simple ? 10 : creaseEdge ? creaseToSharpness(creaseEdge[e]) : 0
        if (sharpness < 1e-6) continue
        const be = level.findEdge(meshToBase[edgeVerts[2 * e]], meshToBase[edgeVerts[2 * e + 1]])
        if (be < 0) throw new Error('subdivision: failed to find reconstructed edge')
        level.edgeSharpness[be] = sharpness
    }
    for (let bv = 0; bv < level.numVertices; bv++) {
        const mv = baseToMeshList[bv]
        if (settings.simple || infiniteSharpVert[mv]) { level.vertSharpness[bv] = SHARPNESS_INFINITE; continue }
        let sharpness = creaseVert ? creaseToSharpness(creaseVert[mv]) : 0
        const vEdges = level.getVertexEdges(bv)
        if (vEdges.length === 2) {
            sharpness += Math.min(level.edgeSharpness[vEdges[0]], level.edgeSharpness[vEdges[1]])
            sharpness = Math.min(sharpness, 10)
        }
        level.vertSharpness[bv] = sharpness
    }

    prepareComponentTagsAndSharpness(level, options)
    return {level, meshToBase, baseToMesh: Int32Array.from(baseToMeshList)}
}

/** `TopologyRefinerFactoryBase::prepareComponentTagsAndSharpness` (`topologyRefinerFactory.cpp:151`), Catmark. */
function prepareComponentTagsAndSharpness(L: Level, options: SdcOptions): void {
    // VTX_BOUNDARY_NONE would turn boundary faces into holes; Blender never asks for it.
    if (options.vtxBoundaryInterpolation === VtxBoundaryInterpolation.None) throw new Error('subdivision: VTX_BOUNDARY_NONE is not supported')
    const sharpenCornerVerts = options.vtxBoundaryInterpolation === VtxBoundaryInterpolation.EdgeAndCorner
    for (let e = 0; e < L.numEdges; e++) {
        let tag = L.edgeTags[e]
        if (L.edgeFaces.size(e) < 2) tag |= ETag.Boundary
        if ((tag & ETag.Boundary) || (tag & ETag.NonManifold)) L.edgeSharpness[e] = SHARPNESS_INFINITE
        const s = L.edgeSharpness[e]
        if (isInfinite(s)) tag |= ETag.InfSharp
        if (isSharp(s) && !isInfinite(s)) tag |= ETag.SemiSharp
        L.edgeTags[e] = tag
    }
    const regularInterior = 4, regularBoundary = 2
    for (let v = 0; v < L.numVertices; v++) {
        let tag = L.vertTags[v]
        const vEdges = L.getVertexEdges(v), vFacesN = L.vertFaces.size(v)
        let boundaryCount = 0, infCount = 0, semiCount = 0, nonManCount = 0
        for (let i = 0; i < vEdges.length; i++) {
            const et = L.edgeTags[vEdges[i]]
            if (et & ETag.Boundary) boundaryCount++
            if (et & ETag.InfSharp) infCount++
            if (et & ETag.SemiSharp) semiCount++
            if (et & ETag.NonManifold) nonManCount++
        }
        const sharpEdgeCount = infCount + semiCount
        const isTopologicalCorner = vFacesN === 1 && vEdges.length === 2
        if (isTopologicalCorner && sharpenCornerVerts) {
            L.vertSharpness[v] = SHARPNESS_INFINITE
        } else if ((tag & VTag.NonManifold) && !isInfinite(L.vertSharpness[v])) {
            const isNonManCrease = nonManCount === 2 && boundaryCount === 0 && vFacesN > vEdges.length && L.testVertexNonManifoldCrease(v)
            if (!isNonManCrease) L.vertSharpness[v] = SHARPNESS_INFINITE
        }
        const vs = L.vertSharpness[v]
        tag &= ~(VTag.InfSharp | VTag.SemiSharp | VTag.SemiSharpEdges | VTag.Boundary | VTag.Corner | VTag.Xordinary | VTag.Incomplete
            | VTag.InfSharpEdges | VTag.InfSharpCrease | VTag.InfIrregular)
        if (isInfinite(vs)) tag |= VTag.InfSharp
        if (isSemiSharp(vs)) tag |= VTag.SemiSharp
        if (semiCount > 0) tag |= VTag.SemiSharpEdges
        L.vertRule[v] = determineVertexVertexRuleFromCount(vs, sharpEdgeCount)
        if (boundaryCount > 0) tag |= VTag.Boundary
        if (isTopologicalCorner && (tag & VTag.InfSharp)) tag |= VTag.Corner
        if (!(tag & VTag.NonManifold) && !(tag & VTag.Corner)) {
            if ((tag & VTag.Boundary) ? vFacesN !== regularBoundary : vFacesN !== regularInterior) tag |= VTag.Xordinary
        }
        if (infCount > 0) tag |= VTag.InfSharpEdges
        L.vertTags[v] = tag
    }
}

/** A refiner: the base level and each uniform refinement after it (`Far::TopologyRefiner::RefineUniform`). */
export class TopologyRefiner {
    readonly levels: Level[]
    readonly refinements: QuadRefinement[] = []
    readonly options: SdcOptions

    constructor(base: Level, options: SdcOptions) {
        this.levels = [base]
        this.options = options
    }

    get maxLevel(): number { return this.levels.length - 1 }

    refineUniform(levels: number): void {
        for (let i = this.maxLevel; i < levels; i++) {
            const child = new Level()
            const r = new QuadRefinement(this.levels[i], child, this.options)
            r.refine()
            this.levels.push(child)
            this.refinements.push(r)
        }
    }

    /**
     * `PrimvarRefiner::Interpolate(level, src, dst)` for `stride`-component vertex data: values of level `level - 1`
     * in, values of level `level` out.
     */
    interpolate(level: number, src: Float64Array, stride: number): Float64Array {
        const r = this.refinements[level - 1]
        const P = r.parent, C = r.child
        const dst = new Float64Array(C.numVertices * stride)
        const mask = new Mask()
        const add = (d: number, s: Float64Array, si: number, w: number) => { for (let k = 0; k < stride; k++) dst[d * stride + k] += s[si * stride + k] * w }

        // interpFromFaces
        for (let f = 0; f < P.numFaces; f++) {
            const cv = r.faceChildVert[f]
            const fv = P.getFaceVertices(f)
            computeFaceVertexMask(fv.length, mask)
            for (let i = 0; i < fv.length; i++) add(cv, src, fv[i], mask.vertex[i])
        }
        // interpFromEdges
        for (let e = 0; e < P.numEdges; e++) {
            const cv = r.edgeChildVert[e]
            const eFaces = P.getEdgeFaces(e)
            const sharp = P.edgeSharpness[e]
            const pRule = sharp > 0 ? Rule.Crease : Rule.Smooth
            computeEdgeVertexMask(this.options, eFaces.length, sharp, mask, pRule, C.getVertexRule(cv))
            add(cv, src, P.edgeVerts[2 * e], mask.vertex[0])
            add(cv, src, P.edgeVerts[2 * e + 1], mask.vertex[1])
            if (mask.numFace > 0) {
                // Catmark face weights are always on face centres, already computed above
                for (let i = 0; i < eFaces.length; i++) add(cv, dst, r.faceChildVert[eFaces[i]], mask.face[i])
            }
        }
        // interpFromVerts
        const hood: VertexNeighborhood & {sharpnessPerEdge: number[]} = {numEdges: 0, numFaces: 0, sharpness: 0, sharpnessPerEdge: [], childSharpness: 0}
        for (let v = 0; v < P.numVertices; v++) {
            const cv = r.vertChildVert[v]
            const vEdges = P.getVertexEdges(v), vFaces = P.getVertexFaces(v)
            hood.numEdges = vEdges.length
            hood.numFaces = vFaces.length
            hood.sharpness = P.vertSharpness[v]
            hood.sharpnessPerEdge.length = vEdges.length
            for (let i = 0; i < vEdges.length; i++) hood.sharpnessPerEdge[i] = P.edgeSharpness[vEdges[i]]
            hood.childSharpness = C.vertSharpness[cv]
            computeVertexVertexMask(this.options, hood, mask, P.getVertexRule(v), C.getVertexRule(cv))
            // smaller weights first, as OpenSubdiv does for precision: faces, edges, then the vertex
            if (mask.numFace > 0) for (let i = 0; i < vFaces.length; i++) add(cv, dst, r.faceChildVert[vFaces[i]], mask.face[i])
            if (mask.numEdge > 0) {
                for (let i = 0; i < vEdges.length; i++) {
                    const e = vEdges[i]
                    const opp = P.edgeVerts[2 * e] === v ? P.edgeVerts[2 * e + 1] : P.edgeVerts[2 * e]
                    add(cv, src, opp, mask.edge[i])
                }
            }
            add(cv, src, v, mask.vertex[0])
        }
        return dst
    }

    /** `PrimvarRefiner::Limit(src, dstPos)` (`primvarRefiner.h:1007`) at the last level. */
    limit(src: Float64Array, stride: number): Float64Array {
        const L = this.levels[this.maxLevel]
        const dst = new Float64Array(L.numVertices * stride)
        const mask = new Mask()
        const hood: VertexNeighborhood & {sharpnessPerEdge: number[]} = {numEdges: 0, numFaces: 0, sharpness: 0, sharpnessPerEdge: [], childSharpness: 0}
        const add = (d: number, si: number, w: number) => { for (let k = 0; k < stride; k++) dst[d * stride + k] += src[si * stride + k] * w }
        for (let v = 0; v < L.numVertices; v++) {
            const vEdges = L.getVertexEdges(v)
            if ((L.vertTags[v] & VTag.Incomplete) || vEdges.length === 0) { add(v, v, 1); continue }
            const vFaces = L.getVertexFaces(v)
            hood.numEdges = vEdges.length
            hood.numFaces = vFaces.length
            hood.sharpness = L.vertSharpness[v]
            hood.sharpnessPerEdge.length = vEdges.length
            for (let i = 0; i < vEdges.length; i++) hood.sharpnessPerEdge[i] = L.edgeSharpness[vEdges[i]]
            computeVertexLimitMask(hood, mask, L.getVertexRule(v))
            if (mask.numFace > 0) {
                const vInFace = L.getVertexFaceLocalIndices(v)
                for (let i = 0; i < mask.numFace; i++) {
                    const fv = L.getFaceVertices(vFaces[i])
                    let opp = vInFace[i] + 2
                    if (opp >= fv.length) opp -= fv.length
                    add(v, fv[opp], mask.face[i])
                }
            }
            for (let i = 0; i < mask.numEdge; i++) {
                const e = vEdges[i]
                add(v, L.edgeVerts[2 * e] === v ? L.edgeVerts[2 * e + 1] : L.edgeVerts[2 * e], mask.edge[i])
            }
            add(v, v, mask.vertex[0])
        }
        return dst
    }
}

/**
 * `bke::subdiv::subdiv_to_mesh` (Blender 5.2.2 `blenkernel/intern/subdiv_mesh.cc`): builds the subdivided mesh through
 * `foreach_subdiv_geometry` (`subdivForeach.ts`), evaluating positions and UV maps with OpenSubdiv (`subdiv.ts`) and
 * interpolating every other attribute bilinearly over the ptex faces.
 *
 * Not ported, because a procedural mesh has none of them: displacement (multires), orco / cloth orco, `CD_MVERT_SKIN`,
 * `CD_NORMAL`, `CD_ORIGSPACE_MLOOP`, `CD_ORIGINDEX`, and the optimal-display edge tags. Vertex groups are float
 * attributes here (`issues/open/modelling-tools/procedural-vertex-groups.md`), so they are mixed as attributes instead
 * of with `mix_deform_verts`.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import {DATA_TYPES, DataType, TypedArray} from './dataTypes'
import {mix4} from './curvesEval'
import {mix2} from './mixers'
import {mixIndicesWeighted} from './mixIndices'
import {meshBoundsMinMax} from './meshBounds'
import {meshRuntime} from './meshRuntime'
import {newMesh} from './meshPrimitives'
import {GroupedIndices, looseEdges, vertToEdgeMap} from './meshTopology'
import {keyCurvePositionWeights} from '../blender/math/colorband'
import {evalBeginFromMesh, evalFaceVarying, evalFinalPoint, evalLimitPoint, meshUvMapNames, Subdiv} from './subdiv'
import {foreachSubdivGeometry, ForeachContext, ORIGINDEX_NONE, ToMeshSettings} from './subdivForeach'

/** One interpolated attribute: the coarse values and the subdivided layer. */
interface Attr {
    type: DataType
    c: number
    src: ArrayLike<number>
    dst: TypedArray
}

/** `mix_attrs(src, std::array<int, 2>, factor, dst_index, dst)` (`subdiv_mesh.cc:328`). */
function mixAttrs2(attrs: Attr[], src: ArrayLike<number>[], a: number, b: number, factor: number, dstIndex: number, dst: TypedArray[]): void {
    attrs.forEach((attr, i) => {
        if (attr.type === 'bool') mixIndicesWeighted('bool', src[i], [a, b], [f32(1 - factor), factor], dst[i], dstIndex)
        else mix2(attr.type, factor, src[i], a, src[i], b, dst[i], dstIndex)
    })
}

/** `mix_attrs(src, std::array<int, 4>, float4 weights, dst_index, dst)` (:352). */
function mixAttrs4(attrs: Attr[], src: ArrayLike<number>[], idx: readonly number[], weights: readonly number[], dstIndex: number, dst: TypedArray[]): void {
    attrs.forEach((attr, i) => {
        if (attr.type === 'bool') mixIndicesWeighted('bool', src[i], idx, weights, dst[i], dstIndex)
        else mix4(attr.type, weights, src[i], idx[0], idx[1], idx[2], idx[3], dst[i], dstIndex)
    })
}

/** `mix_attrs(src, Span<int> indices, Span<float> weights, dst_index, dst)` (:379). */
function mixAttrsN(attrs: Attr[], src: ArrayLike<number>[], idx: ArrayLike<number>, weights: ArrayLike<number>, dstIndex: number, dst: TypedArray[]): void {
    attrs.forEach((attr, i) => mixIndicesWeighted(attr.type, src[i], idx, weights, dst[i], dstIndex))
}

/** `copy_attrs` (:396). */
function copyAttrs(attrs: Attr[], src: ArrayLike<number>[], srcIndex: number, dstIndex: number, dst: TypedArray[]): void {
    attrs.forEach((attr, i) => {
        for (let k = 0; k < attr.c; k++) dst[i][dstIndex * attr.c + k] = src[i][srcIndex * attr.c + k]
    })
}

/** `quad_weights_from_uv` (:966). */
function quadWeightsFromUv(u: number, v: number): number[] {
    const omu = f32(1 - u), omv = f32(1 - v)
    return [f32(omu * omv), f32(u * omv), f32(u * v), f32(omu * v)]
}

/** `LoopsOfPtex` / `loops_of_ptex_get` (:246). */
function loopsOfPtexGet(faceStart: number, faceSize: number, ptexOfFace: number) {
    const first = faceStart + ptexOfFace
    const last = faceStart + (ptexOfFace + faceSize - 1) % faceSize
    return {first, last}
}

/** `VerticesForInterpolation` / `LoopsForInterpolation` (:410, :574): 4 storage elements per attribute. */
class ForInterpolation {
    readonly storage: TypedArray[]
    data: ArrayLike<number>[]
    readonly indices = [0, 0, 0, 0]

    constructor(readonly attrs: Attr[]) {
        this.storage = attrs.map(a => new DATA_TYPES[a.type].array(4 * a.c))
        this.data = []
    }
}

/** `SubdivMeshTLS` (:731). */
interface SubdivMeshTLS {
    vert?: ForInterpolation
    vertFace: number
    vertCorner: number
    loop?: ForInterpolation
    loopFace: number
    loopCorner: number
}

/** `SubdivMeshContext` (:42) and its callbacks. */
class SubdivMeshContext {
    readonly coarsePositions: Float32Array
    readonly coarseEdges: Int32Array
    readonly faces: Int32Array
    readonly cornerVerts: Int32Array
    subdivMesh!: MeshData
    /** `vert_to_edge_map`, built when the coarse mesh has loose edges. */
    vertToEdge?: GroupedIndices
    subdivPositions!: Float32Array
    subdivEdges!: Int32Array
    subdivCornerVerts!: Int32Array
    subdivCornerEdges!: Int32Array
    vertAttrs: Attr[] = []
    edgeAttrs: Attr[] = []
    faceAttrs: Attr[] = []
    cornerAttrs: Attr[] = []
    uvMaps: TypedArray[] = []
    vertSrc: ArrayLike<number>[] = []
    vertDst: TypedArray[] = []
    cornerSrc: ArrayLike<number>[] = []
    cornerDst: TypedArray[] = []
    private readonly p = [0, 0, 0]
    private readonly fv = [0, 0]

    constructor(readonly subdiv: Subdiv, readonly settings: ToMeshSettings, readonly coarse: MeshData) {
        this.coarsePositions = coarse.positions
        this.coarseEdges = coarse.edgeVerts
        this.faces = coarse.faceOffsets
        this.cornerVerts = coarse.cornerVerts
    }

    makeTLS(): SubdivMeshTLS {
        return {vertFace: -1, vertCorner: -1, loopFace: -1, loopCorner: -1}
    }

    private faceSize(f: number) { return this.faces[f + 1] - this.faces[f] }

    /** `create_attrs_and_retrieve_interp_spans` (:812). */
    private createAttrs(domain: AttrDomain, skip: ReadonlySet<string>): Attr[] {
        const out: Attr[] = []
        for (const layer of this.coarse.attributes.layersOnDomain(domain)) {
            if (skip.has(layer.name)) continue
            const type = layer.type as DataType
            const dst = this.subdivMesh.attributes.get(layer.name) ?? this.subdivMesh.attributes.add({name: layer.name, domain, type})
            out.push({type, c: DATA_TYPES[type].components, src: layer.data, dst: dst.data})
        }
        return out
    }

    /** `subdiv_mesh_topology_info` (:855). */
    topologyInfo(numVertices: number, numEdges: number, numLoops: number, numFaces: number): boolean {
        const coarse = this.coarse
        const mesh = newMesh(numVertices, numEdges, numFaces, numLoops)
        this.subdivMesh = mesh
        // `BKE_mesh_copy_parameters_for_eval`.
        mesh.materials = coarse.materials.slice()
        if (numFaces !== 0) for (let f = 0; f <= numFaces; f++) mesh.faceOffsets[f] = 4 * f
        this.vertAttrs = this.createAttrs(AttrDomain.Point, new Set(['position']))
        this.edgeAttrs = this.createAttrs(AttrDomain.Edge, new Set(['.edge_verts']))
        this.faceAttrs = this.createAttrs(AttrDomain.Face, new Set())
        const uvNames = meshUvMapNames(coarse)
        this.cornerAttrs = this.createAttrs(AttrDomain.Corner, new Set(['.corner_vert', '.corner_edge', 'custom_normal', ...uvNames]))
        this.vertSrc = this.vertAttrs.map(a => a.src)
        this.vertDst = this.vertAttrs.map(a => a.dst)
        this.cornerSrc = this.cornerAttrs.map(a => a.src)
        this.cornerDst = this.cornerAttrs.map(a => a.dst)
        // `subdiv_mesh_ctx_cache_custom_data_layers` (:142) / `subdiv_mesh_ctx_cache_uv_layers` (:126).
        this.subdivPositions = mesh.positions
        this.subdivEdges = mesh.edgeVerts
        this.subdivCornerVerts = mesh.cornerVerts
        this.subdivCornerEdges = mesh.cornerEdges
        this.uvMaps = uvNames.map(name => (mesh.attributes.get(name) ?? mesh.attributes.add({name, domain: AttrDomain.Corner, type: 'float2'})).data)
        return true
    }

    // region vertices

    /** `vert_interpolation_from_face` (:452). */
    private vertInterpolationFromFace(vi: ForInterpolation, face: number): void {
        const start = this.faces[face], size = this.faceSize(face)
        if (size === 4) {
            vi.data = this.vertSrc
            for (let k = 0; k < 4; k++) vi.indices[k] = this.cornerVerts[start + k]
            return
        }
        vi.data = vi.storage
        for (let k = 0; k < 4; k++) vi.indices[k] = k
        const weight = f32(1 / size)
        const weights = new Array<number>(size).fill(weight)
        const indices = this.cornerVerts.subarray(start, start + size)
        mixAttrsN(this.vertAttrs, this.vertSrc, indices, weights, 2, vi.storage)
    }

    /** `vert_interpolation_from_corner` (:498). */
    private vertInterpolationFromCorner(vi: ForInterpolation, face: number, corner: number): void {
        const start = this.faces[face], size = this.faceSize(face)
        if (size === 4) return
        const lp = loopsOfPtexGet(start, size, corner)
        const src = this.vertSrc
        copyAttrs(this.vertAttrs, src, this.cornerVerts[start + corner], 0, vi.storage)
        const first = [this.cornerVerts[lp.first], this.cornerVerts[start + (lp.first - start + 1) % size]]
        const last = [this.cornerVerts[lp.first], this.cornerVerts[lp.last]]
        mixAttrs2(this.vertAttrs, src, first[0], first[1], 0.5, 1, vi.storage)
        mixAttrs2(this.vertAttrs, src, last[0], last[1], 0.5, 3, vi.storage)
    }

    /** `subdiv_mesh_ensure_vert_interpolation` (:1109). */
    private ensureVertInterpolation(tls: SubdivMeshTLS, face: number, corner: number): ForInterpolation {
        if (!tls.vert) tls.vert = new ForInterpolation(this.vertAttrs)
        if (tls.vertFace !== face) {
            this.vertInterpolationFromFace(tls.vert, face)
            this.vertInterpolationFromCorner(tls.vert, face, corner)
        } else if (tls.vertCorner !== corner) {
            this.vertInterpolationFromCorner(tls.vert, face, corner)
        }
        tls.vertFace = face
        tls.vertCorner = corner
        return tls.vert
    }

    /** `subdiv_vert_data_interpolate` (:971). */
    private vertDataInterpolate(subdivVert: number, vi: ForInterpolation, u: number, v: number): void {
        mixAttrs4(this.vertAttrs, vi.data, vi.indices, quadWeightsFromUv(u, v), subdivVert, this.vertDst)
    }

    private setPosition(subdivVert: number): void {
        this.subdivPositions[subdivVert * 3] = this.p[0]
        this.subdivPositions[subdivVert * 3 + 1] = this.p[1]
        this.subdivPositions[subdivVert * 3 + 2] = this.p[2]
    }

    /** `subdiv_mesh_vert_corner` (:1093) via `evaluate_vert_and_apply_displacement_copy` (:1000). */
    vertCorner(_tls: SubdivMeshTLS, ptex: number, u: number, v: number, coarseVert: number, _face: number, _corner: number, subdivVert: number): void {
        copyAttrs(this.vertAttrs, this.vertSrc, coarseVert, subdivVert, this.vertDst)
        evalLimitPoint(this.subdiv, ptex, u, v, this.p)
        this.setPosition(subdivVert)
    }

    /** `subdiv_mesh_vert_edge` (:1129) via `evaluate_vert_and_apply_displacement_interpolate` (:1027). */
    vertEdge(tls: SubdivMeshTLS, ptex: number, u: number, v: number, _edge: number, face: number, corner: number, subdivVert: number): void {
        const vi = this.ensureVertInterpolation(tls, face, corner)
        this.vertDataInterpolate(subdivVert, vi, u, v)
        evalLimitPoint(this.subdiv, ptex, u, v, this.p)
        this.setPosition(subdivVert)
    }

    /** `subdiv_mesh_vert_inner` (:1172). */
    vertInner(tls: SubdivMeshTLS, ptex: number, u: number, v: number, face: number, corner: number, subdivVert: number): void {
        const vi = this.ensureVertInterpolation(tls, face, corner)
        this.vertDataInterpolate(subdivVert, vi, u, v)
        evalFinalPoint(this.subdiv, ptex, u, v, this.p)
        this.setPosition(subdivVert)
    }

    /** `subdiv_mesh_vert_loose` (:1357). */
    vertLoose(_tls: SubdivMeshTLS, coarseVert: number, subdivVert: number): void {
        copyAttrs(this.vertAttrs, this.vertSrc, coarseVert, subdivVert, this.vertDst)
        for (let k = 0; k < 3; k++) this.subdivPositions[subdivVert * 3 + k] = this.coarsePositions[coarseVert * 3 + k]
    }

    /** `subdiv_mesh_vert_of_loose_edge` (:1462). */
    vertOfLooseEdge(_tls: SubdivMeshTLS, coarseEdge: number, u: number, subdivVert: number): void {
        const e0 = this.coarseEdges[coarseEdge * 2], e1 = this.coarseEdges[coarseEdge * 2 + 1]
        if (u !== 0 && u !== 1) {
            // `subdiv_mesh_vert_of_loose_edge_interpolate` (:1434).
            mixAttrs2(this.vertAttrs, this.vertSrc, e0, e1, u, subdivVert, this.vertDst)
        }
        // `mesh_interpolate_position_on_edge` (:1413).
        const P = this.coarsePositions, out = this.subdivPositions
        if (this.subdiv.settings.isSimple) {
            // `math::interpolate(a, b, u)`: `a * (1 - u) + b * u`.
            const omu = f32(1 - u)
            for (let k = 0; k < 3; k++) out[subdivVert * 3 + k] = f32(f32(P[e0 * 3 + k] * omu) + f32(P[e1 * 3 + k] * u))
            return
        }
        // `find_edge_neighbors` (:1370): the other edge of an end vertex with exactly two edges (else infinitely sharp).
        const map = this.vertToEdge!
        const neighbor = (vert: number): number => {
            if (map.offsets[vert + 1] - map.offsets[vert] !== 2) return -1
            const a = map.indices[map.offsets[vert]], b = map.indices[map.offsets[vert] + 1]
            return a === coarseEdge ? b : a
        }
        // `edge_other_vert`: `(edge[0] - vert) + edge[1]`.
        const other = (edge: number, vert: number) => (this.coarseEdges[edge * 2] - vert) + this.coarseEdges[edge * 2 + 1]
        const n0 = neighbor(e0), n1 = neighbor(e1)
        // `find_loose_edge_interpolation_positions` (:1387): end points mirrored when there is no neighbor.
        const w = keyCurvePositionWeights(u, false)
        for (let k = 0; k < 3; k++) {
            const p1 = P[e0 * 3 + k], p2 = P[e1 * 3 + k]
            const p0 = n0 >= 0 ? P[other(n0, e0) * 3 + k] : f32(f32(p1 * 2) - p2)
            const p3 = n1 >= 0 ? P[other(n1, e1) * 3 + k] : f32(f32(p2 * 2) - p1)
            // `attribute_math::mix4<float3>`: `w.x * v0 + w.y * v1 + w.z * v2 + w.w * v3`.
            out[subdivVert * 3 + k] = f32(f32(f32(f32(w[0] * p0) + f32(w[1] * p1)) + f32(w[2] * p2)) + f32(w[3] * p3))
        }
    }

    // endregion

    /** `subdiv_mesh_edge` (:1226) with `subdiv_copy_edge_data` (:1199). */
    edge(_tls: SubdivMeshTLS, coarseEdge: number, subdivEdge: number, _isLoose: boolean, v1: number, v2: number): void {
        if (coarseEdge === ORIGINDEX_NONE) {
            for (const a of this.edgeAttrs) {
                const def = DATA_TYPES[a.type].defaultValue
                for (let k = 0; k < a.c; k++) a.dst[subdivEdge * a.c + k] = def[k]
            }
        } else {
            for (const a of this.edgeAttrs) for (let k = 0; k < a.c; k++) a.dst[subdivEdge * a.c + k] = a.src[coarseEdge * a.c + k]
        }
        this.subdivEdges[subdivEdge * 2] = v1
        this.subdivEdges[subdivEdge * 2 + 1] = v2
    }

    // region loops

    /** `loop_interpolation_from_face` (:611). */
    private loopInterpolationFromFace(li: ForInterpolation, face: number): void {
        const start = this.faces[face], size = this.faceSize(face)
        if (size === 4) {
            li.data = this.cornerSrc
            for (let k = 0; k < 4; k++) li.indices[k] = start + k
            return
        }
        li.data = li.storage
        for (let k = 0; k < 4; k++) li.indices[k] = k
        const weight = f32(1 / size)
        const weights = new Array<number>(size).fill(weight)
        const indices = Array.from({length: size}, (_, i) => start + i)
        mixAttrsN(this.cornerAttrs, this.cornerSrc, indices, weights, 2, li.storage)
    }

    /** `loop_interpolation_from_corner` (:657). */
    private loopInterpolationFromCorner(li: ForInterpolation, face: number, corner: number): void {
        const start = this.faces[face], size = this.faceSize(face)
        if (size === 4) return
        const lp = loopsOfPtexGet(start, size, corner)
        const src = this.cornerSrc
        copyAttrs(this.cornerAttrs, src, start + corner, 0, li.storage)
        const second = start + (lp.first - start + 1) % size
        mixAttrs2(this.cornerAttrs, src, lp.first, second, 0.5, 1, li.storage)
        mixAttrs2(this.cornerAttrs, src, lp.last, lp.first, 0.5, 3, li.storage)
    }

    /** `subdiv_mesh_ensure_loop_interpolation` (:1284). */
    private ensureLoopInterpolation(tls: SubdivMeshTLS, face: number, corner: number): ForInterpolation {
        if (!tls.loop) tls.loop = new ForInterpolation(this.cornerAttrs)
        if (tls.loopFace !== face) {
            this.loopInterpolationFromFace(tls.loop, face)
            this.loopInterpolationFromCorner(tls.loop, face, corner)
        } else if (tls.loopCorner !== corner) {
            this.loopInterpolationFromCorner(tls.loop, face, corner)
        }
        tls.loopFace = face
        tls.loopCorner = corner
        return tls.loop
    }

    /** `subdiv_mesh_loop` (:1304). */
    loop(tls: SubdivMeshTLS, ptex: number, u: number, v: number, _coarseLoop: number, face: number, corner: number, subdivLoop: number,
        subdivVert: number, subdivEdge: number): void {
        const li = this.ensureLoopInterpolation(tls, face, corner)
        // `subdiv_interpolate_corner_data` (:1246).
        mixAttrs4(this.cornerAttrs, li.data, li.indices, quadWeightsFromUv(u, v), subdivLoop, this.cornerDst)
        // `subdiv_eval_uv_layer` (:1272).
        this.uvMaps.forEach((uv, i) => {
            evalFaceVarying(this.subdiv, i, ptex, u, v, this.fv)
            uv[subdivLoop * 2] = this.fv[0]
            uv[subdivLoop * 2 + 1] = this.fv[1]
        })
        this.subdivCornerVerts[subdivLoop] = subdivVert
        this.subdivCornerEdges[subdivLoop] = subdivEdge
    }

    // endregion

    /** `subdiv_mesh_face` (:1331): `gather_to_groups` of the face attributes. */
    facesCb(subdivFacesByBaseFace: Int32Array): void {
        for (const a of this.faceAttrs) {
            for (let f = 0; f < this.coarse.facesNum; f++) {
                for (let d = subdivFacesByBaseFace[f]; d < subdivFacesByBaseFace[f + 1]; d++) {
                    for (let k = 0; k < a.c; k++) a.dst[d * a.c + k] = a.src[f * a.c + k]
                }
            }
        }
    }
}

/** `subdiv_to_mesh` (`subdiv_mesh.cc:1521`). Null when the evaluator could not be created for a mesh with faces. */
export function subdivToMesh(subdiv: Subdiv, settings: ToMeshSettings, coarse: MeshData): MeshData | null {
    if (!evalBeginFromMesh(subdiv, coarse)) {
        if (coarse.facesNum) return null
    }
    const ctx = new SubdivMeshContext(subdiv, settings, coarse)
    // `subdiv_to_mesh` (:1546): the vertex to edge map, for smooth loose edges.
    if (looseEdges(coarse).count) ctx.vertToEdge = vertToEdgeMap(coarse)
    // `setup_foreach_callbacks` (:1493): no displacement, so no `vert_every_corner` / `vert_every_edge`.
    const fc: ForeachContext<SubdivMeshTLS> = {
        topologyInfo: (v, e, l, f) => ctx.topologyInfo(v, e, l, f),
        vertCorner: (...a) => ctx.vertCorner(...a),
        vertEdge: (...a) => ctx.vertEdge(...a),
        vertInner: (...a) => ctx.vertInner(...a),
        edge: (...a) => ctx.edge(...a),
        loop: (...a) => ctx.loop(...a),
        faces: o => ctx.facesCb(o),
        vertLoose: (...a) => ctx.vertLoose(...a),
        vertOfLooseEdge: (...a) => ctx.vertOfLooseEdge(...a),
        makeTLS: () => ctx.makeTLS(),
    }
    foreachSubdivGeometry(subdiv, fc, settings, coarse)
    const result = ctx.subdivMesh
    // `tag_loose_verts_none` / `tag_loose_edges_none` / `tag_overlapping_none` only pre-fill caches with what they would
    // compute. For the simple scheme the bounds cache is shared with the coarse mesh (`subdiv_mesh.cc:1587-1590`).
    if (subdiv.settings.isSimple) {
        const bounds = meshBoundsMinMax(coarse)
        if (bounds) meshRuntime(result).bounds = {min: [...bounds.min], max: [...bounds.max]}
    }
    return result
}

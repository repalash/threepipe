/**
 * `bke::subdiv` setup and evaluation (Blender 5.2.2): `blenkernel/intern/subdiv.cc` (`new_from_mesh`,
 * `face_ptex_offset_get`, the settings conversions), `subdiv_converter.cc`, `subdiv_converter_mesh.cc` (the mesh to
 * OpenSubdiv converter), `subdiv_eval.cc` (`eval_begin_from_mesh`, limit and face-varying evaluation) and
 * `BKE_mesh_uv_vert_map_create` (`mesh_mapping.cc:39`). The OpenSubdiv side is `src/blender/opensubdiv/`.
 *
 * Displacement (multires) and orco/cloth orco vertex data are not part of a procedural mesh and are not ported.
 */

import {AttrDomain} from '../../constants'
import {createSubdivLimitEvaluator, SubdivLimitEvaluator} from '../subdivisionSurface'
import {MeshData} from '../../MeshData'
import {f32} from '../../blender/f32'
import {createEvaluatorFromTopologyRefiner, createTopologyRefinerFromConverter, OpenSubdivConverter, OpenSubdivEvaluator, TopologyRefinerImpl} from '../osd/blenderOpenSubdiv'
import {FVarLinearInterpolation, SchemeType, VtxBoundaryInterpolation} from '../osd/sdc'
import {looseEdges, vertsNoFace} from '../../blender/mesh/meshTopology'

/** `VtxBoundaryInterpolation` (`BKE_subdiv.hh:24`). */
export const enum SubdivVtxBoundaryInterpolation {
    NONE = 0,
    EDGE_ONLY = 1,
    EDGE_AND_CORNER = 2,
}

/** `FVarLinearInterpolation` (`BKE_subdiv.hh:34`). */
export const enum SubdivFVarLinearInterpolation {
    NONE = 0,
    CORNERS_ONLY = 1,
    CORNERS_AND_JUNCTIONS = 2,
    CORNERS_JUNCTIONS_AND_CONCAVE = 3,
    BOUNDARIES = 4,
    ALL = 5,
}

/** `bke::subdiv::Settings` (`BKE_subdiv.hh:43`). */
export interface SubdivSettings {
    isSimple: boolean
    isAdaptive: boolean
    level: number
    useCreases: boolean
    vtxBoundaryInterpolation: SubdivVtxBoundaryInterpolation
    fvarLinearInterpolation: SubdivFVarLinearInterpolation
}

/** `fvar_interpolation_from_uv_smooth` (`subdiv.cc:37`), `SUBSURF_UV_SMOOTH_*` (`DNA_modifier_types.h:246`). */
export function fvarInterpolationFromUvSmooth(uvSmooth: number): SubdivFVarLinearInterpolation {
    switch (uvSmooth) {
    case 0: return SubdivFVarLinearInterpolation.ALL
    case 1: return SubdivFVarLinearInterpolation.CORNERS_ONLY
    case 2: return SubdivFVarLinearInterpolation.CORNERS_AND_JUNCTIONS
    case 3: return SubdivFVarLinearInterpolation.CORNERS_JUNCTIONS_AND_CONCAVE
    case 4: return SubdivFVarLinearInterpolation.BOUNDARIES
    case 5: return SubdivFVarLinearInterpolation.NONE
    }
    return SubdivFVarLinearInterpolation.ALL
}

/** `vtx_boundary_interpolation_from_subsurf` (`subdiv.cc:58`), `SUBSURF_BOUNDARY_SMOOTH_*` (`DNA_modifier_types.h:255`). */
export function vtxBoundaryInterpolationFromSubsurf(boundarySmooth: number): SubdivVtxBoundaryInterpolation {
    if (boundarySmooth === 1) return SubdivVtxBoundaryInterpolation.EDGE_AND_CORNER
    return SubdivVtxBoundaryInterpolation.EDGE_ONLY
}

/** `converter_vtx_boundary_interpolation_from_settings` (`subdiv_converter.cc:20`). */
function converterVtxBoundaryInterpolation(s: SubdivSettings): VtxBoundaryInterpolation {
    switch (s.vtxBoundaryInterpolation) {
    case SubdivVtxBoundaryInterpolation.NONE: return VtxBoundaryInterpolation.NONE
    case SubdivVtxBoundaryInterpolation.EDGE_AND_CORNER: return VtxBoundaryInterpolation.EDGE_AND_CORNER
    default: return VtxBoundaryInterpolation.EDGE_ONLY
    }
}

/** `converter_fvar_linear_from_settings` (`subdiv_converter.cc:34`). */
function converterFVarLinear(s: SubdivSettings): FVarLinearInterpolation {
    switch (s.fvarLinearInterpolation) {
    case SubdivFVarLinearInterpolation.NONE: return FVarLinearInterpolation.NONE
    case SubdivFVarLinearInterpolation.CORNERS_ONLY: return FVarLinearInterpolation.CORNERS_ONLY
    case SubdivFVarLinearInterpolation.CORNERS_AND_JUNCTIONS: return FVarLinearInterpolation.CORNERS_PLUS1
    case SubdivFVarLinearInterpolation.CORNERS_JUNCTIONS_AND_CONCAVE: return FVarLinearInterpolation.CORNERS_PLUS2
    case SubdivFVarLinearInterpolation.BOUNDARIES: return FVarLinearInterpolation.BOUNDARIES
    default: return FVarLinearInterpolation.ALL
    }
}

/** `crease_to_sharpness` (`subdiv_inline.hh:116`). */
const creaseToSharpness = (crease: number) => f32(f32(crease * crease) * 10)

/** `Mesh::uv_map_names()` (`mesh.cc:1289`): the float2 corner attributes (`mesh::is_uv_map`), in attribute order. */
export function meshUvMapNames(mesh: MeshData): string[] {
    return mesh.attributes.layersOnDomain(AttrDomain.Corner).filter(l => l.type === 'float2').map(l => l.name)
}

// region mesh_mapping.cc

/** `STD_UV_CONNECT_LIMIT` (`BKE_mesh_mapping.hh:20`). */
const STD_UV_CONNECT_LIMIT = f32(0.0001)

/** `cross_poly_v2` (`math_geom.cc:153`) of the face's UVs. */
function crossPolyV2(uv: ArrayLike<number>, start: number, n: number): number {
    let prev = start + n - 1
    let cross = 0
    for (let a = 0; a < n; a++) {
        const curr = start + a
        cross = f32(cross + f32(f32(uv[prev * 2] - uv[curr * 2]) * f32(uv[curr * 2 + 1] + uv[prev * 2 + 1])))
        prev = curr
    }
    return cross
}

/** One `UvMapVert` (`BKE_mesh_mapping.hh`). */
interface UvMapVert {
    next: UvMapVert | null
    faceIndex: number
    loopOfFaceIndex: number
    separate: boolean
}

/** `BKE_mesh_uv_vert_map_create(faces, corner_verts, uv_map, verts_num, limit, use_winding)` (`mesh_mapping.cc:39`). */
function meshUvVertMapCreate(faces: ArrayLike<number>, facesNum: number, cornerVerts: ArrayLike<number>, uvMap: ArrayLike<number>,
    vertsNum: number, limit: number, useWinding: boolean): (UvMapVert | null)[] | undefined {
    if (facesNum === 0) return undefined
    const vert: (UvMapVert | null)[] = new Array(vertsNum).fill(null)
    const winding: boolean[] = []
    if (useWinding) for (let f = 0; f < facesNum; f++) winding[f] = crossPolyV2(uvMap, faces[f], faces[f + 1] - faces[f]) < 0
    for (let a = 0; a < facesNum; a++) {
        for (let i = 0; i < faces[a + 1] - faces[a]; i++) {
            const v = cornerVerts[faces[a] + i]
            vert[v] = {next: vert[v], faceIndex: a, loopOfFaceIndex: i & 0xffff, separate: false}
        }
    }
    const uvOf = (m: UvMapVert) => faces[m.faceIndex] + m.loopOfFaceIndex
    for (let vi = 0; vi < vertsNum; vi++) {
        let newvlist: UvMapVert | null = null
        let vlist = vert[vi]
        while (vlist) {
            const v: UvMapVert = vlist
            vlist = vlist.next
            v.next = newvlist
            newvlist = v
            const uv = uvOf(v)
            let lastv: UvMapVert | null = null
            let iterv = vlist
            while (iterv) {
                const next: UvMapVert | null = iterv.next
                const uv2 = uvOf(iterv)
                if (Math.abs(f32(uvMap[uv * 2] - uvMap[uv2 * 2])) < limit && Math.abs(f32(uvMap[uv * 2 + 1] - uvMap[uv2 * 2 + 1])) < limit &&
                    (!useWinding || winding[iterv.faceIndex] === winding[v.faceIndex])) {
                    if (lastv) lastv.next = next
                    else vlist = next
                    iterv.next = newvlist
                    newvlist = iterv
                } else {
                    lastv = iterv
                }
                iterv = next
            }
            newvlist.separate = true
        }
        vert[vi] = newvlist
    }
    return vert
}

// endregion

// region subdiv_converter_mesh.cc

/** `initialize_manifold_index_array` (`subdiv_converter_mesh.cc:285`). */
function manifoldIndexArray(notUsed: Uint8Array | undefined, num: number): {indices: Int32Array, reverse: Int32Array, count: number} {
    const indices = new Int32Array(num)
    const reverse = new Int32Array(num)
    let offset = 0
    for (let i = 0; i < num; i++) {
        if (!notUsed || !notUsed[i]) {
            indices[i] = i - offset
            reverse[i - offset] = i
        } else {
            indices[i] = -1
            offset++
        }
    }
    return {indices, reverse, count: num - offset}
}

/** `ConverterStorage` + the callbacks of `init_functions` (`subdiv_converter_mesh.cc:29`, :251). */
class MeshConverter implements OpenSubdivConverter {
    readonly faceOffsets: Int32Array
    readonly facesNum: number
    readonly uvMapNames: string[]
    readonly cdVertexCrease?: ArrayLike<number>
    readonly cdEdgeCrease?: ArrayLike<number>
    loopUvIndices?: Int32Array
    numUvCoordinates = 0
    readonly manifoldVertexIndex: Int32Array
    readonly manifoldVertexIndexReverse: Int32Array
    readonly manifoldEdgeIndexReverse: Int32Array
    readonly numManifoldVertices: number
    readonly numManifoldEdges: number
    readonly infiniteSharpVerticesMap?: Uint8Array

    /** `converter_init_for_mesh` (:381) / `init_user_data` (:358) / `initialize_manifold_indices` (:331). */
    constructor(readonly settings: SubdivSettings, readonly mesh: MeshData) {
        this.faceOffsets = mesh.faceOffsets
        this.facesNum = mesh.facesNum
        if (settings.useCreases) {
            this.cdVertexCrease = pointFloat(mesh, 'crease_vert', AttrDomain.Point)
            this.cdEdgeCrease = pointFloat(mesh, 'crease_edge', AttrDomain.Edge)
        }
        this.uvMapNames = meshUvMapNames(mesh)
        const noFace = vertsNoFace(mesh)
        const loose = looseEdges(mesh)
        const v = manifoldIndexArray(noFace.count ? noFace.mask : undefined, mesh.vertsNum)
        this.manifoldVertexIndex = v.indices
        this.manifoldVertexIndexReverse = v.reverse
        this.numManifoldVertices = v.count
        const e = manifoldIndexArray(loose.count ? loose.mask : undefined, mesh.edgesNum)
        this.manifoldEdgeIndexReverse = e.reverse
        this.numManifoldEdges = e.count
        if (loose.count) {
            this.infiniteSharpVerticesMap = new Uint8Array(mesh.vertsNum)
            const edges = mesh.edgeVerts
            for (let i = 0; i < mesh.edgesNum; i++) {
                if (!loose.mask[i]) continue
                this.infiniteSharpVerticesMap[edges[i * 2]] = 1
                this.infiniteSharpVerticesMap[edges[i * 2 + 1]] = 1
            }
        }
    }

    /** `get_scheme_type` (:69): `BUGGY_SIMPLE_SCHEME_WORKAROUND` - always Catmark. */
    getSchemeType() { return SchemeType.CATMARK }
    getVtxBoundaryInterpolation() { return converterVtxBoundaryInterpolation(this.settings) }
    getFVarLinearInterpolation() { return converterFVarLinear(this.settings) }
    specifiesFullTopology() { return false }
    getNumEdges() { return this.numManifoldEdges }
    getNumVertices() { return this.numManifoldVertices }

    /** `get_face_vertices` (:118). */
    getFaceVertices(face: number, out: {set(i: number, v: number): void}): void {
        const cv = this.mesh.cornerVerts
        for (let i = 0, c = this.faceOffsets[face]; c < this.faceOffsets[face + 1]; i++, c++) out.set(i, this.manifoldVertexIndex[cv[c]])
    }

    /** `get_edge_vertices` (:130). */
    getEdgeVertices(edge: number): [number, number] {
        const e = this.manifoldEdgeIndexReverse[edge]
        const ev = this.mesh.edgeVerts
        return [this.manifoldVertexIndex[ev[e * 2]], this.manifoldVertexIndex[ev[e * 2 + 1]]]
    }

    /** `get_edge_sharpness` (:141). */
    getEdgeSharpness(edge: number): number {
        if (this.settings.isSimple) return 10
        if (!this.cdEdgeCrease) return 0
        return creaseToSharpness(this.cdEdgeCrease[this.manifoldEdgeIndexReverse[edge]])
    }

    /** `is_infinite_sharp_vertex` (:156). */
    isInfiniteSharpVertex(vertex: number): boolean {
        if (this.settings.isSimple) return true
        if (!this.infiniteSharpVerticesMap) return false
        return this.infiniteSharpVerticesMap[this.manifoldVertexIndexReverse[vertex]] !== 0
    }

    /** `get_vertex_sharpness` (:172). */
    getVertexSharpness(vertex: number): number {
        if (!this.cdVertexCrease) return 0
        return creaseToSharpness(this.cdVertexCrease[this.manifoldVertexIndexReverse[vertex]])
    }

    getNumUVLayers() { return this.uvMapNames.length }

    /** `precalc_uv_layer` (:188). */
    precalcUVLayer(layer: number): void {
        const mesh = this.mesh
        const uvMap = mesh.attributes.get(this.uvMapNames[layer])!.data
        const numVert = mesh.vertsNum
        if (!this.loopUvIndices) this.loopUvIndices = new Int32Array(mesh.cornersNum)
        const map = meshUvVertMapCreate(this.faceOffsets, this.facesNum, mesh.cornerVerts, uvMap, numVert, STD_UV_CONNECT_LIMIT, true)!
        this.numUvCoordinates = -1
        for (let v = 0; v < numVert; v++) {
            let uvVert = map[v]
            while (uvVert) {
                if (uvVert.separate) this.numUvCoordinates++
                this.loopUvIndices[this.faceOffsets[uvVert.faceIndex] + uvVert.loopOfFaceIndex] = this.numUvCoordinates
                uvVert = uvVert.next
            }
        }
        this.numUvCoordinates += 1
    }

    finishUVLayer(): void {}
    getNumUVCoordinates() { return this.numUvCoordinates }

    /** `get_face_corner_uv_index` (:232). */
    getFaceCornerUVIndex(face: number, corner: number): number {
        return this.loopUvIndices![this.faceOffsets[face] + corner]
    }
}

/** A float attribute on `domain` (`attributes.lookup<float>`), if present (converted when another type). */
function pointFloat(mesh: MeshData, name: string, domain: AttrDomain): ArrayLike<number> | undefined {
    const layer = mesh.attributes.get(name)
    if (!layer) return undefined
    if (layer.domain !== domain || layer.type !== 'float') {
        throw new Error(`subdiv: crease attribute '${name}' on another domain or of another type is not ported (adapt_domain / conversion)`)
    }
    return layer.data
}

// endregion

// region subdiv.cc / subdiv_eval.cc

/** `bke::subdiv::Subdiv` (`BKE_subdiv.hh:154`). */
export interface Subdiv {
    settings: SubdivSettings
    topologyRefiner?: TopologyRefinerImpl
    evaluator?: OpenSubdivEvaluator
    /**
     * The limit-surface evaluator (`is_adaptive`): the kernel's OpenSubdiv port (`createSubdivLimitEvaluator`), whose
     * adaptive refinement and patch tables evaluate in double where Blender's CPU evaluator uses float - results
     * agree to about 1e-7, not to the bit (issue `procedural-subdiv-one-port.md`).
     */
    limitEvaluator?: SubdivLimitEvaluator
    facePtexOffset?: Int32Array
}

/** `new_from_mesh` (`subdiv.cc:122`) via `new_from_converter` (:84). */
export function subdivNewFromMesh(settings: SubdivSettings, mesh: MeshData): Subdiv | undefined {
    if (mesh.vertsNum === 0) return undefined
    const converter = new MeshConverter(settings, mesh)
    let topologyRefiner: TopologyRefinerImpl | undefined
    if (converter.getNumVertices() !== 0) {
        topologyRefiner = createTopologyRefinerFromConverter(converter, {level: settings.level, isAdaptive: settings.isAdaptive})
    }
    return {settings: {...settings}, topologyRefiner}
}

/** `face_ptex_offset_get` (`subdiv.cc:212`): `facesNum + 1` offsets. */
export function facePtexOffsetGet(subdiv: Subdiv): Int32Array {
    if (subdiv.facePtexOffset) return subdiv.facePtexOffset
    const refiner = subdiv.topologyRefiner
    if (!refiner) return new Int32Array(0)
    const base = refiner.topologyRefiner.getLevel(0)
    const n = base.getNumFaces()
    const offsets = new Int32Array(n + 1)
    let ptex = 0
    for (let f = 0; f < n; f++) {
        const size = base.getFaceVertices(f).size
        offsets[f] = ptex
        ptex += size === 4 ? 1 : size
    }
    offsets[n] = ptex
    return subdiv.facePtexOffset = offsets
}

/** `eval_begin` (`subdiv_eval.cc:58`) for the CPU evaluator. */
function evalBegin(subdiv: Subdiv, numVertexData: number): boolean {
    if (!subdiv.topologyRefiner) return false
    if (!subdiv.evaluator) subdiv.evaluator = createEvaluatorFromTopologyRefiner(subdiv.topologyRefiner)
    subdiv.evaluator.evalOutput.setSettings(numVertexData)
    return true
}

/** `set_coarse_positions` (`subdiv_eval.cc:94`): the positions of vertices used by faces. */
function setCoarsePositions(subdiv: Subdiv, positions: ArrayLike<number>, vertsNum: number, noFace: {mask: Uint8Array, count: number}): void {
    const out = subdiv.evaluator!.evalOutput
    if (noFace.count === 0) {
        out.setCoarsePositions(positions, 0, vertsNum)
        return
    }
    const used = new Float32Array((vertsNum - noFace.count) * 3)
    let j = 0
    for (let i = 0; i < vertsNum; i++) {
        if (noFace.mask[i]) continue
        used[j * 3] = positions[i * 3]
        used[j * 3 + 1] = positions[i * 3 + 1]
        used[j * 3 + 2] = positions[i * 3 + 2]
        j++
    }
    out.setCoarsePositions(used, 0, j)
}

/** `set_face_varying_data_from_uv` (`subdiv_eval.cc:139`). */
function setFaceVaryingDataFromUv(subdiv: Subdiv, mesh: MeshData, uvMap: ArrayLike<number>, layer: number): void {
    const base = subdiv.topologyRefiner!.topologyRefiner.getLevel(0)
    const numFaces = base.getNumFaces()
    const numValues = base.getNumFVarValues(layer)
    const buffer = new Float32Array(numValues * 2)
    const faces = mesh.faceOffsets
    for (let f = 0; f < numFaces; f++) {
        const indices = base.getFaceFVarValues(f, layer)
        for (let i = 0; i < indices.size; i++) {
            buffer[indices.get(i) * 2] = uvMap[(faces[f] + i) * 2]
            buffer[indices.get(i) * 2 + 1] = uvMap[(faces[f] + i) * 2 + 1]
        }
    }
    subdiv.evaluator!.evalOutput.setFaceVaryingData(layer, buffer, 0, numValues)
}

const BOUNDARY_SMOOTH = {[SubdivVtxBoundaryInterpolation.EDGE_AND_CORNER]: 'PRESERVE_CORNERS'} as Record<number, 'PRESERVE_CORNERS' | undefined>
const UV_SMOOTH = {
    [SubdivFVarLinearInterpolation.ALL]: 'NONE', [SubdivFVarLinearInterpolation.CORNERS_ONLY]: 'PRESERVE_CORNERS',
    [SubdivFVarLinearInterpolation.CORNERS_AND_JUNCTIONS]: 'PRESERVE_CORNERS_AND_JUNCTIONS',
    [SubdivFVarLinearInterpolation.CORNERS_JUNCTIONS_AND_CONCAVE]: 'PRESERVE_CORNERS_JUNCTIONS_AND_CONCAVE',
    [SubdivFVarLinearInterpolation.BOUNDARIES]: 'PRESERVE_BOUNDARIES', [SubdivFVarLinearInterpolation.NONE]: 'SMOOTH_ALL',
} as const

/** `eval_begin_from_mesh` (`subdiv_eval.cc:216`) with `eval_refine_from_mesh` (:233). */
export function evalBeginFromMesh(subdiv: Subdiv, mesh: MeshData): boolean {
    if (subdiv.settings.isAdaptive) {
        // The adaptive evaluator (`evaluator_impl.cc:439`): refined to `level` (the node's Quality) with patch tables.
        if (!subdiv.topologyRefiner) return false
        const s = subdiv.settings
        if (s.vtxBoundaryInterpolation === SubdivVtxBoundaryInterpolation.NONE) throw new Error('subdiv: VTX_BOUNDARY_NONE is not supported by the limit evaluator')
        subdiv.limitEvaluator = createSubdivLimitEvaluator(mesh, {
            quality: s.level, useCreases: s.useCreases,
            boundarySmooth: BOUNDARY_SMOOTH[s.vtxBoundaryInterpolation] ?? 'ALL',
            uvSmooth: UV_SMOOTH[s.fvarLinearInterpolation],
            uvMaps: meshUvMapNames(mesh).map(name => mesh.attributes.get(name)!.data),
        }) ?? undefined
        return !!subdiv.limitEvaluator
    }
    // `get_mesh_evaluator_settings`: no orco layers on a procedural mesh.
    if (!evalBegin(subdiv, 0)) return false
    setCoarsePositions(subdiv, mesh.positions, mesh.vertsNum, vertsNoFace(mesh))
    meshUvMapNames(mesh).forEach((name, i) => setFaceVaryingDataFromUv(subdiv, mesh, mesh.attributes.get(name)!.data, i))
    subdiv.evaluator!.evalOutput.refine()
    return true
}

/** `eval_limit_point` (`subdiv_eval.cc:273`). */
export function evalLimitPoint(subdiv: Subdiv, ptexFace: number, u: number, v: number, out: number[]): void {
    if (subdiv.limitEvaluator) {
        // `evaluateLimit` writes floats (`float P[3]`).
        subdiv.limitEvaluator.evaluateLimit(ptexFace, u, v, limitScratch)
        for (let k = 0; k < 3; k++) out[k] = f32(limitScratch[k])
        return
    }
    subdiv.evaluator!.evalOutput.evaluateLimit(ptexFace, u, v, out)
}

const limitScratch = new Float64Array(3)

/** `eval_final_point` (`subdiv_eval.cc:384`): no displacement evaluator, so the limit point. */
export function evalFinalPoint(subdiv: Subdiv, ptexFace: number, u: number, v: number, out: number[]): void {
    evalLimitPoint(subdiv, ptexFace, u, v, out)
}

/** `eval_face_varying` (`subdiv_eval.cc:345`). */
export function evalFaceVarying(subdiv: Subdiv, channel: number, ptexFace: number, u: number, v: number, out: number[]): void {
    if (subdiv.limitEvaluator) {
        subdiv.limitEvaluator.evaluateFaceVarying(channel, ptexFace, u, v, limitScratch)
        out[0] = f32(limitScratch[0])
        out[1] = f32(limitScratch[1])
        return
    }
    subdiv.evaluator!.evalOutput.evaluateFaceVarying(channel, ptexFace, u, v, out)
}

// endregion

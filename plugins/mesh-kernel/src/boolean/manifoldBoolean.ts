/**
 * Mesh booleans with Manifold, as Blender does them: a port of
 * `geometry/intern/mesh_boolean_manifold.cc` (Blender 5.2.2, the "Manifold" solver of the Boolean modifier and
 * the Mesh Boolean node) with the helpers it uses from `mesh_boolean.cc`.
 *
 * The kernel stays dependency-free: the caller passes the initialised `manifold-3d` module. Blender 5.2.2 pins
 * Manifold v3.5.2 (`build_files/build_environment/cmake/versions.cmake:354`), which is not on npm; `manifold-3d@3.5.3`
 * adds only a Windows ARM64 sine fix and CI changes. 3.4.1 triangulated one coplanar union differently, which changed
 * how faces merged back (`tests/boolean-parity.test.ts`, box-union-three).
 *
 * The pipeline:
 * 1. join the inputs with their transforms (`join_meshes_with_transforms`, `mesh_boolean.cc:282`), keeping a
 *    per-mesh offset table (`MeshOffsets`);
 * 2. each input becomes a Manifold from its triangulation (`get_manifold`, `:249`): one run per mesh,
 *    `faceID` = the face's index in the joined mesh;
 * 3. `BatchBoolean` (or `TrimByPlane` when a single quad is subtracted, `:1853`); errors map to
 *    NonManifold / ResultTooBig / Unknown;
 * 4. back to n-gons (`assemble_mesh_from_meshgl`, `:1427`): triangles grouped by `faceID`, merged across the
 *    edges they share (`merge_out_faces`, `:1178`), collinear valence-2 vertices dissolved (`:1294`);
 * 5. attributes through output-to-input maps (`OutToInMaps`, `:439-825`): points by exact position within the
 *    source face, faces by `faceID`, edges by end and direction, corners copied or interpolated with mean-value
 *    weights in the source face (`interpolate_corner_attributes`, `mesh_boolean.cc:101`).
 *
 * Known divergence: n-gons (more than four corners) are triangulated with the kernel's ear clipper, not
 * `BLI_polyfill_calc` (`issues/open/modelling-tools/kernel-triangulate-ngon-polyfill.md`); planar n-gons come out
 * the same after step 4, non-planar ones may differ.
 */

import {MeshData} from '../MeshData'
import {AttrDomain, AttrName, ATTR_TYPE_INFO} from '../constants'
import {AttributeLayer} from '../attributes'
import {Mat4, Vec3, mat4TransformPoint} from '../math'
import {axisDominantV3ToM3, mulV2M3V3} from '../math/geom'
import {interpWeightsPolyV2} from '../bmesh/interp'
import {tessellatePolygon} from '../bake'
import {meshFaceNormals} from '../shading'

// region manifold-3d surface (structural, so the kernel does not import the package)

export interface ManifoldMeshGL {
    numProp: number
    vertProperties: Float32Array
    triVerts: Uint32Array
    mergeFromVert: Uint32Array
    runIndex: Uint32Array
    runOriginalID: Uint32Array
    faceID: Uint32Array
}

export interface ManifoldInstance {
    status(): string
    getMesh(): ManifoldMeshGL
    trimByPlane(normal: [number, number, number], originOffset: number): ManifoldInstance
    delete(): void
}

export interface ManifoldApi {
    Manifold: {
        new (mesh: unknown): ManifoldInstance
        union(manifolds: ManifoldInstance[]): ManifoldInstance
        difference(manifolds: ManifoldInstance[]): ManifoldInstance
        intersection(manifolds: ManifoldInstance[]): ManifoldInstance
    }
    Mesh: new (options: {numProp: number, vertProperties: Float32Array, triVerts: Uint32Array, runIndex?: Uint32Array, runOriginalID?: Uint32Array, faceID?: Uint32Array}) => unknown
}

// endregion

/** Blender's `geometry::boolean::Operation`, RNA spelling. */
export type BooleanOperation = 'INTERSECT' | 'UNION' | 'DIFFERENCE'

/** `BooleanErrorType`. */
export type BooleanError = 'NONE' | 'NON_MANIFOLD' | 'RESULT_TOO_BIG' | 'UNKNOWN'

export interface BooleanResult {
    mesh: MeshData | null
    error: BooleanError
    /** Which inputs were not manifold, when `error` is `NON_MANIFOLD`. */
    nonManifoldMeshIndices: number[]
    /** Edges of the result that separate faces from different inputs (the node's "Intersecting Edges"). */
    intersectingEdges: number[]
}

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

interface MeshOffsets { vertStart: number[], faceStart: number[], edgeStart: number[], cornerStart: number[] }

function meshOffsets(meshes: MeshData[]): MeshOffsets {
    const o: MeshOffsets = {vertStart: [0], faceStart: [0], edgeStart: [0], cornerStart: [0]}
    for (const m of meshes) {
        o.vertStart.push(o.vertStart[o.vertStart.length - 1] + m.vertsNum)
        o.faceStart.push(o.faceStart[o.faceStart.length - 1] + m.facesNum)
        o.edgeStart.push(o.edgeStart[o.edgeStart.length - 1] + m.edgesNum)
        o.cornerStart.push(o.cornerStart[o.cornerStart.length - 1] + m.cornersNum)
    }
    return o
}

/** `mesh_id_for_face` (`mesh_boolean.cc:71`). */
function meshIdForFace(face: number, o: MeshOffsets): number {
    for (let i = 0; i + 1 < o.faceStart.length; i++) if (face >= o.faceStart[i] && face < o.faceStart[i + 1]) return i
    return -1
}

const TOPOLOGY = new Set<string>([AttrName.position, AttrName.edgeVerts, AttrName.cornerVert, AttrName.cornerEdge])

/**
 * `join_meshes_with_transforms` (`mesh_boolean.cc:282`), which is `realize_instances`: the inputs concatenated in
 * order, positions transformed, every attribute of any input present on the result (default where an input lacks
 * it). Materials are joined as `realize_instances.cc` does (`preprocess_meshes` :1542, `join_mesh_material_indices`
 * :1927): the result's list is the ordered union of the inputs' lists (an input without slots contributes one empty
 * slot, here `''`), face indices are remapped into it, and `material_index` exists only when that union has more
 * than one entry.
 */
export function joinMeshesWithTransforms(meshes: MeshData[], transforms: Mat4[]): MeshData {
    const positions: number[] = [], faces: number[][] = []
    let vBase = 0
    meshes.forEach((m, i) => {
        const t = transforms[i] ?? IDENTITY
        for (let v = 0; v < m.vertsNum; v++) {
            const p = mat4TransformPoint(t, [m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]])
            positions.push(p[0], p[1], p[2])
        }
        for (let f = 0; f < m.facesNum; f++) faces.push(Array.from(m.cornerVerts.subarray(m.faceOffsets[f], m.faceOffsets[f + 1]), c => c + vBase))
        vBase += m.vertsNum
    })
    const joined = MeshData.fromFaces({positions, faces})
    // fromFaces rebuilt the edges; map each input edge to its joined edge by vertex pair
    const edgeIndex = new Map<string, number>()
    const ev = joined.edgeVerts
    for (let e = 0; e < joined.edgesNum; e++) {
        const a = ev[2 * e], b = ev[2 * e + 1]
        edgeIndex.set(a < b ? `${a}-${b}` : `${b}-${a}`, e)
    }
    const o = meshOffsets(meshes)
    const seen = new Map<string, AttributeLayer>()
    meshes.forEach((m, i) => {
        for (const layer of m.attributes.layers()) {
            // custom normals: realize_instances joins them through NormalJoinInfo (converting fan-encoded ones to
            // float3) and the boolean flips them on mirrored faces; not ported, so they are left out rather than
            // mixed as raw int16 data (issues/open/modelling-tools/kernel-boolean-custom-normals.md)
            if (TOPOLOGY.has(layer.name) || layer.name === AttrName.materialIndex || layer.name === AttrName.customNormal) continue
            let dst = seen.get(layer.name)
            if (!dst) {
                if (joined.attributes.get(layer.name)) continue
                dst = joined.attributes.ensure(layer.name, layer.domain, layer.type)
                seen.set(layer.name, dst)
            }
            if (dst.domain !== layer.domain || dst.type !== layer.type) continue // realize_instances would convert; not needed by any caller yet
            const comps = ATTR_TYPE_INFO[layer.type].components
            if (layer.domain === AttrDomain.Edge) {
                const mev = m.edgeVerts
                for (let e = 0; e < m.edgesNum; e++) {
                    const a = mev[2 * e] + o.vertStart[i], b = mev[2 * e + 1] + o.vertStart[i]
                    const je = edgeIndex.get(a < b ? `${a}-${b}` : `${b}-${a}`)
                    if (je === undefined) continue
                    for (let k = 0; k < comps; k++) dst.data[je * comps + k] = layer.data[e * comps + k]
                }
            } else {
                const base = layer.domain === AttrDomain.Point ? o.vertStart[i] : layer.domain === AttrDomain.Face ? o.faceStart[i] : o.cornerStart[i]
                dst.data.set(layer.data, base * comps)
            }
        }
    })
    joinMaterialIndices(meshes, joined, o)
    return joined
}

/** `realize_instances.cc` material joining: union of slots, remapped `material_index` (see above). */
function joinMaterialIndices(meshes: MeshData[], joined: MeshData, o: MeshOffsets): void {
    const union: string[] = []
    const indexOf = (m: string) => {
        let i = union.indexOf(m)
        if (i < 0) { i = union.length; union.push(m) }
        return i
    }
    // gather_meshes_to_realize skips meshes without vertices
    const maps = meshes.map(m => m.vertsNum > 0 ? (m.materials.length ? m.materials.map(indexOf) : [indexOf('')]) : null)
    joined.materials = union
    if (union.length <= 1) return
    const dst = joined.attributes.ensure(AttrName.materialIndex, AttrDomain.Face, 'int32').data
    meshes.forEach((m, i) => {
        const map = maps[i]
        if (!map) return
        const src = m.attributes.get(AttrName.materialIndex)?.data
        const totcol = m.materials.length
        for (let f = 0; f < m.facesNum; f++) {
            // get_mapped_material_index (:1858) / the span branch (:1966): out-of-range indices go to the first slot,
            // or to 0 for a mesh with slots and a per-face array
            const idx = src ? src[f] : 0
            dst[o.faceStart[i] + f] = totcol === 0 ? map[0] : idx >= 0 && idx < totcol ? map[idx] : src ? 0 : map[0]
        }
    })
}

/**
 * `get_material_remap_index_based` (`MOD_boolean.cc:366`) with `BKE_object_material_remap_calc`
 * (`material.cc:1281`): the Boolean modifier's default "Index Based" materials. Operand slot `i` keeps index `i`
 * when the target has that many slots (else 0), unless its material sits elsewhere in the target's list.
 */
export function materialRemapIndexBased(target: string[], operand: string[]): number[] {
    const n = operand.length
    if (n <= 0) return [0]
    const remap = new Array<number>(n).fill(0)
    const map = new Map<string, number>()
    target.forEach((m, i) => { if (!map.has(m)) map.set(m, i) })
    if (target.length >= n) for (let i = 0; i < n; i++) remap[i] = i
    else for (let i = 0; i < target.length; i++) remap[i] = i
    for (let i = 0; i < n; i++) {
        if (i < target.length && operand[i] === target[i]) continue
        const j = map.get(operand[i])
        if (j !== undefined) remap[i] = j
    }
    return remap
}

/** `mesh_calc_tessellation_for_face_impl` (`mesh_tessellate.cc:38`): corner triples for one face. */
function faceTriangles(m: MeshData, f: number, out: number[]): void {
    const s = m.faceOffsets[f], n = m.faceOffsets[f + 1] - s
    const P = m.positions, cv = m.cornerVerts
    const p = (c: number): Vec3 => [P[3 * cv[c]], P[3 * cv[c] + 1], P[3 * cv[c] + 2]]
    if (n === 3) { out.push(s, s + 1, s + 2); return }
    if (n === 4) {
        // is_quad_flip_v3_first_third_fast (math_geom.cc:5609): flip out of a degenerate 0-2 split
        const v1 = p(s), v2 = p(s + 1), v3 = p(s + 2), v4 = p(s + 3)
        const d12 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]], d13 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]], d14 = [v4[0] - v1[0], v4[1] - v1[1], v4[2] - v1[2]]
        const ca = [d12[1] * d13[2] - d12[2] * d13[1], d12[2] * d13[0] - d12[0] * d13[2], d12[0] * d13[1] - d12[1] * d13[0]]
        const cb = [d14[1] * d13[2] - d14[2] * d13[1], d14[2] * d13[0] - d14[0] * d13[2], d14[0] * d13[1] - d14[1] * d13[0]]
        if (ca[0] * cb[0] + ca[1] * cb[1] + ca[2] * cb[2] > 0) out.push(s, s + 1, s + 3, s + 1, s + 2, s + 3)
        else out.push(s, s + 1, s + 2, s, s + 2, s + 3)
        return
    }
    const pts: number[] = []
    for (let c = s; c < s + n; c++) pts.push(...p(c))
    const local: number[] = []
    tessellatePolygon(pts, local)
    for (const k of local) out.push(s + k)
}

/** `get_manifold` (`mesh_boolean_manifold.cc:249`). Throws ManifoldError for non-manifold input. */
function toManifold(api: ManifoldApi, joined: MeshData, mesh: number, o: MeshOffsets): ManifoldInstance {
    const v0 = o.vertStart[mesh], v1 = o.vertStart[mesh + 1], f0 = o.faceStart[mesh], f1 = o.faceStart[mesh + 1]
    const vertProperties = Float32Array.from(joined.positions.subarray(3 * v0, 3 * v1))
    const tris: number[] = [], faceID: number[] = []
    for (let f = f0; f < f1; f++) {
        const before = tris.length
        faceTriangles(joined, f, tris)
        for (let t = before; t < tris.length; t += 3) faceID.push(f)
    }
    const triVerts = Uint32Array.from(tris, c => joined.cornerVerts[c] - v0)
    const ntri = triVerts.length / 3
    const meshgl = new api.Mesh({
        numProp: 3, vertProperties, triVerts,
        runIndex: Uint32Array.from([0, ntri * 3]), runOriginalID: Uint32Array.from([mesh]), faceID: Uint32Array.from(faceID),
    })
    return new api.Manifold(meshgl)
}

/** `is_plane` (`mesh_boolean_manifold.cc:1545`): normals from `math::normal_tri` = normalize((a - b) x (b - c)). */
function isPlane(m: MeshData, t: Mat4): {normal: Vec3, offset: number} | null {
    if (m.facesNum !== 1 || m.vertsNum !== 4) return null
    const s = m.faceOffsets[0]
    const v = [0, 1, 2, 3].map(i => {
        const c = m.cornerVerts[s + i]
        return mat4TransformPoint(t, [m.positions[3 * c], m.positions[3 * c + 1], m.positions[3 * c + 2]])
    })
    const nt = (a: Vec3, b: Vec3, c: Vec3): Vec3 => {
        const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], w = [b[0] - c[0], b[1] - c[1], b[2] - c[2]]
        const n: Vec3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
        const l = Math.hypot(...n)
        return l > 1e-35 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 0]
    }
    const n1 = nt(v[0], v[1], v[2]), n2 = nt(v[0], v[2], v[3])
    // math::almost_equal_relative(norm1, norm2, 1e-5f) (BLI_math_vector.hh:25): per component, the epsilon is
    // scaled by |norm1[i]| only
    const close = n1.every((x, i) => Math.abs(x - n2[i]) <= 1e-5 * Math.abs(x))
    if (!close) return null
    return {normal: n1, offset: n1[0] * v[0][0] + n1[1] * v[0][1] + n1[2] * v[0][2]}
}

const statusToError = (status: string): BooleanError =>
    status === 'NoError' ? 'NONE' : status === 'ResultTooLarge' ? 'RESULT_TOO_BIG' : status === 'NotManifold' ? 'NON_MANIFOLD' : 'UNKNOWN'

/**
 * Blender's Manifold boolean of `meshes` (each placed by `transforms[i]`): `UNION`, `INTERSECT`, or `DIFFERENCE`
 * (the first minus all the others).
 *
 * `materialRemaps` is `mesh_boolean`'s `material_remaps`: empty to keep the joined `material_index`, or one map per
 * input (operand slot -> result slot; `[]` for "unchanged"), as the Boolean modifier passes them (target `[]`,
 * operands from {@link materialRemapIndexBased}).
 */
export function meshBooleanManifold(
    api: ManifoldApi, meshes: MeshData[], operation: BooleanOperation, transforms: Mat4[] = [], materialRemaps: number[][] = [],
): BooleanResult {
    const fail = (error: BooleanError, nonManifoldMeshIndices: number[] = []): BooleanResult => ({mesh: null, error, nonManifoldMeshIndices, intersectingEdges: []})
    if (!meshes.length) return fail('UNKNOWN')
    const joined = joinMeshesWithTransforms(meshes, transforms)
    const o = meshOffsets(meshes)
    const manifolds: (ManifoldInstance | null)[] = []
    const statuses: string[] = []
    for (let i = 0; i < meshes.length; i++) {
        try {
            manifolds.push(toManifold(api, joined, i, o))
            statuses.push(manifolds[i]!.status())
        } catch (e) {
            manifolds.push(null)
            statuses.push((e as {code?: string}).code ?? 'Unknown')
        }
    }
    let mgl: ManifoldMeshGL
    try {
        if (statuses.some(s => s !== 'NoError')) {
            const plane = meshes.length === 2 && operation === 'DIFFERENCE' && statuses[0] === 'NoError' ? isPlane(meshes[1], transforms[1] ?? IDENTITY) : null
            if (!plane) {
                const bad = statuses.map((s, i) => s === 'NotManifold' ? i : -1).filter(i => i >= 0)
                return fail(bad.length ? 'NON_MANIFOLD' : 'UNKNOWN', bad)
            }
            // mesh_trim_manifold (:1575)
            const r = manifolds[0]!.trimByPlane(plane.normal, plane.offset)
            mgl = r.getMesh()
            const err = statusToError(r.status())
            r.delete()
            if (err !== 'NONE') return fail(err)
            if (mgl.vertProperties.length > 0 && mgl.runOriginalID.length === 2) {
                mgl.runOriginalID[1] = 1
                const from = mgl.runIndex[1] / 3, to = mgl.runIndex[2] / 3
                for (let i = from; i < to; i++) mgl.faceID[i] = o.faceStart[1]
            }
        } else {
            const list = manifolds as ManifoldInstance[]
            const r = operation === 'INTERSECT' ? api.Manifold.intersection(list) : operation === 'UNION' ? api.Manifold.union(list) : api.Manifold.difference(list)
            mgl = r.getMesh()
            const err = statusToError(r.status())
            r.delete()
            if (err !== 'NONE') return fail(err === 'NON_MANIFOLD' ? 'UNKNOWN' : err)
        }
    } finally {
        for (const m of manifolds) m?.delete()
    }
    cleanMeshGL(mgl)
    return meshglToMesh(mgl, joined, o, meshes, materialRemaps)
}

/** `clean_meshgl` (`mesh_boolean_manifold.cc:383`): drop triangles with out-of-range or repeated vertices. */
function cleanMeshGL(mgl: ManifoldMeshGL): void {
    const nv = mgl.vertProperties.length / mgl.numProp, nt = mgl.triVerts.length / 3
    const tris: number[] = [], ids: number[] = []
    for (let t = 0; t < nt; t++) {
        const a = mgl.triVerts[3 * t], b = mgl.triVerts[3 * t + 1], c = mgl.triVerts[3 * t + 2]
        if (a >= nv || b >= nv || c >= nv || a === b || a === c || b === c) continue
        tris.push(a, b, c); ids.push(mgl.faceID[t])
    }
    if (tris.length !== mgl.triVerts.length) { mgl.triVerts = Uint32Array.from(tris); mgl.faceID = Uint32Array.from(ids) }
}

// region assembling n-gons

interface OutFace { verts: number[], faceId: number }
interface SharedEdge { e1: number, e2: number, v1: number, v2: number }

/** `canon_shared_edge` (`:959`). */
const canonSharedEdge = (e1: number, e2: number, v1: number, v2: number): SharedEdge => v1 < v2 ? {e1, e2, v1, v2} : {e1: e2, e2: e1, v1: v2, v2: v1}

/** `get_shared_edge_from_pair` (`:972`). */
function sharedEdgeFromPair(t1: OutFace, t2: OutFace): SharedEdge | null {
    for (let i1 = 0; i1 < 3; i1++) {
        for (let i2 = 0; i2 < 3; i2++) {
            const v1 = t1.verts[i1], v2 = t2.verts[i2]
            if (v1 !== v2) continue
            const v1Next = t1.verts[(i1 + 1) % 3], v2Prev = t2.verts[(i2 + 2) % 3]
            if (v1Next === v2Prev) return {e1: i1, e2: 3 + ((i2 + 2) % 3), v1, v2: v1Next}
            const v1Prev = t1.verts[(i1 + 2) % 3], v2Next = t2.verts[(i2 + 1) % 3]
            if (v1Prev === v2Next) return {e1: (i1 + 2) % 3, e2: 3 + i2, v1: v1Prev, v2: v1}
        }
    }
    return null
}

/** `get_shared_edges` (`:1007`). */
function sharedEdges(faces: OutFace[]): SharedEdge[] {
    const out: SharedEdge[] = []
    const map = new Map<string, number>()
    faces.forEach((f, fi) => {
        for (let i = 0; i < 3; i++) {
            const v1 = f.verts[i], v2 = f.verts[(i + 1) % 3], e = fi * 3 + i
            map.set(`${v1},${v2}`, e)
            const other = map.get(`${v2},${v1}`)
            if (other !== undefined) out.push(canonSharedEdge(e, other, v1, v2))
        }
    })
    return out
}

/** `is_legal_merge` (`:1034`). */
function isLegalMerge(f1: OutFace, f2: OutFace, v1: number, v2: number): boolean {
    for (const v of f1.verts) if (v !== v1 && v !== v2 && f2.verts.includes(v)) return false
    for (const v of f2.verts) if (v !== v1 && v !== v2 && f1.verts.includes(v)) return false
    return true
}

/** `try_merge_out_face_pair` (`:1065`). */
function tryMergeOutFacePair(f1: OutFace, f2: OutFace, se: SharedEdge): boolean {
    const n1 = f1.verts.length, n2 = f2.verts.length
    const i1 = f1.verts.indexOf(se.v1), i1Next = (i1 + 1) % n1
    const i2 = f2.verts.indexOf(se.v2), i2Next = (i2 + 1) % n2
    if (!isLegalMerge(f1, f2, se.v1, se.v2)) return false
    const i2Prev = (i2 + n2 - 1) % n2, i2NextNext = (i2Next + 1) % n2
    let insert: number[]
    if (i2Prev + 1 > i2NextNext) insert = f2.verts.slice(i2NextNext, i2Prev + 1)
    else {
        const head = f2.verts.slice(i2NextNext)
        insert = head.length < n2 - 2 ? [...head, ...f2.verts.slice(0, i2Prev + 1)] : head
    }
    f1.verts.splice(i1Next, 0, ...insert)
    return true
}

/** `merge_out_face_pair` (`:1126`). */
function mergeOutFacePair(faces: OutFace[]): void {
    const [t1, t2] = faces
    const se = sharedEdgeFromPair(t1, t2)
    if (!se) return
    const vc = t1.verts[(se.e1 + 2) % 3], vd = t2.verts[(se.e2 - 3 + 2) % 3]
    if (vc === vd) return
    t1.verts = [se.v2, vc, se.v1, vd]
    faces.length = 1
}

/** `merge_out_faces` (`:1178`). */
function mergeOutFaces(faces: OutFace[]): void {
    if (faces.length <= 1) return
    if (faces.length === 2) { mergeOutFacePair(faces); return }
    const shared = sharedEdges(faces)
    if (!shared.length) return
    const mergedTo = new Int32Array(faces.length).fill(-1)
    const finalMergedTo = (f: number) => { while (mergedTo[f] !== -1) f = mergedTo[f]; return f }
    for (const se of shared) {
        const f1 = finalMergedTo(Math.floor(se.e1 / 3)), f2 = finalMergedTo(Math.floor(se.e2 / 3))
        if (f1 === -1 || f2 === -2) continue // as in Blender (the second test can never be true)
        if (tryMergeOutFacePair(faces[f1], faces[f2], se)) mergedTo[f2] = f1
    }
    let to = 0
    for (let from = 0; from < faces.length; from++) if (mergedTo[from] === -1) faces[to++] = faces[from]
    faces.length = to
}

/** `approx_in_line` (`:1277`). */
function approxInLine(p0: number[], p1: number[], p2: number[]): boolean {
    const a = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], b = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]]
    const la = Math.hypot(...a), lb = Math.hypot(...b)
    if (!la || !lb) return false
    const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)
    return Math.abs(cos - 1) < 1e-4
}

/** `dissolve_valence2_verts` (`:1294`): returns the compressed positions and remaps the faces in place. */
function dissolveValence2Verts(faces: OutFace[], pos: Float32Array): Float32Array {
    const nv = pos.length / 3
    const dissolve = new Uint8Array(nv)
    const nbFirst = new Int32Array(nv).fill(-1), nbSecond = new Int32Array(nv).fill(-1)
    for (const f of faces) {
        const n = f.verts.length
        for (let i = 0; i < n; i++) {
            const vprev = f.verts[(i - 1 + n) % n], v = f.verts[i], vnext = f.verts[(i + 1) % n]
            if (nbFirst[v] === -1) { nbFirst[v] = vprev; nbSecond[v] = vnext; dissolve[v] = n <= 3 ? 0 : 1 }
            else if (n === 3 || !(vprev === nbSecond[v] && vnext === nbFirst[v])) dissolve[v] = 0
        }
    }
    for (const f of faces) {
        let k = 0
        for (const v of f.verts) if (dissolve[v]) k++
        if (f.verts.length - k < 3) for (const v of f.verts) dissolve[v] = 0
    }
    const P = (v: number) => [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]
    let any = false
    for (let v = 0; v < nv; v++) {
        if (!dissolve[v]) continue
        if (!approxInLine(P(nbFirst[v]), P(v), P(nbSecond[v]))) dissolve[v] = 0
        else any = true
    }
    if (!any) return pos
    const map = new Int32Array(nv).fill(-1)
    let count = 0
    for (let v = 0; v < nv; v++) if (!dissolve[v]) map[v] = count++
    const out = new Float32Array(count * 3)
    for (let v = 0; v < nv; v++) if (map[v] >= 0) out.set(pos.subarray(3 * v, 3 * v + 3), 3 * map[v])
    for (const f of faces) f.verts = f.verts.map(v => map[v]).filter(v => v >= 0)
    return out
}

// endregion

/** `meshgl_to_mesh` (`:1618`). */
function meshglToMesh(mgl: ManifoldMeshGL, joined: MeshData, o: MeshOffsets, meshes: MeshData[], materialRemaps: number[][]): BooleanResult {
    if (!mgl.vertProperties.length || !mgl.triVerts.length) {
        const empty = MeshData.fromFaces({positions: [], faces: []})
        empty.materials = [...joined.materials]
        return {mesh: empty, error: 'NONE', nonManifoldMeshIndices: [], intersectingEdges: []}
    }
    // assemble_mesh_from_meshgl (:1427): positions with stride numProp, faces grouped by faceID
    const stride = mgl.numProp
    let pos: Float32Array = new Float32Array((mgl.vertProperties.length / stride) * 3)
    for (let v = 0; v < pos.length / 3; v++) for (let k = 0; k < 3; k++) pos[3 * v + k] = mgl.vertProperties[stride * v + k]
    const groups: number[][] = Array.from({length: o.faceStart[o.faceStart.length - 1]}, () => [])
    for (let t = 0; t < mgl.triVerts.length / 3; t++) groups[mgl.faceID[t]].push(t)
    const faces: OutFace[] = []
    groups.forEach((g, gid) => {
        const gf = g.map(t => ({verts: [mgl.triVerts[3 * t], mgl.triVerts[3 * t + 1], mgl.triVerts[3 * t + 2]], faceId: gid}))
        mergeOutFaces(gf)
        faces.push(...gf)
    })
    pos = dissolveValence2Verts(faces, pos)

    const out = MeshData.fromFaces({positions: pos, faces: faces.map(f => f.verts)})
    out.materials = [...joined.materials]
    transferAttributes(out, joined, faces, o, meshes, materialRemaps)
    return {mesh: out, error: 'NONE', nonManifoldMeshIndices: [], intersectingEdges: intersectingEdges(out, faces, o)}
}

/** `get_intersecting_edges` (`:1505`). */
function intersectingEdges(out: MeshData, faces: OutFace[], o: MeshOffsets): number[] {
    const first = new Int32Array(out.edgesNum).fill(-1)
    const res: number[] = []
    for (let f = 0; f < out.facesNum; f++) {
        for (let c = out.faceOffsets[f]; c < out.faceOffsets[f + 1]; c++) {
            const e = out.cornerEdges[c]
            if (first[e] === -1) first[e] = f
            else if (meshIdForFace(faces[f].faceId, o) !== meshIdForFace(faces[first[e]].faceId, o)) res.push(e)
        }
    }
    return res
}

/** `OutToInMaps` (`:439-825`) and the attribute copies of `meshgl_to_mesh`. */
function transferAttributes(out: MeshData, joined: MeshData, faces: OutFace[], o: MeshOffsets, meshes: MeshData[], materialRemaps: number[][]): void {
    const faceMap = Int32Array.from(faces, f => f.faceId)
    const inPos = joined.positions, outPos = out.positions
    const inCV = joined.cornerVerts, outCV = out.cornerVerts
    // ensure_vertex_map: exact position match within the source face
    const vertMap = new Int32Array(out.vertsNum).fill(-1)
    for (let of = 0; of < out.facesNum; of++) {
        const inf = faceMap[of]
        for (let c = out.faceOffsets[of]; c < out.faceOffsets[of + 1]; c++) {
            const ov = outCV[c]
            if (vertMap[ov] !== -1) continue
            for (let ic = joined.faceOffsets[inf]; ic < joined.faceOffsets[inf + 1]; ic++) {
                const iv = inCV[ic]
                if (f32eq(outPos, ov, inPos, iv)) { vertMap[ov] = iv; break }
            }
        }
    }
    // ensure_corner_map
    const cornerMap = new Int32Array(out.cornersNum).fill(-1)
    for (let of = 0; of < out.facesNum; of++) {
        const inf = faceMap[of]
        for (let c = out.faceOffsets[of]; c < out.faceOffsets[of + 1]; c++) {
            const iv = vertMap[outCV[c]]
            if (iv === -1) continue
            for (let ic = joined.faceOffsets[inf]; ic < joined.faceOffsets[inf + 1]; ic++) if (inCV[ic] === iv) { cornerMap[c] = ic; break }
        }
    }
    // ensure_edge_map (:651)
    const edgeMap = new Int32Array(out.edgesNum).fill(-1)
    const done = new Uint8Array(out.edgesNum)
    const inEV = joined.edgeVerts, outEV = out.edgeVerts, inCE = joined.cornerEdges, outCE = out.cornerEdges
    const sameDir = (oa: number, ob: number, ia: number, ib: number) => {
        const p = [outPos[3 * oa] - outPos[3 * ob], outPos[3 * oa + 1] - outPos[3 * ob + 1], outPos[3 * oa + 2] - outPos[3 * ob + 2]]
        const q = [inPos[3 * ia] - inPos[3 * ib], inPos[3 * ia + 1] - inPos[3 * ib + 1], inPos[3 * ia + 2] - inPos[3 * ib + 2]]
        const pq = Math.hypot(...p) * Math.hypot(...q)
        if (pq === 0) return true
        return Math.abs(Math.abs((p[0] * q[0] + p[1] * q[1] + p[2] * q[2]) / pq) - 1) <= 1e-5
    }
    for (let of = 0; of < out.facesNum; of++) {
        const inf = faceMap[of]
        const mesh = meshIdForFace(inf, o)
        const vr0 = o.vertStart[mesh], vr1 = o.vertStart[mesh + 1]
        const ifs = joined.faceOffsets[inf], ife = joined.faceOffsets[inf + 1]
        for (let oc = out.faceOffsets[of]; oc < out.faceOffsets[of + 1]; oc++) {
            const ic = cornerMap[oc]
            if (ic === -1) continue
            const oe = outCE[oc]
            if (done[oe]) continue
            const ov = outCV[oc], ie = inCE[ic], iv = inCV[ic]
            let oeV = [outEV[2 * oe], outEV[2 * oe + 1]]
            if (oeV[0] !== ov) oeV = [oeV[1], oeV[0]]
            let ieV = [inEV[2 * ie], inEV[2 * ie + 1]]
            if (ieV[0] !== iv) ieV = [ieV[1], ieV[0]]
            let rep = -1
            const end = vertMap[oeV[1]]
            if (end === ieV[1]) rep = ie
            else if (!(end >= vr0 && end < vr1)) {
                if (sameDir(oeV[0], oeV[1], ieV[0], ieV[1])) rep = ie
            }
            if (rep === -1) {
                const icPrev = ic > ifs ? ic - 1 : ife - 1
                const iePrev = inCE[icPrev], ivPrev = inCV[icPrev]
                let iePrevV = [inEV[2 * iePrev], inEV[2 * iePrev + 1]]
                if (iePrevV[0] !== ivPrev) iePrevV = [iePrevV[1], iePrevV[0]]
                if (vertMap[oeV[0]] === iePrevV[1]) {
                    if (vertMap[oeV[1]] === iePrevV[0]) rep = iePrev
                    else if (vertMap[oeV[1]] === -1 && sameDir(oeV[0], oeV[1], iePrevV[0], iePrevV[1])) rep = iePrev
                }
            }
            if (rep !== -1) { edgeMap[oe] = rep; done[oe] = 1 }
        }
    }

    // copy point / edge / face attributes through the maps; corners copied or interpolated
    const cornerLayers: AttributeLayer[] = []
    for (const layer of joined.attributes.layers()) {
        if (TOPOLOGY.has(layer.name) || layer.name === AttrName.materialIndex) continue
        if (layer.domain === AttrDomain.Corner) { cornerLayers.push(layer); continue }
        const comps = ATTR_TYPE_INFO[layer.type].components
        const dst = out.attributes.ensure(layer.name, layer.domain, layer.type).data
        const map = layer.domain === AttrDomain.Point ? vertMap : layer.domain === AttrDomain.Edge ? edgeMap : faceMap
        for (let i = 0; i < map.length; i++) {
            if (map[i] < 0) continue // value_initialize: the type's default (0)
            for (let k = 0; k < comps; k++) dst[i * comps + k] = layer.data[map[i] * comps + k]
        }
    }
    // material_index (meshgl_to_mesh :1762): copied through the face map, or set_material_from_map
    // (mesh_boolean.cc:257) from the inputs' own indices when remaps are given
    const joinedMat = joined.attributes.get(AttrName.materialIndex)
    if (joinedMat) {
        const dst = out.attributes.ensure(AttrName.materialIndex, AttrDomain.Face, 'int32').data
        if (!materialRemaps.length) {
            for (let f = 0; f < faceMap.length; f++) dst[f] = joinedMat.data[faceMap[f]]
        } else {
            for (let f = 0; f < faceMap.length; f++) {
                const inF = faceMap[f], mesh = meshIdForFace(inF, o)
                const orig = meshes[mesh].attributes.get(AttrName.materialIndex)?.data[inF - o.faceStart[mesh]] ?? 0
                const map = materialRemaps[mesh] ?? []
                dst[f] = orig >= 0 && orig < map.length ? map[orig] : orig
            }
        }
    }
    if (!cornerLayers.length) return
    const dsts = cornerLayers.map(l => ({src: l, dst: out.attributes.ensure(l.name, l.domain, l.type).data, comps: ATTR_TYPE_INFO[l.type].components}))
    const inNormals = meshFaceNormals(joined)
    const w: number[] = []
    for (let of = 0; of < out.facesNum; of++) {
        const inf = faceMap[of]
        const os = out.faceOffsets[of], oe = out.faceOffsets[of + 1]
        let needs = false
        for (let c = os; c < oe; c++) if (cornerMap[c] === -1) { needs = true; break }
        const ifs = joined.faceOffsets[inf], n = joined.faceOffsets[inf + 1] - ifs
        let cos2d: number[] | null = null, axis: ReturnType<typeof axisDominantV3ToM3> | null = null
        if (needs) {
            axis = axisDominantV3ToM3([inNormals[3 * inf], inNormals[3 * inf + 1], inNormals[3 * inf + 2]])
            cos2d = []
            for (let i = 0; i < n; i++) {
                const v = inCV[ifs + i]
                cos2d.push(...mulV2M3V3(axis, [inPos[3 * v], inPos[3 * v + 1], inPos[3 * v + 2]]))
            }
        }
        for (let c = os; c < oe; c++) {
            const ic = cornerMap[c]
            if (ic !== -1) {
                for (const d of dsts) for (let k = 0; k < d.comps; k++) d.dst[c * d.comps + k] = d.src.data[ic * d.comps + k]
                continue
            }
            const v = outCV[c]
            const co = mulV2M3V3(axis!, [outPos[3 * v], outPos[3 * v + 1], outPos[3 * v + 2]])
            interpWeightsPolyV2(w, cos2d!, n, co[0], co[1])
            for (const d of dsts) {
                const isBool = d.src.type === 'bool'
                const integral = !(d.dst instanceof Float32Array || d.dst instanceof Float64Array)
                for (let k = 0; k < d.comps; k++) {
                    let acc = 0
                    for (let i = 0; i < n; i++) acc += d.src.data[(ifs + i) * d.comps + k] * w[i]
                    // DefaultMixer: booleans true at >= 0.5 (BKE_attribute_math.hh:846), integers rounded
                    d.dst[c * d.comps + k] = isBool ? (acc >= 0.5 ? 1 : 0) : integral ? Math.round(acc) : acc
                }
            }
        }
    }
}

/** Exact float32 position equality (`out_pos == in_vert_positions[in_v]`). */
function f32eq(a: Float32Array, i: number, b: Float32Array, j: number): boolean {
    return a[3 * i] === b[3 * j] && a[3 * i + 1] === b[3 * j + 1] && a[3 * i + 2] === b[3 * j + 2]
}

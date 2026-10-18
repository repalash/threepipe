/**
 * Mesh normals as Blender computes them, including custom normals: a port of
 * `blenkernel/intern/mesh_normals.cc` (Blender 5.2.2).
 *
 * - Face normals: Newell's method for every face (`normals_calc_faces`, `:180`); +Z when degenerate.
 * - Vertex normals: face normals weighted by the corner angle (`normals_calc_verts`, `:194`).
 * - The normal domain (`Mesh::normals_domain`, `:301`): a `custom_normal` attribute decides it, else all-sharp
 *   faces or edges give face normals, none give vertex normals, and a mix gives corner normals.
 * - Corner normals (`normals_calc_corners`, `:1239`): per vertex, the corners are split into fans by sharp edges,
 *   sharp faces, boundaries, non-manifold edges and winding flips; a fan's normal is the angle-weighted sum of its
 *   face normals. Each fan defines a normal space (`corner_fan_space_define`, `:595`) in which `custom_normal`
 *   (corner, `int16x2`) encodes a direction as two fractions of the fan's angles
 *   (`corner_space_custom_data_to_normal`, `:711`; `corner_space_custom_normal_to_data`, `:763`).
 * - "Free" custom normals: `custom_normal` as `float3` on points, faces or corners, used as given
 *   (`Mesh::vert_normals / face_normals / corner_normals`, `:349-515`).
 * - Setting custom normals (`mesh_normals_corner_custom_set`, `:1409`): splits fans with sharp edges where the
 *   wanted normals disagree, then encodes each fan's average.
 */

import {MeshData} from './MeshData'
import {AttrDomain, AttrName} from './constants'

const PI = Math.PI
const PI2 = Math.PI * 2
const f32 = Math.fround
/** `LNOR_SPACE_TRIGO_THRESHOLD` (`mesh_normals.cc:591`). */
const TRIGO_THRESHOLD = f32(1 - 1e-4)
const SHRT_MAX = 32767

/** `math::safe_acos_approx` (`BLI_math_base.hh:236`): Blender's float polynomial acos, used in every weight here. */
export function safeAcosApprox(x: number): number {
    const fa = Math.abs(x)
    const m = fa < 1 ? 1 - (1 - fa) : 1
    const a = f32(Math.sqrt(f32(1 - m)) * f32(1.5707963267 + m * (-0.213300989 + m * (0.077980478 + m * -0.02164095))))
    return x < 0 ? f32(PI - a) : a
}

type V3 = [number, number, number]
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
function normalize(v: V3): V3 {
    const l = Math.hypot(v[0], v[1], v[2])
    return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0]
}
const sub = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** The normal domain Blender shades a mesh with (`bke::MeshNormalDomain`). */
export type NormalDomain = 'POINT' | 'FACE' | 'CORNER'

const pos = (P: ArrayLike<number>, v: number): V3 => [P[3 * v], P[3 * v + 1], P[3 * v + 2]]

/**
 * `normals_calc_faces` / `normal_calc_ngon` (`mesh_normals.cc:123, :180`): Newell's method for every face, in
 * float as Blender computes it (`add_newell_cross_v3_v3v3`, `normalize_v3`), since thresholds such as the
 * smooth-by-angle cut-off are compared against these exact values.
 */
export function faceNormalsTrue(mesh: MeshData): Float32Array {
    const P = mesh.positions, CV = mesh.cornerVerts, O = mesh.faceOffsets
    const out = new Float32Array(mesh.facesNum * 3)
    for (let fi = 0; fi < mesh.facesNum; fi++) {
        let x = 0, y = 0, z = 0
        let prev = CV[O[fi + 1] - 1] * 3
        for (let c = O[fi]; c < O[fi + 1]; c++) {
            const cur = CV[c] * 3
            x = f32(x + f32(f32(P[prev + 1] - P[cur + 1]) * f32(P[prev + 2] + P[cur + 2])))
            y = f32(y + f32(f32(P[prev + 2] - P[cur + 2]) * f32(P[prev] + P[cur])))
            z = f32(z + f32(f32(P[prev] - P[cur]) * f32(P[prev + 1] + P[cur + 1])))
            prev = cur
        }
        const d = f32(f32(f32(x * x) + f32(y * y)) + f32(z * z))
        if (d > 1.0e-35) {
            const inv = f32(1 / f32(Math.sqrt(d)))
            out[3 * fi] = f32(x * inv); out[3 * fi + 1] = f32(y * inv); out[3 * fi + 2] = f32(z * inv)
        } else {
            out[3 * fi + 2] = 1
        }
    }
    return out
}

/** `Mesh::vert_to_face_map()`: faces of each vertex in face order (a face twice if it uses the vertex twice). */
export function vertToFaceMap(mesh: MeshData): {offsets: Int32Array, faces: Int32Array} {
    const counts = new Int32Array(mesh.vertsNum + 1)
    for (let c = 0; c < mesh.cornersNum; c++) counts[mesh.cornerVerts[c] + 1]++
    for (let v = 0; v < mesh.vertsNum; v++) counts[v + 1] += counts[v]
    const faces = new Int32Array(mesh.cornersNum)
    const fill = counts.slice(0, mesh.vertsNum)
    for (let f = 0; f < mesh.facesNum; f++) {
        for (let c = mesh.faceOffsets[f]; c < mesh.faceOffsets[f + 1]; c++) faces[fill[mesh.cornerVerts[c]]++] = f
    }
    return {offsets: counts, faces}
}

/** `face_find_corner_from_vert`: the first corner of `face` using `vert`. */
function faceCornerOfVert(mesh: MeshData, face: number, vert: number): number {
    for (let c = mesh.faceOffsets[face]; c < mesh.faceOffsets[face + 1]; c++) if (mesh.cornerVerts[c] === vert) return c
    return -1
}
const cornerPrev = (mesh: MeshData, face: number, c: number) => (c === mesh.faceOffsets[face] ? mesh.faceOffsets[face + 1] - 1 : c - 1)
const cornerNext = (mesh: MeshData, face: number, c: number) => (c === mesh.faceOffsets[face + 1] - 1 ? mesh.faceOffsets[face] : c + 1)

/** `normals_calc_verts` (`:194`): angle-weighted face normals; a vertex without faces gets its normalised position. */
export function vertNormalsFromFaces(mesh: MeshData, map: {offsets: Int32Array, faces: Int32Array}, faceNormals: ArrayLike<number>): Float32Array {
    const P = mesh.positions
    const out = new Float32Array(mesh.vertsNum * 3)
    for (let v = 0; v < mesh.vertsNum; v++) {
        const s = map.offsets[v], e = map.offsets[v + 1]
        if (s === e) { const n = normalize(pos(P, v)); out.set(n, 3 * v); continue }
        const n: V3 = [0, 0, 0]
        const pv = pos(P, v)
        for (let i = s; i < e; i++) {
            const face = map.faces[i]
            const c = faceCornerOfVert(mesh, face, v)
            const dPrev = normalize(sub(pos(P, mesh.cornerVerts[cornerPrev(mesh, face, c)]), pv))
            const dNext = normalize(sub(pos(P, mesh.cornerVerts[cornerNext(mesh, face, c)]), pv))
            const w = safeAcosApprox(dot(dPrev, dNext))
            n[0] += faceNormals[3 * face] * w; n[1] += faceNormals[3 * face + 1] * w; n[2] += faceNormals[3 * face + 2] * w
        }
        out.set(normalize(n), 3 * v)
    }
    return out
}

/** `mix_normals_corner_to_vert` (`:228`). */
function vertNormalsFromCorners(mesh: MeshData, map: {offsets: Int32Array, faces: Int32Array}, corner: ArrayLike<number>): Float32Array {
    const P = mesh.positions
    const out = new Float32Array(mesh.vertsNum * 3)
    for (let v = 0; v < mesh.vertsNum; v++) {
        const s = map.offsets[v], e = map.offsets[v + 1]
        if (s === e) { out.set(normalize(pos(P, v)), 3 * v); continue }
        const n: V3 = [0, 0, 0]
        const pv = pos(P, v)
        for (let i = s; i < e; i++) {
            const face = map.faces[i]
            const c = faceCornerOfVert(mesh, face, v)
            const dPrev = normalize(sub(pos(P, mesh.cornerVerts[cornerPrev(mesh, face, c)]), pv))
            const dNext = normalize(sub(pos(P, mesh.cornerVerts[cornerNext(mesh, face, c)]), pv))
            const w = safeAcosApprox(dot(dPrev, dNext))
            n[0] += corner[3 * c] * w; n[1] += corner[3 * c + 1] * w; n[2] += corner[3 * c + 2] * w
        }
        out.set(normalize(n), 3 * v)
    }
    return out
}

/** `Mesh::normals_domain` (`:301`). */
export function normalsDomain(mesh: MeshData): NormalDomain {
    if (mesh.facesNum === 0) return 'POINT'
    const custom = mesh.attributes.get(AttrName.customNormal)
    if (custom) {
        if (custom.domain === AttrDomain.Point) return 'POINT'
        if (custom.domain === AttrDomain.Face) return 'FACE'
        if (custom.domain === AttrDomain.Corner) return 'CORNER'
    }
    const mix = (layer: ReturnType<typeof mesh.attributes.get>, n: number): 'true' | 'false' | 'mixed' => {
        if (!layer || n === 0) return 'false'
        let t = 0
        for (let i = 0; i < n; i++) if (layer.data[i]) t++
        return t === 0 ? 'false' : t === n ? 'true' : 'mixed'
    }
    const faceMix = mix(mesh.attributes.get(AttrName.sharpFace), mesh.facesNum)
    if (faceMix === 'true') return 'FACE'
    const edgeMix = mix(mesh.attributes.get(AttrName.sharpEdge), mesh.edgesNum)
    if (edgeMix === 'true') return 'FACE'
    if (edgeMix === 'false' && faceMix === 'false') return 'POINT'
    return 'CORNER'
}

/** `Mesh::vert_normals` (`:349`). */
export function meshVertNormals(mesh: MeshData): Float32Array {
    const custom = mesh.attributes.get(AttrName.customNormal)
    const map = vertToFaceMap(mesh)
    if (custom) {
        if (custom.type === 'float3') {
            if (custom.domain === AttrDomain.Point) return Float32Array.from(custom.data)
            if (custom.domain === AttrDomain.Face) return vertNormalsFromFaces(mesh, map, custom.data)
            if (custom.domain === AttrDomain.Corner) return vertNormalsFromCorners(mesh, map, custom.data)
        } else if (custom.type === 'int16x2' && custom.domain === AttrDomain.Corner) {
            return vertNormalsFromCorners(mesh, map, meshCornerNormals(mesh))
        }
    }
    return vertNormalsFromFaces(mesh, map, faceNormalsTrue(mesh))
}

/** `Mesh::face_normals` (`:415`). */
export function meshFaceNormalsCustom(mesh: MeshData): Float32Array {
    const custom = mesh.attributes.get(AttrName.customNormal)
    const O = mesh.faceOffsets
    const fromCorners = (corner: ArrayLike<number>) => {
        const out = new Float32Array(mesh.facesNum * 3)
        for (let f = 0; f < mesh.facesNum; f++) {
            const s: V3 = [0, 0, 0]
            for (let c = O[f]; c < O[f + 1]; c++) { s[0] += corner[3 * c]; s[1] += corner[3 * c + 1]; s[2] += corner[3 * c + 2] }
            out.set(normalize(s), 3 * f)
        }
        return out
    }
    if (custom) {
        if (custom.type === 'float3') {
            if (custom.domain === AttrDomain.Face) return Float32Array.from(custom.data)
            if (custom.domain === AttrDomain.Point) {
                const out = new Float32Array(mesh.facesNum * 3)
                for (let f = 0; f < mesh.facesNum; f++) {
                    const s: V3 = [0, 0, 0]
                    for (let c = O[f]; c < O[f + 1]; c++) {
                        const v = mesh.cornerVerts[c]
                        s[0] += custom.data[3 * v]; s[1] += custom.data[3 * v + 1]; s[2] += custom.data[3 * v + 2]
                    }
                    out.set(normalize(s), 3 * f)
                }
                return out
            }
            if (custom.domain === AttrDomain.Corner) return fromCorners(custom.data)
        } else if (custom.type === 'int16x2' && custom.domain === AttrDomain.Corner) {
            return fromCorners(meshCornerNormals(mesh))
        }
    }
    return faceNormalsTrue(mesh)
}

// region fan spaces and the int16x2 encoding

/** `CornerNormalSpace`. A zero `refAlpha` / `refBeta` marks an invalid space. */
export interface CornerNormalSpace {
    vecLnor: V3
    vecRef: V3
    vecOrtho: V3
    refAlpha: number
    refBeta: number
}

/** `corner_fan_space_define` (`:595`). */
export function cornerFanSpaceDefine(lnor: V3, vecRef: V3, vecOther: V3, edgeVectors: V3[]): CornerNormalSpace {
    const space: CornerNormalSpace = {vecLnor: [0, 0, 0], vecRef: [0, 0, 0], vecOrtho: [0, 0, 0], refAlpha: 0, refBeta: 0}
    const dtpRef = dot(vecRef, lnor), dtpOther = dot(vecOther, lnor)
    if (Math.abs(dtpRef) >= TRIGO_THRESHOLD || Math.abs(dtpOther) >= TRIGO_THRESHOLD) return space
    space.vecLnor = [...lnor]
    if (edgeVectors.length) {
        let alpha = 0
        for (const v of edgeVectors) alpha += safeAcosApprox(dot(v, lnor))
        space.refAlpha = alpha / edgeVectors.length
    } else {
        space.refAlpha = (safeAcosApprox(dot(vecRef, lnor)) + safeAcosApprox(dot(vecOther, lnor))) / 2
    }
    space.vecRef = normalize([vecRef[0] - lnor[0] * dtpRef, vecRef[1] - lnor[1] * dtpRef, vecRef[2] - lnor[2] * dtpRef])
    space.vecOrtho = normalize(cross(lnor, space.vecRef))
    const otherProj = normalize([vecOther[0] - lnor[0] * dtpOther, vecOther[1] - lnor[1] * dtpOther, vecOther[2] - lnor[2] * dtpOther])
    const dtp = dot(space.vecRef, otherProj)
    if (dtp < TRIGO_THRESHOLD) {
        const beta = safeAcosApprox(dtp)
        space.refBeta = dot(space.vecOrtho, otherProj) < 0 ? PI2 - beta : beta
    } else {
        space.refBeta = PI2
    }
    return space
}

const unitShortToFloat = (s: number) => s / SHRT_MAX
const unitFloatToShort = (x: number) => Math.floor(x * SHRT_MAX + 0.5)

/** `corner_space_custom_data_to_normal` (`:711`). */
export function customDataToNormal(space: CornerNormalSpace, d0: number, d1: number): V3 {
    if (d0 === 0 || space.refAlpha === 0 || space.refBeta === 0) return [...space.vecLnor]
    const alphafac = unitShortToFloat(d0)
    const alpha = (alphafac > 0 ? space.refAlpha : PI2 - space.refAlpha) * alphafac
    const betafac = unitShortToFloat(d1)
    const out: V3 = [space.vecLnor[0] * Math.cos(alpha), space.vecLnor[1] * Math.cos(alpha), space.vecLnor[2] * Math.cos(alpha)]
    if (betafac === 0) {
        const s = Math.sin(alpha)
        out[0] += space.vecRef[0] * s; out[1] += space.vecRef[1] * s; out[2] += space.vecRef[2] * s
    } else {
        const sinAlpha = Math.sin(alpha)
        const beta = (betafac > 0 ? space.refBeta : PI2 - space.refBeta) * betafac
        const a = sinAlpha * Math.cos(beta), b = sinAlpha * Math.sin(beta)
        out[0] += space.vecRef[0] * a + space.vecOrtho[0] * b
        out[1] += space.vecRef[1] * a + space.vecOrtho[1] * b
        out[2] += space.vecRef[2] * a + space.vecOrtho[2] * b
    }
    return out
}

/** `corner_space_custom_normal_to_data` (`:763`). */
export function customNormalToData(space: CornerNormalSpace, custom: ArrayLike<number>): [number, number] {
    const isZero = custom[0] === 0 && custom[1] === 0 && custom[2] === 0
    const close = Math.abs(space.vecLnor[0] - custom[0]) <= 1e-4 && Math.abs(space.vecLnor[1] - custom[1]) <= 1e-4
        && Math.abs(space.vecLnor[2] - custom[2]) <= 1e-4
    if (isZero || close) return [0, 0]
    const cosAlpha = dot(space.vecLnor, custom)
    const alpha = safeAcosApprox(cosAlpha)
    const d0 = alpha > space.refAlpha
        ? unitFloatToShort(-(PI2 - alpha) / (PI2 - space.refAlpha))
        : unitFloatToShort(alpha / space.refAlpha)
    const vec = normalize([space.vecLnor[0] * -cosAlpha + custom[0], space.vecLnor[1] * -cosAlpha + custom[1], space.vecLnor[2] * -cosAlpha + custom[2]])
    const cosBeta = dot(space.vecRef, vec)
    let d1 = 0
    if (cosBeta < TRIGO_THRESHOLD) {
        let beta = safeAcosApprox(cosBeta)
        if (dot(space.vecOrtho, vec) < 0) beta = PI2 - beta
        d1 = beta > space.refBeta
            ? unitFloatToShort(-(PI2 - beta) / (PI2 - space.refBeta))
            : unitFloatToShort(beta / space.refBeta)
    }
    return [d0, d1]
}

// endregion

// region normals_calc_corners

/** `CornerNormalSpaceArray`: the fan space of each corner, and the corners of each fan in traversal order. */
export interface CornerFanSpaces {
    spaces: CornerNormalSpace[]
    cornerSpace: Int32Array
    cornersBySpace: number[][]
}

interface CornerInfo { face: number, corner: number, cornerPrev: number, cornerNext: number, vertPrev: number, vertNext: number, edgePrev: number, edgeNext: number }

const EDGE_UNSET = 0, EDGE_ONE = 1, EDGE_TWO = 2, EDGE_SHARP = 3

/**
 * `normals_calc_corners` (`mesh_normals.cc:1239`). `customNormals` is the corner `int16x2` encoding (or null);
 * `fanSpaces`, when given, receives every fan's space.
 */
export function normalsCalcCorners(
    mesh: MeshData, faceNormals: ArrayLike<number>, sharpEdges: ArrayLike<number> | null, sharpFaces: ArrayLike<number> | null,
    customNormals: ArrayLike<number> | null, fanSpaces: CornerFanSpaces | null, out: Float32Array,
    map = vertToFaceMap(mesh),
): void {
    const P = mesh.positions, CE = mesh.cornerEdges
    if (fanSpaces) {
        fanSpaces.spaces = []
        fanSpaces.cornerSpace = new Int32Array(mesh.cornersNum).fill(-1)
        fanSpaces.cornersBySpace = []
    }
    for (let v = 0; v < mesh.vertsNum; v++) {
        const s = map.offsets[v], e = map.offsets[v + 1]
        if (s === e) continue
        const pv = pos(P, v)
        // collect_corner_info + calc_local_edge_indices
        const infos: CornerInfo[] = []
        const localEdgeVerts: number[] = []
        const localEdge = (other: number) => { let i = localEdgeVerts.indexOf(other); if (i < 0) { i = localEdgeVerts.length; localEdgeVerts.push(other) } return i }
        for (let i = s; i < e; i++) {
            const face = map.faces[i]
            const corner = faceCornerOfVert(mesh, face, v)
            const cp = cornerPrev(mesh, face, corner), cn = cornerNext(mesh, face, corner)
            infos.push({face, corner, cornerPrev: cp, cornerNext: cn, vertPrev: mesh.cornerVerts[cp], vertNext: mesh.cornerVerts[cn], edgePrev: 0, edgeNext: 0})
        }
        for (const info of infos) { info.edgePrev = localEdge(info.vertPrev); info.edgeNext = localEdge(info.vertNext) }
        // calc_connecting_edge_info
        const eState = new Int8Array(localEdgeVerts.length)
        const eC1 = new Int32Array(localEdgeVerts.length), eC2 = new Int32Array(localEdgeVerts.length)
        const eWindTowards = new Uint8Array(localEdgeVerts.length)
        const addCorner = (le: number, local: number, corner: number, other: number, towards: boolean) => {
            if (eState[le] === EDGE_UNSET) {
                if (sharpEdges && sharpEdges[CE[towards ? other : corner]]) { eState[le] = EDGE_SHARP; return }
                eState[le] = EDGE_ONE; eC1[le] = local; eWindTowards[le] = towards ? 1 : 0
            } else if (eState[le] === EDGE_ONE) {
                if ((eWindTowards[le] === 1) === towards) { eState[le] = EDGE_SHARP; return }
                eState[le] = EDGE_TWO; eC2[le] = local
            } else {
                eState[le] = EDGE_SHARP
            }
        }
        infos.forEach((info, local) => {
            if (sharpFaces && sharpFaces[info.face]) { eState[info.edgePrev] = EDGE_SHARP; eState[info.edgeNext] = EDGE_SHARP; return }
            addCorner(info.edgePrev, local, info.corner, info.cornerPrev, true)
            addCorner(info.edgeNext, local, info.corner, info.cornerNext, false)
        })
        // calc_edge_directions
        const edgeDirs: V3[] = localEdgeVerts.map(o => normalize(sub(pos(P, o), pv)))

        const visited = new Uint8Array(infos.length)
        let visitedCount = 0, start = 0
        for (;;) {
            // traverse_fan_local_corners
            const fan: number[] = [start]
            let cyclic = false
            {
                let current = start
                let le = infos[current].edgeNext
                while (eState[le] === EDGE_TWO) {
                    current = eC1[le] === current ? eC2[le] : eC1[le]
                    if (current === start) { cyclic = true; break }
                    fan.push(current)
                    le = infos[current].edgeNext
                }
                fan.reverse()
                if (cyclic) {
                    let mi = 0
                    for (let i = 1; i < fan.length; i++) if (infos[fan[i]].corner < infos[fan[mi]].corner) mi = i
                    const rot = fan.splice(0, mi)
                    fan.push(...rot)
                }
            }
            if (!cyclic) {
                let current = start
                let le = infos[current].edgePrev
                while (eState[le] === EDGE_TWO) {
                    current = current === eC1[le] ? eC2[le] : eC1[le]
                    fan.push(current)
                    le = infos[current].edgePrev
                }
            }
            // accumulate_fan_normal
            let fanNormal: V3
            if (fan.length === 1) {
                const fc = infos[fan[0]].face
                fanNormal = [faceNormals[3 * fc], faceNormals[3 * fc + 1], faceNormals[3 * fc + 2]]
            } else {
                const n: V3 = [0, 0, 0]
                for (const lc of fan) {
                    const info = infos[lc]
                    const w = safeAcosApprox(dot(edgeDirs[info.edgePrev], edgeDirs[info.edgeNext]))
                    n[0] += faceNormals[3 * info.face] * w; n[1] += faceNormals[3 * info.face + 1] * w; n[2] += faceNormals[3 * info.face + 2] * w
                }
                fanNormal = normalize(n)
            }
            if (customNormals || fanSpaces) {
                // handle_fan_result_and_custom_normals (:1190)
                const leFirst = infos[fan[0]].edgeNext, leLast = infos[fan[fan.length - 1]].edgePrev
                const fanEdgeDirs: V3[] = []
                if (fan.length > 1) {
                    for (const lc of fan) fanEdgeDirs.push(edgeDirs[infos[lc].edgeNext])
                    if (leLast !== leFirst) fanEdgeDirs.push(edgeDirs[leLast])
                }
                const space = cornerFanSpaceDefine(fanNormal, edgeDirs[leFirst], edgeDirs[leLast], fanEdgeDirs)
                if (customNormals) {
                    let a0 = 0, a1 = 0
                    for (const lc of fan) { a0 += customNormals[2 * infos[lc].corner]; a1 += customNormals[2 * infos[lc].corner + 1] }
                    // int2 division truncates toward zero
                    fanNormal = customDataToNormal(space, Math.trunc(a0 / fan.length), Math.trunc(a1 / fan.length))
                }
                if (fanSpaces) {
                    const idx = fanSpaces.spaces.length
                    fanSpaces.spaces.push(space)
                    const corners = fan.map(lc => infos[lc].corner)
                    fanSpaces.cornersBySpace.push(corners)
                    for (const c of corners) fanSpaces.cornerSpace[c] = idx
                }
            }
            for (const lc of fan) out.set(fanNormal, 3 * infos[lc].corner)
            visitedCount += fan.length
            if (visitedCount === infos.length) break
            for (const lc of fan) visited[lc] = 1
            while (visited[start]) start++
        }
    }
}

/** `Mesh::corner_normals` (`:468`): the normals the mesh is shaded with, per corner. */
export function meshCornerNormals(mesh: MeshData): Float32Array {
    const out = new Float32Array(mesh.cornersNum * 3)
    if (mesh.facesNum === 0) return out
    const domain = normalsDomain(mesh)
    if (domain === 'POINT') {
        const vn = meshVertNormals(mesh)
        for (let c = 0; c < mesh.cornersNum; c++) out.set(vn.subarray(3 * mesh.cornerVerts[c], 3 * mesh.cornerVerts[c] + 3), 3 * c)
        return out
    }
    if (domain === 'FACE') {
        const fn = meshFaceNormalsCustom(mesh)
        for (let f = 0; f < mesh.facesNum; f++) {
            for (let c = mesh.faceOffsets[f]; c < mesh.faceOffsets[f + 1]; c++) out.set(fn.subarray(3 * f, 3 * f + 3), 3 * c)
        }
        return out
    }
    const custom = mesh.attributes.get(AttrName.customNormal)
    if (custom && custom.type === 'float3') {
        if (custom.domain === AttrDomain.Corner) out.set(custom.data)
        return out
    }
    normalsCalcCorners(
        mesh, faceNormalsTrue(mesh), mesh.attributes.get(AttrName.sharpEdge)?.data ?? null,
        mesh.attributes.get(AttrName.sharpFace)?.data ?? null,
        custom && custom.type === 'int16x2' && custom.domain === AttrDomain.Corner ? custom.data : null, null, out,
    )
    return out
}

// endregion

/**
 * `mesh_set_custom_normals` (`mesh_normals.cc:1652`): store `normals` (per corner, or per vertex with
 * `fromVertices`) as the mesh's corner `custom_normal` (int16x2), adding sharp edges where a smooth fan must split.
 * Zero vectors keep the automatic normal. `normalize` normalises the input first, as `mesh_set_custom_normals`
 * does (the `_normalized` variants skip it).
 */
export function meshSetCustomNormals(mesh: MeshData, normals: Float32Array, {fromVertices = false, normalize: doNormalize = true} = {}): void {
    if (doNormalize) {
        for (let i = 0; i < normals.length; i += 3) {
            const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2])
            if (l > 0) { normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l } else { normals[i] = normals[i + 1] = normals[i + 2] = 0 }
        }
    }
    const existing = mesh.attributes.get(AttrName.customNormal)
    if (existing && !(existing.domain === AttrDomain.Corner && existing.type === 'int16x2')) mesh.attributes.remove(AttrName.customNormal)
    const clnors = mesh.attributes.ensure(AttrName.customNormal, AttrDomain.Corner, 'int16x2').data as Int16Array
    const sharpEdges = mesh.attributes.ensure(AttrName.sharpEdge, AttrDomain.Edge, 'bool').data as Uint8Array
    const sharpFaces = mesh.attributes.get(AttrName.sharpFace)?.data ?? null
    const map = vertToFaceMap(mesh)
    const faceNormals = faceNormalsTrue(mesh)
    const vertNormals = vertNormalsFromFaces(mesh, map, faceNormals)
    customNormalsSet(mesh, map, vertNormals, faceNormals, sharpFaces, fromVertices, normals, sharpEdges, clnors)
}

/**
 * `mesh_normals_corner_custom_set` (`mesh_normals.cc:1409`), the core of `normals_corner_custom_set[_from_verts]`:
 * `custom` (per corner, or per vertex with `useVertices`) is encoded into `clnors`, adding to `sharpEdges` where a
 * fan has to split. Zero vectors take the automatic normal.
 */
export function customNormalsSet(
    mesh: MeshData, map: {offsets: Int32Array, faces: Int32Array}, vertNormals: Float32Array, faceNormals: Float32Array,
    sharpFaces: ArrayLike<number> | null, useVertices: boolean, custom: Float32Array, sharpEdges: Uint8Array,
    clnors: Int16Array,
): void {
    const N = mesh.cornersNum
    const spaces: CornerFanSpaces = {spaces: [], cornerSpace: new Int32Array(0), cornersBySpace: []}
    const done = new Uint8Array(N)
    const cornerNormals = new Float32Array(N * 3)
    const cornerFace = new Int32Array(N)
    for (let f = 0; f < mesh.facesNum; f++) for (let c = mesh.faceOffsets[f]; c < mesh.faceOffsets[f + 1]; c++) cornerFace[c] = f
    normalsCalcCorners(mesh, faceNormals, sharpEdges, sharpFaces, clnors, spaces, cornerNormals, map)
    const isZero = (a: Float32Array, i: number) => a[3 * i] === 0 && a[3 * i + 1] === 0 && a[3 * i + 2] === 0
    if (useVertices) {
        for (let v = 0; v < mesh.vertsNum; v++) if (isZero(custom, v)) custom.set(vertNormals.subarray(3 * v, 3 * v + 3), 3 * v)
    } else {
        for (let c = 0; c < N; c++) if (isZero(custom, c)) custom.set(cornerNormals.subarray(3 * c, 3 * c + 3), 3 * c)
    }
    if (useVertices) {
        done.fill(1)
    } else {
        const CE = mesh.cornerEdges
        const tagSharp = (corner: number, prevCorner: number) => {
            const face = cornerFace[corner]
            const cp = cornerPrev(mesh, face, corner)
            const edge = CE[corner], edgePrev = CE[cp], prevEdge = CE[prevCorner]
            sharpEdges[prevEdge === edgePrev ? prevEdge : edge] = 1
        }
        for (let i = 0; i < N; i++) {
            if (done[i]) continue
            const si = spaces.cornerSpace[i]
            const fan = si >= 0 ? spaces.cornersBySpace[si] : []
            if (!fan.length) { done[i] = 1; continue }
            let prevCorner = -1
            let org = -1
            for (let k = fan.length - 1; k >= 0; k--) {
                const corner = fan[k]
                if (org < 0) org = corner
                else if (dot(custom.subarray(3 * org, 3 * org + 3), custom.subarray(3 * corner, 3 * corner + 3)) < TRIGO_THRESHOLD) {
                    tagSharp(corner, prevCorner)
                    org = corner
                }
                prevCorner = corner
                done[corner] = 1
            }
            if (fan.length > 1 && org >= 0) {
                const corner = fan[fan.length - 1]
                if (dot(custom.subarray(3 * org, 3 * org + 3), custom.subarray(3 * corner, 3 * corner + 3)) < TRIGO_THRESHOLD) {
                    tagSharp(corner, prevCorner)
                }
            }
        }
        normalsCalcCorners(mesh, faceNormals, sharpEdges, sharpFaces, clnors, spaces, cornerNormals, map)
    }
    for (let i = 0; i < N; i++) {
        const si = spaces.cornerSpace[i]
        if (si === -1) { done[i] = 0; continue }
        if (!done[i]) continue
        const fan = spaces.cornersBySpace[si]
        if (fan.length < 2) {
            const nidx = useVertices ? mesh.cornerVerts[i] : i
            const d = customNormalToData(spaces.spaces[si], custom.subarray(3 * nidx, 3 * nidx + 3))
            clnors[2 * i] = d[0]; clnors[2 * i + 1] = d[1]
            done[i] = 0
        } else {
            const avg: V3 = [0, 0, 0]
            for (const c of fan) {
                const nidx = useVertices ? mesh.cornerVerts[c] : c
                avg[0] += custom[3 * nidx]; avg[1] += custom[3 * nidx + 1]; avg[2] += custom[3 * nidx + 2]
                done[c] = 0
            }
            const inv = 1 / fan.length
            const d = customNormalToData(spaces.spaces[si], [avg[0] * inv, avg[1] * inv, avg[2] * inv])
            for (const c of fan) { clnors[2 * c] = d[0]; clnors[2 * c + 1] = d[1] }
        }
    }
}

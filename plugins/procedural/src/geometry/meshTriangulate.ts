/**
 * `geometry::mesh_triangulate` (`geometry/intern/mesh_triangulate.cc`, Blender 5.2.2): selected quads and n-gons
 * become triangles (new triangles first, then the untouched faces), duplicate triangles are merged, and edges are
 * rebuilt with `mesh_calc_edges(keep_existing_edges = true)`.
 *
 * The polygon fill is the kernel's float32 port of `BLI_polyfill_calc` / `BLI_polyfill_beautify`.
 */

import {AttrDomain, geomF32, MeshData, polyfillBeautify, polyfillCalc} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import {newMeshData} from './components'
import {DATA_TYPES, DataType} from './dataTypes'
import {meshCalcEdges} from './meshCalcEdges'
import {faceNormalCalc} from './meshNormals'

export type TriangulateQuadMode = 'BEAUTY' | 'FIXED' | 'ALTERNATE' | 'SHORT_EDGE' | 'LONG_EDGE'
export type TriangulateNGonMode = 'BEAUTY' | 'EAR_CLIP'

const FLT_MAX = 3.4028234663852886e38

/** `is_quad_flip_v3` (`math_geom.cc:5587`), float32. */
function isQuadFlipV3(v1: ArrayLike<number>, v2: ArrayLike<number>, v3: ArrayLike<number>, v4: ArrayLike<number>): number {
    const {subV3V3, crossV3V3, dotV3V3} = geomF32
    const d12 = subV3V3(v1, v2), d23 = subV3V3(v2, v3), d34 = subV3V3(v3, v4), d41 = subV3V3(v4, v1)
    let ret = 0
    if (dotV3V3(crossV3V3(d12, d23), crossV3V3(d34, d41)) < 0) ret |= 1
    if (dotV3V3(crossV3V3(d23, d34), crossV3V3(d41, d12)) < 0) ret |= 2
    return ret
}

/** `BLI_polyfill_beautify_quad_rotate_calc_ex` (`polyfill_2d_beautify.cc:91`) without `r_area`, float32. */
function quadRotateCalc(v1: ArrayLike<number>, v2: ArrayLike<number>, v3: ArrayLike<number>, v4: ArrayLike<number>, lockDegenerate: boolean): number {
    const {crossTriV2, lenV2V2} = geomF32
    const eps = f32(1e-12)
    const a234 = crossTriV2(v2, v3, v4), a241 = crossTriV2(v2, v4, v1)
    const a123 = crossTriV2(v1, v2, v3), a134 = crossTriV2(v1, v3, v4)
    if ((a123 >= 0) !== (a134 >= 0)) return FLT_MAX
    if (Math.abs(a123) <= eps || Math.abs(a134) <= eps) return FLT_MAX
    if ((a234 >= 0) !== (a241 >= 0)) return lockDegenerate ? FLT_MAX : -FLT_MAX
    if (Math.abs(a234) <= eps || Math.abs(a241) <= eps) return -FLT_MAX
    const l12 = lenV2V2(v1, v2), l23 = lenV2V2(v2, v3), l34 = lenV2V2(v3, v4), l41 = lenV2V2(v4, v1)
    const l13 = lenV2V2(v1, v3), l24 = lenV2V2(v2, v4)
    const fac24 = f32(f32(Math.abs(a234) / f32(f32(l23 + l34) + l24)) + f32(Math.abs(a241) / f32(f32(l41 + l12) + l24)))
    const fac13 = f32(f32(Math.abs(a123) / f32(f32(l12 + l23) + l13)) + f32(Math.abs(a134) / f32(f32(l34 + l41) + l13)))
    return f32(fac24 - fac13)
}

/** `signum_i_ex` (`math_base_inline.cc:541`). */
const signumIEx = (a: number, eps: number) => (a > eps ? 1 : a < -eps ? -1 : 0)

/** `BLI_polyfill_edge_calc_rotate_beauty__area` (`polyfill_2d_beautify.cc:182`), float32. */
export function edgeCalcRotateBeautyArea(v1: ArrayLike<number>, v2: ArrayLike<number>, v3: ArrayLike<number>, v4: ArrayLike<number>, lockDegenerate: boolean): number {
    const {crossTriV3, normalizeV3, orthoBasisV3V3V3, mulV2M3V3, crossTriV2} = geomF32
    const eps = f32(1e-5)
    const noA = crossTriV3(v2, v3, v4), noB = crossTriV3(v2, v4, v1)
    const no = [f32(noA[0] + noB[0]), f32(noA[1] + noB[1]), f32(noA[2] + noB[2])]
    const noScale = normalizeV3(no)
    if (noScale === 0) return FLT_MAX
    // `axis_dominant_v3_to_m3` (`math_geom.cc:3646`): rows n1, n2, normal, transposed; `m[i * 3 + j] = r_mat[i][j]`.
    const [n1, n2] = orthoBasisV3V3V3(no)
    const rows = [n1, n2, no]
    const m = new Float32Array(9)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] = rows[j][i]
    const p = [v1, v2, v3, v4].map(v => {
        const o = [0, 0]
        mulV2M3V3(m, v, o)
        return o
    })
    if (!(signumIEx(f32(crossTriV2(p[1], p[2], p[3]) / noScale), eps) + signumIEx(f32(crossTriV2(p[1], p[3], p[0]) / noScale), eps))) return FLT_MAX
    return quadRotateCalc(p[0], p[1], p[2], p[3], lockDegenerate)
}

/** `quad::calc_quad_direction_beauty` (:66): true for the 0-2 diagonal. */
function quadDirectionBeauty(v0: ArrayLike<number>, v1: ArrayLike<number>, v2: ArrayLike<number>, v3: ArrayLike<number>): boolean {
    const flip = isQuadFlipV3(v1, v2, v3, v0)
    if (flip & 1) return true
    if (flip & 2) return false
    return edgeCalcRotateBeautyArea(v1, v2, v3, v0, false) > 0
}

function distSq(p: ArrayLike<number>, a: number, b: number): number {
    const dx = f32(p[a * 3] - p[b * 3]), dy = f32(p[a * 3 + 1] - p[b * 3 + 1]), dz = f32(p[a * 3 + 2] - p[b * 3 + 2])
    return f32(f32(f32(dx * dx) + f32(dy * dy)) + f32(dz * dz))
}

/**
 * `mesh_triangulate(src_mesh, selection, ngon_mode, quad_mode)` (:528). `selection` is ascending face indices;
 * undefined when no selected face is a quad or an n-gon.
 */
export function meshTriangulate(src: MeshData, selection: number[], ngonMode: TriangulateNGonMode, quadMode: TriangulateQuadMode): MeshData | undefined {
    const pos = src.attributes.get('position')!.data as Float32Array
    const fo = src.faceOffsets, cv = src.cornerVerts
    const size = (f: number) => fo[f + 1] - fo[f]
    const quads = selection.filter(f => size(f) === 4)
    const ngons = selection.filter(f => size(f) > 4)
    if (!quads.length && !ngons.length) return undefined

    // Corner triangles: n-gons first (`ngon::calc_corner_tris`, :222), then quads (`quad::calc_corner_tris`, :147).
    const cornerTris: number[] = []
    const triSrcFace: number[] = []
    const vert = (c: number) => pos.subarray(cv[c] * 3, cv[c] * 3 + 3)
    for (const f of ngons) {
        const n = size(f), start = fo[f]
        const normal = faceNormalCalc(pos, cv, start, start + n)
        const m = geomF32.axisDominantV3ToM3Negate(normal)
        const coords = new Float32Array(n * 2)
        for (let i = 0; i < n; i++) geomF32.mulV2M3V3(m, vert(start + i), coords, i * 2)
        const tris = polyfillCalc(coords, n, 1)
        if (ngonMode === 'BEAUTY') polyfillBeautify(coords, n, tris)
        for (const t of tris) cornerTris.push(t + start)
        for (let t = 0; t < n - 2; t++) triSrcFace.push(f)
    }
    for (const f of quads) {
        const s = fo[f]
        let edge02: boolean
        switch (quadMode) {
        case 'FIXED': edge02 = true; break
        case 'ALTERNATE': edge02 = false; break
        case 'SHORT_EDGE': edge02 = distSq(pos, cv[s], cv[s + 2]) < distSq(pos, cv[s + 1], cv[s + 3]); break
        case 'LONG_EDGE': edge02 = distSq(pos, cv[s], cv[s + 2]) > distSq(pos, cv[s + 1], cv[s + 3]); break
        default: edge02 = quadDirectionBeauty(vert(s), vert(s + 1), vert(s + 2), vert(s + 3))
        }
        for (const k of edge02 ? [2, 0, 1, 0, 2, 3] : [1, 3, 0, 3, 1, 2]) cornerTris.push(s + k)
        triSrcFace.push(f, f)
    }

    // `tri_to_ordered` (:308) and the insertion-ordered `VectorSet<TriKey>` of distinct triangles (:597).
    const triKey = (a: number, b: number, c: number) => {
        const lo = Math.min(a, b, c), hi = Math.max(a, b, c)
        return `${lo},${(a - lo) + (c - hi) + b},${hi}`
    }
    const unique = new Map<string, number>()
    for (let t = 0; t < cornerTris.length / 3; t++) {
        const k = triKey(cv[cornerTris[t * 3]], cv[cornerTris[t * 3 + 1]], cv[cornerTris[t * 3 + 2]])
        if (!unique.has(k)) unique.set(k, t)
    }
    const uniqueTris = [...unique.values()]
    // Source triangles equal to a new triangle are dropped (`tris_in_set`, :363); the other faces stay, in order.
    const changed = new Uint8Array(src.facesNum)
    for (const f of quads) changed[f] = 1
    for (const f of ngons) changed[f] = 1
    const keptFaces: number[] = []
    for (let f = 0; f < src.facesNum; f++) {
        if (changed[f]) continue
        if (size(f) === 3 && unique.has(triKey(cv[fo[f]], cv[fo[f] + 1], cv[fo[f] + 2]))) continue
        keptFaces.push(f)
    }

    // The new mesh (:612): vertex and edge data shared, faces = unique triangles then kept faces.
    const dst = newMeshData()
    for (const layer of dst.attributes.layers()) dst.attributes.remove(layer.name)
    let corners = uniqueTris.length * 3
    for (const f of keptFaces) corners += size(f)
    dst.resize({verts: src.vertsNum, edges: src.edgesNum, faces: uniqueTris.length + keptFaces.length, corners})
    dst.materials = src.materials.slice()
    let o = 0
    for (let t = 0; t < uniqueTris.length; t++, o += 3) dst.faceOffsets[t] = o
    keptFaces.forEach((f, i) => {
        dst.faceOffsets[uniqueTris.length + i] = o
        o += size(f)
    })
    dst.faceOffsets[uniqueTris.length + keptFaces.length] = o

    const triFace = uniqueTris.map(t => triSrcFace[t])
    // Corner indices of the destination corners, in the source.
    const cornerSrc = new Int32Array(corners)
    uniqueTris.forEach((t, i) => {
        for (let k = 0; k < 3; k++) cornerSrc[i * 3 + k] = cornerTris[t * 3 + k]
    })
    let d = uniqueTris.length * 3
    for (const f of keptFaces) for (let c = fo[f]; c < fo[f + 1]; c++) cornerSrc[d++] = c
    const faceSrc = [...triFace, ...keptFaces]

    for (const layer of src.attributes.layers()) {
        const c = DATA_TYPES[layer.type as DataType].components
        if (layer.domain === AttrDomain.Point || layer.domain === AttrDomain.Edge) {
            dst.attributes.add({name: layer.name, domain: layer.domain, type: layer.type}).data.set(layer.data)
            continue
        }
        if (layer.name === '.corner_edge') continue
        const map = layer.domain === AttrDomain.Face ? faceSrc : layer.domain === AttrDomain.Corner ? cornerSrc : undefined
        if (!map) continue
        const out = dst.attributes.add({name: layer.name, domain: layer.domain, type: layer.type}).data
        for (let i = 0; i < map.length; i++) for (let k = 0; k < c; k++) out[i * c + k] = layer.data[map[i] * c + k]
    }
    dst.attributes.add({name: '.corner_edge', domain: AttrDomain.Corner, type: 'int32'})
    meshCalcEdges(dst, true, false)
    return dst
}

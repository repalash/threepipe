/**
 * Ico Sphere (Blender 5.2.2): `bmo_create_icosphere_exec` (`bmesh/operators/bmo_primitive.cc:965`), the parts of
 * `bmo_subdivide_edges_exec` (`bmesh/operators/bmo_subdivide.cc:910`) it uses (`use_grid_fill`, `use_sphere`, `cuts`,
 * no smooth / fractal / edge percents / custom patterns), and `BM_mesh_bm_to_me` (`bmesh_mesh_convert.cc`) order, on the
 * float32 BMesh in `blender/bmesh/bmeshCore.ts`.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import {BMesh, BMFace, BMLoop, BMVert, BMEdge, loopsOfFace, vertPairShareFaceByLen} from '../blender/bmesh/bmeshCore'
import {newMesh} from './meshPrimitives'

/* eslint-disable array-element-newline */
/** `icovert` (`bmo_primitive.cc:29`); `-170.128` (no `f`) is a double literal converted to float. */
const ICOVERT: readonly number[][] = [
    [0.0, 0.0, -200.0], [144.72, -105.144, -89.443], [-55.277, -170.128, -89.443], [-178.885, 0.0, -89.443],
    [-55.277, 170.128, -89.443], [144.72, 105.144, -89.443], [55.277, -170.128, 89.443], [-144.72, -105.144, 89.443],
    [-144.72, 105.144, 89.443], [55.277, 170.128, 89.443], [178.885, 0.0, 89.443], [0.0, 0.0, 200.0],
].map(v => v.map(f32))

/** `icoface` (`bmo_primitive.cc:44`). */
const ICOFACE: readonly number[][] = [
    [0, 1, 2], [1, 0, 5], [0, 2, 3], [0, 3, 4], [0, 4, 5], [1, 5, 10], [2, 1, 6],
    [3, 2, 7], [4, 3, 8], [5, 4, 9], [1, 10, 6], [2, 6, 7], [3, 7, 8], [4, 8, 9],
    [5, 9, 10], [6, 10, 11], [7, 6, 11], [8, 7, 11], [9, 8, 11], [10, 9, 11],
]

/** `icouvs` (`bmo_primitive.cc:50`). */
const ICOUVS: readonly number[] = [
    0.181819, 0.000000, 0.272728, 0.157461, 0.090910, 0.157461, 0.272728, 0.157461,
    0.363637, 0.000000, 0.454546, 0.157461, 0.909091, 0.000000, 1.000000, 0.157461,
    0.818182, 0.157461, 0.727273, 0.000000, 0.818182, 0.157461, 0.636364, 0.157461,
    0.545455, 0.000000, 0.636364, 0.157461, 0.454546, 0.157461, 0.272728, 0.157461,
    0.454546, 0.157461, 0.363637, 0.314921, 0.090910, 0.157461, 0.272728, 0.157461,
    0.181819, 0.314921, 0.818182, 0.157461, 1.000000, 0.157461, 0.909091, 0.314921,
    0.636364, 0.157461, 0.818182, 0.157461, 0.727273, 0.314921, 0.454546, 0.157461,
    0.636364, 0.157461, 0.545455, 0.314921, 0.272728, 0.157461, 0.363637, 0.314921,
    0.181819, 0.314921, 0.090910, 0.157461, 0.181819, 0.314921, 0.000000, 0.314921,
    0.818182, 0.157461, 0.909091, 0.314921, 0.727273, 0.314921, 0.636364, 0.157461,
    0.727273, 0.314921, 0.545455, 0.314921, 0.454546, 0.157461, 0.545455, 0.314921,
    0.363637, 0.314921, 0.181819, 0.314921, 0.363637, 0.314921, 0.272728, 0.472382,
    0.000000, 0.314921, 0.181819, 0.314921, 0.090910, 0.472382, 0.727273, 0.314921,
    0.909091, 0.314921, 0.818182, 0.472382, 0.545455, 0.314921, 0.727273, 0.314921,
    0.636364, 0.472382, 0.363637, 0.314921, 0.545455, 0.314921, 0.454546, 0.472382,
].map(f32)
/* eslint-enable array-element-newline */

/** `normalize_v3_length` (`math_vector_inline.cc:872`). */
function normalizeV3Length(n: Float32Array, unitLength: number): void {
    let d = f32(f32(f32(n[0] * n[0]) + f32(n[1] * n[1])) + f32(n[2] * n[2]))
    if (d > f32(1.0e-35)) {
        d = f32(Math.sqrt(d))
        const s = f32(unitLength / d)
        for (let k = 0; k < 3; k++) n[k] = f32(n[k] * s)
    } else n.fill(0)
}

interface SubDParams {
    numcuts: number
    smooth: number
}

/** `alter_co` (`bmo_subdivide.cc:246`) for `use_sphere`: the shape-key temp layer gets the vertex projected to `smooth`. */
function alterCo(v: BMVert, params: SubDParams): void {
    const co = v.shape
    co.set(v.co)
    normalizeV3Length(co, params.smooth)
}

/** `subdivide_edge_num` (`bmo_subdivide.cc:396`) without edge percents, with `bm_subdivide_edge_addvert` (:372). */
function subdivideEdgeNum(bm: BMesh, edge: BMEdge, curpoint: number, totpoint: number, params: SubDParams): [BMVert, BMEdge] {
    const factorEdgeSplit = f32(1 / (totpoint + 1 - curpoint))
    const [vNew, eNew] = bm.edgeSplit(edge, edge.v1, factorEdgeSplit)
    alterCo(vNew, params)
    return [vNew, eNew]
}

/** `bm_subdivide_multicut` (`bmo_subdivide.cc:423`). */
function subdivideMulticut(bm: BMesh, edge: BMEdge, params: SubDParams): void {
    const v1 = edge.v1, v2 = edge.v2
    for (let i = 0; i < params.numcuts; i++) subdivideEdgeNum(bm, edge, i, params.numcuts, params)
    alterCo(v1, params)
    alterCo(v2, params)
}

/** `connect_smallest_face` (`bmo_subdivide.cc:124`): returns the new edge and face. */
function connectSmallestFace(bm: BMesh, vA: BMVert, vB: BMVert): [BMEdge, BMFace] | null {
    const share = vertPairShareFaceByLen(vA, vB, true)
    if (!share) return null
    const [f, lA, lB] = share
    const [fNew, lNew] = bm.faceSplit(f, lA, lB)
    return [lNew.e!, fNew]
}

/** `tri_3edge_subdivide` (`bmo_subdivide.cc:792`). */
function tri3EdgeSubdivide(bm: BMesh, verts: BMVert[], params: SubDParams): void {
    const numcuts = params.numcuts
    const lines: BMVert[][] = new Array(numcuts + 2)
    lines[0] = [verts[numcuts * 2 + 1]]
    lines[numcuts + 1] = new Array(numcuts + 2)
    for (let i = 0; i < numcuts; i++) lines[numcuts + 1][i + 1] = verts[i]
    lines[numcuts + 1][0] = verts[numcuts * 3 + 2]
    lines[numcuts + 1][numcuts + 1] = verts[numcuts]

    for (let i = 0; i < numcuts; i++) {
        lines[i + 1] = new Array(2 + i)
        const a = numcuts * 2 + 2 + i
        const b = numcuts + numcuts - i
        const c = connectSmallestFace(bm, verts[a], verts[b])
        if (!c) throw new Error('tri_3edge_subdivide: no face to connect (the C code jumps to cleanup, leaving the face partly cut)')
        const e = c[0]
        lines[i + 1][0] = verts[a]
        lines[i + 1][i + 1] = verts[b]
        for (let j = 0; j < i; j++) lines[i + 1][j + 1] = subdivideEdgeNum(bm, e, j, i, params)[0]
    }
    for (let i = 1; i <= numcuts; i++) {
        for (let j = 0; j < i; j++) {
            if (!connectSmallestFace(bm, lines[i][j], lines[i + 1][j + 1])) throw new Error('tri_3edge_subdivide: connect_smallest_face failed (the C code dereferences the null edge)')
            if (!connectSmallestFace(bm, lines[i][j + 1], lines[i + 1][j + 1])) throw new Error('tri_3edge_subdivide: connect_smallest_face failed (the C code dereferences the null edge)')
        }
    }
}

/**
 * `bmo_subdivide_edges_exec` (`bmo_subdivide.cc:910`) as `create_icosphere` calls it: every edge of every (triangle) face
 * selected, `use_grid_fill`, `use_sphere`, `smooth = radius`. Only the `tri_3edge` pattern can match; any other face throws.
 */
function subdivideEdgesSphere(bm: BMesh, edges: BMEdge[], numcuts: number, smooth: number): void {
    const params: SubDParams = {numcuts, smooth}
    const selected = new Set(edges)
    // "Add a temporary shape-key layer to store displacements on current geometry."
    for (const v of bm.verts) v.shape.set(v.co)

    // Pattern matching (:1015). All three edges of a triangle are selected: `tri_3edge`, first rotation, start = verts[0].
    const facedata: {face: BMFace, start: BMVert}[] = []
    for (const face of bm.faces) {
        const loops = loopsOfFace(face)
        let totesel = 0
        for (const l of loops) if (selected.has(l.e!)) totesel++
        if (face.len === 3 && totesel === 3) facedata.push({face, start: loops[0].v})
        else if (totesel) throw new Error(`subdivide_edges: face pattern (len ${face.len}, ${totesel} selected edges) is not ported`)
    }

    // "go through and split edges" (:1127).
    for (const edge of edges) subdivideMulticut(bm, edge, params)
    // "copy original-geometry displacements to current coordinates".
    for (const v of bm.verts) v.co.set(v.shape)

    // The face data is a stack: last face first (:1141).
    for (let s = facedata.length - 1; s >= 0; s--) {
        const fd = facedata[s]
        const face = fd.face
        const loops = loopsOfFace(face)
        let a = 0
        for (let j = 0; j < loops.length; j++) {
            if (loops[j].v === fd.start) {
                a = j + 1
                break
            }
        }
        const verts: BMVert[] = new Array(face.len)
        for (let j = 0; j < loops.length; j++) verts[(j - a + face.len) % face.len] = loops[j].v
        tri3EdgeSubdivide(bm, verts, params)
    }
    for (const v of bm.verts) v.co.set(v.shape)
}

/** `bmo_create_icosphere_exec` (`bmo_primitive.cc:965`) with an identity matrix. */
export function createIcosphereBMesh(subdiv: number, radius: number, calcUvs: boolean): BMesh {
    const bm = new BMesh()
    const radDiv = f32(radius / 200)
    const eva: BMVert[] = []
    for (let a = 0; a < 12; a++) eva.push(bm.vertCreate(ICOVERT[a].map(c => f32(radDiv * c))))
    const edgeMark = new Set<BMEdge>()
    let uvi = 0
    for (let a = 0; a < 20; a++) {
        const f = bm.faceCreateVerts([eva[ICOFACE[a][0]], eva[ICOFACE[a][1]], eva[ICOFACE[a][2]]])
        for (const l of loopsOfFace(f)) {
            edgeMark.add(l.e!)
            if (calcUvs) {
                l.uv[0] = ICOUVS[uvi * 2]
                l.uv[1] = ICOUVS[uvi * 2 + 1]
                uvi++
            }
        }
    }
    if (subdiv > 1) {
        // `edges=%fe`: the marked edges in mesh order.
        subdivideEdgesSphere(bm, bm.edges.filter(e => edgeMark.has(e)), (1 << (subdiv - 1)) - 1, radius)
    }
    // "must transform after because of sphere subdivision": `mul_m4_v3` with the identity matrix.
    for (const v of bm.verts) {
        const x = v.co[0], y = v.co[1], z = v.co[2]
        const row = (m0: number, m1: number, m2: number) => f32(f32(f32(f32(x * m0) + f32(y * m1)) + f32(m2 * z)) + 0)
        v.co[0] = row(1, 0, 0)
        v.co[1] = row(0, 1, 0)
        v.co[2] = row(0, 0, 1)
    }
    return bm
}

/**
 * `BM_mesh_bm_to_me` (`bmesh_mesh_convert.cc`) for this BMesh: elements in mempool order, loops from `l_first`; faces
 * without `BM_ELEM_SMOOTH` (`sharp_face`), edges with it (no `sharp_edge`); the UV map plus the `.uv_select_*` layers
 * (written whenever a float2 loop layer exists, all false here); the pin layer is skipped as nothing is pinned.
 */
export function icoBMeshToMesh(bm: BMesh, uvName: string | undefined): MeshData {
    const mesh = newMesh(bm.verts.length, bm.edges.length, bm.faces.length, bm.totloop)
    const positions = mesh.positions
    bm.verts.forEach((v, i) => positions.set(v.co, i * 3))
    const edgeVerts = mesh.edgeVerts
    bm.edges.forEach((e, i) => {
        edgeVerts[i * 2] = e.v1.index
        edgeVerts[i * 2 + 1] = e.v2.index
    })
    const faceOffsets = mesh.faceOffsets, cornerVerts = mesh.cornerVerts, cornerEdges = mesh.cornerEdges
    const uvs: number[] = []
    let c = 0
    bm.faces.forEach((f, i) => {
        faceOffsets[i] = c
        for (const l of loopsOfFace(f) as BMLoop[]) {
            cornerVerts[c] = l.v.index
            cornerEdges[c] = l.e!.index
            uvs.push(l.uv[0], l.uv[1])
            c++
        }
    })
    faceOffsets[bm.faces.length] = c
    mesh.attributes.add({name: 'sharp_face', domain: AttrDomain.Face, type: 'bool'}).data.fill(1)
    mesh.attributes.add({name: '.uv_select_vert', domain: AttrDomain.Corner, type: 'bool'})
    mesh.attributes.add({name: '.uv_select_edge', domain: AttrDomain.Corner, type: 'bool'})
    mesh.attributes.add({name: '.uv_select_face', domain: AttrDomain.Face, type: 'bool'})
    if (uvName) mesh.attributes.add({name: uvName, domain: AttrDomain.Corner, type: 'float2'}).data.set(uvs)
    return mesh
}

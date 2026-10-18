/**
 * Face shading flags on a {@link MeshData}: Blender's Shade Flat, Shade Smooth and Shade Smooth by Angle.
 *
 * Ported from Blender 5.2.2:
 * - `bke::mesh_smooth_set` (`blenkernel/intern/mesh.cc:1881`) and `bke::mesh_sharp_edges_set_from_angle`
 *   (`mesh.cc:1893`), which `OBJECT_OT_shade_flat` / `_smooth` / `_smooth_by_angle` call
 *   (`editors/object/object_edit.cc:1710-1714` on `main` at 5.3 alpha `e4e6c79a`, the 5.2.2 checkout has no `editors/`;
 *   defaults: angle 30°, keep sharp edges on);
 * - `mesh_edges_sharp_tag` (`blenkernel/intern/mesh_normals.cc:836`) and `edges_sharp_from_angle_set` (`:903`);
 * - `face_normal_calc` (`mesh_normals.cc:143`) with `normal_tri_v3` / `normal_quad_v3` (`blenlib/intern/math_geom.cc:45`,
 *   `:62`) and Newell's sum for n-gons, in float32 like Blender, so faces exactly at the threshold fall the same way.
 *
 * Shading is data, not a render setting: `sharp_face` (face domain) and `sharp_edge` (edge domain) are what
 * {@link bakeGeometry} splits normal fans on, exactly as Blender's corner normals do.
 */

import {MeshData} from './MeshData'
import {AttrDomain, AttrName} from './constants'
import {meshFaceNormalsCustom} from './normals'

const f = Math.fround

/** `normalize_v3` (float): leaves the vector unchanged below the `1e-35` squared-length cut-off. */
function normalize(n: Float32Array, o: number): void {
    const d = f(f(f(n[o] * n[o]) + f(n[o + 1] * n[o + 1])) + f(n[o + 2] * n[o + 2]))
    if (d > 1.0e-35) {
        const inv = f(1 / f(Math.sqrt(d)))
        n[o] = f(n[o] * inv); n[o + 1] = f(n[o + 1] * inv); n[o + 2] = f(n[o + 2] * inv)
    } else {
        n[o] = 0; n[o + 1] = 0; n[o + 2] = 0
    }
}

/** `cross_v3_v3v3` of (a - b) and (c - d), in float, into `n[o..o+2]`. */
function crossDiff(P: Float32Array, a: number, b: number, c: number, d: number, n: Float32Array, o: number): void {
    const ux = f(P[a] - P[b]), uy = f(P[a + 1] - P[b + 1]), uz = f(P[a + 2] - P[b + 2])
    const vx = f(P[c] - P[d]), vy = f(P[c + 1] - P[d + 1]), vz = f(P[c + 2] - P[d + 2])
    n[o] = f(f(uy * vz) - f(uz * vy))
    n[o + 1] = f(f(uz * vx) - f(ux * vz))
    n[o + 2] = f(f(ux * vy) - f(uy * vx))
}

/**
 * Geometric face normals as `bke::mesh::face_normal_calc` (`mesh_normals.cc:143`) computes them: quads by the
 * cross of their diagonals, triangles by `normal_tri_v3`, n-gons by Newell's sum; a degenerate face gets +Z. (What
 * `MeshPolygon.normal` and the boolean's corner interpolation use; `Mesh::face_normals()` is `meshFaceNormalsCustom`.)
 */
export function meshFaceNormals(mesh: MeshData): Float32Array {
    const P = mesh.positions, CV = mesh.cornerVerts, O = mesh.faceOffsets
    const n = new Float32Array(mesh.facesNum * 3)
    for (let fi = 0; fi < mesh.facesNum; fi++) {
        const s = O[fi], e = O[fi + 1], len = e - s, o = fi * 3
        if (len === 4) {
            // normal_quad_v3: d1 = v1 - v3, d2 = v2 - v4
            crossDiff(P, CV[s] * 3, CV[s + 2] * 3, CV[s + 1] * 3, CV[s + 3] * 3, n, o)
        } else if (len === 3) {
            // normal_tri_v3: cross(v1 - v2, v2 - v3)
            crossDiff(P, CV[s] * 3, CV[s + 1] * 3, CV[s + 1] * 3, CV[s + 2] * 3, n, o)
        } else {
            // normal_calc_ngon: Newell, previous corner to current
            let x = 0, y = 0, z = 0
            let prev = CV[e - 1] * 3
            for (let c = s; c < e; c++) {
                const cur = CV[c] * 3
                x = f(x + f(f(P[prev + 1] - P[cur + 1]) * f(P[prev + 2] + P[cur + 2])))
                y = f(y + f(f(P[prev + 2] - P[cur + 2]) * f(P[prev] + P[cur])))
                z = f(z + f(f(P[prev] - P[cur]) * f(P[prev + 1] + P[cur + 1])))
                prev = cur
            }
            n[o] = x; n[o + 1] = y; n[o + 2] = z
        }
        normalize(n, o)
        if (n[o] === 0 && n[o + 1] === 0 && n[o + 2] === 0) n[o + 2] = 1
    }
    return n
}

/**
 * `bke::mesh_smooth_set` (`mesh.cc:1881`): Shade Smooth (`useSmooth`) or Shade Flat. Removes `sharp_face`
 * (and `sharp_edge` unless `keepSharpEdges`); flat adds `sharp_face` set on every face.
 */
export function meshSmoothSet(mesh: MeshData, useSmooth: boolean, keepSharpEdges = false): void {
    if (!keepSharpEdges) mesh.attributes.remove(AttrName.sharpEdge)
    mesh.attributes.remove(AttrName.sharpFace)
    if (!useSmooth) (mesh.attributes.ensure(AttrName.sharpFace, AttrDomain.Face, 'bool').data as Uint8Array).fill(1)
}

const INDEX_UNSET = -2147483648 // INT_MIN
const INDEX_INVALID = -1

/**
 * `bke::mesh_sharp_edges_set_from_angle` (`mesh.cc:1893`): mark `sharp_edge` on every edge whose two faces
 * meet at more than `angle` (radians). `angle >= π` is Shade Smooth, `angle == 0` is Shade Flat. Edges already
 * sharp stay sharp when `keepSharpEdges`; otherwise the layer starts empty.
 */
export function meshSharpEdgesSetFromAngle(mesh: MeshData, angle: number, keepSharpEdges = false): void {
    if (angle >= Math.PI) { meshSmoothSet(mesh, true, keepSharpEdges); return }
    if (angle === 0) { meshSmoothSet(mesh, false, keepSharpEdges); return }
    if (!keepSharpEdges) mesh.attributes.remove(AttrName.sharpEdge)
    const sharpEdges = mesh.attributes.ensure(AttrName.sharpEdge, AttrDomain.Edge, 'bool').data as Uint8Array
    const sharpFaces = mesh.attributes.get(AttrName.sharpFace)?.data as Uint8Array | undefined
    // mesh.face_normals(): Newell normals for every face, or the ones custom normals give (mesh_normals.cc:415)
    edgesSharpFromAngleSet(mesh, meshFaceNormalsCustom(mesh), sharpFaces, angle, sharpEdges)
}

/**
 * `edges_sharp_from_angle_set` (`mesh_normals.cc:903`) with `mesh_edges_sharp_tag` (`:836`) inlined. As in
 * Blender the input and output sharp-edge spans are the same array, so an edge tagged earlier in the face loop
 * is read back as tagged.
 */
export function edgesSharpFromAngleSet(
    mesh: MeshData, faceNormals: Float32Array, sharpFaces: Uint8Array | undefined, splitAngle: number, sharpEdges: Uint8Array,
): void {
    if (splitAngle >= Math.PI) return
    const O = mesh.faceOffsets, CV = mesh.cornerVerts, CE = mesh.cornerEdges
    const facesNum = mesh.facesNum
    const cornerToFace = new Int32Array(mesh.cornersNum)
    for (let fi = 0; fi < facesNum; fi++) for (let c = O[fi]; c < O[fi + 1]; c++) cornerToFace[c] = fi
    const e2l = new Int32Array(mesh.edgesNum * 2) // int2(0) per edge
    const splitAngleCos = f(Math.cos(f(splitAngle)))
    const faceIsSmooth = (fi: number) => !sharpFaces || !sharpFaces[fi]
    const dot = (a: number, b: number) =>
        f(f(f(faceNormals[a * 3] * faceNormals[b * 3]) + f(faceNormals[a * 3 + 1] * faceNormals[b * 3 + 1])) + f(faceNormals[a * 3 + 2] * faceNormals[b * 3 + 2]))

    for (let fi = 0; fi < facesNum; fi++) {
        for (let corner = O[fi]; corner < O[fi + 1]; corner++) {
            const vert = CV[corner], edge = CE[corner], k = edge * 2
            if ((e2l[k] | e2l[k + 1]) === 0) {
                // 'Empty' edge until now: first corner, and UNSET (smooth) or INVALID (flat face) as the second.
                e2l[k] = corner
                e2l[k + 1] = faceIsSmooth(fi) ? INDEX_UNSET : INDEX_INVALID
            } else if (e2l[k + 1] === INDEX_UNSET) {
                const isAngleSharp = dot(cornerToFace[e2l[k]], fi) < splitAngleCos
                // Sharp if tagged, if this face is flat, if the two faces are flipped against each other (both
                // corners on the same vertex), or past the angle.
                if (!faceIsSmooth(fi) || sharpEdges[edge] || vert === CV[e2l[k]] || isAngleSharp) {
                    e2l[k + 1] = INDEX_INVALID
                    if (isAngleSharp) sharpEdges[edge] = 1
                } else {
                    e2l[k + 1] = corner
                }
            } else if (e2l[k + 1] !== INDEX_UNSET && e2l[k + 1] !== INDEX_INVALID) {
                // More than two corners on this edge (non-manifold): sharp by topology, so not tagged by angle.
                e2l[k + 1] = INDEX_INVALID
                sharpEdges[edge] = 0
            }
            // else: already sharp
        }
    }
}

/**
 * The three Shade operators as `shade_smooth_exec` (`editors/object/object_edit.cc:1710-1714`, 5.3 alpha) runs them on a mesh:
 * `mesh_smooth_set(use_smooth || use_smooth_by_angle, keep_sharp_edges)`, then, for by-angle,
 * `mesh_sharp_edges_set_from_angle(angle, keep_sharp_edges)`. Operator defaults: angle 30°, keep sharp edges on.
 */
export function shadeFlat(mesh: MeshData, keepSharpEdges = true): void {
    meshSmoothSet(mesh, false, keepSharpEdges)
}

export function shadeSmooth(mesh: MeshData, keepSharpEdges = true): void {
    meshSmoothSet(mesh, true, keepSharpEdges)
}

export function shadeSmoothByAngle(mesh: MeshData, angle = 30 * Math.PI / 180, keepSharpEdges = true): void {
    meshSmoothSet(mesh, true, keepSharpEdges)
    meshSharpEdgesSetFromAngle(mesh, angle, keepSharpEdges)
}

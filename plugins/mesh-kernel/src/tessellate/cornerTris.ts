/**
 * `bke::mesh::corner_tris_calc` - Blender's triangulation of a mesh into corner triangles, the one
 * every sampling, scattering and ray-cast geometry node reads through `Mesh::corner_tris()`.
 *
 * Port of `blenkernel/intern/mesh_tessellate.cc` (Blender 5.2.2). Triangles are triples of *corner*
 * indices, `face_size - 2` per face in face order (`poly_to_tri_count`). Quads split along 0-2 unless
 * that diagonal is degenerate (`is_quad_flip_v3_first_third_fast`); n-gons are projected along their
 * Newell normal and ear clipped with {@link polyfillCalc}.
 *
 * `Mesh::corner_tris()` (`mesh_runtime.cc:248`) uses `corner_tris_calc_with_normals` when face normals
 * are cached; for n-gons the cached normal is the same normalised Newell normal (`normal_calc_ngon`,
 * `mesh_normals.cc:123`) and quads/triangles ignore it, so the two paths give the same triangles and
 * only the normal-free one is ported.
 */

import type {MeshData} from '../MeshData'
import {polyfillCalc} from '../math/polyfill2d'
import {addNewellCrossV3V3, axisDominantV3ToM3Negate, isQuadFlipV3FirstThirdFast, mulV2M3V3, normalizeV3} from './geomF32'

/** `poly_to_tri_count(face_index, corner_start)` (`BKE_mesh.hh`): first triangle of a face. */
export function polyToTriCount(faceIndex: number, cornerStart: number): number {
    return cornerStart - faceIndex * 2
}

/**
 * `mesh_calc_tessellation_for_face_impl` (`mesh_tessellate.cc:37`) for one face, writing corner-index
 * triples into `out` from triangle `tri`.
 */
export function tessellateFace(
    positions: ArrayLike<number>, cornerVerts: ArrayLike<number>,
    faceStart: number, faceSize: number, out: Int32Array, tri: number,
): void {
    const put = (t: number, i1: number, i2: number, i3: number) => {
        out[t * 3] = faceStart + i1
        out[t * 3 + 1] = faceStart + i2
        out[t * 3 + 2] = faceStart + i3
    }
    const pos = (corner: number) => {
        const v = cornerVerts[corner] * 3
        return [positions[v], positions[v + 1], positions[v + 2]]
    }
    if (faceSize === 3) {
        put(tri, 0, 1, 2)
        return
    }
    if (faceSize === 4) {
        put(tri, 0, 1, 2)
        put(tri + 1, 0, 2, 3)
        const a = tri * 3, b = (tri + 1) * 3
        if (isQuadFlipV3FirstThirdFast(pos(out[a]), pos(out[a + 1]), pos(out[a + 2]), pos(out[b + 2]))) {
            // Flip out of degenerate 0-2 state.
            out[a + 2] = out[b + 2]
            out[b] = out[a + 1]
        }
        return
    }
    // Newell normal, flipped to get a positive 2D cross product.
    const normal = [0, 0, 0]
    let prev = pos(faceStart + faceSize - 1)
    for (let j = 0; j < faceSize; j++) {
        const curr = pos(faceStart + j)
        addNewellCrossV3V3(normal, prev, curr)
        prev = curr
    }
    if (normalizeV3(normal) === 0) normal[2] = 1
    const axis = axisDominantV3ToM3Negate(normal)
    const proj = new Float32Array(faceSize * 2)
    for (let j = 0; j < faceSize; j++) mulV2M3V3(axis, pos(faceStart + j), proj, j * 2)
    const tris = polyfillCalc(proj, faceSize, 1)
    for (let j = 0; j < faceSize - 2; j++) put(tri + j, tris[j * 3], tris[j * 3 + 1], tris[j * 3 + 2])
}

/** `corner_tris_calc` (`mesh_tessellate.cc:206`): `(corners - 2 * faces) * 3` corner indices. */
export function cornerTrisCalc(mesh: MeshData): Int32Array {
    const fo = mesh.faceOffsets
    const out = new Int32Array((mesh.cornersNum - 2 * mesh.facesNum) * 3)
    const positions = mesh.positions
    const cornerVerts = mesh.cornerVerts
    for (let f = 0; f < mesh.facesNum; f++) {
        tessellateFace(positions, cornerVerts, fo[f], fo[f + 1] - fo[f], out, polyToTriCount(f, fo[f]))
    }
    return out
}

/** `corner_tris_calc_face_indices` (`mesh_tessellate.cc:214`): the face of every corner triangle. */
export function cornerTriFaces(mesh: MeshData): Int32Array {
    const fo = mesh.faceOffsets
    const out = new Int32Array(mesh.cornersNum - 2 * mesh.facesNum)
    for (let f = 0; f < mesh.facesNum; f++) {
        const start = polyToTriCount(f, fo[f])
        out.fill(f, start, start + (fo[f + 1] - fo[f] - 2))
    }
    return out
}

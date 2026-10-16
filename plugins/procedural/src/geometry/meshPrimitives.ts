/**
 * Mesh primitives of the geometry nodes - ports of `geometry/intern/mesh_primitive_*.cc` (Blender
 * 5.2.2). These are not the edit-mode primitives (`bmo_primitive.cc`, which the kernel ports): element
 * order differs, and geometry nodes are compared element by element.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'

/** `BKE_mesh_new_nomain(verts, edges, faces, corners)`. */
export function newMesh(verts: number, edges: number, faces: number, corners: number): MeshData {
    const m = new MeshData()
    m.resize({verts, edges, faces, corners})
    return m
}

/** `bke::mesh_smooth_set` (`blenkernel/intern/mesh.cc:1881`). */
export function meshSmoothSet(mesh: MeshData, useSmooth: boolean, keepSharpEdges = false): void {
    if (!keepSharpEdges) mesh.attributes.remove('sharp_edge')
    mesh.attributes.remove('sharp_face')
    if (!useSmooth) {
        const layer = mesh.attributes.add({name: 'sharp_face', domain: AttrDomain.Face, type: 'bool'})
        layer.data.fill(1)
    }
}

/** `BKE_id_material_eval_ensure_default_slot` (`blenkernel/intern/material.cc:909`): one empty slot. */
export function ensureDefaultMaterialSlot(mesh: MeshData): void {
    if (mesh.materials.length === 0) mesh.materials = ['']
}

/** `create_grid_mesh` (`geometry/intern/mesh_primitive_grid.cc:40`). */
export function createGridMesh(vertsX: number, vertsY: number, sizeX: number, sizeY: number, uvMapId?: string): MeshData {
    const edgesX = vertsX - 1
    const edgesY = vertsY - 1
    const mesh = newMesh(vertsX * vertsY, edgesX * vertsY + edgesY * vertsX, edgesX * edgesY, edgesX * edgesY * 4)
    const positions = mesh.positions
    const edges = mesh.edgeVerts
    const cornerVerts = mesh.cornerVerts
    const cornerEdges = mesh.cornerEdges
    meshSmoothSet(mesh, false)
    const fo = mesh.faceOffsets
    for (let f = 0; f <= mesh.facesNum; f++) fo[f] = f * 4

    const dx = edgesX === 0 ? 0 : f32(sizeX / edgesX)
    const dy = edgesY === 0 ? 0 : f32(sizeY / edgesY)
    const xShift = f32(edgesX / 2)
    const yShift = f32(edgesY / 2)
    for (let x = 0; x < vertsX; x++) {
        for (let y = 0; y < vertsY; y++) {
            const v = x * vertsY + y
            positions[v * 3] = f32(x - xShift) * dx
            positions[v * 3 + 1] = f32(y - yShift) * dy
            positions[v * 3 + 2] = 0
        }
    }
    const yEdgesStart = 0
    const xEdgesStart = vertsX * edgesY
    for (let x = 0; x < vertsX; x++) {
        for (let y = 0; y < edgesY; y++) {
            const vert = x * vertsY + y
            const e = yEdgesStart + x * edgesY + y
            edges[e * 2] = vert
            edges[e * 2 + 1] = vert + 1
        }
    }
    for (let y = 0; y < vertsY; y++) {
        for (let x = 0; x < edgesX; x++) {
            const vert = x * vertsY + y
            const e = xEdgesStart + y * edgesX + x
            edges[e * 2] = vert
            edges[e * 2 + 1] = vert + vertsY
        }
    }
    for (let x = 0; x < edgesX; x++) {
        for (let y = 0; y < edgesY; y++) {
            const face = x * edgesY + y
            const c = face * 4
            const vert = x * vertsY + y
            cornerVerts[c] = vert
            cornerEdges[c] = xEdgesStart + edgesX * y + x
            cornerVerts[c + 1] = vert + vertsY
            cornerEdges[c + 1] = yEdgesStart + edgesY * (x + 1) + y
            cornerVerts[c + 2] = vert + vertsY + 1
            cornerEdges[c + 2] = xEdgesStart + edgesX * (y + 1) + x
            cornerVerts[c + 3] = vert + 1
            cornerEdges[c + 3] = yEdgesStart + edgesY * x + y
        }
    }
    if (uvMapId && mesh.facesNum !== 0) {
        // `calculate_uvs` (:12).
        const uv = mesh.attributes.add({name: uvMapId, domain: AttrDomain.Corner, type: 'float2'}).data
        const ux = sizeX === 0 ? 0 : f32(1 / sizeX)
        const uy = sizeY === 0 ? 0 : f32(1 / sizeY)
        const hx = f32(sizeX * 0.5), hy = f32(sizeY * 0.5)
        for (let i = 0; i < mesh.cornersNum; i++) {
            const v = cornerVerts[i]
            uv[i * 2] = f32(f32(positions[v * 3] + hx) * ux)
            uv[i * 2 + 1] = f32(f32(positions[v * 3 + 1] + hy) * uy)
        }
    }
    return mesh
}

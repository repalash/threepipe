/**
 * Mesh primitives of the geometry nodes - ports of `geometry/intern/mesh_primitive_*.cc` (Blender
 * 5.2.2). These are not the edit-mode primitives (`bmo_primitive.cc`, which the kernel ports): element
 * order differs, and geometry nodes are compared element by element.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import {meshCalcEdges} from './meshCalcEdges'

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

/** `create_line_mesh` (`geometry/intern/mesh_primitive_line.cc:13`): `start + delta * i`. */
export function createLineMesh(start: ArrayLike<number>, delta: ArrayLike<number>, count: number): MeshData | undefined {
    if (count < 1) return undefined
    const mesh = newMesh(count, count - 1, 0, 0)
    const p = mesh.positions
    const e = mesh.edgeVerts
    for (let i = 0; i < count; i++) {
        for (let k = 0; k < 3; k++) p[i * 3 + k] = f32(start[k] + f32(delta[k] * i))
    }
    for (let i = 0; i < count - 1; i++) {
        e[i * 2] = i
        e[i * 2 + 1] = i + 1
    }
    return mesh
}

/** `create_cuboid_mesh` (`geometry/intern/mesh_primitive_cuboid.cc:376`). */
export function createCuboidMesh(size: ArrayLike<number>, vertsX: number, vertsY: number, vertsZ: number, uvMapId?: string): MeshData {
    const edgesX = vertsX - 1, edgesY = vertsY - 1, edgesZ = vertsZ - 1
    // `CuboidConfig` (:13).
    const vertexCount = vertsX * vertsY * vertsZ - (vertsX - 2) * (vertsY - 2) * (vertsZ - 2)
    const faceCount = 2 * (edgesX * edgesY + edgesY * edgesZ + edgesZ * edgesX)
    const mesh = newMesh(vertexCount, 0, faceCount, faceCount * 4)
    meshSmoothSet(mesh, false)

    // `calculate_positions` (:53).
    const pos = mesh.positions
    const zBottom = f32(-size[2] / 2), zDelta = f32(size[2] / edgesZ)
    const xLeft = f32(-size[0] / 2), xDelta = f32(size[0] / edgesX)
    const yFront = f32(-size[1] / 2), yDelta = f32(size[1] / edgesY)
    let vi = 0
    const put = (x: number, y: number, z: number) => {
        pos[vi * 3] = x
        pos[vi * 3 + 1] = y
        pos[vi * 3 + 2] = z
        vi++
    }
    const at = (base: number, delta: number, i: number) => f32(base + f32(delta * i))
    for (let z = 0; z < vertsZ; z++) {
        if (z === 0 || z === edgesZ) {
            const zPos = at(zBottom, zDelta, z)
            for (let y = 0; y < vertsY; y++) {
                const yPos = at(yFront, yDelta, y)
                for (let x = 0; x < vertsX; x++) put(at(xLeft, xDelta, x), yPos, zPos)
            }
        } else {
            for (let y = 0; y < vertsY; y++) {
                if (y === 0 || y === edgesY) {
                    const yPos = at(yFront, yDelta, y)
                    const zPos = at(zBottom, zDelta, z)
                    for (let x = 0; x < vertsX; x++) put(at(xLeft, xDelta, x), yPos, zPos)
                } else {
                    const yPos = at(yFront, yDelta, y)
                    const zPos = at(zBottom, zDelta, z)
                    put(xLeft, yPos, zPos)
                    put(at(xLeft, xDelta, edgesX), yPos, zPos)
                }
            }
        }
    }

    const fo = mesh.faceOffsets
    for (let f = 0; f <= faceCount; f++) fo[f] = f * 4

    // `calculate_corner_verts` (:120).
    const cv = mesh.cornerVerts
    let corner = 0
    const quad = (a: number, b: number, c: number, d: number) => {
        cv[corner] = a
        cv[corner + 1] = b
        cv[corner + 2] = c
        cv[corner + 3] = d
        corner += 4
    }
    const xyCross = vertsX * vertsY - (vertsX - 2) * (vertsY - 2)
    // Bottom.
    let v1s = 0
    for (let y = 0; y < edgesY; y++) {
        for (let x = 0; x < edgesX; x++) {
            const v1 = v1s + x
            const v2 = v1s + vertsX + x
            quad(v1, v2, v2 + 1, v1 + 1)
        }
        v1s += vertsX
    }
    // Front.
    v1s = 0
    let v2s = vertsX * vertsY
    for (let z = 0; z < edgesZ; z++) {
        for (let x = 0; x < edgesX; x++) quad(v1s + x, v1s + x + 1, v2s + x + 1, v2s + x)
        v1s = v2s
        v2s += vertsX * vertsY - (vertsX - 2) * (vertsY - 2)
    }
    // Top.
    v1s = vertsX * vertsY + (vertsZ - 2) * (vertsX * vertsY - (vertsX - 2) * (vertsY - 2))
    v2s = v1s + vertsX
    for (let y = 0; y < edgesY; y++) {
        for (let x = 0; x < edgesX; x++) quad(v1s + x, v1s + x + 1, v2s + x + 1, v2s + x)
        v2s += vertsX
        v1s += vertsX
    }
    // Back.
    v1s = vertsX * edgesY
    v2s = v1s + xyCross
    for (let z = 0; z < edgesZ; z++) {
        if (z === edgesZ - 1) v2s += (vertsX - 2) * (vertsY - 2)
        for (let x = 0; x < edgesX; x++) quad(v1s + x, v2s + x, v2s + x + 1, v1s + x + 1)
        v2s += xyCross
        v1s += xyCross
    }
    // Left.
    v1s = 0
    v2s = vertsX * vertsY
    for (let z = 0; z < edgesZ; z++) {
        for (let y = 0; y < edgesY; y++) {
            let v1: number, v2: number, v3: number, v4: number
            if (z === 0 || y === 0) {
                v1 = v1s + vertsX * y
                v4 = v1 + vertsX
            } else {
                v1 = v1s + 2 * y + vertsX - 2
                v4 = v1 + 2
            }
            if (y === 0 || z === edgesZ - 1) {
                v2 = v2s + vertsX * y
                v3 = v2 + vertsX
            } else {
                v2 = v2s + 2 * y + vertsX - 2
                v3 = v2 + 2
            }
            quad(v1, v2, v3, v4)
        }
        v1s += z === 0 ? vertsX * vertsY : xyCross
        v2s += xyCross
    }
    // Right.
    v1s = edgesX
    v2s = v1s + vertsX * vertsY
    for (let z = 0; z < edgesZ; z++) {
        for (let y = 0; y < edgesY; y++) {
            let v1: number, v2: number, v3: number, v4: number
            if (z === 0) {
                v1 = v1s + vertsX * y
                v4 = v1 + vertsX
            } else {
                v1 = v1s + 2 * y
                v4 = v1 + 2
            }
            if (z === edgesZ - 1) {
                v2 = v2s + vertsX * y
                v3 = v2 + vertsX
            } else {
                v2 = v2s + 2 * y
                v3 = v2 + 2
            }
            if (y === edgesY - 1) {
                v3 = v2 + vertsX
                v4 = v1 + vertsX
            }
            quad(v1, v4, v3, v2)
        }
        v1s += z === 0 ? vertsX * vertsY : xyCross
        v2s += xyCross
    }
    meshCalcEdges(mesh, false, false)

    if (uvMapId) {
        // `calculate_uvs` (:283).
        const uv = mesh.attributes.add({name: uvMapId, domain: AttrDomain.Corner, type: 'float2'}).data
        let c = 0
        const xd = f32(0.25 / edgesX), yd = f32(0.25 / edgesY), zd = f32(0.25 / edgesZ)
        // `a + i * d` with an int `i` converted to float.
        const lin = (a: number, i: number, d: number) => f32(a + f32(i * d))
        const linm = (a: number, i: number, d: number) => f32(a - f32(i * d))
        const set = (u: number, v: number) => {
            uv[c * 2] = u
            uv[c * 2 + 1] = v
            c++
        }
        for (let y = 0; y < edgesY; y++) for (let x = 0; x < edgesX; x++) {
            set(lin(0.25, x, xd), linm(0.375, y, yd))
            set(lin(0.25, x, xd), linm(0.375, y + 1, yd))
            set(lin(0.25, x + 1, xd), linm(0.375, y + 1, yd))
            set(lin(0.25, x + 1, xd), linm(0.375, y, yd))
        }
        for (let z = 0; z < edgesZ; z++) for (let x = 0; x < edgesX; x++) {
            set(lin(0.25, x, xd), lin(0.375, z, zd))
            set(lin(0.25, x + 1, xd), lin(0.375, z, zd))
            set(lin(0.25, x + 1, xd), lin(0.375, z + 1, zd))
            set(lin(0.25, x, xd), lin(0.375, z + 1, zd))
        }
        for (let y = 0; y < edgesY; y++) for (let x = 0; x < edgesX; x++) {
            set(lin(0.25, x, xd), lin(0.625, y, yd))
            set(lin(0.25, x + 1, xd), lin(0.625, y, yd))
            set(lin(0.25, x + 1, xd), lin(0.625, y + 1, yd))
            set(lin(0.25, x, xd), lin(0.625, y + 1, yd))
        }
        for (let z = 0; z < edgesZ; z++) for (let x = 0; x < edgesX; x++) {
            set(linm(1, x, xd), lin(0.375, z, zd))
            set(linm(1, x, xd), lin(0.375, z + 1, zd))
            set(linm(1, x + 1, xd), lin(0.375, z + 1, zd))
            set(linm(1, x + 1, xd), lin(0.375, z, zd))
        }
        for (let z = 0; z < edgesZ; z++) for (let y = 0; y < edgesY; y++) {
            set(linm(0.25, y, yd), lin(0.375, z, zd))
            set(linm(0.25, y, yd), lin(0.375, z + 1, zd))
            set(linm(0.25, y + 1, yd), lin(0.375, z + 1, zd))
            set(linm(0.25, y + 1, yd), lin(0.375, z, zd))
        }
        for (let z = 0; z < edgesZ; z++) for (let y = 0; y < edgesY; y++) {
            set(lin(0.5, y, yd), lin(0.375, z, zd))
            set(lin(0.5, y + 1, yd), lin(0.375, z, zd))
            set(lin(0.5, y + 1, yd), lin(0.375, z + 1, zd))
            set(lin(0.5, y, yd), lin(0.375, z + 1, zd))
        }
    }
    return mesh
}

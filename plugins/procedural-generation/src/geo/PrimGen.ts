/**
 * Primitive geometry generators for procedural generation.
 * Returns plain BufferGeometry — auto-upgraded to IGeometry when assigned to Mesh2.
 */

import {BufferAttribute, BufferGeometry, ExtrudeGeometry, Shape, Vector2} from 'threepipe'

/**
 * Create a subdivided grid on the XZ plane (Y-up).
 * Standard terrain base mesh.
 * @param sizeX Width along X axis
 * @param sizeZ Depth along Z axis
 * @param segsX Number of segments along X
 * @param segsZ Number of segments along Z
 */
export function grid(sizeX: number, sizeZ: number, segsX: number, segsZ: number): BufferGeometry {
    const segsXi = Math.max(1, Math.floor(segsX))
    const segsZi = Math.max(1, Math.floor(segsZ))
    const vertsX = segsXi + 1
    const vertsZ = segsZi + 1
    const halfX = sizeX / 2
    const halfZ = sizeZ / 2
    const segW = sizeX / segsXi
    const segD = sizeZ / segsZi

    const vertCount = vertsX * vertsZ
    const positions = new Float32Array(vertCount * 3)
    const normals = new Float32Array(vertCount * 3)
    const uvs = new Float32Array(vertCount * 2)

    let vi = 0, ni = 0, ui = 0
    for (let iz = 0; iz < vertsZ; iz++) {
        const z = iz * segD - halfZ
        for (let ix = 0; ix < vertsX; ix++) {
            const x = ix * segW - halfX
            positions[vi++] = x
            positions[vi++] = 0
            positions[vi++] = z
            normals[ni++] = 0
            normals[ni++] = 1
            normals[ni++] = 0
            uvs[ui++] = ix / segsXi
            uvs[ui++] = 1 - iz / segsZi
        }
    }

    // Use Uint32 only when vertex count exceeds Uint16 range (65535).
    // The check is on vertCount (max index value) not indexCount (number of entries).
    const indexCount = segsXi * segsZi * 6
    const indices = vertCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount)
    // Winding: (a,b,d),(b,c,d) — matches Three.js PlaneGeometry convention.
    // computeVertexNormals() produces correct +Y normals after terrain displacement.
    let ii = 0
    for (let iz = 0; iz < segsZi; iz++) {
        for (let ix = 0; ix < segsXi; ix++) {
            const a = ix + vertsX * iz
            const b = ix + vertsX * (iz + 1)
            const c = ix + 1 + vertsX * (iz + 1)
            const d = ix + 1 + vertsX * iz
            indices[ii++] = a
            indices[ii++] = b
            indices[ii++] = d
            indices[ii++] = b
            indices[ii++] = c
            indices[ii++] = d
        }
    }

    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(positions, 3))
    geo.setAttribute('normal', new BufferAttribute(normals, 3))
    geo.setAttribute('uv', new BufferAttribute(uvs, 2))
    geo.setIndex(new BufferAttribute(indices, 1))
    return geo
}

/**
 * Create a subdivided quad on the XY plane (facing +Z).
 * Used for building facades — baysX x baysY grid of quads.
 * Each bay center can be used as an instancing point for windows/doors.
 * @param width Width along X
 * @param height Height along Y
 * @param baysX Number of bays horizontally
 * @param baysY Number of bays vertically
 */
export function wallGrid(width: number, height: number, baysX: number, baysY: number): BufferGeometry {
    const baysXi = Math.max(1, Math.floor(baysX))
    const baysYi = Math.max(1, Math.floor(baysY))
    const vertsX = baysXi + 1
    const vertsY = baysYi + 1
    const halfW = width / 2
    const segW = width / baysXi
    const segH = height / baysYi

    const vertCount = vertsX * vertsY
    const positions = new Float32Array(vertCount * 3)
    const normals = new Float32Array(vertCount * 3)
    const uvs = new Float32Array(vertCount * 2)

    let vi = 0, ni = 0, ui = 0
    for (let iy = 0; iy < vertsY; iy++) {
        const y = iy * segH
        for (let ix = 0; ix < vertsX; ix++) {
            const x = ix * segW - halfW
            positions[vi++] = x
            positions[vi++] = y
            positions[vi++] = 0
            normals[ni++] = 0
            normals[ni++] = 0
            normals[ni++] = 1
            uvs[ui++] = ix / baysXi
            uvs[ui++] = iy / baysYi
        }
    }

    const indexCount = baysXi * baysYi * 6
    const indices = vertCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount)
    // Winding: (a,b,d),(b,c,d) — matches Three.js PlaneGeometry convention.
    let ii = 0
    for (let iy = 0; iy < baysYi; iy++) {
        for (let ix = 0; ix < baysXi; ix++) {
            const a = ix + vertsX * iy
            const b = ix + vertsX * (iy + 1)
            const c = ix + 1 + vertsX * (iy + 1)
            const d = ix + 1 + vertsX * iy
            indices[ii++] = a
            indices[ii++] = b
            indices[ii++] = d
            indices[ii++] = b
            indices[ii++] = c
            indices[ii++] = d
        }
    }

    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(positions, 3))
    geo.setAttribute('normal', new BufferAttribute(normals, 3))
    geo.setAttribute('uv', new BufferAttribute(uvs, 2))
    geo.setIndex(new BufferAttribute(indices, 1))
    return geo
}

/**
 * Create an extruded polygon from a 2D outline.
 * Uses Three.js ShapeUtils for triangulation.
 * @param points 2D outline points (CCW winding)
 * @param depth Extrusion depth along Z
 */
export function extrudedPolygon(points: [number, number][], depth: number): BufferGeometry {
    const shape = new Shape(points.map(([x, y]) => new Vector2(x, y)))
    return new ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: false,
    })
}

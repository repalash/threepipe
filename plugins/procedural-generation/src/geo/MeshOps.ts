/**
 * Mesh operations for procedural generation.
 * Wraps Three.js utilities and adds operations inspired by Blender's geometry nodes.
 *
 * References:
 * - mergeGeometries: Three.js BufferGeometryUtils
 *   https://threejs.org/docs/#examples/en/utils/BufferGeometryUtils
 * - Face extrusion: Blender node_geo_extrude_mesh.cc (individual face mode)
 *   https://projects.blender.org/blender/blender/src/branch/main/source/blender/nodes/geometry/nodes/node_geo_extrude_mesh.cc
 * - Realize instances: Blender realize_instances.cc
 *   https://projects.blender.org/blender/blender/src/branch/main/source/blender/geometry/intern/realize_instances.cc
 */

import {BufferAttribute, BufferGeometry, InstancedMesh2, Matrix4, Vector3} from 'threepipe'
import {mergeGeometries} from 'threepipe'

/**
 * Merge multiple BufferGeometries into one.
 * Wraps Three.js mergeGeometries with null safety.
 */
export function merge(...geometries: BufferGeometry[]): BufferGeometry | null {
    const valid = geometries.filter(g => g && g.getAttribute('position'))
    if (valid.length === 0) return null
    if (valid.length === 1) return valid[0]
    return mergeGeometries(valid) ?? null
}

/**
 * Extrude selected faces of a geometry by a given amount along their face normals.
 * Individual face mode: each selected face is extruded independently.
 *
 * Returns the extruded geometry with face index arrays for the new top and side faces,
 * matching Blender's Extrude Mesh node "Top" and "Side" boolean outputs.
 *
 * Algorithm:
 * For each selected face:
 *   1. Duplicate the 3 vertices, offset by amount * faceNormal
 *   2. The original face vertices become the bottom (unchanged)
 *   3. The duplicated vertices form the top face
 *   4. Connect original and duplicated vertices with 3 side quads (2 triangles each)
 *
 * Reference: Blender extrude_individual_mesh_faces in node_geo_extrude_mesh.cc
 *
 * @param geo Source geometry (must be indexed triangles)
 * @param selection Face indices to extrude (if null, extrude all)
 * @param amount Extrusion distance along face normals
 */
export function extrudeFaces(
    geo: BufferGeometry,
    selection: number[] | null,
    amount: number,
): {geometry: BufferGeometry, topFaceIndices: number[], sideFaceIndices: number[]} {
    const srcPositions = geo.getAttribute('position') as BufferAttribute
    const srcNormals = geo.getAttribute('normal') as BufferAttribute | null
    const srcUvs = geo.getAttribute('uv') as BufferAttribute | null
    const srcIndex = geo.getIndex()
    if (!srcPositions) throw new Error('MeshOps.extrudeFaces: geometry has no positions')

    const srcFaceCount = srcIndex ? srcIndex.count / 3 : srcPositions.count / 3
    const selectedFaces = selection ?? Array.from({length: srcFaceCount}, (_, i) => i)

    // Reusable vectors
    const v0 = new Vector3(), v1 = new Vector3(), v2 = new Vector3()
    const edge1 = new Vector3(), edge2 = new Vector3()
    const faceNormal = new Vector3()

    // Output arrays
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    const topFaceIndices: number[] = []
    const sideFaceIndices: number[] = []

    // First, copy all existing vertices and faces
    for (let i = 0; i < srcPositions.count; i++) {
        positions.push(srcPositions.getX(i), srcPositions.getY(i), srcPositions.getZ(i))
        if (srcNormals) normals.push(srcNormals.getX(i), srcNormals.getY(i), srcNormals.getZ(i))
        if (srcUvs) uvs.push(srcUvs.getX(i), srcUvs.getY(i))
    }

    // Copy all existing faces (non-selected stay as-is, selected become bottom)
    for (let f = 0; f < srcFaceCount; f++) {
        const i0 = srcIndex ? srcIndex.getX(f * 3) : f * 3
        const i1 = srcIndex ? srcIndex.getX(f * 3 + 1) : f * 3 + 1
        const i2 = srcIndex ? srcIndex.getX(f * 3 + 2) : f * 3 + 2
        indices.push(i0, i1, i2)
    }

    let outputFaceCount = srcFaceCount

    // Extrude each selected face individually
    for (const faceIdx of selectedFaces) {
        if (faceIdx < 0 || faceIdx >= srcFaceCount) continue

        const i0 = srcIndex ? srcIndex.getX(faceIdx * 3) : faceIdx * 3
        const i1 = srcIndex ? srcIndex.getX(faceIdx * 3 + 1) : faceIdx * 3 + 1
        const i2 = srcIndex ? srcIndex.getX(faceIdx * 3 + 2) : faceIdx * 3 + 2

        // Get face vertices
        v0.set(srcPositions.getX(i0), srcPositions.getY(i0), srcPositions.getZ(i0))
        v1.set(srcPositions.getX(i1), srcPositions.getY(i1), srcPositions.getZ(i1))
        v2.set(srcPositions.getX(i2), srcPositions.getY(i2), srcPositions.getZ(i2))

        // Compute face normal
        edge1.subVectors(v1, v0)
        edge2.subVectors(v2, v0)
        faceNormal.crossVectors(edge1, edge2).normalize()

        // Offset
        const offset = faceNormal.clone().multiplyScalar(amount)

        // Create 3 new vertices (top face)
        const newBase = positions.length / 3
        positions.push(v0.x + offset.x, v0.y + offset.y, v0.z + offset.z)
        positions.push(v1.x + offset.x, v1.y + offset.y, v1.z + offset.z)
        positions.push(v2.x + offset.x, v2.y + offset.y, v2.z + offset.z)

        if (srcNormals) {
            normals.push(faceNormal.x, faceNormal.y, faceNormal.z)
            normals.push(faceNormal.x, faceNormal.y, faceNormal.z)
            normals.push(faceNormal.x, faceNormal.y, faceNormal.z)
        }
        if (srcUvs) {
            uvs.push(srcUvs.getX(i0), srcUvs.getY(i0))
            uvs.push(srcUvs.getX(i1), srcUvs.getY(i1))
            uvs.push(srcUvs.getX(i2), srcUvs.getY(i2))
        }

        // Top face (same winding as original)
        indices.push(newBase, newBase + 1, newBase + 2)
        topFaceIndices.push(outputFaceCount)
        outputFaceCount++

        // 3 side quads (each = 2 triangles)
        // Side quad between edge (i0,i1) and (new0,new1)
        const edgePairs: [number, number, number, number][] = [
            [i0, i1, newBase, newBase + 1],
            [i1, i2, newBase + 1, newBase + 2],
            [i2, i0, newBase + 2, newBase],
        ]

        for (const [a, b, c, d] of edgePairs) {
            // Quad: a-b-d, b-c-d (consistent winding for outward-facing sides)
            // Winding order: we need the side faces to face outward.
            // The quad spans from bottom edge (a,b) to top edge (c,d).
            // Two triangles: (a, c, d) and (a, d, b) — this faces outward
            // when the original face winding is CCW viewed from outside.
            indices.push(a, d, c)
            sideFaceIndices.push(outputFaceCount)
            outputFaceCount++
            indices.push(a, b, d)
            sideFaceIndices.push(outputFaceCount)
            outputFaceCount++
        }
    }

    // Build output geometry
    const result = new BufferGeometry()
    result.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    if (normals.length > 0) result.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
    if (uvs.length > 0) result.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))

    const indexArray = positions.length / 3 > 65535
        ? new Uint32Array(indices)
        : new Uint16Array(indices)
    result.setIndex(new BufferAttribute(indexArray, 1))

    // Recompute normals for correct side face lighting
    result.computeVertexNormals()

    return {geometry: result, topFaceIndices, sideFaceIndices}
}

/**
 * Realize (flatten) instanced meshes to real geometry.
 * Converts InstancedMesh2 children into merged BufferGeometry with all transforms applied.
 * Needed for: GLTF export, boolean operations, vertex painting on instances.
 *
 * Algorithm per Blender's realize_instances.cc:
 * For each instance, copy source geometry with instance transform applied, then merge all copies.
 *
 * @param group A Group containing InstancedMesh2 children
 * @returns Merged BufferGeometry with all instances flattened
 */
export function realizeInstances(group: {children: any[]}): BufferGeometry | null {
    const geometries: BufferGeometry[] = []
    const matrix = new Matrix4()
    const pos = new Vector3()

    for (const child of group.children) {
        if (!child.isInstancedMesh) continue
        const inst = child as InstancedMesh2
        const srcGeo = inst.geometry as BufferGeometry
        if (!srcGeo) continue

        for (let i = 0; i < inst.count; i++) {
            inst.getMatrixAt(i, matrix)
            const clone = srcGeo.clone()
            clone.applyMatrix4(matrix)
            geometries.push(clone)
        }
    }

    if (geometries.length === 0) return null
    const result = mergeGeometries(geometries)

    // Dispose clones
    for (const g of geometries) g.dispose()

    return result ?? null
}

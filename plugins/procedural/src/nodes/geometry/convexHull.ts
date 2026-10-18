/** Convex Hull (`GeometryNodeConvexHull`) - `nodes/geometry/nodes/node_geo_convex_hull.cc` (Blender 5.2.2) on `blender/bullet/convexHullComputer.ts`. */

import {MeshData} from '@threepipe/mesh-kernel'
import {convexHullCompute} from '../../blender/bullet/convexHullComputer'
import {MeshAccessor} from '../../geometry/components'
import {CurvesEvaluator} from '../../geometry/curvesEval'
import {DataType} from '../../geometry/dataTypes'
import {GeometrySet} from '../../geometry/GeometrySet'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {ensureDefaultMaterialSlot, meshSmoothSet, newMesh} from '../../geometry/meshPrimitives'
import {registerNodeType} from '../../runtime/registry'

/**
 * `BKE_mesh_new_nomain_from_template` (`blenkernel/intern/mesh.cc:1548`, `_ex` :1488): a new mesh with the source's materials
 * and every source attribute added with its default value (`AttributeInitDefaultValue`, :1537-1543).
 */
function meshNewFromTemplate(src: MeshData, verts: number, edges: number, faces: number, corners: number): MeshData {
    const dst = newMesh(verts, edges, faces, corners)
    dst.materials = src.materials.slice()
    const acc = new MeshAccessor(dst)
    for (const layer of src.attributes.layers()) {
        if (dst.attributes.get(layer.name)) continue
        acc.add(layer.name, layer.domain, layer.type as DataType)
    }
    return dst
}

/** `hull_from_bullet` (:28). `coords` are float3 positions. */
function hullFromBullet(mesh: MeshData | undefined, coords: Float32Array): MeshData {
    const count = coords.length / 3
    const hull = convexHullCompute(coords, count)
    const vertsNum = hull.originalVertexIndex.length
    const facesNum = vertsNum <= 2 ? 0 : hull.faces.length
    const loopsNum = vertsNum <= 2 ? 0 : hull.edgeTarget.length
    // "Half as many edges as loops, because the mesh is manifold."
    const edgesNum = vertsNum === 2 ? 1 : vertsNum < 2 ? 0 : loopsNum / 2
    let result: MeshData
    if (mesh) result = meshNewFromTemplate(mesh, vertsNum, edgesNum, facesNum, loopsNum)
    else {
        result = newMesh(vertsNum, edgesNum, facesNum, loopsNum)
        ensureDefaultMaterialSlot(result)
    }
    meshSmoothSet(result, false)

    const dstPositions = result.positions
    for (let i = 0; i < vertsNum; i++) {
        const original = hull.originalVertexIndex[i]
        if (original < 0 || original >= count) throw new Error('Convex Hull: hull vertex without an original index (BLI_assert_unreachable)')
        dstPositions[i * 3] = coords[original * 3]
        dstPositions[i * 3 + 1] = coords[original * 3 + 1]
        dstPositions[i * 3 + 2] = coords[original * 3 + 2]
    }

    // `plConvexHullGetLoop` / `plConvexHullGetReversedLoopIndex` (`rb_convex_hull_api.cpp`).
    const cornerVerts = new Int32Array(loopsNum)
    const cornerEdges = new Int32Array(loopsNum)
    let edgeIndex = 0
    const edges = result.edgeVerts
    for (let i = 0; i < loopsNum; i++) {
        const vFrom = hull.edgeTarget[i + hull.edgeReverse[i]]
        const vTo = hull.edgeTarget[i]
        cornerVerts[i] = vFrom
        if (vFrom < vTo) {
            edges[edgeIndex * 2] = vFrom
            edges[edgeIndex * 2 + 1] = vTo
            const reverseIndex = i + hull.edgeReverse[i]
            cornerEdges[i] = edgeIndex
            cornerEdges[reverseIndex] = edgeIndex
            edgeIndex++
        }
    }
    if (edgesNum === 1) {
        // "In this case there are no loops."
        edges[0] = 0
        edges[1] = 1
        edgeIndex++
    }
    if (edgeIndex !== edgesNum) throw new Error(`Convex Hull: ${edgeIndex} edges written, ${edgesNum} expected (BLI_assert)`)

    // `plConvexHullGetFaceSize` / `plConvexHullGetFaceLoops`: `getNextEdgeOfFace` is `(this + reverse)->getNextEdgeOfVertex()`.
    const nextOfFace = (e: number) => {
        const r = e + hull.edgeReverse[e]
        return r + hull.edgeNext[r]
    }
    const faceOffsets = result.faceOffsets
    const meshCornerVerts = result.cornerVerts
    const meshCornerEdges = result.cornerEdges
    let j = 0
    let dstCorner = 0
    for (let i = 0; i < facesNum; i++) {
        const loops: number[] = []
        const eOrig = hull.faces[i]
        let e = eOrig
        do {
            loops.push(e)
            e = nextOfFace(e)
        } while (e !== eOrig)
        faceOffsets[i] = j
        for (const l of loops) {
            meshCornerVerts[dstCorner] = cornerVerts[l]
            meshCornerEdges[dstCorner] = cornerEdges[l]
            dstCorner++
        }
        j += loops.length
    }
    faceOffsets[facesNum] = j
    return result
}

/** `compute_hull` (:139): mesh, point cloud and evaluated curve positions, concatenated in that order. */
function computeHull(g: GeometrySet): MeshData | undefined {
    const parts: Float32Array[] = []
    let count = 0
    if (g.mesh) {
        count++
        parts.push(g.mesh.positions)
    }
    if (g.pointCloud) {
        count++
        parts.push(g.pointCloud.positions)
    }
    if (g.curves) {
        count++
        parts.push(new CurvesEvaluator(g.curves).positions)
    }
    if (count === 0) return undefined
    const total = parts.reduce((n, p) => n + p.length, 0)
    const positions = new Float32Array(total)
    let offset = 0
    for (const p of parts) {
        positions.set(p, offset)
        offset += p.length
    }
    return hullFromBullet(g.mesh, positions)
}

registerNodeType({
    idname: 'GeometryNodeConvexHull',
    label: 'Convex Hull',
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Convex Hull')
    },
    // `node_geo_exec` (:296). Grease Pencil (`convex_hull_grease_pencil`) has no component here.
    execute(p) {
        p.set('Convex Hull', foreachRealGeometry(p.geometry('Geometry'), g => {
            g.setMesh(computeHull(g))
            // `keep_only({Mesh, Instance, Edit})`.
            g.remove('pointcloud')
            g.remove('curves')
        }, p.options.scene))
    },
})

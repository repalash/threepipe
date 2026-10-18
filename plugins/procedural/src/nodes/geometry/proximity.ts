/**
 * Geometry Proximity (`GeometryNodeProximity`) - `nodes/geometry/nodes/node_geo_proximity.cc`
 * (declaration :24-55, init :62, `ProximityFunction` :69-286, exec :288-325, RNA :327-355).
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {newNearest} from '../../blender/kdopbvh'
import {f32} from '../../blender/f32'
import {FieldContext, FieldEvaluation, GField, MultiFunction} from '../../fields'
import {PointCloud} from '../../geometry/components'
import {BVHTreeFromMesh, bvhFindNearest, meshBVHEdgesForMask, meshBVHTrisForFaces, meshBVHVertsForMask, pointCloudBVHForMask} from '../../geometry/meshBVH'
import {GeometrySet} from '../../geometry/GeometrySet'
import {registerNodeType} from '../../runtime/registry'
import {applyFunction} from '../util'

type Target = 'POINTS' | 'EDGES' | 'FACES'

/** `IndexMask::from_group_ids`: the elements of each group id (the order of groups does not matter here). */
function groupMasks(ids: {get(i: number): number}, size: number): Map<number, number[]> {
    const groups = new Map<number, number[]>()
    for (let i = 0; i < size; i++) {
        const id = ids.get(i)
        let g = groups.get(id)
        if (!g) groups.set(id, g = [])
        g.push(i)
    }
    return groups
}

/** `ProximityFunction` (:69): BVH trees per group id, built on first use (`prepare_for_execution` :273). */
function proximityFunction(target: GeometrySet, type: Target, groupId: GField): MultiFunction {
    let trees: Map<number, {mesh?: BVHTreeFromMesh, pointcloud?: BVHTreeFromMesh}> | undefined
    const prepare = () => {
        if (trees) return trees
        trees = new Map()
        const t = trees
        const pc: PointCloud | undefined = target.pointCloud
        // `init_for_pointcloud` (:105), only for the Points target (:276).
        if (pc && type === 'POINTS') {
            const ids = new FieldEvaluation(new FieldContext('pointcloud', pc, AttrDomain.Point), pc.pointsNum).evaluate(groupId)
            for (const [id, mask] of groupMasks(ids, pc.pointsNum)) {
                const e = t.get(id) ?? {}
                e.pointcloud = pointCloudBVHForMask(pc, mask)
                t.set(id, e)
            }
        }
        // `init_for_mesh` (:137).
        const mesh: MeshData | undefined = target.mesh
        if (mesh) {
            const domain = type === 'POINTS' ? AttrDomain.Point : type === 'EDGES' ? AttrDomain.Edge : AttrDomain.Face
            const size = type === 'POINTS' ? mesh.vertsNum : type === 'EDGES' ? mesh.edgesNum : mesh.facesNum
            const ids = new FieldEvaluation(new FieldContext('mesh', mesh, domain), size).evaluate(groupId)
            for (const [id, mask] of groupMasks(ids, size)) {
                const e = t.get(id) ?? {}
                e.mesh = type === 'POINTS' ? meshBVHVertsForMask(mesh, mask) : type === 'EDGES' ? meshBVHEdgesForMask(mesh, mask) : meshBVHTrisForFaces(mesh, mask)
                t.set(id, e)
            }
        }
        return t
    }
    return {
        name: 'Geometry Proximity', inputs: ['float3', 'int32'], outputs: ['float3', 'float', 'bool'],
        call(size, [positions, sampleIds], [outPos, outDist, outValid]) {
            const t = prepare()
            for (let i = 0; i < size; i++) {
                const trees = t.get(sampleIds.get(i))
                if (!trees) {
                    outPos[i * 3] = outPos[i * 3 + 1] = outPos[i * 3 + 2] = 0
                    outValid[i] = 0
                    outDist[i] = 0
                    continue
                }
                // The mesh query sets `dist_sq`, the point cloud query then only finds nearer points (:224).
                const nearest = newNearest()
                const co = [positions.get(i, 0), positions.get(i, 1), positions.get(i, 2)]
                if (trees.mesh?.tree) bvhFindNearest(trees.mesh, co, nearest)
                if (trees.pointcloud?.tree) bvhFindNearest(trees.pointcloud, co, nearest)
                outPos[i * 3] = nearest.co[0]
                outPos[i * 3 + 1] = nearest.co[1]
                outPos[i * 3 + 2] = nearest.co[2]
                outValid[i] = 1
                outDist[i] = f32(Math.sqrt(nearest.distSq))
            }
        },
    }
}

registerNodeType({
    idname: 'GeometryNodeProximity',
    label: 'Geometry Proximity',
    // `geo_proximity_init` (:62): GEO_NODE_PROX_TARGET_FACES.
    properties: {target_element: 'FACES'},
    enums: {target_element: ['POINTS', 'EDGES', 'FACES']},
    declare(b) {
        b.input('GEOMETRY', 'Geometry', 'Target')
        b.input('INT', 'Group ID').hideValue().field()
        b.input('VECTOR', 'Sample Position', 'Source Position').implicit('POSITION')
        b.input('INT', 'Sample Group ID').hideValue()
        b.output('VECTOR', 'Position')
        b.output('FLOAT', 'Distance')
        b.output('BOOLEAN', 'Is Valid')
    },
    execute(p) {
        const target = p.geometry('Target')
        // :293: no mesh and no point cloud, default outputs.
        if (!target.mesh && !target.pointCloud) return
        const fn = proximityFunction(target, p.node.prop<Target>('target_element'), p.field('Group ID'))
        const [position, distance, isValid] = applyFunction(fn, [p.field('Source Position'), p.field('Sample Group ID')])
        p.set('Position', position)
        p.set('Distance', distance)
        p.set('Is Valid', isValid)
    },
})

/**
 * Parity cases for Merge Points (point clouds and meshes, selections, the Index short cut), Cluster by Connected
 * (union by rank roots, running cluster centers, edge selections) and Cluster by Distance (one group, several groups,
 * selections).
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index
const jitter = (seed: number, amount: number) => n.RandomValue({dataType: 'FLOAT_VECTOR', min: [-amount, -amount, -amount], max: [amount, amount, amount], seed}).value as Socket<'VECTOR'>

export function meshClusterCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, SHAPE_SCENE, build))
    const cloud = () => n.SetPosition({geometry: n.MeshToPoints({mesh: n.MeshGrid({sizeX: 2, sizeY: 2, verticesX: 8, verticesY: 8}).mesh}).points, offset: jitter(3, 0.1)}).geometry

    add('merge-points', 'Merge Points on a point cloud and a mesh by integer IDs, partial selection; Index merges nothing', () => {
        const pts = store(cloud(), 'POINT', 'v', index().mul(0.5))
        const byId = n.MergePoints({geometry: pts, mergeID: mod(index(), 5), selection: mod(index(), 7).eq(0).not()}).geometry
        const mesh = n.MergePoints({geometry: attributed(testMeshes()), mergeID: n.Math({operation: 'FLOOR', value: index().mul(0.5)}).value}).geometry
        const same = n.MergePoints({geometry: n.MeshGrid({verticesX: 3, verticesY: 3}).mesh}).geometry
        return n.JoinGeometry({geometry: [byId, mesh, same]}).geometry
    })
    add('cluster-connected', 'Cluster by Connected on a jittered grid with growing clusters, and an edge selection', () => {
        const grid = n.SetPosition({geometry: n.MeshGrid({sizeX: 1, sizeY: 1, verticesX: 9, verticesY: 9}).mesh, offset: jitter(5, 0.03)}).geometry
        let g = store(grid, 'POINT', 'c', n.ClusterByConnected({distance: 0.14}).clusterID)
        g = store(g, 'POINT', 'c_sel', n.ClusterByConnected({distance: 0.2, selection: mod(index(), 3).eq(0).not()}).clusterID)
        return store(g, 'FACE', 'c_face', n.ClusterByConnected({distance: 0.14}).clusterID)
    })
    add('cluster-distance', 'Cluster by Distance with one group, several groups and a selection, on points and mesh faces', () => {
        let pts = store(cloud(), 'POINT', 'one', n.ClusterByDistance({distance: 0.2}).clusterID)
        pts = store(pts, 'POINT', 'groups', n.ClusterByDistance({distance: 0.25, groupID: mod(index(), 3)}).clusterID)
        pts = store(pts, 'POINT', 'sel', n.ClusterByDistance({distance: 0.3, selection: mod(index(), 4).eq(1).not()}).clusterID)
        const faces = store(n.MeshGrid({verticesX: 5, verticesY: 4}).mesh, 'FACE', 'f', n.ClusterByDistance({distance: 0.4}).clusterID)
        return n.JoinGeometry({geometry: [pts, faces]}).geometry
    })
    return cases
}

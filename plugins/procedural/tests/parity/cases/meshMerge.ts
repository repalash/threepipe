/**
 * Parity cases for Merge by Distance: the weld of `mesh_merge_verts.cc` (collapsed edges and faces, split n-gons,
 * duplicate faces, attribute mixing on every domain) in All and Connected modes, with selections, and point clouds.
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, Extra, meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index

export function meshMergeCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, extra, build))
    /** A 5 x 4 grid whose columns 1 and 3 are moved onto columns 0 and 2. */
    const collapsedGrid = () => n.SetPosition({
        geometry: attributed(n.MeshGrid({sizeX: 2, sizeY: 1.5, verticesX: 5, verticesY: 4}).mesh),
        // Grid vertices are column major (4 per column): odd columns move.
        offset: [-0.5, 0, 0], selection: mod(n.Math({operation: 'FLOOR', value: index().div(4)}).value, 2).eq(1),
    }).geometry
    for (const mode of ['All', 'Connected'] as const) {
        const m = mode.toLowerCase()
        add(`merge-${m}-grid-columns`, `Merge by Distance ${mode}: grid columns moved onto their neighbours`, {}, () =>
            n.MergeByDistance({geometry: collapsedGrid(), mode}).geometry)
        add(`merge-${m}-large-distance`, `Merge by Distance ${mode}: distance 0.6 on the joined test meshes (n-gons split, faces collapse)`, SHAPE_SCENE, () =>
            n.MergeByDistance({geometry: attributed(testMeshes()), mode, distance: 0.6}).geometry)
        add(`merge-${m}-selection`, `Merge by Distance ${mode}: distance 0.45 with a vertex selection`, SHAPE_SCENE, () =>
            n.MergeByDistance({geometry: attributed(testMeshes()), mode, distance: 0.45, selection: mod(index(), 3).eq(2).not()}).geometry)
    }
    add('merge-all-duplicate-faces', 'Merge by Distance All of a grid joined with a copy of itself (every face doubled)', {}, () => {
        const g = attributed(n.MeshGrid({verticesX: 4, verticesY: 3}).mesh)
        const other = store(n.MeshGrid({verticesX: 4, verticesY: 3}).mesh, 'FACE', 'ff', index().mul(-2))
        return n.MergeByDistance({geometry: n.JoinGeometry({geometry: [g, other]}).geometry}).geometry
    })
    add('merge-all-nothing', 'Merge by Distance with nothing close leaves the mesh', SHAPE_SCENE, () =>
        n.MergeByDistance({geometry: attributed(testMeshes()), distance: 0.0001}).geometry)
    add('merge-points', 'Merge by Distance of a point cloud with ids and radii, a selection', {}, () => {
        let pts: Socket<'GEOMETRY'> = n.Points({count: 24, position: n.CombineXYZ({x: mod(index(), 5).mul(0.3), y: mod(index(), 3).mul(0.25), z: 0}).vector,
            radius: index().mul(0.01)}).geometry
        pts = n.SetID({geometry: pts, iD: index().mul(3).add(1)}).geometry
        pts = store(pts, 'POINT', 'w', index().mul(0.5))
        return n.MergeByDistance({geometry: pts, distance: 0.32, selection: index().lt(20)}).geometry
    })
    return cases
}

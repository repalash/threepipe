/**
 * Parity cases for Sort Elements (`geometry/intern/reorder.cc`): every supported domain, group-only, weight-only and
 * both, ties broken by index, partial selections (unselected elements stay in place) and the no-op paths.
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index
const random = (seed: number) => n.RandomValue({min: -1, max: 1, seed}).value as Socket<'FLOAT'>

export function meshReorderCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, SHAPE_SCENE, build))
    const meshes = () => store(attributed(testMeshes()), 'POINT', 'original', index())

    add('sort-points-weight', 'Sort points by a random weight, every other third point unselected', () =>
        n.SortElements({geometry: meshes(), domain: 'POINT', sortWeight: random(1), selection: mod(index(), 3).eq(0).not()}).geometry)
    add('sort-points-group-only', 'Sort points by group ID only (ascending groups, index order inside)', () =>
        n.SortElements({geometry: meshes(), domain: 'POINT', groupID: mod(index(), 4).mul(-1)}).geometry)
    add('sort-edges-group-weight', 'Sort edges by group and tied weights', () => {
        const g = store(meshes(), 'EDGE', 'eorig', index())
        return n.SortElements({geometry: g, domain: 'EDGE', groupID: mod(index(), 3), sortWeight: mod(index(), 2)}).geometry
    })
    add('sort-faces-weight', 'Sort faces by descending face area: corners move with their faces', () => {
        const g = store(meshes(), 'FACE', 'forig', index())
        return n.SortElements({geometry: g, domain: 'FACE', sortWeight: n.FaceArea().area.mul(-1)}).geometry
    })
    add('sort-faces-noop', 'Sort faces by index: already sorted, the mesh is unchanged', () =>
        n.SortElements({geometry: meshes(), domain: 'FACE', sortWeight: index()}).geometry)
    add('sort-curves', 'Sort curves (points move with them), reversed, and points of a point cloud by weight', () => {
        const curves = n.JoinGeometry({geometry: [n.CurveCircle({resolution: 5}).curve, n.CurveLine().curve, n.ResampleCurve({curve: n.CurveLine({end: [0, 2, 1]}).curve, count: 4}).curve]}).geometry
        const c = store(store(curves, 'CURVE', 'corig', index()), 'POINT', 'porig', index())
        const sortedCurves = n.SortElements({geometry: c, domain: 'CURVE', sortWeight: index().mul(-1)}).geometry
        const pts = store(n.MeshToPoints({mesh: n.MeshGrid({verticesX: 4, verticesY: 4}).mesh}).points, 'POINT', 'orig', index())
        const sortedPoints = n.SortElements({geometry: pts, domain: 'POINT', sortWeight: random(7)}).geometry
        return n.JoinGeometry({geometry: [sortedCurves, sortedPoints]}).geometry
    })
    add('sort-instances', 'Sort top-level instances by group and weight; unsupported domain on instances does nothing', () => {
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 6, offset: [0.5, 0, 0]}).mesh,
            instance: n.GeometryToInstance({geometry: [n.MeshCube({size: [0.1, 0.1, 0.1]}).mesh, n.MeshCone().mesh]}).instances,
            pickInstance: true, instanceIndex: index()}).instances
        const g = store(inst, 'INSTANCE', 'iorig', index())
        const sorted = n.SortElements({geometry: g, domain: 'INSTANCE', groupID: mod(index(), 2), sortWeight: random(3)}).geometry
        return n.SortElements({geometry: sorted, domain: 'EDGE', sortWeight: random(5)}).geometry
    })
    return cases
}

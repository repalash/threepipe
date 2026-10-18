/**
 * Parity cases for Convex Hull (Bullet `btConvexHullComputer`): random clouds, coplanar faces (n-gons), flat and colinear
 * inputs, duplicate and quantization-coincident points, tiny inputs, mesh + point cloud + curve concatenation, the
 * mesh template attributes, and instances.
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, Extra, meshCase, mod, SHAPE_SCENE, shape, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index

export function meshConvexHullCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, extra, build))
    const join = (parts: Socket<'GEOMETRY'>[]) => n.JoinGeometry({geometry: parts}).geometry
    const hull = (g: Socket<'GEOMETRY'>) => n.ConvexHull({geometry: g}).convexHull
    const random = (count: number, seed: number, min: [number, number, number], max: [number, number, number]) => n.Points({count,
        position: n.RandomValue({dataType: 'FLOAT_VECTOR', min, max, seed}).value as Socket<'VECTOR'>}).geometry

    add('hull-random', 'Convex hull of 300 random points in a box', {}, () => hull(random(300, 3, [-1, -2, -0.5], [2, 1, 0.7])))
    add('hull-random-flat-box', 'Convex hull of random points in a very flat box (axis order / scaling)', {}, () => hull(random(120, 7, [-5, -0.01, -2], [5, 0.02, 3])))
    add('hull-cube-attributes', 'Convex hull of an attributed subdivided cube: coplanar n-gon faces, template attributes with default values', {}, () =>
        hull(attributed(n.MeshCube({size: [1, 2, 0.5], verticesX: 4, verticesY: 3, verticesZ: 2}).mesh)))
    add('hull-uv-sphere', 'Convex hull of a UV sphere (pole fans, many near-coplanar points)', {}, () => hull(n.MeshUVSphere({segments: 24, rings: 12, radius: 1.3}).mesh))
    add('hull-cylinder', 'Convex hull of a cylinder (coplanar cap rings become n-gons)', {}, () => hull(n.MeshCylinder({vertices: 17, sideSegments: 3, fillSegments: 2, depth: 2.5}).mesh))
    add('hull-flat-grid', 'Convex hull of a flat grid (all points coplanar: a two-sided polygon)', {}, () =>
        hull(n.TransformGeometry({geometry: n.MeshGrid({sizeX: 3, sizeY: 2, verticesX: 6, verticesY: 4}).mesh, rotation: [0.3, 0.2, 0.1]}).geometry))
    add('hull-colinear', 'Convex hull of colinear points (two vertices, one edge)', {}, () =>
        hull(n.MeshLine({count: 7, startLocation: [1, 0, 0], offset: [0.3, -0.2, 0.1]}).mesh))
    add('hull-tiny', 'Convex hull of one point, two points, three points, four coplanar points, and an empty point cloud', {}, () => {
        const pts = (positions: [number, number, number][]) => {
            const parts = positions.map(p => n.Points({count: 1, position: p}).geometry)
            return join(parts)
        }
        const instances = n.InstanceOnPoints({points: n.MeshLine({count: 5, offset: [10, 0, 0]}).mesh,
            instance: n.GeometryToInstance({geometry: [
                pts([[0, 0, 0]]),
                pts([[0, 0, 0], [1, 0.5, 0.2]]),
                pts([[0, 0, 0], [1, 0, 0], [0, 1, 0.5]]),
                pts([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]),
                n.Points({count: 0}).geometry,
            ]}).instances, pickInstance: true, instanceIndex: index()}).instances
        return n.RealizeInstances({geometry: hull(instances)}).geometry
    })
    add('hull-duplicates', 'Convex hull of a point cloud with exact duplicates and points that quantize to the same integer point', {}, () => {
        const corners = () => n.MeshToPoints({mesh: n.MeshCube({size: [4, 4, 4]}).mesh}).points
        // Index-derived offsets far below the quantization step (extent / 10216): same Point32, different floats.
        const jitter = n.Points({count: 24, position: n.CombineXYZ({
            x: mod(index(), 2).mul(4).sub(2).add(index().mul(0.00001)),
            y: mod(index().div(2).floor(), 2).mul(4).sub(2),
            z: mod(index().div(4).floor(), 2).mul(4).sub(2).sub(index().mul(0.000013)),
        }).vector}).geometry
        return hull(join([corners(), jitter, corners()]))
    })
    add('hull-components', 'Convex hull of a mesh, a point cloud and curves together (mesh template, evaluated curve points)', {}, () => {
        const curve = n.CurveCircle({resolution: 9, radius: 3}).curve
        const bez = n.TransformGeometry({geometry: n.BezierSegment({resolution: 5, start: [-1, 0, 2], end: [1, 0, 2.5], startHandle: [0, 3, 4], endHandle: [2, -3, 1]}).curve,
            translation: [0, 0, 0.5]}).geometry
        return hull(join([attributed(n.MeshCube().mesh), random(40, 11, [-2, -2, -3], [2, 2, -1]), curve, bez]))
    })
    add('hull-test-meshes', 'Convex hull of the shared test meshes (with loose edges and vertices)', SHAPE_SCENE, () => hull(join([testMeshes(), shape()])))
    add('hull-instances', 'Convex hull of instances: each instance reference hulled separately, instance transforms kept', {}, () => {
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 3, offset: [4, 0, 0]}).mesh, instance: random(30, 5, [-1, -1, -1], [1, 1, 1]),
            rotation: n.EulerToRotation({euler: n.CombineXYZ({x: index().mul(0.4), y: 0, z: 0.2}).vector}).rotation}).instances
        return n.RealizeInstances({geometry: hull(inst)}).geometry
    })
    return cases
}

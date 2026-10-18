/**
 * Parity cases for Index of Nearest (KD-tree per group, ties on a regular grid, single-element groups) and Blur
 * Attribute (every data type, mesh points / edges / faces, curve points with cyclic and single-point curves, zero
 * iterations, per-element weights).
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index

/** A jittered grid: random (seeded) per-point offsets so most nearest neighbours are unique. */
function jittered(): Socket<'GEOMETRY'> {
    const grid = n.MeshGrid({sizeX: 3, sizeY: 2, verticesX: 7, verticesY: 5}).mesh
    const offset = n.RandomValue({dataType: 'FLOAT_VECTOR', min: [-0.2, -0.2, -0.1], max: [0.2, 0.2, 0.1], seed: 4}).value as Socket<'VECTOR'>
    return n.SetPosition({geometry: grid, offset}).geometry
}

export function meshFieldOpCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, SHAPE_SCENE, build))

    add('index-of-nearest-jittered', 'Index of Nearest on a jittered grid (points) and on its faces (face centres)', () => {
        let g = jittered()
        const near = n.IndexOfNearest()
        g = store(g, 'POINT', 'nearest', near.index)
        g = store(g, 'POINT', 'has', near.hasNeighbor)
        const faces = n.IndexOfNearest()
        return store(g, 'FACE', 'nearest_face', faces.index)
    })
    add('index-of-nearest-ties', 'Index of Nearest on a regular grid: equal distances keep Blender\'s traversal winner', () => {
        const near = n.IndexOfNearest()
        return store(n.MeshGrid({sizeX: 2, sizeY: 2, verticesX: 6, verticesY: 6}).mesh, 'POINT', 'nearest', near.index)
    })
    add('index-of-nearest-groups', 'Index of Nearest within groups, including a one-element group (no neighbour)', () => {
        let g = jittered()
        // Groups 0..2 by index modulo 3, and index 34 alone in group 9.
        const group = n.Switch({inputType: 'INT', switch: index().eq(34), false: mod(index(), 3), true: 9}).output as Socket<'INT'>
        const near = n.IndexOfNearest({groupID: group})
        g = store(g, 'POINT', 'nearest', near.index)
        return store(g, 'POINT', 'has', near.hasNeighbor)
    })
    add('index-of-nearest-points', 'Index of Nearest on a point cloud and on instances', () => {
        const pts = n.MeshToPoints({mesh: jittered()}).points
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 5, offset: [0.3, 0.1, 0]}).mesh, instance: n.MeshCube({size: [0.1, 0.1, 0.1]}).mesh}).instances
        const p = store(pts, 'POINT', 'nearest', n.IndexOfNearest().index)
        const i = store(inst, 'INSTANCE', 'nearest', n.IndexOfNearest().index)
        return n.JoinGeometry({geometry: [p, i]}).geometry
    })

    for (const [type, value] of [
        ['FLOAT', () => index().mul(1.5).add(0.25)],
        ['INT', () => mod(index(), 7).mul(3)],
        ['FLOAT_VECTOR', () => n.CombineXYZ({x: index(), y: index().mul(-0.5), z: mod(index(), 3)}).vector],
        ['FLOAT_COLOR', () => n.CombineColor({red: index().mul(0.1), green: mod(index(), 3), blue: 0.5, alpha: index().mul(0.05)}).color],
    ] as const) {
        add(`blur-mesh-${type.toLowerCase()}`, `Blur Attribute (${type}) on points, edges and faces, 3 iterations, weight field`, () => {
            let g: Socket<'GEOMETRY'> = attributed(testMeshes())
            const weight = mod(index(), 4).mul(0.25)
            for (const domain of ['POINT', 'EDGE', 'FACE'] as const) {
                const blurred = n.BlurAttribute({dataType: type, value: value(), iterations: 3, weight}).value
                g = n.StoreNamedAttribute({geometry: g, domain, dataType: type, name: `blur_${domain.toLowerCase()}`, value: blurred}).geometry
            }
            return g
        })
    }
    add('blur-mesh-corner-iterations', 'Blur Attribute on corners (values passed through), 0 and 1 iterations', () => {
        let g = testMeshes()
        g = store(g, 'CORNER', 'b_corner', n.BlurAttribute({value: index().mul(0.5), iterations: 4}).value as Socket<'FLOAT'>)
        g = store(g, 'POINT', 'b0', n.BlurAttribute({value: index().mul(0.5), iterations: 0}).value as Socket<'FLOAT'>)
        return store(g, 'POINT', 'b1', n.BlurAttribute({value: index().mul(0.5), iterations: 1}).value as Socket<'FLOAT'>)
    })
    add('blur-curves', 'Blur Attribute on curve points: open, cyclic and single-point curves; curve domain untouched', () => {
        const circle = n.CurveCircle({resolution: 7}).curve
        const line = n.ResampleCurve({curve: n.CurveLine({start: [0, -3, 0], end: [1, -2, 2]}).curve, count: 5}).curve
        const single = n.ResampleCurve({curve: n.CurveLine().curve, count: 1}).curve
        let g = n.JoinGeometry({geometry: [circle, line, single]}).geometry
        g = n.SetSplineCyclic({geometry: g, cyclic: index().eq(0)}).geometry
        const weight = mod(index(), 3).mul(0.4)
        g = store(g, 'POINT', 'bp', n.BlurAttribute({value: index().mul(index()).mul(0.1), iterations: 2, weight}).value as Socket<'FLOAT'>)
        g = store(g, 'POINT', 'bv', n.BlurAttribute({dataType: 'FLOAT_VECTOR', value: n.Position().position, iterations: 5}).value as Socket<'VECTOR'>)
        return store(g, 'CURVE', 'bc', n.BlurAttribute({value: index().mul(2), iterations: 2}).value as Socket<'FLOAT'>)
    })
    return cases
}

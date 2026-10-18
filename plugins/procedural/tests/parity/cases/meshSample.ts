/**
 * Parity cases for Sample Index, Sample Nearest and Sample Nearest Surface. Query points are grids whose spacing
 * puts many of them at exactly the same distance from several source elements (grid midpoints over a unit grid),
 * so ties resolve through Blender's BVH layout and traversal order.
 */

import {AnySocket, n, Socket} from '../../../src/dsl/builder'
import {attributed, Extra, meshCase, mod, SHAPE_SCENE, shape, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index
const idx = (k: number) => index().mul(k)

/** One field of every socket type, varying per element (read on the source geometry). */
function everyType(): Record<keyof typeof DATA_TYPE, AnySocket> {
    const i = index()
    return {
        f: i.mul(0.5).add(0.25),
        i: mod(i, 5),
        b: mod(i, 3).eq(1),
        v: n.CombineXYZ({x: i, y: i.mul(-0.25), z: mod(i, 4)}).vector,
        c: n.CombineColor({red: i.mul(0.1), green: 0.5, blue: mod(i, 2), alpha: 1}).color,
        q: n.EulerToRotation({euler: n.CombineXYZ({x: i.mul(0.1), y: 0.2, z: i.mul(-0.05)}).vector}).rotation,
        m: n.CombineTransform({translation: n.CombineXYZ({x: i, y: 1, z: 2}).vector, scale: n.CombineXYZ({x: 1, y: i.add(1), z: 1}).vector}).transform,
    }
}

const DATA_TYPE = {f: 'FLOAT', i: 'INT', b: 'BOOLEAN', v: 'FLOAT_VECTOR', c: 'FLOAT_COLOR', q: 'QUATERNION', m: 'FLOAT4X4'} as const

/** `[key, data type, value]` of every type. */
const typed = () => Object.entries(everyType()).map(([k, value]) => [k, DATA_TYPE[k as keyof typeof DATA_TYPE], value] as const)

/** Query points: a 13 x 9 grid with spacing 0.5 over [-1, 5] x [-1, 3], at z = 0.25. */
function queries(): Socket<'GEOMETRY'> {
    return n.MeshToPoints({mesh: n.TransformGeometry({
        geometry: n.MeshGrid({sizeX: 6, sizeY: 4, verticesX: 13, verticesY: 9}).mesh, translation: [2, 1, 0.25],
    }).geometry}).points
}

export function meshSampleCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, extra, build))

    // region Sample Index
    for (const clamp of [false, true] as const) {
        add(`sample-index-every-type${clamp ? '-clamp' : ''}`, `Sample Index of every type from the shape's points, field index with out-of-range values${clamp ? ', clamped' : ''}`, SHAPE_SCENE, () => {
            let g: Socket<'GEOMETRY'> = queries()
            for (const [k, dataType, value] of typed()) {
                const s = n.SampleIndex({geometry: shape(), dataType, value, index: index().sub(5), clamp}).value
                g = store(g, 'POINT', `s_${k}`, s)
            }
            return g
        })
    }
    for (const domain of ['EDGE', 'FACE', 'CORNER'] as const) {
        add(`sample-index-${domain.toLowerCase()}`, `Sample Index on ${domain} of the joined test meshes`, SHAPE_SCENE, () => {
            const src = attributed(testMeshes())
            let g: Socket<'GEOMETRY'> = queries()
            const pre = domain[0].toLowerCase()
            g = store(g, 'POINT', 'sf', n.SampleIndex({geometry: src, domain, value: n.NamedAttribute({name: `${pre}f`}).attribute as Socket<'FLOAT'>, index: idx(3)}).value)
            g = store(g, 'POINT', 'sv', n.SampleIndex({geometry: src, domain, dataType: 'FLOAT_VECTOR', value: n.Position().position, index: idx(2).add(1)}).value)
            return g
        })
    }
    add('sample-index-single', 'Sample Index with single indices: in range, negative, past the end (quaternion default identity), clamped', SHAPE_SCENE, () => {
        let pt: Socket<'GEOMETRY'> = n.Points({count: 1}).geometry
        for (const [name, i, clamp] of [['in', 4, false], ['neg', -1, false], ['past', 99, false], ['clamped', 99, true], ['clampedNeg', -3, true]] as [string, number, boolean][]) {
            for (const [k, dataType, value] of typed()) {
                pt = store(pt, 'POINT', `${name}_${k}`, n.SampleIndex({geometry: shape(), dataType, value, index: i, clamp}).value)
            }
        }
        return pt
    })
    add('sample-index-instances-points', 'Sample Index on instances and on a point cloud next to an empty mesh (component order)', {}, () => {
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 4}).mesh, instance: n.MeshCube().mesh, scale: index().add(1)}).instances
        const pts = n.Points({count: 5, position: n.CombineXYZ({x: idx(-1)}).vector}).geometry
        const emptyMesh = n.DeleteGeometry({geometry: n.MeshCube().mesh, selection: true}).geometry
        let g: Socket<'GEOMETRY'> = queries()
        g = store(g, 'POINT', 'inst', n.SampleIndex({geometry: inst, domain: 'INSTANCE', dataType: 'FLOAT_VECTOR', value: n.Position().position, index: mod(index(), 6)}).value)
        g = store(g, 'POINT', 'pts', n.SampleIndex({geometry: n.JoinGeometry({geometry: [emptyMesh, pts]}).geometry, dataType: 'FLOAT_VECTOR', value: n.Position().position, index: mod(index(), 7)}).value)
        g = store(g, 'POINT', 'none', n.SampleIndex({geometry: inst, domain: 'FACE', value: idx(1), index: index()}).value)
        return g
    })
    // endregion

    // region Sample Nearest
    for (const domain of ['POINT', 'EDGE', 'FACE', 'CORNER'] as const) {
        add(`sample-nearest-${domain.toLowerCase()}`, `Sample Nearest ${domain} on the joined test meshes, many equidistant queries`, SHAPE_SCENE, () =>
            store(queries(), 'POINT', 'nearest', n.SampleNearest({geometry: testMeshes(), domain}).index))
        add(`sample-nearest-grid-${domain.toLowerCase()}`, `Sample Nearest ${domain} on a unit grid from half-unit grid points (ties)`, {}, () =>
            store(queries(), 'POINT', 'nearest', n.SampleNearest({geometry: n.MeshGrid({sizeX: 6, sizeY: 4, verticesX: 7, verticesY: 5}).mesh, domain}).index))
    }
    add('sample-nearest-pointcloud', 'Sample Nearest on a point cloud (mesh without points ignored), and a single position', {}, () => {
        const pts = n.Points({count: 12, position: n.CombineXYZ({x: mod(index(), 4), y: n.Math({operation: 'FLOOR', value: idx(0.25)}).value, z: 0}).vector}).geometry
        const src = n.JoinGeometry({geometry: [n.DeleteGeometry({geometry: n.MeshCube().mesh, selection: true}).geometry, pts]}).geometry
        let g = store(queries(), 'POINT', 'nearest', n.SampleNearest({geometry: src}).index)
        g = store(g, 'POINT', 'single', n.SampleNearest({geometry: src, samplePosition: [1.5, 0.5, 0]}).index)
        return g
    })
    // endregion

    // region Sample Nearest Surface
    add('sample-nearest-surface-every-type', 'Sample Nearest Surface of every type (corner-domain mixing) from the joined test meshes', SHAPE_SCENE, () => {
        let g: Socket<'GEOMETRY'> = queries()
        const src = testMeshes()
        for (const [k, dataType, value] of typed()) {
            const s = n.SampleNearestSurface({mesh: src, dataType, value})
            g = store(g, 'POINT', `s_${k}`, s.value)
        }
        g = store(g, 'POINT', 'pos', n.SampleNearestSurface({mesh: src, dataType: 'FLOAT_VECTOR', value: n.Position().position}).value)
        return g
    })
    add('sample-nearest-surface-groups', 'Sample Nearest Surface with face groups and sample group ids (a missing group is invalid)', SHAPE_SCENE, () => {
        const src = attributed(testMeshes())
        const s = n.SampleNearestSurface({mesh: src, dataType: 'FLOAT_VECTOR', value: n.Position().position, groupID: mod(index(), 2), sampleGroupID: mod(index(), 3)})
        let g = store(queries(), 'POINT', 'pos', s.value)
        g = store(g, 'POINT', 'valid', s.isValid)
        g = store(g, 'POINT', 'pf', n.SampleNearestSurface({mesh: src, value: n.NamedAttribute({name: 'pf'}).attribute as Socket<'FLOAT'>, groupID: mod(index(), 2), sampleGroupID: mod(index(), 2)}).value)
        g = store(g, 'POINT', 'ff', n.SampleNearestSurface({mesh: src, value: n.NamedAttribute({name: 'ff'}).attribute as Socket<'FLOAT'>}).value)
        g = store(g, 'POINT', 'cf', n.SampleNearestSurface({mesh: src, value: n.NamedAttribute({name: 'cf'}).attribute as Socket<'FLOAT'>}).value)
        g = store(g, 'POINT', 'ef', n.SampleNearestSurface({mesh: src, value: n.NamedAttribute({name: 'ef'}).attribute as Socket<'FLOAT'>}).value)
        return g
    })
    add('sample-nearest-surface-grid-ties', 'Sample Nearest Surface on a unit grid from half-unit points (equidistant triangles)', {}, () => {
        const src = n.MeshGrid({sizeX: 6, sizeY: 4, verticesX: 7, verticesY: 5}).mesh
        let g = store(queries(), 'POINT', 'pos', n.SampleNearestSurface({mesh: src, dataType: 'FLOAT_VECTOR', value: n.Position().position}).value)
        g = store(g, 'POINT', 'idx', n.SampleNearestSurface({mesh: src, dataType: 'INT', value: index()}).value)
        return g
    })
    add('sample-nearest-surface-single', 'Sample Nearest Surface with a single position and group id', SHAPE_SCENE, () => {
        let pt: Socket<'GEOMETRY'> = n.Points({count: 1}).geometry
        const src = testMeshes()
        for (const [name, pos, gid] of [['a', [0.3, 0.6, 0.4], 0], ['b', [3.6, 0.7, 0.2], 1], ['c', [9, 9, 9], 5]] as [string, [number, number, number], number][]) {
            const s = n.SampleNearestSurface({mesh: src, dataType: 'FLOAT_VECTOR', value: n.Position().position, groupID: mod(index(), 2), samplePosition: pos, sampleGroupID: gid})
            pt = store(pt, 'POINT', `${name}_pos`, s.value)
            pt = store(pt, 'POINT', `${name}_valid`, s.isValid)
        }
        return pt
    })
    // endregion
    return cases
}

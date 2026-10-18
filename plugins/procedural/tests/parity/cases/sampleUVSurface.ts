/**
 * Parity cases for Sample UV Surface (`ReverseUVSampler` + `BaryWeightSampleFn`): every data type, samples inside, on
 * edges / vertices, outside the UV islands, overlapping UVs (Multiple), single values, empty / face-less meshes.
 */

import {n, Socket} from '../../../src/dsl/builder'
import type {SampleUVSurfaceArgs} from '../../../src/dsl/nodes.generated'
import {Extra, meshCase, mod, store} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index
const position = () => n.Position().position

export function sampleUVSurfaceCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, extra, build))
    /** Points whose positions are the sample UVs: a lattice over [-0.1, 1.1]^2 (includes exact cell / vertex coordinates) plus random ones. */
    const samplePoints = () => n.JoinGeometry({geometry: [
        n.Points({count: 169, position: n.CombineXYZ({x: mod(index(), 13).div(10).sub(0.1), y: index().div(13).floor().div(10).sub(0.1), z: 0}).vector}).geometry,
        n.Points({count: 150, position: n.RandomValue({dataType: 'FLOAT_VECTOR', min: [-0.05, -0.05, 0], max: [1.05, 1.05, 0], seed: 4}).value as Socket<'VECTOR'>}).geometry,
    ]}).geometry
    const sampleOn = (mesh: Socket<'GEOMETRY'>, uv: Socket<'VECTOR'>, dataType: 'FLOAT' | 'INT' | 'BOOLEAN' | 'FLOAT_VECTOR' | 'FLOAT_COLOR' | 'QUATERNION' | 'FLOAT4X4', value: SampleUVSurfaceArgs['value']) => {
        const s = n.SampleUVSurface({dataType, mesh, value, sourceUVMap: uv, sampleUV: position()})
        return store(store(samplePoints(), 'POINT', 'value', s.value), 'POINT', 'valid', s.isValid)
    }
    add('uv-grid-position', 'Sample UV Surface of a grid: position at lattice and random UVs (edges, vertices, outside)', {}, () => {
        const grid = n.MeshGrid({sizeX: 2, sizeY: 1, verticesX: 11, verticesY: 6})
        return sampleOn(grid.mesh, grid.uVMap, 'FLOAT_VECTOR', position())
    })
    add('uv-cube-types', 'Sample UV Surface of a cube (UV islands with gaps) for float, int, bool, color', {}, () => {
        const cube = () => n.MeshCube({size: [1, 2, 3], verticesX: 3, verticesY: 2, verticesZ: 2})
        const types = [
            ['FLOAT', index().mul(0.5)], ['INT', index().mul(3)], ['BOOLEAN', mod(index(), 3).eq(1)],
            ['FLOAT_COLOR', n.CombineColor({red: index().mul(0.1), green: 0.5, blue: index().mul(-0.05), alpha: 1}).color],
        ] as const
        return n.JoinGeometry({geometry: types.map(([t, v], i) => {
            const c = cube()
            const s = n.SampleUVSurface({dataType: t, mesh: c.mesh, value: v, sourceUVMap: c.uVMap, sampleUV: position()})
            return store(store(samplePoints(), 'POINT', `value${i}`, s.value), 'POINT', `valid${i}`, s.isValid)
        })}).geometry
    })
    add('uv-sphere-rotation-matrix', 'Sample UV Surface of a UV sphere (pole triangles, seam) for rotation and matrix values', {}, () => {
        const sphere = () => n.MeshUVSphere({segments: 12, rings: 7})
        const rot = n.EulerToRotation({euler: n.CombineXYZ({x: index().mul(0.1), y: 0.3, z: index().mul(-0.2)}).vector}).rotation
        const a = sphere(), b = sphere()
        const s1 = n.SampleUVSurface({dataType: 'QUATERNION', mesh: a.mesh, value: rot, sourceUVMap: a.uVMap, sampleUV: position()})
        const mat = n.CombineTransform({translation: position(), scale: [1, 2, 3]}).transform
        const s2 = n.SampleUVSurface({dataType: 'FLOAT4X4', mesh: b.mesh, value: mat, sourceUVMap: b.uVMap, sampleUV: position()})
        return store(store(store(samplePoints(), 'POINT', 'rot', s1.value), 'POINT', 'mat', s2.value), 'POINT', 'valid', s1.isValid)
    })
    add('uv-overlap', 'Sample UV Surface with overlapping UVs (position xy as UV of a folded grid): Multiple results are invalid', {}, () => {
        const grid = n.SetPosition({geometry: n.MeshGrid({sizeX: 1, sizeY: 1, verticesX: 5, verticesY: 5}).mesh,
            position: n.CombineXYZ({x: n.Math({operation: 'ABSOLUTE', value: n.SeparateXYZ({vector: position()}).x}).value, y: n.SeparateXYZ({vector: position()}).y, z: 0}).vector}).geometry
        const uv = n.VectorMath({operation: 'ADD', vector: position(), vector1: [0.5, 0.5, 0]}).vector
        return sampleOn(grid, uv, 'FLOAT', index())
    })
    add('uv-single-value', 'Sample UV Surface with a single sample UV (not a field) and a field value', {}, () => {
        const grid = n.MeshGrid({sizeX: 1, sizeY: 1, verticesX: 3, verticesY: 3})
        const s = n.SampleUVSurface({dataType: 'FLOAT', mesh: grid.mesh, value: index(), sourceUVMap: grid.uVMap, sampleUV: [0.3, 0.6, 0]})
        return store(store(n.Points({count: 1}).geometry, 'POINT', 'value', s.value), 'POINT', 'valid', s.isValid)
    })
    add('uv-no-faces', 'Sample UV Surface of a mesh without faces (error, default outputs) and of an empty mesh', {}, () => {
        const line = n.MeshLine({count: 3}).mesh
        const s = n.SampleUVSurface({dataType: 'FLOAT', mesh: line, value: 1, sourceUVMap: position(), sampleUV: position()})
        const empty = n.DeleteGeometry({geometry: n.MeshGrid().mesh, selection: true}).geometry
        const t = n.SampleUVSurface({dataType: 'FLOAT', mesh: empty, value: 1, sourceUVMap: position(), sampleUV: position()})
        return store(store(store(store(samplePoints(), 'POINT', 'a', s.value), 'POINT', 'av', s.isValid), 'POINT', 'b', t.value), 'POINT', 'bv', t.isValid)
    })
    return cases
}

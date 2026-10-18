/** Parity cases for Distribute Points on Faces, written with the DSL. */

import {geometryNodes, n, Socket} from '../../../src/dsl/builder'
import type {NodeGroupLibrary} from '../../../src/runtime/types'
import {ParityCase} from './types'

function single(id: string, description: string, build: () => Socket<'GEOMETRY'>): ParityCase {
    const group = geometryNodes(id, g => {
        g.output.geometry('Geometry', build())
    })
    return {id, description, library: group.toJSON() as NodeGroupLibrary, group: id, input: 'empty'}
}

/** A wavy 6x5 grid with an attribute on points, corners and faces, flat or smooth shaded. */
function surface(smooth: boolean): Socket<'GEOMETRY'> {
    let g: Socket<'GEOMETRY'> = n.MeshGrid({sizeX: 3, sizeY: 2.5, verticesX: 6, verticesY: 5}).mesh
    g = n.SetPosition({geometry: g, offset: n.CombineXYZ({z: n.NoiseTexture({scale: 1.3, detail: 1}).fac.sub(0.5)}).vector}).geometry
    for (const [domain, name] of [['POINT', 'pa'], ['CORNER', 'ca'], ['FACE', 'fa']] as const) {
        g = n.StoreNamedAttribute({geometry: g, domain, name, value: n.Index().index.mul(0.75).add(1)}).geometry
    }
    g = n.StoreNamedAttribute({geometry: g, domain: 'FACE', dataType: 'INT', name: 'fi', value: n.Index().index}).geometry
    g = n.StoreNamedAttribute({geometry: g, domain: 'POINT', dataType: 'FLOAT_COLOR', name: 'col', value: n.CombineColor({red: n.Index().index.mul(0.1)}).color}).geometry
    return n.SetShadeSmooth({geometry: g, shadeSmooth: smooth}).geometry
}

/** Points with their normal and rotation stored, so both outputs are compared. */
function withOutputs(d: ReturnType<typeof n.DistributePointsOnFaces>): Socket<'GEOMETRY'> {
    let g: Socket<'GEOMETRY'> = n.StoreNamedAttribute({geometry: d.points, dataType: 'FLOAT_VECTOR', name: 'nrm', value: d.normal}).geometry
    g = n.StoreNamedAttribute({geometry: g, dataType: 'QUATERNION', name: 'rot', value: d.rotation}).geometry
    return g
}

export function distributeCases(): ParityCase[] {
    return [
        single('distribute-random', 'Random, constant density, flat faces', () =>
            withOutputs(n.DistributePointsOnFaces({mesh: surface(false), density: 6, seed: 3}))),
        single('distribute-random-smooth', 'Random, smooth shading (vertex normals)', () =>
            withOutputs(n.DistributePointsOnFaces({mesh: surface(true), density: 6, seed: -2}))),
        single('distribute-random-field', 'Random, density field and selection', () =>
            withOutputs(n.DistributePointsOnFaces({
                mesh: surface(false), density: n.Position().position.x.add(1.5).mul(4),
                selection: n.Position().position.y.lt(0.6), seed: 11,
            }))),
        single('distribute-random-legacy-normal', 'Random, legacy normals', () =>
            withOutputs(n.DistributePointsOnFaces({mesh: surface(true), density: 5, useLegacyNormal: true}))),
        single('distribute-poisson', 'Poisson disk, distance min and density factor field', () =>
            withOutputs(n.DistributePointsOnFaces({
                mesh: surface(false), distributeMethod: 'POISSON', distanceMin: 0.18, densityMax: 40,
                densityFactor: n.Position().position.x.add(1.5).mul(0.3), seed: 5,
            }))),
        single('distribute-poisson-selection', 'Poisson disk with a selection, no distance', () =>
            n.DistributePointsOnFaces({mesh: surface(true), distributeMethod: 'POISSON', densityMax: 12, selection: n.Index().index.gt(40)}).points),
        {
            // Blender's operator cube carries `.select_vert/.select_edge/.select_poly`; they propagate to the points,
            // the instances and the realized mesh as ordinary attributes (not built-ins in Blender's mesh table).
            ...(() => {
                const group = geometryNodes('distribute-select-propagation', g => {
                    const mesh = g.input.geometry('Geometry')
                    const d = n.DistributePointsOnFaces({mesh, density: 2, seed: 4})
                    const inst = n.InstanceOnPoints({points: d.points, instance: n.MeshCube({size: [0.2, 0.2, 0.2]}).mesh, rotation: d.rotation})
                    g.output.geometry('Geometry', n.JoinGeometry({geometry: [mesh, n.RealizeInstances({geometry: inst.instances}).geometry]}).geometry)
                })
                return {id: 'distribute-select-propagation', description: 'Selection layers of the input propagate through distribute, instance, realize',
                    library: group.toJSON() as NodeGroupLibrary, group: group.name, input: 'cube' as const}
            })(),
        },
        single('distribute-cube', 'Random on a cube (quads split into triangles)', () =>
            withOutputs(n.DistributePointsOnFaces({mesh: n.MeshCube({size: [2, 1, 0.5]}).mesh, density: 9, seed: 1}))),
    ]
}

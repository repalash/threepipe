/**
 * Parity cases for the instance nodes (Instance on Points, Translate/Scale Instances, Realize Instances),
 * written with the DSL.
 */

import {geometryNodes, n, Socket} from '../../../src/dsl/builder'
import type {NodeGroupLibrary} from '../../../src/runtime/types'
import {ParityCase} from './types'

function single(id: string, description: string, build: () => Socket<'GEOMETRY'>): ParityCase {
    const group = geometryNodes(id, g => {
        g.output.geometry('Geometry', build())
    })
    return {id, description, library: group.toJSON() as NodeGroupLibrary, group: id, input: 'empty'}
}

export function instanceCases(): ParityCase[] {
    return [
        single('iop-pick-mesh-only', 'Pick Instance on, Instance is a mesh: empty references', () =>
            n.InstanceOnPoints({points: n.MeshLine({count: 2}).mesh, instance: n.MeshCube().mesh, pickInstance: true}).instances),
        single('iop-basic', 'Cube on a line, rotation and scale fields', () =>
            n.InstanceOnPoints({
                points: n.MeshLine({count: 5, offset: [0.3, -0.2, 0.7]}).mesh, instance: n.MeshCube({size: [0.2, 0.3, 0.4]}).mesh,
                rotation: [0.3, -0.4, 1.1], scale: n.Index().index.add(0.5),
            }).instances),
        single('iop-selection-realize', 'Every other point, then realized', () =>
            n.RealizeInstances({geometry: n.InstanceOnPoints({
                points: n.MeshGrid({verticesX: 3, verticesY: 4}).mesh, instance: n.MeshCube({verticesX: 3}).mesh,
                selection: n.Math({operation: 'MODULO', value: n.Index().index, value1: 2}).value.eq(0), scale: 0.25,
            }).instances}).geometry),
        single('translate-scale-instances', 'Translate (local and global), then scale around a center', () =>
            n.ScaleInstances({
                instances: n.TranslateInstances({
                    instances: n.InstanceOnPoints({points: n.MeshLine({count: 4}).mesh, instance: n.MeshCube().mesh, rotation: [0.5, 0.2, 0.9], scale: [1, 2, 0.5]}).instances,
                    translation: [0.5, 1, -0.25], localSpace: n.Index().index.lt(2),
                }).instances,
                scale: [1.5, 0.5, 2], center: [0.1, 0.2, 0.3], localSpace: n.Index().index.gt(1),
            }).instances),
    ]
}

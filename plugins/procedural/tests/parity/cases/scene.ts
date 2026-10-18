/**
 * Parity cases for Object Info and Collection Info: objects and collections are created by `run_cases.py`
 * (Blender's own cube/plane operators), and Blender writes the scene back with its result, so these cases
 * evaluate against the exact objects Blender saw.
 */

import {geometryNodes, n, Socket} from '../../../src/dsl/builder'
import type {NodeGroupLibrary} from '../../../src/runtime/types'
import {CaseObject, ParityCase} from './types'

type Extra = Omit<ParityCase, 'id' | 'description' | 'library' | 'group' | 'input'>

function single(id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>): ParityCase {
    const group = geometryNodes(id, g => {
        g.output.geometry('Geometry', build())
    })
    return {id, description, library: group.toJSON() as NodeGroupLibrary, group: id, input: 'empty', ...extra}
}

const rock: CaseObject = {name: 'Rock', mesh: 'cube', location: [1, 2, 3], rotation: [0.3, -0.2, 0.9], scale: [1, 2, 0.5]}
const self = {location: [-0.5, 0.25, 1] as [number, number, number], rotation: [0.1, 0.4, -0.3] as [number, number, number], scale: [2, 1, 1.5] as [number, number, number]}

/** Object Info's transform outputs stored on one point, joined with its geometry. */
function objectInfo(space: 'ORIGINAL' | 'RELATIVE', asInstance: boolean): Socket<'GEOMETRY'> {
    const oi = n.ObjectInfo({object: {_ref: 'OBJECT', name: 'Rock'}, transformSpace: space, asInstance})
    let point: Socket<'GEOMETRY'> = n.Points({count: 1}).geometry
    point = n.StoreNamedAttribute({geometry: point, dataType: 'FLOAT_VECTOR', name: 'loc', value: oi.location}).geometry
    point = n.StoreNamedAttribute({geometry: point, dataType: 'QUATERNION', name: 'rot', value: oi.rotation}).geometry
    point = n.StoreNamedAttribute({geometry: point, dataType: 'FLOAT_VECTOR', name: 'scl', value: oi.scale}).geometry
    point = n.StoreNamedAttribute({geometry: point, dataType: 'FLOAT4X4', name: 'mat', value: oi.transform}).geometry
    return n.JoinGeometry({geometry: [oi.geometry, point]}).geometry
}

const props: ParityCase['scene'] = [
    {collection: 'Props', instanceOffset: [0.5, -1, 0.25], objects: [
        {name: 'Crate.10', mesh: 'cube', location: [2, 0, 0], rotation: [0, 0, 0.5], scale: [0.5, 0.5, 0.5]},
        {name: 'crate.2', mesh: 'plane', location: [-1, 1, 0.5], rotation: [0.7, 0, 0]},
    ]},
    {collection: 'Small', parent: 'Props', instanceOffset: [0, 0, 1], objects: [{name: 'Pebble', mesh: 'cube', location: [0, 3, 0], scale: [0.2, 0.2, 0.2]}]},
]

export function sceneCases(): ParityCase[] {
    const cases: ParityCase[] = []
    for (const space of ['ORIGINAL', 'RELATIVE'] as const) {
        for (const asInstance of [false, true]) {
            cases.push(single(`object-info-${space.toLowerCase()}${asInstance ? '-instance' : ''}`,
                `Object Info ${space}${asInstance ? ' as instance' : ''}`, {objects: [rock], ...self}, () => objectInfo(space, asInstance)))
        }
        for (const separate of [false, true]) {
            for (const reset of separate ? [false, true] : [false]) {
                const id = `collection-info-${space.toLowerCase()}${separate ? '-separate' : ''}${reset ? '-reset' : ''}`
                cases.push(single(id, `Collection Info ${space}${separate ? ', separate children' : ''}${reset ? ', reset' : ''}`,
                    {scene: props, ...self}, () =>
                        n.CollectionInfo({collection: {_ref: 'COLLECTION', name: 'Props'}, transformSpace: space, separateChildren: separate, resetChildren: reset}).instances))
            }
        }
        cases.push(single(`collection-info-${space.toLowerCase()}-realized`, `Collection Info ${space}, separate children, realized`, {scene: props, ...self}, () =>
            n.RealizeInstances({geometry: n.CollectionInfo({collection: {_ref: 'COLLECTION', name: 'Props'}, transformSpace: space, separateChildren: true}).instances}).geometry))
    }
    return cases
}

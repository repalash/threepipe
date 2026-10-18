import {describe, expect, it} from 'vitest'
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {importBlenderDump, nodeTypesOf, DumpV1} from './importBlenderDump'
import {isInterfaceSocket} from '../runtime/types'

/**
 * `flower_scattering.json`: the `extract_geo_nodes.py` (v1) dump of `flower_scattering.blend` (Blender 5.0.1, March 2026,
 * `proc` branch). It is derived from a third-party asset whose licence is undecided, so it lives with the local bundles
 * (`<worktree>/tmp/bundles/dumps-v1/`, not in git) and the test skips without it.
 */
const V1_DUMP = join(__dirname, '../../../../tmp/bundles/dumps-v1/flower_scattering.json')

describe.skipIf(!existsSync(V1_DUMP))('importBlenderDump (v1, extract_geo_nodes.py)', () => {
    const dump = existsSync(V1_DUMP) ? JSON.parse(readFileSync(V1_DUMP, 'utf8')) as DumpV1 : undefined as never
    const imported = dump ? importBlenderDump(dump) : undefined as never

    it('flattens nested group trees into a library, deduplicated by name', () => {
        expect(Object.keys(imported.library).sort()).toEqual(['Flower Field System', 'Flower System', 'Grass Scattering', 'Grass System', 'Random Orientation'])
        const top = imported.library['Flower Field System']
        expect(top.nodes.filter(n => n.type === 'GeometryNodeGroup').map(n => n.group).sort()).toEqual(['Flower System', 'Grass System'])
    })

    it('keeps the interface with identifiers, types and defaults', () => {
        const inputs = imported.library['Flower Field System'].interface.filter(isInterfaceSocket).filter(s => s.inOut === 'INPUT')
        expect(inputs[0]).toMatchObject({name: 'Geometry', identifier: 'Input_1', socketType: 'NodeSocketGeometry'})
        expect(inputs.find(s => s.identifier === 'Input_7')).toMatchObject({name: 'Grass Random Tilt', default: 0.20000000298023224})
    })

    it('reads modifier inputs, ID references and attribute-driven inputs', () => {
        const m = imported.modifiers[0]
        expect(m).toMatchObject({object: 'EN-ground_plane_NEW', group: 'Flower Field System'})
        expect(m.inputs.Input_9.value).toEqual({_ref: 'COLLECTION', name: 'GRP-bluebell'})
        expect(m.inputs.Input_18).toMatchObject({type: 'ATTRIBUTE', attribute_name: 'UVMap'})
    })

    it('lists the node types the asset needs', () => {
        const types = nodeTypesOf(imported.library)
        expect(types.get('GeometryNodeDistributePointsOnFaces')).toBe(2)
        expect(types.get('GeometryNodeInstanceOnPoints')).toBe(3)
    })
})

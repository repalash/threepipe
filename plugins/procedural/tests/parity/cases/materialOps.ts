/**
 * Parity cases for Material Selection (faces read on every domain, curves, a material in no slot, the empty slot) and
 * Replace Material (including instanced meshes).
 */

import {n, Socket} from '../../../src/dsl/builder'
import {Domain, meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index
const mat = (name: string) => ({_ref: 'MATERIAL' as const, name})
const MATERIALS = ['Red', 'Green', 'Blue']

function painted(): Socket<'GEOMETRY'> {
    const red = n.SetMaterial({geometry: testMeshes(), material: mat('Red'), selection: mod(index(), 3).eq(0)}).geometry
    return n.SetMaterial({geometry: red, material: mat('Green'), selection: mod(index(), 3).eq(1)}).geometry
}

export function materialOpCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, {...SHAPE_SCENE, materials: MATERIALS}, build))

    add('material-selection', 'Material Selection of Red, Green, Blue (in no slot) and none, read on every domain', () => {
        let g = painted()
        for (const [k, m] of [['red', mat('Red')], ['green', mat('Green')], ['blue', mat('Blue')], ['none', null]] as const) {
            const s = n.MaterialSelection({material: m as never}).selection
            for (const d of ['POINT', 'EDGE', 'FACE', 'CORNER'] as const) g = store(g, d as Domain, `${k}_${d.toLowerCase()}`, s)
        }
        return g
    })
    add('material-selection-curves', 'Material Selection on curves (material index per curve)', () => {
        const curves = n.JoinGeometry({geometry: [n.CurveCircle({resolution: 4}).curve, n.CurveLine().curve, n.CurveCircle({resolution: 3}).curve]}).geometry
        const red = n.SetMaterial({geometry: curves, material: mat('Red')}).geometry
        const idx = n.SetMaterialIndex({geometry: red, materialIndex: mod(index(), 2)}).geometry
        const g = n.StoreNamedAttribute({geometry: idx, domain: 'CURVE', dataType: 'BOOLEAN', name: 'red', value: n.MaterialSelection({material: mat('Red')}).selection}).geometry
        return n.StoreNamedAttribute({geometry: g, domain: 'POINT', dataType: 'BOOLEAN', name: 'red_p', value: n.MaterialSelection({material: mat('Red')}).selection}).geometry
    })
    add('replace-material', 'Replace Material Red -> Blue and the empty slot -> Green, also inside instances', () => {
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 2}).mesh, instance: painted()}).instances
        const all = n.JoinGeometry({geometry: [painted(), inst]}).geometry
        const a = n.ReplaceMaterial({geometry: all, old: mat('Red'), new: mat('Blue')}).geometry
        return n.RealizeInstances({geometry: n.ReplaceMaterial({geometry: a, new: mat('Green')}).geometry}).geometry
    })
    return cases
}

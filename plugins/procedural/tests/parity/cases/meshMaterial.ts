/**
 * Parity cases for Set Material with named materials (`run_cases.py` creates them from `materials`): slot reuse and
 * appending on meshes (full and partial selections), meshes joined with different slot lists (realize joins the
 * lists), point clouds (first slot only) and the empty material.
 */

import {n, Socket} from '../../../src/dsl/builder'
import type {IDRef} from '../../../src/runtime/types'
import {Extra, meshCase, mod, store} from './meshCommon'
import {ParityCase} from './types'

const MAT = (name: string): IDRef => ({_ref: 'MATERIAL', name})
const MATERIALS: Extra = {materials: ['Red', 'Green', 'Blue']}
const index = () => n.Index().index

export function meshMaterialCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, MATERIALS, build))

    add('set-material-mesh', 'Set Material on all faces, then on a selection, then an existing material again', () => {
        let g = n.SetMaterial({geometry: n.MeshGrid({verticesX: 5, verticesY: 4}).mesh, material: MAT('Red')}).geometry
        g = n.SetMaterial({geometry: g, material: MAT('Green'), selection: mod(index(), 3).eq(0)}).geometry
        g = n.SetMaterial({geometry: g, material: MAT('Red'), selection: index().lt(2)}).geometry
        return store(g, 'FACE', 'mi', n.MaterialIndex().materialIndex)
    })
    add('set-material-none-selection', 'Set Material with nothing selected still adds the slot and the attribute', () =>
        n.SetMaterial({geometry: n.MeshCube().mesh, material: MAT('Blue'), selection: false}).geometry)
    add('set-material-join', 'Meshes with different slot lists joined (realize_instances joins material lists and remaps indices)', () => {
        const a = n.SetMaterial({geometry: n.MeshGrid({verticesX: 3, verticesY: 3}).mesh, material: MAT('Green'), selection: mod(index(), 2).eq(0)}).geometry
        const b = n.SetMaterial({geometry: n.TransformGeometry({geometry: n.MeshCube().mesh, translation: [3, 0, 0]}).geometry, material: MAT('Blue')}).geometry
        const c = n.SetMaterialIndex({geometry: n.MeshCube({size: 0.5}).mesh, materialIndex: 3})
        return n.JoinGeometry({geometry: [a, b, c.geometry]}).geometry
    })
    add('set-material-instances', 'Set Material on instanced meshes (foreach_real_geometry), realized', () => {
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 3}).mesh, instance: n.MeshCube({size: 0.3}).mesh}).instances
        return n.RealizeInstances({geometry: n.SetMaterial({geometry: inst, material: MAT('Red'), selection: index().lt(3)}).geometry}).geometry
    })
    add('set-material-points', 'Set Material on point clouds: the first slot, a field selection is ignored; joined point clouds keep the first list', () => {
        const a = n.SetMaterial({geometry: n.Points({count: 3}).geometry, material: MAT('Green'), selection: index().lt(1)}).geometry
        const b = n.SetMaterial({geometry: n.SetMaterial({geometry: n.Points({count: 2}).geometry, material: MAT('Red')}).geometry, material: MAT('Blue')}).geometry
        return n.JoinGeometry({geometry: [a, b]}).geometry
    })
    add('set-material-points-alone', 'Set Material on one point cloud', () =>
        n.SetMaterial({geometry: n.Points({count: 3}).geometry, material: MAT('Blue')}).geometry)
    return cases
}

/**
 * Parity cases for Scale Elements: face and edge islands, uniform and single-axis (axis fields, zero axis, axes
 * parallel to Z), selections, single and per-element scale / center, a 2116-face island (summed in two halves by the
 * deterministic reduce), and the unported large-island grouping (blocked).
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, meshCase, mod, SHAPE_SCENE, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index

export function meshScaleCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, SHAPE_SCENE, build))
    // Separate faces: every face its own island.
    const loose = () => n.SplitEdges({mesh: testMeshes()}).mesh

    add('scale-faces-uniform', 'Uniform face scale on connected islands, per-face scale field, every third face unselected', () =>
        n.ScaleElements({geometry: attributed(testMeshes()), scale: index().mul(0.2).add(0.3), selection: mod(index(), 3).eq(2).not()}).geometry)
    add('scale-faces-individual', 'Uniform scale of separated faces about a fixed center', () =>
        n.ScaleElements({geometry: loose(), scale: 0.5, center: [0.1, 0.2, 0.3]}).geometry)
    add('scale-faces-axis', 'Single-axis face scale with an axis field (zero axis, Z axis, oblique)', () => {
        const axis = n.Switch({inputType: 'VECTOR', switch: mod(index(), 3).eq(0), false: n.CombineXYZ({x: mod(index(), 2), y: index().mul(0.3)}).vector,
            true: n.Switch({inputType: 'VECTOR', switch: mod(index(), 2).eq(0), false: [0, 0, 1], true: [0, 0, 0]}).output as Socket<'VECTOR'>}).output as Socket<'VECTOR'>
        return n.ScaleElements({geometry: loose(), scaleMode: 'Single Axis', axis, scale: 1.7}).geometry
    })
    add('scale-edges', 'Edge islands, uniform and single axis', () => {
        const uniform = n.ScaleElements({geometry: testMeshes(), domain: 'EDGE', scale: index().mul(0.1), selection: mod(index(), 4).eq(1).not()}).geometry
        return n.ScaleElements({geometry: uniform, domain: 'EDGE', scaleMode: 'Single Axis', axis: [1, 1, 0], scale: 0.4, selection: mod(index(), 5).eq(0)}).geometry
    })
    add('scale-big-island', 'A 2116-face island with two small ones (averaging under 1000 per island): means reduced in halves', () => {
        const grid = n.MeshGrid({sizeX: 3, sizeY: 3, verticesX: 47, verticesY: 47}).mesh
        const grid2 = n.SetPosition({geometry: grid, offset: n.CombineXYZ({z: n.Math({operation: 'FRACT', value: index().mul(0.37)}).value.mul(0.1)}).vector}).geometry
        const cubes = n.JoinGeometry({geometry: [n.MeshCube().mesh, n.TransformGeometry({geometry: n.MeshCube().mesh, translation: [3, 0, 0]}).geometry]}).geometry
        const all = n.JoinGeometry({geometry: [grid2, cubes]}).geometry
        return n.ScaleElements({geometry: all, scale: n.Math({operation: 'FRACT', value: index().mul(0.013)}).value.add(0.5)}).geometry
    })
    cases.push({...meshCase('scale-large-islands', 'A single 1600-face island: from_indices_large_groups (parallel_sort order)', {}, () =>
        n.ScaleElements({geometry: n.MeshGrid({verticesX: 41, verticesY: 41}).mesh, scale: index().mul(0.001)}).geometry),
    blocked: 'from_indices_large_groups: tbb::parallel_sort / libc++ std::sort order (procedural-scale-elements-large-islands.md)'})
    return cases
}

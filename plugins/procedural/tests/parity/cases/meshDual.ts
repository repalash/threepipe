/**
 * Parity cases for Dual Mesh: closed and open meshes, with and without Keep Boundaries, attributes on every domain,
 * two-face vertices (dissolved), inconsistent winding on a boundary, a vertex with two separate fans (sorting fails:
 * treated as non-manifold), non-manifold edges and loose elements.
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, meshCase, mod, SHAPE, testMeshes} from './meshCommon'
import {CaseObject, ParityCase} from './types'

const index = () => n.Index().index

/** A pillow (two quads on the same four vertices) and a double cone touching at its apex. */
const SPECIAL: CaseObject = {
    name: 'Special',
    mesh: {
        positions: [
            0, 0, 0, 1, 0, 0, 1, 1, 0.1, 0, 1, 0,
            // double cone: apex 4, ring A 5..8 (z = 1), ring B 9..12 (z = -1)
            3, 0, 0,
            2, 0, 1, 3, -1, 1, 4, 0, 1, 3, 1, 1,
            2, 0, -1, 3, -1, -1, 4, 0, -1, 3, 1, -1,
        ],
        faces: [[0, 1, 2, 3], [3, 2, 1, 0],
            [4, 5, 6], [4, 6, 7], [4, 7, 8], [4, 8, 5], [8, 7, 6, 5],
            [4, 10, 9], [4, 11, 10], [4, 12, 11], [4, 9, 12], [9, 10, 11, 12]],
    },
}
const SCENE = {objects: [SHAPE, SPECIAL]}
const special = () => n.ObjectInfo({object: {_ref: 'OBJECT', name: 'Special'}}).geometry

export function meshDualCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, SCENE, build))

    for (const keep of [false, true]) {
        const k = keep ? 'keep' : 'drop'
        add(`dual-closed-${k}`, `Dual of closed meshes (cube, UV sphere, cylinder with n-gon caps), keep boundaries ${keep}`, () => {
            const g = n.JoinGeometry({geometry: [n.MeshCube({verticesX: 3, verticesY: 2, verticesZ: 2}).mesh, n.MeshUVSphere({segments: 8, rings: 5}).mesh,
                n.MeshCylinder({vertices: 6}).mesh]}).geometry
            return n.DualMesh({mesh: attributed(g), keepBoundaries: keep}).dualMesh
        })
        add(`dual-open-${k}`, `Dual of open and non-manifold meshes with attributes, keep boundaries ${keep}`, () =>
            n.DualMesh({mesh: attributed(n.JoinGeometry({geometry: [testMeshes(), special()]}).geometry), keepBoundaries: keep}).dualMesh)
        add(`dual-flipped-${k}`, `Dual of a grid with some faces flipped (inconsistent winding at boundary vertices), keep boundaries ${keep}`, () => {
            const grid = n.MeshGrid({verticesX: 4, verticesY: 3}).mesh
            return n.DualMesh({mesh: n.FlipFaces({mesh: grid, selection: mod(index(), 4).eq(1)}).mesh, keepBoundaries: keep}).dualMesh
        })
    }
    add('dual-twice', 'Dual of the dual of a displaced grid with Keep Boundaries', () => {
        const grid = n.SetPosition({geometry: n.MeshGrid({verticesX: 5, verticesY: 4}).mesh,
            offset: n.CombineXYZ({z: n.Math({operation: 'FRACT', value: index().mul(0.37)}).value}).vector}).geometry
        return n.DualMesh({mesh: n.DualMesh({mesh: grid, keepBoundaries: true}).dualMesh, keepBoundaries: true}).dualMesh
    })
    return cases
}

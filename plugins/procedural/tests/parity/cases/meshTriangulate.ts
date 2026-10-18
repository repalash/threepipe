/**
 * Parity cases for Triangulate (`geometry::mesh_triangulate`): every quad method on planar, non-planar and concave
 * quads, both n-gon methods on convex, concave and non-planar n-gons, partial selections, duplicate triangles
 * (a source triangle equal to a new one is dropped, new duplicates merged), attributes on every domain, and a mesh
 * over 1000 faces (several edge hash maps in `mesh_calc_edges`).
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, mod, meshCase, SHAPE, testMeshes} from './meshCommon'
import {CaseObject, ParityCase} from './types'

const index = () => n.Index().index

/**
 * A concave, slightly non-planar 10-gon (star); a concave quad (dart) both ways round; a quad with a triangle on
 * its first three corners (duplicate after Fixed); two copies of one quad (duplicate new triangles).
 */
const CONCAVE: CaseObject = {
    name: 'Concave',
    mesh: {
        positions: [
            // star 0..9
            ...Array.from({length: 10}, (_, i) => {
                const r = i % 2 ? 0.4 : 1, a = (i / 10) * Math.PI * 2
                return [Math.fround(r * Math.cos(a)), Math.fround(r * Math.sin(a)), i % 3 ? 0.05 : 0]
            }).flat(),
            // dart 10..13
            3, 0, 0, 4, 0.2, 0, 3, 1, 0, 3.3, 0.25, 0,
            // quad + triangle 14..17
            5, 0, 0, 6, 0, 0, 6, 1, 0, 5, 1, 0,
            // doubled quad 18..21
            7, 0, 0, 8, 0, 0.1, 8, 1, 0, 7, 1, 0.2,
        ],
        faces: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [10, 11, 12, 13], [13, 12, 11, 10], [14, 15, 16, 17], [14, 15, 16], [18, 19, 20, 21], [18, 19, 20, 21]],
    },
}
const SCENE = {objects: [SHAPE, CONCAVE]}
const concave = () => n.ObjectInfo({object: {_ref: 'OBJECT', name: 'Concave'}}).geometry

export function meshTriangulateCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, SCENE, build))
    const all = () => attributed(n.JoinGeometry({geometry: [testMeshes(), concave()]}).geometry)

    for (const [quad, ngon] of [['Beauty', 'Beauty'], ['Fixed', 'Clip'], ['Fixed Alternate', 'Beauty'], ['Shortest Diagonal', 'Clip'], ['Longest Diagonal', 'Beauty']] as const) {
        add(`triangulate-${quad.toLowerCase().replace(' ', '-')}-${ngon.toLowerCase()}`, `Triangulate with quad method ${quad}, n-gon method ${ngon}`, () =>
            n.Triangulate({mesh: all(), quadMethod: quad, nGonMethod: ngon}).mesh)
    }
    add('triangulate-selection', 'Triangulate every other face; already-triangle selections stay', () =>
        n.Triangulate({mesh: all(), selection: mod(index(), 2).eq(0), quadMethod: 'Beauty'}).mesh)
    add('triangulate-none', 'Nothing to do: only triangles selected, and an all-triangle mesh', () => {
        const tris = n.Triangulate({mesh: n.MeshGrid({verticesX: 3, verticesY: 3}).mesh}).mesh
        const twice = n.Triangulate({mesh: tris, quadMethod: 'Fixed'}).mesh
        return n.JoinGeometry({geometry: [twice, n.Triangulate({mesh: testMeshes(), selection: false}).mesh]}).geometry
    })
    add('triangulate-large', 'A 1521-face grid, displaced, with a circle n-gon: over 1000 faces', () => {
        const grid = n.MeshGrid({sizeX: 4, sizeY: 4, verticesX: 40, verticesY: 40}).mesh
        const z = n.Math({operation: 'FRACT', value: index().mul(0.618)}).value.mul(0.2)
        const bumpy = n.SetPosition({geometry: grid, offset: n.CombineXYZ({z}).vector}).geometry
        return n.Triangulate({mesh: n.JoinGeometry({geometry: [bumpy, n.MeshCircle({vertices: 13, fillType: 'NGON'}).mesh]}).geometry, quadMethod: 'Beauty'}).mesh
    })
    return cases
}

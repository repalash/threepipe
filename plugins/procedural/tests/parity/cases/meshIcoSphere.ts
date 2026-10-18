/** Parity cases for Ico Sphere (`create_icosphere` + `subdivide_edges use_sphere` + `BM_mesh_bm_to_me`): every subdivision level, radii, the UV map. */

import {n, Socket} from '../../../src/dsl/builder'
import {Extra, meshCase, store} from './meshCommon'
import {ParityCase} from './types'

export function meshIcoSphereCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, extra, build))
    for (const [subdivisions, radius] of [[1, 1], [2, 1], [3, 2.5], [4, 0.37], [5, 1], [6, 3]] as const) {
        add(`ico-s${subdivisions}`, `Ico Sphere, ${subdivisions} subdivisions, radius ${radius}, with the UV map`, {}, () => {
            const ico = n.MeshIcoSphere({subdivisions, radius})
            return store(ico.mesh, 'CORNER', 'uv', ico.uVMap)
        })
    }
    add('ico-no-uv', 'Ico Sphere, 3 subdivisions, UV map output unused (no UVs calculated)', {}, () => n.MeshIcoSphere({subdivisions: 3}).mesh)
    add('ico-negative-radius', 'Ico Sphere with a negative radius (absolute value) and 2 subdivisions', {}, () => n.MeshIcoSphere({subdivisions: 2, radius: -1.5}).mesh)
    add('ico-zero-radius', 'Ico Sphere with radius 0 and 3 subdivisions (degenerate normalize)', {}, () => n.MeshIcoSphere({subdivisions: 3, radius: 0}).mesh)
    add('ico-edge-angle', 'Edge angles on a 3-subdivision Ico Sphere (topology-dependent field)', {}, () =>
        store(n.MeshIcoSphere({subdivisions: 3}).mesh, 'EDGE', 'angle', n.EdgeAngle().signedAngle))
    return cases
}

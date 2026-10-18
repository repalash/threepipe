/**
 * Parity cases for Subdivision Surface (`node_geo_subdivision_surface.cc` on `bke::subdiv`): uniform Catmull-Clark
 * (`Limit Surface` off: the uniform stencil path) and the limit surface (adaptive refinement to Quality, patch
 * evaluation), levels 0-3, edge and vertex creases from fields, boundary smoothing, the six UV smoothing modes,
 * attributes of every type, and the meshes Subdivide Mesh uses (n-gons, non-manifold, loose geometry).
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, Extra, meshCase, mod, shape} from './meshCommon'
import {allMeshes, bowtie, SCENE, typed, uvs} from './subdivMesh'
import {ParityCase} from './types'

const index = () => n.Index().index

export function subdivSurfaceCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, extra, build))

    for (const level of [0, 1, 2]) {
        add(`ss-uniform-l${level}`, `Subdivision Surface level ${level}, no limit surface: every mesh kind with attributes on every domain`, SCENE,
            () => n.SubdivisionSurface({mesh: attributed(allMeshes()), level, limitSurface: false}).mesh)
    }
    for (const level of [1, 2, 3]) {
        add(`ss-limit-l${level}`, `Subdivision Surface level ${level} on the limit surface (quality 3): the shape and the bowtie with attributes`, SCENE,
            () => n.SubdivisionSurface({mesh: attributed(n.JoinGeometry({geometry: [shape(), bowtie()]}).geometry), level}).mesh)
    }
    add('ss-limit-all', 'Subdivision Surface level 1 on the limit surface: n-gons, non-manifold edge and vertex, loose edges and vertices, holes', SCENE,
        () => n.SubdivisionSurface({mesh: attributed(allMeshes()), level: 1}).mesh)
    for (const limitSurface of [false, true]) {
        add(`ss-creases-${limitSurface ? 'limit' : 'uniform'}`, `Subdivision Surface level 2${limitSurface ? '' : ', no limit surface'}: edge creases (some edges 0.7, some 1) and vertex creases from fields, clamped`, SCENE,
            () => n.SubdivisionSurface({mesh: shape(), level: 2, limitSurface,
                edgeCrease: n.Switch({inputType: 'FLOAT', switch: mod(index(), 3).eq(0), false: 0, true: n.Switch({inputType: 'FLOAT', switch: mod(index(), 2).eq(0), false: 0.7, true: 1.4}).output as Socket<'FLOAT'>}).output as Socket<'FLOAT'>,
                vertexCrease: n.Switch({inputType: 'FLOAT', switch: mod(index(), 5).eq(1), false: -1, true: 0.6}).output as Socket<'FLOAT'>}).mesh)
    }
    for (const quality of [1, 5]) {
        add(`ss-quality-${quality}`, `Subdivision Surface level 2, quality ${quality}`, SCENE,
            () => n.SubdivisionSurface({mesh: shape(), level: 2, quality}).mesh)
    }
    add('ss-boundary-keep-corners', 'Subdivision Surface level 2 on an open grid and the bowtie, boundary smooth Keep Corners', SCENE, () =>
        n.SubdivisionSurface({mesh: n.JoinGeometry({geometry: [n.MeshGrid({sizeX: 2, sizeY: 1, verticesX: 4, verticesY: 3}).mesh, bowtie()]}).geometry,
            level: 2, boundarySmooth: 'Keep Corners'}).mesh)
    for (const uvSmooth of ['None', 'Keep Corners', 'Keep Corners, Junctions', 'Keep Corners, Junctions, Concave', 'Keep Boundaries', 'All']) {
        const id = uvSmooth.toLowerCase().replace(/[^a-z]+/g, '-')
        add(`ss-uv-${id}`, `Subdivision Surface level 1 on the limit surface, UV smooth ${uvSmooth}: two UV maps (continuous, seams)`, SCENE,
            () => n.SubdivisionSurface({mesh: uvs(allMeshes()), level: 1, uVSmooth: uvSmooth}).mesh)
    }
    add('ss-typed-uniform', 'Subdivision Surface level 1, no limit surface: int8, colours, quaternions, matrices and float2 on every domain', SCENE,
        () => n.SubdivisionSurface({mesh: typed(n.JoinGeometry({geometry: [shape(), bowtie()]}).geometry, true), level: 1, limitSurface: false}).mesh)
    return cases
}

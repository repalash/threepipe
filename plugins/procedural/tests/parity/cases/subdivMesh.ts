/**
 * Parity cases for Subdivide Mesh (`node_geo_mesh_subdivide.cc` on `bke::subdiv` + OpenSubdiv, issue 15b Phase A):
 * levels 0-6, quads / triangles / n-gons, a non-manifold edge (three faces), a non-manifold vertex (bowtie),
 * inconsistent winding, loose edges and vertices, meshes without faces, attributes of every type on every domain,
 * UV maps (face-varying channels, seams and flipped UV winding), material indices and instances.
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, Extra, meshCase, mod, SHAPE, shape, store, testMeshes} from './meshCommon'
import {CaseObject, ParityCase} from './types'

/**
 * Two triangles sharing only vertex 2 (a non-manifold vertex), and two quads sharing edge 5-6 with opposite winding
 * (a non-manifold edge for OpenSubdiv's orientation), plus a quad fan around vertex 9 with one face reversed.
 */
const BOWTIE: CaseObject = {
    name: 'Bowtie',
    mesh: {
        positions: [
            0, 0, 0, 1, 0, 0.1, 0.5, 0.5, 0, 0, 1, 0.2, 1, 1, -0.1,
            2, 0, 0, 2, 1, 0, 3, 0, 0.3, 3, 1, 0, 1, 2, 0.1, 2.5, -1, 0.2,
            4, 0, 0, 5, 0, 0.1, 5, 1, 0, 4, 1, 0.2, 4.5, 0.5, 0.5,
        ],
        faces: [[0, 1, 2], [2, 4, 3], [1, 5, 6, 4], [5, 7, 8, 6], [6, 8, 9], [7, 5, 10], [11, 12, 15], [12, 13, 15], [15, 13, 14], [11, 15, 14]],
    },
}

export const SCENE: Extra = {objects: [SHAPE, BOWTIE]}

const index = () => n.Index().index
export const bowtie = () => n.ObjectInfo({object: {_ref: 'OBJECT', name: 'Bowtie'}}).geometry

/** The shape, the bowtie and the shared test meshes (cube, grid with deleted faces, line), joined. */
export const allMeshes = () => n.JoinGeometry({geometry: [testMeshes(), n.TransformGeometry({geometry: bowtie(), translation: [0, -6, 0]}).geometry]}).geometry

/**
 * Attributes of the types `attributed` does not cover, on every mesh domain (`*8`, `*col`, `*bc`, `*q`, `*m`, `*2`).
 * FLOAT4 is left out: the package has no FLOAT4 attribute type yet (`issues/open/modelling-tools/procedural-float4-attribute-type.md`).
 */
export function typed(geometry: Socket<'GEOMETRY'>, matrices = false): Socket<'GEOMETRY'> {
    let g = geometry
    for (const [domain, p] of [['POINT', 'p'], ['EDGE', 'e'], ['FACE', 'f'], ['CORNER', 'c']] as const) {
        const i = index()
        const v = n.CombineXYZ({x: i.mul(0.3), y: mod(i, 5).mul(-0.7), z: i.mul(0.11).add(0.2)}).vector
        g = n.StoreNamedAttribute({geometry: g, domain, dataType: 'INT8', name: `${p}8`, value: mod(i.mul(37), 200).sub(100)}).geometry
        g = n.StoreNamedAttribute({geometry: g, domain, dataType: 'FLOAT_COLOR', name: `${p}col`,
            value: n.CombineColor({red: i.mul(0.1), green: mod(i, 4).mul(0.3), blue: 0.5, alpha: mod(i, 2)}).color}).geometry
        g = n.StoreNamedAttribute({geometry: g, domain, dataType: 'BYTE_COLOR', name: `${p}bc`,
            value: n.CombineColor({red: mod(i.mul(0.13), 1), green: mod(i, 3).mul(0.4), blue: 0.25, alpha: 1}).color}).geometry
        g = n.StoreNamedAttribute({geometry: g, domain, dataType: 'QUATERNION', name: `${p}q`, value: n.EulerToRotation({euler: v}).rotation}).geometry
        if (matrices) {
            g = n.StoreNamedAttribute({geometry: g, domain, dataType: 'FLOAT4X4', name: `${p}m`,
                value: n.CombineTransform({translation: v, rotation: n.EulerToRotation({euler: v}).rotation, scale: [1, 2, 0.5]}).transform}).geometry
        }
        g = n.StoreNamedAttribute({geometry: g, domain, dataType: 'FLOAT2', name: `${p}2`, value: v}).geometry
    }
    return g
}

/** UV maps on the corners: `uv_pos` (continuous: the position), `uv_seam` (seams between faces of different parity). */
export function uvs(geometry: Socket<'GEOMETRY'>): Socket<'GEOMETRY'> {
    const pos = n.Position().position
    let g = n.StoreNamedAttribute({geometry, domain: 'CORNER', dataType: 'FLOAT2', name: 'uv_pos', value: pos}).geometry
    const face = n.EvaluateOnDomain({domain: 'FACE', dataType: 'INT', value: index()}).value as Socket<'INT'>
    const shifted = n.CombineXYZ({x: pos.x.add(mod(face, 2).mul(0.5)), y: pos.y.mul(-1)}).vector
    g = n.StoreNamedAttribute({geometry: g, domain: 'CORNER', dataType: 'FLOAT2', name: 'uv_seam', value: shifted}).geometry
    return g
}

export function subdivMeshCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, extra, build))

    for (const level of [0, 1, 2, 3]) {
        add(`subdiv-all-l${level}`, `Subdivide Mesh level ${level}: quads, triangles, n-gons, non-manifold edge and vertex, loose edges and vertices, holes; float/int/vector/bool attributes on every domain`,
            SCENE, () => n.SubdivideMesh({mesh: attributed(allMeshes()), level}).mesh)
    }
    add('subdiv-typed-l2', 'Subdivide Mesh level 2: int8, colours, byte colours, quaternions and float2 attributes on every domain', SCENE,
        () => n.SubdivideMesh({mesh: typed(n.JoinGeometry({geometry: [shape(), bowtie()]}).geometry), level: 2}).mesh)
    for (const level of [0, 2]) {
        add(`subdiv-matrix-quads-l${level}`, `Subdivide Mesh level ${level}: rotation and matrix attributes on an all-quad mesh (mix4 and copies only; level 0 is the input)`, {}, () =>
            n.SubdivideMesh({mesh: typed(n.MeshCube({size: [1, 0.5, 2], verticesX: 3, verticesY: 2, verticesZ: 3}).mesh, true), level}).mesh)
    }
    cases.push(meshCase('subdiv-matrix-ngons', 'Subdivide Mesh level 1: matrix attributes on triangles / n-gons need the float4x4 mix2', SCENE, () =>
        n.SubdivideMesh({mesh: typed(n.JoinGeometry({geometry: [shape(), bowtie()]}).geometry, true), level: 1}).mesh))
    add('subdiv-uv-l2', 'Subdivide Mesh level 2: two UV maps (continuous and with seams) as face-varying channels', SCENE,
        () => n.SubdivideMesh({mesh: uvs(allMeshes()), level: 2}).mesh)
    add('subdiv-uv-primitives', 'Subdivide Mesh level 1: UV maps of the cube, UV sphere and cylinder primitives (seams, poles, n-gon caps)', {}, () => {
        const cube = n.MeshCube({size: [1, 2, 0.5], verticesX: 3, verticesY: 2, verticesZ: 2})
        const sphere = n.MeshUVSphere({segments: 7, rings: 5})
        const cyl = n.MeshCylinder({vertices: 6, fillType: 'NGON', sideSegments: 2})
        const withUv = (g: Socket<'GEOMETRY'>, uv: Socket<'VECTOR'>, t: [number, number, number]) =>
            n.TransformGeometry({geometry: n.StoreNamedAttribute({geometry: g, domain: 'CORNER', dataType: 'FLOAT2', name: 'UVMap', value: uv}).geometry, translation: t}).geometry
        const joined = n.JoinGeometry({geometry: [withUv(cube.mesh, cube.uVMap, [0, 0, 0]), withUv(sphere.mesh, sphere.uVMap, [3, 0, 0]),
            withUv(cyl.mesh, cyl.uVMap, [6, 0, 0])]}).geometry
        return n.SubdivideMesh({mesh: joined, level: 1}).mesh
    })
    add('subdiv-uv-flipped', 'Subdivide Mesh level 1: equal UVs on faces with opposite UV winding stay separate', {}, () => {
        const grid = n.MeshGrid({sizeX: 2, sizeY: 2, verticesX: 4, verticesY: 3}).mesh
        const pos = n.Position().position
        const face = n.EvaluateOnDomain({domain: 'FACE', dataType: 'INT', value: index()}).value as Socket<'INT'>
        const flip = n.CombineXYZ({x: pos.x.mul(mod(face, 2).mul(2).sub(1)), y: pos.y}).vector
        return n.SubdivideMesh({mesh: n.StoreNamedAttribute({geometry: grid, domain: 'CORNER', dataType: 'FLOAT2', name: 'uv', value: flip}).geometry, level: 1}).mesh
    })
    add('subdiv-ngons-l4', 'Subdivide Mesh level 4: n-gon fill circle, triangle fan and a 3-gon', {}, () => {
        const ngon = n.MeshCircle({vertices: 7, fillType: 'NGON'}).mesh
        const fan = n.TransformGeometry({geometry: n.MeshCircle({vertices: 5, fillType: 'TRIANGLE_FAN', radius: 0.7}).mesh, translation: [3, 0, 0.5]}).geometry
        const tri = n.TransformGeometry({geometry: n.MeshCircle({vertices: 3, fillType: 'NGON'}).mesh, translation: [0, 3, 0]}).geometry
        return n.SubdivideMesh({mesh: attributed(n.JoinGeometry({geometry: [ngon, fan, tri]}).geometry), level: 4}).mesh
    })
    add('subdiv-quad-l6', 'Subdivide Mesh level 6 (the maximum) of a non-planar quad and a triangle (topology and positions only, to keep the result small)', SCENE, () => {
        const part = n.DeleteGeometry({geometry: shape(), domain: 'FACE', selection: index().eq(1).not()}).geometry
        return n.SubdivideMesh({mesh: n.JoinGeometry({geometry: [part, n.TransformGeometry({geometry: n.MeshCircle({vertices: 3, fillType: 'NGON'}).mesh, translation: [0, 3, 0]}).geometry]}).geometry, level: 6}).mesh
    })
    add('subdiv-loose-only', 'Subdivide Mesh level 2 of meshes without faces: a line (loose edges) and loose vertices', {}, () => {
        const line = n.MeshLine({count: 4, offset: [0.5, 0.2, -0.1]}).mesh
        const verts = n.DeleteGeometry({geometry: n.MeshLine({count: 3, startLocation: [0, 2, 0]}).mesh, domain: 'EDGE', mode: 'EDGE_FACE', selection: true}).geometry
        return n.SubdivideMesh({mesh: attributed(n.JoinGeometry({geometry: [line, verts]}).geometry), level: 2}).mesh
    })
    add('subdiv-materials', 'Subdivide Mesh level 2: material index and sharp edges / faces are copied to the new elements', SCENE, () => {
        let g = n.SetMaterialIndex({geometry: allMeshes(), materialIndex: mod(index(), 3)}).geometry
        g = store(g, 'EDGE', 'sharp_edge', mod(index(), 4).eq(0))
        g = store(g, 'FACE', 'sharp_face', mod(index(), 2).eq(1))
        return n.SubdivideMesh({mesh: g, level: 2}).mesh
    })
    add('subdiv-instances', 'Subdivide Mesh inside instances (foreach_real_geometry), with a curve passed through', {}, () => {
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 3, offset: [2, 0, 0]}).mesh, instance: attributed(n.MeshCube({size: 0.5}).mesh), scale: index().add(1)}).instances
        const joined = n.JoinGeometry({geometry: [inst, n.CurveLine().curve, n.MeshCircle({vertices: 5, fillType: 'NGON'}).mesh]}).geometry
        return n.RealizeInstances({geometry: n.SubdivideMesh({mesh: joined, level: 2}).mesh}).geometry
    })
    add('subdiv-level-field', 'Subdivide Mesh with a negative level (clamped to 0: unchanged)', SCENE, () =>
        n.SubdivideMesh({mesh: attributed(shape()), level: -3}).mesh)
    return cases
}

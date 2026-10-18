/**
 * Parity cases for the round mesh primitives (Mesh Circle, Cylinder, Cone, UV Sphere: every fill type, degenerate
 * radii, the Top/Side/Bottom and UV Map outputs) and Bounding Box (computed and primitive eager bounds, point clouds
 * with and without the radius, instanced geometry).
 */

import {n, Socket} from '../../../src/dsl/builder'
import {Extra, meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index

export function meshPrimitiveCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, extra, build))
    const FILLS = ['NONE', 'NGON', 'TRIANGLE_FAN'] as const

    add('circle', 'Mesh Circle with every fill type and 3, 5 and 32 vertices', {}, () => n.JoinGeometry({geometry: FILLS.flatMap((fillType, f) =>
        [3, 5, 32].map((vertices, i) => n.TransformGeometry({
            geometry: n.MeshCircle({fillType, vertices, radius: 1.3 + i * 0.1}).mesh, translation: [f * 3, i * 3, 0],
        }).geometry))}).geometry)

    for (const fillType of FILLS) {
        add(`cylinder-${fillType.toLowerCase()}`, `Cylinder ${fillType}: segments, Top/Side/Bottom and UV Map`, {}, () => {
            const c = n.MeshCylinder({fillType, vertices: 7, sideSegments: 3, ...(fillType === 'NONE' ? {} : {fillSegments: 2}), radius: 0.8, depth: 1.7})
            let g: Socket<'GEOMETRY'> = c.mesh
            for (const d of ['POINT', 'FACE'] as const) {
                g = store(g, d, `top_${d}`, c.top)
                g = store(g, d, `side_${d}`, c.side)
                g = store(g, d, `bottom_${d}`, c.bottom)
            }
            return store(g, 'CORNER', 'uv', c.uVMap)
        })
        for (const [label, radiusTop, radiusBottom, depth] of [['tip', 0, 1.1, 2], ['truncated', 0.4, 1.1, 1.5], ['inverted', 0.9, 0, 1], ['line', 0, 0, 2], ['vertex', 0, 0, 0]] as const) {
            add(`cone-${fillType.toLowerCase()}-${label}`, `Cone ${fillType} ${label}: outputs and UV Map`, {}, () => {
                const c = n.MeshCone({fillType, vertices: 6, sideSegments: 2, ...(fillType === 'NONE' ? {} : {fillSegments: 3}), radiusTop, radiusBottom, depth})
                let g: Socket<'GEOMETRY'> = c.mesh
                for (const d of ['POINT', 'FACE'] as const) {
                    g = store(g, d, `top_${d}`, c.top)
                    g = store(g, d, `side_${d}`, c.side)
                    g = store(g, d, `bottom_${d}`, c.bottom)
                }
                return store(g, 'CORNER', 'uv', c.uVMap)
            })
        }
    }
    for (const [segments, rings] of [[3, 2], [8, 5], [32, 16]] as const) {
        add(`uv-sphere-${segments}-${rings}`, `UV Sphere ${segments} x ${rings} with UV Map`, {}, () => {
            const s = n.MeshUVSphere({segments, rings, radius: 1.25})
            return store(s.mesh, 'CORNER', 'uv', s.uVMap)
        })
    }
    add('uv-sphere-normals', 'UV Sphere vertex normals are the assigned unit positions (mesh_vert_normals_assign), read after a store', {}, () =>
        store(n.MeshUVSphere({segments: 12, rings: 7}).mesh, 'POINT', 'n', n.Normal().normal))

    // region Bounding Box
    const box = (g: Socket<'GEOMETRY'>, useRadius = true) => {
        const b = n.BoundingBox({geometry: g, useRadius})
        let pt: Socket<'GEOMETRY'> = n.Points({count: 1}).geometry
        pt = store(pt, 'POINT', 'min', b.min)
        pt = store(pt, 'POINT', 'max', b.max)
        return n.JoinGeometry({geometry: [b.boundingBox, pt]}).geometry
    }
    add('bounding-box-meshes', 'Bounding Box of joined meshes (computed bounds)', SHAPE_SCENE, () => box(testMeshes()))
    for (const useRadius of [true, false]) {
        add(`bounding-box-points${useRadius ? '-radius' : ''}`, `Bounding Box of point clouds with and without radii, use radius ${useRadius}`, {}, () => {
            const a = n.Points({count: 5, position: n.CombineXYZ({x: index(), y: mod(index(), 2), z: 0.5}).vector, radius: index().mul(0.3)}).geometry
            return box(n.JoinGeometry({geometry: [a, n.MeshLine({count: 2, offset: [0.2, 0.2, 0.2]}).mesh]}).geometry, useRadius)
        })
    }
    add('bounding-box-instances', 'Bounding Box: Min/Max ignore instances, the box mesh is made per instanced geometry', {}, () => {
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 3, offset: [2, 0, 0]}).mesh, instance: n.MeshCube({size: [0.5, 1, 1.5]}).mesh,
            rotation: n.EulerToRotation({euler: n.CombineXYZ({z: index().mul(0.4)}).vector}).rotation}).instances
        return box(n.JoinGeometry({geometry: [inst, n.MeshCircle({vertices: 9}).mesh]}).geometry)
    })
    add('bounding-box-primitives', 'Bounding Box of round primitives (Blender uses their eager analytic bounds)', {}, () => n.JoinGeometry({geometry: [
        box(n.MeshCircle({vertices: 5, radius: 1.7}).mesh),
        box(n.MeshCylinder({vertices: 7, radius: 0.6, depth: 1.3}).mesh),
        box(n.MeshCone({vertices: 9, radiusTop: 0.2, radiusBottom: 1.3, depth: 2.2}).mesh),
        box(n.MeshUVSphere({segments: 11, rings: 7, radius: 0.9}).mesh),
        box(n.MeshCone({radiusTop: 0, radiusBottom: 0, depth: 2.5, sideSegments: 3}).mesh),
    ]}).geometry)
    // endregion
    return cases
}

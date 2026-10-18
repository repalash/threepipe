/**
 * Mesh primitive nodes: Grid (`node_geo_mesh_primitive_grid.cc`), Mesh Line (`node_geo_mesh_primitive_line.cc`),
 * Cube (`node_geo_mesh_primitive_cube.cc`).
 */

import {GField} from '../../fields/field'
import {AttributeFieldInput} from '../../fields/inputs'
import {GeometrySet} from '../../geometry/GeometrySet'
import {createCuboidMesh, createGridMesh, createLineMesh, ensureDefaultMaterialSlot} from '../../geometry/meshPrimitives'
import {transformMesh} from '../../geometry/transform'
import {eulerToQuat} from '../../blender/math/matrix'
import {f32} from '../../blender/f32'
import {length3, normalize3} from '../../blender/math/vec'
import {MeshData} from '@threepipe/mesh-kernel'
import {stdMax} from '../util'
import {registerNodeType} from '../../runtime/registry'

registerNodeType({
    idname: 'GeometryNodeMeshGrid',
    label: 'Grid',
    dslName: 'MeshGrid',
    declare(b) {
        b.input('FLOAT', 'Size X').default(1).min(0).subtype('DISTANCE')
        b.input('FLOAT', 'Size Y').default(1).min(0).subtype('DISTANCE')
        b.input('INT', 'Vertices X').default(3).min(2).max(1000)
        b.input('INT', 'Vertices Y').default(3).min(2).max(1000)
        b.output('GEOMETRY', 'Mesh')
        b.output('VECTOR', 'UV Map').field()
    },
    // `node_geo_exec` (:47).
    execute(p) {
        const sizeX = p.float('Size X')
        const sizeY = p.float('Size Y')
        const vx = p.int('Vertices X')
        const vy = p.int('Vertices Y')
        if (vx < 1 || vy < 1) return
        const uvId = p.outputUsed('UV Map') ? p.anonymousName('UV Map') : undefined
        const mesh = createGridMesh(vx, vy, sizeX, sizeY, uvId)
        ensureDefaultMaterialSlot(mesh)
        p.set('Mesh', GeometrySet.fromMesh(mesh))
        // The UV map is a float2 attribute read through a float3 socket (implicit conversion).
        if (uvId) p.set('UV Map', GField.fromInput(new AttributeFieldInput(uvId, 'float3')))
    },
})

registerNodeType({
    idname: 'GeometryNodeMeshLine',
    label: 'Mesh Line',
    // `node_init` (:72).
    properties: {mode: 'OFFSET', count_mode: 'TOTAL'},
    enums: {mode: ['OFFSET', 'END_POINTS'], count_mode: ['TOTAL', 'RESOLUTION']},
    declare(b, node) {
        // `node_declare` (:25), availability from `node_update` (:82).
        const mode = node.prop<string>('mode')
        const countMode = node.prop<string>('count_mode')
        b.input('INT', 'Count').default(10).min(1).max(10000).available(mode === 'OFFSET' || countMode === 'TOTAL')
        b.input('FLOAT', 'Resolution').default(1).min(0.1).subtype('DISTANCE').available(mode === 'END_POINTS' && countMode === 'RESOLUTION')
        b.input('VECTOR', 'Start Location').subtype('TRANSLATION')
        b.input('VECTOR', 'Offset').default([0, 0, 1]).subtype('TRANSLATION')
        b.output('GEOMETRY', 'Mesh')
    },
    // `node_geo_exec` (:134).
    execute(p) {
        const mode = p.node.prop<string>('mode')
        const countMode = p.node.prop<string>('count_mode')
        const start = p.vector('Start Location')
        let mesh: MeshData | undefined
        if (mode === 'END_POINTS') {
            const end = p.vector('Offset')
            const total = [f32(end[0] - start[0]), f32(end[1] - start[1]), f32(end[2] - start[2])]
            if (countMode === 'RESOLUTION') {
                const resolution = stdMax(p.float('Resolution'), f32(0.0001))
                // `int count = length / resolution + 1` (float arithmetic, truncated).
                const count = Math.trunc(f32(f32(length3(total) / resolution) + 1))
                const n = normalize3(total)
                mesh = createLineMesh(start, [f32(n[0] * resolution), f32(n[1] * resolution), f32(n[2] * resolution)], count)
            } else {
                const count = p.int('Count')
                if (count === 1) mesh = createLineMesh(start, [0, 0, 0], count)
                else {
                    const d = f32(count - 1)
                    mesh = createLineMesh(start, [f32(total[0] / d), f32(total[1] / d), f32(total[2] / d)], count)
                }
            }
        } else {
            mesh = createLineMesh(start, p.vector('Offset'), p.int('Count'))
        }
        if (mesh) ensureDefaultMaterialSlot(mesh)
        p.set('Mesh', mesh ? GeometrySet.fromMesh(mesh) : new GeometrySet())
    },
})

/** `create_cube_mesh` (`node_geo_mesh_primitive_cube.cc:39`). */
function createCubeMesh(size: [number, number, number], vx: number, vy: number, vz: number, uvId?: string): MeshData {
    const dimensions = (vx - 1 > 0 ? 1 : 0) + (vy - 1 > 0 ? 1 : 0) + (vz - 1 > 0 ? 1 : 0)
    if (dimensions === 0) return createLineMesh([0, 0, 0], [0, 0, 0], 1)!
    if (dimensions === 1) {
        let start: number[], delta: number[]
        if (vx > 1) {
            start = [f32(-size[0] / 2), 0, 0]
            delta = [f32(size[0] / (vx - 1)), 0, 0]
        } else if (vy > 1) {
            start = [0, f32(-size[1] / 2), 0]
            delta = [0, f32(size[1] / (vy - 1)), 0]
        } else {
            start = [0, 0, f32(-size[2] / 2)]
            delta = [0, 0, f32(size[2] / (vz - 1))]
        }
        return createLineMesh(start, delta, vx * vy * vz)!
    }
    if (dimensions === 2) {
        if (vz === 1) return createGridMesh(vx, vy, size[0], size[1], uvId)
        const halfPi = f32(Math.PI / 2)
        if (vy === 1) {
            const mesh = createGridMesh(vx, vz, size[0], size[2], uvId)
            transformMesh(mesh, [0, 0, 0], eulerToQuat([halfPi, 0, 0]), [1, 1, 1])
            return mesh
        }
        const mesh = createGridMesh(vz, vy, size[2], size[1], uvId)
        transformMesh(mesh, [0, 0, 0], eulerToQuat([0, halfPi, 0]), [1, 1, 1])
        return mesh
    }
    return createCuboidMesh(size, vx, vy, vz, uvId)
}

registerNodeType({
    idname: 'GeometryNodeMeshCube',
    label: 'Cube',
    dslName: 'MeshCube',
    declare(b) {
        // `node_declare` (:17).
        b.input('VECTOR', 'Size').default([1, 1, 1]).min(0).subtype('TRANSLATION')
        b.input('INT', 'Vertices X').default(2).min(2).max(1000)
        b.input('INT', 'Vertices Y').default(2).min(2).max(1000)
        b.input('INT', 'Vertices Z').default(2).min(2).max(1000)
        b.output('GEOMETRY', 'Mesh')
        b.output('VECTOR', 'UV Map').field()
    },
    // `node_geo_exec` (:97).
    execute(p) {
        const size = p.vector('Size')
        const vx = p.int('Vertices X'), vy = p.int('Vertices Y'), vz = p.int('Vertices Z')
        if (vx < 1 || vy < 1 || vz < 1) {
            p.warn('Vertices must be at least 1')
            return
        }
        const uvId = p.outputUsed('UV Map') ? p.anonymousName('UV Map') : undefined
        const mesh = createCubeMesh(size, vx, vy, vz, uvId)
        ensureDefaultMaterialSlot(mesh)
        p.set('Mesh', GeometrySet.fromMesh(mesh))
        if (uvId) p.set('UV Map', GField.fromInput(new AttributeFieldInput(uvId, 'float3')))
    },
})

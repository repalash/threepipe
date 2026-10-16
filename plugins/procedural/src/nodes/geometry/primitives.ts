/**
 * Mesh primitive nodes: Grid (`node_geo_mesh_primitive_grid.cc`).
 */

import {GField} from '../../fields/field'
import {AttributeFieldInput} from '../../fields/inputs'
import {GeometrySet} from '../../geometry/GeometrySet'
import {createGridMesh, ensureDefaultMaterialSlot} from '../../geometry/meshPrimitives'
import {registerNodeType} from '../../runtime/registry'

registerNodeType({
    idname: 'GeometryNodeMeshGrid',
    label: 'Grid',
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

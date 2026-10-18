/** Ico Sphere (`GeometryNodeMeshIcoSphere`) - `nodes/geometry/nodes/node_geo_mesh_primitive_ico_sphere.cc` (Blender 5.2.2). */

import {GField} from '../../fields/field'
import {AttributeFieldInput} from '../../fields/inputs'
import {GeometrySet} from '../../geometry/GeometrySet'
import {createIcosphereBMesh, icoBMeshToMesh} from '../../geometry/icoSphere'
import {ensureDefaultMaterialSlot} from '../../geometry/meshPrimitives'
import {registerNodeType} from '../../runtime/registry'

registerNodeType({
    idname: 'GeometryNodeMeshIcoSphere',
    label: 'Ico Sphere',
    dslName: 'MeshIcoSphere',
    declare(b) {
        b.input('FLOAT', 'Radius').default(1).min(0).subtype('DISTANCE')
        b.input('INT', 'Subdivisions').default(1).min(1).max(7)
        b.output('GEOMETRY', 'Mesh')
        b.output('VECTOR', 'UV Map').field()
    },
    // `node_geo_exec` (:121) with `create_ico_sphere_mesh` (:66).
    execute(p) {
        const subdivisions = Math.min(p.int('Subdivisions'), 10)
        const radius = p.float('Radius')
        const uvId = p.outputUsed('UV Map') ? p.anonymousName('UV Map') : undefined
        const bm = createIcosphereBMesh(subdivisions, Math.abs(radius), uvId !== undefined)
        const mesh = icoBMeshToMesh(bm, uvId)
        ensureDefaultMaterialSlot(mesh)
        p.set('Mesh', GeometrySet.fromMesh(mesh))
        if (uvId) p.set('UV Map', GField.fromInput(new AttributeFieldInput(uvId, 'float3')))
    },
})

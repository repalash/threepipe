/**
 * Round mesh primitive nodes: Mesh Circle (`node_geo_mesh_primitive_circle.cc`), Cylinder
 * (`node_geo_mesh_primitive_cylinder.cc`), Cone (`node_geo_mesh_primitive_cone.cc`), UV Sphere
 * (`node_geo_mesh_primitive_uv_sphere.cc`), on `src/geometry/meshPrimitivesRound.ts`.
 */

import {GField} from '../../fields/field'
import {AttributeFieldInput} from '../../fields/inputs'
import {GeometrySet} from '../../geometry/GeometrySet'
import {ensureDefaultMaterialSlot} from '../../geometry/meshPrimitives'
import {CircleFillType, ConeAttributeOutputs, createCircleMesh, createCylinderOrConeMesh, createUVSphereMesh} from '../../geometry/meshPrimitivesRound'
import {meshVertNormalsAssign} from '../../geometry/meshNormals'
import {meshTranslate} from '../../geometry/transform'
import {meshBoundsTranslate} from '../../geometry/meshBounds'
import {f32} from '../../blender/f32'
import type {ExecParams} from '../../runtime/params'
import {registerNodeType} from '../../runtime/registry'

/** `rna_enum_node_geometry_mesh_circle_fill_type_items` (`rna_nodetree.cc:525`). */
const FILL_TYPES = ['NONE', 'NGON', 'TRIANGLE_FAN']

registerNodeType({
    idname: 'GeometryNodeMeshCircle',
    label: 'Mesh Circle',
    // `node_init`: no fill.
    properties: {fill_type: 'NONE'},
    enums: {fill_type: FILL_TYPES},
    declare(b) {
        b.input('INT', 'Vertices').default(32).min(3)
        b.input('FLOAT', 'Radius').default(1).min(0).subtype('DISTANCE')
        b.output('GEOMETRY', 'Mesh')
    },
    // `node_geo_exec` (:190).
    execute(p) {
        const radius = p.float('Radius')
        const verts = p.int('Vertices')
        if (verts < 3) {
            p.warn('Vertices must be at least 3')
            return
        }
        p.set('Mesh', GeometrySet.fromMesh(createCircleMesh(radius, verts, p.node.prop<CircleFillType>('fill_type'))))
    },
})

/** The anonymous outputs of a cylinder or cone (`get_output_anonymous_attribute_id_if_needed`). */
function coneOutputs(p: ExecParams): ConeAttributeOutputs {
    const id = (name: string) => (p.outputUsed(name) ? p.anonymousName(name) : undefined)
    return {topId: id('Top'), bottomId: id('Bottom'), sideId: id('Side'), uvMapId: id('UV Map')}
}

function setConeOutputs(p: ExecParams, o: ConeAttributeOutputs): void {
    if (o.topId) p.set('Top', GField.fromInput(new AttributeFieldInput(o.topId, 'bool')))
    if (o.bottomId) p.set('Bottom', GField.fromInput(new AttributeFieldInput(o.bottomId, 'bool')))
    if (o.sideId) p.set('Side', GField.fromInput(new AttributeFieldInput(o.sideId, 'bool')))
    // The UV map is a float2 attribute read through a vector socket.
    if (o.uvMapId) p.set('UV Map', GField.fromInput(new AttributeFieldInput(o.uvMapId, 'float3')))
}

/** The segment counts with Blender's checks (`node_geo_exec` of both nodes); undefined after a warning. */
function segments(p: ExecParams): {circle: number, side: number, fill: number} | undefined {
    const circle = p.int('Vertices')
    if (circle < 3) {
        p.warn('Vertices must be at least 3')
        return undefined
    }
    const side = p.int('Side Segments')
    if (side < 1) {
        p.warn('Side Segments must be at least 1')
        return undefined
    }
    const fill = p.node.prop<string>('fill_type') === 'NONE' ? 1 : p.int('Fill Segments')
    if (fill < 1) {
        p.warn('Fill Segments must be at least 1')
        return undefined
    }
    return {circle, side, fill}
}

registerNodeType({
    idname: 'GeometryNodeMeshCylinder',
    label: 'Cylinder',
    dslName: 'MeshCylinder',
    properties: {fill_type: 'NGON'},
    enums: {fill_type: FILL_TYPES},
    declare(b, node) {
        b.input('INT', 'Vertices').default(32).min(3).max(512)
        b.input('INT', 'Side Segments').default(1).min(1).max(512)
        b.input('INT', 'Fill Segments').default(1).min(1).max(512).available(node.prop<string>('fill_type') !== 'NONE')
        b.input('FLOAT', 'Radius').default(1).min(0).subtype('DISTANCE')
        b.input('FLOAT', 'Depth').default(2).min(0).subtype('DISTANCE')
        b.output('GEOMETRY', 'Mesh')
        b.output('BOOLEAN', 'Top').field()
        b.output('BOOLEAN', 'Side').field()
        b.output('BOOLEAN', 'Bottom').field()
        b.output('VECTOR', 'UV Map').field()
    },
    // `node_geo_exec`: a cone with equal radii.
    execute(p) {
        const radius = p.float('Radius')
        const depth = p.float('Depth')
        const s = segments(p)
        if (!s) return
        const o = coneOutputs(p)
        const mesh = createCylinderOrConeMesh(radius, radius, depth, s.circle, s.side, s.fill, p.node.prop<CircleFillType>('fill_type'), o)
        ensureDefaultMaterialSlot(mesh)
        p.set('Mesh', GeometrySet.fromMesh(mesh))
        setConeOutputs(p, o)
    },
})

registerNodeType({
    idname: 'GeometryNodeMeshCone',
    label: 'Cone',
    dslName: 'MeshCone',
    properties: {fill_type: 'NGON'},
    enums: {fill_type: FILL_TYPES},
    declare(b, node) {
        b.input('INT', 'Vertices').default(32).min(3).max(512)
        b.input('INT', 'Side Segments').default(1).min(1).max(512)
        b.input('INT', 'Fill Segments').default(1).min(1).max(512).available(node.prop<string>('fill_type') !== 'NONE')
        b.input('FLOAT', 'Radius Top').min(0).subtype('DISTANCE')
        b.input('FLOAT', 'Radius Bottom').default(1).min(0).subtype('DISTANCE')
        b.input('FLOAT', 'Depth').default(2).min(0).subtype('DISTANCE')
        b.output('GEOMETRY', 'Mesh')
        b.output('BOOLEAN', 'Top').field()
        b.output('BOOLEAN', 'Bottom').field()
        b.output('BOOLEAN', 'Side').field()
        b.output('VECTOR', 'UV Map').field()
    },
    // `node_geo_exec`: the base moved to the origin.
    execute(p) {
        const s = segments(p)
        if (!s) return
        const radiusTop = p.float('Radius Top'), radiusBottom = p.float('Radius Bottom'), depth = p.float('Depth')
        const o = coneOutputs(p)
        const mesh = createCylinderOrConeMesh(radiusTop, radiusBottom, depth, s.circle, s.side, s.fill, p.node.prop<CircleFillType>('fill_type'), o)
        ensureDefaultMaterialSlot(mesh)
        // `bke::mesh_translate(*mesh, float3(0, 0, depth * 0.5f), false)`.
        meshTranslate(mesh, [0, 0, f32(depth * 0.5)])
        meshBoundsTranslate(mesh, [0, 0, f32(depth * 0.5)])
        p.set('Mesh', GeometrySet.fromMesh(mesh))
        setConeOutputs(p, o)
    },
})

registerNodeType({
    idname: 'GeometryNodeMeshUVSphere',
    label: 'UV Sphere',
    dslName: 'MeshUVSphere',
    declare(b) {
        b.input('INT', 'Segments').default(32).min(3).max(1024)
        b.input('INT', 'Rings').default(16).min(2).max(1024)
        b.input('FLOAT', 'Radius').default(1).min(0).subtype('DISTANCE')
        b.output('GEOMETRY', 'Mesh')
        b.output('VECTOR', 'UV Map').field()
    },
    // `node_geo_exec`.
    execute(p) {
        const segmentsNum = p.int('Segments')
        const ringsNum = p.int('Rings')
        if (segmentsNum < 3 || ringsNum < 2) {
            if (segmentsNum < 3) p.warn('Segments must be at least 3')
            if (ringsNum < 3) p.warn('Rings must be at least 3')
            return
        }
        const radius = p.float('Radius')
        const uvId = p.outputUsed('UV Map') ? p.anonymousName('UV Map') : undefined
        const {mesh, vertNormals} = createUVSphereMesh(radius, segmentsNum, ringsNum, uvId)
        meshVertNormalsAssign(mesh, vertNormals)
        ensureDefaultMaterialSlot(mesh)
        p.set('Mesh', GeometrySet.fromMesh(mesh))
        if (uvId) p.set('UV Map', GField.fromInput(new AttributeFieldInput(uvId, 'float3')))
    },
})

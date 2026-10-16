/**
 * Attribute nodes: Store Named Attribute (`node_geo_store_named_attribute.cc`), Named Attribute
 * (`node_geo_input_named_attribute.cc`) and the built-in field inputs Position, Index, ID, Normal
 * (`node_geo_input_position.cc`, `node_geo_input_index.cc`, `node_geo_input_id.cc`,
 * `node_geo_input_normal.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {GField} from '../../fields/field'
import {convertField} from '../../runtime/values'
import {captureFieldsOnGeometry} from '../../fields/capture'
import {AttributeExistsFieldInput, AttributeFieldInput, IDAttributeFieldInput, IndexFieldInput, NormalFieldInput} from '../../fields/inputs'
import {registerNodeType} from '../../runtime/registry'
import {GeometrySet, ComponentType} from '../../geometry/GeometrySet'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {allowProceduralAttributeAccess, dataTypeFromRNA, domainFromRNA, socketTypeFromRNA} from '../attributeTypes'
import {isAnonymousAttributeName} from '../../geometry/attributeAccessor'

registerNodeType({
    idname: 'GeometryNodeStoreNamedAttribute',
    label: 'Store Named Attribute',
    // `node_init` (:62): CD_PROP_FLOAT on points.
    properties: {data_type: 'FLOAT', domain: 'POINT'},
    declare(b, node) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('STRING', 'Name')
        b.input(socketTypeFromRNA(node.prop<string>('data_type')), 'Value').field()
    },
    // `node_geo_exec` (:94).
    execute(p) {
        let geometry = p.geometry('Geometry')
        const name = p.string('Name')
        if (!name) return p.set('Geometry', geometry)
        if (!allowProceduralAttributeAccess(name)) {
            p.warn('Procedural access to this attribute is not allowed')
            return p.set('Geometry', geometry)
        }
        if (isAnonymousAttributeName(name)) {
            p.warn('Anonymous attributes cannot be created here')
            return p.set('Geometry', geometry)
        }
        const dataType = dataTypeFromRNA(p.node.prop<string>('data_type'))
        const domain = domainFromRNA(p.node.prop<string>('domain'))
        const selection = p.field('Selection')
        let field = p.field('Value')
        // Float2, Float4, ColorByte and Int8 are stored converted from the socket's type (:121).
        if (field.type !== dataType) field = convertField(field, dataType)
        let failure = false
        if (domain === AttrDomain.Instance) {
            if (geometry.instances) {
                if (name === 'position' && dataType === 'float3') {
                    throw new Error('Store Named Attribute: writing "position" on instances is not ported yet')
                }
                if (!captureFieldsOnGeometry(geometry, 'instances', [name], domain, selection, [field])) {
                    if (geometry.domainSize('instances', domain) !== 0) failure = true
                }
            }
        } else {
            geometry = foreachRealGeometry(geometry, g => {
                for (const type of ['mesh', 'pointcloud', 'curves'] as ComponentType[]) {
                    if (!g.has(type)) continue
                    if (!captureFieldsOnGeometry(g, type, [name], domain, selection, [field])) {
                        if (g.domainSize(type, domain) !== 0) failure = true
                    }
                }
            }, p.options.scene)
        }
        if (failure) p.warn(`Failed to write to attribute "${name}" with domain "${p.node.prop('domain')}" and type "${p.node.prop('data_type')}"`)
        p.set('Geometry', geometry)
    },
})

registerNodeType({
    idname: 'GeometryNodeInputNamedAttribute',
    label: 'Named Attribute',
    properties: {data_type: 'FLOAT'},
    declare(b, node) {
        b.input('STRING', 'Name')
        b.output(socketTypeFromRNA(node.prop<string>('data_type')), 'Attribute').field()
        b.output('BOOLEAN', 'Exists').field()
    },
    // `node_geo_exec` (:66).
    execute(p) {
        const name = p.string('Name')
        if (!name) return
        if (!allowProceduralAttributeAccess(name)) {
            p.warn('Procedural access to this attribute is not allowed')
            return
        }
        if (isAnonymousAttributeName(name)) {
            p.warn('Anonymous attributes cannot be accessed by name')
            return
        }
        const type = dataTypeFromRNA(p.node.prop<string>('data_type'))
        p.set('Attribute', GField.fromInput(new AttributeFieldInput(name, type)))
        p.set('Exists', GField.fromInput(new AttributeExistsFieldInput(name)))
    },
})

registerNodeType({
    idname: 'GeometryNodeInputPosition',
    label: 'Position',
    declare(b) {
        b.output('VECTOR', 'Position').field()
    },
    execute(p) {
        p.set('Position', GField.fromInput(new AttributeFieldInput('position', 'float3')))
    },
})

registerNodeType({
    idname: 'GeometryNodeInputIndex',
    label: 'Index',
    declare(b) {
        b.output('INT', 'Index').field()
    },
    execute(p) {
        p.set('Index', GField.fromInput(new IndexFieldInput()))
    },
})

registerNodeType({
    idname: 'GeometryNodeInputID',
    label: 'ID',
    declare(b) {
        b.output('INT', 'ID').field()
    },
    execute(p) {
        p.set('ID', GField.fromInput(new IDAttributeFieldInput()))
    },
})

registerNodeType({
    idname: 'GeometryNodeInputNormal',
    label: 'Normal',
    properties: {legacy_corner_normals: false},
    declare(b) {
        b.output('VECTOR', 'Normal').field()
        b.output('VECTOR', 'True Normal').field()
    },
    execute(p) {
        if (p.node.prop<boolean>('legacy_corner_normals')) throw new Error('Normal: legacy corner normals are not ported yet')
        p.set('Normal', GField.fromInput(new NormalFieldInput()))
        if (p.outputUsed('True Normal')) throw new Error('Normal: the True Normal output is not ported yet')
    },
})

export {GeometrySet}

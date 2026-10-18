/**
 * Capture Attribute (`node_geo_attribute_capture.cc`): evaluates its item fields (and the selection) on a domain
 * of the geometry, stores them as anonymous attributes and outputs fields reading them back.
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {captureFieldsOnGeometry, GField} from '../../fields'
import {AttributeFieldInput} from '../../fields/inputs'
import {ComponentType, GeometrySet} from '../../geometry/GeometrySet'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {registerNodeType, NodeInstance} from '../../runtime/registry'
import {domainFromRNA, socketTypeFromRNA} from '../attributeTypes'
import {socketDataType} from '../../runtime/declaration'

interface CaptureItem {
    name: string
    dataType: string
    input: string
    output: string
}

/**
 * `capture_items` with `CaptureAttributeItemsAccessor::input_socket_identifier_for_item` /
 * `output_socket_identifier_for_item` (`geometry/include/NOD_geo_capture_attribute.hh`): identifier 0 is
 * `Value` / `Attribute`, others `Value_<id>` / `Attribute_<id>`. Items without an `identifier` (dumps: the RNA
 * item has none) take their position, which is what a node whose items were only ever appended has.
 */
function captureItems(node: NodeInstance): CaptureItem[] {
    return node.items('capture_items').map((item, i) => {
        const id = typeof item.identifier === 'number' ? item.identifier : i
        return {
            name: String(item.name ?? ''),
            dataType: String(item.data_type ?? 'FLOAT'),
            input: id === 0 ? 'Value' : `Value_${id}`,
            output: id === 0 ? 'Attribute' : `Attribute_${id}`,
        }
    })
}

/**
 * Components captured on (:180, grease pencil is not a component here). `clean_unused_attributes` (:117) only removes
 * anonymous attributes nothing downstream reads; this runtime keeps them (plan §1.5), which changes no value.
 */
const MESH_LIKE: ComponentType[] = ['mesh', 'pointcloud', 'curves']

registerNodeType({
    idname: 'GeometryNodeCaptureAttribute',
    label: 'Capture Attribute',
    // `node_init` (:84): point domain, no items.
    properties: {domain: 'POINT', active_index: 0},
    enums: {domain: ['POINT', 'EDGE', 'FACE', 'CORNER', 'CURVE', 'INSTANCE', 'LAYER']},
    // `node_declare` (:31).
    declare(b, node) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.output('BOOLEAN', 'Selection').field()
        for (const item of captureItems(node)) {
            const type = socketTypeFromRNA(item.dataType)
            b.input(type, item.name, item.input).field()
            b.output(type, item.name, item.output).field()
        }
        b.input('CUSTOM', '', '__extend__')
        b.output('CUSTOM', '', '__extend__')
    },
    // `node_internally_linked_input` (:277): the input at the output's index.
    internallyLinkedInput(node, output) {
        if (output === 'Geometry' || output === 'Selection') return output
        return captureItems(node).find(i => i.output === output)?.input
    },
    // `node_geo_exec` (:145).
    execute(p) {
        const geometry = p.geometry('Geometry')
        if (!p.outputUsed('Geometry')) {
            p.warn('The attribute output cannot be used without the geometry output')
            return
        }
        const domainName = p.node.prop<string>('domain')
        if (domainName === 'LAYER') throw new Error('Capture Attribute: the grease pencil layer domain is not supported (no grease pencil component)')
        const domain = domainFromRNA(domainName)
        const selection = p.field('Selection')
        const fields: GField[] = []
        const names: string[] = []
        const outputs: {id: string, name: string, field: GField}[] = []
        for (const item of captureItems(p.node)) {
            if (!p.outputUsed(item.output)) continue
            const field = p.field(item.input)
            const name = p.anonymousName(item.output)
            fields.push(field)
            names.push(name)
            outputs.push({id: item.output, name, field})
        }
        if (p.outputUsed('Selection')) {
            const name = p.anonymousName('Selection')
            fields.push(selection)
            names.push(name)
            outputs.push({id: 'Selection', name, field: selection})
        }
        if (!fields.length) {
            p.set('Geometry', geometry)
            return
        }
        const captureOn = (g: GeometrySet, type: ComponentType) => {
            captureFieldsOnGeometry(g, type, names, domain, selection, fields)
        }
        let out = geometry
        if (domain === AttrDomain.Instance) {
            // Only the top level of instances (:173).
            if (geometry.instances) captureOn(geometry, 'instances')
        } else {
            out = foreachRealGeometry(geometry, g => {
                for (const type of MESH_LIKE) if (g.has(type)) captureOn(g, type)
            }, p.options.scene)
        }
        p.set('Geometry', out)
        for (const o of outputs) {
            const dt = socketDataType(p.node.decl.outputs.find(d => d.identifier === o.id)!.type)!
            p.set(o.id, GField.fromInput(new AttributeFieldInput(o.name, dt)))
        }
    },
})

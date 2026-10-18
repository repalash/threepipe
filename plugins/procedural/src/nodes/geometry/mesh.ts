/**
 * Mesh state nodes: Set Shade Smooth (`node_geo_set_shade_smooth.cc`), Is Face Smooth
 * (`node_geo_input_face_smooth.cc`), Is Edge Smooth (`node_geo_input_edge_smooth.cc`).
 */

import {MeshData} from '@threepipe/mesh-kernel'
import {captureFieldsOnGeometry, evaluateConstantField, GField, invertBooleanField} from '../../fields'
import {AttributeFieldInput} from '../../fields/inputs'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {registerNodeType} from '../../runtime/registry'
import {domainFromRNA} from '../attributeTypes'

/** `try_removing_sharp_attribute` (:43): constant selection/sharpness need no per-element write. */
function tryRemovingSharpAttribute(mesh: MeshData, name: string, selection: GField, sharpness: GField): boolean {
    if (selection.dependsOnInput || sharpness.dependsOnInput) return false
    if (!evaluateConstantField(selection)[0]) return true
    if (evaluateConstantField(sharpness)[0]) return false
    mesh.attributes.remove(name)
    return true
}

registerNodeType({
    idname: 'GeometryNodeSetShadeSmooth',
    label: 'Set Shade Smooth',
    properties: {domain: 'FACE'},
    // rna_enum_attribute_domain_edge_face_items.
    enums: {domain: ['EDGE', 'FACE']},
    declare(b) {
        b.input('GEOMETRY', 'Mesh', 'Geometry')
        b.output('GEOMETRY', 'Mesh', 'Geometry')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('BOOLEAN', 'Shade Smooth').default(true).field()
    },
    // `node_geo_exec` (:83) and `set_sharp` (:61).
    execute(p) {
        const domainName = p.node.prop<string>('domain')
        const domain = domainFromRNA(domainName)
        const name = domainName === 'FACE' ? 'sharp_face' : 'sharp_edge'
        const selection = p.field('Selection')
        const sharpness = invertBooleanField(p.field('Shade Smooth'))
        const out = foreachRealGeometry(p.geometry('Geometry'), g => {
            const mesh = g.meshForWrite()
            if (!mesh) return
            if (mesh.attributes.domainSizes[domain] === 0) return
            if (tryRemovingSharpAttribute(mesh, name, selection, sharpness)) return
            captureFieldsOnGeometry(g, 'mesh', [name], domain, selection, [sharpness])
        }, p.options.scene)
        p.set('Geometry', out)
    },
})

registerNodeType({
    idname: 'GeometryNodeInputShadeSmooth',
    label: 'Is Face Smooth',
    declare(b) {
        b.output('BOOLEAN', 'Smooth').field()
    },
    execute(p) {
        p.set('Smooth', invertBooleanField(GField.fromInput(new AttributeFieldInput('sharp_face', 'bool'))))
    },
})

registerNodeType({
    idname: 'GeometryNodeInputEdgeSmooth',
    label: 'Is Edge Smooth',
    declare(b) {
        b.output('BOOLEAN', 'Smooth').field()
    },
    execute(p) {
        p.set('Smooth', invertBooleanField(GField.fromInput(new AttributeFieldInput('sharp_edge', 'bool'))))
    },
})


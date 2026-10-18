/**
 * Separate Geometry (`node_geo_separate_geometry.cc`) and Delete Geometry (`node_geo_delete_geometry.cc`),
 * on `geometry::separate_geometry` (`src/geometry/separateGeometry.ts`).
 */

import {elementwise, FieldOperation, GField} from '../../fields'
import {GeometrySet} from '../../geometry/GeometrySet'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {DeleteGeometryMode, separateGeometry} from '../../geometry/separateGeometry'
import type {ExecParams} from '../../runtime/params'
import {registerNodeType} from '../../runtime/registry'
import {domainFromRNA} from '../attributeTypes'

/** `fn::invert_boolean_field` (`functions/intern/field.cc`): a "Not" operation. */
const notFn = elementwise('Not', ['bool'], ['bool'], ([a], [o]) => { o[0] = a[0] ? 0 : 1 })
const invert = (f: GField) => new FieldOperation(notFn, [f]).output(0)

// rna_enum_attribute_domain_without_corner_items.
const DOMAINS = ['POINT', 'EDGE', 'FACE', 'CURVE', 'INSTANCE', 'LAYER']

function separate(p: ExecParams, geometry: GeometrySet, domainName: string, mode: DeleteGeometryMode, selection: GField): GeometrySet {
    if (domainName === 'LAYER') throw new Error('procedural: grease pencil layers are not a geometry component here')
    const domain = domainFromRNA(domainName)
    if (domainName === 'INSTANCE') {
        // Only top-level instances.
        separateGeometry(geometry, domain, mode, selection)
        return geometry
    }
    return foreachRealGeometry(geometry, g => { separateGeometry(g, domain, mode, selection) }, p.options.scene)
}

registerNodeType({
    idname: 'GeometryNodeSeparateGeometry',
    label: 'Separate Geometry',
    properties: {domain: 'POINT'},
    enums: {domain: DOMAINS},
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.output('GEOMETRY', 'Selection')
        b.output('GEOMETRY', 'Inverted')
    },
    // `node_geo_exec` (:51).
    execute(p) {
        const domain = p.node.prop<string>('domain')
        const selection = p.field('Selection')
        if (p.outputUsed('Selection')) p.set('Selection', separate(p, p.geometry('Geometry'), domain, 'ALL', selection))
        if (p.outputUsed('Inverted')) p.set('Inverted', separate(p, p.geometry('Geometry'), domain, 'ALL', invert(selection)))
    },
})

registerNodeType({
    idname: 'GeometryNodeDeleteGeometry',
    label: 'Delete Geometry',
    properties: {mode: 'ALL', domain: 'POINT'},
    enums: {mode: ['ALL', 'EDGE_FACE', 'ONLY_FACE'], domain: DOMAINS},
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
    },
    // `node_geo_exec` (:57): the kept part is the inverted selection.
    execute(p) {
        const selection = invert(p.field('Selection'))
        p.set('Geometry', separate(p, p.geometry('Geometry'), p.node.prop<string>('domain'), p.node.prop<DeleteGeometryMode>('mode'), selection))
    },
})

/**
 * Sort Elements (`node_geo_sort_elements.cc`): reorders one domain of each real geometry (or the top-level
 * instances) by group ID, then sort weight, keeping unselected elements in place (`geometry/intern/reorder.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation, GField} from '../../fields'
import type {ComponentType} from '../../geometry/GeometrySet'
import {GeometrySet} from '../../geometry/GeometrySet'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {reorderCurves, reorderInstances, reorderMesh, reorderPoints, sortIndicesByWeights, SUPPORTED_REORDERING} from '../../geometry/reorder'
import {registerNodeType} from '../../runtime/registry'
import {domainFromRNA} from '../attributeTypes'

/** `sorted_indices` (:37). */
function sortedIndices(context: FieldContext, size: number, selection: GField, group: GField, weight: GField): Int32Array | undefined {
    if (size === 0) return undefined
    const e = new FieldEvaluation(context, size)
    const sel = e.evaluate(selection)
    const mask: number[] = []
    for (let i = 0; i < size; i++) if (sel.get(i)) mask.push(i)
    return sortIndicesByWeights(size, mask, e.evaluate(group), e.evaluate(weight))
}

registerNodeType({
    idname: 'GeometryNodeSortElements',
    label: 'Sort Elements',
    properties: {domain: 'POINT'},
    enums: {domain: ['POINT', 'EDGE', 'FACE', 'CURVE', 'INSTANCE']},
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('INT', 'Group ID').hideValue().field()
        b.input('FLOAT', 'Sort Weight').hideValue().field()
    },
    execute(p) {
        const selection = p.field('Selection'), group = p.field('Group ID'), weight = p.field('Sort Weight')
        const domain = domainFromRNA(p.node.prop<string>('domain'))
        let g = p.geometry('Geometry')
        if (domain === AttrDomain.Instance) {
            const inst = g.instances
            if (inst) {
                const indices = sortedIndices(new FieldContext('instances', inst, AttrDomain.Instance), inst.instancesNum, selection, group, weight)
                if (indices) {
                    g = g.copy()
                    g.setInstances(reorderInstances(inst, indices))
                }
            }
        } else {
            g = foreachRealGeometry(g, real => {
                for (const type of ['mesh', 'curves', 'pointcloud', 'instances'] as const) {
                    if (!SUPPORTED_REORDERING[type].includes(domain)) continue
                    const component = componentOf(real, type)
                    if (!component) continue
                    const size = component.attributes.domainSizes[domain] ?? 0
                    const indices = sortedIndices(new FieldContext(type as ComponentType, component, domain), size, selection, group, weight)
                    if (!indices) continue
                    if (type === 'mesh') real.setMesh(reorderMesh(real.mesh!, indices, domain))
                    else if (type === 'curves') real.setCurves(reorderCurves(real.curves!, indices))
                    else if (type === 'pointcloud') real.setPointCloud(reorderPoints(real.pointCloud!, indices))
                    else real.setInstances(reorderInstances(real.instances!, indices))
                }
            }, p.options.scene)
        }
        p.set('Geometry', g)
    },
})

function componentOf(g: GeometrySet, type: 'mesh' | 'curves' | 'pointcloud' | 'instances') {
    return type === 'mesh' ? g.mesh : type === 'curves' ? g.curves : type === 'pointcloud' ? g.pointCloud : g.instances
}

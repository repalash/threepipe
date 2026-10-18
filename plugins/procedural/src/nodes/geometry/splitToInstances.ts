/**
 * Split to Instances (`node_geo_split_to_instances.cc`): one instance per group ID of the selected elements, each
 * holding the elements of its group (mesh, point cloud, curves, or the instances themselves). Instance order is the
 * order of `blender::Map<int, GeometrySet>` (`src/blender/map.ts`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {AttributeFieldInput, FieldContext, FieldEvaluation, GField} from '../../fields'
import {BlenderIntMap} from '../../blender/map'
import {Instances, PointCloud} from '../../geometry/components'
import {GeometrySet} from '../../geometry/GeometrySet'
import type {ComponentType} from '../../geometry/GeometrySet'
import {meshCopySelection} from '../../geometry/meshCopySelection'
import {gatherAttributes} from '../../geometry/meshToCurve'
import {removeUnusedReferences} from '../../geometry/realizeInstances'
import {curvesCopyCurveSelection, curvesCopyPointSelection} from '../../geometry/separateGeometry'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'
import {domainFromRNA} from '../attributeTypes'

type Groups = BlenderIntMap<GeometrySet>

/**
 * `do_common_split` (:62): the selected elements by group ID (`IndexMask::from_group_ids`: groups in order of first
 * appearance), each group's geometry created in the map. Undefined when nothing is selected.
 */
function commonSplit(type: ComponentType, component: NonNullable<GeometrySet['mesh']> | PointCloud | NonNullable<GeometrySet['curves']> | Instances,
    domain: AttrDomain, selection: GField, groupId: GField, groups: Groups): {ids: number[], masks: number[][]} | undefined {
    const size = component.attributes.domainSizes[domain] ?? 0
    const e = new FieldEvaluation(new FieldContext(type, component, domain), size)
    const sel = e.evaluate(selection), ids = e.evaluate(groupId)
    const index = new Map<number, number>()
    const out = {ids: [] as number[], masks: [] as number[][]}
    for (let i = 0; i < size; i++) {
        if (!sel.get(i)) continue
        const id = ids.get(i)
        let g = index.get(id)
        if (g === undefined) {
            index.set(id, g = out.ids.length)
            out.ids.push(id)
            out.masks.push([])
        }
        out.masks[g].push(i)
    }
    if (!out.ids.length) return undefined
    // `ensure_group_geometries` (:46).
    for (const id of out.ids) groups.lookupOrAdd(id, () => new GeometrySet())
    return out
}

registerNodeType({
    idname: 'GeometryNodeSplitToInstances',
    label: 'Split to Instances',
    properties: {domain: 'POINT'},
    enums: {domain: ['POINT', 'EDGE', 'FACE', 'CURVE', 'INSTANCE', 'LAYER']},
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('INT', 'Group ID').hideValue().field()
        b.output('GEOMETRY', 'Instances')
        b.output('INT', 'Group ID').field()
    },
    execute(p) {
        const domain = domainFromRNA(p.node.prop<string>('domain'))
        const src = p.geometry('Geometry')
        const selection = p.field('Selection'), groupId = p.field('Group ID')
        const groups: Groups = new BlenderIntMap<GeometrySet>()
        const mesh = src.mesh
        if (mesh && (domain === AttrDomain.Point || domain === AttrDomain.Edge || domain === AttrDomain.Face)) {
            // `split_mesh_groups` (:82).
            const split = commonSplit('mesh', mesh, domain, selection, groupId, groups)
            split?.ids.forEach((id, g) => {
                const sel = new Uint8Array(mesh.attributes.domainSizes[domain])
                for (const i of split.masks[g]) sel[i] = 1
                const result = meshCopySelection(mesh, GVArray.fromArray('bool', sel), domain)
                const geometry = groups.lookup(id)!
                if (result === undefined) geometry.setShared('mesh', src)
                else geometry.setMesh(result ?? undefined)
            })
        }
        const pc = src.pointCloud
        if (pc && domain === AttrDomain.Point) {
            // `split_pointcloud_groups` (:127).
            const split = commonSplit('pointcloud', pc, AttrDomain.Point, selection, groupId, groups)
            split?.ids.forEach((id, g) => {
                const out = new PointCloud(split.masks[g].length)
                gatherAttributes(pc.accessor(), AttrDomain.Point, out.accessor(), AttrDomain.Point, new Set(), split.masks[g])
                groups.lookup(id)!.setPointCloud(out)
            })
        }
        const curves = src.curves
        if (curves && (domain === AttrDomain.Point || domain === AttrDomain.Curve)) {
            // `split_curve_groups` (:159): `curves_new_nomain` (no material slots).
            const split = commonSplit('curves', curves, domain, selection, groupId, groups)
            split?.ids.forEach((id, g) => {
                const out = domain === AttrDomain.Point ? curvesCopyPointSelection(curves, split.masks[g]) : curvesCopyCurveSelection(curves, split.masks[g])
                out.materials = []
                groups.lookup(id)!.setCurves(out)
            })
        }
        const inst = src.instances
        if (inst && domain === AttrDomain.Instance) {
            // `split_instance_groups` (:193).
            const split = commonSplit('instances', inst, AttrDomain.Instance, selection, groupId, groups)
            split?.ids.forEach((id, g) => {
                const out = new Instances(split.masks[g].length, inst.transformsFirst)
                for (const ref of inst.references) out.addReference(ref)
                gatherAttributes(inst.accessor(), AttrDomain.Instance, out.accessor(), AttrDomain.Instance, new Set(), split.masks[g])
                removeUnusedReferences(out)
                groups.lookup(id)!.setInstances(out)
            })
        }
        // `node_geo_exec` (:224): identity transforms, handles in map order.
        const items = [...groups.items()]
        const dst = new Instances(items.length, true)
        const groupName = p.outputUsed('Group ID') ? p.anonymousName('Group ID') : undefined
        if (groupName) dst.accessor().add(groupName, AttrDomain.Instance, 'int32', Int32Array.from(items, ([id]) => id))
        const t = dst.transforms
        for (let i = 0; i < items.length; i++) t[i * 16] = t[i * 16 + 5] = t[i * 16 + 10] = t[i * 16 + 15] = 1
        dst.referenceHandles.set(items.map((_, i) => i))
        for (const [, geometry] of items) dst.addReference({type: 'geometry', geometry})
        const out = new GeometrySet()
        out.setInstances(dst)
        out.name = src.name
        p.set('Instances', out)
        if (groupName) p.set('Group ID', GField.fromInput(new AttributeFieldInput(groupName, 'int32')))
    },
})

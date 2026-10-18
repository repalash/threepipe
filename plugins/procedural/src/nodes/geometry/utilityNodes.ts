/**
 * Small geometry nodes: Set Geometry Name (`node_geo_set_geometry_name.cc`), Get Geometry Component
 * (`node_geo_get_geometry_component.cc`), Warning (`node_geo_warning.cc`), Rename Attribute
 * (`node_geo_rename_attribute.cc` with `rename_attributes`, `attribute_storage_access.cc:290`) and Instance Bounds
 * (`node_geo_input_instance_bounds.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext, FieldInput, GField} from '../../fields'
import type {AttributeAccessor} from '../../geometry/attributeAccessor'
import {ComponentType, GeometrySet} from '../../geometry/GeometrySet'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {computeBoundboxWithoutInstances} from '../../geometry/meshBounds'
import {referenceToGeometry} from '../../geometry/realizeInstances'
import {GVArray} from '../../geometry/varray'
import type {SceneProvider} from '../../runtime/context'
import {registerNodeType} from '../../runtime/registry'

registerNodeType({
    idname: 'GeometryNodeSetGeometryName',
    label: 'Set Geometry Name',
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        b.input('STRING', 'Name')
    },
    execute(p) {
        const g = p.geometry('Geometry')
        g.name = p.string('Name')
        p.set('Geometry', g)
    },
})

/** `rna_enum_geometry_component_type_items` names (menu values) to component types; Edit and Volume have none here. */
const COMPONENT_TYPES: Record<string, ComponentType | null> = {
    'Mesh': 'mesh', 'Point Cloud': 'pointcloud', 'Curve': 'curves', 'Instances': 'instances', 'Volume': null, 'Grease Pencil': null,
}

registerNodeType({
    idname: 'GeometryNodeGetGeometryComponent',
    label: 'Get Geometry Component',
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Component')
        b.output('BOOLEAN', 'Exists')
        b.input('MENU', 'Type').default('Mesh')
        b.input('BOOLEAN', 'Remove').default(true)
    },
    // `node_geo_exec` (:41).
    execute(p) {
        const g = p.geometry('Geometry')
        const name = p.string('Type')
        if (!(name in COMPONENT_TYPES)) throw new Error(`Get Geometry Component: '${name}' is not a menu item`)
        const type = COMPONENT_TYPES[name]
        const component = new GeometrySet()
        component.name = g.name
        let exists = false
        if (type && g.has(type)) {
            component.setShared(type, g)
            exists = true
        }
        if (type && p.bool('Remove')) g.remove(type)
        p.set('Geometry', g)
        p.set('Component', component)
        p.set('Exists', GField.constant('bool', [exists ? 1 : 0]))
    },
})

registerNodeType({
    idname: 'GeometryNodeWarning',
    label: 'Warning',
    // `custom1` is the warning type (Error, Warning, Info).
    properties: {warning_type: 'ERROR'},
    enums: {warning_type: ['ERROR', 'WARNING', 'INFO']},
    declare(b) {
        b.input('BOOLEAN', 'Show').default(true).hideValue()
        b.output('BOOLEAN', 'Show')
        b.input('STRING', 'Message')
    },
    // `LazyFunctionForWarningNode::execute_impl` (:44): the message is only requested when shown.
    execute(p) {
        const show = p.get('Show')
        if (p.bool('Show')) p.warn(p.string('Message'))
        p.set('Show', show)
    },
})

/**
 * `rename_attributes` (`attribute_storage_access.cc:290`) on one component's attributes: returns the names that
 * failed. Vertex groups are plain attributes here (`procedural-vertex-groups.md`).
 */
function renameAttributes(attrs: AttributeAccessor, renames: [string, string][], overwrite: boolean): string[] {
    const storage = attrs.storage
    const failed: string[] = []
    const toRemove: string[] = []
    const map: [string, string][] = []
    for (const [oldName, newName] of renames) {
        const old = storage.get(oldName)
        if (!newName || !old) {
            failed.push(oldName)
            continue
        }
        const oldInfo = attrs.builtins[oldName]
        if (oldInfo && oldInfo.deletable === false) {
            failed.push(oldName)
            continue
        }
        const newInfo = attrs.builtins[newName]
        if (newInfo && (newInfo.domain !== old.domain || newInfo.type !== old.type)) {
            failed.push(oldName)
            continue
        }
        if (overwrite) toRemove.push(newName)
        else if (storage.get(newName)) {
            failed.push(oldName)
            continue
        }
        map.push([oldName, newName])
    }
    for (const name of toRemove) storage.remove(name)
    // `AttributeStorage::rename`: every mapped attribute keeps its data under the new name.
    const layers = map.map(([o, n]) => ({layer: storage.get(o), name: n}))
    for (const [o] of map) storage.remove(o)
    for (const {layer, name} of layers) {
        if (!layer) continue
        storage.add({name, domain: layer.domain, type: layer.type}).data.set(layer.data)
    }
    return failed
}

registerNodeType({
    idname: 'GeometryNodeRenameAttribute',
    label: 'Rename Attribute',
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        b.input('MENU', 'Mode').default('Single')
        b.input('STRING', 'Old')
        b.input('STRING', 'New')
        b.input('BOOLEAN', 'Overwrite').default(false)
    },
    // `node_geo_exec` (:47).
    execute(p) {
        const g = p.geometry('Geometry')
        const mode = p.string('Mode')
        if (mode !== 'Single' && mode !== 'Prefix') throw new Error(`Rename Attribute: '${mode}' is not a menu item`)
        const oldName = p.string('Old'), newName = p.string('New'), overwrite = p.bool('Overwrite')
        if (!oldName || oldName === newName) return p.set('Geometry', g)
        let notFound = false
        const failures: string[] = []
        const out = foreachRealGeometry(g, real => {
            for (const type of ['mesh', 'pointcloud', 'curves', 'instances'] as const) {
                if (!real.has(type)) continue
                const read = real.attributes(type)!
                const renames: [string, string][] = []
                if (mode === 'Single') {
                    if (!read.contains(oldName)) {
                        notFound = true
                        continue
                    }
                    renames.push([oldName, newName])
                } else {
                    for (const name of read.names()) if (name.startsWith(oldName)) renames.push([name, newName + name.slice(oldName.length)])
                }
                if (!renames.length) continue
                const write = real.attributesForWrite(type)!
                for (const f of renameAttributes(write, renames, overwrite)) failures.push(`Failed to rename attribute: '${f}' to '${renames.find(r => r[0] === f)![1]}'`)
            }
        }, p.options.scene)
        if (notFound) p.warn(`Attribute not found: '${oldName}'`)
        for (const f of failures) p.warn(f)
        p.set('Geometry', out)
    },
})

/** `InstanceBoundsField` (:23): the bounds of each instance's referenced geometry, without nested instances. */
class InstanceBoundsInput extends FieldInput {
    constructor(readonly useRadius: boolean, readonly max: boolean, readonly scene: SceneProvider | undefined) {
        super('float3', max ? 'Max' : 'Min')
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const inst = context.instances
        if (!inst || context.domain !== AttrDomain.Instance) return undefined
        const handles = inst.referenceHandles
        const used = new Uint8Array(inst.references.length)
        for (let i = 0; i < inst.instancesNum; i++) if (handles[i] < used.length) used[handles[i]] = 1
        const bounds = inst.references.map((ref, r) => {
            if (!used[r]) return [0, 0, 0]
            // Collections give nothing (`Type::Collection: break`).
            const geometry = ref.type === 'collection' ? new GeometrySet() : referenceToGeometry(ref, this.scene)
            const b = computeBoundboxWithoutInstances(geometry, this.useRadius)
            return b ? (this.max ? b.max : b.min) : [0, 0, 0]
        })
        const out = new Float32Array(inst.instancesNum * 3)
        for (let i = 0; i < inst.instancesNum; i++) out.set(bounds[handles[i]], i * 3)
        return GVArray.fromArray('float3', out)
    }
}

registerNodeType({
    idname: 'GeometryNodeInputInstanceBounds',
    label: 'Instance Bounds',
    declare(b) {
        b.input('BOOLEAN', 'Use Radius').default(true)
        b.output('VECTOR', 'Min').field()
        b.output('VECTOR', 'Max').field()
    },
    execute(p) {
        const useRadius = p.bool('Use Radius')
        p.set('Min', GField.fromInput(new InstanceBoundsInput(useRadius, false, p.options.scene)))
        p.set('Max', GField.fromInput(new InstanceBoundsInput(useRadius, true, p.options.scene)))
    },
})

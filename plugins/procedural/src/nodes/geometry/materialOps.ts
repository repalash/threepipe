/**
 * Replace Material (`node_geo_material_replace.cc`) and Material Selection (`node_geo_material_selection.cc`).
 * Materials are slot names (`''` for an empty slot), as in `material.ts`.
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext, FieldInput, GField} from '../../fields'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'

registerNodeType({
    idname: 'GeometryNodeReplaceMaterial',
    label: 'Replace Material',
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        b.input('MATERIAL', 'Old')
        b.input('MATERIAL', 'New')
    },
    // `replace_materials` on the mesh slots of every real geometry (no grease pencil component here).
    execute(p) {
        const oldName = p.idRef('Old')?.name ?? ''
        const newName = p.idRef('New')?.name ?? ''
        p.set('Geometry', foreachRealGeometry(p.geometry('Geometry'), g => {
            const mesh = g.meshForWrite()
            if (mesh) mesh.materials = mesh.materials.map(m => (m === oldName ? newName : m))
        }, p.options.scene))
    },
})

/** `MaterialSelectionFieldInput` (:57): faces (mesh) or curves using a slot holding the material, adapted to the context. */
class MaterialSelectionInput extends FieldInput {
    constructor(readonly material: string) {
        super('bool', 'Material Selection node')
    }

    key(): string {
        return `material-selection:${this.material}`
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const owner = context.mesh ?? context.curves
        if (!owner) return undefined
        const domain = context.mesh ? AttrDomain.Face : AttrDomain.Curve
        const attrs = context.attributes()
        const size = attrs.domainSize(domain)
        // `select_by_material` (:22).
        const slots: number[] = []
        owner.materials.forEach((m, i) => { if (m === this.material) slots.push(i) })
        let selection: GVArray
        if (!slots.length) {
            selection = GVArray.fromSingle('bool', size, [0])
        } else {
            const indices = attrs.lookupOrDefault('material_index', domain, 'int32', [0])
            if (indices.isSingle) {
                selection = GVArray.fromSingle('bool', size, [slots.includes(indices.single[0]) ? 1 : 0])
            } else {
                const out = new Uint8Array(size)
                for (let i = 0; i < size; i++) out[i] = slots.includes(indices.get(i)) ? 1 : 0
                selection = GVArray.fromArray('bool', out)
            }
        }
        return attrs.adaptDomain(selection, domain, context.domain)
    }
}

registerNodeType({
    idname: 'GeometryNodeMaterialSelection',
    label: 'Material Selection',
    declare(b) {
        b.input('MATERIAL', 'Material')
        b.output('BOOLEAN', 'Selection').field()
    },
    execute(p) {
        p.set('Selection', GField.fromInput(new MaterialSelectionInput(p.idRef('Material')?.name ?? '')))
    },
})

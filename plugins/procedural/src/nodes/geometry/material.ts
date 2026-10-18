/**
 * Material nodes: Set Material (`node_geo_set_material.cc`), Set Material Index (`node_geo_set_material_index.cc`)
 * and Material Index (`node_geo_input_material_index.cc`).
 *
 * Materials are names: a mesh's / point cloud's / curves' slots are `materials`, an empty slot (`nullptr`) is `''`, and a Material
 * socket holds `{_ref: 'MATERIAL', name}` or null.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {captureFieldsOnGeometry, FieldContext, FieldEvaluation, GField} from '../../fields'
import {AttributeFieldInput} from '../../fields/inputs'
import {MeshAccessor} from '../../geometry/components'
import {ensureDefaultMaterialSlot} from '../../geometry/meshPrimitives'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {meshEnsureMaxMaterialIndex} from '../../geometry/meshRuntime'
import {registerNodeType} from '../../runtime/registry'

/** `assign_material_to_id_geometry` (`node_geo_set_material.cc:42`) for a mesh's faces. */
function assignMaterialToMesh(mesh: MeshData, selectionField: GField, material: string | null): void {
    const domainSize = mesh.facesNum
    const sel = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Face), domainSize).evaluate(selectionField)
    const selected: number[] = []
    for (let i = 0; i < domainSize; i++) if (sel.get(i)) selected.push(i)
    // :56: faces that stay unselected keep referring to the default material through an empty slot.
    if (selected.length !== domainSize) ensureDefaultMaterialSlot(mesh)
    // :62-72: `first_index_try(material)` (pointer equality; an empty slot is nullptr), else append a slot.
    const slot = material ?? ''
    // :63: the slot count before a new slot is added.
    const origMaterialsNum = mesh.materials.length
    let newIndex = mesh.materials.indexOf(slot)
    if (newIndex === -1) {
        newIndex = mesh.materials.length
        // `BKE_id_material_eval_assign(id, new_index + 1, material)` (`material.cc:882`).
        mesh.materials = [...mesh.materials, slot]
    }
    const attributes = new MeshAccessor(mesh)
    if (selected.length === domainSize) {
        // :74: and the max index cache is the new index (:76).
        attributes.remove('material_index')
        attributes.add('material_index', AttrDomain.Face, 'int32', [newIndex])
        meshEnsureMaxMaterialIndex(mesh, newIndex)
    } else {
        // :80: `lookup_or_add_for_write_span` (the built-in default 0 for a new attribute), then `masked_fill`.
        if (!attributes.contains('material_index')) attributes.add('material_index', AttrDomain.Face, 'int32')
        const data = attributes.layerForWrite('material_index')!.data
        for (const i of selected) data[i] = newIndex
        // :84: a new last slot is the largest index.
        if (newIndex === origMaterialsNum) meshEnsureMaxMaterialIndex(mesh, newIndex)
    }
}

/** `BKE_id_material_eval_assign(id, 1, material)` (`material.cc:882`): slot 0, growing the list to one slot. */
function assignFirstSlot(materials: readonly string[], material: string | null): string[] {
    const out = materials.length ? materials.slice() : ['']
    out[0] = material ?? ''
    return out
}

registerNodeType({
    idname: 'GeometryNodeSetMaterial',
    label: 'Set Material',
    // `node_declare` (:21).
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('MATERIAL', 'Material')
    },
    // `node_geo_exec` (:90).
    execute(p) {
        const ref = p.idRef('Material')
        const material = ref ? ref.name : null
        const selection = p.field('Selection')
        let noFacesWarning = false
        let pointSelectionWarning = false
        let curvesSelectionWarning = false
        const out = foreachRealGeometry(p.geometry('Geometry'), g => {
            if (g.mesh) {
                if (g.mesh.facesNum === 0) {
                    if (g.mesh.vertsNum > 0) noFacesWarning = true
                } else {
                    assignMaterialToMesh(g.meshForWrite()!, selection, material)
                }
            }
            // :128-139: `BKE_id_material_eval_assign(&id, 1, material)` on point clouds and curves: the first slot, which
            // supports no selection (an info message when the selection is a field).
            if (g.pointCloud) {
                const pc = g.pointCloudForWrite()!
                pc.materials = assignFirstSlot(pc.materials, material)
                if (selection.dependsOnInput) pointSelectionWarning = true
            }
            if (g.curves) {
                const c = g.curvesForWrite()!
                c.materials = assignFirstSlot(c.materials, material)
                if (selection.dependsOnInput) curvesSelectionWarning = true
            }
        }, p.options.scene)
        if (noFacesWarning) p.warn('Mesh has no faces for material assignment')
        if (pointSelectionWarning) p.warn('Point clouds only support a single material; selection input cannot be a field')
        if (curvesSelectionWarning) p.warn('Curves only support a single material; selection input cannot be a field')
        p.set('Geometry', out)
    },
})

registerNodeType({
    idname: 'GeometryNodeSetMaterialIndex',
    label: 'Set Material Index',
    // `node_declare` (:17).
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('INT', 'Material Index').min(0).field()
    },
    // `node_geo_exec` (:52): `try_capture_field_on_geometry` on the faces of every real mesh (grease pencil is
    // not a component here).
    execute(p) {
        const selection = p.field('Selection')
        const index = p.field('Material Index')
        const out = foreachRealGeometry(p.geometry('Geometry'), g => {
            if (!g.mesh) return
            captureFieldsOnGeometry(g, 'mesh', ['material_index'], AttrDomain.Face, selection, [index])
        }, p.options.scene)
        p.set('Geometry', out)
    },
})

registerNodeType({
    idname: 'GeometryNodeInputMaterialIndex',
    label: 'Material Index',
    declare(b) {
        b.output('INT', 'Material Index').field()
    },
    // `node_geo_exec` (:14): the `material_index` attribute.
    execute(p) {
        p.set('Material Index', GField.fromInput(new AttributeFieldInput('material_index', 'int32')))
    },
})

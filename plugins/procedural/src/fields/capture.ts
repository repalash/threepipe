/**
 * Writing fields into attributes - port of `bke::try_capture_fields_on_geometry`
 * (`blenkernel/intern/geometry_fields.cc:983-1145`), used by Store Named Attribute, Capture Attribute
 * and every node that outputs an anonymous attribute.
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {DATA_TYPES} from '../geometry/dataTypes'
import {GVArray} from '../geometry/varray'
import {AttributeAccessor} from '../geometry/attributeAccessor'
import type {ComponentType, GeometrySet} from '../geometry/GeometrySet'
import {GField, elementwise, FieldOperation} from './field'
import {FieldEvaluation, evaluateConstantField} from './evaluate'
import {FieldContext} from './context'

/** `AttributeValidator::validate_field_if_necessary`: wrap the field in the built-in's validator. */
function validated(attributes: AttributeAccessor, name: string, field: GField): GField {
    const b = attributes.builtins[name]
    if (!b?.validate) return field
    const validate = b.validate
    const fn = elementwise(`${name} Validate`, [field.type], [field.type], (ins, outs) => {
        const v = validate(ins[0])
        for (let k = 0; k < v.length; k++) outs[0][k] = v[k]
    })
    return new FieldOperation(fn, [field]).output(0)
}

/**
 * `try_capture_fields_on_geometry(attributes, context, names, domain, selection, fields)`. Returns
 * false when any field could not be stored (wrong domain or type for a built-in name).
 */
export function captureFieldsOnAttributes(
    attributes: AttributeAccessor, context: FieldContext,
    names: readonly string[], domain: AttrDomain, selection: GField | undefined, fields: readonly GField[],
): boolean {
    const size = attributes.domainSize(domain)
    if (size === 0) {
        let all = true
        names.forEach((name, i) => {
            all = attributes.add(name, domain, fields[i].type) && all
        })
        return all
    }
    const evaluation = new FieldEvaluation(context, size)
    const selectionIsFull = !selection || (!selection.dependsOnInput && evaluateConstantField(selection)[0] !== 0)
    const sel = selection && !selectionIsFull ? evaluation.evaluate(selection) : undefined
    let success = true

    names.forEach((name, i) => {
        const type = fields[i].type
        const b = attributes.builtins[name]
        if (b && (b.domain !== domain || b.type !== type)) {
            success = false
            return
        }
        const field = validated(attributes, name, fields[i])
        const existing = attributes.lookupMeta(name)
        const values = evaluation.evaluate(field)
        const c = DATA_TYPES[type].components

        if (existing && existing.domain === domain && existing.type === type) {
            // Write into the existing attribute, selected elements only.
            const layer = attributes.layerForWrite(name)!
            const src = values.materialize()
            if (!sel) {
                layer.data = (src === values.data ? src.slice() : src) as never
            } else {
                for (let e = 0; e < size; e++) if (sel.get(e)) for (let k = 0; k < c; k++) layer.data[e * c + k] = src[e * c + k]
            }
            return
        }

        // New array: start from the old values (or the default) when only some elements are written
        // (`initialize_new_data`, :955).
        let data: ArrayLike<number> & {length: number}
        if (!selectionIsFull) {
            const init = (b ? GVArray.fromSingle(type, size, attributes.builtinDefault(name)!) : undefined) ??
                attributes.lookup(name, domain, type) ?? GVArray.fromDefault(type, size)
            const base = init.materialize().slice()
            const src = values.materialize()
            for (let e = 0; e < size; e++) if (sel!.get(e)) for (let k = 0; k < c; k++) base[e * c + k] = src[e * c + k]
            data = base
        } else {
            const m = values.materialize()
            data = m === values.data ? m.slice() : m
        }
        attributes.remove(name)
        if (!attributes.add(name, domain, type, data as never)) success = false
    })
    return success
}

/** `try_capture_fields_on_geometry(component, names, domain, selection, fields)` on one component of a set. */
export function captureFieldsOnGeometry(
    geometry: GeometrySet, type: ComponentType,
    names: readonly string[], domain: AttrDomain, selection: GField | undefined, fields: readonly GField[],
): boolean {
    const attributes = geometry.attributesForWrite(type)
    if (!attributes) return false
    const component = geometry.get(type)!
    const context = new FieldContext(type, component, domain)
    return captureFieldsOnAttributes(attributes, context, names, domain, selection, fields)
}

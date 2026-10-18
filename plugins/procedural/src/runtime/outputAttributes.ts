/**
 * A nodes modifier's output attributes (`store_output_attributes`, `nodes/intern/geometry_nodes_execute.cc:511`):
 * each field output of the group with an attribute name set on the modifier is evaluated on the output geometry and
 * stored under that name, on the output's `attribute_domain` - first on the top-level instances, then on every real
 * geometry (mesh, point cloud, curves).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation, GField} from '../fields'
import {DATA_TYPES, DataType, TypedArray, allocate} from '../geometry/dataTypes'
import {ComponentType, GeometrySet} from '../geometry/GeometrySet'
import {foreachRealGeometry} from '../geometry/joinGeometries'
import {allowProceduralAttributeAccess} from '../nodes/attributeTypes'
import type {SceneProvider} from './context'
import type {SocketValue} from './values'

export interface OutputAttributeInfo {
    field: GField
    name: string
    domain: AttrDomain
}

interface ToStore {
    type: ComponentType
    domain: AttrDomain
    name: string
    dataType: DataType
    data: TypedArray
}

/** `compute_attributes_to_store` (:410): all values are computed before the geometry changes. */
function computeAttributesToStore(geometry: GeometrySet, byDomain: Map<AttrDomain, OutputAttributeInfo[]>, types: ComponentType[]): ToStore[] {
    const out: ToStore[] = []
    for (const type of types) {
        if (!geometry.has(type)) continue
        const attributes = geometry.attributes(type)!
        const component = geometry.get(type)
        for (const [domain, infos] of byDomain) {
            if (!attributes.supportsDomain(domain)) continue
            const size = attributes.domainSize(domain)
            const evaluation = new FieldEvaluation(new FieldContext(type, component as never, domain), size)
            for (const info of infos) {
                const dataType = info.field.type
                const values = evaluation.evaluate(info.field)
                const c = DATA_TYPES[dataType].components
                const data = allocate(dataType, size, false)
                // `validate_field_if_necessary`: a built-in's validator (e.g. material_index >= 0) on every value.
                const validate = attributes.builtins[info.name]?.validate
                for (let i = 0; i < size; i++) {
                    let v = Array.from({length: c}, (_, k) => values.get(i, k))
                    if (validate) v = validate(v)
                    for (let k = 0; k < c; k++) data[i * c + k] = v[k]
                }
                out.push({type, domain, name: info.name, dataType, data})
            }
        }
    }
    return out
}

/** `store_computed_output_attributes` (:469). */
function storeComputed(geometry: GeometrySet, stores: ToStore[]): void {
    for (const s of stores) {
        const attributes = geometry.attributesForWrite(s.type)!
        const meta = attributes.lookupMeta(s.name)
        // Removing fails for non-deletable built-ins, which then keep their domain and type.
        if (meta && (meta.domain !== s.domain || meta.type !== s.dataType)) attributes.remove(s.name)
        if (attributes.add(s.name, s.domain, s.dataType, s.data)) continue
        // `lookup_or_add_for_write(...).varray.set_all`: an existing attribute of the same domain and type.
        const now = attributes.lookupMeta(s.name)
        if (!now || now.domain !== s.domain || now.type !== s.dataType) {
            throw new Error(`procedural: output attribute '${s.name}' cannot be written to the built-in ${now?.type ?? ''} attribute on another domain or type (attribute conversion is not ported)`)
        }
        attributes.layerForWrite(s.name)!.data.set(s.data)
    }
}

/**
 * Store `outputs` (interface output identifier -> attribute name, domain) of a group's evaluated outputs on its
 * output geometry. Outputs that are not fields, empty names and internal names (`allow_procedural_attribute_access`)
 * are skipped.
 */
export function storeOutputAttributes(geometry: GeometrySet, infos: OutputAttributeInfo[], scene: SceneProvider | undefined): GeometrySet {
    // `find_output_attributes_to_store` (:368): grouped by domain, in output order.
    const byDomain = new Map<AttrDomain, OutputAttributeInfo[]>()
    for (const info of infos) {
        if (!info.name || !allowProceduralAttributeAccess(info.name)) continue
        if (!byDomain.has(info.domain)) byDomain.set(info.domain, [])
        byDomain.get(info.domain)!.push(info)
    }
    if (!byDomain.size) return geometry
    let result = geometry.copy()
    // Top-level instances first.
    storeComputed(result, computeAttributesToStore(result, byDomain, ['instances']))
    if (byDomain.size === 1 && byDomain.has(AttrDomain.Instance)) return result
    result = foreachRealGeometry(result, g => {
        storeComputed(g, computeAttributesToStore(g, byDomain, ['mesh', 'pointcloud', 'curves']))
    }, scene)
    return result
}

/** The field of an output value, when it is one (`value_variant.get<fn::GField>()`). */
export function outputField(value: SocketValue): GField | undefined {
    return value instanceof GField ? value : undefined
}

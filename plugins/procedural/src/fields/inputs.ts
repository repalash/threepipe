/**
 * Built-in field inputs - ports of `blenkernel/intern/geometry_fields.cc` (`AttributeFieldInput` :404,
 * `AttributeExistsFieldInput` :442, `IDAttributeFieldInput` :531, `EvaluateAtIndexInput` :621,
 * `EvaluateOnDomainInput` :757, `NormalFieldInput` :833) and `fn::IndexFieldInput`
 * (`functions/intern/field.cc`).
 */

import {curveNormalsVArray} from '../geometry/curvesFields'
import {AttrDomain} from '@threepipe/mesh-kernel'
import {DATA_TYPES, DataType} from '../geometry/dataTypes'
import {GVArray} from '../geometry/varray'
import {meshNormalsVArray} from '../geometry/meshNormals'
import {FieldInput, GField} from './field'
import {FieldContext} from './context'
import {FieldEvaluation} from './evaluate'

/** `fn::IndexFieldInput::get_index_varray`: 0 .. size-1. */
export function indexVArray(size: number): GVArray {
    const a = new Int32Array(size)
    for (let i = 0; i < size; i++) a[i] = i
    return GVArray.fromArray('int32', a)
}

export class IndexFieldInput extends FieldInput {
    readonly indexInList = true

    constructor() {
        super('int32', 'Index')
    }

    key(): string {
        return 'index'
    }

    getVArray(context: FieldContext): GVArray {
        return indexVArray(context.size)
    }
}

/**
 * Instance positions are the translation of each transform (`bke::instance_position_varray`,
 * `instances.cc`), not a stored attribute.
 */
function instancePositions(context: FieldContext): GVArray {
    const inst = context.instances!
    const t = inst.transforms
    const out = new Float32Array(inst.instancesNum * 3)
    for (let i = 0; i < inst.instancesNum; i++) {
        out[i * 3] = t[i * 16 + 12]
        out[i * 3 + 1] = t[i * 16 + 13]
        out[i * 3 + 2] = t[i * 16 + 14]
    }
    return GVArray.fromArray('float3', out)
}

export class AttributeFieldInput extends FieldInput {
    constructor(readonly name: string, type: DataType) {
        super(type, `"${name}" attribute`)
    }

    key(): string {
        return `attr:${this.name}:${this.type}`
    }

    getVArray(context: FieldContext): GVArray | undefined {
        if (context.domain === AttrDomain.Instance && this.name === 'position' && context.instances) {
            return instancePositions(context)
        }
        return context.attributes().lookup(this.name, context.domain, this.type)
    }

    /** `AttributeFieldInput::preferred_domain`: the domain the attribute is stored on. */
    preferredDomain(context: FieldContext): AttrDomain | undefined {
        return context.attributes().lookupMeta(this.name)?.domain
    }
}

export class AttributeExistsFieldInput extends FieldInput {
    constructor(readonly name: string) {
        super('bool', `"${name}" exists`)
    }

    key(): string {
        return `exists:${this.name}`
    }

    getVArray(context: FieldContext): GVArray {
        return GVArray.fromSingle('bool', context.size, [context.attributes().contains(this.name) ? 1 : 0])
    }
}

/** `get_random_id_attribute_name` (`geometry_fields.cc:521`): "id" on points and instances only. */
export class IDAttributeFieldInput extends FieldInput {
    readonly indexInList = true

    constructor() {
        super('int32', 'ID / Index')
    }

    key(): string {
        return 'id'
    }

    getVArray(context: FieldContext): GVArray {
        if (context.domain === AttrDomain.Point || context.domain === AttrDomain.Instance) {
            const v = context.attributes().lookup('id', context.domain, 'int32')
            if (v) return v
        }
        return indexVArray(context.size)
    }
}

export class NormalFieldInput extends FieldInput {
    /** `NormalFieldInput(legacy_corner_normals, true_normals)` (`geometry_fields.cc:833`). */
    constructor(readonly legacyCornerNormals = false, readonly trueNormals = false) {
        super('float3', trueNormals ? 'True Normal' : 'Normal')
    }

    key(): string {
        return `normal:${this.legacyCornerNormals}:${this.trueNormals}`
    }

    getVArray(context: FieldContext): GVArray | undefined {
        if (context.mesh) return meshNormalsVArray(context.mesh, context.domain, this.legacyCornerNormals, this.trueNormals)
        if (context.curves) return curveNormalsVArray(context.curves, context.domain)
        return undefined
    }
}

/** `EvaluateOnDomainInput` (`geometry_fields.cc:757`). */
export class EvaluateOnDomainInput extends FieldInput {
    constructor(readonly field: GField, readonly sourceDomain: AttrDomain) {
        super(field.type, 'Evaluate on Domain')
    }

    children(): GField[] {
        return [this.field]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const attrs = context.attributes()
        if (!attrs.supportsDomain(this.sourceDomain)) return undefined
        const srcCtx = context.withDomain(this.sourceDomain)
        const values = new FieldEvaluation(srcCtx, srcCtx.size).evaluate(this.field)
        return attrs.adaptDomain(values, this.sourceDomain, context.domain)
    }
}

/** `EvaluateAtIndexInput` (`geometry_fields.cc:621`): out-of-range indices are value-initialised (:645, zeros). */
export class EvaluateAtIndexInput extends FieldInput {
    constructor(readonly indexField: GField, readonly valueField: GField, readonly valueDomain: AttrDomain) {
        super(valueField.type, 'Evaluate at Index')
    }

    children(): GField[] {
        return [this.indexField, this.valueField]
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const attrs = context.attributes()
        if (!attrs.supportsDomain(this.valueDomain)) return undefined
        const valueCtx = context.withDomain(this.valueDomain)
        const values = new FieldEvaluation(valueCtx, valueCtx.size).evaluate(this.valueField)
        const indices = new FieldEvaluation(context, context.size).evaluate(this.indexField)
        const c = DATA_TYPES[this.type].components
        const out = new DATA_TYPES[this.type].array(context.size * c)
        for (let i = 0; i < context.size; i++) {
            const j = indices.get(i)
            // `value_initialize_indices`: the typed array is already zero-filled.
            if (j >= 0 && j < values.size) for (let k = 0; k < c; k++) out[i * c + k] = values.get(j, k)
        }
        return GVArray.fromArray(this.type, out)
    }
}

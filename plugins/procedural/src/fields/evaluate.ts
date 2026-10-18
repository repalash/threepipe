/**
 * Field evaluation - `fn::evaluate_fields` (`functions/intern/field_evaluation.cc:296`) and
 * `evaluate_constant_field`.
 *
 * Within one call every field node is evaluated once (inputs are deduplicated by their `key`, which is
 * Blender's input hashing). Operations whose inputs are all single values run once and stay single,
 * as Blender's procedure executor does for constant-folded parts of a field tree. Every element is
 * computed: Blender's selection masks only skip work, and the values written to selected elements
 * do not depend on them.
 */

import {DATA_TYPES} from '../geometry/dataTypes'
import {GVArray} from '../geometry/varray'
import {FieldConstant, FieldInput, FieldNode, FieldOperation, GField} from './field'
import type {FieldContext} from './context'

export class FieldEvaluation {
    private readonly nodeResults = new Map<number, GVArray[]>()
    private readonly inputResults = new Map<string, GVArray>()

    constructor(readonly context: FieldContext | undefined, readonly size: number) {}

    evaluate(field: GField): GVArray {
        return this.evaluateNode(field.node)[field.index]
    }

    private evaluateNode(node: FieldNode): GVArray[] {
        const cached = this.nodeResults.get(node.id)
        if (cached) return cached
        let result: GVArray[]
        if (node instanceof FieldConstant) {
            result = [GVArray.fromSingle(node.type, this.size, node.value)]
        } else if (node instanceof FieldInput) {
            const key = node.key()
            let v = this.inputResults.get(key)
            if (!v) {
                const inList = this.context?.isList
                v = (this.context && (!inList || node.indexInList) ? node.getVArray(this.context) : undefined) ?? GVArray.fromDefault(node.type, this.size)
                if (v.size !== this.size) {
                    throw new Error(`procedural: field input '${node.debugName}' returned ${v.size} values for a domain of ${this.size}`)
                }
                this.inputResults.set(key, v)
            }
            result = [v]
        } else if (node instanceof FieldOperation) {
            const inputs = node.inputs.map(f => this.evaluate(f))
            const allSingle = inputs.every(v => v.isSingle)
            const n = allSingle ? 1 : this.size
            const outs = node.fn.outputs.map(t => new DATA_TYPES[t].array(n * DATA_TYPES[t].components))
            const callInputs = allSingle ? inputs.map(v => GVArray.fromSingle(v.type, 1, v.single)) : inputs
            node.fn.call(n, callInputs, outs)
            result = node.fn.outputs.map((t, i) => allSingle
                ? GVArray.fromSingle(t, this.size, Array.from(outs[i]))
                : GVArray.fromArray(t, outs[i]))
        } else {
            throw new Error('procedural: unknown field node')
        }
        this.nodeResults.set(node.id, result)
        return result
    }
}

/** `evaluate_fields(scope, fields, mask, context)`. */
export function evaluateFields(context: FieldContext, fields: readonly GField[], size = context.size): GVArray[] {
    const e = new FieldEvaluation(context, size)
    return fields.map(f => e.evaluate(f))
}

/** `evaluate_constant_field`: the value of a field that does not depend on any input. */
export function evaluateConstantField(field: GField): readonly number[] {
    if (field.dependsOnInput) throw new Error('procedural: field depends on an input; it has no constant value')
    return new FieldEvaluation(undefined, 1).evaluate(field).single
}

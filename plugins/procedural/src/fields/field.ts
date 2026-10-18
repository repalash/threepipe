/**
 * Fields - lazily evaluated functions over the elements of a geometry domain. Port of the model in
 * `functions/FN_field.hh` (`GField`, `FieldInput` :336, `FieldOperation` :384, constants) and the
 * multi-function interface it evaluates (`functions/FN_multi_function.hh`).
 *
 * A field value never holds data; it is evaluated against a {@link FieldContext} (a geometry component
 * and a domain) by `evaluateFields` (`field_evaluation.cc:296`).
 */

import {DATA_TYPES, DataType, TypedArray} from '../geometry/dataTypes'
import {GVArray} from '../geometry/varray'
import type {FieldContext} from './context'

let nextNodeId = 1

/** One node of a field tree. */
export abstract class FieldNode {
    /** Stable identity for memoisation within an evaluation. */
    readonly id = nextNodeId++
    abstract readonly dependsOnInput: boolean
}

/** A field output: node plus output index, with its value type (`GField`). */
export class GField {
    constructor(readonly node: FieldNode, readonly index: number, readonly type: DataType) {}

    get dependsOnInput(): boolean {
        return this.node.dependsOnInput
    }

    /** A field that outputs `value` everywhere (`GField(GPointer)`, constant field). */
    static constant(type: DataType, value: ArrayLike<number>): GField {
        return new GField(new FieldConstant(type, value), 0, type)
    }

    static fromInput(input: FieldInput): GField {
        return new GField(input, 0, input.type)
    }
}

export class FieldConstant extends FieldNode {
    readonly dependsOnInput = false
    readonly value: readonly number[]

    constructor(readonly type: DataType, value: ArrayLike<number>) {
        super()
        const stored = new DATA_TYPES[type].array(DATA_TYPES[type].components)
        for (let k = 0; k < stored.length; k++) stored[k] = value[k]
        this.value = Object.freeze(Array.from(stored))
    }
}

/**
 * A leaf that reads from the context (`fn::FieldInput`). `key` deduplicates equal inputs within one
 * evaluation, like Blender's `FieldInput::hash`/`is_equal_to`.
 */
export abstract class FieldInput extends FieldNode {
    readonly dependsOnInput = true

    constructor(readonly type: DataType, readonly debugName: string) {
        super()
    }

    /** `ListFieldContext::get_varray_for_input` (`list_function_eval.cc:14`): Index and ID read as the list index there. */
    readonly indexInList: boolean = false

    /** Equal keys mean equal values in the same context. Defaults to identity. */
    key(): string {
        return `#${this.id}`
    }

    /**
     * `get_varray_for_context`. Return undefined when the context has nothing for this input; the
     * evaluator then uses the type's default value (`field_evaluation.cc:103`).
     */
    abstract getVArray(context: FieldContext): GVArray | undefined

    /** Fields this input evaluates internally (`foreach_recursive_field`). */
    children(): GField[] {
        return []
    }
}

/**
 * A function of whole arrays (`mf::MultiFunction`). `call` writes every output for indices
 * `[0, size)`; inputs may be single values (read with `get(i)` - an element-wise function can use
 * {@link elementwise}).
 */
export interface MultiFunction {
    readonly name: string
    readonly inputs: readonly DataType[]
    readonly outputs: readonly DataType[]
    call(size: number, inputs: readonly GVArray[], outputs: TypedArray[]): void
}

export class FieldOperation extends FieldNode {
    readonly dependsOnInput: boolean

    constructor(readonly fn: MultiFunction, readonly inputs: readonly GField[]) {
        super()
        if (inputs.length !== fn.inputs.length) {
            throw new Error(`procedural: ${fn.name} takes ${fn.inputs.length} inputs, got ${inputs.length}`)
        }
        inputs.forEach((f, i) => {
            if (f.type !== fn.inputs[i]) throw new Error(`procedural: ${fn.name} input ${i} must be ${fn.inputs[i]}, got ${f.type}`)
        })
        this.dependsOnInput = inputs.some(f => f.dependsOnInput)
    }

    output(index = 0): GField {
        return new GField(this, index, this.fn.outputs[index])
    }
}

/**
 * Build a multi-function from a per-element body. `body(ins, outs)` reads input components from
 * `ins[i]` (arrays of the input's components) and writes output components into `outs[o]`.
 * Floating outputs are stored into Float32Arrays, so results are rounded like Blender's.
 */
export function elementwise(
    name: string,
    inputs: readonly DataType[],
    outputs: readonly DataType[],
    body: (ins: number[][], outs: number[][]) => void,
): MultiFunction {
    const inC = inputs.map(t => DATA_TYPES[t].components)
    const outC = outputs.map(t => DATA_TYPES[t].components)
    return {
        name, inputs, outputs,
        call(size, ins, outs) {
            const iv = inC.map(c => new Array<number>(c).fill(0))
            const ov = outC.map(c => new Array<number>(c).fill(0))
            for (let i = 0; i < size; i++) {
                for (let a = 0; a < ins.length; a++) for (let k = 0; k < inC[a]; k++) iv[a][k] = ins[a].get(i, k)
                body(iv, ov)
                for (let o = 0; o < outs.length; o++) for (let k = 0; k < outC[o]; k++) outs[o][i * outC[o] + k] = ov[o][k]
            }
        },
    }
}

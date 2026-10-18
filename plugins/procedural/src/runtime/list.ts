/**
 * Lists (`nodes::GList`, `NOD_geometry_nodes_list.hh`): a socket value holding `size` values of one socket type,
 * stored as an array or as one value repeated (`SingleData`). Field types store their components in a typed array;
 * other types (strings, IDs, geometry) as plain values.
 */

import {DATA_TYPES, DataType, TypedArray} from '../geometry/dataTypes'
import {GVArray} from '../geometry/varray'
import {FieldContext} from '../fields/context'
import {FieldEvaluation} from '../fields/evaluate'
import {GField, MultiFunction} from '../fields/field'
import type {SocketType} from './types'

export class GList {
    private constructor(
        /** Element type: a field data type, or the socket type for other values. */
        readonly type: DataType | SocketType,
        readonly size: number,
        /** Field types: `size * components` values (array data), or `components` values (single data). */
        readonly numbers?: TypedArray,
        readonly single = false,
        /** Other types. */
        readonly items?: readonly unknown[],
    ) {}

    static fromArray(type: DataType, data: TypedArray): GList {
        return new GList(type, data.length / DATA_TYPES[type].components, data)
    }

    static fromSingle(type: DataType, value: ArrayLike<number>, size: number): GList {
        const data = new DATA_TYPES[type].array(DATA_TYPES[type].components)
        data.set(Array.from(value))
        return new GList(type, size, data, true)
    }

    static fromItems(type: SocketType, items: readonly unknown[]): GList {
        return new GList(type, items.length, undefined, false, items)
    }

    get isData(): boolean {
        return this.numbers !== undefined
    }

    get dataType(): DataType {
        if (!this.isData) throw new Error(`procedural: a ${this.type} list has no field data type`)
        return this.type as DataType
    }

    /** Component `k` of element `i`. */
    get(i: number, k = 0): number {
        const c = DATA_TYPES[this.dataType].components
        return this.single ? this.numbers![k] : this.numbers![i * c + k]
    }

    item(i: number): unknown {
        return this.items![i]
    }

    /** As a varray of `n` elements (`add_list_to_params`): single data stays single. */
    varray(n = this.size): GVArray {
        if (this.single) return GVArray.fromSingle(this.dataType, n, Array.from(this.numbers!))
        return GVArray.fromArray(this.dataType, this.numbers!)
    }

    /** `create_repeated_list` (`list_function_eval.cc:85`): repeated up to `dstSize` elements (never shorter). */
    repeated(dstSize: number): GList {
        if (this.size >= dstSize || this.single) return this.single ? new GList(this.type, Math.max(this.size, dstSize), this.numbers, true) : this
        const c = DATA_TYPES[this.dataType].components
        const out = new DATA_TYPES[this.dataType].array(dstSize * c)
        for (let i = 0; i < dstSize; i++) for (let k = 0; k < c; k++) out[i * c + k] = this.numbers![(i % this.size) * c + k]
        return GList.fromArray(this.dataType, out)
    }
}

/** `evaluate_field_to_list` (`list_function_eval.cc:29`). */
export function evaluateFieldToList(field: GField, count: number): GList {
    const v = new FieldEvaluation(FieldContext.forList(count), count).evaluate(field)
    const c = DATA_TYPES[field.type].components
    const out = new DATA_TYPES[field.type].array(count * c)
    for (let i = 0; i < count; i++) for (let k = 0; k < c; k++) out[i * c + k] = v.get(i, k)
    return GList.fromArray(field.type, out)
}

/**
 * `execute_multi_function_on_value_variant__list` (`list_function_eval.cc:128`): the function on every element up to
 * the longest list; shorter lists repeat, single values broadcast, fields are evaluated as lists, empty lists read as
 * the type's default. Every output is a list.
 */
export function executeMultiFunctionOnLists(fn: MultiFunction, inputs: (GField | GList)[]): GList[] {
    let max = 0
    for (const v of inputs) if (v instanceof GList) max = Math.max(max, v.size)
    const params = inputs.map((v, i) => {
        const t = fn.inputs[i]
        if (v instanceof GList) {
            if (v.size === 0) return GVArray.fromSingle(t, max, DATA_TYPES[t].defaultValue)
            return v.repeated(max).varray(max)
        }
        if (v.dependsOnInput) return evaluateFieldToList(v, max).varray(max)
        return new FieldEvaluation(undefined, max).evaluate(v)
    })
    const outs = fn.outputs.map(t => new DATA_TYPES[t].array(max * DATA_TYPES[t].components))
    fn.call(max, params, outs)
    return fn.outputs.map((t, i) => GList.fromArray(t, outs[i]))
}

/** `SampleIndexFunction` (`list_function_eval.cc:42`): the list's value at each index, the default when out of range. */
export function sampleIndexFunction(list: GList): MultiFunction {
    const t = list.dataType
    const c = DATA_TYPES[t].components
    return {
        name: 'Sample Index', inputs: ['int32'], outputs: [t],
        call(size, [index], [out]) {
            for (let i = 0; i < size; i++) {
                const j = index.get(i)
                for (let k = 0; k < c; k++) out[i * c + k] = j >= 0 && j < list.size ? list.get(j, k) : DATA_TYPES[t].defaultValue[k]
            }
        },
    }
}

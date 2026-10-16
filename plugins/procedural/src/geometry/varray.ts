/**
 * A typed, possibly single-valued, array of attribute or field values - the subset of Blender's
 * `GVArray` (`blenlib/BLI_generic_virtual_array.hh`) the data model needs. Either `data` holds
 * `size * components` values, or every element equals `single`.
 *
 * Single values matter for correctness, not only speed: domain adaptation of a single value keeps it
 * single only when no loose elements could take the default instead (`mesh_attributes.cc:533`).
 */

import {allocate, DATA_TYPES, DataType, TypedArray} from './dataTypes'

export class GVArray {
    private constructor(
        readonly type: DataType,
        readonly size: number,
        private readonly _data: TypedArray | undefined,
        private readonly _single: readonly number[] | undefined,
    ) {}

    static fromArray(type: DataType, data: TypedArray): GVArray {
        const c = DATA_TYPES[type].components
        if (data.length % c !== 0) throw new Error(`GVArray: ${data.length} values is not a multiple of ${c} for ${type}`)
        return new GVArray(type, data.length / c, data, undefined)
    }

    static fromSingle(type: DataType, size: number, value: ArrayLike<number>): GVArray {
        const c = DATA_TYPES[type].components
        if (value.length !== c) throw new Error(`GVArray: single ${type} value needs ${c} components`)
        // Store as the type's array so the value is rounded like stored data (float32, int truncation).
        const stored = new DATA_TYPES[type].array(c)
        for (let k = 0; k < c; k++) stored[k] = value[k]
        return new GVArray(type, size, undefined, Object.freeze(Array.from(stored)))
    }

    static fromDefault(type: DataType, size: number): GVArray {
        return GVArray.fromSingle(type, size, DATA_TYPES[type].defaultValue)
    }

    get components(): number {
        return DATA_TYPES[this.type].components
    }

    get isSingle(): boolean {
        return this._single !== undefined
    }

    /** The single value; only valid when {@link isSingle}. */
    get single(): readonly number[] {
        if (!this._single) throw new Error('GVArray: not a single value')
        return this._single
    }

    /** Component `k` of element `i`. */
    get(i: number, k = 0): number {
        if (this._single) return this._single[k]
        return this._data![i * DATA_TYPES[this.type].components + k]
    }

    /** A flat typed array with every element, shared with this varray when it already is one. */
    materialize(): TypedArray {
        if (this._data) return this._data
        const out = allocate(this.type, this.size, false)
        const c = this.components
        const v = this._single!
        for (let i = 0; i < this.size; i++) for (let k = 0; k < c; k++) out[i * c + k] = v[k]
        return out
    }

    /** Raw storage when not single, otherwise undefined. */
    get data(): TypedArray | undefined {
        return this._data
    }
}

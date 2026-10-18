/**
 * Port of OpenSubdiv v3_7_0 `opensubdiv/vtr/types.h` and `vtr/array.h` (Copyright 2014 DreamWorks Animation LLC), plus
 * the bit layout of `Vtr::internal::Level::VTag` / `ETag` / `FTag` (`vtr/level.h:76-150`).
 * Licensed under the Tomorrow Open Source Technology License 1.0 - see `OPENSUBDIV-LICENSE.txt` in this folder.
 *
 * Tags are kept as integers with one bit per bit-field (the order of the C++ bit-fields), so copies, `memset` clears
 * and `BitwiseOr` are integer operations.
 */

export const INDEX_INVALID = -1
export const indexIsValid = (i: number) => i !== INDEX_INVALID
/** `VALENCE_LIMIT` (`types.h:47`): the largest `LocalIndex`. */
export const VALENCE_LIMIT = (1 << 16) - 1

/**
 * `Vtr::Array<T>` / `ConstArray<T>` (`array.h:44`): a view of `size` elements of `data` starting at `offset`.
 */
export class IndexArray {
    constructor(readonly data: number[], readonly offset: number, readonly size: number) {}

    get(i: number): number {
        return this.data[this.offset + i]
    }

    set(i: number, v: number): void {
        this.data[this.offset + i] = v
    }

    /** `FindIndexIn4Tuple` (`array.h:39`). */
    findIndexIn4Tuple(value: number): number {
        for (let i = 0; i < 4; i++) if (this.data[this.offset + i] === value) return i
        throw new Error('FindIndexIn4Tuple() did not find expected value!')
    }

    /** `FindIndex` (`array.h:49`): `size` when absent. */
    findIndex(value: number): number {
        for (let i = 0; i < this.size; ++i) if (this.data[this.offset + i] === value) return i
        return this.size
    }

    toArray(): number[] {
        return this.data.slice(this.offset, this.offset + this.size)
    }
}

// region VTag (`level.h:76`)
export const VT_NON_MANIFOLD = 1 << 0
export const VT_XORDINARY = 1 << 1
export const VT_BOUNDARY = 1 << 2
export const VT_CORNER = 1 << 3
export const VT_INF_SHARP = 1 << 4
export const VT_SEMI_SHARP = 1 << 5
export const VT_SEMI_SHARP_EDGES = 1 << 6
export const VT_RULE_SHIFT = 7
export const VT_RULE_MASK = 0xf << VT_RULE_SHIFT
export const VT_INCOMPLETE = 1 << 11
export const VT_INCID_IRREG_FACE = 1 << 12
export const VT_INF_SHARP_EDGES = 1 << 13
export const VT_INF_SHARP_CREASE = 1 << 14
export const VT_INF_IRREGULAR = 1 << 15

export const vtRule = (t: number) => (t & VT_RULE_MASK) >> VT_RULE_SHIFT
export const vtWithRule = (t: number, rule: number) => (t & ~VT_RULE_MASK) | ((rule & 0xf) << VT_RULE_SHIFT)
export const vtBit = (t: number, bit: number) => (t & bit) !== 0
export const vtSet = (t: number, bit: number, on: boolean) => (on ? t | bit : t & ~bit)
// endregion

// region ETag (`level.h:115`)
export const ET_NON_MANIFOLD = 1 << 0
export const ET_BOUNDARY = 1 << 1
export const ET_INF_SHARP = 1 << 2
export const ET_SEMI_SHARP = 1 << 3
// endregion

// region FTag (`level.h:139`)
export const FT_HOLE = 1 << 0
// endregion

/** `std::vector::resize`: grow with `fill`, or shrink. */
export function resizeVector(v: number[], size: number, fill = 0): void {
    if (v.length > size) v.length = size
    else while (v.length < size) v.push(fill)
}

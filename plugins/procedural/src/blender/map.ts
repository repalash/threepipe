/**
 * `blender::Map` (`blenlib/BLI_map.hh`) with integer keys, for code whose output order is the map's iteration order
 * (`keys()` / `items()` walk the slot array). Ported: the slot array (inline capacity, `LoadFactor(1, 2)`,
 * `BLI_hash_tables.hh`), `ensure_can_add` / `realloc_and_reinsert` (:1099, :1359), `add_after_grow` (:1151),
 * `lookup_or_add_cb` (:1252), `DefaultHash` of integers (`BLI_hash.hh:119`, `uint64_t(value)`) and
 * `PythonProbingStrategy<1>` (`BLI_probing_strategies.hh:125`). Removal is not ported.
 */

const MASK64 = (1n << 64n) - 1n

/** `power_of_2_max`. */
function powerOf2Max(x: number): number {
    let p = 1
    while (p < x) p *= 2
    return p
}

/** `LoadFactor::compute_total_slots` with `LOAD_FACTOR 1, 2`: `power_of_2_max(ceil(min_usable * 2 / 1))`. */
function totalSlotsFor(minUsable: number): number {
    return powerOf2Max(minUsable * 2)
}

export class BlenderIntMap<V> {
    private keys_: (number | undefined)[]
    private values: (V | undefined)[]
    private hashes: bigint[]
    private occupied = 0
    private usable = 0
    private mask = 0n
    /** `SlotArray::inline_buffer_capacity()`: `compute_total_slots(inline capacity, 1, 2)`. */
    private readonly inlineSlots: number

    /** `inlineCapacity`: the `InlineBufferCapacity` template argument (`default_inline_buffer_capacity`: 4 below 100 bytes). */
    constructor(inlineCapacity = 4) {
        this.inlineSlots = inlineCapacity > 0 ? totalSlotsFor(inlineCapacity) : 1
        // `slots_(1)`: one empty slot, no usable slots.
        this.keys_ = [undefined]
        this.values = [undefined]
        this.hashes = [0n]
    }

    get size(): number {
        return this.occupied
    }

    /** `DefaultHash<int>`: `uint64_t(value)` (sign-extended). */
    private static hash(key: number): bigint {
        return BigInt.asUintN(64, BigInt(key))
    }

    /** The probing sequence: `SLOT_PROBING_BEGIN` with `PythonProbingStrategy<1, false>`. */
    private *probe(hash: bigint, mask: bigint): Generator<number> {
        let h = hash, perturb = hash
        for (;;) {
            yield Number(h & mask)
            perturb >>= 5n
            h = (5n * h + 1n + perturb) & MASK64
        }
    }

    /** `realloc_and_reinsert` (:1099). */
    private realloc(minUsable: number): void {
        minUsable = Math.max(minUsable, this.occupied * 2)
        const total = Math.max(totalSlotsFor(minUsable), this.inlineSlots)
        const usable = Math.floor(total / 2)
        const mask = BigInt(total - 1)
        const keys: (number | undefined)[] = new Array(total).fill(undefined)
        const values: (V | undefined)[] = new Array(total).fill(undefined)
        const hashes: bigint[] = new Array(total).fill(0n)
        for (let s = 0; s < this.keys_.length; s++) {
            if (this.keys_[s] === undefined) continue
            // `add_after_grow` (:1151).
            for (const i of this.probe(this.hashes[s], mask)) {
                if (keys[i] !== undefined) continue
                keys[i] = this.keys_[s]
                values[i] = this.values[s]
                hashes[i] = this.hashes[s]
                break
            }
        }
        this.keys_ = keys
        this.values = values
        this.hashes = hashes
        this.usable = usable
        this.mask = mask
    }

    /** `lookup_or_add_cb` (:1252). */
    lookupOrAdd(key: number, create: () => V): V {
        if (this.occupied >= this.usable) this.realloc(this.occupied + 1)
        const hash = BlenderIntMap.hash(key)
        for (const i of this.probe(hash, this.mask)) {
            if (this.keys_[i] === undefined) {
                this.keys_[i] = key
                this.hashes[i] = hash
                this.values[i] = create()
                this.occupied++
                return this.values[i]!
            }
            if (this.keys_[i] === key) return this.values[i]!
        }
        throw new Error('unreachable')
    }

    lookup(key: number): V | undefined {
        if (!this.occupied) return undefined
        for (const i of this.probe(BlenderIntMap.hash(key), this.mask)) {
            if (this.keys_[i] === undefined) return undefined
            if (this.keys_[i] === key) return this.values[i]
        }
        return undefined
    }

    /** `items()`: occupied slots in slot order. */
    *items(): Generator<[number, V]> {
        for (let i = 0; i < this.keys_.length; i++) if (this.keys_[i] !== undefined) yield [this.keys_[i]!, this.values[i]!]
    }
}

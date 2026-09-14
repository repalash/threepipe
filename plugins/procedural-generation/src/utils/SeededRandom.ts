/**
 * Deterministic pseudo-random number generator using the mulberry32 algorithm.
 * Produces reproducible sequences from a given seed.
 *
 * Algorithm source: Tommy Ettinger's mulberry32
 * Reference: https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
 */
export class SeededRandom {
    private _state: number
    private _initial: number

    constructor(seed: number) {
        this._initial = seed | 0
        this._state = this._initial
    }

    /**
     * Returns the next random number in [0, 1).
     * Uses mulberry32 — fast, 32-bit state, good distribution.
     */
    next(): number {
        let t = this._state += 0x6D2B79F5
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    /** Random float in [min, max). */
    range(min: number, max: number): number {
        return min + this.next() * (max - min)
    }

    /** Random integer in [min, max] (inclusive). */
    int(min: number, max: number): number {
        return Math.floor(this.range(min, max + 1))
    }

    /** Pick a random element from an array. */
    pick<T>(arr: readonly T[]): T {
        return arr[Math.floor(this.next() * arr.length)]
    }

    /** Weighted random pick from an array of {item, weight} objects. */
    pickWeighted<T>(items: readonly {item: T, weight: number}[]): T {
        const totalWeight = items.reduce((sum, i) => sum + i.weight, 0)
        let r = this.next() * totalWeight
        for (const entry of items) {
            r -= entry.weight
            if (r <= 0) return entry.item
        }
        return items[items.length - 1].item
    }

    /** Fisher-Yates shuffle (in-place, returns same array). */
    shuffle<T>(arr: T[]): T[] {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1))
            const tmp = arr[i]
            arr[i] = arr[j]
            arr[j] = tmp
        }
        return arr
    }

    /**
     * Gaussian (normal) distribution via Box-Muller transform.
     * Returns a sample from N(mean, stddev).
     * Reference: Box, G.E.P. and Muller, M.E. (1958) "A Note on the Generation of Random Normal Deviates"
     * https://en.wikipedia.org/wiki/Box%E2%80%93Muller_transform
     */
    gaussian(mean = 0, stddev = 1): number {
        const u1 = this.next()
        const u2 = this.next()
        const z = Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2)
        return mean + z * stddev
    }

    /**
     * Create an independent child RNG.
     * The child's seed is derived from the parent's current state,
     * so the parent sequence is deterministic regardless of what the child does.
     * Critical for composition: changing one sub-generator doesn't affect others.
     *
     * Uses the raw 32-bit state directly (not float conversion) to avoid
     * precision loss from float→int round-trip.
     */
    fork(): SeededRandom {
        // Advance state AND run full mulberry32 mixing to get a well-distributed child seed.
        // Without mixing, consecutive forks produce seeds differing by a constant (0x6D2B79F5),
        // causing correlated early sequences in child RNGs.
        let t = this._state += 0x6D2B79F5
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return new SeededRandom((t ^ (t >>> 14)) | 0)
    }

    /** Reset to the initial seed. */
    reset(): void {
        this._state = this._initial
    }

    /** Get the initial seed. */
    get seed(): number {
        return this._initial
    }
}

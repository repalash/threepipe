/**
 * `blender::RandomNumberGenerator` (`blenlib/BLI_rand.hh`, `intern/rand.cc`): drand48's 48-bit linear
 * congruential generator. The state is kept as a BigInt (the multiply needs 83 bits before the mask).
 */

import {f32} from './f32'

const MULTIPLIER = 0x5DEECE66Dn
const ADDEND = 0xBn
const MASK = 0xFFFFFFFFFFFFn

export class RandomNumberGenerator {
    private x = 0n

    constructor(seed = 0) {
        this.seed(seed)
    }

    /** `seed` (:35): `(uint64(seed) << 16) | 0x330E`. */
    seed(seed: number): void {
        this.x = (BigInt(seed >>> 0) << 16n) | 0x330En
    }

    private step(): void {
        this.x = (MULTIPLIER * this.x + ADDEND) & MASK
    }

    /** `get_uint32` (:46). */
    getUint32(): number {
        this.step()
        return Number(this.x >> 17n) >>> 0
    }

    /** `get_int32` (:52): `int32_t(x >> 17)`, never negative (31 bits). */
    getInt32(): number {
        this.step()
        return Number(this.x >> 17n) | 0
    }

    /** `get_float` (:83): `float(int32) / 0x80000000`. */
    getFloat(): number {
        return f32(f32(this.getInt32()) / 2147483648)
    }

    /** `get_double` (:75). */
    getDouble(): number {
        return this.getInt32() / 2147483648
    }

    skip(n: number): void {
        while (n-- > 0) this.step()
    }

    /** `get_barycentric_coordinates` (:101). */
    getBarycentricCoordinates(): [number, number, number] {
        let r1 = this.getFloat()
        let r2 = this.getFloat()
        if (f32(r1 + r2) > 1) {
            r1 = f32(1 - r1)
            r2 = f32(1 - r2)
        }
        return [r1, r2, f32(f32(1 - r1) - r2)]
    }

    /** `round_probabilistic` (`rand.cc:306`): `int(x) + (fractf(x) > get_float())`. */
    roundProbabilistic(x: number): number {
        const frac = f32(x - Math.floor(x))
        return Math.trunc(x) + (frac > this.getFloat() ? 1 : 0)
    }
}

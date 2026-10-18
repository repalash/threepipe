import {describe, expect, it} from 'vitest'
import {incircle, orient2d} from './predicates'

/** A double as `m * 2^e` with BigInt `m` (exact). */
function toExact(x: number): [bigint, number] {
    if (x === 0) return [0n, 0]
    const buf = new DataView(new ArrayBuffer(8))
    buf.setFloat64(0, x)
    const hi = buf.getUint32(0), lo = buf.getUint32(4)
    const sign = hi >>> 31 ? -1n : 1n
    const exp = (hi >>> 20) & 0x7ff
    let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo)
    let e: number
    if (exp === 0) e = -1074
    else {
        mant |= 1n << 52n
        e = exp - 1075
    }
    return [sign * mant, e]
}

/** Every value scaled to integers by the same power of two. */
function scaled(values: number[]): bigint[] {
    const ex = values.map(toExact)
    const minE = Math.min(...ex.map(([, e]) => e))
    return ex.map(([m, e]) => m << BigInt(e - minE))
}

const sign = (b: bigint) => (b < 0n ? -1 : b > 0n ? 1 : 0)

function exactOrient(a: number[], b: number[], c: number[]): number {
    const [ax, ay, bx, by, cx, cy] = scaled([...a, ...b, ...c])
    return sign((ax - cx) * (by - cy) - (ay - cy) * (bx - cx))
}

function exactIncircle(a: number[], b: number[], c: number[], d: number[]): number {
    const [ax, ay, bx, by, cx, cy, dx, dy] = scaled([...a, ...b, ...c, ...d])
    const adx = ax - dx, ady = ay - dy, bdx = bx - dx, bdy = by - dy, cdx = cx - dx, cdy = cy - dy
    const alift = adx * adx + ady * ady, blift = bdx * bdx + bdy * bdy, clift = cdx * cdx + cdy * cdy
    return sign(alift * (bdx * cdy - cdx * bdy) + blift * (cdx * ady - adx * cdy) + clift * (adx * bdy - bdx * ady))
}

describe('Shewchuk predicates', () => {
    // Near-degenerate inputs: points on a line / circle perturbed by a few ulps, where the fast path is not enough.
    // A small deterministic generator (mulberry32).
    let seed = 7
    const r = () => {
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const near = (v: number) => v + (Math.floor(r() * 7) - 3) * Number.EPSILON * Math.max(1, Math.abs(v))
    it('orient2d is exact', () => {
        for (let i = 0; i < 4000; i++) {
            const t = r() * 3 - 1
            const a = [r() * 10, r() * 10], b = [r() * 10, r() * 10]
            const c = i % 2 ? [near(a[0] + (b[0] - a[0]) * t), near(a[1] + (b[1] - a[1]) * t)] : [r() * 10, r() * 10]
            expect(orient2d(a, b, c)).toBe(exactOrient(a, b, c))
        }
    })
    it('incircle is exact', () => {
        for (let i = 0; i < 4000; i++) {
            const pts = [0, 1, 2, 3].map(k => {
                const ang = r() * 7
                return i % 2 ? [near(Math.cos(ang) * 3 + 1), near(Math.sin(ang) * 3 - 2)] : [r() * 6, r() * 6 + k]
            })
            expect(incircle(pts[0], pts[1], pts[2], pts[3])).toBe(exactIncircle(pts[0], pts[1], pts[2], pts[3]))
        }
    })
})

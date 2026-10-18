/*
Copyright (c) 2011 Ole Kniemeyer, MAXON, www.maxon.net

This software is provided 'as-is', without any express or implied warranty.
In no event will the authors be held liable for any damages arising from the use of this software.
Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it freely,
subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim that you wrote the original software. If you use this software in a product, an acknowledgment in the product documentation would be appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.
*/

/**
 * ALTERED SOURCE: a TypeScript port of Bullet's `btConvexHullComputer` (`extern/bullet2/src/LinearMath/btConvexHullComputer.cpp`,
 * as shipped in Blender 5.2.2), used by Blender through `intern/rigidbody/rb_convex_hull_api.cpp`. Line numbers below refer
 * to that `.cpp` file.
 *
 * Build configuration ported: Blender compiles Bullet with `-DBT_USE_DOUBLE_PRECISION` (`extern/bullet2/CMakeLists.txt:21`),
 * so `btScalar` is `double` and `btVector3` has no SIMD path (`btScalar.h:216`); `USE_X86_64_ASM` is not defined (:36), so
 * `Int128` is the portable code. Blender only calls `compute(float *, stride, count, 0, 0)` (`rb_convex_hull_api.cpp`), so
 * `shrink` (which needs `Rational128`, `PointR128` and `shiftFace`) is never reached; it is not ported and throws.
 *
 * Integer arithmetic: the input is scaled to `|coordinate| <= 5108` (:2028-2077), so `Point32` values and their first
 * cross products are small. Quantities that can exceed 2^53 (dot products with second-level cross products, products of
 * two `Point64`, and the 128-bit `Rational64` comparison products, `Int128::mul` / `DMul`) are computed with BigInt,
 * which is exact as the C++ `int64_t` / `Int128` results are (the values stay below 2^63, no overflow occurs). Number
 * arithmetic is guarded: `nmul` throws if a product could have lost precision.
 */

const SAFE = 2 ** 53

/** Exact Number product, or an error (the caller must use BigInt for that quantity). */
function nmul(a: number, b: number): number {
    const p = a * b
    if (!(Math.abs(p) < SAFE)) throw new Error('btConvexHullComputer: an int64 product exceeds 2^53 in Number arithmetic')
    return p
}

function nsum(a: number, b: number, c: number): number {
    const s = a + b + c
    if (!(Math.abs(s) < SAFE)) throw new Error('btConvexHullComputer: an int64 sum exceeds 2^53 in Number arithmetic')
    return s
}

/** `Point32` (:76). */
interface Point32 {
    x: number
    y: number
    z: number
    index: number
}

/** `Point64` (:55): values held as exact Numbers. */
interface Point64 {
    x: number
    y: number
    z: number
}

const p32 = (x: number, y: number, z: number): Point32 => ({x, y, z, index: -1})
const eq32 = (a: Point32, b: Point32) => a.x === b.x && a.y === b.y && a.z === b.z
const sub32 = (a: Point32, b: Point32): Point32 => p32(a.x - b.x, a.y - b.y, a.z - b.z)
/** `Point32::cross` (both overloads, :107/:112). */
const cross = (a: Point64, b: Point64): Point64 => ({
    x: nmul(a.y, b.z) - nmul(a.z, b.y),
    y: nmul(a.z, b.x) - nmul(a.x, b.z),
    z: nmul(a.x, b.y) - nmul(a.y, b.x),
})
/** `Point32::dot` / `Point64::dot` when every product stays below 2^53. */
const dotN = (a: Point64, b: Point64): number => nsum(nmul(a.x, b.x), nmul(a.y, b.y), nmul(a.z, b.z))
/** The same dot product as an `int64_t` that can exceed 2^53. */
const dotB = (a: Point64, b: Point64): bigint => BigInt(a.x) * BigInt(b.x) + BigInt(a.y) * BigInt(b.y) + BigInt(a.z) * BigInt(b.z)

/** `Rational64` (:276) with BigInt numerator / denominator (`uint64_t`). */
class Rational64 {
    readonly numerator: bigint
    readonly denominator: bigint
    readonly sign: number

    constructor(numerator: bigint, denominator: bigint) {
        let sign: number, n: bigint, d: bigint
        if (numerator > 0n) {
            sign = 1
            n = numerator
        } else if (numerator < 0n) {
            sign = -1
            n = -numerator
        } else {
            sign = 0
            n = 0n
        }
        if (denominator > 0n) d = denominator
        else if (denominator < 0n) {
            sign = -sign
            d = -denominator
        } else d = 0n
        this.numerator = n
        this.denominator = d
        this.sign = sign
    }

    isNegativeInfinity(): boolean {
        return this.sign < 0 && this.denominator === 0n
    }

    isNaN(): boolean {
        return this.sign === 0 && this.denominator === 0n
    }

    /** `Rational64::compare` (:898): `sign * Int128::mul(m_numerator, b.m_denominator).ucmp(Int128::mul(m_denominator, b.m_numerator))`. */
    compare(b: Rational64): number {
        if (this.sign !== b.sign) return this.sign - b.sign
        if (this.sign === 0) return 0
        const l = this.numerator * b.denominator, r = this.denominator * b.numerator
        return this.sign * (l < r ? -1 : l > r ? 1 : 0)
    }
}

class Vertex {
    next: Vertex | null = null
    prev: Vertex | null = null
    edges: Edge | null = null
    point!: Point32
    copy = -1
}

class Edge {
    next!: Edge
    prev!: Edge
    reverse!: Edge
    target!: Vertex
    copy = 0

    /** `Edge::link` (:540). */
    link(n: Edge): void {
        this.next = n
        n.prev = this
    }
}

/** `IntermediateHull` (:665). */
interface IntermediateHull {
    minXy: Vertex | null
    maxXy: Vertex | null
    minYx: Vertex | null
    maxYx: Vertex | null
}

const emptyHull = (): IntermediateHull => ({minXy: null, maxXy: null, minYx: null, maxYx: null})

const enum Orientation { NONE, CLOCKWISE, COUNTER_CLOCKWISE }

/** `pointCmp` (:2012). */
const pointCmp = (p: Point32, q: Point32) => p.y < q.y || (p.y === q.y && (p.x < q.x || (p.x === q.x && p.z < q.z)))

/** `btAlignedObjectArray::quickSort` / `quickSortInternal` (`btAlignedObjectArray.h:311`), with an explicit stack (the two ranges are disjoint). */
function quickSort<T>(a: T[], less: (p: T, q: T) => boolean): void {
    if (a.length <= 1) return
    const stack: number[] = [0, a.length - 1]
    while (stack.length) {
        const hi = stack.pop()!, lo = stack.pop()!
        let i = lo, j = hi
        const x = a[Math.floor((lo + hi) / 2)]
        do {
            while (less(a[i], x)) i++
            while (less(x, a[j])) j--
            if (i <= j) {
                const t = a[i]
                a[i] = a[j]
                a[j] = t
                i++
                j--
            }
        } while (i <= j)
        if (i < hi) stack.push(i, hi)
        if (lo < j) stack.push(lo, j)
    }
}

/** `btConvexHullInternal` (:49) without the shrink parts. */
class ConvexHullInternal {
    private originalVertices: Vertex[] = []
    private mergeStamp = 0
    vertexList: Vertex | null = null

    /** `newEdgePair` (:1020). */
    private newEdgePair(from: Vertex, to: Vertex): Edge {
        const e = new Edge(), r = new Edge()
        e.reverse = r
        r.reverse = e
        e.copy = this.mergeStamp
        r.copy = this.mergeStamp
        e.target = to
        r.target = from
        return e
    }

    /** `removeEdgePair` (:794). */
    private removeEdgePair(edge: Edge): void {
        let n = edge.next
        const r = edge.reverse
        if (n !== edge) {
            n.prev = edge.prev
            edge.prev.next = n
            r.target.edges = n
        } else r.target.edges = null
        n = r.next
        if (n !== r) {
            n.prev = r.prev
            r.prev.next = n
            edge.target.edges = n
        } else edge.target.edges = null
    }

    /** `mergeProjection` (:1041): returns `[merged, c0, c1]`. */
    private mergeProjection(h0: IntermediateHull, h1: IntermediateHull): [boolean, Vertex, Vertex] {
        let v0 = h0.maxYx!
        let v1 = h1.minYx!
        if (v0.point.x === v1.point.x && v0.point.y === v1.point.y) {
            const v1p = v1.prev!
            if (v1p === v1) {
                const c0 = v0
                if (v1.edges) v1 = v1.edges.target
                return [false, c0, v1]
            }
            const v1n = v1.next!
            v1p.next = v1n
            v1n.prev = v1p
            if (v1 === h1.minXy) {
                if (v1n.point.x < v1p.point.x || (v1n.point.x === v1p.point.x && v1n.point.y < v1p.point.y)) h1.minXy = v1n
                else h1.minXy = v1p
            }
            if (v1 === h1.maxXy) {
                if (v1n.point.x > v1p.point.x || (v1n.point.x === v1p.point.x && v1n.point.y > v1p.point.y)) h1.maxXy = v1n
                else h1.maxXy = v1p
            }
        }

        v0 = h0.maxXy!
        v1 = h1.maxXy!
        let v00: Vertex | null = null
        let v10: Vertex | null = null
        let sign = 1
        for (let side = 0; side <= 1; side++) {
            let dx = (v1.point.x - v0.point.x) * sign
            if (dx > 0) {
                while (true) {
                    const dy = v1.point.y - v0.point.y
                    const w0 = side ? v0.next! : v0.prev!
                    if (w0 !== v0) {
                        const dx0 = (w0.point.x - v0.point.x) * sign
                        const dy0 = w0.point.y - v0.point.y
                        if (dy0 <= 0 && (dx0 === 0 || (dx0 < 0 && dy0 * dx <= dy * dx0))) {
                            v0 = w0
                            dx = (v1.point.x - v0.point.x) * sign
                            continue
                        }
                    }
                    const w1 = side ? v1.next! : v1.prev!
                    if (w1 !== v1) {
                        const dx1 = (w1.point.x - v1.point.x) * sign
                        const dy1 = w1.point.y - v1.point.y
                        const dxn = (w1.point.x - v0.point.x) * sign
                        if (dxn > 0 && dy1 < 0 && (dx1 === 0 || (dx1 < 0 && dy1 * dx < dy * dx1))) {
                            v1 = w1
                            dx = dxn
                            continue
                        }
                    }
                    break
                }
            } else if (dx < 0) {
                while (true) {
                    const dy = v1.point.y - v0.point.y
                    const w1 = side ? v1.prev! : v1.next!
                    if (w1 !== v1) {
                        const dx1 = (w1.point.x - v1.point.x) * sign
                        const dy1 = w1.point.y - v1.point.y
                        if (dy1 >= 0 && (dx1 === 0 || (dx1 < 0 && dy1 * dx <= dy * dx1))) {
                            v1 = w1
                            dx = (v1.point.x - v0.point.x) * sign
                            continue
                        }
                    }
                    const w0 = side ? v0.prev! : v0.next!
                    if (w0 !== v0) {
                        const dx0 = (w0.point.x - v0.point.x) * sign
                        const dy0 = w0.point.y - v0.point.y
                        const dxn = (v1.point.x - w0.point.x) * sign
                        if (dxn < 0 && dy0 > 0 && (dx0 === 0 || (dx0 < 0 && dy0 * dx < dy * dx0))) {
                            v0 = w0
                            dx = dxn
                            continue
                        }
                    }
                    break
                }
            } else {
                const x = v0.point.x
                let y0 = v0.point.y
                let w0 = v0
                let t: Vertex
                while ((t = side ? w0.next! : w0.prev!) !== v0 && t.point.x === x && t.point.y <= y0) {
                    w0 = t
                    y0 = t.point.y
                }
                v0 = w0
                let y1 = v1.point.y
                let w1 = v1
                while ((t = side ? w1.prev! : w1.next!) !== v1 && t.point.x === x && t.point.y >= y1) {
                    w1 = t
                    y1 = t.point.y
                }
                v1 = w1
            }
            if (side === 0) {
                v00 = v0
                v10 = v1
                v0 = h0.minXy!
                v1 = h1.minXy!
                sign = -1
            }
        }
        v0.prev = v1
        v1.next = v0
        v00!.next = v10
        v10!.prev = v00
        if (h1.minXy!.point.x < h0.minXy!.point.x) h0.minXy = h1.minXy
        if (h1.maxXy!.point.x >= h0.maxXy!.point.x) h0.maxXy = h1.maxXy
        h0.maxYx = h1.maxYx
        return [true, v00!, v10!]
    }

    /** `computeInternal` (:1238). */
    private computeInternal(start: number, end: number, result: IntermediateHull): void {
        const n = end - start
        switch (n) {
        case 0:
            result.minXy = result.maxXy = result.minYx = result.maxYx = null
            return
        case 2: {
            let v = this.originalVertices[start]
            let w = this.originalVertices[start + 1]
            if (!eq32(v.point, w.point)) {
                const dx = v.point.x - w.point.x
                const dy = v.point.y - w.point.y
                if (dx === 0 && dy === 0) {
                    if (v.point.z > w.point.z) {
                        const t = w
                        w = v
                        v = t
                    }
                    v.next = v
                    v.prev = v
                    result.minXy = result.maxXy = result.minYx = result.maxYx = v
                } else {
                    v.next = w
                    v.prev = w
                    w.next = v
                    w.prev = v
                    if (dx < 0 || (dx === 0 && dy < 0)) {
                        result.minXy = v
                        result.maxXy = w
                    } else {
                        result.minXy = w
                        result.maxXy = v
                    }
                    if (dy < 0 || (dy === 0 && dx < 0)) {
                        result.minYx = v
                        result.maxYx = w
                    } else {
                        result.minYx = w
                        result.maxYx = v
                    }
                }
                let e = this.newEdgePair(v, w)
                e.link(e)
                v.edges = e
                e = e.reverse
                e.link(e)
                w.edges = e
                return
            }
            const v1 = this.originalVertices[start]
            v1.edges = null
            v1.next = v1
            v1.prev = v1
            result.minXy = result.maxXy = result.minYx = result.maxYx = v1
            return
        }
        case 1: {
            const v = this.originalVertices[start]
            v.edges = null
            v.next = v
            v.prev = v
            result.minXy = result.maxXy = result.minYx = result.maxYx = v
            return
        }
        }
        const split0 = start + Math.trunc(n / 2)
        const p = this.originalVertices[split0 - 1].point
        let split1 = split0
        while (split1 < end && eq32(this.originalVertices[split1].point, p)) split1++
        this.computeInternal(start, split0, result)
        const hull1 = emptyHull()
        this.computeInternal(split1, end, hull1)
        this.merge(result, hull1)
    }

    /** `getOrientation` (:1430). */
    private static getOrientation(prev: Edge, next: Edge, s: Point32, t: Point32): Orientation {
        if (prev.next === next) {
            if (prev.prev === next) {
                const n = cross(t, s)
                const m = cross(sub32(prev.target.point, next.reverse.target.point), sub32(next.target.point, next.reverse.target.point))
                const dot = dotB(n, m)
                return dot > 0n ? Orientation.COUNTER_CLOCKWISE : Orientation.CLOCKWISE
            }
            return Orientation.COUNTER_CLOCKWISE
        } else if (prev.prev === next) return Orientation.CLOCKWISE
        return Orientation.NONE
    }

    /** `findMaxAngle` (:1456): returns the edge and `minCot`. */
    private findMaxAngle(ccw: boolean, start: Vertex, s: Point32, rxs: Point64, sxrxs: Point64, minCotIn: Rational64): [Edge | null, Rational64] {
        let minEdge: Edge | null = null
        let minCot = minCotIn
        let e = start.edges
        if (e) {
            do {
                if (e.copy > this.mergeStamp) {
                    const t = sub32(e.target.point, start.point)
                    const cot = new Rational64(dotB(t, sxrxs), BigInt(dotN(t, rxs)))
                    if (!cot.isNaN()) {
                        let cmp: number
                        if (minEdge === null) {
                            minCot = cot
                            minEdge = e
                        } else if ((cmp = cot.compare(minCot)) < 0) {
                            minCot = cot
                            minEdge = e
                        } else if (cmp === 0 && ccw === (ConvexHullInternal.getOrientation(minEdge, e, s, t) === Orientation.COUNTER_CLOCKWISE)) {
                            minEdge = e
                        }
                    }
                }
                e = e.next
            } while (e !== start.edges)
        }
        return [minEdge, minCot]
    }

    /** `findEdgeForCoplanarFaces` (:1503): returns the advanced `[e0, e1]`. */
    private findEdgeForCoplanarFaces(c0: Vertex, c1: Vertex, e0: Edge | null, e1: Edge | null, stop0: Vertex | null, stop1: Vertex | null): [Edge | null, Edge | null] {
        const start0 = e0
        const start1 = e1
        let et0 = start0 ? start0.target.point : c0.point
        let et1 = start1 ? start1.target.point : c1.point
        const s = sub32(c1.point, c0.point)
        const normal = cross(sub32((start0 ? start0 : start1)!.target.point, c0.point), s)
        const dist = dotN(c0.point, normal)
        const perp = cross(s, normal)

        let maxDot0 = dotB(et0, perp)
        if (e0) {
            while (e0.target !== stop0) {
                const e: Edge = e0.reverse.prev
                if (dotN(e.target.point, normal) < dist) break
                if (e.copy === this.mergeStamp) break
                const dot = dotB(e.target.point, perp)
                if (dot <= maxDot0) break
                maxDot0 = dot
                e0 = e
                et0 = e.target.point
            }
        }

        let maxDot1 = dotB(et1, perp)
        if (e1) {
            while (e1.target !== stop1) {
                const e: Edge = e1.reverse.next
                if (dotN(e.target.point, normal) < dist) break
                if (e.copy === this.mergeStamp) break
                const dot = dotB(e.target.point, perp)
                if (dot <= maxDot1) break
                maxDot1 = dot
                e1 = e
                et1 = e.target.point
            }
        }

        let dx = maxDot1 - maxDot0
        if (dx > 0n) {
            while (true) {
                const dy = BigInt(dotN(sub32(et1, et0), s))
                if (e0 && e0.target !== stop0) {
                    const f0 = e0.next.reverse
                    if (f0.copy > this.mergeStamp) {
                        const dx0 = dotB(sub32(f0.target.point, et0), perp)
                        const dy0 = BigInt(dotN(sub32(f0.target.point, et0), s))
                        if (dx0 === 0n ? dy0 < 0n : (dx0 < 0n && new Rational64(dy0, dx0).compare(new Rational64(dy, dx)) >= 0)) {
                            et0 = f0.target.point
                            dx = dotB(sub32(et1, et0), perp)
                            e0 = e0 === start0 ? null : f0
                            continue
                        }
                    }
                }
                if (e1 && e1.target !== stop1) {
                    const f1 = e1.reverse.next
                    if (f1.copy > this.mergeStamp) {
                        const d1 = sub32(f1.target.point, et1)
                        if (dotN(d1, normal) === 0) {
                            const dx1 = dotB(d1, perp)
                            const dy1 = BigInt(dotN(d1, s))
                            const dxn = dotB(sub32(f1.target.point, et0), perp)
                            if (dxn > 0n && (dx1 === 0n ? dy1 < 0n : (dx1 < 0n && new Rational64(dy1, dx1).compare(new Rational64(dy, dx)) > 0))) {
                                e1 = f1
                                et1 = e1.target.point
                                dx = dxn
                                continue
                            }
                        }
                    }
                }
                break
            }
        } else if (dx < 0n) {
            while (true) {
                const dy = BigInt(dotN(sub32(et1, et0), s))
                if (e1 && e1.target !== stop1) {
                    const f1 = e1.prev.reverse
                    if (f1.copy > this.mergeStamp) {
                        const dx1 = dotB(sub32(f1.target.point, et1), perp)
                        const dy1 = BigInt(dotN(sub32(f1.target.point, et1), s))
                        if (dx1 === 0n ? dy1 > 0n : (dx1 < 0n && new Rational64(dy1, dx1).compare(new Rational64(dy, dx)) <= 0)) {
                            et1 = f1.target.point
                            dx = dotB(sub32(et1, et0), perp)
                            e1 = e1 === start1 ? null : f1
                            continue
                        }
                    }
                }
                if (e0 && e0.target !== stop0) {
                    const f0 = e0.reverse.prev
                    if (f0.copy > this.mergeStamp) {
                        const d0 = sub32(f0.target.point, et0)
                        if (dotN(d0, normal) === 0) {
                            const dx0 = dotB(d0, perp)
                            const dy0 = BigInt(dotN(d0, s))
                            const dxn = dotB(sub32(et1, f0.target.point), perp)
                            if (dxn < 0n && (dx0 === 0n ? dy0 > 0n : (dx0 < 0n && new Rational64(dy0, dx0).compare(new Rational64(dy, dx)) < 0))) {
                                e0 = f0
                                et0 = e0.target.point
                                dx = dxn
                                continue
                            }
                        }
                    }
                }
                break
            }
        }
        return [e0, e1]
    }

    /** `merge` (:1680). */
    private merge(h0: IntermediateHull, h1: IntermediateHull): void {
        if (!h1.maxXy) return
        if (!h0.maxXy) {
            Object.assign(h0, h1)
            return
        }
        this.mergeStamp--

        let c0: Vertex
        let toPrev0: Edge | null = null
        let firstNew0: Edge | null = null
        let pendingHead0: Edge | null = null
        let pendingTail0: Edge | null = null
        let c1: Vertex
        let toPrev1: Edge | null = null
        let firstNew1: Edge | null = null
        let pendingHead1: Edge | null = null
        let pendingTail1: Edge | null = null
        let prevPoint: Point32

        const [projected, pc0, pc1] = this.mergeProjection(h0, h1)
        c0 = pc0
        c1 = pc1
        if (projected) {
            const s = sub32(c1.point, c0.point)
            const down = p32(0, 0, -1)
            const normal = cross(down, s)
            const t = cross(s, normal)

            let e = c0.edges
            let start0: Edge | null = null
            if (e) {
                do {
                    const dot = dotN(sub32(e.target.point, c0.point), normal)
                    if (dot === 0 && dotN(sub32(e.target.point, c0.point), t) > 0) {
                        if (!start0 || ConvexHullInternal.getOrientation(start0, e, s, down) === Orientation.CLOCKWISE) start0 = e
                    }
                    e = e.next
                } while (e !== c0.edges)
            }

            e = c1.edges
            let start1: Edge | null = null
            if (e) {
                do {
                    const dot = dotN(sub32(e.target.point, c1.point), normal)
                    if (dot === 0 && dotN(sub32(e.target.point, c1.point), t) > 0) {
                        if (!start1 || ConvexHullInternal.getOrientation(start1, e, s, down) === Orientation.COUNTER_CLOCKWISE) start1 = e
                    }
                    e = e.next
                } while (e !== c1.edges)
            }

            if (start0 || start1) {
                [start0, start1] = this.findEdgeForCoplanarFaces(c0, c1, start0, start1, null, null)
                if (start0) c0 = start0.target
                if (start1) c1 = start1.target
            }

            prevPoint = {...c1.point}
            prevPoint.z++
        } else {
            prevPoint = {...c1.point}
            prevPoint.x++
        }

        const first0 = c0
        const first1 = c1
        let firstRun = true

        while (true) {
            const s = sub32(c1.point, c0.point)
            const r = sub32(prevPoint, c0.point)
            const rxs = cross(r, s)
            const sxrxs = cross(s, rxs)

            const [min0, minCot0] = this.findMaxAngle(false, c0, s, rxs, sxrxs, new Rational64(0n, 0n))
            const [min1, minCot1] = this.findMaxAngle(true, c1, s, rxs, sxrxs, new Rational64(0n, 0n))
            if (!min0 && !min1) {
                let e = this.newEdgePair(c0, c1)
                e.link(e)
                c0.edges = e
                e = e.reverse
                e.link(e)
                c1.edges = e
                return
            } else {
                const cmp = !min0 ? 1 : !min1 ? -1 : minCot0.compare(minCot1)
                if (firstRun || (cmp >= 0 ? !minCot1.isNegativeInfinity() : !minCot0.isNegativeInfinity())) {
                    let e = this.newEdgePair(c0, c1)
                    if (pendingTail0) pendingTail0.prev = e
                    else pendingHead0 = e
                    e.next = pendingTail0!
                    pendingTail0 = e

                    e = e.reverse
                    if (pendingTail1) pendingTail1.next = e
                    else pendingHead1 = e
                    e.prev = pendingTail1!
                    pendingTail1 = e
                }

                let e0 = min0
                let e1 = min1
                if (cmp === 0) [e0, e1] = this.findEdgeForCoplanarFaces(c0, c1, e0, e1, null, null)

                if (cmp >= 0 && e1) {
                    if (toPrev1) {
                        for (let e = toPrev1.next; e !== min1;) {
                            const n: Edge = e.next
                            this.removeEdgePair(e)
                            e = n
                        }
                    }
                    if (pendingTail1) {
                        if (toPrev1) toPrev1.link(pendingHead1!)
                        else {
                            min1!.prev.link(pendingHead1!)
                            firstNew1 = pendingHead1
                        }
                        pendingTail1.link(min1!)
                        pendingHead1 = null
                        pendingTail1 = null
                    } else if (!toPrev1) firstNew1 = min1

                    prevPoint = c1.point
                    c1 = e1.target
                    toPrev1 = e1.reverse
                }

                if (cmp <= 0 && e0) {
                    if (toPrev0) {
                        for (let e = toPrev0.prev; e !== min0;) {
                            const n: Edge = e.prev
                            this.removeEdgePair(e)
                            e = n
                        }
                    }
                    if (pendingTail0) {
                        if (toPrev0) pendingHead0!.link(toPrev0)
                        else {
                            pendingHead0!.link(min0!.next)
                            firstNew0 = pendingHead0
                        }
                        min0!.link(pendingTail0)
                        pendingHead0 = null
                        pendingTail0 = null
                    } else if (!toPrev0) firstNew0 = min0

                    prevPoint = c0.point
                    c0 = e0.target
                    toPrev0 = e0.reverse
                }
            }

            if (c0 === first0 && c1 === first1) {
                if (toPrev0 === null) {
                    pendingHead0!.link(pendingTail0!)
                    c0.edges = pendingTail0
                } else {
                    for (let e = toPrev0.prev; e !== firstNew0;) {
                        const n: Edge = e.prev
                        this.removeEdgePair(e)
                        e = n
                    }
                    if (pendingTail0) {
                        pendingHead0!.link(toPrev0)
                        firstNew0!.link(pendingTail0)
                    }
                }

                if (toPrev1 === null) {
                    pendingTail1!.link(pendingHead1!)
                    c1.edges = pendingTail1
                } else {
                    for (let e = toPrev1.next; e !== firstNew1;) {
                        const n: Edge = e.next
                        this.removeEdgePair(e)
                        e = n
                    }
                    if (pendingTail1) {
                        toPrev1.link(pendingHead1!)
                        pendingTail1.link(firstNew1!)
                    }
                }
                return
            }
            firstRun = false
        }
    }

    /** `btConvexHullInternal::compute` (:2021) for float coordinates (`doubleCoords == false`), in double precision. */
    compute(coords: ArrayLike<number>, count: number): void {
        const min = [1e30, 1e30, 1e30], max = [-1e30, -1e30, -1e30]
        for (let i = 0; i < count; i++) {
            for (let k = 0; k < 3; k++) {
                const v = coords[i * 3 + k]
                if (!Number.isFinite(v)) throw new Error('btConvexHullComputer: non-finite input coordinates (undefined behaviour in the int32 conversion) are not ported')
                // `btSetMin` / `btSetMax` (`btMinMax.h:39`).
                if (v < min[k]) min[k] = v
                if (max[k] < v) max[k] = v
            }
        }
        const s = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
        // `btVector3::maxAxis` / `minAxis` (`btVector3.h:470-480`).
        const maxAxis = s[0] < s[1] ? (s[1] < s[2] ? 2 : 1) : (s[0] < s[2] ? 2 : 0)
        let minAxis = s[0] < s[1] ? (s[0] < s[2] ? 0 : 2) : (s[1] < s[2] ? 1 : 2)
        if (minAxis === maxAxis) minAxis = (maxAxis + 1) % 3
        const medAxis = 3 - maxAxis - minAxis

        // `s /= btScalar(10216)` is `*this *= btScalar(1.0) / s` (`btVector3.h:223`).
        const inv = 1 / 10216
        for (let k = 0; k < 3; k++) s[k] *= inv
        if ((medAxis + 1) % 3 !== maxAxis) for (let k = 0; k < 3; k++) s[k] *= -1
        for (let k = 0; k < 3; k++) if (s[k] !== 0) s[k] = 1 / s[k]
        const center = [(min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5]

        const points: Point32[] = new Array(count)
        for (let i = 0; i < count; i++) {
            const p = [0, 0, 0]
            for (let k = 0; k < 3; k++) p[k] = (coords[i * 3 + k] - center[k]) * s[k]
            // `(int32_t)` truncation; |p| <= 5108 here.
            points[i] = {x: Math.trunc(p[medAxis]) | 0, y: Math.trunc(p[maxAxis]) | 0, z: Math.trunc(p[minAxis]) | 0, index: i}
        }
        quickSort(points, pointCmp)

        this.originalVertices = new Array(count)
        for (let i = 0; i < count; i++) {
            const v = new Vertex()
            v.point = points[i]
            this.originalVertices[i] = v
        }
        this.mergeStamp = -3
        const hull = emptyHull()
        this.computeInternal(0, count, hull)
        this.vertexList = hull.minXy
    }
}

/** The output of `btConvexHullComputer` (`btConvexHullComputer.h`): vertices, half-edges with relative links, faces. */
export interface ConvexHullResult {
    /** `original_vertex_index`. */
    originalVertexIndex: number[]
    /** `Edge::next` (relative), `Edge::reverse` (relative), `Edge::targetVertex`. */
    edgeNext: number[]
    edgeReverse: number[]
    edgeTarget: number[]
    /** Index of an edge of each face. */
    faces: number[]
}

/**
 * `btConvexHullComputer::compute(const float *coords, int stride, int count, btScalar shrink, btScalar shrinkClamp)` (:2654) for
 * tightly packed float3 `coords`. Only `shrink == 0` (what Blender passes) is ported.
 */
export function convexHullCompute(coords: ArrayLike<number>, count: number, shrink = 0): ConvexHullResult {
    if (shrink > 0) throw new Error('btConvexHullComputer: shrink (btConvexHullInternal::shrink / shiftFace) is not ported')
    const out: ConvexHullResult = {originalVertexIndex: [], edgeNext: [], edgeReverse: [], edgeTarget: [], faces: []}
    if (count <= 0) return out
    const hull = new ConvexHullInternal()
    hull.compute(coords, count)

    // `getVertexCopy` (:2638).
    const oldVertices: Vertex[] = []
    const getVertexCopy = (vertex: Vertex) => {
        let index = vertex.copy
        if (index < 0) {
            index = oldVertices.length
            vertex.copy = index
            oldVertices.push(vertex)
        }
        return index
    }
    getVertexCopy(hull.vertexList!)
    let copied = 0
    while (copied < oldVertices.length) {
        const v = oldVertices[copied]
        // `vertices.push_back(hull.getCoordinates(v))` is not read by Blender (it copies the original positions).
        out.originalVertexIndex.push(v.point.index)
        const firstEdge = v.edges
        if (firstEdge) {
            let firstCopy = -1
            let prevCopy = -1
            let e = firstEdge
            do {
                if (e.copy < 0) {
                    const s = out.edgeTarget.length
                    out.edgeNext.push(0, 0)
                    out.edgeReverse.push(1, -1)
                    out.edgeTarget.push(getVertexCopy(e.target), copied)
                    e.copy = s
                    e.reverse.copy = s + 1
                }
                if (prevCopy >= 0) out.edgeNext[e.copy] = prevCopy - e.copy
                else firstCopy = e.copy
                prevCopy = e.copy
                e = e.next
            } while (e !== firstEdge)
            out.edgeNext[firstCopy] = prevCopy - firstCopy
        }
        copied++
    }

    for (let i = 0; i < copied; i++) {
        const v = oldVertices[i]
        const firstEdge = v.edges
        if (firstEdge) {
            let e = firstEdge
            do {
                if (e.copy >= 0) {
                    out.faces.push(e.copy)
                    let f = e
                    do {
                        f.copy = -1
                        f = f.reverse.prev
                    } while (f !== e)
                }
                e = e.next
            } while (e !== firstEdge)
        }
    }
    return out
}

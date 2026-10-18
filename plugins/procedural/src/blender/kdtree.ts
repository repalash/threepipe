/**
 * `BLI_kdtree` for 3D float points (`blenlib/BLI_kdtree.hh`): insert, `kdtree_balance` (quick-select around the
 * median per axis, :121), `kdtree_range_search_cb` (:588), `kdtree_calc_duplicates_fast` (:723). Node order after balancing and the pruning tests are
 * Blender's, so searches visit the same nodes in the same order.
 */

import {f32} from './f32'

const UNSET = -1

export class KDTree3 {
    private co: Float32Array
    private index: Int32Array
    private left: Int32Array
    private right: Int32Array
    private d: Uint8Array
    private len = 0
    private root = UNSET

    constructor(capacity: number) {
        this.co = new Float32Array(capacity * 3)
        this.index = new Int32Array(capacity)
        this.left = new Int32Array(capacity).fill(UNSET)
        this.right = new Int32Array(capacity).fill(UNSET)
        this.d = new Uint8Array(capacity)
    }

    /** `kdtree_insert` (:96). */
    insert(index: number, x: number, y: number, z: number): void {
        const n = this.len++
        this.co[n * 3] = x
        this.co[n * 3 + 1] = y
        this.co[n * 3 + 2] = z
        this.index[n] = index
        this.left[n] = this.right[n] = UNSET
        this.d[n] = 0
    }

    /** `KDTreeNode_head` swap: coordinates, index and children (the axis is set after). */
    private swap(a: number, b: number): void {
        for (let k = 0; k < 3; k++) {
            const t = this.co[a * 3 + k]
            this.co[a * 3 + k] = this.co[b * 3 + k]
            this.co[b * 3 + k] = t
        }
        let t = this.index[a]; this.index[a] = this.index[b]; this.index[b] = t
        t = this.left[a]; this.left[a] = this.left[b]; this.left[b] = t
        t = this.right[a]; this.right[a] = this.right[b]; this.right[b] = t
    }

    /** `detail::kdtree_balance` (:121) over `nodes[ofs .. ofs + len)`. */
    private balanceRange(ofs: number, len: number, axis: number): number {
        if (len <= 0) return UNSET
        if (len === 1) return ofs
        let left = 0
        let right = len - 1
        const median = len >> 1
        const ax = (i: number) => this.co[(ofs + i) * 3 + axis]
        while (right > left) {
            const co = ax(right)
            let i = left - 1
            let j = right
            for (;;) {
                while (ax(++i) < co) { /* pass */ }
                while (ax(--j) > co && j > left) { /* pass */ }
                if (i >= j) break
                this.swap(ofs + i, ofs + j)
            }
            this.swap(ofs + i, ofs + right)
            if (i >= median) right = i - 1
            if (i <= median) left = i + 1
        }
        const node = ofs + median
        this.d[node] = axis
        const next = (axis + 1) % 3
        this.left[node] = this.balanceRange(ofs, median, next)
        this.right[node] = this.balanceRange(ofs + median + 1, len - (median + 1), next)
        return node
    }

    /** `kdtree_balance` (:183). */
    balance(): void {
        this.root = this.balanceRange(0, this.len, 0)
    }

    /**
     * `kdtree_find_nearest_cb` (`BLI_kdtree.hh:208`): the nearest point the filter accepts (`1` accept, `0` skip, `-1`
     * stop), or -1. Strictly nearer points replace the current one, in Blender's stack order.
     */
    findNearestCb(x: number, y: number, z: number, filter: (index: number, distSq: number) => number = () => 1): number {
        if (this.root === UNSET) return -1
        const q = [x, y, z]
        let minDist = 3.4028234663852886e38
        let minNode = -1
        const test = (n: number): boolean => {
            const dx = f32(this.co[n * 3] - x), dy = f32(this.co[n * 3 + 1] - y), dz = f32(this.co[n * 3 + 2] - z)
            const distSq = f32(f32(f32(dx * dx) + f32(dy * dy)) + f32(dz * dz))
            if (distSq >= minDist) return false
            const r = filter(this.index[n], distSq)
            if (r === 1) {
                minDist = distSq
                minNode = n
                return false
            }
            return r === -1
        }
        const stack: number[] = [this.root]
        while (stack.length) {
            const n = stack.pop()!
            const axis = this.d[n]
            let cur = f32(this.co[n * 3 + axis] - q[axis])
            if (cur < 0) {
                cur = f32(-cur * cur)
                if (-cur < minDist) {
                    if (test(n)) break
                    if (this.left[n] !== UNSET) stack.push(this.left[n])
                }
                if (this.right[n] !== UNSET) stack.push(this.right[n])
            } else {
                cur = f32(cur * cur)
                if (cur < minDist) {
                    if (test(n)) break
                    if (this.right[n] !== UNSET) stack.push(this.right[n])
                }
                if (this.left[n] !== UNSET) stack.push(this.left[n])
            }
        }
        return minNode < 0 ? -1 : this.index[minNode]
    }

    /**
     * `kdtree_range_search_cb` (:588): every point with `distance_squared <= range * range`; `cb` returning false
     * stops the search. Callback order is the traversal order (a stack), not by distance.
     */
    rangeSearch(x: number, y: number, z: number, range: number, cb: (index: number, distSq: number) => boolean): void {
        if (this.root === UNSET) return
        const rangeSq = f32(range * range)
        const q = [x, y, z]
        const stack: number[] = [this.root]
        while (stack.length) {
            const n = stack.pop()!
            const axis = this.d[n]
            const nodeCo = this.co[n * 3 + axis]
            if (f32(q[axis] + range) < nodeCo) {
                if (this.left[n] !== UNSET) stack.push(this.left[n])
            } else if (f32(q[axis] - range) > nodeCo) {
                if (this.right[n] !== UNSET) stack.push(this.right[n])
            } else {
                // `math::distance_squared`: dot of the difference, left to right.
                const dx = f32(this.co[n * 3] - x), dy = f32(this.co[n * 3 + 1] - y), dz = f32(this.co[n * 3 + 2] - z)
                const distSq = f32(f32(f32(dx * dx) + f32(dy * dy)) + f32(dz * dz))
                if (distSq <= rangeSq && cb(this.index[n], distSq) === false) break
                if (this.left[n] !== UNSET) stack.push(this.left[n])
                if (this.right[n] !== UNSET) stack.push(this.right[n])
            }
        }
    }

    /**
     * `kdtree_calc_duplicates_fast` (`BLI_kdtree.hh:723`) with `deduplicate_recursive` (:673): `duplicates[i]` becomes
     * the index `i` merges into; -1 entries are candidates, self-references are kept. Searches go in node order, or by
     * point index with `useIndexOrder` (`kdtree_order`, :646). Returns the number of merges found.
     */
    calcDuplicatesFast(range: number, duplicates: Int32Array, useIndexOrder = false): number {
        let found = 0
        const rangeSq = f32(range * range)
        const recurse = (i: number, search: number, sx: number, sy: number, sz: number) => {
            const axis = this.d[i]
            const s = axis === 0 ? sx : axis === 1 ? sy : sz
            const c = this.co[i * 3 + axis]
            if (f32(s + range) <= c) {
                if (this.left[i] !== UNSET) recurse(this.left[i], search, sx, sy, sz)
            } else if (f32(s - range) >= c) {
                if (this.right[i] !== UNSET) recurse(this.right[i], search, sx, sy, sz)
            } else {
                const index = this.index[i]
                if (search !== index && duplicates[index] === -1) {
                    // `math::distance_squared(node->co, search_co)`.
                    const dx = f32(this.co[i * 3] - sx), dy = f32(this.co[i * 3 + 1] - sy), dz = f32(this.co[i * 3 + 2] - sz)
                    if (f32(f32(f32(dx * dx) + f32(dy * dy)) + f32(dz * dz)) <= rangeSq) {
                        duplicates[index] = search
                        found++
                    }
                }
                if (this.left[i] !== UNSET) recurse(this.left[i], search, sx, sy, sz)
                if (this.right[i] !== UNSET) recurse(this.right[i], search, sx, sy, sz)
            }
        }
        if (this.root === UNSET) return 0
        const search = (n: number, index: number) => {
            if (duplicates[index] !== -1 && duplicates[index] !== index) return
            const prev = found
            recurse(this.root, index, this.co[n * 3], this.co[n * 3 + 1], this.co[n * 3 + 2])
            // Prevent chains of doubles.
            if (found !== prev) duplicates[index] = index
        }
        if (useIndexOrder) {
            let maxIndex = -1
            for (let n = 0; n < this.len; n++) maxIndex = Math.max(maxIndex, this.index[n])
            const order = new Int32Array(maxIndex + 1).fill(-1)
            for (let n = 0; n < this.len; n++) order[this.index[n]] = n
            for (let i = 0; i <= maxIndex; i++) if (order[i] !== -1) search(order[i], i)
        } else {
            for (let n = 0; n < this.len; n++) search(n, this.index[n])
        }
        return found
    }
}

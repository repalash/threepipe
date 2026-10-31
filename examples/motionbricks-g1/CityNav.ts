import {Vector3} from 'threepipe'

// Getting around the block city: the cubes stand on a one-metre grid, and the robot (about 0.6 m across) must go
// around them. A* finds a path through free cells, it is shortened wherever a straight line keeps clear of the
// cubes, and the robot follows it by steering at a point a little way along.

const CLEARANCE = 0.42

export class CityNav {
    /** Blocked cells, as "x,z" for the cell from (x, z) to (x + 1, z + 1). */
    readonly blocked: Set<string>
    /** How far the grid goes from the origin, in metres. */
    readonly extent: number

    constructor(blocked: Set<string>, extent: number) {
        this.blocked = blocked
        this.extent = extent
    }

    isBlocked(cx: number, cz: number) {
        return this.blocked.has(`${cx},${cz}`)
    }

    /** Distance from a ground point to the nearest cube, up to 2 m. */
    clearance(x: number, z: number) {
        let best = 2
        const cx = Math.floor(x), cz = Math.floor(z)
        for (let i = cx - 2; i <= cx + 2; i++) for (let j = cz - 2; j <= cz + 2; j++) {
            if (!this.isBlocked(i, j)) continue
            const dx = Math.max(i - x, 0, x - (i + 1)), dz = Math.max(j - z, 0, z - (j + 1))
            best = Math.min(best, Math.hypot(dx, dz))
        }
        return best
    }

    free(x: number, z: number, margin = CLEARANCE) {
        return this.clearance(x, z) >= margin
    }

    /** Whether the straight line from a to b keeps clear of the cubes. */
    lineFree(ax: number, az: number, bx: number, bz: number, margin = CLEARANCE) {
        const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.15))
        for (let i = 0; i <= n; i++) if (!this.free(ax + (bx - ax) * i / n, az + (bz - az) * i / n, margin)) return false
        return true
    }

    /** The nearest point to (x, z) the robot can stand on. */
    nearestFree(x: number, z: number) {
        if (this.free(x, z)) return new Vector3(x, 0, z)
        for (let r = 0.5; r < 6; r += 0.5) {
            for (let a = 0; a < 16; a++) {
                const px = x + Math.cos(a / 16 * Math.PI * 2) * r, pz = z + Math.sin(a / 16 * Math.PI * 2) * r
                if (this.free(px, pz)) return new Vector3(px, 0, pz)
            }
        }
        return new Vector3(x, 0, z)
    }

    /** A path of ground points from `from` to `to` around the cubes, or null when there is none. */
    path(from: Vector3, to: Vector3): Vector3[] | null {
        const goal = this.nearestFree(to.x, to.z)
        if (this.lineFree(from.x, from.z, goal.x, goal.z)) return [goal]
        // A* over half-metre cells, centres at (i + 0.5) / 2.
        const S = 2, lim = this.extent * S, W = 4096, O = 2048
        const key = (i: number, j: number) => (i + O) * W + j + O
        const cellOf = (k: number): [number, number] => [Math.floor(k / W) - O, k % W - O]
        const center = (i: number, j: number): [number, number] => [(i + 0.5) / S, (j + 0.5) / S]
        const si = Math.floor(from.x * S), sj = Math.floor(from.z * S)
        const gi = Math.floor(goal.x * S), gj = Math.floor(goal.z * S)
        const g = new Map<number, number>(), came = new Map<number, number>(), closed = new Set<number>()
        const heap = new MinHeap()
        const h = (i: number, j: number) => Math.hypot(i - gi, j - gj)
        g.set(key(si, sj), 0)
        heap.push(key(si, sj), h(si, sj))
        let found = -1
        for (let steps = 0; heap.size && steps < 40000; steps++) {
            const cur = heap.pop()
            if (closed.has(cur)) continue
            closed.add(cur)
            const [ci, cj] = cellOf(cur)
            if (ci === gi && cj === gj) {
                found = cur
                break
            }
            for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
                if (!di && !dj) continue
                const ni = ci + di, nj = cj + dj
                const nk = key(ni, nj)
                if (Math.abs(ni) > lim || Math.abs(nj) > lim || closed.has(nk)) continue
                const [x, z] = center(ni, nj)
                const room = this.clearance(x, z)
                if (room < CLEARANCE) continue
                // Prefer the middle of a passage: close to a cube costs more.
                const cost = g.get(cur)! + Math.hypot(di, dj) * (1 + Math.max(0, 1 - room) * 1.5)
                if (cost < (g.get(nk) ?? Infinity)) {
                    g.set(nk, cost)
                    came.set(nk, cur)
                    heap.push(nk, cost + h(ni, nj))
                }
            }
        }
        if (found < 0) return null
        const cells: Vector3[] = []
        for (let k: number | undefined = found; k !== undefined; k = came.get(k)) {
            const [x, z] = center(...cellOf(k))
            cells.unshift(new Vector3(x, 0, z))
        }
        cells[cells.length - 1] = goal
        // Keep only the corners: skip every point a straight line can reach past.
        const points: Vector3[] = []
        let at = new Vector3(from.x, 0, from.z)
        for (let i = 0; i < cells.length;) {
            let j = cells.length - 1
            while (j > i && !this.lineFree(at.x, at.z, cells[j].x, cells[j].z)) j--
            points.push(cells[j])
            at = cells[j]
            i = j + 1
        }
        return points
    }
}

/** A binary heap of keys by priority, smallest first. */
class MinHeap {
    private _keys: number[] = []
    private _values: number[] = []

    get size() {
        return this._keys.length
    }

    push(key: number, value: number) {
        const k = this._keys, v = this._values
        let i = k.length
        k.push(key)
        v.push(value)
        while (i > 0) {
            const parent = i - 1 >> 1
            if (v[parent] <= v[i]) break
            ;[k[i], k[parent]] = [k[parent], k[i]]
            ;[v[i], v[parent]] = [v[parent], v[i]]
            i = parent
        }
    }

    pop() {
        const k = this._keys, v = this._values
        const top = k[0]
        const lastKey = k.pop()!, lastValue = v.pop()!
        if (k.length) {
            k[0] = lastKey
            v[0] = lastValue
            for (let i = 0; ;) {
                const l = 2 * i + 1, r = l + 1
                let m = i
                if (l < k.length && v[l] < v[m]) m = l
                if (r < k.length && v[r] < v[m]) m = r
                if (m === i) break
                ;[k[i], k[m]] = [k[m], k[i]]
                ;[v[i], v[m]] = [v[m], v[i]]
                i = m
            }
        }
        return top
    }
}

/** Follows a path by steering at a point `lookahead` metres along it, and hands the last stretch to moveTo. */
export class PathFollower {
    path: Vector3[] = []
    private _finishing = false

    set(path: Vector3[]) {
        this.path = path
        this._finishing = false
    }

    clear() {
        this.path = []
        this._finishing = false
    }

    get active() {
        return this.path.length > 0 && !this._finishing
    }

    /**
     * The direction to steer this frame, 'finish' when the rest is a straight run to the end (call moveTo with the
     * last point), or null when there is no path.
     */
    update(position: Vector3, stopDistance: number, lookahead: number): Vector3 | 'finish' | null {
        if (!this.path.length || this._finishing) return null
        // Drop the corners already reached.
        while (this.path.length > 1 && position.distanceTo(this.path[0]) < 0.6) this.path.shift()
        let left = position.distanceTo(this.path[0])
        for (let i = 1; i < this.path.length; i++) left += this.path[i - 1].distanceTo(this.path[i])
        if (this.path.length === 1 || left < stopDistance) {
            this._finishing = true
            return 'finish'
        }
        // The point `lookahead` metres along the path.
        let remaining = lookahead, from = position.clone()
        for (const p of this.path) {
            const d = from.distanceTo(p)
            if (d >= remaining) return p.clone().sub(from).setLength(remaining).add(from).sub(position).setY(0)
            remaining -= d
            from = p
        }
        return this.path[this.path.length - 1].clone().sub(position).setY(0)
    }
}

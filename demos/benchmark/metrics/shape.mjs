// Shape metrics between two triangle soups: seeded area-weighted surface sampling, a BVH for closest-point
// queries, Chamfer / Hausdorff / F-score, and a trimmed ICP that refines a similarity transform.
//
// - Sampling: uniform on the surface, a triangle picked by area, then the barycentric point of Osada, Funkhouser,
//   Chazelle, Dobkin, "Shape distributions" (ACM TOG 2002) eq. 1: P = (1 - sqrt(r1)) A + sqrt(r1) (1 - r2) B + sqrt(r1) r2 C.
// - Closest point on a triangle: three's Triangle.closestPointToPoint (Ericson, Real-Time Collision Detection 5.1.5).
// - F-score at a distance threshold: Knapitsch, Park, Zhou, Koltun, "Tanks and Temples" (SIGGRAPH 2017) - precision
//   (candidate points within tau of the reference), recall (reference points within tau of the candidate).
// - Absolute orientation: Horn, "Closed-form solution of absolute orientation using unit quaternions" (JOSA A 4(4),
//   1987): rotation = eigenvector of the largest eigenvalue of the 4x4 matrix N (section 4), scale from the
//   symmetric formula (section 2.D), translation from the centroids (section 2.C).
// - Trimmed ICP: Chetverikov, Svirko, Stepanov, Krsek, "The Trimmed Iterative Closest Point algorithm" (ICPR 2002):
//   each iteration fits only the best `keep` fraction of the correspondences.

import {Matrix4, Quaternion, Triangle, Vector3} from 'three'

/** mulberry32: a small seeded PRNG, so a benchmark run samples the same points every time. */
export function rng(seed = 1) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/**
 * Flatten parts ({position, index}) into one triangle soup.
 * @returns {{tris: Float64Array, part: Int32Array, count: number}} tris: 9 numbers per triangle, part: its part index
 */
export function soup(parts, matrix = null) {
    let n = 0
    for (const p of parts) n += p.index.length / 3
    const tris = new Float64Array(n * 9), part = new Int32Array(n)
    const m = matrix ? new Matrix4().fromArray(matrix) : null
    const v = new Vector3()
    let t = 0
    parts.forEach((p, pi) => {
        const P = p.position, I = p.index
        for (let k = 0; k < I.length; k += 3, t++) {
            for (let c = 0; c < 3; c++) {
                const i = I[k + c] * 3
                v.set(P[i], P[i + 1], P[i + 2])
                if (m) v.applyMatrix4(m)
                tris[t * 9 + c * 3] = v.x; tris[t * 9 + c * 3 + 1] = v.y; tris[t * 9 + c * 3 + 2] = v.z
            }
            part[t] = pi
        }
    })
    return {tris, part, count: n}
}

export function triArea(tris, t) {
    const o = t * 9
    const ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2]
    const vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2]
    return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
}

/** Total surface area of a soup. */
export function area(s) {
    let a = 0
    for (let t = 0; t < s.count; t++) a += triArea(s.tris, t)
    return a
}

/**
 * `n` points uniformly distributed over the surface (area-weighted), deterministic for a seed.
 * @returns {{points: Float64Array, tri: Int32Array}}
 */
export function sample(s, n, seed = 1) {
    const cdf = new Float64Array(s.count)
    let acc = 0
    for (let t = 0; t < s.count; t++) { acc += triArea(s.tris, t); cdf[t] = acc }
    const r = rng(seed)
    const points = new Float64Array(n * 3), tri = new Int32Array(n)
    for (let i = 0; i < n; i++) {
        const x = r() * acc
        let lo = 0, hi = s.count - 1
        while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < x) lo = mid + 1; else hi = mid }
        const o = lo * 9, s1 = Math.sqrt(r()), r2 = r()
        const a = 1 - s1, b = s1 * (1 - r2), c = s1 * r2
        for (let k = 0; k < 3; k++) points[i * 3 + k] = a * s.tris[o + k] + b * s.tris[o + 3 + k] + c * s.tris[o + 6 + k]
        tri[i] = lo
    }
    return {points, tri}
}

/** A bounding-volume hierarchy over a soup's triangles (median split on the longest centroid axis). */
export class TriangleBVH {
    constructor(s, leafSize = 8) {
        this.s = s
        const n = s.count
        this.order = Int32Array.from({length: n}, (_, i) => i)
        const cen = new Float64Array(n * 3)
        for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) cen[t * 3 + k] = (s.tris[t * 9 + k] + s.tris[t * 9 + 3 + k] + s.tris[t * 9 + 6 + k]) / 3
        // nodes: [minx, miny, minz, maxx, maxy, maxz, left|start, right|count, isLeaf]
        this.nodes = []
        const build = (start, end) => {
            const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
            const cb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
            for (let i = start; i < end; i++) {
                const t = this.order[i]
                for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) {
                    const v = s.tris[t * 9 + c * 3 + k]
                    if (v < box[k]) box[k] = v
                    if (v > box[k + 3]) box[k + 3] = v
                }
                for (let k = 0; k < 3; k++) { const v = cen[t * 3 + k]; if (v < cb[k]) cb[k] = v; if (v > cb[k + 3]) cb[k + 3] = v }
            }
            const id = this.nodes.length
            this.nodes.push(null)
            if (end - start <= leafSize) { this.nodes[id] = [...box, start, end - start, 1]; return id }
            const ext = [cb[3] - cb[0], cb[4] - cb[1], cb[5] - cb[2]]
            const ax = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2
            const sub = Array.from(this.order.subarray(start, end)).sort((a, b) => cen[a * 3 + ax] - cen[b * 3 + ax])
            this.order.set(sub, start)
            const mid = (start + end) >> 1
            const l = build(start, mid), r = build(mid, end)
            this.nodes[id] = [...box, l, r, 0]
            return id
        }
        if (n) build(0, n)
        this._tri = new Triangle()
        this._a = new Vector3(); this._b = new Vector3(); this._c = new Vector3(); this._p = new Vector3(); this._q = new Vector3()
    }

    static boxDist2(n, x, y, z) {
        const dx = Math.max(n[0] - x, 0, x - n[3]), dy = Math.max(n[1] - y, 0, y - n[4]), dz = Math.max(n[2] - z, 0, z - n[5])
        return dx * dx + dy * dy + dz * dz
    }

    /** Closest point on the surface to (x, y, z): {d2, tri, point: [x, y, z]}. */
    closest(x, y, z, maxD2 = Infinity) {
        let best = maxD2, bestTri = -1
        const out = [0, 0, 0]
        if (!this.nodes.length) return {d2: Infinity, tri: -1, point: out}
        const T = this.s.tris, tri = this._tri, p = this._p.set(x, y, z), q = this._q
        const stack = [0]
        while (stack.length) {
            const n = this.nodes[stack.pop()]
            if (TriangleBVH.boxDist2(n, x, y, z) >= best) continue
            if (n[8]) {
                for (let i = n[6], e = n[6] + n[7]; i < e; i++) {
                    const t = this.order[i], o = t * 9
                    tri.set(this._a.set(T[o], T[o + 1], T[o + 2]), this._b.set(T[o + 3], T[o + 4], T[o + 5]), this._c.set(T[o + 6], T[o + 7], T[o + 8]))
                    tri.closestPointToPoint(p, q)
                    const d2 = q.distanceToSquared(p)
                    if (d2 < best) { best = d2; bestTri = t; out[0] = q.x; out[1] = q.y; out[2] = q.z }
                }
            } else {
                const l = this.nodes[n[6]], r = this.nodes[n[7]]
                const dl = TriangleBVH.boxDist2(l, x, y, z), dr = TriangleBVH.boxDist2(r, x, y, z)
                // push the farther first, so the nearer is searched first
                if (dl < dr) { if (dr < best) stack.push(n[7]); if (dl < best) stack.push(n[6]) }
                else { if (dl < best) stack.push(n[6]); if (dr < best) stack.push(n[7]) }
            }
        }
        return {d2: best, tri: bestTri, point: out}
    }
}

/** Distances from each point to the surface in `bvh`. */
export function distances(points, bvh) {
    const n = points.length / 3, d = new Float64Array(n)
    for (let i = 0; i < n; i++) d[i] = Math.sqrt(bvh.closest(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]).d2)
    return d
}

export function percentile(values, q) {
    if (!values.length) return NaN
    const s = Float64Array.from(values).sort()
    return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
}

const mean = a => { let s = 0; for (const v of a) s += v; return a.length ? s / a.length : NaN }

/**
 * Two-sided distance summary. `dAB`: candidate points to the reference surface (accuracy / precision side);
 * `dBA`: reference points to the candidate surface (completeness / recall side).
 */
export function summarize(dAB, dBA, taus = [1, 2, 5]) {
    const f = {}
    for (const t of taus) {
        let p = 0, r = 0
        for (const v of dAB) if (v <= t) p++
        for (const v of dBA) if (v <= t) r++
        p /= dAB.length; r /= dBA.length
        f[t] = {precision: p, recall: r, f: p + r > 0 ? 2 * p * r / (p + r) : 0}
    }
    const mAB = mean(dAB), mBA = mean(dBA)
    return {
        accuracy: mAB, completeness: mBA, chamfer: (mAB + mBA) / 2,
        hausdorff: Math.max(percentile(dAB, 1), percentile(dBA, 1)),
        hausdorff95: Math.max(percentile(dAB, 0.95), percentile(dBA, 0.95)),
        fscore: f,
    }
}

/** Eigen-decomposition of a symmetric matrix (cyclic Jacobi). Returns {values, vectors (columns)}. */
export function jacobiEigen(A, n = A.length, sweeps = 50) {
    const a = A.map(r => r.slice()), v = Array.from({length: n}, (_, i) => Array.from({length: n}, (_, j) => +(i === j)))
    for (let s = 0; s < sweeps; s++) {
        let off = 0
        for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q]
        if (off < 1e-30) break
        for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
            if (Math.abs(a[p][q]) < 1e-300) continue
            const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
            const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
            const c = 1 / Math.sqrt(t * t + 1), sn = t * c
            for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - sn * akq; a[k][q] = sn * akp + c * akq }
            for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - sn * aqk; a[q][k] = sn * apk + c * aqk }
            for (let k = 0; k < n; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - sn * vkq; v[k][q] = sn * vkp + c * vkq }
        }
    }
    return {values: a.map((r, i) => r[i]), vectors: v}
}

/**
 * Horn 1987: the similarity (s, R, t) minimising sum |y_i - (s R x_i + t)|^2 over paired points.
 * @param {'translation'|'scale-translation'|'rigid'|'similarity'} mode
 * @returns {Matrix4}
 */
export function absoluteOrientation(X, Y, mode = 'similarity') {
    const n = X.length / 3
    const cx = [0, 0, 0], cy = [0, 0, 0]
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { cx[k] += X[i * 3 + k] / n; cy[k] += Y[i * 3 + k] / n }
    if (mode === 'translation') return new Matrix4().makeTranslation(cy[0] - cx[0], cy[1] - cx[1], cy[2] - cx[2])
    if (mode === 'scale-translation') {
        // rotation held at identity: Horn's symmetric scale (section 2.D) and the centroid translation (2.C)
        let sx = 0, sy = 0
        for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { sx += (X[i * 3 + k] - cx[k]) ** 2; sy += (Y[i * 3 + k] - cy[k]) ** 2 }
        const s = Math.sqrt(sy / sx)
        return new Matrix4().makeScale(s, s, s).setPosition(cy[0] - s * cx[0], cy[1] - s * cx[1], cy[2] - s * cx[2])
    }
    const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    let sx = 0, sy = 0
    for (let i = 0; i < n; i++) {
        const x = [X[i * 3] - cx[0], X[i * 3 + 1] - cx[1], X[i * 3 + 2] - cx[2]]
        const y = [Y[i * 3] - cy[0], Y[i * 3 + 1] - cy[1], Y[i * 3 + 2] - cy[2]]
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) S[a][b] += x[a] * y[b]
        sx += x[0] * x[0] + x[1] * x[1] + x[2] * x[2]
        sy += y[0] * y[0] + y[1] * y[1] + y[2] * y[2]
    }
    const [[Sxx, Sxy, Sxz], [Syx, Syy, Syz], [Szx, Szy, Szz]] = S
    const N = [
        [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
        [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
        [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
        [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
    ]
    const {values, vectors} = jacobiEigen(N, 4)
    let best = 0
    for (let i = 1; i < 4; i++) if (values[i] > values[best]) best = i
    const [q0, qx, qy, qz] = [0, 1, 2, 3].map(k => vectors[k][best])
    const R = new Matrix4().makeRotationFromQuaternion(new Quaternion(qx, qy, qz, q0).normalize())
    // Horn section 2.D, the symmetric scale: s = sqrt(sum |y'|^2 / sum |x'|^2)
    const s = mode === 'similarity' ? Math.sqrt(sy / sx) : 1
    const M = new Matrix4().makeScale(s, s, s).premultiply(R)
    const c = new Vector3(...cx).applyMatrix4(M)
    M.setPosition(cy[0] - c.x, cy[1] - c.y, cy[2] - c.z)
    return M
}

/**
 * Trimmed ICP: refine `initial` (maps source into the target frame) so the source surface lies on the target's.
 * @returns {{matrix: Matrix4, iterations: number, rms: number, history: number[]}}
 */
export function icp(sourcePoints, targetBVH, initial, {mode = 'similarity', keep = 0.9, iterations = 100, tolerance = 1e-6} = {}) {
    let M = initial.clone()
    const n = sourcePoints.length / 3
    const v = new Vector3()
    const history = []
    let prev = Infinity, it = 0, rms = NaN
    for (; it < iterations; it++) {
        const X = new Float64Array(n * 3), Y = new Float64Array(n * 3), d = new Float64Array(n)
        for (let i = 0; i < n; i++) {
            v.set(sourcePoints[i * 3], sourcePoints[i * 3 + 1], sourcePoints[i * 3 + 2]).applyMatrix4(M)
            const c = targetBVH.closest(v.x, v.y, v.z)
            X[i * 3] = v.x; X[i * 3 + 1] = v.y; X[i * 3 + 2] = v.z
            Y[i * 3] = c.point[0]; Y[i * 3 + 1] = c.point[1]; Y[i * 3 + 2] = c.point[2]
            d[i] = c.d2
        }
        const cut = percentile(d, keep)
        const idx = []
        for (let i = 0; i < n; i++) if (d[i] <= cut) idx.push(i)
        const Xk = new Float64Array(idx.length * 3), Yk = new Float64Array(idx.length * 3)
        idx.forEach((i, j) => { for (let k = 0; k < 3; k++) { Xk[j * 3 + k] = X[i * 3 + k]; Yk[j * 3 + k] = Y[i * 3 + k] } })
        let e = 0
        for (const i of idx) e += d[i]
        rms = Math.sqrt(e / idx.length)
        history.push(rms)
        const step = absoluteOrientation(Xk, Yk, mode)
        M = step.multiply(M)
        if (Math.abs(prev - rms) < tolerance * Math.max(1, rms)) { it++; break }
        prev = rms
    }
    return {matrix: M, iterations: it, rms, history}
}

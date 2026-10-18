// Subdivision cages fitted to measured outlines (16-realism.md §3.3).
//
// A closed control polygon P subdivided by Catmull-Clark has, along a band of regular quads, the uniform cubic
// B-spline of P as its limit curve, and the limit position of control point i is (P[i-1] + 4 P[i] + P[i+1]) / 6
// (OpenSubdiv 3.7.0 opensubdiv/sdc/catmarkScheme.h:244-261, assignSmoothLimitMask: the regular valence-4 mask
// 4/9, 1/9, 1/36 is the tensor product of 1/6, 4/6, 1/6, so on a straight extrusion, where a point's neighbours
// across the band sit at the same profile position, it projects to the curve mask; the crease mask at :215-222 is
// the same 2/3, 1/6, 1/6).
// fitClosedCage solves for P so that those limit points land on a target outline, which is how a measured
// silhouette becomes a cage without hand-placing support loops.

/** Resample a closed polyline (array of [a, b]) to n points, spaced by arclength weighted by local turning. */
export function resampleClosed(poly, n, cornerWeight = 4) {
    const m = poly.length
    const seg = []
    let total = 0
    for (let i = 0; i < m; i++) {
        const a = poly[i], b = poly[(i + 1) % m]
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        // turning at both ends of the segment, in radians
        const turn = k => {
            const p = poly[(k - 1 + m) % m], q = poly[k], r = poly[(k + 1) % m]
            const a1 = Math.atan2(q[1] - p[1], q[0] - p[0]), a2 = Math.atan2(r[1] - q[1], r[0] - q[0])
            let d = a2 - a1
            while (d > Math.PI) d -= 2 * Math.PI
            while (d < -Math.PI) d += 2 * Math.PI
            return Math.abs(d)
        }
        const w = len * (1 + cornerWeight * (turn(i) + turn((i + 1) % m)) / 2 / Math.max(len, 1e-6) * 5)
        seg.push({a, b, len, w})
        total += w
    }
    const out = []
    let acc = 0, si = 0
    for (let k = 0; k < n; k++) {
        const target = k / n * total
        while (si < m - 1 && acc + seg[si].w < target) { acc += seg[si].w; si++ }
        const t = Math.min(1, Math.max(0, (target - acc) / seg[si].w))
        const {a, b} = seg[si]
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
    return out
}

/** Control polygon whose cubic B-spline limit points interpolate `target` (closed). */
export function fitClosedCage(target, iterations = 200) {
    const n = target.length
    const P = target.map(p => [...p])
    for (let it = 0; it < iterations; it++) {
        let err = 0
        for (let i = 0; i < n; i++) {
            const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n]
            for (let k = 0; k < 2; k++) {
                const L = (a[k] + 4 * b[k] + c[k]) / 6
                const d = target[i][k] - L
                b[k] += d
                err = Math.max(err, Math.abs(d))
            }
        }
        if (err < 1e-4) break
    }
    return P
}

/** Signed area of a closed polygon in (a, b); positive is counter-clockwise. */
export function signedArea(poly) {
    let s = 0
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length]
        s += p[0] * q[1] - q[0] * p[1]
    }
    return s / 2
}

/**
 * Commands for a prism cage: `primitive cylinder` along `axis` with one segment per profile point, then every
 * vertex placed. The cylinder's vertex 2i is ring i at the low end of the axis and 2i+1 at the high end, and the
 * ring runs clockwise seen from +axis starting at the top (+y, or -z for a y axis), so the profile is passed in
 * that order to keep the faces facing out.
 * `place(i, end, p)` returns the world position of ring i at end 0 (low) or 1 (high) for profile point p.
 */
export function prismCage(name, axis, profile, place) {
    const n = profile.length
    const verts = []
    for (let i = 0; i < n; i++) for (let e = 0; e < 2; e++) verts.push([2 * i + e, ...place(i, e, profile[i]).map(v => +v.toFixed(4))])
    return [
        {op: 'primitive', type: 'cylinder', name, axis, segments: n, radius: 10, height: 10, position: [0, 0, 0]},
        {op: 'vertices', object: name, verts},
    ]
}

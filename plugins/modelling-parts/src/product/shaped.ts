/**
 * Non-round product parts built from stacked rings of one closed outline: rockers and levers (a rounded rectangle
 * extruded with a chamfered top), the eyecup (a rounded-rectangle rubber frame with a window) and strap lugs (a
 * wire swept round a closed path).
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {PartDefinition, PartResult, Vec3} from '../types'

/** A rounded rectangle centred on the origin in (a, b), `n` points per corner, counter-clockwise from +a. */
export function roundedRect(w: number, h: number, r: number, n = 4): [number, number][] {
    r = Math.min(r, w / 2 - 1e-6, h / 2 - 1e-6)
    const out: [number, number][] = []
    const corners: [number, number, number][] = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]]
    for (const [cx, cy, a0] of corners) {
        for (let k = 0; k <= n; k++) {
            const a = (a0 + 90 * k / n) * Math.PI / 180
            out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
        }
    }
    return out
}

/**
 * Rings of one outline stacked along an axis, bridged by quads, the ends closed by n-gons (or left open).
 * `rings[k]` = {scale: [sa, sb] or offset outline, at: position along the axis}. Outline in (a, b), axis c:
 * world = a * A + b * B + c * C.
 */
function stack(outlines: {pts: [number, number][], c: number}[], frame: {A: Vec3, B: Vec3, C: Vec3}, closeStart = true, closeEnd = true): MeshData {
    const n = outlines[0].pts.length
    const positions: number[] = []
    for (const o of outlines) {
        if (o.pts.length !== n) throw new Error('stack: rings must have the same point count')
        for (const [a, b] of o.pts) {
            for (let k = 0; k < 3; k++) positions.push(a * frame.A[k] + b * frame.B[k] + o.c * frame.C[k])
        }
    }
    const faces: number[][] = []
    for (let r = 0; r < outlines.length - 1; r++) {
        for (let i = 0; i < n; i++) {
            const i2 = (i + 1) % n
            faces.push([r * n + i, r * n + i2, (r + 1) * n + i2, (r + 1) * n + i])
        }
    }
    const last = outlines.length - 1
    if (closeStart) faces.push(Array.from({length: n}, (_, i) => n - 1 - i))
    if (closeEnd) faces.push(Array.from({length: n}, (_, i) => last * n + i))
    return MeshData.fromFaces({positions, faces})
}

/** Offset a convex closed outline outwards by d (per-vertex, along the averaged edge normals). */
function offsetOutline(pts: [number, number][], d: number): [number, number][] {
    const n = pts.length
    return pts.map((p, i) => {
        const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n]
        const t = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(t[0], t[1]) || 1
        // counter-clockwise outline: outward normal is (t.y, -t.x)
        return [p[0] + d * t[1] / l, p[1] - d * t[0] / l] as [number, number]
    })
}

export interface RockerParams {
    length: number
    width: number
    height: number
    radius?: number
    chamfer?: number
}

export const rocker: PartDefinition<RockerParams> = {
    id: 'product/rocker',
    title: 'Rocker, lever or slide knob',
    tags: ['switch', 'lever', 'button', 'slider'],
    params: {
        type: 'object',
        properties: {
            length: {type: 'number', description: 'Size along x.'},
            width: {type: 'number', description: 'Size along z.'},
            height: {type: 'number', description: 'Height above the surface (+y).'},
            radius: {type: 'number', description: 'Corner radius in plan. Default min(length, width) x 0.3.'},
            chamfer: {type: 'number', description: 'Top edge chamfer. Default height x 0.3.'},
        },
        required: ['length', 'width', 'height'],
        additionalProperties: false,
    },
    build(p) {
        const r = p.radius ?? Math.min(p.length, p.width) * 0.3, h = p.height, c = Math.min(p.chamfer ?? h * 0.3, h * 0.9, Math.min(p.length, p.width) * 0.3)
        const base = roundedRect(p.length, p.width, r)
        const topO = roundedRect(p.length - 2 * c, p.width - 2 * c, Math.max(r - c, 0.05))
        // plan in (x, -z) so a counter-clockwise outline faces +y
        const mesh = stack([{pts: base, c: -0.3}, {pts: base, c: h - c}, {pts: topO, c: h}], {A: [1, 0, 0], B: [0, 0, -1], C: [0, 1, 0]})
        return shaped(mesh, h, Math.max(p.length, p.width) / 2, 40)
    },
}

export interface EyecupParams {
    width: number
    height: number
    depth: number
    radius?: number
    windowWidth?: number
    windowHeight?: number
    windowRadius?: number
    windowDepth?: number
    flare?: number
}

export const eyecup: PartDefinition<EyecupParams> = {
    id: 'product/eyecup',
    title: 'Eyecup',
    tags: ['eyecup', 'viewfinder', 'rubber'],
    params: {
        type: 'object',
        properties: {
            width: {type: 'number', description: 'Outer width (x).'},
            height: {type: 'number', description: 'Outer height (y in the outline, z of the part).'},
            depth: {type: 'number', description: 'How far it stands out (+y).'},
            radius: {type: 'number', description: 'Outer corner radius. Default height x 0.3.'},
            windowWidth: {type: 'number', description: 'Window width. Default width x 0.55.'},
            windowHeight: {type: 'number', description: 'Window height. Default height x 0.5.'},
            windowRadius: {type: 'number', description: 'Window corner radius. Default 1.5.'},
            windowDepth: {type: 'number', description: 'How deep the window goes in. Default depth x 0.9.'},
            flare: {type: 'number', description: 'Outward flare of the rim at the front. Default 1.'},
        },
        required: ['width', 'height', 'depth'],
        additionalProperties: false,
    },
    build(p) {
        const W = p.width, H = p.height, D = p.depth, R = p.radius ?? H * 0.3
        const ww = p.windowWidth ?? W * 0.55, wh = p.windowHeight ?? H * 0.5, wr = p.windowRadius ?? 1.5, wd = p.windowDepth ?? D * 0.9
        const fl = p.flare ?? 1
        const n = 6
        const outer = roundedRect(W, H, R, n)
        // the window is resampled to the outer outline's point count, by matching angles round the centre
        const win = resample(roundedRect(ww, wh, wr, n), outer.length)
        const rim = (o: [number, number][], k: number) => offsetOutline(o, k)
        // a soft rubber section: the wall bulges out, rolls over a rounded rim (radius rr) onto a top band, then rolls
        // in over a second, smaller radius into the window. ring(s, e, c): outline lerped from outer (s 0) to the
        // window (s 1), offset outwards by e, at height c.
        const ring = (sv: number, e: number, c: number) => ({pts: rim(roundedRectLerp(outer, win, sv), e), c})
        const rr = Math.min(D * 0.45, (Math.min(W - ww, H - wh)) / 4)
        const ri = rr * 0.6
        const rings = [ring(0, 0, 0), ring(0, fl * 0.55, D * 0.35)]
        for (let k = 0; k <= 4; k++) {
            const t = k / 4 * Math.PI / 2
            rings.push(ring(0, fl - rr + rr * Math.cos(t), D - rr + rr * Math.sin(t)))
        }
        // across the top band (outer rim inner edge at s0, inner roll starts at s1)
        const s0 = Math.min(0.3, rr / Math.max(1e-6, (W - ww) / 2)), s1 = 1 - Math.min(0.45, ri / Math.max(1e-6, (W - ww) / 2))
        rings.push(ring((s0 + s1) / 2, 0, D))
        for (let k = 0; k <= 4; k++) {
            const t = k / 4 * Math.PI / 2
            rings.push(ring(s1 + (1 - s1) * Math.sin(t), 0, D - ri + ri * Math.cos(t)))
        }
        rings.push(ring(1, 0, D - wd))
        const mesh = stack(rings, {A: [1, 0, 0], B: [0, 0, -1], C: [0, 1, 0]}, true, true)
        return shaped(mesh, D, Math.max(W, H) / 2, 30)
    },
}

function resample(pts: [number, number][], n: number): [number, number][] {
    // by arc length, starting at the first point
    const m = pts.length
    const L = [0]
    for (let i = 1; i <= m; i++) L.push(L[i - 1] + Math.hypot(pts[i % m][0] - pts[i - 1][0], pts[i % m][1] - pts[i - 1][1]))
    const out: [number, number][] = []
    let s = 0
    for (let k = 0; k < n; k++) {
        const t = k / n * L[m]
        while (s < m - 1 && L[s + 1] < t) s++
        const u = (t - L[s]) / (L[s + 1] - L[s] || 1), a = pts[s], b = pts[(s + 1) % m]
        out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u])
    }
    return out
}

function roundedRectLerp(a: [number, number][], b: [number, number][], t: number): [number, number][] {
    return a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t])
}

export interface StrapLugParams {
    width: number
    height: number
    wire?: number
    segments?: number
}

export const strapLug: PartDefinition<StrapLugParams> = {
    id: 'product/strap-lug',
    title: 'Strap lug',
    tags: ['lug', 'strap', 'eyelet'],
    params: {
        type: 'object',
        properties: {
            width: {type: 'number', description: 'Outer width of the loop (z).'},
            height: {type: 'number', description: 'How far the loop stands out (+x).'},
            wire: {type: 'number', description: 'Wire radius. Default 1.'},
            segments: {type: 'integer', description: 'Samples round the loop. Default 24.', minimum: 8},
        },
        required: ['width', 'height'],
        additionalProperties: false,
    },
    build(p) {
        const w = p.wire ?? 1, W = p.width / 2 - w, Hh = p.height - w, ns = p.segments ?? 24, m = 8
        // a D-shaped loop in the xz plane: straight along the body (x = 0), a half ellipse outwards
        const path: [number, number][] = []
        for (let k = 0; k < ns; k++) {
            const t = k / ns
            if (t < 0.5) {
                const a = Math.PI * (t / 0.5) - Math.PI / 2
                path.push([Hh * Math.cos(a), W * Math.sin(a)])
            } else {
                const u = (t - 0.5) / 0.5
                path.push([0, W - 2 * W * u])
            }
        }
        const positions: number[] = []
        for (let k = 0; k < ns; k++) {
            const a = path[(k - 1 + ns) % ns], b = path[(k + 1) % ns], c = path[k]
            const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1
            const nx = tz / l, nz = -tx / l // in-plane normal
            for (let j = 0; j < m; j++) {
                const t = j / m * Math.PI * 2
                positions.push(c[0] + w * Math.cos(t) * nx, w * Math.sin(t), c[1] + w * Math.cos(t) * nz)
            }
        }
        const faces: number[][] = []
        for (let k = 0; k < ns; k++) for (let j = 0; j < m; j++) {
            const k2 = (k + 1) % ns, j2 = (j + 1) % m
            faces.push([k * m + j, k * m + j2, k2 * m + j2, k2 * m + j])
        }
        const mesh = MeshData.fromFaces({positions, faces})
        return {mesh, groups: {}, anchors: {base: {position: [0, 0, 0], normal: [-1, 0, 0]}, tip: {position: [p.height, 0, 0], normal: [1, 0, 0]}}, smoothAngle: 60}
    },
}

function shaped(mesh: MeshData, height: number, radius: number, smoothAngle: number): PartResult {
    // planar uv (x, z) for prints and relief
    const uv = mesh.attributes.ensure('uv', AttrDomain.Corner, 'float2').data
    const P = mesh.positions, CV = mesh.cornerVerts
    for (let c = 0; c < mesh.cornersNum; c++) { uv[2 * c] = P[3 * CV[c]] / (2 * radius) + 0.5; uv[2 * c + 1] = P[3 * CV[c] + 2] / (2 * radius) + 0.5 }
    return {
        mesh, groups: {},
        anchors: {base: {position: [0, 0, 0], normal: [0, -1, 0]}, top: {position: [0, height, 0], normal: [0, 1, 0]}},
        smoothAngle,
    }
}

/** Chaikin corner cutting on a closed polyline - a smooth outline from a few hand-placed points. */
export function chaikinClosed(pts: [number, number][], iterations = 2): [number, number][] {
    let p = pts
    for (let it = 0; it < iterations; it++) {
        const q: [number, number][] = []
        for (let i = 0; i < p.length; i++) {
            const a = p[i], b = p[(i + 1) % p.length]
            q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]])
        }
        p = q
    }
    return p
}

const area2 = (p: [number, number][]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1] }, 0)

export interface PadParams {
    outline: [number, number][]
    thickness: number
    round?: number
    smooth?: number
    samples?: number
}

export const pad: PartDefinition<PadParams> = {
    id: 'product/pad',
    title: 'Pad (raised panel with a rounded edge)',
    tags: ['pad', 'thumb rest', 'panel', 'rubber', 'grip'],
    params: {
        type: 'object',
        properties: {
            outline: {type: 'array', description: 'Closed outline points [a, b]: a along x, b along -z (seen from +y, the pad\'s face). A few points; it is smoothed.', items: {type: 'array'}},
            thickness: {type: 'number', description: 'Height above the surface (+y).'},
            round: {type: 'number', description: 'Radius of the rounded top edge. Default thickness x 0.6.'},
            smooth: {type: 'integer', description: 'Chaikin smoothing passes on the outline. Default 3.', minimum: 0, maximum: 6},
            samples: {type: 'integer', description: 'Points round the outline after smoothing. Default 120.', minimum: 12},
        },
        required: ['outline', 'thickness'],
        additionalProperties: false,
    },
    build(p) {
        let o = chaikinClosed(p.outline, p.smooth ?? 3)
        if (area2(o) < 0) o = [...o].reverse()
        o = resample(o, p.samples ?? 120)
        const T = p.thickness, R = Math.min(p.round ?? T * 0.6, T * 0.95)
        const rings: {pts: [number, number][], c: number}[] = [{pts: o, c: -0.3}, {pts: o, c: T - R}]
        for (let k = 1; k <= 4; k++) {
            const t = k / 4 * Math.PI / 2
            rings.push({pts: offsetOutline(o, -R * (1 - Math.cos(t))), c: T - R + R * Math.sin(t)})
        }
        const mesh = stack(rings, {A: [1, 0, 0], B: [0, 0, -1], C: [0, 1, 0]})
        let bx = 0
        for (const [a, b] of o) bx = Math.max(bx, Math.abs(a), Math.abs(b))
        return shaped(mesh, T, bx, 35)
    },
}

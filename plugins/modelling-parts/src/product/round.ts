/**
 * Round product parts, all surfaces of revolution about +y built by {@link revolve}: knurled rings (lens focus and
 * zoom rubber, dial sides), dials, round buttons and lens barrel sections. Units are the caller's (mm for the
 * camera). Ribs are real geometry with hard rib edges (the realism benchmark's reference models the 167 lens ribs
 * as bodies, 16-realism.md §1.2), not a texture.
 */

import {revolve} from '../revolve'
import {PartDefinition, PartResult} from '../types'

/**
 * Angular samples for `ribs` ribs: each rib period has a flat top of `ribWidth` of the period, two flanks of
 * `flank` and a flat groove between - four samples per period.
 */
export function ribAngles(ribs: number, ribWidth: number, flank = 0.12): {angles: number[], top: boolean[]} {
    const P = Math.PI * 2 / ribs
    const w = Math.min(0.9, Math.max(0.1, ribWidth)), f = Math.min(flank, (1 - w) / 2 - 0.01)
    const angles: number[] = [], top: boolean[] = []
    for (let k = 0; k < ribs; k++) {
        const a0 = k * P
        angles.push(a0, a0 + w * P, a0 + (w + f) * P, a0 + (1 - f) * P)
        top.push(true, true, false, false)
    }
    return {angles, top}
}

export interface KnurledRingParams {
    radius: number
    length: number
    innerRadius?: number
    ribs?: number
    ribDepth?: number
    ribWidth?: number
    chamfer?: number
}

export const knurledRing: PartDefinition<KnurledRingParams> = {
    id: 'product/knurled-ring',
    title: 'Knurled ring',
    tags: ['lens', 'grip', 'ring', 'rubber'],
    params: {
        type: 'object',
        properties: {
            radius: {type: 'number', description: 'Outer radius at the rib tops.'},
            length: {type: 'number', description: 'Length along the axis (+y).'},
            innerRadius: {type: 'number', description: 'Bore radius. Default radius - 2 x ribDepth - 1.'},
            ribs: {type: 'integer', description: 'Number of ribs round. Default 60.', minimum: 3},
            ribDepth: {type: 'number', description: 'Groove depth. Default 0.6.'},
            ribWidth: {type: 'number', description: 'Rib top as a fraction of the pitch. Default 0.45.', minimum: 0.1, maximum: 0.9},
            chamfer: {type: 'number', description: 'Chamfer on both outer rims, along the axis. Default ribDepth.'},
        },
        required: ['radius', 'length'],
        additionalProperties: false,
    },
    build(p) {
        const depth = p.ribDepth ?? 0.6, r = p.radius, L = p.length
        const ch = Math.min(p.chamfer ?? depth, L / 4)
        const ri = p.innerRadius ?? r - 2 * depth - 1
        if (!(ri > 0 && ri < r - depth)) throw new Error('knurled-ring: innerRadius must be between 0 and radius - ribDepth')
        const {angles, top} = ribAngles(p.ribs ?? 60, p.ribWidth ?? 0.45)
        // inner bottom, outer bottom (groove radius), rib band, outer top, inner top - closed by the bore
        const profile: [number, number][] = [[ri, 0], [r - depth, 0], [r, ch], [r, L - ch], [r - depth, L], [ri, L]]
        const ribbed = new Set([2, 3])
        const res = revolve({profile, angles, closed: true, modulate: (j, a) => ribbed.has(j) && !top[angles.indexOf(a)] ? -depth : 0})
        return result(res, {knurl: [...res.bandFaces[2]]}, L, r)
    },
}

export interface DialParams {
    radius: number
    height: number
    ribs?: number
    ribDepth?: number
    topChamfer?: number
    lockRadius?: number
    lockHeight?: number
    skirt?: number
}

export const dial: PartDefinition<DialParams> = {
    id: 'product/dial',
    title: 'Dial',
    tags: ['dial', 'knob', 'mode dial'],
    params: {
        type: 'object',
        properties: {
            radius: {type: 'number', description: 'Radius at the knurl tops.'},
            height: {type: 'number', description: 'Height of the knurled body above its base (+y).'},
            ribs: {type: 'integer', description: 'Knurl ribs round. Default 48.', minimum: 3},
            ribDepth: {type: 'number', description: 'Knurl groove depth. Default 0.35.'},
            topChamfer: {type: 'number', description: 'Chamfer from the knurl to the top face. Default 0.6.'},
            lockRadius: {type: 'number', description: 'Centre lock button radius; 0 for none. Default 0.'},
            lockHeight: {type: 'number', description: 'Lock button height above the top. Default 0.8.'},
            skirt: {type: 'number', description: 'Plain band below the knurl. Default 0.6.'},
        },
        required: ['radius', 'height'],
        additionalProperties: false,
    },
    build(p) {
        const r = p.radius, H = p.height, d = p.ribDepth ?? 0.35, ch = p.topChamfer ?? 0.6, sk = Math.min(p.skirt ?? 0.6, H / 3)
        const {angles, top} = ribAngles(p.ribs ?? 48, 0.5)
        const lr = p.lockRadius ?? 0, lh = p.lockHeight ?? 0.8
        const profile: [number, number][] = [[0, 0], [r - d, 0], [r - d, sk], [r, sk + d], [r, H - ch], [r - ch, H]]
        if (lr > 0) profile.push([lr + 0.3, H], [lr, H + 0.15], [lr, H + lh - 0.25], [lr - 0.25, H + lh], [0, H + lh])
        else profile.push([0, H])
        const ribbed = new Set([3, 4])
        const res = revolve({profile, angles, modulate: (j, a) => ribbed.has(j) && !top[angles.indexOf(a)] ? -d : 0})
        const topFaces = res.bandFaces.slice(5).flat()
        return result(res, {knurl: [...res.bandFaces[3]], top: topFaces}, lr > 0 ? H + lh : H, r)
    },
}

export interface ButtonParams {
    radius: number
    height: number
    chamfer?: number
    dome?: number
    collar?: number
    segments?: number
}

export const button: PartDefinition<ButtonParams> = {
    id: 'product/button',
    title: 'Round button',
    tags: ['button', 'control'],
    params: {
        type: 'object',
        properties: {
            radius: {type: 'number', description: 'Cap radius.'},
            height: {type: 'number', description: 'Height above the surface (+y), to the cap edge.'},
            chamfer: {type: 'number', description: 'Edge chamfer/round of the cap. Default radius x 0.15.'},
            dome: {type: 'number', description: 'Extra rise at the cap centre (convex). Default 0; negative is a dish.'},
            collar: {type: 'number', description: 'Width of a raised collar ring round the button; 0 for none. Default 0.'},
            segments: {type: 'integer', description: 'Segments round. Default 40.', minimum: 8},
        },
        required: ['radius', 'height'],
        additionalProperties: false,
    },
    build(p) {
        const r = p.radius, h = p.height, c = Math.min(p.chamfer ?? r * 0.15, h * 0.8, r * 0.5), dm = p.dome ?? 0
        const profile: [number, number][] = []
        // base sunk 0.3 below the surface so it seats on a slightly curved body
        if (p.collar) profile.push([0, -0.3], [r + p.collar + 0.4, -0.3], [r + p.collar, 0.35], [r + 0.15, 0.35], [r + 0.15, 0.1])
        else profile.push([0, -0.3], [r, -0.3])
        // rounded rim: a quarter circle of radius c in 3 steps
        for (let k = 0; k <= 3; k++) {
            const t = k / 3 * Math.PI / 2
            profile.push([r - c + c * Math.cos(t), h - c + c * Math.sin(t)])
        }
        const inner = r - c
        if (dm !== 0) profile.push([inner * 0.6, h + dm * 0.64], [inner * 0.3, h + dm * 0.91])
        profile.push([0, h + dm])
        const res = revolve({profile, segments: p.segments ?? 40})
        return result(res, {}, h + dm, r)
    },
}

export interface LensBarrelParams {
    stations: [number, number][]
    bore?: number
    segments?: number
}

export const lensBarrel: PartDefinition<LensBarrelParams> = {
    id: 'product/lens-barrel',
    title: 'Lens barrel section',
    tags: ['lens', 'barrel', 'tube'],
    params: {
        type: 'object',
        properties: {
            stations: {type: 'array', description: '[[radius, y], ...] along the axis, outer surface, in order.', items: {type: 'array'}},
            bore: {type: 'number', description: 'Inner radius; 0 closes the ends instead. Default 0.'},
            segments: {type: 'integer', description: 'Segments round. Default 96.', minimum: 8},
        },
        required: ['stations'],
        additionalProperties: false,
    },
    build(p) {
        const st = p.stations
        if (st.length < 2) throw new Error('lens-barrel: at least two stations')
        const b = p.bore ?? 0
        const profile: [number, number][] = [[b, st[0][1]], ...st, [b, st[st.length - 1][1]]]
        const res = revolve({profile, segments: p.segments ?? 96, closed: b > 0})
        return result(res, {}, st[st.length - 1][1], Math.max(...st.map(s => s[0])))
    },
}

function result(res: ReturnType<typeof revolve>, groups: Record<string, number[]>, height: number, radius: number): PartResult {
    return {
        mesh: res.mesh,
        groups: Object.fromEntries(Object.entries(groups).map(([k, faces]) => [k, {faces}])),
        anchors: {
            base: {position: [0, 0, 0], normal: [0, -1, 0]},
            top: {position: [0, height, 0], normal: [0, 1, 0]},
            side: {position: [0, height / 2, radius], normal: [0, 0, 1]},
        },
        smoothAngle: 35,
    }
}

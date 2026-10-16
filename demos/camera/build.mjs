/**
 * Canon EOS 5D Mark IV with an EF 24-105mm f/4L IS USM, to scale, built entirely through the
 * modelling command API.
 *
 *     npm run modelling:session -- demos/camera/build.mjs --out demos/camera/shots \
 *         --url http://127.0.0.1:9372/examples/modelling-api/index.html --no-serve \
 *         --width 1200 --height 800 --command-timeout 600000
 *
 * Every published number (body 150.7 x 116.4 x 75.9 mm, lens 83.5 x 107 mm, 77 mm filter thread,
 * EF mount 54 mm throat, 3.2-inch 3:2 monitor, ISO 518 shoe channel 18.6 x 2 mm) is in
 * `refs/SOURCES.md`, with the photographs the rest is read from and how.
 *
 * Units: millimetres. Axes: Y up, Z forward (the way the lens points), X to the camera's left as
 * the photographer holds it - so in a front view the grip is on the left of the frame (-X) and the
 * mode dial on the right (+X). The base of the body is y = 0 and its back (the monitor face) z = 0.
 *
 * How it is built:
 *
 * - **Lens.** Every ring is a `lathe` of a profile read off the side photograph and scaled to the
 *   published length: mount, barrel, focus ring, zoom ring, the red L ring, the front element. The
 *   rubber rings are knurled by `inset`ting every other face of their rib band inward. The distance
 *   window is an `inset` of the barrel faces facing up; the AF/IS switch panel an `inset` on a box.
 * - **Body.** A `primitive` box, `bevel`led twice: the silhouette corners with a 6-segment round,
 *   then every remaining product edge with a 3-segment round. The monitor recess is cut into the back
 *   with four `bisect`s restricted to the back face, then `inset` with a negative depth. The grip
 *   is a `sweep` of its measured top-view section up the side of the body. The prism housing is a
 *   box with its top vertices pulled in, bevelled. The hot shoe is an `inset` + recess to the ISO
 *   channel. Buttons and dials are lathes; repeated buttons are `array`s; the strap lugs are a
 *   `sweep` with a live `mirror` modifier.
 * - **Checks.** Measured from the finished model, not restated from the constants, against the
 *   published numbers; anything off by more than 2 % throws.
 *
 * The session object may carry a `beat(name)` hook: `record.mjs` uses it to move the camera and put
 * up titles at the start of each section. The session harness has none, so it is a no-op here.
 */

import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'

// --- published dimensions (mm) ---------------------------------------------------------------

const BODY = {W: 150.7, H: 116.4, D: 75.9}
const LENS = {diameter: 83.5, length: 107, filter: 77}
const MOUNT = {throat: 54, flangeFocal: 44}
/** 3.2 in diagonal, 3:2 aspect: the active area of the monitor. */
const MONITOR = {diagonal: 3.2 * 25.4, aspect: 3 / 2}
const SHOE = {channel: 18.6, channelLength: 16.0, channelDepth: 2.0}

// --- readings from the photographs (mm; see refs/SOURCES.md) ---------------------------------

/** Optical axis: 15.5 mm to the camera's left of the body centre (rear photo), 48 mm up (front). */
const AX = 15.5
const AY = 48
/** Depth stations, from the back of the body. */
const Z = {rear: 0, front: 58, flange: 73, grip: BODY.D}
/** Top plate of the main block (front photo: 88-90 mm either side of the prism). */
const TOP = 88.5
/** The grip side carries 0.75 mm of rubber proud of the magnesium. */
const SKIN = 0.75
const X0 = -BODY.W / 2
const X1 = BODY.W / 2
/** Monitor glass, rear photo: 72.5 x 49.8 mm, centre 20.2 mm left of the body centre, 41 mm up. */
const LCD = {cx: 20.2, cy: 40.95, w: 72.5, h: 49.8}
/** Lens station: the lens's z is measured from the mount flange. */
const L = z => Z.flange + z
/** The camera for the lens stages: one framing, so the lathe reads as one continuous shot. */
const LENS_VIEW = {position: [AX + 250, AY + 150, L(230)], target: [AX, AY, L(52)]}

// --- materials --------------------------------------------------------------------------------

const MAT = {
    magnesium: {color: '#141517', metalness: 0.1, roughness: 0.6},
    rubber: {color: '#161616', metalness: 0, roughness: 0.92},
    anodised: {color: '#191a1d', metalness: 0.45, roughness: 0.36},
    chrome: {color: '#d5d8dc', metalness: 1, roughness: 0.16},
    glass: {color: '#0d1a26', metalness: 0.2, roughness: 0.03, opacity: 0.9},
    screen: {color: '#060708', metalness: 0.1, roughness: 0.06},
    red: {color: '#c0101c', metalness: 0.1, roughness: 0.35},
    button: {color: '#202124', metalness: 0.2, roughness: 0.5},
    gold: {color: '#c9a548', metalness: 1, roughness: 0.3},
}

// --- geometry helpers (all on `inspect {detail}` output) ---------------------------------------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const len = a => Math.hypot(a[0], a[1], a[2])
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const range = (a, b) => Array.from({length: b - a}, (_, i) => a + i)

/** Face centroids and Newell normals. */
function faces(d) {
    return d.faceVerts.map((vs, i) => {
        const p = vs.map(v => d.vertices[v])
        const c = [0, 0, 0]
        const n = [0, 0, 0]
        p.forEach((a, k) => {
            const b = p[(k + 1) % p.length]
            c[0] += a[0] / p.length; c[1] += a[1] / p.length; c[2] += a[2] / p.length
            n[0] += (a[1] - b[1]) * (a[2] + b[2])
            n[1] += (a[2] - b[2]) * (a[0] + b[0])
            n[2] += (a[0] - b[0]) * (a[1] + b[1])
        })
        return {i, verts: vs, c, n: norm(n), area: len(n) / 2}
    })
}

/** Every edge with its two faces and the angle between their normals, in degrees. */
function edges(d) {
    const F = faces(d)
    const byKey = new Map()
    const key = (a, b) => a < b ? `${a}-${b}` : `${b}-${a}`
    for (const f of F) {
        f.verts.forEach((v, k) => {
            const kk = key(v, f.verts[(k + 1) % f.verts.length])
            if (!byKey.has(kk)) byKey.set(kk, [])
            byKey.get(kk).push(f.i)
        })
    }
    return d.edgeVerts.map(([a, b], i) => {
        const fs = byKey.get(key(a, b)) ?? []
        const angle = fs.length === 2
            ? Math.acos(Math.max(-1, Math.min(1, dot(F[fs[0]].n, F[fs[1]].n)))) * 180 / Math.PI : null
        return {i, a: d.vertices[a], b: d.vertices[b], faces: fs, angle}
    })
}

/** Topology numbers for the report: counts, polygon mix, and whether the mesh is closed. */
function topology(d) {
    const sizes = d.faceVerts.map(f => f.length)
    const E = edges(d)
    const boundary = E.filter(e => e.faces.length === 1).length
    const nonManifold = E.filter(e => e.faces.length > 2).length
    return {
        verts: d.vertices.length, edges: d.edgeVerts.length, faces: d.faceVerts.length,
        tris: sizes.filter(s => s === 3).length, quads: sizes.filter(s => s === 4).length,
        ngons: sizes.filter(s => s > 4).length, boundary, nonManifold,
        manifold: boundary === 0 && nonManifold === 0,
    }
}

/** Angle of a point around an axis through `c`, in degrees, 0 at +X (z axis) or +Z (y axis). */
const aroundZ = (p, c) => Math.atan2(p[1] - c[1], p[0] - c[0]) * 180 / Math.PI
const aroundY = (p, c) => Math.atan2(p[0] - c[0], p[2] - c[2]) * 180 / Math.PI

export default async (session) => {
    const {run, capture, log, outDir} = session
    const beat = session.beat ?? (async () => {})

    /** Run and insist: a build that silently skips a failed step is not a build. */
    const must = async command => {
        const r = await run(command)
        if (!r.ok) throw new Error(`${command.op} ${command.name ?? command.object ?? ''} failed: ${r.error}`)
        return r
    }
    const detail = async name => (await must({op: 'inspect', object: name, detail: true, limit: 1000000})).data
    const box = async name => (await must({op: 'measure', object: name, mode: 'bounds'})).data
    const unionBox = async names => {
        const bs = await box(names)
        const list = Array.isArray(bs) ? bs : [bs]
        return {
            min: [0, 1, 2].map(k => Math.min(...list.map(b => b.min[k]))),
            max: [0, 1, 2].map(k => Math.max(...list.map(b => b.max[k]))),
        }
    }

    const paint = (object, m) => must({op: 'material', object, ...m})
    /** A capture from an explicit camera, so each stage frames what it built. */
    const shot = async (label, position, target, fov = 30) => {
        await must({op: 'camera', projection: 'perspective', fov, position, target})
        return capture(label)
    }

    /** A box from its extents, with the transform baked so object space is world space. */
    const block = async (name, [x0, x1], [y0, y1], [z0, z1]) => {
        await must({op: 'primitive', type: 'cube', name, width: x1 - x0, height: y1 - y0, depth: z1 - z0,
            position: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]})
        await must({op: 'applyTransform', object: name})
    }

    /** Bevel the edges `pick` selects, if any. */
    const bevelWhere = async (name, pick, opts) => {
        const E = edges(await detail(name)).filter(pick).map(e => e.i)
        if (!E.length) throw new Error(`bevel on ${name}: the selection is empty`)
        return must({op: 'bevel', object: name, edges: E, profile: 0.5, ...opts})
    }
    const sharp = (min = 60) => e => e.angle !== null && e.angle >= min

    /**
     * Cut a rectangle into the planar faces of `name` lying on `plane` (a face filter), with one
     * `bisect` per side restricted to those faces, and return the face inside it.
     */
    const cutRect = async (name, onPlane, cuts, inside) => {
        for (const {co, no} of cuts) {
            const F = faces(await detail(name)).filter(onPlane)
            await must({op: 'bisect', object: name, planeCo: co, planeNo: no, faces: F.map(f => f.i)})
        }
        const F = faces(await detail(name)).filter(f => onPlane(f) && inside(f.c))
        if (F.length !== 1) throw new Error(`cutRect on ${name}: expected one face inside, found ${F.length}`)
        return F[0].i
    }

    /**
     * Knurl a lathed ring: of the faces facing away from the axis inside `band`, inset every other
     * one individually and push it in by `depth` - ribs and grooves, one quad each.
     */
    const knurl = async (name, {axis, center, band, depth, thickness = 0.12, outward = 0.6}) => {
        const d = await detail(name)
        const F = faces(d).filter(f => {
            const a = axis === 'z' ? 2 : axis === 'y' ? 1 : 0
            const radial = f.c.map((v, k) => k === a ? 0 : v - center[k])
            const t = f.c[a]
            return t > band[0] && t < band[1] && dot(f.n, norm(radial)) > outward
        })
        const ang = f => axis === 'z' ? aroundZ(f.c, center) : axis === 'y' ? aroundY(f.c, center)
            : Math.atan2(f.c[1] - center[1], f.c[2] - center[2]) * 180 / Math.PI
        // Group by angle (a band may be several faces tall) and take every other angular column.
        const cols = [...new Set(F.map(f => Math.round(ang(f) * 100) / 100))].sort((a, b) => a - b)
        const keep = new Set(cols.filter((_, k) => k % 2 === 0))
        const picked = F.filter(f => keep.has(Math.round(ang(f) * 100) / 100)).map(f => f.i)
        if (!picked.length) throw new Error(`knurl on ${name}: no faces in the band`)
        await must({op: 'inset', object: name, faces: picked, individual: true, thickness, depth: -depth})
        return picked.length
    }

    /** A round button standing `h` proud of a face, as a lathe: bevelled crown, sunk 0.3 mm. */
    const button = async (name, center, axis, r, h, dir = -1, crown = 0.45) => {
        const s = dir
        await must({op: 'lathe', name, axis, center, segments: 32, color: MAT.button.color,
            profile: [[0, -0.3 * s], [r, -0.3 * s], [r, (h - crown) * s], [r - crown * 0.4, (h - crown * 0.3) * s],
                [r - crown, h * s], [0, h * s]]})
    }

    const parts = []
    const note = (name, what) => parts.push({name, what})

    await must({op: 'delete', object: '*'})
    await must({op: 'lighting', environmentIntensity: 1.1, background: '#e8eaee'})
    await must({op: 'light', name: 'key', type: 'directional', position: [-260, 420, 520], intensity: 2.2})
    await must({op: 'light', name: 'rim', type: 'directional', position: [380, 260, -420], intensity: 1.4})

    // --- references ---------------------------------------------------------------------------
    //
    // Front: CEphoto's mount-open front, body silhouette 230-1599 px across, base at y = 1151 px.
    // Back: CEphoto's rear, 243-1746 px, base at 1375 px. Lens: Jinho Jung's elevation, rotated so
    // the front points along +Z as seen from +X: flange at 565 px, front at 137 px, axis at 232 px.
    await beat('references')
    const REF = {
        front: {img: '/demos/camera/refs/body-mount.jpg', px: [1920, 1298], x: [230, 1599], base: 1151},
        back: {img: '/demos/camera/refs/body-rear.jpg', px: [1920, 1484], x: [243, 1746], base: 1375},
        lens: {img: '/demos/camera/refs/lens-side-rotated.jpg', px: [700, 457], flange: 565, front: 137, axis: 232},
    }
    /**
     * Where each plane sits: `behind` the model (drawn under it, for calibrating) and `over` it -
     * the same plane slid along its normal to the camera's side of the model, drawn with the depth
     * test, so in an orthographic view the photograph lies on top of the model at the same scale.
     */
    const PLACE = {}
    for (const [name, plane, r, z] of [['front', 'front', REF.front, -60], ['back', 'back', REF.back, 260]]) {
        const yMid = r.base / r.px[1]
        const ref = await must({op: 'reference', name, plane, image: r.img, opacity: 0.55,
            calibrate: {from: [r.x[0] / r.px[0], yMid], to: [r.x[1] / r.px[0], yMid], distance: BODY.W}})
        const s = ref.data.width / r.px[0]
        // Seen from behind, image-right is world -X.
        const sign = plane === 'back' ? -1 : 1
        const x = sign * (r.px[0] / 2 - (r.x[0] + r.x[1]) / 2) * s, y = (r.base - r.px[1] / 2) * s
        PLACE[name] = {behind: [x, y, z], over: [x, y, plane === 'back' ? -60 : 240]}
        await must({op: 'reference', name, plane, origin: PLACE[name].behind})
        log(`${name} reference: ${(1 / s).toFixed(3)} px/mm`)
    }
    {
        const r = REF.lens
        const ref = await must({op: 'reference', name: 'lens', plane: 'right', image: r.img, opacity: 0.6,
            calibrate: {from: [r.flange / r.px[0], r.axis / r.px[1]], to: [r.front / r.px[0], r.axis / r.px[1]],
                distance: LENS.length}})
        const s = ref.data.width / r.px[0]
        // From +X, world +Z runs to the left of the image.
        const y = AY + (r.axis - r.px[1] / 2) * s, z = Z.flange + (r.flange - r.px[0] / 2) * s
        PLACE.lens = {behind: [-140, y, z], over: [140, y, z]}
        await must({op: 'reference', name: 'lens', plane: 'right', origin: PLACE.lens.behind})
        log(`lens reference: ${(1 / s).toFixed(3)} px/mm`)
    }
    // One plane at a time: each is drawn behind the model, so two would show through each other.
    for (const name of ['front', 'back', 'lens']) await must({op: 'reference', name, visible: false})
    for (const name of ['front', 'back', 'lens']) {
        await must({op: 'reference', name, visible: true})
        await must({op: 'camera', projection: 'orthographic', view: `ref:${name}`})
        await capture(`reference ${name}, calibrated`)
        await must({op: 'reference', name, visible: false})
    }
    await must({op: 'camera', projection: 'perspective', fov: 30})

    // --- the lens -------------------------------------------------------------------------------
    //
    // Profiles are [radius, z] with z from the flange, read off the side photograph: the barrel
    // spans 342 px for 83.5 mm across, and 428 px for the 107 mm from flange to front.
    await beat('lens')
    const lathe = (name, profile, extra = {}) => must({op: 'lathe', name, axis: 'z', center: [AX, AY, 0],
        segments: 96, closed: true, profile: profile.map(([r, z]) => [r, L(z)]), ...extra})

    // Chrome bayonet: the flange face sits on the body's flange; the tabs go into the throat.
    await lathe('lens-mount', [[22.5, -7.5], [26.6, -7.5], [26.6, -1.2], [29.3, -1.2], [29.3, 0.8], [22.5, 0.8]])
    // The barrel, from the mount to the filter thread, as one closed profile with its inner wall.
    await lathe('lens-barrel', [
        [22.5, 0.8], [31.0, 0.8], [33.4, 2.4], [34.2, 6.0], [35.9, 16.0], [36.6, 16.6], [36.6, 23.4],
        [37.0, 23.6], [37.0, 37.8], [39.2, 38.4], [39.7, 39.0], [39.7, 52.0], [39.7, 65.6], [41.0, 66.4],
        [41.0, 71.0], [40.5, 71.2], [40.5, 90.2], [41.5, 90.4], [41.5, 95.4], [41.75, 96.4], [41.75, 104.0],
        [41.6, 106.4], [41.2, 107.0], [LENS.filter / 2, 107.0], [LENS.filter / 2, 103.2], [36.0, 102.4],
        [33.6, 100.6], [33.6, 98.0], [22.5, 98.0],
    ])
    await paint(['lens-mount'], MAT.chrome)
    await paint(['lens-barrel'], MAT.anodised)
    await shot('lens barrel, lathed', LENS_VIEW.position, LENS_VIEW.target)

    // Focus ring (rubber, fine ribs) and zoom ring (rubber, the widest point of the lens).
    const ring = (name, r0, r1, z0, z1, edge) => lathe(name,
        [[r0, z0], [r1 - 0.4, z0], [r1, z0 + 0.4], [r1, z0 + edge], [r1, z1 - edge], [r1, z1 - 0.4],
            [r1 - 0.4, z1], [r0, z1]], {segments: 120})
    await ring('lens-focus-ring', 36.9, 38.7, 23.8, 37.6, 1.6)
    await ring('lens-zoom-ring', 40.4, LENS.diameter / 2, 71.2, 90.2, 1.8)
    const ribsF = await knurl('lens-focus-ring', {axis: 'z', center: [AX, AY, 0], band: [L(25.3), L(36.1)], depth: 0.55})
    const ribsZ = await knurl('lens-zoom-ring', {axis: 'z', center: [AX, AY, 0], band: [L(72.9), L(88.5)], depth: 0.6})
    log(`knurled: focus ring ${ribsF} grooves, zoom ring ${ribsZ}`)
    await paint(['lens-focus-ring', 'lens-zoom-ring'], MAT.rubber)
    await lathe('lens-red-ring', [[41.3, 95.5], [41.68, 95.5], [41.68, 96.3], [41.3, 96.3]], {segments: 96})
    await paint('lens-red-ring', MAT.red)

    // Front element: a spherical cap, rim at z 100.6, apex 4 mm proud of it (R = 143 mm).
    {
        const r = 33.5, sag = 4.0, R = (r * r + sag * sag) / (2 * sag), z0 = 100.6, n = 10
        const cap = range(0, n + 1).map(i => {
            const rr = r * (n - i) / n
            return [rr, z0 + sag - (R - Math.sqrt(R * R - rr * rr))]
        })
        await lathe('lens-front-element', [...cap.reverse(), [0, 97.6], [r, 97.6]].reverse()
            .filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]), {segments: 96})
        await paint('lens-front-element', MAT.glass)
    }

    // The distance-scale window: the barrel faces facing up in the window section, inset as one region.
    {
        const F = faces(await detail('lens-barrel')).filter(f => f.c[2] > L(39.5) && f.c[2] < L(65.2)
            && f.n[1] > 0.88 && Math.hypot(f.c[0] - AX, f.c[1] - AY) > 39)
        await must({op: 'inset', object: 'lens-barrel', faces: F.map(f => f.i), thickness: 1.2, depth: -0.7})
        log(`distance window: ${F.length} barrel faces inset`)
    }
    // AF/MF and stabiliser switches, on the left of the barrel as the photographer holds it (+X).
    await block('lens-switch-panel', [AX + 38.6, AX + 41.4], [AY - 8, AY + 8], [L(41), L(62)])
    await bevelWhere('lens-switch-panel', sharp(), {offset: 0.8, segments: 2})
    {
        const F = faces(await detail('lens-switch-panel')).filter(f => f.n[0] > 0.99)
        await must({op: 'inset', object: 'lens-switch-panel', faces: F.map(f => f.i), thickness: 1.1, depth: -0.6})
    }
    for (const [k, zc] of [[0, 46.0], [1, 56.0]]) {
        await block(`lens-switch-${k}`, [AX + 40.2, AX + 42.6], [AY - 2.2, AY + 2.2], [L(zc - 3.2), L(zc + 3.2)])
        await bevelWhere(`lens-switch-${k}`, sharp(), {offset: 0.5, segments: 2})
    }
    await paint('lens-switch-panel', MAT.anodised)
    await paint(['lens-switch-0', 'lens-switch-1'], MAT.button)
    await shot('lens, rings knurled', LENS_VIEW.position, LENS_VIEW.target)
    note('lens-*', 'lathe profiles, knurled with inset, window inset')

    // --- the body block ------------------------------------------------------------------------
    await beat('body')
    // The magnesium shell under the grip skin: 0.75 mm in from the published width on the grip side.
    await block('body', [X0 + SKIN, X1], [0, TOP], [Z.rear, Z.front])
    // Silhouette corners (edges running front to back): the base rounds tighter than the top.
    await bevelWhere('body', e => Math.abs(e.a[2] - e.b[2]) > 1 && e.a[1] > TOP / 2, {offset: 11, segments: 6})
    await bevelWhere('body', e => Math.abs(e.a[2] - e.b[2]) > 1 && e.a[1] < TOP / 2, {offset: 7, segments: 6})
    // Every other edge a real product has: the front and back perimeters, 3-segment round.
    await bevelWhere('body', sharp(60), {offset: 2.6, segments: 3})
    await paint('body', MAT.magnesium)
    await shot('body block, bevelled', [-250, 210, -330], [0, 45, 30])

    // The monitor recess: four bisects restricted to the back face, then inset and pushed in.
    {
        const back = f => f.n[2] < -0.999 && Math.abs(f.c[2]) < 1e-3
        const x0 = LCD.cx - LCD.w / 2, x1 = LCD.cx + LCD.w / 2, y0 = LCD.cy - LCD.h / 2, y1 = LCD.cy + LCD.h / 2
        const face = await cutRect('body', back, [
            {co: [x0, 0, 0], no: [1, 0, 0]}, {co: [x1, 0, 0], no: [1, 0, 0]},
            {co: [0, y0, 0], no: [0, 1, 0]}, {co: [0, y1, 0], no: [0, 1, 0]},
        ], c => c[0] > x0 && c[0] < x1 && c[1] > y0 && c[1] < y1)
        await must({op: 'inset', object: 'body', faces: [face], thickness: 0.9, depth: -1.4})
        // A crisp 0.5 mm round on the recess lip, the way the glass bezel is finished.
        await bevelWhere('body', e => e.angle >= 30 && Math.abs(e.a[2]) < 1e-3 && Math.abs(e.b[2]) < 1e-3
            && Math.min(e.a[0], e.b[0]) > x0 - 0.1 && Math.max(e.a[0], e.b[0]) < x1 + 0.1
            && Math.min(e.a[1], e.b[1]) > y0 - 0.1 && Math.max(e.a[1], e.b[1]) < y1 + 0.1,
        {offset: 0.5, segments: 2})
    }
    // The monitor itself: the 3.2-inch 3:2 active area, under the glass.
    {
        const w = MONITOR.diagonal * MONITOR.aspect / Math.hypot(MONITOR.aspect, 1)
        const h = w / MONITOR.aspect
        await block('lcd-screen', [LCD.cx - w / 2, LCD.cx + w / 2], [LCD.cy - h / 2, LCD.cy + h / 2], [0.7, 1.2])
        await paint('lcd-screen', MAT.screen)
    }
    await shot('monitor recess: bisect, inset', [-190, 150, -250], [10, 45, 0])
    note('body', 'cube, bevel x3 (6/6/3 segments), bisect x4 + inset recess, bevel lip')

    // --- the grip ---------------------------------------------------------------------------------
    //
    // Its top-view section, from the front photo (x -75.35 to -24.7, the rubber's inner edge) and the
    // published depth (front at z = 75.9), as a superellipse; swept up the body with a radius per
    // station that rounds it in at the base and under the shutter button.
    await beat('grip')
    {
        const gx0 = X0, gx1 = -24.7, gz0 = 10, gz1 = Z.grip
        const cx = (gx0 + gx1) / 2, cz = (gz0 + gz1) / 2, ax = (gx1 - gx0) / 2, az = (gz1 - gz0) / 2
        const n = 3.2, steps = 48
        const section = range(0, steps).map(i => {
            const t = 2 * Math.PI * i / steps
            const c = Math.cos(t), s = Math.sin(t)
            return [ax * Math.sign(c) * Math.abs(c) ** (2 / n), az * Math.sign(s) * Math.abs(s) ** (2 / n)]
        })
        // Stations up the grip, and the section scale at each (Blender's curve radius): full in the
        // middle, rounding in at the base and under the shutter button.
        const ys = [2.0, 5.0, 12, 30, 50, 66, 76, 83, 88.5]
        const radii = [0.9, 0.965, 0.995, 1, 1, 0.995, 0.975, 0.94, 0.87]
        await must({op: 'sweep', name: 'grip', path: ys.map(y => [cx, y, cz]), profile: section, radii,
            capEnds: true})
        await bevelWhere('grip', sharp(40), {offset: 3.2, segments: 4})
    }
    await paint('grip', MAT.rubber)
    await shot('grip, swept', [-330, 170, 330], [-30, 48, 40])
    note('grip', 'sweep of a superellipse section with per-station radii, cap rims bevelled')

    // --- prism housing, top LCD, hot shoe -------------------------------------------------------
    await beat('top')
    await block('body-prism', [AX - 33, AX + 33], [TOP - 6, 111.5], [Z.rear, 70])
    {
        // Pull the top in: 46 mm wide (rear photo), from z 5 to 48 - the front slope of the prism;
        // the back stays near vertical, where the eyepiece hangs on it.
        const d = await detail('body-prism')
        const moves = d.vertices.map(([x, y, z], i) => y > 110 ? [i, AX + Math.sign(x - AX) * 23, y, z > 30 ? 48 : 5] : null)
            .filter(Boolean)
        await must({op: 'vertices', object: 'body-prism', verts: moves})
        // The four rising edges, then the crown.
        await bevelWhere('body-prism', e => Math.abs(e.a[1] - e.b[1]) > 10, {offset: 9, segments: 6})
        await bevelWhere('body-prism', e => e.angle >= 25 && e.a[1] > 111 && e.b[1] > 111, {offset: 5, segments: 4})
    }
    {
        // The top LCD window, recessed into the top plate on the grip side.
        const topFace = f => f.n[1] > 0.999 && Math.abs(f.c[1] - TOP) < 1e-3
        const x0 = -61, x1 = -24, z0 = 14, z1 = 36
        const face = await cutRect('body', topFace, [
            {co: [x0, 0, 0], no: [1, 0, 0]}, {co: [x1, 0, 0], no: [1, 0, 0]},
            {co: [0, 0, z0], no: [0, 0, 1]}, {co: [0, 0, z1], no: [0, 0, 1]},
        ], c => c[0] > x0 && c[0] < x1 && c[2] > z0 && c[2] < z1)
        await must({op: 'inset', object: 'body', faces: [face], thickness: 1.0, depth: -0.8})
        await block('top-lcd-glass', [x0 + 1.2, x1 - 1.2], [TOP - 0.7, TOP - 0.4], [z0 + 1.2, z1 - 1.2])
        await paint('top-lcd-glass', MAT.screen)
    }
    // Hot shoe: a block on the prism, its top inset to the ISO channel and sunk 2 mm.
    {
        const w = SHOE.channel + 2 * 2.7
        await block('shoe', [AX - w / 2, AX + w / 2], [111.0, BODY.H], [24, 24 + SHOE.channelLength + 2 * 2.7])
        // Inset first, then round the outside: inset by more than a corner's radius would turn the
        // corner inside out (Blender does the same; the check below caught it).
        const top = faces(await detail('shoe')).filter(f => f.n[1] > 0.999 && Math.abs(f.c[1] - BODY.H) < 1e-3)
        await must({op: 'inset', object: 'shoe', faces: top.map(f => f.i), thickness: 2.7,
            depth: -SHOE.channelDepth})
        await bevelWhere('shoe', e => Math.abs(e.a[1] - e.b[1]) > 3 && Math.abs(e.a[0] - AX) > w / 2 - 1e-3,
            {offset: 1.2, segments: 2})
        await must({op: 'lathe', name: 'shoe-contact', axis: 'y', center: [AX, 0, 24 + 2.7 + SHOE.channelLength / 2],
            segments: 24, profile: [[0, BODY.H - 2.3], [2.2, BODY.H - 2.3], [2.2, BODY.H - 1.85], [0, BODY.H - 1.85]]})
    }
    await paint('body-prism', MAT.magnesium)
    await paint('shoe', MAT.chrome)
    await paint('shoe-contact', MAT.gold)
    await shot('prism, top LCD and hot shoe', [210, 330, 330], [10, 80, 40])
    note('body-prism', 'cube, top vertices pulled to the measured slope, bevel 6 + 4 segments')
    note('shoe', 'cube, inset + sunk to the ISO 518 channel')

    // --- dials and buttons -----------------------------------------------------------------------
    await beat('controls')
    // Mode dial (rear photo: Ø23 mm, 55.9 mm left of centre), knurled round its side.
    await must({op: 'lathe', name: 'dial-mode', axis: 'y', center: [57.5, 0, 30], segments: 72,
        profile: [[0, 88.0], [11.6, 88.0], [11.6, 88.8], [11.6, 95.0], [11.6, 95.6], [11.0, 96.2], [4.6, 96.2],
            [4.6, 97.4], [0, 97.4]]})
    await knurl('dial-mode', {axis: 'y', center: [57.5, 0, 30], band: [88.9, 94.9], depth: 0.45})
    await paint('dial-mode', MAT.anodised)
    // Main dial, in front of the shutter button, turning on X.
    await must({op: 'lathe', name: 'dial-main', axis: 'x', center: [0, 85.5, 57], segments: 60,
        profile: [[0, -47], [6.8, -47], [7.4, -46.4], [7.4, -40.6], [6.8, -40.0], [0, -40.0]]})
    await knurl('dial-main', {axis: 'x', center: [0, 85.5, 57], band: [-46.3, -40.7], depth: 0.4})
    await paint('dial-main', MAT.anodised)
    // Shutter button: a shallow dome on a collar, on the grip's top.
    await must({op: 'lathe', name: 'btn-shutter', axis: 'y', center: [-58, 0, 66], segments: 40,
        profile: [[0, 87.6], [6.4, 87.6], [6.4, 90.0], [5.6, 90.2], [5.6, 91.4], [4.6, 92.3], [2.4, 92.8],
            [0, 92.9]]})
    // Quick control dial, rear (Ø30 mm at 36.4 mm right of centre, 27.3 mm up), toothed rim.
    await must({op: 'lathe', name: 'dial-quick', axis: 'z', center: [-36.4, 27.3, 0], segments: 64, closed: true,
        profile: [[8.2, 0.3], [15.0, 0.3], [15.0, -0.4], [15.0, -2.0], [14.4, -2.6], [8.2, -2.6]]})
    await knurl('dial-quick', {axis: 'z', center: [-36.4, 27.3, 0], band: [-2.1, -0.3], depth: 0.5, outward: 0.5})
    await paint('dial-quick', MAT.anodised)
    await button('btn-set', [-36.4, 27.3, 0], 'z', 6.4, 2.2)
    // Rear buttons, read off the rear photograph: one made, the rest arrayed at the measured pitch.
    await button('btn-rear-column', [64.8, 64.9, 0], 'z', 3.5, 1.8)
    await must({op: 'array', object: 'btn-rear-column', count: 5, step: [0, -11.87, 0], merge: false})
    await button('btn-menu', [62.2, 79.5, 0], 'z', 3.3, 1.8)
    await must({op: 'array', object: 'btn-menu', count: 2, step: [-11.3, 0, 0], merge: false})
    await button('btn-af', [-44.2, 84.3, 0], 'z', 3.0, 1.8)
    await must({op: 'array', object: 'btn-af', count: 3, step: [-10.15, -3.2, 0], merge: false})
    await button('btn-q', [-24.8, 46.6, 0], 'z', 3.3, 1.6)
    await button('btn-start', [-21.3, 78.7, 0], 'z', 5.0, 1.6)
    await button('btn-joystick', [-28.6, 62.7, 0], 'z', 4.5, 3.2, -1, 1.6)
    // Front: lens release beside the mount, and the two buttons by the grip.
    await button('btn-release', [AX + 44, AY + 2, Z.front], 'z', 4.6, 3.4, 1, 0.9)
    await button('btn-front', [-19.5, 21.0, Z.front], 'z', 4.0, 2.2, 1)
    await must({op: 'array', object: 'btn-front', count: 2, step: [0, 13, 0], merge: false})
    // Thumb rest: rubber on the back of the grip.
    await block('rubber-thumb', [X0 + SKIN, -51], [8, 74], [-0.8, 4])
    await bevelWhere('rubber-thumb', sharp(), {offset: 1.6, segments: 3})
    await paint('btn-*', MAT.button)
    await paint('rubber-thumb', MAT.rubber)
    await shot('rear controls', [-120, 170, -360], [5, 55, 0])
    note('dial-*', 'lathe, rims knurled with inset')
    note('btn-*', 'lathe; repeated buttons arrayed at the measured pitch')

    // --- eyepiece ---------------------------------------------------------------------------------
    //
    // The rubber eyecup (rear photo: 54 x 35.6 mm outside, centred on the optical axis, 90 mm up):
    // a section swept round a rounded rectangle, closed.
    await beat('eyecup')
    {
        const cx = AX, cy = 90.0, hw = 24.0, hh = 14.8, rc = 8.5, z = -5.2
        const path = []
        const corner = (ox, oy, a0) => {
            for (let i = 0; i <= 6; i++) {
                const a = a0 + (Math.PI / 2) * i / 6
                path.push([ox + rc * Math.cos(a), oy + rc * Math.sin(a), z])
            }
        }
        corner(cx + hw - rc, cy + hh - rc, 0)
        corner(cx - hw + rc, cy + hh - rc, Math.PI / 2)
        corner(cx - hw + rc, cy - hh + rc, Math.PI)
        corner(cx + hw - rc, cy - hh + rc, 1.5 * Math.PI)
        await must({op: 'sweep', name: 'eyecup', path, closed: true,
            profile: [[-5.2, -3.0], [5.2, -3.0], [5.2, 3.0], [-5.2, 3.0]]})
        await bevelWhere('eyecup', sharp(60), {offset: 1.3, segments: 3})
        await block('eyepiece', [cx - hw + 2, cx + hw - 2], [cy - hh + 2, cy + hh - 2], [-3.4, 0.5])
        const backFace = faces(await detail('eyepiece')).filter(f => f.n[2] < -0.999)
        await must({op: 'inset', object: 'eyepiece', faces: backFace.map(f => f.i), thickness: 6, depth: -1.6})
        await block('eyepiece-glass', [cx - 10, cx + 10], [cy - 6, cy + 6], [-2.0, -1.85])
        await paint('eyecup', MAT.rubber)
        await paint('eyepiece', MAT.anodised)
        await paint('eyepiece-glass', MAT.glass)
    }
    await shot('eyecup, swept round a closed path', [90, 190, -210], [AX, 88, 0])
    note('eyecup', 'sweep of a section round a closed rounded-rectangle path, bevelled')

    // --- mount and lugs ---------------------------------------------------------------------------
    await beat('mount')
    const mountLathe = (name, profile) => must({op: 'lathe', name, axis: 'z', center: [AX, AY, 0], segments: 96,
        closed: true, profile})
    await mountLathe('mount-boss', [[27.4, Z.front - 1], [38.6, Z.front - 1], [38.6, 68.0], [37.2, 69.5],
        [32.6, 69.5], [32.6, 68.0], [27.4, 68.0]])
    await mountLathe('mount-flange', [[MOUNT.throat / 2, 68.0], [32.4, 68.0], [32.4, Z.flange - 0.5],
        [31.9, Z.flange], [MOUNT.throat / 2, Z.flange]])
    await must({op: 'primitive', type: 'icosphere', name: 'mount-index', radius: 1.3, subdivisions: 2,
        position: [AX, AY + 35.6, 69.5]})
    await must({op: 'applyTransform', object: 'mount-index'})
    // Strap lugs: a bar swept round a D through the side of the body, mirrored live to the other side.
    {
        const y = 79.0, x0 = X1 - 0.8, out = 4.4
        const path = range(0, 9).map(i => {
            const t = Math.PI * i / 8
            return [x0 + out * Math.sin(t), y, 30 - 5.5 * Math.cos(t)]
        })
        await must({op: 'sweep', name: 'lug', path, profile: [[-0.85, -1.4], [0.85, -1.4], [0.85, 1.4], [-0.85, 1.4]],
            capEnds: true})
        await must({op: 'modifier', object: 'lug', add: {type: 'mirror', axis: 'x'}})
    }
    await paint('mount-boss', MAT.anodised)
    await paint(['mount-flange', 'lug'], MAT.chrome)
    await paint('mount-index', MAT.red)
    await shot('mount and lugs', [150, 120, 420], [0, 58, 60])
    note('mount-*', 'lathe; bayonet flange at the published 54 mm throat')
    note('lug', 'sweep along a D path, live mirror modifier')

    // --- assembled --------------------------------------------------------------------------------
    await beat('assembled')
    await shot('assembled', [330, 210, 470], [8, 52, 80], 26)

    // --- checks: the model against the published numbers -----------------------------------------
    //
    // Measured from the finished model. Tolerance 2 %; any miss throws.
    const health = await must({op: 'selftest'})
    log(`selftest: ${health.data.objects} objects, ${health.data.failed} failed`)
    if (health.data.failed) throw new Error('selftest failed')

    const checks = []
    const expect = (what, got, want, source) => {
        const delta = got - want
        const pct = Math.abs(delta) / Math.abs(want) * 100
        const ok = pct <= 2
        checks.push({what, expected: want, measured: +got.toFixed(3), delta: +delta.toFixed(3), pct: +pct.toFixed(2), ok, source})
        log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}: ${got.toFixed(2)} mm (published ${want}, ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}, ${pct.toFixed(2)} %)`)
    }
    const shell = await unionBox(['body', 'grip', 'body-prism', 'shoe'])
    expect('body width (shell + grip, without lugs)', shell.max[0] - shell.min[0], BODY.W, 'Canon')
    expect('body height (base to hot-shoe top)', shell.max[1] - shell.min[1], BODY.H, 'Canon')
    expect('body depth (monitor face to grip front)', shell.max[2] - shell.min[2], BODY.D, 'Canon')
    const zoom = await unionBox(['lens-zoom-ring'])
    expect('lens maximum diameter (zoom ring)', zoom.max[0] - zoom.min[0], LENS.diameter, 'Canon')
    const lens = await unionBox(['lens-barrel', 'lens-zoom-ring', 'lens-focus-ring'])
    const lensFlange = (await unionBox(['lens-mount'])).max[2] - 0.8
    expect('lens length (mount flange to front)', lens.max[2] - lensFlange, LENS.length, 'Canon')
    {
        // The filter thread: the smallest radius on the barrel's front face.
        const d = await detail('lens-barrel')
        const front = d.vertices.filter(v => Math.abs(v[2] - L(107)) < 1e-3)
        const r = Math.min(...front.map(v => Math.hypot(v[0] - AX, v[1] - AY)))
        expect('filter thread diameter', 2 * r, LENS.filter, 'Canon')
    }
    {
        const d = await detail('mount-flange')
        const r = Math.min(...d.vertices.map(v => Math.hypot(v[0] - AX, v[1] - AY)))
        expect('EF mount throat diameter', 2 * r, MOUNT.throat, 'EF mount')
        const flange = Math.max(...d.vertices.map(v => v[2]))
        expect('lens flange seated on the body flange (z)', lensFlange, flange, 'EF mount')
    }
    {
        const b = await unionBox(['lcd-screen'])
        expect('monitor diagonal (3.2 in, active area)', Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1]),
            MONITOR.diagonal, 'Canon')
    }
    {
        // The shoe channel: the inset face's extent, and how far it sits below the shoe top.
        const d = await detail('shoe')
        const floor = d.vertices.filter(v => Math.abs(v[1] - (BODY.H - SHOE.channelDepth)) < 1e-3)
        const xs = floor.map(v => v[0])
        expect('hot-shoe channel width', Math.max(...xs) - Math.min(...xs), SHOE.channel, 'ISO 518')
        const top = Math.max(...d.vertices.map(v => v[1]))
        expect('hot-shoe channel depth', top - Math.min(...floor.map(v => v[1])), SHOE.channelDepth, 'ISO 518')
    }
    const failed = checks.filter(c => !c.ok)

    // --- topology, per object ------------------------------------------------------------------
    const doc = (await must({op: 'inspect'})).data
    const topo = []
    for (const name of doc.names) topo.push({name, ...topology(await detail(name))})
    const total = topo.reduce((a, t) => ({verts: a.verts + t.verts, edges: a.edges + t.edges, faces: a.faces + t.faces,
        tris: a.tris + t.tris, quads: a.quads + t.quads, ngons: a.ngons + t.ngons,
        manifold: a.manifold + (t.manifold ? 1 : 0)}), {verts: 0, edges: 0, faces: 0, tris: 0, quads: 0, ngons: 0, manifold: 0})
    log(`model: ${doc.objects} objects, ${total.verts} verts / ${total.edges} edges / ${total.faces} faces, `
        + `${(100 * total.quads / total.faces).toFixed(1)} % quads, ${total.manifold}/${topo.length} closed manifolds`)
    for (const t of topo.filter(t => !t.manifold)) log(`  open/non-manifold: ${t.name} (${t.boundary} boundary, ${t.nonManifold} non-manifold edges)`)
    await writeFile(join(outDir, '..', 'checks.json'), JSON.stringify({checks, topology: topo, total, parts}, null, 2))
    if (failed.length) throw new Error(`${failed.length} dimension checks failed: ${failed.map(c => c.what).join('; ')}`)

    // --- against the photographs, orthographic --------------------------------------------------
    await beat('compare')
    for (const [name, over, only] of [['front', 'front over the photograph', 'front, model only'],
        ['back', 'back over the photograph', 'back, model only'], ['lens', 'side over the lens elevation', 'side, model only']]) {
        await must({op: 'reference', name, origin: PLACE[name].over, behind: false, opacity: 0.5, visible: true})
        await must({op: 'camera', projection: 'orthographic', view: `ref:${name}`})
        await capture(over)
        await must({op: 'reference', name, visible: false})
        await capture(only)
        await must({op: 'reference', name, origin: PLACE[name].behind, behind: true, opacity: 0.55})
    }
    await must({op: 'camera', view: 'top', fit: '*', padding: 1.05})
    await capture('top, model only')

    // --- close-ups ---------------------------------------------------------------------------------
    await beat('closeups')
    await must({op: 'camera', projection: 'perspective', fov: 26,
        position: [-150, 190, -190], target: [-40, 70, 10]})
    await capture('bevelled corners and grip, from behind')
    // The viewport's wireframe mode draws the render triangulation, not the mesh's edges
    // (issues/open/modelling-tools/command-display-wireframe-triangles.md). To show the real edge
    // flow, copy the parts and turn every *mesh* edge into a thin strut with `wireframe`.
    const edgesOf = async (names, thickness) => {
        for (const name of names) {
            await must({op: 'duplicate', object: name, name: `edges-${name}`})
            await must({op: 'wireframe', object: `edges-${name}`, thickness, offset: 0, replace: true})
        }
        await paint('edges-*', {color: '#e0202c', metalness: 0, roughness: 0.6})
    }
    await edgesOf(['body', 'grip', 'rubber-thumb', 'body-prism'], 0.32)
    await capture('bevelled corners, mesh edges')
    await must({op: 'delete', object: 'edges-*'})
    await must({op: 'camera', position: [AX + 70, AY + 95, L(125)], target: [AX, AY + 25, L(62)]})
    await edgesOf(['lens-focus-ring', 'lens-zoom-ring', 'lens-barrel'], 0.14)
    await capture('lens knurling, mesh edges')
    await must({op: 'delete', object: 'edges-*'})
    await must({op: 'camera', position: [105, 150, -30], target: [55, 91, 28]})
    await capture('mode dial knurling')
    await edgesOf(['dial-mode', 'body'], 0.1)
    await capture('mode dial knurling, mesh edges')
    await must({op: 'delete', object: 'edges-*'})
    await must({op: 'material', object: ['body', 'body-prism', 'grip'], opacity: 0.28})
    await must({op: 'camera', position: [260, 120, 160], target: [0, 55, 60]})
    await capture('x-ray: mount and bayonet inside the shell')
    await must({op: 'material', object: ['body', 'body-prism', 'grip'], opacity: 1})

    // --- hero and turntable -------------------------------------------------------------------------
    await beat('hero')
    // The hero photograph looks at the camera from its front right, a little above, on a long lens.
    await must({op: 'camera', fov: 22, position: [330, 210, 470], target: [8, 52, 80]})
    await capture('hero, three-quarter front')
    for (const [k, a] of [[0, 30], [1, 120], [2, 210], [3, 300]]) {
        const t = a * Math.PI / 180
        await must({op: 'camera', fov: 24, position: [AX + 520 * Math.sin(t), 190, 70 + 520 * Math.cos(t)],
            target: [AX, 58, 70]})
        await capture(`turntable ${k + 1}`)
    }

    await must({op: 'export', format: 'glb', path: 'demos/camera/camera.glb'})
}

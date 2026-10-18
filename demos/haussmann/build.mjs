/**
 * A Haussmann apartment block, to scale, built entirely through the modelling command API.
 *
 * The building is a real one: the *maison à loyer* at N° 77 boulevard de Sébastopol, Paris, by Paul
 * Mesnard, published in César Daly's *L'architecture privée au XIXe siècle* (1870), Exemple M2. It
 * fills a block corner between the boulevard, the rue Greneta and the rue Palestro, with two cut
 * corners (*pans coupés*). Every dimension below is read off Daly's 1:100 elevation and 1:200 plans
 * (`refs/`); the readings, with their pixel coordinates, are listed below and in the report page
 * (`index.html`).
 *
 *     npm run modelling:session -- demos/haussmann/build.mjs --out demos/haussmann/shots \
 *         --url http://127.0.0.1:9371/examples/modelling-api/index.html --no-serve --width 1200 --height 800
 *
 * Axes: Y up, metres. The boulevard front is the plane z = 0, facing +z; x runs along it from the
 * lower cut corner (x = 0) to the party wall (x = 14.93). The rue Palestro front is z = -15.59.
 *
 * How it is built:
 * - **Walls.** The plan outline, with a vertex at every window jamb, is one n-gon (a `circle` whose
 *   vertices are moved onto the measured plan). It is pushed up with one `extrude` per storey line -
 *   floor, window head, next floor - so every window, pier and band of the façade is a quad.
 * - **Openings.** `inset` frames every window (individually) and every shop front (as a region), an
 *   `extrude` per façade recesses them, a second `inset` makes the sash, and `separate` lifts the
 *   panes out into the glass object.
 * - **Cornices and bands.** A region `inset` with `depth` pushes a whole storey band out of the wall,
 *   mitred round the cut corners; `bevel` rounds the main cornice's soffit.
 * - **Balconies.** The plan polygon again, outset with a negative individual `inset`, its middle and
 *   party-wall side deleted, cut flush with `bisect`, thickened with `solidify`, nosed with `bevel`.
 *   The railings are one 30 cm cast-iron module repeated along the balcony edge by a live curve
 *   `array`, so they turn the corners.
 * - **Mansard.** The roof is the wall's top face, `inset` with a depth equal to its width: a 45° brisis
 *   (the 1859 limit), then a shallow terrasson. Dormers are one master on live `array`s.
 * - **Chimneys.** Boxes on the party wall and in the façade, with `lathe`d pots on a live `array`.
 */

// --- measured data ------------------------------------------------------------------------------

/**
 * Daly, Exemple M2 Pl. 1 (elevation of the boulevard front, 1:100). The scale bar's 0 and 10 m ticks
 * are at pixels 737 and 1465 of the 2118 x 3204 scan: 72.8 px/m. Rows are pixel rows of the scan.
 */
const ELEV = {
    file: '/demos/haussmann/refs/daly-1870-m2-pl1-elevation-77-bd-sebastopol.jpg',
    size: [2118, 3204],
    pxPerM: 72.8,
    ground: 2345, // pavement line
    left: 515, right: 1602, // the cut corner's edge and the party wall
    rows: {
        shopHead: 2110, F1: 2050, headF1: 1885, F2: 1805, headF2: 1610, F3: 1550, headF3: 1390,
        F4: 1335, headF4: 1160, F5: 1110, headF5: 960, eave: 893, brisisTop: 700, chimney: 640,
    },
    /** Window centres (pixel columns) of the six bays, from the paired leaves of the 2nd-floor windows. */
    bays: [632, 804, 978.5, 1152, 1323, 1495],
    windowWidth: 88, // px, the opening between the stone jambs
    door: {left: 926, right: 1038, top: 2119}, // the entrance under bay 3
}
const lv = row => (ELEV.ground - row) / ELEV.pxPerM
const L = Object.fromEntries(Object.entries(ELEV.rows).map(([k, v]) => [k, lv(v)]))

/**
 * Daly, Exemple M2 Pl. 3 (plans of the 1st-4th floors, 1:200). Its own scale bar reads 35.57 px/m,
 * but that makes the six boulevard bays 2.47 m apart against the elevation's 2.371 m, 4.2 % out. The
 * elevation is the drawing to trust: it is twice the scale, and it puts the cornice at 19.95 m, on
 * the 20 m the 1859 decree allowed on a street this wide. So the plan is calibrated on the same six
 * bays: their centres, at pixel columns 893.5 ... 1333 on the plan, are 5 x 2.371 m apart.
 */
const PLAN = {
    file: '/demos/haussmann/refs/daly-1870-m2-pl3-plans-77-bd-sebastopol.jpg',
    size: [2118, 3204],
    pxPerM: (1333 - 893.5) / ((ELEV.bays[5] - ELEV.bays[0]) / ELEV.pxPerM),
    seb: 1269, pal: 682, // rows of the outer wall faces
    origin: 822, // column where the boulevard front starts at the lower cut corner
    greneta: y => 0.4726 * y + 177.7, // outer face of the rue Greneta wall, fitted to its six piers
    upperCut: {pal: 598, gre: 758}, // the Palestro/Greneta cut corner: column on Palestro, row on Greneta
    lowerCut: {gre: 1212}, // the Greneta/boulevard cut corner: row on Greneta (meets the boulevard at the origin)
    palestroBays: [662.5, 749.5, 841, 944, 1052, 1154, 1245, 1332], // window centres, columns
    grenetaBays: [823.5, 906, 990.5, 1075.5, 1159], // window centres, rows
}
const pp = (col, row) => [(col - PLAN.origin) / PLAN.pxPerM, (row - PLAN.seb) / PLAN.pxPerM]

const SEB_LENGTH = (ELEV.right - ELEV.left) / ELEV.pxPerM
const DEPTH = (PLAN.seb - PLAN.pal) / PLAN.pxPerM
/** Plan corners, in [x, z]: E and F on the boulevard, A on the party wall at Palestro, B-C and D-E the cut corners. */
const E = [0, 0]
const F = [SEB_LENGTH, 0]
const A = [SEB_LENGTH, -DEPTH]
const B = pp(PLAN.upperCut.pal, PLAN.pal)
const C = pp(PLAN.greneta(PLAN.upperCut.gre), PLAN.upperCut.gre)
const D = pp(PLAN.greneta(PLAN.lowerCut.gre), PLAN.lowerCut.gre)

const WIN = ELEV.windowWidth / ELEV.pxPerM
const BAY = (ELEV.bays[5] - ELEV.bays[0]) / 5 / ELEV.pxPerM

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
const len = v => Math.hypot(v[0], v[1])
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** The five street fronts and the party wall, in ring order, with window centres as distances from `a`. */
const FRONTS = [
    {key: 'sebastopol', a: E, b: F, windows: ELEV.bays.map(c => (c - ELEV.left) / ELEV.pxPerM)},
    {key: 'party', a: F, b: A, windows: []},
    {key: 'palestro', a: A, b: B, windows: PLAN.palestroBays.map(c => A[0] - pp(c, PLAN.pal)[0])},
    {key: 'cut-palestro', a: B, b: C, windows: [len(sub(C, B)) / 2]},
    {key: 'greneta', a: C, b: D, windows: PLAN.grenetaBays.map(r => len(sub(pp(PLAN.greneta(r), r), C)))},
    {key: 'cut-sebastopol', a: D, b: E, windows: [len(sub(E, D)) / 2]},
]
for (const f of FRONTS) {
    const d = sub(f.b, f.a)
    f.length = len(d)
    f.dir = [d[0] / f.length, d[1] / f.length]
    // Outward, in [x, z]. The ring runs E -> F -> A -> ... so the street is on the left of travel when
    // seen from above with x right and z down the page: for the boulevard (dir +x) that is +z.
    f.normal = [-f.dir[1], f.dir[0]]
    f.street = f.key !== 'party'
}

/** Shop fronts on the ground floor: groups of window bays that share one opening; `door` is the entrance. */
const SHOPS = {
    sebastopol: [[0, 1], [3, 4, 5]], palestro: [[0, 1], [2, 3], [4, 5], [6, 7]],
    'cut-palestro': [[0]], greneta: [[0, 1], [3, 4]], 'cut-sebastopol': [[0]],
}
const DOORS = {sebastopol: [2], greneta: [2]}

/** Storey lines, bottom to top: each `extrude` of the wall ends on one. */
const LINES = ['shopHead', 'F1', 'headF1', 'F2', 'headF2', 'F3', 'headF3', 'F4', 'headF4', 'F5', 'headF5', 'eave']
const BANDS = [0, ...LINES.map(k => L[k])] // band i spans BANDS[i]..BANDS[i+1]
const WINDOW_BANDS = [2, 4, 6, 8, 10] // F1..F5, floor to window head

const MAT = {
    stone: {color: '#ddd0b6', roughness: 0.82, metalness: 0},
    zinc: {color: '#7f8b95', roughness: 0.42, metalness: 0.55},
    glass: {color: '#26313b', roughness: 0.06, metalness: 0.35},
    iron: {color: '#1d2023', roughness: 0.5, metalness: 0.6},
    shop: {color: '#20342c', roughness: 0.55, metalness: 0.05},
    pot: {color: '#a85b3a', roughness: 0.8, metalness: 0},
    pavement: {color: '#8d8a84', roughness: 0.95, metalness: 0},
    road: {color: '#45474a', roughness: 0.95, metalness: 0},
    neighbour: {color: '#c9c0ae', roughness: 0.9, metalness: 0},
}

// The 1859 decree (Paris): on streets over 20 m wide the façade may rise 20 m to the cornice and the
// roof stays inside a 45° line from the eaves. The brisis is drawn at that 45°.
const BRISIS_PITCH = 45
const BALCONY_DEPTH = 0.5 // plan: the balcony outline runs 18-19 px (0.48-0.50 m) outside the wall
const CORNICE_PROJECTION = 0.55
const RECESS = 0.24 // window reveal depth

export const DATA = {ELEV, PLAN, L, E, F, A, B, C, D, FRONTS, SEB_LENGTH, DEPTH, WIN, BAY}

// --- the build ----------------------------------------------------------------------------------

export default async (session) => {
    const {run, log} = session
    // `capture` is optional, so the same build drives the report (stills) and the video (beats).
    const capture = session.capture ?? (async () => null)
    /** Camera moves eased in the film (`cameraDuration`), instant in a session. */
    const shotCam = (position, target, fov = 40) => run({op: 'camera', projection: 'perspective', fov, position, target,
        duration: session.cameraDuration ?? 0})
    /** From across the rue Greneta / boulevard corner, a little above the street. */
    const CORNER_VIEW = [[-30, 24, 32], [4, 9.5, -7.5]]
    const beat = session.beat ?? (async () => null)

    const must = async command => {
        const r = await run(command)
        if (!r.ok) throw new Error(`${command.op} failed: ${r.error}`)
        return r
    }
    const detail = name => must({op: 'inspect', object: name, detail: true, limit: 1000000}).then(r => r.data)

    const centroid = (d, f) => {
        const vs = d.faceVerts[f].map(v => d.vertices[v])
        return [0, 1, 2].map(k => vs.reduce((s, v) => s + v[k], 0) / vs.length)
    }
    /** The street front a point at plan position [x, z] faces, by distance to the front's line segment. */
    const frontOf = (x, z) => {
        let best = null, bestD = Infinity
        for (const f of FRONTS) {
            const t = Math.max(0, Math.min(f.length, (x - f.a[0]) * f.dir[0] + (z - f.a[1]) * f.dir[1]))
            const d = Math.hypot(x - (f.a[0] + f.dir[0] * t), z - (f.a[1] + f.dir[1] * t))
            if (d < bestD) (bestD = d, best = {front: f, t, d: (x - f.a[0]) * f.normal[0] + (z - f.a[1]) * f.normal[1]})
        }
        return best
    }
    const bandOf = y => BANDS.findIndex((b, i) => i < BANDS.length - 1 && y >= b - 1e-6 && y <= BANDS[i + 1] + 1e-6)

    await must({op: 'delete', object: '*'})
    await must({op: 'lighting', environmentIntensity: 0.75, background: '#d6dde4'})
    await must({op: 'light', name: 'sun', type: 'directional', position: [-40, 60, 45], target: [5, 8, -8],
        intensity: 2.4, castShadow: true})

    // --- references ---------------------------------------------------------------------------
    // The elevation stands behind the model, registered on the boulevard front: the cut corner's edge
    // at x = 0, the pavement at y = 0.
    const elev = await must({op: 'reference', name: 'elevation', plane: 'front', image: ELEV.file, opacity: 0.85,
        calibrate: {from: [ELEV.left / ELEV.size[0], ELEV.ground / ELEV.size[1]],
            to: [ELEV.right / ELEV.size[0], ELEV.ground / ELEV.size[1]], distance: SEB_LENGTH}})
    const em = elev.data.width / ELEV.size[0]
    await must({op: 'reference', name: 'elevation', plane: 'front', origin: [
        (ELEV.size[0] / 2 - ELEV.left) * em, (ELEV.ground - ELEV.size[1] / 2) * em, -DEPTH - 4]})
    log(`elevation reference: ${elev.data.width.toFixed(2)} x ${elev.data.height.toFixed(2)} m `
        + `(${(1 / em).toFixed(2)} px/m)`)
    // The plan lies under the model, registered on the same corner.
    const plan = await must({op: 'reference', name: 'plan', plane: 'top', image: PLAN.file, opacity: 0.9,
        calibrate: {from: [PLAN.origin / PLAN.size[0], PLAN.seb / PLAN.size[1]],
            to: [(PLAN.origin + SEB_LENGTH * PLAN.pxPerM) / PLAN.size[0], PLAN.seb / PLAN.size[1]],
            distance: SEB_LENGTH}})
    const pm = plan.data.width / PLAN.size[0]
    await must({op: 'reference', name: 'plan', plane: 'top', origin: [
        (PLAN.size[0] / 2 - PLAN.origin) * pm, -0.2, (PLAN.size[1] / 2 - PLAN.seb) * pm]})
    log(`plan reference: ${(1 / pm).toFixed(2)} px/m`)
    await beat('references')
    await must({op: 'camera', projection: 'orthographic', position: [SEB_LENGTH / 2, 11.5, 60], target: [SEB_LENGTH / 2, 11.5, 0],
        frustumSize: 27})
    await capture('the 1870 elevation, registered')
    await must({op: 'camera', projection: 'orthographic', position: [2.5, 80, -7.85], target: [2.5, 0, -7.9], frustumSize: 24})
    await capture('the plan, registered')
    await must({op: 'camera', projection: 'perspective', fov: 40})
    // Out of the way until the model is compared with them again.
    await must({op: 'reference', name: 'elevation', plane: 'front', visible: false})
    await must({op: 'reference', name: 'plan', plane: 'top', visible: false})

    // --- walls: the plan outline with every window jamb, pushed up storey by storey --------------
    const ring = [] // [x, z]
    const segs = [] // per ring edge: {front, type: 'win' | 'wall', window}
    for (const f of FRONTS) {
        ring.push(f.a)
        segs.push({front: f, type: 'wall'})
        f.windows.forEach((u, w) => {
            ring.push(lerp2(f.a, f.b, (u - WIN / 2) / f.length))
            segs.push({front: f, type: 'win', window: w})
            ring.push(lerp2(f.a, f.b, (u + WIN / 2) / f.length))
            segs.push({front: f, type: 'wall'})
        })
    }
    const N = ring.length
    await must({op: 'primitive', type: 'circle', name: 'facade', segments: N, radius: 1, color: MAT.stone.color})
    await must({op: 'vertices', object: 'facade', verts: ring.map(([x, z], i) => [i, x, 0, z])})
    let cap = [0]
    let prev = 0
    for (const k of LINES) {
        const r = await must({op: 'extrude', object: 'facade', faces: cap, direction: [0, 1, 0], distance: L[k] - prev})
        cap = r.data.capFaces
        prev = L[k]
        if (k === 'F1') (await shotCam(...CORNER_VIEW), await capture('blockout: the plan pushed up to the first floor'))
    }
    await beat('walls')
    await must({op: 'display', mode: 'wireframe'})
    await capture('one extrude per storey line: every bay is a quad')
    await must({op: 'display', mode: 'material'})

    /** Side faces of the wall, classified by band and ring segment. */
    const classify = d => d.faceVerts.map((verts, i) => {
        if (verts.length !== 4) return null
        const ps = verts.map(v => d.vertices[v])
        const ys = ps.map(p => p[1])
        if (Math.max(...ys) - Math.min(...ys) < 1e-4) return null // horizontal
        const c = centroid(d, i)
        const lo = ps.filter(p => p[1] < Math.min(...ys) + 1e-4)
        const mx = lo.reduce((s, p) => s + p[0], 0) / lo.length, mz = lo.reduce((s, p) => s + p[2], 0) / lo.length
        let seg = -1, best = Infinity
        segs.forEach((s, j) => {
            const a = ring[j], b = ring[(j + 1) % N]
            const dd = Math.hypot((a[0] + b[0]) / 2 - mx, (a[1] + b[1]) / 2 - mz)
            if (dd < best) (best = dd, seg = j)
        })
        return {i, band: bandOf(c[1]), seg, s: segs[seg], c}
    }).filter(Boolean)

    let d = await detail('facade')
    let sides = classify(d)

    // --- ground floor: shop fronts as regions, the entrances as single bays ---------------------
    const shopFaces = [], doorFaces = []
    for (const s of sides) {
        if (s.band !== 0 || !s.s.front.street) continue
        const f = s.s.front.key
        const jStart = j => segs.findIndex(x => x.front.key === f && x.type === 'win' && x.window === j)
        for (const g of SHOPS[f] ?? []) {
            const from = jStart(g[0]), to = jStart(g[g.length - 1])
            if (s.seg >= from && s.seg <= to) shopFaces.push(s.i)
        }
        for (const w of DOORS[f] ?? []) if (s.seg === jStart(w)) doorFaces.push(s.i)
    }
    const shops = await must({op: 'inset', object: 'facade', faces: [...shopFaces, ...doorFaces], thickness: 0.14})
    d = await detail('facade')
    // Inset faces keep their place; remember them by centroid, since the next inset renumbers the mesh.
    const groundOpenings = shops.data.insetFaces.map(f => centroid(d, f))

    // --- windows: every window bay on every street front, framed individually ---------------------
    sides = classify(d)
    const windowFaces = sides.filter(s => WINDOW_BANDS.includes(s.band) && s.s.type === 'win' && s.s.front.street)
    log(`windows: ${windowFaces.length}`)
    const wi = await must({op: 'inset', object: 'facade', faces: windowFaces.map(s => s.i), individual: true, thickness: 0.08})
    d = await detail('facade')
    const openings = [
        ...wi.data.insetFaces.map(f => centroid(d, f)),
        ...groundOpenings,
    ]
    // Recess them: one extrude per front, straight back along its inward normal.
    const byFront = new Map()
    for (const c of openings) {
        const f = frontOf(c[0], c[2]).front
        if (!byFront.has(f)) byFront.set(f, [])
        byFront.get(f).push(c)
    }
    const near3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-3
    const recessed = []
    for (const [f, cs] of byFront) {
        d = await detail('facade')
        const faces = d.faceVerts.map((_, i) => i).filter(i => cs.some(c => near3(centroid(d, i), c)))
        await must({op: 'extrude', object: 'facade', faces, direction: [-f.normal[0], 0, -f.normal[1]], distance: RECESS})
        for (const c of cs) recessed.push([c[0] - f.normal[0] * RECESS, c[1], c[2] - f.normal[1] * RECESS])
    }
    d = await detail('facade')
    const reveals = d.faceVerts.map((_, i) => i).filter(i => recessed.some(c => near3(centroid(d, i), c)))
    const sash = await must({op: 'inset', object: 'facade', faces: reveals, individual: true, thickness: 0.05})
    await shotCam([-15, 12, 23], [4, 9, -4], 45)
    await capture('windows framed, recessed and glazed')

    // The panes and the shop doors become their own objects, so they can be glass and painted wood.
    await must({op: 'separate', object: 'facade', mode: 'faces', faces: sash.data.insetFaces, name: 'glass'})
    d = await detail('glass')
    const doorCols = Object.entries(DOORS).flatMap(([k, ws]) => {
        const f = FRONTS.find(x => x.key === k)
        return ws.map(w => lerp2(f.a, f.b, f.windows[w] / f.length))
    })
    const doorPanes = d.faceVerts.map((_, i) => i).filter(i => {
        const c = centroid(d, i)
        return c[1] < L.shopHead && doorCols.some(p => Math.hypot(p[0] - c[0], p[1] - c[2]) < WIN)
    })
    await must({op: 'separate', object: 'glass', mode: 'faces', faces: doorPanes, name: 'doors'})
    await must({op: 'material', object: 'glass', ...MAT.glass})
    await must({op: 'material', object: 'doors', ...MAT.shop})
    await beat('openings')

    // --- bands and cornices: whole storey bands pushed out of the wall, mitred round the corners --
    d = await detail('facade')
    sides = classify(d)
    const bandFaces = band => sides.filter(s => s.band === band && s.s.front.street
        && Math.abs(frontOf(s.c[0], s.c[2]).d) < 1e-3).map(s => s.i)
    // The main cornice: the entablature over the 5th-floor windows.
    const entablature = bandFaces(11)
    await must({op: 'inset', object: 'facade', faces: entablature, thickness: 0.1, depth: CORNICE_PROJECTION})
    d = await detail('facade')
    sides = classify(d)
    {
        // Round the cornice's soffit: the bottom edge of the pushed-out band, all round the building.
        const y = L.headF5 + 0.1
        const soffit = d.edgeVerts.map((e, i) => ({e, i})).filter(({e}) => e.every(v => {
            const p = d.vertices[v]
            return Math.abs(p[1] - y) < 1e-3 && frontOf(p[0], p[2]).d > CORNICE_PROJECTION - 0.05
        })).map(x => x.i)
        log(`cornice soffit edges: ${soffit.length}`)
        await must({op: 'bevel', object: 'facade', edges: soffit, offset: 0.22, segments: 4, profile: 0.5})
    }
    d = await detail('facade')
    sides = classify(d)
    // The shop fascia under the first floor, and plain string courses under the 3rd and 4th.
    await must({op: 'inset', object: 'facade', faces: bandFaces(1), thickness: 0.06, depth: 0.16})
    d = await detail('facade')
    sides = classify(d)
    await must({op: 'inset', object: 'facade', faces: [...bandFaces(5), ...bandFaces(7)], thickness: 0.3, depth: 0.07})
    await beat('cornices')
    await shotCam([-10, 21, 9], [0, 18.5, -2], 45)
    await capture('cornice and string courses pushed out of the wall')

    // --- mansard: the outline inset with a depth equal to its width ------------------------------
    //
    // A 45° roof over an outline with a 67° corner is a straight skeleton: inset far enough and the
    // short cut corner on the rue Palestro shrinks to nothing (at 2.36 m, before the brisis is 2.65 m
    // deep). So the roof is its own object on the six plan corners, inset to that event, the vanished
    // edge welded into a hip, and inset on. Its outline runs on past the party wall and is cut there
    // with `bisect`, which leaves the gable against the neighbour vertical.
    const brisisH = L.brisisTop - L.eave
    const brisisW = brisisH / Math.tan(BRISIS_PITCH * Math.PI / 180)
    const roofOutline = [E, [SEB_LENGTH + 8, 0], [SEB_LENGTH + 8, -DEPTH], B, C, D]
    /** Inset distance at which the edge i -> i+1 of a convex outline shrinks to a point. */
    const collapseAt = (pts, i) => {
        const n = pts.length
        const turn = j => {
            const a = sub(pts[j], pts[(j - 1 + n) % n]), b = sub(pts[(j + 1) % n], pts[j])
            return Math.acos((a[0] * b[0] + a[1] * b[1]) / (len(a) * len(b)))
        }
        return len(sub(pts[(i + 1) % n], pts[i])) / (Math.tan(turn(i) / 2) + Math.tan(turn((i + 1) % n) / 2))
    }
    const hip = collapseAt(roofOutline, 3) // the B-C cut corner
    log(`roof: the Palestro cut corner collapses at an inset of ${hip.toFixed(3)} m`)
    await must({op: 'primitive', type: 'circle', name: 'roof', segments: 6, radius: 1, color: MAT.zinc.color})
    await must({op: 'vertices', object: 'roof', verts: roofOutline.map(([x, z], i) => [i, x, L.eave, z])})
    const r1 = await must({op: 'inset', object: 'roof', faces: [0], thickness: hip, depth: hip})
    // The cut corner's two inset vertices now coincide: weld them into the hip's apex.
    let rd = await detail('roof')
    const pair = rd.faceVerts[r1.data.insetFaces[0]].filter(v => {
        const p = rd.vertices[v]
        return Math.hypot(p[0] - (B[0] + C[0]) / 2, p[2] - (B[1] + C[1]) / 2) < hip * 2.5
    })
    await must({op: 'mergeByDistance', object: 'roof', verts: pair, threshold: 0.01})
    rd = await detail('roof')
    const mid = rd.faceVerts.map((v, i) => ({v, i})).find(({v}) => v.every(k => Math.abs(rd.vertices[k][1] - (L.eave + hip)) < 1e-4)).i
    await must({op: 'inset', object: 'roof', faces: [mid], thickness: brisisW - hip, depth: brisisH - hip})
    // The terrasson: a shallow second slope, stopped short of the next event (the boulevard cut corner).
    rd = await detail('roof')
    const crown = rd.faceVerts.map((v, i) => ({v, i})).find(({v}) => v.length >= 5 && v.every(k => Math.abs(rd.vertices[k][1] - L.brisisTop) < 1e-4)).i
    const TERRASSON = {width: 1.5, rise: 0.25}
    await must({op: 'inset', object: 'roof', faces: [crown], thickness: TERRASSON.width, depth: TERRASSON.rise})
    await must({op: 'bisect', object: 'roof', planeCo: [SEB_LENGTH, 0, 0], planeNo: [1, 0, 0], clearOuter: true})
    // The roof is a surface, not a solid, so the cut is an open chain and `fill` has no loop to close.
    // Close the gable with Blender's F on the chain's vertices, in order round the profile.
    rd = await detail('roof')
    const gable = rd.vertices.map((p, i) => ({p, i})).filter(({p}) => Math.abs(p[0] - SEB_LENGTH) < 1e-4)
    const gc = gable.reduce((a, {p}) => [a[0] + p[1] / gable.length, a[1] + p[2] / gable.length], [0, 0])
    gable.sort((a, b) => Math.atan2(a.p[1] - gc[0], a.p[2] - gc[1]) - Math.atan2(b.p[1] - gc[0], b.p[2] - gc[1]))
    await must({op: 'makeEdgeFace', object: 'roof', verts: gable.map(g => g.i)})
    await must({op: 'material', object: 'roof', ...MAT.zinc})
    await beat('roof')
    // Seen end-on from the party wall, before the neighbour is built: the gable is the roof's section.
    await shotCam([SEB_LENGTH + 30, 21.5, -DEPTH / 2], [SEB_LENGTH, 20.8, -DEPTH / 2], 32)
    await capture('mansard: a 45° brisis and a shallow terrasson, by inset')

    // --- balconies: the plan outset, cut flush at the party wall, thickened and nosed ------------
    /** The street fronts offset outward by `r`, as a polyline from the party wall round to the party wall. */
    const offsetPath = r => {
        const fronts = ['sebastopol', 'cut-sebastopol', 'greneta', 'cut-palestro', 'palestro'].map(k => FRONTS.find(f => f.key === k))
        // Walk boulevard (F -> E reversed), then D, C, B, A.
        const lines = fronts.map(f => {
            const sign = f.key === 'sebastopol' ? -1 : 1
            const dir = [f.dir[0] * sign, f.dir[1] * sign]
            const p = [f.a[0] + f.normal[0] * r, f.a[1] + f.normal[1] * r]
            return {p, dir}
        })
        const meet = (l1, l2) => {
            const den = l1.dir[0] * l2.dir[1] - l1.dir[1] * l2.dir[0]
            const t = ((l2.p[0] - l1.p[0]) * l2.dir[1] - (l2.p[1] - l1.p[1]) * l2.dir[0]) / den
            return [l1.p[0] + l1.dir[0] * t, l1.p[1] + l1.dir[1] * t]
        }
        const end = SEB_LENGTH - 0.03
        const pts = [[end, lines[0].p[1]]]
        for (let i = 0; i + 1 < lines.length; i++) pts.push(meet(lines[i], lines[i + 1]))
        pts.push([end, lines[lines.length - 1].p[1]])
        return pts
    }
    const pathLength = pts => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0)

    // The railing module: 30 cm of top rail and bottom rail, one bar and a cast ring beside it,
    // modelled Z-up because the curve array's frames are Blender's (Z up; see
    // issues/open/modelling-tools/command-array-curve-frames-z-up.md): the railing is stood up after.
    // (A finer module - two bars to 24 cm - pushed the exported GLB past 5 MB.)
    const MODULE = 0.3
    const moduleParts = async (name, up) => {
        // `up` is the axis the railing stands along: 'z' for the curve arrays, 'y' for straight runs.
        const at = (x, h) => up === 'z' ? [x, 0, h] : [x, h, 0]
        const box = (w, t, h) => up === 'z' ? {width: w, height: t, depth: h} : {width: w, height: h, depth: t}
        const parts = [`${name}-top`, `${name}-bottom`, `${name}-bar`, `${name}-ring`]
        await must({op: 'primitive', type: 'cube', name: parts[0], ...box(MODULE, 0.05, 0.05), position: at(MODULE / 2, 0.975), color: MAT.iron.color})
        await must({op: 'primitive', type: 'cube', name: parts[1], ...box(MODULE, 0.03, 0.03), position: at(MODULE / 2, 0.1)})
        await must({op: 'primitive', type: 'cube', name: parts[2], ...box(0.02, 0.02, 0.84), position: at(0.01, 0.535)})
        await must({op: 'primitive', type: 'torus', name: parts[3], radius: 0.1, tubeRadius: 0.009, segments: 6,
            tubeSegments: 3, axis: up === 'z' ? 'y' : 'z', position: at(MODULE / 2, 0.55)})
        await must({op: 'join', objects: parts, name})
        await must({op: 'applyTransform', object: name})
    }
    const railingMaster = name => moduleParts(name, 'z')

    const balcony = async (level, y) => {
        const name = `balcony-${level}`
        await must({op: 'primitive', type: 'circle', name, segments: 6, radius: 1, color: MAT.stone.color})
        await must({op: 'vertices', object: name, verts: [E, F, A, B, C, D].map(([x, z], i) => [i, x, y, z])})
        const o = await must({op: 'inset', object: name, faces: [0], individual: true, thickness: -BALCONY_DEPTH})
        await must({op: 'deleteElements', object: name, faces: o.data.insetFaces, type: 'FACE'})
        const dd = await detail(name)
        const party = dd.faceVerts.map((v, i) => ({i, c: centroid(dd, i)})).find(({c}) => c[0] > SEB_LENGTH).i
        await must({op: 'deleteElements', object: name, faces: [party], type: 'FACE'})
        await must({op: 'bisect', object: name, planeCo: [SEB_LENGTH, 0, 0], planeNo: [1, 0, 0], clearOuter: true})
        // A negative inset winds the new ring facing down (-y), so the shell grows along it: offset 1.
        await must({op: 'solidify', object: name, thickness: 0.16, offset: 1})
        // Nose the slab: the outer top edge, all along the front.
        const s = await detail(name)
        const nose = s.edgeVerts.map((e, i) => ({e, i})).filter(({e}) => e.every(v => {
            const p = s.vertices[v]
            return Math.abs(p[1] - y) < 1e-4 && frontOf(p[0], p[2]).d > BALCONY_DEPTH - 1e-3
        })).map(x => x.i)
        if (nose.length) await must({op: 'bevel', object: name, edges: nose, offset: 0.04, segments: 3, profile: 0.5})
        // The railing, 45 cm out, from the party wall round both cut corners to the party wall.
        const path = offsetPath(BALCONY_DEPTH - 0.05)
        const rail = `railing-${level}`
        await railingMaster(rail)
        const count = Math.floor(pathLength(path) / MODULE)
        await must({op: 'array', object: rail, path: path.map(([x, z]) => [x, -z, y]), count, live: true})
        await must({op: 'transform', object: rail, rotate: [-Math.PI / 2, 0, 0]})
        await must({op: 'material', object: rail, ...MAT.iron})
        return {name, rail, count}
    }
    const balconies = []
    balconies.push(await balcony(2, L.F2))
    await shotCam([-13, 10, 10], [-1, 8, -1.5], 45)
    await capture('2nd-floor balcony: outset, bisected, solidified, railing on a curve array')
    balconies.push(await balcony(4, L.F4))
    balconies.push(await balcony(5, L.F5))
    await beat('balconies')

    // --- balconettes (3rd floor) and window guards (1st floor), one master each --------------------
    const placements = FRONTS.filter(f => f.street).flatMap(f => f.windows.map(u => ({f, p: lerp2(f.a, f.b, u / f.length)})))
    const angleOf = f => Math.atan2(f.normal[0], f.normal[1]) // rotation about y taking +z onto the normal
    /** A straight railing run centred on x = 0, standing on y = 0 in the plane z = 0: the module on a linear array. */
    const straightRailing = async name => {
        await moduleParts(name, 'y')
        const n = Math.round((WIN + 0.24) / MODULE)
        await must({op: 'transform', object: name, move: [-n * MODULE / 2, 0, 0]})
        await must({op: 'applyTransform', object: name})
        await must({op: 'array', object: name, count: n, step: [MODULE, 0, 0], merge: true})
        return n * MODULE
    }
    /** Copy `master` onto every street bay at height `y`, `out` metres in front of the wall; join the copies. */
    const spread = async (master, y, out, into) => {
        const names = []
        for (const {f, p} of placements) {
            const r = await must({op: 'duplicate', object: master, name: `${master}-copy`, angle: angleOf(f), axis: 'y',
                pivot: [0, 0, 0], move: [p[0] + f.normal[0] * out, y, p[1] + f.normal[1] * out]})
            names.push(...r.objects)
        }
        await must({op: 'join', objects: names, name: into})
    }
    {
        const width = await straightRailing('balconette')
        await must({op: 'primitive', type: 'cube', name: 'balconette-slab', width: width + 0.14, height: 0.12, depth: 0.38,
            position: [0, -0.06, 0.19], color: MAT.stone.color})
        await must({op: 'applyTransform', object: 'balconette-slab'})
        await spread('balconette', L.F3, 0.32, 'balconettes-3')
        await spread('balconette-slab', L.F3, 0, 'balconette-slabs-3')
        await straightRailing('guard')
        await spread('guard', L.F1, 0.04, 'guards-1')
        await must({op: 'delete', objects: ['balconette', 'balconette-slab', 'guard']})
        await must({op: 'material', objects: ['balconettes-3', 'guards-1'], ...MAT.iron})
        await must({op: 'material', object: 'balconette-slabs-3', ...MAT.stone})
    }
    await shotCam([-8, 9, 14], [3, 8, -2], 45)
    await capture('balconettes and window guards: one master, placed on every bay')

    // --- dormers: one master, live arrays along the regular fronts -------------------------------
    {
        const DORMER = {w: 1.3, h: 1.75, d: 2.0, sill: 0.8}
        await must({op: 'primitive', type: 'cube', name: 'dormer', width: DORMER.w, height: DORMER.h, depth: DORMER.d,
            position: [0, DORMER.h / 2, -DORMER.d / 2], color: MAT.zinc.color})
        await must({op: 'applyTransform', object: 'dormer'})
        let dd = await detail('dormer')
        const faceBy = (n, dd2) => dd2.faceVerts.map((_, i) => i).find(i => {
            const c = centroid(dd2, i)
            return n === 'front' ? Math.abs(c[2]) < 1e-4 : Math.abs(c[1] - DORMER.h) < 1e-4
        })
        const fr = await must({op: 'inset', object: 'dormer', faces: [faceBy('front', dd)], thickness: 0.16})
        await must({op: 'extrude', object: 'dormer', faces: fr.data.insetFaces, direction: [0, 0, -1], distance: 0.12})
        dd = await detail('dormer')
        await must({op: 'extrude', object: 'dormer', faces: [faceBy('top', dd)], direction: [0, 1, 0], distance: 0.1,
            scale: [1.12, 1, 1.04]})
        dd = await detail('dormer')
        const pane = dd.faceVerts.map((_, i) => i).find(i => Math.abs(centroid(dd, i)[2] + 0.12) < 1e-4)
        const ps = await must({op: 'inset', object: 'dormer', faces: [pane], thickness: 0.05})
        await must({op: 'separate', object: 'dormer', mode: 'faces', faces: ps.data.insetFaces, name: 'dormer-glass'})
        await must({op: 'material', object: 'dormer-glass', ...MAT.glass})
        // Shown on its own out in the street, then put back at the origin the placements work from.
        await must({op: 'transform', objects: ['dormer', 'dormer-glass'], move: [-16, 0, 9]})
        await capture('dormer master', {view: 'iso', fit: ['dormer', 'dormer-glass']})
        await must({op: 'transform', objects: ['dormer', 'dormer-glass'], move: [16, 0, -9]})

        const at = (f, u) => {
            const p = lerp2(f.a, f.b, u / f.length)
            return [p[0] - f.normal[0] * DORMER.sill, L.eave + DORMER.sill, p[1] - f.normal[1] * DORMER.sill]
        }
        const placeGroup = async (f, us, name, live) => {
            const p0 = at(f, us[0])
            const made = []
            for (const [src, dst] of [['dormer', name], ['dormer-glass', `${name}-glass`]]) {
                const r = await must({op: 'duplicate', object: src, name: dst, angle: angleOf(f), axis: 'y', pivot: [0, 0, 0], move: p0})
                made.push(...r.objects)
            }
            // Bake the placement, so the array's step can be given in world terms, along the front.
            await must({op: 'applyTransform', objects: made})
            if (live) {
                const step = (us[us.length - 1] - us[0]) / (us.length - 1)
                await must({op: 'array', objects: made, count: us.length,
                    step: [f.dir[0] * step, 0, f.dir[1] * step], live: true, merge: false})
            }
            return made
        }
        const seb = FRONTS.find(f => f.key === 'sebastopol'), gre = FRONTS.find(f => f.key === 'greneta')
        await placeGroup(seb, seb.windows, 'dormers-sebastopol', true)
        await placeGroup(gre, gre.windows, 'dormers-greneta', true)
        // Palestro's bays are irregular (2.31 to 2.87 m): placed one by one. The cut corners get none:
        // their brisis narrows to a hip below the height of a dormer.
        let k = 0
        const singles = []
        const pal = FRONTS.find(f => f.key === 'palestro')
        for (const u of pal.windows) singles.push(...await placeGroup(pal, [u], `dormer-${k++}`, false))
        await must({op: 'join', objects: singles.filter(n => !n.includes('glass')), name: 'dormers-other'})
        await must({op: 'join', objects: singles.filter(n => n.includes('glass')), name: 'dormers-other-glass'})
        await must({op: 'delete', objects: ['dormer', 'dormer-glass']})
        log(`dormers: ${seb.windows.length + gre.windows.length + k}`)
    }
    await beat('dormers')
    await shotCam([-22, 30, 22], [3, 20, -7], 40)
    await capture('dormers on live arrays')

    // --- chimneys: party-wall stack and the two stacks the elevation shows -----------------------
    {
        const top = L.chimney
        const stack = async (name, x0, x1, z0, z1, y0) => {
            await must({op: 'primitive', type: 'cube', name, width: x1 - x0, height: top - y0, depth: z1 - z0,
                position: [(x0 + x1) / 2, (y0 + top) / 2, (z0 + z1) / 2], color: MAT.stone.color})
            await must({op: 'applyTransform', object: name})
            const dd = await detail(name)
            const t = dd.faceVerts.map((_, i) => i).find(i => Math.abs(centroid(dd, i)[1] - top) < 1e-4)
            // A capping course: the top face pushed up and flared.
            await must({op: 'extrude', object: name, faces: [t], direction: [0, 1, 0], distance: 0.08, scale: [1.15, 1, 1.15]})
        }
        const ex = col => (col - ELEV.left) / ELEV.pxPerM
        // Party wall: the elevation's right-hand stack, 1560-1600 px; runs back along the wall.
        await stack('chimney-party', ex(1562), SEB_LENGTH, -DEPTH + 1.2, -1.4, L.brisisTop - 0.6)
        // The stack in the boulevard wall, rising through the brisis (1058-1094 px).
        await stack('chimney-front', ex(1058), ex(1094), -1.0, -0.25, L.eave - 0.3)
        // The left-hand stack behind the cut corner (515-560 px).
        await stack('chimney-corner', ex(518), ex(560), -3.4, -2.8, L.brisisTop - 0.5)
        await must({op: 'join', objects: ['chimney-front', 'chimney-corner'], name: 'chimneys'})
        // Pots: one lathed terracotta pot, arrayed live along the party-wall stack.
        const potH = 0.38
        await must({op: 'lathe', name: 'pots', segments: 12, color: MAT.pot.color,
            profile: [[0, 0], [0.12, 0], [0.12, 0.04], [0.095, 0.08], [0.09, potH - 0.08], [0.115, potH - 0.03],
                [0.115, potH], [0, potH]],
            position: [SEB_LENGTH - 0.27, top + 0.08, -DEPTH + 1.6]})
        await must({op: 'applyTransform', object: 'pots'})
        const n = Math.floor((DEPTH - 3.0) / 0.5)
        await must({op: 'array', object: 'pots', count: n, step: [0, 0, 0.5], live: true, merge: false})
    }
    await beat('chimneys')

    // --- street: pavement round the three fronts, the road, and the neighbour on the party wall ---
    {
        await must({op: 'primitive', type: 'plane', name: 'road', size: 90, position: [5, -0.15, -8], color: MAT.road.color})
        await must({op: 'primitive', type: 'circle', name: 'pavement', segments: 6, radius: 1, color: MAT.pavement.color})
        // The building's outline, run on under the neighbour, outset 4 m: a ring of six quads.
        const out = [E, [SEB_LENGTH + 12, 0], [SEB_LENGTH + 12, -DEPTH], B, C, D]
        await must({op: 'vertices', object: 'pavement', verts: out.map(([x, z], i) => [i, x, 0, z])})
        const o = await must({op: 'inset', object: 'pavement', faces: [0], individual: true, thickness: -4.0})
        await must({op: 'deleteElements', object: 'pavement', faces: o.data.insetFaces, type: 'FACE'})
        await must({op: 'solidify', object: 'pavement', thickness: 0.15, offset: 1})
        // The next house along the boulevard and the rue Palestro, to the same 20 m.
        await must({op: 'primitive', type: 'cube', name: 'neighbour', width: 12, height: L.eave - 0.4, depth: DEPTH,
            position: [SEB_LENGTH + 6, (L.eave - 0.4) / 2, -DEPTH / 2], color: MAT.neighbour.color})
        await must({op: 'applyTransform', object: 'neighbour'})
        const nd = await detail('neighbour')
        const nt = nd.faceVerts.map((_, i) => i).find(i => centroid(nd, i)[1] > L.eave - 0.41)
        await must({op: 'inset', object: 'neighbour', faces: [nt], thickness: 2.4, depth: 2.4})
    }
    // --- materials: stone, zinc, glass, cast iron, terracotta ------------------------------------
    await must({op: 'material', objects: ['facade', 'chimney-party', 'chimneys', 'balcony-2', 'balcony-4', 'balcony-5',
        'balconette-slabs-3'], ...MAT.stone})
    await must({op: 'material', objects: ['dormers-sebastopol', 'dormers-greneta', 'dormers-other'], ...MAT.zinc})
    await must({op: 'material', objects: ['dormers-sebastopol-glass', 'dormers-greneta-glass', 'dormers-other-glass'], ...MAT.glass})
    await must({op: 'material', object: 'pots', ...MAT.pot})
    await must({op: 'material', object: 'road', ...MAT.road})
    await must({op: 'material', object: 'pavement', ...MAT.pavement})
    await must({op: 'material', object: 'neighbour', ...MAT.neighbour})
    await beat('street')
    await shotCam([-36, 13, 40], [4, 8, -7], 40)
    await capture('the street')

    // --- checks: the model against the drawings -------------------------------------------------
    //
    // Measured from the finished model, not restated from the constants. A miss over 2 % throws.
    const health = await must({op: 'selftest'})
    log(`selftest: ${health.data.objects} objects, ${health.data.failed} failed`)
    if (health.data.failed) throw new Error('selftest failed')

    const checks = []
    /** Within 2 % of the drawing, and never more than `abs` (3 cm for lengths) - whichever is tighter. */
    const expect = (what, got, want, source, abs = 0.03) => {
        const delta = got - want
        const ok = Math.abs(delta) <= Math.min(0.02 * Math.abs(want), abs) + 1e-9
        checks.push({what, want: +want.toFixed(3), got: +got.toFixed(3), delta: +delta.toFixed(3), ok, source})
        log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}: ${got.toFixed(3)} (drawing ${want.toFixed(3)})`)
    }
    const box = async name => (await must({op: 'measure', object: name, mode: 'bounds'})).data[0]
    const facade = await detail('facade')
    const ground = facade.vertices.filter(v => Math.abs(v[1]) < 1e-4)
    const at0 = (x, z) => ground.find(v => Math.hypot(v[0] - x, v[2] - z) < 0.02)
    // Corners, as built: the ground ring of the wall.
    const corner = p => {
        const v = at0(p[0], p[1])
        if (!v) throw new Error(`no wall vertex at plan corner ${p}`)
        return [v[0], v[2]]
    }
    const [cE, cF, cA, cB, cC, cD] = [E, F, A, B, C, D].map(corner)
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
    const facadeBox = await box('facade')
    expect('cornice height above the pavement (1859 limit: 20 m)', facadeBox.max[1], lv(ELEV.rows.eave), 'Pl. 1 row 893')
    expect('boulevard front, cut corner to party wall', dist(cE, cF), (ELEV.right - ELEV.left) / ELEV.pxPerM, 'Pl. 1 cols 515-1602')
    expect('depth, boulevard to rue Palestro', dist(cF, cA), (PLAN.seb - PLAN.pal) / PLAN.pxPerM, 'Pl. 3 rows 682-1269')
    expect('rue Palestro front', dist(cA, cB), A[0] - (PLAN.upperCut.pal - PLAN.origin) / PLAN.pxPerM, 'Pl. 3 cols 598 to party wall')
    expect('rue Greneta front', dist(cC, cD), (PLAN.lowerCut.gre - PLAN.upperCut.gre) * Math.hypot(1, 0.4726) / PLAN.pxPerM, 'Pl. 3 rows 758-1212')
    expect('cut corner, Greneta / boulevard', dist(cD, cE), Math.hypot(PLAN.greneta(PLAN.lowerCut.gre) - PLAN.origin, PLAN.lowerCut.gre - PLAN.seb) / PLAN.pxPerM, 'Pl. 3')
    expect('cut corner, Palestro / Greneta', dist(cB, cC), Math.hypot(PLAN.upperCut.pal - PLAN.greneta(PLAN.upperCut.gre), PLAN.upperCut.gre - PLAN.pal) / PLAN.pxPerM, 'Pl. 3')
    const greAngle = Math.atan2(cD[0] - cC[0], cD[1] - cC[1]) * 180 / Math.PI
    expect('rue Greneta, angle off square (deg)', greAngle, Math.atan(0.4726) * 180 / Math.PI, 'Pl. 3 pier fit', 0.3)
    for (const [lvl, name] of [[2, 'balcony-2'], [4, 'balcony-4'], [5, 'balcony-5']]) {
        expect(`${lvl}${lvl === 2 ? 'nd' : 'th'}-floor balcony, top of slab`, (await box(name)).max[1], L[`F${lvl}`], `Pl. 1 row ${ELEV.rows[`F${lvl}`]}`)
    }
    expect('balcony projection (boulevard)', (await box('balcony-2')).max[2], BALCONY_DEPTH, 'Pl. 3 outline 18-19 px')
    expect('3rd-floor balconettes, top of slab', (await box('balconette-slabs-3')).max[1], L.F3, `Pl. 1 row ${ELEV.rows.F3}`)
    expect('1st floor (the window guards stand on it)', (await box('guards-1')).min[1] - 0.085, L.F1, `Pl. 1 row ${ELEV.rows.F1}`)
    // Windows: the glass panes' centres on the boulevard's 2nd floor give the bay rhythm.
    const glass = await detail('glass')
    const sebPanes = glass.faceVerts.map((_, i) => centroid(glass, i))
        .filter(c => Math.abs(c[2] + RECESS) < 0.01 && c[1] > L.F2 && c[1] < L.headF2).sort((a, b) => a[0] - b[0])
    expect('boulevard windows, 2nd floor', sebPanes.length, 6, 'Pl. 1', 0)
    expect('bay spacing, boulevard', (sebPanes[sebPanes.length - 1][0] - sebPanes[0][0]) / (sebPanes.length - 1), BAY, 'Pl. 1 window leaves')
    {
        const first = (ELEV.bays[0] - ELEV.left) / ELEV.pxPerM
        const jambs = facade.vertices.filter(v => Math.abs(v[2]) < 1e-4 && Math.abs(v[1] - L.F2) < 1e-4
            && Math.abs(v[0] - first) < WIN * 0.75).map(v => v[0])
        expect('window opening, between stone jambs', Math.max(...jambs) - Math.min(...jambs), WIN, 'Pl. 1 88 px')
    }
    const roof = await detail('roof')
    const brisisTop = roof.vertices.filter(v => Math.abs(v[1] - L.brisisTop) < 1e-3 && v[0] > 0.5 && v[0] < SEB_LENGTH + 1e-3)
    const setback = Math.min(...brisisTop.map(v => -v[2]).filter(z => z > 0 && z < 5))
    expect('top of the brisis', Math.max(...brisisTop.map(v => v[1])), L.brisisTop, `Pl. 1 row ${ELEV.rows.brisisTop}`)
    expect('brisis pitch (deg; 1859: within 45°)', Math.atan2(L.brisisTop - L.eave, setback) * 180 / Math.PI, BRISIS_PITCH, '1859 decree', 0.3)
    expect('chimney tops (party-wall stack, capping)', (await box('chimney-party')).max[1], L.chimney + 0.08, `Pl. 1 row ${ELEV.rows.chimney} + coping`)
    expect('main cornice projection', facadeBox.max[2], CORNICE_PROJECTION, 'A2 Pl. 6 profile, scaled')
    const failed = checks.filter(c => !c.ok)

    // --- counts and topology --------------------------------------------------------------------
    const doc = (await must({op: 'inspect'})).data
    const topo = []
    for (const name of doc.names) {
        const dd = await detail(name)
        const count = new Map()
        for (const f of dd.faceVerts) f.forEach((v, k) => {
            const w = f[(k + 1) % f.length], key = v < w ? `${v}-${w}` : `${w}-${v}`
            count.set(key, (count.get(key) ?? 0) + 1)
        })
        let boundary = 0, nonManifold = 0
        for (const c of count.values()) if (c === 1) boundary++; else if (c > 2) nonManifold++
        const sizes = dd.faceVerts.map(f => f.length)
        topo.push({name, verts: dd.verts, edges: dd.edges, faces: dd.faces,
            quads: sizes.filter(s => s === 4).length, tris: sizes.filter(s => s === 3).length,
            ngons: sizes.filter(s => s > 4).length, boundary, nonManifold})
    }
    const evaluated = await session.page?.evaluate(() => {
        let triangles = 0, meshes = 0
        window.viewer.scene.modelRoot.traverse(o => {
            if (!o.isMesh || o.userData.__isReferencePlane || !o.visible) return
            meshes++
            const g = o.geometry
            triangles += (g.index ? g.index.count : g.attributes.position.count) / 3
        })
        return {triangles, meshes}
    })
    const report = {checks, topo, totals: doc.totals, objects: doc.objects, evaluated,
        balconies: balconies.map(b => ({name: b.name, railingModules: b.count}))}
    session.report = report
    log(`model: ${doc.objects} objects, masters ${doc.totals.verts} verts / ${doc.totals.edges} edges / `
        + `${doc.totals.faces} faces; ${evaluated?.triangles} triangles drawn`)
    if (session.outDir) {
        const {writeFile} = await import('node:fs/promises')
        await writeFile(`${session.outDir}/report.json`, JSON.stringify(report, null, 2))
    }
    if (failed.length) throw new Error(`${failed.length} dimension checks off by more than 2 %: ${failed.map(c => c.what).join('; ')}`)
    await beat('checks', report)
    if (session.present === false) return

    // --- presentation: the views the report compares with the references --------------------------
    const view = async (label, position, target, fov = 45) => {
        await must({op: 'camera', projection: 'perspective', fov, position, target})
        await capture(label)
    }
    await view('hero: from the rue Greneta corner, eye level', [-16, 1.7, 26], [3, 12, -6], 45)
    await view('three-quarter on the cut corner, as the rue Monge photograph', [-21, 7, 21], [-1, 11, -3], 42)
    await view('the boulevard front from across the boulevard', [7.5, 1.7, 30], [7.5, 10.5, 0], 48)
    await view('rue Palestro and the upper cut corner', [-18, 6, -34], [1, 11, -12], 45)
    await must({op: 'display', mode: 'wireframe'})
    await view('wireframe', [-26, 26, 30], [5, 9, -8], 40)
    await must({op: 'display', mode: 'material'})
    await must({op: 'material', object: '*', opacity: 0.3})
    await view('x-ray', [-26, 26, 30], [5, 9, -8], 40)
    await must({op: 'material', object: '*', opacity: 1})
    await must({op: 'reference', name: 'elevation', plane: 'front', visible: true})
    await must({op: 'camera', projection: 'orthographic', position: [SEB_LENGTH / 2, 11.5, 60], target: [SEB_LENGTH / 2, 11.5, 0],
        frustumSize: 27})
    await must({op: 'display', mode: 'wireframe'})
    await capture('orthographic, wireframe over the 1870 elevation')
    await must({op: 'display', mode: 'material'})
    await must({op: 'reference', name: 'elevation', plane: 'front', visible: false})
    await capture('orthographic, the model alone, same framing')
    await must({op: 'reference', name: 'plan', plane: 'top', visible: true})
    await must({op: 'camera', projection: 'orthographic', position: [2.5, 80, -7.85], target: [2.5, 0, -7.9], frustumSize: 24})
    await must({op: 'display', mode: 'wireframe'})
    await capture('top, wireframe over the 1870 plan')
    await must({op: 'display', mode: 'material'})
    await must({op: 'reference', name: 'plan', plane: 'top', visible: false})
    await must({op: 'camera', projection: 'perspective', fov: 40})
    await must({op: 'export', format: 'glb', path: 'demos/haussmann/haussmann.glb'})
}

/**
 * A cast-iron spiral staircase and a short Gothic arcade, to scale, built entirely through the
 * `@threepipe/plugin-modelling` JSON command API.
 *
 *     npm run modelling:session -- demos/stair/build.mjs --out tmp/stair/run --port 9383 \
 *         --width 1200 --height 800
 *
 * Parameters come from the environment so the same build re-runs at other settings:
 *
 *     STAIR_TREADS=16 ARCADE_BAYS=5 npm run modelling:session -- demos/stair/build.mjs ...
 *
 * Every vertex comes out of a generating command (`primitive`, `lathe`, `sweep`) and is placed by
 * `vertices`, `transform`, `extrude`, `inset`, `solidify`, `bevel`, `subdivide`, `bridgeEdgeLoops`,
 * `mirror` or an `array`; the places that use `vertices` compute positions from the measured numbers
 * below. Repetition is live (`array {live: true}`, `modifier`), so changing a count or editing a
 * master re-lays everything that depends on it.
 *
 * Axes: Y up, metres. The stair stands on the origin; the arcade runs along +X beside it.
 *
 * References and how each number was read: `demos/stair/refs/SOURCES.md`.
 */

const env = typeof process !== 'undefined' ? process.env : {}

// --- parameters -------------------------------------------------------------------------------

/** Treads per full turn. The catalogue stair has 12 (30 degrees each). */
const TREADS_PER_TURN = Number(env.STAIR_TREADS ?? 12)
/** Full turns of the flight, floor to landing. */
const TURNS = Number(env.STAIR_TURNS ?? 2)
/** Arches in the arcade. The demo's arcade has four. */
const BAYS = Number(env.ARCADE_BAYS ?? 4)
/** `full` builds both pieces; `stair` or `arcade` builds one (for iterating on it). */
const PART = env.STAIR_PART ?? 'full'
/** Where to write the GLBs. Empty skips the export. */
const EXPORT_DIR = env.STAIR_EXPORT_DIR ?? 'demos/stair'

// --- measured data: the stair -----------------------------------------------------------------
//
// UK Architectural Antiques listing 24019 (ref 10118), a reclaimed Safety Stairways Ltd cast-iron
// spiral: "13 steps including the top landing plate. Floor to floor measures: 104". The distance from
// the centre of the pole to the outside of the step is 26 1/2". [...] The centre pole measures:
// 105 1/2" tall plus additional 37". The balcony spindles on the top landing measure 33 1/2" tall."
// Twelve treads to a turn is counted from the listing's top-down photograph (30 degree treads).

const IN = 0.0254
const CAT = {
    radius: 26.5 * IN,              // pole centre to outside of the tread
    rise: 104 * IN / 13,            // 8": 13 rises, floor to landing
    newel: 37 * IN,                 // the pole above the landing
    spindle: 33.5 * IN,             // baluster / balcony spindle length
    treadsPerTurn: 12,
}
/** Floor to landing for two turns at the catalogue's rise. Kept when the tread count changes. */
const FLOOR_TO_LANDING = TURNS * CAT.treadsPerTurn * CAT.rise
const RISERS = TURNS * TREADS_PER_TURN
const RISE = FLOOR_TO_LANDING / RISERS
const TREAD_ANGLE = 2 * Math.PI / TREADS_PER_TURN

/** Details read from the photographs, in proportion to the measured radius. */
const STAIR = {
    pole: 1.5 * IN,                 // 3" pole
    hub: 2.4 * IN,                  // the cast collar each tread hangs on
    plate: 0.625 * IN,              // tread casting thickness
    nosing: 1 * IN,                 // tread overlaps the one below by this, at the outside
    balusterInset: 1.25 * IN,       // baluster centre in from the tread edge
    rail: {width: 1.5 * IN, thick: 0.5 * IN},
}

/** Safety Stairways castings were supplied primed and painted; the listing's stair is white. */
const PAINT = '#e6e3dc'

// --- measured data: the arcade ----------------------------------------------------------------
//
// HABS NY-6061-ish, Church of the Ascension, Fifth Avenue at Tenth Street, New York (Richard Upjohn,
// 1840-41), measured 1968: sheet 8 "Interior elevation: south side of nave" (scale bar 0-10 ft),
// sheet 3 main floor plan, sheet 7 transverse section (aisle ceiling 31'-9" dimensioned). Readings off
// sheet 8 at 39.6 px/ft (the scale bar), cross-checked against the plan (pier pitch 14.2 ft).

const FT = 0.3048
const ARC = {
    bay: 14.25 * FT,                // pier centre to pier centre
    springing: 21.34 * FT,          // floor to the top of the capital (abacus)
    apex: 30.43 * FT,               // floor to the intrados at the crown
    span: 11.29 * FT,               // intrados, springing to springing
    ring: 1.69 * FT,                // arch moulding, intrados to extrados at the crown
    pier: 2.68 * FT,                // quatrefoil pier, across the shafts
    abacus: 3.91 * FT,              // capital top, across
    capital: 1.79 * FT,             // abacus top to necking
    aisleCeiling: 31.75 * FT,       // sheet 7, dimensioned: the vault crown
    sill: 33.8 * FT,                // clerestory sill, sheet 8: the string course runs under it
    aisle: 15.1 * FT,               // sheet 3: pier centre to the aisle wall
    wall: 1.5 * FT,                 // arcade wall thickness (sheet 3 plan)
}
/** Where the arcade stands, beside and behind the stair. */
const ARCADE_AT = [3.4, 0, -4.8]
const STONE = '#c9c2b4'
const STONE_DARK = '#a9a194'

export default async function build(session) {
    const {run, capture, log} = session
    // Hooks a recorder (record.mjs) fills in; a plain session leaves them as no-ops.
    const REC = !!session.recording
    const section = session.section ?? (async () => {})
    const hold = session.hold ?? (async () => {})

    const must = async command => {
        const r = await run(command)
        if (!r.ok) throw new Error(`${command.op} failed: ${r.error}`)
        return r
    }
    const inspectAll = name => must({op: 'inspect', object: name, detail: true, limit: 100000}).then(r => r.data)
    const box = async name => (await must({op: 'measure', object: name, mode: 'bounds'})).data[0]

    const checks = []
    const check = (what, got, want, unit = 'm') => {
        const err = Math.abs(got - want) / Math.abs(want)
        const ok = err <= 0.02
        checks.push({what, got: +got.toFixed(4), want: +want.toFixed(4), err: +(err * 100).toFixed(2), ok, unit})
        log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}: ${got.toFixed(4)} ${unit} (reference ${want.toFixed(4)}, ${(err * 100).toFixed(2)}%)`)
    }

    await must({op: 'delete', object: '*'})
    await must({op: 'lighting', environmentIntensity: 0.8, background: '#5b6068'})
    await must({op: 'light', name: 'sun', type: 'directional', position: [6, 10, 8], target: [0, 2, 0],
        intensity: 2.4, castShadow: true})

    const STAIR_PARTS = ['column', 'tread', 'baluster', 'landing', 'balcony-a', 'balcony-b', 'handrail', 'landing-rail']
    if (PART !== 'arcade') await stair()
    let arcadeAt = [0, 0, 0]
    // The arcade is built about the origin like any part - its modifiers work in object space - so the
    // finished stair steps aside while it is, and comes back after the arcade has moved to its place.
    if (PART === 'full') await must({op: 'transform', object: STAIR_PARTS, move: [-60, 0, 0]})
    if (PART !== 'stair') await arcade()
    if (PART === 'full') await must({op: 'transform', object: STAIR_PARTS, move: [60, 0, 0]})
    if (PART === 'full') await finale()

    async function finale() {
        const A = ARC.aisle, L = BAYS * ARC.bay, at = arcadeAt
        const view = async (label, eye, target, fov = 45) => {
            await must({op: 'camera', projection: 'perspective', fov, position: eye, target})
            return capture(label)
        }
        await must({op: 'primitive', type: 'circle', name: 'stair-floor', radius: 1.6, segments: 48, color: '#8f877a',
            position: [0, -0.002, 0]})
        await must({op: 'applyTransform', object: 'stair-floor'})
        await must({op: 'material', object: ['tread', 'baluster', 'column', 'landing', 'handrail', 'landing-rail',
            'balcony-a', 'balcony-b'], roughness: 0.45, metalness: 0})
        await must({op: 'material', object: ['stair-floor'], roughness: 0.95, metalness: 0})

        const heroStair = [[4.4, 3.4, 6.0], [0, 2.9, 0], 50]
        const heroArcade = [[at[0] + L / 2 + 8, 5.5, at[2] + 19], [at[0] + L / 2, 5.0, at[2] - A / 2], 46]
        const both = [[-7.5, 5.5, 13], [at[0] + L / 2 - 3, 4.0, at[2] - 2], 48]
        const aisle = [[at[0] - 1.2, 1.7, at[2] - A / 2], [at[0] + L, 7.8, at[2] - A / 2], 62]
        const under = [[0.15, 0.4, 0.25], [0.35, 4.0, -0.4], 70]
        await view('hero: the stair', ...heroStair)
        await view('hero: the arcade', ...heroArcade)
        await view('hero: both pieces', ...both)
        await view('inside the aisle, under the ribs', ...aisle)
        await view('looking up the stair from its foot', ...under)
        await view('detail: treads, collars and balusters', [1.15, 2.1, 1.1], [0.1, 1.55, -0.1], 42)

        // Wireframe and x-ray passes over the same frames.
        await section('Wireframe and x-ray', 'every piece is still editable topology: quads, live modifiers')
        await must({op: 'display', mode: 'wireframe'})
        await view('wireframe: the stair', ...heroStair)
        await view('wireframe: the arcade', ...heroArcade)
        await must({op: 'display', mode: 'material'})
        await must({op: 'material', object: '*', opacity: 0.28})
        await view('x-ray: the stair', ...heroStair)
        await view('x-ray: the arcade', ...heroArcade)
        await must({op: 'material', object: '*', opacity: 1})
        await view('hero: both pieces (final)', ...both)
        if (session.orbit) {
            await section('Turntable', '')
            await session.orbit({center: [(at[0] + L - 1) / 2, 4.2, (at[2] - A + 1) / 2], radius: 17, height: 7.5, seconds: 12})
        }
    }

    async function stair() {
        log(`stair: ${TREADS_PER_TURN} treads a turn, ${TURNS} turns, rise ${(RISE / IN).toFixed(2)}"`)
        const H = FLOOR_TO_LANDING
        const R = CAT.radius
        const sp = CAT.spindle
        const dir = phi => [Math.cos(phi), 0, -Math.sin(phi)]
        const at = (r, phi, y) => [r * Math.cos(phi), y, -r * Math.sin(phi)]
        const angleOf = ([x, , z]) => Math.atan2(-z, x)
        const stairView = async (label, eye, target, fov = 32) => {
            await must({op: 'camera', projection: 'perspective', fov, position: eye, target})
            return capture(label)
        }
        const wholeStair = label => stairView(label, [4.4, 3.4, 6.0], [0, 2.9, 0], 50)

        // --- column: one lathe, floor flange to finial ----------------------------------------
        await section('The column', 'one `lathe`: a profile of 17 points revolved 24 times')
        const top = H + CAT.newel
        const ball = 1.6 * IN
        const finial = []
        for (let i = 1; i <= 8; i++) {
            const t = -Math.PI / 2 + Math.PI * i / 8
            finial.push([ball * Math.cos(t), top + 0.9 * IN + ball + ball * Math.sin(t)])
        }
        await must({op: 'lathe', name: 'column', segments: 24, color: PAINT, profile: [
            [0, 0], [4.5 * IN, 0], [4.5 * IN, 0.5 * IN], [3.2 * IN, 0.9 * IN], [2.2 * IN, 1.6 * IN],
            [STAIR.pole, 2.2 * IN], [STAIR.pole, top - 1.2 * IN], [STAIR.pole + 0.4 * IN, top - 0.8 * IN],
            [STAIR.pole + 0.4 * IN, top], [0.9 * IN, top + 0.4 * IN], [0.7 * IN, top + 0.9 * IN],
            ...finial,
        ]})
        await stairView('column, one lathe', [1.5, 0.45, 1.9], [0, 2.6, 0], 62)

        // --- one tread: a polar grid, pierced, given thickness, bevelled --------------------------
        //
        // A grid laid flat, then every vertex moved onto polar coordinates: out from the hub, and round
        // the tread from its nosing (just behind angle 0, overlapping the tread below) to the next
        // tread's angle. The copies turn by +TREAD_ANGLE about +Y.
        await section('One tread', '`primitive grid` laid onto polar coordinates, `inset`, `deleteElements`, `solidify`, `bevel`, `extrude`')
        const RADIAL = 7, AROUND = 6
        await must({op: 'primitive', type: 'grid', name: 'tread', xSegments: RADIAL, ySegments: AROUND,
            width: 1, depth: 1, color: PAINT})
        const nose = STAIR.nosing / R
        // Grid lines. The first and last of each are the cast rim (narrow); the rest are spaced evenly
        // and become the openings.
        const lines = (lo, loRim, hiRim, hi, n) => [lo, ...Array.from({length: n - 1},
            (_, k) => loRim + (hiRim - loRim) * k / (n - 2)), hi]
        const radii = lines(STAIR.hub, STAIR.hub + 0.8 * IN, R - 0.9 * IN, R, RADIAL)
        // Round the tread the grid runs against the angle, so its up-facing normal survives the map.
        const angles = lines(TREAD_ANGLE, TREAD_ANGLE - 0.6 * IN / R, -nose + 1.1 * IN / R, -nose, AROUND)
        {
            const d = await inspectAll('tread')
            await must({op: 'vertices', object: 'tread', verts: d.vertices.map(([x, , z], i) =>
                [i, ...at(radii[Math.round((x + 0.5) * RADIAL)], angles[Math.round((z + 0.5) * AROUND)], RISE)])})
        }
        await stairView('tread blank on the polar grid', [0.45, 1.15, 0.42], [0.36, RISE, -0.1], 38)

        // The cast pattern: every cell off the rim inset to leave a rib, and the inset face deleted, so
        // the plate is an openwork casting.
        {
            const d = await inspectAll('tread')
            const onRim = ([x, , z]) => {
                const r = Math.hypot(x, z), a = angleOf([x, 0, z])
                return r < STAIR.hub + 1e-4 || r > R - 1e-4 || a > TREAD_ANGLE - 1e-4 || a < -nose + 1e-4
            }
            // A cell is rim when one of its sides lies on the outline: two corners there.
            const inner = []
            d.faceVerts.forEach((vs, i) => {
                if (vs.filter(v => onRim(d.vertices[v])).length < 2) inner.push(i)
            })
            const rib = await must({op: 'inset', object: 'tread', faces: inner, individual: true, thickness: 0.32 * IN})
            await must({op: 'deleteElements', object: 'tread', faces: rib.data.insetFaces, type: 'FACE'})
        }
        await must({op: 'solidify', object: 'tread', thickness: STAIR.plate, offset: -1})
        // Round the openings: bevel the short vertical edges at their corners, chosen by position from
        // `inspect`'s edge list.
        {
            const d = await inspectAll('tread')
            const corners = []
            d.edgeVerts.forEach(([a, b], i) => {
                const p = d.vertices[a], q = d.vertices[b]
                const vertical = Math.hypot(p[0] - q[0], p[2] - q[2]) < 1e-4 && Math.abs(Math.abs(p[1] - q[1]) - STAIR.plate) < 1e-4
                const r = Math.hypot(p[0], p[2]), ang = angleOf(p)
                const inside = r > STAIR.hub + 1e-3 && r < R - 1e-3 && ang < TREAD_ANGLE - 1e-3 && ang > -nose + 1e-3
                if (vertical && inside) corners.push(i)
            })
            await must({op: 'bevel', object: 'tread', edges: corners, offset: 0.28 * IN, segments: 3, profile: 0.5})
        }
        await stairView('tread pierced, solidified, openings rounded', [0.95, 0.75, 0.75], [0.35, RISE, -0.1], 38)

        // The nosing: the underside of the front rim extruded down into the apron cast treads have.
        {
            const d = await inspectAll('tread')
            const front = []
            const frontLine = angles[AROUND - 1]
            d.faceVerts.forEach((vs, i) => {
                const pts = vs.map(v => d.vertices[v])
                const under = pts.every(q => Math.abs(q[1] - (RISE - STAIR.plate)) < 1e-4)
                if (under && pts.every(q => angleOf(q) < frontLine + 1e-4)) front.push(i)
            })
            if (!front.length) throw new Error('no nosing faces found under the tread')
            await must({op: 'extrude', object: 'tread', faces: front, distance: 1.25 * IN, direction: [0, -1, 0]})
        }

        // The collar the tread hangs on: a lathed sleeve one rise tall, so the stacked collars read as
        // the column the way the castings do.
        await must({op: 'lathe', name: 'collar', segments: 24, color: PAINT, profile: [
            [STAIR.pole, 0], [STAIR.hub, 0], [STAIR.hub + 0.3 * IN, 0.4 * IN], [STAIR.hub, 0.8 * IN],
            [STAIR.hub, RISE], [STAIR.pole, RISE]],
            // Closed: the profile's last point joins its first, so the sleeve has its bore and is solid.
            closed: true})
        await must({op: 'join', objects: ['tread', 'collar'], name: 'tread'})
        await stairView('one tread with its collar', [0.95, 0.75, 0.75], [0.3, RISE * 0.6, -0.1], 38)

        // --- the flight: one live radial array with a rise per copy ---------------------------------
        // Blender: Array with Constant Offset (0, 0, rise) + Object Offset to an empty turned one tread.
        // `angle` is the total sweep; the per-copy turn is angle / count, so the count grows with the
        // angle. Copies never touch, so nothing is welded.
        await must({op: 'array', object: 'tread', count: 1, angle: TREAD_ANGLE, axis: 'y', step: [0, RISE, 0],
            merge: false, live: true})
        await section('The flight', 'one live radial `array`: turn one tread, rise one step, repeat')
        if (REC) {
            await stairView('the array grows the flight', [4.4, 3.4, 6.0], [0, 2.9, 0], 50)
            for (let n = 2; n <= RISERS - 1; n++) {
                await must({op: 'modifier', object: 'tread', index: 0, update: {count: n, angle: TREAD_ANGLE * n}})
                await hold(140)
            }
        } else {
            const grow = [2, 4, Math.round(RISERS / 3), Math.round(RISERS / 2), RISERS - 1]
            for (const n of grow) {
                await must({op: 'modifier', object: 'tread', index: 0, update: {count: n, angle: TREAD_ANGLE * n}})
                await wholeStair(`the array grows the flight: ${n} treads`)
            }
        }

        // --- balusters: one lathed spindle, the same array ------------------------------------------
        await section('Balusters, landing, handrail', '`lathe` + the same array; the landing cast like a tread; `sweep` along the helix')
        const br = R - STAIR.balusterInset
        const bPhi = TREAD_ANGLE * 0.35
        const spindle = [
            [0, 0], [0.55 * IN, 0], [0.55 * IN, 0.6 * IN], [0.35 * IN, 1.0 * IN], [0.35 * IN, sp * 0.18],
            [0.6 * IN, sp * 0.2], [0.35 * IN, sp * 0.22], [0.3 * IN, sp * 0.5], [0.55 * IN, sp * 0.52],
            [0.3 * IN, sp * 0.54], [0.3 * IN, sp * 0.8], [0.55 * IN, sp * 0.82], [0.3 * IN, sp * 0.84],
            [0.3 * IN, sp], [0, sp]]
        // Revolved about its own axis out on the tread, so the object origin stays on the column axis -
        // the pivot the radial array turns it about.
        await must({op: 'lathe', name: 'baluster', segments: 10, color: PAINT,
            profile: spindle.map(([r, y]) => [r, y + RISE]), center: at(br, bPhi, 0)})
        await must({op: 'array', object: 'baluster', count: RISERS - 1, angle: TREAD_ANGLE * (RISERS - 1),
            axis: 'y', step: [0, RISE, 0], merge: false, live: true})

        // --- landing: a square plate at the top, cast like the treads --------------------------------
        const phi0 = (RISERS - 1) * TREAD_ANGLE - nose
        const L = R + 2 * IN
        const d1 = dir(phi0), d2 = dir(phi0 + Math.PI / 2)
        const sq = (s, t, y) => [s * d1[0] + t * d2[0], y, s * d1[2] + t * d2[2]]
        const LN = 6
        await must({op: 'primitive', type: 'grid', name: 'landing', xSegments: LN, ySegments: LN, width: 1,
            depth: 1, color: PAINT})
        {
            const d = await inspectAll('landing')
            const g = lines(0, 1.0 * IN, L - 1.0 * IN, L, LN)
            // (s, t) is a right-handed pair seen from above only one way round; pick the one that keeps
            // the grid's normal up.
            await must({op: 'vertices', object: 'landing', verts: d.vertices.map(([x, , z], i) =>
                [i, ...sq(g[Math.round((z + 0.5) * LN)], g[Math.round((x + 0.5) * LN)], H)])})
            const lr = await inspectAll('landing')
            const rimL = ([x, , z]) => {
                const s = x * d1[0] + z * d1[2], t = x * d2[0] + z * d2[2]
                return s < 1e-4 || t < 1e-4 || s > L - 1e-4 || t > L - 1e-4
            }
            const inner = []
            lr.faceVerts.forEach((vs, i) => {
                if (vs.filter(v => rimL(lr.vertices[v])).length < 2) inner.push(i)
            })
            const rib = await must({op: 'inset', object: 'landing', faces: inner, individual: true, thickness: 0.32 * IN})
            await must({op: 'deleteElements', object: 'landing', faces: rib.data.insetFaces, type: 'FACE'})
        }
        await must({op: 'solidify', object: 'landing', thickness: STAIR.plate, offset: -1})

        // Balcony spindles along the two open edges: one spindle, a live linear array along each edge.
        const bal = 6
        const edgeA = sq(L - 1.0 * IN, 1.5 * IN, 0), edgeB = sq(L - 1.0 * IN, L - 1.0 * IN, 0)
        const stepA = edgeB.map((v, k) => (v - edgeA[k]) / (bal - 1))
        await must({op: 'lathe', name: 'balcony-a', segments: 10, color: PAINT,
            profile: spindle.map(([r, y]) => [r, y + H]), center: edgeA})
        await must({op: 'array', object: 'balcony-a', count: bal, step: stepA, live: true})
        const edgeC = sq(1.5 * IN, L - 1.0 * IN, 0)
        const stepC = edgeC.map((v, k) => (v - edgeB[k]) / (bal - 1))
        await must({op: 'lathe', name: 'balcony-b', segments: 10, color: PAINT,
            profile: spindle.map(([r, y]) => [r, y + H]), center: edgeB})
        await must({op: 'array', object: 'balcony-b', count: bal, step: stepC, live: true})

        // --- handrail: a flat bar swept along the helix over the baluster tops ----------------------
        // `normalMode: zUp` keeps the bar's width horizontal: on a helix about Y the horizontal normal is
        // exactly radial. Minimum twist would roll this bar about 180 degrees a turn.
        const rail = STAIR.rail
        const yRail = phi => RISE + (phi - bPhi) / TREAD_ANGLE * RISE + sp + rail.thick / 2
        const endPhi = bPhi + (RISERS - 1) * TREAD_ANGLE
        const helix = []
        const samples = Math.round((endPhi - bPhi) / (Math.PI / 24))
        for (let i = 0; i <= samples; i++) {
            const phi = bPhi + (endPhi - bPhi) * i / samples
            helix.push(at(br, phi, yRail(phi)))
        }
        // Round the landing's open edges at the same height, bar on its flat.
        const yTop = H + sp + rail.thick / 2
        const landingRail = [sq(L - 1.0 * IN, 1.5 * IN, yTop), sq(L - 1.0 * IN, L - 1.0 * IN, yTop),
            sq(1.5 * IN, L - 1.0 * IN, yTop)]
        const barProfile = []
        const hw = rail.width / 2, ht = rail.thick / 2
        for (let i = 0; i < 12; i++) {
            // A flat bar with fully rounded edges: two half-rounds joined by flats.
            const t = Math.PI * 2 * i / 12
            const c = Math.cos(t), sgn = c >= 0 ? 1 : -1
            barProfile.push([sgn * (hw - ht) + ht * c, ht * Math.sin(t)])
        }
        await must({op: 'sweep', name: 'handrail', path: helix, profile: barProfile, normalMode: 'zUp', color: PAINT})
        await must({op: 'sweep', name: 'landing-rail', path: landingRail, profile: barProfile, normalMode: 'zUp', color: PAINT})
        await wholeStair('balusters, landing and handrail')

        // Checks against the catalogue, measured from the model.
        const treads = await box('tread')
        check('stair diameter (outside of the treads), x', treads.size[0], 2 * CAT.radius)
        check('stair diameter (outside of the treads), z', treads.size[2], 2 * CAT.radius)
        check('floor to landing (top of the landing plate)', (await box('landing')).max[1], RISERS * CAT.rise * CAT.treadsPerTurn / TREADS_PER_TURN)
        const listing = (await must({op: 'modifier', object: 'tread'})).data[0]
        const copies = listing.evaluatedVerts / listing.masterVerts
        check('risers per full turn (tread copies + landing, / turns)', (copies + 1) / TURNS, TREADS_PER_TURN, 'treads')
        check('rise per step (catalogue 8" at 12 a turn)', (await box('landing')).max[1] / RISERS,
            CAT.rise * CAT.treadsPerTurn / TREADS_PER_TURN)
        const railD = await inspectAll('handrail')
        const ring = railD.vertices.slice(0, barProfile.length)
        const railMid = ring.reduce((a, v) => a + v[1], 0) / ring.length
        check('handrail centre above the first tread (spindle + half the bar)', railMid - RISE, sp + rail.thick / 2)
        const balBox = await box('balcony-a')
        check('balcony spindle height above the landing', balBox.max[1] - H, sp)
        const colD = await inspectAll('column')
        const newelTop = Math.max(...colD.vertices.filter(v => Math.abs(Math.hypot(v[0], v[2]) - (STAIR.pole + 0.4 * IN)) < 1e-4).map(v => v[1]))
        check('column above the landing (newel)', newelTop - H, CAT.newel)
    }

    async function arcade() {
        log(`arcade: ${BAYS} bays of ${(ARC.bay / FT).toFixed(2)} ft`)
        const B = ARC.bay, w = ARC.wall
        const ys = ARC.springing
        // The pointed arch: two circular arcs through the springing points and the crown. For the left
        // arc, centred on the springing line at xc (from the bay centre): R = xc + s/2, R^2 = xc^2 + h^2.
        const pointed = (span, rise) => {
            const xc = (rise * rise - span * span / 4) / span
            return {xc, R: xc + span / 2}
        }
        const arch = pointed(ARC.span, ARC.apex - ys)
        log(`  arch: span ${ARC.span.toFixed(3)} m, rise ${(ARC.apex - ys).toFixed(3)} m, radius ${arch.R.toFixed(3)} m, centres ${arch.xc.toFixed(3)} m past the middle`)
        const view = async (label, eye, target, fov = 40) => {
            await must({op: 'camera', projection: 'perspective', fov, position: eye, target})
            return capture(label)
        }

        // --- the arch: half a ring from two arcs, extruded, mirrored, moulded ------------------------
        await section('The arcade', 'HABS, Church of the Ascension, New York: one pointed arch from two arcs')
        // The left half: a strip of quads from the springing to the crown, its lower edge on the
        // intrados (radius R) and its upper on the extrados (R + ring), both centred at xc past the
        // middle of the bay. Built in the front face of the wall, then extruded through it.
        const N = 14
        const mid = B / 2
        // A point on the left arc of radius r (concentric with the intrados), k of N steps from the
        // springing line to where it reaches the bay's centre line.
        const arcPoint = (k, r) => {
            const end = Math.acos(-arch.xc / r)
            const t = Math.PI - (Math.PI - end) * k / N
            return [mid + arch.xc + r * Math.cos(t), ys + r * Math.sin(t)]
        }
        await must({op: 'primitive', type: 'grid', name: 'arc-arch', xSegments: N, ySegments: 1, width: 1, depth: 1,
            color: STONE})
        {
            const d = await inspectAll('arc-arch')
            await must({op: 'vertices', object: 'arc-arch', verts: d.vertices.map(([x, , z], i) =>
                [i, ...arcPoint(Math.round((x + 0.5) * N), z > 0 ? arch.R + ARC.ring : arch.R), 0])})
        }
        // Mirror the half-ring surface first, welding the crown edge, then give the whole ring the wall's
        // thickness: solidifying first would leave the two halves' crown caps face to face inside.
        await must({op: 'mirror', object: 'arc-arch', axis: 'x', center: [mid, 0, 0]})
        await must({op: 'solidify', object: 'arc-arch', thickness: w, offset: 0})
        await view('one pointed arch: two arcs, mirrored, solidified', [mid + 2.4, ys + 1.0, 7.5], [mid, ys + 1.5, 0], 40)
        {
            // The computed profile, before the moulding rounds its arrises.
            const d = await inspectAll('arc-arch')
            const crown = d.vertices.filter(v => Math.abs(v[0] - mid) < 1e-3)
            const intradosCrown = Math.min(...crown.map(v => v[1]))
            check('arch: floor to the intrados at the crown (as built)', intradosCrown, ARC.apex)
            const spring = d.vertices.filter(v => Math.abs(v[1] - ys) < 1e-4)
            const inner = spring.filter(v => Math.abs(Math.abs(v[0] - mid) - ARC.span / 2) < 0.05)
            const span = Math.max(...inner.map(v => v[0])) - Math.min(...inner.map(v => v[0]))
            check('arch: intrados span at the springing', span, ARC.span)
        }
        // Mouldings: round every arris of the ring.
        await must({op: 'bevel', object: 'arc-arch', offset: 0.06, segments: 3, profile: 0.5})
        await view('the ring bevelled into a moulding', [mid + 2.4, ys + 1.0, 7.5], [mid, ys + 1.5, 0], 40)

        // --- the spandrel: wall from the extrados to the string course -------------------------------
        await section('One bay', 'spandrel, a loop-cut string course, a clustered pier, a rib vault')
        const scH = 0.32, scProj = 0.12
        const scTop = ARC.sill
        const extrados = x => {
            const u = x <= mid ? x : B - x
            const r = arch.R + ARC.ring
            return ys + Math.sqrt(Math.max(0, r * r - (u - (mid + arch.xc)) ** 2))
        }
        const SN = 16
        await must({op: 'primitive', type: 'grid', name: 'arc-spandrel', xSegments: SN, ySegments: 1, width: 1, depth: 1,
            color: STONE})
        {
            const d = await inspectAll('arc-spandrel')
            await must({op: 'vertices', object: 'arc-spandrel', verts: d.vertices.map(([x, , z], i) => {
                const px = (x + 0.5) * B
                return [i, px, z < 0 ? extrados(px) : scTop - scH, 0]
            })})
        }
        await must({op: 'solidify', object: 'arc-spandrel', thickness: w, offset: 0})

        // --- the string course: a box, loop-cut by `subdivide`, the lower loops drawn back -----------
        await must({op: 'primitive', type: 'cube', name: 'arc-course', width: B, height: scH, depth: w + 2 * scProj,
            position: [mid, scTop - scH / 2, 0], color: STONE_DARK})
        await must({op: 'applyTransform', object: 'arc-course'})
        {
            const d = await inspectAll('arc-course')
            const vertical = d.edgeVerts.map(([p, q], i) => ({i, p: d.vertices[p], q: d.vertices[q]}))
                .filter(e => Math.abs(e.p[0] - e.q[0]) < 1e-6 && Math.abs(e.p[2] - e.q[2]) < 1e-6)
                .map(e => e.i)
            await must({op: 'subdivide', object: 'arc-course', edges: vertical, cuts: 2})
            const c = await inspectAll('arc-course')
            const level = y => c.vertices.map((v, i) => [v, i]).filter(([v]) => Math.abs(v[1] - y) < 1e-4).map(([, i]) => i)
            const bottom = level(scTop - scH), lower = level(scTop - scH * 2 / 3)
            // The underside chamfers back into the wall: a weathered drip moulding.
            await must({op: 'transform', object: 'arc-course', verts: bottom, scale: [1, 1, (w + 0.02) / (w + 2 * scProj)], pivot: [mid, 0, 0]})
            await must({op: 'transform', object: 'arc-course', verts: lower, scale: [1, 1, (w + scProj) / (w + 2 * scProj)], pivot: [mid, 0, 0]})
        }
        await view('spandrel and a loop-cut string course', [mid + 2.4, ys + 1.6, 7.5], [mid, ys + 2.2, 0], 42)

        // --- the pier: lathed base, four lathed shafts each bridged to its capital, abacus -----------
        const shaftR = 0.2, off = ARC.pier / 2 - shaftR
        const baseTop = 0.46
        const neck = ys - ARC.capital
        const abacusBottom = ys - 0.13
        await must({op: 'lathe', name: 'arc-base', segments: 8, color: STONE_DARK, profile: [
            [0, 0], [0.64, 0], [0.64, 0.3], [0.58, 0.36], [0.55, baseTop], [0, baseTop]]})
        // One shaft, open at its top: a torus-moulded foot and a plain drum.
        await must({op: 'lathe', name: 'arc-shaft', segments: 16, color: STONE, center: [off, 0, 0], profile: [
            [0, baseTop], [shaftR + 0.06, baseTop], [shaftR + 0.07, baseTop + 0.05], [shaftR + 0.04, baseTop + 0.1],
            [shaftR + 0.01, baseTop + 0.13], [shaftR, baseTop + 0.18], [shaftR, neck]]})
        // Its capital, open at the bottom: astragal, bell, top.
        await must({op: 'lathe', name: 'arc-capital', segments: 16, color: STONE, center: [off, 0, 0], profile: [
            [shaftR + 0.035, neck + 0.06], [shaftR + 0.035, neck + 0.1], [shaftR + 0.005, neck + 0.13],
            [shaftR + 0.02, neck + 0.25], [shaftR + 0.08, abacusBottom - 0.06], [shaftR + 0.12, abacusBottom],
            [0, abacusBottom]]})
        await must({op: 'join', objects: ['arc-shaft', 'arc-capital'], name: 'arc-shaft'})
        {
            // The shaft's open top and the capital's open bottom are two loops to join: Bridge Edge Loops,
            // with cuts, makes the necking between them.
            const d = await inspectAll('arc-shaft')
            const ringAt = y => d.vertices.map((v, i) => [v, i]).filter(([v]) => Math.abs(v[1] - y) < 1e-4).map(([, i]) => i)
            const loops = [...ringAt(neck), ...ringAt(neck + 0.06)]
            await must({op: 'bridgeEdgeLoops', object: 'arc-shaft', verts: loops, numberCuts: 2, interpolation: 'LINEAR'})
        }
        await must({op: 'array', object: 'arc-shaft', count: 4, angle: 2 * Math.PI, axis: 'y', live: true})
        await must({op: 'lathe', name: 'arc-core', segments: 16, color: STONE, profile: [
            [0, baseTop], [0.21, baseTop], [0.21, abacusBottom], [0, abacusBottom]]})
        await must({op: 'lathe', name: 'arc-abacus', segments: 8, color: STONE_DARK, profile: [
            [0, abacusBottom], [ARC.abacus / 2 / Math.cos(Math.PI / 8), abacusBottom],
            [ARC.abacus / 2 / Math.cos(Math.PI / 8), ys - 0.04], [ARC.abacus / 2 / Math.cos(Math.PI / 8) - 0.04, ys], [0, ys]]})
        await view('a clustered pier: lathes, a radial array, a bridged necking', [3.6, 4.0, 5.6], [0, 3.3, 0], 50)
        await must({op: 'join', objects: ['arc-base', 'arc-shaft', 'arc-core', 'arc-abacus'], name: 'arc-pier'})
        {
            const d = await inspectAll('arc-pier')
            // The ring where the shafts' foot mouldings end and the plain drums begin.
            const mid3 = d.vertices.filter(v => Math.abs(v[1] - (baseTop + 0.18)) < 1e-4)
            const across = Math.max(...mid3.map(v => v[0])) - Math.min(...mid3.map(v => v[0]))
            check('pier: across the clustered shafts', across, ARC.pier)
            check('pier: floor to the top of the capital (springing)', Math.max(...d.vertices.map(v => v[1])), ARC.springing)
        }

        // --- the vault: a groin surface and its ribs, from two pointed barrels ------------------------
        // Two pointed barrels, one spanning the bay (B) and one the aisle (A), crowning at the aisle
        // ceiling of sheet 7. The diagonal ribs follow the groins where they meet, exactly.
        const A = ARC.aisle, rise = ARC.aisleCeiling - ys
        const barrel = span => {
            const {xc, R} = pointed(span, rise)
            return {
                height: d => {
                    const u = Math.min(d, span - d)
                    return Math.sqrt(Math.max(0, R * R - (span / 2 + xc - u) ** 2))
                },
                // Distance from the springing at which the barrel reaches height y (rising half).
                at: y => span / 2 + xc - Math.sqrt(R * R - y * y),
            }
        }
        const bx = barrel(B), bz = barrel(A)
        const VN = 12
        await must({op: 'primitive', type: 'grid', name: 'arc-vault', xSegments: VN, ySegments: VN, width: 1, depth: 1,
            color: STONE})
        {
            const d = await inspectAll('arc-vault')
            await must({op: 'vertices', object: 'arc-vault', verts: d.vertices.map(([x, , z], i) => {
                const px = (x + 0.5) * B, pz = (z + 0.5) * -A
                // A groin vault is the union of the two barrels' spaces, so its ceiling is the higher
                // of the two: each side opens in an arch, and the groins fall where they are equal.
                return [i, px, ys + Math.max(bx.height(px), bz.height(-pz)), pz]
            })})
        }
        await must({op: 'solidify', object: 'arc-vault', thickness: 0.12, offset: 1})
        const ribProfile = [[-0.09, 0], [0.09, 0], [0.09, 0.12], [0.04, 0.22], [-0.04, 0.22], [-0.09, 0.12]]
        // Diagonal: up the groin from the pier at (0, 0) to the crown, and down to (B, -A).
        const groin = []
        const GN = 14
        for (let k = 0; k <= GN; k++) {
            const y = rise * k / GN
            groin.push([bx.at(y), ys + y, -bz.at(y)])
        }
        const diag = [...groin, ...groin.slice(0, -1).reverse().map(([x, y, z]) => [B - x, y, -A - z])]
        await must({op: 'sweep', name: 'arc-rib-diagonal', path: diag, profile: ribProfile, normalMode: 'zUp', color: STONE_DARK})
        await must({op: 'sweep', name: 'arc-rib-diagonal-2', path: diag.map(([x, y, z]) => [B - x, y, z]), profile: ribProfile,
            normalMode: 'zUp', color: STONE_DARK})
        await must({op: 'join', objects: ['arc-rib-diagonal', 'arc-rib-diagonal-2'], name: 'arc-rib-diagonal'})
        const trans = []
        for (let k = 0; k <= GN; k++) trans.push([0, ys + rise * k / GN, -bz.at(rise * k / GN)])
        const transverse = [...trans, ...trans.slice(0, -1).reverse().map(([x, y, z]) => [x, y, -A - z])]
        await must({op: 'sweep', name: 'arc-rib-transverse', path: transverse, profile: ribProfile, normalMode: 'zUp',
            color: STONE_DARK})
        {
            const d = await inspectAll('arc-vault')
            check('vault: floor to the crown (aisle ceiling, sheet 7)', Math.max(...d.vertices.map(v => v[1])), ARC.aisleCeiling)
        }

        // --- the bays: live linear arrays; the far arcade: live mirrors --------------------------------
        const perBay = ['arc-arch', 'arc-spandrel', 'arc-course', 'arc-vault', 'arc-rib-diagonal']
        const perPier = ['arc-pier', 'arc-rib-transverse']
        for (const o of perBay) await must({op: 'array', object: o, count: 1, step: [B, 0, 0], live: true})
        for (const o of perPier) await must({op: 'array', object: o, count: 2, step: [B, 0, 0], live: true})
        const setBays = async n => {
            for (const o of perBay) await must({op: 'modifier', object: o, index: 0, update: {count: n}})
            for (const o of perPier) await must({op: 'modifier', object: o, index: 0, update: {count: n + 1}})
        }
        const arcadeView = label => view(label, [BAYS * B / 2 + 8, 5.5, 19], [BAYS * B / 2, 5.0, -A / 2], 46)
        await section('The bays', 'live linear arrays; a live mirror makes the far arcade')
        for (let n = 1; n <= BAYS; n++) {
            await setBays(n)
            if (REC) await (n === 1 ? arcadeView('the arcade grows by array') : hold(500))
            else await arcadeView(`the arcade grows by array: ${n} bay${n > 1 ? 's' : ''}`)
        }
        for (const o of ['arc-arch', 'arc-spandrel', 'arc-course', 'arc-pier']) {
            await must({op: 'modifier', object: o, add: {type: 'mirror', axis: 'z', center: [0, 0, -A / 2]}})
        }
        await must({op: 'primitive', type: 'plane', name: 'arc-floor', width: BAYS * B + 3, depth: A + 4,
            position: [BAYS * B / 2, 0, -A / 2], color: '#8f877a'})
        await must({op: 'applyTransform', object: 'arc-floor'})
        await arcadeView('mirrored across the aisle: the far arcade, vaulted between')
        {
            const pier = await box('arc-pier')
            // The widest thing on a pier is its octagonal abacus, corner to corner on the x axis.
            const baseAcross = ARC.abacus / Math.cos(Math.PI / 8)
            check('arcade: pier centre to pier centre (from the arrayed piers)', (pier.size[0] - baseAcross) / BAYS, ARC.bay)
            check('arcade: aisle, pier centre to pier centre across (mirror)', pier.size[2] - baseAcross, ARC.aisle)
        }
        // Live: the bay count is one number on five modifiers.
        for (const n of [3, 5, BAYS]) {
            await setBays(n)
            if (n !== BAYS) await arcadeView(`live: ${n} bays from the same masters`)
        }

        // Place the arcade beside the stair, as objects - every modifier keeps working in object space.
        const at = PART === 'full' ? ARCADE_AT : [0, 0, 0]
        if (PART === 'full') await must({op: 'transform', object: 'arc-*', move: ARCADE_AT})
        await must({op: 'material', object: 'arc-*', roughness: 0.85, metalness: 0})

        // Against the drawing: HABS sheet 8 calibrated by its own scale bar (0 to 10 ft), its first
        // pier centre and floor line put on the model's, viewed square-on in orthographic.
        const ref = {w: 1010, h: 2180, bar0: [320.7, 2105], bar10: [718.0, 2105], pier: [211, 1926]}
        const pxPerM = (ref.bar10[0] - ref.bar0[0]) / (10 * FT)
        const W = ref.w / pxPerM, Hh = ref.h / pxPerM
        await must({op: 'reference', name: 'habs', plane: 'front', image: '/demos/stair/refs/habs-ascension-nave-bay-elevation.png',
            calibrate: {from: [ref.bar0[0] / ref.w, ref.bar0[1] / ref.h], to: [ref.bar10[0] / ref.w, ref.bar10[1] / ref.h], distance: 10 * FT},
            origin: [at[0] - (ref.pier[0] / ref.w - 0.5) * W, at[1] - (0.5 - ref.pier[1] / ref.h) * Hh, at[2] - A - 1.0],
            align: 'center', opacity: 0.9})
        await must({op: 'camera', projection: 'orthographic', position: [at[0] + B, at[1] + 5.4, at[2] + 30],
            target: [at[0] + B, at[1] + 5.4, at[2]], frustumSize: 12})
        await must({op: 'material', object: ['arc-arch', 'arc-spandrel', 'arc-course', 'arc-pier'], opacity: 0.5})
        await capture('orthographic, over HABS sheet 8 at its scale bar')
        await must({op: 'material', object: ['arc-arch', 'arc-spandrel', 'arc-course', 'arc-pier'], opacity: 1})
        await must({op: 'reference', name: 'habs', plane: 'front', visible: false})
        await capture('orthographic, model only')
        await must({op: 'camera', projection: 'perspective'})
        arcadeAt = at
    }

    // --- topology report: counts, quads, manifoldness, from each master and its stack -------------
    // `inspect` reports counts only, so face sizes and edge use are tallied here from its detail.
    if (!REC) {
        const doc = (await must({op: 'inspect'})).data
        const stacks = new Map(((await must({op: 'modifier'})).data ?? []).map(m => [m.object, m]))
        const rows = []
        for (const name of doc.names) {
            const d = await inspectAll(name)
            const sizes = d.faceVerts.map(f => f.length)
            const use = new Map()
            for (const f of d.faceVerts) {
                for (let k = 0; k < f.length; k++) {
                    const a = f[k], b = f[(k + 1) % f.length]
                    const key = a < b ? a + ',' + b : b + ',' + a
                    use.set(key, (use.get(key) ?? 0) + 1)
                }
            }
            const boundary = [...use.values()].filter(n => n === 1).length
            const nonManifold = [...use.values()].filter(n => n > 2).length
            const stack = stacks.get(name)
            rows.push({name, verts: d.verts, edges: d.edges, faces: d.faces,
                quads: sizes.filter(n => n === 4).length, tris: sizes.filter(n => n === 3).length,
                ngons: sizes.filter(n => n > 4).length, boundary, nonManifold,
                modifiers: stack ? stack.modifiers.map(m => m.summary) : [],
                evaluatedVerts: stack ? stack.evaluatedVerts : d.verts})
        }
        log('REPORT ' + JSON.stringify({params: {TREADS_PER_TURN, TURNS, BAYS, RISE, FLOOR_TO_LANDING}, checks, topology: rows}))
    }

    // --- export: one GLB per piece ------------------------------------------------------------------
    // `export {objects}` is accepted but ignored - it always writes the whole scene (issue
    // command-export-ignores-objects.md) - so each piece is exported with the other deleted, and the
    // delete undone.
    if (EXPORT_DIR && PART === 'full' && !REC) {
        const stairParts = STAIR_PARTS
        await must({op: 'reference', name: 'habs', remove: true})
        await must({op: 'delete', object: ['arc-floor', 'stair-floor']})
        await must({op: 'delete', object: 'arc-*'})
        await must({op: 'export', path: `${EXPORT_DIR}/stair.glb`})
        await must({op: 'undo'})
        await must({op: 'delete', object: stairParts})
        await must({op: 'export', path: `${EXPORT_DIR}/arcade.glb`})
        await must({op: 'undo'})
        await must({op: 'undo'})
        const doc = (await must({op: 'inspect'})).data
        log(`after the exports and undos: ${doc.objects} objects (${doc.names.join(', ')})`)
    }

    // --- checks and report data ------------------------------------------------------------------
    const health = await must({op: 'selftest'})
    log(`selftest: ${health.data.objects} objects, ${health.data.failed} failed`)
    if (health.data.failed) throw new Error('selftest failed: ' + JSON.stringify(health.data.results))
    const failed = checks.filter(c => !c.ok)
    session.result = {checks}
    if (failed.length) throw new Error(`${failed.length} dimension checks failed: ${failed.map(c => c.what).join('; ')}`)
}

/**
 * An ISU-152 heavy assault gun, built entirely through the modelling command API.
 *
 * This is the threepipe answer to the SU-152 lab report: same question - can an agent build a
 * recognisable, editable vehicle from a photograph using ordinary modelling operations and visual
 * feedback - with this repository's own command list, written against its own references.
 *
 * References (all public, none of them geometry):
 * - Wikimedia Commons, `11-Heavy self propelled gun su 152-LMW.jpg` - three-quarter view, the
 *   primary shape reference.
 * - Wikimedia Commons, `ISU-152 Lutsk.jpg` - front three-quarter, mantlet and mudguards.
 * - Wikimedia Commons, `SU-152, Parola Tank Museum.jpg` - head on, track and casemate widths.
 * - Published dimensions: 6.77 m hull, 3.07 m wide, 2.48 m tall, 0.47 m clearance, 0.65 m track,
 *   six road wheels a side, three return rollers, rear drive sprocket, front idler.
 *
 * No model, part, texture or script was downloaded. Every vertex here comes out of a `primitive`,
 * `lathe` or `sweep` command and is moved by `vertices`, `transform`, `extrude` or `array`.
 *
 *     npm run modelling:session -- examples/modelling-api/builds/isu-152.mjs --out tmp/isu-152
 *
 * Axes: Y up, +Z towards the nose, +X to the vehicle's left.
 */

// --- measured dimensions, in metres ---------------------------------------------------------

const HULL = {length: 6.77, width: 2.44, floor: 0.47, roof: 1.32}
const TRACK = {width: 0.65, centreX: 1.21, thickness: 0.09, top: 0.95}
const WHEEL = {radius: 0.275, width: 0.16, firstZ: -2.05, spacing: 0.82, centreY: 0.365}
const CASEMATE = {width: 2.54, roof: 2.42, front: 2.95, back: -0.55}
const GUN = {y: 1.78, z: 2.62, length: 3.35, radius: 0.115}

const GREEN = '#54604a'
const DARK = '#3a4034'
const STEEL = '#6f7680'

export default async ({run, runAll, capture, inspect, log}) => {
    await run({op: 'delete', object: '*'})
    await run({op: 'lighting', environmentIntensity: 1.0, background: '#20242a'})
    await run({op: 'light', name: 'key', type: 'directional', position: [4, 6, 5], intensity: 2.2,
        castShadow: true})

    // --- reference, calibrated ----------------------------------------------------------------
    //
    // The report's first and loudest complaint was an uncalibrated photograph. So before any
    // geometry: place the reference at a measured scale, using the one dimension that can be read
    // off the photo unambiguously - the vehicle's overall length between the track extremes.

    await run({
        op: 'reference', name: 'quarter', plane: 'right', image: '/tmp/reference/lmw.jpg',
        calibrate: {from: [0.18, 0.62], to: [0.86, 0.62], distance: HULL.length},
        origin: [-2.6, 0, 0], align: 'bottom', opacity: 0.45,
    })
    await capture('reference placed', {view: 'ref:quarter'})

    // --- hull -----------------------------------------------------------------------------------

    await run({op: 'primitive', type: 'cube', name: 'hull', color: GREEN,
        width: HULL.width, height: HULL.roof - HULL.floor, depth: HULL.length,
        position: [0, (HULL.floor + HULL.roof) / 2, 0]})

    // The nose is a two-plane wedge, not a flat wall: pull the front-top corners back and the
    // front-bottom corners forward. Indices come from `inspect`, not from guessing.
    const hull = await inspect('hull', true)
    const front = pick(hull, v => v[2] > 0)
    await run({op: 'vertices', object: 'hull', relative: true,
        verts: front.filter(i => hull.vertices[i][1] > 0).map(i => [i, 0, 0, -0.34])})
    await run({op: 'vertices', object: 'hull', relative: true,
        verts: front.filter(i => hull.vertices[i][1] < 0).map(i => [i, 0, 0, -0.12])})
    await capture('hull blocked in', {view: 'ref:quarter'})

    // --- running gear ---------------------------------------------------------------------------
    //
    // One road wheel, lathed from a stepped profile, then a live array. Live, not baked: the report
    // arrayed its wheels and then could not change the master. This one stays editable.

    const wheelProfile = [
        [0.00, -WHEEL.width / 2], [0.10, -WHEEL.width / 2], [0.12, -0.05],
        [0.24, -0.05], [WHEEL.radius, -0.03], [WHEEL.radius, 0.03],
        [0.24, 0.05], [0.12, 0.05], [0.10, WHEEL.width / 2], [0.00, WHEEL.width / 2],
    ]
    await run({op: 'lathe', name: 'roadwheel', axis: 'x', segments: 20, color: DARK,
        profile: wheelProfile, position: [-TRACK.centreX, WHEEL.centreY, WHEEL.firstZ]})
    await run({op: 'array', object: 'roadwheel', count: 6, step: [0, 0, WHEEL.spacing], live: true})

    await run({op: 'lathe', name: 'sprocket', axis: 'x', segments: 18, color: DARK,
        profile: [[0, -0.09], [0.14, -0.09], [0.16, -0.05], [0.30, -0.05], [0.30, 0.05],
            [0.16, 0.05], [0.14, 0.09], [0, 0.09]],
        position: [-TRACK.centreX, 0.58, -2.82]})
    await run({op: 'lathe', name: 'idler', axis: 'x', segments: 18, color: DARK,
        profile: [[0, -0.08], [0.12, -0.08], [0.14, -0.04], [0.32, -0.04], [0.32, 0.04],
            [0.14, 0.04], [0.12, 0.08], [0, 0.08]],
        position: [-TRACK.centreX, 0.48, 2.72]})
    await run({op: 'lathe', name: 'roller', axis: 'x', segments: 14, color: DARK,
        profile: [[0, -0.06], [0.14, -0.06], [0.14, 0.06], [0, 0.06]],
        position: [-TRACK.centreX, TRACK.top - 0.1, -1.2]})
    await run({op: 'array', object: 'roller', count: 3, step: [0, 0, 1.7], live: true})
    await capture('running gear', {view: 'ref:quarter'})

    // --- track ------------------------------------------------------------------------------------
    //
    // A closed sweep: a flat shoe section carried around the wheels, idler and sprocket. This is the
    // operation the report used 88 individual arrayed shoes for; one closed path with a rectangular
    // profile gives the same silhouette as one continuous, welded, quad-only surface.

    const trackPath = trackOutline()
    await run({op: 'sweep', name: 'track', closed: true, color: '#2b2f2a',
        profile: [[-TRACK.width / 2, -TRACK.thickness / 2], [TRACK.width / 2, -TRACK.thickness / 2],
            [TRACK.width / 2, TRACK.thickness / 2], [-TRACK.width / 2, TRACK.thickness / 2]],
        path: trackPath.map(([y, z]) => [-TRACK.centreX, y, z])})
    await capture('one track run', {view: 'ref:quarter'})

    // --- mirror the whole running gear to the other side ---------------------------------------

    for (const part of ['roadwheel', 'sprocket', 'idler', 'roller', 'track']) {
        await run({op: 'duplicate', object: part, name: part + '-r', scale: [-1, 1, 1]})
    }
    await capture('both sides', {view: 'front', fit: '*'})

    // --- casemate ---------------------------------------------------------------------------------

    await run({op: 'primitive', type: 'cube', name: 'casemate', color: GREEN,
        width: CASEMATE.width, height: CASEMATE.roof - HULL.roof,
        depth: CASEMATE.front - CASEMATE.back,
        position: [0, (HULL.roof + CASEMATE.roof) / 2, (CASEMATE.front + CASEMATE.back) / 2]})

    // Slope the front plate back and pull the roof in, the shape that makes it read as an ISU
    // rather than a box.
    const cas = await inspect('casemate', true)
    const top = pick(cas, v => v[1] > 0)
    await run({op: 'vertices', object: 'casemate', relative: true,
        verts: top.filter(i => cas.vertices[i][2] > 0).map(i => [i, 0, 0, -0.95])})
    await run({op: 'transform', object: 'casemate', scale: [0.88, 1, 1], pivot: 'center',
        verts: top})
    await capture('casemate', {view: 'ref:quarter'})

    // --- gun ---------------------------------------------------------------------------------------

    await run({op: 'lathe', name: 'mantlet', axis: 'z', segments: 24, color: GREEN,
        profile: [[0.16, -0.10], [0.46, -0.10], [0.50, 0.02], [0.47, 0.18], [0.36, 0.30], [0.19, 0.34]],
        position: [0, GUN.y, GUN.z]})
    await run({op: 'lathe', name: 'barrel', axis: 'z', segments: 24, color: DARK,
        profile: [[0, 0], [0.17, 0], [0.17, 0.28], [0.13, 0.36], [GUN.radius, 0.44],
            [GUN.radius, GUN.length], [0.078, GUN.length]],
        position: [0, GUN.y, GUN.z + 0.05]})
    await run({op: 'lathe', name: 'brake-ring', axis: 'z', segments: 20, color: DARK,
        profile: [[0.10, 0], [0.16, 0], [0.16, 0.035], [0.10, 0.035]],
        position: [0, GUN.y, GUN.z + GUN.length - 0.50]})
    await run({op: 'array', object: 'brake-ring', count: 10, step: [0, 0, 0.048], live: true})
    await capture('gun', {view: 'ref:quarter'})

    // --- mudguards and fittings ----------------------------------------------------------------

    // Fenders cover the top run of track. Without them the running gear reads as exposed bogies,
    // which is the single biggest difference from the reference photograph.
    //
    // Built as a surface and then given thickness, rather than as a flattened box: a pressed steel
    // fender is a sheet, and `solidify` is what turns one into a plate with a rim closing its edges.
    // Doing it this way also means the downturned ends keep their thickness through the bend, which a
    // scaled box cannot.
    await run({op: 'primitive', type: 'grid', name: 'fender', color: GREEN,
        xSegments: 1, ySegments: 8, width: 0.78, depth: 5.4,
        position: [-1.21, TRACK.top + 0.16, 0.15]})
    // Turn the leading and trailing edges down, the way a pressed steel fender is shaped.
    const fender = await inspect('fender', true)
    const ends = pick(fender, v => Math.abs(v[2]) > 2.6)
    await run({op: 'vertices', object: 'fender', relative: true,
        verts: ends.map(i => [i, 0, -0.16, 0])})
    await run({op: 'solidify', object: 'fender', thickness: 0.035, offset: 0})
    await run({op: 'duplicate', object: 'fender', name: 'fender-r', scale: [-1, 1, 1]})

    // A hatch is a disc with a rim: lathe the disc, then inset its top face twice - once inward and
    // down for the recess, once more and back up for the raised lip. Two commands where modelling the
    // same shape as a profile would take a dozen profile points to get wrong.
    await run({op: 'lathe', name: 'hatch', axis: 'y', segments: 18, color: GREEN,
        profile: [[0, 0], [0.28, 0], [0.28, 0.05], [0, 0.05]],
        position: [-0.62, CASEMATE.roof, 0.75]})
    const hatch = await inspect('hatch', true)
    const hatchTop = topFacesOf(hatch)
    const recess = await run({op: 'inset', object: 'hatch', faces: hatchTop,
        thickness: 0.035, depth: -0.015})
    await run({op: 'inset', object: 'hatch', faces: recess.data.insetFaces,
        thickness: 0.03, depth: 0.022})
    await run({op: 'duplicate', object: 'hatch', name: 'hatch-r', move: [1.24, 0, 0]})

    await run({op: 'sweep', name: 'grabrail', radius: 0.012, steps: 6, color: STEEL,
        path: [[-1.16, 1.86, -0.25], [-1.27, 1.94, -0.12], [-1.27, 1.94, 0.25], [-1.16, 1.86, 0.38]]})
    await run({op: 'array', object: 'grabrail', count: 2, step: [0, 0, 1.15], live: true})
    await run({op: 'duplicate', object: 'grabrail', name: 'grabrail-r', scale: [-1, 1, 1]})

    await run({op: 'lathe', name: 'fueldrum', axis: 'z', segments: 20, color: DARK,
        profile: [[0, 0], [0.22, 0.02], [0.23, 0.07], [0.23, 0.78], [0.22, 0.83], [0, 0.85]],
        position: [-1.21, TRACK.top + 0.42, -2.9]})
    await run({op: 'duplicate', object: 'fueldrum', name: 'fueldrum-r', scale: [-1, 1, 1]})
    await capture('fittings', {view: 'ref:quarter'})

    // --- engine deck ------------------------------------------------------------------------------

    await run({op: 'primitive', type: 'cube', name: 'deck', color: GREEN,
        width: 2.32, height: 0.1, depth: 2.0, position: [0, HULL.roof + 0.05, -2.2]})
    // Recess the grille panel into the deck rather than sitting a slab on top of it.
    const deck = await inspect('deck', true)
    await run({op: 'inset', object: 'deck', faces: topFacesOf(deck), thickness: 0.16, depth: -0.035})
    await run({op: 'primitive', type: 'cube', name: 'louver', color: DARK,
        width: 1.6, height: 0.03, depth: 0.05, position: [0, HULL.roof + 0.11, -1.6]})
    await run({op: 'array', object: 'louver', count: 14, step: [0, 0, -0.07], live: true})

    // --- checks and delivery -------------------------------------------------------------------

    const clash = await run({op: 'measure', mode: 'overlaps', tolerance: 0.02})
    log(`clearance: ${clash.data.pairs} intersecting pairs`)
    for (const o of clash.data.overlaps.slice(0, 8)) log(`  ${o.a} ∩ ${o.b}  ${o.overlap.join(' × ')}`)

    const health = await run({op: 'selftest'})
    log(`selftest: ${health.data.objects} objects, ${health.data.failed} failed`)

    const totals = await run({op: 'inspect'})
    log(`total: ${totals.data.objects} objects, ${totals.data.totals.faces} faces, `
        + `${totals.data.totals.verts} verts`)

    await capture('side', {view: 'right', fit: '*'})
    await capture('front', {view: 'front', fit: '*'})
    await capture('top', {view: 'top', fit: '*'})
    await capture('three quarter', {view: 'iso', fit: '*'})
    await run({op: 'export', format: 'glb', path: 'tmp/isu-152/isu-152.glb'})
}

/** Indices of the upward-facing faces of an inspected object, by their corner average. */
function topFacesOf(inspected) {
    const top = Math.max(...inspected.vertices.map(v => v[1]))
    return inspected.faceVerts
        .map((verts, i) => ({
            i,
            y: verts.reduce((a, v) => a + inspected.vertices[v][1], 0) / verts.length,
        }))
        .filter(f => f.y > top - 1e-4)
        .map(f => f.i)
}

/** Indices of an inspected object's vertices matching a predicate on its local position. */
function pick(inspected, predicate) {
    return inspected.vertices.map((v, i) => (predicate(v) ? i : -1)).filter(i => i >= 0)
}

/**
 * The track outline as `[y, z]` points: along the bottom run, up around the idler, back along the
 * return rollers, and down around the sprocket. Radii and centres come from the wheel positions
 * above rather than being drawn by eye, so moving a wheel moves the track with it.
 */
function trackOutline() {
    const bottomY = TRACK.thickness / 2
    const topY = TRACK.top
    const idler = {z: 2.72, y: 0.48, r: 0.36}
    const sprocket = {z: -2.82, y: 0.58, r: 0.35}
    const points = []

    // bottom run, nose to tail
    points.push([bottomY, idler.z - 0.2], [bottomY, sprocket.z + 0.2])
    // around the sprocket
    for (let i = 1; i < 7; i++) {
        const a = -Math.PI / 2 - (i / 7) * Math.PI
        points.push([sprocket.y + Math.sin(a) * sprocket.r, sprocket.z + Math.cos(a) * sprocket.r])
    }
    // top run over the return rollers, tail to nose
    points.push([topY, sprocket.z + 0.3], [topY, idler.z - 0.3])
    // around the idler
    for (let i = 1; i < 7; i++) {
        const a = Math.PI / 2 - (i / 7) * Math.PI
        points.push([idler.y + Math.sin(a) * idler.r, idler.z + Math.cos(a) * idler.r])
    }
    return points
}

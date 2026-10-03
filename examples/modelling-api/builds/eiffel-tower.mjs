/**
 * The Eiffel Tower, to scale, built entirely through the modelling command API.
 *
 * Every dimension below is from Eiffel's own drawings ("La tour de trois cents mètres", 1900), E.
 * Monod's 1890 panel diagram, or the operator's published figures. The sources, and which numbers are
 * readings or approximations, are in `eiffel-tower.md` beside this file.
 *
 *     npm run modelling:session -- examples/modelling-api/builds/eiffel-tower.mjs --out tmp/eiffel/build
 *
 * The references are expected under `tmp/eiffel/references/` (see the README for how to fetch them).
 *
 * Axes: Y up, metres, origin on the ground at the centre of the tower. The four faces are the planes
 * x = ±O(y) and z = ±O(y). The pier this script models directly is the one on the +x/+z diagonal;
 * the other three are live mirrors of it.
 *
 * How it is built. The tower is a wrought-iron lattice, so almost nothing here is a solid:
 *
 * - **Cages.** Each pier, the shaft above the second floor, and the arches start as a polygon *cage* -
 *   one quad per panel face, the same panels Eiffel numbered 1 to 29. A cage is a square `plane`
 *   pushed up panel by panel with `extrude`, each step moving the cap along the measured centreline and
 *   scaling it to the measured width, so every ring sits exactly on a panel line of the drawing.
 * - **Bracing.** `poke` puts both diagonals in every panel - a St Andrew's cross with a node where they
 *   meet - and a live `wireframe` modifier turns every edge of the cage into a strut. Editing the cage
 *   moves the lattice with it.
 * - **Symmetry.** One pier is modelled; `mirror` modifiers on x and z make the other three. Members
 *   that repeat round the shaft use a live radial `array`.
 * - **Columns.** The four corner members (arbalétriers) of each pier are solid tapered boxes, extruded
 *   through the same panel lines as the cage, because on the real tower they are plated box girders.
 */

// --- measured data ----------------------------------------------------------------------------

/**
 * The panel lines: height above the ground (m) and the full width between the axes of the outer
 * corner members (m). Line 0 is the centre of the stone bearings ("centre des sommiers", cote 36.00);
 * lines 1-29 are the bottoms of Eiffel's panels 1-29; the last entry is the third floor.
 * Heights: Weidman & Pinelis 2004 Table 1 panel heights from z = 6.40 (checked against Monod and the
 * floor cotes). Widths: Monod 1890 up to line 12, Weidman & Pinelis above (they agree there).
 */
const Z = [2.5, 6.4, 17.4, 28.4, 39.4, 50.4, 57.4, 68.4, 79.4, 90.4, 100.6, 110.6, 115.5, 126.8,
    137.5, 148.1, 158.6, 169.1, 179.1, 189.1, 198.7, 207.79, 216.38, 224.52, 232.21, 239.49, 246.38,
    252.9, 259.06, 264.9, 276.13]
const W = [116.40, 112.487, 101.427, 90.368, 79.309, 68.25, 62.195, 55.30, 48.95, 43.20, 38.32,
    33.67, 31.70, 28.64, 25.76, 23.57, 21.58, 20.00, 18.49, 17.39, 16.45, 15.57, 14.73, 13.94, 13.19,
    12.48, 11.81, 11.17, 10.57, 10.00, 10.00]
const LINE = {firstFloor: 6, secondFloor: 12, merge: 18}

const FLOOR = {first: 57.63, second: 115.73, third: 276.13}
const TOP = {lantern: 300.51, antenna: 330.0}
const BASE = {side: 124.90, pier: 25.33}
/** Each pier is a box 15.00 m between its corner-member axes up to the first floor, 10.41 m at the second. */
const PIER = {base: 15.00, second: 10.41}
/** Decorative arches: 74 m across, springing at the bearings, crown about 39.4 m. */
const ARCH = {radius: 37.0, spring: 2.5, depth: 3.2, thickness: 1.0}
const PLATFORM = {first: 70.69, second: 40.96, third: 18.65}

const IRON = '#5e4a3a'
const IRON_DARK = '#4f3e31'
const STONE = '#b7ab98'

/** Half the outer-axis width at height `y`, by straight lines between panel lines. */
function O(y) {
    if (y <= Z[0]) return W[0] / 2 + (Z[0] - y) * (W[0] - W[1]) / 2 / (Z[1] - Z[0])
    for (let i = 1; i < Z.length; i++) {
        if (y <= Z[i]) return (W[i - 1] + (W[i] - W[i - 1]) * (y - Z[i - 1]) / (Z[i] - Z[i - 1])) / 2
    }
    return W[W.length - 1] / 2
}

/** Pier width (between corner-member axes) at `y`: 15 m to the first floor, then straight to 10.41. */
function pierWidth(y) {
    const y1 = Z[LINE.firstFloor], y2 = Z[LINE.secondFloor]
    if (y <= y1) return PIER.base
    return PIER.base + (PIER.second - PIER.base) * Math.min(1, (y - y1) / (y2 - y1))
}

/**
 * Where the inner face-column of a pier sits across a face above the second floor: the two piers on a
 * face converge until their inner columns meet at line 18 (Monod; Eiffel Pl. I figs. 4-5).
 */
function faceColumn(y) {
    const y2 = Z[LINE.secondFloor], ym = Z[LINE.merge]
    const start = O(y2) - PIER.second
    return Math.max(0, start * (ym - y) / (ym - y2))
}

// --- helpers --------------------------------------------------------------------------------

const range = (a, b) => Array.from({length: b - a}, (_, i) => a + i)

export default async ({run, capture, log, page}) => {
    /** Run and insist: a build that silently skips a failed step is not a build. */
    const must = async command => {
        const r = await run(command)
        if (!r.ok) throw new Error(`${command.op} failed: ${r.error}`)
        return r
    }

    /** Make a horizontal square `plane` of `size` and move its vertices to `centre`. */
    const square = async (name, size, centre, color = IRON) => {
        await must({op: 'primitive', type: 'plane', name, width: size, depth: size, color})
        // Move the geometry, not the object: mirror and radial modifiers work about the object origin,
        // which has to stay at the tower axis.
        await must({op: 'transform', object: name, faces: [0], move: centre})
    }

    /**
     * Push `faces` up through the given rings. Each ring is `{y, cx, cz, size}`: the cap is moved to
     * the ring's centre and scaled to its size, about its own centre - one `extrude` per ring.
     */
    const stack = async (name, faces, rings) => {
        for (let i = 1; i < rings.length; i++) {
            const a = rings[i - 1], b = rings[i]
            const r = await must({op: 'extrude', object: name, faces,
                direction: [b.cx - a.cx, b.y - a.y, b.cz - a.cz], distance: 1,
                scale: [b.size / a.size, 1, b.size / a.size]})
            faces = r.data.capFaces
        }
        return faces
    }

    // `inspect` lists 400 elements by default; these meshes are small, but not that small.
    const inspectAll = name => must({op: 'inspect', object: name, detail: true, limit: 100000})
        .then(r => r.data)

    /** Indices of the horizontal faces of an object lying at its lowest and highest y. */
    const capsOf = async name => {
        const d = await inspectAll(name)
        const ys = d.vertices.map(v => v[1])
        const lo = Math.min(...ys), hi = Math.max(...ys)
        return d.faceVerts
            .map((verts, i) => ({i, ys: verts.map(v => d.vertices[v][1])}))
            .filter(f => f.ys.every(y => Math.abs(y - lo) < 1e-3) || f.ys.every(y => Math.abs(y - hi) < 1e-3))
            .map(f => f.i)
    }
    /** Open the ends of a cage, poke every panel, and hang a live wireframe on it. */
    const lattice = async (name, thickness, mirrors = []) => {
        await must({op: 'deleteElements', object: name, faces: await capsOf(name), type: 'FACE'})
        await must({op: 'poke', object: name})
        for (const axis of mirrors) await must({op: 'modifier', object: name, add: {type: 'mirror', axis}})
        await must({op: 'wireframe', object: name, thickness, offset: 0, live: true})
    }

    /**
     * A band round the tower: an `n` x `n` grid at the first ring, its whole region extruded through
     * the rings, the caps removed. What is left is the outer surface of the band, `n` faces per side
     * per ring - the cells of a lattice girder, or the bays of a frieze.
     */
    const band = async (name, n, rings, color = IRON) => {
        await must({op: 'primitive', type: 'grid', name, xSegments: n, ySegments: n,
            width: rings[0].size, depth: rings[0].size, color})
        await must({op: 'transform', object: name, faces: range(0, n * n), move: [rings[0].cx, rings[0].y, rings[0].cz]})
        await stack(name, range(0, n * n), rings)
        await must({op: 'deleteElements', object: name, faces: await capsOf(name), type: 'FACE'})
    }
    const flat = (y, size) => ({y, cx: 0, cz: 0, size})
    const onFaces = (y, extra = 0) => flat(y, 2 * O(y) + extra)

    /** Indices of an object's faces that are not horizontal - the sides of a box. */
    const sidesOf = async name => {
        const d = await inspectAll(name)
        return d.faceVerts
            .map((verts, i) => ({i, ys: verts.map(v => d.vertices[v][1])}))
            .filter(f => Math.max(...f.ys) - Math.min(...f.ys) > 1e-3)
            .map(f => f.i)
    }

    /** A floor: a square slab with a square hole, `thickness` deep below `y`. */
    const deck = async (name, y, outer, inner, thickness, color = IRON_DARK) => {
        await square(name, outer, [0, y, 0], color)
        const r = await must({op: 'inset', object: name, faces: [0], thickness: (outer - inner) / 2})
        await must({op: 'deleteElements', object: name, faces: r.data.insetFaces, type: 'FACE'})
        await must({op: 'solidify', object: name, thickness, offset: -1})
    }

    /** A railing: a ring of bays, each bay's edges a rail or a baluster. */
    const railing = async (name, y, side, bays, height = 1.1) => {
        await band(name, bays, [flat(y, side), flat(y + height, side)], IRON_DARK)
        await must({op: 'wireframe', object: name, thickness: 0.07, offset: 0, live: true})
    }

    /**
     * Curved brackets: a quarter-ellipse from `inner` (vertical there) to `outer` (horizontal there),
     * in the plane through `along`, swept with a rectangular section.
     */
    /** Brackets are deepest where they leave the structure and taper to their tip: a curve radius per point. */
    const taper = (from, to, steps = 10) => range(0, steps + 1).map(i => from + (to - from) * i / steps)
    const bracketPath = (from, to, steps = 10) => range(0, steps + 1).map(i => {
        const t = (Math.PI / 2) * i / steps
        const k = 1 - Math.cos(t)
        return [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * Math.sin(t),
            from[2] + (to[2] - from[2]) * k]
    })

    await must({op: 'delete', object: '*'})
    await must({op: 'lighting', environmentIntensity: 0.8, background: '#cfd8e2'})
    await must({op: 'light', name: 'sun', type: 'directional', position: [180, 320, 260], intensity: 2.6})

    // --- references ---------------------------------------------------------------------------
    //
    // Monod's elevation is the one drawing with a width at every panel line. Calibrate it vertically
    // on the tower axis, line 1 (z = 6.40) to the third floor (z = 276.13) - pixels 2460 and 369 of
    // its 1257 x 2637 scan - and register it so that line 1 sits at its real height.
    const MONOD = {px: [1257, 2637], axis: 611, line1: 2460, third: 369}
    const ref = await must({
        op: 'reference', name: 'monod', plane: 'front',
        image: '/tmp/eiffel/references/eiffel-diagram-elevation-1to1200-exterior-widths-monod-1890.jpg',
        calibrate: {from: [MONOD.axis / MONOD.px[0], MONOD.line1 / MONOD.px[1]],
            to: [MONOD.axis / MONOD.px[0], MONOD.third / MONOD.px[1]], distance: FLOOR.third - Z[1]},
        opacity: 0.55,
    })
    const mPerPx = ref.data.height / MONOD.px[1]
    await must({op: 'reference', name: 'monod', plane: 'front', origin: [
        -(MONOD.axis - MONOD.px[0] / 2) * mPerPx,
        Z[1] + (MONOD.line1 - MONOD.px[1] / 2) * mPerPx,
        -80,
    ]})
    log(`monod reference: ${ref.data.width.toFixed(2)} x ${ref.data.height.toFixed(2)} m, `
        + `${(1 / mPerPx).toFixed(3)} px/m`)

    // --- masonry plinths ----------------------------------------------------------------------
    // Four 25.33 m squares whose outer corners make the 124.90 m base square, up to the bearings.
    const plinthC = BASE.side / 2 - BASE.pier / 2
    await must({op: 'primitive', type: 'cube', name: 'plinth', width: BASE.pier, depth: BASE.pier,
        height: Z[0], color: STONE})
    await must({op: 'transform', object: 'plinth', faces: range(0, 6), move: [plinthC, Z[0] / 2, plinthC]})
    await must({op: 'modifier', object: 'plinth', add: {type: 'mirror', axis: 'x'}})
    await must({op: 'modifier', object: 'plinth', add: {type: 'mirror', axis: 'z'}})

    // --- the piers, bearings to the second floor -----------------------------------------------
    const pierRings = range(0, LINE.secondFloor + 1).map(i => {
        const s = pierWidth(Z[i])
        const c = O(Z[i]) - s / 2
        return {y: Z[i], cx: c, cz: c, size: s}
    })
    await square('pier', PIER.base, [pierRings[0].cx, Z[0], pierRings[0].cz])
    await stack('pier', [0], pierRings)
    await lattice('pier', 1.1, ['x', 'z'])
    await capture('pier lattice', {view: 'iso', fit: '*'})

    // The four arbalétriers: four squares at the pier's corners, extruded as one region through the
    // same rings, so their spacing follows the pier and their section tapers with it.
    const COLUMN = 2.2
    await square('pier-columns', COLUMN, [pierRings[0].cx - PIER.base / 2, Z[0], pierRings[0].cz - PIER.base / 2],
        IRON_DARK)
    await must({op: 'array', object: 'pier-columns', count: 2, step: [PIER.base, 0, 0], merge: false})
    await must({op: 'array', object: 'pier-columns', count: 2, step: [0, 0, PIER.base], merge: false})
    await stack('pier-columns', [0, 1, 2, 3], pierRings)
    await must({op: 'modifier', object: 'pier-columns', add: {type: 'mirror', axis: 'x'}})
    await must({op: 'modifier', object: 'pier-columns', add: {type: 'mirror', axis: 'z'}})
    await capture('piers', {view: 'front', fit: '*'})

    // --- the shaft, second floor to third ---------------------------------------------------------
    //
    // Panels 12-17: on each face the two piers' outer faces carry on and converge, so each face has
    // three strips - pier, the narrowing gap, pier - until the inner columns meet at line 18.
    const lowerRings = range(LINE.secondFloor, LINE.merge + 1).map(i => ({y: Z[i], cx: 0, cz: 0, size: W[i]}))
    await must({op: 'primitive', type: 'grid', name: 'shaft-lower', xSegments: 3, ySegments: 3,
        width: W[LINE.secondFloor], depth: W[LINE.secondFloor], color: IRON})
    await must({op: 'transform', object: 'shaft-lower', faces: range(0, 9), move: [0, Z[LINE.secondFloor], 0]})
    await stack('shaft-lower', range(0, 9), lowerRings)
    await must({op: 'deleteElements', object: 'shaft-lower', faces: await capsOf('shaft-lower'), type: 'FACE'})
    {
        // Put every ring's two inner vertices per face on the converging columns.
        const d = await inspectAll('shaft-lower')
        const moves = []
        d.vertices.forEach(([x, y, z], i) => {
            const o = O(y), f = faceColumn(y)
            const onX = Math.abs(Math.abs(x) - o) < 1e-3, onZ = Math.abs(Math.abs(z) - o) < 1e-3
            if (onZ && !onX) moves.push([i, Math.sign(x) * f, y, z])
            else if (onX && !onZ) moves.push([i, x, y, Math.sign(z) * f])
        })
        await must({op: 'vertices', object: 'shaft-lower', verts: moves})
        // At line 18 the two inner columns of a face are one: weld them.
        await must({op: 'weld', object: 'shaft-lower', distance: 1e-3})
    }
    await must({op: 'poke', object: 'shaft-lower'})
    await must({op: 'wireframe', object: 'shaft-lower', thickness: 0.8, offset: 0, live: true})

    // Panels 18-29: one box, each face split down the middle by the merged columns.
    const upperRings = range(LINE.merge, Z.length).map(i => ({y: Z[i], cx: 0, cz: 0, size: W[i]}))
    await must({op: 'primitive', type: 'grid', name: 'shaft-upper', xSegments: 2, ySegments: 2,
        width: W[LINE.merge], depth: W[LINE.merge], color: IRON})
    await must({op: 'transform', object: 'shaft-upper', faces: range(0, 4), move: [0, Z[LINE.merge], 0]})
    await stack('shaft-upper', range(0, 4), upperRings)
    await lattice('shaft-upper', 0.6)

    // Shaft columns: the corner member carries on from the pier's outer column; a radial array puts
    // it on all four corners.
    const shaftColumn = y => 1.5 - 0.6 * (y - Z[LINE.secondFloor]) / (FLOOR.third - Z[LINE.secondFloor])
    const cornerRings = range(LINE.secondFloor, Z.length).map(i =>
        ({y: Z[i], cx: O(Z[i]), cz: O(Z[i]), size: shaftColumn(Z[i])}))
    await square('shaft-corner', cornerRings[0].size, [cornerRings[0].cx, cornerRings[0].y, cornerRings[0].cz],
        IRON_DARK)
    await stack('shaft-corner', [0], cornerRings)
    await must({op: 'array', object: 'shaft-corner', count: 4, angle: Math.PI * 2, axis: 'y', pivot: [0, 0, 0],
        merge: false, live: true})

    // Converging face columns, panels 12-17: one, arrayed round the shaft, mirrored across each face.
    const faceRings = range(LINE.secondFloor, LINE.merge + 1).map(i =>
        ({y: Z[i], cx: faceColumn(Z[i]), cz: O(Z[i]), size: shaftColumn(Z[i])}))
    await square('shaft-face', faceRings[0].size, [faceRings[0].cx, faceRings[0].y, faceRings[0].cz], IRON_DARK)
    await stack('shaft-face', [0], faceRings)
    await must({op: 'array', object: 'shaft-face', count: 4, angle: Math.PI * 2, axis: 'y', pivot: [0, 0, 0],
        merge: false, live: true})
    await must({op: 'modifier', object: 'shaft-face', add: {type: 'mirror', axis: 'x'}})

    // The merged face columns, panels 18-29, down the middle of each face.
    const midRings = range(LINE.merge, Z.length).map(i => ({y: Z[i], cx: 0, cz: O(Z[i]), size: shaftColumn(Z[i])}))
    await square('shaft-mid', midRings[0].size, [0, midRings[0].y, midRings[0].cz], IRON_DARK)
    await stack('shaft-mid', [0], midRings)
    await must({op: 'array', object: 'shaft-mid', count: 4, angle: Math.PI * 2, axis: 'y', pivot: [0, 0, 0],
        merge: false, live: true})
    await capture('shaft', {view: 'front', fit: '*'})

    // --- decorative arches ------------------------------------------------------------------------
    //
    // A 74 m semicircle springing at the bearings, lying on the sloping outer face of the piers. The
    // section is a box 3.2 m deep and 1 m thick, poked and wireframed into the arch's openwork.
    const archPath = range(0, 41).map(i => {
        const t = Math.PI * i / 40
        const y = ARCH.spring + ARCH.radius * Math.sin(t)
        return [ARCH.radius * Math.cos(t), y, O(y)]
    })
    await must({op: 'sweep', name: 'arch', path: archPath, capEnds: false, color: IRON,
        profile: [[0, -ARCH.thickness / 2], [ARCH.depth, -ARCH.thickness / 2],
            [ARCH.depth, ARCH.thickness / 2], [0, ARCH.thickness / 2]]})
    await must({op: 'poke', object: 'arch'})
    await must({op: 'wireframe', object: 'arch', thickness: 0.3, offset: 0, boundary: true})
    await must({op: 'array', object: 'arch', count: 4, angle: Math.PI * 2, axis: 'y', pivot: [0, 0, 0],
        merge: false, live: true})
    await capture('arches', {view: 'front', fit: '*'})


    // --- first floor ----------------------------------------------------------------------------
    //
    // Under the floor, on every face, a lattice girder two cells deep runs right across the tower in
    // the plane of the faces (Monod's cross-hatched panel 5; the photograph from the Champ de Mars).
    // Above it, the plain frieze carrying the 72 names, then the floor and its railing.
    await band('girder-1', 16, [onFaces(46.5), onFaces(49.75), onFaces(53.0)])
    await must({op: 'poke', object: 'girder-1'})
    await must({op: 'wireframe', object: 'girder-1', thickness: 0.55, offset: 0, live: true})

    await band('frieze-1', 18, [flat(53.0, 69.0), flat(57.4, 69.0)])
    await must({op: 'inset', object: 'frieze-1', individual: true, thickness: 0.35, depth: -0.25})
    await must({op: 'solidify', object: 'frieze-1', thickness: 0.8, offset: -1})
    // Between the arch and the girder, a row of openings that grows towards the legs: a strip whose
    // lower edge lies on the arch's extrados and upper edge on the girder's underside, every bay
    // inset and its middle removed.
    {
        const bays = 20, half = 30, top = 46.5, extrados = ARCH.radius + ARCH.depth
        await must({op: 'primitive', type: 'grid', name: 'arcade-1', xSegments: bays, ySegments: 1,
            width: 2 * half, depth: 1, color: IRON})
        const d = await inspectAll('arcade-1')
        // The grid lies flat with its rows at z = -0.5 and +0.5: send the first to the arch, the
        // second to the girder, both onto the sloping face.
        await must({op: 'vertices', object: 'arcade-1', verts: d.vertices.map(([x, , z], i) => {
            const y = z < 0 ? ARCH.spring + Math.sqrt(extrados * extrados - x * x) : top
            return [i, x, y, O(y)]
        })})
        const ins = await must({op: 'inset', object: 'arcade-1', individual: true, thickness: 0.45})
        await must({op: 'deleteElements', object: 'arcade-1', faces: ins.data.insetFaces, type: 'FACE'})
        await must({op: 'solidify', object: 'arcade-1', thickness: 0.6, offset: 0})
        await must({op: 'array', object: 'arcade-1', count: 4, angle: Math.PI * 2, axis: 'y', pivot: [0, 0, 0],
            merge: false, live: true})
    }
    await deck('deck-1', FLOOR.first, PLATFORM.first, 30.0, 0.5)
    // The glazed pavilions along the platform edge and the canopy over them.
    await deck('pavilions-1', FLOOR.first + 4.0, PLATFORM.first - 5.0, PLATFORM.first - 15.0, 4.0, '#46535a')
    await must({op: 'material', object: 'pavilions-1', roughness: 0.12, metalness: 0.6})
    await deck('canopy-1', FLOOR.first + 5.0, PLATFORM.first + 0.6, PLATFORM.first - 15.0, 0.6)
    await railing('railing-1', FLOOR.first, PLATFORM.first - 0.3, 48)
    await capture('first floor', {view: 'front', fit: ['girder-1', 'frieze-1', 'deck-1', 'arch']})

    // --- second floor ---------------------------------------------------------------------------
    // The girder of panel 11 and the lower belt at the foot of panel 10, both lattice; the overhanging
    // platform with its fascia on curved brackets.
    await band('girder-2', 8, [onFaces(110.6), onFaces(113.05), onFaces(115.5)])
    await band('belt-2', 8, [onFaces(100.6), onFaces(103.6)])
    for (const name of ['girder-2', 'belt-2']) {
        await must({op: 'poke', object: name})
        await must({op: 'wireframe', object: name, thickness: 0.35, offset: 0, live: true})
    }
    await band('fascia-2', 12, [flat(111.5, PLATFORM.second), flat(FLOOR.second + 0.3, PLATFORM.second)])
    await must({op: 'inset', object: 'fascia-2', individual: true, thickness: 0.25, depth: -0.15})
    await must({op: 'solidify', object: 'fascia-2', thickness: 0.5, offset: -1})
    // Unlike the first floor, the second is floored right across (the view from below shows it).
    await square('deck-2', PLATFORM.second, [0, FLOOR.second, 0], IRON_DARK)
    await must({op: 'solidify', object: 'deck-2', thickness: 0.4, offset: -1})
    await railing('railing-2', FLOOR.second + 0.3, PLATFORM.second - 0.2, 28)
    await deck('pavilions-2', FLOOR.second + 4.0, PLATFORM.second - 4.0, PLATFORM.second - 12.0, 3.7, '#46535a')
    await must({op: 'material', object: 'pavilions-2', roughness: 0.12, metalness: 0.6})
    // Brackets from the shaft face under the fascia, eleven to a side.
    await must({op: 'sweep', name: 'brackets-2', color: IRON_DARK,
        path: bracketPath([-17, 110.0, O(110.0) + 0.4], [-17, FLOOR.second - 0.5, PLATFORM.second / 2 - 0.5]),
        profile: [[-0.15, -0.3], [0.15, -0.3], [0.15, 0.3], [-0.15, 0.3]], radii: taper(1.4, 0.7)})
    await must({op: 'array', object: 'brackets-2', count: 11, step: [3.4, 0, 0], merge: false, live: true})
    await must({op: 'array', object: 'brackets-2', count: 4, angle: Math.PI * 2, axis: 'y', pivot: [0, 0, 0],
        merge: false, live: true})
    await capture('second floor', {view: 'iso', fit: ['girder-2', 'fascia-2', 'deck-2', 'brackets-2']})

    // --- intermediate platform (panel 19-20) ------------------------------------------------------
    const yMid = 194.5
    await deck('deck-mid', yMid, 2 * O(yMid) + 2.4, 2 * O(yMid) - 1.0, 0.3)
    await railing('railing-mid', yMid, 2 * O(yMid) + 2.2, 12, 1.0)

    // --- third floor and summit -----------------------------------------------------------------
    //
    // The cabin sits on eight curved consoles that flare out of panel 29 - four at the corners, four
    // mid-face. Above it the open upper deck, the campanile lattice, the lantern and the mast.
    const cabin = PLATFORM.third
    await must({op: 'sweep', name: 'consoles-mid', color: IRON_DARK,
        path: bracketPath([0, 266.0, 5.0], [0, FLOOR.third - 0.2, cabin / 2 - 0.4]),
        profile: [[-0.15, -0.8], [0.15, -0.8], [0.15, 0.8], [-0.15, 0.8]], radii: taper(1.3, 0.6)})
    await must({op: 'sweep', name: 'consoles-corner', color: IRON_DARK,
        path: bracketPath([5.0, 266.0, 5.0], [cabin / 2 - 0.4, FLOOR.third - 0.2, cabin / 2 - 0.4]),
        profile: [[-0.18, -1.0], [0.18, -1.0], [0.18, 1.0], [-0.18, 1.0]], radii: taper(1.3, 0.6)})
    for (const name of ['consoles-mid', 'consoles-corner']) {
        await must({op: 'array', object: name, count: 4, angle: Math.PI * 2, axis: 'y', pivot: [0, 0, 0],
            merge: false, live: true})
    }
    // A closed box with a row of eight windows a side: the grid's region extruded, the sides inset.
    await must({op: 'primitive', type: 'grid', name: 'cabin', xSegments: 8, ySegments: 8, width: cabin,
        depth: cabin, color: IRON})
    await must({op: 'transform', object: 'cabin', faces: range(0, 64), move: [0, FLOOR.third, 0]})
    await stack('cabin', range(0, 64), [flat(FLOOR.third, cabin), flat(279.11, cabin)])
    await must({op: 'inset', object: 'cabin', faces: await sidesOf('cabin'), individual: true,
        thickness: 0.35, depth: -0.2})
    await deck('deck-3', 279.11 + 0.3, cabin + 1.0, 0.5, 0.3)
    await railing('railing-3', 279.41, cabin + 0.8, 14, 1.2)

    // Above the cabin: the enclosed top level and, where the 1889 lantern stood, today's stepped
    // equipment decks round a lattice core up to the 300.51 m terrace, then the mast as it has stood
    // since the 2022 DAB antenna: 330 m to the tip. (Massing from photographs; no drawing found.)
    await must({op: 'primitive', type: 'grid', name: 'top-block', xSegments: 4, ySegments: 4, width: 11.0,
        depth: 11.0, color: IRON})
    await must({op: 'transform', object: 'top-block', faces: range(0, 16), move: [0, 279.41, 0]})
    await stack('top-block', range(0, 16), [flat(279.41, 11.0), flat(283.6, 10.2)])
    await must({op: 'inset', object: 'top-block', faces: await sidesOf('top-block'), individual: true,
        thickness: 0.3, depth: -0.15})
    await railing('fence-3', 279.41, cabin + 0.6, 20, 2.4)
    await square('campanile', 8.6, [0, 283.6, 0])
    await stack('campanile', [0], [flat(283.6, 8.6), flat(289.3, 7.2), flat(294.8, 5.4),
        flat(TOP.lantern - 0.3, 3.6)])
    await lattice('campanile', 0.45)
    await deck('equipment-deck-1', 289.3, 13.0, 0.5, 0.35)
    await deck('equipment-deck-2', 294.8, 9.0, 0.5, 0.3)
    await railing('equipment-rail-1', 289.3, 12.6, 12, 1.2)
    await railing('equipment-rail-2', 294.8, 8.6, 8, 1.2)
    await deck('terrace', TOP.lantern, 4.4, 0.5, 0.3)
    await must({op: 'lathe', name: 'antenna', axis: 'y', segments: 12, color: '#8a8f94',
        profile: [[0, TOP.lantern], [0.6, TOP.lantern], [0.6, 312.0], [0.4, 312.0], [0.4, 324.0],
            [0.18, 324.0], [0.1, TOP.antenna], [0, TOP.antenna]]})
    await capture('summit', {view: 'iso', fit: ['cabin', 'campanile', 'top-block', 'consoles-corner']})

    // --- checks: the model against the numbers it was built from -----------------------------------
    //
    // Measured from the finished model, not restated from the constants. Any miss throws, so a build
    // that has drifted from the drawing fails rather than producing a plausible-looking tower.
    const health = await run({op: 'selftest'})
    log(`selftest: ${health.data.objects} objects, ${health.data.failed} failed`)
    if (health.data.failed) throw new Error('selftest failed')

    const checks = []
    const expect = (what, got, want, tol) => {
        checks.push({what, got: +got.toFixed(3), want, ok: Math.abs(got - want) <= tol})
        log(`  ${Math.abs(got - want) <= tol ? 'ok  ' : 'FAIL'} ${what}: ${got.toFixed(3)} m (expected ${want} ±${tol})`)
    }
    const world = (await must({op: 'inspect'})).data.bounds
    const box = async name => (await must({op: 'measure', object: name, mode: 'bounds'})).data[0]
    /** Max |x| (axis-aligned half-width) of an object's master vertices lying at height `y`. */
    const halfWidthAt = async (name, y) => {
        const d = await inspectAll(name)
        const at = d.vertices.filter(v => Math.abs(v[1] - y) < 1e-3)
        if (!at.length) throw new Error(`${name} has no vertices at y = ${y}`)
        return {max: Math.max(...at.map(v => Math.abs(v[0]))), min: Math.min(...at.map(v => Math.abs(v[0])))}
    }
    expect('overall height, ground to antenna tip', world.max[1] - world.min[1], TOP.antenna, 0.01)
    expect('top of the lantern terrace', (await box('terrace')).max[1], TOP.lantern, 0.01)
    const plinths = await box('plinth')
    expect('base square (outer edges of the plinths), x', plinths.size[0], BASE.side, 0.01)
    expect('base square, z', plinths.size[2], BASE.side, 0.01)
    expect('clear gap between the plinths', 2 * (await halfWidthAt('plinth', 0)).min, 74.24, 0.01)
    const bearings = await halfWidthAt('pier', Z[0])
    expect('outer column axes at the bearings (half)', bearings.max, 58.20, 0.01)
    expect('pier box at the bearings', bearings.max - bearings.min, PIER.base, 0.01)
    expect('pier centre-square at the bearings (half)', (bearings.max + bearings.min) / 2, 50.70, 0.01)
    const atFirst = await halfWidthAt('pier', Z[LINE.firstFloor])
    expect('outer width at line 6, under the first floor', 2 * atFirst.max, 62.195, 0.01)
    const atSecond = await halfWidthAt('pier', Z[LINE.secondFloor])
    expect('shaft width at the second floor (line 12)', 2 * atSecond.max, 31.70, 0.01)
    expect('pier width at the second floor', atSecond.max - atSecond.min, PIER.second, 0.01)
    // Every panel line, not only the floors: the extrusions must land the cage on the drawing's
    // polyline everywhere.
    let worst = {line: 0, dev: -1}
    for (let i = 0; i < Z.length; i++) {
        const name = i <= LINE.secondFloor ? 'pier' : i <= LINE.merge ? 'shaft-lower' : 'shaft-upper'
        const dev = Math.abs(2 * (await halfWidthAt(name, Z[i])).max - W[i])
        if (dev > worst.dev) worst = {line: i, dev}
    }
    expect(`worst outer width over all ${Z.length} panel lines (line ${worst.line})`, worst.dev, 0, 0.01)
    const atThird = await halfWidthAt('shaft-upper', FLOOR.third)
    expect('shaft width at the third floor', 2 * atThird.max, 10.00, 0.01)
    expect('first floor level', (await box('deck-1')).max[1], FLOOR.first, 0.01)
    expect('first floor platform side', (await box('deck-1')).size[0], PLATFORM.first, 0.01)
    expect('second floor level', (await box('deck-2')).max[1], FLOOR.second, 0.01)
    expect('second floor platform side', (await box('deck-2')).size[0], PLATFORM.second, 0.01)
    expect('third floor level (cabin floor)', (await box('cabin')).min[1], FLOOR.third, 0.01)
    const arch = await inspectAll('arch')
    const crown = Math.min(...arch.vertices.filter(v => Math.abs(v[0]) < 0.5 && v[1] > 30).map(v => v[1]))
    // Monod's crown is 39.4 m; the struts' underside sits a few tenths below the swept intrados.
    expect('arch crown, underside of the struts', crown, 39.4, 0.3)
    const failed = checks.filter(c => !c.ok)
    if (failed.length) throw new Error(`${failed.length} dimension checks failed: ${failed.map(c => c.what).join('; ')}`)

    const counts = await page.evaluate(() => {
        let triangles = 0, meshes = 0
        window.viewer.scene.modelRoot.traverse(o => {
            if (!o.isMesh || o.userData.__isReferencePlane || !o.visible) return
            meshes++
            const g = o.geometry
            triangles += (g.index ? g.index.count : g.attributes.position.count) / 3
        })
        return {triangles, meshes}
    })
    const doc = (await must({op: 'inspect'})).data
    log(`model: ${doc.objects} objects, ${counts.meshes} meshes, ${counts.triangles} triangles rendered; `
        + `masters ${doc.totals.verts} verts / ${doc.totals.faces} faces`)
    await capture('front', {view: 'front', fit: '*'})
    await capture('iso', {view: 'iso', fit: '*'})

    // --- against the drawing, orthographic ------------------------------------------------------
    await must({op: 'camera', projection: 'orthographic', view: 'ref:monod'})
    await capture('ortho over monod')
    await must({op: 'reference', name: 'monod', plane: 'front', visible: false})
    await capture('ortho model only')
    await must({op: 'reference', name: 'monod', plane: 'front', visible: true})
    await must({op: 'reference', name: 'monod', plane: 'front', visible: false})
    await must({op: 'camera', view: 'front', fit: '*', padding: 1.03})
    await capture('ortho front, whole')

    // --- views matching the photographs ------------------------------------------------------------
    await must({op: 'camera', projection: 'perspective', fov: 30,
        position: [0, 1.7, 640], target: [0, 150, 0]})
    await capture('front from the champ de mars')
    const az = 20 * Math.PI / 180
    await must({op: 'camera', fov: 21, position: [1100 * Math.sin(az), 12, 1100 * Math.cos(az)],
        target: [0, 160, 0]})
    await capture('three-quarter from pont de bir-hakeim')
    await must({op: 'camera', fov: 75, position: [0, 1.7, 0], target: [0, 300, 0.5]})
    await capture('from below, through the centre')
    await must({op: 'camera', fov: 50, position: [0, 22, 150], target: [0, 42, 0]})
    await capture('first floor and arch')
    await must({op: 'camera', fov: 35, position: [75, 88, 100], target: [0, 112, 0]})
    await capture('second floor')
    await must({op: 'camera', fov: 30, position: [55, 255, 70], target: [0, 280, 0]})
    await capture('summit')
}

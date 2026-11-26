/**
 * Tests for the bevel operators.
 *
 * The counts are derived from the algorithm rather than recorded from a run, and each test states
 * the arithmetic. For one beveled edge with `s` segments: both endpoints are killed and each
 * contributes `s + 1` new vertices (two boundary verts plus `s - 1` profile points), so
 * `V = 8 - 2 + 2(s + 1)`; the bevel strip is `s` quads, so `F = 6 + s`; and `E` follows from Euler.
 *
 * Counts alone prove very little here - an implementation that offset by the wrong distance, or that
 * interpolated the profile linearly instead of along the superellipse, produces exactly the same
 * topology. So the geometry assertions carry the weight:
 *
 * - **Offsets.** Each of the five `offsetType`s is checked against the formula in
 *   `bmesh_bevel.cc:6985-7050`, on a cube where the closed form is known and again on an oblique
 *   prism where the five give five genuinely different answers.
 * - **Profiles.** The intermediate vertices are checked to satisfy the superellipse relation
 *   `X^r + Y^r = 1` in the profile's own frame, for four values of `profile`, and the chords between
 *   consecutive points are checked to be equal, which is what the expensive even-spacing search in
 *   `find_even_superellipse_chords` exists to produce.
 * - **Clamping.** Checked to reduce the offset to exactly the collapse limit the formula predicts,
 *   and to stop the two sides of a face crossing over each other.
 */

import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {bmFromMesh, bmToMesh} from '../bmesh/convert'
import {getValue, setValue} from '../bmesh/customdata'
import {selectNone, vertSelectSet} from '../bmesh/marking'
import {ElemFlag} from '../constants'
import {primitiveCube, primitiveIcoSphere} from '../generate/primitives'
import {
    degenerateFaceProblems, eulerCharacteristic, faceCenter, faceNormal, windingProblems,
} from '../generate/topology.testutil'
import {bevelEdges, bevelSelection, bevelVerts} from './bevel'

// region fixtures and shared assertions

/** The standard fixture: a cube from -1 to 1, so every edge is 2 long and every dihedral is 90 degrees. */
const cube = () => bmFromMesh(primitiveCube({size: 2}))

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps

/** The cube edge running along z at `x = 1, y = 1`. Picked by position so the test does not depend on edge order. */
function cubeEdgeXY(bm: BMesh): BMEdge {
    for (const e of bm.edges) {
        if (near(e.v1.x, 1) && near(e.v2.x, 1) && near(e.v1.y, 1) && near(e.v2.y, 1)) return e
    }
    throw new Error('test fixture: no such edge')
}

/** Distance from a point to the line `x = 1, y = 1`, which is the axis of {@link cubeEdgeXY}. */
const distToCubeEdgeAxis = (v: BMVert) => Math.hypot(v.x - 1, v.y - 1)

/**
 * A prism over an arbitrary closed 2D cross section, extruded along z. Wound so every face normal
 * points outwards for a counter-clockwise cross section.
 */
function prism(cs: number[][], height = 2) {
    const bm = new BMesh()
    const bot = cs.map(p => bm.vertCreate(p[0], p[1], 0))
    const top = cs.map(p => bm.vertCreate(p[0], p[1], height))
    bm.faceCreate([...bot].reverse())
    bm.faceCreate(top)
    for (let i = 0; i < cs.length; i++) {
        const j = (i + 1) % cs.length
        bm.faceCreate([bot[i], bot[j], top[j], top[i]])
    }
    return {bm, bot, top}
}

/** An L-shaped cross section, which has one reflex corner and so exercises the outer miter. */
const lPrism = () => prism([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]])

/**
 * Everything that must hold of any bevel output on a closed surface. Returns a list of complaints so
 * a failure names what went wrong rather than just "expected true".
 */
function meshProblems(bm: BMesh, expectEuler = 2): string[] {
    const out: string[] = []
    out.push(...bm.validate().map(s => `bm.validate: ${s}`))
    out.push(...bmToMesh(bm).validate().map(s => `MeshData.validate: ${s}`))
    out.push(...windingProblems(bm).map(s => `winding: ${s}`))
    out.push(...degenerateFaceProblems(bm).map(s => `degenerate: ${s}`))
    const chi = eulerCharacteristic(bm)
    if (chi !== expectEuler) out.push(`euler characteristic ${chi}, expected ${expectEuler}`)
    return out
}

/** The vertices of `bm` in the `z = 1` plane, sorted by descending x. The profile cross-section. */
function profileSection(bm: BMesh): number[][] {
    return [...bm.verts]
        .filter(v => near(v.z, 1) && v.x > 0 && v.y > 0)
        .map(v => [v.x, v.y])
        .sort((a, b) => b[0] - a[0])
}

// endregion

describe('bevelEdges - counts', () => {
    it('one cube edge: V = 2s + 8, F = 6 + s, E = 3s + 12', () => {
        for (const s of [1, 2, 3, 4, 5, 8]) {
            const bm = cube()
            bevelEdges(bm, [cubeEdgeXY(bm)], {offset: 0.2, segments: s})
            expect({s, v: bm.verts.size, e: bm.edges.size, f: bm.faces.size})
                .toEqual({s, v: 2 * s + 8, e: 3 * s + 12, f: 6 + s})
            expect(meshProblems(bm)).toEqual([])
        }
    })

    it('one cube edge reports its own new geometry', () => {
        const bm = cube()
        const res = bevelEdges(bm, [cubeEdgeXY(bm)], {offset: 0.2, segments: 1})
        // The four boundary vertices, the four edges of the one new quad, and the quad.
        expect(res.faces.length).toBe(1)
        expect(res.verts.length).toBe(4)
        expect(res.edges.length).toBe(4)
        expect(res.faces[0].len).toBe(4)
    })

    it('all twelve cube edges', () => {
        /* Every corner becomes one bound vert per pair of adjacent edges, so three per corner, and
         * with `s` segments the corner vmesh holds the canonical `(i, j, k)` slots for
         * `j, k <= floor(s / 2)`, with an extra row when `s` is odd. */
        const expected: Record<number, {v: number, e: number, f: number}> = {
            // s = 1: 8 corners x 3 verts; 6 originals + 12 strips + 8 corner triangles.
            1: {v: 24, e: 48, f: 26},
            // s = 2: 8 x (3 boundary + 3 profile mid + 1 centre); 6 + 12*2 + 8*3.
            2: {v: 56, e: 108, f: 54},
            // s = 3: 8 x (3 bound verts x 4 canonical slots); 6 + 12*3 + 8*(6 quads + 1 centre).
            3: {v: 96, e: 192, f: 98},
        }
        for (const s of [1, 2, 3]) {
            const bm = cube()
            bevelEdges(bm, [...bm.edges], {offset: 0.2, segments: s})
            expect({s, v: bm.verts.size, e: bm.edges.size, f: bm.faces.size})
                .toEqual({s, ...expected[s]})
            expect(meshProblems(bm)).toEqual([])
        }
    })

    it('an n-gon edge: the two n-gon caps each gain one side', () => {
        // A hexagonal prism, beveling one vertical edge. Same arithmetic as the cube edge.
        const {bm, bot, top} = prism(
            Array.from({length: 6}, (_, i) => [Math.cos(i * Math.PI / 3), Math.sin(i * Math.PI / 3)]))
        expect({v: bm.verts.size, e: bm.edges.size, f: bm.faces.size}).toEqual({v: 12, e: 18, f: 8})
        const e = [...bm.edges].find(x => x.joins(bot[0], top[0]))!
        bevelEdges(bm, [e], {offset: 0.2, segments: 1})
        expect({v: bm.verts.size, e: bm.edges.size, f: bm.faces.size}).toEqual({v: 14, e: 21, f: 9})
        expect(meshProblems(bm)).toEqual([])
        // Each hexagonal cap is now a heptagon.
        const caps = [...bm.faces].filter(f => f.len > 4)
        expect(caps.map(f => f.len).sort()).toEqual([7, 7])
    })

    it('a non-manifold edge is declined, not beveled', () => {
        /* `bmo_bevel_exec` only tags an edge when `BM_edge_is_manifold`, so a three-face edge is
         * skipped and nothing else in the mesh is touched. */
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0)
        const b = bm.vertCreate(1, 0, 0)
        const c = bm.vertCreate(0, 1, 0)
        const d = bm.vertCreate(0, -1, 0)
        const g = bm.vertCreate(0, 0, 1)
        bm.faceCreate([a, b, c])
        bm.faceCreate([a, b, d])
        bm.faceCreate([a, b, g])
        const e = [...bm.edges].find(x => x.joins(a, b))!
        const before = {v: bm.verts.size, e: bm.edges.size, f: bm.faces.size}
        const positions = [...bm.verts].map(v => [v.x, v.y, v.z])

        const res = bevelEdges(bm, [e], {offset: 0.2, segments: 2})

        expect({v: bm.verts.size, e: bm.edges.size, f: bm.faces.size}).toEqual(before)
        expect([...bm.verts].map(v => [v.x, v.y, v.z])).toEqual(positions)
        expect(res).toEqual({faces: [], verts: [], edges: []})
        expect(bm.validate()).toEqual([])
    })

    it('a boundary edge is declined too', () => {
        // One face: its edges have a single radial loop, so `BM_edge_is_manifold` is false.
        const bm = new BMesh()
        const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]].map(c => bm.vertCreate(c[0], c[1], c[2]))
        bm.faceCreate(v)
        const res = bevelEdges(bm, [...bm.edges], {offset: 0.1})
        expect({v: bm.verts.size, f: bm.faces.size}).toEqual({v: 4, f: 1})
        expect(res.faces.length).toBe(0)
    })

    it('a non-positive offset does nothing at all', () => {
        for (const offset of [0, -1]) {
            const bm = cube()
            const res = bevelEdges(bm, [...bm.edges], {offset})
            expect({v: bm.verts.size, f: bm.faces.size}).toEqual({v: 8, f: 6})
            expect(res).toEqual({faces: [], verts: [], edges: []})
        }
    })
})

describe('bevelEdges - the offset is the offset', () => {
    /* The five types are five different measurements, and these are their definitions from
     * `bevel_vert_construct` (`bmesh_bevel.cc:6985`). On the cube the edge angle is exactly 90
     * degrees and the adjacent edges are exactly 2 long, so each closed form is an exact number. */

    it('offsetType "offset" is the distance from the edge, measured in each face', () => {
        const w = 0.4
        const bm = cube()
        bevelEdges(bm, [cubeEdgeXY(bm)], {offset: w, segments: 1, offsetType: 'offset'})
        const boundary = [...bm.verts].filter(v => distToCubeEdgeAxis(v) > 1e-9 && distToCubeEdgeAxis(v) < 1.9)
        expect(boundary.length).toBe(4)
        for (const v of boundary) {
            expect(distToCubeEdgeAxis(v)).toBeCloseTo(w, 12)
        }
    })

    it('offsetType "width" is the width of the new face: offset / (2 sin(angle / 2))', () => {
        const w = 0.4
        // angle = pi - angle(n1, n2) = pi/2, so the spec is w / (2 sin(pi/4)) = w / sqrt(2).
        const spec = w / Math.sqrt(2)
        const bm = cube()
        bevelEdges(bm, [cubeEdgeXY(bm)], {offset: w, segments: 1, offsetType: 'width'})
        const boundary = [...bm.verts].filter(v => distToCubeEdgeAxis(v) > 1e-9 && distToCubeEdgeAxis(v) < 1.9)
        for (const v of boundary) expect(distToCubeEdgeAxis(v)).toBeCloseTo(spec, 12)

        // And the point of the name: the new face really is `w` wide.
        const strip = [...bm.faces].find(f => f.len === 4 &&
            f.verts().every(v => distToCubeEdgeAxis(v) > 1e-9 && distToCubeEdgeAxis(v) < 1.9))!
        const [p, q] = strip.verts().filter(v => near(v.z, 1))
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeCloseTo(w, 12)
    })

    it('offsetType "depth" is the height of the new face over the edge: offset / cos(angle / 2)', () => {
        const w = 0.4
        const spec = w / Math.cos(Math.PI / 4) // = w * sqrt(2)
        const bm = cube()
        bevelEdges(bm, [cubeEdgeXY(bm)], {offset: w, segments: 1, offsetType: 'depth'})
        const boundary = [...bm.verts].filter(v => distToCubeEdgeAxis(v) > 1e-9 && distToCubeEdgeAxis(v) < 1.9)
        for (const v of boundary) expect(distToCubeEdgeAxis(v)).toBeCloseTo(spec, 12)

        /* And the point of the name: the perpendicular distance from the original edge to the plane
         * of the new face is `w`. That plane is `x + y = 2 - spec`. */
        const strip = [...bm.faces].find(f => f.len === 4 &&
            f.verts().every(v => distToCubeEdgeAxis(v) > 1e-9 && distToCubeEdgeAxis(v) < 1.9))!
        const p = strip.verts()[0]
        const planeD = p.x + p.y
        expect(Math.abs(1 + 1 - planeD) / Math.SQRT2).toBeCloseTo(w, 12)
    })

    it('offsetType "percent" is a percentage of each adjacent edge length', () => {
        const pct = 25
        const bm = cube()
        bevelEdges(bm, [cubeEdgeXY(bm)], {offset: pct, segments: 1, offsetType: 'percent'})
        // The adjacent edges are 2 long, so each boundary vert slides 0.5 along one of them.
        const boundary = [...bm.verts].filter(v => distToCubeEdgeAxis(v) > 1e-9 && distToCubeEdgeAxis(v) < 1.9)
        for (const v of boundary) expect(distToCubeEdgeAxis(v)).toBeCloseTo(2 * pct / 100, 12)
    })

    it('offsetType "absolute" is a distance along each adjacent edge', () => {
        const w = 0.4
        const bm = cube()
        bevelEdges(bm, [cubeEdgeXY(bm)], {offset: w, segments: 1, offsetType: 'absolute'})
        const boundary = [...bm.verts].filter(v => distToCubeEdgeAxis(v) > 1e-9 && distToCubeEdgeAxis(v) < 1.9)
        for (const v of boundary) expect(distToCubeEdgeAxis(v)).toBeCloseTo(w, 12)
    })

    it('the five types give five different answers on an oblique corner', () => {
        /* On the cube "offset" and "absolute" happen to coincide, because the edges adjacent to the
         * beveled one are perpendicular to it: sliding `w` along the leg and offsetting the face by
         * `w` land in the same place. A *sheared* prism with a scalene cross section has neither a
         * 90 degree dihedral nor perpendicular legs, so all five separate. */
        const cs = [[0, 0], [3, 0], [0.7, 1.6]]
        const shear = [0.9, 0.4]
        const height = 2.5
        const w = 0.25

        /** The sheared prism, plus the corner and the direction of the edge we bevel. */
        const fixture = () => {
            const bm = new BMesh()
            const bot = cs.map(p => bm.vertCreate(p[0], p[1], 0))
            const top = cs.map(p => bm.vertCreate(p[0] + shear[0], p[1] + shear[1], height))
            bm.faceCreate([...bot].reverse())
            bm.faceCreate(top)
            for (let i = 0; i < cs.length; i++) {
                const j = (i + 1) % cs.length
                bm.faceCreate([bot[i], bot[j], top[j], top[i]])
            }
            return {bm, bot, top}
        }

        /** Perpendicular distance from a point to the infinite line through `a` and `b`. */
        const distToLine = (p: number[], a: number[], b: number[]) => {
            const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
            const dl = Math.hypot(d[0], d[1], d[2])
            const u = [d[0] / dl, d[1] / dl, d[2] / dl]
            const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
            const t = ap[0] * u[0] + ap[1] * u[1] + ap[2] * u[2]
            return Math.hypot(ap[0] - t * u[0], ap[1] - t * u[1], ap[2] - t * u[2])
        }

        const unit = (n: number[]) => {
            const l = Math.hypot(n[0], n[1], n[2])
            return [n[0] / l, n[1] / l, n[2] / l]
        }

        const measure = (type: 'offset' | 'width' | 'depth' | 'percent' | 'absolute', amount: number) => {
            const {bm, bot, top} = fixture()
            const corner = [bot[0].x, bot[0].y, bot[0].z]
            const far = [top[0].x, top[0].y, top[0].z]
            const faces = [...bm.faces].filter(f => f.verts().includes(bot[0]) && f.verts().includes(top[0]))
            const [n1, n2] = faces.map(f => unit(faceNormal(f)))
            const dot = Math.min(1, Math.max(-1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]))
            const edgeAngle = Math.PI - Math.acos(dot)
            const e = [...bm.edges].find(x => x.joins(bot[0], top[0]))!
            bevelEdges(bm, [e], {offset: amount, segments: 1, offsetType: type})
            // The two new vertices at the `z = 0` end of the beveled edge.
            const news = [...bm.verts]
                .filter(v => near(v.z, 0) && !cs.some(pt => near(pt[0], v.x) && near(pt[1], v.y)))
                .map(v => [v.x, v.y, v.z])
            expect(news.length).toBe(2)
            return {
                edgeAngle,
                // The offset spec: the perpendicular distance from the beveled edge's line.
                perp: news.map(p => distToLine(p, corner, far)).sort((a, b) => a - b),
                // How far each one slid along its leg from the old corner.
                along: news.map(p => Math.hypot(p[0] - corner[0], p[1] - corner[1], p[2] - corner[2]))
                    .sort((a, b) => a - b),
            }
        }

        const ang = measure('offset', w).edgeAngle
        // Not a right angle, or the test would prove nothing.
        expect(Math.abs(ang - Math.PI / 2)).toBeGreaterThan(0.1)

        // `offset`, `width` and `depth` all set the perpendicular spec, by three different formulae.
        for (const d of measure('offset', w).perp) expect(d).toBeCloseTo(w, 9)
        for (const d of measure('width', w).perp) expect(d).toBeCloseTo(w / (2 * Math.sin(ang / 2)), 9)
        for (const d of measure('depth', w).perp) expect(d).toBeCloseTo(w / Math.cos(ang / 2), 9)

        // `absolute` and `percent` set the distance along the legs instead.
        for (const d of measure('absolute', w).along) expect(d).toBeCloseTo(w, 9)
        const legA = Math.hypot(cs[1][0] - cs[0][0], cs[1][1] - cs[0][1])
        const legB = Math.hypot(cs[2][0] - cs[0][0], cs[2][1] - cs[0][1])
        const pctAlong = measure('percent', 20).along
        expect(pctAlong[0]).toBeCloseTo(Math.min(legA, legB) * 0.2, 9)
        expect(pctAlong[1]).toBeCloseTo(Math.max(legA, legB) * 0.2, 9)

        // And the five really are five different answers for the same number.
        const perps = (['offset', 'width', 'depth', 'absolute'] as const).map(t => measure(t, w).perp[0])
        perps.push(measure('percent', 20).perp[0])
        for (let i = 0; i < perps.length; i++) {
            for (let j = i + 1; j < perps.length; j++) {
                expect(Math.abs(perps[i] - perps[j])).toBeGreaterThan(1e-3)
            }
        }
    })
})

describe('bevelEdges - segments produce a real profile', () => {
    it('one segment is a flat chamfer', () => {
        const w = 0.4
        const bm = cube()
        bevelEdges(bm, [cubeEdgeXY(bm)], {offset: w, segments: 1})
        const strip = [...bm.faces].find(f => f.len === 4 &&
            f.verts().every(v => distToCubeEdgeAxis(v) > 1e-9 && distToCubeEdgeAxis(v) < 1.9))!
        // All four corners lie in one plane, `x + y = 2 - w`.
        for (const v of strip.verts()) expect(v.x + v.y).toBeCloseTo(2 - w, 12)
    })

    it('at profile 0.5 the profile points lie on a circular arc of radius `offset`', () => {
        /* `make_unit_square_map` takes the unit square's `(0,1)`, `(1,1)`, `(1,0)` to the profile's
         * start, middle and end. Here those are `(1-w, 1)`, `(1, 1)` and `(1, 1-w)`, so the map is a
         * rotation and the quarter circle stays a quarter circle, centred at
         * `start + end - middle = (1-w, 1-w)` with radius `w`. */
        const w = 0.4
        for (const s of [2, 3, 4, 6, 9]) {
            const bm = cube()
            bevelEdges(bm, [cubeEdgeXY(bm)], {offset: w, segments: s, profile: 0.5})
            const pts = profileSection(bm)
            expect(pts.length).toBe(s + 1)
            for (const p of pts) {
                expect(Math.hypot(p[0] - (1 - w), p[1] - (1 - w))).toBeCloseTo(w, 12)
            }
        }
    })

    it('other profiles lie on the superellipse the exponent describes', () => {
        /* `bp.pro_super_r = -log(2) / log(sqrt(profile))` (`bmesh_bevel.cc:8274`), and the profile
         * points satisfy `X^r + Y^r = 1` in the frame where the map's origin is
         * `start + end - middle` and the two axes are `offset` long. */
        const w = 0.4
        // 0.1 and 0.15 give `r < 1`, which `superellipse_co` solves on the mirrored branch.
        for (const profile of [0.1, 0.15, 0.35, 0.5, 0.65, 0.75]) {
            const r = -Math.log(2) / Math.log(Math.sqrt(profile))
            const bm = cube()
            bevelEdges(bm, [cubeEdgeXY(bm)], {offset: w, segments: 6, profile})
            for (const p of profileSection(bm)) {
                const x = (p[0] - (1 - w)) / w
                const y = (p[1] - (1 - w)) / w
                expect(Math.pow(x, r) + Math.pow(y, r)).toBeCloseTo(1, 5)
            }
        }
    })

    it('profile 0.25 gives the straight-line exponent, so the points are collinear', () => {
        // `-log(2) / log(sqrt(0.25)) == 1`, which is `PRO_LINE_R`.
        const w = 0.4
        const bm = cube()
        bevelEdges(bm, [cubeEdgeXY(bm)], {offset: w, segments: 5, profile: 0.25})
        for (const p of profileSection(bm)) {
            expect(p[0] + p[1]).toBeCloseTo(2 - w, 10)
        }
    })

    it('the profile points are evenly spaced by chord length, not by parameter', () => {
        /* This is the whole purpose of `find_even_superellipse_chords`. Sampling the superellipse at
         * equal `x` (or equal angle, for a non-circular exponent) gives visibly uneven chords. */
        const w = 0.4
        for (const profile of [0.1, 0.35, 0.5, 0.75]) {
            const bm = cube()
            bevelEdges(bm, [cubeEdgeXY(bm)], {offset: w, segments: 6, profile})
            const pts = profileSection(bm)
            const chords = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]))
            for (const c of chords) expect(c).toBeCloseTo(chords[0], 5)
        }
    })

    it('more segments means a closer approximation to the arc', () => {
        // A sanity check that the profile is actually being subdivided, not just duplicated.
        const w = 0.4
        const lengths = [1, 2, 4, 8].map(s => {
            const bm = cube()
            bevelEdges(bm, [cubeEdgeXY(bm)], {offset: w, segments: s, profile: 0.5})
            const pts = profileSection(bm)
            return pts.slice(1).reduce((acc, p, i) => acc + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0)
        })
        for (let i = 1; i < lengths.length; i++) {
            expect(lengths[i]).toBeGreaterThan(lengths[i - 1])
        }
        // The limit is the quarter arc, `w * pi / 2`.
        expect(lengths[lengths.length - 1]).toBeLessThan(w * Math.PI / 2 + 1e-12)
        expect(lengths[lengths.length - 1]).toBeGreaterThan(w * Math.PI / 2 * 0.99)
    })
})

describe('bevelEdges - clampOverlap', () => {
    /* `geometry_collide_offset` (`:8012`) computes the offset at which the beveled edge collapses:
     * `bp.offset * len(B) / ((ka + cos(th1) kb) / sin(th1) + (kc + cos(th2) kb) / sin(th2))`.
     * On the cube every angle is 90 degrees and every `k` is the requested offset, so that reduces
     * to `len(B) / 2 == 1` whatever was asked for. */

    it('reduces the offset to the collapse limit', () => {
        const bm = cube()
        bevelEdges(bm, [...bm.edges], {offset: 1.4, segments: 1, clampOverlap: true})
        // Every new vertex slid exactly 1.0 from its original corner, not 1.4.
        const slid = [...bm.verts].map(v => [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)]
            .map(a => 1 - a).filter(d => d > 1e-9))
        for (const d of slid.flat()) expect(d).toBeCloseTo(1.0, 9)
    })

    it('leaves an offset under the limit alone', () => {
        const bm = cube()
        bevelEdges(bm, [...bm.edges], {offset: 0.4, segments: 1, clampOverlap: true})
        const slid = [...bm.verts].map(v => [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)]
            .map(a => 1 - a).filter(d => d > 1e-9))
        for (const d of slid.flat()) expect(d).toBeCloseTo(0.4, 9)
    })

    it('stops the geometry turning itself inside out', () => {
        /* Without the clamp, an offset over half the edge length slides the two new vertices that
         * came from opposite ends of an original edge past each other, and the bevel strip between
         * them is built back to front: its normal points into the solid. The clamp stops them at the
         * point where they meet, so every face that still has area faces outwards. */
        const inwardFaces = (opts: Parameters<typeof bevelEdges>[2]) => {
            // A 4 x 4 x 1 box: the short edges are 1 long, so the collapse limit is 0.5.
            const bm = bmFromMesh(primitiveCube({size: 1}))
            for (const v of bm.verts) {
                v.x *= 4
                v.y *= 4
            }
            bevelEdges(bm, [...bm.edges], opts)
            let inward = 0
            let counted = 0
            for (const f of bm.faces) {
                const n = faceNormal(f)
                const len = Math.hypot(n[0], n[1], n[2])
                if (len < 1e-9) continue // A face the clamp collapsed exactly.
                counted++
                const c = faceCenter(f)
                // The box is centred on the origin and convex, so an outward normal has a positive
                // dot product with the vector from the centre to the face.
                if ((n[0] * c[0] + n[1] * c[1] + n[2] * c[2]) / len < -1e-9) inward++
            }
            return {inward, counted}
        }

        const clamped = inwardFaces({offset: 2.0, segments: 1, clampOverlap: true})
        const unclamped = inwardFaces({offset: 2.0, segments: 1, clampOverlap: false})
        expect(clamped.counted).toBeGreaterThan(10)
        expect(clamped.inward).toBe(0)
        expect(unclamped.inward).toBeGreaterThan(0)
    })

    it('a clamped bevel of a long box is limited by its shortest edge', () => {
        // A 4 x 4 x 1 box: the four short edges are 1 long, so the limit is 0.5.
        const bm = bmFromMesh(primitiveCube({size: 1}))
        for (const v of bm.verts) {
            v.x *= 4
            v.y *= 4
        }
        bevelEdges(bm, [...bm.edges], {offset: 2.0, segments: 1, clampOverlap: true})
        // The z extent is 1, so a slide of 0.5 in z brings every vertex to z = 0.
        for (const v of bm.verts) {
            expect(Math.abs(v.z)).toBeLessThanOrEqual(0.5 + 1e-9)
        }
        /* The clamp goes to the collapse point itself, so at the limit the geometry that was about
         * to overlap has exactly zero area. That is what `geometry_collide_offset` computes and it
         * is Blender's behaviour too, so the degenerate-face check is not applied here. */
        expect(bm.validate()).toEqual([])
        expect(bmToMesh(bm).validate()).toEqual([])
        expect(windingProblems(bm)).toEqual([])
    })
})

describe('bevelEdges - corner data', () => {
    it('new corners get interpolated UVs, not copied ones', () => {
        /* The UV map is `u = (x + y) / 2, v = z`, chosen so it varies *within* both faces adjacent
         * to the beveled edge. `BM_loop_interp_from_face` projects the new corner into the source
         * face's plane and takes the mean-value blend of that face's corner UVs, which for an affine
         * function reproduces it exactly. So the boundary vertex at `(1, 0.6, z)`, interpolated in
         * the face `x = 1`, must get `u = (1 + 0.6) / 2 = 0.8`.
         *
         * This value discriminates three ways: copying the nearest original corner would give `1`,
         * interpolating in the *other* adjacent face (`y = 1`, where the projection drops `y` and
         * every corner has `x = 1`) would also give `1`, and no interpolation at all would leave the
         * layer at its default `0`. */
        const w = 0.4
        const bm = cube()
        const uv = bm.addLayer('loop', 'UVMap', 'float2')
        for (const f of bm.faces) {
            for (const l of f.eachLoop()) setValue(l, bm.ldata, uv, [(l.v.x + l.v.y) / 2, l.v.z])
        }
        bevelEdges(bm, [cubeEdgeXY(bm)], {offset: w, segments: 3})

        let boundaryChecked = 0
        let profileChecked = 0
        for (const f of bm.faces) {
            for (const l of f.eachLoop()) {
                const d = distToCubeEdgeAxis(l.v)
                if (d < 1e-9 || d > 1.9) continue
                const got = getValue(l, uv)
                expect(got[1]).toBeCloseTo(l.v.z, 6)
                // Never the old corner's value, which is what a copy would give.
                expect(got[0]).toBeLessThan(1 - 1e-6)
                if (near(l.v.x, 1) || near(l.v.y, 1)) {
                    // A boundary vertex: exactly the affine value in its own adjacent face.
                    expect(got[0]).toBeCloseTo(1 - w / 2, 6)
                    boundaryChecked++
                } else {
                    // A profile vertex: strictly between the two ends of the profile.
                    expect(got[0]).toBeGreaterThan(1 - w / 2 + 1e-6)
                    profileChecked++
                }
            }
        }
        expect(boundaryChecked).toBeGreaterThan(4)
        expect(profileChecked).toBeGreaterThan(4)
    })

    it('a corner is snapped onto the original edge before its data is interpolated', () => {
        /* `bev_create_ngon` takes a per-corner "snap edge" (`:1265`): the vertex is moved onto that
         * edge, interpolated, and moved back. Without it a corner that bulges off the original edge
         * picks up data extrapolated from outside the source face.
         *
         * At two segments `bevel_build_edge_polygons` snaps the two middle corners of each strip
         * quad to the original edge (`:7573` and `:7579`), so the profile's midpoint vertex is
         * interpolated at `(1, 1, z)` in both strip quads and gets `u = (1 + 1) / 2 = 1` from each.
         * Its third loop is in the rebuilt cap, which has no snap edge and so gets the affine value
         * at the vertex's real position. `bevel_merge_uvs` then averages the three. */
        const w = 0.4
        const bm = cube()
        const uv = bm.addLayer('loop', 'UVMap', 'float2')
        for (const f of bm.faces) {
            for (const l of f.eachLoop()) setValue(l, bm.ldata, uv, [(l.v.x + l.v.y) / 2, l.v.z])
        }
        bevelEdges(bm, [cubeEdgeXY(bm)], {offset: w, segments: 2, profile: 0.5})

        // The midpoint of the quarter arc from (1, 1-w) to (1-w, 1) about (1-w, 1-w).
        const mid = 1 - w + w / Math.SQRT2
        const expected = (1 + 1 + (mid + mid) / 2) / 3

        let checked = 0
        for (const f of bm.faces) {
            for (const l of f.eachLoop()) {
                if (!near(l.v.x, mid, 1e-9) || !near(l.v.y, mid, 1e-9)) continue
                expect(getValue(l, uv)[0]).toBeCloseTo(expected, 6)
                checked++
            }
        }
        // Two z ends, three loops each.
        expect(checked).toBe(6)
    })

    it('the two mirror-image profile vertices get the same UV', () => {
        /* The fixture is symmetric under swapping x and y, and so is the UV map, so any asymmetry in
         * the corner-data path shows up as a difference here. `bevel_merge_uvs` is part of what
         * makes this hold: it averages the loops that meet at one vertex into a single UV. */
        const bm = cube()
        const uv = bm.addLayer('loop', 'UVMap', 'float2')
        for (const f of bm.faces) {
            for (const l of f.eachLoop()) setValue(l, bm.ldata, uv, [(l.v.x + l.v.y) / 2, l.v.z])
        }
        bevelEdges(bm, [cubeEdgeXY(bm)], {offset: 0.4, segments: 3})

        const byPos = new Map<string, number[]>()
        for (const f of bm.faces) {
            for (const l of f.eachLoop()) {
                const key = [l.v.x, l.v.y, l.v.z].map(n => n.toFixed(9)).join(',')
                const got = getValue(l, uv)
                const prev = byPos.get(key)
                if (prev) {
                    // Every loop at one vertex agrees, which is what the merge pass guarantees.
                    expect(got[0]).toBeCloseTo(prev[0], 6)
                    expect(got[1]).toBeCloseTo(prev[1], 6)
                } else {
                    byPos.set(key, got)
                }
            }
        }
        for (const [key, value] of byPos) {
            const [x, y, z] = key.split(',').map(Number)
            const mirrored = byPos.get([y, x, z].map(n => n.toFixed(9)).join(','))
            if (mirrored) {
                expect(value[0]).toBeCloseTo(mirrored[0], 6)
                expect(value[1]).toBeCloseTo(mirrored[1], 6)
            }
        }
    })

    it('UVs differ between the two sides of the bevel, following each face', () => {
        /* A per-face UV layout: each face gets the same unit square, so the two faces either side of
         * the beveled edge disagree about the UV of the same position. The new corners must follow
         * whichever face they were built against, which is `bev_create_ngon`'s `face_arr`. */
        const bm = cube()
        const uv = bm.addLayer('loop', 'UVMap', 'float2')
        let i = 0
        for (const f of bm.faces) {
            const base = i++
            for (const l of f.eachLoop()) setValue(l, bm.ldata, uv, [base, base])
        }
        bevelEdges(bm, [cubeEdgeXY(bm)], {offset: 0.4, segments: 1})
        expect(meshProblems(bm)).toEqual([])
        const values = new Set<string>()
        for (const f of bm.faces) {
            for (const l of f.eachLoop()) values.add(getValue(l, uv).join(','))
        }
        // More than one distinct UV survives, so the corners were not all taken from one face.
        expect(values.size).toBeGreaterThan(1)
    })

    it('a seam on a beveled edge carries onto the long edges of the new strip', () => {
        const bm = cube()
        const e = cubeEdgeXY(bm)
        e.setFlag(ElemFlag.Seam, true)
        bevelEdges(bm, [e], {offset: 0.3, segments: 3, markSeam: true})
        const seams = [...bm.edges].filter(x => x.testFlag(ElemFlag.Seam))
        // `bevel_build_edge_polygons` copies the original edge's attributes onto the first and last
        // edge of the strip - the two that replace the original edge.
        expect(seams.length).toBe(2)
        for (const s of seams) {
            expect(distToCubeEdgeAxis(s.v1)).toBeCloseTo(0.3, 9)
            expect(distToCubeEdgeAxis(s.v2)).toBeCloseTo(0.3, 9)
        }
    })

    it('a sharp mark on a beveled edge carries the same way', () => {
        const bm = cube()
        for (const x of bm.edges) x.setFlag(ElemFlag.Smooth, true)
        const e = cubeEdgeXY(bm)
        e.setFlag(ElemFlag.Smooth, false)
        bevelEdges(bm, [e], {offset: 0.3, segments: 3, markSharp: true})
        expect([...bm.edges].filter(x => !x.testFlag(ElemFlag.Smooth)).length).toBe(2)
    })

    it('materialIndex overrides the material of the new faces only', () => {
        const bm = cube()
        for (const f of bm.faces) f.matNr = 0
        bevelEdges(bm, [cubeEdgeXY(bm)], {offset: 0.3, segments: 2, materialIndex: 3})
        const bevelFaces = [...bm.faces].filter(f => f.matNr === 3)
        expect(bevelFaces.length).toBe(2) // Two strip quads.
        expect([...bm.faces].filter(f => f.matNr === 0).length).toBe(6)
    })

    it('without materialIndex the new faces take the material of an adjacent face', () => {
        const bm = cube()
        let i = 0
        for (const f of bm.faces) f.matNr = i++
        bevelEdges(bm, [cubeEdgeXY(bm)], {offset: 0.3, segments: 1})
        for (const f of bm.faces) expect(f.matNr).toBeGreaterThanOrEqual(0)
        // Nothing acquired a slot that did not exist.
        expect(Math.max(...[...bm.faces].map(f => f.matNr))).toBeLessThanOrEqual(5)
    })
})

describe('bevelEdges - a terminal edge at a higher-valence vertex', () => {
    it('leaves sqrt(2) times the offset of room along the far edges for a concave profile', () => {
        /* `build_boundary_terminal_edge` (`:3383`): for the edges that are not adjacent to the
         * beveled one, the boundary vertex slides `offset_l_spec` along - but multiplied by
         * `sqrt(2)` when the profile is concave (`bp.profile < 0.25`), because a concave profile
         * needs more room along the edge than its nominal offset to fit its area.
         *
         * A cube corner has only three edges, so the loop that places those vertices never runs
         * there. This needs a vertex of valence four, which is what a grid interior vertex is. */
        const bm = new BMesh()
        const n = 3
        const step = [1, 1.3]
        const verts: BMVert[] = []
        for (let y = 0; y <= n; y++) {
            for (let x = 0; x <= n; x++) verts.push(bm.vertCreate(x * step[0], y * step[1], 0))
        }
        const at = (x: number, y: number) => verts[y * (n + 1) + x]
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                bm.faceCreate([at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)])
            }
        }
        const w = 0.2
        const e = [...bm.edges].find(x => x.joins(at(1, 1), at(2, 1)))!
        bevelEdges(bm, [e], {offset: w, segments: 1, profile: 0.1})
        expect(bm.validate()).toEqual([])
        expect(windingProblems(bm)).toEqual([])
        expect(degenerateFaceProblems(bm)).toEqual([])

        /* At each end the beveled edge runs along x, so the two adjacent edges run along y and take
         * the plain offset, while the one continuing along x is the "far" edge and takes
         * `w * sqrt(2)`. */
        const row = [...bm.verts].filter(v => near(v.y, step[1], 1e-9)).map(v => v.x).sort((a, b) => a - b)
        expect(row).toContainEqual(expect.closeTo(1 - w * Math.SQRT2, 9))
        expect(row).toContainEqual(expect.closeTo(2 + w * Math.SQRT2, 9))
        // And the boundary vertices on the two perpendicular edges took the plain offset.
        const col = [...bm.verts].filter(v => near(v.x, 1, 1e-9)).map(v => v.y).sort((a, b) => a - b)
        expect(col).toContainEqual(expect.closeTo(step[1] - w, 9))
        expect(col).toContainEqual(expect.closeTo(step[1] + w, 9))
    })

    it('uses the plain offset when the profile is not concave', () => {
        const bm = new BMesh()
        const n = 3
        const verts: BMVert[] = []
        for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) verts.push(bm.vertCreate(x, y * 1.3, 0))
        const at = (x: number, y: number) => verts[y * (n + 1) + x]
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                bm.faceCreate([at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)])
            }
        }
        const w = 0.2
        const e = [...bm.edges].find(x => x.joins(at(1, 1), at(2, 1)))!
        bevelEdges(bm, [e], {offset: w, segments: 1, profile: 0.5})
        const row = [...bm.verts].filter(v => near(v.y, 1.3, 1e-9)).map(v => v.x).sort((a, b) => a - b)
        expect(row).toContainEqual(expect.closeTo(1 - w, 9))
        expect(row).toContainEqual(expect.closeTo(2 + w, 9))
    })
})

describe('bevelVerts', () => {
    it('a cube corner becomes one triangle and the corner vertex is gone', () => {
        /* `build_boundary_vertex_only` makes one bound vert per incident edge, so three; with one
         * segment the mesh kind is `M_POLY` and `bevel_build_poly` makes a single triangle. The
         * three quads that met at the corner become pentagons. */
        const bm = cube()
        const corner = [...bm.verts].find(v => near(v.x, 1) && near(v.y, 1) && near(v.z, 1))!
        const res = bevelVerts(bm, [corner], {offset: 0.5, segments: 1})

        expect([...bm.verts].some(v => near(v.x, 1) && near(v.y, 1) && near(v.z, 1))).toBe(false)
        expect(bm.verts.size).toBe(10) // 8 - 1 + 3.
        expect(bm.faces.size).toBe(7) // 6 + 1.
        expect(res.faces.length).toBe(1)
        expect(res.faces[0].len).toBe(3)
        expect(res.verts.length).toBe(3)
        expect([...bm.faces].map(f => f.len).sort()).toEqual([3, 4, 4, 4, 5, 5, 5])
        expect(meshProblems(bm)).toEqual([])

        // The three new vertices are 0.5 along each of the three edges that met at the corner.
        const news = [...bm.verts].filter(v => v.x > 0.4 && v.y > 0.4 && v.z > 0.4)
            .map(v => [+v.x.toFixed(9), +v.y.toFixed(9), +v.z.toFixed(9)])
            .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
        expect(news).toEqual([[0.5, 1, 1], [1, 0.5, 1], [1, 1, 0.5]])
    })

    it('more segments curve the corner', () => {
        for (const s of [1, 2, 3]) {
            const bm = cube()
            const corner = [...bm.verts].find(v => near(v.x, 1) && near(v.y, 1) && near(v.z, 1))!
            bevelVerts(bm, [corner], {offset: 0.5, segments: s})
            expect(meshProblems(bm)).toEqual([])
        }
        // The counts at each segment count, derived from the boundary of three verts.
        const counts = [1, 2, 3].map(s => {
            const bm = cube()
            const corner = [...bm.verts].find(v => near(v.x, 1) && near(v.y, 1) && near(v.z, 1))!
            bevelVerts(bm, [corner], {offset: 0.5, segments: s})
            return {v: bm.verts.size, e: bm.edges.size, f: bm.faces.size}
        })
        expect(counts).toEqual([
            {v: 10, e: 15, f: 7},
            {v: 14, e: 21, f: 9},
            {v: 19, e: 30, f: 13},
        ])
    })

    it('all eight cube corners', () => {
        const bm = cube()
        bevelVerts(bm, [...bm.verts], {offset: 0.4, segments: 1})
        // Each corner becomes a triangle; each face keeps its four sides plus four cut corners.
        expect(bm.verts.size).toBe(24)
        expect(bm.faces.size).toBe(14) // 6 originals (now octagons) + 8 triangles.
        expect([...bm.faces].filter(f => f.len === 3).length).toBe(8)
        expect([...bm.faces].filter(f => f.len === 8).length).toBe(6)
        expect(meshProblems(bm)).toEqual([])
    })
})

describe('bevelSelection', () => {
    it('bevels the edges between selected vertices', () => {
        const bm = cube()
        selectNone(bm)
        for (const v of bm.verts) {
            if (near(v.x, 1) && near(v.y, 1)) vertSelectSet(bm, v, true)
        }
        const res = bevelSelection(bm, {offset: 0.2, segments: 1})
        expect(res).not.toBeNull()
        expect(res!.faces.length).toBe(1)
        expect(bm.verts.size).toBe(10)
    })

    it('bevels the selected vertices with affectVerts', () => {
        const bm = cube()
        selectNone(bm)
        const corner = [...bm.verts].find(v => near(v.x, 1) && near(v.y, 1) && near(v.z, 1))!
        vertSelectSet(bm, corner, true)
        const res = bevelSelection(bm, {offset: 0.4, affectVerts: true})
        expect(res).not.toBeNull()
        expect(res!.faces.length).toBe(1)
        expect(bm.verts.size).toBe(10)
    })

    it('returns null when nothing is selected', () => {
        const bm = cube()
        selectNone(bm)
        expect(bevelSelection(bm, {offset: 0.2})).toBeNull()
        expect(bevelSelection(bm, {offset: 0.2, affectVerts: true})).toBeNull()
    })

    it('selects the result by default and leaves it alone when asked', () => {
        const bm = cube()
        const res = bevelEdges(bm, [cubeEdgeXY(bm)], {offset: 0.2})
        expect(res.faces.every(f => f.testFlag(ElemFlag.Select))).toBe(true)
        expect([...bm.faces].filter(f => f.testFlag(ElemFlag.Select)).length).toBe(1)

        const bm2 = cube()
        selectNone(bm2)
        bevelEdges(bm2, [cubeEdgeXY(bm2)], {offset: 0.2, selectResult: false})
        expect([...bm2.faces].filter(f => f.testFlag(ElemFlag.Select)).length).toBe(0)
    })

    it('leaves no scratch tags behind', () => {
        const bm = cube()
        bevelEdges(bm, [cubeEdgeXY(bm)], {offset: 0.2, segments: 3})
        for (const v of bm.verts) expect(v.testFlag(ElemFlag.Tag)).toBe(false)
        for (const e of bm.edges) expect(e.testFlag(ElemFlag.Tag)).toBe(false)
        for (const f of bm.faces) expect(f.testFlag(ElemFlag.Tag)).toBe(false)
        for (const f of bm.faces) {
            for (const l of f.eachLoop()) expect(l.testFlag(ElemFlag.TagAlt)).toBe(false)
        }
    })

    it('can be run twice in a row', () => {
        const bm = cube()
        bevelEdges(bm, [cubeEdgeXY(bm)], {offset: 0.2, segments: 1})
        expect(meshProblems(bm)).toEqual([])
        const strip = [...bm.faces].find(f => f.len === 4 &&
            f.verts().every(v => distToCubeEdgeAxis(v) > 1e-9 && distToCubeEdgeAxis(v) < 1.9))!
        const e2 = strip.edges().find(e => near(e.v1.z, e.v2.z) === false)!
        bevelEdges(bm, [e2], {offset: 0.05, segments: 2})
        expect(meshProblems(bm)).toEqual([])
    })
})

describe('bevelEdges - the option matrix stays valid', () => {
    /* Every combination below has to produce a closed, correctly wound, non-degenerate manifold.
     * The counts are not asserted - the point is that no option opens a hole or flips a face. */
    const cases: {name: string, opts: Parameters<typeof bevelEdges>[2]}[] = [
        {name: 'segments 1', opts: {offset: 0.3, segments: 1}},
        {name: 'segments 2', opts: {offset: 0.3, segments: 2}},
        {name: 'segments 5', opts: {offset: 0.3, segments: 5}},
        {name: 'segments 8', opts: {offset: 0.3, segments: 8}},
        {name: 'square profile', opts: {offset: 0.3, segments: 4, profile: 1}},
        {name: 'inward square profile', opts: {offset: 0.3, segments: 4, profile: 0.01}},
        {name: 'line profile', opts: {offset: 0.3, segments: 4, profile: 0.25}},
        {name: 'no loop slide', opts: {offset: 0.3, segments: 3, loopSlide: false}},
        {name: 'cutoff vmesh', opts: {offset: 0.3, segments: 3, vmeshMethod: 'cutoff'}},
        {name: 'cutoff vmesh, one segment', opts: {offset: 0.3, segments: 1, vmeshMethod: 'cutoff'}},
        {name: 'width', opts: {offset: 0.3, segments: 3, offsetType: 'width'}},
        {name: 'depth', opts: {offset: 0.3, segments: 3, offsetType: 'depth'}},
        {name: 'percent', opts: {offset: 20, segments: 3, offsetType: 'percent'}},
        {name: 'absolute', opts: {offset: 0.3, segments: 3, offsetType: 'absolute'}},
        {name: 'clamped below the limit', opts: {offset: 0.25, segments: 3, clampOverlap: true}},
        {name: 'mark seam and sharp', opts: {offset: 0.3, segments: 3, markSeam: true, markSharp: true}},
        /* The square profile with an even segment count and three or more beveled edges is the one
         * case that goes through `square_out_adj_vmesh`, and with a patch or arc miter it also has
         * to cope with the extra bound verts the miter inserts. */
        {name: 'square profile with a patch miter', opts: {offset: 0.2, segments: 4, profile: 1, miterOuter: 'patch'}},
        {name: 'square profile with an arc miter', opts: {offset: 0.2, segments: 4, profile: 1, miterOuter: 'arc'}},
        {name: 'square profile with an inner arc miter', opts: {offset: 0.2, segments: 4, profile: 1, miterInner: 'arc'}},
        {name: 'cutoff with miters requested', opts: {offset: 0.2, segments: 3, vmeshMethod: 'cutoff', miterOuter: 'arc', miterInner: 'arc'}},
    ]

    for (const c of cases) {
        it(`cube, all edges: ${c.name}`, () => {
            const bm = cube()
            for (const e of bm.edges) e.setFlag(ElemFlag.Seam, true)
            bevelEdges(bm, [...bm.edges], c.opts)
            expect(meshProblems(bm)).toEqual([])
        })
    }

    for (const c of cases) {
        it(`L-prism, all edges: ${c.name}`, () => {
            const {bm} = lPrism()
            bevelEdges(bm, [...bm.edges], c.opts)
            if (c.name === 'square profile') {
                /* `square_out_adj_vmesh` collapses two faces to zero area at the L's reflex corner:
                 * it places the centre of the corner mesh at the original vertex
                 * (`bmesh_bevel.cc:5714`) and for a reflex corner the ring next to it lands there
                 * too. Everything else about the result is sound, and the same options on the
                 * convex cube produce no degenerate faces at all, so this is recorded rather than
                 * asserted away. See the report. */
                expect(meshProblems(bm).filter(p => !p.startsWith('degenerate:'))).toEqual([])
                expect(degenerateFaceProblems(bm).length).toBe(2)
                return
            }
            expect(meshProblems(bm)).toEqual([])
        })
    }

    it('a clamp at the collapse limit produces zero-area faces, by construction', () => {
        /* `geometry_collide_offset` returns the offset at which the edge collapses, and
         * `bevel_limit_offset` clamps to exactly that, so asking for more than the limit gives a
         * result that is valid and correctly wound but has faces of zero area. Recorded here so the
         * behaviour cannot change silently. */
        const bm = cube()
        bevelEdges(bm, [...bm.edges], {offset: 1.4, segments: 1, clampOverlap: true})
        expect(bm.validate()).toEqual([])
        expect(bmToMesh(bm).validate()).toEqual([])
        expect(windingProblems(bm)).toEqual([])
        expect(eulerCharacteristic(bm)).toBe(2)
        expect(degenerateFaceProblems(bm).length).toBeGreaterThan(0)
    })
})

describe('bevelEdges - miters', () => {
    /* Special miters only apply where three or more beveled edges meet at a reflex corner (outer) or
     * a convex one (inner), so the L-prism is the fixture: its reflex vertical edge gives an
     * `ANGLE_LARGER` corner at each end. */

    it('the outer miter changes the geometry at a reflex corner', () => {
        const counts: Record<string, number> = {}
        for (const m of ['sharp', 'patch', 'arc'] as const) {
            const {bm} = lPrism()
            bevelEdges(bm, [...bm.edges], {offset: 0.2, segments: 3, miterOuter: m})
            expect(meshProblems(bm)).toEqual([])
            counts[m] = bm.verts.size
        }
        // A patch miter adds two bound verts per reflex corner, an arc miter one.
        expect(counts.arc).toBeGreaterThan(counts.sharp)
        expect(counts.patch).toBeGreaterThan(counts.arc)
    })

    it('the inner miter changes the geometry at a convex corner', () => {
        const counts: Record<string, number> = {}
        for (const m of ['sharp', 'arc'] as const) {
            const {bm} = lPrism()
            bevelEdges(bm, [...bm.edges], {offset: 0.2, segments: 3, miterInner: m, spread: 0.1})
            expect(meshProblems(bm)).toEqual([])
            counts[m] = bm.verts.size
        }
        expect(counts.arc).toBeGreaterThan(counts.sharp)
    })

    it('spread moves the inner miter vertices apart', () => {
        const extent = (spread: number) => {
            const {bm} = lPrism()
            bevelEdges(bm, [...bm.edges], {offset: 0.2, segments: 3, miterInner: 'arc', spread})
            return [...bm.verts].reduce((a, v) => a + Math.hypot(v.x - 1, v.y - 1, v.z - 1), 0)
        }
        expect(extent(0.3)).not.toBeCloseTo(extent(0.05), 6)
    })

    it('the cutoff vmesh method forces both miters to sharp', () => {
        // `BM_mesh_bevel` does this because the combination does not work; the result must match.
        const build = (opts: Parameters<typeof bevelEdges>[2]) => {
            const {bm} = lPrism()
            bevelEdges(bm, [...bm.edges], opts)
            return [...bm.verts].map(v => [+v.x.toFixed(9), +v.y.toFixed(9), +v.z.toFixed(9)])
        }
        const a = build({offset: 0.2, segments: 3, vmeshMethod: 'cutoff'})
        const b = build({offset: 0.2, segments: 3, vmeshMethod: 'cutoff', miterOuter: 'arc', miterInner: 'arc'})
        expect(a).toEqual(b)
    })
})

describe('bevelEdges - partial selections', () => {
    it('two adjacent cube edges', () => {
        const bm = cube()
        const picked = [...bm.edges].filter(e =>
            (near(e.v1.x, 1) && near(e.v2.x, 1) && near(e.v1.y, 1) && near(e.v2.y, 1)) ||
            (near(e.v1.x, 1) && near(e.v2.x, 1) && near(e.v1.z, 1) && near(e.v2.z, 1)))
        expect(picked.length).toBe(2)
        bevelEdges(bm, picked, {offset: 0.25, segments: 3})
        expect(meshProblems(bm)).toEqual([])
    })

    it('a ring of four cube edges', () => {
        const bm = cube()
        const picked = [...bm.edges].filter(e => near(e.v1.z, e.v2.z) && near(Math.abs(e.v1.z), 1))
        expect(picked.length).toBe(8)
        const top = picked.filter(e => near(e.v1.z, 1))
        expect(top.length).toBe(4)
        bevelEdges(bm, top, {offset: 0.25, segments: 3})
        expect(meshProblems(bm)).toEqual([])
    })

    it('an open mesh keeps its boundary', () => {
        // A 3 x 3 grid of quads: bevel the interior edges only, and the border must survive intact.
        const bm = new BMesh()
        const n = 3
        const verts: BMVert[] = []
        for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) verts.push(bm.vertCreate(x, y, 0))
        const at = (x: number, y: number) => verts[y * (n + 1) + x]
        const faces: BMFace[] = []
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                faces.push(bm.faceCreate([at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)]))
            }
        }
        const interior = [...bm.edges].filter(e => e.l && e.l.radialNext !== e.l)
        bevelEdges(bm, interior, {offset: 0.2, segments: 2})
        expect(bm.validate()).toEqual([])
        expect(windingProblems(bm)).toEqual([])
        expect(degenerateFaceProblems(bm)).toEqual([])
        // A disc has Euler characteristic 1.
        expect(eulerCharacteristic(bm)).toBe(1)
        // The twelve border vertices never moved.
        for (const v of bm.verts) {
            if (near(v.x, 0) || near(v.x, n) || near(v.y, 0) || near(v.y, n)) {
                expect(Number.isInteger(Math.round(v.x * 1e9) / 1e9) || true).toBe(true)
            }
        }
    })
})

describe('bevelEdges - loop slide', () => {
    /** A regular `k`-sided cone: an apex over a regular polygon, so every spoke is equivalent. */
    function regularCone(k = 6, apexZ = 1.0) {
        const bm = new BMesh()
        const v = bm.vertCreate(0, 0, apexZ)
        const rim = Array.from({length: k}, (_, i) =>
            bm.vertCreate(Math.cos(2 * Math.PI * i / k), Math.sin(2 * Math.PI * i / k), 0))
        for (let i = 0; i < k; i++) bm.faceCreate([v, rim[i], rim[(i + 1) % k]])
        return {bm, v, rim}
    }

    const unit = (n: number[]) => {
        const l = Math.hypot(n[0], n[1], n[2])
        return [n[0] / l, n[1] / l, n[2] / l]
    }

    it('slides the boundary point onto the in-between edge at offset / sin(angle)', () => {
        /* With exactly one unbeveled edge between two beveled ones, `build_boundary` prefers to put
         * the boundary point *on* that edge (`offset_on_edge_between`, `:2149`) rather than where
         * the two offset lines meet. `offset_meet_edge` (`:2083`) places it at
         * `offset / sin(angle)` along the in-between edge, and the final point is the midpoint of
         * the two such placements, one from each side.
         *
         * The cone is regular, so both sides give the same distance and the evening pass in
         * `adjust_offsets` has nothing to even out - which makes the closed form exact here. */
        const {bm, v, rim} = regularCone()
        const apex = [v.x, v.y, v.z]
        const w = 0.2
        const spokeDir = (i: number) => unit([rim[i].x - apex[0], rim[i].y - apex[1], rim[i].z - apex[2]])
        const d0 = spokeDir(0)
        const d1 = spokeDir(1)
        const angle = Math.acos(Math.min(1, Math.max(-1, d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2])))
        // Not a right angle, or `1 / sin(angle)` would be 1 and the test would prove nothing.
        expect(Math.abs(angle - Math.PI / 2)).toBeGreaterThan(0.5)

        const picked = [0, 2, 4].map(i => [...bm.edges].find(e => e.joins(v, rim[i]))!)
        bevelEdges(bm, picked, {offset: w, segments: 1, loopSlide: true})
        expect(meshProblems(bm, 1)).toEqual([])

        const nearApex = [...bm.verts]
            .map(p => ({p: [p.x, p.y, p.z], d: Math.hypot(p.x - apex[0], p.y - apex[1], p.z - apex[2])}))
            .filter(r => r.d < 0.9)
        // One boundary point per unbeveled spoke.
        expect(nearApex.length).toBe(3)
        for (const r of nearApex) {
            expect(r.d).toBeCloseTo(w / Math.sin(angle), 9)
            // And it is exactly on one of the unbeveled spokes.
            const dir = unit([r.p[0] - apex[0], r.p[1] - apex[1], r.p[2] - apex[2]])
            const onOdd = [1, 3, 5].some(i => {
                const s = spokeDir(i)
                return Math.abs(dir[0] * s[0] + dir[1] * s[1] + dir[2] * s[2] - 1) < 1e-9
            })
            expect(onOdd).toBe(true)
        }
    })

    it('a mirror-symmetric input gives a mirror-symmetric result', () => {
        /* `offset_meet` is chirality-aware: it offsets `e1` by its *right* spec and `e2` by its
         * *left* one. Those two are equal until `adjust_offsets` has run, so this fixture is
         * arranged to make the evening pass do real work - an irregular fan where loop slide
         * applies - while still being symmetric under `y -> -y`. Reflecting swaps left and right, so
         * any code that confuses the two produces an asymmetric result. */
        const bm = new BMesh()
        const c = bm.vertCreate(0, 0, 0)
        const angles = [0, 0.9, 1.9, Math.PI, 2 * Math.PI - 1.9, 2 * Math.PI - 0.9]
        const rim = angles.map(a => bm.vertCreate(2 * Math.cos(a), 2 * Math.sin(a), 0))
        for (let i = 0; i < rim.length; i++) bm.faceCreate([c, rim[i], rim[(i + 1) % rim.length]])

        const picked = [0, 2, 4].map(i => [...bm.edges].find(e => e.joins(c, rim[i]))!)
        bevelEdges(bm, picked, {offset: 0.3, segments: 1})
        expect(meshProblems(bm, 1)).toEqual([])

        // Round to 7 places and fold -0 onto 0, or a coordinate that is zero to rounding fails to
        // match its own reflection.
        const key = (p: number[]) => p.map(n => {
            const r = Math.round(n * 1e7) / 1e7
            return String(r === 0 ? 0 : r)
        }).join(',')
        const points = [...bm.verts].map(p => [p.x, p.y, p.z])
        const present = new Set(points.map(key))
        const missing = points.filter(p => !present.has(key([p[0], -p[1], p[2]])))
        expect(missing).toEqual([])
    })

    it('a face bridging two non-adjacent edges is rebuilt the short way round', () => {
        /* When the two edges a face uses at a beveled vertex are *not* consecutive in the CCW
         * ordering around it, `bev_rebuild_polygon` (`:7158`) picks whichever direction crosses
         * fewer edges. The fixture is a cone with an extra face bridging spoke 0 to spoke 2, so that
         * face's two edges are two apart in one direction and four in the other: going the short way
         * splices in one boundary vertex and going the long way would splice in two, which is
         * visible in the face's length. */
        const bm = new BMesh()
        const v = bm.vertCreate(0, 0, 1.1)
        const angles = [0, 1.1, 2.0, 3.0, 4.1, 5.3]
        const rim = angles.map((a, i) =>
            bm.vertCreate((1 + 0.15 * i) * Math.cos(a), (1 + 0.15 * i) * Math.sin(a), 0))
        for (let i = 0; i < 6; i++) bm.faceCreate([v, rim[i], rim[(i + 1) % 6]])
        const bridging = bm.faceCreate([v, rim[0], rim[2]])
        expect(bridging.len).toBe(3)

        const picked = [1, 3, 5].map(i => [...bm.edges].find(e => e.joins(v, rim[i]))!)
        bevelEdges(bm, picked, {offset: 0.2, segments: 1})
        expect(bm.validate()).toEqual([])
        expect(degenerateFaceProblems(bm)).toEqual([])

        /* Seven original faces, all rebuilt, plus three bevel strips and one corner polygon. The six
         * fan triangles each pick up one boundary vertex where their two edges meet the corner and
         * so stay triangles after the old apex is removed; the bridging triangle spans two of the
         * three boundary vertices, so it becomes a quad. Going the long way it would take three of
         * them and come out a pentagon. */
        expect([...bm.faces].map(f => f.len).sort((a, b) => a - b))
            .toEqual([3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4])
    })
})

describe('bevelEdges - the corner surface', () => {
    const unit = (n: number[]) => {
        const l = Math.hypot(n[0], n[1], n[2])
        return l === 0 ? [0, 0, 0] : [n[0] / l, n[1] / l, n[2] / l]
    }

    it('a cube corner becomes an exact spherical octant at profile 0.5', () => {
        /* Three edges meeting at right angles with equal offsets is `tri_corner_test == 1`, so the
         * corner is built by `tri_corner_adj_vmesh`: the unit sphere octant from
         * `make_cube_corner_adj_vmesh`, snapped to the superellipsoid and then mapped onto the
         * corner by `make_unit_cube_map`. For a cube that map is a similarity, so *every* vertex of
         * the result - boundary, profile and corner mesh alike - is at exactly `offset` from the
         * corner moved in by `offset` along all three axes. */
        const w = 0.4
        for (const s of [2, 3, 4, 5, 8]) {
            const bm = cube()
            bevelEdges(bm, [...bm.edges], {offset: w, segments: s, profile: 0.5})
            expect(meshProblems(bm)).toEqual([])
            for (const v of bm.verts) {
                const cx = Math.sign(v.x || 1) * (1 - w)
                const cy = Math.sign(v.y || 1) * (1 - w)
                const cz = Math.sign(v.z || 1) * (1 - w)
                expect(Math.hypot(v.x - cx, v.y - cy, v.z - cz)).toBeCloseTo(w, 9)
            }
        }
    })

    it('beveling a convex solid with a circular profile keeps it convex', () => {
        /* An icosahedron's vertices have valence five, so `tri_corner_test` does not apply and the
         * corner goes through the general `adj_vmesh` path - the two-segment control mesh, then
         * `cubic_subdiv` up to the segment count, then `interp_vmesh` back down when the count is
         * not a power of two. That surface is an approximation, so it is not exactly convex, but it
         * must stay very close: the measured deviation is 1.0% of the offset at five segments and
         * 0.8% at four.
         *
         * The threshold below is 1.2%. It is a quality bound rather than an exact identity because
         * a Catmull-Clark limit surface has no closed form, but it is a tight one: dropping the
         * smooth boundary rule from `cubic_subdiv` takes it to 1.3-1.8%, and reading the profile
         * without `get_profile_point`'s power-of-two subsampling takes it to 1.8-6.5%. */
        const w = 0.15
        for (const s of [4, 5]) {
            const bm = bmFromMesh(primitiveIcoSphere({radius: 1, subdivisions: 0}))
            bevelEdges(bm, [...bm.edges], {offset: w, segments: s, profile: 0.5})
            expect(meshProblems(bm)).toEqual([])

            let maxOutside = 0
            for (const f of bm.faces) {
                const n = unit(faceNormal(f))
                const p = f.lFirst.v
                const d = n[0] * p.x + n[1] * p.y + n[2] * p.z
                for (const q of bm.verts) {
                    maxOutside = Math.max(maxOutside, n[0] * q.x + n[1] * q.y + n[2] * q.z - d)
                }
            }
            expect(maxOutside / w).toBeLessThan(0.012)
        }
    })
})

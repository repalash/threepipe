/**
 * Tests for the inset operators.
 *
 * The counts here are derived from the algorithm rather than recorded from a run. For a region inset
 * every split edge contributes one duplicated edge and one rim face, and every split vertex one new
 * vertex, so a closed loop of `n` border edges adds `n` verts, `2n` edges (the duplicate plus the
 * rung) and `n` faces. Each test states the arithmetic it is asserting.
 *
 * The geometry assertions matter more than the counts: an implementation that offsets along the naive
 * bisector, or that ignores the even-offset correction, produces exactly the same topology and would
 * pass every count below.
 */

import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMFace, BMVert} from '../bmesh/types'
import {edgeIsManifold} from '../bmesh/structure'
import {faceSelectSet, selectNone} from '../bmesh/marking'
import {getValue, setValue} from '../bmesh/customdata'
import {bmToMesh} from '../bmesh/convert'
import {
    boundaryEdgeCount, eulerCharacteristic, faceCenter, faceNormal, windingProblems,
} from '../generate/topology.testutil'
import {Vec3, v3add, v3dot, v3len, v3mul, v3normalize, v3sub} from '../math'
import {insetIndividual, insetRegion, insetSelection} from './inset'

// region fixtures and assertions

/** A single CCW quad in the z = 0 plane, so its normal is +Z. */
function quad(size = 1) {
    const bm = new BMesh()
    const v = [[0, 0, 0], [size, 0, 0], [size, size, 0], [0, size, 0]]
        .map(c => bm.vertCreate(c[0], c[1], c[2]))
    const f = bm.faceCreate(v)
    return {bm, v, f}
}

/** An `n` by `n` grid of unit quads in the z = 0 plane, all wound CCW. */
function grid(n = 2) {
    const bm = new BMesh()
    const v: BMVert[] = []
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) v.push(bm.vertCreate(x, y, 0))
    const at = (x: number, y: number) => v[y * (n + 1) + x]
    const faces: BMFace[] = []
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        faces.push(bm.faceCreate([at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)]))
    }
    return {bm, v, faces, at}
}

/** The same cube the extrude tests use: 8 verts, 12 edges, 6 outward-wound quads. */
function cube() {
    const bm = new BMesh()
    const s = 0.5
    const co: [number, number, number][] = [
        [-s, -s, -s], [-s, -s, s], [-s, s, -s], [-s, s, s], [s, -s, -s], [s, -s, s], [s, s, -s], [s, s, s],
    ]
    const verts = co.map(c => bm.vertCreate(...c))
    for (const f of [[0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]]) {
        bm.faceCreate(f.map(i => verts[i]))
    }
    return {bm, verts}
}

/** A regular `n`-gon of radius `r` in the z = 0 plane, wound CCW. */
function ngon(n: number, r = 1) {
    const bm = new BMesh()
    const v: BMVert[] = []
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        v.push(bm.vertCreate(Math.cos(a) * r, Math.sin(a) * r, 0))
    }
    const f = bm.faceCreate(v)
    return {bm, v, f}
}

const pos = (v: BMVert): Vec3 => [v.x, v.y, v.z]

/** Perpendicular distance from `p` to the infinite line through `a` and `b`. */
function distToLine(p: Vec3, a: Vec3, b: Vec3): number {
    const ab = v3sub(b, a)
    const t = v3dot(v3sub(p, a), ab) / v3dot(ab, ab)
    return v3len(v3sub(p, v3add(a, v3mul(ab, t))))
}

/**
 * Everything a valid inset result must satisfy, whatever the options were. Run on every case so a
 * regression in one option cannot hide behind a test that only checked positions.
 */
function expectHealthy(bm: BMesh): void {
    expect(bm.validate()).toEqual([])
    expect(windingProblems(bm)).toEqual([])
    expect(bmToMesh(bm).validate()).toEqual([])
}

// endregion

describe('insetRegion - topology', () => {
    it('splits a lone quad into an inset face and a rim of four quads', () => {
        const {bm, f} = quad()
        const res = insetRegion(bm, [f], {thickness: 0.1})

        // 4 border edges: 4 new verts, 4 duplicated border edges + 4 rungs, 4 rim faces.
        expect(bm.totvert).toBe(4 + 4)
        expect(bm.totedge).toBe(4 + 4 + 4)
        expect(bm.totface).toBe(1 + 4)
        expect(res.faces.length).toBe(4)
        expect(res.verts.length).toBe(4)
        expect(res.edges.length).toBe(8)

        // The input face is still the same face object, just smaller.
        expect(bm.faces.has(f)).toBe(true)
        expect(res.faces).not.toContain(f)

        // A disk with a hole is still a disk.
        expect(eulerCharacteristic(bm)).toBe(1)
        expect(boundaryEdgeCount(bm)).toBe(4)
        expectHealthy(bm)
    })

    it('insets the border of a 2x2 region and leaves its interior alone', () => {
        const {bm, faces, at} = grid(2)
        const centre = at(1, 1)
        const centreBefore = pos(centre)

        const res = insetRegion(bm, faces, {thickness: 0.1})

        // The 8 border edges are split; the 4 interior edges have two tagged faces and are not.
        expect(res.faces.length).toBe(8)
        expect(bm.totvert).toBe(9 + 8)
        expect(bm.totedge).toBe(12 + 8 + 8)
        expect(bm.totface).toBe(4 + 8)
        expect(eulerCharacteristic(bm)).toBe(1)

        // The interior vertex is not on the border, so nothing may move it.
        expect(pos(centre)).toEqual(centreBefore)
        expectHealthy(bm)
    })

    it('insets one face of a cube and keeps the cube closed', () => {
        const {bm} = cube()
        const f = [...bm.faces][0]

        insetRegion(bm, [f], {thickness: 0.1})

        // 4 border edges -> 4 new verts, 4 separated edges + 4 rungs, 4 rim faces.
        expect(bm.totvert).toBe(8 + 4)
        expect(bm.totedge).toBe(12 + 4 + 4)
        expect(bm.totface).toBe(6 + 4)
        expect(eulerCharacteristic(bm)).toBe(2)
        for (const e of bm.edges) expect(edgeIsManifold(e)).toBe(true)
        expectHealthy(bm)
    })

    it('does nothing when the whole of a closed mesh is selected', () => {
        const {bm} = cube()
        const before = {v: bm.totvert, e: bm.totedge, f: bm.totface}

        const res = insetRegion(bm, [...bm.faces], {thickness: 0.1})

        // Every edge has two tagged faces, so there is no border anywhere to inset.
        expect(res.faces).toEqual([])
        expect({v: bm.totvert, e: bm.totedge, f: bm.totface}).toEqual(before)
        expectHealthy(bm)
    })

    it('insets an n-gon', () => {
        const {bm, f} = ngon(7, 2)

        insetRegion(bm, [f], {thickness: 0.2})

        expect(bm.totvert).toBe(7 + 7)
        expect(bm.totedge).toBe(7 + 7 + 7)
        expect(bm.totface).toBe(1 + 7)
        expect(eulerCharacteristic(bm)).toBe(1)
        expectHealthy(bm)
    })

    it('does nothing to a lone face when useBoundary is off', () => {
        const {bm, f} = quad()
        const before = {v: bm.totvert, e: bm.totedge, f: bm.totface}
        const cos = f.verts().map(pos)

        const res = insetRegion(bm, [f], {thickness: 0.1, useBoundary: false})

        expect(res.faces).toEqual([])
        expect({v: bm.totvert, e: bm.totedge, f: bm.totface}).toEqual(before)
        expect(f.verts().map(pos)).toEqual(cos)
        expectHealthy(bm)
    })
})

describe('insetRegion - the offset is really the thickness', () => {
    it('places every new vertex exactly `thickness` from both of its original edges', () => {
        const {bm, v, f} = quad()
        const before = v.map(pos)
        const t = 0.17

        insetRegion(bm, [f], {thickness: t})

        // The face kept its identity and its winding, so loop i still corresponds to original i.
        const after = f.verts().map(pos)
        expect(after.length).toBe(4)
        for (let i = 0; i < 4; i++) {
            const prev = before[(i + 3) % 4]
            const next = before[(i + 1) % 4]
            // Perpendicular distance to the two original edges that met at this corner.
            expect(distToLine(after[i], before[i], next)).toBeCloseTo(t, 12)
            expect(distToLine(after[i], prev, before[i])).toBeCloseTo(t, 12)
        }

        // And the inset square is the original shrunk by `t` on every side.
        for (const p of after) {
            expect(Math.min(p[0], 1 - p[0])).toBeCloseTo(t, 12)
            expect(Math.min(p[1], 1 - p[1])).toBeCloseTo(t, 12)
            expect(p[2]).toBeCloseTo(0, 12)
        }
        expectHealthy(bm)
    })

    it('keeps every face pointing the way it did', () => {
        const {bm, f} = quad()
        const nBefore = v3normalize(faceNormal(f))

        insetRegion(bm, [f], {thickness: 0.2})

        // The inset face must not flip, and the rim must agree with it.
        expect(v3dot(v3normalize(faceNormal(f)), nBefore)).toBeCloseTo(1, 12)
        for (const rim of bm.faces) {
            expect(v3dot(v3normalize(faceNormal(rim)), nBefore)).toBeGreaterThan(0.99)
        }
    })
})

describe('insetRegion - useEvenOffset', () => {
    /**
     * A sliver triangle whose apex angle is under six degrees. The even-offset correction divides by
     * `sin(theta / 2)` there, so the corrected apex lands roughly twenty times further in than the
     * naive bisector walk - the two are not a rounding apart.
     */
    function sliver() {
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0)
        const b = bm.vertCreate(10, -0.5, 0)
        const c = bm.vertCreate(10, 0.5, 0)
        const f = bm.faceCreate([a, b, c])
        // The face keeps its identity and its loop order through an inset, but *not* its vertex
        // objects: separating the border hands the face fresh ones and leaves the originals on the
        // rim. So the apex has to be read back off the face rather than held onto.
        return {bm, f, a: pos(a), b: pos(b), c: pos(c), apex: () => pos(f.verts()[0])}
    }

    it('puts the sharp corner at `thickness` from both of its edges', () => {
        const {bm, f, a, b, c, apex} = sliver()
        const t = 0.05

        insetRegion(bm, [f], {thickness: t, useEvenOffset: true})

        const p = apex()
        expect(distToLine(p, a, b)).toBeCloseTo(t, 12)
        expect(distToLine(p, a, c)).toBeCloseTo(t, 12)
        expectHealthy(bm)
    })

    it('walks only `thickness` along the bisector when the correction is off', () => {
        const {bm, f, a, b, c, apex} = sliver()
        const t = 0.05

        insetRegion(bm, [f], {thickness: t, useEvenOffset: false})

        // Without the correction the vertex moves `thickness` along the *normalized* bisector of the
        // two inward edge normals, which is Blender's `tvec` before `shell_v3v3_mid_normalized_to_dist`.
        const nAB = v3normalize([-(b[1] - a[1]), b[0] - a[0], 0])
        const nAC = v3normalize([c[1] - a[1], -(c[0] - a[0]), 0])
        const expected = v3add(a, v3mul(v3normalize(v3add(nAB, nAC)), t))

        const p = apex()
        expect(p[0]).toBeCloseTo(expected[0], 12)
        expect(p[1]).toBeCloseTo(expected[1], 12)

        // ...which leaves it far short of `thickness` from either edge.
        expect(distToLine(p, a, b)).toBeLessThan(t * 0.1)
        expectHealthy(bm)
    })

    it('the two flag settings differ by much more than a rounding error', () => {
        const even = sliver()
        insetRegion(even.bm, [even.f], {thickness: 0.05, useEvenOffset: true})
        const naive = sliver()
        insetRegion(naive.bm, [naive.f], {thickness: 0.05, useEvenOffset: false})

        const d = v3len(v3sub(even.apex(), naive.apex()))
        expect(d).toBeGreaterThan(0.9)
    })

    it('makes no difference at a right-angled corner, where the bisector is already even', () => {
        // A square corner is the one case where the correction cancels against the bisector walk in
        // the perpendicular direction, which is why a square is a useless test for this flag.
        const a = quad()
        insetRegion(a.bm, [a.f], {thickness: 0.1, useEvenOffset: true})
        const b = quad()
        insetRegion(b.bm, [b.f], {thickness: 0.1, useEvenOffset: false})

        const da = distToLine(pos(a.f.verts()[0]), [0, 0, 0], [1, 0, 0])
        const db = distToLine(pos(b.f.verts()[0]), [0, 0, 0], [1, 0, 0])
        expect(da).toBeCloseTo(0.1, 12)
        // The naive walk is `thickness * cos(45)` from each edge, not `thickness`.
        expect(db).toBeCloseTo(0.1 * Math.SQRT1_2, 12)
    })
})

describe('insetRegion - the one-split-edge boundary vertex', () => {
    /**
     * Two quads sharing S-T, inset with only the *shared* edge split (`useBoundary` off), so the
     * corner at S has exactly one split edge. That is Blender's "1 edge user - boundary vert, not so
     * common" branch, and it aligns the offset with the unsplit border edge rather than with the
     * split edge's face tangent - "we want the inset to align flush with the boundary edge, not the
     * normal of the interior edge, which would give an unsightly bump".
     *
     * The border edge here deliberately does *not* meet S-T at a right angle. Where it does, the
     * even-offset correction is exactly 1 and the flag cannot be observed at all.
     */
    function skewPair() {
        const bm = new BMesh()
        const s = bm.vertCreate(0, 0, 0)
        const t = bm.vertCreate(0, 1, 0)
        const p1 = bm.vertCreate(-1, -0.6, 0)
        const p2 = bm.vertCreate(-1, 1.6, 0)
        const q1 = bm.vertCreate(1, -0.6, 0)
        const q2 = bm.vertCreate(1, 1.6, 0)
        const a = bm.faceCreate([s, t, p2, p1])
        bm.faceCreate([t, s, q1, q2])
        return {bm, a, cornerAtS: () => pos(a.verts()[0]), p1: pos(p1)}
    }

    it('slides along the unsplit border edge, at `thickness` from the split one', () => {
        const {bm, a, cornerAtS, p1} = skewPair()
        const t = 0.1

        insetRegion(bm, [a], {thickness: t, useBoundary: false, useEvenOffset: true})

        const p = cornerAtS()
        // It moved along S -> P1 and nowhere else.
        const dir = v3normalize(v3sub(p, [0, 0, 0]))
        const along = v3normalize(p1)
        expect(v3dot(dir, along)).toBeCloseTo(1, 10)
        // ...and the even-offset correction put it exactly `thickness` from the split edge S-T.
        expect(distToLine(p, [0, 0, 0], [0, 1, 0])).toBeCloseTo(t, 12)
        expectHealthy(bm)
    })

    it('ignores the border edge entirely when the correction is off', () => {
        const {bm, a, cornerAtS} = skewPair()
        const t = 0.1

        insetRegion(bm, [a], {thickness: t, useBoundary: false, useEvenOffset: false})

        // `use_even_boundary` is `use_even_offset` (Blender's "could make own option"), so turning
        // the flag off drops the *whole* border-alignment branch, not just its shell correction:
        // `tvec` falls back to the split edge's own face tangent, which here is -X. The corner
        // therefore leaves the border instead of sliding along it - the "unsightly bump" the
        // alignment exists to avoid.
        const p = cornerAtS()
        expect(p[0]).toBeCloseTo(-t, 12)
        expect(p[1]).toBeCloseTo(0, 12)
        expectHealthy(bm)
    })
})

describe('insetRegion - useRelativeOffset', () => {
    it('scales the offset by the edge lengths, so a bigger face insets further', () => {
        const small = quad(1)
        insetRegion(small.bm, [small.f], {thickness: 0.1, useRelativeOffset: true})
        const big = quad(4)
        insetRegion(big.bm, [big.f], {thickness: 0.1, useRelativeOffset: true})

        // Each corner averages the two split edges meeting there, so the factor is the side length.
        const dSmall = distToLine(pos(small.f.verts()[0]), [0, 0, 0], [1, 0, 0])
        const dBig = distToLine(pos(big.f.verts()[0]), [0, 0, 0], [4, 0, 0])
        expect(dSmall).toBeCloseTo(0.1 * 1, 12)
        expect(dBig).toBeCloseTo(0.1 * 4, 12)
        expect(dBig / dSmall).toBeCloseTo(4, 10)
    })

    it('is off by default, so face size does not change the offset', () => {
        const small = quad(1)
        insetRegion(small.bm, [small.f], {thickness: 0.1})
        const big = quad(4)
        insetRegion(big.bm, [big.f], {thickness: 0.1})

        expect(distToLine(pos(small.f.verts()[0]), [0, 0, 0], [1, 0, 0])).toBeCloseTo(0.1, 12)
        expect(distToLine(pos(big.f.verts()[0]), [0, 0, 0], [4, 0, 0])).toBeCloseTo(0.1, 12)
    })
})

describe('insetRegion - depth', () => {
    it('moves the inset face along the normal by exactly `depth`', () => {
        const {bm, f} = quad()

        insetRegion(bm, [f], {thickness: 0.2, depth: 0.35})

        for (const v of f.verts()) {
            expect(v.z).toBeCloseTo(0.35, 12)
            // The thickness still applied in the plane.
            expect(Math.min(v.x, 1 - v.x)).toBeCloseTo(0.2, 12)
        }
        // The rim stayed where the original boundary was.
        for (const rim of bm.faces) {
            if (rim === f) continue
            expect(rim.verts().some(v => Math.abs(v.z) < 1e-12)).toBe(true)
        }
        expectHealthy(bm)
    })

    it('takes depth in the negative direction too', () => {
        const {bm, f} = quad()
        insetRegion(bm, [f], {thickness: 0.2, depth: -0.5})
        for (const v of f.verts()) expect(v.z).toBeCloseTo(-0.5, 12)
        expectHealthy(bm)
    })

    it('scales depth by the surrounding edge lengths under useRelativeOffset', () => {
        const {bm, f} = quad(3)
        insetRegion(bm, [f], {thickness: 0.1, depth: 0.2, useRelativeOffset: true})
        // Every split edge is 3 long, so `bm_edge_info_average_length` returns 3 at every vertex.
        for (const v of f.verts()) expect(v.z).toBeCloseTo(0.2 * 3, 12)
        expectHealthy(bm)
    })

    it('fills in a length for an interior vertex no split edge touches', () => {
        // The middle vertex of a 3x3 region is two edges away from the border, which is the only
        // thing `bm_edge_info_average_length_fallback` exists for.
        const {bm, faces, at} = grid(3)
        insetRegion(bm, faces, {thickness: 0.1, depth: 0.25, useRelativeOffset: true})

        for (const v of [at(1, 1), at(2, 2), at(1, 2), at(2, 1)]) {
            // Every edge in the grid is unit length, so the flood average is 1 everywhere.
            expect(v.z).toBeCloseTo(0.25, 10)
        }
        expectHealthy(bm)
    })
})

describe('insetRegion - useBoundary', () => {
    it('insets the open border when on, and only the shared edges when off', () => {
        const withBoundary = grid(2)
        const a = withBoundary.faces[0]
        const resA = insetRegion(withBoundary.bm, [a], {thickness: 0.1, useBoundary: true})

        // All four edges of the face are split: two shared with neighbours, two on the open border.
        expect(resA.faces.length).toBe(4)
        for (const v of a.verts()) {
            expect(Math.min(v.x, 1 - v.x)).toBeCloseTo(0.1, 12)
            expect(Math.min(v.y, 1 - v.y)).toBeCloseTo(0.1, 12)
        }
        expectHealthy(withBoundary.bm)

        const without = grid(2)
        const b = without.faces[0]
        const resB = insetRegion(without.bm, [b], {thickness: 0.1, useBoundary: false})

        // Only the two shared edges are split, so only two rim faces exist.
        expect(resB.faces.length).toBe(2)
        const cos = b.verts().map(pos)
        // The corner away from both neighbours has no split edge and cannot move at all.
        expect(cos.filter(p => Math.abs(p[0]) < 1e-12 && Math.abs(p[1]) < 1e-12).length).toBe(1)
        // The two border verts slide along the open border instead of inwards.
        expect(cos.filter(p => Math.abs(p[1]) < 1e-12).length).toBe(2)
        expect(cos.filter(p => Math.abs(p[0]) < 1e-12).length).toBe(2)
        // ...and the inner corner still moves diagonally.
        expect(cos.some(p => Math.abs(p[0] - 0.9) < 1e-12 && Math.abs(p[1] - 0.9) < 1e-12)).toBe(true)
        expectHealthy(without.bm)
    })
})

describe('insetRegion - useOutset', () => {
    it('grows outside the original face instead of inside it', () => {
        const inside = grid(3)
        const centreIn = inside.faces[4]
        const resIn = insetRegion(inside.bm, [centreIn], {thickness: 0.2})

        const outside = grid(3)
        const centreOut = outside.faces[4]
        const resOut = insetRegion(outside.bm, [centreOut], {thickness: 0.2, useOutset: true})

        // Same rim size either way - the border is the same four edges.
        expect(resIn.faces.length).toBe(4)
        expect(resOut.faces.length).toBe(4)

        // The original face occupied [1, 2] x [1, 2]. Inset puts the new geometry inside that
        // square; outset puts it outside.
        const inSquare = (p: Vec3) => p[0] > 1 - 1e-9 && p[0] < 2 + 1e-9 && p[1] > 1 - 1e-9 && p[1] < 2 + 1e-9
        for (const f of resIn.faces) expect(inSquare(faceCenter(f))).toBe(true)
        for (const f of resOut.faces) expect(inSquare(faceCenter(f))).toBe(false)

        // Outset leaves the selected face itself where it was and eats into its neighbours.
        for (const v of centreOut.verts()) {
            expect(Math.min(Math.abs(v.x - 1), Math.abs(v.x - 2))).toBeCloseTo(0, 12)
        }
        // Inset shrinks it by exactly the thickness.
        for (const v of centreIn.verts()) {
            expect(Math.min(Math.abs(v.x - 1.2), Math.abs(v.x - 1.8))).toBeCloseTo(0, 12)
        }

        expectHealthy(inside.bm)
        expectHealthy(outside.bm)
    })

    it('forces useBoundary off, since an outset region has no open border of its own', () => {
        // Outsetting a lone quad inverts the tag to "no faces", so no edge is mixed and nothing
        // happens - even with useBoundary explicitly on.
        const {bm, f} = quad()
        const res = insetRegion(bm, [f], {thickness: 0.1, useOutset: true, useBoundary: true})
        expect(res.faces).toEqual([])
        expect(bm.totface).toBe(1)
    })
})

describe('insetRegion - useEdgeRail', () => {
    /**
     * Two quads sharing the edge S-T, with deliberately *unequal* border edges leaving S.
     *
     * The asymmetry is the whole fixture. Take two adjacent cube faces instead and the rail changes
     * nothing at all: both border edges at the shared corner are perpendicular to the shared edge, so
     * their two face tangents are the same vector and the bisector already points straight down the
     * rail. That configuration cannot tell the flag's two settings apart, and a test built on it would
     * pass against an implementation that ignored `use_edge_rail` entirely.
     */
    function railPair() {
        const bm = new BMesh()
        const s = bm.vertCreate(0, 0, 0)
        const t = bm.vertCreate(0, 1, 0)
        const p1 = bm.vertCreate(-1, -0.6, 0)
        const p2 = bm.vertCreate(-1, 1.6, 0)
        const q1 = bm.vertCreate(1, 0.3, 0)
        const q2 = bm.vertCreate(1, 1.6, 0)
        const a = bm.faceCreate([s, t, p2, p1])
        const b = bm.faceCreate([t, s, q1, q2])
        // `a.verts()[0]` is the corner that started life at S; the vertex object itself ends up on
        // the rim once the border is separated.
        return {bm, region: [a, b], cornerAtS: () => pos(a.verts()[0])}
    }

    it('slides the shared corner along the shared edge instead of into the corner', () => {
        const railed = railPair()
        insetRegion(railed.bm, railed.region, {thickness: 0.1, useEdgeRail: true})
        expectHealthy(railed.bm)

        const plain = railPair()
        insetRegion(plain.bm, plain.region, {thickness: 0.1, useEdgeRail: false})
        expectHealthy(plain.bm)

        // Same topology either way; the flag only chooses a direction.
        expect(railed.bm.totvert).toBe(plain.bm.totvert)
        expect(railed.bm.totedge).toBe(plain.bm.totedge)
        expect(railed.bm.totface).toBe(plain.bm.totface)

        // With the rail on, the corner moves straight along S -> T, which here is +Y.
        const railedDelta = v3normalize(v3sub(railed.cornerAtS(), [0, 0, 0]))
        expect(Math.abs(railedDelta[0])).toBeLessThan(1e-12)
        expect(railedDelta[1]).toBeCloseTo(1, 12)

        // With it off, the corner follows the bisector of the two border tangents, which the
        // asymmetric fixture deliberately makes point off the shared edge.
        const plainDelta = v3normalize(v3sub(plain.cornerAtS(), [0, 0, 0]))
        expect(Math.abs(plainDelta[0])).toBeGreaterThan(0.3)

        expect(v3len(v3sub(railed.cornerAtS(), plain.cornerAtS()))).toBeGreaterThan(1e-3)
    })
})

describe('insetIndividual', () => {
    it('insets a lone quad the same way the region form does', () => {
        const {bm, v, f} = quad()
        const before = v.map(pos)
        const t = 0.13

        const res = insetIndividual(bm, [f], {thickness: t})

        expect(bm.totvert).toBe(4 + 4)
        expect(bm.totedge).toBe(4 + 4 + 4)
        expect(bm.totface).toBe(1 + 4)
        expect(res.faces.length).toBe(4)
        expect(eulerCharacteristic(bm)).toBe(1)

        for (const p of f.verts().map(pos)) {
            expect(Math.min(p[0], 1 - p[0])).toBeCloseTo(t, 12)
            expect(Math.min(p[1], 1 - p[1])).toBeCloseTo(t, 12)
        }
        // The rim is still the original outline.
        for (const p of before) {
            expect([...bm.verts].some(w => v3len(v3sub(pos(w), p)) < 1e-12)).toBe(true)
        }
        expectHealthy(bm)
    })

    it('insets an n-gon', () => {
        const {bm, f} = ngon(7, 2)
        insetIndividual(bm, [f], {thickness: 0.2})

        expect(bm.totvert).toBe(7 + 7)
        expect(bm.totedge).toBe(7 * 3)
        expect(bm.totface).toBe(1 + 7)
        expect(eulerCharacteristic(bm)).toBe(1)
        expectHealthy(bm)
    })

    it('pulls every face of a 2x2 grid apart from its neighbours', () => {
        const {bm, faces} = grid(2)

        const res = insetIndividual(bm, faces, {thickness: 0.1})

        // Each face gets 4 private verts (16), the original 9 keep the outline.
        // Edges: 4 x 4 private + 12 outline + 4 x 4 rungs.
        // Faces: 4 inset + 4 x 4 rim.
        expect(bm.totvert).toBe(9 + 16)
        expect(bm.totedge).toBe(16 + 12 + 16)
        expect(bm.totface).toBe(4 + 16)
        expect(res.faces.length).toBe(16)
        expect(eulerCharacteristic(bm)).toBe(1)

        // Each original face is now a 0.8 square inside its own cell.
        for (const f of faces) {
            const c = faceCenter(f)
            for (const v of f.verts()) {
                expect(Math.abs(Math.abs(v.x - c[0]) - 0.4)).toBeLessThan(1e-12)
                expect(Math.abs(Math.abs(v.y - c[1]) - 0.4)).toBeLessThan(1e-12)
            }
        }
        expectHealthy(bm)
    })

    it('insets every face of a cube and keeps it closed', () => {
        const {bm} = cube()
        const faces = [...bm.faces]

        insetIndividual(bm, faces, {thickness: 0.1})

        // 6 x 4 private verts; 6 x 4 private edges + 12 outline + 6 x 4 rungs; 6 + 24 faces.
        expect(bm.totvert).toBe(8 + 24)
        expect(bm.totedge).toBe(24 + 12 + 24)
        expect(bm.totface).toBe(6 + 24)
        expect(eulerCharacteristic(bm)).toBe(2)
        for (const e of bm.edges) expect(edgeIsManifold(e)).toBe(true)
        expectHealthy(bm)
    })

    it('honours useEvenOffset on a sharp corner', () => {
        function sliver() {
            const bm = new BMesh()
            const a = bm.vertCreate(0, 0, 0)
            const b = bm.vertCreate(10, -0.5, 0)
            const c = bm.vertCreate(10, 0.5, 0)
            const f = bm.faceCreate([a, b, c])
            return {bm, f, apex: () => pos(f.verts()[0])}
        }

        const t = 0.05
        const even = sliver()
        insetIndividual(even.bm, [even.f], {thickness: t, useEvenOffset: true})
        expect(distToLine(even.apex(), [0, 0, 0], [10, -0.5, 0])).toBeCloseTo(t, 12)

        const naive = sliver()
        insetIndividual(naive.bm, [naive.f], {thickness: t, useEvenOffset: false})
        expect(distToLine(naive.apex(), [0, 0, 0], [10, -0.5, 0])).toBeLessThan(t * 0.1)

        expect(v3len(v3sub(even.apex(), naive.apex()))).toBeGreaterThan(0.9)
    })

    it('honours depth and useRelativeOffset', () => {
        const plain = quad(1)
        insetIndividual(plain.bm, [plain.f], {thickness: 0.1, depth: 0.3})
        for (const v of plain.f.verts()) expect(v.z).toBeCloseTo(0.3, 12)

        const relative = quad(3)
        insetIndividual(relative.bm, [relative.f], {thickness: 0.1, depth: 0.2, useRelativeOffset: true})
        for (const v of relative.f.verts()) expect(v.z).toBeCloseTo(0.2 * 3, 12)
        // The in-plane offset scales too.
        for (const v of relative.f.verts()) expect(Math.min(v.x, 3 - v.x)).toBeCloseTo(0.1 * 3, 12)

        expectHealthy(plain.bm)
        expectHealthy(relative.bm)
    })

    it('does not flip any face normal', () => {
        const {bm, f} = quad()
        const nBefore = v3normalize(faceNormal(f))
        insetIndividual(bm, [f], {thickness: 0.2})
        for (const face of bm.faces) {
            expect(v3dot(v3normalize(faceNormal(face)), nBefore)).toBeGreaterThan(0.99)
        }
    })
})

describe('insetSelection', () => {
    it('insets the selected faces and returns null when nothing is selected', () => {
        const {bm, faces} = grid(2)
        selectNone(bm)
        expect(insetSelection(bm, {thickness: 0.1})).toBe(null)

        faceSelectSet(bm, faces[0], true)
        const res = insetSelection(bm, {thickness: 0.1})!
        expect(res.faces.length).toBe(4)
        expectHealthy(bm)
    })

    it('leaves the input faces selected, as MESH_OT_inset does by default', () => {
        const {bm, f} = quad()
        insetRegion(bm, [f], {thickness: 0.1})

        expect(f.selected).toBe(true)
        expect(bm.totfacesel).toBe(1)
        // The counters must agree with the flags, or later selection ops drift.
        expect([...bm.faces].filter(x => x.selected).length).toBe(bm.totfacesel)
        expect([...bm.verts].filter(x => x.selected).length).toBe(bm.totvertsel)
        expect([...bm.edges].filter(x => x.selected).length).toBe(bm.totedgesel)
    })

    it('leaves the selection alone when selectResult is false', () => {
        const {bm, f} = quad()
        selectNone(bm)
        insetRegion(bm, [f], {thickness: 0.1, selectResult: false})
        expect(bm.totfacesel).toBe(0)
        expect([...bm.faces].filter(x => x.selected).length).toBe(0)
    })
})

describe('inset - useInterpolate', () => {
    /**
     * A quad carrying a UV map that is the identity on its own geometry: corner `(x, y)` has UV
     * `(x, y)`. Any correct spatial interpolation must therefore leave every corner's UV equal to its
     * position, wherever the inset moves it - so one assertion covers the whole mesh, and a copy of
     * the neighbouring corner's value (which is what the non-interpolated path does) fails it.
     */
    function uvQuad() {
        const {bm, f} = quad()
        const uv = bm.addLayer('loop', 'uv_map', 'float2')
        for (const l of f.eachLoop()) setValue(l, bm.ldata, uv, [l.v.x, l.v.y])
        return {bm, f, uv}
    }

    // 6 places, not 12: a float2 layer is a `Float32Array`, so a value like 0.3 comes back about
    // 1.2e-8 out however exact the arithmetic was.
    function expectUvMatchesPosition(bm: BMesh, uv: ReturnType<BMesh['addLayer']>): void {
        for (const f of bm.faces) {
            for (const l of f.eachLoop()) {
                const value = getValue(l, uv)
                expect(value[0]).toBeCloseTo(l.v.x, 6)
                expect(value[1]).toBeCloseTo(l.v.y, 6)
            }
        }
    }

    it('re-samples the region face and its rim from the face as it was', () => {
        const {bm, uv} = uvQuad()
        const f = [...bm.faces][0]

        insetRegion(bm, [f], {thickness: 0.25, useInterpolate: true})

        expectUvMatchesPosition(bm, uv)
        expectHealthy(bm)
    })

    it('does the same for the individual form', () => {
        const {bm, uv} = uvQuad()
        const f = [...bm.faces][0]

        insetIndividual(bm, [f], {thickness: 0.25, useInterpolate: true})

        expectUvMatchesPosition(bm, uv)
        expectHealthy(bm)
    })

    it('without it, the inner corners keep the border values instead', () => {
        const {bm, uv} = uvQuad()
        const f = [...bm.faces][0]

        insetRegion(bm, [f], {thickness: 0.25, useInterpolate: false})

        // The inset face's corners moved to 0.25 / 0.75 but still carry the original 0 / 1 UVs.
        const off = [...f.eachLoop()].filter(l => {
            const value = getValue(l, uv)
            return Math.abs(value[0] - l.v.x) > 0.2 || Math.abs(value[1] - l.v.y) > 0.2
        })
        expect(off.length).toBe(4)
        expectHealthy(bm)
    })

    it('interpolates a region over a grid, where the rim samples mid-face values', () => {
        const {bm, faces, v} = grid(2)
        const uv = bm.addLayer('loop', 'uv_map', 'float2')
        for (const f of bm.faces) for (const l of f.eachLoop()) setValue(l, bm.ldata, uv, [l.v.x, l.v.y])
        expect(v.length).toBe(9)

        insetRegion(bm, faces, {thickness: 0.3, useInterpolate: true})

        expectUvMatchesPosition(bm, uv)
        expectHealthy(bm)
    })

    it('is off by default, matching the operator slot rather than MESH_OT_inset', () => {
        const {bm, uv} = uvQuad()
        const f = [...bm.faces][0]
        insetRegion(bm, [f], {thickness: 0.25})
        const first = getValue([...f.eachLoop()][0], uv)
        // Unchanged from the original corner value, not re-sampled at the new position.
        expect(first[0]).toBeCloseTo(0, 12)
        expect(first[1]).toBeCloseTo(0, 12)
    })
})

describe('inset - degenerate input', () => {
    it('does nothing for an empty face list', () => {
        const {bm} = quad()
        expect(insetRegion(bm, [], {thickness: 0.1})).toEqual({faces: [], verts: [], edges: []})
        expect(insetIndividual(bm, [], {thickness: 0.1})).toEqual({faces: [], verts: [], edges: []})
        expect(bm.totface).toBe(1)
    })

    it('is a no-op at zero thickness, but still builds the rim', () => {
        const {bm, f} = quad()
        insetRegion(bm, [f], {thickness: 0})
        expect(bm.totvert).toBe(8)
        expect(bm.totface).toBe(5)
        // Every rim face is degenerate but the topology has to stay valid.
        expect(bm.validate()).toEqual([])
        expect(bmToMesh(bm).validate()).toEqual([])
    })
})

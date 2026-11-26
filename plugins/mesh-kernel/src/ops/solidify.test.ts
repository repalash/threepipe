import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMFace, BMVert} from '../bmesh/types'
import {bmToMesh} from '../bmesh/convert'
import {createCone} from '../generate/primitives'
import {faceSelectSet, selectNone} from '../bmesh/marking'
import {AttrName, ElemFlag} from '../constants'
import {getComponent} from '../bmesh/customdata'
import {Vec3, v3add, v3cross, v3dot, v3len, v3mul, v3normalize, v3sub} from '../math'
import {
    boundaryEdgeCount,
    degenerateFaceProblems,
    eulerCharacteristic,
    faceCenter,
    faceNormal,
    signedVolume6,
    windingProblems,
} from '../generate/topology.testutil'
import {SolidifyOptions, solidify, solidifySelection} from './solidify'

// region fixtures

/** One quad on the XY plane, wound so its normal is +Z. */
function quad(w = 1, h = 1) {
    const bm = new BMesh()
    const v = [
        bm.vertCreate(0, 0, 0),
        bm.vertCreate(w, 0, 0),
        bm.vertCreate(w, h, 0),
        bm.vertCreate(0, h, 0),
    ]
    const f = bm.faceCreate(v)
    return {bm, v, f}
}

/** An `n` by `n` quad grid on the XY plane, normals +Z. */
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

/** A closed unit cube, outward wound. */
function cube() {
    const bm = new BMesh()
    const s = 0.5
    const co: Vec3[] = [
        [-s, -s, -s], [-s, -s, s], [-s, s, -s], [-s, s, s],
        [s, -s, -s], [s, -s, s], [s, s, -s], [s, s, s],
    ]
    const verts = co.map(c => bm.vertCreate(c[0], c[1], c[2]))
    const faces = [[0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]]
        .map(f => bm.faceCreate(f.map(i => verts[i])))
    return {bm, verts, faces}
}

/**
 * Two unit quads meeting at a right angle along the Y axis, forming a convex ridge: one lying on
 * `z = 0` facing +Z and reaching out to `x = -1`, one standing on `x = 0` facing +X and reaching
 * down to `z = -1`. The solid is the quadrant `x < 0, z < 0`, so the 270 degrees of space outside
 * the crease make it convex - the outside of a box corner, not a groove.
 *
 * The two vertices on the crease, `o` and `p`, have a vertex normal 45 degrees off both faces, which
 * is exactly where a naive offset comes out thin.
 */
function fold() {
    const bm = new BMesh()
    const o = bm.vertCreate(0, 0, 0)
    const p = bm.vertCreate(0, 1, 0)
    const a0 = bm.vertCreate(-1, 0, 0)
    const a1 = bm.vertCreate(-1, 1, 0)
    const b0 = bm.vertCreate(0, 0, -1)
    const b1 = bm.vertCreate(0, 1, -1)
    // `flat` walks the crease o -> p, so `up` must walk it p -> o for the two to agree.
    const flat = bm.faceCreate([a0, o, p, a1])
    const up = bm.faceCreate([p, o, b0, b1])
    return {bm, o, p, a0, a1, b0, b1, flat, up}
}

/**
 * Two triangles sharing the edge `o -> p`, with *different* corner angles at `o`: 90 degrees in the
 * one lying on `z = 0`, and `acos(0.5 / sqrt(1.25))` in the one standing on `x = 0`.
 *
 * The asymmetry is the point. It is what makes the two candidate vertex normals (face-angle-weighted
 * and high-quality edge-weighted) differ, and what makes the even-offset corner weighting visible -
 * on a symmetric fold every weighting scheme gives the same answer.
 */
function slantedPair() {
    const bm = new BMesh()
    const o = bm.vertCreate(0, 0, 0)
    const p = bm.vertCreate(0, 1, 0)
    const a = bm.vertCreate(2, 0, 0)
    const b = bm.vertCreate(0, 0.5, 1)
    const t1 = bm.faceCreate([o, a, p])
    const t2 = bm.faceCreate([o, p, b])
    return {bm, o, p, a, b, t1, t2}
}

/**
 * Three triangles meeting at `o`, no two of them at the same angle to each other. Needed because a
 * vertex with only two faces cannot tell the high-quality normal apart from a plain sum of face
 * normals: both land on the bisector of the two, whatever weights they use.
 */
function corner() {
    const bm = new BMesh()
    const o = bm.vertCreate(0, 0, 0)
    const a = bm.vertCreate(1, 0, 0)
    const b = bm.vertCreate(0, 1, 0)
    const c = bm.vertCreate(0, -1, -1)
    const fa = bm.faceCreate([o, a, b])
    const fb = bm.faceCreate([b, c, o])
    const fc = bm.faceCreate([a, o, c])
    return {bm, o, a, b, c, fa, fb, fc}
}

/** Newell's normal for a triangle, written out rather than taken from the operator. */
function triNormal(p0: Vec3, p1: Vec3, p2: Vec3): Vec3 {
    return v3normalize(v3cross(v3sub(p1, p0), v3sub(p2, p0)))
}

/** An open tube: a cylinder with no caps, so it has two boundary rings. */
function tube(segments = 8) {
    const bm = new BMesh()
    const res = createCone(bm, {segments, capEnds: false, selectResult: false})
    return {bm, faces: res.faces}
}

const co = (v: BMVert): Vec3 => [v.x, v.y, v.z]

function assertClean(bm: BMesh): void {
    expect(bm.validate()).toEqual([])
    expect(degenerateFaceProblems(bm)).toEqual([])
    expect(bmToMesh(bm).validate()).toEqual([])
}

/** Distance from `v` to the plane through `origin` with unit normal `n`, signed. */
function planeDistance(v: BMVert, origin: Vec3, n: Vec3): number {
    return v3dot([v.x - origin[0], v.y - origin[1], v.z - origin[2]], n)
}

// endregion

describe('solidify element counts', () => {
    it('turns one quad into a closed box: 8 verts, 12 edges, 6 faces', () => {
        const {bm, f} = quad()
        const res = solidify(bm, [f], {thickness: 0.25})

        expect(bm.totvert).toBe(8)
        expect(bm.totedge).toBe(12)
        expect(bm.totface).toBe(6)
        expect(res.innerFaces.length).toBe(1)
        expect(res.rimFaces.length).toBe(4)
        expect(res.verts.length).toBe(4)
        expect(res.edges.length).toBe(8)
        expect(eulerCharacteristic(bm)).toBe(2)
        expect(boundaryEdgeCount(bm)).toBe(0)
        assertClean(bm)
    })

    it('leaves two separate open shells when the rim is off', () => {
        const {bm, f} = quad()
        const res = solidify(bm, [f], {thickness: 0.25, useRim: false})

        expect(bm.totvert).toBe(8)
        expect(bm.totedge).toBe(8)
        expect(bm.totface).toBe(2)
        expect(res.rimFaces.length).toBe(0)
        // Two disks: chi = 1 each, and every edge of both is still a border.
        expect(eulerCharacteristic(bm)).toBe(2 * 1)
        expect(boundaryEdgeCount(bm)).toBe(8)
        assertClean(bm)
    })

    it('adds only a skirt under useRimOnly, leaving the input surface single-sided', () => {
        const {bm, f} = quad()
        const res = solidify(bm, [f], {thickness: 0.25, useRimOnly: true})

        expect(res.innerFaces.length).toBe(0)
        expect(res.rimFaces.length).toBe(4)
        expect(bm.totvert).toBe(8)
        // 4 input + 4 across the shell + 4 along the far edge of the skirt.
        expect(bm.totedge).toBe(12)
        expect(bm.totface).toBe(5)
        expect(eulerCharacteristic(bm)).toBe(1)
        // The far edge of each skirt quad is still open.
        expect(boundaryEdgeCount(bm)).toBe(4)
        assertClean(bm)
    })

    it('closes a 2x2 grid: 18 verts, 32 edges, 16 faces', () => {
        const {bm, faces} = grid(2)
        expect([bm.totvert, bm.totedge, bm.totface]).toEqual([9, 12, 4])

        const res = solidify(bm, faces, {thickness: 0.1})
        expect(bm.totvert).toBe(18)
        expect(bm.totedge).toBe(32)
        expect(bm.totface).toBe(16)
        expect(res.innerFaces.length).toBe(4)
        // 8 boundary edges of the grid, one rim quad each.
        expect(res.rimFaces.length).toBe(8)
        expect(eulerCharacteristic(bm)).toBe(2)
        expect(boundaryEdgeCount(bm)).toBe(0)
        assertClean(bm)
    })

    it('gives a closed cube two nested closed shells and no rim at all', () => {
        const {bm, faces} = cube()
        const res = solidify(bm, faces, {thickness: 0.1})

        // Nothing is on a boundary, so `use_rim` has nothing to do.
        expect(res.rimFaces.length).toBe(0)
        expect(bm.totvert).toBe(16)
        expect(bm.totedge).toBe(24)
        expect(bm.totface).toBe(12)
        // Two closed surfaces: 2 + 2.
        expect(eulerCharacteristic(bm)).toBe(4)
        expect(boundaryEdgeCount(bm)).toBe(0)
        assertClean(bm)
    })

    it('turns an open tube into a closed ring, chi 0 because it is genus 1', () => {
        const {bm, faces} = tube(8)
        expect([bm.totvert, bm.totedge, bm.totface]).toEqual([16, 24, 8])
        expect(boundaryEdgeCount(bm)).toBe(16)

        const res = solidify(bm, faces, {thickness: 0.1})
        expect(bm.totvert).toBe(32)
        // 24 input + 24 inner + 16 across the shell.
        expect(bm.totedge).toBe(64)
        expect(bm.totface).toBe(32)
        expect(res.rimFaces.length).toBe(16)
        expect(boundaryEdgeCount(bm)).toBe(0)
        expect(eulerCharacteristic(bm)).toBe(0)
        assertClean(bm)
    })

    it('leaves an open tube open with the rim off', () => {
        const {bm, faces} = tube(8)
        solidify(bm, faces, {thickness: 0.1, useRim: false})
        expect(bm.totvert).toBe(32)
        expect(bm.totedge).toBe(48)
        expect(bm.totface).toBe(16)
        expect(boundaryEdgeCount(bm)).toBe(32)
        assertClean(bm)
    })

    it('does nothing for an empty face list', () => {
        const bm = new BMesh()
        const res = solidify(bm, [])
        expect(res.faces).toEqual([])
        expect(res.verts).toEqual([])
        expect(res.edges).toEqual([])
        expect(bm.totvert).toBe(0)
    })
})

describe('solidify thickness', () => {
    it('puts the two surfaces exactly `thickness` apart along the normal', () => {
        const {bm, f, v} = quad()
        const res = solidify(bm, [f], {thickness: 0.25})

        // The plane is z = 0 with normal +Z, so the shell's separation is a z difference.
        for (const src of v) {
            const dst = res.vertMap.get(src)!
            expect(dst.x).toBeCloseTo(src.x, 12)
            expect(dst.y).toBeCloseTo(src.y, 12)
            expect(Math.abs(dst.z - src.z)).toBeCloseTo(0.25, 12)
        }
        const outer = faceCenter(f)
        const inner = faceCenter(res.innerFaces[0])
        expect(Math.abs(outer[2] - inner[2])).toBeCloseTo(0.25, 12)
    })

    it('holds the thickness for a negative value, putting the shell on the other side', () => {
        // ofs_orig = +0.3 and ofs_new = 0, and `ofs_new >= ofs_orig` is now false, so the macro at
        // `:403` hands the moving offset to the input surface instead of to the copy. The shell ends
        // up above the input plane rather than below it, which is what a negative thickness means.
        const {bm, f, v} = quad()
        const res = solidify(bm, [f], {thickness: -0.3})
        for (const src of v) expect(src.z).toBeCloseTo(0.3, 12)
        for (const dst of res.vertMap.values()) expect(dst.z).toBeCloseTo(0, 12)
        for (const [src, dst] of res.vertMap) expect(Math.abs(dst.z - src.z)).toBeCloseTo(0.3, 12)
    })

    it('measures the thickness on a tube radially, not along a chord', () => {
        const {bm, faces} = tube(32)
        const before = [...bm.verts].map(v => Math.hypot(v.x, v.y))
        const res = solidify(bm, faces, {thickness: 0.05})
        // Every input vertex is on the unit cylinder, so its copy must be on the 0.95 one.
        let checked = 0
        for (const [src, dst] of res.vertMap) {
            expect(Math.hypot(src.x, src.y)).toBeCloseTo(1, 6)
            expect(Math.hypot(dst.x, dst.y)).toBeCloseTo(0.95, 6)
            expect(dst.z).toBeCloseTo(src.z, 12)
            checked++
        }
        expect(checked).toBe(before.length)
    })
})

describe('solidify offset placement', () => {
    // Blender: ofs_orig = -(((-offset_fac + 1) * 0.5) * thickness), ofs_new = thickness + ofs_orig.
    const t = 0.4

    it('at offset -1 keeps the input surface as the outer one', () => {
        const {bm, f, v} = quad()
        const res = solidify(bm, [f], {thickness: t, offset: -1})
        for (const src of v) expect(src.z).toBeCloseTo(0, 12)
        for (const dst of res.vertMap.values()) expect(dst.z).toBeCloseTo(-t, 12)
    })

    it('at offset +1 makes the input surface the inner one', () => {
        const {bm, f, v} = quad()
        const res = solidify(bm, [f], {thickness: t, offset: 1})
        for (const src of v) expect(src.z).toBeCloseTo(t, 12)
        for (const dst of res.vertMap.values()) expect(dst.z).toBeCloseTo(0, 12)
    })

    it('at offset 0 straddles the input surface', () => {
        const {bm, f, v} = quad()
        const res = solidify(bm, [f], {thickness: t, offset: 0})
        for (const src of v) expect(src.z).toBeCloseTo(t / 2, 12)
        for (const dst of res.vertMap.values()) expect(dst.z).toBeCloseTo(-t / 2, 12)
    })

    it('interpolates in between, and the thickness never changes', () => {
        for (const offset of [-1, -0.5, -0.25, 0, 0.25, 0.5, 1]) {
            const {bm, f, v} = quad()
            const res = solidify(bm, [f], {thickness: t, offset})
            const ofsOrig = -(((-offset + 1) * 0.5) * t)
            const ofsNew = t + ofsOrig
            for (const src of v) expect(src.z).toBeCloseTo(ofsNew, 12)
            for (const dst of res.vertMap.values()) expect(dst.z).toBeCloseTo(ofsOrig, 12)
            // Whatever the placement, the two surfaces are `t` apart.
            expect(ofsNew - ofsOrig).toBeCloseTo(t, 12)
        }
    })
})

describe('solidify winding', () => {
    it('reverses the inner surface, so the two faces point opposite ways', () => {
        const {bm, f} = quad()
        const before = faceNormal(f)
        const res = solidify(bm, [f], {thickness: 0.25})
        const after = faceNormal(res.innerFaces[0])

        // Same area, opposite direction: the dot of the two area vectors is minus the area squared.
        const dot = v3dot(before, after)
        expect(dot).toBeLessThan(0)
        expect(dot).toBeCloseTo(-v3dot(before, before), 12)
        const unitBefore = v3normalize(before)
        const unitAfter = v3normalize(after)
        for (let i = 0; i < 3; i++) expect(unitAfter[i]).toBeCloseTo(-unitBefore[i], 12)
    })

    it('winds the whole closed result consistently, rim included', () => {
        for (const opts of [{}, {useEvenOffset: true}, {offset: 0}, {flipNormals: true}] as SolidifyOptions[]) {
            const {bm, faces} = grid(2)
            solidify(bm, faces, {thickness: 0.1, ...opts})
            expect(windingProblems(bm)).toEqual([])
        }
    })

    it('winds a solidified tube and a solidified cube consistently', () => {
        const t = tube(8)
        solidify(t.bm, t.faces, {thickness: 0.1})
        expect(windingProblems(t.bm)).toEqual([])

        const c = cube()
        solidify(c.bm, c.faces, {thickness: 0.1})
        expect(windingProblems(c.bm)).toEqual([])
    })

    it('leaves the shell facing outwards, and flipNormals turns it inside out', () => {
        const a = grid(2)
        solidify(a.bm, a.faces, {thickness: 0.1})
        const outward = signedVolume6(a.bm)
        expect(outward).toBeGreaterThan(0)

        const b = grid(2)
        solidify(b.bm, b.faces, {thickness: 0.1, flipNormals: true})
        const inward = signedVolume6(b.bm)
        expect(inward).toBeLessThan(0)
        // The same solid, occupying the same volume, inside out.
        expect(inward).toBeCloseTo(-outward, 12)
        expect(windingProblems(b.bm)).toEqual([])
    })

    it('flipNormals swaps which surface the offsets land on rather than flipping a face', () => {
        const {bm, f, v} = quad()
        const res = solidify(bm, [f], {thickness: 0.4, flipNormals: true})
        // Unflipped this is z = 0 for the input and z = -0.4 for the copy; flipped it is the reverse.
        for (const src of v) expect(src.z).toBeCloseTo(-0.4, 12)
        for (const dst of res.vertMap.values()) expect(dst.z).toBeCloseTo(0, 12)
        // And the copy is still the reversed one - no face was flipped to achieve the inversion.
        const outer = v3normalize(faceNormal(f))
        const inner = v3normalize(faceNormal(res.innerFaces[0]))
        for (let i = 0; i < 3; i++) expect(inner[i]).toBeCloseTo(-outer[i], 12)
    })

    it('winds each rim quad against the input face it bridges', () => {
        const {bm, f} = quad()
        const res = solidify(bm, [f], {thickness: 0.25})
        for (const rim of res.rimFaces) {
            // Every rim quad faces away from the shell's axis, which here is the z axis through the
            // centre of the quad.
            const c = faceCenter(rim)
            const n = v3normalize(faceNormal(rim))
            const radial: Vec3 = [c[0] - 0.5, c[1] - 0.5, 0]
            expect(v3dot(n, radial)).toBeGreaterThan(0)
        }
    })
})

describe('solidify useEvenOffset', () => {
    const t = 0.2

    it('keeps the perpendicular thickness at a fold, where the naive offset thins', () => {
        // The crease vertices have a vertex normal bisecting the two faces, 45 degrees off each, so
        // a plain offset of `t` clears each face by only t * cos(45) = 0.7071 t.
        const even = fold()
        const evenRes = solidify(even.bm, [even.flat, even.up], {thickness: t, useEvenOffset: true})
        const plain = fold()
        const plainRes = solidify(plain.bm, [plain.flat, plain.up], {thickness: t})

        const zUp: Vec3 = [0, 0, 1]
        const xUp: Vec3 = [1, 0, 0]
        for (const src of [even.o, even.p]) {
            const dst = evenRes.vertMap.get(src)!
            // `flat` lies in z = 0 and `up` in x = 0. The copy must be `t` clear of both.
            expect(Math.abs(planeDistance(dst, [0, 0, 0], zUp))).toBeCloseTo(t, 12)
            expect(Math.abs(planeDistance(dst, [0, 0, 0], xUp))).toBeCloseTo(t, 12)
            // Which is exactly (-t, y, -t): a push of t * sqrt(2) along the bisector.
            expect(dst.x).toBeCloseTo(-t, 12)
            expect(dst.z).toBeCloseTo(-t, 12)
        }

        for (const src of [plain.o, plain.p]) {
            const dst = plainRes.vertMap.get(src)!
            const thin = t / Math.SQRT2
            expect(Math.abs(planeDistance(dst, [0, 0, 0], zUp))).toBeCloseTo(thin, 12)
            expect(Math.abs(planeDistance(dst, [0, 0, 0], xUp))).toBeCloseTo(thin, 12)
            // 29% thin, which is the whole reason the flag exists.
            expect(thin).toBeLessThan(t * 0.75)
        }
    })

    it('leaves vertices off the fold alone, whichever way the flag is set', () => {
        for (const useEvenOffset of [false, true]) {
            const f = fold()
            const res = solidify(f.bm, [f.flat, f.up], {thickness: t, useEvenOffset})
            // `a0` only touches the flat face, so its normal is that face's and no correction applies.
            const dst = res.vertMap.get(f.a0)!
            expect(dst.x).toBeCloseTo(-1, 12)
            expect(dst.z).toBeCloseTo(-t, 12)
        }
    })

    it('changes nothing on a flat surface, where every corner is already square on', () => {
        const flatEven = grid(2)
        const evenRes = solidify(flatEven.bm, flatEven.faces, {thickness: t, useEvenOffset: true})
        const flatPlain = grid(2)
        const plainRes = solidify(flatPlain.bm, flatPlain.faces, {thickness: t})

        const evenZ = [...evenRes.vertMap.values()].map(v => v.z)
        const plainZ = [...plainRes.vertMap.values()].map(v => v.z)
        expect(evenZ.length).toBe(9)
        for (let i = 0; i < evenZ.length; i++) {
            expect(evenZ[i]).toBeCloseTo(-t, 12)
            expect(plainZ[i]).toBeCloseTo(-t, 12)
        }
    })

    it('weights each corner the way face_angles_calc does, which is pi minus the interior angle', () => {
        // `slantedPair` has corners of 90 and 63.4 degrees at `o`, so the two conventions give
        // different weighted averages and this pins down which one is used.
        const t2 = 0.5
        const m = slantedPair()
        const res = solidify(m.bm, [m.t1, m.t2], {thickness: t2, useEvenOffset: true})

        const nA = triNormal([0, 0, 0], [2, 0, 0], [0, 1, 0])
        const nB = triNormal([0, 0, 0], [0, 1, 0], [0, 0.5, 1])
        // The vertex normal weights face normals by the *interior* angle (`normals_calc_verts`).
        const int1 = Math.PI / 2
        const int2 = Math.acos(0.5 / Math.sqrt(1.25))
        const vn = v3normalize(v3add(v3mul(nA, int1), v3mul(nB, int2)))
        // The even-offset weight is `pi` minus it (`face_angles_calc`, mesh_evaluate.cc:201).
        const w1 = Math.PI - int1
        const w2 = Math.PI - int2
        const shell = (n: Vec3): number => 1 / Math.abs(v3dot(vn, n))
        const ratio = (shell(nA) * w1 + shell(nB) * w2) / (w1 + w2)

        const dst = res.vertMap.get(m.o)!
        expect(dst.x).toBeCloseTo(-t2 * ratio * vn[0], 12)
        expect(dst.y).toBeCloseTo(-t2 * ratio * vn[1], 12)
        expect(dst.z).toBeCloseTo(-t2 * ratio * vn[2], 12)
        // The two conventions really do disagree here, so the assertion above is discriminating.
        const other = (shell(nA) * int1 + shell(nB) * int2) / (int1 + int2)
        expect(Math.abs(ratio - other)).toBeGreaterThan(0.05)
    })

    it('takes the shell distance from the absolute cosine, so a folded-back face still thickens', () => {
        // `shell_v3v3_normalized_to_dist` uses `fabsf(dot)`. A fan whose last triangle folds back
        // over the others gives that vertex a normal more than 90 degrees away from one of its face
        // normals, so the signed cosine would be negative and that corner would vote to move the
        // surface the wrong way. This is the only shape in this file that can tell the two apart.
        const bm = new BMesh()
        const o = bm.vertCreate(0, 0, 0)
        const r0 = bm.vertCreate(1, 0, 0)
        const r1 = bm.vertCreate(0, 1, 0)
        const r2 = bm.vertCreate(-1, 0, 0)
        const r3 = bm.vertCreate(0, 0.5, 0.1)
        const tris = [bm.faceCreate([o, r0, r1]), bm.faceCreate([o, r1, r2]), bm.faceCreate([o, r2, r3])]

        const co0: Vec3 = [0, 0, 0]
        const ring: Vec3[] = [[1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, 0.5, 0.1]]
        const normals = [0, 1, 2].map(i => triNormal(co0, ring[i], ring[i + 1]))
        // Every corner at `o` happens to be a right angle, so the weights are all equal and the
        // assertion turns entirely on the sign handling.
        const angles = [0, 1, 2].map(i => Math.acos(Math.max(-1, Math.min(1,
            v3dot(v3normalize(ring[i]), v3normalize(ring[i + 1]))))))
        let acc: Vec3 = [0, 0, 0]
        for (let i = 0; i < 3; i++) acc = v3add(acc, v3mul(normals[i], angles[i]))
        const vn = v3normalize(acc)
        // One of the three faces really is more than 90 degrees from the vertex normal.
        expect(Math.min(...normals.map(n => v3dot(vn, n)))).toBeLessThan(0)

        let num = 0
        let den = 0
        for (let i = 0; i < 3; i++) {
            const w = Math.PI - angles[i]
            num += (1 / Math.abs(v3dot(vn, normals[i]))) * w
            den += w
        }
        const ratio = num / den

        const res = solidify(bm, tris, {thickness: 0.5, useEvenOffset: true})
        const dst = res.vertMap.get(o)!
        expect(dst.x).toBeCloseTo(-0.5 * ratio * vn[0], 12)
        expect(dst.y).toBeCloseTo(-0.5 * ratio * vn[1], 12)
        expect(dst.z).toBeCloseTo(-0.5 * ratio * vn[2], 12)

        // Without the absolute value the third corner votes the other way and the answer moves.
        let signedNum = 0
        for (let i = 0; i < 3; i++) signedNum += (1 / v3dot(vn, normals[i])) * (Math.PI - angles[i])
        expect(Math.abs(signedNum / den - ratio)).toBeGreaterThan(0.1)
    })

    it('gives a different result from the plain offset on folded geometry', () => {
        const even = fold()
        const evenRes = solidify(even.bm, [even.flat, even.up], {thickness: t, useEvenOffset: true})
        const plain = fold()
        const plainRes = solidify(plain.bm, [plain.flat, plain.up], {thickness: t})

        const evenCrease = co(evenRes.vertMap.get(even.o)!)
        const plainCrease = co(plainRes.vertMap.get(plain.o)!)
        expect(evenCrease).not.toEqual(plainCrease)
        expect(Math.abs(evenCrease[0] - plainCrease[0])).toBeGreaterThan(0.05)
    })
})

describe('solidify offsetClamp', () => {
    // A quad 0.2 wide and 1 tall: every vertex's shortest edge is 0.2, so a thickness of 1 would
    // push the copy five times further than the geometry it sits on is wide.
    const thin = () => quad(0.2, 1)

    it('does not overshoot the shortest edge at clamp 1', () => {
        const {bm, f} = thin()
        const res = solidify(bm, [f], {thickness: 1, offsetClamp: 1})
        for (const dst of res.vertMap.values()) expect(dst.z).toBeCloseTo(-0.2, 12)
    })

    it('overshoots wildly without the clamp, which is what the clamp is for', () => {
        const {bm, f} = thin()
        const res = solidify(bm, [f], {thickness: 1})
        for (const dst of res.vertMap.values()) expect(dst.z).toBeCloseTo(-1, 12)
    })

    it('scales the clamp distance by the factor', () => {
        // offset = |thickness| * offsetClamp = 0.5, and 0.2^2 < 0.5^2, so the scalar is 0.2 / 0.5.
        const {bm, f} = thin()
        const res = solidify(bm, [f], {thickness: 1, offsetClamp: 0.5})
        for (const dst of res.vertMap.values()) expect(dst.z).toBeCloseTo(-0.4, 12)
    })

    it('leaves an offset that already fits untouched', () => {
        // offset = 0.1, and the shortest edge squared (0.04) is not below 0.01, so nothing happens.
        const {bm, f} = thin()
        const res = solidify(bm, [f], {thickness: 0.1, offsetClamp: 1})
        for (const dst of res.vertMap.values()) expect(dst.z).toBeCloseTo(-0.1, 12)
    })

    it('clamps per vertex, by that vertex\'s own shortest edge', () => {
        // Columns at x = 0, 0.2 and 1.2: the two left columns are pinched, the right one is not.
        const bm = new BMesh()
        const xs = [0, 0.2, 1.2]
        const v: BMVert[] = []
        for (const y of [0, 1]) for (const x of xs) v.push(bm.vertCreate(x, y, 0))
        const at = (i: number, y: number) => v[y * 3 + i]
        const faces = [0, 1].map(i => bm.faceCreate([at(i, 0), at(i + 1, 0), at(i + 1, 1), at(i, 1)]))

        const res = solidify(bm, faces, {thickness: 1, offsetClamp: 1})
        // x = 0 and x = 0.2 both have the 0.2-long edge as their shortest.
        expect(res.vertMap.get(at(0, 0))!.z).toBeCloseTo(-0.2, 12)
        expect(res.vertMap.get(at(1, 0))!.z).toBeCloseTo(-0.2, 12)
        // x = 1.2's shortest edge is the vertical one, length 1, which does not trigger the clamp.
        expect(res.vertMap.get(at(2, 0))!.z).toBeCloseTo(-1, 12)
    })

    it('clamps the even-offset path too, and the angle clamp changes the result again', () => {
        const plain = fold()
        const plainRes = solidify(plain.bm, [plain.flat, plain.up],
            {thickness: 1, useEvenOffset: true, offsetClamp: 1})
        const angle = fold()
        const angleRes = solidify(angle.bm, [angle.flat, angle.up],
            {thickness: 1, useEvenOffset: true, offsetClamp: 1, useAngleClamp: true})

        // The fold's edges are all length 1, so the plain clamp does nothing at all here...
        expect(plainRes.vertMap.get(plain.o)!.x).toBeCloseTo(-1, 12)
        // ...while the angle clamp sees the 90 degree fold and pulls the offset in.
        expect(angleRes.vertMap.get(angle.o)!.x).toBeGreaterThan(-1)
        expect(angleRes.vertMap.get(angle.o)!.x).toBeLessThan(0)
        assertClean(angle.bm)
    })

    it('runs the angle clamp in the non-even path as well', () => {
        // Thickness 4 on a fold whose edges are all 1 long, straddling the input surface so that
        // both offset loops run. The plain clamp scales both by sqrt(1) / 4; the angle clamp leaves
        // the convex side alone (its `cos_ang` is negative, so `if (cos_ang > 0)` skips it) and pulls
        // the other in to `sqrt(1) * 0.5 / cos(45)`, which is a different number on each side.
        const opts = {thickness: 4, offset: 0, offsetClamp: 1}
        const noAngle = fold()
        const noAngleRes = solidify(noAngle.bm, [noAngle.flat, noAngle.up], opts)
        const withAngle = fold()
        const withAngleRes = solidify(withAngle.bm, [withAngle.flat, withAngle.up],
            {...opts, useAngleClamp: true})

        const bisector = Math.SQRT1_2
        // Plain clamp: +-2 scaled by 0.25, so +-0.5 along the bisector.
        expect(noAngle.o.x).toBeCloseTo(0.5 * bisector, 12)
        expect(noAngleRes.vertMap.get(noAngle.o)!.x).toBeCloseTo(-0.5 * bisector, 12)
        // Angle clamp: the input surface keeps its full +2, the copy is pulled back to -1 / sqrt(2).
        expect(withAngle.o.x).toBeCloseTo(2 * bisector, 12)
        expect(withAngleRes.vertMap.get(withAngle.o)!.x).toBeCloseTo(-Math.SQRT1_2 * bisector, 12)
        assertClean(withAngle.bm)
    })
})

describe('solidify normals', () => {
    it('offsets along Blender\'s angle-weighted vertex normal, not along a face normal', () => {
        const build = slantedPair
        const t = 0.5
        // Face normals are +Z for `t1` (it lies in z = 0) and +X for `t2` (it lies in x = 0).
        // Corner angles at `o`: 90 degrees in `t1`, acos(0.5/sqrt(1.25)) in `t2`.
        const angle2 = Math.acos(0.5 / Math.sqrt(1.25))
        const weighted: Vec3 = [angle2, 0, Math.PI / 2]
        const expected = v3normalize(weighted)

        const plain = build()
        const plainRes = solidify(plain.bm, [plain.t1, plain.t2], {thickness: t})
        const dst = plainRes.vertMap.get(plain.o)!
        expect(dst.x).toBeCloseTo(-t * expected[0], 12)
        expect(dst.y).toBeCloseTo(-t * expected[1], 12)
        expect(dst.z).toBeCloseTo(-t * expected[2], 12)

        // High-quality normals accumulate per edge instead: the shared edge contributes the
        // bisector of the two face normals (scaled by 1 for a right angle), and each of the two
        // boundary edges at `o` contributes its single face's normal.
        const hq = build()
        const hqRes = solidify(hq.bm, [hq.t1, hq.t2], {thickness: t, useHighQualityNormals: true})
        const bisector: Vec3 = [Math.SQRT1_2, 0, Math.SQRT1_2]
        const hqExpected = v3normalize([bisector[0] + 1, 0, bisector[2] + 1])
        const hqDst = hqRes.vertMap.get(hq.o)!
        expect(hqDst.x).toBeCloseTo(-t * hqExpected[0], 12)
        expect(hqDst.z).toBeCloseTo(-t * hqExpected[2], 12)

        // And the two really are different directions, so the test discriminates.
        expect(Math.abs(expected[0] - hqExpected[0])).toBeGreaterThan(0.1)
    })

    it('weights each high-quality edge normal by the angle between its two faces', () => {
        // `mid_v3_v3v3_angle_weighted` scales the bisector by (4/pi) * acos(|a + b| / 2), which is 1
        // for a right angle and anything else otherwise. A vertex with only two faces cannot show
        // that up - every weighting lands on the same bisector - so this needs three.
        const t = 0.5
        const m = corner()
        const res = solidify(m.bm, [m.fa, m.fb, m.fc], {thickness: t, useHighQualityNormals: true})

        const o: Vec3 = [0, 0, 0]
        const a: Vec3 = [1, 0, 0]
        const b: Vec3 = [0, 1, 0]
        const c: Vec3 = [0, -1, -1]
        const nA = triNormal(o, a, b)
        const nB = triNormal(b, c, o)
        const nC = triNormal(a, o, c)
        const mid = (x: Vec3, y: Vec3): Vec3 => {
            const sum = v3add(x, y)
            const len = v3len(sum)
            return v3mul(v3normalize(sum), (2 / Math.PI) * 2 * Math.acos(len / 2))
        }
        // The three edges at `o`, each shared by two of the three faces.
        const expected = v3normalize(v3add(v3add(mid(nA, nC), mid(nA, nB)), mid(nB, nC)))

        const dst = res.vertMap.get(m.o)!
        expect(dst.x).toBeCloseTo(-t * expected[0], 12)
        expect(dst.y).toBeCloseTo(-t * expected[1], 12)
        expect(dst.z).toBeCloseTo(-t * expected[2], 12)

        // Dropping the weight would give a measurably different direction, so this discriminates.
        const unweighted = v3normalize(v3add(v3add(
            v3normalize(v3add(nA, nC)), v3normalize(v3add(nA, nB))), v3normalize(v3add(nB, nC))))
        expect(v3len(v3sub(expected, unweighted))).toBeGreaterThan(0.02)
    })

    it('does not read three.js or any cached vertex normal off the mesh', () => {
        // Poison the cached normals; the offset must be unaffected because Blender computes its own.
        const {bm, f, v} = quad()
        for (const vert of v) {
            vert.nx = 1
            vert.ny = 1
            vert.nz = 1
        }
        const res = solidify(bm, [f], {thickness: 0.25})
        for (const [src, dst] of res.vertMap) {
            expect(dst.z).toBeCloseTo(-0.25, 12)
            expect(dst.x).toBeCloseTo(src.x, 12)
            expect(dst.y).toBeCloseTo(src.y, 12)
        }
    })
})

describe('solidify attributes and selection', () => {
    it('carries the input face\'s per-corner data onto the inner and rim faces', () => {
        const {bm, f} = quad()
        const uv = bm.addLayer('loop', 'uv', 'float2')
        const loops = [...f.eachLoop()]
        loops.forEach((l, i) => {
            l.fdata = new Float32Array(bm.ldata.floatSize)
            l.fdata[uv.offset] = i
            l.fdata[uv.offset + 1] = i * 2
        })

        const res = solidify(bm, [f], {thickness: 0.2})
        // The inner face keeps corner 0 and runs backwards, so its corners carry 0, 3, 2, 1.
        const innerU = [...res.innerFaces[0].eachLoop()].map(l => getComponent(l, uv, 0))
        expect(innerU).toEqual([0, 3, 2, 1])
        // Each rim quad copies the two corners of the edge it bridges, twice over - and each copy
        // has to land on the corner holding that same vertex, which is what `k1`/`k2` mean at `:1057`.
        const inputU = new Map<BMVert, number>()
        for (const l of loops) inputU.set(l.v, getComponent(l, uv, 0))
        const inverse = new Map<BMVert, BMVert>()
        for (const [src, dst] of res.vertMap) inverse.set(dst, src)
        for (const rim of res.rimFaces) {
            const u = [...rim.eachLoop()].map(l => getComponent(l, uv, 0))
            expect(u[0]).toBe(u[3])
            expect(u[1]).toBe(u[2])
            expect(u[0]).not.toBe(u[1])
            for (const l of rim.eachLoop()) {
                const source = inverse.get(l.v) ?? l.v
                expect(getComponent(l, uv, 0)).toBe(inputU.get(source))
            }
        }
    })

    it('offsets the material slot of the inner and rim faces', () => {
        const {bm, f} = quad()
        bm.materials = ['a', 'b', 'c']
        f.matNr = 0
        const res = solidify(bm, [f], {thickness: 0.2, materialOffset: 1, materialOffsetRim: 2})
        expect(f.matNr).toBe(0)
        expect(res.innerFaces[0].matNr).toBe(1)
        for (const rim of res.rimFaces) expect(rim.matNr).toBe(2)
    })

    it('clamps the material offset to the last slot, and ignores it with one material', () => {
        const a = quad()
        a.bm.materials = ['a', 'b']
        const aRes = solidify(a.bm, [a.f], {thickness: 0.2, materialOffset: 5})
        expect(aRes.innerFaces[0].matNr).toBe(1)

        const b = quad()
        b.bm.materials = ['only']
        const bRes = solidify(b.bm, [b.f], {thickness: 0.2, materialOffset: 5})
        expect(bRes.innerFaces[0].matNr).toBe(0)
    })

    it('writes the three crease values on the edges they belong to', () => {
        const {bm, f, v} = quad()
        const res = solidify(bm, [f], {
            thickness: 0.2, creaseRim: 0.5, creaseOuter: 0.25, creaseInner: 0.75,
        })
        const layer = bm.edata.get(AttrName.creaseEdge)!

        // The input surface's boundary edges took `crease_outer`.
        for (const e of f.edges()) expect(getComponent(e, layer)).toBeCloseTo(0.25, 6)
        // The inner surface's took `crease_inner`.
        for (const e of res.innerFaces[0].edges()) expect(getComponent(e, layer)).toBeCloseTo(0.75, 6)
        // And the edges that cross the shell took `crease_rim`.
        for (const src of v) {
            const across = res.edges.find(e => e.joins(src, res.vertMap.get(src)!))!
            expect(getComponent(across, layer)).toBeCloseTo(0.5, 6)
        }
    })

    it('adds a bevel weight by convexity when bevelConvex is set', () => {
        // The crease is convex (`angle < M_PI`), so the outer surface's copy of it takes the
        // positive weight and the inner surface's copy, which folds the other way, takes none.
        const f = fold()
        const res = solidify(f.bm, [f.flat, f.up], {thickness: 0.1, bevelConvex: 0.5})
        const layer = f.bm.edata.get(AttrName.bevelWeightEdge)!
        const crease = [...f.bm.edges].find(e => e.joins(f.o, f.p))!
        expect(getComponent(crease, layer)).toBeCloseTo(0.5, 6)
        const innerCrease = res.edges.find(
            e => e.joins(res.vertMap.get(f.o)!, res.vertMap.get(f.p)!))!
        expect(getComponent(innerCrease, layer)).toBeCloseTo(0, 6)
        // A boundary edge has no second face, so no angle, so no weight.
        const border = [...f.bm.edges].find(e => e.joins(f.a0, f.a1))!
        expect(getComponent(border, layer)).toBeCloseTo(0, 6)

        // A concave crease is the other way round: negative weights land on the outer surface.
        const g = fold()
        const gRes = solidify(g.bm, [g.flat, g.up], {thickness: 0.1, bevelConvex: -0.5})
        const gLayer = g.bm.edata.get(AttrName.bevelWeightEdge)!
        // `clamp_f(bevel_convex, 0, 1)` is 0 for a negative setting, so the convex outer edge is left
        // alone and it is the inner one that picks the weight up. Weights clamp to `0..1`, so the
        // negative value cannot show through - which is Blender's behaviour, not a rounding artefact.
        expect(getComponent([...g.bm.edges].find(e => e.joins(g.o, g.p))!, gLayer)).toBeCloseTo(0, 6)
        const gInner = gRes.edges.find(
            e => e.joins(gRes.vertMap.get(g.o)!, gRes.vertMap.get(g.p)!))!
        expect(getComponent(gInner, gLayer)).toBeCloseTo(0, 6)
    })

    it('selects the whole shell, and leaves selection alone when asked', () => {
        const {bm, f} = quad()
        const res = solidify(bm, [f], {thickness: 0.2})
        expect(bm.totfacesel).toBe(6)
        expect(bm.totvertsel).toBe(8)
        for (const face of [f, ...res.faces]) expect(face.hflag & ElemFlag.Select).toBeTruthy()

        const other = quad()
        selectNone(other.bm)
        solidify(other.bm, [other.f], {thickness: 0.2, selectResult: false})
        expect(other.bm.totfacesel).toBe(0)
        expect(other.bm.totvertsel).toBe(0)
    })
})

describe('solidifySelection', () => {
    it('solidifies the selected faces and returns null when nothing is selected', () => {
        const {bm, faces} = grid(2)
        selectNone(bm)
        expect(solidifySelection(bm, {thickness: 0.1})).toBeNull()

        faceSelectSet(bm, faces[0], true)
        const res = solidifySelection(bm, {thickness: 0.1})!
        expect(res).not.toBeNull()
        expect(res.innerFaces.length).toBe(1)
        expect(res.rimFaces.length).toBe(4)
        assertClean(bm)
    })

    it('treats an edge shared with an unselected face as a boundary of the region', () => {
        // The region is one quad of a 2x2 grid; two of its edges are shared with faces outside it,
        // and those still get rim quads because only the region counts.
        const {bm, faces} = grid(2)
        const res = solidify(bm, [faces[0]], {thickness: 0.1})
        expect(res.rimFaces.length).toBe(4)
        expect(bm.validate()).toEqual([])
    })
})

describe('solidify stays valid across the option matrix', () => {
    const cases: [string, SolidifyOptions][] = [
        ['defaults', {}],
        ['even', {useEvenOffset: true}],
        ['hq normals', {useHighQualityNormals: true}],
        ['even + hq', {useEvenOffset: true, useHighQualityNormals: true}],
        ['no rim', {useRim: false}],
        ['rim only', {useRimOnly: true}],
        ['flipped', {flipNormals: true}],
        ['flipped + even', {flipNormals: true, useEvenOffset: true}],
        ['offset 0', {offset: 0}],
        ['offset +1', {offset: 1}],
        ['clamped', {offsetClamp: 1}],
        ['clamped + even', {offsetClamp: 1, useEvenOffset: true}],
        ['angle clamped', {offsetClamp: 1, useAngleClamp: true}],
        ['angle clamped + even', {offsetClamp: 1, useAngleClamp: true, useEvenOffset: true}],
        ['rim only + clamped', {useRimOnly: true, offsetClamp: 1}],
        ['rim only + angle clamped', {useRimOnly: true, offsetClamp: 1, useAngleClamp: true}],
        ['creases + material', {creaseRim: 1, creaseOuter: 1, creaseInner: 1, materialOffset: 1}],
        ['bevel convex', {bevelConvex: 0.5}],
    ]

    it('zero thickness leaves the two surfaces coincident but the topology sound', () => {
        // Blender does the same: the shell is still built, it just has no depth, so the rim quads
        // have no area. Topology has to survive it; geometry cannot.
        const {bm, faces} = grid(2)
        solidify(bm, faces, {thickness: 0})
        expect(bm.validate()).toEqual([])
        expect(bmToMesh(bm).validate()).toEqual([])
        expect(eulerCharacteristic(bm)).toBe(2)
    })

    for (const [name, opts] of cases) {
        it(`${name}`, () => {
            for (const build of [() => grid(2), () => tube(6), () => fold(), () => cube()]) {
                const built = build()
                const faces = 'faces' in built
                    ? built.faces
                    : [(built as ReturnType<typeof fold>).flat, (built as ReturnType<typeof fold>).up]
                solidify(built.bm, faces, {thickness: 0.1, ...opts})
                assertClean(built.bm)
                expect(windingProblems(built.bm)).toEqual([])
            }
        })
    }
})

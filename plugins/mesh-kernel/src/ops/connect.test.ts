/**
 * Hand-checked tests for the connect ports (`connect.ts`, `connectPair.ts`): the current-source
 * behaviour where it differs from Blender 3.4.1 (which wrote the parity fixtures, see
 * `tests/bmesh-ops-connect-parity.test.ts`), and the pieces the fixtures cannot isolate.
 */

import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMFace, BMLoop, BMVert} from '../bmesh/types'
import {faceCalcNormal} from '../bmesh/polygon'
import {vertSelectSet} from '../bmesh/marking'
import {diskEdgeExists} from '../bmesh/structure'
import {ElemFlag} from '../constants'
import {Vec3, v3cross, v3dot, v3normalize, v3sub} from '../math'
import {normalsUpdate} from './bevel-bmquery'
import {
    LoopPair, connectVerts, faceSplitsCheckLegal, vertConnectPathSelection, vertConnectSelection,
    vertPairShareFaceByAngle,
} from './connect'
import {HeapSimple, connectVertPair, invertM3} from './connectPair'

const co = (v: BMVert): Vec3 => [v.x, v.y, v.z]

function mesh(positions: number[][], faces: number[][]) {
    const bm = new BMesh()
    const verts = positions.map(p => bm.vertCreate(p[0], p[1], p[2]))
    const fs = faces.map(f => bm.faceCreate(f.map(i => verts[i])))
    normalsUpdate(bm)
    return {bm, verts, faces: fs}
}

const loopOf = (f: BMFace, v: BMVert): BMLoop => f.loops().find(l => l.v === v)!

// The "U" of the parity fixture: two pillars on a bar; (0, 0) and (4, 0) are straight corners and
// (1, 0), (3, 0) the notch corners on the same line.
const U_CO = [[0, 2, 0], [0, 0, 0], [0, -2, 0], [4, -2, 0], [4, 0, 0], [4, 2, 0], [3, 2, 0], [3, 0, 0], [3, -1, 0],
    [1, -1, 0], [1, 0, 0], [1, 2, 0]]
// The "C": the cut between its tips (2, 5) runs across the opening.
const C_CO = [[0, 0, 0], [4, 0, 0], [4, 1, 0], [1, 1, 0], [1, 3, 0], [4, 3, 0], [4, 4, 0], [0, 4, 0]]

describe('BM_face_splits_check_legal (current source: corner-angle inside test)', () => {
    it('keeps a cut that starts inside the face at both ends, even when it runs outside between two vertices it only touches', () => {
        // Blender 3.4.1's midpoint ray test rejected this one (its midpoint (2, 0) is in the notch).
        const {verts, faces} = mesh(U_CO, [U_CO.map((_, i) => i)])
        const pairs: LoopPair[] = [[loopOf(faces[0], verts[1]), loopOf(faces[0], verts[4])]]
        faceSplitsCheckLegal(faces[0], pairs)
        expect(pairs[0][0]).not.toBe(null)
    })

    it('rejects a cut that leaves the face at one of its corners', () => {
        // At tip 2 = (4, 1) the face lies below-left; the direction to tip 5 = (4, 3) points up, outside.
        const {verts, faces} = mesh(C_CO, [C_CO.map((_, i) => i)])
        const pairs: LoopPair[] = [[loopOf(faces[0], verts[2]), loopOf(faces[0], verts[5])]]
        faceSplitsCheckLegal(faces[0], pairs)
        expect(pairs[0][0]).toBe(null)
    })

    it('steps over zero-length edges to find the corner a cut leaves from', () => {
        // A C with both tips doubled (zero-length edges 2-3 and 6-7) and the cut 3-7 across its opening.
        // From loop 3 the previous corner is 2, at the same place, and from loop 7 it is 6: stepping over
        // them, the corner at 3 does not contain the cut (it is rejected). Without the step the corner
        // direction is the zero vector and both angles come out 0 for this cut direction (mixed signs),
        // so it would pass. The coordinates average to (1.5, 2) exactly, so the centred projection stays
        // exact and the cut only *touches* the outline at its ends.
        const CD = [[-4, 0, 0], [4, 0, 0], [4, 1, 0], [4, 1, 0], [1, 1, 0], [1, 3, 0], [3, 3, 0], [3, 3, 0], [3, 4, 0], [-4, 4, 0]]
        const {verts, faces} = mesh(CD, [CD.map((_, i) => i)])
        const pairs: LoopPair[] = [[loopOf(faces[0], verts[3]), loopOf(faces[0], verts[7])]]
        faceSplitsCheckLegal(faces[0], pairs)
        expect(pairs[0][0]).toBe(null)
    })

    it('keeps a cut across the inside of the concave face', () => {
        const {verts, faces} = mesh(C_CO, [C_CO.map((_, i) => i)])
        const pairs: LoopPair[] = [[loopOf(faces[0], verts[0]), loopOf(faces[0], verts[3])]]
        faceSplitsCheckLegal(faces[0], pairs)
        expect(pairs[0][0]).not.toBe(null)
    })

    it('rejects a cut crossing an edge of the face, and the later of two crossing cuts', () => {
        // L: the cut 1-5 crosses edge 2-3.
        const L = [[0, 0, 0], [3, 0, 0], [3, 1, 0], [1, 1, 0], [1, 3, 0], [0, 3, 0]]
        const a = mesh(L, [L.map((_, i) => i)])
        const p1: LoopPair[] = [[loopOf(a.faces[0], a.verts[1]), loopOf(a.faces[0], a.verts[5])]]
        faceSplitsCheckLegal(a.faces[0], p1)
        expect(p1[0][0]).toBe(null)
        // A hexagon made concave by a notch at vertex 4 (so the convex shortcut does not apply), with
        // two cuts that each lie inside but cross each other: the self-intersection test clears the
        // first of the crossing pair.
        const H = [[0, 0, 0], [2, -1, 0], [4, 0, 0], [4, 3, 0], [2, 2.2, 0], [0, 3, 0]]
        const b = mesh(H, [H.map((_, i) => i)])
        const f = b.faces[0]
        const p2: LoopPair[] = [
            [loopOf(f, b.verts[0]), loopOf(f, b.verts[3])],
            [loopOf(f, b.verts[1]), loopOf(f, b.verts[5])],
        ]
        faceSplitsCheckLegal(f, p2)
        expect(p2.map(p => p[0] !== null)).toEqual([false, true])
    })
})

describe('connect_verts', () => {
    it('cuts the U through its notch with check_degenerate (current source)', () => {
        const {bm, verts} = mesh(U_CO, [U_CO.map((_, i) => i)])
        const r = connectVerts(bm, [verts[1], verts[4]], {checkDegenerate: true})
        expect(r.error).toBe(null)
        expect(bm.totface).toBe(2)
        expect(r.edges).toHaveLength(1)
        expect(r.edges[0].joins(verts[1], verts[4])).toBe(true)
        expect(bm.validate()).toEqual([])
    })

    it('flushes the selection and keeps the select history as a top-level operator does', () => {
        const {bm, verts} = mesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [[0, 1, 2, 3]])
        vertSelectSet(bm, verts[0], true)
        vertSelectSet(bm, verts[2], true)
        // An unselected element in the history: `bmesh_edit_end` sets the history aside for the flush,
        // so it must survive (an edit-mode `EDBM_selectmode_flush` would drop it).
        bm.selectHistory = [{elem: verts[1]}]
        const r = connectVerts(bm, [verts[0], verts[2]])
        expect(r.edges).toHaveLength(1)
        expect(r.edges[0].hflag & ElemFlag.Select).toBeTruthy()
        expect(bm.totedgesel).toBe(1)
        expect(bm.selectHistory.map(h => h.elem)).toEqual([verts[1]])
    })
})

describe('BM_vert_pair_share_face_by_angle', () => {
    it('picks the face whose two halves stay coplanar, whichever face comes first', () => {
        for (const flatFirst of [true, false]) {
            const bm = new BMesh()
            const a = bm.vertCreate(0, 0, 0)
            const b = bm.vertCreate(1, 1, 0)
            const x = bm.vertCreate(1, 0, 0)
            const y = bm.vertCreate(0, 1, 0)
            const z = bm.vertCreate(1, -0.5, 0.8)
            const w = bm.vertCreate(-0.5, 1, -0.8)
            const make = (flat: boolean) => flat ? bm.faceCreate([a, x, b, y]) : bm.faceCreate([a, z, b, w])
            const f1 = make(flatFirst)
            const f2 = make(!flatFirst)
            const flat = flatFirst ? f1 : f2
            const r = vertPairShareFaceByAngle(a, b, false)
            expect(r?.f).toBe(flat)
        }
    })
})

describe('connect_vert_pair', () => {
    it('does nothing for anything but two vertices, and when no face path exists', () => {
        const {bm, verts} = mesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [3, 0, 0], [4, 0, 0], [4, 1, 0], [3, 1, 0]],
            [[0, 1, 2, 3], [4, 5, 6, 7]])
        expect(connectVertPair(bm, [verts[0]]).edges).toEqual([])
        expect(connectVertPair(bm, [verts[0], verts[2], verts[4]]).edges).toEqual([])
        expect(connectVertPair(bm, [verts[0], verts[6]]).edges).toEqual([])
        expect(bm.totedge).toBe(8)
    })
})

describe('HeapSimple (BLI_heap_simple)', () => {
    it('pops in value order, ties in Blender\'s sift order (not insertion order)', () => {
        const h = new HeapSimple<string>()
        h.insert(1, 'a')
        h.insert(1, 'b')
        h.insert(1, 'c')
        // pop: 'a' leaves, the last node ('c') sifts down from the root and stays (b is not smaller).
        expect([h.popMin(), h.popMin(), h.popMin()]).toEqual(['a', 'c', 'b'])
        expect(h.isEmpty()).toBe(true)

        const vals = [5, 3, 8, 1, 9, 2, 7, 3, 0.5]
        vals.forEach((v, i) => h.insert(v, String(i)))
        const out: number[] = []
        while (!h.isEmpty()) out.push(vals[Number(h.popMin())])
        expect(out).toEqual([...vals].sort((p, q) => p - q))
    })
})

describe('invert_m3', () => {
    it('inverts through the adjoint and reports a singular matrix', () => {
        const m: [Vec3, Vec3, Vec3] = [[2, 0, 0], [1, 3, 0], [0, 1, 4]]
        const {inv, ok} = invertM3(m)
        expect(ok).toBe(true)
        // m * inv = I, with Blender's `m[i][j]` as column i, row j.
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                let s = 0
                for (let k = 0; k < 3; k++) s += m[k][r] * inv[c][k]
                expect(s).toBeCloseTo(r === c ? 1 : 0, 12)
            }
        }
        expect(invertM3([[1, 2, 3], [2, 4, 6], [0, 1, 1]]).ok).toBe(false)
    })
})

// The open tube of the parity fixture ("path cylinder").
const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/bmesh-ops-connect.json')

describe('vert_connect_path, current-source behaviour', () => {
    const fx = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {cases: {name: string, input: {positions: number[][], faces: number[][]}, output: {positions: number[][]}}[]}
    const cyl = fx.cases.find(c => c.name === 'path cylinder')!

    /** The angle-weighted vertex normal from fresh face normals (`BM_vert_calc_normal`), computed independently. */
    function vertNormal(v: BMVert): Vec3 {
        const n: Vec3 = [0, 0, 0]
        for (const e of [...diskEdgesOf(v)]) {
            if (!e.l) continue
            let l = e.l
            do {
                if (l.v === v) {
                    const fn = faceCalcNormal(l.f)
                    const a = v3normalize(v3sub(co(l.v), co(l.prev.v)))
                    const b = v3normalize(v3sub(co(l.next.v), co(l.v)))
                    const ang = Math.acos(Math.min(1, Math.max(-1, -v3dot(a, b))))
                    n[0] += fn[0] * ang
                    n[1] += fn[1] * ang
                    n[2] += fn[2] * ang
                }
                l = l.radialNext!
            } while (l !== e.l)
        }
        return v3normalize(n)
    }
    function* diskEdgesOf(v: BMVert) {
        let e = v.e!
        do {
            yield e
            e = e.diskNext(v)!
        } while (e !== v.e)
    }

    /** The first row of `bm_vert_pair_to_matrix`'s inverse (orthonormal case): the cutting plane's normal. */
    function cutPlane(a: BMVert, b: BMVert, na: Vec3, nb: Vec3): Vec3 {
        const dir = v3normalize(v3sub(co(a), co(b)))
        const pa = v3sub(na, dir.map(x => x * v3dot(na, dir)) as Vec3)
        let pb = v3sub(nb, dir.map(x => x * v3dot(nb, dir)) as Vec3)
        if (v3dot(pa, pb) < 0) pb = pb.map(x => -x) as Vec3
        const nor = v3normalize([pa[0] + pb[0], pa[1] + pb[1], pa[2] + pb[2]])
        return v3normalize(v3cross(dir, nor))
    }

    function build() {
        const m = mesh(cyl.input.positions, cyl.input.faces)
        return m
    }

    it('cuts each pair on the plane of the normals from before the first cut (#154197)', () => {
        const {bm, verts} = build()
        const [v0, v11, v21, v6] = [verts[0], verts[11], verts[21], verts[6]]
        // Normals before anything is cut.
        const n11 = vertNormal(v11)
        const n21 = vertNormal(v21)
        // 3.4.1's normals for the second pair: recalculated after the first cut 0-11.
        const ref = build()
        connectVertPair(ref.bm, [ref.verts[0], ref.verts[11]])
        normalsUpdate(ref.bm)
        const n11After = vertNormal(ref.verts[11])
        const n21After = vertNormal(ref.verts[21])

        for (const v of [v0, v11, v21, v6]) vertSelectSet(bm, v, true)
        bm.selectHistory = [v0, v11, v21, v6].map(elem => ({elem}))
        expect(vertConnectPathSelection(bm).ok).toBe(true)

        // The vertex the cut 11-21 put on edge 12-20.
        const v12 = verts[12]
        const v20 = verts[20]
        const vNew = [...bm.verts].find(v => diskEdgeExists(v, v12) && diskEdgeExists(v, v20) && v !== v11 && v !== v21)!
        expect(vNew).toBeTruthy()

        const plane = cutPlane(v11, v21, n11, n21)
        expect(Math.abs(v3dot(plane, v3sub(co(vNew), co(v11))))).toBeLessThan(1e-9)
        // ...and not on 3.4.1's plane, where Blender 3.4.1's vertex (the fixture) is.
        const planeAfter = cutPlane(v11, v21, n11After, n21After)
        expect(Math.abs(v3dot(planeAfter, v3sub(co(vNew), co(v11))))).toBeGreaterThan(1e-5)
        const blender = cyl.output.positions[26] as Vec3
        expect(Math.abs(v3dot(planeAfter, v3sub(blender, co(v11))))).toBeLessThan(5e-6)
    })

    it('refuses a mixed select history, changing nothing (#147150)', () => {
        const {bm, verts} = mesh([[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [0, 1, 0]],
            [[0, 1, 4, 5], [1, 2, 3, 4]])
        for (const i of [0, 1, 3]) vertSelectSet(bm, verts[i], true)
        const e = diskEdgeExists(verts[0], verts[1])!
        e.hflag |= ElemFlag.Select
        bm.totedgesel = 1
        bm.selectHistory = [{elem: verts[3]}, {elem: e}]
        const before = bm.describe()
        expect(vertConnectPathSelection(bm)).toEqual({ok: false, error: 'Could not connect mixed selection types', meshChanged: false})
        expect(bm.describe()).toBe(before)
        expect(bm.selectHistory).toHaveLength(2)
    })

    it('refuses a face select history with its own message', () => {
        const {bm, verts, faces} = mesh([[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [0, 1, 0]],
            [[0, 1, 4, 5], [1, 2, 3, 4]])
        for (const i of [0, 1, 4, 5]) vertSelectSet(bm, verts[i], true)
        bm.selectHistory = [{elem: faces[0]}]
        const before = bm.describe()
        expect(vertConnectPathSelection(bm)).toEqual({ok: false, error: 'Could not connect a face selection', meshChanged: false})
        expect(bm.describe()).toBe(before)
    })

    it('finishes without doing anything when nothing is selected', () => {
        const {bm} = mesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [[0, 1, 2, 3]])
        expect(vertConnectPathSelection(bm)).toEqual({ok: true, edges: []})
        expect(bm.totedge).toBe(4)
    })
})

describe('vert_connect', () => {
    it('cancels with fewer than two selected vertices', () => {
        const {bm, verts} = mesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [[0, 1, 2, 3]])
        vertSelectSet(bm, verts[0], true)
        expect(vertConnectSelection(bm)).toEqual({ok: false, error: 'Could not connect vertices', meshChanged: false})
        expect(bm.totedge).toBe(4)
    })
})

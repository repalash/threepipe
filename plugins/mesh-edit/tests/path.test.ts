/**
 * Shortest path select: the graph search from `bmesh_path.cc` and the operator from
 * `editmesh_path.cc`.
 */

import {describe, expect, it} from 'vitest'
import {bmFromMesh, BMesh, BMEdge, BMFace, BMVert, ElemFlag, primitiveGrid, SelectMode, selectCountsRecalc, selectHistoryActive, selectHistoryStore, vertSelectSet, faceSelectSet, edgeSelectSet, selectNone} from '@threepipe/mesh-kernel'
import {calcPathEdge, calcPathFace, calcPathVert, checkerIntervalTest, shortestPathPick, activeElemOrFace} from '../src/select/path'

function grid(mode: number, n = 4) {
    const bm = bmFromMesh(primitiveGrid({xSegments: n, ySegments: n, size: n / 2}))
    bm.selectMode = mode
    // A new primitive comes fully selected, as in Blender; start clean.
    selectNone(bm)
    const verts = [...bm.verts]
    const at = (x: number, y: number): BMVert => {
        const v = verts.find(v => Math.abs(v.x - x) < 1e-6 && Math.abs(v.y - y) < 1e-6)
        if (!v) throw new Error(`no vertex at ${x}, ${y}`)
        return v
    }
    const edge = (x0: number, y0: number, x1: number, y1: number): BMEdge =>
        [...bm.edges].find(e => e.joins(at(x0, y0), at(x1, y1)))!
    const faceAt = (cx: number, cy: number): BMFace =>
        [...bm.faces].find(f => {
            const vs = f.verts()
            const x = vs.reduce((s, v) => s + v.x, 0) / vs.length
            const y = vs.reduce((s, v) => s + v.y, 0) / vs.length
            return Math.abs(x - cx) < 1e-6 && Math.abs(y - cy) < 1e-6
        })!
    return {bm, at, edge, faceAt}
}

function counts(bm: BMesh): [number, number, number] {
    selectCountsRecalc(bm)
    return [bm.totvertsel, bm.totedgesel, bm.totfacesel]
}

const notHidden = (e: {hflag: number}) => !(e.hflag & ElemFlag.Hidden)

describe('BM_mesh_calc_path_vert', () => {
    it('finds a straight path along a row', () => {
        const {bm, at} = grid(SelectMode.Vertex)
        const path = calcPathVert(bm, at(-2, 0), at(2, 0), {}, notHidden)!
        expect(path.map(v => [v.x, v.y])).toEqual([[-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0]])
    })

    it('a corner-to-corner path is one of the shortest, so monotone', () => {
        const {bm, at} = grid(SelectMode.Vertex)
        // Vertex paths cost plain edge length (no turn bias, unlike edge and face paths): every
        // monotone staircase ties at 8 steps, and whichever wins must never step backwards.
        const path = calcPathVert(bm, at(-2, -2), at(2, 2), {}, notHidden)!
        expect(path.length).toBe(9)
        for (let i = 1; i < path.length; i++) {
            const dx = path[i].x - path[i - 1].x
            const dy = path[i].y - path[i - 1].y
            expect(dx + dy).toBe(1)
            expect(dx >= 0 && dy >= 0).toBe(true)
        }
    })

    it('does not walk through filtered vertices', () => {
        const {bm, at} = grid(SelectMode.Vertex, 2)
        // Block the whole middle column: no path from left to right.
        const blocked = new Set([at(0, -1), at(0, 0), at(0, 1)])
        expect(calcPathVert(bm, at(-1, 0), at(1, 0), {}, v => !blocked.has(v))).toBeNull()
    })

    it('with face stepping a diagonal is one step', () => {
        const {bm, at} = grid(SelectMode.Vertex)
        const path = calcPathVert(bm, at(0, 0), at(1, 1), {useStepFace: true, useTopologyDistance: true}, notHidden)!
        expect(path.length).toBe(2)
    })
})

describe('BM_mesh_calc_path_edge', () => {
    it('connects two edges in a row through the edges between them', () => {
        const {bm, edge} = grid(SelectMode.Edge)
        const path = calcPathEdge(bm, edge(-2, 0, -1, 0), edge(1, 0, 2, 0), {}, notHidden)!
        expect(path.length).toBe(4)
        expect(path[0]).toBe(edge(-2, 0, -1, 0))
        expect(path[3]).toBe(edge(1, 0, 2, 0))
    })

    it('with face stepping walks a ring of parallel edges', () => {
        const {bm, edge} = grid(SelectMode.Edge)
        const path = calcPathEdge(bm, edge(0, -2, 1, -2), edge(0, 2, 1, 2), {useStepFace: true}, notHidden)!
        expect(path.length).toBe(5)
        for (const e of path) expect(e.v1.y === e.v2.y).toBe(true)
    })
})

describe('BM_mesh_calc_path_face', () => {
    it('connects two faces across their shared edges', () => {
        const {bm, faceAt} = grid(SelectMode.Face)
        const path = calcPathFace(bm, faceAt(-1.5, -1.5), faceAt(1.5, -1.5), {}, notHidden)!
        expect(path.length).toBe(4)
        expect(path[0]).toBe(faceAt(-1.5, -1.5))
        expect(path[3]).toBe(faceAt(1.5, -1.5))
    })

    it('with face stepping crosses at vertices too', () => {
        const {bm, faceAt} = grid(SelectMode.Face)
        const path = calcPathFace(bm, faceAt(-1.5, -1.5), faceAt(1.5, 1.5), {useStepFace: true, useTopologyDistance: true}, notHidden)!
        expect(path.length).toBe(4)
    })
})

describe('mouse_mesh_shortest_path_* (Ctrl+click)', () => {
    it('selects the path from the active vertex and makes the far end active', () => {
        const {bm, at} = grid(SelectMode.Vertex)
        vertSelectSet(bm, at(-2, 0), true)
        selectHistoryStore(bm, at(-2, 0))
        expect(shortestPathPick(bm, activeElemOrFace(bm), at(2, 0), {trackActive: true})).toBe(true)
        expect(counts(bm)).toEqual([5, 4, 0])
        expect(selectHistoryActive(bm)).toBe(at(2, 0))
    })

    it('a fully selected path is toggled off', () => {
        const {bm, at} = grid(SelectMode.Vertex)
        for (let x = -2; x <= 2; x++) vertSelectSet(bm, at(x, 0), true)
        selectHistoryStore(bm, at(-2, 0))
        shortestPathPick(bm, at(-2, 0), at(2, 0), {trackActive: true})
        expect(counts(bm)[0]).toBe(0)
        expect(selectHistoryActive(bm)).toBeNull()
    })

    it('edge paths can tag seams instead of selecting', () => {
        const {bm, edge} = grid(SelectMode.Edge)
        edgeSelectSet(bm, edge(-2, 0, -1, 0), true)
        selectHistoryStore(bm, edge(-2, 0, -1, 0))
        shortestPathPick(bm, edge(-2, 0, -1, 0), edge(1, 0, 2, 0), {trackActive: true, edgeMode: 'seam'})
        let seams = 0
        for (const e of bm.edges) if (e.hflag & ElemFlag.Seam) seams++
        expect(seams).toBe(4)
        // The last edge is always active and selected in a tag mode.
        expect(selectHistoryActive(bm)).toBe(edge(1, 0, 2, 0))
    })

    it('face paths select the faces between', () => {
        const {bm, faceAt} = grid(SelectMode.Face)
        faceSelectSet(bm, faceAt(-1.5, -1.5), true)
        selectHistoryStore(bm, faceAt(-1.5, -1.5))
        shortestPathPick(bm, faceAt(-1.5, -1.5), faceAt(1.5, -1.5), {trackActive: true})
        expect(counts(bm)[2]).toBe(4)
        expect(bm.actFace).toBe(faceAt(1.5, -1.5))
    })

    it('refuses mismatched element kinds', () => {
        const {bm, at, edge} = grid(SelectMode.Vertex | SelectMode.Edge)
        expect(shortestPathPick(bm, at(0, 0), edge(0, 0, 1, 0), {})).toBe(false)
    })

    it('with the same element as source and destination just toggles it', () => {
        const {bm, at} = grid(SelectMode.Vertex)
        shortestPathPick(bm, at(0, 0), at(0, 0), {trackActive: true})
        expect(counts(bm)[0]).toBe(1)
        shortestPathPick(bm, at(0, 0), at(0, 0), {trackActive: true})
        expect(counts(bm)[0]).toBe(0)
    })
})

describe('checker interval', () => {
    it('is always true when skip is zero', () => {
        for (let d = -1; d < 6; d++) expect(checkerIntervalTest({nth: 1, skip: 0, offset: 0}, d)).toBe(true)
    })

    it('skips every other element with nth 1 skip 1', () => {
        const hits = [-1, 0, 1, 2, 3, 4].map(d => checkerIntervalTest({nth: 1, skip: 1, offset: 0}, d))
        // C's remainder: -1 % 2 is -1, which is not >= 1.
        expect(hits).toEqual([false, false, true, false, true, false])
    })
})

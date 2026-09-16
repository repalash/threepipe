import {describe, expect, it} from 'vitest'
import {BMesh} from './BMesh'
import {BMVert} from './types'
import {diskEdgeExists} from './structure'
import {ElemFlag, SelectMode} from '../constants'
import {
    edgeSelectSet,
    faceHideSet,
    faceSelectSet,
    revealAll,
    selectAll,
    selectCountsRecalc,
    selectedElements,
    selectFlush,
    selectFlushMode,
    selectHistoryActive,
    selectHistoryStore,
    selectHistoryValidate,
    selectInvert,
    selectModeSet,
    selectNone,
    vertHideSet,
    vertSelectSet,
} from './marking'

/** A 2x2 quad grid: 9 verts, 12 edges, 4 faces. Interior vertex is shared by all four. */
function grid2x2() {
    const bm = new BMesh()
    const v: BMVert[] = []
    for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) v.push(bm.vertCreate(x, 0, z))
    const at = (x: number, z: number) => v[z * 3 + x]
    const faces = []
    for (let z = 0; z < 2; z++) {
        for (let x = 0; x < 2; x++) {
            faces.push(bm.faceCreate([at(x, z), at(x + 1, z), at(x + 1, z + 1), at(x, z + 1)]))
        }
    }
    return {bm, v, at, faces}
}

/** Counters must always agree with a fresh count; every test ends with this. */
function expectCountsConsistent(bm: BMesh) {
    const before = [bm.totvertsel, bm.totedgesel, bm.totfacesel]
    selectCountsRecalc(bm)
    expect([bm.totvertsel, bm.totedgesel, bm.totfacesel]).toEqual(before)
}

describe('propagation on individual set', () => {
    it('selecting an edge selects both its vertices', () => {
        const {bm, v, at} = grid2x2()
        const e = diskEdgeExists(at(0, 0), at(1, 0))!
        edgeSelectSet(bm, e, true)
        expect(e.hflag & ElemFlag.Select).toBeTruthy()
        expect(at(0, 0).hflag & ElemFlag.Select).toBeTruthy()
        expect(at(1, 0).hflag & ElemFlag.Select).toBeTruthy()
        expect(bm.totvertsel).toBe(2)
        expect(bm.totedgesel).toBe(1)
        expectCountsConsistent(bm)
        expect(v.length).toBe(9)
    })

    it('selecting a face selects all its edges and vertices', () => {
        const {bm, faces} = grid2x2()
        faceSelectSet(bm, faces[0], true)
        expect(bm.totfacesel).toBe(1)
        expect(bm.totedgesel).toBe(4)
        expect(bm.totvertsel).toBe(4)
        expectCountsConsistent(bm)
    })

    it('deselecting an edge keeps a vertex alive when another selected edge uses it', () => {
        const {bm, at} = grid2x2()
        bm.selectMode = SelectMode.Edge // vertex mode off, so the "any other" rule applies
        const shared = at(1, 0)
        const e1 = diskEdgeExists(at(0, 0), shared)!
        const e2 = diskEdgeExists(shared, at(2, 0))!
        edgeSelectSet(bm, e1, true)
        edgeSelectSet(bm, e2, true)
        expect(bm.totvertsel).toBe(3)

        edgeSelectSet(bm, e1, false)
        // The shared vertex survives because e2 is still selected.
        expect(shared.hflag & ElemFlag.Select).toBeTruthy()
        expect(at(0, 0).hflag & ElemFlag.Select).toBeFalsy()
        expectCountsConsistent(bm)
    })

    it('in vertex mode deselecting an edge deselects both vertices outright', () => {
        const {bm, at} = grid2x2()
        bm.selectMode = SelectMode.Vertex
        const shared = at(1, 0)
        const e1 = diskEdgeExists(at(0, 0), shared)!
        const e2 = diskEdgeExists(shared, at(2, 0))!
        edgeSelectSet(bm, e1, true)
        edgeSelectSet(bm, e2, true)
        edgeSelectSet(bm, e1, false)
        // Blender's documented asymmetry: vertex mode is authoritative, so it does not protect the vertex.
        expect(shared.hflag & ElemFlag.Select).toBeFalsy()
        expectCountsConsistent(bm)
    })

    it('deselecting a face keeps an edge alive when another selected face uses it', () => {
        const {bm, faces, at} = grid2x2()
        faceSelectSet(bm, faces[0], true)
        faceSelectSet(bm, faces[1], true)
        const shared = diskEdgeExists(at(1, 0), at(1, 1))!
        faceSelectSet(bm, faces[0], false)
        expect(shared.hflag & ElemFlag.Select).toBeTruthy()
        expectCountsConsistent(bm)
    })
})

describe('flushing', () => {
    it('selects an edge only when both vertices are selected', () => {
        const {bm, at} = grid2x2()
        vertSelectSet(bm, at(0, 0), true)
        selectFlush(bm)
        expect(bm.totedgesel).toBe(0)

        vertSelectSet(bm, at(1, 0), true)
        selectFlush(bm)
        expect(bm.totedgesel).toBe(1)
        expectCountsConsistent(bm)
    })

    it('selects a face only when every one of its edges is selected', () => {
        const {bm, faces, at} = grid2x2()
        for (const c of [[0, 0], [1, 0], [1, 1]] as const) vertSelectSet(bm, at(c[0], c[1]), true)
        selectFlush(bm)
        expect(bm.totfacesel).toBe(0) // three of four corners is not enough

        vertSelectSet(bm, at(0, 1), true)
        selectFlush(bm)
        expect(bm.totfacesel).toBe(1)
        expect(faces[0].hflag & ElemFlag.Select).toBeTruthy()
        expectCountsConsistent(bm)
    })

    it('flush deselects an edge whose vertex was deselected', () => {
        const {bm, at} = grid2x2()
        const e = diskEdgeExists(at(0, 0), at(1, 0))!
        edgeSelectSet(bm, e, true)
        vertSelectSet(bm, at(0, 0), false)
        selectFlush(bm)
        expect(e.hflag & ElemFlag.Select).toBeFalsy()
        expectCountsConsistent(bm)
    })

    it('face mode flushes down to edges and vertices', () => {
        const {bm, faces} = grid2x2()
        bm.selectMode = SelectMode.Face
        faces[0].hflag |= ElemFlag.Select
        selectCountsRecalc(bm)
        selectFlushMode(bm)
        expect(bm.totedgesel).toBe(4)
        expect(bm.totvertsel).toBe(4)
        expectCountsConsistent(bm)
    })

    it('edge mode flushes down to vertices', () => {
        const {bm, at} = grid2x2()
        bm.selectMode = SelectMode.Edge
        const e = diskEdgeExists(at(0, 0), at(1, 0))!
        e.hflag |= ElemFlag.Select
        selectCountsRecalc(bm)
        selectFlushMode(bm)
        expect(bm.totvertsel).toBe(2)
        expectCountsConsistent(bm)
    })
})

describe('select all, none, invert', () => {
    it('selectAll selects every element on every domain', () => {
        const {bm} = grid2x2()
        selectAll(bm)
        expect(bm.totvertsel).toBe(9)
        expect(bm.totedgesel).toBe(12)
        expect(bm.totfacesel).toBe(4)
        expectCountsConsistent(bm)
    })

    it('selectNone clears everything and the history', () => {
        const {bm, v} = grid2x2()
        selectAll(bm)
        selectHistoryStore(bm, v[0])
        selectNone(bm)
        expect([bm.totvertsel, bm.totedgesel, bm.totfacesel]).toEqual([0, 0, 0])
        expect(bm.selectHistory).toEqual([])
        expectCountsConsistent(bm)
    })

    it('invert in vertex mode swaps exactly the vertex set', () => {
        const {bm, at} = grid2x2()
        bm.selectMode = SelectMode.Vertex
        vertSelectSet(bm, at(0, 0), true)
        selectFlush(bm)
        selectInvert(bm)
        expect(bm.totvertsel).toBe(8)
        expect(at(0, 0).hflag & ElemFlag.Select).toBeFalsy()
        expectCountsConsistent(bm)
    })

    it('invert in face mode swaps the face set', () => {
        const {bm, faces} = grid2x2()
        bm.selectMode = SelectMode.Face
        faceSelectSet(bm, faces[0], true)
        selectInvert(bm)
        expect(bm.totfacesel).toBe(3)
        expect(faces[0].hflag & ElemFlag.Select).toBeFalsy()
        expectCountsConsistent(bm)
    })
})

describe('mode switching', () => {
    it('converts a face selection into vertex mode', () => {
        const {bm, faces} = grid2x2()
        selectModeSet(bm, SelectMode.Face)
        faceSelectSet(bm, faces[0], true)
        selectModeSet(bm, SelectMode.Vertex)
        expect(bm.totvertsel).toBe(4)
        expectCountsConsistent(bm)
    })

    it('drops history entries the new mode cannot represent', () => {
        const {bm, faces, v} = grid2x2()
        selectModeSet(bm, SelectMode.Vertex | SelectMode.Face)
        faceSelectSet(bm, faces[0], true)
        selectHistoryStore(bm, faces[0])
        selectHistoryStore(bm, v[0])
        expect(bm.selectHistory.length).toBe(2)

        selectModeSet(bm, SelectMode.Vertex)
        expect(bm.selectHistory.every(h => h.elem instanceof BMVert)).toBe(true)
    })

    it('rejects an empty mode', () => {
        const {bm} = grid2x2()
        expect(() => selectModeSet(bm, 0)).toThrow(/at least one domain/)
    })
})

describe('selection history', () => {
    it('tracks the active element as the last stored', () => {
        const {bm, v} = grid2x2()
        vertSelectSet(bm, v[0], true)
        vertSelectSet(bm, v[1], true)
        selectHistoryStore(bm, v[0])
        selectHistoryStore(bm, v[1])
        expect(selectHistoryActive(bm)).toBe(v[1])
    })

    it('re-storing moves an element to the end rather than duplicating it', () => {
        const {bm, v} = grid2x2()
        selectHistoryStore(bm, v[0])
        selectHistoryStore(bm, v[1])
        selectHistoryStore(bm, v[0])
        expect(bm.selectHistory.length).toBe(2)
        expect(selectHistoryActive(bm)).toBe(v[0])
    })

    it('validate drops entries that are no longer selected', () => {
        const {bm, v} = grid2x2()
        vertSelectSet(bm, v[0], true)
        selectHistoryStore(bm, v[0])
        vertSelectSet(bm, v[0], false)
        selectHistoryValidate(bm)
        expect(bm.selectHistory).toEqual([])
    })
})

describe('hiding', () => {
    it('hiding a vertex hides its edges and faces, and deselects them', () => {
        const {bm, at} = grid2x2()
        selectAll(bm)
        vertHideSet(bm, at(1, 1), true) // the interior vertex, used by all four faces
        expect(at(1, 1).hflag & ElemFlag.Hidden).toBeTruthy()
        expect(bm.totfacesel).toBe(0)
        expectCountsConsistent(bm)
    })

    it('a hidden element cannot be selected', () => {
        const {bm, faces} = grid2x2()
        faceHideSet(bm, faces[0], true)
        faceSelectSet(bm, faces[0], true)
        expect(faces[0].hflag & ElemFlag.Select).toBeFalsy()
        expectCountsConsistent(bm)
    })

    it('flush never selects a hidden element', () => {
        const {bm, faces} = grid2x2()
        faceHideSet(bm, faces[0], true)
        selectAll(bm)
        expect(faces[0].hflag & ElemFlag.Select).toBeFalsy()
        expectCountsConsistent(bm)
    })

    it('reveal unhides and selects what was revealed', () => {
        const {bm, faces} = grid2x2()
        faceHideSet(bm, faces[0], true)
        revealAll(bm)
        expect(faces[0].hflag & ElemFlag.Hidden).toBeFalsy()
        expect(bm.totfacesel).toBe(4)
        expectCountsConsistent(bm)
    })
})

describe('selectedElements', () => {
    it('returns the domain matching the mode', () => {
        const {bm, faces} = grid2x2()
        selectModeSet(bm, SelectMode.Face)
        faceSelectSet(bm, faces[0], true)
        expect(selectedElements(bm)).toEqual([faces[0]])

        selectModeSet(bm, SelectMode.Vertex)
        expect(selectedElements(bm).length).toBe(4)
    })
})

describe('selection survives mesh validity', () => {
    it('every selection operation leaves the mesh valid', () => {
        const {bm, faces, v} = grid2x2()
        selectAll(bm)
        expect(bm.validate()).toEqual([])
        selectInvert(bm)
        expect(bm.validate()).toEqual([])
        selectModeSet(bm, SelectMode.Edge)
        expect(bm.validate()).toEqual([])
        vertHideSet(bm, v[0], true)
        expect(bm.validate()).toEqual([])
        revealAll(bm)
        expect(bm.validate()).toEqual([])
        faceSelectSet(bm, faces[0], false)
        expect(bm.validate()).toEqual([])
    })
})

/**
 * Box, lasso and circle select: Blender's selection operations and edge rules, on a fake projection
 * and fake visibility bitmaps. The GPU buffer itself is covered by the Playwright suite.
 */

import {describe, expect, it} from 'vitest'
import {bmFromMesh, BMesh, BMVert, ElemFlag, primitiveGrid, SelectMode, vertSelectSet, faceSelectSet, edgeSelectSet, selectCountsRecalc, selectNone} from '@threepipe/mesh-kernel'
import {regionSelect, RegionVisibility} from '../src/select/regionSelect'
import {selectOpAction, selectOpActionDeselected, selectOpFromModifiers} from '../src/select/selectOp'
import type {ProjectFn} from '../src/picking'
import type {SelectElements} from '../src/select/findNearest'

/** A 4x4 grid of quads on the XY plane, 5x5 vertices from -1 to 1. */
function grid(mode: number): {bm: BMesh, elements: SelectElements, at: (x: number, y: number) => BMVert} {
    const bm = bmFromMesh(primitiveGrid({xSegments: 4, ySegments: 4, size: 1}))
    bm.selectMode = mode
    // A new primitive comes fully selected, as in Blender; start clean.
    selectNone(bm)
    const verts = [...bm.verts]
    const at = (x: number, y: number) => {
        const v = verts.find(v => Math.abs(v.x - x) < 1e-6 && Math.abs(v.y - y) < 1e-6)
        if (!v) throw new Error(`no vertex at ${x}, ${y}`)
        return v
    }
    return {bm, elements: {verts, edges: [...bm.edges], faces: [...bm.faces]}, at}
}

/** Orthographic top-down projection: 100 px per unit, origin at (200, 200), y down. */
const project: ProjectFn = (x, y) => ({x: 200 + x * 100, y: 200 - y * 100, depth: 0.5})

function counts(bm: BMesh): [number, number, number] {
    selectCountsRecalc(bm)
    return [bm.totvertsel, bm.totedgesel, bm.totfacesel]
}

describe('select op actions (select_utils.cc)', () => {
    it('match ED_select_op_action_deselected', () => {
        // [op, isSelect, isInside] -> result
        expect(selectOpActionDeselected('set', false, true)).toBe(1)
        expect(selectOpActionDeselected('set', true, false)).toBe(-1)
        expect(selectOpActionDeselected('add', false, true)).toBe(1)
        expect(selectOpActionDeselected('add', true, true)).toBe(-1)
        expect(selectOpActionDeselected('sub', true, true)).toBe(0)
        expect(selectOpActionDeselected('sub', false, true)).toBe(-1)
        expect(selectOpActionDeselected('and', true, true)).toBe(-1)
        expect(selectOpActionDeselected('and', true, false)).toBe(0)
        expect(selectOpActionDeselected('and', false, true)).toBe(-1)
        expect(selectOpActionDeselected('xor', true, true)).toBe(0)
        expect(selectOpActionDeselected('xor', false, true)).toBe(1)
        expect(selectOpActionDeselected('xor', false, false)).toBe(-1)
    })

    it('set deselects outside elements only in the non-deselected variant', () => {
        expect(selectOpAction('set', true, false)).toBe(0)
        expect(selectOpActionDeselected('set', true, false)).toBe(-1)
    })

    it('maps the select-box tool modifiers', () => {
        expect(selectOpFromModifiers(false, false)).toBe('set')
        expect(selectOpFromModifiers(true, false)).toBe('add')
        expect(selectOpFromModifiers(false, true)).toBe('sub')
        expect(selectOpFromModifiers(true, true)).toBe('and')
    })
})

describe('box select, X-ray (projected)', () => {
    it('selects the vertices inside the rectangle and nothing else', () => {
        const {bm, elements, at} = grid(SelectMode.Vertex)
        // The box covers x in [-0.6, 0.6], y in [-0.6, 0.6]: the 3x3 inner vertices at -0.5, 0, 0.5.
        const changed = regionSelect(bm, elements, {kind: 'rect', rect: {xmin: 140, ymin: 140, xmax: 260, ymax: 260}}, 'set', project, null)
        expect(changed).toBe(true)
        expect(counts(bm)).toEqual([9, 12, 4])
        expect(at(0, 0).hflag & ElemFlag.Select).toBeTruthy()
        expect(at(1, 1).hflag & ElemFlag.Select).toBeFalsy()
    })

    it('set replaces, add extends, sub subtracts, and intersects, xor toggles', () => {
        const {bm, elements, at} = grid(SelectMode.Vertex)
        const left = {kind: 'rect', rect: {xmin: 90, ymin: 90, xmax: 160, ymax: 310}} as const // x = -1, -0.5
        const top = {kind: 'rect', rect: {xmin: 90, ymin: 90, xmax: 310, ymax: 160}} as const // y = 1, 0.5
        regionSelect(bm, elements, left, 'set', project, null)
        expect(counts(bm)[0]).toBe(10)
        regionSelect(bm, elements, top, 'add', project, null)
        expect(counts(bm)[0]).toBe(16) // 10 + 10 - 4 shared
        regionSelect(bm, elements, top, 'sub', project, null)
        expect(counts(bm)[0]).toBe(6) // left column minus its top two rows
        regionSelect(bm, elements, top, 'add', project, null)
        regionSelect(bm, elements, top, 'and', project, null)
        expect(counts(bm)[0]).toBe(10)
        expect(at(-1, -1).hflag & ElemFlag.Select).toBeFalsy()
        regionSelect(bm, elements, left, 'xor', project, null)
        expect(counts(bm)[0]).toBe(12) // top row keeps 6 outside left; left adds 6 below the top
        regionSelect(bm, elements, left, 'set', project, null)
        expect(counts(bm)[0]).toBe(10)
    })

    it('in edge mode takes fully enclosed edges first, crossing edges only when none is enclosed', () => {
        const {bm, elements} = grid(SelectMode.Edge)
        // A thin box around the vertical edge between (0, 0) and (0, 0.5), with margin: fully inside.
        regionSelect(bm, elements, {kind: 'rect', rect: {xmin: 190, ymin: 140, xmax: 210, ymax: 210}}, 'set', project, null)
        expect(counts(bm)).toEqual([2, 1, 0])
        // A box around the middle of that edge only: nothing is enclosed, so the crossing edge is taken.
        regionSelect(bm, elements, {kind: 'rect', rect: {xmin: 190, ymin: 165, xmax: 210, ymax: 185}}, 'set', project, null)
        expect(counts(bm)).toEqual([2, 1, 0])
        // A box around a vertex crosses four edges but encloses none.
        regionSelect(bm, elements, {kind: 'rect', rect: {xmin: 190, ymin: 190, xmax: 210, ymax: 210}}, 'set', project, null)
        expect(counts(bm)).toEqual([5, 4, 0])
    })

    it('in face mode tests the face centre', () => {
        const {bm, elements} = grid(SelectMode.Face)
        // Face centres sit at +-0.25, +-0.75; this box holds the four centres around the origin.
        regionSelect(bm, elements, {kind: 'rect', rect: {xmin: 170, ymin: 170, xmax: 230, ymax: 230}}, 'set', project, null)
        expect(counts(bm)).toEqual([9, 12, 4])
    })

    it('reports no change when nothing is inside, and keeps the selection on add', () => {
        const {bm, elements, at} = grid(SelectMode.Vertex)
        vertSelectSet(bm, at(1, 1), true)
        expect(regionSelect(bm, elements, {kind: 'rect', rect: {xmin: 0, ymin: 0, xmax: 10, ymax: 10}}, 'add', project, null)).toBe(false)
        expect(counts(bm)[0]).toBe(1)
        // Set with an empty box deselects everything: Blender's pre-deselect.
        expect(regionSelect(bm, elements, {kind: 'rect', rect: {xmin: 0, ymin: 0, xmax: 10, ymax: 10}}, 'set', project, null)).toBe(true)
        expect(counts(bm)[0]).toBe(0)
    })
})

describe('box select on the selection buffer', () => {
    function visibility(elements: SelectElements, inside: {verts?: BMVert[], edges?: number[], faces?: number[]}): RegionVisibility {
        const v = new Uint8Array(elements.verts.length)
        const e = new Uint8Array(elements.edges.length)
        const f = new Uint8Array(elements.faces.length)
        for (const vert of inside.verts ?? []) v[elements.verts.indexOf(vert)] = 1
        for (const i of inside.edges ?? []) e[i] = 1
        for (const i of inside.faces ?? []) f[i] = 1
        return {verts: v, edges: e, faces: f}
    }

    it('selects exactly the vertices the buffer saw, whatever the projection says', () => {
        const {bm, elements, at} = grid(SelectMode.Vertex)
        const vis = visibility(elements, {verts: [at(1, 1), at(-1, -1)]})
        // The rectangle would cover everything on the CPU path; the bitmap wins.
        regionSelect(bm, elements, {kind: 'rect', rect: {xmin: 0, ymin: 0, xmax: 400, ymax: 400}}, 'set', project, vis)
        expect(counts(bm)[0]).toBe(2)
        expect(at(1, 1).hflag & ElemFlag.Select).toBeTruthy()
    })

    it('an edge needs both a buffer pixel and enclosed endpoints', () => {
        const {bm, elements} = grid(SelectMode.Edge)
        const edgeIndex = elements.edges.findIndex(e => e.v1.x === e.v2.x && Math.min(e.v1.y, e.v2.y) === 0 && e.v1.x === 0)
        expect(edgeIndex).toBeGreaterThanOrEqual(0)
        const vis = visibility(elements, {edges: [edgeIndex]})
        // Enclosing rect over the whole grid: only the visible edge is enclosed-and-visible.
        regionSelect(bm, elements, {kind: 'rect', rect: {xmin: 0, ymin: 0, xmax: 400, ymax: 400}}, 'set', project, vis)
        expect(counts(bm)).toEqual([2, 1, 0])
        // A rect that does not enclose it: pass 1 (crossing) still needs the buffer bit, which the
        // other edges lack, so only this edge can be taken.
        regionSelect(bm, elements, {kind: 'rect', rect: {xmin: 190, ymin: 165, xmax: 210, ymax: 185}}, 'set', project, vis)
        expect(counts(bm)).toEqual([2, 1, 0])
    })

    it('hidden elements are never selected', () => {
        const {bm, elements, at} = grid(SelectMode.Vertex)
        at(0, 0).hflag |= ElemFlag.Hidden
        const vis = visibility(elements, {verts: [at(0, 0), at(0.5, 0)]})
        regionSelect(bm, elements, {kind: 'rect', rect: {xmin: 0, ymin: 0, xmax: 400, ymax: 400}}, 'set', project, vis)
        expect(counts(bm)[0]).toBe(1)
        expect(at(0, 0).hflag & ElemFlag.Select).toBeFalsy()
    })
})

describe('lasso select (projected)', () => {
    it('selects the vertices inside the polygon, not just its bounding box', () => {
        const {bm, elements, at} = grid(SelectMode.Vertex)
        // A triangle with corners at (-1.2, 1.2), (1.2, 1.2), (0, -1.2): the top row is inside, the
        // bottom corners are outside its bounding box's lower corners.
        const points: [number, number][] = [[80, 80], [320, 80], [200, 320]]
        regionSelect(bm, elements, {kind: 'lasso', points}, 'set', project, null)
        expect(at(-1, 1).hflag & ElemFlag.Select).toBeTruthy()
        expect(at(1, 1).hflag & ElemFlag.Select).toBeTruthy()
        expect(at(0, -1).hflag & ElemFlag.Select).toBeTruthy()
        expect(at(-1, -1).hflag & ElemFlag.Select).toBeFalsy()
        expect(at(1, -1).hflag & ElemFlag.Select).toBeFalsy()
        expect(at(-1, 0).hflag & ElemFlag.Select).toBeFalsy()
    })

    it('in edge mode an edge crossing the lasso is taken when none is enclosed', () => {
        const {bm, elements} = grid(SelectMode.Edge)
        // A small diamond around (0.25, 0): crosses the horizontal edge from (0, 0) to (0.5, 0) only.
        const points: [number, number][] = [[225, 190], [235, 200], [225, 210], [215, 200]]
        regionSelect(bm, elements, {kind: 'lasso', points}, 'set', project, null)
        expect(counts(bm)).toEqual([2, 1, 0])
    })
})

describe('circle select (projected)', () => {
    it('adds what is inside the circle and subtracts with sub', () => {
        const {bm, elements, at} = grid(SelectMode.Vertex)
        regionSelect(bm, elements, {kind: 'circle', x: 200, y: 200, radius: 60}, 'add', project, null)
        // Within 0.6 units of the origin: the origin and its four axis neighbours at 0.5.
        expect(counts(bm)[0]).toBe(5)
        regionSelect(bm, elements, {kind: 'circle', x: 200, y: 200, radius: 10}, 'sub', project, null)
        expect(counts(bm)[0]).toBe(4)
        expect(at(0, 0).hflag & ElemFlag.Select).toBeFalsy()
    })

    it('in edge mode takes edges that pass through the circle', () => {
        const {bm, elements} = grid(SelectMode.Edge)
        // A circle of 10 px around the middle of the edge from (0, 0) to (0.5, 0).
        regionSelect(bm, elements, {kind: 'circle', x: 225, y: 200, radius: 10}, 'add', project, null)
        expect(counts(bm)).toEqual([2, 1, 0])
    })

    it('in face mode tests the centre, and flushes nothing else', () => {
        const {bm, elements} = grid(SelectMode.Face)
        regionSelect(bm, elements, {kind: 'circle', x: 225, y: 175, radius: 10}, 'add', project, null)
        expect(counts(bm)).toEqual([4, 4, 1])
    })
})

describe('mode flush after a region', () => {
    it('vertex mode selects the edges and faces whose vertices are all inside', () => {
        const {bm, elements} = grid(SelectMode.Vertex)
        regionSelect(bm, elements, {kind: 'rect', rect: {xmin: 90, ymin: 90, xmax: 260, ymax: 260}}, 'set', project, null)
        // 4x4 vertices, 3x3 faces.
        expect(counts(bm)).toEqual([16, 24, 9])
    })

    it('edge mode does not select edges between selected vertices that were not inside', () => {
        const {bm, elements, at} = grid(SelectMode.Edge)
        // Select two opposite edges of the quad at the origin, then the region flush runs.
        const top = [...bm.edges].find(e => e.joins(at(0, 0.5), at(0.5, 0.5)))!
        const bottom = [...bm.edges].find(e => e.joins(at(0, 0), at(0.5, 0)))!
        edgeSelectSet(bm, top, true)
        edgeSelectSet(bm, bottom, true)
        regionSelect(bm, elements, {kind: 'rect', rect: {xmin: 0, ymin: 0, xmax: 1, ymax: 1}}, 'add', project, null)
        // No change inside the box, and no quad edges dragged along by the four selected corners.
        expect(counts(bm)).toEqual([4, 2, 0])
    })

    it('face select propagates to the face\'s edges and vertices', () => {
        const {bm, elements} = grid(SelectMode.Face)
        faceSelectSet(bm, elements.faces[0], true)
        expect(counts(bm)).toEqual([4, 4, 1])
    })
})

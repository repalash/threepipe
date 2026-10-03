/**
 * Element selection: the selection-buffer search and Blender's rule for which element a click means.
 *
 * The buffer is faked here - the GPU half is covered by the Playwright suite - so these pin the logic
 * ported from `array_utils_c.cc` and `editmesh_select.cc` on its own.
 */

import {describe, expect, it} from 'vitest'
import {bmFromMesh, primitiveCube, primitiveGrid, SelectMode, BMesh} from '@threepipe/mesh-kernel'
import {findNearestId, spiralSquare} from '../src/select/spiral'
import {SELECT_DIST_PX, SelectSampler, unifiedFindNearest} from '../src/select/findNearest'
import type {ProjectFn} from '../src/picking'

describe('spiralSquare', () => {
    it('visits a 3x3 buffer in Blender\'s order', () => {
        // Traced by hand through `_bli_array_iter_spiral_square` (array_utils_c.cc:290) for a 3x3
        // array centred at (1, 1): centre, then the ring from the negative-quadrant diagonal.
        const order: number[] = []
        spiralSquare([3, 3], [1, 1], i => {
            order.push(i)
            return false
        })
        expect(order).toEqual([4, 1, 2, 5, 8, 7, 6, 3, 0])
    })

    it('visits every cell of a larger buffer once, ring by ring', () => {
        for (const size of [5, 9, 151]) {
            const c = (size - 1) / 2
            const seen = new Set<number>()
            let lastRing = 0
            spiralSquare([size, size], [c, c], i => {
                expect(seen.has(i)).toBe(false)
                seen.add(i)
                const ring = Math.max(Math.abs(Math.floor(i / size) - c), Math.abs((i % size) - c))
                expect(ring).toBeGreaterThanOrEqual(lastRing)
                lastRing = ring
                return false
            })
            expect(seen.size).toBe(size * size)
        }
    })

    it('stops at the first hit', () => {
        let visits = 0
        const hit = spiralSquare([5, 5], [2, 2], i => {
            visits++
            return i === 7
        })
        expect(hit).toBe(7)
        expect(visits).toBeLessThan(10)
    })
})

describe('findNearestId', () => {
    it('returns the id and its Manhattan distance from the centre', () => {
        const size = 7
        const ids = new Uint32Array(size * size)
        ids[1 * size + 5] = 42 // two rows and two columns from the centre (3, 3)
        expect(findNearestId(ids, size)).toEqual({id: 42, dist: 4})
    })

    it('prefers the inner ring even when an outer id is closer in a straight line', () => {
        const size = 9
        const ids = new Uint32Array(size * size)
        ids[4 * size + 8] = 1 // same row, 4 columns away: ring 4, Manhattan 4
        ids[2 * size + 2] = 2 // diagonal: ring 2, Manhattan 4
        expect(findNearestId(ids, size)?.id).toBe(2)
    })

    it('finds nothing in an empty buffer', () => {
        expect(findNearestId(new Uint32Array(25), 5)).toBeNull()
    })
})

/** A sampler answering from fixed tables, so the rule can be tested without a GPU. */
function fakeSampler(table: {
    face?: number | null
    edge?: {index: number, dist: number} | null
    vert?: {index: number, dist: number} | null
}): SelectSampler & {calls: string[]} {
    const calls: string[] = []
    return {
        calls,
        samplePoint(domain) {
            calls.push('sample:' + domain)
            return domain === 'face' ? table.face ?? null : null
        },
        findNearest(domain, _x, _y, dist) {
            calls.push(`nearest:${domain}:${dist}`)
            const hit = domain === 'edge' ? table.edge : domain === 'vert' ? table.vert : null
            // The real buffer only returns ids inside the (2r+1) square, i.e. Manhattan <= 2r.
            return hit && hit.dist <= 2 * dist ? hit : null
        },
    }
}

function cubeBMesh(mode: number): BMesh {
    const bm = bmFromMesh(primitiveCube({size: 2}))
    bm.selectMode = mode
    return bm
}

const elementsOf = (bm: BMesh) => ({verts: [...bm.verts], edges: [...bm.edges], faces: [...bm.faces]})

/** Projects everything to the given point, so centre distances are controlled by the test. */
const projectTo = (x: number, y: number): ProjectFn => () => ({x, y, depth: 0.5})

describe('unifiedFindNearest (editmesh_select.cc unified_findnearest)', () => {
    it('uses Blender\'s 75 px reach', () => {
        expect(SELECT_DIST_PX).toBe(75)
        const bm = cubeBMesh(SelectMode.Vertex)
        const sampler = fakeSampler({vert: {index: 2, dist: 40}})
        const r = unifiedFindNearest(bm, elementsOf(bm), sampler, 100, 100, projectTo(0, 0))
        expect(sampler.calls).toEqual(['nearest:vert:75'])
        expect(r.element).toBe(elementsOf(bm).verts[2])
    })

    it('in face mode, takes only the face exactly under the cursor', () => {
        const bm = cubeBMesh(SelectMode.Face)
        const sampler = fakeSampler({face: 3})
        const r = unifiedFindNearest(bm, elementsOf(bm), sampler, 10, 10, projectTo(0, 0))
        expect(sampler.calls).toEqual(['sample:face'])
        expect(r.face).toBe(elementsOf(bm).faces[3])
        expect(r.element).toBe(r.face)
    })

    it('gives a vertex priority over an edge and a face', () => {
        const bm = cubeBMesh(SelectMode.Vertex | SelectMode.Edge | SelectMode.Face)
        // Face centre 5 px away caps the edge search at 5; edge found at 3, its centre 4 px away caps
        // the vertex search at 4; vertex found at 2.
        const sampler = fakeSampler({face: 0, edge: {index: 1, dist: 3}, vert: {index: 2, dist: 2}})
        const r = unifiedFindNearest(bm, elementsOf(bm), sampler, 0, 0, (x, y, z) => ({x: 2.5, y: 2.5, depth: 0}))
        expect(r.vert).toBe(elementsOf(bm).verts[2])
        expect(r.edge).toBeNull()
        expect(r.face).toBeNull()
    })

    it('shrinks the search to the face centre, capped at half the reach', () => {
        const bm = cubeBMesh(SelectMode.Edge | SelectMode.Face)
        // Face centre is 200 px away: the edge search gets min(75/2, 200) = 37.5 -> 38 px.
        const sampler = fakeSampler({face: 0, edge: {index: 4, dist: 30}})
        const r = unifiedFindNearest(bm, elementsOf(bm), sampler, 0, 0, projectTo(200, 0))
        expect(sampler.calls).toEqual(['sample:face', 'nearest:edge:38'])
        expect(r.edge).toBe(elementsOf(bm).edges[4])
    })

    it('keeps the face when the edge is further than its centre', () => {
        const bm = cubeBMesh(SelectMode.Edge | SelectMode.Face)
        // Face centre 10 px away: an edge 20 px away does not beat it.
        const sampler = fakeSampler({face: 1, edge: {index: 4, dist: 20}})
        const r = unifiedFindNearest(bm, elementsOf(bm), sampler, 0, 0, projectTo(10, 0))
        expect(r.face).toBe(elementsOf(bm).faces[1])
        expect(r.edge).toBeNull()
    })

    it('falls back to the edge under the cursor when nothing qualified', () => {
        const bm = cubeBMesh(SelectMode.Edge)
        // Found in the buffer square but beyond the 75 px reach: Blender still selects it,
        // "it makes sense to select this".
        const sampler = fakeSampler({edge: {index: 5, dist: 90}})
        const r = unifiedFindNearest(bm, elementsOf(bm), sampler, 0, 0, projectTo(0, 0))
        expect(r.element).toBe(elementsOf(bm).edges[5])
    })

    it('returns nothing on empty space', () => {
        const bm = bmFromMesh(primitiveGrid({xSegments: 2, ySegments: 2}))
        bm.selectMode = SelectMode.Vertex | SelectMode.Edge | SelectMode.Face
        const r = unifiedFindNearest(bm, elementsOf(bm), fakeSampler({}), 0, 0, projectTo(0, 0))
        expect(r.element).toBeNull()
    })
})

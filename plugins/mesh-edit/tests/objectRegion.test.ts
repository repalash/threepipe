/** Object-mode box select's coverage test (`do_object_box_select` under `GPU_SELECT_ALL`). */
import {describe, expect, it} from 'vitest'
import {meshTouchesRect, triangleIntersectsRect} from '../src/select/objectRegion'

const ortho = (x: number, y: number) => [x, y] as [number, number]

describe('triangleIntersectsRect', () => {
    const tri = [0, 0, 10, 0, 0, 10] as const
    it('overlaps when a corner is inside, when the rect is inside, and when edges cross', () => {
        expect(triangleIntersectsRect(...tri, {x0: -1, y0: -1, x1: 1, y1: 1})).toBe(true)
        expect(triangleIntersectsRect(...tri, {x0: 1, y0: 1, x1: 2, y1: 2})).toBe(true)
        expect(triangleIntersectsRect(...tri, {x0: 4, y0: -5, x1: 6, y1: 20})).toBe(true)
    })
    it('separates on the hypotenuse even when the bounding boxes overlap', () => {
        expect(triangleIntersectsRect(...tri, {x0: 8, y0: 8, x1: 9, y1: 9})).toBe(false)
    })
    it('accepts a rect given in any corner order', () => {
        expect(triangleIntersectsRect(...tri, {x0: 1, y0: 1, x1: -1, y1: -1})).toBe(true)
    })
})

describe('meshTouchesRect', () => {
    // A unit quad at z = 0, two triangles.
    const pos = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]
    const idx = [0, 1, 2, 0, 2, 3]
    it('counts any covered pixel, not the centre', () => {
        expect(meshTouchesRect(pos, idx, ortho, {x0: 9, y0: 9, x1: 30, y1: 30})).toBe(true)
        expect(meshTouchesRect(pos, idx, ortho, {x0: 11, y0: 11, x1: 30, y1: 30})).toBe(false)
    })
    it('skips triangles with a corner behind the camera', () => {
        const behind = (x: number, y: number, z: number) => x > 5 ? null : [x, y] as [number, number]
        // Corners 1 and 2 are behind the camera, and each triangle uses one of them, so neither counts.
        expect(meshTouchesRect(pos, idx, behind, {x0: -1, y0: -1, x1: 20, y1: 20})).toBe(false)
    })
    it('works on non-indexed triangle lists', () => {
        const soup = [0, 0, 0, 10, 0, 0, 10, 10, 0]
        expect(meshTouchesRect(soup, null, ortho, {x0: 8, y0: 1, x1: 9, y1: 2})).toBe(true)
    })
})

/**
 * The screen-space tests behind box and lasso select, against the Blender functions they port.
 */

import {describe, expect, it} from 'vitest'
import {
    edgeFullyInsideRect,
    edgeInsideCircle,
    edgeInsideRect,
    ISECT_LINE_LINE_COLINEAR,
    ISECT_LINE_LINE_CROSS,
    ISECT_LINE_LINE_EXACT,
    ISECT_LINE_LINE_NONE,
    isectSegSegV2Int,
    lassoBoundBox,
    lassoIsEdgeInside,
    lassoIsPointInside,
    rasterPolygonMask,
} from '../src/select/lasso'

const square: [number, number][] = [[10, 10], [30, 10], [30, 30], [10, 30]]

describe('lasso_2d.cc', () => {
    it('bound box', () => {
        expect(lassoBoundBox([[5, 7], [-2, 9], [3, -1]])).toEqual({xmin: -2, ymin: -1, xmax: 5, ymax: 9})
    })

    it('point inside polygon, with the integer truncation Blender applies', () => {
        expect(lassoIsPointInside(square, 20, 20)).toBe(true)
        expect(lassoIsPointInside(square, 35, 20)).toBe(false)
        expect(lassoIsPointInside(square, 29.9, 29.9)).toBe(true) // truncates to 29, 29
        expect(lassoIsPointInside([], 20, 20)).toBe(false)
    })

    it('edge inside: an endpoint inside, or a side crossed', () => {
        expect(lassoIsEdgeInside(square, 20, 20, 50, 50)).toBe(true)
        expect(lassoIsEdgeInside(square, 0, 20, 50, 20)).toBe(true) // crosses two sides
        expect(lassoIsEdgeInside(square, 0, 40, 50, 40)).toBe(false)
        expect(lassoIsEdgeInside(square, 0, 0, 5, 5)).toBe(false)
    })
})

describe('isect_seg_seg_v2_int', () => {
    it('classifies crossings', () => {
        expect(isectSegSegV2Int([0, 0], [10, 10], [0, 10], [10, 0])).toBe(ISECT_LINE_LINE_CROSS)
        expect(isectSegSegV2Int([0, 0], [10, 10], [0, 10], [5, 5])).toBe(ISECT_LINE_LINE_EXACT)
        expect(isectSegSegV2Int([0, 0], [10, 10], [20, 0], [30, 10])).toBe(ISECT_LINE_LINE_COLINEAR)
        expect(isectSegSegV2Int([0, 0], [10, 10], [20, 0], [20, 30])).toBe(ISECT_LINE_LINE_NONE)
    })
})

describe('view3d_select.cc edge tests', () => {
    const rect = {xmin: 10, ymin: 10, xmax: 30, ymax: 30}

    it('fully inside is inclusive of the border', () => {
        expect(edgeFullyInsideRect(rect, 10, 10, 30, 30)).toBe(true)
        expect(edgeFullyInsideRect(rect, 10, 10, 31, 30)).toBe(false)
    })

    it('inside: enclosed, crossing, or neither', () => {
        expect(edgeInsideRect(rect, 15, 15, 25, 25)).toBe(true)
        expect(edgeInsideRect(rect, 0, 20, 40, 20)).toBe(true) // straight through
        expect(edgeInsideRect(rect, 0, 0, 40, 5)).toBe(false) // entirely above
        expect(edgeInsideRect(rect, 0, 35, 35, 0)).toBe(true) // diagonal clipping a corner
        expect(edgeInsideRect(rect, 0, 70, 70, 0)).toBe(false) // diagonal missing the corner
    })

    it('inside circle uses the distance to the segment', () => {
        expect(edgeInsideCircle(20, 20, 5, 0, 22, 40, 22)).toBe(true)
        expect(edgeInsideCircle(20, 20, 5, 0, 26, 40, 26)).toBe(false)
    })
})

describe('BLI_bitmap_draw_2d_poly_v2i_n', () => {
    function render(mask: Uint8Array, w: number, h: number): string[] {
        const rows: string[] = []
        for (let y = 0; y < h; y++) {
            let row = ''
            for (let x = 0; x < w; x++) row += mask[y * w + x] ? '#' : '.'
            rows.push(row)
        }
        return rows
    }

    it('fills a square: columns [xmin, xmax), rows (ymin, ymax], as the C code does', () => {
        // A span becomes active on the row of its lower vertex and fills from the row after it,
        // through the row of its upper vertex: Blender's convention, traced from the source.
        const mask = rasterPolygonMask([[1, 1], [4, 1], [4, 4], [1, 4]], 0, 0, 6, 6)
        expect(render(mask, 6, 6)).toEqual([
            '......',
            '......',
            '.###..',
            '.###..',
            '.###..',
            '......',
        ])
    })

    it('fills a triangle and respects the clip rectangle', () => {
        // Traced by hand through the C: x crossings truncate (0.5 -> 0, 7.5 -> 7, 1.5 -> 1, ...).
        const mask = rasterPolygonMask([[0, 0], [8, 0], [4, 8]], 2, 1, 7, 6)
        expect(render(mask, 5, 5)).toEqual([
            '#####',
            '#####',
            '####.',
            '####.',
            '###..',
        ])
    })

    it('a polygon entirely outside fills nothing', () => {
        const mask = rasterPolygonMask([[20, 20], [30, 20], [25, 30]], 0, 0, 10, 10)
        expect(mask.every(b => b === 0)).toBe(true)
    })
})

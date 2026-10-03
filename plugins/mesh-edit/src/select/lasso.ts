/**
 * Screen-space geometry for box, lasso and circle select: point-in-polygon, segment crossings, and
 * the polygon rasteriser that masks the selection buffer to a lasso.
 *
 * Ports, each cited at the function:
 * - `blenlib/intern/lasso_2d.cc` (`BLI_lasso_boundbox`, `BLI_lasso_is_point_inside`,
 *   `BLI_lasso_is_edge_inside`);
 * - `blenlib/intern/math_geom.cc` (`isect_point_poly_v2_int`, `isect_seg_seg_v2_int`,
 *   `dist_squared_to_line_segment_v2`);
 * - `editors/space_view3d/view3d_select.cc` (`edge_fully_inside_rect`, `edge_inside_rect`,
 *   `edge_inside_circle`);
 * - `blenlib/intern/bitmap_draw_2d.cc` (`BLI_bitmap_draw_2d_poly_v2i_n`).
 *
 * Coordinates are canvas CSS pixels with y down. Blender's are y up; every test here is symmetric
 * in y, so nothing needs flipping. Lasso points are integers, as `BLI_lasso_*` takes `int2`.
 */

/** Inclusive integer rectangle, Blender's `rcti`. */
export interface ScreenRect {
    xmin: number
    ymin: number
    xmax: number
    ymax: number
}

export type LassoPoint = readonly [number, number]

/** `BLI_lasso_boundbox`. */
export function lassoBoundBox(points: readonly LassoPoint[]): ScreenRect {
    const rect = {xmin: points[0][0], xmax: points[0][0], ymin: points[0][1], ymax: points[0][1]}
    for (let a = 1; a < points.length; a++) {
        const p = points[a]
        if (p[0] < rect.xmin) rect.xmin = p[0]
        else if (p[0] > rect.xmax) rect.xmax = p[0]
        if (p[1] < rect.ymin) rect.ymin = p[1]
        else if (p[1] > rect.ymax) rect.ymax = p[1]
    }
    return rect
}

/** `BLI_rctf_isect_pt_v`: inclusive on all four sides. */
export function rectContains(rect: ScreenRect, x: number, y: number): boolean {
    if (x < rect.xmin) return false
    if (x > rect.xmax) return false
    if (y < rect.ymin) return false
    if (y > rect.ymax) return false
    return true
}

/** `isect_point_poly_v2_int` (`math_geom.cc:1550`): the crossing-number test, integer form. */
export function isectPointPolyV2Int(px: number, py: number, verts: readonly LassoPoint[]): boolean {
    let isect = false
    const nr = verts.length
    for (let i = 0, j = nr - 1; i < nr; j = i++) {
        if ((verts[i][1] > py) !== (verts[j][1] > py)
            && px < (verts[j][0] - verts[i][0]) * (py - verts[i][1]) / (verts[j][1] - verts[i][1]) + verts[i][0]) {
            isect = !isect
        }
    }
    return isect
}

/**
 * `BLI_lasso_is_point_inside` (`lasso_2d.cc:42`). Blender passes the float screen position through
 * an `int` parameter, which truncates; the same truncation is applied here.
 */
export function lassoIsPointInside(points: readonly LassoPoint[], sx: number, sy: number): boolean {
    if (!points.length || !Number.isFinite(sx)) return false
    return isectPointPolyV2Int(Math.trunc(sx), Math.trunc(sy), points)
}

export const ISECT_LINE_LINE_COLINEAR = -1
export const ISECT_LINE_LINE_NONE = 0
export const ISECT_LINE_LINE_EXACT = 1
export const ISECT_LINE_LINE_CROSS = 2

/** `isect_seg_seg_v2_int` (`math_geom.cc:1139`). */
export function isectSegSegV2Int(v1: LassoPoint, v2: LassoPoint, v3: LassoPoint, v4: LassoPoint): number {
    const div = (v2[0] - v1[0]) * (v4[1] - v3[1]) - (v2[1] - v1[1]) * (v4[0] - v3[0])
    if (div === 0) return ISECT_LINE_LINE_COLINEAR

    const lambda = ((v1[1] - v3[1]) * (v4[0] - v3[0]) - (v1[0] - v3[0]) * (v4[1] - v3[1])) / div
    const mu = ((v1[1] - v3[1]) * (v2[0] - v1[0]) - (v1[0] - v3[0]) * (v2[1] - v1[1])) / div

    if (lambda >= 0 && lambda <= 1 && mu >= 0 && mu <= 1) {
        if (lambda === 0 || lambda === 1 || mu === 0 || mu === 1) return ISECT_LINE_LINE_EXACT
        return ISECT_LINE_LINE_CROSS
    }
    return ISECT_LINE_LINE_NONE
}

/**
 * `BLI_lasso_is_edge_inside` (`lasso_2d.cc:55`): an endpoint inside the lasso, or the segment
 * crossing one of the lasso's sides (including the closing side).
 */
export function lassoIsEdgeInside(points: readonly LassoPoint[], x0: number, y0: number, x1: number, y1: number): boolean {
    if (!points.length || !Number.isFinite(x0) || !Number.isFinite(x1)) return false
    const v1: LassoPoint = [Math.trunc(x0), Math.trunc(y0)]
    const v2: LassoPoint = [Math.trunc(x1), Math.trunc(y1)]

    // Check points in lasso.
    if (lassoIsPointInside(points, v1[0], v1[1])) return true
    if (lassoIsPointInside(points, v2[0], v2[1])) return true

    // No points in lasso, so we have to intersect with lasso edge.
    if (isectSegSegV2Int(points[0], points[points.length - 1], v1, v2) > 0) return true
    for (let i = 0; i < points.length - 1; i++) {
        if (isectSegSegV2Int(points[i], points[i + 1], v1, v2) > 0) return true
    }
    return false
}

/** `edge_fully_inside_rect` (`view3d_select.cc:488`). */
export function edgeFullyInsideRect(rect: ScreenRect, ax: number, ay: number, bx: number, by: number): boolean {
    return rectContains(rect, ax, ay) && rectContains(rect, bx, by)
}

/** `edge_inside_rect` (`view3d_select.cc:493`): fully inside, or crossing the rectangle. */
export function edgeInsideRect(rect: ScreenRect, ax: number, ay: number, bx: number, by: number): boolean {
    // Check points in rect.
    if (edgeFullyInsideRect(rect, ax, ay, bx, by)) return true

    // Check points completely out rect.
    if (ax < rect.xmin && bx < rect.xmin) return false
    if (ax > rect.xmax && bx > rect.xmax) return false
    if (ay < rect.ymin && by < rect.ymin) return false
    if (ay > rect.ymax && by > rect.ymax) return false

    // Simple check lines intersecting. Blender truncates these to `int`.
    const d1 = Math.trunc((ay - by) * (ax - rect.xmin) + (bx - ax) * (ay - rect.ymin))
    const d2 = Math.trunc((ay - by) * (ax - rect.xmin) + (bx - ax) * (ay - rect.ymax))
    const d3 = Math.trunc((ay - by) * (ax - rect.xmax) + (bx - ax) * (ay - rect.ymax))
    const d4 = Math.trunc((ay - by) * (ax - rect.xmax) + (bx - ax) * (ay - rect.ymin))

    if (d1 < 0 && d2 < 0 && d3 < 0 && d4 < 0) return false
    if (d1 > 0 && d2 > 0 && d3 > 0 && d4 > 0) return false
    return true
}

/** `dist_squared_to_line_segment_v2` (`math_geom.cc:307`), via `closest_to_line_segment_v2`. */
export function distSquaredToLineSegmentV2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax
    const dy = by - ay
    const lenSq = dx * dx + dy * dy
    let cx: number
    let cy: number
    if (lenSq === 0) {
        cx = ax
        cy = ay
    } else {
        let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
        t = t < 0 ? 0 : t > 1 ? 1 : t
        cx = ax + t * dx
        cy = ay + t * dy
    }
    return (px - cx) * (px - cx) + (py - cy) * (py - cy)
}

/** `edge_inside_circle` (`view3d_select.cc:3738`). */
export function edgeInsideCircle(cx: number, cy: number, radius: number, ax: number, ay: number, bx: number, by: number): boolean {
    return distSquaredToLineSegmentV2(cx, cy, ax, ay, bx, by) < radius * radius
}

/**
 * Rasterise a polygon into a row-major mask over `[xmin, xmax) x [ymin, ymax)`, row 0 at `ymin`.
 *
 * Port of `BLI_bitmap_draw_2d_poly_v2i_n` (`bitmap_draw_2d.cc:319`, "originally by Darel Rex
 * Finley, 2007, optimized by Campbell Barton, 2016 to track sorted intersections"), with the span
 * callback inlined as a fill. The selection buffer uses it to keep only the pixels of a lasso's
 * bounding rectangle that lie inside the lasso (`DRW_select_buffer_bitmap_from_poly`).
 */
export function rasterPolygonMask(verts: readonly LassoPoint[], xmin: number, ymin: number, xmax: number, ymax: number): Uint8Array {
    const width = xmax - xmin
    const height = ymax - ymin
    const mask = new Uint8Array(Math.max(0, width * height))
    if (width <= 0 || height <= 0 || verts.length < 3) return mask

    // Each span is [index of lower vertex, index of upper vertex] by y.
    const spanY: [number, number][] = []
    for (let iCurr = 0, iPrev = verts.length - 1; iCurr < verts.length; iPrev = iCurr++) {
        const coPrev = verts[iPrev]
        const coCurr = verts[iCurr]
        if (coPrev[1] !== coCurr[1]) {
            // Any segments entirely above or below the area of interest can be skipped.
            if (Math.min(coPrev[1], coCurr[1]) >= ymax || Math.max(coPrev[1], coCurr[1]) < ymin) continue
            spanY.push(coPrev[1] < coCurr[1] ? [iPrev, iCurr] : [iCurr, iPrev])
        }
    }

    // `draw_poly_v2i_n__span_y_sort`: by the lower vertex's y, then x.
    spanY.sort((a, b) => {
        const coA = verts[a[0]]
        const coB = verts[b[0]]
        if (coA[1] < coB[1]) return -1
        if (coA[1] > coB[1]) return 1
        if (coA[0] < coB[0]) return -1
        if (coA[0] > coB[0]) return 1
        return 0
    })

    const nodeX: {spanYIndex: number, x: number}[] = []
    let spanYIndex = 0
    if (spanY.length !== 0 && verts[spanY[0][0]][1] < ymin) {
        while (spanYIndex < spanY.length && verts[spanY[spanYIndex][0]][1] < ymin) {
            if (verts[spanY[spanYIndex][1]][1] >= ymin) nodeX.push({spanYIndex, x: 0})
            spanYIndex += 1
        }
    }

    // Loop through the rows of the image.
    for (let pixelY = ymin; pixelY < ymax; pixelY++) {
        let isSorted = true
        let doRemove = false

        for (let i = 0, xIxPrev = -Infinity; i < nodeX.length; i++) {
            const n = nodeX[i]
            const s = spanY[n.spanYIndex]
            const coPrev = verts[s[0]]
            const coCurr = verts[s[1]]
            const x = coPrev[0] - coCurr[0]
            const y = coPrev[1] - coCurr[1]
            const yPx = pixelY - coCurr[1]
            const xIx = Math.trunc(coCurr[0] + (yPx / y) * x)
            n.x = xIx
            if (isSorted && xIxPrev > xIx) isSorted = false
            if (!doRemove && coCurr[1] === pixelY) doRemove = true
            xIxPrev = xIx
        }

        // Sort the nodes, via a simple "bubble" sort.
        if (!isSorted) {
            let i = 0
            const nodeXEnd = nodeX.length - 1
            while (i < nodeXEnd) {
                if (nodeX[i].x > nodeX[i + 1].x) {
                    const tmp = nodeX[i]
                    nodeX[i] = nodeX[i + 1]
                    nodeX[i + 1] = tmp
                    if (i !== 0) i -= 1
                } else {
                    i += 1
                }
            }
        }

        // Fill the pixels between node pairs.
        for (let i = 0; i + 1 < nodeX.length; i += 2) {
            let xSrc = nodeX[i].x
            let xDst = nodeX[i + 1].x
            if (xSrc >= xmax) break
            if (xDst > xmin) {
                xSrc = Math.max(xSrc, xmin)
                xDst = Math.min(xDst, xmax)
                if (xSrc < xDst) {
                    const row = (pixelY - ymin) * width
                    for (let px = xSrc - xmin; px < xDst - xmin; px++) mask[row + px] = 1
                }
            }
        }

        // Clear finalized nodes in one pass, only when needed.
        if (doRemove) {
            let iDst = 0
            for (let iSrc = 0; iSrc < nodeX.length; iSrc++) {
                const s = spanY[nodeX[iSrc].spanYIndex]
                const co = verts[s[1]]
                if (co[1] !== pixelY) {
                    if (iDst !== iSrc) nodeX[iDst].spanYIndex = nodeX[iSrc].spanYIndex
                    iDst += 1
                }
            }
            nodeX.length = iDst
        }

        // Scan for new x-nodes.
        while (spanYIndex < spanY.length && verts[spanY[spanYIndex][0]][1] === pixelY) {
            nodeX.push({spanYIndex, x: 0})
            spanYIndex += 1
        }
    }

    return mask
}

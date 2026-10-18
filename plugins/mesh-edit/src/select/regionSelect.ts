/**
 * Box, lasso and circle select over the mesh elements.
 *
 * Port of `do_mesh_box_select` (`editors/space_view3d/view3d_select.cc:4064`), `do_lasso_select_mesh`
 * (`:826`) and `mesh_circle_select` (`:4796`), with their per-element callbacks
 * (`do_mesh_box_select__doSelect*` `:3961`, `do_lasso_select_mesh__doSelect*` `:718`,
 * `mesh_circle_doSelect*` `:4746`) and the buffer checks `edbm_backbuf_check_and_select_*` (`:249`).
 *
 * Two paths, as in Blender:
 * - **Without X-ray** (`use_zbuf`) the caller hands in bitmaps read from the selection buffer: one
 *   bit per element saying whether any of its pixels landed inside the region. Vertices and faces
 *   are selected straight from the bitmap, so occlusion is free. Edges still need their projected
 *   endpoints, because the rule is geometric: an edge is selected when it is *fully* inside the
 *   region (pass 0), and only if no edge was, when it merely crosses it (pass 1); the bitmap bit
 *   gates both passes so hidden edges stay out.
 * - **With X-ray** everything is projected and tested on the CPU with the same rules; faces are
 *   tested by their centre, as `mesh_foreachScreenFace` reports them.
 *
 * The circle is simpler: no two-pass edges, and `sub` is the only deselecting mode.
 *
 * No renderer in here; the plugin provides the projection and the bitmaps, so this runs in Node.
 */

import {
    BMesh,
    BMEdge,
    BMFace,
    BMVert,
    edgeSelectSet,
    ElemFlag,
    faceSelectSet,
    SelectMode,
    selectModeFlush,
    selectNone,
    vertSelectSet,
} from '@threepipe/mesh-kernel'
import type {ProjectFn} from '../picking'
import type {SelectElements} from './findNearest'
import {SelectOp, selectOpActionDeselected, selectOpUsePreDeselect} from './selectOp'
import {
    edgeFullyInsideRect,
    edgeInsideCircle,
    edgeInsideRect,
    LassoPoint,
    lassoBoundBox,
    lassoIsEdgeInside,
    lassoIsPointInside,
    rectContains,
    ScreenRect,
} from './lasso'

export type RegionShape =
    | {kind: 'rect', rect: ScreenRect}
    | {kind: 'lasso', points: readonly LassoPoint[]}
    | {kind: 'circle', x: number, y: number, radius: number}

/**
 * Which elements have at least one pixel inside the region, from the selection buffer. One byte per
 * element of the matching {@link SelectElements} list. Null means X-ray: test everything.
 */
export interface RegionVisibility {
    verts: Uint8Array
    edges: Uint8Array
    faces: Uint8Array
}

/** `BM_face_calc_center_median`: the mean of the corners, which is what the face callbacks receive. */
export function faceCenter(f: BMFace, out: {x: number, y: number, z: number}): void {
    let x = 0, y = 0, z = 0, n = 0
    for (const l of f.eachLoop()) {
        x += l.v.x
        y += l.v.y
        z += l.v.z
        n++
    }
    out.x = x / n
    out.y = y / n
    out.z = z / n
}

/**
 * Apply a region selection. Returns whether anything changed. The caller flushes nothing: the
 * mode flush (`EDBM_selectmode_flush`) is done here, as in Blender.
 *
 * `elements` are the visible elements in buffer order (the lists `SelectBuffer.update` produces);
 * `visibility` bitmaps index into them. Hidden elements are never in those lists.
 */
export function regionSelect(
    bm: BMesh,
    elements: SelectElements,
    shape: RegionShape,
    op: SelectOp,
    project: ProjectFn,
    visibility: RegionVisibility | null,
): boolean {
    if (shape.kind === 'circle') return circleSelect(bm, elements, shape, op, project, visibility)

    const mode = bm.selectMode
    const useZbuf = visibility !== null
    let changed = false
    let isDone = false

    const rect: ScreenRect = shape.kind === 'rect' ? shape.rect : lassoBoundBox(shape.points)
    const lasso = shape.kind === 'lasso' ? shape.points : null

    if (selectOpUsePreDeselect(op)) {
        if (bm.totvertsel) {
            selectNone(bm)
            changed = true
        }
    }

    const insidePoint = (x: number, y: number): boolean =>
        rectContains(rect, x, y) && (!lasso || lassoIsPointInside(lasso, x, y))

    if (mode & SelectMode.Vertex) {
        if (useZbuf) {
            changed = backbufCheckAndSelectVerts(bm, elements.verts, visibility.verts, op) || changed
        } else {
            for (const v of elements.verts) {
                const p = project(v.x, v.y, v.z)
                const isInside = !!p && insidePoint(p.x, p.y)
                const r = selectOpActionDeselected(op, (v.hflag & ElemFlag.Select) !== 0, isInside)
                if (r !== -1) {
                    vertSelectSet(bm, v, r === 1)
                    changed = true
                }
            }
        }
    }

    if (mode & SelectMode.Edge) {
        // Does both use_zbuf and non-use_zbuf versions (need screen coordinates for both).
        const bits = useZbuf ? visibility.edges : null
        const edges = elements.edges
        const pa: ({x: number, y: number} | null)[] = new Array(edges.length)
        const pb: ({x: number, y: number} | null)[] = new Array(edges.length)
        for (let i = 0; i < edges.length; i++) {
            const e = edges[i]
            pa[i] = project(e.v1.x, e.v1.y, e.v1.z)
            pb[i] = project(e.v2.x, e.v2.y, e.v2.z)
        }

        // Pass 0: fully inside.
        for (let i = 0; i < edges.length; i++) {
            const a = pa[i]
            const b = pb[i]
            if (!a || !b) continue
            const isVisible = bits ? bits[i] !== 0 : true
            const isInside = isVisible && edgeFullyInsideRect(rect, a.x, a.y, b.x, b.y)
                && (!lasso || lassoIsPointInside(lasso, a.x, a.y) && lassoIsPointInside(lasso, b.x, b.y))
            const e = edges[i]
            const r = selectOpActionDeselected(op, (e.hflag & ElemFlag.Select) !== 0, isInside)
            if (r !== -1) {
                edgeSelectSet(bm, e, r === 1)
                isDone = true
                changed = true
            }
        }
        if (!isDone) {
            // Fall back to partially inside.
            for (let i = 0; i < edges.length; i++) {
                const a = pa[i]
                const b = pb[i]
                if (!a || !b) continue
                const isVisible = bits ? bits[i] !== 0 : true
                const isInside = isVisible && (lasso
                    ? lassoIsEdgeInside(lasso, a.x, a.y, b.x, b.y)
                    : edgeInsideRect(rect, a.x, a.y, b.x, b.y))
                const e = edges[i]
                const r = selectOpActionDeselected(op, (e.hflag & ElemFlag.Select) !== 0, isInside)
                if (r !== -1) {
                    edgeSelectSet(bm, e, r === 1)
                    changed = true
                }
            }
        }
    }

    if (mode & SelectMode.Face) {
        if (useZbuf) {
            changed = backbufCheckAndSelectFaces(bm, elements.faces, visibility.faces, op) || changed
        } else {
            const c = {x: 0, y: 0, z: 0}
            for (const f of elements.faces) {
                faceCenter(f, c)
                const p = project(c.x, c.y, c.z)
                const isInside = !!p && insidePoint(p.x, p.y)
                const r = selectOpActionDeselected(op, (f.hflag & ElemFlag.Select) !== 0, isInside)
                if (r !== -1) {
                    faceSelectSet(bm, f, r === 1)
                    changed = true
                }
            }
        }
    }

    if (changed) selectModeFlush(bm)
    return changed
}

/** `mesh_circle_select` (`view3d_select.cc:4796`). */
function circleSelect(
    bm: BMesh,
    elements: SelectElements,
    shape: {x: number, y: number, radius: number},
    op: SelectOp,
    project: ProjectFn,
    visibility: RegionVisibility | null,
): boolean {
    const mode = bm.selectMode
    const useZbuf = visibility !== null
    let changed = false

    if (selectOpUsePreDeselect(op)) {
        if (bm.totvertsel) {
            selectNone(bm)
            changed = true
        }
    }

    const select = op !== 'sub'
    const bufOp: SelectOp = select ? 'add' : 'sub'
    const radiusSq = shape.radius * shape.radius
    const inCircle = (x: number, y: number) => (x - shape.x) * (x - shape.x) + (y - shape.y) * (y - shape.y) <= radiusSq

    if (mode & SelectMode.Vertex) {
        if (useZbuf) {
            changed = backbufCheckAndSelectVerts(bm, elements.verts, visibility.verts, bufOp) || changed
        } else {
            for (const v of elements.verts) {
                const p = project(v.x, v.y, v.z)
                if (p && inCircle(p.x, p.y)) {
                    vertSelectSet(bm, v, select)
                    changed = true
                }
            }
        }
    }

    if (mode & SelectMode.Edge) {
        if (useZbuf) {
            changed = backbufCheckAndSelectEdges(bm, elements.edges, visibility.edges, bufOp) || changed
        } else {
            for (const e of elements.edges) {
                const a = project(e.v1.x, e.v1.y, e.v1.z)
                const b = project(e.v2.x, e.v2.y, e.v2.z)
                if (a && b && edgeInsideCircle(shape.x, shape.y, shape.radius, a.x, a.y, b.x, b.y)) {
                    edgeSelectSet(bm, e, select)
                    changed = true
                }
            }
        }
    }

    if (mode & SelectMode.Face) {
        if (useZbuf) {
            changed = backbufCheckAndSelectFaces(bm, elements.faces, visibility.faces, bufOp) || changed
        } else {
            const c = {x: 0, y: 0, z: 0}
            for (const f of elements.faces) {
                faceCenter(f, c)
                const p = project(c.x, c.y, c.z)
                if (p && inCircle(p.x, p.y)) {
                    faceSelectSet(bm, f, select)
                    changed = true
                }
            }
        }
    }

    if (changed) selectModeFlush(bm)
    return changed
}

/** `edbm_backbuf_check_and_select_verts` (`view3d_select.cc:249`). */
export function backbufCheckAndSelectVerts(bm: BMesh, verts: readonly BMVert[], bits: Uint8Array, op: SelectOp): boolean {
    let changed = false
    for (let i = 0; i < verts.length; i++) {
        const v = verts[i]
        if (v.hflag & ElemFlag.Hidden) continue
        const r = selectOpActionDeselected(op, (v.hflag & ElemFlag.Select) !== 0, bits[i] !== 0)
        if (r !== -1) {
            vertSelectSet(bm, v, r === 1)
            changed = true
        }
    }
    return changed
}

/** `edbm_backbuf_check_and_select_edges` (`view3d_select.cc:286`). */
export function backbufCheckAndSelectEdges(bm: BMesh, edges: readonly BMEdge[], bits: Uint8Array, op: SelectOp): boolean {
    let changed = false
    for (let i = 0; i < edges.length; i++) {
        const e = edges[i]
        if (e.hflag & ElemFlag.Hidden) continue
        const r = selectOpActionDeselected(op, (e.hflag & ElemFlag.Select) !== 0, bits[i] !== 0)
        if (r !== -1) {
            edgeSelectSet(bm, e, r === 1)
            changed = true
        }
    }
    return changed
}

/** `edbm_backbuf_check_and_select_faces` (`view3d_select.cc:323`). */
export function backbufCheckAndSelectFaces(bm: BMesh, faces: readonly BMFace[], bits: Uint8Array, op: SelectOp): boolean {
    let changed = false
    for (let i = 0; i < faces.length; i++) {
        const f = faces[i]
        if (f.hflag & ElemFlag.Hidden) continue
        const r = selectOpActionDeselected(op, (f.hflag & ElemFlag.Select) !== 0, bits[i] !== 0)
        if (r !== -1) {
            faceSelectSet(bm, f, r === 1)
            changed = true
        }
    }
    return changed
}

/**
 * Reversing a face's winding in place.
 *
 * Ported from `source/blender/bmesh/intern/bmesh_core.cc` (`bmesh_kernel_loop_reverse`) and
 * `bmesh_mods.cc` (`BM_face_normal_flip_ex` / `BM_face_normal_flip`).
 *
 * Distinct from the `flipFace` in `generate/mirror.ts`, which is `bke::mesh_flip_faces` - a *Mesh*
 * level operation that rebuilds the face from a corner list. This one is the BMesh kernel operation:
 * the face, its loops, their per-corner data and every id survive, because all that moves is the
 * links. Callers that hold the face (extrude hands its input back to the caller) need that.
 *
 * The rewiring is Blender's "inline loop reversal" fast path rather than the commented-out
 * remove/append pair above it, because the two are not interchangeable: removing every loop from its
 * radial cycle and appending it to the previous edge's would visit cycles this walk has already
 * rewritten. Blender's version carries one step of the previous cycle's state instead, which is why
 * `e_prev`, `l_prev_radial_next`, `l_prev_radial_prev` and `is_prev_boundary` exist.
 */

import {BMEdge, BMFace, BMLoop} from './types'

/**
 * Reverse `f`'s loop cycle, so `(v0, v1, ... vn-1)` becomes `(v0, vn-1, ... v1)`.
 *
 * Port of `bmesh_kernel_loop_reverse` (`bmesh_core.cc:1105`). Each loop keeps the vertex it points
 * at - and so its corner attributes stay on the corner they belong to - and takes over the edge of
 * the loop that used to precede it, which is exactly the edge joining it to its new successor.
 *
 * The `cd_loop_mdisp_offset` / `use_loop_mdisp_flip` arguments are not ported: they flip a multires
 * displacement grid, and the kernel has no multires layer.
 */
export function loopReverse(f: BMFace): void {
    const lFirst = f.lFirst
    if (!lFirst) return

    // "track previous cycles radial state"
    let ePrev: BMEdge | null = lFirst.prev.e
    let lPrevRadialNext: BMLoop = lFirst.prev.radialNext!
    let lPrevRadialPrev: BMLoop = lFirst.prev.radialPrev!
    let isPrevBoundary = lPrevRadialNext === lPrevRadialNext.radialNext

    let lIter: BMLoop = lFirst
    do {
        const eIter = lIter.e
        const lIterRadialNext = lIter.radialNext!
        const lIterRadialPrev = lIter.radialPrev!
        const isIterBoundary = lIterRadialNext === lIterRadialNext.radialNext

        if (isPrevBoundary) {
            lIter.radialNext = lIter
            lIter.radialPrev = lIter
        } else {
            lIter.radialNext = lPrevRadialNext
            lIter.radialPrev = lPrevRadialPrev
            lPrevRadialNext.radialPrev = lIter
            lPrevRadialPrev.radialNext = lIter
        }

        // The edge is losing this loop, so it must not be the one the edge names. `lIter.next` is
        // still the original successor here; the swap below is what makes it the predecessor.
        if (eIter && eIter.l === lIter) eIter.l = lIter.next

        lIter.e = ePrev

        const lNextOld = lIter.next
        lIter.next = lIter.prev
        lIter.prev = lNextOld

        ePrev = eIter
        lPrevRadialNext = lIterRadialNext
        lPrevRadialPrev = lIterRadialPrev
        isPrevBoundary = isIterBoundary

        // "step to next (now swapped)" - after the swap `prev` is the original `next`, so this walks
        // the cycle in its original direction.
        lIter = lIter.prev
    } while (lIter !== lFirst)
}

/**
 * Reverse `f`'s winding and negate its cached normal.
 *
 * Port of `BM_face_normal_flip_ex` (`bmesh_mods.cc:1092`), which is {@link loopReverse} followed by
 * `negate_v3(f->no)`. The normal is only a cache, but a caller that flipped a face and then read
 * `f.nx/ny/nz` without a normals update would otherwise see the old direction.
 */
export function faceNormalFlip(f: BMFace): void {
    loopReverse(f)
    f.nx = -f.nx
    f.ny = -f.ny
    f.nz = -f.nz
}

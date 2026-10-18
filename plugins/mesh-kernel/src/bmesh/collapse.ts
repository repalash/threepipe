/**
 * Collapsing an edge: the Euler operator that merges an edge's two vertices into one.
 *
 * Ported from `source/blender/bmesh/intern/bmesh_core.cc` (`bmesh_kernel_join_vert_kill_edge`, JVKE)
 * and `bmesh_mods.cc` (`BM_edge_collapse`, a one-line wrapper around it).
 *
 * **This belongs in `bmesh/euler.ts`**, next to SEMV, SFME, JFKE and JEKV - it is the same family of
 * operator from the same Blender file, and JVKE is the one the M1 subplan lists as still to do. It
 * is here because `euler.ts` was owned by another agent when these helpers were promoted out of
 * `generate/primitives.ts`. Move it when that is no longer true.
 *
 * JVKE is the operator behind a cone's apex: `bmo_create_cone_exec` builds a full-height cylinder and
 * then collapses the top rim down to a point, one edge at a time, which turns each side quad into a
 * triangle and each of the cap's own edges into nothing.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from './types'
import {BMesh} from './BMesh'
import {diskEdgeExists} from './structure'
import {edgeSplice, edgeVertSwap} from './splice'

/**
 * Collapse `eKill`, merging `vKill` into the vertex at its other end, and return the survivor.
 *
 * Port of `bmesh_kernel_join_vert_kill_edge` (`bmesh_core.cc:1966`).
 *
 * Every loop along `eKill` is unlinked from its face, which shortens that face by one corner; the
 * loop that followed it takes over the vertex. Faces that fall below three corners are killed when
 * `killDegenerateFaces` is set - Blender collects them first and kills them at the end, because
 * killing one mid-walk would pull the radial cycle out from under the walk.
 *
 * `checkEdgeExists` is Blender's `check_edge_exists`: after the merge two edges can end up spanning
 * the same pair of vertices, and this splices them together instead of leaving a double. Blender's
 * own callers pass it, and so does {@link edgeCollapse}.
 *
 * The multires (`cd_loop_mdisp_offset`) and `BM_CHECK_ELEMENT` blocks are not ported: the kernel has
 * no multires layer, and `BMesh.validate()` is the equivalent of the checks.
 */
export function joinVertKillEdge(
    bm: BMesh,
    eKill: BMEdge,
    vKill: BMVert,
    doDel: boolean,
    checkEdgeExists: boolean,
    killDegenerateFaces: boolean,
): BMVert {
    const vTarget = eKill.otherVert(vKill)
    const facesDegenerate: BMFace[] = []

    if (eKill.l) {
        let lKill: BMLoop | null = eKill.l
        const lFirst = eKill.l
        do {
            // Relink the face cycle around the loop being dropped, and fix its successor's vertex.
            if (lKill!.next.v === vKill) lKill!.next.v = vTarget

            lKill!.next.prev = lKill!.prev
            lKill!.prev.next = lKill!.next
            if (lKill!.f.lFirst === lKill) lKill!.f.lFirst = lKill!.next

            lKill!.f.len--
            if (killDegenerateFaces && lKill!.f.len < 3) facesDegenerate.push(lKill!.f)

            const lNext: BMLoop = lKill!.radialNext!
            bm.loops.delete(lKill!)
            lKill!.radialNext = null
            lKill!.radialPrev = null
            lKill = lNext === lFirst ? null : lNext
        } while (lKill)

        eKill.l = null
    }

    bm.edgeKill(eKill)

    if (vTarget.e && vKill.e) {
        // Inlined `BM_vert_splice(bm, v_target, v_kill)`, as Blender does here: the splice has to
        // interleave with the double check, so it cannot be the shared `vertSplice`.
        let e: BMEdge | null
        while ((e = vKill.e)) {
            const eTarget = checkEdgeExists ? diskEdgeExists(vTarget, e.otherVert(vKill)) : null
            edgeVertSwap(e, vTarget, vKill)
            if (eTarget) edgeSplice(bm, eTarget, e)
        }
    }

    if (killDegenerateFaces) {
        for (const f of facesDegenerate) if (bm.faces.has(f)) bm.faceKill(f)
    }

    if (doDel && bm.verts.has(vKill)) bm.vertKill(vKill)

    return vTarget
}

/**
 * Collapse `eKill` onto the end away from `vKill`.
 *
 * Port of `BM_edge_collapse` (`bmesh_mods.cc:472`), which is {@link joinVertKillEdge} with
 * `check_edge_exists` always on. The higher-level name, and the one operators reach for.
 */
export function edgeCollapse(
    bm: BMesh, eKill: BMEdge, vKill: BMVert, doDel: boolean, killDegenerateFaces: boolean,
): BMVert {
    return joinVertKillEdge(bm, eKill, vKill, doDel, true, killDegenerateFaces)
}

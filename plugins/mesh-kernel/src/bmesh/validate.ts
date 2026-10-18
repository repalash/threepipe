/**
 * Port of Blender's `BM_mesh_is_valid` - `source/blender/bmesh/intern/bmesh_mesh_validate.cc` (Blender 5.3,
 * the function at line 63). Blender compiles it into debug builds only and prints each problem to stderr
 * through its `ERRMSG` macro; here each problem is returned as a string, worded as Blender words it, and the
 * mesh is valid when the list is empty (`is_valid = (errtot == 0)`, line 247).
 *
 * This complements {@link BMesh.validate}, which checks the cycle invariants the kernel itself relies on
 * (disk cycles, radial back-links, termination). `BM_mesh_is_valid` adds the checks a correct-but-wrong mesh
 * fails: elements both hidden and selected, two edges over one vertex pair, a face repeating a loop, vertex
 * or edge, and two faces over the same vertex cycle in either winding.
 *
 * Differences from the C++, all of them forced by the language rather than chosen:
 * - The duplicate checks use local `Set`s rather than toggling `BM_ELEM_INTERNAL_TAG` on the elements
 *   (lines 156-163, 207-209, 239-244), so the mesh's flags are never touched, even transiently.
 * - Blender dereferences `l->radial_next`, `l->prev` and friends unconditionally; the kernel types them as
 *   possibly null while a mesh is half-built, so a null link is reported where Blender would crash.
 * - `BM_mesh_elem_index_ensure(bm, BM_ALL)` (line 82) is {@link BMesh.elemIndexEnsure}.
 */

import {ElemFlag} from '../constants'
import {BMesh} from './BMesh'
import type {BMLoop} from './types'

const SELECT_HIDDEN = ElemFlag.Select | ElemFlag.Hidden

/** `BM_elem_flag_test(e, BM_ELEM_SELECT | BM_ELEM_HIDDEN) == (BM_ELEM_SELECT | BM_ELEM_HIDDEN)`. */
function hiddenAndSelected(e: {hflag: number}): boolean {
    return (e.hflag & SELECT_HIDDEN) === SELECT_HIDDEN
}

/**
 * Check a {@link BMesh} the way `BM_mesh_is_valid` does. Returns the problems found; empty means valid.
 *
 * Reassigns every element's `index` first, as Blender's does ("force recalc, even if tagged as valid,
 * since this mesh is suspect!", line 80), so the indices in the messages are iteration order.
 */
export function bmMeshIsValid(bm: BMesh): string[] {
    const errors: string[] = []
    const err = (msg: string) => errors.push(msg)

    // line 81-82
    bm.elemIndexEnsure()

    // lines 84-95: verts
    let i = 0
    for (const v of bm.verts) {
        if (hiddenAndSelected(v)) err(`vert ${i}: is hidden and selected`)
        if (v.e) {
            if (!v.e.uses(v)) err(`vert ${i}: is not in its referenced edge: ${v.e.index}`)
        }
        i++
    }

    // lines 97-110: edges, building the edge hash at the same time. `OrderedEdge` is the unordered pair.
    const edgeHash = new Map<string, number>()
    i = 0
    for (const e of bm.edges) {
        if (e.v1 === e.v2) err(`edge ${i}: duplicate index: ${e.v1.index}`)
        const a = e.v1.index
        const b = e.v2.index
        const key = a < b ? `${a},${b}` : `${b},${a}`
        const existing = edgeHash.get(key)
        if (existing === undefined) edgeHash.set(key, i)
        else err(`edge ${i}, ${existing}: are duplicates`)
        i++
    }

    // lines 112-143: edge radial structure
    i = 0
    for (const e of bm.edges) {
        if (hiddenAndSelected(e)) err(`edge ${i}: is hidden and selected`)
        if (e.l) {
            const lFirst = e.l
            let lIter: BMLoop | null = lFirst
            let guard = 0
            do {
                if (lIter.e !== e) {
                    err(`edge ${i}: has invalid loop, loop is of face ${lIter.f.index}`)
                } else if (!e.uses(lIter.v)) {
                    err(`edge ${i}: has invalid loop with vert not in edge, loop is of face ${lIter.f.index}`)
                } else if (!e.uses(lIter.next.v)) {
                    err(`edge ${i}: has invalid loop with next vert not in edge, loop is of face ${lIter.f.index}`)
                }
                lIter = lIter.radialNext
                if (!lIter) {
                    err(`edge ${i}: has a loop with no 'radial_next'`)
                    break
                }
                if (++guard > bm.totloop + 1) {
                    err(`edge ${i}: radial cycle does not return to its first loop`)
                    break
                }
            } while (lIter !== lFirst)
        }
        i++
    }

    // lines 145-245: face structure
    const faceMap = new Map<string, number>()
    i = 0
    for (const f of bm.faces) {
        if (hiddenAndSelected(f)) err(`face ${i}: is hidden and selected`)
        const lFirst = f.lFirst
        if (!lFirst) {
            err(`face ${i}: has no loops`)
            i++
            continue
        }

        // lines 156-168: the length check
        let fLen = 0
        let lIter: BMLoop = lFirst
        do {
            fLen++
            lIter = lIter.next
            if (fLen > bm.totloop + 1) break
        } while (lIter !== lFirst)
        if (fLen !== f.len) err(`face ${i}: has length of ${f.len} but should be ${fLen}`)

        // lines 170-215
        const seenLoops = new Set<BMLoop>()
        const seenVerts = new Set<unknown>()
        const seenEdges = new Set<unknown>()
        let lVertMin = lFirst
        let j = 0
        lIter = lFirst
        do {
            if (seenLoops.has(lIter)) err(`face ${i}: has duplicate loop at corner: ${j}`)
            if (seenVerts.has(lIter.v)) err(`face ${i}: has duplicate vert: ${lIter.v.index}, at corner: ${j}`)
            if (lIter.e && seenEdges.has(lIter.e)) {
                err(`face ${i}: has duplicate edge: ${lIter.e.index}, at corner: ${j}`)
            }

            // adjacent data checks
            if (lIter.f !== f) err(`face ${i}: has loop that points to face: ${lIter.f.index} at corner: ${j}`)
            if (lIter !== lIter.prev?.next) err(`face ${i}: has invalid 'prev/next' at corner: ${j}`)
            if (lIter !== lIter.next?.prev) err(`face ${i}: has invalid 'next/prev' at corner: ${j}`)
            if (lIter !== lIter.radialPrev?.radialNext) {
                err(`face ${i}: has invalid 'radial_prev/radial_next' at corner: ${j}`)
            }
            if (lIter !== lIter.radialNext?.radialPrev) {
                err(`face ${i}: has invalid 'radial_next/radial_prev' at corner: ${j}`)
            }

            seenLoops.add(lIter)
            seenVerts.add(lIter.v)
            if (lIter.e) seenEdges.add(lIter.e)

            if (lIter.v.index < lVertMin.v.index) lVertMin = lIter
            j++
            lIter = lIter.next
            if (j > fLen) break
        } while (lIter !== lFirst)

        // lines 217-232: vertex indices walked from the lowest, in the direction of the lower neighbour, so
        // a face and its flipped copy produce the same key.
        const faceVerts: number[] = []
        lIter = lVertMin
        if (lVertMin.next.v.index < lVertMin.prev.v.index) {
            do {
                faceVerts.push(lIter.v.index)
                lIter = lIter.next
            } while (lIter !== lVertMin && faceVerts.length <= fLen)
        } else {
            do {
                faceVerts.push(lIter.v.index)
                lIter = lIter.prev
            } while (lIter !== lVertMin && faceVerts.length <= fLen)
        }

        // lines 234-237
        const key = faceVerts.join(',')
        const existing = faceMap.get(key)
        if (existing === undefined) faceMap.set(key, i)
        else err(`face ${i}: duplicate of ${existing}`)
        i++
    }

    return errors
}

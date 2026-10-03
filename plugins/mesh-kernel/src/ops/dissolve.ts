/**
 * Dissolving faces: merging each contiguous region of the given faces into a single n-gon.
 *
 * Ported from `source/blender/bmesh/operators/bmo_dissolve.cc` (`bmo_dissolve_faces_exec`,
 * `bm_vert_collapse_edge_and_merge`), `bmesh/intern/bmesh_core.cc` (`BM_faces_join`,
 * `bm_vert_is_manifold_flagged`, `bmesh_kernel_join_edge_kill_vert`), `bmesh/intern/bmesh_mods.cc`
 * (`BM_faces_join_pair`, `BM_vert_collapse_faces`, `BM_vert_collapse_edge`),
 * `bmesh/intern/bmesh_delete.cc` (`BMO_mesh_delete_oflag_context`, `DEL_FACES`) and
 * `editors/mesh/editmesh_tools.cc` (`edbm_dissolve_faces_exec`). Edge and vertex dissolve are in
 * `dissolveEdges.ts`, Limited Dissolve in `dissolveLimit.ts`.
 *
 * This is also how a fan of triangles becomes one cap: `bmo_create_circle_exec` and
 * `bmo_create_cone_exec` both build their end caps as a triangle fan and then dissolve it.
 *
 * The join is not a merge of vertex lists. It takes the region's boundary - every edge with exactly
 * one adjacent face inside the region - and builds one face from that edge set with
 * {@link faceCreateNgon}, which is what recovers a winding from an unordered set. Interior edges and
 * the vertices that only interior edges touch then go away.
 *
 * Blender's operator flags (`FACE_MARK`, `FACE_TAG`, `FACE_ORIG`, `FACE_NEW`, `VERT_MARK`) and API
 * flags (`_FLAG_JF`) become sets beside the mesh, as the rest of the kernel does.
 *
 * Not ported, and why: the multires (`CD_MDISPS`) branches - the kernel has no multires layer, and
 * without one Blender skips them (`cd_loop_mdisp_offset == -1`).
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdgeExists, diskEdgeRemove, diskEdges, diskVertReplace, edgeFaceCount, edgeIsBoundary, radialLoops} from '../bmesh/structure'
import {copyElemAttrs, copyElemHeader, interpElemAttrs} from '../bmesh/customdata'
import {faceCreateNgon} from '../bmesh/ngon'
import {edgeSplice, faceFindDouble} from '../bmesh/splice'
import {loopReverse} from '../bmesh/flip'
import {dataInterpFromVerts} from '../bmesh/interp'
import {faceSplit} from '../bmesh/mods'
import {edgeSelectSetNoflush, selectCountsRecalc} from '../bmesh/marking'
import {elemsHflagEnable} from '../bmesh/hflag'
import {walkIsland} from '../bmesh/walkers'
import {ElemFlag, ElemType} from '../constants'
import {bmeshEditEnd, BmeshEditEndFlags} from './edgenet'
import {bmoDeleteFacesContext} from './gridFill'

// region helpers
//
// Generic `bmesh_query.cc` / `bmesh_mods.cc` / `bmesh_core.cc` functions the kernel did not have
// yet (or had only in a reduced form). Exported so the other dissolve files share one copy; listed
// in the comm folder for the parent to consolidate into `bmesh/`.

/** `BM_vert_is_edge_pair` (`bmesh_query.cc:580`): exactly two edges meet at `v`. */
export function vertIsEdgePair(v: BMVert): boolean {
    const e = v.e
    if (e) {
        const eOther = e.diskNext(v)!
        return eOther !== e && eOther.diskNext(v) === e
    }
    return false
}

/** `BM_vert_edge_pair` (`bmesh_query.cc:602`): the two edges of a two-edge vertex, else null. */
export function vertEdgePair(v: BMVert): [BMEdge, BMEdge] | null {
    const eA = v.e
    if (eA) {
        const eB = eA.diskNext(v)!
        if (eB !== eA && eB.diskNext(v) === eA) return [eA, eB]
    }
    return null
}

/** `BM_edge_loop_pair` (`bmesh_query.cc:565`): the two loops of an edge with exactly two faces. */
export function edgeLoopPair(e: BMEdge): [BMLoop, BMLoop] | null {
    const la = e.l
    let lb: BMLoop | null
    if (la && (lb = la.radialNext) && la !== lb && lb.radialNext === la) return [la, lb]
    return null
}

/** `BM_edge_face_pair` (`bmesh_query.cc:550`): the two faces of an edge with exactly two faces. */
export function edgeFacePair(e: BMEdge): [BMFace, BMFace] | null {
    const pair = edgeLoopPair(e)
    return pair ? [pair[0].f, pair[1].f] : null
}

/** `bmesh_radial_facevert_count` (`bmesh_structure.cc:494`). */
function radialFacevertCount(l: BMLoop, v: BMVert): number {
    let count = 0
    let lIter = l
    do {
        if (lIter.v === v) count++
    } while ((lIter = lIter.radialNext!) !== l)
    return count
}

/** `bmesh_disk_facevert_count` (`bmesh_structure.cc:252`). */
function diskFacevertCount(v: BMVert): number {
    let count = 0
    if (v.e) {
        const eFirst = v.e
        let eIter = eFirst
        do {
            if (eIter.l) count += radialFacevertCount(eIter.l, v)
        } while ((eIter = eIter.diskNext(v)!) !== eFirst)
    }
    return count
}

/** `bmesh_disk_faceloop_find_first` (`bmesh_structure.cc:302`). */
function diskFaceloopFindFirst(e: BMEdge, v: BMVert): BMLoop | null {
    let eIter = e
    do {
        if (eIter.l) return eIter.l.v === v ? eIter.l : eIter.l.next
    } while ((eIter = eIter.diskNext(v)!) !== e)
    return null
}

/** `bmesh_radial_facevert_check` (`bmesh_structure.cc`): some loop of `l`'s radial cycle is at `v`. */
function radialFacevertCheck(l: BMLoop, v: BMVert): boolean {
    let lIter = l
    do {
        if (lIter.v === v) return true
    } while ((lIter = lIter.radialNext!) !== l)
    return false
}

/** `bmesh_disk_faceedge_find_next` (`bmesh_structure.cc:332`). */
function diskFaceedgeFindNext(e: BMEdge, v: BMVert): BMEdge {
    let eFind = e.diskNext(v)!
    do {
        if (eFind.l && radialFacevertCheck(eFind.l, v)) return eFind
    } while ((eFind = eFind.diskNext(v)!) !== e)
    return e
}

/** `bmesh_radial_faceloop_find_first` (`bmesh_structure.cc:444`). */
function radialFaceloopFindFirst(l: BMLoop, v: BMVert): BMLoop | null {
    let lIter = l
    do {
        if (lIter.v === v) return lIter
    } while ((lIter = lIter.radialNext!) !== l)
    return null
}

/** `bmesh_radial_faceloop_find_next` (`bmesh_structure.cc:456`). */
function radialFaceloopFindNext(l: BMLoop, v: BMVert): BMLoop {
    let lIter = l.radialNext!
    do {
        if (lIter.v === v) return lIter
    } while ((lIter = lIter.radialNext!) !== l)
    return l
}

/**
 * Blender's `BM_ITER_ELEM (l, &iter, v, BM_LOOPS_OF_VERT)` with its exact visiting order
 * (`bmiter__loop_of_vert_begin` / `_step`, `bmesh_iterators.cc:459`/`:473`): starting from the first
 * face-loop of `v.e`'s disk, every loop at `v` of each edge's radial cycle, edge by edge. As in
 * Blender the next loop is found *before* the current one is handed out, and the walk is bounded by
 * the face-corner count taken at the start.
 */
export function* loopsOfVert(v: BMVert): Generator<BMLoop> {
    let count = diskFacevertCount(v)
    if (!count) return
    let lFirst = diskFaceloopFindFirst(v.e!, v)!
    let eNext = lFirst.e!
    let lNext: BMLoop | null = lFirst
    while (lNext) {
        const lCurr: BMLoop = lNext
        if (count) {
            count--
            lNext = radialFaceloopFindNext(lNext, v)
            if (lNext === lFirst) {
                eNext = diskFaceedgeFindNext(eNext, v)
                lFirst = radialFaceloopFindFirst(eNext.l!, v)!
                lNext = lFirst
            }
        }
        if (!count) lNext = null
        yield lCurr
    }
}

/** Blender's `BM_ITER_ELEM (f, &iter, v, BM_FACES_OF_VERT)`: the face of each loop of {@link loopsOfVert}. */
function facesOfVert(v: BMVert): BMFace[] {
    const out: BMFace[] = []
    for (const l of loopsOfVert(v)) out.push(l.f)
    return out
}

/**
 * `BM_elem_flag_merge_ex` (`bmesh_inline.hh:75`): unless both have `hflagAnd`, clear it on both; then
 * both take the union of their flags. Raw header bits, as Blender's macro (the selection counters
 * are recounted by the select-mode flush that follows every operator).
 */
export function elemFlagMergeEx(a: {hflag: number}, b: {hflag: number}, hflagAnd: number): void {
    if (((a.hflag & b.hflag) & hflagAnd) === 0) {
        a.hflag &= ~hflagAnd
        b.hflag &= ~hflagAnd
    }
    a.hflag = b.hflag = a.hflag | b.hflag
}

/**
 * `bmesh_kernel_join_edge_kill_vert` (`bmesh_core.cc:1799`), JEKV with every option.
 *
 * The kernel's {@link import('../bmesh/euler').joinEdgeKillVert} is this with `check_edge_exists`,
 * `kill_degenerate_faces` and `kill_duplicate_faces` off and a triangle refused instead of killed;
 * the dissolve operators need all three (`BM_vert_collapse_edge(.., true, true)`). Returns `e_old`,
 * the surviving edge, or null where Blender returns null.
 */
export function joinEdgeKillVertEx(
    bm: BMesh, eKill: BMEdge, vKill: BMVert, doDel: boolean,
    checkEdgeExists: boolean, killDegenerateFaces: boolean, killDuplicateFaces: boolean,
): BMEdge | null {
    if (!eKill.uses(vKill)) return null

    // `bmesh_disk_count_at_most(v_kill, 3) == 2`
    let valence = 0
    for (const _ of diskEdges(vKill)) if (++valence === 3) break
    if (valence !== 2) return null

    const eOld = eKill.diskNext(vKill)!
    const vTarget = eKill.otherVert(vKill)
    const vOld = eOld.otherVert(vKill)

    // check for double edges: `BM_verts_in_edge(v_kill, v_target, e_old)`
    if (eOld.joins(vKill, vTarget)) return null

    const facesDegenerate: BMFace[] = []
    const facesDuplicateCandidate: BMFace[] = []

    const eSplice = checkEdgeExists ? diskEdgeExists(vTarget, vOld) : null

    diskVertReplace(eOld, vTarget, vKill)
    // remove e_kill from 'v_target's disk cycle
    diskEdgeRemove(eKill, vTarget)

    if (eKill.l) {
        // fix the neighboring loops of all loops in e_kill's radial cycle
        const lFirst = eKill.l
        let lKill = lFirst
        do {
            // relink loops and fix vertex pointer
            if (lKill.next.v === vKill) lKill.next.v = vTarget
            lKill.next.prev = lKill.prev
            lKill.prev.next = lKill.next
            if (lKill.f.lFirst === lKill) lKill.f.lFirst = lKill.next

            // fix len attribute of face
            lKill.f.len--
            if (killDegenerateFaces && lKill.f.len < 3) {
                facesDegenerate.push(lKill.f)
            } else if (killDuplicateFaces) {
                // The duplicate test isn't reliable at this point as `e_splice` might be set,
                // so the duplicate test needs to run once the edge has been spliced.
                facesDuplicateCandidate.push(lKill.f)
            }
            const lKillNext: BMLoop = lKill.radialNext!
            // `bm_kill_only_loop`
            bm.loops.delete(lKill)
            lKill = lKillNext
        } while (lKill !== lFirst)
        eKill.l = null
    }

    // `bm_kill_only_edge(bm, e_kill)`. Blender frees the edge without unlinking it from `v_kill`'s
    // disk; unlinking it first leaves `v_kill` loose, which is the state Blender's `else` branch sets
    // (`v_kill->e = nullptr`), and lets `edgeKill` do the history and table bookkeeping.
    diskEdgeRemove(eKill, vKill)
    bm.edgeKill(eKill)

    // deallocate vertex (`bm_kill_only_vert`), or leave it loose
    if (doDel) bm.vertKill(vKill)
    else vKill.e = null

    if (checkEdgeExists && eSplice) {
        // removes e_splice
        edgeSplice(bm, eOld, eSplice)
    }

    if (killDegenerateFaces) {
        // `BLI_SMALLSTACK_POP` order: last pushed first.
        while (facesDegenerate.length) bm.faceKill(facesDegenerate.pop()!)
    }
    if (killDuplicateFaces) {
        while (facesDuplicateCandidate.length) {
            const fKill = facesDuplicateCandidate.pop()!
            if (bm.faces.has(fKill) && faceFindDouble(fKill)) bm.faceKill(fKill)
        }
    }

    return eOld
}

/**
 * `BM_vert_collapse_faces` (`bmesh_mods.cc:343`): dissolve the two-edge vertex `vKill` into `eKill`'s
 * other end. The corner of every face along `eKill` that survives at the far vertex first takes the
 * blend of its own and the removed corner's data at `fac`, and `vKill`'s data is blended likewise.
 * With `joinFaces` the faces around `vKill` are merged and re-split instead.
 */
export function vertCollapseFaces(
    bm: BMesh, eKill: BMEdge, vKill: BMVert, fac: number, doDel: boolean, joinFaces: boolean,
    killDegenerateFaces: boolean, killDuplicateFaces: boolean,
): BMEdge | null {
    let eNew: BMEdge | null = null
    const tv = eKill.otherVert(vKill)

    // first modify the face loop data
    if (eKill.l) {
        const w = [1 - fac, fac]
        let lIter = eKill.l
        do {
            if (lIter.v === tv && lIter.next.v === vKill) {
                const tvloop = lIter
                const kvloop = lIter.next
                interpElemAttrs(kvloop, [kvloop, tvloop], w, bm.ldata)
            }
        } while ((lIter = lIter.radialNext!) !== eKill.l)
    }

    // now interpolate the vertex data
    dataInterpFromVerts(bm, vKill, tv, vKill, fac)

    const e2 = eKill.diskNext(vKill)!
    const tv2 = e2.otherVert(vKill)

    if (joinFaces) {
        const faces = facesOfVert(vKill)
        if (faces.length >= 2) {
            const fDouble = {double: null as BMFace | null}
            const f2 = facesJoin(bm, faces, true, fDouble)
            if (f2) {
                const lA = faceVertShareLoop(f2, tv)
                const lB = lA && faceVertShareLoop(f2, tv2)
                if (lA && lB) {
                    const split = faceSplit(bm, f2, lA, lB, undefined, false)
                    if (split) eNew = split.lNew.e
                }
            }
        }
    } else {
        // single face or no faces
        eNew = joinEdgeKillVertEx(bm, eKill, vKill, doDel, true, killDegenerateFaces, killDuplicateFaces)
    }
    return eNew
}

/** `BM_face_vert_share_loop` (`bmesh_query.cc`). */
function faceVertShareLoop(f: BMFace, v: BMVert): BMLoop | null {
    let lIter = f.lFirst
    do {
        if (lIter.v === v) return lIter
    } while ((lIter = lIter.next) !== f.lFirst)
    return null
}

/**
 * `BM_vert_collapse_edge` (`bmesh_mods.cc:432`): {@link vertCollapseFaces} at `fac = 1`, faces kept.
 * The surviving corners keep the far vertex's corner data.
 */
export function vertCollapseEdge(
    bm: BMesh, eKill: BMEdge, vKill: BMVert, doDel: boolean, killDegenerateFaces: boolean, killDuplicateFaces: boolean,
): BMEdge | null {
    return vertCollapseFaces(bm, eKill, vKill, 1, doDel, false, killDegenerateFaces, killDuplicateFaces)
}

/**
 * `bm_vert_collapse_edge_and_merge` (`bmo_dissolve.cc:143`): {@link vertCollapseEdge} with the two
 * edges' header flags merged first (hidden only if both were), and never a visible edge left on a
 * hidden vertex.
 */
export function vertCollapseEdgeAndMerge(bm: BMesh, v: BMVert, doDel: boolean): BMEdge | null {
    // Merge the header flags on the two edges that will be merged.
    const ePair = vertEdgePair(v)!
    elemFlagMergeEx(ePair[0], ePair[1], ElemFlag.Hidden)

    // Dissolve the vertex.
    const eNew = vertCollapseEdge(bm, v.e!, v, doDel, true, true)

    if (eNew) {
        // Ensure the result of dissolving never leaves visible edges connected to hidden vertices.
        if (!(eNew.hflag & ElemFlag.Hidden)) {
            if ((eNew.v1.hflag & ElemFlag.Hidden) || (eNew.v2.hflag & ElemFlag.Hidden)) {
                if (eNew.hflag & ElemFlag.Select) edgeSelectSetNoflush(bm, eNew, false)
                eNew.hflag |= ElemFlag.Hidden
            }
        }
    }
    return eNew
}

// endregion

/**
 * Is `v` manifold *within* `region` - every edge at it used by two or more faces (not a boundary),
 * and every one of those faces inside the region?
 *
 * Port of `bm_vert_is_manifold_flagged` (`bmesh_core.cc:1232`). A vertex like that is entirely
 * interior to the region and disappears when the region becomes one face; one that fails the test is
 * on the boundary, or is a pinch point, and has to stay.
 */
export function vertIsManifoldInRegion(v: BMVert, region: ReadonlySet<BMFace>): boolean {
    let e = v.e
    if (!e) return false
    do {
        let l = e.l
        if (!l) return false
        if (edgeIsBoundary(l.e!)) return false
        do {
            if (!region.has(l.f)) return false
        } while ((l = l.radialNext!) !== e.l)
    } while ((e = e.diskNext(v)!) !== v.e)
    return true
}

/** Out-parameter for {@link facesJoin}: Blender's `BMFace **r_double`. */
export interface FacesJoinDouble {
    double: BMFace | null
}

/**
 * Merge a contiguous manifold region of faces into one n-gon, and return it.
 *
 * Port of `BM_faces_join` (`bmesh_core.cc:1263`). Returns null when the region is not a contiguous
 * manifold disc - an edge with three of the region's faces on it, or a boundary that is not a single
 * cycle - which is Blender's answer too, rather than corrupting the mesh.
 *
 * `doDel` is Blender's argument of the same name: on, the interior edges and vertices are deleted
 * (which takes the old faces with them); off, only the old faces go and their interior skeleton is
 * left behind as wire.
 *
 * When the joined face turns out to be a double of an existing face: without `rDouble` the new face
 * is killed and the existing one returned (and reused); with `rDouble` the double is reported there
 * and the new face kept, for the caller to resolve - both as Blender's `r_double`. An active face that
 * was joined away is replaced by the result (`had_active_face`).
 */
export function facesJoin(bm: BMesh, faces: readonly BMFace[], doDel: boolean, rDouble?: FacesJoinDouble): BMFace | null {
    const hadActiveFace = bm.actFace !== null

    // Initialize the return value if provided. This ensures it will be null if the join fails.
    if (rDouble) rDouble.double = null

    if (!faces.length) return null
    if (faces.length === 1) return faces[0]

    // `bm_elements_systag_enable(faces, totface, _FLAG_JF)`; the edge and vertex `_FLAG_JF` are separate sets.
    const flagJF = new Set(faces)
    const edgeJF = new Set<BMEdge>()
    const vertJF = new Set<BMVert>()

    const edges: BMEdge[] = []
    const deledges: BMEdge[] = []
    const delverts: BMVert[] = []
    let v1: BMVert | null = null
    let v2: BMVert | null = null

    for (const f of faces) {
        const lFirst = f.lFirst
        let lIter = lFirst
        do {
            // `bm_loop_systag_count_radial(l_iter, _FLAG_JF)`
            let rlen = 0
            for (const rl of radialLoops(lIter.e!)) if (flagJF.has(rl.f)) rlen++

            if (rlen > 2) {
                // Input faces do not form a contiguous manifold region.
                return null
            }
            if (rlen === 1) {
                edges.push(lIter.e!)
                if (!v1) {
                    v1 = lIter.v
                    v2 = lIter.e!.otherVert(lIter.v)
                }
            } else if (rlen === 2) {
                const e = lIter.e!
                const d1 = vertIsManifoldInRegion(e.v1, flagJF)
                const d2 = vertIsManifoldInRegion(e.v2, flagJF)

                if (!d1 && !d2 && !edgeJF.has(e)) {
                    // don't remove an edge it makes up the side of another face
                    // else this will remove the face as well - campbell
                    if (!(edgeFaceCount(e) > 2)) {
                        if (doDel) deledges.push(e)
                        edgeJF.add(e)
                    }
                } else {
                    if (d1 && !vertJF.has(e.v1)) {
                        if (doDel) delverts.push(e.v1)
                        vertJF.add(e.v1)
                    }
                    if (d2 && !vertJF.has(e.v2)) {
                        if (doDel) delverts.push(e.v2)
                        vertJF.add(e.v2)
                    }
                }
            }
        } while ((lIter = lIter.next) !== lFirst)
    }

    // create region face
    let fNew = edges.length ? faceCreateNgon(bm, v1!, v2!, edges, faces[0]) : null
    if (!fNew) {
        // Invalid boundary region to join faces
        return null
    }

    // If a new face was created, check whether it is a double of an existing face.
    const fExisting = faceFindDouble(fNew)
    if (fExisting) {
        if (rDouble) {
            // Return the double to the calling function if that was requested.
            rDouble.double = fExisting
        } else {
            // Otherwise, automatically reuse the existing face.
            bm.faceKill(fNew)
            fNew = fExisting
        }
    }

    const reusingFace = fExisting !== null && !rDouble

    // If we are *not* reusing an existing face, transfer data from the faces being joined.
    if (!reusingFace) {
        // copy over loop data
        const lFirst = fNew.lFirst
        let lIter = lFirst
        do {
            let l2 = lIter.radialNext!
            do {
                if (flagJF.has(l2.f)) break
                l2 = l2.radialNext!
            } while (l2 !== lIter)

            if (l2 !== lIter) {
                // loops share an edge, shared vert depends on winding
                if (l2.v !== lIter.v) l2 = l2.next
                // `BM_elem_attrs_copy(bm, l2, l_iter)`
                copyElemHeader(l2, lIter, 'loop')
                copyElemAttrs(l2, lIter, bm.ldata)
            }
        } while ((lIter = lIter.next) !== lFirst)
    }

    if (doDel) {
        // delete all the edges and verts that were identified while walking the mesh
        for (const edge of deledges) bm.edgeKill(edge)
        for (const vert of delverts) bm.vertKill(vert)
    } else {
        // delete only the faces that were merged
        for (const f of faces) bm.faceKill(f)
    }

    // If the mesh started with an active face, but no longer has one, then the active face was one
    // of the faces that was joined then deleted. Set the active face to preserve it.
    if (hadActiveFace && bm.actFace === null) bm.actFace = fNew

    return fNew
}

/**
 * `BM_faces_join_pair` (`bmesh_mods.cc:193`): join the two faces across one edge. When the faces
 * wind the same way along the shared edge (`l_a->v == l_b->v`) the second is reversed first (and
 * stays reversed if the join then fails, as in Blender).
 */
export function facesJoinPair(bm: BMesh, lA: BMLoop, lB: BMLoop, doDel: boolean, rDouble?: FacesJoinDouble): BMFace | null {
    if (lA.v === lB.v) loopReverse(lB.f)
    return facesJoin(bm, [lA.f, lB.f], doDel, rDouble)
}

export interface DissolveFacesOptions {
    /**
     * Dissolve remaining vertices which connect to only two edges. Blender's `use_verts` (bmesh
     * operator default false; `MESH_OT_dissolve_faces` default false).
     */
    useVerts?: boolean
}

/**
 * Dissolve faces: merge each connected group of the given faces into one n-gon. Returns the faces
 * made - Blender's `region.out`, in mesh order. A group of a single face is left alone and is not in
 * the output, as in Blender.
 *
 * Port of `bmo_dissolve_faces_exec` (`bmo_dissolve.cc:225`). Groups are walked with
 * `BMW_ISLAND_MANIFOLD` restricted to the input faces; a group whose join fails is kept unchanged
 * (Blender stopped raising "Could not create merged face" in 3.0), and any input face the joins did
 * not already remove goes through the `DEL_FACES` delete.
 *
 * Like every `bmo_*` port here this does not refresh normals or flush the selection; Blender's
 * `bmesh_edit_end` does that around the outermost operator, which {@link dissolveFacesSelection} ports.
 */
export function dissolveFaces(bm: BMesh, faces: readonly BMFace[], options: DissolveFacesOptions = {}): BMFace[] {
    const useVerts = options.useVerts ?? false
    const vertMark = new Set<BMVert>()
    const faceMark = new Set<BMFace>()
    const faceTag = new Set<BMFace>()
    const faceOrig = new Set<BMFace>()
    const faceNew = new Set<BMFace>()

    if (useVerts) {
        // tag verts that start out with only 2 edges, don't remove these later
        for (const v of bm.verts) if (!vertIsEdgePair(v)) vertMark.add(v)
    }

    for (const f of faces) {
        faceMark.add(f)
        faceTag.add(f)
    }

    // List of regions which are themselves a list of faces.
    const regions: BMFace[][] = []

    // collect region
    for (const f of faces) {
        if (!faceTag.has(f)) continue
        // `BMW_ISLAND_MANIFOLD` with `mask_face = FACE_MARK`
        const walked = walkIsland(f, true, {maskFace: x => faceMark.has(x)})
        // Check there are at least two faces before creating the array.
        if (walked.length >= 2) {
            for (const face of walked) {
                faceTag.delete(face)
                faceOrig.add(face)
            }
            regions.push(walked)
        }
    }

    // track how many faces we should end up with
    let totfaceTarget = bm.totface

    for (const region of regions) {
        const facesLen = region.length
        const fDouble: FacesJoinDouble = {double: null}
        let fNew = facesJoin(bm, region, true, fDouble)

        if (fNew) {
            // All the joined faces are gone and the fresh f_new represents their union.
            totfaceTarget -= facesLen - 1

            if (fDouble.double) {
                // `BM_faces_join()` succeeded, but there is a double. Keep the pre-existing face and
                // retain its custom-data. Remove the newly made merge result.
                bm.faceKill(fNew)
                totfaceTarget -= 1
                fNew = fDouble.double
            }

            // Un-mark the joined face to ensure it is not garbage collected later.
            faceOrig.delete(fNew)
            // Mark the joined face so it can be added to the selection later.
            faceNew.add(fNew)
        } else {
            // `BM_faces_join()` failed. Prevent these faces from being removed.
            for (const face of region) faceOrig.delete(face)
        }
    }

    // Typically no faces need to be deleted
    if (totfaceTarget !== bm.totface) {
        // `delete geom=%ff context=DEL_FACES` (`bmo_delete_exec` -> `BMO_mesh_delete_oflag_context`):
        // `%ff` collects the faces carrying FACE_ORIG now; the nested operator has fresh flags.
        const geom = new Set<BMFace>()
        for (const f of bm.faces) if (faceOrig.has(f)) geom.add(f)
        bmoDeleteFacesContext(bm, new Set(), new Set(), geom)
    }

    if (useVerts) {
        for (const v of [...bm.verts]) {
            if (!bm.verts.has(v)) continue // `BM_ITER_MESH_MUTABLE`: the next element was read before
            if (!vertMark.has(v)) continue
            if (vertIsEdgePair(v)) vertCollapseEdgeAndMerge(bm, v, true)
        }
    }

    // `BMO_slot_buffer_from_enabled_flag(.., "region.out", BM_FACE, FACE_NEW)`
    const out: BMFace[] = []
    for (const f of bm.faces) if (faceNew.has(f)) out.push(f)
    return out
}

// region edit-mode operator

/**
 * `bmesh_edit_end` flags of `dissolve_verts` / `_edges` / `_faces` / `_limit`
 * (`bmesh_opdefines.cc:1480`, `:1512`, `:1537`, `:1582`): `BMO_OPTYPE_FLAG_NORMALS_CALC |
 * SELECT_FLUSH | SELECT_VALIDATE`.
 */
export const DISSOLVE_EDIT_END: BmeshEditEndFlags = {normalsCalc: true, selectFlush: true, selectValidate: true}

/**
 * Result of the selection-level dissolve operators. `changed` is false when the operator ran but
 * had nothing to work on (Blender's `continue` for an object with no selection); `regionOut` is the
 * operator's `region.out` where it has one.
 */
export type DissolveSelectionResult =
    | {ok: true, changed: boolean, regionOut: BMFace[]}
    | {ok: false, error: string}

/**
 * Elements carrying `hflag`, hidden ones excluded, in mesh order: the `%hv`/`%he`/`%hf` slot
 * arguments under `BMO_FLAG_RESPECT_HIDE` (`bmo_slot_buffer_from_hflag`, `bmesh_operators.cc:801`).
 */
export function elemsWithHflag<T extends BMVert | BMEdge | BMFace>(set: Iterable<T>, hflag: number): T[] {
    const out: T[] = []
    for (const ele of set) if (!(ele.hflag & ElemFlag.Hidden) && (ele.hflag & hflag)) out.push(ele)
    return out
}

export interface DissolveFacesSelectionOptions {
    /** "Dissolve Vertices": dissolve remaining vertices which connect to only two edges. Default false. */
    useVerts?: boolean
}

/**
 * Edit-mode Dissolve Faces: `edbm_dissolve_faces_exec` (`editmesh_tools.cc:6187`). Runs
 * {@link dissolveFaces} on the selected visible faces, then (`EDBM_op_call_and_selectf(.., "region.out",
 * true, ..)`) adds the merged faces to the selection with a flush.
 *
 * Not ported: `BM_custom_loop_normals_to_vector_layer` / `_from_vector_layer`. The kernel keeps custom
 * normals (if any) as a plain corner attribute, which the joins already carry like any other layer.
 */
export function dissolveFacesSelection(bm: BMesh, options: DissolveFacesSelectionOptions = {}): DissolveSelectionResult {
    const useVerts = options.useVerts ?? false
    selectCountsRecalc(bm)
    if (bm.totfacesel === 0) return {ok: true, changed: false, regionOut: []}

    const faces = elemsWithHflag(bm.faces, ElemFlag.Select)
    const regionOut = dissolveFaces(bm, faces, {useVerts})
    // `bmesh_edit_end`: the dissolve operators are NORMALS_CALC | SELECT_FLUSH | SELECT_VALIDATE.
    bmeshEditEnd(bm, DISSOLVE_EDIT_END)
    // `select_extend == true`: no deselect-all first; `BMO_slot_buffer_hflag_enable(.., BM_FACE, SELECT, true)`
    elemsHflagEnable(bm, regionOut, ElemType.Face, ElemFlag.Select, true)
    selectCountsRecalc(bm)
    return {ok: true, changed: true, regionOut}
}

// endregion

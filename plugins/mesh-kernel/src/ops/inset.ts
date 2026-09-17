/**
 * Inset operators.
 *
 * Ported from `source/blender/bmesh/operators/bmo_inset.cc`, both halves of it:
 * `bmo_inset_individual_exec` (each face shrunk inside itself) and `bmo_inset_region_exec` (the
 * boundary between tagged and untagged faces is split and pushed inwards). The region form is the one
 * the `I` key runs and the one with the geometry in it.
 *
 * Neither operator builds the inset face. That is the part that reads oddly at first and is worth
 * saying out loud: the *original* faces survive and their vertices are moved inwards, and what gets
 * created is the rim of quads between where the boundary was and where it now is. So "inset by `t`"
 * means "separate the region's boundary edges, offset the inner copy by `t`, then fill the gap".
 * Everything else - the even-offset correction, the edge rail, the relative scaling - is about
 * choosing the offset direction and magnitude for one split vertex.
 *
 * Three kernel functions this needs do not exist in `src/bmesh` yet - `bmesh_kernel_edge_separate`,
 * `bmesh_kernel_vert_separate` and `bmesh_kernel_unglue_region_make_vert` (`BM_face_loop_separate`).
 * They are ported here, privately, in the `bmesh_core.cc` section below. They belong in `bmesh/` next
 * to the Euler operators and should move there once nothing else is mid-flight in that directory;
 * they are general-purpose topology surgery, not inset-specific.
 *
 * Divergences from Blender, all deliberate and all local to this file:
 *
 * - **Normals are recomputed on entry.** `bmo_inset` reads `f->no` and `v->no` throughout and edit
 *   mode guarantees they are current. Nothing in this kernel maintains them, so {@link normalsUpdate}
 *   (`BM_mesh_normals_update`) runs first. It is a real side effect on the whole mesh.
 * - **`BMesh.vertCreate` / `edgeCreate` / `faceCreate` do not reproduce `BM_elem_attrs_copy`'s header
 *   rules.** Blender keeps `BM_ELEM_TAG` when copying from an example and drops the select bit; the
 *   kernel does the opposite. This operator depends on both (tags propagate to separated edges, and a
 *   silently-selected new face would desynchronise `bm.totfacesel`), so the three `*CreateFrom`
 *   helpers below fix the header up afterwards. `v->no` and `f->no` are copied from the example by
 *   `BM_elem_attrs_copy` too, and the kernel does not copy those either.
 * - **The edge-info index is a `Map`, not `elem.index`.** Blender stores the `SplitEdgeInfo` slot in
 *   `BM_elem_index_get(e)` and relies on newly created edges reading back as -1. A map has exactly
 *   that behaviour without clobbering the mesh's lazily-validated indices.
 * - **`USE_LOOP_CUSTOMDATA_MERGE` is not ported.** See {@link InsetOptions.useInterpolate}.
 */

import {BMEdge, BMElem, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {
    diskEdgeExists, diskEdges, edgeIsBoundary, radialLoopAppend, radialLoopRemove, radialLoops,
} from '../bmesh/structure'
import {edgeVertSwap, vertSplice} from '../bmesh/splice'
import {BMCustomDataLayout, copyElemAttrs, getValue, setValue} from '../bmesh/customdata'
import {faceInterpFromFace} from '../bmesh/interp'
import {ElemFlag} from '../constants'
import {faceSelectSet, selectNone} from '../bmesh/marking'
import {Vec3, v3add, v3cross, v3dot, v3len, v3mul, v3normalize, v3sub} from '../math'

// region math_geom_inline.cc - shell thickness

/**
 * `SMALL_NUMBER` from `math_geom_inline.cc:18`. The guard value below which the shell functions give
 * up and return 1 rather than dividing by a cosine that has collapsed.
 */
const SMALL_NUMBER = 1e-8

/**
 * How far along `a` you must travel for the result to sit at unit distance from the plane of `b`.
 *
 * Port of `shell_v3v3_normalized_to_dist` (`math_geom_inline.cc:133`), which the header documents as
 * `shell_angle_to_dist(angle_normalized_v3v3(a, b))`, i.e. `1 / |cos(angle)|`. Both inputs must be
 * unit length.
 */
function shellV3V3NormalizedToDist(a: Vec3, b: Vec3): number {
    const angleCos = Math.abs(v3dot(a, b))
    return angleCos < SMALL_NUMBER ? 1 : 1 / angleCos
}

/**
 * The same correction for the *bisector* of `a` and `b`: `1 / |cos(angle / 2)|`.
 *
 * Port of `shell_v3v3_mid_normalized_to_dist` (`math_geom_inline.cc:148`). This one function is the
 * whole of `use_even_offset` for a mid-corner. Walking the normalized bisector by `thickness` leaves
 * a sharp corner far short of `thickness` from either edge; multiplying by this puts it at exactly
 * `thickness` from both, which is what "Offset Even" means in the tool header.
 */
function shellV3V3MidNormalizedToDist(a: Vec3, b: Vec3): number {
    const ab = v3normalize(v3add(a, b))
    const angleCos = v3len(ab) !== 0 ? Math.abs(v3dot(a, ab)) : 0
    return angleCos < SMALL_NUMBER ? 1 : 1 / angleCos
}

// endregion

// region small vector helpers over BMVert

const co = (v: BMVert): Vec3 => [v.x, v.y, v.z]

/** `madd_v3_v3fl` applied to a vertex position. */
function vertMadd(v: BMVert, dir: Vec3, fac: number): void {
    v.x += dir[0] * fac
    v.y += dir[1] * fac
    v.z += dir[2] * fac
}

/** `len_squared_v3v3` - the squared distance between two vectors read as points. */
function lenSquaredV3V3(a: Vec3, b: Vec3): number {
    const d = v3sub(a, b)
    return v3dot(d, d)
}

/** `BM_edge_calc_length`. */
function edgeCalcLength(e: BMEdge): number {
    return Math.hypot(e.v1.x - e.v2.x, e.v1.y - e.v2.y, e.v1.z - e.v2.z)
}

// endregion

// region bmesh_polygon.cc / bmesh_mesh_normals.cc - normals

/**
 * Port of `BM_face_calc_normal` (`bmesh_polygon.cc`), special cases and all.
 *
 * Triangles and quads do not go through Newell: Blender uses `normal_tri_v3` and the "real cross" of
 * a quad's two diagonals. For a non-planar quad the diagonal cross and the Newell accumulation give
 * different answers, so the special cases are not an optimisation and cannot be skipped.
 */
function faceNormalUpdate(f: BMFace): void {
    let n: Vec3
    if (f.len === 4) {
        const l0 = f.lFirst
        const l1 = l0.next
        const l2 = l1.next
        const l3 = l2.next
        // `normal_quad_v3`: cross(v1 - v3, v2 - v4).
        n = v3cross(v3sub(co(l0.v), co(l2.v)), v3sub(co(l1.v), co(l3.v)))
    } else if (f.len === 3) {
        const l0 = f.lFirst
        const l1 = l0.next
        const l2 = l1.next
        // `normal_tri_v3`: cross(v1 - v2, v2 - v3).
        n = v3cross(v3sub(co(l0.v), co(l1.v)), v3sub(co(l1.v), co(l2.v)))
    } else {
        // `bm_face_calc_poly_normal` - Newell's method over the loop cycle.
        n = [0, 0, 0]
        let vPrev = co(f.lFirst.prev.v)
        let l = f.lFirst
        do {
            const vCurr = co(l.v)
            n[0] += (vPrev[1] - vCurr[1]) * (vPrev[2] + vCurr[2])
            n[1] += (vPrev[2] - vCurr[2]) * (vPrev[0] + vCurr[0])
            n[2] += (vPrev[0] - vCurr[0]) * (vPrev[1] + vCurr[1])
            vPrev = vCurr
            l = l.next
        } while (l !== f.lFirst)
    }
    const unit = v3normalize(n)
    f.nx = unit[0]
    f.ny = unit[1]
    f.nz = unit[2]
}

/**
 * Port of `bm_vert_calc_normals_impl` (`bmesh_mesh_normals.cc:85`): each adjacent face normal weighted
 * by the corner angle it subtends at `v`.
 *
 * Blender computes the corner angle from the two *edge* vectors, which are oriented `v1 -> v2` rather
 * than away from the vertex, and flips the sign of the dot product when exactly one of the two edges
 * runs backwards relative to its loop. Reproduced literally - getting that XOR wrong silently weights
 * some corners by their supplement.
 */
function vertNormalUpdate(v: BMVert): void {
    let n: Vec3 = [0, 0, 0]
    if (v.e) {
        for (const eIter of diskEdges(v)) {
            const lFirst = eIter.l
            if (!lFirst) continue
            const e2diff = v3normalize(v3sub(co(eIter.v1), co(eIter.v2)))
            let lIter: BMLoop = lFirst
            do {
                if (lIter.v === v) {
                    const ePrev = lIter.prev.e!
                    const e1diff = v3normalize(v3sub(co(ePrev.v1), co(ePrev.v2)))
                    let dotprod = v3dot(e1diff, e2diff)
                    if ((lIter.prev.e!.v1 === lIter.prev.v) !== (lIter.e!.v1 === lIter.v)) {
                        dotprod = -dotprod
                    }
                    // `math::safe_acos_approx(-dotprod)` - the approximation is for speed only.
                    const fac = Math.acos(Math.min(1, Math.max(-1, -dotprod)))
                    n = v3add(n, v3mul([lIter.f.nx, lIter.f.ny, lIter.f.nz], fac))
                }
                lIter = lIter.radialNext!
            } while (lIter !== lFirst)
        }
        const len = v3len(n)
        if (len !== 0) {
            v.nx = n[0] / len
            v.ny = n[1] / len
            v.nz = n[2] / len
            return
        }
    }
    // Blender's fallback: point away from the origin.
    const fallback = v3normalize(co(v))
    v.nx = fallback[0]
    v.ny = fallback[1]
    v.nz = fallback[2]
}

/**
 * Port of `BM_mesh_normals_update`. Faces first, then vertices, because the vertex pass reads face
 * normals.
 *
 * Edit mode runs this after every operator, so `bmo_inset` simply assumes `f->no` and `v->no` are
 * current. Nothing in this kernel does, so the inset operators run it themselves.
 */
function normalsUpdate(bm: BMesh): void {
    for (const f of bm.faces) faceNormalUpdate(f)
    for (const v of bm.verts) vertNormalUpdate(v)
}

// endregion

// region bmesh_query.cc - the queries inset uses

/** Loops at `v`, i.e. those whose `l.v` is `v`. Blender's `BM_LOOPS_OF_VERT` iterator. */
function* loopsOfVert(v: BMVert): Generator<BMLoop> {
    for (const e of diskEdges(v)) {
        for (const l of radialLoops(e)) {
            if (l.v === v) yield l
        }
    }
}

/** True when any face using `v` carries `BM_ELEM_TAG`. Blender's `BM_FACES_OF_VERT` scan. */
function vertHasTaggedFace(v: BMVert): boolean {
    for (const e of diskEdges(v)) {
        for (const l of radialLoops(e)) {
            if (l.f.hflag & ElemFlag.Tag) return true
        }
    }
    return false
}

/** Each face using `v`, once. Blender's `BM_FACES_OF_VERT` iterator. */
function* facesOfVert(v: BMVert): Generator<BMFace> {
    const seen = new Set<BMFace>()
    for (const e of diskEdges(v)) {
        for (const l of radialLoops(e)) {
            if (seen.has(l.f)) continue
            seen.add(l.f)
            yield l.f
        }
    }
}

/**
 * The edge's two vertices in the order `lEdge` walks them.
 *
 * Port of `BM_edge_ordered_verts_ex`. An edge has no intrinsic direction; a loop does, and the whole
 * point of this call is to borrow the loop's.
 */
function edgeOrderedVertsEx(lEdge: BMLoop): [BMVert, BMVert] {
    return [lEdge.v, lEdge.next.v]
}

/**
 * The unit vector lying in `eLoop`'s face, perpendicular to `e`, pointing into the face.
 *
 * Port of `BM_edge_calc_face_tangent` (`bmesh_query.cc`). This is the direction the edge wants to move
 * when the face is inset, and `SplitEdgeInfo.no` is nothing but this per split edge.
 */
function edgeCalcFaceTangent(eLoop: BMLoop): Vec3 {
    const [v1, v2] = edgeOrderedVertsEx(eLoop)
    const tvec = v3sub(co(v1), co(v2))
    return v3normalize(v3cross(tvec, [eLoop.f.nx, eLoop.f.ny, eLoop.f.nz]))
}

/**
 * The loop on the other face of `e`, aligned so it points at the same vertex `l` does.
 *
 * Port of `BM_edge_other_loop`. Requires `e` to have a second radial face.
 */
function edgeOtherLoop(e: BMEdge, l: BMLoop): BMLoop {
    let lOther = l.e === e ? l : l.prev
    lOther = lOther.radialNext!
    if (lOther.v === l.v) {
        /* pass */
    } else if (lOther.next.v === l.v) {
        lOther = lOther.next
    } else {
        throw new Error(`mesh-kernel: edge ${e.id} radial cycle does not reach vertex ${l.v.id}`)
    }
    return lOther
}

/**
 * Walking `l`'s face across `v`, the loop at the vertex on the far side of `v` from `l.e`.
 *
 * Port of `BM_loop_other_vert_loop`, written out in the same four branches. Used by the edge rail to
 * ask "do these two region faces meet at a single shared vertex beyond the split one".
 */
function loopOtherVertLoop(l: BMLoop, v: BMVert): BMLoop {
    const e = l.e!
    const vPrev = e.otherVert(v)
    if (l.v === v) {
        if (l.prev.v === vPrev) return l.next
        return l.prev
    }
    if (l.prev.v === v) return l.prev.prev
    return l.next.next
}

/** Port of `BM_loop_calc_face_angle`: the corner angle of `l`'s face at `l.v`. */
function loopCalcFaceAngle(l: BMLoop): number {
    const a = v3normalize(v3sub(co(l.v), co(l.prev.v)))
    const b = v3normalize(v3sub(co(l.v), co(l.next.v)))
    return Math.acos(Math.min(1, Math.max(-1, v3dot(a, b))))
}

/**
 * How far along `v.no` you must move to keep a constant distance from every face at `v`.
 *
 * Port of `BM_vert_calc_shell_factor` (`bmesh_query.cc:1438`), the corner-angle-weighted average of
 * the per-face shell corrections. `depth` uses it so that pushing an inset region in along the vertex
 * normals keeps the offset even where the surface is not flat.
 */
function vertCalcShellFactor(v: BMVert): number {
    let accumShell = 0
    let accumAngle = 0
    const vno: Vec3 = [v.nx, v.ny, v.nz]
    for (const l of loopsOfVert(v)) {
        const faceAngle = loopCalcFaceAngle(l)
        accumShell += shellV3V3NormalizedToDist(vno, [l.f.nx, l.f.ny, l.f.nz]) * faceAngle
        accumAngle += faceAngle
    }
    return accumAngle !== 0 ? accumShell / accumAngle : 1
}

// endregion

// region bmesh_construct.cc - element creation that matches BM_elem_attrs_copy

/**
 * Blender's header rule when copying from an example: the destination keeps its own select bits and
 * takes every other flag - crucially including `BM_ELEM_TAG` - from the source. See the four
 * `BM_elem_attrs_copy` overloads at `bmesh_construct.cc:365`.
 *
 * `BMesh`'s create helpers do the reverse, stripping `Tag` and inheriting `Select`. Inset needs
 * Blender's rule: tags have to survive onto separated edges, and a new face that quietly arrives
 * selected would leave `bm.totfacesel` wrong.
 */
function elemHflagFromExample(dstSelectMask: number, srcHflag: number): number {
    return srcHflag & ~dstSelectMask
}

/** `BM_vert_create(bm, v_example->co, v_example, BM_CREATE_NOP)`, normal and flags included. */
function vertCreateFrom(bm: BMesh, example: BMVert): BMVert {
    const v = bm.vertCreate(example.x, example.y, example.z, example)
    v.hflag = elemHflagFromExample(ElemFlag.Select, example.hflag)
    v.nx = example.nx
    v.ny = example.ny
    v.nz = example.nz
    return v
}

/**
 * `BM_edge_create(bm, v1, v2, e_example, ...)`, with `BM_CREATE_NO_DOUBLE` as `noDouble`.
 *
 * The existing-edge lookup is done here rather than deferred to `BMesh.edgeCreate` so that an edge
 * that was already there keeps its own header instead of being overwritten from the example.
 */
function edgeCreateFrom(bm: BMesh, v1: BMVert, v2: BMVert, example: BMEdge, noDouble = false): BMEdge {
    if (noDouble) {
        const existing = diskEdgeExists(v1, v2)
        if (existing) return existing
    }
    const e = bm.edgeCreate(v1, v2, example)
    e.hflag = elemHflagFromExample(ElemFlag.Select, example.hflag)
    return e
}

/** `BM_face_create_verts(bm, varr, len, f_example, BM_CREATE_NOP, true)`. */
function faceCreateFrom(bm: BMesh, verts: BMVert[], example: BMFace): BMFace {
    const f = bm.faceCreate(verts, example)
    f.hflag = elemHflagFromExample(ElemFlag.Select | ElemFlag.SelectUV, example.hflag)
    f.nx = example.nx
    f.ny = example.ny
    f.nz = example.nz
    return f
}

/**
 * Replace `dst`'s whole attribute block with `src`'s, defaults and all.
 *
 * `CustomData_bmesh_free_block_data` followed by `CustomData_bmesh_copy_block`, which is how
 * `bmo_inset_region_exec` installs a stored block onto a rim loop. Not the same as
 * {@link copyElemAttrs}: that one leaves the destination alone where the source has no block, and a
 * block-for-block replacement must not.
 */
function blockReplace(src: BMElem, dst: BMElem, layout: BMCustomDataLayout): void {
    for (const layer of layout.layers) setValue(dst, layout, layer, getValue(src, layer))
}

/** `BM_elem_attrs_copy` for a pair of loops - per-corner data plus the header rule. */
function loopAttrsCopy(bm: BMesh, src: BMLoop, dst: BMLoop): void {
    if (src === dst) return
    copyElemAttrs(src, dst, bm.ldata)
    dst.hflag = (dst.hflag & (ElemFlag.Select | ElemFlag.SelectUV))
        | (src.hflag & ~(ElemFlag.Select | ElemFlag.SelectUV))
}

// endregion

// region bmesh_core.cc - the three separation kernels

/**
 * Peel `lSep` off `e` onto a duplicate edge, leaving the rest of `e`'s radial fan behind.
 *
 * Port of `bmesh_kernel_edge_separate` (`bmesh_core.cc:2711`). Blender asserts rather than acting on a
 * boundary edge, because there is nothing to cut; the same early-out is kept here so callers can be
 * sloppy the way `bmesh_kernel_unglue_region_make_vert` is.
 */
function kernelEdgeSeparate(bm: BMesh, e: BMEdge, lSep: BMLoop): void {
    if (lSep.e !== e) throw new Error(`mesh-kernel: loop ${lSep.id} is not on edge ${e.id}`)
    if (edgeIsBoundary(e)) return

    if (lSep === e.l) e.l = lSep.radialNext

    const eNew = edgeCreateFrom(bm, e.v1, e.v2, e)
    radialLoopRemove(e, lSep)
    radialLoopAppend(eNew, lSep)
}

/**
 * Split `v` into one vertex per face fan around it.
 *
 * Port of `bmesh_kernel_vert_separate` (`bmesh_core.cc:2431`). The returned array starts with `v`
 * itself, which keeps the last fan found; the others are new. A wire edge is its own fan, which is
 * exactly what lets the region inset glue the duplicated boundary edges back together afterwards.
 *
 * The walk is Blender's: flag every edge of the disk, then repeatedly take `v->e`, sweep the fan
 * reachable from it through radial neighbours, and move that fan onto a fresh vertex unless it is the
 * last one. `EDGE_VISIT` (Blender's `_FLAG_WALK` API flag) is a `Set` here, since this kernel has no
 * API-flag layer.
 */
function kernelVertSeparate(bm: BMesh, v: BMVert): BMVert[] {
    const vertsOut: BMVert[] = [v]
    if (!v.e) return vertsOut

    const visited = new Set<BMEdge>()
    let vEdgesNum = 0
    {
        const eFirst = v.e
        let eIter: BMEdge = eFirst
        do {
            vEdgesNum++
            visited.add(eIter)
            eIter = eIter.diskNext(v)!
        } while (eIter !== eFirst)
    }

    let edgesFound = 0
    for (;;) {
        // `edges` collects one fan; `edgesSearch` is the frontier of radial neighbours to expand.
        const edges: BMEdge[] = []
        const edgesSearch: BMEdge[] = []

        let e: BMEdge | undefined = v.e!
        visited.delete(e)
        do {
            edges.push(e)
            edgesFound++

            if (e.l) {
                const lFirst = e.l
                let lIter: BMLoop = lFirst
                do {
                    // The other edge of this face at `v` - the fan steps across faces, not edges.
                    const lAdjacent = lIter.v === v ? lIter.prev : lIter.next
                    const eAdjacent = lAdjacent.e!
                    if (visited.has(eAdjacent)) {
                        visited.delete(eAdjacent)
                        edgesSearch.push(eAdjacent)
                    }
                    lIter = lIter.radialNext!
                } while (lIter !== lFirst)
            }

            e = edgesSearch.pop()
        } while (e)

        if (edgesFound === vEdgesNum) {
            // The remaining fan is left on `v`; Blender's "We're done!".
            break
        }

        const vNew = vertCreateFrom(bm, v)
        for (const eMove of edges) edgeVertSwap(eMove, vNew, v)
        vertsOut.push(vNew)
    }

    return vertsOut
}

/**
 * Detach one face corner from the fan around its vertex, returning the vertex that keeps `lSep`.
 *
 * Port of `bmesh_kernel_unglue_region_make_vert` (`bmesh_core.cc:2749`), which is what
 * `BM_face_loop_separate` is an alias for (`bmesh_mods.cc:891`).
 *
 * The search loop below is transcribed as shipped. Note that its comment ("Search for an edge
 * unattached to this loop", and a no-op return when the vertex has only the loop's two edges)
 * describes the *opposite* condition to the `!ELEM(...)` the code tests, so the early return is in
 * practice unreachable: a valence-2 vertex is separated rather than returned unchanged. That is not a
 * problem for inset, which handles both outcomes - `bmo_face_inset_individual` only uses the return
 * value to decide whether it has to create the rim vertex itself, and when the split happens the
 * original vertex becomes the rim vertex instead. Kept faithful rather than "fixed", since the
 * geometry is identical either way and diverging here would diverge from Blender's output.
 */
function kernelUnglueRegionMakeVert(bm: BMesh, lSep: BMLoop): BMVert {
    const vSep = lSep.v

    // Peel the face from the edge radials on both sides of the loop vert.
    if (!edgeIsBoundary(lSep.e!)) kernelEdgeSeparate(bm, lSep.e!, lSep)
    if (!edgeIsBoundary(lSep.prev.e!)) kernelEdgeSeparate(bm, lSep.prev.e!, lSep.prev)

    let eIter = vSep.e!
    while (eIter !== lSep.e && eIter !== lSep.prev.e) {
        eIter = eIter.diskNext(vSep)!
        if (eIter === vSep.e) return vSep
    }

    vSep.e = lSep.e

    const vNew = vertCreateFrom(bm, vSep)
    const edges: BMEdge[] = [lSep.e!, lSep.prev.e!]
    for (const e of edges) edgeVertSwap(e, vNew, vSep)

    return vNew
}

// endregion

// region bmo_inset.cc - generic face interpolation

/**
 * Blender's `InterpFace` (`bmo_inset.cc:50`), built by `bm_interp_face_store` (`:59`).
 *
 * Both inset operators interpolate a face *from itself*: the corners move, and then each corner asks
 * what the per-corner data was at its new position in the *old* face. That needs the old data and the
 * old positions after both have been overwritten, which is why the operator cannot just call
 * `BM_loop_interp_from_face` and be done - Blender's own comment says "this is more complex for
 * regions since we're not creating new faces and throwing away old ones".
 *
 * Blender detaches raw CustomData blocks into a memory arena. A block in this kernel is an element,
 * so the snapshot is a detached copy of the face - its own loops and verts, holding the original
 * positions and the original attribute blocks - that is never added to the mesh. Feeding that clone
 * to {@link faceInterpFromFace} as the source reproduces `BM_face_interp_from_face_ex` with the
 * stored `blocks_l`, `blocks_v`, `cos_2d` and `axis_mat` exactly: `faceProject2d` rebuilds `cos_2d`
 * and `axis_mat` from the clone, which still holds the pre-inset geometry.
 */
interface InterpFace {
    /** The live face, which is both the destination and (through the clone) the source. */
    f: BMFace
    /** Detached copy at the original positions, never in the mesh. */
    clone: BMFace
    /** The clone's loops in order, standing in for Blender's `blocks_l`. */
    cloneLoops: BMLoop[]
    /** Blender's `BM_elem_index_set(l_iter, i)` - which slot of `blocks_l` a live loop maps to. */
    loopIndex: Map<BMLoop, number>
}

/** Port of `bm_interp_face_store` (`bmo_inset.cc:59`). */
function interpFaceStore(bm: BMesh, f: BMFace): InterpFace {
    const clone = new BMFace(bm.nextId())
    const cloneLoops: BMLoop[] = []
    const loopIndex = new Map<BMLoop, number>()

    let prev: BMLoop | null = null
    let i = 0
    for (const l of f.eachLoop()) {
        const v = new BMVert(bm.nextId(), l.v.x, l.v.y, l.v.z)
        v.nx = l.v.nx
        v.ny = l.v.ny
        v.nz = l.v.nz
        blockReplace(l.v, v, bm.vdata)

        const cl = new BMLoop(bm.nextId(), v, null, clone)
        blockReplace(l, cl, bm.ldata)

        if (prev === null) clone.lFirst = cl
        else {
            cl.prev = prev
            prev.next = cl
        }
        prev = cl
        cloneLoops.push(cl)
        // Used later for index lookups, as Blender's `set_dirty` loop index is.
        loopIndex.set(l, i)
        i++
    }
    clone.lFirst.prev = prev!
    prev!.next = clone.lFirst
    clone.len = i
    clone.nx = f.nx
    clone.ny = f.ny
    clone.nz = f.nz

    return {f, clone, cloneLoops, loopIndex}
}

/**
 * Port of `BM_face_interp_from_face_ex(bm, iface->f, iface->f, true, ...)` as both insets call it -
 * the face takes its own stored data back, re-sampled at the corners' new positions.
 */
function interpFaceApply(bm: BMesh, iface: InterpFace): void {
    faceInterpFromFace(bm, iface.f, iface.clone, true)
}

// endregion

// region public API

export interface InsetOptions {
    /**
     * How far the boundary moves, in Blender's `thickness`. With {@link useEvenOffset} on this is a
     * true perpendicular distance from the original edges; with it off it is a distance along the
     * corner bisector, which is shorter.
     */
    thickness?: number
    /** Displacement of the inset face along the vertex normals afterwards. Blender's `depth`. */
    depth?: number
    /**
     * Correct the offset for the corner angle so the inset sits at a constant distance from every
     * original edge. Blender's `use_even_offset`, and true by default there (`MESH_OT_inset`,
     * `editmesh_inset.cc:601`) because without it a sharp corner pulls in far less than asked.
     */
    useEvenOffset?: boolean
    /** Scale the offset by the lengths of the edges it is measured against. Blender's `use_relative_offset`. */
    useRelativeOffset?: boolean
    /**
     * Inset along the open border of the region as well as along the border with other faces.
     * Blender's `use_boundary`, true by default. Forced off by {@link useOutset}.
     *
     * With this off, a region whose whole border is a mesh boundary - a lone quad, say - has no edge
     * to split and the operator does nothing at all.
     */
    useBoundary?: boolean
    /**
     * Where two region faces meet the border at the same vertex and share a vertex beyond it, slide
     * the split vertex along that shared edge instead of along the corner bisector. Blender's
     * `use_edge_rail`, off by default.
     */
    useEdgeRail?: boolean
    /**
     * Grow outwards instead of inwards: the tag is inverted, so the inset happens on the far side of
     * the region border and the selected faces get bigger. Blender's `use_outset`.
     */
    useOutset?: boolean
    /**
     * Blend per-corner data (UVs, colours) across the inset rather than copying it in from the edge.
     * Blender's `use_interpolate`, and the difference between an inset panel whose texture keeps
     * flowing across it and one where the inner ring repeats the border's UVs.
     *
     * Defaults to **false** here, where `MESH_OT_inset` defaults it to true, for one reason:
     * `bmo_inset.cc`'s `USE_LOOP_CUSTOMDATA_MERGE` post-pass (`bm_loop_customdata_merge`, `:111`) is
     * *not* ported. That pass re-merges per-corner values that the interpolation caused to diverge
     * either side of a shared edge (Blender's #41445) and needs `CustomData_layer_has_math`,
     * `CustomData_data_equals` and `CustomData_data_mix_value`, none of which `customdata.ts` models
     * yet. Everything the pass would fix is a seam artefact on a UV map, so the interpolation is
     * correct without it in the common case and opt-in until the rest lands - rather than on by
     * default and subtly wrong on exactly the meshes that care.
     */
    useInterpolate?: boolean
    /**
     * Select the result and deselect everything else, as the interactive operator does. Blender
     * selects the *input* faces (the ones that have just been inset), not the new rim - that is
     * `use_select_inset`, off by default (`editmesh_inset.cc:302`).
     */
    selectResult?: boolean
}

export interface InsetResult {
    /**
     * The rim faces created between the old boundary and the new one - Blender's `faces.out`, flagged
     * `ELE_NEW`. The faces that were passed in are *not* here: they still exist, with the same
     * identity, just smaller.
     */
    faces: BMFace[]
    /** Vertices the operator created, from splitting the region border. */
    verts: BMVert[]
    /** Edges the operator created: the duplicated border edges and the rim's rungs. */
    edges: BMEdge[]
}

interface ResolvedOptions {
    thickness: number
    depth: number
    useEvenOffset: boolean
    useRelativeOffset: boolean
    useBoundary: boolean
    useEdgeRail: boolean
    useOutset: boolean
    useInterpolate: boolean
    selectResult: boolean
}

function resolveOptions(opts: InsetOptions): ResolvedOptions {
    return {
        thickness: opts.thickness ?? 0,
        depth: opts.depth ?? 0,
        // Defaults follow `MESH_OT_inset` rather than the raw operator slots, which are all false.
        useEvenOffset: opts.useEvenOffset ?? true,
        useRelativeOffset: opts.useRelativeOffset ?? false,
        useBoundary: opts.useBoundary ?? true,
        useEdgeRail: opts.useEdgeRail ?? false,
        useOutset: opts.useOutset ?? false,
        useInterpolate: opts.useInterpolate ?? false,
        selectResult: opts.selectResult !== false,
    }
}

/** Book-keeping so the result can report what the operator created. */
class NewElements {
    private readonly _verts: Set<BMVert>
    private readonly _edges: Set<BMEdge>

    constructor(bm: BMesh) {
        this._verts = new Set(bm.verts)
        this._edges = new Set(bm.edges)
    }

    collect(bm: BMesh): {verts: BMVert[], edges: BMEdge[]} {
        return {
            verts: [...bm.verts].filter(v => !this._verts.has(v)),
            edges: [...bm.edges].filter(e => !this._edges.has(e)),
        }
    }
}

function finishSelection(bm: BMesh, faces: BMFace[]): void {
    // `use_select_inset` is off by default, so the editor deselects everything and re-selects the
    // input faces - the ones that were just inset, not the new rim (`editmesh_inset.cc:302`).
    // `faceSelectSet` flushes down to edges and verts, which is what `do_flush` asks for there.
    selectNone(bm)
    for (const f of faces) {
        if (!bm.faces.has(f)) continue
        faceSelectSet(bm, f, true)
    }
}

// endregion

// region inset individual

/**
 * Port of `bmo_face_inset_individual` (`bmo_inset.cc:261`).
 *
 * Every corner of `f` is unglued from its fan, so `f` ends up on a private set of vertices; the
 * vertices it let go of become the rim, and a quad is built between each old edge and its new twin.
 * Then, and only then, are `f`'s own vertices moved inwards.
 */
function faceInsetIndividual(bm: BMesh, f: BMFace, opts: ResolvedOptions, out: BMFace[]): void {
    const len = f.len
    /* Verts split away from the face, aligned with the face verts. */
    const verts: BMVert[] = new Array(len)
    /* Edge tangents, aligned with the face-loop-edges. */
    const edgeNors: Vec3[] = new Array(len)
    const coords: Vec3[] = new Array(len)

    const lFirst = f.lFirst

    // Split off all loops.
    {
        let lIter = lFirst
        let i = 0
        do {
            let vOther: BMVert = lIter.v
            const vSep = kernelUnglueRegionMakeVert(bm, lIter)
            if (vSep === vOther) {
                // Nothing separated - the corner was already private to `f`, so the rim vertex has
                // to be made by hand.
                vOther = vertCreateFrom(bm, lIter.v)
            }
            verts[i] = vOther

            // Unrelated to splitting, but calc here.
            edgeNors[i] = edgeCalcFaceTangent(lIter)

            i++
            lIter = lIter.next
        } while (lIter !== lFirst)
    }

    // Build rim faces.
    {
        let lIter = lFirst
        let i = 0
        do {
            const vOther = verts[i]
            const vOtherNext = verts[(i + 1) % len]

            edgeCreateFrom(bm, vOther, vOtherNext, lIter.e!, true)

            const fNewOuter = faceCreateFrom(bm, [vOther, vOtherNext, lIter.next.v, lIter.v], f)
            out.push(fNewOuter)

            // Copy loop data. `l_other` is the rim face's loop along the shared edge, so stepping
            // around it lands on the corner matching each of `f`'s two loops on that edge.
            const lOther = lIter.radialNext!
            loopAttrsCopy(bm, lIter.next, lOther.prev)
            loopAttrsCopy(bm, lIter, lOther.next.next)

            if (!opts.useInterpolate) {
                loopAttrsCopy(bm, lIter.next, lOther)
                loopAttrsCopy(bm, lIter, lOther.next)
            }

            i++
            lIter = lIter.next
        } while (lIter !== lFirst)
    }

    // Hold interpolation values. After the rim is built and before anything moves, which is the only
    // moment the face still has its original geometry *and* its final loop cycle.
    const iface = opts.useInterpolate ? interpFaceStore(bm, f) : null

    // Calculate the translation vector for each new vert. Done into `coords` first, because reading
    // an edge length after moving one of its vertices would feed the offset back into itself.
    {
        let lIter = lFirst
        let i = 0
        let eLengthPrev = opts.depth !== 0 ? edgeCalcLength(lIter.prev.e!) : 0
        const fno: Vec3 = [f.nx, f.ny, f.nz]
        do {
            const enoPrev = edgeNors[(i ? i : len) - 1]
            const enoNext = edgeNors[i]

            let tvec = v3normalize(v3add(enoPrev, enoNext))
            const vNewCo = co(lIter.v)

            if (opts.useEvenOffset) {
                tvec = v3mul(tvec, shellV3V3MidNormalizedToDist(enoPrev, enoNext))
            }

            if (opts.useRelativeOffset) {
                tvec = v3mul(tvec, (edgeCalcLength(lIter.e!) + edgeCalcLength(lIter.prev.e!)) / 2)
            }

            vNewCo[0] += tvec[0] * opts.thickness
            vNewCo[1] += tvec[1] * opts.thickness
            vNewCo[2] += tvec[2] * opts.thickness

            // Set normal, add depth and write the new vertex position.
            lIter.v.nx = fno[0]
            lIter.v.ny = fno[1]
            lIter.v.nz = fno[2]

            if (opts.depth !== 0) {
                const eLength = edgeCalcLength(lIter.e!)
                const fac = opts.depth * (opts.useRelativeOffset ? (eLengthPrev + eLength) * 0.5 : 1)
                eLengthPrev = eLength
                vNewCo[0] += fno[0] * fac
                vNewCo[1] += fno[1] * fac
                vNewCo[2] += fno[2] * fac
            }

            coords[i] = vNewCo

            i++
            lIter = lIter.next
        } while (lIter !== lFirst)
    }

    // Update the coords.
    {
        let lIter = lFirst
        let i = 0
        do {
            lIter.v.setCo(coords[i][0], coords[i][1], coords[i][2])
            i++
            lIter = lIter.next
        } while (lIter !== lFirst)
    }

    if (iface) {
        interpFaceApply(bm, iface)

        // Re-copy the rim's inner corners, which have to follow the values the face just took.
        let lIter = lFirst
        do {
            const lOther = lIter.radialNext!
            loopAttrsCopy(bm, lIter.next, lOther)
            loopAttrsCopy(bm, lIter, lOther.next)
            lIter = lIter.next
        } while (lIter !== lFirst)
    }
}

/**
 * Inset each face separately, so that neighbouring faces come apart along their shared edge.
 *
 * Port of `bmo_inset_individual_exec` (`bmo_inset.cc:414`). This is the `I, I` form in Blender, and
 * `thickness`, `depth`, {@link InsetOptions.useEvenOffset} and
 * {@link InsetOptions.useRelativeOffset} are the only options it reads - a region's boundary, rail
 * and outset questions do not arise when every face is its own region.
 */
export function insetIndividual(bm: BMesh, faces: BMFace[], opts: InsetOptions = {}): InsetResult {
    const options = resolveOptions(opts)
    const created = new NewElements(bm)
    const newFaces: BMFace[] = []

    if (!faces.length) return {faces: [], verts: [], edges: []}

    normalsUpdate(bm)

    // Only tag faces in the slot. Nothing in the individual path reads the tag, but Blender sets it
    // and an operator that leaves stale tags behind is a trap for the next one.
    for (const f of bm.faces) f.hflag &= ~ElemFlag.Tag
    for (const f of faces) f.hflag |= ElemFlag.Tag

    for (const f of faces) {
        faceInsetIndividual(bm, f, options, newFaces)
    }

    const {verts, edges} = created.collect(bm)
    if (options.selectResult) finishSelection(bm, faces)

    return {faces: newFaces, verts, edges}
}

// endregion

// region inset region

/** Blender's `SplitEdgeInfo` (`bmo_inset.cc:467`), one per edge the region border runs along. */
interface SplitEdgeInfo {
    /** The edge's face tangent, from {@link edgeCalcFaceTangent} - the direction it insets along. */
    no: Vec3
    /** Length before anything moved. */
    length: number
    /** The copy that stays where it was, carrying the untagged side. */
    eOld: BMEdge
    /** The copy that moves inwards, carrying the tagged side. */
    eNew: BMEdge
    /** The loop of the tagged face along this edge. */
    l: BMLoop
}

/**
 * The loop of the single tagged face on this radial cycle, when there is exactly one tagged face and
 * at least one untagged one; null otherwise.
 *
 * Port of `bm_edge_is_mixed_face_tag` (`bmo_inset.cc:483`). This is the definition of "the region
 * border": an edge between a selected face and an unselected one. Two tagged faces means interior,
 * zero means outside, and both are left alone.
 */
function edgeIsMixedFaceTag(l: BMLoop | null): BMLoop | null {
    if (l === null) return null
    let totTag = 0
    let totUntag = 0
    let lTag: BMLoop | null = null
    let lIter: BMLoop = l
    do {
        if (lIter.f.hflag & ElemFlag.Tag) {
            // More than one tagged face - bail out early!
            if (totTag === 1) return null
            lTag = lIter
            totTag++
        } else {
            totUntag++
        }
        lIter = lIter.radialNext!
    } while (lIter !== l)

    return totTag === 1 && totUntag >= 1 ? lTag : null
}

/**
 * Mean length of the split edges around `v`, or -1 when none of `v`'s edges is one.
 *
 * Port of `bm_edge_info_average_length` (`bmo_inset.cc:511`).
 */
function edgeInfoAverageLength(v: BMVert, edgeInfo: SplitEdgeInfo[], edgeIndex: Map<BMEdge, number>): number {
    let len = 0
    let tot = 0
    for (const e of diskEdges(v)) {
        const i = edgeIndex.get(e)
        if (i !== undefined) {
            len += edgeInfo[i].length
            tot++
        }
    }
    return tot !== 0 ? len / tot : -1
}

interface VertLengths {
    /**
     * Length accumulated from vertices nearer the inset boundary, so that an interior vertex with no
     * split edge of its own still gets a value that varies smoothly rather than jumping.
     */
    lengthAccum: number
    /**
     * How many neighbours have contributed. Zero is uninitialised, positive means this pass and not
     * yet divided, -1 means a previous pass and already divided.
     */
    count: number
}

/** Lazily built state for {@link edgeInfoAverageLengthFallback}. */
interface FallbackState {
    vertLengths: Map<BMVert, VertLengths> | null
}

/**
 * Fill in relative lengths for vertices inside the region that no split edge touches.
 *
 * Port of `bm_edge_info_average_length_fallback` (`bmo_inset.cc:547`). Only reached when `depth` is
 * non-zero, `use_relative_offset` is on, and the region has interior vertices - insetting a 3x3 grid
 * of faces with depth, for instance, where the middle vertex is nowhere near a split edge.
 *
 * The walk is a breadth-first flood outwards from the boundary vertices, each pass averaging what the
 * previous one deposited. Blender's `STACK_REMOVE` shuffle over a single array is written here as an
 * explicit per-pass drain, which processes exactly the same vertices in the same (reverse-push) order.
 */
function edgeInfoAverageLengthFallback(
    vLookup: BMVert, edgeInfo: SplitEdgeInfo[], edgeIndex: Map<BMEdge, number>, bm: BMesh,
    state: FallbackState,
): number {
    if (state.vertLengths === null) {
        const vertLengths = new Map<BMVert, VertLengths>()
        let vertStack: BMVert[] = []

        for (const e of bm.edges) {
            if (!edgeIndex.has(e)) continue
            for (const v of [e.v1, e.v2]) {
                if (!(v.hflag & ElemFlag.Tag)) continue
                if (vertLengths.has(v)) continue
                vertStack.push(v)
                // Needed for the first pass; we know the edge lengths exist here.
                vertLengths.set(v, {
                    count: 1,
                    lengthAccum: edgeInfoAverageLength(v, edgeInfo, edgeIndex),
                })
            }
        }

        // While there are vertices without their accumulated lengths divided by the count.
        while (vertStack.length !== 0) {
            const pass = vertStack
            vertStack = []
            for (let i = pass.length - 1; i >= 0; i--) {
                const v = pass[i]
                const rec = vertLengths.get(v)!
                rec.lengthAccum /= rec.count
                rec.count = -1 // Ignore in future passes.

                for (const e of diskEdges(v)) {
                    if (!(e.hflag & ElemFlag.Tag)) continue
                    const vOther = e.otherVert(v)
                    if (!(vOther.hflag & ElemFlag.Tag)) continue
                    let recOther = vertLengths.get(vOther)
                    if (!recOther) {
                        recOther = {lengthAccum: 0, count: 0}
                        vertLengths.set(vOther, recOther)
                    }
                    if (recOther.count >= 0) {
                        if (recOther.count === 0) vertStack.push(vOther)
                        recOther.count += 1
                        recOther.lengthAccum += rec.lengthAccum
                    }
                }
            }
        }

        state.vertLengths = vertLengths
    }

    // Blender asserts the lookup succeeded; a vertex the flood never reached has no length to give.
    return state.vertLengths.get(vLookup)?.lengthAccum ?? 0
}

/** Port of `bm_edge_info_average_length_with_fallback` (`bmo_inset.cc:648`). */
function edgeInfoAverageLengthWithFallback(
    v: BMVert, edgeInfo: SplitEdgeInfo[], edgeIndex: Map<BMEdge, number>, bm: BMesh,
    state: FallbackState,
): number {
    const length = edgeInfoAverageLength(v, edgeInfo, edgeIndex)
    if (length !== -1) return length
    return edgeInfoAverageLengthFallback(v, edgeInfo, edgeIndex, bm, state)
}

/**
 * Inset a region of faces: the border between the region and everything else is split, the inner copy
 * is pushed inwards and a rim of quads fills the gap.
 *
 * Port of `bmo_inset_region_exec` (`bmo_inset.cc:664`), whose own summary is worth keeping:
 *
 * - Set all faces as tagged/untagged based on selection.
 * - Find all edges that have 1 tagged, 1 untagged face.
 * - Separate these edges and tag vertices, set their index to point to the original edge.
 * - Build faces between old/new edges.
 * - Inset the new edges into their faces.
 *
 * `facesExclude` is Blender's `faces_exclude` slot, only meaningful under {@link InsetOptions.useOutset}
 * where it keeps faces out of the (inverted) region; the editor passes hidden faces there.
 */
export function insetRegion(
    bm: BMesh, faces: BMFace[], opts: InsetOptions = {}, facesExclude: BMFace[] = [],
): InsetResult {
    const options = resolveOptions(opts)
    const created = new NewElements(bm)
    const newFaces: BMFace[] = []

    if (!faces.length) return {faces: [], verts: [], edges: []}

    const useOutset = options.useOutset
    // Blender ANDs these two at the top: outsetting has no "boundary of the region" to speak of,
    // since the region is everything else.
    const useBoundary = options.useBoundary && !useOutset
    const useEvenOffset = options.useEvenOffset
    const useEvenBoundary = useEvenOffset /* could make own option */
    const useRelativeOffset = options.useRelativeOffset
    const useEdgeRail = options.useEdgeRail
    const thickness = options.thickness
    const depth = options.depth

    /* BMVert original location storage - only needed by the edge rail, which must not read a
     * position that a previous split has already moved. */
    const useVertCoordsOrig = useEdgeRail
    const vertCoords = new Map<BMVert, Vec3>()

    /* Interpolation vars. Blender keeps an array aligned with faces and fills only the entries it
     * uses; a map keyed by the face is the same thing. */
    const useInterpolate = options.useInterpolate
    const ifaceMap = new Map<BMFace, InterpFace>()

    normalsUpdate(bm)

    if (!useOutset) {
        for (const f of bm.faces) f.hflag &= ~ElemFlag.Tag
        for (const f of faces) f.hflag |= ElemFlag.Tag
    } else {
        for (const f of bm.faces) f.hflag |= ElemFlag.Tag
        for (const f of faces) f.hflag &= ~ElemFlag.Tag
        for (const f of facesExclude) f.hflag &= ~ElemFlag.Tag
    }

    // First count all inset edges we will split, and initialize tagging. Blender stores the slot
    // index in `e->head.index`; a map does the same job without touching the mesh's indices.
    const edgeIndex = new Map<BMEdge, number>()
    const edgeInfo: SplitEdgeInfo[] = []
    for (const e of bm.edges) {
        if (
            /* tag if boundary is enabled */
            (useBoundary && edgeIsBoundary(e) && (e.l!.f.hflag & ElemFlag.Tag)) ||
            /* tag if edge is an interior edge in between a tagged and untagged face */
            edgeIsMixedFaceTag(e.l) !== null
        ) {
            e.v1.hflag |= ElemFlag.Tag
            e.v2.hflag |= ElemFlag.Tag
            e.hflag |= ElemFlag.Tag

            edgeIndex.set(e, edgeInfo.length)
            edgeInfo.push({
                no: [0, 0, 0],
                length: edgeCalcLength(e),
                eOld: e,
                eNew: e,
                l: null as unknown as BMLoop,
            })
        } else {
            e.v1.hflag &= ~ElemFlag.Tag
            e.v2.hflag &= ~ElemFlag.Tag
            e.hflag &= ~ElemFlag.Tag
        }
    }

    const edgeInfoLen = edgeInfo.length
    if (edgeInfoLen === 0) {
        // No border between tagged and untagged faces, so there is nothing to inset. A closed mesh
        // with every face selected lands here, and so does a lone face with `useBoundary` off.
        if (options.selectResult) finishSelection(bm, faces)
        return {faces: [], verts: [], edges: []}
    }

    for (let i = 0; i < edgeInfoLen; i++) {
        const es = edgeInfo[i]
        const lMixed = edgeIsMixedFaceTag(es.eOld.l)
        es.l = lMixed ?? es.eOld.l! /* must be a boundary */

        // Run the separate arg.
        if (!edgeIsBoundary(es.eOld)) {
            kernelEdgeSeparate(bm, es.eOld, es.l)
        }

        // Calc edge-split info.
        es.eNew = es.l.e!
        es.no = edgeCalcFaceTangent(es.l)

        if (es.eNew === es.eOld) {
            // Happens on boundary edges. Take care here, we're creating this double edge which
            // _must_ have its verts replaced later on - the vertex separation below is what does it.
            es.eOld = edgeCreateFrom(bm, es.eNew.v1, es.eNew.v2, es.eNew)
        }

        // Store index back to original in `edge_info`.
        edgeIndex.set(es.eNew, i)
        es.eNew.hflag |= ElemFlag.Tag

        // Important to tag again here.
        es.eNew.v1.hflag |= ElemFlag.Tag
        es.eNew.v2.hflag |= ElemFlag.Tag

        /* Initialize interpolation vars. Only the faces touching `es.l.e` are stored, so faces with
         * no mixed selection cost nothing.
         *
         * NOTE: faces on the other side of the inset will be interpolated too since this is hard to
         * detect; just allow it even though it will cause some redundant interpolation. */
        if (useInterpolate) {
            for (const v of [es.l.e!.v1, es.l.e!.v2]) {
                for (const f of facesOfVert(v)) {
                    if (!ifaceMap.has(f)) ifaceMap.set(f, interpFaceStore(bm, f))
                }
            }
        }
        /* done interpolation */
    }

    // Execute the split and position verts. It would be most obvious to loop over verts here but
    // don't do this since we will be splitting them off (iterating stuff you modify is bad juju);
    // instead loop over edges then their verts.
    for (let i = 0; i < edgeInfoLen; i++) {
        const es = edgeInfo[i]
        for (let j = 0; j < 2; j++) {
            const v = j === 0 ? es.eNew.v1 : es.eNew.v2

            /* end confusing part - just pretend this is a typical loop on verts */

            // Only split off tagged verts - used by separated edges.
            if (!(v.hflag & ElemFlag.Tag)) continue

            // Disable touching twice, this _will_ happen if the flags are not disabled.
            v.hflag &= ~ElemFlag.Tag

            const vout = kernelVertSeparate(bm, v)

            // In some cases the edge doesn't split off.
            if (vout.length === 1) {
                if (useVertCoordsOrig) vertCoords.set(vout[0], co(vout[0]))
                continue
            }

            let vGlue: BMVert | null = null

            for (const vSplit of vout) {
                let vertEdgeTagTot = 0
                const vecpair: [number, number] = [-1, -1]

                if (useVertCoordsOrig) vertCoords.set(vSplit, co(vSplit))

                // Find adjacent split edges that still carry a tagged face.
                for (const e of diskEdges(vSplit)) {
                    if ((e.hflag & ElemFlag.Tag) && e.l && (e.l.f.hflag & ElemFlag.Tag)) {
                        if (vertEdgeTagTot < 2) {
                            const idx = edgeIndex.get(e)
                            if (idx === undefined) {
                                throw new Error(`mesh-kernel: inset edge ${e.id} has no split info`)
                            }
                            vecpair[vertEdgeTagTot] = idx
                        }
                        vertEdgeTagTot++
                    }
                }

                if (vertEdgeTagTot !== 0) {
                    let tvec: Vec3

                    if (vertEdgeTagTot >= 2) {
                        /* 2 edge users - common case.
                         *
                         * Now there are 2 cases to check for: if both edges use the same face OR both
                         * faces have the same normal, then we can calculate an edge that fits nicely
                         * between the 2 edge normals. Otherwise use the shared edge OR the corner
                         * defined by these 2 face normals. */
                        const eInfoA = edgeInfo[vecpair[0]]
                        const eInfoB = edgeInfo[vecpair[1]]

                        const fA = eInfoA.l.f
                        const fB = eInfoB.l.f

                        /* Set to false when we're not exactly between (e_info_a->no, e_info_b->no);
                         * in that case the shell thickness has to be measured against the angle of
                         * tvec itself rather than against the bisector. */
                        let isMid = true

                        // Used as either the normal, or to find the right direction for the cross
                        // product between both face normals.
                        tvec = v3add(eInfoA.no, eInfoB.no)

                        if (!useEdgeRail) {
                            /* pass */
                        } else if (fA !== fB) {
                            // These lookups are very quick.
                            const lOtherA = loopOtherVertLoop(eInfoA.l, vSplit)
                            const lOtherB = loopOtherVertLoop(eInfoB.l, vSplit)

                            if (lOtherA.v === lOtherB.v) {
                                // Both edges' faces are adjacent, but we don't need to know the
                                // shared edge - having both verts is enough. Note that we can't use
                                // `l_other_a->v` directly since it may be inset and give a feedback
                                // loop, which is what `vertCoords` is for.
                                const coOther = useVertCoordsOrig
                                    ? vertCoords.get(lOtherA.v) ?? co(lOtherA.v)
                                    : co(lOtherA.v)

                                tvec = v3sub(coOther, co(vSplit))
                                isMid = false
                            }

                            /* Blender's second branch here - a cross product of the two face normals
                             * when the faces do not touch - is `#if 0`'d out upstream, "since this
                             * gives odd results at times, see #39288". Not ported for that reason. */
                        }

                        tvec = v3normalize(tvec)

                        // Scale by edge angle.
                        if (useEvenOffset) {
                            if (isMid) {
                                tvec = v3mul(tvec, shellV3V3MidNormalizedToDist(eInfoA.no, eInfoB.no))
                            } else {
                                // Use the largest angle.
                                const far = lenSquaredV3V3(tvec, eInfoA.no) > lenSquaredV3V3(tvec, eInfoB.no)
                                    ? eInfoA.no
                                    : eInfoB.no
                                tvec = v3mul(tvec, shellV3V3NormalizedToDist(tvec, far))
                            }
                        }

                        // Scale relative to edge lengths.
                        if (useRelativeOffset) {
                            tvec = v3mul(tvec, (edgeInfo[vecpair[0]].length + edgeInfo[vecpair[1]].length) / 2)
                        }
                    } else {
                        /* 1 edge user - boundary vert, not so common. */
                        const eNoA = edgeInfo[vecpair[0]].no

                        if (useEvenBoundary) {
                            /* This is the case where only one split edge is attached to `v_split`,
                             * i.e. the face to inset is on a boundary. We want the inset to align
                             * flush with the boundary edge, not with the normal of the interior edge,
                             * which would give an unsightly bump.
                             *
                             * The fact we are doing location comparisons on verts that are moved
                             * about doesn't matter, because the direction remains the same. */
                            const eStart = vSplit.e
                            if (!eStart || !eStart.l) {
                                throw new Error(
                                    `mesh-kernel: inset boundary vertex ${vSplit.id} has no face to align to`)
                            }
                            // The loop will always be either next or prev.
                            let l: BMLoop = eStart.l
                            if (l.prev.v === vSplit) l = l.prev
                            else if (l.next.v === vSplit) l = l.next
                            else if (l.v === vSplit) { /* pass */ } else {
                                throw new Error(
                                    `mesh-kernel: inset could not place loop ${l.id} at vertex ${vSplit.id}`)
                            }

                            // Find the edge which is _not_ being split here.
                            let eOther: BMEdge
                            if (!(l.e!.hflag & ElemFlag.Tag)) eOther = l.e!
                            else if (!(l.prev.e!.hflag & ElemFlag.Tag)) eOther = l.prev.e!
                            else {
                                throw new Error(
                                    `mesh-kernel: inset found no unsplit edge at vertex ${vSplit.id}`)
                            }

                            const vOther = eOther.otherVert(vSplit)
                            tvec = v3normalize(v3sub(co(vOther), co(vSplit)))

                            if (useEvenOffset) {
                                tvec = v3mul(tvec, shellV3V3NormalizedToDist(eNoA, tvec))
                            }
                        } else {
                            tvec = [eNoA[0], eNoA[1], eNoA[2]]
                        }

                        // Scale relative to edge length.
                        if (useRelativeOffset) {
                            tvec = v3mul(tvec, edgeInfo[vecpair[0]].length)
                        }
                    }

                    // Apply the offset.
                    vertMadd(vSplit, tvec, thickness)
                }

                // This saves the expensive/slow glue check for common cases.
                if (vout.length > 2) {
                    // Last step: fuse this vertex back in if it has no tagged face. The duplicated
                    // boundary edges land here - each is its own fan, and without this the outer rim
                    // would be a set of disconnected wire edges rather than a ring.
                    if (!vertHasTaggedFace(vSplit)) {
                        if (vGlue === null) {
                            vGlue = vSplit
                        } else if (vertSplice(bm, vGlue, vSplit)) {
                            if (useVertCoordsOrig) vertCoords.delete(vSplit)
                        }
                    }
                }
            }
        }
    }

    if (useInterpolate) {
        for (const iface of ifaceMap.values()) interpFaceApply(bm, iface)
    }

    // Create faces.
    for (let i = 0; i < edgeInfoLen; i++) {
        const es = edgeInfo[i]
        const varr: BMVert[] = []

        // Get the verts in the correct order. Blender fills varr[1] then varr[0], which reverses the
        // new edge relative to the tagged face - "yes - reverse face is correct in this case" - and
        // is what makes the rim wind consistently with the face it was cut from.
        const [ordered0, ordered1] = edgeOrderedVertsEx(es.l)
        varr[1] = ordered0
        varr[0] = ordered1

        // Slightly trickier check than taking all four - since we can't assume the verts are split.
        let j = 2 /* 2 edges are set */
        if (varr[0] === es.eNew.v1) {
            if (es.eOld.v2 !== es.eNew.v2) varr[j++] = es.eOld.v2
            if (es.eOld.v1 !== es.eNew.v1) varr[j++] = es.eOld.v1
        } else {
            if (es.eOld.v1 !== es.eNew.v1) varr[j++] = es.eOld.v1
            if (es.eOld.v2 !== es.eNew.v2) varr[j++] = es.eOld.v2
        }

        if (j === 2) {
            // Can't make face! Nothing separated along this edge.
            continue
        }

        const f = faceCreateFrom(bm, varr.slice(0, j), es.l.f)
        newFaces.push(f)

        /* Copy loop data, otherwise UVs and vertex colours are no good. Blender notes it could
         * interpolate here instead, which is what `use_interpolate` does.
         *
         *              l_a->e & l_b->prev->e
         * +------------------------------------+
         * |\ l_a                          l_b /|
         * | \ l_a->prev->e            l_b->e / |
         * |  \ l_a->prev          l_b->next /  |
         * |   +----------------------------+   |
         * |   |l_a_other    ^     l_b_other|   |
         * |   |        (inset face)        |   |
         * |   +----------------------------+   |
         * |  /                              \  |
         * | /                                \ |
         * |/                                  \|
         * +------------------------------------+
         */
        let lA: BMLoop = f.lFirst
        let lB: BMLoop = lA.next

        // We know this side has a radial_next because of the order of created verts in the quad.
        const lAOther = edgeOtherLoop(lA.e!, lA)
        const lBOther = edgeOtherLoop(lA.e!, lB)
        loopAttrsCopy(bm, lAOther, lA)
        loopAttrsCopy(bm, lBOther, lB)

        // Step around to the opposite side of the quad - warning, this may have no other edges!
        lA = lA.next.next
        lB = lA.next

        // Swap a<->b intentionally.
        if (useInterpolate) {
            // The outer corners take the face's data as it was *before* the inset moved anything,
            // straight out of the stored blocks - the interpolated values now on the face belong to
            // the inner corners, which `lA`/`lB`'s siblings already received above.
            const iface = ifaceMap.get(es.l.f)
            const iA = iface?.loopIndex.get(lAOther)
            const iB = iface?.loopIndex.get(lBOther)
            if (iface === undefined || iA === undefined || iB === undefined) {
                throw new Error(`mesh-kernel: inset has no stored interpolation data for face ${es.l.f.id}`)
            }
            blockReplace(iface.cloneLoops[iA], lB, bm.ldata)
            blockReplace(iface.cloneLoops[iB], lA, bm.ldata)

            /* Blender follows this with `bm_loop_customdata_merge` under
             * `USE_LOOP_CUSTOMDATA_MERGE`; see `InsetOptions.useInterpolate` for why that pass is
             * not here. */
        } else {
            loopAttrsCopy(bm, lAOther, lB)
            loopAttrsCopy(bm, lBOther, lA)
        }
    }

    // Cheap feature to add depth to the inset.
    if (depth !== 0) {
        // We need to re-calculate tagged normals, but for this purpose we can copy tagged verts from
        // the faces they inset from.
        for (const es of edgeInfo) {
            es.eNew.v1.nx = 0; es.eNew.v1.ny = 0; es.eNew.v1.nz = 0
            es.eNew.v2.nx = 0; es.eNew.v2.ny = 0; es.eNew.v2.nz = 0
        }
        for (const es of edgeInfo) {
            const f = es.l.f
            for (const v of [es.eNew.v1, es.eNew.v2]) {
                v.nx += f.nx
                v.ny += f.ny
                v.nz += f.nz
            }
        }
        for (const es of edgeInfo) {
            for (const v of [es.eNew.v1, es.eNew.v2]) {
                // Annoying, avoid normalizing twice.
                const lenSq = v.nx * v.nx + v.ny * v.ny + v.nz * v.nz
                if (lenSq !== 1) {
                    const len = Math.sqrt(lenSq)
                    if (len !== 0) {
                        v.nx /= len
                        v.ny /= len
                        v.nz /= len
                    }
                }
            }
        }
        /* done correcting edge verts normals */

        // Untag verts.
        for (const v of bm.verts) v.hflag &= ~ElemFlag.Tag

        // Tag face verts. Note this is the *input* faces, which after the inset are the smaller ones
        // - and under `useOutset` they are the untagged ones, which is deliberate: outset still
        // pushes the selected faces along their normals.
        for (const f of faces) {
            for (const l of f.eachLoop()) {
                l.v.hflag |= ElemFlag.Tag
                l.e!.hflag |= ElemFlag.Tag
            }
        }

        // Do this in 2 passes so moving the verts doesn't feed back into the face angle checks that
        // `BM_vert_calc_shell_factor` uses.
        const varrCo = new Map<BMVert, Vec3>()
        const fallback: FallbackState = {vertLengths: null}

        for (const v of bm.verts) {
            if (!(v.hflag & ElemFlag.Tag)) continue
            const fac = depth
                * (useRelativeOffset
                    ? edgeInfoAverageLengthWithFallback(v, edgeInfo, edgeIndex, bm, fallback)
                    : 1)
                * (useEvenBoundary ? vertCalcShellFactor(v) : 1)
            varrCo.set(v, [v.x + v.nx * fac, v.y + v.ny * fac, v.z + v.nz * fac])
        }

        for (const [v, c] of varrCo) v.setCo(c[0], c[1], c[2])
    }

    const {verts, edges} = created.collect(bm)
    if (options.selectResult) finishSelection(bm, faces)

    return {faces: newFaces, verts, edges}
}

/**
 * Inset whatever is selected, the editor-facing entry point in the shape of `extrudeSelection`.
 *
 * Returns null when no face is selected. Blender's `MESH_OT_inset` is face-only: unlike extrude there
 * is no edge fallback, because an inset of an edge is not defined.
 */
export function insetSelection(bm: BMesh, opts: InsetOptions = {}): InsetResult | null {
    const faces = [...bm.faces].filter(f => f.hflag & ElemFlag.Select)
    if (!faces.length) return null
    return insetRegion(bm, faces, opts)
}

// endregion

/**
 * Bisect: cut geometry in two along a plane, optionally removing one side.
 *
 * Ported from Blender:
 * - `source/blender/bmesh/tools/bmesh_bisect_plane.cc` - `BM_mesh_bisect_plane` and
 *   `bm_face_bisect_verts`, the cut itself;
 * - `source/blender/bmesh/operators/bmo_bisect_plane.cc` - `bmo_bisect_plane_exec`, the `bisect_plane`
 *   operator: input tagging, `clear_inner` / `clear_outer`, the `geom.out` / `geom_cut.out` slots;
 * - `source/blender/editors/mesh/editmesh_bisect.cc` - `mesh_bisect_exec`, the edit-mode operator on
 *   top: the selection is the input, the cut is selected afterwards, `use_fill` closes the cut with
 *   `triangle_fill` + `face_attribute_fill`.
 *
 * Blender keeps the per-vertex scratch values (`BM_VERT_DIR`, `BM_VERT_SKIP`, `BM_VERT_DIST`,
 * `BM_VERT_SORTVAL`, `BM_VERT_LOOPINDEX`) in `head.index` and `no`; here they live in maps private to
 * one call. The operator flags (`ELE_NEW`, `ELE_CUT`, `ELE_INPUT`) are sets. `BM_ELEM_TAG` is the
 * kernel's {@link ElemFlag.Tag}, used exactly as Blender uses it (on edges: "can be cut"; on faces:
 * cleared = "in the stack"; on verts: "centred and its faces queued").
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {ElemFlag} from '../constants'
import {splitEdgeMakeVert, splitFaceMakeEdge} from '../bmesh/euler'
import {diskEdges, radialLoops} from '../bmesh/structure'
import {faceVertShareLoop} from '../bmesh/walkers'
import {faceNormalUpdate} from '../bmesh/polygon'
import {edgeSelectSet, faceSelectSet, selectFlush, selectNone, vertSelectSet} from '../bmesh/marking'
import {Vec3} from '../math'

/** A plane as `[a, b, c, d]`: points `p` with `a*x + b*y + c*z + d = 0`. Blender's `float plane[4]`. */
export type Plane4 = [number, number, number, number]

/** `plane_from_point_normal_v3` (`math_geom.cc`). The normal is used as given, not normalised. */
export function planeFromPointNormal(co: Vec3, no: Vec3): Plane4 {
    return [no[0], no[1], no[2], -(no[0] * co[0] + no[1] * co[1] + no[2] * co[2])]
}

/** `plane_point_side_v3`: signed distance, scaled by the length of the plane's normal. */
function planePointSide(plane: Plane4, v: BMVert): number {
    return plane[0] * v.x + plane[1] * v.y + plane[2] * v.z + plane[3]
}

/** `plane_point_test_v3` (`bmesh_bisect_plane.cc:41`). */
function planePointTest(plane: Plane4, v: BMVert, eps: number): {side: number, depth: number} {
    const f = planePointSide(plane, v)
    if (f <= -eps) return {side: -1, depth: f}
    if (f >= eps) return {side: 1, depth: f}
    return {side: 0, depth: f}
}

/** `closest_to_plane_v3`: move `v` onto the plane. */
function closestToPlane(plane: Plane4, v: BMVert): void {
    const lenSq = plane[0] * plane[0] + plane[1] * plane[1] + plane[2] * plane[2]
    const side = planePointSide(plane, v)
    const fac = side / lenSq
    v.x -= plane[0] * fac
    v.y -= plane[1] * fac
    v.z -= plane[2] * fac
}

/** `BM_loop_is_adjacent`. */
function loopIsAdjacent(a: BMLoop, b: BMLoop): boolean {
    return a.next === b || a.prev === b
}

/** Output flags of {@link meshBisectPlane}: Blender's `oflag_center` / `oflag_new` operator flags. */
export interface BisectFlags {
    /** `oflag_center` (`ELE_CUT` in the operator): verts on the plane and edges lying in it. */
    center: Set<BMVert | BMEdge>
    /** `oflag_new` (`ELE_NEW`): verts, edges and faces the cut created. */
    newElems: Set<BMVert | BMEdge | BMFace>
}

/** Scratch state for one bisect: Blender's `head.index` / `no` abuse, as maps. */
interface VertScratch {
    dir: Map<BMVert, number>
    skip: Map<BMVert, boolean>
    dist: Map<BMVert, number>
    sortval: Map<BMVert, number>
    loopIndex: Map<BMVert, number>
}

const isCenter = (v: BMVert) => (v.hflag & ElemFlag.Tag) !== 0
const setCenter = (v: BMVert, on: boolean) => { if (on) v.hflag |= ElemFlag.Tag; else v.hflag &= ~ElemFlag.Tag }
const edgeIsCut = (e: BMEdge) => (e.hflag & ElemFlag.Tag) !== 0
/** `face_in_stack_test`: a face is "in the stack" when its tag is *cleared*. */
const faceInStack = (f: BMFace) => (f.hflag & ElemFlag.Tag) === 0
const faceInStackEnable = (f: BMFace) => { f.hflag &= ~ElemFlag.Tag }
const faceInStackDisable = (f: BMFace) => { f.hflag |= ElemFlag.Tag }

/**
 * `BM_face_split(bm, f, l_a, l_b, &l_new, nullptr, true)` (`bmesh_mods.cc:207`) without the multires
 * branch (no `CD_MDISPS` here). Returns the new face and `l_new` (`l_f2`, the new edge's loop in the
 * new face), or null for adjacent loops.
 */
function faceSplit(bm: BMesh, f: BMFace, la: BMLoop, lb: BMLoop): {fNew: BMFace, lNew: BMLoop} | null {
    if (loopIsAdjacent(la, lb) || f !== la.f || f !== lb.f) return null
    const {fNew, lNew} = splitFaceMakeEdge(bm, f, la, lb, undefined, true)
    return {fNew, lNew}
}

/** `bm_face_bisect_verts` (`bmesh_bisect_plane.cc:138`). */
function faceBisectVerts(bm: BMesh, f: BMFace, plane: Plane4, s: VertScratch, flags: BisectFlags): void {
    const fLenOrig = f.len
    const vertSplitArr: BMVert[] = []
    const useDirs = [false, false, false]
    let isInside = false
    let faceHasCenterEdge = false

    const lFirst = f.lFirst
    let lIter = lFirst
    do {
        if (isCenter(lIter.v)) {
            // If both are -1 or 1, or both are zero: don't flip 'inside' var while walking.
            s.skip.set(lIter.v, ((s.dir.get(lIter.prev.v) ?? 0) ^ (s.dir.get(lIter.next.v) ?? 0)) === 0)
            vertSplitArr.push(lIter.v)
            if (!faceHasCenterEdge && isCenter(lIter.prev.v)) faceHasCenterEdge = true
        }
        useDirs[(s.dir.get(lIter.v) ?? 0) + 1] = true
    } while ((lIter = lIter.next) !== lFirst)

    if (!(vertSplitArr.length > 1 && useDirs[0] && useDirs[2])) return

    if (vertSplitArr.length === 2) {
        const la = faceVertShareLoop(f, vertSplitArr[0])!
        const lb = faceVertShareLoop(f, vertSplitArr[1])!
        // Common case, just cut the face once.
        const r = faceSplit(bm, f, la, lb)
        if (r) {
            flags.center.add(r.lNew.e!)
            flags.newElems.add(r.lNew.e!)
            flags.newElems.add(r.lNew.f)
        }
        return
    }

    // Less common case: work out how to make several cuts. (`:198`)
    if (faceHasCenterEdge) {
        let i = 0
        lIter = lFirst
        do {
            s.loopIndex.set(lIter.v, i++)
        } while ((lIter = lIter.next) !== lFirst)

        // Start on a non-centred vertex so a span of centred vertices can be walked forwards only.
        let lFirstNonCenter = lFirst
        while (isCenter(lFirstNonCenter.v)) lFirstNonCenter = lFirstNonCenter.next

        lIter = lFirstNonCenter
        do {
            if (s.skip.get(lIter.v)) continue
            if (!(isCenter(lIter.v) && isCenter(lIter.next.v))) continue
            const lPrev = lIter.prev
            let lNext = lIter.next.next
            while (isCenter(lNext.v)) lNext = lNext.next
            // Skip all vertices when the edges at either end of the span are on the same side.
            if (!((s.dir.get(lPrev.v) ?? 0) ^ (s.dir.get(lNext.v) ?? 0))) {
                lIter = lPrev.next
                while (lIter !== lNext) {
                    s.skip.set(lIter.v, true)
                    lIter = lIter.next
                }
            }
            // Step over the span already handled, even if skip wasn't set.
            lIter = lNext.prev
        } while ((lIter = lIter.next) !== lFirstNonCenter)
    }

    // The direction to sort verts in across the face (`:262`). Either sign works.
    let sortDir: Vec3 = [
        f.ny * plane[2] - f.nz * plane[1],
        f.nz * plane[0] - f.nx * plane[2],
        f.nx * plane[1] - f.ny * plane[0],
    ]
    let len = Math.hypot(sortDir[0], sortDir[1], sortDir[2])
    if (len === 0) {
        // Find any 2 verts and use their direction. (`:270`; Blender keeps looping after a match.)
        let i = 0
        for (i = 0; i < vertSplitArr.length; i++) {
            const a = vertSplitArr[0], b = vertSplitArr[i]
            if (!(a.x === b.x && a.y === b.y && a.z === b.z)) {
                sortDir = [a.x - b.x, a.y - b.y, a.z - b.z]
                const l = Math.hypot(sortDir[0], sortDir[1], sortDir[2])
                if (l) sortDir = [sortDir[0] / l, sortDir[1] / l, sortDir[2] / l]
            }
        }
        // Blender's bail-out (`:277`): `i` always ends at the stack size here, so it always bails.
        if (i === vertSplitArr.length) return
    } else {
        sortDir = [sortDir[0] / len, sortDir[1] / len, sortDir[2] / len]
    }

    // Sort the verts across the face from one side to the other.
    for (const v of vertSplitArr) s.sortval.set(v, sortDir[0] * v.x + sortDir[1] * v.y + sortDir[2] * v.z)
    // `std::sort` with a strict `<`; ties are left to the sort, here kept stable.
    vertSplitArr.sort((a, b) => s.sortval.get(a)! - s.sortval.get(b)!)

    // Split the face across the sorted splits. Which face gets which split is unknown, so all of the
    // faces made so far are searched for the vert pair (`:299`).
    const faceSplitArr: BMFace[] = [f]
    for (let i = 0; i < vertSplitArr.length - 1; i++) {
        const va = vertSplitArr[i]
        const vb = vertSplitArr[i + 1]
        if (faceHasCenterEdge) {
            // `vert_pair_adjacent_in_orig_face`
            const delta = Math.abs(s.loopIndex.get(va)! - s.loopIndex.get(vb)!)
            if (delta === 1 || delta === fLenOrig - 1) continue
        }
        if (!s.skip.get(va)) isInside = !isInside
        if (!isInside) continue

        let la: BMLoop | null = null
        let lb: BMLoop | null = null
        let found = false
        let j = 0
        for (j = 0; j < faceSplitArr.length; j++) {
            la = faceVertShareLoop(faceSplitArr[j], va)
            lb = la ? faceVertShareLoop(faceSplitArr[j], vb) : null
            if (la && lb) {
                found = true
                break
            }
        }
        // Ideally won't happen, but it can for self-intersecting faces.
        if (found && !loopIsAdjacent(la!, lb!)) {
            const r = faceSplit(bm, faceSplitArr[j], la!, lb!)
            if (r) {
                flags.center.add(r.lNew.e!)
                flags.newElems.add(r.lNew.e!)
                flags.newElems.add(r.lNew.f)
                if (r.fNew !== faceSplitArr[j]) faceSplitArr.push(r.fNew)
            }
        }
    }
}

/**
 * `BM_mesh_bisect_plane` (`bmesh_bisect_plane.cc:380`).
 *
 * With `useTag`, only edges tagged {@link ElemFlag.Tag} are cut and only faces tagged are split (the
 * caller sets both, as `bmo_bisect_plane_exec` does). Face normals must be current.
 */
export function meshBisectPlane(
    bm: BMesh, plane: Plane4, useSnapCenter: boolean, useTag: boolean, eps: number,
): BisectFlags {
    const flags: BisectFlags = {center: new Set(), newElems: new Set()}
    const s: VertScratch = {dir: new Map(), skip: new Map(), dist: new Map(), sortval: new Map(), loopIndex: new Map()}
    const edgesArr: BMEdge[] = []

    if (useTag) {
        // Flush edge tags to verts. Face tags are set by the caller.
        for (const v of bm.verts) v.hflag &= ~ElemFlag.Tag
        for (const e of bm.edges) {
            if (edgeIsCut(e)) {
                edgesArr.push(e)
                e.v1.hflag |= ElemFlag.Tag
                e.v2.hflag |= ElemFlag.Tag
            }
        }
    } else {
        for (const e of bm.edges) {
            e.hflag |= ElemFlag.Tag
            edgesArr.push(e)
        }
        for (const f of bm.faces) faceInStackDisable(f)
    }

    for (const v of bm.verts) {
        if (useTag && !(v.hflag & ElemFlag.Tag)) {
            setCenter(v, false)
            // These should never be accessed.
            s.dir.set(v, 0)
            s.dist.set(v, 0)
            continue
        }
        setCenter(v, false)
        const t = planePointTest(plane, v, eps)
        s.dir.set(v, t.side)
        s.dist.set(v, t.depth)
        if (t.side === 0) {
            flags.center.add(v)
            if (useSnapCenter) closestToPlane(plane, v)
        }
    }

    // A stack of faces to be evaluated for splitting (`BLI_LINKSTACK`, LIFO).
    const faceStack: BMFace[] = []

    for (const e of edgesArr) {
        const side = [s.dir.get(e.v1) ?? 0, s.dir.get(e.v2) ?? 0]
        const dist = [s.dist.get(e.v1) ?? 0, s.dist.get(e.v2) ?? 0]

        if (side[0] && side[1] && side[0] !== side[1]) {
            const eFac = dist[0] / (dist[0] - dist[1])
            if (e.l) {
                for (const l of radialLoops(e)) {
                    if (!faceInStack(l.f)) {
                        faceInStackEnable(l.f)
                        faceStack.push(l.f)
                    }
                }
            }
            // `BM_edge_split(bm, e, e->v1, &e_new, e_fac)`.
            const {vNew, eNew} = splitEdgeMakeVert(bm, e, e.v1, eFac)
            flags.newElems.add(eNew)
            setCenter(vNew, true)
            flags.newElems.add(vNew)
            flags.center.add(vNew)
            s.dir.set(vNew, 0)
            s.dist.set(vNew, 0)
        } else if (side[0] === 0 || side[1] === 0) {
            // Either vert on the plane: tag it and push every face using it.
            const ev = [e.v1, e.v2]
            for (let j = 0; j < 2; j++) {
                if (side[j] !== 0) continue
                const v = ev[j]
                if (isCenter(v)) continue
                setCenter(v, true)
                for (const l of loopsOfVertInDiskOrder(v)) {
                    if (!faceInStack(l.f)) {
                        faceInStackEnable(l.f)
                        faceStack.push(l.f)
                    }
                }
            }
            // If both verts are on the plane, the edge lies in it.
            if (side[0] === 0 && side[1] === 0) flags.center.add(e)
        }
    }

    let f: BMFace | undefined
    while ((f = faceStack.pop())) faceBisectVerts(bm, f, plane, s, flags)

    return flags
}

/**
 * `BM_LOOPS_OF_VERT` in Blender's iteration order (`bmesh_iterators.cc`, `bmiter__loop_of_vert_*`):
 * the disk cycle from `v->e`, and around each edge the radial cycle from `e->l`, yielding the loops
 * whose `v` is `v`.
 */
function* loopsOfVertInDiskOrder(v: BMVert): Generator<BMLoop> {
    for (const e of [...diskEdges(v)]) {
        if (!e.l) continue
        for (const l of [...radialLoops(e)]) if (l.v === v) yield l
    }
}

/** Options of {@link bisectPlane}: Blender's `bisect_plane` operator slots. */
export interface BisectPlaneOptions {
    /** A point on the plane, in the mesh's own space. */
    planeCo: Vec3
    /** The plane's normal, in the mesh's own space. Not normalised by Blender; `dist` scales with it. */
    planeNo: Vec3
    /** `dist`: vertices this close to the plane count as on it. Blender's operator default is 0.0001. */
    dist?: number
    /** Snap vertices within `dist` onto the plane. */
    useSnapCenter?: boolean
    /** Remove geometry in front of the plane (the side the normal points to). */
    clearOuter?: boolean
    /** Remove geometry behind the plane. */
    clearInner?: boolean
}

export interface BisectPlaneResult {
    /** `geom.out`: input and new geometry that survived. */
    geom: (BMVert | BMEdge | BMFace)[]
    /** `geom_cut.out`: the verts and edges on the plane. */
    geomCut: (BMVert | BMEdge)[]
}

/**
 * The `bisect_plane` operator, `bmo_bisect_plane_exec` (`bmo_bisect_plane.cc:28`), over `geom`.
 *
 * Face normals must be current, as they are in edit mode (`bm_face_bisect_verts` asserts it).
 */
export function bisectPlane(bm: BMesh, geom: Iterable<BMVert | BMEdge | BMFace>, opts: BisectPlaneOptions): BisectPlaneResult {
    const dist = opts.dist ?? 0
    const {planeCo, planeNo} = opts
    if (planeNo[0] === 0 && planeNo[1] === 0 && planeNo[2] === 0) throw new Error('mesh-kernel: bisect: zero normal given')
    const plane = planeFromPointNormal(planeCo, planeNo)

    const input = new Set<BMVert | BMEdge | BMFace>()
    const inputVerts: BMVert[] = []
    // Tag the geometry to bisect.
    for (const e of bm.edges) e.hflag &= ~ElemFlag.Tag
    for (const f of bm.faces) f.hflag &= ~ElemFlag.Tag
    for (const el of geom) {
        if (input.has(el)) continue
        input.add(el)
        if (el instanceof BMVert) inputVerts.push(el)
        else el.hflag |= ElemFlag.Tag
    }

    const flags = meshBisectPlane(bm, plane, !!opts.useSnapCenter, true, dist)

    if (opts.clearOuter || opts.clearInner) {
        // An array of verts, since `geom` holds both verts and the edges that use them (`:58`).
        const planeOuter: Plane4 = [plane[0], plane[1], plane[2], plane[3] - dist]
        const planeInner: Plane4 = [plane[0], plane[1], plane[2], plane[3] + dist]
        const vertArr: BMVert[] = []
        for (const v of inputVerts) {
            if ((opts.clearOuter && planePointSide(planeOuter, v) > 0) || (opts.clearInner && planePointSide(planeInner, v) < 0)) {
                vertArr.push(v)
            }
        }
        let v: BMVert | undefined
        while ((v = vertArr.pop())) bm.vertKill(v)
    }

    // `BMO_slot_buffer_from_enabled_flag` walks the mesh in element order: verts, edges, faces.
    const alive = (el: BMVert | BMEdge | BMFace) => el instanceof BMVert ? bm.verts.has(el) : el instanceof BMEdge ? bm.edges.has(el) : bm.faces.has(el)
    const flagged = (el: BMVert | BMEdge | BMFace) => (flags.newElems.has(el) || input.has(el)) && alive(el)
    const geomOut: (BMVert | BMEdge | BMFace)[] = [
        ...[...bm.verts].filter(flagged), ...[...bm.edges].filter(flagged), ...[...bm.faces].filter(flagged),
    ]
    const geomCut: (BMVert | BMEdge)[] = [
        ...[...bm.verts].filter(v => flags.center.has(v)), ...[...bm.edges].filter(e => flags.center.has(e)),
    ]
    return {geom: geomOut, geomCut}
}

/** Options of {@link bisectSelection}: Blender's `MESH_OT_bisect` properties. */
export interface BisectSelectionOptions {
    planeCo: Vec3
    planeNo: Vec3
    /** `use_fill`: close the cut with a face. Needs `fill` (the `triangle_fill` port). */
    useFill?: boolean
    clearInner?: boolean
    clearOuter?: boolean
    /** `threshold`, default 0.0001. */
    threshold?: number
}

/** The fill step of `mesh_bisect_exec`: `triangle_fill` then `face_attribute_fill`, returning the new faces. */
export type BisectFillFn = (bm: BMesh, edges: BMEdge[], normal: Vec3) => BMFace[]

/**
 * Edit-mode bisect, `mesh_bisect_exec` (`editmesh_bisect.cc:232`) for one mesh, with the plane already
 * in the mesh's space: the selected verts, edges and faces are the input; afterwards the cut is
 * selected (and the fill faces, with `useFill`). Returns false when nothing was selected, as Blender
 * skips a mesh with `totedgesel == 0`.
 *
 * `fill` performs `triangle_fill edges=geom_cut.out normal=normalize(plane_no) use_dissolve=true` and
 * `face_attribute_fill use_normals=true use_data=true` (`:345-374`).
 */
export function bisectSelection(bm: BMesh, opts: BisectSelectionOptions, fill?: BisectFillFn): BisectPlaneResult | null {
    if (bm.totedgesel === 0) return null
    const geom: (BMVert | BMEdge | BMFace)[] = []
    for (const v of bm.verts) if (v.hflag & ElemFlag.Select) geom.push(v)
    for (const e of bm.edges) if (e.hflag & ElemFlag.Select) geom.push(e)
    for (const f of bm.faces) if (f.hflag & ElemFlag.Select) geom.push(f)
    // Edit mode keeps face normals current; the cut sorts multi-split n-gons by them.
    for (const f of bm.faces) faceNormalUpdate(f)

    const result = bisectPlane(bm, geom, {
        planeCo: opts.planeCo, planeNo: opts.planeNo,
        dist: opts.threshold ?? 0.0001,
        clearInner: opts.clearInner, clearOuter: opts.clearOuter,
    })

    selectNone(bm)

    if (opts.useFill) {
        if (!fill) throw new Error('mesh-kernel: bisect use_fill needs a fill function (triangle_fill)')
        const n = opts.planeNo
        const l = Math.hypot(n[0], n[1], n[2])
        const normalFill: Vec3 = l ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 0]
        const faces = fill(bm, result.geomCut.filter((e): e is BMEdge => e instanceof BMEdge && bm.edges.has(e)), normalFill)
        for (const f of faces) if (bm.faces.has(f)) faceSelectSet(bm, f, true)
    }

    for (const el of result.geomCut) {
        if (el instanceof BMVert) { if (bm.verts.has(el)) vertSelectSet(bm, el, true) }
        else if (bm.edges.has(el)) edgeSelectSet(bm, el, true)
    }
    selectFlush(bm)
    return result
}

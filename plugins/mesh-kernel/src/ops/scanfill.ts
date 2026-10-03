/**
 * Scan-fill: triangulate one or more 2D/3D polygons, with hole support, by a sweep line.
 *
 * A line-for-line port of `source/blender/blenlib/intern/scanfill.cc` (Blender main) and its header
 * `blenlib/BLI_scanfill.h`. Blender uses it to tessellate curves, fonts and `bmesh.ops.triangle_fill`
 * (F in edit mode on a closed edge loop). Line references are to `scanfill.cc` unless stated.
 *
 * Everything that decides the output order or the triangle winding is kept as Blender has it:
 * - The three `ListBase` lists (`fillvertbase`, `filledgebase`, `fillfacebase`) and the per-vertex
 *   edge lists of the sweep (`ScanFillVertLink`, which Blender casts to a `ListBase`) are intrusive
 *   doubly linked lists here too, mutated with ports of `BLI_addtail`, `BLI_remlink`,
 *   `BLI_insertlinkbefore` and `BLI_movelisttolist` (`blenlib/intern/listbase.cc`) that keep their
 *   exact pointer semantics - including that `BLI_remlink` leaves the removed link's own
 *   `next`/`prev` untouched.
 * - `qsort` with `vergscdata` (`:81`). `vergscdata` returns 0 for two distinct vertices with the same
 *   projected position, so C `qsort`'s instability could matter. The Blender this is verified against
 *   (3.4.1 on Debian, glibc 2.36) gets glibc's `qsort`, which is a merge sort - stable - whenever it
 *   can allocate its scratch buffer (always, at these sizes). `Array.prototype.sort` is stable too, so
 *   the two agree. A Blender linked against an unstable `qsort` (macOS libc) could order coincident
 *   vertices differently; that is the only possible divergence and it needs coincident vertices.
 * - `bsearch` (`:335`) is glibc's algorithm (`bits/stdlib-bsearch.h`): halve `[l, u)` and return the
 *   first probe that compares equal. With coincident vertices which equal element is hit depends on
 *   the probe sequence, so it is reproduced rather than replaced with a `Map` lookup.
 * - `edge_count` is a `uchar` in Blender (`BLI_scanfill.h:59`); increments and decrements wrap at
 *   8 bits here as well.
 *
 * Numerics: Blender computes in `float`, this port in doubles. That is accepted kernel-wide; it can
 * only matter for inputs whose float32 projections tie where the doubles do not (or vice versa).
 * The epsilon constants are rounded to float32 so the thresholds themselves are Blender's.
 *
 * Not ported: `BLI_SCANFILL_CALC_REMOVE_DOUBLES` (STEP 0 at `:478` and the zero-length edge chase at
 * `:525`). Its only callers are curve/font filling; `bmo_triangle_fill_exec` passes
 * `HOLES | POLYS | LOOSE`, so it is unreachable from the mesh kernel. Passing the flag throws rather
 * than silently ignoring it. `BLI_scanfill_calc_self_isect` (`scanfill_utils.cc`) is likewise not
 * ported; nothing here calls it.
 *
 * Blender main vs 3.4.1 (`blenlib/intern/scanfill.c`, what the installed Blender runs): the only
 * logic difference is STEP 4, the hole/bound join - see {@link scanfillCalcEx}.
 */

import type {Vec3} from '../math'

// region BLI_scanfill.h

/**
 * `BLI_scanfill_calc` flags (`BLI_scanfill.h:89-104`).
 */
export const ScanFillFlag = {
    /** Merge zero-length edges. Not ported - see the module note. */
    RemoveDoubles: 1 << 1,
    /** Calculate isolated polygons (connectivity), instead of treating everything as one. */
    Polys: 1 << 2,
    /** Detect holes: polygons whose bounds touch are filled together. */
    Holes: 1 << 3,
    /** Remove loose edges and edge strings before filling. */
    Loose: 1 << 4,
} as const

/** `SF_POLY_UNSET` (`BLI_scanfill.h:41`): `(unsigned short)-1`. */
const SF_POLY_UNSET = 0xffff

/** Intrusive doubly linked list, Blender's `ListBase` / `ListBaseT<T>`. */
export interface ScanFillListBase<T extends ScanFillLink<T>> {
    first: T | null
    last: T | null
}

export interface ScanFillLink<T> {
    next: T | null
    prev: T | null
}

/** `ScanFillVert` (`BLI_scanfill.h:43`). */
export class ScanFillVert implements ScanFillLink<ScanFillVert> {
    next: ScanFillVert | null = null
    prev: ScanFillVert | null = null
    /**
     * `tmp` union. `tmp.v` is only used by the not-ported REMOVE_DOUBLES path; callers store their own
     * element in `tmp.p` (triangle fill keeps the `BMVert` there).
     */
    tmpV: ScanFillVert | null = null
    tmpP: unknown = null
    /** Vertex location. */
    co: Vec3
    /** 2D projection of the location. */
    xy: [number, number] = [0, 0]
    /** Free for callers to match results with their own data. */
    keyindex = 0
    /** `ushort poly_nr`. */
    polyNr: number
    /** `uchar edge_count`: number of edges using this vertex. Wraps at 8 bits. */
    edgeCount = 0
    /** Vertex status, `SF_VERT_*`. */
    f = SF_VERT_NEW
    /** Flag callers can use as they like. */
    userFlag = 0

    constructor(co: Vec3, polyNr: number) {
        this.co = co
        this.polyNr = polyNr
    }
}

/** `ScanFillEdge` (`BLI_scanfill.h:66`). */
export class ScanFillEdge implements ScanFillLink<ScanFillEdge> {
    next: ScanFillEdge | null = null
    prev: ScanFillEdge | null = null
    v1: ScanFillVert
    v2: ScanFillVert
    /** `ushort poly_nr`. */
    polyNr: number
    /** Edge status, `SF_EDGE_*`. */
    f = SF_EDGE_NEW
    userFlag = 0
    /** `tmp.c`. */
    tmpC = 0

    constructor(v1: ScanFillVert, v2: ScanFillVert, polyNr: number) {
        this.v1 = v1
        this.v2 = v2
        this.polyNr = polyNr
    }
}

/** `ScanFillFace` (`BLI_scanfill.h:77`): one output triangle. */
export class ScanFillFace implements ScanFillLink<ScanFillFace> {
    next: ScanFillFace | null = null
    prev: ScanFillFace | null = null
    v1: ScanFillVert
    v2: ScanFillVert
    v3: ScanFillVert

    constructor(v1: ScanFillVert, v2: ScanFillVert, v3: ScanFillVert) {
        this.v1 = v1
        this.v2 = v2
        this.v3 = v3
    }
}

/** `ScanFillContext` (`BLI_scanfill.h:21`). The memory arena has no equivalent; the GC owns it. */
export interface ScanFillContext {
    fillvertbase: ScanFillListBase<ScanFillVert>
    filledgebase: ScanFillListBase<ScanFillEdge>
    fillfacebase: ScanFillListBase<ScanFillFace>
    /**
     * `ushort poly_nr`. Callers may increment it before adding each curve to skip the connectivity
     * pass; {@link scanfillBegin} sets it to `SF_POLY_UNSET` so the first increment wraps to 0.
     */
    polyNr: number
}

// endregion

// region local types and constants (scanfill.cc:44-77)

/** `PolyFill` (`:44`). */
interface PolyFill {
    edges: number
    verts: number
    minXy: [number, number]
    maxXy: [number, number]
    nr: number
    f: number
}

/**
 * `ScanFillVertLink` (`:51`). Blender casts `&sc->edge_first` to a `ListBase *`, so `edge_first` /
 * `edge_last` are named `first` / `last` here and the link is itself the edge list.
 */
interface ScanFillVertLink extends ScanFillListBase<ScanFillEdge> {
    vert: ScanFillVert
}

/** `SF_EPSILON 0.00003f` (`:60`), as the float32 constant Blender compares against. */
const SF_EPSILON = Math.fround(0.00003)
/** `SF_EPSILON_SQ` (`:61`), a float product in C. */
const SF_EPSILON_SQ = Math.fround(SF_EPSILON * SF_EPSILON)

/** `ScanFillVert::f` (`:64-66`). */
const SF_VERT_NEW = 0
const SF_VERT_AVAILABLE = 1
const SF_VERT_ZERO_LEN = 2

/** `ScanFillEdge::f` (`:71-73`). */
const SF_EDGE_NEW = 0
const SF_EDGE_INTERNAL = 2

/** `PolyFill::f` (`:76-77`). */
const SF_POLY_NEW = 0
const SF_POLY_VALID = 1

/** `FLT_EPSILON`. */
const FLT_EPSILON = 1.1920928955078125e-7

/** `uchar` increment/decrement. */
const u8 = (x: number): number => x & 0xff

// endregion

// region listbase.cc

/** `BLI_addtail` (`listbase.cc:118`). */
function addtail<T extends ScanFillLink<T>>(lb: ScanFillListBase<T>, link: T): void {
    link.next = null
    link.prev = lb.last
    if (lb.last) lb.last.next = link
    if (lb.first === null) lb.first = link
    lb.last = link
}

/** `BLI_remlink` (`listbase.cc:138`). Leaves `link.next`/`link.prev` as they were, as Blender does. */
function remlink<T extends ScanFillLink<T>>(lb: ScanFillListBase<T>, link: T): void {
    if (link.next) link.next.prev = link.prev
    if (link.prev) link.prev.next = link.next
    if (lb.last === link) lb.last = link.prev
    if (lb.first === link) lb.first = link.next
}

/** `BLI_insertlinkbefore` (`listbase.cc:378`): `newlink` before `nextlink`. */
function insertlinkbefore<T extends ScanFillLink<T>>(lb: ScanFillListBase<T>, nextlink: T | null, newlink: T): void {
    /* empty list */
    if (lb.first === null) {
        lb.first = newlink
        lb.last = newlink
        return
    }
    /* insert at end of list */
    if (nextlink === null) {
        newlink.prev = lb.last
        newlink.next = null
        lb.last!.next = newlink
        lb.last = newlink
        return
    }
    /* at beginning of list */
    if (lb.first === nextlink) lb.first = newlink

    newlink.next = nextlink
    newlink.prev = nextlink.prev
    nextlink.prev = newlink
    if (newlink.prev) newlink.prev.next = newlink
}

/** `BLI_movelisttolist` (`listbase.cc:32`): append all of `src` to `dst`, leaving `src` empty. */
function movelisttolist<T extends ScanFillLink<T>>(dst: ScanFillListBase<T>, src: ScanFillListBase<T>): void {
    if (src.first === null) return
    if (dst.first === null) {
        dst.first = src.first
        dst.last = src.last
    } else {
        dst.last!.next = src.first
        src.first.prev = dst.last
        dst.last = src.last
    }
    src.first = src.last = null
}

// endregion

// region math helpers (blenlib/intern/math_*.cc), module-private

/** `normalize_v3` (`math_vector_inline.cc:872`), in place; returns the original length or 0. */
function normalizeV3(n: Vec3): number {
    let d = n[0] * n[0] + n[1] * n[1] + n[2] * n[2]
    if (d > 1.0e-35) {
        d = Math.sqrt(d)
        const s = 1.0 / d
        n[0] *= s
        n[1] *= s
        n[2] *= s
    } else {
        n[0] = n[1] = n[2] = 0
        d = 0
    }
    return d
}

/** `normalize_v2` (`math_vector_inline.cc:841`), into `r`. */
function normalizeV2(r: [number, number], a: readonly [number, number]): number {
    let d = a[0] * a[0] + a[1] * a[1]
    if (d > 1.0e-35) {
        d = Math.sqrt(d)
        const s = 1.0 / d
        r[0] = a[0] * s
        r[1] = a[1] * s
    } else {
        r[0] = r[1] = 0
        d = 0
    }
    return d
}

/** `compare_ff` (`math_base_inline.cc:416`). */
const compareFF = (a: number, b: number, maxDiff: number): boolean => Math.abs(a - b) <= maxDiff

/** `compare_v2v2` (`math_vector_inline.cc:1015`). */
const compareV2V2 = (a: readonly number[], b: readonly number[], limit: number): boolean =>
    compareFF(a[0], b[0], limit) && compareFF(a[1], b[1], limit)

/** `compare_v3v3` (`math_vector_inline.cc:1020`). */
const compareV3V3 = (a: readonly number[], b: readonly number[], limit: number): boolean =>
    compareFF(a[0], b[0], limit) && compareFF(a[1], b[1], limit) && compareFF(a[2], b[2], limit)

/** `add_newell_cross_v3_v3v3` (`math_vector_inline.cc:700`). */
function addNewellCrossV3V3V3(n: Vec3, vPrev: Vec3, vCurr: Vec3): void {
    n[0] += (vPrev[1] - vCurr[1]) * (vPrev[2] + vCurr[2])
    n[1] += (vPrev[2] - vCurr[2]) * (vPrev[0] + vCurr[0])
    n[2] += (vPrev[0] - vCurr[0]) * (vPrev[1] + vCurr[1])
}

/** `ortho_basis_v3v3_v3` (`math_vector.cc:568`). */
function orthoBasisV3V3V3(rN1: Vec3, rN2: Vec3, n: Vec3): void {
    const eps = FLT_EPSILON
    const f = n[0] * n[0] + n[1] * n[1]
    if (f > eps) {
        const d = 1.0 / Math.sqrt(f)
        rN1[0] = n[1] * d
        rN1[1] = -n[0] * d
        rN1[2] = 0.0
        rN2[0] = -n[2] * rN1[1]
        rN2[1] = n[2] * rN1[0]
        rN2[2] = n[0] * rN1[1] - n[1] * rN1[0]
    } else {
        /* degenerate case */
        rN1[0] = (n[2] < 0.0) ? -1.0 : 1.0
        rN1[1] = rN1[2] = rN2[0] = rN2[2] = 0.0
        rN2[1] = 1.0
    }
}

/**
 * `axis_dominant_v3_to_m3_negate` (`math_geom.cc:3663`): a 3x3 projecting onto the plane of
 * `normal`, mirrored so the 2D winding matches the 3D one. `r[col][row]`, Blender's layout.
 */
function axisDominantV3ToM3Negate(normal: Vec3): Vec3[] {
    const r: Vec3[] = [[0, 0, 0], [0, 0, 0], [-normal[0], -normal[1], -normal[2]]]
    orthoBasisV3V3V3(r[0], r[1], r[2])
    /* transpose_m3 (math_matrix_c.cc:1199) */
    let t = r[0][1]; r[0][1] = r[1][0]; r[1][0] = t
    t = r[0][2]; r[0][2] = r[2][0]; r[2][0] = t
    t = r[1][2]; r[1][2] = r[2][1]; r[2][1] = t
    return r
}

/** `mul_v2_m3v3` (`math_matrix_c.cc:844`). */
function mulV2M3V3(r: [number, number], m: Vec3[], a: Vec3): void {
    const t0 = a[0], t1 = a[1], t2 = a[2]
    r[0] = m[0][0] * t0 + m[1][0] * t1 + m[2][0] * t2
    r[1] = m[0][1] * t0 + m[1][1] * t1 + m[2][1] * t2
}

/** `cos_v2v2v2` (`math_vector.cc:302`): cosine of the angle at `p2`. */
function cosV2V2V2(p1: readonly [number, number], p2: readonly [number, number], p3: readonly [number, number]): number {
    const vec1: [number, number] = [p2[0] - p1[0], p2[1] - p1[1]]
    const vec2: [number, number] = [p2[0] - p3[0], p2[1] - p3[1]]
    normalizeV2(vec1, vec1)
    normalizeV2(vec2, vec2)
    return vec1[0] * vec2[0] + vec1[1] * vec2[1]
}

/** `dist_squared_to_line_v2` (`math_geom.cc:294`) via `closest_to_line_v2` (`math_geom.cc:3298`). */
function distSquaredToLineV2(p: readonly number[], l1: readonly number[], l2: readonly number[]): number {
    const u0 = l2[0] - l1[0], u1 = l2[1] - l1[1]
    const h0 = p[0] - l1[0], h1 = p[1] - l1[1]
    const denom = u0 * u0 + u1 * u1
    let c0: number, c1: number
    if (denom === 0.0) {
        c0 = l1[0]
        c1 = l1[1]
    } else {
        const lambda = (u0 * h0 + u1 * h1) / denom
        c0 = l1[0] + u0 * lambda
        c1 = l1[1] + u1 * lambda
    }
    const d0 = c0 - p[0], d1 = c1 - p[1]
    return d0 * d0 + d1 * d1
}

// endregion

// region qsort / bsearch

/**
 * `vergscdata` (`:81`): sort scan vertices top to bottom (descending y), then left to right.
 * Returns 0 for distinct vertices at the same projected position; see the module note on stability.
 */
function vergscdata(x1: ScanFillVertLink, x2: ScanFillVertLink): number {
    if (x1.vert.xy[1] < x2.vert.xy[1]) return 1
    if (x1.vert.xy[1] > x2.vert.xy[1]) return -1
    if (x1.vert.xy[0] > x2.vert.xy[0]) return 1
    if (x1.vert.xy[0] < x2.vert.xy[0]) return -1
    return 0
}

/** glibc `bsearch` (`bits/stdlib-bsearch.h`) over the first `len` entries of `base`. */
function bsearch(key: ScanFillVertLink, base: ScanFillVertLink[], len: number): ScanFillVertLink | null {
    let l = 0
    let u = len
    while (l < u) {
        const idx = (l + u) >>> 1
        const p = base[idx]
        const comparison = vergscdata(key, p)
        if (comparison < 0) u = idx
        else if (comparison > 0) l = idx + 1
        else return p
    }
    return null
}

// endregion

// region FILL ROUTINES

/** `BLI_scanfill_vert_add` (`:104`). */
export function scanfillVertAdd(ctx: ScanFillContext, vec: Vec3): ScanFillVert {
    const sfV = new ScanFillVert([vec[0], vec[1], vec[2]], ctx.polyNr)
    addtail(ctx.fillvertbase, sfV)
    return sfV
}

/** `BLI_scanfill_edge_add` (`:126`). */
export function scanfillEdgeAdd(ctx: ScanFillContext, v1: ScanFillVert, v2: ScanFillVert): ScanFillEdge {
    const sfEd = new ScanFillEdge(v1, v2, ctx.polyNr)
    addtail(ctx.filledgebase, sfEd)
    return sfEd
}

/** `addfillface` (`:145`). Does not make edges. */
function addfillface(ctx: ScanFillContext, v1: ScanFillVert, v2: ScanFillVert, v3: ScanFillVert): void {
    addtail(ctx.fillfacebase, new ScanFillFace(v1, v2, v3))
}

/** `boundisect` (`:161`): has `pf2` been touched (intersected) by `pf1`, by bounding box? */
function boundisect(pf2: PolyFill, pf1: PolyFill): boolean {
    /* test first if polys exist */
    if (pf1.edges === 0 || pf2.edges === 0) return false

    if (pf2.maxXy[0] < pf1.minXy[0]) return false
    if (pf2.maxXy[1] < pf1.minXy[1]) return false

    if (pf2.minXy[0] > pf1.maxXy[0]) return false
    if (pf2.minXy[1] > pf1.maxXy[1]) return false

    return true
}

/** `fill_target_map_recursive` (`:187`). */
function fillTargetMapRecursive(pfList: PolyFill[], pfLen: number, pfTarget: number, pfTest: number, targetMap: number[]): void {
    const pfA = pfList[pfTest]
    for (let pfBIndex = pfTarget + 1; pfBIndex < pfLen; pfBIndex++) {
        if (targetMap[pfBIndex] !== pfBIndex) {
            /* All intersections have already been identified for this polygon. */
            continue
        }
        const pfB = pfList[pfBIndex]
        if (boundisect(pfA, pfB)) {
            targetMap[pfBIndex] = pfTarget
            fillTargetMapRecursive(pfList, pfLen, pfTarget, pfBIndex, targetMap)
        }
    }
}

/** `mergepolysSimp` (`:209`): add `pf2` to `pf1`. */
function mergepolysSimp(ctx: ScanFillContext, pf1: PolyFill, pf2: PolyFill): void {
    /* replace old poly numbers */
    for (let eve = ctx.fillvertbase.first; eve; eve = eve.next) {
        if (eve.polyNr === pf2.nr) eve.polyNr = pf1.nr
    }
    for (let eed = ctx.filledgebase.first; eed; eed = eed.next) {
        if (eed.polyNr === pf2.nr) eed.polyNr = pf1.nr
    }

    /* Join. */
    pf1.verts += pf2.verts
    pf1.edges += pf2.edges

    pf1.maxXy[0] = Math.max(pf1.maxXy[0], pf2.maxXy[0])
    pf1.maxXy[1] = Math.max(pf1.maxXy[1], pf2.maxXy[1])

    pf1.minXy[0] = Math.min(pf1.minXy[0], pf2.minXy[0])
    pf1.minXy[1] = Math.min(pf1.minXy[1], pf2.minXy[1])

    pf1.f = pf1.f | pf2.f

    /* Clear the other one. */
    pf2.verts = pf2.edges = 0
}

/** `testedgeside` (`:240`): is `v3` to the right of `v1-v2`? With exception: `v3 == v1 || v3 == v2`. */
function testedgeside(v1: readonly number[], v2: readonly number[], v3: readonly number[]): boolean {
    const inp = (v2[0] - v1[0]) * (v1[1] - v3[1]) + (v1[1] - v2[1]) * (v1[0] - v3[0])

    if (inp < 0.0) return false
    if (inp === 0.0) {
        if (v1[0] === v3[0] && v1[1] === v3[1]) return false
        if (v2[0] === v3[0] && v2[1] === v3[1]) return false
    }
    return true
}

/** `addedgetoscanvert` (`:261`): find the first edge to the right of `eed` and insert `eed` before it. */
function addedgetoscanvert(sc: ScanFillVertLink, eed: ScanFillEdge): boolean {
    if (sc.first === null) {
        sc.first = sc.last = eed
        eed.prev = eed.next = null
        return true
    }

    const x = eed.v1.xy[0]
    const y = eed.v1.xy[1]

    let fac1 = eed.v2.xy[1] - y
    if (fac1 === 0.0) fac1 = 1.0e10 * (eed.v2.xy[0] - x)
    else fac1 = (x - eed.v2.xy[0]) / fac1

    let ed: ScanFillEdge | null
    for (ed = sc.first; ed; ed = ed.next) {
        if (ed.v2 === eed.v2) return false

        let fac = ed.v2.xy[1] - y
        if (fac === 0.0) fac = 1.0e10 * (ed.v2.xy[0] - x)
        else fac = (x - ed.v2.xy[0]) / fac

        if (fac > fac1) break
    }
    if (ed) insertlinkbefore(sc, ed, eed)
    else addtail(sc, eed)

    return true
}

/**
 * `addedgetoscanlist` (`:312`): insert the edge at the right place in the scan list.
 * Returns the scan vertex when the edge already exists there, else null.
 */
function addedgetoscanlist(scdata: ScanFillVertLink[], eed: ScanFillEdge, len: number): ScanFillVertLink | null {
    /* which vert is left-top? */
    if (eed.v1.xy[1] === eed.v2.xy[1]) {
        if (eed.v1.xy[0] > eed.v2.xy[0]) {
            const eve = eed.v1
            eed.v1 = eed.v2
            eed.v2 = eve
        }
    } else if (eed.v1.xy[1] < eed.v2.xy[1]) {
        const eve = eed.v1
        eed.v1 = eed.v2
        eed.v2 = eve
    }
    /* find location in list */
    const scsearch = {vert: eed.v1, first: null, last: null} as ScanFillVertLink
    const sc = bsearch(scsearch, scdata, len)

    if (sc === null) {
        // `printf("Error in search edge: %p\n", ...)` (`:338`); Blender carries on.
        console.error('mesh-kernel scanfill: error in search edge')
    } else if (!addedgetoscanvert(sc, eed)) {
        return sc
    }
    return null
}

/** `boundinsideEV` (`:350`): is `eve` inside the bound-box of `eed`? */
function boundinsideEV(eed: ScanFillEdge, eve: ScanFillVert): boolean {
    let minx: number, maxx: number, miny: number, maxy: number

    if (eed.v1.xy[0] < eed.v2.xy[0]) {
        minx = eed.v1.xy[0]
        maxx = eed.v2.xy[0]
    } else {
        minx = eed.v2.xy[0]
        maxx = eed.v1.xy[0]
    }
    if (eve.xy[0] >= minx && eve.xy[0] <= maxx) {
        if (eed.v1.xy[1] < eed.v2.xy[1]) {
            miny = eed.v1.xy[1]
            maxy = eed.v2.xy[1]
        } else {
            miny = eed.v2.xy[1]
            maxy = eed.v1.xy[1]
        }
        if (eve.xy[1] >= miny && eve.xy[1] <= maxy) return true
    }
    return false
}

/**
 * `testvertexnearedge` (`:378`): only vertices with `edge_count == 1` are tested for being close to
 * an edge; if one is, it is inserted.
 */
function testvertexnearedge(ctx: ScanFillContext): void {
    for (let eve = ctx.fillvertbase.first; eve; eve = eve.next) {
        if (eve.edgeCount !== 1) continue

        /* find the edge which has vertex eve,
         * NOTE: we _know_ this will crash if 'ed1' becomes nullptr
         * but this will never happen. */
        let ed1 = ctx.filledgebase.first!
        for (; !(ed1.v1 === eve || ed1.v2 === eve); ed1 = ed1.next!) {
            /* do nothing */
        }

        if (ed1.v1 === eve) {
            ed1.v1 = ed1.v2
            ed1.v2 = eve
        }

        for (let eed = ctx.filledgebase.first; eed; eed = eed.next) {
            if (eve !== eed.v1 && eve !== eed.v2 && eve.polyNr === eed.polyNr) {
                if (compareV2V2(eve.xy, eed.v1.xy, SF_EPSILON)) {
                    ed1.v2 = eed.v1
                    eed.v1.edgeCount = u8(eed.v1.edgeCount + 1)
                    eve.edgeCount = 0
                    break
                }
                if (compareV2V2(eve.xy, eed.v2.xy, SF_EPSILON)) {
                    ed1.v2 = eed.v2
                    eed.v2.edgeCount = u8(eed.v2.edgeCount + 1)
                    eve.edgeCount = 0
                    break
                }

                if (boundinsideEV(eed, eve)) {
                    // NOTE: Blender passes `(eed.v1->xy, eed.v2->xy, eve.xy)` to
                    // `dist_squared_to_line_v2(p, l1, l2)` (`:414`), i.e. the distance of `eed.v1`
                    // from the line through `eed.v2` and `eve` - not of `eve` from `eed`. Ported as is.
                    const dist = distSquaredToLineV2(eed.v1.xy, eed.v2.xy, eve.xy)
                    if (dist < SF_EPSILON_SQ) {
                        /* new edge */
                        ed1 = scanfillEdgeAdd(ctx, eed.v1, eve)
                        ed1.polyNr = eed.polyNr
                        eed.v1 = eve
                        eve.edgeCount = 3
                        break
                    }
                }
            }
        }
    }
}

/** `splitlist` (`:432`): everything is in the temp lists; move only poly `nr` to the fill lists. */
function splitlist(ctx: ScanFillContext, tempve: ScanFillListBase<ScanFillVert>, temped: ScanFillListBase<ScanFillEdge>, nr: number): void {
    movelisttolist(tempve, ctx.fillvertbase)
    movelisttolist(temped, ctx.filledgebase)

    for (let eve = tempve.first, eveNext: ScanFillVert | null; eve; eve = eveNext) {
        eveNext = eve.next
        if (eve.polyNr === nr) {
            remlink(tempve, eve)
            addtail(ctx.fillvertbase, eve)
        }
    }

    for (let eed = temped.first, eedNext: ScanFillEdge | null; eed; eed = eedNext) {
        eedNext = eed.next
        if (eed.polyNr === nr) {
            remlink(temped, eed)
            addtail(ctx.filledgebase, eed)
        }
    }
}

/** `scanfill` (`:456`): fill one (merged) polygon; returns the number of triangles added. */
function scanfill(ctx: ScanFillContext, pf: PolyFill, flag: number): number {
    const nr = pf.nr
    let twoconnected = false

    /* STEP 0: remove zero sized edges (`:478`) - BLI_SCANFILL_CALC_REMOVE_DOUBLES only, not ported;
     * scanfillCalcEx rejects the flag before getting here. */

    /* STEP 1: make using FillVert and FillEdge lists a sorted ScanFillVertLink list */
    const scdata: ScanFillVertLink[] = []
    let verts = 0
    for (let eve = ctx.fillvertbase.first; eve; eve = eve.next) {
        if (eve.polyNr === nr) {
            if (eve.f !== SF_VERT_ZERO_LEN) {
                verts++
                eve.f = SF_VERT_NEW /* Flag for connect edges later on. */
                scdata.push({vert: eve, first: null, last: null})
            }
        }
    }

    // `qsort(scdata, verts, ..., vergscdata)` (`:523`). Stable, as glibc's merge sort is.
    scdata.sort(vergscdata)

    // `:558-565` (the non-REMOVE_DOUBLES branch).
    for (let eed = ctx.filledgebase.first, eedNext: ScanFillEdge | null; eed; eed = eedNext) {
        eedNext = eed.next
        remlink(ctx.filledgebase, eed)
        if (eed.v1 !== eed.v2) addedgetoscanlist(scdata, eed, verts)
    }

    /* STEP 2: FILL LOOP */

    if (pf.f === SF_POLY_NEW) twoconnected = true

    /* (temporal) security: never much more faces than vertices */
    let totface = 0
    let maxface: number
    if (flag & ScanFillFlag.Holes) {
        maxface = 2 * verts /* 2*verts: based at a filled circle within a triangle */
    } else {
        /* when we don't calc any holes, we assume face is a non overlapping loop */
        maxface = (verts - 2) >>> 0 // `uint` arithmetic
    }

    for (let a = 0; a < verts; a++) {
        const sc = scdata[a]
        /* Set connect-flags. */
        let ed1: ScanFillEdge | null
        let ed2: ScanFillEdge | null
        let ed3: ScanFillEdge | null
        let eedNext: ScanFillEdge | null
        for (ed1 = sc.first; ed1; ed1 = eedNext) {
            eedNext = ed1.next
            if (ed1.v1.edgeCount === 1 || ed1.v2.edgeCount === 1) {
                remlink(sc, ed1)
                addtail(ctx.filledgebase, ed1)
                if (ed1.v1.edgeCount > 1) ed1.v1.edgeCount = u8(ed1.v1.edgeCount - 1)
                if (ed1.v2.edgeCount > 1) ed1.v2.edgeCount = u8(ed1.v2.edgeCount - 1)
            } else {
                ed1.v2.f = SF_VERT_AVAILABLE
            }
        }
        while (sc.first) { /* for as long there are edges */
            ed1 = sc.first
            ed2 = ed1.next

            if (totface >= maxface) {
                a = verts
                break
            }
            if (ed2 === null) {
                sc.first = sc.last = null
                addtail(ctx.filledgebase, ed1)
                ed1.v2.f = SF_VERT_NEW
                ed1.v1.edgeCount = u8(ed1.v1.edgeCount - 1)
                ed1.v2.edgeCount = u8(ed1.v2.edgeCount - 1)
            } else {
                /* test rest of vertices */
                let bestSc: ScanFillVertLink | null = null
                let angleBestCos = -1.0
                let firsttime = false

                const v1 = ed1.v2
                const v2 = ed1.v1
                const v3 = ed2.v2

                /* this happens with a serial of overlapping edges */
                if (v1 === v2 || v2 === v3) break

                const miny = Math.min(v1.xy[1], v3.xy[1])

                for (let b = a + 1; b < verts; b++) {
                    const sc1 = scdata[b]
                    if (sc1.vert.f === SF_VERT_NEW) {
                        if (sc1.vert.xy[1] <= miny) break
                        if (testedgeside(v1.xy, v2.xy, sc1.vert.xy)) {
                            if (testedgeside(v2.xy, v3.xy, sc1.vert.xy)) {
                                if (testedgeside(v3.xy, v1.xy, sc1.vert.xy)) {
                                    /* point is in triangle */

                                    /* Because multiple points can be inside triangle
                                     * (concave holes) we continue searching and pick the
                                     * one with sharpest corner. */
                                    if (bestSc === null) {
                                        /* even without holes we need to keep checking #35861. */
                                        bestSc = sc1
                                    } else {
                                        /* Prevent angle calc for the simple cases
                                         * only 1 vertex is found. */
                                        if (!firsttime) {
                                            angleBestCos = cosV2V2V2(v2.xy, v1.xy, bestSc.vert.xy)
                                            firsttime = true
                                        }

                                        const angleTestCos = cosV2V2V2(v2.xy, v1.xy, sc1.vert.xy)
                                        if (angleTestCos > angleBestCos) {
                                            bestSc = sc1
                                            angleBestCos = angleTestCos
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if (bestSc) {
                    /* make new edge, and start over */
                    ed3 = scanfillEdgeAdd(ctx, v2, bestSc.vert)
                    remlink(ctx.filledgebase, ed3)
                    insertlinkbefore(sc, ed2, ed3)
                    ed3.v2.f = SF_VERT_AVAILABLE
                    ed3.f = SF_EDGE_INTERNAL
                    ed3.v1.edgeCount = u8(ed3.v1.edgeCount + 1)
                    ed3.v2.edgeCount = u8(ed3.v2.edgeCount + 1)
                } else {
                    /* new triangle */
                    addfillface(ctx, v1, v2, v3)
                    totface++
                    remlink(sc, ed1)
                    addtail(ctx.filledgebase, ed1)
                    ed1.v2.f = SF_VERT_NEW
                    ed1.v1.edgeCount = u8(ed1.v1.edgeCount - 1)
                    ed1.v2.edgeCount = u8(ed1.v2.edgeCount - 1)
                    /* ed2 can be removed when it's a boundary edge */
                    if (ed2.f === SF_EDGE_NEW && twoconnected) {
                        remlink(sc, ed2)
                        addtail(ctx.filledgebase, ed2)
                        ed2.v2.f = SF_VERT_NEW
                        ed2.v1.edgeCount = u8(ed2.v1.edgeCount - 1)
                        ed2.v2.edgeCount = u8(ed2.v2.edgeCount - 1)
                    }

                    /* new edge */
                    ed3 = scanfillEdgeAdd(ctx, v1, v3)
                    remlink(ctx.filledgebase, ed3)
                    ed3.f = SF_EDGE_INTERNAL
                    ed3.v1.edgeCount = u8(ed3.v1.edgeCount + 1)
                    ed3.v2.edgeCount = u8(ed3.v2.edgeCount + 1)

                    const sc1 = addedgetoscanlist(scdata, ed3, verts)

                    if (sc1) { /* ed3 already exists: remove if a boundary */
                        ed3.v1.edgeCount = u8(ed3.v1.edgeCount - 1)
                        ed3.v2.edgeCount = u8(ed3.v2.edgeCount - 1)

                        for (ed3 = sc1.first; ed3; ed3 = ed3.next) {
                            if ((ed3.v1 === v1 && ed3.v2 === v3) || (ed3.v1 === v3 && ed3.v2 === v1)) {
                                if (twoconnected) {
                                    remlink(sc1, ed3)
                                    addtail(ctx.filledgebase, ed3)
                                    ed3.v1.edgeCount = u8(ed3.v1.edgeCount - 1)
                                    ed3.v2.edgeCount = u8(ed3.v2.edgeCount - 1)
                                }
                                break
                            }
                        }
                    }
                }
            }

            /* test for loose edges */
            for (ed1 = sc.first; ed1; ed1 = eedNext) {
                eedNext = ed1.next
                if (ed1.v1.edgeCount < 2 || ed1.v2.edgeCount < 2) {
                    remlink(sc, ed1)
                    addtail(ctx.filledgebase, ed1)
                    if (ed1.v1.edgeCount > 1) ed1.v1.edgeCount = u8(ed1.v1.edgeCount - 1)
                    if (ed1.v2.edgeCount > 1) ed1.v2.edgeCount = u8(ed1.v2.edgeCount - 1)
                }
            }
            /* done with loose edges */
        }
    }

    return totface
}

/** `BLI_scanfill_begin` (`:783`). */
export function scanfillBegin(): ScanFillContext {
    return {
        fillvertbase: {first: null, last: null},
        filledgebase: {first: null, last: null},
        fillfacebase: {first: null, last: null},
        polyNr: SF_POLY_UNSET,
    }
}

/** `BLI_scanfill_end` (`:797`): drop the lists. */
export function scanfillEnd(ctx: ScanFillContext): void {
    ctx.fillvertbase.first = ctx.fillvertbase.last = null
    ctx.filledgebase.first = ctx.filledgebase.last = null
    ctx.fillfacebase.first = ctx.fillfacebase.last = null
}

/**
 * Triangulate everything added to `ctx`; returns the number of triangles, which are appended to
 * `ctx.fillfacebase`. Port of `BLI_scanfill_calc_ex` (`:817`).
 *
 * `norProj` is the projection normal and must be unit length (Blender asserts non-zero and relies on
 * unit for the projection basis). Null computes one with Newell's method over the vertex list.
 *
 * Blender 3.4.1 difference (STEP 4, holes): 3.4.1 first `qsort`s the poly list by bound minimum
 * (`vergpoly`) and merges pairwise, growing the bound of the absorbing poly inside `boundisect`; main
 * (ported here) merges the transitive closure of bound overlaps in poly-number order
 * (`fill_target_map_recursive`) and fills in poly-number order. For disjoint islands the triangles are
 * identical but 3.4.1 emits the islands in bound order, main in connectivity order. Chains of bounds
 * that only overlap through a third poly found later in 3.4.1's sorted order can also merge in main
 * and stay separate in 3.4.1.
 */
export function scanfillCalcEx(ctx: ScanFillContext, flag: number, norProj: Vec3 | null): number {
    if (flag & ScanFillFlag.RemoveDoubles) {
        throw new Error('mesh-kernel scanfill: BLI_SCANFILL_CALC_REMOVE_DOUBLES is not ported (unreachable from triangle_fill)')
    }
    if (norProj && !(norProj[0] * norProj[0] + norProj[1] * norProj[1] + norProj[2] * norProj[2] > FLT_EPSILON)) {
        throw new Error('mesh-kernel scanfill: projection normal must be non-zero') // BLI_assert (`:836`)
    }

    let totfaces = 0 /* total faces added */
    let poly = 0
    let ok: boolean

    /* first test vertices if they are in edges */
    /* including resetting of flags */
    for (let eed = ctx.filledgebase.first; eed; eed = eed.next) {
        eed.v1.f = SF_VERT_AVAILABLE
        eed.v2.f = SF_VERT_AVAILABLE
    }

    let vertAvailable = false
    for (let eve = ctx.fillvertbase.first; eve; eve = eve.next) {
        if (eve.f === SF_VERT_AVAILABLE) {
            vertAvailable = true
            break
        }
    }
    if (!vertAvailable) return 0

    const n: Vec3 = [0, 0, 0]

    if (norProj) {
        n[0] = norProj[0]
        n[1] = norProj[1]
        n[2] = norProj[2]
    } else {
        /* define projection: with 'best' normal */
        /* Newell's Method */
        /* Similar code used elsewhere, but this checks for double ups
         * which historically this function supports so better not change */

        /* WARNING: this only gives stable direction with single polygons,
         * ideally we'd calculate connectivity and each polys normal, see #41047 */
        let vPrev = ctx.fillvertbase.last!.co

        for (let eve = ctx.fillvertbase.first; eve; eve = eve.next) {
            if (!compareV3V3(vPrev, eve.co, SF_EPSILON)) {
                addNewellCrossV3V3V3(n, vPrev, eve.co)
                vPrev = eve.co
            }
        }
    }

    if (normalizeV3(n) === 0.0) return 0

    const mat2d = axisDominantV3ToM3Negate(n)

    /* STEP 1: COUNT POLYS */
    if (ctx.polyNr !== SF_POLY_UNSET) {
        poly = (ctx.polyNr + 1) & 0xffff
        ctx.polyNr = SF_POLY_UNSET
    }

    if ((flag & ScanFillFlag.Polys) && poly === 0) {
        for (let eve = ctx.fillvertbase.first; eve; eve = eve.next) {
            mulV2M3V3(eve.xy, mat2d, eve.co)

            /* get first vertex with no poly number */
            if (eve.polyNr === SF_POLY_UNSET) {
                let toggle = 0
                /* now a sort of select connected */
                ok = true
                eve.polyNr = poly

                while (ok) {
                    ok = false

                    toggle++
                    for (let eed = (toggle & 1) ? ctx.filledgebase.first : ctx.filledgebase.last; eed;
                        eed = (toggle & 1) ? eed.next : eed.prev) {
                        if (eed.v1.polyNr === SF_POLY_UNSET && eed.v2.polyNr === poly) {
                            eed.v1.polyNr = poly
                            eed.polyNr = poly
                            ok = true
                        } else if (eed.v2.polyNr === SF_POLY_UNSET && eed.v1.polyNr === poly) {
                            eed.v2.polyNr = poly
                            eed.polyNr = poly
                            ok = true
                        } else if (eed.polyNr === SF_POLY_UNSET) {
                            if (eed.v1.polyNr === poly && eed.v2.polyNr === poly) {
                                eed.polyNr = poly
                                ok = true
                            }
                        }
                    }
                }

                poly = (poly + 1) & 0xffff
            }
        }
    } else if (poly) {
        /* we pre-calculated poly_nr */
        for (let eve = ctx.fillvertbase.first; eve; eve = eve.next) {
            mulV2M3V3(eve.xy, mat2d, eve.co)
        }
    } else {
        poly = 1

        for (let eve = ctx.fillvertbase.first; eve; eve = eve.next) {
            mulV2M3V3(eve.xy, mat2d, eve.co)
            eve.polyNr = 0
        }

        for (let eed = ctx.filledgebase.first; eed; eed = eed.next) {
            eed.polyNr = 0
        }
    }

    /* STEP 2: remove loose edges and strings of edges */
    if (flag & ScanFillFlag.Loose) {
        let toggle = 0
        for (let eed = ctx.filledgebase.first; eed; eed = eed.next) {
            // `(eed.v1->edge_count++ > 250) || (eed.v2->edge_count++ > 250)`: post-increments,
            // short-circuited.
            const c1 = eed.v1.edgeCount
            eed.v1.edgeCount = u8(c1 + 1)
            if (c1 > 250) return 0
            const c2 = eed.v2.edgeCount
            eed.v2.edgeCount = u8(c2 + 1)
            if (c2 > 250) {
                /* otherwise it's impossible to be sure you can clear vertices */
                return 0
            }
        }

        /* does it only for vertices with (->edge_count == 1) */
        testvertexnearedge(ctx)

        ok = true
        while (ok) {
            ok = false

            toggle++

            let eedNext: ScanFillEdge | null
            for (let eed = (toggle & 1) ? ctx.filledgebase.first : ctx.filledgebase.last; eed; eed = eedNext) {
                eedNext = (toggle & 1) ? eed.next : eed.prev
                if (eed.v1.edgeCount === 1) {
                    eed.v2.edgeCount = u8(eed.v2.edgeCount - 1)
                    remlink(ctx.fillvertbase, eed.v1)
                    remlink(ctx.filledgebase, eed)
                    ok = true
                } else if (eed.v2.edgeCount === 1) {
                    eed.v1.edgeCount = u8(eed.v1.edgeCount - 1)
                    remlink(ctx.fillvertbase, eed.v2)
                    remlink(ctx.filledgebase, eed)
                    ok = true
                }
            }
        }
        if (ctx.filledgebase.first === null) {
            /* All edges removed */
            return 0
        }
    } else {
        /* skip checks for loose edges */
        for (let eed = ctx.filledgebase.first; eed; eed = eed.next) {
            eed.v1.edgeCount = u8(eed.v1.edgeCount + 1)
            eed.v2.edgeCount = u8(eed.v2.edgeCount + 1)
        }
    }

    /* STEP 3: MAKE POLYFILL STRUCT */
    const pflist: PolyFill[] = []
    for (let a = 0; a < poly; a++) {
        pflist.push({edges: 0, verts: 0, minXy: [1.0e20, 1.0e20], maxXy: [-1.0e20, -1.0e20], f: SF_POLY_NEW, nr: a})
    }
    for (let eed = ctx.filledgebase.first; eed; eed = eed.next) {
        pflist[eed.polyNr].edges++
    }

    for (let eve = ctx.fillvertbase.first; eve; eve = eve.next) {
        const pf = pflist[eve.polyNr]
        pf.verts++
        const minXyP = pf.minXy
        const maxXyP = pf.maxXy

        minXyP[0] = (minXyP[0]) < (eve.xy[0]) ? (minXyP[0]) : (eve.xy[0])
        minXyP[1] = (minXyP[1]) < (eve.xy[1]) ? (minXyP[1]) : (eve.xy[1])
        maxXyP[0] = (maxXyP[0]) > (eve.xy[0]) ? (maxXyP[0]) : (eve.xy[0])
        maxXyP[1] = (maxXyP[1]) > (eve.xy[1]) ? (maxXyP[1]) : (eve.xy[1])
        if (eve.edgeCount > 2) pf.f = SF_POLY_VALID
    }

    /* STEP 4: FIND HOLES OR BOUNDS, JOIN THEM
     *  ( bounds just to divide it in pieces for optimization,
     *    the edgefill itself has good auto-hole detection). */
    if ((flag & ScanFillFlag.Holes) && poly > 1) {
        // `range_vn_u(target_map, poly, 0)`
        const targetMap: number[] = []
        for (let a = 0; a < poly; a++) targetMap.push(a)

        for (let a = 0; a < poly; a++) {
            if (targetMap[a] !== a) continue
            fillTargetMapRecursive(pflist, poly, a, a, targetMap)
        }

        /* Join polygons. */
        for (let a = 0; a < poly; a++) {
            if (targetMap[a] !== a) {
                const pfSrc = pflist[a]
                const pfDst = pflist[targetMap[a]]
                mergepolysSimp(ctx, pfDst, pfSrc)
            }
        }
    }

    /* STEP 5: MAKE TRIANGLES */
    const tempve: ScanFillListBase<ScanFillVert> = {first: ctx.fillvertbase.first, last: ctx.fillvertbase.last}
    const temped: ScanFillListBase<ScanFillEdge> = {first: ctx.filledgebase.first, last: ctx.filledgebase.last}
    ctx.fillvertbase.first = ctx.fillvertbase.last = null
    ctx.filledgebase.first = ctx.filledgebase.last = null

    for (let a = 0; a < poly; a++) {
        const pf = pflist[a]
        if (pf.edges > 1) {
            splitlist(ctx, tempve, temped, pf.nr)
            totfaces += scanfill(ctx, pf, flag)
        }
    }
    movelisttolist(ctx.fillvertbase, tempve)
    movelisttolist(ctx.filledgebase, temped)

    return totfaces
}

/** `BLI_scanfill_calc` (`:1140`): {@link scanfillCalcEx} with a Newell projection normal. */
export function scanfillCalc(ctx: ScanFillContext, flag: number): number {
    return scanfillCalcEx(ctx, flag, null)
}

/** Iterate a scan-fill list (`fillvertbase`, `filledgebase`, `fillfacebase`) in order. */
export function* scanfillList<T extends ScanFillLink<T>>(lb: ScanFillListBase<T>): Generator<T> {
    for (let x = lb.first; x; x = x.next) yield x
}

// endregion

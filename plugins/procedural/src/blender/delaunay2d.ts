/**
 * Constrained Delaunay triangulation, `blender::meshintersect::delaunay_2d_calc` for `double` (Blender 5.2.2
 * `blenlib/intern/delaunay_2d.cc`, `BLI_delaunay_2d.hh`): the divide-and-conquer Delaunay triangulation of the
 * vertices (Guibas-Stolfi), edge and face constraints inserted by walking crossings, even-odd / non-zero hole
 * detection, and the output (vertex, edge and face order as Blender emits them). Orientation and in-circle tests are
 * Shewchuk's exact predicates (`predicates.ts`); the `mpq_class` (GMP) instantiation and the debug drawing are not
 * ported (Blender's `double` path does not use them). Line numbers below refer to `delaunay_2d.cc`.
 */

import {incircle, orient2d} from './predicates'

export const enum CDTOutputType {
    FULL = 0,
    INSIDE = 1,
    INSIDE_WITH_HOLES = 2,
    INSIDE_WITH_HOLES_NONZERO = 3,
    CONSTRAINTS = 4,
    CONSTRAINTS_VALID_BMESH = 5,
    CONSTRAINTS_VALID_BMESH_WITH_HOLES = 6,
    CONSTRAINTS_VALID_BMESH_WITH_HOLES_NONZERO = 7,
}

/** `CDT_input<double>` (`BLI_delaunay_2d.hh:152`). */
export interface CDTInput {
    vert: [number, number][]
    edge: [number, number][]
    face: number[][]
    epsilon: number
    needIds: boolean
}

/** `CDT_result<double>`: vertex coordinates, edges and faces (ids are not produced: `need_ids` is not ported). */
export interface CDTResult {
    vert: [number, number][]
    edge: [number, number][]
    face: number[][]
    faceEdgeOffset: number
}

type V2 = [number, number]

interface SymEdge {
    next: SymEdge | null
    rot: SymEdge | null
    vert: CDTVert
    edge: CDTEdge
    face: CDTFace
}

interface CDTVert {
    co: V2
    symedge: SymEdge | null
    inputIds: Set<number>
    index: number
    mergeToIndex: number
    visitIndex: number
}

interface CDTEdge {
    inputIds: Set<number>
    symedges: [SymEdge, SymEdge]
}

interface CDTFace {
    symedge: SymEdge | null
    inputIds: Set<number>
    visitIndex: number
    deleted: boolean
    hole: boolean
}

/** `sym` (:110). */
const sym = (se: SymEdge): SymEdge => se.next!.rot!
/** `prev` (:116). */
const prev = (se: SymEdge): SymEdge => se.rot!.next!.rot!

// region math (`BLI_math_vector.hh`, `math_vec.cc`)
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]]
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1]
const distanceSquared = (a: V2, b: V2) => dot(sub(a, b), sub(a, b))
const distance = (a: V2, b: V2) => Math.sqrt(distanceSquared(a, b))
/** `math::interpolate`: `a * (1 - t) + b * t`. */
const interpolate = (a: V2, b: V2, t: number): V2 => [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t]

const enum Isect { COLINEAR = -1, NONE = 0, EXACT = 1, CROSS = 2 }

/** `isect_seg_seg<double2>` (`math_vec.cc:46`). */
function isectSegSeg(v1: V2, v2: V2, v3: V2, v4: V2): {kind: Isect, lambda: number} {
    const div = (v2[0] - v1[0]) * (v4[1] - v3[1]) - (v2[1] - v1[1]) * (v4[0] - v3[0])
    if (div === 0) return {kind: Isect.COLINEAR, lambda: 0}
    const lambda = ((v1[1] - v3[1]) * (v4[0] - v3[0]) - (v1[0] - v3[0]) * (v4[1] - v3[1])) / div
    const mu = ((v1[1] - v3[1]) * (v2[0] - v1[0]) - (v1[0] - v3[0]) * (v2[1] - v1[1])) / div
    if (lambda >= 0 && lambda <= 1 && mu >= 0 && mu <= 1) {
        if (lambda === 0 || lambda === 1 || mu === 0 || mu === 1) return {kind: Isect.EXACT, lambda}
        return {kind: Isect.CROSS, lambda}
    }
    return {kind: Isect.NONE, lambda}
}
// endregion

/** `filtered_orient2d<double>` (:724) / `filtered_incircle<double>` (:791): the exact predicates on the coordinates. */
const filteredOrient2d = (a: V2, b: V2, c: V2) => orient2d(a, b, c)
const filteredIncircle = (a: V2, b: V2, c: V2, d: V2) => incircle(a, b, c, d)

/** `in_line<double>` (:843). */
function inLine(a: V2, b: V2, c: V2): boolean {
    const ab = sub(b, a), ac = sub(c, a)
    if (dot(ab, ac) < 0) return false
    const bc = sub(c, b)
    return dot(bc, ac) >= 0
}

/** `CDTArrangement<double>` (:235). */
class CDTArrangement {
    readonly verts: CDTVert[] = []
    readonly edges: CDTEdge[] = []
    readonly faces: CDTFace[] = []
    outerFace!: CDTFace

    /** `add_vert` (:878). */
    addVert(pt: V2): CDTVert {
        const v: CDTVert = {co: [pt[0], pt[1]], symedge: null, inputIds: new Set(), index: -1, mergeToIndex: -1, visitIndex: 0}
        v.index = this.verts.push(v) - 1
        return v
    }

    /** `add_edge` (:887). */
    addEdge(v1: CDTVert, v2: CDTVert, fleft: CDTFace, fright: CDTFace): CDTEdge {
        const e = {inputIds: new Set<number>()} as CDTEdge
        const se: SymEdge = {next: null, rot: null, vert: v1, edge: e, face: fleft}
        const sesym: SymEdge = {next: null, rot: null, vert: v2, edge: e, face: fright}
        e.symedges = [se, sesym]
        this.edges.push(e)
        if (v1.symedge === null) v1.symedge = se
        if (v2.symedge === null) v2.symedge = sesym
        return e
    }

    /** `add_face` (:911). */
    addFace(): CDTFace {
        const f: CDTFace = {symedge: null, inputIds: new Set(), visitIndex: 0, deleted: false, hole: false}
        this.faces.push(f)
        return f
    }

    /** `add_diagonal` (:1046). */
    addDiagonal(s1: SymEdge, s2: SymEdge): CDTEdge {
        const fold = s1.face
        const fnew = this.addFace()
        const s1prev = prev(s1)
        const s1prevsym = sym(s1prev)
        const s2prev = prev(s2)
        const s2prevsym = sym(s2prev)
        const ediag = this.addEdge(s1.vert, s2.vert, fnew, fold)
        const [sdiag, sdiagsym] = ediag.symedges
        sdiag.next = s2
        sdiagsym.next = s1
        s2prev.next = sdiagsym
        s1prev.next = sdiag
        s1.rot = sdiag
        sdiag.rot = s1prevsym
        s2.rot = sdiagsym
        sdiagsym.rot = s2prevsym
        for (let se: SymEdge = s2; se !== sdiag; se = se.next!) se.face = fnew
        for (const id of fold.inputIds) fnew.inputIds.add(id)
        return ediag
    }

    /** `add_vert_to_symedge_edge` (:1073). */
    addVertToSymedgeEdge(v: CDTVert, se: SymEdge): CDTEdge {
        const seRot = se.rot!
        const seRotsym = sym(seRot)
        const e = this.addEdge(v, se.vert, se.face, se.face)
        const [newSe, newSeSym] = e.symedges
        newSe.next = se
        newSeSym.next = newSe
        newSe.rot = newSe
        newSeSym.rot = seRot
        se.rot = newSeSym
        seRotsym.next = newSeSym
        return e
    }

    /** `connect_separate_parts` (:1096). */
    connectSeparateParts(se1: SymEdge, se2: SymEdge): CDTEdge {
        const se1Rot = se1.rot!
        const se1Rotsym = sym(se1Rot)
        const se2Rot = se2.rot!
        const se2Rotsym = sym(se2Rot)
        const e = this.addEdge(se1.vert, se2.vert, this.outerFace, this.outerFace)
        const [newSe, newSeSym] = e.symedges
        newSe.next = se2
        newSeSym.next = se1
        newSe.rot = se1Rot
        newSeSym.rot = se2Rot
        se1.rot = newSe
        se2.rot = newSeSym
        se1Rotsym.next = newSe
        se2Rotsym.next = newSeSym
        return e
    }

    /** `split_edge` (:1126). */
    splitEdge(se: SymEdge, lambda: number, windingMap: Map<CDTEdge, number> | undefined, boundaryCountMap: Map<CDTEdge, number> | undefined): CDTEdge {
        const a = se.vert.co
        const b = se.next!.vert.co
        const sesym = sym(se)
        const sesymprev = prev(sesym)
        const sesymprevsym = sym(sesymprev)
        const senext = se.next!
        const v = this.addVert(interpolate(a, b, lambda))
        const e = this.addEdge(v, se.next!.vert, se.face, sesym.face)
        sesym.vert = v
        const [newse, newsesym] = e.symedges
        se.next = newse
        newsesym.next = sesym
        newse.next = senext
        newse.rot = sesym
        sesym.rot = newse
        senext.rot = newsesym
        newsesym.rot = sesymprevsym
        sesymprev.next = newsesym
        if (newsesym.vert.symedge === sesym) newsesym.vert.symedge = newsesym
        for (const id of se.edge.inputIds) e.inputIds.add(id)
        if (boundaryCountMap) {
            const count = boundaryCountMap.get(se.edge) ?? 0
            if (count !== 0 && !boundaryCountMap.has(e)) boundaryCountMap.set(e, count)
        }
        if (windingMap) {
            let winding = windingMap.get(se.edge) ?? 0
            if (winding !== 0) {
                if (se === se.edge.symedges[1]) winding = -winding
                if (!windingMap.has(e)) windingMap.set(e, winding)
            }
        }
        return e
    }

    /** `delete_edge` (:1211). */
    deleteEdge(se: SymEdge): void {
        const sesym = sym(se)
        const v1 = se.vert
        const v2 = sesym.vert
        const aface = se.face
        const bface = sesym.face
        const f = se.next!
        const h = prev(se)
        const i = sesym.next!
        const j = prev(sesym)
        const jsym = sym(j)
        const hsym = sym(h)
        const v1Isolated = i === se
        const v2Isolated = f === sesym
        if (!v1Isolated) {
            h.next = i
            i.rot = hsym
        }
        if (!v2Isolated) {
            j.next = f
            f.rot = jsym
        }
        if (!v1Isolated && !v2Isolated && aface !== bface) {
            for (let k: SymEdge = i; k !== f; k = k.next!) k.face = aface
        }
        if (v1Isolated) v1.symedge = null
        else if (v1.symedge === se) v1.symedge = i
        if (v2Isolated) v2.symedge = null
        else if (v2.symedge === sesym) v2.symedge = f
        se.next = se.rot = null
        sesym.next = sesym.rot = null
        if (!v1Isolated && !v2Isolated && aface !== bface) {
            bface.deleted = true
            if (this.outerFace === bface) this.outerFace = aface
        } else if (v1Isolated && v2Isolated) {
            if (aface === this.outerFace) {
                if (this.outerFace.symedge === se || this.outerFace.symedge === sesym) this.outerFace.symedge = null
            } else {
                aface.deleted = true
            }
        }
    }

    /** `get_vert_resolve_merge` (:314). */
    getVertResolveMerge(i: number): CDTVert {
        let v = this.verts[i]
        if (v.mergeToIndex !== -1) v = this.verts[v.mergeToIndex]
        return v
    }
}

/** `CDT_state<double>` (:324). */
interface CDTState {
    cdt: CDTArrangement
    inputVertNum: number
    visitCount: number
    faceEdgeOffset: number
    epsilon: number
    needIds: boolean
    edgeWindingMap?: Map<CDTEdge, number>
    polygonBoundaryCountMap?: Map<CDTEdge, number>
}

const outputUsesEvenoddHoles = (t: CDTOutputType) => t === CDTOutputType.INSIDE_WITH_HOLES || t === CDTOutputType.CONSTRAINTS_VALID_BMESH_WITH_HOLES
const outputUsesNonzeroHoles = (t: CDTOutputType) =>
    t === CDTOutputType.INSIDE_WITH_HOLES_NONZERO || t === CDTOutputType.CONSTRAINTS_VALID_BMESH_WITH_HOLES_NONZERO

/** `id_range_in_list` (:941). */
function idRangeInList(ids: Set<number>, start: number, end: number): boolean {
    for (const id of ids) if (id >= start && id <= end) return true
    return false
}

const isConstrainedEdge = (e: CDTEdge) => e.inputIds.size > 0
const isDeletedEdge = (e: CDTEdge) => e.symedges[0].next === null

/** `find_symedge_between_verts` (:989). */
function findSymedgeBetweenVerts(v1: CDTVert, v2: CDTVert): SymEdge | null {
    const tstart = v1.symedge!
    let t = tstart
    do {
        if (t.next!.vert === v2) return t
    } while ((t = t.rot!) !== tstart)
    return null
}

/** `find_symedge_with_face` (:1004). */
function findSymedgeWithFace(v: CDTVert, f: CDTFace): SymEdge | null {
    const tstart = v.symedge!
    let t = tstart
    do {
        if (t.face === f) return t
    } while ((t = t.rot!) !== tstart)
    return null
}

const existsEdge = (v1: CDTVert, v2: CDTVert) => findSymedgeBetweenVerts(v1, v2) !== null

/** `vert_touches_face` (:1027). */
function vertTouchesFace(v: CDTVert, f: CDTFace): boolean {
    let se = v.symedge!
    do {
        if (se.face === f) return true
    } while ((se = se.rot!) !== v.symedge)
    return false
}

// region initial triangulation (:1284-1613)

interface SiteInfo {
    v: CDTVert
    origIndex: number
}

/** `site_lexicographic_sort` (:1293). */
function siteCompare(a: SiteInfo, b: SiteInfo): number {
    const ca = a.v.co, cb = b.v.co
    if (ca[0] < cb[0]) return -1
    if (ca[0] > cb[0]) return 1
    if (ca[1] < cb[1]) return -1
    if (ca[1] > cb[1]) return 1
    return a.origIndex < b.origIndex ? -1 : a.origIndex > b.origIndex ? 1 : 0
}

/** `find_site_merges` (:1317). */
function findSiteMerges(sites: SiteInfo[]): void {
    const n = sites.length
    for (let i = 0; i < n - 1; ++i) {
        let j = i + 1
        while (j < n && sites[j].v.co[0] === sites[i].v.co[0] && sites[j].v.co[1] === sites[i].v.co[1]) {
            sites[j].v.mergeToIndex = sites[i].origIndex
            ++j
        }
        if (j - i > 1) i = j - 1
    }
}

const vertLeftOfSymedge = (v: CDTVert, se: SymEdge) => filteredOrient2d(v.co, se.vert.co, se.next!.vert.co) > 0
const vertRightOfSymedge = (v: CDTVert, se: SymEdge) => filteredOrient2d(v.co, se.next!.vert.co, se.vert.co) > 0
const dcTriValid = (se: SymEdge, basel: SymEdge, baselSym: SymEdge) => filteredOrient2d(se.next!.vert.co, baselSym.vert.co, basel.vert.co) > 0

/** `dc_tri` (:1356): returns `[r_le, r_re]`. */
function dcTri(cdt: CDTArrangement, sites: SiteInfo[], start: number, end: number): [SymEdge | null, SymEdge | null] {
    const n = end - start
    if (n <= 1) return [null, null]
    if (n <= 3) {
        const v1 = sites[start].v
        const v2 = sites[start + 1].v
        const ea = cdt.addEdge(v1, v2, cdt.outerFace, cdt.outerFace)
        ea.symedges[0].next = ea.symedges[1]
        ea.symedges[1].next = ea.symedges[0]
        ea.symedges[0].rot = ea.symedges[0]
        ea.symedges[1].rot = ea.symedges[1]
        if (n === 2) return [ea.symedges[0], ea.symedges[1]]
        const v3 = sites[start + 2].v
        const eb = cdt.addVertToSymedgeEdge(v3, ea.symedges[1])
        const orient = filteredOrient2d(v1.co, v2.co, v3.co)
        if (orient > 0) {
            cdt.addDiagonal(eb.symedges[0], ea.symedges[0])
            return [ea.symedges[0], eb.symedges[0]]
        }
        if (orient < 0) {
            cdt.addDiagonal(ea.symedges[0], eb.symedges[0])
            return [ea.symedges[0].rot, eb.symedges[0].rot]
        }
        return [ea.symedges[0], eb.symedges[0]]
    }
    const n2 = Math.trunc(n / 2)
    let [ldo, ldi] = dcTri(cdt, sites, start, start + n2) as [SymEdge, SymEdge]
    let [rdi, rdo] = dcTri(cdt, sites, start + n2, end) as [SymEdge, SymEdge]
    for (;;) {
        if (vertLeftOfSymedge(rdi.vert, ldi)) ldi = ldi.next!
        else if (vertRightOfSymedge(ldi.vert, rdi)) rdi = sym(rdi).rot!
        else break
    }
    let ebasel = cdt.connectSeparateParts(sym(rdi).next!, ldi)
    let basel = ebasel.symedges[0]
    let baselSym = ebasel.symedges[1]
    if (ldi.vert === ldo.vert) ldo = baselSym
    if (rdi.vert === rdo.vert) rdo = basel
    for (;;) {
        let lcand = baselSym.rot!
        let rcand = baselSym.next!
        if (dcTriValid(lcand, basel, baselSym)) {
            while (filteredIncircle(baselSym.vert.co, basel.vert.co, lcand.next!.vert.co, lcand.rot!.next!.vert.co) > 0) {
                const t = lcand.rot!
                cdt.deleteEdge(sym(lcand))
                lcand = t
            }
        }
        if (dcTriValid(rcand, basel, baselSym)) {
            while (filteredIncircle(baselSym.vert.co, basel.vert.co, rcand.next!.vert.co, sym(rcand).next!.next!.vert.co) > 0) {
                const t = sym(rcand).next!
                cdt.deleteEdge(rcand)
                rcand = t
            }
        }
        const validL = dcTriValid(lcand, basel, baselSym)
        const validR = dcTriValid(rcand, basel, baselSym)
        if (!validL && !validR) break
        if (!validL || (validR && filteredIncircle(lcand.next!.vert.co, lcand.vert.co, rcand.vert.co, rcand.next!.vert.co) > 0)) {
            ebasel = cdt.addDiagonal(rcand.next!, baselSym)
        } else {
            ebasel = cdt.addDiagonal(baselSym.next!, sym(lcand))
        }
        basel = ebasel.symedges[0]
        baselSym = ebasel.symedges[1]
    }
    return [ldo, rdo]
}

/** `dc_triangulate` (:1559): drops merged sites first. */
function dcTriangulate(cdt: CDTArrangement, sites: SiteInfo[]): void {
    let i = 0, j = 0
    const nsites = sites.length
    while (j < nsites) {
        sites[i] = sites[j++]
        if (sites[i].v.mergeToIndex < 0) i++
    }
    const n = i
    if (n === 0) return
    dcTri(cdt, sites, 0, n)
}

/** `initial_triangulation` (:1599). */
function initialTriangulation(cdt: CDTArrangement): void {
    const n = cdt.verts.length
    if (n <= 1) return
    const sites: SiteInfo[] = cdt.verts.map((v, i) => ({v, origIndex: i}))
    sites.sort(siteCompare)
    findSiteMerges(sites)
    dcTriangulate(cdt, sites)
}

/** `re_delaunay_triangulate` (:1622). */
function reDelaunayTriangulate(cdt: CDTArrangement, se: SymEdge): void {
    if (se.face === cdt.outerFace || sym(se).face === cdt.outerFace) return
    let count = 1
    for (let ss = se.next!; ss !== se; ss = ss.next!) count++
    if (count <= 3) return
    const first = se.next!.next!
    const a = se.vert
    const b = se.next!.vert
    let c = first.vert
    let cse = first
    for (let ss = first.next!; ss !== se; ss = ss.next!) {
        const v = ss.vert
        if (filteredIncircle(a.co, b.co, c.co, v.co) > 0) {
            c = v
            cse = ss
        }
    }
    let ebc: CDTEdge | null = null
    let eca: CDTEdge | null = null
    if (!existsEdge(b, c)) ebc = cdt.addDiagonal(se.next!, cse)
    if (!existsEdge(c, a)) eca = cdt.addDiagonal(cse, se)
    if (ebc) reDelaunayTriangulate(cdt, ebc.symedges[1])
    if (eca) reDelaunayTriangulate(cdt, eca.symedges[1])
}

// endregion

// region edge constraints (:1668-2248)

const triOrient = (t: SymEdge) => filteredOrient2d(t.vert.co, t.next!.vert.co, t.next!.next!.vert.co)

/** `CrossData` (:1698). */
interface CrossData {
    lambda: number
    vert: CDTVert | null
    in: SymEdge | null
    out: SymEdge | null
}

const crossData = (lambda = 0, vert: CDTVert | null = null, i: SymEdge | null = null, o: SymEdge | null = null): CrossData => ({lambda, vert, in: i, out: o})

function assignCross(dst: CrossData, src: CrossData): void {
    dst.lambda = src.lambda
    dst.vert = src.vert
    dst.in = src.in
    dst.out = src.out
}

/** `fill_crossdata_for_through_vert` (:1755). */
function fillCrossdataForThroughVert(v: CDTVert, cdOut: SymEdge, cd: CrossData, cdNext: CrossData): void {
    cdNext.lambda = 0
    cdNext.vert = v
    cdNext.in = null
    cdNext.out = null
    if (cd.lambda === 0) {
        cd.out = cdOut
    } else {
        let se = sym(cd.in!)
        if (se.vert !== v) {
            se = se.next!
            if (se.vert !== v) se = se.next!
        }
        cdNext.in = se
    }
}

/** `fill_crossdata_for_intersect` (:1797). */
function fillCrossdataForIntersect(curco: V2, v2: CDTVert, t: SymEdge, cd: CrossData, cdNext: CrossData, epsilon: number): void {
    const va = t.vert
    const vb = t.next!.vert
    const seVcvb = sym(t.next!)
    const seVcva = t.next!.next!
    const isect = isectSegSeg(va.co, vb.co, curco, v2.co)
    const lambda = isect.lambda
    switch (isect.kind) {
    case Isect.CROSS: {
        const lenAb = distance(va.co, vb.co)
        if (lambda * lenAb <= epsilon) {
            fillCrossdataForThroughVert(va, seVcva, cd, cdNext)
        } else if ((1 - lambda) * lenAb <= epsilon) {
            fillCrossdataForThroughVert(vb, seVcvb, cd, cdNext)
        } else {
            assignCross(cdNext, crossData(lambda, null, t, null))
            if (cd.lambda === 0) cd.out = seVcva
        }
        break
    }
    case Isect.EXACT:
        if (lambda === 0) fillCrossdataForThroughVert(va, seVcva, cd, cdNext)
        else if (lambda === 1) fillCrossdataForThroughVert(vb, seVcvb, cd, cdNext)
        else {
            assignCross(cdNext, crossData(lambda, null, t, null))
            if (cd.lambda === 0) cd.out = seVcva
        }
        break
    case Isect.NONE:
        if (lambda <= 0.5) fillCrossdataForThroughVert(va, seVcva, cd, cdNext)
        else fillCrossdataForThroughVert(vb, seVcvb, cd, cdNext)
        break
    case Isect.COLINEAR:
        if (distanceSquared(va.co, v2.co) <= distanceSquared(vb.co, v2.co)) fillCrossdataForThroughVert(va, seVcva, cd, cdNext)
        else fillCrossdataForThroughVert(vb, seVcvb, cd, cdNext)
        break
    }
}

/** `get_next_crossing_from_vert` (:1897). */
function getNextCrossingFromVert(state: CDTState, cd: CrossData, cdNext: CrossData, v2: CDTVert): boolean {
    const tstart = cd.vert!.symedge!
    let t = tstart
    const vcur = cd.vert!
    let ok = false
    do {
        if (t.face !== state.cdt.outerFace && triOrient(t) < 0) {
            // `BLI_assert(false)`: "Shouldn't happen".
        }
        const va = t.next!.vert
        const vb = t.next!.next!.vert
        const orient1 = filteredOrient2d(t.vert.co, va.co, v2.co)
        if (orient1 === 0 && inLine(vcur.co, va.co, v2.co)) {
            fillCrossdataForThroughVert(va, t, cd, cdNext)
            ok = true
            break
        }
        if (t.face !== state.cdt.outerFace) {
            const orient2 = filteredOrient2d(vcur.co, vb.co, v2.co)
            if (orient1 > 0 && orient2 < 0) {
                t = t.next!
                fillCrossdataForIntersect(vcur.co, v2, t, cd, cdNext, state.epsilon)
                ok = true
                break
            }
        }
    } while ((t = t.rot!) !== tstart)
    return ok
}

/** `get_next_crossing_from_edge` (:1948). */
function getNextCrossingFromEdge(cd: CrossData, cdNext: CrossData, v2: CDTVert, epsilon: number): void {
    const va = cd.in!.vert
    const vb = cd.in!.next!.vert
    const curco = interpolate(va.co, vb.co, cd.lambda)
    const seAc = sym(cd.in!).next!
    const vc = seAc.next!.vert
    const orient = filteredOrient2d(curco, v2.co, vc.co)
    if (orient < 0) fillCrossdataForIntersect(curco, v2, seAc.next!, cd, cdNext, epsilon)
    else if (orient > 0) fillCrossdataForIntersect(curco, v2, seAc, cd, cdNext, epsilon)
    else assignCross(cdNext, crossData(0, vc, seAc.next!, null))
}

/** `add_edge_constraint` (:2003): the edges making up the constraint, in order, when `rEdges` is wanted. */
function addEdgeConstraint(state: CDTState, v1: CDTVert, v2: CDTVert, inputId: number, rEdges: CDTEdge[] | undefined): void {
    if (v1 === v2) return
    let t: SymEdge | null = findSymedgeBetweenVerts(v1, v2)
    if (t !== null) {
        t.edge.inputIds.add(inputId)
        rEdges?.push(t.edge)
        return
    }
    const visit = ++state.visitCount
    const crossings: CrossData[] = [crossData(0, v1, null, null)]
    let n: number
    while (!((n = crossings.length) > 0 && crossings[n - 1].vert === v2)) {
        crossings.push(crossData())
        const cd = crossings[n - 1]
        const cdNext = crossings[n]
        let ok: boolean
        if (crossings[n - 1].lambda === 0) {
            ok = getNextCrossingFromVert(state, cd, cdNext, v2)
        } else {
            getNextCrossingFromEdge(cd, cdNext, v2, state.epsilon)
            ok = true
        }
        const unreasonablyLargeCrossings = 100000
        if (!ok || crossings.length === unreasonablyLargeCrossings) {
            // `BLI_assert(false); return;`: the constraint is dropped.
            return
        }
        if (crossings[n].lambda === 0) {
            if (crossings[n].vert!.visitIndex === visit) return
            crossings[n].vert!.visitIndex = visit
        }
    }
    const ncrossings = crossings.length
    for (let i = 2; i < ncrossings; ++i) {
        const cd = crossings[i]
        if (cd.lambda === 0) {
            const v = cd.vert!
            let j: number
            let cdPrev: CrossData
            for (j = i - 1; j > 0; --j) {
                cdPrev = crossings[j]
                if ((cdPrev.lambda === 0 && cdPrev.vert !== v) || (cdPrev.lambda !== 0 && cdPrev.in!.vert !== v && cdPrev.in!.next!.vert !== v)) break
                cdPrev.lambda = -1
            }
            if (j < i - 1) {
                cdPrev = crossings[j]
                let se: SymEdge | null
                if (cdPrev.lambda === 0) {
                    se = findSymedgeBetweenVerts(cdPrev.vert!, v)
                    if (se === null) return
                    cdPrev.out = se
                    cd.in = null
                } else {
                    se = findSymedgeWithFace(v, sym(cdPrev.in!).face)
                    if (se === null) return
                    cd.in = se
                }
            }
        }
    }
    for (let i = 0; i < ncrossings; ++i) {
        const cd = crossings[i]
        if (cd.lambda !== 0 && cd.lambda !== -1 && isConstrainedEdge(cd.in!.edge)) {
            const edge = state.cdt.splitEdge(cd.in!, cd.lambda, state.edgeWindingMap, state.polygonBoundaryCountMap)
            cd.vert = edge.symedges[0].vert
        }
    }
    for (let i = 0; i < ncrossings; ++i) {
        const cd = crossings[i]
        if (cd.lambda !== 0 && cd.lambda !== -1 && !isConstrainedEdge(cd.in!.edge)) state.cdt.deleteEdge(cd.in!)
    }
    let tstart = crossings[0].out!
    for (let i = 1; i < ncrossings; i++) {
        const cd = crossings[i]
        if (cd.lambda === -1) continue
        t = null
        let tnext: SymEdge | null = t
        let edge: CDTEdge
        if (cd.lambda !== 0) {
            if (isConstrainedEdge(cd.in!.edge)) {
                t = cd.vert!.symedge
                tnext = sym(t!).next
            }
        } else if (cd.lambda === 0) {
            t = cd.in
            tnext = cd.out
            if (t === null) {
                let j: number
                let cdPrev: CrossData | undefined
                for (j = i - 1; j >= 0; j--) {
                    cdPrev = crossings[j]
                    if (cdPrev.lambda !== -1) break
                }
                edge = cdPrev!.out!.edge
                edge.inputIds.add(inputId)
                rEdges?.push(edge)
            }
        }
        if (t !== null) {
            if (tstart.next!.vert === t.vert) edge = tstart.edge
            else edge = state.cdt.addDiagonal(tstart, t)
            edge.inputIds.add(inputId)
            rEdges?.push(edge)
            reDelaunayTriangulate(state.cdt, edge.symedges[0])
            reDelaunayTriangulate(state.cdt, edge.symedges[1])
        }
        if (i < ncrossings - 1) {
            if (tnext !== null) tstart = tnext
        }
    }
}

/** `add_edge_constraints` (:2229). */
function addEdgeConstraints(state: CDTState, input: CDTInput): void {
    const ne = input.edge.length
    const nv = input.vert.length
    for (let i = 0; i < ne; i++) {
        const [iv1, iv2] = input.edge[i]
        if (iv1 < 0 || iv1 >= nv || iv2 < 0 || iv2 >= nv) continue
        const v1 = state.cdt.getVertResolveMerge(iv1)
        const v2 = state.cdt.getVertResolveMerge(iv2)
        addEdgeConstraint(state, v1, v2, state.needIds ? i : 0, undefined)
    }
    state.faceEdgeOffset = ne
}

/** `add_face_ids` (:2269). */
function addFaceIds(state: CDTState, faceSymedge: SymEdge, faceId: number, fedgeStart: number, fedgeEnd: number): void {
    state.visitCount++
    const visit = state.visitCount
    const stack: SymEdge[] = [faceSymedge]
    while (stack.length) {
        let se = stack.pop()!
        const face = se.face
        if (face.visitIndex === visit) continue
        face.visitIndex = visit
        face.inputIds.add(faceId)
        const seStart = se
        for (se = se.next!; se !== seStart; se = se.next!) {
            if (!idRangeInList(se.edge.inputIds, fedgeStart, fedgeEnd)) {
                const seSym = sym(se)
                if (seSym.face.visitIndex !== visit) stack.push(seSym)
            }
        }
    }
}

/** `add_face_constraints` (:2327). */
function addFaceConstraints(state: CDTState, input: CDTInput, outputType: CDTOutputType, needWinding: boolean): number {
    const nv = input.vert.length
    const faces = input.face
    let faceSymedge0: SymEdge | null = null
    const cdt = state.cdt
    let maxflen = 0
    for (const f of faces) maxflen = Math.max(maxflen, f.length)
    state.faceEdgeOffset = Math.max(maxflen, state.faceEdgeOffset)
    let facesAdded = 0
    for (let f = 0; f < faces.length; f++) {
        const face = faces[f]
        if (face.length <= 2) continue
        const fedgeStart = (f + 1) * state.faceEdgeOffset
        for (let i = 0; i < face.length; i++) {
            const faceEdgeId = fedgeStart + i
            const iv1 = face[i]
            const iv2 = face[(i + 1) % face.length]
            if (iv1 < 0 || iv1 >= nv || iv2 < 0 || iv2 >= nv) continue
            ++facesAdded
            const v1 = cdt.getVertResolveMerge(iv1)
            const v2 = cdt.getVertResolveMerge(iv2)
            const edgeList: CDTEdge[] = []
            addEdgeConstraint(state, v1, v2, faceEdgeId, edgeList)
            if (edgeList.length) {
                const faceEdge = edgeList[0]
                faceSymedge0 = faceEdge.symedges[0]
                if (faceSymedge0.vert !== v1) faceSymedge0 = faceEdge.symedges[1]
                if (state.polygonBoundaryCountMap || needWinding) {
                    let currVert = v1
                    for (const e of edgeList) {
                        let nextVert: CDTVert
                        let windingDelta: number
                        if (e.symedges[0].vert === currVert) {
                            nextVert = e.symedges[1].vert
                            windingDelta = 1
                        } else {
                            nextVert = e.symedges[0].vert
                            windingDelta = -1
                        }
                        if (state.polygonBoundaryCountMap) state.polygonBoundaryCountMap.set(e, (state.polygonBoundaryCountMap.get(e) ?? 0) + 1)
                        if (needWinding) state.edgeWindingMap!.set(e, (state.edgeWindingMap!.get(e) ?? 0) + windingDelta)
                        currVert = nextVert
                    }
                }
            }
        }
        const fedgeEnd = fedgeStart + face.length - 1
        if (faceSymedge0 !== null) {
            if (state.needIds || outputType === CDTOutputType.CONSTRAINTS_VALID_BMESH) {
                addFaceIds(state, faceSymedge0, state.needIds ? f : 0, fedgeStart, fedgeEnd)
            }
        }
    }
    return facesAdded
}

// endregion

// region output preparation (:2444-3171)

/** `dissolve_symedge` (:2444). */
function dissolveSymedge(state: CDTState, se: SymEdge): void {
    const cdt = state.cdt
    let symse = sym(se)
    if (symse.face === cdt.outerFace) {
        se = sym(se)
        symse = sym(se)
    }
    if (cdt.outerFace.symedge === se || cdt.outerFace.symedge === symse) {
        if (se.next!.next === se) cdt.outerFace.symedge = null
        else cdt.outerFace.symedge = se.next!.next
    } else {
        const v1Isolated = symse.next === se
        const v2Isolated = se.next === symse
        if (se.face.symedge === se) se.face.symedge = v2Isolated ? prev(se) : se.next
        if (symse.face.symedge === symse) symse.face.symedge = v1Isolated ? prev(symse) : symse.next
    }
    cdt.deleteEdge(se)
}

/** `remove_non_constraint_edges` (:2485). */
function removeNonConstraintEdges(state: CDTState): void {
    for (const e of state.cdt.edges) {
        const se = e.symedges[0]
        if (!isDeletedEdge(e) && !isConstrainedEdge(e)) dissolveSymedge(state, se)
    }
}

/** `remove_non_constraint_edges_leave_valid_bmesh` (:2543). */
function removeNonConstraintEdgesLeaveValidBmesh(state: CDTState, useHoleStatus: boolean): void {
    const cdt = state.cdt
    if (cdt.edges.length === 0) return
    const dissolvable: {lenSquared: number, e: CDTEdge}[] = []
    for (const e of cdt.edges) {
        if (!isDeletedEdge(e) && !isConstrainedEdge(e)) {
            dissolvable.push({e, lenSquared: distanceSquared(e.symedges[0].vert.co, e.symedges[1].vert.co)})
        }
    }
    const edgeVerts = (e: CDTEdge): [number, number] => {
        const v0 = e.symedges[0].vert.index, v1 = e.symedges[1].vert.index
        return v0 < v1 ? [v0, v1] : [v1, v0]
    }
    dissolvable.sort((a, b) => {
        if (a.lenSquared !== b.lenSquared) return a.lenSquared < b.lenSquared ? -1 : 1
        const av = edgeVerts(a.e), bv = edgeVerts(b.e)
        if (av[0] !== bv[0]) return av[0] < bv[0] ? -1 : 1
        return av[1] < bv[1] ? -1 : av[1] > bv[1] ? 1 : 0
    })
    const isOutputFace = (f: CDTFace) => (useHoleStatus ? !f.hole : f.inputIds.size !== 0)
    for (const ets of dissolvable) {
        const se = ets.e.symedges[0]
        let dissolve = true
        const fleft = se.face
        const fright = sym(se).face
        if (fleft !== cdt.outerFace && fright !== cdt.outerFace && (isOutputFace(fleft) || isOutputFace(fright))) {
            for (let se2 = se.next!; dissolve && se2 !== se; se2 = se2.next!) {
                if (sym(se2).face === fright || (se2.vert !== se.next!.vert && vertTouchesFace(se2.vert, fright))) dissolve = false
            }
        }
        if (dissolve) dissolveSymedge(state, se)
    }
}

/** `remove_outer_edges_until_constraints` (:2610). */
function removeOuterEdgesUntilConstraints(state: CDTState): void {
    const visit = ++state.visitCount
    state.cdt.outerFace.visitIndex = visit
    const fstack: CDTFace[] = []
    let seStart = state.cdt.outerFace.symedge!
    let se = seStart
    do {
        if (!isConstrainedEdge(se.edge)) {
            const fsym = sym(se).face
            if (fsym.visitIndex !== visit) fstack.push(fsym)
        }
    } while ((se = se.next!) !== seStart)
    while (fstack.length) {
        // `BLI_linklist_prepend` + `BLI_linklist_pop`: the edges are dissolved in reverse order of collection.
        const toDissolve: SymEdge[] = []
        const f = fstack.pop()!
        if (f.visitIndex === visit) continue
        f.visitIndex = visit
        seStart = se = f.symedge!
        do {
            const dissolvable = !isConstrainedEdge(se.edge)
            if (dissolvable) {
                const fsym = sym(se).face
                if (fsym.visitIndex !== visit) fstack.push(fsym)
                else toDissolve.unshift(se)
            }
            se = se.next!
        } while (se !== seStart)
        while (toDissolve.length) {
            se = toDissolve.shift()!
            if (se.next !== null) dissolveSymedge(state, se)
        }
    }
}

/** `remove_faces_in_holes` (:2660). */
function removeFacesInHoles(state: CDTState): void {
    for (const f of state.cdt.faces) {
        if (!f.deleted && f.hole) {
            f.deleted = true
            let se = f.symedge!
            const seStart = se
            let seNext: SymEdge
            do {
                seNext = se.next!
                if (se.edge && !isConstrainedEdge(se.edge)) se.next = null
                se = seNext
            } while (se !== seStart)
        }
    }
}

const VISIT_INDEX_UNVISITED = -1
const VISIT_INDEX_OUTER_FACE = -2

/**
 * `flood_fill_region_values` (:2712). The adjacency comes from a `Map<int2, Value>` in Blender (hash order); for
 * values that are consistent around every cycle (parities, winding numbers) the result does not depend on the order.
 */
function floodFillRegionValues(regionPairValue: Map<string, number>, regionValue: number[], unset: number, combine: (cur: number, v: number) => number): void {
    const adjacency: {neighbor: number, value: number}[][] = regionValue.map(() => [])
    for (const [key, value] of regionPairValue) {
        const [src, dst] = key.split(',').map(Number)
        adjacency[src].push({neighbor: dst, value})
    }
    const stack: number[] = []
    for (let r = 0; r < regionValue.length; r++) if (regionValue[r] !== unset) stack.push(r)
    while (stack.length) {
        const region = stack.pop()!
        const cur = regionValue[region]
        for (const re of adjacency[region]) {
            if (regionValue[re.neighbor] === unset) {
                regionValue[re.neighbor] = combine(cur, re.value)
                stack.push(re.neighbor)
            }
        }
    }
}

/** `detect_holes_with_fillrule_even_odd` (:2772). */
function detectHolesWithFillruleEvenOdd(state: CDTState): void {
    const cdt = state.cdt
    const boundaryCount = state.polygonBoundaryCountMap!
    const boundaryRegions: {region: number, parity: number}[] = []
    const fstack: CDTFace[] = []
    for (const f of cdt.faces) f.visitIndex = VISIT_INDEX_UNVISITED
    cdt.outerFace.visitIndex = VISIT_INDEX_OUTER_FACE
    let curRegion = -1
    for (const fInit of cdt.faces) {
        if (fInit.deleted || !fInit.symedge || fInit.visitIndex !== VISIT_INDEX_UNVISITED) continue
        curRegion++
        fInit.visitIndex = curRegion
        fstack.push(fInit)
        let outerParity = -1
        while (fstack.length) {
            const f = fstack.pop()!
            const seStart = f.symedge!
            let se = seStart
            do {
                if (!se.edge) continue
                const neighbor = sym(se).face
                if (!neighbor) continue
                const constrained = isConstrainedEdge(se.edge)
                if (neighbor === cdt.outerFace) {
                    const flip = (boundaryCount.get(se.edge) ?? 0) & 1
                    if (outerParity === -1) outerParity = flip
                    else if (outerParity !== flip) outerParity = 1
                } else if (!constrained && !neighbor.deleted && neighbor.visitIndex === VISIT_INDEX_UNVISITED) {
                    neighbor.visitIndex = curRegion
                    fstack.push(neighbor)
                }
            } while ((se = se.next!) !== seStart)
        }
        if (outerParity !== -1) boundaryRegions.push({region: curRegion, parity: outerParity})
    }
    const numRegions = ++curRegion
    state.visitCount = numRegions
    if (numRegions === 0) return
    const regionPairFlip = new Map<string, number>()
    for (const e of cdt.edges) {
        if (isDeletedEdge(e) || !isConstrainedEdge(e)) continue
        const r0 = e.symedges[0].face.visitIndex, r1 = e.symedges[1].face.visitIndex
        if (r0 === r1 || r0 < 0 || r1 < 0) continue
        const flip = (boundaryCount.get(e) ?? 0) & 1
        // `Map::add` keeps the first value of a key.
        if (!regionPairFlip.has(`${r0},${r1}`)) regionPairFlip.set(`${r0},${r1}`, flip)
        if (!regionPairFlip.has(`${r1},${r0}`)) regionPairFlip.set(`${r1},${r0}`, flip)
    }
    const regionParity = new Array<number>(numRegions).fill(-1)
    for (const info of boundaryRegions) if (regionParity[info.region] === -1) regionParity[info.region] = info.parity
    floodFillRegionValues(regionPairFlip, regionParity, -1, (cur, flip) => cur ^ flip)
    for (const f of cdt.faces) {
        const region = f.visitIndex
        if (region >= 0) f.hole = regionParity[region] !== 1
    }
}

const INT_MIN = -2147483648

/** `detect_holes_with_fillrule_nonzero` (:2934). */
function detectHolesWithFillruleNonzero(state: CDTState): void {
    const cdt = state.cdt
    const boundaryRegions: {region: number, winding: number}[] = []
    const fstack: CDTFace[] = []
    for (const f of cdt.faces) f.visitIndex = VISIT_INDEX_UNVISITED
    cdt.outerFace.visitIndex = VISIT_INDEX_OUTER_FACE
    let curRegion = -1
    for (const fInit of cdt.faces) {
        if (fInit.deleted || !fInit.symedge || fInit.visitIndex !== VISIT_INDEX_UNVISITED) continue
        curRegion++
        fInit.visitIndex = curRegion
        fstack.push(fInit)
        let foundConstrainedOuter = false, foundAnyOuter = false
        let outerWinding = 0
        while (fstack.length) {
            const f = fstack.pop()!
            const seStart = f.symedge!
            let se = seStart
            do {
                if (!se.edge) continue
                const neighbor = sym(se).face
                if (!neighbor) continue
                if (isConstrainedEdge(se.edge)) {
                    if (neighbor === cdt.outerFace && !foundConstrainedOuter) {
                        foundConstrainedOuter = true
                        foundAnyOuter = true
                        const winding = state.edgeWindingMap!.get(se.edge) ?? 0
                        outerWinding = se.edge.symedges[0] === se ? winding : -winding
                    }
                } else if (neighbor === cdt.outerFace) {
                    foundAnyOuter = true
                } else if (!neighbor.deleted && neighbor.visitIndex === VISIT_INDEX_UNVISITED) {
                    neighbor.visitIndex = curRegion
                    fstack.push(neighbor)
                }
            } while ((se = se.next!) !== seStart)
        }
        if (foundAnyOuter) boundaryRegions.push({region: curRegion, winding: outerWinding})
    }
    const numRegions = ++curRegion
    state.visitCount = numRegions
    if (numRegions === 0) return
    const regionPairWinding = new Map<string, number>()
    for (const e of cdt.edges) {
        if (isDeletedEdge(e) || !isConstrainedEdge(e)) continue
        const r0 = e.symedges[0].face.visitIndex, r1 = e.symedges[1].face.visitIndex
        if (r0 === r1 || r0 < 0 || r1 < 0) continue
        const winding = state.edgeWindingMap!.get(e) ?? 0
        if (!regionPairWinding.has(`${r0},${r1}`)) regionPairWinding.set(`${r0},${r1}`, -winding)
        if (!regionPairWinding.has(`${r1},${r0}`)) regionPairWinding.set(`${r1},${r0}`, winding)
    }
    const regionWinding = new Array<number>(numRegions).fill(INT_MIN)
    for (const info of boundaryRegions) if (regionWinding[info.region] === INT_MIN) regionWinding[info.region] = info.winding
    floodFillRegionValues(regionPairWinding, regionWinding, INT_MIN, (cur, delta) => cur + delta)
    for (const f of cdt.faces) {
        const region = f.visitIndex
        if (region >= 0) {
            const winding = regionWinding[region]
            f.hole = winding === 0 || winding === INT_MIN
        }
    }
}

/** `prepare_cdt_for_output` (:3123). */
function prepareCdtForOutput(state: CDTState, outputType: CDTOutputType): void {
    const cdt = state.cdt
    if (cdt.edges.length === 0) return
    for (const e of cdt.edges) {
        if (!isDeletedEdge(e)) {
            if (e.symedges[0].face.symedge === null) e.symedges[0].face.symedge = e.symedges[0]
            if (e.symedges[1].face.symedge === null) e.symedges[1].face.symedge = e.symedges[1]
        }
    }
    if (outputUsesEvenoddHoles(outputType)) detectHolesWithFillruleEvenOdd(state)
    else if (outputUsesNonzeroHoles(outputType)) detectHolesWithFillruleNonzero(state)
    switch (outputType) {
    case CDTOutputType.CONSTRAINTS: removeNonConstraintEdges(state); break
    case CDTOutputType.CONSTRAINTS_VALID_BMESH: removeNonConstraintEdgesLeaveValidBmesh(state, false); break
    case CDTOutputType.INSIDE: removeOuterEdgesUntilConstraints(state); break
    case CDTOutputType.INSIDE_WITH_HOLES:
    case CDTOutputType.INSIDE_WITH_HOLES_NONZERO:
        removeOuterEdgesUntilConstraints(state)
        removeFacesInHoles(state)
        break
    case CDTOutputType.CONSTRAINTS_VALID_BMESH_WITH_HOLES:
    case CDTOutputType.CONSTRAINTS_VALID_BMESH_WITH_HOLES_NONZERO:
        removeOuterEdgesUntilConstraints(state)
        removeNonConstraintEdgesLeaveValidBmesh(state, true)
        removeFacesInHoles(state)
        break
    }
}

/** `get_cdt_output` (:3174). */
function getCdtOutput(state: CDTState, outputType: CDTOutputType): CDTResult {
    prepareCdtForOutput(state, outputType)
    const cdt = state.cdt
    const result: CDTResult = {vert: [], edge: [], face: [], faceEdgeOffset: state.faceEdgeOffset}
    const vertsSize = cdt.verts.length
    const vertToOutput = new Int32Array(vertsSize)
    let nv = 0
    for (let i = 0; i < vertsSize; ++i) if (cdt.verts[i].mergeToIndex === -1) vertToOutput[i] = nv++
    if (nv <= 0) return result
    if (nv < vertsSize) {
        for (let i = 0; i < vertsSize; ++i) {
            const v = cdt.verts[i]
            if (v.mergeToIndex !== -1) vertToOutput[i] = vertToOutput[v.mergeToIndex]
        }
    }
    for (const v of cdt.verts) if (v.mergeToIndex === -1) result.vert.push([v.co[0], v.co[1]])
    for (const e of cdt.edges) if (!isDeletedEdge(e)) result.edge.push([vertToOutput[e.symedges[0].vert.index], vertToOutput[e.symedges[1].vert.index]])
    for (const f of cdt.faces) {
        if (!f.deleted && f !== cdt.outerFace) {
            const face: number[] = []
            let se = f.symedge!
            const seStart = se
            do {
                face.push(vertToOutput[se.vert.index])
                se = se.next!
            } while (se !== seStart)
            result.face.push(face)
        }
    }
    return result
}

// endregion

/** `delaunay_calc` (:3300) / `delaunay_2d_calc(const CDT_input<double> &, CDT_output_type)` (:3336). */
export function delaunay2dCalc(input: CDTInput, outputType: CDTOutputType): CDTResult {
    if (input.needIds) throw new Error('delaunay_2d_calc: need_ids (vert/edge/face origins) is not ported')
    const cdt = new CDTArrangement()
    cdt.outerFace = cdt.addFace()
    const state: CDTState = {cdt, inputVertNum: input.vert.length, visitCount: 0, faceEdgeOffset: 0, epsilon: input.epsilon, needIds: input.needIds}
    const needWinding = outputUsesNonzeroHoles(outputType)
    if (needWinding) state.edgeWindingMap = new Map()
    if (outputUsesEvenoddHoles(outputType)) state.polygonBoundaryCountMap = new Map()
    for (let i = 0; i < state.inputVertNum; ++i) cdt.addVert(input.vert[i])
    initialTriangulation(cdt)
    addEdgeConstraints(state, input)
    const actualNf = addFaceConstraints(state, input, outputType, needWinding)
    if (actualNf === 0 && outputType !== CDTOutputType.FULL && outputType !== CDTOutputType.INSIDE && outputType !== CDTOutputType.CONSTRAINTS) {
        outputType = CDTOutputType.INSIDE
    }
    return getCdtOutput(state, outputType)
}

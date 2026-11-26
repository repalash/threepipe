/**
 * Subdividing edges and grid-filling the faces they cut.
 *
 * Ported from `source/blender/bmesh/operators/bmo_subdivide.cc` (`bmo_subdivide_edges_exec`,
 * `bm_subdivide_multicut`, `subdivide_edge_num`, `alter_co`, `connect_smallest_face`,
 * `tri_3edge_subdivide`) and `bmesh_query.cc` (`BM_vert_pair_share_face_by_len`).
 *
 * **This is a subset of Blender's operator, and deliberately so.** `bmo_subdivide_edges_exec`
 * dispatches over six fill patterns by matching each face's mask of split edges; the icosphere, which
 * is what needs it here, marks *every* edge of *every* face, so only `tri_3edge` can ever match and
 * the matcher reduces to the identity rotation it finds first. `alter_co` likewise is ported for its
 * `use_sphere` branch only - the smooth, fractal and shape-key branches have no caller yet. The other
 * five patterns and the other `alter_co` branches are missing, not approximated: adding a caller that
 * needs a quad pattern means porting that pattern, not stretching this one.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {splitEdgeMakeVert, splitFaceMakeEdge} from '../bmesh/euler'
import {Vec3} from '../math'

/**
 * Every loop that points at `v`, by walking each edge of its disk and each loop of that edge's
 * radial cycle. Blender's `BM_LOOPS_OF_VERT` iterator (`bmesh_iterators.cc`).
 *
 * A `bmesh_query.cc` helper, like the two below; it belongs in a query module when the kernel grows
 * one, the way `bmesh/walkers.ts` says of the queries it carries.
 */
function* loopsOfVert(v: BMVert): Generator<BMLoop> {
    if (!v.e) return
    let e: BMEdge = v.e
    do {
        if (e.l) {
            let l: BMLoop = e.l
            do {
                if (l.v === v) yield l
                l = l.radialNext!
            } while (l !== e.l)
        }
        e = e.diskNext(v)!
    } while (e !== v.e)
}

/** The loop of `f` at `v`, or null. Port of `BM_face_vert_share_loop`. */
function faceVertShareLoop(f: BMFace, v: BMVert): BMLoop | null {
    for (const l of f.eachLoop()) if (l.v === v) return l
    return null
}

/** Blender's `BM_loop_is_adjacent` (`bmesh_query_inline.hh:127`): are two loops of a face neighbours? */
function loopIsAdjacent(a: BMLoop, b: BMLoop): boolean {
    return b === a.next || b === a.prev
}

/**
 * The smallest face both vertices belong to, with the loop of each.
 *
 * Port of `BM_vert_pair_share_face_by_len` (`bmesh_query.cc:176`). "Smallest" matters: a vertex pair
 * can be shared by several faces once a grid fill is under way, and splitting the smallest is what
 * keeps `connect_smallest_face` cutting the cell it just made rather than the whole triangle again.
 */
export function vertPairShareFaceByLen(
    vA: BMVert, vB: BMVert, allowAdjacent: boolean,
): {f: BMFace, lA: BMLoop, lB: BMLoop} | null {
    let fCur: BMFace | null = null
    let lCurA: BMLoop | null = null
    let lCurB: BMLoop | null = null
    if (vA.e && vB.e) {
        for (const lA of loopsOfVert(vA)) {
            if (fCur === null || lA.f.len < fCur.len) {
                const lB = faceVertShareLoop(lA.f, vB)
                if (lB && (allowAdjacent || !loopIsAdjacent(lA, lB))) {
                    fCur = lA.f
                    lCurA = lA
                    lCurB = lB
                }
            }
        }
    }
    return fCur ? {f: fCur, lA: lCurA!, lB: lCurB!} : null
}

/** One cut: the new vertex, and the new edge `splitEdgeMakeVert` handed back. */
type SubdivideEdgeNum = (e: BMEdge, curPoint: number, totPoint: number) => {v: BMVert, e: BMEdge}

/**
 * Subdivide every edge of a set of triangles `numCuts` times, grid-fill the interiors, and project
 * every vertex the pass touches onto a sphere of `radius`.
 *
 * Port of `bmo_subdivide_edges_exec` (`bmo_subdivide.cc:905`) with `use_grid_fill` and `use_sphere`,
 * restricted to the `tri_3edge` pattern - see the note at the top of this file.
 *
 * Blender stages the altered coordinates in a temporary shape layer and copies them back after the
 * edge splits and again after the pattern fill, so that an interpolation later in the same pass reads
 * un-projected positions. `staged` is that layer: projecting as each vertex appears would make the
 * next split's midpoint a chord of the sphere rather than a midpoint of the original triangle.
 */
export function subdivideTrisOnSphere(
    bm: BMesh, edges: readonly BMEdge[], numCuts: number, radius: number,
): void {
    const staged = new Map<BMVert, Vec3>()

    /** `alter_co` with `use_sphere`: `normalize_v3_length(co, smooth)`. */
    const alterCo = (v: BMVert) => {
        const len = Math.hypot(v.x, v.y, v.z)
        staged.set(v, len > 0
            ? [v.x / len * radius, v.y / len * radius, v.z / len * radius]
            : [v.x, v.y, v.z])
    }
    const flushStaged = () => {
        for (const [v, co] of staged) v.setCo(co[0], co[1], co[2])
        staged.clear()
    }

    /** `subdivide_edge_num` composed with `bm_subdivide_edge_addvert`. */
    const subdivideEdgeNum: SubdivideEdgeNum = (e, curPoint, totPoint) => {
        const factorEdgeSplit = 1 / (totPoint + 1 - curPoint)
        const {vNew, eNew} = splitEdgeMakeVert(bm, e, e.v1, factorEdgeSplit)
        alterCo(vNew)
        return {v: vNew, e: eNew}
    }

    // Record which faces to fill, and where each one's vertex ordering starts, before any splitting:
    // once an edge is cut the face's loop cycle grows and `fd->start` is what recovers the order.
    const faceData: {face: BMFace, start: BMVert}[] = []
    const splitEdges = new Set(edges)
    for (const f of bm.faces) {
        if (f.len !== 3) continue
        let allSplit = true
        for (const l of f.eachLoop()) {
            if (!splitEdges.has(l.e!)) {
                allSplit = false
                break
            }
        }
        // `tri_3edge`'s mask is {1, 1, 1}; the first rotation to match is a = 0, so start = verts[0].
        if (allSplit) faceData.push({face: f, start: f.lFirst.v})
    }

    // `bm_subdivide_multicut` for every input edge. Blender keeps splitting the *same* edge object:
    // `BM_edge_split` hands the near half to the new edge and leaves the far half in `eed`, which
    // therefore walks along the original edge as the factor 1/(numcuts + 1 - i) shrinks it.
    for (const e of edges) {
        const v1 = e.v1
        const v2 = e.v2
        for (let i = 0; i < numCuts; i++) subdivideEdgeNum(e, i, numCuts)
        alterCo(v1)
        alterCo(v2)
    }
    flushStaged()

    for (const fd of faceData) triThreeEdgeSubdivide(bm, fd, numCuts, subdivideEdgeNum)
    flushStaged()
}

/**
 * Grid-fill one triangle whose three edges have each been cut `numCuts` times.
 * Port of `tri_3edge_subdivide` (`bmo_subdivide.cc:792`).
 */
export function triThreeEdgeSubdivide(
    bm: BMesh,
    fd: {face: BMFace, start: BMVert},
    numCuts: number,
    subdivideEdgeNum: SubdivideEdgeNum,
): void {
    // Blender's driver rebuilds `verts` from the face's loop cycle, starting one past `fd->start`.
    const face = fd.face
    const loops = [...face.eachLoop()]
    let a = 0
    for (let j = 0; j < loops.length; j++) {
        if (loops[j].v === fd.start) {
            a = j + 1
            break
        }
    }
    const verts: BMVert[] = new Array(loops.length)
    for (let j = 0; j < loops.length; j++) {
        verts[(j - a + loops.length) % loops.length] = loops[j].v
    }

    /**
     * Port of `connect_smallest_face` (`bmo_subdivide.cc:126`). Blender passes `allow_adjacent` and
     * then asserts the loops are not adjacent, so a split that would be degenerate is a bug in the
     * caller rather than something to swallow; `splitFaceMakeEdge` raises it.
     */
    const connectSmallestFace = (vA: BMVert, vB: BMVert): BMEdge | null => {
        const share = vertPairShareFaceByLen(vA, vB, true)
        if (!share) return null
        return splitFaceMakeEdge(bm, share.f, share.lA, share.lB).eNew
    }

    // Rows of the triangular grid; row 0 is the apex, row numCuts+1 the base.
    const lines: (BMVert | null)[][] = new Array(numCuts + 2)
    lines[0] = [verts[numCuts * 2 + 1]]

    lines[numCuts + 1] = new Array(numCuts + 2).fill(null)
    for (let i = 0; i < numCuts; i++) lines[numCuts + 1][i + 1] = verts[i]
    lines[numCuts + 1][0] = verts[numCuts * 3 + 2]
    lines[numCuts + 1][numCuts + 1] = verts[numCuts]

    for (let i = 0; i < numCuts; i++) {
        lines[i + 1] = new Array(2 + i).fill(null)
        const ai = numCuts * 2 + 2 + i
        const bi = numCuts + numCuts - i
        const e = connectSmallestFace(verts[ai], verts[bi])
        if (!e) return

        lines[i + 1][0] = verts[ai]
        lines[i + 1][i + 1] = verts[bi]

        // As in `bm_subdivide_multicut`, the same edge is split repeatedly and walks along itself.
        for (let j = 0; j < i; j++) lines[i + 1][j + 1] = subdivideEdgeNum(e, j, i).v
    }

    for (let i = 1; i <= numCuts; i++) {
        for (let j = 0; j < i; j++) {
            connectSmallestFace(lines[i][j]!, lines[i + 1][j + 1]!)
            connectSmallestFace(lines[i][j + 1]!, lines[i + 1][j + 1]!)
        }
    }
}

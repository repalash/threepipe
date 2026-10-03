/**
 * Connect a pair of vertices by splitting faces along the shortest path between them -
 * `bmesh.ops.connect_vert_pair`, what Vertex Connect does for two vertices that share no face and what
 * Vertex Connect Path (J) runs for each consecutive pair.
 *
 * Ported from `source/blender/bmesh/operators/bmo_connect_pair.cc` (all of it). Blender's description
 * of the method (`:26`):
 *
 * - use the line between both verts and their normal average to construct a matrix.
 * - using the matrix, we can find all intersecting verts/edges.
 * - walk the connected data and find the shortest path.
 *   - store a heap of paths which are being scanned (`PathContext.states`).
 *   - continuously search the shortest path in the heap.
 *   - never step over the same element twice (tag elements as `ELE_TOUCHED`).
 *     this avoids going into an eternal loop if there are many possible branches (see #45582).
 *   - when running into a branch, create a new `PathLinkState` state and add to the heap.
 *   - when the target is reached,
 *     finish - since none of the other paths can be shorter than the one just found.
 * - if the connection can't be found - fail.
 * - with the connection found, split all edges tagging verts
 *   (or tag verts that sit on the intersection).
 * - run the standard connect operator.
 *
 * `BLI_heapsimple` is ported alongside (`blenlib/intern/BLI_heap_simple.cc`) because which of two
 * equally short states pops first decides the path, and that is the heap's sift order. The link pool
 * (`BLI_mempool`) is plain garbage-collected objects.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {edgeSplit} from '../bmesh/mods'
import {faceNormalUpdate} from '../bmesh/polygon'
import {diskEdges} from '../bmesh/structure'
import {Vec3, v3add, v3cross, v3dot, v3sub} from '../math'
import {lenV3V3, normalizeV3Len, orthoV3V3, projectPlaneNormalizedV3V3V3} from '../math/geom'
import {ConnectVertsResult, EDIT_END_FLAGS, connectVertsExec, loopsOfEdge} from './connect'
import {loopsOfVert} from './dissolve'
import {bmeshEditEnd} from './edgenet'

const co = (v: BMVert): Vec3 => [v.x, v.y, v.z]

const CONNECT_EPS = 0.0001
const FLT_EPSILON = 1.1920929e-7
const FLT_MAX = 3.402823466e38

// region helpers - `BLI_heap_simple.cc`, `math_matrix_c.cc`

interface HeapSimpleNode<T> {
    value: number
    ptr: T
}

/**
 * `HeapSimple` (`BLI_heap_simple.cc`): a binary min-heap of `(value, ptr)` without handles. Ported
 * node for node - `heapsimple_up` on insert, `heapsimple_down` from the last node on pop - so ties
 * resolve in the order Blender's do.
 */
export class HeapSimple<T> {
    private tree: HeapSimpleNode<T>[] = []
    private size = 0

    /** `heapsimple_down` (`BLI_heap_simple.cc:47`). */
    private down(startI: number, init: HeapSimpleNode<T>): void {
        const tree = this.tree
        const size = this.size
        // Pull the active node values into locals.
        const activeVal = init.value
        const activePtr = init.ptr
        let i = startI
        tree[i].value = activeVal
        for (;;) {
            const l = (i << 1) + 1
            const r = l + 1 // right
            // Find the child with the smallest value.
            let smallest = i
            if (l < size && tree[l].value < activeVal) smallest = l
            if (r < size && tree[r].value < tree[smallest].value) smallest = r
            if (smallest === i) break
            // Move the smallest child into the current node.
            tree[i].value = tree[smallest].value
            tree[i].ptr = tree[smallest].ptr
            // Proceed to next iteration and spill value.
            i = smallest
            tree[i].value = activeVal
        }
        // Spill the pointer into the final position of the node.
        tree[i].ptr = activePtr
    }

    /** `heapsimple_up` (`BLI_heap_simple.cc:108`). */
    private up(i: number, activeVal: number, activePtr: T): void {
        const tree = this.tree
        while (i > 0) {
            const p = (i - 1) >> 1
            if (activeVal >= tree[p].value) break
            tree[i] = {value: tree[p].value, ptr: tree[p].ptr}
            i = p
        }
        tree[i] = {value: activeVal, ptr: activePtr}
    }

    /** `BLI_heapsimple_insert` (`BLI_heap_simple.cc:171`). */
    insert(value: number, ptr: T): void {
        this.up(this.size++, value, ptr)
    }

    /** `BLI_heapsimple_is_empty`. */
    isEmpty(): boolean {
        return this.size === 0
    }

    /** `BLI_heapsimple_len`. */
    get length(): number {
        return this.size
    }

    /** `BLI_heapsimple_pop_min` (`BLI_heap_simple.cc:200`). */
    popMin(): T {
        if (this.size === 0) throw new Error('mesh-kernel: pop from an empty heap')
        const ptr = this.tree[0].ptr
        if (--this.size) {
            const last = this.tree[this.size]
            this.down(0, {value: last.value, ptr: last.ptr})
        }
        return ptr
    }

    /** `BLI_heapsimple_clear` (without a free callback - the GC frees). */
    clear(): void {
        this.size = 0
        this.tree.length = 0
    }
}

/** Blender's `float m[3][3]`, indexed exactly as the C (`m[i][j]`). */
type M3 = [Vec3, Vec3, Vec3]

/** `adjoint_m3_m3` (`math_matrix_c.cc:1813`). */
function adjointM3M3(m: M3): M3 {
    const m00 = m[0][0], m01 = m[0][1], m02 = m[0][2]
    const m10 = m[1][0], m11 = m[1][1], m12 = m[1][2]
    const m20 = m[2][0], m21 = m[2][1], m22 = m[2][2]
    return [
        [m11 * m22 - m12 * m21, -m01 * m22 + m02 * m21, m01 * m12 - m02 * m11],
        [-m10 * m22 + m12 * m20, m00 * m22 - m02 * m20, -m00 * m12 + m02 * m10],
        [m10 * m21 - m11 * m20, -m00 * m21 + m01 * m20, m00 * m11 - m01 * m10],
    ]
}

/** `determinant_m3_array` (`math_matrix_c.cc:1004`). */
function determinantM3Array(m: M3): number {
    return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
        m[1][0] * (m[0][1] * m[2][2] - m[0][2] * m[2][1]) +
        m[2][0] * (m[0][1] * m[1][2] - m[0][2] * m[1][1])
}

/**
 * `invert_m3` (`math_matrix_c.cc:1034`, through `invert_m3_m3`): the adjoint over the determinant.
 * Returns the (unscaled adjoint when singular) result and whether the determinant was non-zero.
 */
export function invertM3(m: M3): {inv: M3, ok: boolean} {
    const inv = adjointM3M3(m)
    let det = determinantM3Array(m)
    const ok = det !== 0
    if (det !== 0) {
        det = 1 / det
        for (let a = 0; a < 3; a++) {
            for (let b = 0; b < 3; b++) inv[a][b] *= det
        }
    }
    return {inv, ok}
}

/** `dot_m3_v3_row_x` (`math_vector_inline.cc:469`). */
function dotM3V3RowX(m: M3, a: Vec3): number {
    return m[0][0] * a[0] + m[1][0] * a[1] + m[2][0] * a[2]
}

// endregion

/** Options of `bmesh.ops.connect_vert_pair` (`bmesh_opdefines.cc:1400`). */
export interface ConnectVertPairOptions {
    /** `verts_exclude`: input vertices to explicitly exclude from connecting. */
    vertsExclude?: Iterable<BMVert>
    /** `faces_exclude`: input faces to explicitly exclude from connecting. */
    facesExclude?: Iterable<BMFace>
}

/** One step of a path: the vertex or edge crossed, and the edge or face it was reached through. */
interface PathLink {
    next: PathLink | null
    /** edge or vert */
    ele: BMVert | BMEdge
    /** edge or face we came from (not 'next->ele') */
    eleFrom: BMEdge | BMFace | null
}

/** A path being scanned: its links (shared with the paths it branched from) and length so far. */
interface PathLinkState {
    /** chain of links */
    linkLast: PathLink | null
    /** length along links */
    dist: number
    coPrev: Vec3
}

interface PathContext {
    states: HeapSimple<PathLinkState>
    matrix: M3
    axisSep: number
    vPair: [BMVert, BMVert]
    /** `FACE_EXCLUDE` - typically hidden faces. */
    facesExclude: Set<BMFace>
    /** `VERT_EXCLUDE`. */
    vertsExclude: Set<BMVert>
    /** `ELE_TOUCHED` - any element we've walked over (only do it once!). */
    touched: Set<BMVert | BMEdge>
}

/**
 * `MinDistDir` (`bmo_connect_pair.cc:128`). Simply getting the closest intersecting vert/edge is _not_
 * good enough (#43792): the closest may be a dead end, so the closest in both directions is kept. The
 * first intersection fixes the direction; later ones update the distance on their side of it.
 */
interface MinDistDir {
    /** distance in both directions (FLT_MAX == uninitialized) */
    distMin: [number, number]
    /** direction of the first intersection found */
    dir: Vec3
}

const minDistDirInit = (): MinDistDir => ({distMin: [FLT_MAX, FLT_MAX], dir: [0, 0, 0]})

const faceWalkTest = (pc: PathContext, f: BMFace) => !pc.facesExclude.has(f)
const vertWalkTest = (pc: PathContext, v: BMVert) => !pc.vertsExclude.has(v)

/** `min_dist_dir_test` (`bmo_connect_pair.cc:142`): which slot a hit updates, or -1 for neither. */
function minDistDirTest(mddir: MinDistDir, distDir: Vec3, distSq: number): number {
    if (mddir.distMin[0] === FLT_MAX) return 0
    if (v3dot(distDir, mddir.dir) > 0) {
        if (distSq < mddir.distMin[0]) return 0
    } else {
        if (distSq < mddir.distMin[1]) return 1
    }
    return -1
}

/** `min_dist_dir_update` (`bmo_connect_pair.cc:162`). */
function minDistDirUpdate(dist: MinDistDir, distDir: Vec3): void {
    if (dist.distMin[0] === FLT_MAX) dist.dir = [distDir[0], distDir[1], distDir[2]]
}

/** `state_isect_co_pair` (`bmo_connect_pair.cc:171`): do the two points lie strictly on either side of the plane? */
function stateIsectCoPair(pc: PathContext, coA: Vec3, coB: Vec3): boolean {
    const diffA = dotM3V3RowX(pc.matrix, coA) - pc.axisSep
    const diffB = dotM3V3RowX(pc.matrix, coB) - pc.axisSep

    const testA = Math.abs(diffA) < CONNECT_EPS ? 0 : diffA < 0 ? -1 : 1
    const testB = Math.abs(diffB) < CONNECT_EPS ? 0 : diffB < 0 ? -1 : 1

    // on either side
    return (testA !== 0 && testB !== 0) && testA !== testB
}

/** `state_isect_co_exact` (`bmo_connect_pair.cc:185`): does the point lie on the plane? */
function stateIsectCoExact(pc: PathContext, c: Vec3): boolean {
    const diff = dotM3V3RowX(pc.matrix, c) - pc.axisSep
    return Math.abs(diff) <= CONNECT_EPS
}

/** `state_calc_co_pair_fac` (`bmo_connect_pair.cc:191`): where the plane cuts the segment, from `coA`. */
function stateCalcCoPairFac(pc: PathContext, coA: Vec3, coB: Vec3): number {
    const diffA = Math.abs(dotM3V3RowX(pc.matrix, coA) - pc.axisSep)
    const diffB = Math.abs(dotM3V3RowX(pc.matrix, coB) - pc.axisSep)
    const diffTot = diffA + diffB
    return diffTot > FLT_EPSILON ? diffA / diffTot : 0.5
}

/** `state_calc_co_pair` (`bmo_connect_pair.cc:203`) with `interp_v3_v3v3`. */
function stateCalcCoPair(pc: PathContext, coA: Vec3, coB: Vec3): Vec3 {
    const fac = stateCalcCoPairFac(pc, coA, coB)
    const s = 1 - fac
    return [s * coA[0] + fac * coB[0], s * coA[1] + fac * coB[1], s * coA[2] + fac * coB[2]]
}

/** `state_link_add` (`bmo_connect_pair.cc:232`): extend the path, never to walk onto `ele` again. */
function stateLinkAdd(pc: PathContext, state: PathLinkState, ele: BMVert | BMEdge, eleFrom: BMEdge | BMFace | null): void {
    // never walk onto this again
    pc.touched.add(ele)

    // track distance
    let c: Vec3
    if (ele instanceof BMVert) {
        c = co(ele)
    } else {
        c = stateCalcCoPair(pc, co(ele.v1), co(ele.v2))
    }

    // tally distance
    if (eleFrom) state.dist += lenV3V3(state.coPrev, c)
    state.coPrev = c

    state.linkLast = {ele, eleFrom, next: state.linkLast}
}

/** `state_dupe_add` (`bmo_connect_pair.cc:296`): a copy of the state (sharing its links). */
function stateDupeAdd(stateOrig: PathLinkState): PathLinkState {
    return {linkLast: stateOrig.linkLast, dist: stateOrig.dist, coPrev: [stateOrig.coPrev[0], stateOrig.coPrev[1], stateOrig.coPrev[2]]}
}

/**
 * `state_link_add_test` (`bmo_connect_pair.cc:303`): the first step from a state extends it in place;
 * every further step branches a copy of the original and queues it.
 */
function stateLinkAddTest(
    pc: PathContext, state: PathLinkState, stateOrig: PathLinkState, ele: BMVert | BMEdge, eleFrom: BMEdge | BMFace,
): PathLinkState {
    const isNew = stateOrig.linkLast !== state.linkLast
    if (isNew) state = stateDupeAdd(stateOrig)

    stateLinkAdd(pc, state, ele, eleFrom)

    // after adding a link so we use the updated 'state->dist'
    if (isNew) pc.states.insert(state.dist, state)

    return state
}

/** `state_step__face_edges` (`bmo_connect_pair.cc:325`): walk around the face edges. */
function stateStepFaceEdges(
    pc: PathContext, state: PathLinkState, stateOrig: PathLinkState,
    lIter: BMLoop, lLast: BMLoop, mddir: MinDistDir,
): PathLinkState {
    const lIterBest: (BMLoop | null)[] = [null, null]

    do {
        if (stateIsectCoPair(pc, co(lIter.v), co(lIter.next.v))) {
            const coIsect = stateCalcCoPair(pc, co(lIter.v), co(lIter.next.v))
            const distDir = v3sub(coIsect, stateOrig.coPrev)
            const distTest = v3dot(distDir, distDir)
            let index: number
            if ((index = minDistDirTest(mddir, distDir, distTest)) !== -1) {
                const eleNext = lIter.e!
                const eleNextFrom = lIter.f

                if (faceWalkTest(pc, eleNextFrom) && !pc.touched.has(eleNext)) {
                    minDistDirUpdate(mddir, distDir)
                    mddir.distMin[index] = distTest
                    lIterBest[index] = lIter
                }
            }
        }
    } while ((lIter = lIter.next) !== lLast)

    for (let i = 0; i < 2; i++) {
        const l = lIterBest[i]
        if (l) state = stateLinkAddTest(pc, state, stateOrig, l.e!, l.f)
    }

    return state
}

/** `state_step__face_verts` (`bmo_connect_pair.cc:374`): walk around the face verts. */
function stateStepFaceVerts(
    pc: PathContext, state: PathLinkState, stateOrig: PathLinkState,
    lIter: BMLoop, lLast: BMLoop, mddir: MinDistDir,
): PathLinkState {
    const lIterBest: (BMLoop | null)[] = [null, null]

    do {
        if (stateIsectCoExact(pc, co(lIter.v))) {
            const coIsect = co(lIter.v)
            const distDir = v3sub(coIsect, stateOrig.coPrev)
            const distTest = v3dot(distDir, distDir)
            let index: number
            if ((index = minDistDirTest(mddir, distDir, distTest)) !== -1) {
                const eleNext = lIter.v
                const eleNextFrom = lIter.f

                if (faceWalkTest(pc, eleNextFrom) && !pc.touched.has(eleNext)) {
                    minDistDirUpdate(mddir, distDir)
                    mddir.distMin[index] = distTest
                    lIterBest[index] = lIter
                }
            }
        }
    } while ((lIter = lIter.next) !== lLast)

    for (let i = 0; i < 2; i++) {
        const l = lIterBest[i]
        if (l) state = stateLinkAddTest(pc, state, stateOrig, l.v, l.f)
    }

    return state
}

/**
 * `state_step` (`bmo_connect_pair.cc:419`): from the state's last element, step to the nearest plane
 * crossings in every face around it (both directions), and along edges to vertices on the plane.
 * Returns whether the state was extended.
 */
function stateStep(pc: PathContext, state: PathLinkState): boolean {
    const stateOrig: PathLinkState = stateDupeAdd(state)
    const ele = state.linkLast!.ele
    const eleFrom = state.linkLast!.eleFrom

    if (ele instanceof BMEdge) {
        const e = ele
        for (const lStart of loopsOfEdge(e)) {
            if (lStart.f !== eleFrom && faceWalkTest(pc, lStart.f)) {
                const mddir = minDistDirInit()
                // Very similar to block below.
                state = stateStepFaceEdges(pc, state, stateOrig, lStart.next, lStart, mddir)
                state = stateStepFaceVerts(pc, state, stateOrig, lStart.next.next, lStart, mddir)
            }
        }
    } else {
        const v = ele

        // Vert loops.
        for (const lStart of loopsOfVert(v)) {
            if (lStart.f !== eleFrom && faceWalkTest(pc, lStart.f)) {
                const mddir = minDistDirInit()
                // Very similar to block above.
                state = stateStepFaceEdges(pc, state, stateOrig, lStart.next, lStart.prev, mddir)
                if (lStart.f.len > 3) {
                    // Adjacent verts are handled in `state_step__vert_edges`.
                    state = stateStepFaceVerts(pc, state, stateOrig, lStart.next.next, lStart.prev, mddir)
                }
            }
        }

        // Vert edges.
        for (const e of diskEdges(v)) {
            const vOther = e.otherVert(v)
            if (e !== eleFrom && vertWalkTest(pc, vOther)) {
                if (stateIsectCoExact(pc, co(vOther))) {
                    if (!pc.touched.has(vOther)) {
                        state = stateLinkAddTest(pc, state, stateOrig, vOther, e)
                    }
                }
            }
        }
    }
    return stateOrig.linkLast !== state.linkLast
}

/**
 * `bm_vert_pair_to_matrix` (`bmo_connect_pair.cc:491`): an orientation matrix from the two vertices -
 * the direction between them, their normals (projected off that direction, flipped to agree, added
 * unnormalised so normals near the direction count less, #46784) and the third axis. Falls back to
 * the surrounding faces, then to any orthogonal axis, when the normals give none. Inverted, so its
 * first row measures the signed distance from the cutting plane.
 */
function vertPairToMatrix(vPair: [BMVert, BMVert]): M3 {
    const eps = 1e-8

    const basisDir = v3sub(co(vPair[0]), co(vPair[1]))
    normalizeV3Len(basisDir)

    let basisNor: Vec3
    // align both normals to the directions before combining
    {
        // align normal to direction
        const basisNorA = projectPlaneNormalizedV3V3V3([vPair[0].nx, vPair[0].ny, vPair[0].nz], basisDir)
        let basisNorB = projectPlaneNormalizedV3V3V3([vPair[1].nx, vPair[1].ny, vPair[1].nz], basisDir)

        // Don't normalize before combining so as normals approach the direction,
        // they have less effect (#46784).

        // combine the normals
        // for flipped faces
        if (v3dot(basisNorA, basisNorB) < 0) basisNorB = [-basisNorB[0], -basisNorB[1], -basisNorB[2]]
        basisNor = v3add(basisNorA, basisNorB)
    }

    // get third axis
    normalizeV3Len(basisNor)
    let basisTmp = v3cross(basisDir, basisNor)

    // Try get the axis from surrounding faces, fallback to 'ortho_v3_v3'
    if (normalizeV3Len(basisTmp) < eps) {
        // vertex normals are directly opposite

        // find the loop with the lowest angle
        // (Blender zeroes only `nor[0..1]` here (`zero_v2`) and leaves `nor[2]` uninitialised; it is
        // only read when no face qualified, and zero is used for it.)
        const axisPair = [{nor: [0, 0, 0] as Vec3, angleCos: -FLT_MAX}, {nor: [0, 0, 0] as Vec3, angleCos: -FLT_MAX}]

        for (let i = 0; i < 2; i++) {
            for (const l of loopsOfVert(vPair[i])) {
                // project basis dir onto the normal to find its closest angle
                const basisDirProj = projectPlaneNormalizedV3V3V3(basisDir, [l.f.nx, l.f.ny, l.f.nz])

                if (normalizeV3Len(basisDirProj) > eps) {
                    const angleCosTest = v3dot(basisDirProj, basisDir)

                    if (angleCosTest > axisPair[i].angleCos) {
                        axisPair[i].angleCos = angleCosTest
                        axisPair[i].nor = [basisDirProj[0], basisDirProj[1], basisDirProj[2]]
                    }
                }
            }
        }

        // create a new 'basis_nor' from the best direction.
        // NOTE: we could add the directions,
        // but this more often gives 45d rotated matrix, so just use the best one.
        basisNor = [...axisPair[axisPair[0].angleCos < axisPair[1].angleCos ? 1 : 0].nor]
        basisNor = projectPlaneNormalizedV3V3V3(basisNor, basisDir)

        basisTmp = v3cross(basisDir, basisNor)

        // last resort, pick _any_ ortho axis
        if (normalizeV3Len(basisTmp) < eps) {
            basisNor = orthoV3V3(basisDir)
            normalizeV3Len(basisNor)
            basisTmp = v3cross(basisDir, basisNor)
            normalizeV3Len(basisTmp)
        }
    }

    const m: M3 = [basisTmp, basisDir, basisNor]
    const {inv, ok} = invertM3(m)
    if (!ok) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    return inv
}

/**
 * The body of `bmo_connect_vert_pair_exec` (`bmo_connect_pair.cc:593`) without the top-level
 * `bmesh_edit_end` (Vertex Connect runs it through its own edit-mode wrapper). Use
 * {@link connectVertPair} from outside.
 */
export function connectVertPairExec(bm: BMesh, verts: readonly BMVert[], options: ConnectVertPairOptions = {}): ConnectVertsResult {
    if (verts.length !== 2) {
        // fail!
        return {edges: [], error: null}
    }
    // fail!
    if (!(verts[0] && verts[1])) return {edges: [], error: null}

    // tag so we won't touch ever (typically hidden faces)
    const pc: PathContext = {
        states: new HeapSimple<PathLinkState>(),
        matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        axisSep: 0,
        vPair: [verts[0], verts[1]],
        facesExclude: new Set(options.facesExclude ?? []),
        vertsExclude: new Set(options.vertsExclude ?? []),
        touched: new Set(),
    }
    const vertOut = new Set<BMVert>()
    let stateBest: PathLinkState | null = null

    // calculate matrix
    pc.matrix = vertPairToMatrix(pc.vPair)
    pc.axisSep = dotM3V3RowX(pc.matrix, co(pc.vPair[0]))

    // add first vertex
    {
        const state: PathLinkState = {linkLast: null, dist: 0, coPrev: [0, 0, 0]}
        stateLinkAdd(pc, state, pc.vPair[0], null)
        pc.states.insert(state.dist, state)
    }

    while (!pc.states.isEmpty()) {
        while (!pc.states.isEmpty()) {
            const state = pc.states.popMin()

            // either we insert this into 'pc.states' or its freed
            let continueSearch: boolean

            if (state.linkLast!.ele === pc.vPair[1]) {
                // pass, wait until all are found
                stateBest = state

                // we're done, exit all loops
                pc.states.clear()
                continueSearch = false
            } else if (stateStep(pc, state)) {
                continueSearch = true
            } else {
                // didn't reach the end, remove it,
                // links are shared between states so just free the link_pool at the end
                continueSearch = false
            }

            if (continueSearch) pc.states.insert(state.dist, state)
        }
    }

    if (stateBest && stateBest.linkLast) {
        // find the best state
        let link: PathLink | null = stateBest.linkLast
        do {
            if (link.ele instanceof BMEdge) {
                const e = link.ele
                const eFac = stateCalcCoPairFac(pc, co(e.v1), co(e.v2))
                const vNew = edgeSplit(bm, e, e.v1, eFac).vNew
                // Adding vertices makes the face-normals stale.
                // These are used for the `connect_verts` call next for projecting onto the face,
                // so the normals must be recalculated here.
                for (const l of loopsOfEdge(e)) faceNormalUpdate(l.f)
                vertOut.add(vNew)
            } else {
                vertOut.add(link.ele)
            }
        } while ((link = link.next))
    }

    vertOut.add(pc.vPair[0])
    vertOut.add(pc.vPair[1])

    if (stateBest && stateBest.linkLast) {
        // "connect_verts verts=%fv faces_exclude=%s check_degenerate=%b": `%fv` is the flagged
        // vertices in mesh order.
        const flagged: BMVert[] = []
        for (const v of bm.verts) if (vertOut.has(v)) flagged.push(v)
        return connectVertsExec(bm, flagged, {facesExclude: pc.facesExclude, checkDegenerate: true})
    }
    return {edges: [], error: null}
}

/**
 * `bmesh.ops.connect_vert_pair`: connect two vertices by splitting the faces along the shortest path
 * between them, across as many faces as it takes. `verts` must hold exactly two vertices (anything
 * else does nothing). The cut follows the plane through both vertices that contains (as near as
 * possible) their averaged normal, so the stored vertex and face normals must be current.
 *
 * Port of `bmo_connect_vert_pair_exec` (`bmo_connect_pair.cc:593`) run as a top-level operator, so
 * followed by `bmesh_edit_end`: every normal recalculated and the selection flushed by the select mode.
 * `edges` is `edges.out` of the `connect_verts` run along the path (empty when no path was found).
 */
export function connectVertPair(bm: BMesh, verts: readonly BMVert[], options: ConnectVertPairOptions = {}): ConnectVertsResult {
    const result = connectVertPairExec(bm, verts, options)
    bmeshEditEnd(bm, EDIT_END_FLAGS)
    return result
}

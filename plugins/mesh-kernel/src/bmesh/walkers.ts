/**
 * BMesh topology walkers - select linked, edge loop, edge ring, face loop and boundary loop.
 *
 * Ported from `source/blender/bmesh/intern/bmesh_walkers_impl.cc` (declarations in
 * `bmesh_walkers.hh`, state machine in `bmesh_walkers.cc`).
 *
 * | here | Blender | what it walks |
 * | --- | --- | --- |
 * | {@link walkVertShellEdges} | `BMW_VERT_SHELL` | every edge reachable through edges from a seed ("select linked") |
 * | {@link walkEdgeLoop} | `BMW_EDGELOOP` | an edge loop, continuing across valence-4 vertices |
 * | {@link walkEdgeRing} | `BMW_EDGERING` | an edge ring, stepping to the opposite edge of each quad |
 * | {@link walkFaceLoop} | `BMW_FACELOOP` | the quads a face loop passes through |
 * | {@link walkEdgeBoundary} | `BMW_EDGEBOUNDARY` | the boundary edges connected to a boundary edge |
 * | {@link walkLoopShell} | `BMW_LOOP_SHELL` | every loop of the shell a seed belongs to |
 * | {@link walkIsland} | `BMW_ISLAND` / `BMW_ISLAND_MANIFOLD` | the face region connected across shared edges |
 *
 * **Walkers never mutate the mesh.** Blender's own header says it in capitals: do not modify topology
 * while walking. Every function here only reads cycles and its own visit sets.
 *
 * ## Why the state machine survived the port
 *
 * Blender's generic machinery (`BMWalker`, its mempool and `BMW_init`/`BMW_step`) exists because C has
 * no closures, and most of it is not worth porting. One part is: the *worklist*. The loop, ring and
 * face-loop walkers all "rewind" in their `begin` - they run a complete walk in one direction purely to
 * find the far end, copy that last state, flip its direction and start the real walk from there. That
 * trick reads the worklist directly, so {@link Walker} keeps `BMW_state_add` / `BMW_state_remove` /
 * `BMW_current_state` / `BMW_walk` with their exact semantics (depth-first pushes at the head,
 * breadth-first at the tail, the current state is always the head). Generators then wrap the engine, so
 * callers see plain iteration.
 *
 * Blender's `yield` callback is dead code in current Blender - `BMW_begin` and `BMW_step` return what
 * `step` returns - so the ports return from `step` too.
 *
 * ## Walker masks
 *
 * Blender's walkers filter by *operator* flags (`BMO_elem_flag_test`), which this kernel does not have
 * yet (step 10 of the M1 subplan). The only mask that is ported is `BMW_FLAG_TEST_HIDDEN`, as
 * {@link WalkOptions.testHidden}; with it off - the default - `bmw_mask_check_*` is always true, which
 * is exactly what Blender does with an empty mask.
 *
 * ## Delimiters
 *
 * `BMWDelimitFlag` becomes named booleans on {@link WalkOptions}. Note there is no `BMW_DELIMIT_NORMAL`
 * in current Blender: un-delimited walking is `delimit = 0`, so passing no options is the "normal" mode.
 * Seam is the `Seam` element flag; sharp is the *absence* of the `Smooth` element flag.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from './types'
import {
    diskEdgeExists,
    diskEdges,
    edgeIsBoundary,
    edgeIsManifold,
    edgeIsWire,
    radialLoops,
} from './structure'
import {ElemFlag} from '../constants'

// region options

/**
 * Walker flags and delimiters. Blender's `BMWFlag` and `BMWDelimitFlag`, one boolean per bit.
 *
 * Each walker ignores the delimiters it does not support, exactly as Blender asserts about
 * `delimit_supported`; the doc comment on each function lists the ones it honours.
 */
export interface WalkOptions {
    /** `BMW_FLAG_TEST_HIDDEN`. Treat hidden elements as absent. */
    testHidden?: boolean
    /** `BMW_DELIMIT_EDGE_MARK_SEAM`. Stop at edges flagged {@link ElemFlag.Seam}. */
    delimitSeam?: boolean
    /** `BMW_DELIMIT_EDGE_MARK_SHARP`. Stop at edges *without* {@link ElemFlag.Smooth}. */
    delimitSharp?: boolean
    /** `BMW_DELIMIT_FACE_MARK_MATERIAL`. Stop where the two faces have different material slots. */
    delimitMaterial?: boolean
    /**
     * `BMW_DELIMIT_EDGE_LOOP_NGONS` for {@link walkEdgeLoop} and `BMW_DELIMIT_EDGE_RING_NGONS` for
     * {@link walkEdgeRing}: keep the walk to quads instead of any even-sided face.
     */
    delimitNgons?: boolean
    /** `BMW_DELIMIT_EDGE_LOOP_INNER_CORNERS`. Boundary loops only. */
    delimitInnerCorners?: boolean
    /** `BMW_DELIMIT_EDGE_LOOP_OUTER_CORNERS`. Boundary loops only. */
    delimitOuterCorners?: boolean
}

/** A UV seam. Blender's `BM_elem_flag_test(e, BM_ELEM_SEAM)`. */
function edgeIsSeam(e: BMEdge): boolean {
    return (e.hflag & ElemFlag.Seam) !== 0
}

/** A sharp edge is one that is *not* smooth, which is how Blender stores it. */
function edgeIsSharp(e: BMEdge): boolean {
    return (e.hflag & ElemFlag.Smooth) === 0
}

// endregion

// region queries ported from bmesh_query.cc
//
// These belong in a queries module (step 7 of the M1 subplan) and should move there when one exists;
// they live here because the walkers are the first callers.

/** Edges around `v` that have at least one face. Port of `BM_vert_edge_count_nonwire`. */
export function vertEdgeCountNonWire(v: BMVert): number {
    let count = 0
    for (const e of diskEdges(v)) if (e.l) count++
    return count
}

/** How many loops in `l`'s radial cycle point at `v`. Port of `bmesh_radial_facevert_count`. */
export function radialFacevertCount(l: BMLoop, v: BMVert): number {
    let count = 0
    let iter: BMLoop = l
    do {
        if (iter.v === v) count++
        iter = iter.radialNext!
    } while (iter !== l)
    return count
}

/**
 * Number of face corners at `v`. Port of `BM_vert_face_count` / `bmesh_disk_facevert_count`.
 *
 * Counts corners, not faces: a face that touches `v` twice (only possible in degenerate topology)
 * counts twice, and every face is counted once per pair of its edges at `v`, which is why each edge
 * contributes its radial count and the total is not simply the number of distinct faces.
 */
export function vertFaceCount(v: BMVert): number {
    let count = 0
    for (const e of diskEdges(v)) {
        if (e.l) count += radialFacevertCount(e.l, v)
    }
    return count
}

/** The other loop of `l`'s face that uses `v`. Port of `BM_loop_other_edge_loop`. */
export function loopOtherEdgeLoop(l: BMLoop, v: BMVert): BMLoop {
    return l.v === v ? l.prev : l.next
}

/** The loop of `f` at `v`, or null. Port of `BM_face_vert_share_loop`. */
export function faceVertShareLoop(f: BMFace, v: BMVert): BMLoop | null {
    for (const l of f.eachLoop()) if (l.v === v) return l
    return null
}

/**
 * Walking `f`'s boundary from `vPrev` through `v`, the loop on the far side of `v`.
 * Port of `BM_face_other_vert_loop`.
 */
export function faceOtherVertLoop(f: BMFace, vPrev: BMVert, v: BMVert): BMLoop | null {
    const l = faceVertShareLoop(f, v)
    if (!l) return null
    if (l.prev.v === vPrev) return l.next
    if (l.next.v === vPrev) return l.prev
    return null
}

/**
 * True for a boundary edge of an n-gon whose neighbouring edge in that n-gon is also a boundary.
 * Port of `bm_edge_is_single` (`bmesh_walkers_impl.cc:846`), the "single" in `BMwEdgeLoopWalker`.
 */
function edgeIsSingle(e: BMEdge): boolean {
    return edgeIsBoundary(e) && e.l!.f.len > 4 &&
        (edgeIsBoundary(e.l!.next.e!) || edgeIsBoundary(e.l!.prev.e!))
}

// endregion

// region the walker engine

type WalkOrder = 'depthFirst' | 'breadthFirst'

interface WalkState {
    /** Blender's `BMwGenericWalker.depth`, kept for fidelity; none of the ported walkers read it. */
    depth: number
}

/**
 * The worklist half of Blender's `BMWalker`, without the mempool or the function-pointer table.
 *
 * Port of `bmesh_walkers.cc`. Subclasses implement `begin` and `step` exactly as the C ones do; the
 * state objects are copied by value on removal, which is what `BMW_state_remove_r`'s `memcpy` does.
 */
abstract class Walker<S extends WalkState, T extends object> {
    /** Head is the current state. `BMWalker.states`. */
    protected readonly states: S[] = []
    protected readonly visitSet = new Set<object>()
    protected readonly visitSetAlt = new Set<object>()
    protected depth = 0
    protected readonly order: WalkOrder = 'depthFirst'

    protected constructor(protected readonly opts: WalkOptions) {}

    // region mask checks - `bmw_mask_check_*`, minus the operator flag layer this kernel lacks

    protected maskCheckVert(v: BMVert): boolean {
        return !(this.opts.testHidden && v.hidden)
    }

    protected maskCheckEdge(e: BMEdge): boolean {
        return !(this.opts.testHidden && e.hidden)
    }

    protected maskCheckFace(f: BMFace): boolean {
        return !(this.opts.testHidden && f.hidden)
    }

    // endregion

    /** `BMW_current_state`, including its automatic depth update. */
    protected currentState(): S | null {
        const s = this.states[0]
        if (!s) return null
        this.depth = s.depth + 1
        return s
    }

    /** `BMW_state_add`. Depth-first pushes at the head, breadth-first at the tail. */
    protected stateAdd(state: Omit<S, 'depth'> | S): S {
        const s = {...(state as object), depth: this.depth} as S
        if (this.order === 'depthFirst') this.states.unshift(s)
        else this.states.push(s)
        return s
    }

    /** `BMW_state_remove_r`: take a copy of the current state, then drop it from the worklist. */
    protected stateRemoveR(): S {
        const s = this.states.shift()
        if (!s) throw new Error('mesh-kernel: walker stepped with an empty worklist')
        return {...s}
    }

    protected abstract step(): T | null

    /** `BMW_walk`. */
    protected walk(): T | null {
        while (this.currentState()) {
            const current = this.step()
            if (current) return current
        }
        return null
    }

    /**
     * `BMW_begin` followed by `BMW_step` until exhausted, which is what the `BMW_ITER` macro expands to.
     * Call after the subclass's `begin` has seeded the worklist.
     */
    protected* iterate(): Generator<T> {
        let current = this.currentState() ? this.step() : null
        while (current) {
            yield current
            current = this.walk()
        }
    }
}

/**
 * Collect a walk into an array, dropping repeats.
 *
 * Most walkers guard every push with their visit set and so never yield an element twice, but two do:
 * `BMW_EDGERING` when a delimiter makes it walk both directions from the same edge, and `BMW_FACELOOP`
 * when a closed loop comes back to its first face through a different edge. Blender only ever sets a
 * selection flag on what a walker yields, so a repeat is invisible there. Here the `*Iter` functions
 * yield exactly what Blender yields, and the array functions are deduplicated, keeping first-visit
 * order, so callers can index and count them.
 */
function collect<T>(walk: Generator<T>): T[] {
    const out: T[] = []
    const seen = new Set<T>()
    for (const item of walk) {
        if (seen.has(item)) continue
        seen.add(item)
        out.push(item)
    }
    return out
}

/**
 * Guard for the two fan walks that Blender leaves unbounded (they terminate on valid topology because
 * the fan is finite and contains the edge they started from). Throwing beats hanging if a caller hands
 * a walker a corrupted mesh; on valid input this limit is never approached.
 */
function fanGuard(v: BMVert, steps: number): void {
    if (steps > 1e6) throw new Error(`mesh-kernel: edge loop fan around vertex ${v.id} does not terminate`)
}

// endregion

// region shell walker - BMW_VERT_SHELL

interface ShellState extends WalkState {
    curedge: BMEdge
}

/**
 * Port of `bmw_VertShellWalker_*` (`bmesh_walkers_impl.cc:91`). Breadth-first, yields edges.
 */
class VertShellWalker extends Walker<ShellState, BMEdge> {
    protected readonly order: WalkOrder = 'breadthFirst'

    constructor(start: BMVert | BMEdge, opts: WalkOptions) {
        super(opts)
        this.begin(start)
    }

    private visitEdge(e: BMEdge): void {
        if (this.visitSet.has(e)) return
        if (!this.maskCheckEdge(e)) return
        this.stateAdd({curedge: e})
        this.visitSet.add(e)
    }

    private begin(start: BMVert | BMEdge): void {
        if (start instanceof BMVert) {
            // Starting at a vertex, put all of its edges on the worklist.
            for (const e of diskEdges(start)) this.visitEdge(e)
        } else {
            this.visitEdge(start)
        }
    }

    protected step(): BMEdge {
        const owalk = this.stateRemoveR()
        const e = owalk.curedge
        for (let i = 0; i < 2; i++) {
            const v = i ? e.v2 : e.v1
            for (const e2 of diskEdges(v)) this.visitEdge(e2)
        }
        return e
    }

    run(): Generator<BMEdge> {
        return this.iterate()
    }
}

/**
 * Every edge reachable from `start` by following edges - Blender's `BMW_VERT_SHELL`, the walker behind
 * "select linked" (the `L` key). Breadth-first from the seed; each edge is yielded once.
 *
 * `start` may be a vertex (all of its edges seed the walk) or an edge.
 * Honours {@link WalkOptions.testHidden}; `BMW_VERT_SHELL` supports no delimiters.
 */
export function walkVertShellEdgesIter(start: BMVert | BMEdge, opts: WalkOptions = {}): Generator<BMEdge> {
    return new VertShellWalker(start, opts).run()
}

/** {@link walkVertShellEdgesIter} collected into an array, in walk order, each edge once. */
export function walkVertShellEdges(start: BMVert | BMEdge, opts: WalkOptions = {}): BMEdge[] {
    return collect(walkVertShellEdgesIter(start, opts))
}

/**
 * The vertices of the shell reached by {@link walkVertShellEdges}, each once, in the order the walk
 * first touches them. A loose seed vertex yields itself.
 *
 * Blender's walker yields edges only; edit-mode select-linked flushes those to vertices afterwards
 * (`EDBM_selectmode_flush`), which is what this does.
 */
export function walkVertShell(start: BMVert | BMEdge, opts: WalkOptions = {}): BMVert[] {
    const out: BMVert[] = []
    const seen = new Set<BMVert>()
    const push = (v: BMVert) => {
        if (seen.has(v)) return
        seen.add(v)
        out.push(v)
    }
    if (start instanceof BMVert) push(start)
    for (const e of walkVertShellEdgesIter(start, opts)) {
        push(e.v1)
        push(e.v2)
    }
    return out
}

// endregion

// region edge loop walker - BMW_EDGELOOP

interface EdgeLoopState extends WalkState {
    cur: BMEdge
    /** Blender keeps `start`/`startv` on the state; only `cur` and `lastv` drive stepping. */
    start: BMEdge
    lastv: BMVert
    startv: BMVert
    /** The n-gon acting as a hub, when the loop runs along the side of one. */
    fHub: BMFace | null
    /** Boundary looping takes a different branch entirely. */
    isBoundary: boolean
    /** The edge's vertices are only connected to one face. */
    isSingle: boolean
}

/**
 * Port of `bmw_EdgeLoopWalker_*` (`bmesh_walkers_impl.cc:840`).
 *
 * Four distinct behaviours, chosen once in `begin` and carried on every state:
 * - **n-gon hub**: the loop runs along one side of an n-gon; step around the hub.
 * - **wire**: no faces at all; every connected wire edge is part of the loop.
 * - **interior**: cross the vertex to the opposite edge, which needs valence 4 (or 2).
 * - **boundary**: follow the fan around the vertex until another boundary edge turns up.
 */
class EdgeLoopWalker extends Walker<EdgeLoopState, BMEdge> {
    constructor(e: BMEdge, opts: WalkOptions) {
        super(opts)
        this.begin(e)
    }

    /**
     * Port of `bmw_EdgeLoopWalker_delimit_by_mark`. Blender's comment: when starting on a mark, stop
     * when the next edge does not have the mark; otherwise stop when any edge connected to the next
     * vertex has the mark.
     */
    private delimitByMark(v: BMVert, e: BMEdge, l: BMLoop, marked: (e: BMEdge) => boolean): boolean {
        if (marked(e)) {
            if (!marked(l.e!) && !(this.opts.testHidden && l.e!.hidden) && !edgeIsWire(l.e!)) {
                return true
            }
        } else {
            for (const eOther of diskEdges(v)) {
                if (marked(eOther) && !(this.opts.testHidden && eOther.hidden) && !edgeIsWire(eOther)) {
                    return true
                }
            }
        }
        return false
    }

    /** Port of `bmw_EdgeLoopWalker_delimit_mark_check`. */
    private delimitMarkCheck(v: BMVert, e: BMEdge, l: BMLoop): boolean {
        if (this.opts.delimitSeam && this.delimitByMark(v, e, l, edgeIsSeam)) return true
        if (this.opts.delimitSharp && this.delimitByMark(v, e, l, edgeIsSharp)) return true
        return false
    }

    private begin(e: BMEdge): void {
        const vertEdgeCount = [vertEdgeCountNonWire(e.v1), vertEdgeCountNonWire(e.v2)]
        const vertFaceCounts = [vertFaceCount(e.v1), vertFaceCount(e.v2)]

        const v = e.v1

        const isBoundary = edgeIsBoundary(e)
        const first = this.stateAdd({
            cur: e,
            start: e,
            lastv: v,
            startv: v,
            fHub: null,
            isBoundary,
            isSingle: isBoundary && edgeIsSingle(e),
        })
        this.visitSet.add(e)

        /*
         * Detect an n-gon hub. Blender's diagram: with an n-gon on one side of the edge and a series of
         * faces on the other, walk around the n-gon for as long as the edges are connected to it, which
         * is what a user reading the mesh sees as the edge loop. The face count test is #84906: without
         * it the three edges could be this edge plus two boundary edges, which are not stepped over.
         */
        if (!first.isBoundary &&
            ((vertEdgeCount[0] === 3 && vertFaceCounts[0] === 3) ||
             (vertEdgeCount[1] === 3 && vertFaceCounts[1] === 3))) {
            let fBest: BMFace | null = null
            for (const l of radialLoops(e)) {
                if (fBest === null || fBest.len < l.f.len) fBest = l.f
            }
            // Only use hub selection for 5+ sides, else it conflicts with normal edge loop selection.
            first.fHub = fBest ? (fBest.len > 4 ? fBest : null) : null
        } else {
            first.fHub = null
        }

        /*
         * Rewind. Run the walk to exhaustion in one direction purely to find the far end, then restart
         * from that last state with `lastv` flipped, so the real walk covers the whole loop in one pass.
         * `BMW_walk` performs exactly one step here, because this walker's step never returns null.
         */
        let owalk: EdgeLoopState = first
        let cur = this.currentState()
        while (cur) {
            owalk = {...cur}
            this.walk()
            cur = this.currentState()
        }

        const restart = this.stateAdd({...owalk})
        restart.lastv = restart.startv = owalk.cur.otherVert(owalk.lastv)

        this.visitSet.clear()
        this.visitSet.add(owalk.cur)
    }

    protected step(): BMEdge {
        const owalk = this.stateRemoveR()

        const e = owalk.cur
        let l: BMLoop | null = e.l
        let v: BMVert

        if (owalk.fHub) {
            // INTERIOR NGON EDGE
            v = e.otherVert(owalk.lastv)
            const vertEdgeTot = vertEdgeCountNonWire(v)

            if (vertEdgeTot === 3) {
                l = faceOtherVertLoop(owalk.fHub, owalk.lastv, v)
                // Blender dereferences this without a null check; a null here means the hub does not
                // actually connect the two vertices, which cannot happen on valid topology.
                const nexte = l ? diskEdgeExists(v, l.v) : null

                if (nexte && this.maskCheckEdge(nexte) && !this.visitSet.has(nexte) &&
                    // Never step onto a boundary edge, this gives odd results.
                    !edgeIsBoundary(nexte)) {
                    this.stateAdd({...owalk, cur: nexte, lastv: v})
                    this.visitSet.add(nexte)
                }
            }
        } else if (l === null) {
            // WIRE EDGE. Every connected wire edge joins the loop, in both directions.
            for (let i = 0; i < 2; i++) {
                v = i ? e.v2 : e.v1
                for (const nexte of diskEdges(v)) {
                    if (nexte.l === null && this.maskCheckEdge(nexte) && !this.visitSet.has(nexte)) {
                        this.stateAdd({...owalk, cur: nexte, lastv: v})
                        this.visitSet.add(nexte)
                    }
                }
            }
        } else if (!owalk.isBoundary) {
            // NORMAL EDGE WITH FACES
            v = e.otherVert(owalk.lastv)
            const vertEdgeTot = vertEdgeCountNonWire(v)

            // Typical looping over edges in the middle of a mesh. Blender's note on the 2: "why use 2
            // here at all? - for internal ngon loops it can be useful."
            if (vertEdgeTot === 4 || vertEdgeTot === 2) {
                const iOpposite = vertEdgeTot / 2
                let i = 0
                do {
                    l = loopOtherEdgeLoop(l!, v)
                    if (edgeIsManifold(l.e!)) {
                        l = l.radialNext!
                    } else {
                        l = null
                        break
                    }
                } while (++i !== iOpposite)
            } else {
                l = null
            }

            if (l && this.delimitMarkCheck(v, e, l)) l = null

            if (l !== null) {
                if (l !== e.l && this.maskCheckEdge(l.e!) && !this.visitSet.has(l.e!)) {
                    this.stateAdd({...owalk, cur: l.e!, lastv: v})
                    this.visitSet.add(l.e!)
                }
            }
        } else {
            // BOUNDARY EDGE WITH FACES
            v = e.otherVert(owalk.lastv)
            const vertEdgeTot = vertEdgeCountNonWire(v)

            // Check if any corner delimits should stop the step.
            let hasCornerDelimit = false
            if (this.opts.delimitInnerCorners) {
                if (vertEdgeTot > 3) hasCornerDelimit = true
            }
            if (this.opts.delimitOuterCorners && !hasCornerDelimit) {
                if (vertEdgeTot === 2 && !edgeIsSingle(e)) hasCornerDelimit = true
            }

            // Find the next boundary edge in the fan.
            if (!hasCornerDelimit) {
                let steps = 0
                for (;;) {
                    fanGuard(v, ++steps)
                    l = loopOtherEdgeLoop(l!, v)
                    if (edgeIsManifold(l.e!)) {
                        l = l.radialNext!
                    } else if (edgeIsBoundary(l.e!)) {
                        break
                    } else {
                        l = null
                        break
                    }
                }
            }

            if (l && this.delimitMarkCheck(v, e, l)) l = null

            // Stop at delimiting n-gons here so that the rewind picks the correct edge to start from.
            if (l && this.opts.delimitNgons) {
                if (owalk.isSingle !== edgeIsSingle(l.e!)) l = null
            }

            if (l !== null) {
                if (l !== e.l && this.maskCheckEdge(l.e!) && !this.visitSet.has(l.e!)) {
                    this.stateAdd({...owalk, cur: l.e!, lastv: v})
                    this.visitSet.add(l.e!)
                }
            }
        }

        return owalk.cur
    }

    run(): Generator<BMEdge> {
        return this.iterate()
    }
}

/**
 * The edge loop through `e` - Blender's `BMW_EDGELOOP`, the walker behind edit-mode loop select
 * (`Alt`-click).
 *
 * The walk starts at one end of the loop and runs through to the other, so a closed loop comes back
 * around to `e` and stops; `e` itself is always included. The four cases Blender distinguishes:
 *
 * - **interior edges** continue across a vertex of valence 4 (or 2) to the opposite edge, and stop at
 *   any other valence - a pole ends the loop.
 * - **boundary edges** follow the fan around the vertex to the next boundary edge instead.
 * - **wire edges** (no faces) take every connected wire edge.
 * - an edge along a **5+-sided n-gon** with valence-3/face-3 ends walks around that n-gon as a hub.
 *
 * Honours {@link WalkOptions.delimitSeam}, {@link WalkOptions.delimitSharp},
 * {@link WalkOptions.delimitNgons}, {@link WalkOptions.delimitInnerCorners},
 * {@link WalkOptions.delimitOuterCorners} and {@link WalkOptions.testHidden}.
 */
export function walkEdgeLoopIter(e: BMEdge, opts: WalkOptions = {}): Generator<BMEdge> {
    return new EdgeLoopWalker(e, opts).run()
}

/** {@link walkEdgeLoopIter} collected into an array, in walk order, each edge once. */
export function walkEdgeLoop(e: BMEdge, opts: WalkOptions = {}): BMEdge[] {
    return collect(walkEdgeLoopIter(e, opts))
}

// endregion

// region edge ring walker - BMW_EDGERING

interface EdgeRingState extends WalkState {
    l: BMLoop | null
    /** Set instead of `l` when the ring is a single edge: a wire edge, or one that is delimited. */
    wireedge: BMEdge | null
    noCalc: boolean
}

/**
 * Port of `bmw_EdgeringWalker_*` (`bmesh_walkers_impl.cc:1400`).
 *
 * Blender's comment: conditions for starting and stepping the edge ring have been tuned to match
 * behaviour users expect (dating back to v2.4x).
 */
class EdgeRingWalker extends Walker<EdgeRingState, BMEdge> {
    constructor(e: BMEdge, opts: WalkOptions) {
        super(opts)
        this.begin(e)
    }

    /** Port of `bmw_EdgeringWalker_delimit_check`. Non-manifold edges are never delimited. */
    private delimitCheck(e: BMEdge): boolean {
        if (!edgeIsManifold(e)) return false
        if (this.opts.delimitSeam && edgeIsSeam(e)) return true
        if (this.opts.delimitSharp && edgeIsSharp(e)) return true
        if (this.opts.delimitMaterial) {
            const l = e.l!
            if (l.f.matNr !== l.radialNext!.f.matNr) return true
        }
        return false
    }

    /** Blender's `EDGE_CHECK` macro, local to `bmw_EdgeringWalker_step`. */
    private edgeCheck(e: BMEdge): boolean {
        return this.maskCheckEdge(e) && (edgeIsBoundary(e) || edgeIsManifold(e))
    }

    private begin(e: BMEdge): void {
        const first = this.stateAdd({l: e.l, wireedge: null, noCalc: false})

        if (!first.l) {
            first.wireedge = e
            return
        }

        /*
         * A delimiting start edge is treated as a wire edge, selecting only itself. Blender's note:
         * ideally starting from a delimiting edge would scan in both directions, but supporting that
         * with the current walker logic is quite involved, especially for a corner case.
         */
        if (this.delimitCheck(e)) {
            first.l = null
            first.wireedge = e
            return
        }

        first.wireedge = null
        this.visitSet.add(first.l.e!)

        // Rewind, as in the edge loop walker: find the far end, then walk the ring from there.
        let owalk: EdgeRingState = first
        let cur = this.currentState()
        while (cur) {
            owalk = {...cur}
            this.walk()
            cur = this.currentState()
        }

        const restart = this.stateAdd({...owalk})
        const delimitNgon = !!this.opts.delimitNgons
        if (delimitNgon ? restart.l!.f.len !== 4 : restart.l!.f.len % 2 !== 0) {
            restart.l = restart.l!.radialNext!
        }

        this.visitSet.clear()
        this.visitSet.add(restart.l!.e!)

        // Add both sides so both directions are walked. When `noCalc` is set the walk hit a delimiting
        // edge and cannot step further, so the alternate state traverses the ring the other way (#157860).
        if (restart.l!.radialNext !== restart.l) {
            if (restart.noCalc ||
                (delimitNgon ? restart.l!.f.len !== 4 : restart.l!.f.len % 2 !== 0)) {
                this.stateAdd({l: restart.l!.radialNext!, wireedge: null, noCalc: false})
            }
        }
    }

    protected step(): BMEdge {
        const owalk = this.stateRemoveR()

        let l = owalk.l
        if (!l) return owalk.wireedge!

        const e = l.e!
        /*
         * The walker will not traverse to a non-manifold edge, but may be started on one, and should
         * not traverse *away* from one either: non-manifold edges are never in an edge ring with
         * manifold edges.
         */
        if (!this.edgeCheck(e) || owalk.noCalc) return e

        const delimitNgon = !!this.opts.delimitNgons
        let stepOk = false

        if (delimitNgon) {
            // Only quads.
            l = l.radialNext!
            l = l.next.next

            if (l.f.len !== 4 || !this.edgeCheck(l.e!) || !this.maskCheckFace(l.f)) {
                l = owalk.l!.next.next
            }
            // Only walk to a manifold edge.
            stepOk = l.f.len === 4 && this.edgeCheck(l.e!) && !this.visitSet.has(l.e!)
        } else {
            // Only n-gons with an even number of sides.
            l = l.radialNext!

            // `len` is the *neighbouring* face's length, and the fallback below steps that same number
            // of halves around the original face instead. Blender's quirk, kept deliberately.
            const len = l.f.len
            let i = len
            while (i > 0) {
                l = l.next
                i -= 2
            }

            if (len <= 0 || len % 2 !== 0 || !this.edgeCheck(l.e!) || !this.maskCheckFace(l.f)) {
                l = owalk.l!
                i = len
                while (i > 0) {
                    l = l.next
                    i -= 2
                }
            }
            // Only walk to a manifold edge.
            stepOk = l.f.len % 2 === 0 && this.edgeCheck(l.e!) && !this.visitSet.has(l.e!)
        }

        if (stepOk) {
            this.stateAdd({l, wireedge: null, noCalc: this.delimitCheck(l.e!)})
            this.visitSet.add(l.e!)
        }

        return e
    }

    run(): Generator<BMEdge> {
        return this.iterate()
    }
}

/**
 * The edge ring through `e` - Blender's `BMW_EDGERING`, and what loop cut walks to find the ring it
 * will cut across.
 *
 * Steps across each face to the edge opposite `e`: for a quad that is `l.next.next`, for an n-gon it is
 * half the face's length round, so only even-sided faces are crossed unless
 * {@link WalkOptions.delimitNgons} restricts the walk to quads. Stops at wire and non-manifold edges;
 * a closed ring (a cylinder) comes back to `e` and stops.
 *
 * Honours {@link WalkOptions.delimitSeam}, {@link WalkOptions.delimitSharp},
 * {@link WalkOptions.delimitMaterial}, {@link WalkOptions.delimitNgons} and
 * {@link WalkOptions.testHidden}.
 */
export function walkEdgeRingIter(e: BMEdge, opts: WalkOptions = {}): Generator<BMEdge> {
    return new EdgeRingWalker(e, opts).run()
}

/**
 * {@link walkEdgeRingIter} collected into an array in walk order, with each edge appearing once.
 *
 * The raw walk can yield one edge twice: when a delimiter stops the first pass, `begin` adds a second
 * state for the opposite direction *and* keeps the stopped one, and both yield the edge they stopped on.
 */
export function walkEdgeRing(e: BMEdge, opts: WalkOptions = {}): BMEdge[] {
    return collect(walkEdgeRingIter(e, opts))
}

// endregion

// region face loop walker - BMW_FACELOOP

interface FaceLoopState extends WalkState {
    l: BMLoop
    /** Set when the walk reached a face it may yield but must not step past. */
    noCalc: boolean
}

/**
 * Port of `bmw_FaceLoopWalker_*` (`bmesh_walkers_impl.cc:1222`). Blender's comment: conditions for
 * starting and stepping the face loop have been tuned in an attempt to match the face loops built by
 * edit-mesh.
 */
class FaceLoopWalker extends Walker<FaceLoopState, BMFace> {
    constructor(e: BMEdge, opts: WalkOptions) {
        super(opts)
        this.begin(e)
    }

    /** Port of `bmw_FaceLoopWalker_include_face`. */
    private includeFace(l: BMLoop): boolean {
        // The face must have degree 4.
        if (l.f.len !== 4) return false
        if (!this.maskCheckFace(l.f)) return false
        // The face must not have been visited *through this edge*; the same face may be entered again
        // through a different edge, which is how a closed face loop closes.
        if (this.visitSet.has(l.f) && this.visitSetAlt.has(l.e!)) return false
        return true
    }

    /** Port of `bmw_FaceLoopWalker_edge_begins_loop`. */
    private edgeBeginsLoop(e: BMEdge): boolean {
        // There is no face loop starting from a wire edge.
        if (edgeIsWire(e)) return false
        // Don't start a loop from a boundary edge if it cannot be extended to cover any faces.
        if (edgeIsBoundary(e)) {
            if (!this.includeFace(e.l!)) return false
        }
        // Don't start a face loop from non-manifold edges.
        if (!edgeIsManifold(e)) return false
        return true
    }

    /** Port of `bmw_FaceLoopWalker_delimit_check`. */
    private delimitCheck(fA: BMFace, e: BMEdge, fB: BMFace): boolean {
        if (this.opts.delimitSeam && edgeIsSeam(e)) return true
        if (this.opts.delimitSharp && edgeIsSharp(e)) return true
        if (this.opts.delimitMaterial && fA.matNr !== fB.matNr) return true
        return false
    }

    private begin(e: BMEdge): void {
        if (!this.edgeBeginsLoop(e)) return

        const first = this.stateAdd({l: e.l!, noCalc: false})
        this.visitSet.add(first.l.f)

        // Rewind, as in the edge loop walker.
        let owalk: FaceLoopState = first
        let cur = this.currentState()
        while (cur) {
            owalk = {...cur}
            this.walk()
            cur = this.currentState()
        }

        const restart = this.stateAdd({...owalk})
        restart.noCalc = false

        this.visitSetAlt.clear()
        this.visitSetAlt.add(restart.l.e!)

        this.visitSet.clear()
        this.visitSet.add(restart.l.f)

        // When starting on a delimiting edge, add both sides so both directions are walked.
        if (this.delimitCheck(restart.l.f, restart.l.e!, restart.l.radialNext!.f)) {
            const alt = this.stateAdd({l: restart.l.radialNext!, noCalc: false})
            this.visitSet.add(alt.l.f)
        }
    }

    protected step(): BMFace {
        const owalk = this.stateRemoveR()

        const f = owalk.l.f
        let l = owalk.l.radialNext!

        if (owalk.noCalc) return f

        if (!this.includeFace(l)) {
            l = owalk.l
            l = l.next.next
            if (!edgeIsManifold(l.e!)) l = l.prev.prev
            l = l.radialNext!
        }

        if (this.includeFace(l)) {
            const next = this.stateAdd({l, noCalc: false})

            if (l.f.len !== 4 || this.delimitCheck(f, l.e!, l.f)) {
                // Yield the face, but do not step past it.
                next.noCalc = true
                next.l = owalk.l
            } else {
                next.noCalc = false
            }

            // Both may already exist.
            this.visitSetAlt.add(l.e!)
            this.visitSet.add(l.f)
        }

        return f
    }

    run(): Generator<BMFace> {
        return this.iterate()
    }
}

/**
 * The face loop crossing `e` - Blender's `BMW_FACELOOP`.
 *
 * Takes an **edge**, not a face: `BMW_FACELOOP`'s `begin_htype` is `BM_EDGE`, because a face alone does
 * not say which of its two loops to follow. The walk covers the quads the loop passes through, in walk
 * order.
 *
 * A closed face loop yields its first face **twice** - once at the start and once on coming back round,
 * because the return arrives through a different edge and `bmw_FaceLoopWalker_include_face` only rejects
 * a face reached through an edge it was already reached by. That is Blender's behaviour, and harmless
 * there because callers only set a selection flag. {@link walkFaceLoop} drops the duplicate;
 * {@link walkFaceLoopIter} does not.
 *
 * Honours {@link WalkOptions.delimitSeam}, {@link WalkOptions.delimitSharp},
 * {@link WalkOptions.delimitMaterial} and {@link WalkOptions.testHidden}.
 */
export function walkFaceLoopIter(e: BMEdge, opts: WalkOptions = {}): Generator<BMFace> {
    return new FaceLoopWalker(e, opts).run()
}

/**
 * {@link walkFaceLoopIter} collected into an array in walk order, with each face appearing once.
 * See the note there about the duplicated first face of a closed loop.
 */
export function walkFaceLoop(e: BMEdge, opts: WalkOptions = {}): BMFace[] {
    return collect(walkFaceLoopIter(e, opts))
}

// endregion

// region boundary edge walker - BMW_EDGEBOUNDARY

interface EdgeBoundaryState extends WalkState {
    e: BMEdge
}

/** Port of `bmw_EdgeboundaryWalker_*` (`bmesh_walkers_impl.cc:1583`). */
class EdgeBoundaryWalker extends Walker<EdgeBoundaryState, BMEdge> {
    constructor(e: BMEdge, opts: WalkOptions) {
        super(opts)
        this.begin(e)
    }

    private begin(e: BMEdge): void {
        // Blender asserts the seed is a boundary edge. Here it is a thrown error, because a silent
        // empty walk would be a confusing way to report a caller's mistake.
        if (!edgeIsBoundary(e)) {
            throw new Error(`mesh-kernel: edge ${e.id} is not a boundary edge (it has ` +
                `${e.l ? 'more than one face' : 'no faces'})`)
        }
        if (this.visitSet.has(e)) return
        this.stateAdd({e})
        this.visitSet.add(e)
    }

    protected step(): BMEdge {
        const owalk = this.stateRemoveR()
        const e = owalk.e

        if (!this.maskCheckEdge(e)) return e

        for (let i = 0; i < 2; i++) {
            const v = i ? e.v2 : e.v1
            for (const eOther of diskEdges(v)) {
                if (e !== eOther && edgeIsBoundary(eOther)) {
                    if (this.visitSet.has(eOther)) continue
                    if (!this.maskCheckEdge(eOther)) continue
                    this.stateAdd({e: eOther})
                    this.visitSet.add(eOther)
                }
            }
        }

        return e
    }

    run(): Generator<BMEdge> {
        return this.iterate()
    }
}

/**
 * Every boundary edge connected to `e` through shared vertices - Blender's `BMW_EDGEBOUNDARY`, used by
 * "select boundary loop".
 *
 * `e` must be a boundary edge (exactly one face). Note this is a flood fill over boundary edges, not an
 * ordered traversal: where two boundary loops meet at a pinched vertex it takes both, so the result is
 * the connected boundary component rather than a single cycle. Depth-first, each edge once.
 *
 * Honours {@link WalkOptions.testHidden}; `BMW_EDGEBOUNDARY` supports no delimiters.
 */
export function walkEdgeBoundaryIter(e: BMEdge, opts: WalkOptions = {}): Generator<BMEdge> {
    return new EdgeBoundaryWalker(e, opts).run()
}

/** {@link walkEdgeBoundaryIter} collected into an array, in walk order, each edge once. */
export function walkEdgeBoundary(e: BMEdge, opts: WalkOptions = {}): BMEdge[] {
    return collect(walkEdgeBoundaryIter(e, opts))
}

// endregion

// region loop shell walker - BMW_LOOP_SHELL

interface LoopShellState extends WalkState {
    curloop: BMLoop
}

/**
 * Port of `bmw_LoopShellWalker_*` (`bmesh_walkers_impl.cc:225`). Breadth-first, yields loops.
 *
 * Blender's note: this is mainly useful to loop over a shell delimited by edges. The wire variant
 * (`BMW_LOOP_SHELL_WIRE`) is not ported.
 */
class LoopShellWalker extends Walker<LoopShellState, BMLoop> {
    protected readonly order: WalkOrder = 'breadthFirst'

    constructor(start: BMVert | BMEdge | BMFace | BMLoop, opts: WalkOptions) {
        super(opts)
        this.begin(start)
    }

    private visitLoop(l: BMLoop): void {
        if (this.visitSet.has(l)) return
        if (!this.maskCheckFace(l.f)) return
        this.stateAdd({curloop: l})
        this.visitSet.add(l)
    }

    private begin(start: BMVert | BMEdge | BMFace | BMLoop): void {
        if (start instanceof BMLoop) {
            this.visitLoop(start)
        } else if (start instanceof BMVert) {
            // `BM_LOOPS_OF_VERT`: every corner at the vertex, found through its disk cycle.
            for (const e of diskEdges(start)) {
                for (const l of radialLoops(e)) {
                    if (l.v === start) this.visitLoop(l)
                }
            }
        } else if (start instanceof BMEdge) {
            for (const l of radialLoops(start)) this.visitLoop(l)
        } else {
            // The walker handles the other loops within the face.
            if (start.lFirst) this.visitLoop(start.lFirst)
        }
    }

    protected step(): BMLoop {
        const owalk = this.stateRemoveR()
        const l = owalk.curloop

        this.visitLoop(l.next)
        this.visitLoop(l.prev)

        const edgePair = [l.e, l.prev.e]
        for (const e of edgePair) {
            if (!e) continue
            if (!this.maskCheckEdge(e)) continue
            for (const lIter of radialLoops(e)) {
                const lRadial = lIter.v === l.v ? lIter : lIter.next
                if (l !== lRadial) this.visitLoop(lRadial)
            }
        }

        return l
    }

    run(): Generator<BMLoop> {
        return this.iterate()
    }
}

/**
 * Every loop of the shell `start` belongs to - Blender's `BMW_LOOP_SHELL`. Breadth-first, each loop
 * once. `start` may be a vertex, edge, face or loop.
 *
 * Honours {@link WalkOptions.testHidden}; `BMW_LOOP_SHELL` supports no delimiters.
 */
export function walkLoopShellIter(start: BMVert | BMEdge | BMFace | BMLoop, opts: WalkOptions = {}): Generator<BMLoop> {
    return new LoopShellWalker(start, opts).run()
}

/** {@link walkLoopShellIter} collected into an array, in walk order, each loop once. */
export function walkLoopShell(start: BMVert | BMEdge | BMFace | BMLoop, opts: WalkOptions = {}): BMLoop[] {
    return collect(walkLoopShellIter(start, opts))
}

// endregion

// region island walker - BMW_ISLAND / BMW_ISLAND_MANIFOLD

interface IslandState extends WalkState {
    cur: BMFace
}

/** Port of `bmw_IslandWalker_*` (`bmesh_walkers_impl.cc:734`). Breadth-first, yields faces. */
class IslandWalker extends Walker<IslandState, BMFace> {
    protected readonly order: WalkOrder = 'breadthFirst'

    constructor(f: BMFace, private readonly onlyManifold: boolean, opts: WalkOptions) {
        super(opts)
        this.begin(f)
    }

    private begin(f: BMFace): void {
        if (!this.maskCheckFace(f)) return
        this.stateAdd({cur: f})
        this.visitSet.add(f)
    }

    /** Port of `bmw_IslandWalker_step_ex`. */
    protected step(): BMFace {
        const owalk = this.stateRemoveR()

        for (const lIter of owalk.cur.eachLoop()) {
            if (!lIter.e || !this.maskCheckEdge(lIter.e)) continue

            let lRadial: BMLoop

            if (this.onlyManifold && lIter.radialNext !== lIter) {
                // Ensure exactly one other face can be walked onto.
                let faceCount = 1
                lRadial = lIter.radialNext!
                do {
                    if (this.maskCheckFace(lRadial.f)) {
                        faceCount++
                        if (faceCount === 3) break
                    }
                    lRadial = lRadial.radialNext!
                } while (lRadial !== lIter)

                if (faceCount !== 2) continue
            }

            lRadial = lIter
            while ((lRadial = lRadial.radialNext!) !== lIter) {
                const f = lRadial.f
                if (!this.maskCheckFace(f)) continue
                // Saves a visit-set lookup: on a manifold edge there is a 50% chance of this.
                if (f === owalk.cur) continue
                if (this.visitSet.has(f)) continue

                this.stateAdd({cur: f})
                this.visitSet.add(f)
                break
            }
        }

        return owalk.cur
    }

    run(): Generator<BMFace> {
        return this.iterate()
    }
}

/**
 * The face region connected to `f` across shared edges - Blender's `BMW_ISLAND`. Breadth-first, each
 * face once.
 *
 * With `onlyManifold`, edges that do not have exactly two usable faces are not crossed, which is
 * `BMW_ISLAND_MANIFOLD`.
 *
 * Honours {@link WalkOptions.testHidden}; `BMW_ISLAND` supports no delimiters.
 */
export function walkIslandIter(f: BMFace, onlyManifold = false, opts: WalkOptions = {}): Generator<BMFace> {
    return new IslandWalker(f, onlyManifold, opts).run()
}

/** {@link walkIslandIter} collected into an array, in walk order, each face once. */
export function walkIsland(f: BMFace, onlyManifold = false, opts: WalkOptions = {}): BMFace[] {
    return collect(walkIslandIter(f, onlyManifold, opts))
}

// endregion

/**
 * Loop and ring select on click: Alt+click an edge for its loop, Ctrl+Alt+click for its ring, in
 * face mode a face loop; Alt+click a boundary edge twice to walk the whole boundary.
 *
 * Port of `walker_select_count` / `walker_select` (`editors/mesh/editmesh_select.cc:1656`, `:1694`),
 * `mouse_mesh_loop_face` / `_edge_ring` / `_edge` (`:2033`, `:2042`, `:2075`),
 * `edbm_select_loop_or_ring_by_edge` (`:2143`) and the select/clear/cycle resolution of
 * `edbm_select_loop_or_ring_exec_impl` (`:2296`) plus the active-element choice of
 * `edbm_select_loop_or_ring_invoke_impl` (`:2420`).
 *
 * The walkers themselves are the kernel's ports of Blender's (`walkEdgeLoop`, `walkEdgeRing`,
 * `walkFaceLoop`, `walkEdgeBoundary`, `walkEdgeLoopNonManifold`).
 */

import {
    BMesh,
    BMEdge,
    BMFace,
    BMVert,
    edgeFaceCount,
    edgeIsBoundary,
    ElemFlag,
    elemSelectSet,
    radialLoops,
    SelectMode,
    selectHistoryRemove,
    selectHistoryStore,
    selectModeFlush,
    selectNone,
    walkEdgeBoundaryIter,
    walkEdgeLoopIter,
    walkEdgeLoopNonManifoldIter,
    walkEdgeRingIter,
    walkFaceLoopIter,
    WalkOptions,
} from '@threepipe/mesh-kernel'
import type {ProjectFn} from '../picking'
import {faceCenter} from './regionSelect'

export type LoopWalker = 'edgeLoop' | 'edgeRing' | 'faceLoop' | 'edgeBoundary' | 'edgeLoopNonManifold'

/** `BMWDelimitFlag` as the kernel's walker options; `delimitSeam`/`delimitSharp` drive the cycling. */
export type LoopDelimit = Pick<WalkOptions,
    'delimitSeam' | 'delimitSharp' | 'delimitMaterial' | 'delimitNgons' | 'delimitInnerCorners' | 'delimitOuterCorners'>

const NO_DELIMIT: LoopDelimit = {}

function walk(kind: LoopWalker, e: BMEdge, delimit: LoopDelimit): Iterable<BMEdge | BMFace> {
    // `BMW_FLAG_TEST_HIDDEN` on every walk, as the callers pass.
    const opts: WalkOptions = {...delimit, testHidden: true}
    switch (kind) {
    case 'edgeLoop': return walkEdgeLoopIter(e, opts)
    case 'edgeRing': return walkEdgeRingIter(e, opts)
    case 'faceLoop': return walkFaceLoopIter(e, opts)
    case 'edgeBoundary': return walkEdgeBoundaryIter(e, {testHidden: true})
    case 'edgeLoopNonManifold': return walkEdgeLoopNonManifoldIter(e, {testHidden: true})
    }
}

/**
 * `walker_select_count` (`:1656`): how many walked elements are unselected (`[0]`) and selected
 * (`[1]`), or `[-1, -1]` as soon as both kinds are seen.
 */
export function walkerSelectCount(kind: LoopWalker, e: BMEdge, delimit: LoopDelimit): [number, number] {
    const count: [number, number] = [0, 0]
    for (const ele of walk(kind, e, delimit)) {
        count[ele.hflag & ElemFlag.Select ? 1 : 0] += 1
        // Early exit when mixed.
        if (count[0] && count[1]) {
            count[0] = count[1] = -1
            break
        }
    }
    return count
}

/** `walker_select` (`:1694`): select or deselect everything the walker visits. */
export function walkerSelect(bm: BMesh, kind: LoopWalker, e: BMEdge, select: boolean, delimit: LoopDelimit): boolean {
    let changed = false
    for (const ele of walk(kind, e, delimit)) {
        if (!select) selectHistoryRemove(bm, ele)
        elemSelectSet(bm, ele, select)
        changed = true
    }
    return changed
}

/** `mouse_mesh_loop_face` (`:2033`). */
export function mouseMeshLoopFace(bm: BMesh, eed: BMEdge, select: boolean, selectClear: boolean, delimit: LoopDelimit): void {
    if (selectClear) selectNone(bm)
    walkerSelect(bm, 'faceLoop', eed, select, delimit)
}

/** `mouse_mesh_loop_edge_ring` (`:2042`). */
export function mouseMeshLoopEdgeRing(bm: BMesh, eed: BMEdge, select: boolean, selectClear: boolean, delimit: LoopDelimit): void {
    let fullLoop = false

    // Cycle between using delimits and skipping them.
    if (delimit.delimitSeam || delimit.delimitSharp) {
        // If up to the delimits is selected toggle the whole loop.
        let count = walkerSelectCount('edgeRing', eed, delimit)
        if (count[select ? 0 : 1] === 0) {
            fullLoop = true
            // If the whole loop is selected, toggle back to delimits.
            count = walkerSelectCount('edgeRing', eed, NO_DELIMIT)
            if (count[select ? 0 : 1] === 0) fullLoop = false
        }
    }
    if (selectClear) selectNone(bm)
    walkerSelect(bm, 'edgeRing', eed, select, fullLoop ? NO_DELIMIT : delimit)
}

/** `mouse_mesh_loop_edge` (`:2075`). */
export function mouseMeshLoopEdge(
    bm: BMesh, eed: BMEdge, select: boolean, selectClear: boolean, selectCycle: boolean, delimit: LoopDelimit,
): void {
    let fullBoundary = false
    let fullLoop = false
    const nonManifold = edgeFaceCount(eed) > 2

    // Cycle between the edge loop and the boundary.
    if (selectCycle && edgeIsBoundary(eed)) {
        // If the loop is selected toggle the boundary.
        let count = walkerSelectCount('edgeLoop', eed, delimit)
        if (count[select ? 0 : 1] === 0) {
            fullBoundary = true
            // If the boundary is selected, toggle back to the loop.
            count = walkerSelectCount('edgeBoundary', eed, NO_DELIMIT)
            if (count[select ? 0 : 1] === 0) fullBoundary = false
        }
    } else if (!nonManifold && (delimit.delimitSeam || delimit.delimitSharp)) {
        // Cycle between using delimits and skipping them.
        let count = walkerSelectCount('edgeLoop', eed, delimit)
        if (count[select ? 0 : 1] === 0) {
            fullLoop = true
            count = walkerSelectCount('edgeLoop', eed, NO_DELIMIT)
            if (count[select ? 0 : 1] === 0) fullLoop = false
        }
    }

    if (selectClear) selectNone(bm)

    if (fullBoundary) {
        walkerSelect(bm, 'edgeBoundary', eed, select, NO_DELIMIT)
    } else if (nonManifold) {
        walkerSelect(bm, 'edgeLoopNonManifold', eed, select, delimit)
    } else if (fullLoop) {
        walkerSelect(bm, 'edgeLoop', eed, select, NO_DELIMIT)
    } else {
        walkerSelect(bm, 'edgeLoop', eed, select, delimit)
    }
}

/**
 * `edbm_select_loop_or_ring_by_edge` (`:2143`): the core, shared by invoke and exec. Face mode walks
 * a face loop; otherwise a ring or a loop. The edge becomes active when selecting in edge mode.
 */
export function selectLoopOrRingByEdge(
    bm: BMesh, eed: BMEdge, select: boolean, selectClear: boolean, selectCycle: boolean, ring: boolean, delimit: LoopDelimit,
): void {
    if (bm.selectMode & SelectMode.Face) {
        mouseMeshLoopFace(bm, eed, select, selectClear, delimit)
    } else if (ring) {
        mouseMeshLoopEdgeRing(bm, eed, select, selectClear, delimit)
    } else {
        mouseMeshLoopEdge(bm, eed, select, selectClear, selectCycle, delimit)
    }

    selectModeFlush(bm)

    // Sets as active, useful for other tools.
    if (select && bm.selectMode & SelectMode.Edge) selectHistoryStore(bm, eed)
}

export interface LoopSelectParams {
    /** `Shift`: add the loop to the selection. */
    extend?: boolean
    /** Remove the loop from the selection. */
    deselect?: boolean
    /** Toggle: select, or deselect when the edge was already selected. */
    toggle?: boolean
    /** `Ctrl`: edge ring instead of edge loop. Ignored in face mode. */
    ring?: boolean
    delimit?: LoopDelimit
    /**
     * Cursor position and projection, so the active element can be the end of the clicked edge
     * nearest the cursor in vertex mode, or the face of that edge nearest the cursor in face mode -
     * what `edbm_select_loop_or_ring_invoke_impl` records for redo.
     */
    cursor?: {x: number, y: number, project: ProjectFn}
}

/**
 * Loop or ring select from a picked edge, with Blender's modifier semantics
 * (`edbm_select_loop_or_ring_exec_impl`, `:2296`):
 * - no modifier: replace the selection (`select_clear`), and cycle loop/boundary on repeat;
 * - extend: always select; deselect: always deselect;
 * - toggle: select unless the edge was selected, in which case deselect without cycling.
 */
export function loopSelectEdge(bm: BMesh, eed: BMEdge, params: LoopSelectParams = {}): void {
    if (eed.hflag & ElemFlag.Hidden) return
    const extend = !!params.extend
    const deselect = !!params.deselect
    const toggle = !!params.toggle

    let select = true
    let selectClear = false
    let selectCycle = true

    if (!extend && !deselect && !toggle) selectClear = true

    if (extend) {
        select = true
    } else if (deselect) {
        select = false
    } else if (selectClear || !(eed.hflag & ElemFlag.Select)) {
        select = true
    } else if (toggle) {
        select = false
        selectCycle = false
    }

    selectLoopOrRingByEdge(bm, eed, select, selectClear, selectCycle, !!params.ring, params.delimit ?? NO_DELIMIT)

    // Set the active element from the cursor (the invoke's vert_index / face_index).
    if (select && params.cursor) {
        const {x, y, project} = params.cursor
        if (bm.selectMode & SelectMode.Vertex) {
            // Find the nearest vert from the mouse.
            const p1 = project(eed.v1.x, eed.v1.y, eed.v1.z)
            const p2 = project(eed.v2.x, eed.v2.y, eed.v2.z)
            const length1 = p1 ? (p1.x - x) ** 2 + (p1.y - y) ** 2 : Infinity
            const length2 = p2 ? (p2.x - x) ** 2 + (p2.y - y) ** 2 : Infinity
            const v: BMVert = length1 < length2 ? eed.v1 : eed.v2
            if (!(v.hflag & ElemFlag.Hidden) && v.hflag & ElemFlag.Select) selectHistoryStore(bm, v)
        } else if (bm.selectMode & SelectMode.Face) {
            // Find the face of eed which is the nearest of the mouse.
            let best: BMFace | null = null
            let bestDist = Infinity
            const c = {x: 0, y: 0, z: 0}
            for (const l of radialLoops(eed)) {
                faceCenter(l.f, c)
                const p = project(c.x, c.y, c.z)
                if (!p) continue
                const d = (p.x - x) ** 2 + (p.y - y) ** 2
                if (d < bestDist) {
                    bestDist = d
                    best = l.f
                }
            }
            if (best && !(best.hflag & ElemFlag.Hidden) && best.hflag & ElemFlag.Select) {
                bm.actFace = best
                selectHistoryStore(bm, best)
            }
        }
    }
}

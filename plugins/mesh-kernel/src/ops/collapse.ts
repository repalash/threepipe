/**
 * Point merge and collapse: the rest of `source/blender/bmesh/operators/bmo_removedoubles.cc` -
 * `bmo_pointmerge_exec` (`:463`), `bmo_collapse_exec` (`:501`), `bmo_collapse_uvs_exec` with
 * `bmo_collapsecon_do_layer` (`:592`, `:656`), `bmo_average_vert_facedata_exec` (`:422`) and
 * `bmo_pointmerge_facedata_exec` (`:370`) - with the loop-data island walker they use
 * (`bmw_UVEdgeWalker`, `bmesh/intern/bmesh_walkers_impl.cc:1674`), and the edit-mode Merge and
 * Collapse operators over them (`edbm_merge_exec`, `merge_target`, `merge_firstlast`,
 * `edbm_collapse_edge_exec` in `editors/mesh/editmesh_tools.cc`).
 *
 * Operator flags (`EDGE_MARK`) are sets. The weld itself is `weldVerts` (`weld.ts`, `bmo_weld_verts_exec`).
 */

import {BMEdge, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {edgeIsBoundary} from '../bmesh/structure'
import {copyElemAttrs, getValue, setValue, type BMLayerDef} from '../bmesh/customdata'
import {layerAdd, layerDataEquals, layerDoMinMax, layerHasMath, layerInitMinMax, layerMidpoint, layerMultiply} from '../bmesh/customdataMath'
import {edbmFlagDisableAll} from '../bmesh/hflag'
import {vertFaceCount, walkVertShellEdgesIter} from '../bmesh/walkers'
import {ElemFlag, SelectMode} from '../constants'
import type {Vec3} from '../math'
import {BmeshEditEndFlags, bmoOpExec} from './bmo'
import {loopsOfVert} from './dissolve'
import {weldVerts} from './weld'

// region loop-data island walker (`bmw_UVEdgeWalker_*`, bmesh_walkers_impl.cc:1674-1755)

/**
 * `BMW_LOOPDATA_ISLAND`: from a loop, every loop reachable across `maskEdge` edges whose `layer` value
 * matches. Depth first (`BMW_DEPTH_FIRST`: the newest state is the current one). The visit set lives
 * as long as the walker, so a second `begin` on a loop already walked yields nothing - Blender reuses
 * one walker for a whole layer (`bmo_collapsecon_do_layer`).
 */
class LoopDataIslandWalker {
    private readonly visit = new Set<BMLoop>()
    private readonly states: BMLoop[] = []

    constructor(private readonly layer: BMLayerDef, private readonly maskEdge: (e: BMEdge) => boolean) {}

    /** `BMW_begin`: the first loop, or null. */
    begin(l: BMLoop): BMLoop | null {
        // bmw_UVEdgeWalker_begin
        if (!this.visit.has(l)) {
            this.states.push(l)
            this.visit.add(l)
        }
        return this.states.length ? this.step() : null
    }

    /** `BMW_step`: the next loop, or null. */
    next(): BMLoop | null {
        return this.states.length ? this.step() : null
    }

    private step(): BMLoop {
        const l = this.states.pop()! // BMW_state_remove_r
        if (!this.maskEdge(l.e!)) return l

        // "Go over loops around `l->v` and `l->next->v` and see which ones share `l` and `l->next`
        // UV coordinates. in addition, push on `l->next` if necessary."
        for (let i = 0; i < 2; i++) {
            const lPivot = i ? l.next : l
            const dataPivot = getValue(lPivot, this.layer)
            for (const lRadialFirst of loopsOfVert(lPivot.v)) {
                let lRadial = lRadialFirst
                do {
                    if (this.visit.has(lRadial)) continue
                    if (lRadial.v !== lPivot.v && !this.maskEdge(lRadial.e!)) continue
                    const lOther = lRadial.v !== lPivot.v ? lRadial.next : lRadial
                    if (!layerDataEquals(this.layer, dataPivot, getValue(lOther, this.layer))) continue
                    this.states.push(lRadial)
                    this.visit.add(lRadial)
                } while ((lRadial = lRadial.radialNext!) !== lRadialFirst)

                // "Also traverse the previous loop's edge `l_radial_first->prev->e` for masked walks.
                // This handles boundary edges where face winding places the loop at the opposite end
                // of the edge from the pivot vertex" (#152249).
                const lBoundary = lRadialFirst.prev
                if (edgeIsBoundary(lBoundary.e!) && this.maskEdge(lBoundary.e!) && !this.visit.has(lBoundary)) {
                    this.visit.add(lBoundary)
                    this.states.push(lBoundary)
                }
            }
        }
        return l
    }
}

// endregion

// region bmesh operators

/**
 * `bmo_collapse_uvs_exec` (`bmo_removedoubles.cc:656`): for every loop layer with math, snap each
 * island of matching values along `edges` to the midpoint of its bounds (`bmo_collapsecon_do_layer`).
 */
export function collapseUvs(bm: BMesh, edges: Iterable<BMEdge>): void {
    const mathLayers = bm.ldata.layers.filter(layerHasMath)
    if (!mathLayers.length) return // CustomData_has_math
    const mark = new Set(edges) // EDGE_MARK
    for (const layer of mathLayers) {
        const walker = new LoopDataIslandWalker(layer, e => mark.has(e))
        for (const f of bm.faces) {
            for (const l of f.eachLoop()) {
                if (!mark.has(l.e!)) continue
                const stack: BMLoop[] = []
                const {min, max} = layerInitMinMax(layer)
                for (let l2 = walker.begin(l); l2; l2 = walker.next()) {
                    layerDoMinMax(layer, getValue(l2, layer), min, max)
                    stack.push(l2)
                }
                if (stack.length) {
                    // "Snap custom-data (UV, vertex-colors) points to their centroid."
                    const mid = layerMidpoint(layer, min, max)
                    while (stack.length) setValue(stack.pop()!, bm.ldata, layer, mid)
                }
            }
        }
    }
}

/**
 * `bmo_collapse_exec` (`:501`): each connected group of `edges` collapses to one vertex at the mean of
 * its edges' ends (each end counted once per edge), optionally collapsing the loop data first.
 */
export function collapseEdges(bm: BMesh, edges: readonly BMEdge[], uvs: boolean): void {
    if (uvs) bmoOpExec(bm, null, () => collapseUvs(bm, edges)) // `collapse_uvs edges=%s`, nested

    const mark = new Set(edges) // EDGE_MARK
    const targetmap = new Map<BMVert, BMVert>()
    // The walker's visit set outlives each `BMW_begin`: an edge already walked starts nothing.
    const walked = new Set<BMEdge>()
    for (const e of [...bm.edges]) {
        if (!mark.has(e) || walked.has(e)) continue
        let cx = 0, cy = 0, cz = 0
        let count = 0
        const edgeStack: BMEdge[] = []
        for (const ew of walkVertShellEdgesIter(e.v1, {maskEdge: x => mark.has(x)})) {
            walked.add(ew)
            edgeStack.push(ew)
            cx = Math.fround(cx + ew.v1.x); cy = Math.fround(cy + ew.v1.y); cz = Math.fround(cz + ew.v1.z)
            cx = Math.fround(cx + ew.v2.x); cy = Math.fround(cy + ew.v2.y); cz = Math.fround(cz + ew.v2.z)
            count += 2
            // Prevent adding to `slot_targetmap` multiple times.
            ew.v1.hflag &= ~ElemFlag.Tag
            ew.v2.hflag &= ~ElemFlag.Tag
        }
        if (!edgeStack.length) continue
        const f = Math.fround(1 / count)
        const center = [Math.fround(cx * f), Math.fround(cy * f), Math.fround(cz * f)]
        // Snap edges to a point. `BLI_stack_peek`: the last edge walked.
        const vTar = edgeStack[edgeStack.length - 1].v1
        while (edgeStack.length) {
            const ep = edgeStack.pop()!
            for (const vSrc of [ep.v1, ep.v2]) {
                vSrc.setCo(center[0], center[1], center[2])
                if (vSrc !== vTar && !(vSrc.hflag & ElemFlag.Tag)) {
                    vSrc.hflag |= ElemFlag.Tag
                    targetmap.set(vSrc, vTar)
                }
            }
        }
    }
    bmoOpExec(bm, null, () => weldVerts(bm, targetmap)) // `weld_verts`, nested
}

/**
 * `bmo_pointmerge_exec` (`:463`): weld `verts` into one. Without `vertTarget` the first of `verts` is
 * moved to `mergeCo` and survives, and vertex data is averaged; with it, `vertTarget` survives where it is.
 */
export function pointmerge(bm: BMesh, verts: readonly BMVert[], mergeCo: Vec3, vertTarget: BMVert | null = null): void {
    const isExplicitSnap = vertTarget !== null
    const targetmap = new Map<BMVert, BMVert>()
    for (const v of verts) {
        if (!vertTarget) {
            vertTarget = v
            vertTarget.setCo(mergeCo[0], mergeCo[1], mergeCo[2])
        } else if (v !== vertTarget) {
            targetmap.set(v, vertTarget)
        }
    }
    bmoOpExec(bm, null, () => weldVerts(bm, targetmap, {averageVertData: !isExplicitSnap}))
}

/**
 * `bmo_average_vert_facedata_exec` (`:422`): every loop of `verts` takes, per math layer, the midpoint
 * of the bounds of all their values.
 */
export function averageVertFacedata(bm: BMesh, verts: readonly BMVert[]): void {
    for (const layer of bm.ldata.layers) {
        if (!layerHasMath(layer)) continue
        const {min, max} = layerInitMinMax(layer)
        for (const v of verts) for (const l of loopsOfVert(v)) layerDoMinMax(layer, getValue(l, layer), min, max)
        const mid = layerMidpoint(layer, min, max)
        for (const v of verts) for (const l of loopsOfVert(v)) setValue(l, bm.ldata, layer, mid)
    }
}

/**
 * `bmo_pointmerge_facedata_exec` (`:370`): the loops of `vertTarget` average their math layers into
 * its first loop, whose whole block then goes to every loop of `verts`.
 */
export function pointmergeFacedata(bm: BMesh, verts: readonly BMVert[], vertTarget: BMVert): void {
    const tot = vertFaceCount(vertTarget)
    if (!tot) return
    const fac = Math.fround(1 / tot)
    let lFirst: BMLoop | null = null
    for (const l of loopsOfVert(vertTarget)) {
        if (lFirst === null) lFirst = l
        for (const layer of bm.ldata.layers) {
            if (!layerHasMath(layer)) continue
            const e2 = getValue(l, layer)
            layerMultiply(layer, e2, fac)
            setValue(l, bm.ldata, layer, e2)
            if (l !== lFirst) {
                const e1 = getValue(lFirst, layer)
                layerAdd(layer, e1, e2)
                setValue(lFirst, bm.ldata, layer, e1)
            }
        }
    }
    for (const v of verts) {
        for (const l of loopsOfVert(v)) {
            if (l === lFirst) continue
            copyElemAttrs(lFirst!, l, bm.ldata) // CustomData_bmesh_copy_block
        }
    }
}

// endregion

// region edit-mode Merge and Collapse

/** `bmo_pointmerge_def` / `bmo_collapse_def` `type_flag`: NORMALS_CALC | SELECT_FLUSH | SELECT_VALIDATE. */
const MERGE_TYPE_FLAG: BmeshEditEndFlags = {normalsCalc: true, selectFlush: true, selectValidate: true}
/** `bmo_average_vert_facedata_def` / `bmo_pointmerge_facedata_def` `type_flag`: none. */
const FACEDATA_TYPE_FLAG: BmeshEditEndFlags = {}

/** `merge_type_items` (`editmesh_tools.cc:3565`). */
export type MergeType = 'CENTER' | 'CURSOR' | 'COLLAPSE' | 'FIRST' | 'LAST'

export type MergeSelectionResult = {ok: true} | {ok: false, error: string}

const selectedVisibleVerts = (bm: BMesh) =>
    [...bm.verts].filter(v => (v.hflag & ElemFlag.Select) && !(v.hflag & ElemFlag.Hidden))

/**
 * `merge_target` (`editmesh_tools.cc:3434`): merge the selected vertices at their centre, or at the
 * 3D cursor (`cursor`, already in the object's local space - Blender multiplies by `world_to_object`).
 */
function mergeTarget(bm: BMesh, cursor: Vec3 | null, useUvmerge: boolean): boolean {
    let co: Vec3
    if (cursor) {
        co = [cursor[0], cursor[1], cursor[2]]
    } else {
        let cx = 0, cy = 0, cz = 0
        let i = 0
        for (const v of bm.verts) {
            if (!(v.hflag & ElemFlag.Select)) continue
            cx = Math.fround(cx + v.x); cy = Math.fround(cy + v.y); cz = Math.fround(cz + v.z)
            i++
        }
        if (!i) return false
        const fac = Math.fround(1 / i)
        co = [Math.fround(cx * fac), Math.fround(cy * fac), Math.fround(cz * fac)]
    }
    if (useUvmerge) bmoOpExec(bm, FACEDATA_TYPE_FLAG, () => averageVertFacedata(bm, selectedVisibleVerts(bm)))
    bmoOpExec(bm, MERGE_TYPE_FLAG, () => pointmerge(bm, selectedVisibleVerts(bm), co))
    return true
}

/** `merge_firstlast` (`:3374`): merge at the first or last vertex of the select history. */
function mergeFirstlast(bm: BMesh, useFirst: boolean, useUvmerge: boolean): boolean {
    const hist = bm.selectHistory
    const ese = useFirst ? hist[0] : hist[hist.length - 1]
    if (!ese || !(ese.elem instanceof BMVert)) return false
    const mergevert = ese.elem
    if (!(mergevert.hflag & ElemFlag.Select)) return false
    if (useUvmerge) bmoOpExec(bm, FACEDATA_TYPE_FLAG, () => pointmergeFacedata(bm, selectedVisibleVerts(bm), mergevert))
    const co: Vec3 = [mergevert.x, mergevert.y, mergevert.z]
    bmoOpExec(bm, MERGE_TYPE_FLAG, () => pointmerge(bm, selectedVisibleVerts(bm), co))
    return true
}

/**
 * `MESH_OT_merge` (`edbm_merge_exec`, `editmesh_tools.cc:3488`): merge the selected vertices by
 * `type`. `cursor` is the 3D cursor in the mesh's local space (for `CURSOR`). `uvs` is Blender's
 * "UVs" option (`MESH_OT_merge.uvs`, default false): move UVs according to the merge.
 */
export function mergeSelection(bm: BMesh, type: MergeType, uvs = false, cursor: Vec3 | null = null): MergeSelectionResult {
    if (bm.totvertsel === 0) return {ok: false, error: 'No vertices selected'}
    let ok = false
    switch (type) {
    case 'CENTER':
        ok = mergeTarget(bm, null, uvs)
        break
    case 'CURSOR':
        if (!cursor) return {ok: false, error: 'No 3D cursor to merge at'}
        ok = mergeTarget(bm, cursor, uvs)
        break
    case 'LAST':
        ok = mergeFirstlast(bm, false, uvs)
        break
    case 'FIRST':
        ok = mergeFirstlast(bm, true, uvs)
        break
    case 'COLLAPSE': {
        const edges = [...bm.edges].filter(e => (e.hflag & ElemFlag.Select) && !(e.hflag & ElemFlag.Hidden))
        bmoOpExec(bm, MERGE_TYPE_FLAG, () => collapseEdges(bm, edges, uvs))
        ok = true
        break
    }
    }
    if (!ok) return {ok: false, error: type === 'FIRST' || type === 'LAST' ? `The ${type === 'FIRST' ? 'first' : 'last'} selected element is not a selected vertex` : 'Nothing to merge'}
    // once collapsed, we can't have edge/face selection
    if (!(bm.selectMode & SelectMode.Vertex)) edbmFlagDisableAll(bm, ElemFlag.Select)
    return {ok: true}
}

/**
 * `MESH_OT_edge_collapse` (`edbm_collapse_edge_exec`, `:690`): collapse each connected group of
 * selected edges (and so of selected faces) into a vertex, merging UVs and colours (`uvs=true`).
 */
export function edgeCollapseSelection(bm: BMesh): MergeSelectionResult {
    if (bm.totedgesel === 0) return {ok: false, error: 'No edges selected'}
    const edges = [...bm.edges].filter(e => (e.hflag & ElemFlag.Select) && !(e.hflag & ElemFlag.Hidden))
    bmoOpExec(bm, MERGE_TYPE_FLAG, () => collapseEdges(bm, edges, true))
    return {ok: true}
}

// endregion

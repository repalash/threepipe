/**
 * Select More / Select Less: grow the selection by one ring of neighbours, or shrink it by one.
 *
 * Port of the `region_extend` operator (`bmesh/operators/bmo_utils.cc:200`,
 * `bmo_region_extend_expand` / `_contract` / `_exec`) and its callers `EDBM_select_more` /
 * `EDBM_select_less` (`editors/mesh/editmesh_utils.cc:402`, `:425`).
 *
 * Blender tags with operator flags (`SEL_ORIG` for the input, `SEL_FLAG` for the result); sets play
 * that role here. In face mode the result is flushed through the face setters; in vertex and edge
 * mode it is applied as raw flags and then the mode flush settles it, exactly as the caller does.
 */

import {
    BMesh,
    BMEdge,
    BMFace,
    BMVert,
    diskEdges,
    edgeIsWire,
    edgeSelectSet,
    edgeSelectSetNoflush,
    ElemFlag,
    faceSelectSet,
    radialLoops,
    SelectMode,
    selectModeClean,
    selectModeFlush,
    vertSelectSet,
} from '@threepipe/mesh-kernel'

type Elem = BMVert | BMEdge | BMFace

interface RegionExtendResult {
    verts: Set<BMVert>
    edges: Set<BMEdge>
    faces: Set<BMFace>
}

function* vertFaces(v: BMVert): Generator<BMFace> {
    const seen = new Set<BMFace>()
    for (const e of diskEdges(v)) {
        for (const l of radialLoops(e)) {
            if (l.v !== v || seen.has(l.f)) continue
            seen.add(l.f)
            yield l.f
        }
    }
}

/** `bmo_face_flag_set_flush`: the face and its edges and vertices. */
function faceFlagSetFlush(f: BMFace, out: RegionExtendResult): void {
    out.faces.add(f)
    for (const l of f.eachLoop()) {
        if (l.e) out.edges.add(l.e)
        out.verts.add(l.v)
    }
}

/** `bmo_region_extend_expand` (`bmo_utils.cc:212`). */
function regionExtendExpand(orig: Set<Elem>, useFaces: boolean, useFacesStep: boolean): RegionExtendResult {
    const out: RegionExtendResult = {verts: new Set(), edges: new Set(), faces: new Set()}
    const hidden = (e: {hflag: number}) => (e.hflag & ElemFlag.Hidden) !== 0

    if (!useFaces) {
        for (const v of orig) {
            if (!(v instanceof BMVert)) continue
            let found = false
            for (const e of diskEdges(v)) {
                if (!orig.has(e) && !hidden(e)) {
                    found = true
                    break
                }
            }
            if (!found) continue

            if (!useFacesStep) {
                for (const e of diskEdges(v)) {
                    if (!out.edges.has(e) && !hidden(e)) {
                        out.edges.add(e)
                        out.verts.add(e.otherVert(v))
                    }
                }
            } else {
                for (const f of vertFaces(v)) {
                    if (!out.faces.has(f) && !hidden(f)) faceFlagSetFlush(f, out)
                }
                // Handle wire edges (when stepping over faces).
                for (const e of diskEdges(v)) {
                    if (edgeIsWire(e)) {
                        if (!out.edges.has(e) && !hidden(e)) {
                            out.edges.add(e)
                            out.verts.add(e.otherVert(v))
                        }
                    }
                }
            }
        }
    } else {
        for (const f of orig) {
            if (!(f instanceof BMFace)) continue
            for (const l of f.eachLoop()) {
                if (!useFacesStep) {
                    if (!l.e) continue
                    for (const lr of radialLoops(l.e)) {
                        const fOther = lr.f
                        if (!orig.has(fOther) && !out.faces.has(fOther) && !hidden(fOther)) out.faces.add(fOther)
                    }
                } else {
                    for (const fOther of vertFaces(l.v)) {
                        if (!orig.has(fOther) && !out.faces.has(fOther) && !hidden(fOther)) out.faces.add(fOther)
                    }
                }
            }
        }
    }
    return out
}

/** `bmo_region_extend_contract` (`bmo_utils.cc:314`). */
function regionExtendContract(orig: Set<Elem>, useFaces: boolean, useFacesStep: boolean): RegionExtendResult {
    const out: RegionExtendResult = {verts: new Set(), edges: new Set(), faces: new Set()}

    if (!useFaces) {
        for (const v of orig) {
            if (!(v instanceof BMVert)) continue
            let found = false
            if (!useFacesStep) {
                for (const e of diskEdges(v)) {
                    if (!orig.has(e)) {
                        found = true
                        break
                    }
                }
            } else {
                for (const f of vertFaces(v)) {
                    if (!orig.has(f)) {
                        found = true
                        break
                    }
                }
                // Handle wire edges (when stepping over faces).
                if (!found) {
                    for (const e of diskEdges(v)) {
                        if (edgeIsWire(e) && !orig.has(e)) {
                            found = true
                            break
                        }
                    }
                }
            }
            if (found) {
                out.verts.add(v)
                for (const e of diskEdges(v)) out.edges.add(e)
            }
        }
    } else {
        for (const f of orig) {
            if (!(f instanceof BMFace)) continue
            loops: for (const l of f.eachLoop()) {
                if (!useFacesStep) {
                    if (!l.e) continue
                    for (const lr of radialLoops(l.e)) {
                        if (!orig.has(lr.f)) {
                            out.faces.add(f)
                            break loops
                        }
                    }
                } else {
                    for (const fOther of vertFaces(l.v)) {
                        if (!orig.has(fOther)) {
                            out.faces.add(f)
                            break loops
                        }
                    }
                }
            }
        }
    }
    return out
}

/**
 * `bmo_region_extend_exec` (`bmo_utils.cc:413`) over the selected elements: the elements to add
 * (`!contract`) or to remove (`contract`).
 */
export function regionExtend(bm: BMesh, useFaces: boolean, useFaceStep: boolean, contract: boolean): RegionExtendResult {
    const orig = new Set<Elem>()
    for (const v of bm.verts) if (v.hflag & ElemFlag.Select) orig.add(v)
    for (const e of bm.edges) if (e.hflag & ElemFlag.Select) orig.add(e)
    for (const f of bm.faces) if (f.hflag & ElemFlag.Select) orig.add(f)
    return contract
        ? regionExtendContract(orig, useFaces, useFaceStep)
        : regionExtendExpand(orig, useFaces, useFaceStep)
}

/**
 * `BMO_slot_buffer_hflag_enable/disable(..., BM_ELEM_SELECT, do_flush)`: with `flush` the
 * propagating setters (`BM_elem_select_set`), without it the raw flags.
 */
function applyResult(bm: BMesh, result: RegionExtendResult, select: boolean, flush: boolean): void {
    for (const v of result.verts) vertSelectSet(bm, v, select)
    for (const e of result.edges) {
        if (flush) edgeSelectSet(bm, e, select)
        else edgeSelectSetNoflush(bm, e, select)
    }
    for (const f of result.faces) {
        if (flush) {
            faceSelectSet(bm, f, select)
        } else if (f.hflag & ElemFlag.Hidden) {
            // Never selected.
        } else if (select) {
            if (!(f.hflag & ElemFlag.Select)) {
                f.hflag |= ElemFlag.Select
                bm.totfacesel++
            }
        } else if (f.hflag & ElemFlag.Select) {
            f.hflag &= ~ElemFlag.Select
            bm.totfacesel--
        }
    }
}

/** `EDBM_select_more` (`editmesh_utils.cc:402`). Ctrl+Numpad+. */
export function selectMore(bm: BMesh, useFaceStep = false): void {
    const useFaces = bm.selectMode === SelectMode.Face
    const result = regionExtend(bm, useFaces, useFaceStep, false)
    // Don't flush selection in edge/vertex mode.
    applyResult(bm, result, true, useFaces)
    selectModeFlush(bm)
}

/** `EDBM_select_less` (`editmesh_utils.cc:425`). Ctrl+Numpad-. */
export function selectLess(bm: BMesh, useFaceStep = false): void {
    const useFaces = bm.selectMode === SelectMode.Face
    const result = regionExtend(bm, useFaces, useFaceStep, true)
    applyResult(bm, result, false, useFaces)
    selectModeFlush(bm)
    // Only needed for select less: ensure we don't have isolated elements remaining.
    selectModeClean(bm)
}

/**
 * Duplicate, split, separate and delete.
 *
 * Ported from `bmo_dupe.cc` (duplicate, split) and `bmesh_delete.cc` (the delete contexts). These are
 * the operations kit-bashing is built from: copy a piece, move it, repeat. The demo this project is
 * chasing assembles almost an entire scene this way.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdges, radialLoops} from '../bmesh/structure'
import {copyElemAttrs} from '../bmesh/customdata'
import {ElemFlag} from '../constants'
import {edgeSelectSet, faceSelectSet, selectNone, vertSelectSet} from '../bmesh/marking'

export interface DuplicateResult {
    verts: BMVert[]
    edges: BMEdge[]
    faces: BMFace[]
    vertMap: Map<BMVert, BMVert>
    edgeMap: Map<BMEdge, BMEdge>
    faceMap: Map<BMFace, BMFace>
}

export interface DuplicateInput {
    verts?: Iterable<BMVert>
    edges?: Iterable<BMEdge>
    faces?: Iterable<BMFace>
}

/**
 * Copy geometry, leaving the originals in place.
 *
 * Port of `bmo_duplicate_exec`. Everything a duplicated face needs is pulled in automatically: its
 * vertices and edges come along whether or not the caller listed them, which is what makes
 * "duplicate the selection" behave when only faces are selected.
 *
 * The copies are placed exactly on the originals; the caller moves them, exactly as Blender's
 * duplicate-and-move macro does.
 */
export function duplicateGeometry(
    bm: BMesh, input: DuplicateInput, selectResult = true,
): DuplicateResult {
    const srcFaces = new Set(input.faces ?? [])
    const srcEdges = new Set(input.edges ?? [])
    const srcVerts = new Set(input.verts ?? [])

    // Pull in everything the listed faces and edges depend on.
    for (const f of srcFaces) {
        for (const l of f.eachLoop()) {
            srcVerts.add(l.v)
            if (l.e) srcEdges.add(l.e)
        }
    }
    for (const e of srcEdges) {
        srcVerts.add(e.v1)
        srcVerts.add(e.v2)
    }

    const vertMap = new Map<BMVert, BMVert>()
    for (const v of srcVerts) {
        const nv = bm.vertCreate(v.x, v.y, v.z, v)
        nv.hflag &= ~ElemFlag.Select
        vertMap.set(v, nv)
    }

    const edgeMap = new Map<BMEdge, BMEdge>()
    for (const e of srcEdges) {
        const ne = bm.edgeCreate(vertMap.get(e.v1)!, vertMap.get(e.v2)!, e, {noDouble: true})
        ne.hflag &= ~ElemFlag.Select
        edgeMap.set(e, ne)
    }

    const faceMap = new Map<BMFace, BMFace>()
    for (const f of srcFaces) {
        const loops = [...f.eachLoop()]
        const nf = bm.faceCreate(loops.map(l => vertMap.get(l.v)!), f)
        nf.hflag &= ~ElemFlag.Select
        const dstLoops = [...nf.eachLoop()]
        for (let i = 0; i < loops.length; i++) copyElemAttrs(loops[i], dstLoops[i], bm.ldata)
        faceMap.set(f, nf)
    }

    if (selectResult) {
        selectNone(bm)
        for (const f of faceMap.values()) faceSelectSet(bm, f, true)
        for (const e of edgeMap.values()) edgeSelectSet(bm, e, true)
        for (const v of vertMap.values()) vertSelectSet(bm, v, true)
    }

    return {
        verts: [...vertMap.values()],
        edges: [...edgeMap.values()],
        faces: [...faceMap.values()],
        vertMap,
        edgeMap,
        faceMap,
    }
}

/** Duplicate whatever is selected. Blender's `Shift+D`. */
export function duplicateSelection(bm: BMesh): DuplicateResult | null {
    const faces = [...bm.faces].filter(f => f.hflag & ElemFlag.Select)
    const edges = [...bm.edges].filter(e => e.hflag & ElemFlag.Select)
    const verts = [...bm.verts].filter(v => v.hflag & ElemFlag.Select)
    if (!faces.length && !edges.length && !verts.length) return null
    return duplicateGeometry(bm, {faces, edges, verts})
}

/**
 * Split the selection away from the mesh: duplicate it, then delete the originals.
 *
 * Port of `bmo_split_exec`, Blender's `Y`. The copy ends up disconnected from whatever it was
 * attached to, which is the difference from a plain duplicate.
 */
export function splitSelection(bm: BMesh): DuplicateResult | null {
    const faces = [...bm.faces].filter(f => f.hflag & ElemFlag.Select)
    const verts = [...bm.verts].filter(v => v.hflag & ElemFlag.Select)
    if (!faces.length && !verts.length) return null

    const result = duplicateGeometry(bm, {faces, verts})
    for (const f of faces) bm.faceKill(f)
    // Drop originals that nothing uses any more.
    for (const v of verts) {
        if (!bm.verts.has(v)) continue
        if (v.e === null) bm.vertKill(v)
    }
    return result
}

/** How much a delete takes with it. Mirrors Blender's `DEL_*` contexts. */
export type DeleteContext =
    /** Vertices and everything using them. */
    | 'verts'
    /** Edges, and the faces using them; vertices survive. */
    | 'edges'
    /** Faces, plus edges and vertices left unused. */
    | 'faces'
    /** Faces only; their edges and vertices stay, leaving a hole. */
    | 'onlyFaces'
    /** Edges and faces, keeping the vertices. */
    | 'edgesFaces'

/**
 * Delete the selection with the given context.
 *
 * Port of `BM_mesh_delete_hflag_context`. The context is what Blender's `X` menu offers, and it
 * matters: deleting faces while keeping their rim is how you open a hole, while deleting vertices
 * takes the surrounding surface with them.
 */
export function deleteSelection(bm: BMesh, context: DeleteContext = 'verts'): number {
    const selVerts = [...bm.verts].filter(v => v.hflag & ElemFlag.Select)
    const selEdges = [...bm.edges].filter(e => e.hflag & ElemFlag.Select)
    const selFaces = [...bm.faces].filter(f => f.hflag & ElemFlag.Select)
    let removed = 0

    switch (context) {
    case 'verts':
        for (const v of selVerts) {
            if (!bm.verts.has(v)) continue
            bm.vertKill(v)
            removed++
        }
        break

    case 'edges':
        for (const e of selEdges) {
            if (!bm.edges.has(e)) continue
            bm.edgeKill(e)
            removed++
        }
        // Vertices left with nothing attached go too, matching Blender's cleanup.
        for (const v of [...bm.verts]) if (v.e === null) bm.vertKill(v)
        break

    case 'onlyFaces':
        for (const f of selFaces) {
            if (!bm.faces.has(f)) continue
            bm.faceKill(f)
            removed++
        }
        break

    case 'faces': {
        const touchedEdges = new Set<BMEdge>()
        const touchedVerts = new Set<BMVert>()
        for (const f of selFaces) {
            for (const l of f.eachLoop()) {
                if (l.e) touchedEdges.add(l.e)
                touchedVerts.add(l.v)
            }
        }
        for (const f of selFaces) {
            if (!bm.faces.has(f)) continue
            bm.faceKill(f)
            removed++
        }
        // Then anything the faces were holding up.
        for (const e of touchedEdges) {
            if (bm.edges.has(e) && e.l === null) bm.edgeKill(e)
        }
        for (const v of touchedVerts) {
            if (bm.verts.has(v) && v.e === null) bm.vertKill(v)
        }
        break
    }

    case 'edgesFaces':
        for (const e of selEdges) {
            if (!bm.edges.has(e)) continue
            bm.edgeKill(e)
            removed++
        }
        break
    }

    return removed
}

/**
 * Merge the selected vertices into one, at the given point or at their median.
 *
 * Port of `bmo_pointmerge_exec`, Blender's `M`. Faces that collapse to fewer than three distinct
 * corners are removed rather than left degenerate.
 */
export function mergeVerts(
    bm: BMesh, verts: BMVert[], target?: {x: number, y: number, z: number},
): BMVert | null {
    if (verts.length < 2) return null

    const point = target ?? (() => {
        let x = 0, y = 0, z = 0
        for (const v of verts) {
            x += v.x
            y += v.y
            z += v.z
        }
        return {x: x / verts.length, y: y / verts.length, z: z / verts.length}
    })()

    const keep = verts[0]
    const doomed = new Set(verts.slice(1))
    keep.setCo(point.x, point.y, point.z)

    // Faces that would end up with fewer than three distinct vertices cannot survive the merge.
    const facesToKill = new Set<BMFace>()
    for (const v of doomed) {
        for (const e of diskEdges(v)) {
            for (const l of radialLoops(e)) {
                const distinct = new Set<BMVert>()
                for (const fl of l.f.eachLoop()) distinct.add(doomed.has(fl.v) ? keep : fl.v)
                if (distinct.size < 3) facesToKill.add(l.f)
            }
        }
    }
    for (const f of facesToKill) if (bm.faces.has(f)) bm.faceKill(f)

    // Rebuild every remaining face that referenced a doomed vertex, with the survivor in its place.
    // `sources` keeps the loop each surviving corner came from, the way `remdoubles_createface`
    // stacks `loops[]` alongside `verts[]`, so per-corner attributes survive the rebuild.
    const rebuild: {verts: BMVert[], sources: BMLoop[], example: BMFace}[] = []
    const seen = new Set<BMFace>()
    for (const v of doomed) {
        for (const e of [...diskEdges(v)]) {
            for (const l of [...radialLoops(e)]) {
                if (seen.has(l.f)) continue
                seen.add(l.f)
                const mapped: BMVert[] = []
                const sources: BMLoop[] = []
                for (const fl of l.f.eachLoop()) {
                    const m = doomed.has(fl.v) ? keep : fl.v
                    // Collapse consecutive duplicates produced by the merge.
                    if (!mapped.length || mapped[mapped.length - 1] !== m) {
                        mapped.push(m)
                        sources.push(fl)
                    }
                }
                if (mapped.length > 1 && mapped[0] === mapped[mapped.length - 1]) {
                    mapped.pop()
                    sources.pop()
                }
                if (mapped.length >= 3) rebuild.push({verts: mapped, sources, example: l.f})
            }
        }
    }
    // Build the replacement while the original is still there, so it can act as the example for
    // header flags, material slot and face attributes, then drop the original. This is the order
    // `bmo_weld_verts_exec` uses (`remdoubles_createface`, then one delete pass at the end); killing
    // first loses everything the face carried.
    for (const {verts: fv, sources, example} of rebuild) {
        if (!bm.faces.has(example)) continue
        try {
            const nf = bm.faceCreate(fv, example)
            const dstLoops = [...nf.eachLoop()]
            for (let i = 0; i < dstLoops.length; i++) copyElemAttrs(sources[i], dstLoops[i], bm.ldata)
        } catch {
            // A face that cannot be rebuilt (a repeated vertex after the merge) is simply dropped.
        }
        bm.faceKill(example)
    }

    for (const v of doomed) if (bm.verts.has(v)) bm.vertKill(v)

    selectNone(bm)
    vertSelectSet(bm, keep, true)
    return keep
}

/** Merge whatever vertices are selected. */
export function mergeSelectedVerts(
    bm: BMesh, mode: 'center' | 'first' | 'last' = 'center',
): BMVert | null {
    const verts = [...bm.verts].filter(v => v.hflag & ElemFlag.Select)
    if (verts.length < 2) return null
    const target = mode === 'first' ? verts[0] : mode === 'last' ? verts[verts.length - 1] : undefined
    return mergeVerts(bm, verts, target ? {x: target.x, y: target.y, z: target.z} : undefined)
}

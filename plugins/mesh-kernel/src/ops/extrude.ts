/**
 * Extrude operators.
 *
 * Ported from `source/blender/bmesh/operators/bmo_extrude.cc`. Blender builds extrude out of smaller
 * pieces: duplicate the region, delete the originals that are now interior, and stitch side faces
 * along the boundary using the `boundary_map` the duplicate produced. The same shape is followed here,
 * with the duplication written out directly rather than going through an operator-slot layer that does
 * not exist yet.
 *
 * The winding rule is easy to get backwards, and getting it wrong turns the result inside out with no
 * other symptom. For a boundary edge whose adjacent region face walks `a → b`, the side face is
 * `(a, b, b', a')`: walk the bottom rim forwards and the top rim backwards, which closes the strip
 * consistently with the cap. `(b, a, a', b')` looks equally plausible and produces inward normals.
 */

import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {radialLoops} from '../bmesh/structure'
import {copyElemAttrs} from '../bmesh/customdata'
import {ElemFlag} from '../constants'
import {faceSelectSet, selectNone, vertSelectSet} from '../bmesh/marking'

export interface ExtrudeResult {
    /** The new cap faces, which replace the originals. */
    faces: BMFace[]
    /** The side faces created along the region boundary. */
    sideFaces: BMFace[]
    /** New vertices, one per vertex of the original region. */
    verts: BMVert[]
    /** Original vertex to its duplicate. */
    vertMap: Map<BMVert, BMVert>
}

export interface ExtrudeOptions {
    /** Keep the original faces instead of deleting them. Blender's `use_keep_orig`. */
    keepOriginal?: boolean
    /** Select the result and deselect everything else, as the interactive operator does. */
    selectResult?: boolean
}

/**
 * Extrude a region of faces.
 *
 * The originals are replaced by duplicates and joined to the boundary by new side faces, so the result
 * is closed. Interior edges and vertices of the region disappear with the originals; boundary ones stay
 * because the side faces use them.
 *
 * Returns null when `faces` is empty. The caller usually moves {@link ExtrudeResult.verts} afterwards,
 * which is exactly what Blender's `MESH_OT_extrude_region_move` macro does.
 */
export function extrudeFaceRegion(
    bm: BMesh, faces: BMFace[], options: ExtrudeOptions = {},
): ExtrudeResult | null {
    if (!faces.length) return null
    const region = new Set(faces)

    // Classify the region's edges. A boundary edge has exactly one adjacent face inside the region;
    // everything else is interior and will vanish with the originals.
    const boundaryEdges: BMEdge[] = []
    const interiorEdges: BMEdge[] = []
    const edgeSeen = new Set<BMEdge>()
    for (const f of region) {
        for (const l of f.eachLoop()) {
            const e = l.e!
            if (edgeSeen.has(e)) continue
            edgeSeen.add(e)
            let inRegion = 0
            for (const rl of radialLoops(e)) if (region.has(rl.f)) inRegion++
            if (inRegion === 1) boundaryEdges.push(e)
            else interiorEdges.push(e)
        }
    }

    // Duplicate every vertex the region touches.
    const vertMap = new Map<BMVert, BMVert>()
    for (const f of region) {
        for (const l of f.eachLoop()) {
            if (vertMap.has(l.v)) continue
            const nv = bm.vertCreate(l.v.x, l.v.y, l.v.z, l.v)
            nv.hflag &= ~ElemFlag.Select
            vertMap.set(l.v, nv)
        }
    }

    // Duplicate the faces, keeping winding so the cap faces the same way the region did.
    const newFaces: BMFace[] = []
    for (const f of region) {
        const verts = [...f.eachLoop()].map(l => vertMap.get(l.v)!)
        const nf = bm.faceCreate(verts, f)
        nf.hflag &= ~ElemFlag.Select
        // Per-corner data follows the loop order, which the duplicate preserves.
        const srcLoops = [...f.eachLoop()]
        const dstLoops = [...nf.eachLoop()]
        for (let i = 0; i < srcLoops.length; i++) copyElemAttrs(srcLoops[i], dstLoops[i], bm.ldata)
        newFaces.push(nf)
    }

    // Stitch the sides. Winding: the region face walks a -> b along this edge, so the side runs
    // a -> b along the bottom rim and b' -> a' back along the top, which faces it outward.
    const sideFaces: BMFace[] = []
    for (const e of boundaryEdges) {
        let loopInRegion = null as null | {v: BMVert, nextV: BMVert}
        for (const l of radialLoops(e)) {
            if (region.has(l.f)) {
                loopInRegion = {v: l.v, nextV: l.next.v}
                break
            }
        }
        if (!loopInRegion) continue
        const a = loopInRegion.v
        const b = loopInRegion.nextV
        const a2 = vertMap.get(a)!
        const b2 = vertMap.get(b)!
        if (a2 === b2) continue
        const side = bm.faceCreate([a, b, b2, a2])
        side.hflag &= ~ElemFlag.Select
        sideFaces.push(side)
    }

    if (!options.keepOriginal) {
        // Remove the originals, then the interior edges and vertices they were holding up.
        for (const f of region) bm.faceKill(f)
        for (const e of interiorEdges) {
            if (!bm.edges.has(e)) continue
            if (e.l === null) bm.edgeKill(e)
        }
        for (const v of vertMap.keys()) {
            if (!bm.verts.has(v)) continue
            if (v.e === null) bm.vertKill(v)
        }
    }

    if (options.selectResult !== false) {
        selectNone(bm)
        for (const f of newFaces) faceSelectSet(bm, f, true)
        for (const v of vertMap.values()) vertSelectSet(bm, v, true)
    }

    return {
        faces: newFaces,
        sideFaces,
        verts: [...vertMap.values()],
        vertMap,
    }
}

/**
 * Extrude edges that have no face, or the boundary of a selection, producing a ribbon of new faces.
 *
 * Port of `extrude_edge_only`. Used when the selection is edges rather than faces, which in Blender is
 * what the `E` key dispatches to when no face is selected.
 */
export function extrudeEdgeOnly(
    bm: BMesh, edges: BMEdge[], options: ExtrudeOptions = {},
): ExtrudeResult | null {
    if (!edges.length) return null

    const vertMap = new Map<BMVert, BMVert>()
    const ensure = (v: BMVert): BMVert => {
        let nv = vertMap.get(v)
        if (!nv) {
            nv = bm.vertCreate(v.x, v.y, v.z, v)
            nv.hflag &= ~ElemFlag.Select
            vertMap.set(v, nv)
        }
        return nv
    }

    const sideFaces: BMFace[] = []
    for (const e of edges) {
        const a = e.v1
        const b = e.v2
        const a2 = ensure(a)
        const b2 = ensure(b)
        const face = bm.faceCreate([a, b, b2, a2])
        face.hflag &= ~ElemFlag.Select
        sideFaces.push(face)
    }

    if (options.selectResult !== false) {
        selectNone(bm)
        for (const v of vertMap.values()) vertSelectSet(bm, v, true)
    }

    return {faces: [], sideFaces, verts: [...vertMap.values()], vertMap}
}

/**
 * Extrude whatever is selected, choosing the strategy the way Blender's `E` key does: faces if any are
 * selected, otherwise edges.
 */
export function extrudeSelection(bm: BMesh, options: ExtrudeOptions = {}): ExtrudeResult | null {
    const faces = [...bm.faces].filter(f => f.hflag & ElemFlag.Select)
    if (faces.length) return extrudeFaceRegion(bm, faces, options)

    const edges = [...bm.edges].filter(e => e.hflag & ElemFlag.Select)
    if (edges.length) return extrudeEdgeOnly(bm, edges, options)

    return null
}

/** Move a set of vertices by a vector. The other half of Blender's extrude-and-move macro. */
export function translateVerts(verts: Iterable<BMVert>, dx: number, dy: number, dz: number): void {
    for (const v of verts) {
        v.x += dx
        v.y += dy
        v.z += dz
    }
}

/**
 * Average normal of a set of faces, which is the direction `E` extrudes along by default.
 * Returns null when the faces cancel out or are degenerate.
 */
export function averageFaceNormal(faces: BMFace[]): [number, number, number] | null {
    let nx = 0, ny = 0, nz = 0
    for (const f of faces) {
        const verts = [...f.eachLoop()].map(l => l.v)
        for (let i = 0; i < verts.length; i++) {
            const a = verts[i]
            const b = verts[(i + 1) % verts.length]
            nx += (a.y - b.y) * (a.z + b.z)
            ny += (a.z - b.z) * (a.x + b.x)
            nz += (a.x - b.x) * (a.y + b.y)
        }
    }
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-12) return null
    return [nx / len, ny / len, nz / len]
}

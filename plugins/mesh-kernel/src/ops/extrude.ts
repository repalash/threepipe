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
import {diskEdgeExists, radialLoops} from '../bmesh/structure'
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
    /**
     * Original edge to the edge that spans its two duplicates - Blender's `boundary_map.out` read
     * the other way round. Filled by {@link extrudeEdgeOnly}, where it is the new rim and so the
     * input to the next extrusion in a chain; empty for {@link extrudeFaceRegion}, whose caller has
     * the duplicated faces to walk instead.
     */
    edgeMap: Map<BMEdge, BMEdge>
}

export interface ExtrudeOptions {
    /** Keep the original faces instead of deleting them. Blender's `use_keep_orig`. */
    keepOriginal?: boolean
    /** Select the result and deselect everything else, as the interactive operator does. */
    selectResult?: boolean
    /**
     * Wind the side faces the other way round, so they face inwards instead of outwards.
     * Blender's `use_normal_flip`.
     */
    useNormalFlip?: boolean
    /**
     * Take each side face's winding from the face already attached to the source edge, rather than
     * from the duplicate. Blender's `use_normal_from_adjacent`, and its comment says why it exists:
     * "needed for repetitive extrusions that use the normals from the previously created faces".
     *
     * This is what makes {@link extrudeEdgeOnly} chainable. Extruding a wire ring produces a ribbon
     * whose rim edges now carry a face; extruding the rim again without this rule winds the second
     * ribbon the same way round the shared edge as the first, which is inside out. A spin, a lathe
     * and a UV sphere are all repeated extrusions of the same rim, so all three need it.
     *
     * Turning it on gives exactly `bmo_extrude_edge_only_exec` (`bmo_extrude.cc:167`), whose rule is
     * `edge_normal_flip = !(e->l && e->v1 != e->l->v)` with no alternative. Leaving it off gives the
     * first-extrusion rule of `bmo_extrude_face_region_exec` (`bmo_extrude.cc:518`), which is what
     * the operator did before the option existed and what the existing tests expect. The two differ
     * by a flip on a wire edge, which is a real difference between the two Blender operators and not
     * a mistake in either.
     *
     * Only meaningful for {@link extrudeEdgeOnly}; {@link extrudeFaceRegion} already takes its
     * winding from the region face.
     */
    useNormalFromAdjacent?: boolean
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
        // `use_normal_flip` reverses the strip; the reversal of (a, b, b', a') written from b.
        const side = options.useNormalFlip
            ? bm.faceCreate([b, a, a2, b2])
            : bm.faceCreate([a, b, b2, a2])
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
        edgeMap: new Map(),
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

    const useNormalFlip = options.useNormalFlip === true
    const useNormalFromAdjacent = options.useNormalFromAdjacent === true

    const sideFaces: BMFace[] = []
    const edgeMap = new Map<BMEdge, BMEdge>()
    for (const e of edges) {
        const a = e.v1
        const b = e.v2
        // Create both duplicates before deciding the winding, so the order vertices are created in
        // follows the order the edges were given in. Generators such as the lathe rely on that.
        const a2 = ensure(a)
        const b2 = ensure(b)

        // Port of the winding decision in `bmo_extrude_face_region_exec` (`bmo_extrude.cc:518`).
        // `eNew` is Blender's `e_new`, the duplicate of `e`; it normally does not exist yet, which is
        // the `e_new->l == null` arm of the original expression.
        const eNew = diskEdgeExists(a2, b2)
        const edgeNormalFlip = useNormalFromAdjacent
            ? !(e.l !== null && e.v1 !== e.l.v)
            : !(eNew && eNew.l ? eNew.l.v === eNew.v1 : (!e.l || !(e.l.v === e.v1)))

        const face = edgeNormalFlip === useNormalFlip
            ? bm.faceCreate([a, b, b2, a2])
            : bm.faceCreate([b, a, a2, b2])
        face.hflag &= ~ElemFlag.Select
        sideFaces.push(face)

        // The far rim, which is what a chained extrusion has to be handed next. Looking it up by
        // endpoint afterwards is not equivalent: `faceCreate` stores it in whichever direction the
        // quad happened to walk it.
        const rim = diskEdgeExists(a2, b2)
        if (rim) edgeMap.set(e, rim)
    }

    if (options.selectResult !== false) {
        selectNone(bm)
        for (const v of vertMap.values()) vertSelectSet(bm, v, true)
    }

    return {faces: [], sideFaces, verts: [...vertMap.values()], vertMap, edgeMap}
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

/**
 * Extrude operators.
 *
 * Ported from `source/blender/bmesh/operators/bmo_extrude.cc`. Blender builds extrude out of smaller
 * pieces: duplicate the region, delete or reverse the originals depending on whether anything borders
 * the region, and stitch side faces along the boundary using the `boundary_map` the duplicate
 * produced. The same shape is followed here, with the duplication written out directly rather than
 * going through an operator-slot layer that does not exist yet.
 *
 * The winding rule is easy to get backwards, and getting it wrong turns the result inside out with no
 * other symptom. For a boundary edge whose adjacent region face walks `a → b`, the side face is
 * `(a, b, b', a')`: walk the bottom rim forwards and the top rim backwards, which closes the strip
 * consistently with the cap. `(b, a, a', b')` looks equally plausible and produces inward normals.
 */

import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdgeExists, diskEdges, radialLoops} from '../bmesh/structure'
import {copyElemAttrs} from '../bmesh/customdata'
import {faceNormalFlip} from '../bmesh/flip'
import {ElemFlag} from '../constants'
import {faceSelectSet, selectNone, vertSelectSet} from '../bmesh/marking'

export interface ExtrudeResult {
    /**
     * The new cap faces. They replace the originals when the region had a neighbour and are simply
     * the far side of the new solid when it did not - see {@link extrudeFaceRegion}.
     */
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
    /**
     * Keep the original faces instead of deleting them. Blender's `use_keep_orig`.
     *
     * Note that {@link extrudeFaceRegion} keeps them by itself whenever the region has no face
     * attached to it from outside - see that function. This option only forces the issue.
     */
    keepOriginal?: boolean
    /**
     * Leave a kept original face's winding alone instead of reversing it. Blender's
     * `skip_input_flip`, which only `bmo_spin_exec` passes.
     *
     * When the originals survive they end up on the far side of the new solid from the cap, and a
     * face that was wound to face "up" now has to face "down" - so `bmo_extrude_face_region_exec`
     * flips every input face in that case (`bmo_extrude.cc:437`). Extruding a plane produces a box
     * with outward normals because of this line. A spin does not want it, because the seed profile
     * is the user's existing geometry rather than one side of a new solid.
     */
    skipInputFlip?: boolean
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
 * The region is duplicated and the copy joined to the boundary by new side faces. When the originals
 * are deleted, the interior edges and vertices of the region go with them; boundary ones stay,
 * because the side faces use them.
 *
 * **The originals are only deleted when the region has a neighbour.** This is Blender's `delorig`
 * (`bmo_extrude_face_region_exec`, `bmo_extrude.cc:341`) and it is the difference between extruding
 * a face *of* something and extruding something whole:
 *
 * - Extrude one face of a cube and every edge of that face has a second, non-input face. `delorig`
 *   is true, the original goes, and the cube grows a bump.
 * - Extrude a lone plane, or any whole island with nothing attached along its border, and no edge
 *   has an outside neighbour. `delorig` stays false, the original survives, and - because it is
 *   flipped, see {@link ExtrudeOptions.skipInputFlip} - the result is a closed box. That is what
 *   Blender gives you for `Plane`, `E`, and it is not a special case anywhere in the code: it falls
 *   out of the same scan.
 *
 * Returns null when `faces` is empty. The caller usually moves {@link ExtrudeResult.verts} afterwards,
 * which is exactly what Blender's `MESH_OT_extrude_region_move` macro does.
 */
export function extrudeFaceRegion(
    bm: BMesh, faces: BMFace[], options: ExtrudeOptions = {},
): ExtrudeResult | null {
    if (!faces.length) return null
    const region = new Set(faces)
    const keepOriginal = options.keepOriginal === true

    // The input edges, Blender's `EXT_INPUT` on `BM_EDGE`. The operator is handed `geom=%hvef`, so
    // when a face is selected all of its edges are input too; a face-set argument means the same set.
    const inputEdges = new Set<BMEdge>()
    for (const f of region) for (const l of f.eachLoop()) inputEdges.add(l.e!)

    // Classify the input edges, the `EXT_DEL` / `delorig` scan of `bmo_extrude.cc:341`.
    //
    // `found` is "this edge has a face user that is not extrude input", and a single one of those
    // anywhere in the region is what licenses deleting the originals. An edge with two or more input
    // faces and no outside one is interior and is deleted with them.
    //
    // A boundary edge, the one that gets a side face, is Blender's `boundary_map.out`: `bmo_edge_copy`
    // (`bmo_dupe.cc:110`) records an edge whose count of *input* radial faces is below two.
    const boundaryEdges: BMEdge[] = []
    const delEdges = new Set<BMEdge>()
    let delorig = false
    for (const e of inputEdges) {
        let found = false
        let edgeFaceTot = 0
        for (const rl of radialLoops(e)) {
            if (region.has(rl.f)) edgeFaceTot++
            else found = true
        }
        if (edgeFaceTot < 2) boundaryEdges.push(e)
        // Blender skips the whole scan under `use_keep_orig`, leaving `delorig` false.
        if (keepOriginal) continue
        if (found) delorig = true
        else if (edgeFaceTot > 1) delEdges.add(e)
    }

    // "calculate verts to delete": a vertex goes only when every edge at it is an input edge that is
    // itself being deleted, and every face at it is input. Blender scans the whole mesh; no vertex
    // outside the region can pass the first test, so the region's own vertices are the same set.
    const delVerts = new Set<BMVert>()
    if (!keepOriginal) {
        for (const f of region) {
            for (const l of f.eachLoop()) {
                const v = l.v
                if (delVerts.has(v) || !v.e) continue
                let found = false
                for (const e of diskEdges(v)) {
                    if (!inputEdges.has(e) || !delEdges.has(e)) {
                        found = true
                        break
                    }
                }
                // "avoid an extra loop" - only reached when every edge at `v` is going.
                if (!found) {
                    for (const e of diskEdges(v)) {
                        for (const rl of radialLoops(e)) {
                            if (!region.has(rl.f)) {
                                found = true
                                break
                            }
                        }
                        if (found) break
                    }
                }
                if (!found) delVerts.add(v)
            }
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
    //
    // Blender decides the same thing from the *duplicate* edge, `edge_normal_flip =
    // !(e_new->l->v == e_new->v1)` (`bmo_extrude.cc:519`), and the two reduce to each other. The
    // duplicate keeps the original's vertex order, so `e_new->v1` is the copy of `e->v1`, and the
    // duplicated face walks `e_new` the way the region face walks `e`. Take the region face as
    // walking a -> b: if a is `e->v1` Blender's test passes and the quad is
    // `(v1, v2, v2', v1') = (a, b, b', a')`; if a is `e->v2` the test fails and the quad is
    // `(v2, v1, v1', v2')`, which is `(a, b, b', a')` again. One expression either way.
    //
    // It also means the side face traverses this edge in the *same* direction as the region face, so
    // a surviving original has the opposite orientation to the solid until it is flipped below.
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

    if (delorig) {
        // `delete geom=%fvef context=DEL_ONLYTAGGED`, which is `BMO_mesh_delete_oflag_tagged`:
        // tagged faces, then tagged edges, then tagged vertices (`bmesh_delete.cc:73`). Every input
        // face is tagged; the edges and vertices are the ones the scan above marked.
        for (const f of region) bm.faceKill(f)
        for (const e of delEdges) if (bm.edges.has(e)) bm.edgeKill(e)
        for (const v of delVerts) if (bm.verts.has(v)) bm.vertKill(v)
    } else if (options.skipInputFlip !== true) {
        // "Flip input faces only when originals are kept (!delorig) and the caller didn't request to
        // skip flipping" (`bmo_extrude.cc:435`). The kept original is now the far side of the new
        // solid, so it has to face the other way.
        //
        // Blender flips here, *before* building the side faces, and gets away with it because it
        // takes each side face's winding from the duplicate edge `e_new`. This takes it from the
        // region face instead - the two are algebraically the same, see the note at the side-face
        // loop - so the flip has to come after. Same result either way.
        for (const f of region) faceNormalFlip(f)
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

/**
 * Triangle fill: fill closed edge loops (with holes) with triangles, optionally dissolved into n-gons.
 *
 * Port of `bmo_triangle_fill_exec` (`source/blender/bmesh/operators/bmo_triangulate.cc:52`), the
 * operator behind `bmesh.ops.triangle_fill` and edit mode's Fill (Alt+F). The triangulation itself is
 * Blender's sweep-line scan-fill, ported in `scanfill.ts`. Line references are to
 * `bmo_triangulate.cc` (Blender main) unless stated.
 *
 * Operator flags (`ELE_NEW`, `EDGE_MARK`) become sets. `geom.out` is collected the way
 * `BMO_slot_buffer_from_enabled_flag` does it: edges in mesh order, then faces in mesh order.
 *
 * Not ported: `use_beauty` (`:227`), which runs `beautify_fill` - not in the kernel yet. Asking for it
 * throws instead of silently returning the un-beautified triangles.
 *
 * Blender 3.4.1 (`bmo_triangulate.c`) differs only in the dissolve step: it joins across every
 * manifold `ELE_NEW` edge (`BM_edge_is_manifold`) with no duplicate-face handling; main (ported)
 * additionally requires both faces to be `ELE_NEW` and removes the joined face when it duplicates an
 * existing one. The two agree whenever the fill does not overlap existing faces.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdgeExists, diskEdges, edgeIsBoundary} from '../bmesh/structure'
import type {Vec3} from '../math'
import {faceExists} from './weld'
import {facesJoinPair} from './dissolveEdges'
import {
    ScanFillFlag,
    ScanFillVert,
    scanfillBegin,
    scanfillCalcEx,
    scanfillEdgeAdd,
    scanfillEnd,
    scanfillVertAdd,
} from './scanfill'

export interface TriangleFillOptions {
    /**
     * Projection normal. Zero or absent estimates one from the loops (and then lets existing
     * adjacent faces vote on the winding). Blender's `normal`.
     */
    normal?: Vec3
    /** Dissolve the new internal edges, merging the triangles into n-gons. Blender's `use_dissolve`. */
    useDissolve?: boolean
    /** Blender's `use_beauty`. Not ported (`beautify_fill`); `true` throws. */
    useBeauty?: boolean
}

export interface TriangleFillResult {
    /** New faces (`geom.out` faces), in mesh order. */
    faces: BMFace[]
    /** New edges (`geom.out` edges): created edges that were not input edges, in mesh order. */
    edges: BMEdge[]
}

/** `normalize_v3` (`math_vector_inline.cc:872`), in place; returns the original length or 0. */
function normalizeV3(n: Vec3): number {
    let d = n[0] * n[0] + n[1] * n[1] + n[2] * n[2]
    if (d > 1.0e-35) {
        d = Math.sqrt(d)
        const s = 1.0 / d
        n[0] *= s
        n[1] *= s
        n[2] *= s
    } else {
        n[0] = n[1] = n[2] = 0
        d = 0
    }
    return d
}

/** `BM_edge_loop_pair` (`bmesh_query.cc:565`): the two loops of an edge with exactly two faces. */
function edgeLoopPair(e: BMEdge): [BMLoop, BMLoop] | null {
    const la = e.l
    if (!la) return null
    const lb = la.radialNext
    if (lb && la !== lb && lb.radialNext === la) return [la, lb]
    return null
}

/**
 * `BM_face_create_quad_tri(bm, v1, v2, v3, nullptr, nullptr, BM_CREATE_NO_DOUBLE)`
 * (`bmesh_construct.cc:67`) = `BM_face_create_verts(..., create_edges=true)` (`bmesh_core.cc:596`).
 *
 * Missing edges are made first, by `BM_edges_from_verts_ensure` (`bmesh_construct.cc:57`), which
 * starts at the closing edge `(v3, v1)` - the creation order decides the mesh's edge order, which the
 * dissolve pass and `geom.out` iterate. Then `BM_face_create` (`bmesh_core.cc:546`) returns an
 * existing face over the same vertices if there is one.
 */
function faceCreateTriNoDouble(bm: BMesh, vertArr: BMVert[]): BMFace {
    const len = vertArr.length
    const edgeArr: BMEdge[] = new Array(len)
    for (let i = 0, iPrev = len - 1; i < len; iPrev = i++) {
        edgeArr[iPrev] = diskEdgeExists(vertArr[iPrev], vertArr[i]) ?? bm.edgeCreate(vertArr[iPrev], vertArr[i])
    }
    const fExisting = faceExists(vertArr)
    if (fExisting) return fExisting
    return bm.faceCreateWithEdges(vertArr, edgeArr)
}

/** `SortNormal` (`:47`). */
interface SortNormal {
    value: number
    no: Vec3
}

/**
 * Fill the closed loops formed by `edges` with triangles (and, with `useDissolve`, merge them into
 * n-gons). Returns the new faces and edges.
 *
 * Port of `bmo_triangle_fill_exec` (`bmo_triangulate.cc:52`) with `use_beauty = false`.
 */
export function triangleFill(bm: BMesh, edges: readonly BMEdge[], options: TriangleFillOptions = {}): TriangleFillResult {
    const useBeauty = options.useBeauty ?? false
    const useDissolve = options.useDissolve ?? false
    if (useBeauty) {
        throw new Error('mesh-kernel triangleFill: use_beauty needs beautify_fill, which is not ported')
    }

    const edgeMark = new Set<BMEdge>() // EDGE_MARK
    const eleNewEdge = new Set<BMEdge>() // ELE_NEW on edges
    const eleNewFace = new Set<BMFace>() // ELE_NEW on faces

    const scanfillFlag = ScanFillFlag.Holes | ScanFillFlag.Polys | ScanFillFlag.Loose
    let calcWinding = false

    const sfVertMap = new Map<BMVert, ScanFillVert>()

    // BMO_slot_vec_get(op->slots_in, "normal", normal)
    const normal: Vec3 = options.normal ? [options.normal[0], options.normal[1], options.normal[2]] : [0, 0, 0]

    const sfCtx = scanfillBegin()

    for (const e of edges) { // `:73`
        const eVerts = [e.v1, e.v2]
        const sfVerts: ScanFillVert[] = [null!, null!]

        edgeMark.add(e)

        calcWinding = calcWinding || edgeIsBoundary(e)

        for (let i = 0; i < 2; i++) {
            let sfVert = sfVertMap.get(eVerts[i])
            if (!sfVert) {
                sfVert = scanfillVertAdd(sfCtx, [eVerts[i].x, eVerts[i].y, eVerts[i].z])
                sfVert.tmpP = eVerts[i]
                sfVertMap.set(eVerts[i], sfVert)
            }
            sfVerts[i] = sfVert
        }

        scanfillEdgeAdd(sfCtx, sfVerts[0], sfVerts[1])
    }
    const norsTot = sfVertMap.size

    if (normal[0] === 0 && normal[1] === 0 && normal[2] === 0) { // `:95`
        /* calculate the normal from the cross product of vert-edge pairs.
         * Since we don't know winding, just accumulate */
        let isDegenerate = true

        const nors: SortNormal[] = new Array(norsTot)

        let i = 0
        for (let sfVert = sfCtx.fillvertbase.first; sfVert; sfVert = sfVert.next, i++) {
            const v = sfVert.tmpP as BMVert
            const ePair: BMEdge[] = []
            let eIndex = 0

            // `no` is left uninitialised for the -1 entries; they sort last and are never read.
            nors[i] = {value: -1.0, no: [0, 0, 0]}

            /* only use if 'is_degenerate' stays true */
            normal[0] += v.nx
            normal[1] += v.ny
            normal[2] += v.nz

            for (const e of diskEdges(v)) { // BM_ITER_ELEM (e, &eiter, v, BM_EDGES_OF_VERT)
                if (edgeMark.has(e)) {
                    if (eIndex === 2) {
                        eIndex = 0
                        break
                    }
                    ePair[eIndex++] = e
                }
            }

            if (eIndex === 2) {
                isDegenerate = false

                const o0 = ePair[0].otherVert(v)
                const o1 = ePair[1].otherVert(v)
                const dirA: Vec3 = [v.x - o0.x, v.y - o0.y, v.z - o0.z]
                const dirB: Vec3 = [v.x - o1.x, v.y - o1.y, v.z - o1.z]

                // cross_v3_v3v3
                const no: Vec3 = [
                    dirA[1] * dirB[2] - dirA[2] * dirB[1],
                    dirA[2] * dirB[0] - dirA[0] * dirB[2],
                    dirA[0] * dirB[1] - dirA[1] * dirB[0],
                ]
                nors[i].no = no
                nors[i].value = no[0] * no[0] + no[1] * no[1] + no[2] * no[2]

                /* only to get deterministic behavior (for initial normal) */
                const lenA = dirA[0] * dirA[0] + dirA[1] * dirA[1] + dirA[2] * dirA[2]
                const lenB = dirB[0] * dirB[0] + dirB[1] * dirB[1] + dirB[2] * dirB[2]
                if (lenA > lenB) {
                    no[0] = -no[0]
                    no[1] = -no[1]
                    no[2] = -no[2]
                }
            }
        }

        if (isDegenerate) {
            /* no vertices have 2 edges?
             * in this case fall back to the average vertex normals */
        } else {
            // `qsort(nors, nors_tot, sizeof(*nors), BLI_sortutil_cmp_float_reverse)` (`:151`):
            // descending by value. The comparator returns 0 for equal values (every corner of a
            // square), so which one becomes `nors[0]` - and so the normal's sign - depends on the sort
            // being stable. glibc's qsort (the reference Blender's) is a stable merge sort here, as is
            // Array.prototype.sort. See scanfill.ts for the same note.
            nors.sort((a, b) => (a.value < b.value ? 1 : a.value > b.value ? -1 : 0))

            normal[0] = nors[0].no[0]
            normal[1] = nors[0].no[1]
            normal[2] = nors[0].no[2]
            for (i = 0; i < norsTot; i++) {
                if (nors[i].value === -1.0) break
                const no = nors[i].no
                if (normal[0] * no[0] + normal[1] * no[1] + normal[2] * no[2] < 0.0) {
                    no[0] = -no[0]
                    no[1] = -no[1]
                    no[2] = -no[2]
                }
                normal[0] += no[0]
                normal[1] += no[1]
                normal[2] += no[2]
            }
            normalizeV3(normal)
        }
    } else {
        calcWinding = false
    }

    /* in this case we almost certainly have degenerate geometry,
     * better set a fallback value as a last resort */
    if (normalizeV3(normal) === 0.0) normal[2] = 1.0

    scanfillCalcEx(sfCtx, scanfillFlag, normal)

    /* if we have existing faces, base winding on those */
    if (calcWinding) { // `:181`
        let windingVotes = 0
        for (let sfTri = sfCtx.fillfacebase.first; sfTri; sfTri = sfTri.next) {
            const vTri = [sfTri.v1.tmpP as BMVert, sfTri.v2.tmpP as BMVert, sfTri.v3.tmpP as BMVert]

            for (let i = 0, iPrev = 2; i < 3; iPrev = i++) {
                const e = diskEdgeExists(vTri[i], vTri[iPrev]) // BM_edge_exists
                if (e && edgeIsBoundary(e) && edgeMark.has(e)) {
                    windingVotes += (e.l!.v === vTri[i]) ? 1 : -1
                }
            }
        }

        if (windingVotes < 0) {
            for (let sfTri = sfCtx.fillfacebase.first; sfTri; sfTri = sfTri.next) {
                const t = sfTri.v2
                sfTri.v2 = sfTri.v3
                sfTri.v3 = t
            }
        }
    }

    for (let sfTri = sfCtx.fillfacebase.first; sfTri; sfTri = sfTri.next) { // `:204`
        const f = faceCreateTriNoDouble(bm, [sfTri.v1.tmpP as BMVert, sfTri.v2.tmpP as BMVert, sfTri.v3.tmpP as BMVert])

        eleNewFace.add(f)
        for (const l of f.eachLoop()) {
            if (!edgeMark.has(l.e!)) eleNewEdge.add(l.e!)
        }
    }

    scanfillEnd(sfCtx)

    if (useDissolve) { // `:236`
        // BM_ITER_MESH_MUTABLE over edges. The loop only ever kills the current edge (and faces), and
        // creates no edges, so walking the live set visits exactly what Blender's iterator does.
        for (const e of bm.edges) {
            if (!eleNewEdge.has(e)) continue
            /* in rare cases the edges face will have already been removed from the edge */
            const pair = edgeLoopPair(e)
            if (pair &&
                /* This ensures we don't delete existing faces attached to the geometry being filled.
                 * The likely cause of this will have been a duplicate, where the newly created
                 * face was removed and the existing (un-tagged) face kept.
                 * Follow the rule of not deleting geometry unrelated to the fill. */
                (eleNewFace.has(pair[0].f) && eleNewFace.has(pair[1].f))) {
                // Open: `issues/open/modelling-tools/kernel-triangle-fill-r-double.md`. Blender passes `&f_double` (`:253`), but the
                // kernel's `facesJoinPair` / `facesJoin` (`dissolveEdges.ts`, `dissolve.ts`) do not port
                // `BM_faces_join`'s `r_double` out-parameter, so `fDouble` cannot be reported and stays
                // null. On a duplicate the kernel instead returns the existing face and leaves the two
                // joined faces alive; the `else if (fNew)` branch then kills them with `e`, so the mesh
                // ends up as Blender's, but the pre-existing face is added to `geom.out`, which Blender
                // does not do. Only reachable when a fill overlaps an existing face. Fix: add `r_double`
                // to `facesJoin` (bmesh_core.cc:1376-1388) and pass it here.
                const fDouble: BMFace | null = null
                const fNew = facesJoinPair(bm, e.l!, e.l!.radialNext!, false)

                if (fDouble) {
                    /* NOTE(@ideasman42): Regarding duplicate faces (`:256-270`): never finish with
                     * duplicate faces; remove the "new" face rather than existing geometry. */
                    if (fNew) bm.faceKill(fNew)
                    bm.edgeKill(e)
                } else if (fNew) {
                    eleNewFace.add(fNew)
                    bm.edgeKill(e)
                }
            } else if (e.l === null) {
                bm.edgeKill(e)
            } else {
                /* Edges with 1 or 3+ faces attached,
                 * most likely caused by a degenerate mesh. */
            }
        }
    }

    // BMO_slot_buffer_from_enabled_flag(..., "geom.out", BM_EDGE | BM_FACE, ELE_NEW)
    const outEdges: BMEdge[] = []
    for (const e of bm.edges) if (eleNewEdge.has(e)) outEdges.push(e)
    const outFaces: BMFace[] = []
    for (const f of bm.faces) if (eleNewFace.has(f)) outFaces.push(f)
    return {faces: outFaces, edges: outEdges}
}

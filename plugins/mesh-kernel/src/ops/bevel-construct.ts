/**
 * Analysing one vertex: which of its edges are beveled, in what CCW order, and how far back each
 * side of each beveled edge must be offset.
 *
 * Ported from `bmesh_bevel.cc:6583-7115`.
 *
 * The edge ordering is the subtle half. `bv.edges` must run CCW around the vertex as seen from the
 * outside, with `edges[i].fnext === edges[i + 1].fprev` being the face between them, because every
 * later stage walks that cycle and assumes it. Blender first tries `fastBevelEdgeOrder`, a linear
 * walk that works whenever the faces form a manifold cap, and falls back to
 * `bevelEdgeOrderExtend`, a backtracking search, when they do not. Blender keeps the older
 * quadratic `fast_bevel_edge_order` (the `#else` branch) in preference to a faster one it also
 * wrote, because the two make different arbitrary choices and users' models depend on which - so
 * this is a port of the legacy branch, deliberately.
 *
 * The `offset_type` conversion at the end is where the five offset types stop being the same number:
 * `OFFSET` is the distance from the edge measured in each face, `WIDTH` divides it by
 * `2 sin(angle / 2)` so the *new face* is that wide, `DEPTH` divides by `cos(angle / 2)` so the
 * distance from the original edge to the new surface is the request, and `PERCENT`/`ABSOLUTE`
 * measure along the adjacent edges instead.
 */

import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdges, edgeFaceCount, edgeIsWire, radialLoops} from '../bmesh/structure'
import {ElemFlag} from '../constants'
import {
    addV3V3V3, angleNormalizedV3V3, angleV3V3, normalizeV3, nv3, subV3V3V3,
} from './bevel-math'
import {
    BEVEL_AFFECT, BEVEL_AMT, BEVEL_EPSILON, BevVert, BevelParams, EdgeHalf, newVMesh,
} from './bevel-types'
import {co, edgeCalcLength, edgeOtherVert, faceEdgeShareLoopQ, fno} from './bevel-bmquery'
import {bevCcwTest} from './bevel-profile'
import {contigLdataAcrossEdge} from './bevel-boundary'

/** `edge_face_angle` (`:6585`) - the angle between the two faces at `e`, or 0 when there are not two. */
export function edgeFaceAngle(e: EdgeHalf): number {
    if (e.fprev && e.fnext) {
        // The angle between faces is the supplement of the angle between their normals.
        return Math.PI - angleNormalizedV3V3(fno(e.fprev), fno(e.fnext))
    }
    return 0.0
}

/**
 * `edges_face_connected_at_vert` (`:958`) - do two edges sharing a vertex also share a face?
 * True when some loop around `bme1` has `bme2` as its previous or next edge.
 */
export function edgesFaceConnectedAtVert(bme1: BMEdge, bme2: BMEdge): boolean {
    if (!bme1.l) return false
    for (const l of radialLoops(bme1)) {
        if (l.prev.e === bme2 || l.next.e === bme2) return true
    }
    return false
}

/**
 * `bevel_edge_order_extend` (`:6608`) - extend the ordering past index `i` by backtracking search.
 *
 * Exponential in the number of "internal" faces at the vertex - faces bridging between the edges
 * that would otherwise form a manifold cap - which is almost never more than one. Returns the index
 * at which the best path found ends, with every edge on that path tagged.
 */
function bevelEdgeOrderExtend(
    bv: {v: BMVert, edgecount: number}, edges: (BMEdge | null)[], tagged: Set<BMEdge>, i: number,
): number {
    const sucs: BMEdge[] = []

    const bme = edges[i]!
    for (const l of radialLoops(bme)) {
        const bme2 = (l.v === bv.v ? l.prev.e : l.next.e)!
        if (!tagged.has(bme2)) {
            sucs.push(bme2)
        }
    }
    const nsucs = sucs.length

    let bestj = i
    const j = i
    let savePath: BMEdge[] = []
    for (let sucindex = 0; sucindex < nsucs; sucindex++) {
        const nextbme = sucs[sucindex]
        edges[j + 1] = nextbme
        tagged.add(nextbme)
        const tryj = bevelEdgeOrderExtend(bv, edges, tagged, j + 1)
        if (tryj > bestj ||
            (tryj === bestj && edgesFaceConnectedAtVert(edges[tryj]!, edges[0]!))) {
            bestj = tryj
            savePath = []
            for (let k = j + 1; k <= bestj; k++) {
                savePath.push(edges[k]!)
            }
        }
        // Reset to the path that only goes to j.
        for (let k = j + 1; k <= tryj; k++) {
            tagged.delete(edges[k]!)
            edges[k] = null
        }
    }
    if (bestj > j) {
        for (let k = j + 1; k <= bestj; k++) {
            edges[k] = savePath[k - (j + 1)]
            tagged.add(edges[k]!)
        }
    }
    return bestj
}

/**
 * `fast_bevel_edge_order` (`:6708`, the legacy `#else` branch) - the usual case, where the faces
 * form a manifold cap and each successive edge shares exactly one face with the previous one.
 *
 * On failure it untags the partial path and returns false; the caller then falls back to the search.
 */
function fastBevelEdgeOrder(
    bv: {v: BMVert, edgecount: number}, edges: (BMEdge | null)[], tagged: Set<BMEdge>,
): boolean {
    const ntot = bv.edgecount

    let bme = edges[0]!
    if (!bme.l) {
        return false
    }

    for (let i = 1; i < ntot; i++) {
        // Find an untagged edge bme2 that shares a face with the previous bme.
        let numSharedFace = 0
        let firstSuc: BMEdge | null = null // The first successor, to match the legacy behaviour.
        for (const bme2 of diskEdges(bv.v)) {
            if (tagged.has(bme2)) continue

            if (bme2.l) {
                for (const l of radialLoops(bme2)) {
                    const f: BMFace = l.f
                    if (faceEdgeShareLoopQ(f, bme)) {
                        numSharedFace++
                        if (firstSuc === null) {
                            firstSuc = bme2
                        }
                    }
                }
            }
            if (numSharedFace >= 3) break
        }
        if (numSharedFace === 1 || (i === 1 && numSharedFace === 2)) {
            edges[i] = bme = firstSuc!
            tagged.add(bme)
        } else {
            for (let k = 1; k < i; k++) {
                tagged.delete(edges[k]!)
                edges[k] = null
            }
            return false
        }
    }
    return true
}

/**
 * `find_bevel_edge_order` (`:6765`) - fill `edges` with a good CCW ordering, then resolve the face
 * between each successive pair into `fnext`/`fprev`.
 *
 * `tagged` replaces Blender's `_FLAG_OVERLAP` API flag, which it notes "isn't cleared before use, it
 * just so happens that it's not set"; a set is clearer and has the same lifetime.
 */
export function findBevelEdgeOrder(
    bv: BevVert, edges: (BMEdge | null)[], tagged: Set<BMEdge>, firstBme: BMEdge,
    fnext: (BMFace | null)[], fprev: (BMFace | null)[],
): void {
    const ntot = bv.edgecount
    let first: BMEdge | null = firstBme
    for (let i = 0; ;) {
        edges[i] = first!
        tagged.add(first!)
        if (i === 0 && fastBevelEdgeOrder(bv, edges, tagged)) {
            break
        }
        i = bevelEdgeOrderExtend(bv, edges, tagged, i)
        i++
        if (i >= bv.edgecount) {
            break
        }
        // Not done yet: find a new starting edge, preferring a boundary one.
        first = null
        for (const bme of diskEdges(bv.v)) {
            if (tagged.has(bme)) continue
            if (!first) first = bme
            if (edgeFaceCount(bme) === 1) {
                first = bme
                break
            }
        }
    }

    // Now fill in the faces.
    for (let i = 0; i < ntot; i++) {
        const i2 = i === bv.edgecount - 1 ? 0 : i + 1
        const bme = edges[i]!
        const bme2 = edges[i2]!
        if (fnext[i] !== null || fprev[i2] !== null) {
            continue
        }
        /* Which faces have successive loops for bme and bme2? There can be more than one, for
         * example in the manifold `ntot == 2` case. Prefer one whose loop runs the same way as e.
         * The assignment is inside the loop in Blender, so once a candidate is found every later
         * iteration reassigns; kept as written. */
        let bestf: BMFace | null = null
        if (bme.l) {
            for (const l of radialLoops(bme)) {
                const f = l.f
                if (l.prev.e === bme2 || l.next.e === bme2) {
                    if (!bestf || l.v === bv.v) {
                        bestf = f
                    }
                }
                if (bestf) {
                    fnext[i] = bestf
                    fprev[i2] = bestf
                }
            }
        }
    }
}

/**
 * `bevel_vert_construct` (`:6828`) - build the {@link BevVert} for `v`, or return null when this
 * vertex turns out not to be beveled after all (in which case its tag is cleared, which is what
 * stops the later passes from touching it).
 *
 * Only selected edges with exactly two incident faces are beveled; `bmo_bevel_exec` has already
 * filtered on `BM_edge_is_manifold`, which is where a non-manifold edge is declined.
 *
 * Wire edges are excluded from `edges` entirely when edge beveling, and collected separately so
 * `bevelReattachWires` can put them back.
 */
export function bevelVertConstruct(bm: BMesh, bp: BevelParams, v: BMVert): BevVert | null {
    let nsel = 0
    let totEdges = 0
    let totWire = 0
    let firstBme: BMEdge | null = null
    const tagged = new Set<BMEdge>()

    for (const bme of diskEdges(v)) {
        const faceCount = edgeFaceCount(bme)
        if (bme.testFlag(ElemFlag.Tag) && bp.affectType !== BEVEL_AFFECT.VERTICES) {
            nsel++
            if (!firstBme) {
                firstBme = bme
            }
        }
        if (faceCount === 1) {
            // A good place to start the face chain.
            firstBme = bme
        }
        if (faceCount > 0 || bp.affectType === BEVEL_AFFECT.VERTICES) {
            totEdges++
        }
        if (edgeIsWire(bme)) {
            totWire++
            /* When edge beveling, exclude wire edges from the edges array by marking them chosen so
             * the ordering below will not pick them. */
            if (bp.affectType !== BEVEL_AFFECT.VERTICES) {
                tagged.add(bme)
            }
        }
    }
    if (!firstBme) {
        firstBme = v.e
    }

    if ((nsel === 0 && bp.affectType !== BEVEL_AFFECT.VERTICES) ||
        (totEdges < 2 && bp.affectType === BEVEL_AFFECT.VERTICES)) {
        // Signal that this vertex is not being beveled.
        v.setFlag(ElemFlag.Tag, false)
        return null
    }

    const vmesh = newVMesh()
    vmesh.seg = bp.seg
    const bv: BevVert = {
        v,
        edgecount: totEdges,
        selcount: nsel,
        wirecount: totWire,
        offset: bp.offset,
        anySeam: false,
        visited: false,
        edges: [],
        wireEdges: [],
        vmesh,
    }

    bp.vertHash.set(v, bv)

    /* `findBevelEdgeOrder` only ever touches the `e` field and the two face fields, and needs to be
     * able to write null into `e` while backtracking, so it works on plain arrays which are then
     * used to build the EdgeHalf records. */
    const orderedEdges: (BMEdge | null)[] = new Array(totEdges).fill(null)
    const fnext: (BMFace | null)[] = new Array(totEdges).fill(null)
    const fprev: (BMFace | null)[] = new Array(totEdges).fill(null)
    findBevelEdgeOrder(bv, orderedEdges, tagged, firstBme!, fnext, fprev)

    const edges: EdgeHalf[] = []
    for (let i = 0; i < totEdges; i++) {
        const bme = orderedEdges[i]!
        const isBev = bme.testFlag(ElemFlag.Tag) && bp.affectType !== BEVEL_AFFECT.VERTICES
        edges.push({
            next: null as unknown as EdgeHalf,
            prev: null as unknown as EdgeHalf,
            e: bme,
            fprev: fprev[i],
            fnext: fnext[i],
            leftv: null,
            rightv: null,
            profileIndex: 0,
            seg: isBev ? bp.seg : 0,
            offsetL: 0,
            offsetR: 0,
            offsetLSpec: 0,
            offsetRSpec: 0,
            isBev,
            isRev: bme.v2 === v,
            isSeam: false,
            visitedRpo: false,
        })
    }
    bv.edges = edges

    /* If the edge array does not go CCW around the vertex seen from the average normal side, reverse
     * it, being careful to swap the face pointers too. */
    if (totEdges > 1) {
        let ccwTestSum = 0
        for (let i = 0; i < totEdges; i++) {
            ccwTestSum += bevCcwTest(edges[i].e, edges[(i + 1) % totEdges].e, edges[i].fnext)
        }
        if (ccwTestSum < 0) {
            for (let i = 0; i <= Math.floor(totEdges / 2) - 1; i++) {
                const t = edges[i]
                edges[i] = edges[totEdges - i - 1]
                edges[totEdges - i - 1] = t
                let sw = edges[i].fprev; edges[i].fprev = edges[i].fnext; edges[i].fnext = sw
                const o = edges[totEdges - i - 1]
                sw = o.fprev; o.fprev = o.fnext; o.fnext = sw
            }
            if (totEdges % 2 === 1) {
                const i = Math.floor(totEdges / 2)
                const sw = edges[i].fprev
                edges[i].fprev = edges[i].fnext
                edges[i].fnext = sw
            }
        }
    }

    const vertAxis = nv3(0, 0, 0)
    if (bp.affectType === BEVEL_AFFECT.VERTICES) {
        /* Blender modifies `bv.offset` by the vertex group or bevel weight here; both are out of
         * scope (see the `bevel.ts` header), so the offset stays as given. */
        // Find the centre axis. Blender's note: do not use the vertex normal, it gives bad results.
        if (bp.offsetType === BEVEL_AMT.WIDTH || bp.offsetType === BEVEL_AMT.DEPTH) {
            const edgeDir = nv3()
            for (let i = 0; i < totEdges; i++) {
                const v2 = edgeOtherVert(edges[i].e, bv.v)
                subV3V3V3(edgeDir, co(bv.v), co(v2))
                normalizeV3(edgeDir)
                addV3V3V3(vertAxis, vertAxis, edgeDir)
            }
        }
    }

    // Set the offsets for each beveled edge.
    for (let i = 0; i < totEdges; i++) {
        const e = edges[i]
        e.next = edges[(i + 1) % totEdges]
        e.prev = edges[(i + totEdges - 1) % totEdges]

        if (e.isBev) {
            /* Convert the distance the user asked for into offsets along the faces on the left and
             * right of this edge half. Except for the percent method they are the same on each side. */
            switch (bp.offsetType) {
            case BEVEL_AMT.OFFSET: {
                e.offsetLSpec = bp.offset
                break
            }
            case BEVEL_AMT.WIDTH: {
                const z = Math.abs(2.0 * Math.sin(edgeFaceAngle(e) / 2.0))
                if (z < BEVEL_EPSILON) {
                    e.offsetLSpec = 0.01 * bp.offset // Undefined behaviour, so a tiny bevel.
                } else {
                    e.offsetLSpec = bp.offset / z
                }
                break
            }
            case BEVEL_AMT.DEPTH: {
                const z = Math.abs(Math.cos(edgeFaceAngle(e) / 2.0))
                if (z < BEVEL_EPSILON) {
                    e.offsetLSpec = 0.01 * bp.offset
                } else {
                    e.offsetLSpec = bp.offset / z
                }
                break
            }
            case BEVEL_AMT.PERCENT: {
                /* The offset has to meet the adjacent edges at a percentage of their lengths. The
                 * width is not constant, so no width is stored at all - what is stored is the
                 * distance to travel along the adjacent edge at this end. */
                e.offsetLSpec = edgeCalcLength(e.prev.e) * bp.offset / 100.0
                e.offsetRSpec = edgeCalcLength(e.next.e) * bp.offset / 100.0
                break
            }
            case BEVEL_AMT.ABSOLUTE: {
                // Like percent, but an absolute distance along the adjacent edges.
                e.offsetLSpec = bp.offset
                e.offsetRSpec = bp.offset
                break
            }
            default: {
                e.offsetLSpec = bp.offset
                break
            }
            }
            if (bp.offsetType !== BEVEL_AMT.PERCENT && bp.offsetType !== BEVEL_AMT.ABSOLUTE) {
                e.offsetRSpec = e.offsetLSpec
            }
            // `bp.use_weights` is out of scope.
        } else if (bp.affectType === BEVEL_AFFECT.VERTICES) {
            const edgeDir = nv3()
            switch (bp.offsetType) {
            case BEVEL_AMT.OFFSET: {
                e.offsetLSpec = bv.offset
                break
            }
            case BEVEL_AMT.WIDTH: {
                const v2 = edgeOtherVert(e.e, bv.v)
                subV3V3V3(edgeDir, co(bv.v), co(v2))
                const z = Math.abs(2.0 * Math.sin(angleV3V3(vertAxis, edgeDir)))
                if (z < BEVEL_EPSILON) {
                    e.offsetLSpec = 0.01 * bp.offset
                } else {
                    e.offsetLSpec = bp.offset / z
                }
                break
            }
            case BEVEL_AMT.DEPTH: {
                const v2 = edgeOtherVert(e.e, bv.v)
                subV3V3V3(edgeDir, co(bv.v), co(v2))
                const z = Math.abs(Math.cos(angleV3V3(vertAxis, edgeDir)))
                if (z < BEVEL_EPSILON) {
                    e.offsetLSpec = 0.01 * bp.offset
                } else {
                    e.offsetLSpec = bp.offset / z
                }
                break
            }
            case BEVEL_AMT.PERCENT: {
                e.offsetLSpec = edgeCalcLength(e.e) * bv.offset / 100.0
                break
            }
            case BEVEL_AMT.ABSOLUTE: {
                e.offsetLSpec = bv.offset
                break
            }
            }
            e.offsetRSpec = e.offsetLSpec
        } else {
            e.offsetLSpec = e.offsetRSpec = 0.0
        }
        e.offsetL = e.offsetLSpec
        e.offsetR = e.offsetRSpec

        if (e.fprev && e.fnext) {
            e.isSeam = !contigLdataAcrossEdge(bm, e.e, e.fprev, e.fnext)
        } else {
            e.isSeam = true
        }
    }

    // Collect the wire edges found earlier.
    if (totWire !== 0) {
        for (const bme of diskEdges(v)) {
            if (edgeIsWire(bme)) {
                bv.wireEdges.push(bme)
            }
        }
    }

    return bv
}

/**
 * Rebuilding the original faces, bridging the beveled edges, and clamping.
 *
 * Ported from `bmesh_bevel.cc:7117-7620` (face rebuild, wires, the weld cross and the edge
 * polygons) and `:8012-8236` (collision-limited offsets).
 *
 * Two distinct jobs finish a bevel. Every original face touching a beveled vertex has to be rebuilt
 * with the new boundary vertices spliced in where the old one was ({@link bevRebuildPolygon}); and
 * the strip of quads bridging the two sides of each beveled edge has to be made
 * ({@link bevelBuildEdgePolygons}). The originals are then killed by the caller.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdgeExists, edgeIsManifold, radialLoops} from '../bmesh/structure'
import {copyElemAttrs} from '../bmesh/customdata'
import {ElemFlag} from '../constants'
import {angleV3V3V3, lenSquaredV3V3, lenV3V3, safeDivide} from './bevel-math'
import {
    BEVEL_AFFECT, BEVEL_AMT, BEVEL_EPSILON, BevVert, BevelParams, BoundVert, EdgeHalf, FKind, VMesh,
    countCcwEdgesBetween, findBevVert, findEdgeHalf, findOtherEndEdgeHalf, meshVert, recordFaceKind,
} from './bevel-types'
import {co, edgeCalcLength, edgeOtherVert, faceEdgeShareLoopQ, facesOfVert} from './bevel-bmquery'
import {bevCreateNgon, disableFlagOutEdge, edgeCreateFrom} from './bevel-create'
import {chooseRepFace} from './bevel-boundary'

/**
 * `bev_rebuild_polygon` (`:7118`) - rebuild one original face that has at least one beveled vertex.
 *
 * At each beveled corner the single old vertex is replaced by the run of boundary vertices between
 * where the previous edge left the corner and where this edge enters it. Which way round that run
 * goes depends on how the two edges sit in the CCW ordering at the vertex, which is the `goCcw`
 * decision - and the valence-2 case has to be broken separately, by asking which of the corner's two
 * faces this one is.
 *
 * Returns whether the face was rebuilt; the replacement is left in `rNewFace.f`. The original is
 * *not* killed here - the caller defers that, because one face can be reached from several of its
 * beveled vertices.
 */
export function bevRebuildPolygon(
    bm: BMesh, bp: BevelParams, f: BMFace, rNewFace?: {f: BMFace | null},
): boolean {
    let doRebuild = false
    const vv: BMVert[] = []
    const ee: (BMEdge | null)[] = []
    const nvBvMap = new Map<BMVert, BMVert>() // New vertex to the original beveled vertex.

    for (const l of f.eachLoop()) {
        if (l.v.testFlag(ElemFlag.Tag)) {
            const lprev = l.prev
            const bv = findBevVert(bp, l.v)!
            const vm = bv.vmesh
            const e = findEdgeHalf(bv, l.e!)!
            const bme = e.e
            const eprev = findEdgeHalf(bv, lprev.e!)!

            // Which direction around the vertex do we travel to match the orientation of f?
            let goCcw: boolean
            if (e.prev === eprev) {
                if (eprev.prev === e) {
                    // Valence 2: use whether f is `e.fnext` or `e.fprev` to break the tie.
                    goCcw = e.fnext !== f
                } else {
                    goCcw = true
                }
            } else if (eprev.prev === e) {
                goCcw = false
            } else {
                /* The edges of the face are non-contiguous in our ordering around bv; go whichever
                 * way round is shorter. */
                goCcw = countCcwEdgesBetween(eprev, e) < countCcwEdgesBetween(e, eprev)
            }
            let onProfileStart = false
            let vstart: BoundVert
            let vend: BoundVert
            if (goCcw) {
                vstart = eprev.rightv!
                vend = e.leftv!
                if (e.profileIndex > 0) {
                    vstart = vstart.prev
                    onProfileStart = true
                }
            } else {
                vstart = eprev.leftv!
                vend = e.rightv!
                if (eprev.profileIndex > 0) {
                    vstart = vstart.next
                    onProfileStart = true
                }
            }
            let v: BoundVert = vstart
            if (!onProfileStart) {
                vv.push(v.nv.v!)
                ee.push(bme)
                nvBvMap.set(v.nv.v!, l.v)
            }
            while (v !== vend) {
                if (goCcw) {
                    const i = v.index
                    let kstart: number
                    let kend: number
                    if (onProfileStart) {
                        kstart = e.profileIndex
                        onProfileStart = false
                    } else {
                        kstart = 1
                    }
                    if (eprev.rightv === v && eprev.profileIndex > 0) {
                        kend = eprev.profileIndex
                    } else {
                        kend = vm.seg
                    }
                    for (let k = kstart; k <= kend; k++) {
                        const bmv = meshVert(vm, i, 0, k).v
                        if (bmv) {
                            vv.push(bmv)
                            ee.push(bme)
                            nvBvMap.set(bmv, l.v)
                        }
                    }
                    v = v.next
                } else {
                    const i = v.prev.index
                    let kstart: number
                    let kend: number
                    if (onProfileStart) {
                        kstart = eprev.profileIndex
                        onProfileStart = false
                    } else {
                        kstart = vm.seg - 1
                    }
                    if (e.rightv === v.prev && e.profileIndex > 0) {
                        kend = e.profileIndex
                    } else {
                        kend = 0
                    }
                    for (let k = kstart; k >= kend; k--) {
                        const bmv = meshVert(vm, i, 0, k).v
                        if (bmv) {
                            vv.push(bmv)
                            ee.push(bme)
                            nvBvMap.set(bmv, l.v)
                        }
                    }
                    v = v.prev
                }
            }
            doRebuild = true
        } else {
            vv.push(l.v)
            ee.push(l.e)
            nvBvMap.set(l.v, l.v) // The old vertex is kept, so it maps to itself.
        }
    }
    if (doRebuild) {
        const n = vv.length
        const fNew = bevCreateNgon(bp, bm, vv, n, null, f, null, null, nvBvMap, -1, true)

        // Copy attributes from the old edges.
        let bmePrev = ee[n - 1]
        for (let k = 0; k < n; k++) {
            const bmeNew = diskEdgeExists(vv[k], vv[(k + 1) % n])
            if (ee[k] && bmeNew && ee[k] !== bmeNew) {
                copyElemAttrs(ee[k]!, bmeNew, bm.edata)
                bmeNew.hflag = (bmeNew.hflag & ElemFlag.Select) | (ee[k]!.hflag & ~ElemFlag.Select)
                /* Undo seam and smooth for corner segments when those attributes are not contiguous
                 * around the face. */
                if (k < n - 1 && ee[k] === ee[k + 1]) {
                    if (ee[k]!.testFlag(ElemFlag.Seam) && bmePrev && !bmePrev.testFlag(ElemFlag.Seam)) {
                        bmeNew.setFlag(ElemFlag.Seam, false)
                    }
                    // "Sharp" is the one we want contiguous, so the test is reversed.
                    if (!ee[k]!.testFlag(ElemFlag.Smooth) && bmePrev && bmePrev.testFlag(ElemFlag.Smooth)) {
                        bmeNew.setFlag(ElemFlag.Smooth, true)
                    }
                } else {
                    bmePrev = ee[k]
                }
            }
        }

        // Do not select or return the newly created boundary faces.
        if (fNew) {
            if (rNewFace) {
                rNewFace.f = fNew
            }
            recordFaceKind(bp, fNew, FKind.RECON)
            fNew.setFlag(ElemFlag.Tag, false)
            // Nor new edges that are not part of a new bevel face.
            for (const bme of fNew.edges()) {
                let keep = false
                for (const lOther of radialLoops(bme)) {
                    if (lOther.f.testFlag(ElemFlag.Tag)) {
                        keep = true
                        break
                    }
                }
                if (!keep) {
                    disableFlagOutEdge(bp, bme)
                }
            }
        }
    }

    return doRebuild
}

/**
 * `bevel_rebuild_existing_polygons` (`:7320`) - rebuild every face touching `v`.
 *
 * The originals are collected rather than killed, because a face with two beveled vertices is
 * reached twice and killing it the first time would invalidate the second visit.
 */
export function bevelRebuildExistingPolygons(
    bm: BMesh, bp: BevelParams, v: BMVert, rebuiltOrigFaces: Set<BMFace>,
): void {
    for (const f of facesOfVert(v)) {
        if (!rebuiltOrigFaces.has(f)) {
            if (bevRebuildPolygon(bm, bp, f)) {
                rebuiltOrigFaces.add(f)
            }
        }
    }
}

/**
 * `bevel_reattach_wires` (`:7345`) - a wire edge at a beveled vertex is reconnected to whichever new
 * boundary vertex is closest to its far end.
 */
export function bevelReattachWires(bm: BMesh, bp: BevelParams, v: BMVert): void {
    const bv = findBevVert(bp, v)
    if (!bv || bv.wirecount === 0 || !bv.vmesh) {
        return
    }

    for (let i = 0; i < bv.wirecount; i++) {
        const e = bv.wireEdges[i]
        let vclosest: BMVert | null = null
        let dclosest = Number.MAX_VALUE
        let votherclosest: BMVert | null = null
        const vother = edgeOtherVert(e, v)
        let bvother: BevVert | null = null
        if (vother.testFlag(ElemFlag.Tag)) {
            bvother = findBevVert(bp, vother)
            if (!bvother || !bvother.vmesh) {
                return // Should not happen.
            }
        }
        let bndv = bv.vmesh.boundstart!
        do {
            if (bvother) {
                let bndvother = bvother.vmesh.boundstart!
                do {
                    const d = lenSquaredV3V3(bndvother.nv.co, bndv.nv.co)
                    if (d < dclosest) {
                        vclosest = bndv.nv.v
                        votherclosest = bndvother.nv.v
                        dclosest = d
                    }
                    bndvother = bndvother.next
                } while (bndvother !== bvother.vmesh.boundstart)
            } else {
                const d = lenSquaredV3V3(co(vother), bndv.nv.co)
                if (d < dclosest) {
                    vclosest = bndv.nv.v
                    votherclosest = vother
                    dclosest = d
                }
            }
            bndv = bndv.next
        } while (bndv !== bv.vmesh.boundstart)
        /* Blender has no `vclosest !== votherclosest` test; it would pass the same vertex twice to
         * `BM_edge_create`, which is undefined there and throws here. The guard cannot change a
         * well-formed result, since a wire edge whose two ends resolve to one vertex has nothing to
         * reattach to. */
        if (vclosest && votherclosest && vclosest !== votherclosest) {
            edgeCreateFrom(bm, vclosest, votherclosest, e, true)
        }
    }
}

/**
 * `bevvert_is_weld_cross` (`:7398`) - a weld with four edges, two beveled and two on opposite sides.
 */
export function bevvertIsWeldCross(bv: BevVert): boolean {
    return bv.edgecount === 4 && bv.selcount === 2 &&
        ((bv.edges[0].isBev && bv.edges[2].isBev) || (bv.edges[1].isBev && bv.edges[3].isBev))
}

/**
 * `weld_cross_attrs_copy` (`:7424`) - carry edge attributes across the unbeveled arms of a cross
 * weld, so a seam or sharp edge running through the crossing stays continuous.
 *
 * Blender's diagram: `e` is one of the beveled edges, `e.prev` and `e.next` the unbeveled arms, and
 * their attributes are copied onto the segment edges `01`, `12`, `23` of the profile. A seam is only
 * carried across when *both* arms have it, which is what the two "disable"/"enable" flags encode.
 */
export function weldCrossAttrsCopy(bm: BMesh, bv: BevVert, vm: VMesh, vmindex: number, e: EdgeHalf): void {
    let bmePrev: BMEdge | null = null
    let bmeNext: BMEdge | null = null
    for (let i = 0; i < 4; i++) {
        if (bv.edges[i] === e) {
            bmePrev = bv.edges[(i + 3) % 4].e
            bmeNext = bv.edges[(i + 1) % 4].e
            break
        }
    }
    if (!bmePrev || !bmeNext) return

    // A seam or a sharp edge should only cross when it is that way on both sides.
    const disableSeam = bmePrev.testFlag(ElemFlag.Seam) !== bmeNext.testFlag(ElemFlag.Seam)
    const enableSmooth = bmePrev.testFlag(ElemFlag.Smooth) !== bmeNext.testFlag(ElemFlag.Smooth)

    const nseg = e.seg
    for (let i = 0; i < nseg; i++) {
        const bme = diskEdgeExists(meshVert(vm, vmindex, 0, i).v!, meshVert(vm, vmindex, 0, i + 1).v!)
        if (!bme) continue
        copyElemAttrs(bmePrev, bme, bm.edata)
        bme.hflag = (bme.hflag & ElemFlag.Select) | (bmePrev.hflag & ~ElemFlag.Select)
        if (disableSeam) {
            bme.setFlag(ElemFlag.Seam, false)
        }
        if (enableSmooth) {
            bme.setFlag(ElemFlag.Smooth, true)
        }
    }
}

/**
 * `bevel_build_edge_polygons` (`:7461`) - the strip of quads bridging the two sides of one beveled
 * edge.
 *
 * ```
 *      bme->v1
 *     / | \
 *   v1--|--v4
 *   |   |   |
 *   v2--|--v3
 *     \ | /
 *      bme->v2
 * ```
 *
 * Most of the body is about *which face each quad's corners take their data from*. A quad wholly on
 * one side interpolates in that side's face; the one straddling the centre interpolates in `f1` on
 * the left and `f2` on the right, unless the edge is a UV seam, in which case both halves go to one
 * chosen face and the corners belonging to the other are snapped onto the original edge first so the
 * result lands exactly on the seam.
 */
export function bevelBuildEdgePolygons(bm: BMesh, bp: BevelParams, bme: BMEdge): void {
    const matNr = bp.matNr

    if (!edgeIsManifold(bme)) {
        return
    }

    const bv1 = findBevVert(bp, bme.v1)
    const bv2 = findBevVert(bp, bme.v2)
    if (!bv1 || !bv2) return

    const e1 = findEdgeHalf(bv1, bme)
    const e2 = findEdgeHalf(bv2, bme)
    if (!e1 || !e2) return

    const nseg = e1.seg

    const bmv1 = e1.leftv!.nv.v!
    const bmv4 = e1.rightv!.nv.v!
    const bmv2 = e2.rightv!.nv.v!
    const bmv3 = e2.leftv!.nv.v!

    const f1 = e1.fprev
    const f2 = e1.fnext
    const faces: (BMFace | null)[] = [f1, f1, f2, f2]

    const i1 = e1.leftv!.index
    const i2 = e2.leftv!.index
    const vm1 = bv1.vmesh
    const vm2 = bv2.vmesh

    const verts: BMVert[] = [bmv1, bmv2, null as unknown as BMVert, null as unknown as BMVert]

    const nvBvMap = new Map<BMVert, BMVert>()
    nvBvMap.set(verts[0], bv1.v)
    nvBvMap.set(verts[1], bv2.v)

    const odd = nseg % 2
    const mid = Math.floor(nseg / 2)
    const fchoices: (BMFace | null)[] = [f1, f2]
    let fChoice: BMFace | null = null
    let centerAdjK = -1
    if (odd && e1.isSeam) {
        fChoice = chooseRepFace(bp, fchoices, 2)
        if (nseg > 1) {
            centerAdjK = fChoice === f1 ? mid + 2 : mid
        }
    }
    for (let k = 1; k <= nseg; k++) {
        verts[3] = meshVert(vm1, i1, 0, k).v!
        verts[2] = meshVert(vm2, i2, 0, nseg - k).v!
        nvBvMap.set(verts[3], bv1.v)
        nvBvMap.set(verts[2], bv2.v)
        let rF: BMFace | null
        if (odd && k === mid + 1) {
            if (e1.isSeam) {
                /* Straddles a seam: interpolate in `fChoice` and snap the loops whose verts are in
                 * the other face onto `bme` for interpolation. */
                const edges: (BMEdge | null)[] = fChoice === f1
                    ? [null, null, bme, bme]
                    : [bme, bme, null, null]
                rF = bevCreateNgon(bp, bm, verts, 4, null, fChoice, edges, null, nvBvMap, matNr, true)
            } else {
                // Straddles but is not a seam: left half in f1, right half in f2.
                rF = bevCreateNgon(bp, bm, verts, 4, faces, fChoice, null, null, nvBvMap, matNr, true)
            }
        } else if (odd && k === centerAdjK && e1.isSeam) {
            /* The strip next to the centre one, in another UV island. Snap the edge near the seam to
             * `bme` to match what happens in the bevel rings. */
            let edges: (BMEdge | null)[]
            let fInterp: BMFace | null
            if (k === mid) {
                edges = [null, null, bme, bme]
                fInterp = f1
            } else {
                edges = [bme, bme, null, null]
                fInterp = f2
            }
            rF = bevCreateNgon(bp, bm, verts, 4, null, fInterp, edges, null, nvBvMap, matNr, true)
        } else if (!odd && k === mid) {
            // The left polygon that touches an even centre line on its right.
            const edges: (BMEdge | null)[] = [null, null, bme, bme]
            rF = bevCreateNgon(bp, bm, verts, 4, null, f1, edges, null, nvBvMap, matNr, true)
        } else if (!odd && k === mid + 1) {
            // The right polygon that touches an even centre line on its left.
            const edges: (BMEdge | null)[] = [bme, bme, null, null]
            rF = bevCreateNgon(bp, bm, verts, 4, null, f2, edges, null, nvBvMap, matNr, true)
        } else {
            // Neither crosses nor touches the centre line.
            const f = k <= mid ? f1 : f2
            rF = bevCreateNgon(bp, bm, verts, 4, null, f, null, null, nvBvMap, matNr, true)
        }
        recordFaceKind(bp, rF, FKind.EDGE)
        // Tag the long edges: those out of verts[0] and verts[2].
        if (rF) {
            for (const l of rF.eachLoop()) {
                if (l.v === verts[0] || l.v === verts[2]) {
                    l.setFlag(ElemFlag.TagAlt, true)
                }
            }
        }
        verts[0] = verts[3]
        verts[1] = verts[2]
    }

    // Copy edge data to the first and last edge.
    const bme1 = diskEdgeExists(bmv1, bmv2)
    const bme2 = diskEdgeExists(bmv3, bmv4)
    for (const target of [bme1, bme2]) {
        if (!target) continue
        copyElemAttrs(bme, target, bm.edata)
        target.hflag = (target.hflag & ElemFlag.Select) | (bme.hflag & ~ElemFlag.Select)
    }

    // At a "weld cross" end, keep edge attributes continuous across the end edges.
    if (bevvertIsWeldCross(bv1)) {
        weldCrossAttrsCopy(bm, bv1, vm1, i1, e1)
    }
    if (bevvertIsWeldCross(bv2)) {
        weldCrossAttrsCopy(bm, bv2, vm2, i2, e2)
    }
}

// region collision limiting (`:8012-8236`)

/**
 * `geometry_collide_offset` (`:8012`) - the largest offset at which the beveled edge `eb` has not
 * yet collapsed.
 *
 * Blender's diagram:
 * ```
 * a                 d
 *  \               /
 * A \             / C
 *    \ th1    th2/
 *     b---------c
 *          B
 * ```
 * `A`, `B`, `C` follow a face around `a, b, c, d`; `eb` is `B`, going from `b` to `c`. The offsets
 * of the three have the form `ka*t`, `kb*t`, `kc*t`. Offsetting all three inwards makes two corner
 * vectors that meet at a point; the length of `B` divided by the projection of those vectors onto
 * `B` is how many offsets fit before the edge collapses.
 *
 * The second half handles edge slide: when a side edge is in line with `B` and not beveled, walking
 * on around the n-gon until the accumulated exterior angle turns gives a further limit.
 */
export function geometryCollideOffset(bp: BevelParams, eb: EdgeHalf): number {
    const noCollideOffset = bp.offset + 1e6
    let limit = noCollideOffset
    if (bp.offset === 0.0) {
        return noCollideOffset
    }
    let kb = eb.offsetLSpec
    const ea = eb.next // In direction b --> a.
    const ka = ea.offsetRSpec
    let vb: BMVert
    let vc: BMVert
    if (eb.isRev) {
        vc = eb.e.v1
        vb = eb.e.v2
    } else {
        vb = eb.e.v1
        vc = eb.e.v2
    }
    const va = ea.isRev ? ea.e.v1 : ea.e.v2
    const bvcRef: {bv: BevVert | null} = {bv: null}
    const ebother = findOtherEndEdgeHalf(bp, eb, bvcRef)
    let ec: EdgeHalf | null
    let vd: BMVert
    let kc: number
    if (bp.offsetType === BEVEL_AMT.PERCENT || bp.offsetType === BEVEL_AMT.ABSOLUTE) {
        if (ea.isBev && ebother !== null && ebother.prev.isBev) {
            if (bp.offsetType === BEVEL_AMT.PERCENT) {
                return 50.0
            }
            // Blender: "This is only right sometimes. The exact answer is very hard to calculate."
            const blen = edgeCalcLength(eb.e)
            return bp.offset > blen / 2.0 ? blen / 2.0 : blen
        }
        return noCollideOffset
    }
    if (ebother !== null) {
        ec = ebother.prev // In direction c --> d.
        vc = bvcRef.bv!.v
        kc = ec.offsetLSpec
        vd = ec.isRev ? ec.e.v1 : ec.e.v2
    } else {
        // No BevVert for the far end, so C cannot be beveled.
        kc = 0.0
        ec = null
        // Find an edge from c that has the same face.
        if (eb.fnext === null) {
            return noCollideOffset
        }
        const lb = faceEdgeShareLoopQ(eb.fnext, eb.e)
        if (!lb) {
            return noCollideOffset
        }
        if (lb.next.v === vc) {
            vd = lb.next.next.v
        } else if (lb.v === vc) {
            vd = lb.prev.v
        } else {
            return noCollideOffset
        }
    }
    if (ea.e === eb.e || (ec && ec.e === eb.e)) {
        return noCollideOffset
    }
    const th1 = angleV3V3V3(co(va), co(vb), co(vc))
    const th2 = angleV3V3V3(co(vb), co(vc), co(vd))

    /* The offset at which edge B collapses, which is when advancing clones of A, B and C all meet
     * at a point. */
    const sin1 = Math.sin(th1)
    const sin2 = Math.sin(th2)
    const cos1 = Math.cos(th1)
    const cos2 = Math.cos(th2)
    let offsetsProjectedOnB = safeDivide(ka + cos1 * kb, sin1) + safeDivide(kc + cos2 * kb, sin2)
    if (offsetsProjectedOnB > BEVEL_EPSILON) {
        offsetsProjectedOnB = bp.offset * (lenV3V3(co(vb), co(vc)) / offsetsProjectedOnB)
        if (offsetsProjectedOnB > BEVEL_EPSILON) {
            limit = offsetsProjectedOnB
        }
    }

    /* Now the edge slide cases. Where side edges are in line with edge B and are not beveled, keep
     * iterating until a return edge (not in line with B) gives a minimum offset to the far side of
     * the n-gon. Blender: "This is not perfect, but is simpler and will catch many more overlap
     * issues." */
    if (kb > 1.1920929e-7 && (ka === 0.0 || kc === 0.0)) {
        // Use the bevel-weight offsets rather than the full offset where weights are used.
        kb = bp.offset / kb

        if (ka === 0.0 && eb.fnext) {
            let la = faceEdgeShareLoopQ(eb.fnext, ea.e)
            if (la) {
                let aSideSlide = 0.0
                let exteriorAngle = 0.0
                let first = true

                /* Blender has no iteration bound here: it relies on the accumulated exterior angle
                 * of a real face turning within one lap. The bound is defensive only - a face whose
                 * every corner is exactly straight would spin forever - and it cannot change the
                 * result for any face that terminates. */
                let guard = eb.fnext.len + 1
                while (exteriorAngle < 0.0001 && guard-- > 0) {
                    if (first) {
                        exteriorAngle = Math.PI - th1
                        first = false
                    } else {
                        la = la!.prev
                        exteriorAngle += Math.PI -
                            angleV3V3V3(co(la.v), co(la.next.v), co(la.next.next.v))
                    }
                    aSideSlide += edgeCalcLength(la!.e!) * Math.sin(exteriorAngle)
                }
                limit = Math.min(aSideSlide * kb, limit)
            }
        }

        if (kc === 0.0 && eb.fnext) {
            let lc: BMLoop | null = faceEdgeShareLoopQ(eb.fnext, eb.e)
            if (lc) {
                lc = lc.next
                let cSideSlide = 0.0
                let exteriorAngle = 0.0
                let first = true
                let guard = eb.fnext.len + 1
                while (exteriorAngle < 0.0001 && guard-- > 0) {
                    if (first) {
                        exteriorAngle = Math.PI - th2
                        first = false
                    } else {
                        lc = lc!.next
                        exteriorAngle += Math.PI -
                            angleV3V3V3(co(lc.prev.v), co(lc.v), co(lc.next.v))
                    }
                    cSideSlide += edgeCalcLength(lc!.e!) * Math.sin(exteriorAngle)
                }
                limit = Math.min(cSideSlide * kb, limit)
            }
        }
    }
    return limit
}

/**
 * `vertex_collide_offset` (`:8164`) - for a vertex bevel, the `t` at which the two new vertices
 * sliding along one edge from each end meet.
 */
export function vertexCollideOffset(bp: BevelParams, ea: EdgeHalf): number {
    const noCollideOffset = bp.offset + 1e6
    if (bp.offset === 0.0) {
        return noCollideOffset
    }
    const ka = ea.offsetLSpec / bp.offset
    const eb = findOtherEndEdgeHalf(bp, ea)
    const kb = eb ? eb.offsetLSpec / bp.offset : 0.0
    const kab = ka + kb
    const la = edgeCalcLength(ea.e)
    if (kab <= 0.0) {
        return noCollideOffset
    }
    return la / kab
}

/**
 * `bevel_limit_offset` (`:8186`) - clamp `bp.offset` to the largest value that does not collide, and
 * scale every offset spec by the same factor.
 *
 * Every spec is some multiple of `bp.offset`, which is why a single multiply is equivalent to
 * recomputing them all - that identity is the whole reason clamping can be a separate pass.
 */
export function bevelLimitOffset(bp: BevelParams, bm: BMesh): void {
    let limitedOffset = bp.offset
    for (const bmv of bm.verts) {
        if (!bmv.testFlag(ElemFlag.Tag)) continue
        const bv = findBevVert(bp, bmv)
        if (!bv) continue
        for (let i = 0; i < bv.edgecount; i++) {
            const eh = bv.edges[i]
            const collisionOffset = bp.affectType === BEVEL_AFFECT.VERTICES
                ? vertexCollideOffset(bp, eh)
                : geometryCollideOffset(bp, eh)
            limitedOffset = Math.min(collisionOffset, limitedOffset)
        }
    }

    if (limitedOffset < bp.offset) {
        const offsetFactor = limitedOffset / bp.offset
        for (const bmv of bm.verts) {
            if (!bmv.testFlag(ElemFlag.Tag)) continue
            const bv = findBevVert(bp, bmv)
            if (!bv) continue
            for (let i = 0; i < bv.edgecount; i++) {
                const eh = bv.edges[i]
                eh.offsetLSpec *= offsetFactor
                eh.offsetRSpec *= offsetFactor
                eh.offsetL *= offsetFactor
                eh.offsetR *= offsetFactor
            }
        }
        bp.offset = limitedOffset
    }
}

// endregion

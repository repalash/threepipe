/**
 * Element creation, representative-face choice and the UV merge bookkeeping.
 *
 * Ported from `bmesh_bevel.cc:757-1170` (flags, the UV vert map, `bev_create_ngon`) and
 * `:5259-5500` (representative faces for the corner polygon).
 *
 * Blender's comment on `bev_create_ngon` - "ALL face creation goes through this function, this is
 * important to keep!" - is why everything else in this port calls {@link bevCreateNgon} rather than
 * `bm.faceCreate`. It is the single place that copies face attributes, interpolates each new
 * corner's data from the right original face, records the face kind, and registers the face for the
 * UV merge pass.
 *
 * ### The UV merge pass
 *
 * `BM_loop_interp_from_face` places each new corner's UV by projecting its 3D position into the
 * source face and taking the barycentric-style blend. Two corners that are geometrically the same
 * point but were interpolated in two different source faces come out with UVs that differ in the
 * last few digits, which shows as a hairline seam. Blender fixes this afterwards rather than trying
 * to make the interpolation exact: loops that *should* share a UV are collected into buckets by
 * {@link determineUvVertConnectivity} and {@link updateUvVertMap}, and {@link bevelMergeUvs}
 * averages each bucket. The comment on `bevel_merge_uvs` says as much: it "exists purely because of
 * imperfections in initial UV position calculations".
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {BMLayerDef, copyElemAttrs, getValue, setValue} from '../bmesh/customdata'
import {loopInterpFromFace} from '../bmesh/interp'
import {ElemFlag} from '../constants'
import {
    M3, V3, areaPolyV2, axisDominantV3ToM3, closestToLineSegmentV3, copyV3V3, lenSquaredV3V3,
    mulV2M3V3, nv3,
} from './bevel-math'
import {
    BEVEL_EPSILON_BIG, BevVert, BevelParams, BoundVert, FKind, STD_UV_CONNECT_LIMIT, UVFace, VMesh,
    findUVFace, meshVert, recordFaceKind,
} from './bevel-types'
import {co, facePointInsideTest, faceVertShareLoop, fno, loopsOfVert, setCo} from './bevel-bmquery'
import {chooseRepFace} from './bevel-boundary'

// region output flags (`:754-778`)

/** `flag_out_edge` (`:759`). */
export function flagOutEdge(bp: BevelParams, bme: BMEdge): void {
    bp.outEdges.add(bme)
}

/** `flag_out_vert` (`:766`). */
export function flagOutVert(bp: BevelParams, bmv: BMVert): void {
    bp.outVerts.add(bmv)
}

/** `disable_flag_out_edge` (`:773`). */
export function disableFlagOutEdge(bp: BevelParams, bme: BMEdge): void {
    bp.outEdges.delete(bme)
}

// endregion

// region element creation matching BM_elem_attrs_copy

/**
 * `BM_elem_attrs_copy`'s header rule (`bmesh_construct.cc:337`):
 * `dst->hflag = (dst->hflag & SELECT) | (src->hflag & ~SELECT)`.
 *
 * The kernel's `vertCreate`/`edgeCreate`/`faceCreate` do the opposite - they take the example's
 * flags but strip `Tag` and keep nothing of the destination. Bevel depends on both halves of the
 * real rule: `Tag` must propagate (`bev_create_ngon` and the final vertex sweep both read it), and a
 * new face must not silently inherit a selected example's select bit or `bm.totfacesel` desynchronises.
 * So each `*CreateFrom` below fixes the header up after the fact, the same workaround `ops/inset.ts`
 * uses and for the same reason - `issues/open/modelling-tools/kernel-elem-attrs-copy-flags.md`.
 */
function elemHflagFromExample(dstHflag: number, srcHflag: number): number {
    const mask = ElemFlag.Select | ElemFlag.SelectUV
    return (dstHflag & mask) | (srcHflag & ~mask)
}

/** `BM_vert_create(bm, co, eg, BM_CREATE_NOP)` with `BM_elem_attrs_copy`'s flag rule. */
export function vertCreateFrom(bm: BMesh, point: readonly number[], example: BMVert | null): BMVert {
    const v = bm.vertCreate(point[0], point[1], point[2], example ?? undefined)
    if (example) {
        v.hflag = elemHflagFromExample(0, example.hflag)
        // `BM_elem_attrs_copy` copies `v->no` too, which the kernel does not.
        v.nx = example.nx
        v.ny = example.ny
        v.nz = example.nz
    }
    return v
}

/** `BM_edge_create` with the same correction. */
export function edgeCreateFrom(
    bm: BMesh, v1: BMVert, v2: BMVert, example: BMEdge | null, noDouble = false,
): BMEdge {
    const e = bm.edgeCreate(v1, v2, example ?? undefined, {noDouble})
    if (example && e.v1 === v1 && e.v2 === v2) {
        e.hflag = elemHflagFromExample(0, example.hflag)
    }
    return e
}

/**
 * `create_mesh_bmvert` (`:862`) - instantiate the `BMVert` for a VMesh slot.
 *
 * The `BM_elem_flag_disable(nv->v, BM_ELEM_TAG)` is not incidental: the example is the original
 * vertex, which *is* tagged, and a tagged new vertex would be killed by the final sweep.
 */
export function createMeshBmvert(
    bm: BMesh, bp: BevelParams, vm: VMesh, i: number, j: number, k: number, eg: BMVert | null,
): void {
    const nv = meshVert(vm, i, j, k)
    nv.v = vertCreateFrom(bm, nv.co, eg)
    nv.v.setFlag(ElemFlag.Tag, false)
    flagOutVert(bp, nv.v)
}

// endregion

// region UV vert map (`:974-1160`)

/** `register_uv_face` (`:974`). */
export function registerUvFace(
    bp: BevelParams, fnew: BMFace | null, frep: BMFace | null, frepArr: (BMFace | null)[] | null,
): UVFace | null {
    if (!fnew) return null

    const uvFace: UVFace = {f: fnew, attachedFrep: null}
    if (frepArr && frepArr[0]) {
        /* Taking the first entry of `frepArr` is arbitrary, and Blender's comment explains why it
         * does not matter: when a new face's corner data is interpolated from several original
         * faces, those faces should already be connected in UV space. */
        uvFace.attachedFrep = frepArr[0]
    } else if (frep) {
        uvFace.attachedFrep = frep
    }

    bp.uvFaceHash.set(fnew, uvFace)
    return uvFace
}

/** `update_uv_vert_map` (`:1005`). */
export function updateUvVertMap(
    bp: BevelParams, uvFace: UVFace | null, bv: BMVert | null, nvBvMap: Map<BMVert, BMVert> | null,
): void {
    if (!uvFace || !uvFace.attachedFrep) {
        return
    }

    for (const uvVertMap of bp.uvVertMaps) {
        for (const l of uvFace.f.eachLoop()) {
            const uvVertBuckets = uvVertMap.get(l.v)
            if (!uvVertBuckets) {
                /* A new vertex (and its loop) needs registering. No connectivity search is needed;
                 * make a bucket and move on. */
                uvVertMap.set(l.v, [new Set([l])])
                continue
            }

            /* `origV` always points at a vertex taking part in the bevel that came from the
             * original mesh - the same vertex as `BevVert.v`. */
            const origV = nvBvMap ? nvBvMap.get(l.v)! : bv!
            const origL = faceVertShareLoop(uvFace.attachedFrep, origV)

            let isBucketFound = false
            for (const l2 of loopsOfVert(l.v)) {
                if (l === l2) continue

                const uvFace2 = findUVFace(bp, l2.f)
                if (!uvFace2 || !uvFace2.attachedFrep) continue

                const origL2 = faceVertShareLoop(uvFace2.attachedFrep, origV)

                let isOrigUvVertsConnected = false
                const origUvVertBuckets = uvVertMap.get(origV)
                if (origUvVertBuckets && origL && origL2) {
                    for (const bucket of origUvVertBuckets) {
                        if (bucket.has(origL) && bucket.has(origL2)) {
                            isOrigUvVertsConnected = true
                            break
                        }
                    }
                }

                /* Add `l` to the bucket holding the neighbouring loop `l2` when either the two new
                 * faces have the same representative face, or their representative faces are
                 * different but already overlapping in UV space at this vertex. */
                if (uvFace.attachedFrep === uvFace2.attachedFrep || isOrigUvVertsConnected) {
                    for (const bucket of uvVertBuckets) {
                        if (bucket.has(l2)) {
                            bucket.add(l)
                            isBucketFound = true
                            break
                        }
                    }
                }
                if (isBucketFound) break
            }
            if (!isBucketFound) {
                uvVertBuckets.push(new Set([l]))
            }
        }
    }
}

/** The UV (`float2`) loop layers, in order. `CustomData_get_n_offset(&bm->ldata, CD_PROP_FLOAT2, i)`. */
export function uvLayers(bm: BMesh): BMLayerDef[] {
    return bm.ldata.layers.filter(l => l.type === 'float2')
}

/** `uv_vert_map_init` (`:1419`). */
export function uvVertMapInit(bp: BevelParams, bm: BMesh): void {
    bp.uvVertMaps = uvLayers(bm).map(() => new Map())
}

/** `uv_vert_map_pop` (`:1429`). */
export function uvVertMapPop(bp: BevelParams, v: BMVert): void {
    for (const uvVertMap of bp.uvVertMaps) {
        uvVertMap.delete(v)
    }
}

/**
 * `determine_uv_vert_connectivity` (`:1093`) - bucket the loops around `v` by whether their UVs
 * already coincide, before anything is built. Two loops within `STD_UV_CONNECT_LIMIT` are the same
 * UV vert and must stay so.
 */
export function determineUvVertConnectivity(bp: BevelParams, bm: BMesh, v: BMVert): void {
    const layers = uvLayers(bm)
    for (let i = 0; i < layers.length; ++i) {
        const layer = layers[i]
        const uvVertBuckets: Set<BMLoop>[] = []
        for (const l of loopsOfVert(v)) {
            const luv = getValue(l, layer)
            let isOverlapFound = false
            for (const bucket of uvVertBuckets) {
                for (const l2 of bucket) {
                    const luv2 = getValue(l2, layer)
                    if (Math.abs(luv[0] - luv2[0]) <= STD_UV_CONNECT_LIMIT &&
                        Math.abs(luv[1] - luv2[1]) <= STD_UV_CONNECT_LIMIT) {
                        bucket.add(l)
                        isOverlapFound = true
                        break
                    }
                }
                if (isOverlapFound) break
            }
            if (!isOverlapFound) {
                uvVertBuckets.push(new Set([l]))
            }
        }
        bp.uvVertMaps[i].set(v, uvVertBuckets)
    }
}

/** `bevel_merge_uvs` (`:1137`) - average each bucket's UVs so they become exactly equal. */
export function bevelMergeUvs(bp: BevelParams, bm: BMesh): void {
    const layers = uvLayers(bm)
    for (let i = 0; i < layers.length; ++i) {
        const layer = layers[i]
        for (const uvVertBuckets of bp.uvVertMaps[i].values()) {
            for (const bucket of uvVertBuckets) {
                const numUvVerts = bucket.size
                if (numUvVerts <= 1) continue
                const uv = [0, 0]
                for (const l of bucket) {
                    const luv = getValue(l, layer)
                    uv[0] += luv[0]
                    uv[1] += luv[1]
                }
                uv[0] /= numUvVerts
                uv[1] /= numUvVerts
                for (const l of bucket) {
                    setValue(l, bm.ldata, layer, uv)
                }
            }
        }
    }
}

// endregion

// region representative faces

/**
 * `boundvert_rep_face` (`:1172`) - a good face to take materials and corner data from for the faces
 * built around this bound vert, and optionally a second choice.
 */
export function boundvertRepFace(v: BoundVert, rFother?: {f: BMFace | null}): BMFace | null {
    let frep: BMFace | null
    let frep2: BMFace | null = null
    if (v.ebev) {
        frep = v.ebev.fprev
        if (v.efirst!.fprev !== frep) {
            frep2 = v.efirst!.fprev
        }
    } else if (v.efirst) {
        frep = v.efirst.fprev
        if (frep) {
            if (v.elast!.fnext !== frep) {
                frep2 = v.elast!.fnext
            } else if (v.efirst.fnext !== frep) {
                frep2 = v.efirst.fnext
            } else if (v.elast!.fprev !== frep) {
                frep2 = v.efirst.fprev
            }
        } else if (v.efirst.fnext) {
            frep = v.efirst.fnext
            if (v.elast!.fnext !== frep) {
                frep2 = v.elast!.fnext
            }
        } else if (v.elast!.fprev) {
            frep = v.elast!.fprev
        }
    } else if (v.prev.elast) {
        frep = v.prev.elast.fnext
        if (v.next.efirst) {
            if (frep) {
                frep2 = v.next.efirst.fprev
            } else {
                frep = v.next.efirst.fprev
            }
        }
    } else {
        frep = null
    }
    if (rFother) {
        rFother.f = frep2
    }
    return frep
}

/** `get_incident_edges` (`:5259`) - the (up to two) edges of `f` that use `v`. */
export function getIncidentEdges(f: BMFace | null, v: BMVert): [BMEdge | null, BMEdge | null] {
    let e1: BMEdge | null = null
    let e2: BMEdge | null = null
    if (!f) return [null, null]
    for (const e of f.edges()) {
        if (e.v1 === v || e.v2 === v) {
            if (e1 === null) e1 = e
            else if (e2 === null) e2 = e
        }
    }
    return [e1, e2]
}

/** `dist_squared_to_line_segment_v3` (`math_geom.cc:395`). */
function distSquaredToLineSegmentV3(p: readonly number[], l1: readonly number[], l2: readonly number[]): number {
    const closest = nv3()
    closestToLineSegmentV3(closest, p, l1, l2)
    return lenSquaredV3V3(closest, p)
}

/** `find_closer_edge` (`:5281`). */
export function findCloserEdge(point: readonly number[], e1: BMEdge, e2: BMEdge): BMEdge {
    const dsq1 = distSquaredToLineSegmentV3(point, co(e1.v1), co(e1.v2))
    const dsq2 = distSquaredToLineSegmentV3(point, co(e2.v1), co(e2.v2))
    return dsq1 < dsq2 ? e1 : e2
}

/**
 * `find_face_internal_boundverts` (`:5300`) - which bound verts of `bv` project inside `f`.
 * At most three, because including miters that is the most that can lie between two edges.
 */
export function findFaceInternalBoundverts(bv: BevVert, f: BMFace | null): (BoundVert | null)[] {
    const rInternal: (BoundVert | null)[] = [null, null, null]
    if (f === null) {
        return rInternal
    }
    let nInternal = 0
    const vm = bv.vmesh
    let v = vm.boundstart!
    do {
        if (facePointInsideTest(f, v.nv.co)) {
            rInternal[nInternal++] = v
            if (nInternal === 3) break
        }
        v = v.next
    } while (v !== vm.boundstart)
    return rInternal
}

/**
 * `projected_boundary_area` (`:5336`) - the area, in `f`'s plane, of the polygon the bound verts
 * would make once each one outside `f` is snapped to whichever of `f`'s two incident edges is
 * nearer.
 */
export function projectedBoundaryArea(bv: BevVert, f: BMFace): number {
    const vm = bv.vmesh
    const projCo: number[][] = []
    const axisMat: M3 = [0, 0, 0, 0, 0, 0, 0, 0, 0]
    axisDominantV3ToM3(axisMat, fno(f))
    const [e1, e2] = getIncidentEdges(f, bv.v)
    if (!e1 || !e2) return 0
    const unsnapped = findFaceInternalBoundverts(bv, f)
    let v = vm.boundstart!
    do {
        const point = co(v.nv.v!)
        const p = [0, 0]
        if (v === unsnapped[0] || v === unsnapped[1] || v === unsnapped[2]) {
            mulV2M3V3(p, axisMat, point)
        } else {
            const snap1 = nv3()
            const snap2 = nv3()
            closestToLineSegmentV3(snap1, point, co(e1.v1), co(e1.v2))
            closestToLineSegmentV3(snap2, point, co(e2.v1), co(e2.v2))
            const d1Sq = lenSquaredV3V3(snap1, point)
            const d2Sq = lenSquaredV3V3(snap2, point)
            mulV2M3V3(p, axisMat, d1Sq <= d2Sq ? snap1 : snap2)
        }
        projCo.push(p)
        v = v.next
    } while (v !== vm.boundstart)
    return areaPolyV2(projCo, vm.count)
}

/**
 * `is_bad_uv_poly` (`:5381`) - would this representative face give a near-zero-area UV polygon?
 * That interpolates textures badly, so such a candidate is dropped.
 */
export function isBadUvPoly(bv: BevVert, frep: BMFace): boolean {
    return projectedBoundaryArea(bv, frep) < BEVEL_EPSILON_BIG
}

/**
 * `frep_for_center_poly` (`:5405`) - the representative face for the polygon in the middle of a
 * corner.
 *
 * Normally only the faces either side of a beveled edge are candidates. A single beveled edge is a
 * special case where the third face has to be considered too, or the UV polygon comes out with zero
 * area; and a vertex bevel has no beveled edges at all, so with an odd segment count every adjacent
 * face is a candidate - which is exactly what `affectVerticesOdd` is for.
 */
export function frepForCenterPoly(bp: BevelParams, bv: BevVert): BMFace | null {
    let anyBmf: BMFace | null = null
    const considerAllFaces = bv.selcount === 1 || bp.affectVerticesOdd
    const fchoices: (BMFace | null)[] = []

    for (let i = 0; i < bv.edgecount; i++) {
        if (!bv.edges[i].isBev && !considerAllFaces) {
            continue
        }
        const ftwo: (BMFace | null)[] = [bv.edges[i].fprev, bv.edges[i].fnext]
        const bmf = chooseRepFace(bp, ftwo, 2)
        if (bmf !== null) {
            if (anyBmf === null) {
                anyBmf = bmf
            }
            let alreadyThere = false
            for (let j = fchoices.length - 1; j >= 0; j--) {
                if (fchoices[j] === bmf) {
                    alreadyThere = true
                    break
                }
            }
            if (!alreadyThere) {
                if (bp.mathLayerInfo.hasMathLayers) {
                    if (isBadUvPoly(bv, bmf)) {
                        continue
                    }
                }
                fchoices.push(bmf)
            }
        }
    }
    if (fchoices.length === 0) {
        return anyBmf
    }
    return chooseRepFace(bp, fchoices, fchoices.length)
}

// endregion

/**
 * `bev_create_ngon` (`:1236`) - the one place a bevel face is made.
 *
 * @param faceArr per-corner interpolation face, or null to use `facerep` for every corner.
 * @param snapEdgeArr per-corner edge to snap the vertex onto *for interpolation only*. The position
 *   is saved, moved onto the edge, interpolated, and restored; without it a corner that sits just
 *   off an original edge picks up data extrapolated from outside the source face.
 * @param doInterp run `BM_loop_interp_from_face` at all.
 */
export function bevCreateNgon(
    bp: BevelParams, bm: BMesh, vertArr: BMVert[], totv: number,
    faceArr: (BMFace | null)[] | null, facerep: BMFace | null,
    snapEdgeArr: (BMEdge | null)[] | null, bv: BMVert | null,
    nvBvMap: Map<BMVert, BMVert> | null, matNr: number, doInterp: boolean,
): BMFace | null {
    const verts = vertArr.slice(0, totv)
    let f: BMFace
    try {
        f = bm.faceCreate(verts, facerep ?? undefined)
    } catch {
        // `BM_face_create_verts` returns null on a degenerate vertex list; the kernel throws.
        return null
    }
    if (facerep || (faceArr && faceArr[0])) {
        const src = facerep ?? faceArr![0]!
        copyElemAttrs(src, f, bm.pdata)
        // Blender's face is fresh (`hflag == 0`) when `BM_elem_attrs_copy` runs, so the destination
        // half of the mask contributes nothing; passing 0 reproduces that regardless of what the
        // kernel's `faceCreate` already put there.
        f.hflag = elemHflagFromExample(0, src.hflag)
        f.matNr = src.matNr
        if (doInterp) {
            let i = 0
            for (const l of f.eachLoop()) {
                // The loops of a created face are in the same order as the verts.
                const interpF = faceArr ? faceArr[i] : facerep
                if (interpF) {
                    const bme = snapEdgeArr ? snapEdgeArr[i] : null
                    let saveCo: V3 | null = null
                    if (bme) {
                        saveCo = co(l.v)
                        const snapped = nv3()
                        closestToLineSegmentV3(snapped, saveCo, co(bme.v1), co(bme.v2))
                        setCo(l.v, snapped)
                    }
                    loopInterpFromFace(bm, l, interpF, true)
                    if (bme && saveCo) {
                        setCo(l.v, saveCo)
                    }
                }
                i++
            }
        }
    }

    f.setFlag(ElemFlag.Tag, true)
    for (const bme of f.edges()) {
        // Not needed by bevel itself; this is so the operator can select the new geometry.
        flagOutEdge(bp, bme)
    }

    if (matNr >= 0) {
        f.matNr = matNr
    }

    const uvFace = registerUvFace(bp, f, facerep, faceArr)
    updateUvVertMap(bp, uvFace, bv, nvBvMap)

    return f
}

/**
 * `build_center_ngon` (`:5449`) - the polygon at the very middle of a corner, made from the
 * `(i, ns2, ns2)` vertex of each bound vert.
 */
export function buildCenterNgon(bp: BevelParams, bm: BMesh, bv: BevVert, matNr: number): void {
    const vm = bv.vmesh
    const vv: BMVert[] = []
    const vf: (BMFace | null)[] = []
    const ve: (BMEdge | null)[] = []

    const ns2 = Math.floor(vm.seg / 2)
    let frep: BMFace | null
    let frepE1: BMEdge | null
    let frepE2: BMEdge | null
    let frepUnsnapped: (BoundVert | null)[] = [null, null, null]
    if (bv.anySeam) {
        frep = frepForCenterPoly(bp, bv)
        const inc = getIncidentEdges(frep, bv.v)
        frepE1 = inc[0]
        frepE2 = inc[1]
        frepUnsnapped = findFaceInternalBoundverts(bv, frep)
    } else {
        frep = null
        frepE1 = frepE2 = null
    }
    let v = vm.boundstart!
    do {
        const i = v.index
        vv.push(meshVert(vm, i, ns2, ns2).v!)
        if (frep) {
            vf.push(frep)
            if (v === frepUnsnapped[0] || v === frepUnsnapped[1] || v === frepUnsnapped[2]) {
                ve.push(null)
            } else if (frepE1 && frepE2) {
                ve.push(findCloserEdge(co(meshVert(vm, i, ns2, ns2).v!), frepE1, frepE2))
            } else {
                ve.push(null)
            }
        } else {
            vf.push(boundvertRepFace(v))
            ve.push(null)
        }
        v = v.next
    } while (v !== vm.boundstart)
    const f = bevCreateNgon(bp, bm, vv, vv.length, vf, frep, ve, bv.v, null, matNr, true)
    recordFaceKind(bp, f, FKind.VERT)
}

/** Small helper used by the VMesh builders where Blender writes into a `float *` in place. */
export function copyCo(dst: V3, src: readonly number[]): void {
    copyV3V3(dst, src)
}

/**
 * Wireframe: turn every edge of a surface into a strut of square-ish section.
 *
 * Ported from `source/blender/bmesh/tools/bmesh_wireframe.cc` (`BM_mesh_wireframe`, `:131`), the
 * function both of Blender's entry points call: the edit-mode operator through `bmo_wireframe_exec`
 * (`bmesh/operators/bmo_wireframe.cc:22`, which tags the input faces first) and the Wireframe modifier
 * (`modifiers/intern/MOD_wireframe.cc`, `WireframeModifier_do`, which runs it on every face).
 *
 * How it builds a strut, because the parameters only make sense once this is clear: every vertex of
 * the region is duplicated twice, once each side of the surface along its normal (`verts_neg`,
 * `verts_pos`, `thickness` apart). Every face corner gets one more vertex, inset into its face by half
 * the thickness and sitting midway between the two sides (`verts_loop`). Each face edge then gets two
 * quads joining the corner verts to the two sides, so an edge shared by two faces ends up as a closed
 * tube with a diamond section: `pos`, the inset corner of one face, `neg`, the inset corner of the
 * other. The original faces are removed (`use_replace`) and what is left is the frame.
 *
 * Poke a quad first (`ops/poke.ts`) and its frame is a St Andrew's cross - lattice bracing.
 *
 * Divergences from Blender, all local to this file:
 *
 * - **Normals are recomputed on entry.** Both entry points have current `f->no` and `v->no` - edit
 *   mode keeps them, and the modifier converts with `calc_face_normal` and `calc_vert_normal` set.
 *   Nothing in this kernel maintains them, so {@link normalsUpdate} (`BM_mesh_normals_update`) runs
 *   first, as in `inset.ts` and `bevel.ts`.
 * - **Indices live in maps.** Blender stores array slots in `BM_elem_index_set` and relies on new
 *   faces reading back -1. Maps have that behaviour without clobbering the mesh's lazy indices, the
 *   same choice `inset.ts` makes.
 * - **No vertex-group weighting** (`defgrp_index`, `defgrp_invert`, `offset_fac_vg`): the kernel has no
 *   deform-vertex domain. That path is always off here, which is exactly Blender's behaviour with no
 *   vertex group named.
 */

import {BMesh} from '../bmesh/BMesh'
import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {diskEdgeExists, diskEdges} from '../bmesh/structure'
import {copyElemAttrs, copyElemHeader, setComponent} from '../bmesh/customdata'
import {ElemFlag, AttrName} from '../constants'
import {normalsUpdate} from './bevel-bmquery'
import {
    FLT_EPSILON, V3, addV3V3, addV3V3V3, angleV3V3, angleV3V3V3, compareV3V3, crossV3V3V3, dotV3V3,
    maddV3V3Fl, maddV3V3V3Fl, negateV3, normalizeV3, nv3, subV3V3V3,
} from './bevel-math'

export interface WireframeOptions {
    /** Strut thickness. Blender's `thickness` (operator) / `offset` (modifier). Default 0.01. */
    thickness?: number
    /**
     * Where the struts sit relative to the surface, in `-1..1` - the same factor solidify takes.
     * Blender's `offset` (operator) / `offset_fac` (modifier). Default 0.01, as in `MESH_OT_wireframe`.
     */
    offset?: number
    /** Remove the original faces, leaving only the frame. Blender's `use_replace`. Default true. */
    useReplace?: boolean
    /** Close open boundaries with a strut too. Blender's `use_boundary`. Default true. */
    useBoundary?: boolean
    /** Keep the strut width true at sharp corners. Blender's `use_even_offset`. Default true. */
    useEvenOffset?: boolean
    /** Scale the thickness by local edge length. Blender's `use_relative_offset`. Default false. */
    useRelativeOffset?: boolean
    /** Write `creaseWeight` on the hub edges, for a subdivision surface. Blender's `use_crease`. */
    useCrease?: boolean
    /** Blender's `crease_weight`. Default 0.01. */
    creaseWeight?: number
    /** Added to the material index of every new face, clamped to `materialMax`. Modifier only. */
    materialOffset?: number
    /** Upper clamp for {@link materialOffset}. Blender passes `totcol - 1`. */
    materialMax?: number
}

export interface WireframeResult {
    /** Every face the frame is made of. Blender's `faces.out`. */
    faces: BMFace[]
}

// region math and query helpers

/** `SMALL_NUMBER` from `math_geom_inline.cc:18`. */
const SMALL_NUMBER = 1e-8

/** `shell_angle_to_dist` (`math_geom_inline.cc:129`). */
function shellAngleToDist(angle: number): number {
    return angle < SMALL_NUMBER ? 1 : Math.abs(1 / Math.cos(angle))
}

const co = (v: BMVert): V3 => [v.x, v.y, v.z]
const vno = (v: BMVert): V3 => [v.nx, v.ny, v.nz]
const fno = (f: BMFace): V3 => [f.nx, f.ny, f.nz]

/** `project_plane_normalized_v3_v3v3` (`math_vector.cc:529`). */
function projectPlaneNormalizedV3V3(out: V3, p: readonly number[], vPlane: readonly number[]): void {
    const mul = dotV3V3(p, vPlane)
    maddV3V3V3Fl(out, p, vPlane, -mul)
}

/** `angle_on_axis_v3v3v3_v3` (`math_vector.cc:399`) through `angle_on_axis_v3v3_v3` (`:368`). */
function angleOnAxisV3V3V3V3(v1: V3, v2: V3, v3: V3, axis: V3): number {
    const vec1 = nv3()
    const vec2 = nv3()
    subV3V3V3(vec1, v1, v2)
    subV3V3V3(vec2, v3, v2)
    const v1Proj = nv3()
    const v2Proj = nv3()
    projectPlaneNormalizedV3V3(v1Proj, vec1, axis)
    projectPlaneNormalizedV3V3(v2Proj, vec2, axis)
    return angleV3V3(v1Proj, v2Proj)
}

/** `BM_loop_calc_face_angle` (`bmesh_query.cc:1206`). */
function loopCalcFaceAngle(l: BMLoop): number {
    return angleV3V3V3(co(l.prev.v), co(l.v), co(l.next.v))
}

/**
 * `BM_loop_calc_face_tangent` (`bmesh_query.cc:1313`): the unit direction into the face at a corner,
 * along the corner's bisector, with the concave-corner check.
 */
function loopCalcFaceTangent(l: BMLoop, rTangent: V3): void {
    const vPrev = nv3()
    const vNext = nv3()
    const dir = nv3()
    subV3V3V3(vPrev, co(l.prev.v), co(l.v))
    subV3V3V3(vNext, co(l.v), co(l.next.v))
    normalizeV3(vPrev)
    normalizeV3(vNext)
    addV3V3V3(dir, vPrev, vNext)

    if (!compareV3V3(vPrev, vNext, FLT_EPSILON * 10)) {
        const nor = nv3() // for this purpose doesn't need to be normalized
        crossV3V3V3(nor, vPrev, vNext)
        // concave face check
        if (dotV3V3(nor, fno(l.f)) < 0) negateV3(nor)
        crossV3V3V3(rTangent, dir, nor)
    } else {
        // prev/next are the same - compare with face normal since we don't have one
        crossV3V3V3(rTangent, dir, fno(l.f))
    }
    normalizeV3(rTangent)
}

/**
 * `BM_edge_calc_face_tangent` (`bmesh_query.cc:1398`): perpendicular to the edge, in `eLoop`'s face,
 * pointing into it. Blender's `e` argument only feeds an assertion inside `BM_edge_ordered_verts_ex`
 * (that `eLoop` is on it); the direction comes from the loop, so the edge is not passed here.
 */
function edgeCalcFaceTangent(eLoop: BMLoop, rTangent: V3): void {
    // `BM_edge_ordered_verts_ex`: the loop's own direction along the edge.
    const v1 = eLoop.v
    const v2 = eLoop.next.v
    const tvec = nv3()
    subV3V3V3(tvec, co(v1), co(v2))
    crossV3V3V3(rTangent, tvec, fno(eLoop.f))
    normalizeV3(rTangent)
}

/**
 * `BM_vert_calc_median_tagged_edge_length` (`bmesh_query.cc:1482`). Note the divisor: Blender's
 * `BM_ITER_ELEM_INDEX` counts *every* edge of the vertex, tagged or not, so this is the tagged length
 * averaged over all of them. Kept as written.
 */
function vertCalcMedianTaggedEdgeLength(v: BMVert): number {
    let tot = 0
    let length = 0
    for (const e of diskEdges(v)) {
        const vOther = e.otherVert(v)
        if (vOther.hflag & ElemFlag.Tag) {
            length += Math.hypot(e.v1.x - e.v2.x, e.v1.y - e.v2.y, e.v1.z - e.v2.z)
        }
        tot++
    }
    return tot ? length / tot : 0
}

/** `bm_edge_tag_faceloop` (`bmesh_wireframe.cc:26`): the loop of `e` whose face is tagged. */
function edgeTagFaceloop(e: BMEdge): BMLoop | null {
    const lFirst = e.l
    if (!lFirst) return null
    let l: BMLoop = lFirst
    do {
        if (l.f.hflag & ElemFlag.Tag) return l
        l = l.radialNext!
    } while (l !== lFirst)
    // in the case this is used, we know this will never happen
    return null
}

/**
 * `bm_vert_boundary_tangent` (`bmesh_wireframe.cc:41`): the in-surface direction a boundary vertex
 * insets along, plus the averaged face normal and the two boundary neighbours.
 */
function vertBoundaryTangent(v: BMVert, rNo: V3, rNoFace: V3): {vaOther: BMVert | null, vbOther: BMVert | null} {
    let eA: BMEdge | null = null
    let eB: BMEdge | null = null

    // Get 2 boundary edges, there should only _be_ 2, in case there are more - results won't be valid
    // of course.
    for (const eIter of diskEdges(v)) {
        if (eIter.hflag & ElemFlag.Tag) {
            if (eA === null) {
                eA = eIter
            } else {
                eB = eIter
                break
            }
        }
    }

    const noFace = nv3()
    const noEdge = nv3()
    const tvecA = nv3()
    const tvecB = nv3()
    let vaOther: BMVert | null
    let vbOther: BMVert | null

    if (eA && eB) {
        const lA = edgeTagFaceloop(eA)!
        const lB = edgeTagFaceloop(eB)!

        // average edge face normal
        addV3V3V3(noFace, fno(lA.f), fno(lB.f))
        normalizeV3(noFace)

        // average edge direction
        const vA = eA.otherVert(v)
        const vB = eB.otherVert(v)

        subV3V3V3(tvecA, co(v), co(vA))
        subV3V3V3(tvecB, co(vB), co(v))
        normalizeV3(tvecA)
        normalizeV3(tvecB)
        addV3V3V3(noEdge, tvecA, tvecB) // not unit length but this is ok

        // check are we flipped the right way
        edgeCalcFaceTangent(lA, tvecA)
        edgeCalcFaceTangent(lB, tvecB)
        addV3V3(tvecA, tvecB)

        vaOther = vA
        vbOther = vB
    } else {
        // Degenerate case - vertex connects a boundary edged face to other faces, so we have only one
        // boundary face - only use it for calculations.
        const lA = edgeTagFaceloop(eA!)!
        const f = fno(lA.f)
        noFace[0] = f[0]
        noFace[1] = f[1]
        noFace[2] = f[2]

        // edge direction
        const vA = eA!.otherVert(v)
        subV3V3V3(noEdge, co(v), co(vA))

        // check are we flipped the right way
        edgeCalcFaceTangent(lA, tvecA)

        vaOther = null
        vbOther = null
    }

    // find the normal
    crossV3V3V3(rNo, noEdge, noFace)
    normalizeV3(rNo)
    if (dotV3V3(rNo, tvecA) > 0) negateV3(rNo)

    rNoFace[0] = noFace[0]
    rNoFace[1] = noFace[1]
    rNoFace[2] = noFace[2]
    return {vaOther, vbOther}
}

/** `bm_loop_is_radial_boundary` (`bmesh_wireframe.cc:128`): the only tagged face around this edge. */
function loopIsRadialBoundary(lFirst: BMLoop): boolean {
    let l = lFirst.radialNext!
    if (l === lFirst) return true // a real boundary
    do {
        if (l.f.hflag & ElemFlag.Tag) return false
        l = l.radialNext!
    } while (l !== lFirst)
    return true
}

/** `BM_elem_attrs_copy` for a pair of loops: the corner data plus the header rule. */
function loopAttrsCopy(bm: BMesh, src: BMLoop, dst: BMLoop): void {
    if (src === dst) return
    copyElemAttrs(src, dst, bm.ldata)
    copyElemHeader(src, dst, 'loop')
}

/** `BM_vert_create(bm, co, v_example, BM_CREATE_NOP)`: the example's attributes, header and normal. */
function vertCreateAt(bm: BMesh, c: readonly number[], example: BMVert): BMVert {
    return bm.vertCreate(c[0], c[1], c[2], example)
}

// endregion

/**
 * Make a solid wireframe of `faces`, or of the whole mesh when `faces` is null.
 *
 * With a face list this is `bmo_wireframe_exec` (`bmo_wireframe.cc:22`): edge and face tags are
 * cleared, the listed faces are tagged, and `BM_mesh_wireframe` runs with `use_tag`. With null it is
 * the Wireframe modifier's call (`MOD_wireframe.cc`), every face, no tags.
 */
export function wireframe(bm: BMesh, faces: readonly BMFace[] | null, opts: WireframeOptions = {}): WireframeResult {
    const useTag = faces !== null
    if (useTag) {
        // `BM_mesh_elem_hflag_disable_all(bm, BM_EDGE | BM_FACE, BM_ELEM_TAG, false)`, then tag the slot.
        for (const e of bm.edges) e.hflag &= ~ElemFlag.Tag
        for (const f of bm.faces) f.hflag &= ~ElemFlag.Tag
        for (const f of faces) f.hflag |= ElemFlag.Tag
    } else {
        // `BM_mesh_wireframe`'s precondition: "All edge tags must be cleared."
        for (const e of bm.edges) e.hflag &= ~ElemFlag.Tag
    }

    // See the file header: both of Blender's callers arrive with current normals.
    normalsUpdate(bm)

    meshWireframe(bm, {
        offset: opts.thickness ?? 0.01,
        offsetFac: opts.offset ?? 0.01,
        useReplace: opts.useReplace ?? true,
        useBoundary: opts.useBoundary ?? true,
        useEvenOffset: opts.useEvenOffset ?? true,
        useRelativeOffset: opts.useRelativeOffset ?? false,
        useCrease: opts.useCrease ?? false,
        creaseWeight: opts.creaseWeight ?? 0.01,
        matOffset: opts.materialOffset ?? 0,
        matMax: opts.materialMax ?? Math.max(bm.materials.length - 1, 0),
        useTag,
    })

    // `BMO_slot_buffer_from_enabled_hflag(..., "faces.out", BM_FACE, BM_ELEM_TAG)`.
    const out: BMFace[] = []
    for (const f of bm.faces) if (f.hflag & ElemFlag.Tag) out.push(f)
    return {faces: out}
}

interface MeshWireframeParams {
    offset: number
    offsetFac: number
    useReplace: boolean
    useBoundary: boolean
    useEvenOffset: boolean
    useRelativeOffset: boolean
    useCrease: boolean
    creaseWeight: number
    matOffset: number
    matMax: number
    useTag: boolean
}

/** Port of `BM_mesh_wireframe` (`bmesh_wireframe.cc:131`), minus the vertex-group weighting. */
function meshWireframe(bm: BMesh, p: MeshWireframeParams): void {
    const {offset, offsetFac, useReplace, useBoundary, useEvenOffset, useRelativeOffset, useCrease,
        creaseWeight, matOffset, matMax, useTag} = p

    const ofsOrig = -(((-offsetFac + 1) * 0.5) * offset)
    const ofsNew = offset + ofsOrig
    const ofsMid = (ofsOrig + ofsNew) / 2
    const inset = offset / 2

    const creaseLayer = useCrease ? bm.addLayer('edge', AttrName.creaseEdge, 'float') : null

    // filled only with boundary verts
    const vertsSrc: BMVert[] = [...bm.verts]
    const totvertOrig = vertsSrc.length
    const vertIndex = new Map<BMVert, number>()
    for (let i = 0; i < totvertOrig; i++) {
        vertIndex.set(vertsSrc[i], i)
        vertsSrc[i].hflag &= ~ElemFlag.Tag
    }
    const vertsNeg: (BMVert | null)[] = new Array(totvertOrig).fill(null)
    const vertsPos: (BMVert | null)[] = new Array(totvertOrig).fill(null)
    // Will over-allocate, but makes for easy lookups by index to keep aligned.
    const vertsBoundary: (BMVert | null)[] | null = useBoundary ? new Array(totvertOrig).fill(null) : null
    const vertsRelfac: number[] | null = useRelativeOffset ? new Array(totvertOrig).fill(1) : null

    // Setup tags, all faces and verts will be tagged which will be duplicated. The face list is the
    // original faces; anything created later is Blender's "index -1" and skipped.
    const facesOrig: BMFace[] = [...bm.faces]
    for (const fSrc of facesOrig) {
        if (useTag) {
            if (!(fSrc.hflag & ElemFlag.Tag)) continue
        } else {
            fSrc.hflag |= ElemFlag.Tag
        }
        for (const l of fSrc.eachLoop()) {
            l.v.hflag |= ElemFlag.Tag
            // also tag boundary edges
            l.e!.setFlag(ElemFlag.Tag, loopIsRadialBoundary(l))
        }
    }

    // duplicate tagged verts
    for (let i = 0; i < totvertOrig; i++) {
        const vSrc = vertsSrc[i]
        if (vSrc.hflag & ElemFlag.Tag) {
            let fac = 1
            if (vertsRelfac) {
                vertsRelfac[i] = useRelativeOffset ? vertCalcMedianTaggedEdgeLength(vSrc) : 1
                fac *= vertsRelfac[i]
            }

            const neg = bm.vertCreate(0, 0, 0, vSrc)
            const pos = bm.vertCreate(0, 0, 0, vSrc)
            vertsNeg[i] = neg
            vertsPos[i] = pos
            const c = co(vSrc)
            const n = vno(vSrc)

            if (offset === 0) {
                const a = nv3()
                const b = nv3()
                maddV3V3V3Fl(a, c, n, ofsOrig * fac)
                maddV3V3V3Fl(b, c, n, ofsNew * fac)
                neg.setCo(a[0], a[1], a[2])
                pos.setCo(b[0], b[1], b[2])
            } else {
                const tvec = nv3()
                maddV3V3V3Fl(tvec, c, n, ofsMid * fac)
                const a = nv3()
                const b = nv3()
                maddV3V3V3Fl(a, tvec, n, (ofsOrig - ofsMid) * fac)
                maddV3V3V3Fl(b, tvec, n, (ofsNew - ofsMid) * fac)
                neg.setCo(a[0], a[1], a[2])
                pos.setCo(b[0], b[1], b[2])
            }
        }
        // else: could skip this - Blender writes nullptr, which the fill already holds.

        // conflicts with BM_vert_calc_median_tagged_edge_length
        if (!useRelativeOffset) vSrc.hflag &= ~ElemFlag.Tag
    }

    if (useRelativeOffset) {
        for (const v of bm.verts) v.hflag &= ~ElemFlag.Tag
    }

    // May over-allocate if not all faces have wire.
    const vertsLoop = new Map<BMLoop, BMVert>()
    const tvec = nv3()

    for (const fSrc of facesOrig) {
        if (useTag && !(fSrc.hflag & ElemFlag.Tag)) continue

        for (const l of fSrc.eachLoop()) {
            loopCalcFaceTangent(l, tvec)

            // create offset vert
            let fac = 1
            if (vertsRelfac) fac *= vertsRelfac[vertIndex.get(l.v)!]

            let facShell = fac
            if (useEvenOffset) facShell *= shellAngleToDist((Math.PI - loopCalcFaceAngle(l)) * 0.5)

            const at = nv3()
            maddV3V3V3Fl(at, co(l.v), tvec, inset * facShell)
            if (offset !== 0) maddV3V3Fl(at, vno(l.v), ofsMid * fac)
            vertsLoop.set(l, vertCreateAt(bm, at, l.v))

            if (useBoundary && (l.e!.hflag & ElemFlag.Tag)) { // is this a boundary?
                for (const vBoundary of [l.v, l.next.v]) {
                    if (vBoundary.hflag & ElemFlag.Tag) continue
                    const vBoundaryIndex = vertIndex.get(vBoundary)!
                    vBoundary.hflag |= ElemFlag.Tag

                    const noFace = nv3()
                    const btan = nv3()
                    const {vaOther, vbOther} = vertBoundaryTangent(vBoundary, btan, noFace)

                    // create offset vert - similar to code above but different angle calc
                    let bfac = 1
                    if (vertsRelfac) bfac *= vertsRelfac[vBoundaryIndex]

                    let bfacShell = bfac
                    // for verts with only one boundary edge - this will be null
                    if (useEvenOffset && vaOther) {
                        bfacShell *= shellAngleToDist(
                            (Math.PI - angleOnAxisV3V3V3V3(co(vaOther), co(vBoundary), co(vbOther!), noFace)) * 0.5)
                    }

                    const bat = nv3()
                    maddV3V3V3Fl(bat, co(vBoundary), btan, inset * bfacShell)
                    if (offset !== 0) maddV3V3Fl(bat, vno(vBoundary), ofsMid * bfac)
                    vertsBoundary![vBoundaryIndex] = vertCreateAt(bm, bat, vBoundary)
                }
            }
        }
    }

    const setCrease = (a: BMVert, b: BMVert) => {
        const e = diskEdgeExists(a, b)
        if (e && creaseLayer) setComponent(e, bm.edata, creaseLayer, 0, creaseWeight)
    }
    const applyMatOffset = (f: BMFace) => {
        if (matOffset) f.matNr = Math.min(Math.max(f.matNr + matOffset, 0), matMax)
    }

    for (const fSrc of facesOrig) {
        if (useTag && !(fSrc.hflag & ElemFlag.Tag)) continue

        fSrc.hflag &= ~ElemFlag.Tag

        for (const l of fSrc.loops()) {
            const lNext = l.next
            const vL1 = vertsLoop.get(l)!
            const vL2 = vertsLoop.get(lNext)!

            const i1 = vertIndex.get(l.v)!
            const i2 = vertIndex.get(lNext.v)!

            const vNeg1 = vertsNeg[i1]!
            const vNeg2 = vertsNeg[i2]!
            const vPos1 = vertsPos[i1]!
            const vPos2 = vertsPos[i2]!

            let fNew = bm.faceCreate([vL1, vL2, vNeg2, vNeg1], fSrc)
            applyMatOffset(fNew)
            fNew.hflag |= ElemFlag.Tag
            let lNew = fNew.lFirst
            loopAttrsCopy(bm, l, lNew)
            loopAttrsCopy(bm, l, lNew.prev)
            loopAttrsCopy(bm, lNext, lNew.next)
            loopAttrsCopy(bm, lNext, lNew.next.next)

            fNew = bm.faceCreate([vL2, vL1, vPos1, vPos2], fSrc)
            applyMatOffset(fNew)
            fNew.hflag |= ElemFlag.Tag
            lNew = fNew.lFirst
            loopAttrsCopy(bm, lNext, lNew)
            loopAttrsCopy(bm, lNext, lNew.prev)
            loopAttrsCopy(bm, l, lNew.next)
            loopAttrsCopy(bm, l, lNew.next.next)

            if (useBoundary && (l.e!.hflag & ElemFlag.Tag)) {
                // We know it's a boundary and this is the only face user (which is being wire'd).
                // We know we only touch this edge/face once.
                const vB1 = vertsBoundary![i1]!
                const vB2 = vertsBoundary![i2]!

                fNew = bm.faceCreate([vB2, vB1, vNeg1, vNeg2], fSrc)
                applyMatOffset(fNew)
                fNew.hflag |= ElemFlag.Tag
                lNew = fNew.lFirst
                loopAttrsCopy(bm, lNext, lNew)
                loopAttrsCopy(bm, lNext, lNew.prev)
                loopAttrsCopy(bm, l, lNew.next)
                loopAttrsCopy(bm, l, lNew.next.next)

                fNew = bm.faceCreate([vB1, vB2, vPos2, vPos1], fSrc)
                applyMatOffset(fNew)
                fNew.hflag |= ElemFlag.Tag
                lNew = fNew.lFirst
                loopAttrsCopy(bm, l, lNew)
                loopAttrsCopy(bm, l, lNew.prev)
                loopAttrsCopy(bm, lNext, lNew.next)
                loopAttrsCopy(bm, lNext, lNew.next.next)

                if (useCrease) {
                    setCrease(vPos1, vB1)
                    setCrease(vPos2, vB2)
                    setCrease(vNeg1, vB1)
                    setCrease(vNeg2, vB2)
                }
            }

            if (useCrease) {
                setCrease(vPos1, vL1)
                setCrease(vPos2, vL2)
                setCrease(vNeg1, vL1)
                setCrease(vNeg2, vL2)
            }
        }
    }

    if (useReplace) {
        if (useTag) {
            // Only remove faces which are original and used to make wire, use `verts_pos` and
            // `verts_neg` to avoid a feedback loop.
            const dupeTestOrig = (v: BMVert) => vertsNeg[vertIndex.get(v)!] !== null
            const dupeTest = (v: BMVert) => vertsPos[vertIndex.get(v)!] !== null
            const dupeClear = (v: BMVert) => {
                vertsPos[vertIndex.get(v)!] = null
            }

            // First ensure we keep all verts which are used in faces that weren't entirely made into
            // wire.
            for (const fSrc of facesOrig) {
                if (!bm.faces.has(fSrc)) continue
                let mixFlag = 0
                for (const l of fSrc.eachLoop()) {
                    mixFlag |= dupeTestOrig(l.v) ? 1 : 2
                    if (mixFlag === (1 | 2)) break
                }
                if (mixFlag === (1 | 2)) {
                    for (const l of fSrc.eachLoop()) dupeClear(l.v)
                }
            }

            // now remove any verts which were made into wire by all faces
            for (let i = 0; i < totvertOrig; i++) {
                const vSrc = vertsSrc[i]
                if (dupeTest(vSrc)) bm.vertKill(vSrc)
            }
        } else {
            // simple case, no tags - replace all
            for (let i = 0; i < totvertOrig; i++) bm.vertKill(vertsSrc[i])
        }
    }
}

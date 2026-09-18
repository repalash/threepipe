/**
 * Boundary construction: the cycle of {@link BoundVert}s around one beveled vertex.
 *
 * Ported from `bmesh_bevel.cc:1309-1640` (the "math layer" bookkeeping that picks representative
 * faces), `:2832-3000` (seam and sharp propagation) and `:3182-3762` (`build_boundary` and its two
 * special cases plus the miters).
 *
 * `buildBoundary` runs at least twice per vertex: once with `construct` true, which allocates the
 * BoundVerts and wires up every `leftv`/`rightv`/`ebev`/`eon` pointer and decides the {@link MeshKind}
 * to fill the corner with, and again with `construct` false after clamping or the offset adjustment
 * pass, which only moves the coordinates. That is why nearly every branch below appears twice.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {BMLayerDef} from '../bmesh/customdata'
import {getValue} from '../bmesh/customdata'
import {ElemFlag} from '../constants'
import {
    V4, copyV3V3, distSquaredToPlaneV3, dotV3V3, maddV3V3V3Fl, normalizeV3, nv3,
    planeFromPointNormalV3, subV3V3V3,
} from './bevel-math'
import {
    AngleKind, BEVEL_AFFECT, BEVEL_AMT, BEVEL_EPSILON_BIG, BEVEL_MITER, BEVEL_PROFILE, BEVEL_VMESH,
    BevVert, BevelParams, BoundVert, EdgeHalf, FKind, MeshKind, addNewBoundVert, adjustBoundVert,
    getFaceKind, meshVert, nextBev,
} from './bevel-types'
import {co, edgeLoopPair, edgeOtherVert, faceCalcCenterBounds, fno, loopsOfVert} from './bevel-bmquery'
import {edgesAngleKind, goodOffsetOnEdgeBetween, offsetInPlane, offsetMeet, offsetOnEdgeBetween, slideDist} from './bevel-offset'
import {calculateProfile, moveProfilePlane, setProfileParams} from './bevel-profile'
import {isectLinePlaneV3} from './bevel-math'

// region math layers (`:1309-1570`)

/**
 * The loop layers that `CustomData_layer_has_math` (`customdata.cc:2456`) answers true for: the ones
 * whose type declares `equal`, `add`, `multiply`, `initminmax` and `dominmax`. In Blender's table
 * that is exactly `CD_PROP_FLOAT2` (UVs), `CD_PROP_COLOR`, `CD_PROP_BYTE_COLOR` and
 * `CD_MLOOP_ORIGSPACE`; the kernel has no origspace layer, so the first three remain.
 */
export function layerHasMath(layer: BMLayerDef): boolean {
    return layer.type === 'float2' || layer.type === 'float4' || layer.type === 'byteColor'
}

/**
 * `CustomData_data_equals` (`customdata.cc:2262`) for the math layers, which is not `memcmp`: each of
 * these types supplies its own `equal` callback with a tolerance.
 * - `layerEqual_propfloat2` (`:1425`): squared distance under `1e-5`.
 * - `layerEqual_propcol` (`:1218`) and `layerEqual_mloopcol` (`:838`): squared distance under `1e-3`.
 */
function layerDataEquals(l1: BMLoop, l2: BMLoop, layer: BMLayerDef): boolean {
    const a = getValue(l1, layer)
    const b = getValue(l2, layer)
    let tot = 0
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i]
        tot += d * d
    }
    return layer.type === 'float2' ? tot < 0.00001 : tot < 0.001
}

/** `contig_ldata_across_loops` (`:1309`). */
function contigLdataAcrossLoops(l1: BMLoop, l2: BMLoop, layer: BMLayerDef): boolean {
    return layerDataEquals(l1, l2, layer)
}

/**
 * `contig_ldata_across_edge` (`:1322`) - are all the math layers continuous from `f1` to `f2` across
 * `e`? False as soon as the edge is not manifold, or the two faces disagree about its direction.
 */
export function contigLdataAcrossEdge(bm: BMesh, e: BMEdge, f1: BMFace, f2: BMFace): boolean {
    const mathLayers = bm.ldata.layers.filter(layerHasMath)
    if (bm.ldata.layers.length === 0) return true

    const pair = edgeLoopPair(e)
    if (!pair) return false
    let [lef1, lef2] = pair
    // With faces oriented consistently around e, lef1 and lef2 are f1 and f2 in some order.
    if (lef1.f === f2) {
        const t = lef1; lef1 = lef2; lef2 = t
    }
    if (lef1.f !== f1 || lef2.f !== f2) return false
    if (lef1.v === lef2.v) return false
    const lv1f1 = lef1
    const lv2f1 = lef1.next
    const lv1f2 = lef2.next
    const lv2f2 = lef2
    for (const layer of mathLayers) {
        if (!contigLdataAcrossLoops(lv1f1, lv1f2, layer) ||
            !contigLdataAcrossLoops(lv2f1, lv2f2, layer)) {
            return false
        }
    }
    return true
}

/** `contig_ldata_around_vert` (`:1369`) - every loop around `v` agrees on every math layer. */
export function contigLdataAroundVert(bm: BMesh, v: BMVert): boolean {
    const mathLayers = bm.ldata.layers.filter(layerHasMath)
    if (bm.ldata.layers.length === 0) return true

    let lFirst: BMLoop | null = null
    for (const l of loopsOfVert(v)) {
        if (lFirst === null) {
            lFirst = l
            continue
        }
        for (const layer of mathLayers) {
            if (!contigLdataAcrossLoops(lFirst, l, layer)) return false
        }
    }
    return true
}

/** `swap_face_components` (`:1401`). */
function swapFaceComponents(faceComponent: Int32Array, totface: number, c1: number, c2: number): void {
    if (c1 === c2) return
    for (let f = 0; f < totface; f++) {
        if (faceComponent[f] === c1) faceComponent[f] = c2
        else if (faceComponent[f] === c2) faceComponent[f] = c1
    }
}

/**
 * `math_layer_info_init` (`:1442`) - label every face with the connected component it belongs to in
 * UV space.
 *
 * Only needed for an odd segment count, because only then is there a centre segment that could
 * arbitrarily take either adjacent face's data. The final swap so that components 0 and 1 are the
 * topmost and bottom-most faces is Blender's, and it exists purely so that the arbitrary choice
 * lands the same way for symmetric geometry.
 */
export function mathLayerInfoInit(bp: BevelParams, bm: BMesh): void {
    bp.mathLayerInfo.hasMathLayers = false
    bp.mathLayerInfo.faceComponent = null
    for (const layer of bm.ldata.layers) {
        if (layer.type === 'float2') {
            bp.mathLayerInfo.hasMathLayers = true
            break
        }
    }
    if (!bp.mathLayerInfo.hasMathLayers || bp.seg % 2 === 0) {
        return
    }

    bm.elemIndexEnsure()
    const faces = [...bm.faces]
    const totface = faces.length
    const faceComponent = new Int32Array(totface).fill(-1)
    bp.mathLayerInfo.faceComponent = faceComponent

    const stack: BMFace[] = new Array(totface)
    const inStack: boolean[] = new Array(totface).fill(false)

    let currentComponent = -1
    for (let f = 0; f < totface; f++) {
        if (faceComponent[f] === -1 && !inStack[f]) {
            let stackTop = 0
            currentComponent++
            stack[stackTop] = faces[f]
            inStack[f] = true
            while (stackTop >= 0) {
                const bmf = stack[stackTop]
                stackTop--
                const bmfIndex = bmf.index
                inStack[bmfIndex] = false
                if (faceComponent[bmfIndex] !== -1) continue
                faceComponent[bmfIndex] = currentComponent
                /* Neighbours are faces sharing an edge with bmf across which every math layer is
                 * contiguous. */
                for (const bme of bmf.edges()) {
                    for (const lOther of [...(bme.l ? radialLoopList(bme) : [])]) {
                        const bmfOther = lOther.f
                        if (bmfOther === bmf) continue
                        const otherIndex = bmfOther.index
                        if (faceComponent[otherIndex] !== -1 || inStack[otherIndex]) continue
                        if (contigLdataAcrossEdge(bm, bme, bmf, bmfOther)) {
                            stackTop++
                            stack[stackTop] = bmfOther
                            inStack[otherIndex] = true
                        }
                    }
                }
            }
        }
    }

    /* Components 0 and 1 are made the topmost and bottom-most (in z) components, which usually
     * gives a more pleasing result. */
    if (currentComponent <= 0) {
        return
    }
    let topFaceZ = -1e30
    let topFaceComponent = -1
    let botFaceZ = 1e30
    let botFaceComponent = -1
    const cent = nv3()
    for (let f = 0; f < totface; f++) {
        faceCalcCenterBounds(faces[f], cent)
        const fz = cent[2]
        if (fz > topFaceZ) {
            topFaceZ = fz
            topFaceComponent = faceComponent[f]
        }
        if (fz < botFaceZ) {
            botFaceZ = fz
            botFaceComponent = faceComponent[f]
        }
    }
    swapFaceComponents(faceComponent, totface, faceComponent[0], topFaceComponent)
    if (botFaceComponent !== topFaceComponent) {
        if (botFaceComponent === 0) {
            // It was swapped with the old topFaceComponent.
            botFaceComponent = topFaceComponent
        }
        swapFaceComponents(faceComponent, totface, faceComponent[1], botFaceComponent)
    }
}

function* radialLoopList(e: BMEdge): Generator<BMLoop> {
    const lFirst = e.l
    if (!lFirst) return
    let l: BMLoop = lFirst
    do {
        yield l
        l = l.radialNext!
    } while (l !== lFirst)
}

/**
 * `choose_rep_face` (`:1572`) - a deterministic tie-break between equally valid representative faces.
 *
 * With an odd number of segments the centre segment can belong to either neighbouring face, and for
 * the centre polygon of a corner *every* adjacent face is a candidate. Choosing at random makes UV
 * maps and material assignments look inconsistent between two identical corners, so Blender ranks
 * candidates by six values in order - UV component id, selected before unselected, lower material
 * index, then the z, x and y of the bounding-box centre - and takes the first unique minimum.
 */
export function chooseRepFace(bp: BevelParams, face: (BMFace | null)[], nfaces: number): BMFace | null {
    const VEC_VALUE_LEN = 6
    const valueVecs: number[][] = new Array(nfaces)
    const stillViable: boolean[] = new Array(nfaces).fill(false)
    let numViable = 0

    for (let f = 0; f < nfaces; f++) {
        const bmf = face[f]
        if (bmf === null) {
            stillViable[f] = false
            valueVecs[f] = new Array(VEC_VALUE_LEN).fill(0)
            continue
        }
        stillViable[f] = true
        numViable++
        const vec: number[] = []
        vec.push(bp.mathLayerInfo.faceComponent ? bp.mathLayerInfo.faceComponent[bmf.index] : 0)
        vec.push(bmf.testFlag(ElemFlag.Select) ? 0 : 1)
        vec.push(bmf.matNr >= 0 ? bmf.matNr : 0)
        const cent = nv3()
        faceCalcCenterBounds(bmf, cent)
        vec.push(cent[2])
        vec.push(cent[0])
        vec.push(cent[1])
        valueVecs[f] = vec
    }

    let bestF = -1
    for (let valueIndex = 0; numViable > 1 && valueIndex < VEC_VALUE_LEN; valueIndex++) {
        for (let f = 0; f < nfaces; f++) {
            if (!stillViable[f] || f === bestF) continue
            if (bestF === -1) {
                bestF = f
                continue
            }
            if (valueVecs[f][valueIndex] < valueVecs[bestF][valueIndex]) {
                bestF = f
                // The earlier candidates are no longer viable.
                for (let i = f - 1; i >= 0; i--) {
                    if (stillViable[i]) {
                        stillViable[i] = false
                        numViable--
                    }
                }
            } else if (valueVecs[f][valueIndex] > valueVecs[bestF][valueIndex]) {
                stillViable[f] = false
                numViable--
            }
        }
    }
    if (bestF === -1) bestF = 0
    return face[bestF]
}

// endregion

// region seam and sharp propagation (`:2832-3000`)

/**
 * `HASNOT_SEAMSHARP` (`:2848`). The sharp test is the negation of the smooth flag, which is why the
 * two cases read the opposite way round.
 */
function hasnotSeamsharp(eh: EdgeHalf, flag: number): boolean {
    if (flag === ElemFlag.Seam) return !eh.e.testFlag(ElemFlag.Seam)
    return eh.e.testFlag(ElemFlag.Smooth)
}

/**
 * `check_edge_data_seam_sharp_edges` (`:2851`) - for each beveled edge that *has* a seam (or sharp),
 * count how many beveled edges follow it that do not, and store the count on its right bound vert.
 *
 * Without this, a seam that runs into a bevel stops at the bevel: the outer edges of one beveled
 * edge inherit its flags, but nothing carries the seam across the corner to the next edge that has
 * one. Blender's own TODO records that this does not work for terminal edges or miters.
 */
export function checkEdgeDataSeamSharpEdges(bv: BevVert, flag: number): void {
    let e = bv.edges[0]
    let efirst = bv.edges[0]

    // Get to the first edge carrying the flag.
    while (hasnotSeamsharp(e, flag)) {
        e = e.next
        if (e === efirst) break
    }

    if (hasnotSeamsharp(e, flag)) {
        return
    }

    efirst = e

    do {
        let flagCount = 0
        let ne = e.next

        while (hasnotSeamsharp(ne, flag) && ne !== efirst) {
            if (ne.isBev) flagCount++
            ne = ne.next
        }
        if (ne === e || (ne === efirst && hasnotSeamsharp(efirst, flag))) {
            break
        }
        if (flag === ElemFlag.Seam) {
            e.rightv!.seamLen = flagCount
        } else if (flag === ElemFlag.Smooth) {
            e.rightv!.sharpLen = flagCount
        }
        e = ne
    } while (e !== efirst)
}

/** `set_bound_vert_seams` (`:3183`). */
export function setBoundVertSeams(bv: BevVert, markSeam: boolean, markSharp: boolean): void {
    bv.anySeam = false
    let v = bv.vmesh.boundstart!
    do {
        v.anySeam = false
        for (let e: EdgeHalf | null = v.efirst; e; e = e.next) {
            v.anySeam = v.anySeam || e.isSeam
            if (e === v.elast) break
        }
        bv.anySeam = bv.anySeam || v.anySeam
        v = v.next
    } while (v !== bv.vmesh.boundstart)

    if (markSeam) {
        checkEdgeDataSeamSharpEdges(bv, ElemFlag.Seam)
    }
    if (markSharp) {
        checkEdgeDataSeamSharpEdges(bv, ElemFlag.Smooth)
    }
}

/**
 * `bevel_extend_edge_data_ex` (`:2899`) - walk the outer ring of the vmesh and set the seam or sharp
 * flag on every segment edge for the run recorded by {@link checkEdgeDataSeamSharpEdges}.
 */
function bevelExtendEdgeDataEx(bv: BevVert, flag: number): void {
    const vm = bv.vmesh

    let bcur = vm.boundstart!
    let start = bcur

    do {
        const extendLen = flag === ElemFlag.Seam ? bcur.seamLen : bcur.sharpLen
        if (extendLen) {
            if (!vm.boundstart!.seamLen && start === vm.boundstart) {
                start = bcur // The first bound vert with a run.
            }

            const idxEnd = bcur.index + extendLen
            for (let i = bcur.index; i < idxEnd; i++) {
                let v1 = meshVert(vm, i % vm.count, 0, 0).v!
                let e: BMEdge
                for (let k = 1; k < vm.seg; k++) {
                    const v2 = meshVert(vm, i % vm.count, 0, k).v!
                    // Find the edge shared by the current and next vertex and flag it.
                    e = v1.e!
                    while (e.v1 !== v2 && e.v2 !== v2) {
                        e = e.diskNext(v1)!
                    }
                    if (flag === ElemFlag.Seam) {
                        e.setFlag(ElemFlag.Seam, true)
                    } else {
                        e.setFlag(ElemFlag.Smooth, false)
                    }
                    v1 = v2
                }
                const v3 = meshVert(vm, (i + 1) % vm.count, 0, 0).v!
                e = v1.e!
                while (e.v1 !== v3 && e.v2 !== v3) {
                    e = e.diskNext(v1)!
                }
                if (flag === ElemFlag.Seam) {
                    e.setFlag(ElemFlag.Seam, true)
                } else {
                    e.setFlag(ElemFlag.Smooth, false)
                }
                bcur = bcur.next
            }
        } else {
            bcur = bcur.next
        }
    } while (bcur !== start)
}

/** `bevel_extend_edge_data` (`:2958`). */
export function bevelExtendEdgeData(bv: BevVert): void {
    const vm = bv.vmesh
    if (vm.meshKind === MeshKind.TRI_FAN || bv.selcount < 2) {
        return
    }
    bevelExtendEdgeDataEx(bv, ElemFlag.Seam)
    bevelExtendEdgeDataEx(bv, ElemFlag.Smooth)
}

/**
 * `bevel_edges_sharp_boundary` (`:2971`) - mark an edge sharp when it runs between a smooth
 * reconstructed face and one of the new bevel faces.
 *
 * Note this is a no-op on the kernel's default output, because `faceCreate` leaves a new face flat
 * (`f->head.hflag = 0`, `bmesh_core.cc:493`) and this only considers smooth ones.
 */
export function bevelEdgesSharpBoundary(bm: BMesh, bp: BevelParams): void {
    for (const f of bm.faces) {
        if (!f.testFlag(ElemFlag.Smooth)) continue
        if (getFaceKind(bp, f) !== FKind.RECON) continue
        for (const l of f.eachLoop()) {
            // The cases we care about have exactly one adjacent face.
            const lother = l.radialNext
            if (lother && lother !== l && lother.f) {
                const fkind = getFaceKind(bp, lother.f)
                if (fkind === FKind.EDGE || fkind === FKind.VERT) {
                    l.e!.setFlag(ElemFlag.Smooth, false)
                }
            }
        }
    }
}

// endregion

// region build_boundary (`:3207-3762`)

/** `eh_on_plane` (`:3207`) - is `e` between two faces whose normals are 180 degrees apart? */
export function ehOnPlane(e: EdgeHalf): boolean {
    if (e.fprev && e.fnext) {
        const dot = dotV3V3(fno(e.fprev), fno(e.fnext))
        if (Math.abs(dot + 1.0) <= BEVEL_EPSILON_BIG || Math.abs(dot - 1.0) <= BEVEL_EPSILON_BIG) {
            return true
        }
    }
    return false
}

/**
 * `calculate_vm_profiles` (`:3224`) - fill in every bound vert's profile.
 *
 * Must run exactly once per BevVert, after every change to the profile parameters, which is why
 * `specialParams` exists: the miter and terminal-edge paths have already chosen a plane by hand and
 * must not have it recomputed.
 */
export function calculateVmProfiles(bp: BevelParams, bv: BevVert, vm = bv.vmesh): void {
    let bndv = vm.boundstart!
    do {
        if (!bndv.profile.specialParams) {
            setProfileParams(bp, bv, bndv)
        }
        let miterProfile = false
        let reverseProfile = false
        if (bp.profileType === BEVEL_PROFILE.CUSTOM) {
            // Only a custom profile is asymmetric, so only then does the direction matter.
            miterProfile = bndv.isArcStart || bndv.isPatchStart
            reverseProfile = !bndv.isProfileStart && !miterProfile
        }
        calculateProfile(bp, bndv, reverseProfile, miterProfile)
        bndv = bndv.next
    } while (bndv !== vm.boundstart)
}

/** `build_boundary_vertex_only` (`:3245`) - every edge simply slides back by its own offset. */
function buildBoundaryVertexOnly(bp: BevelParams, bv: BevVert, construct: boolean, bm: BMesh): void {
    const vm = bv.vmesh

    const efirst = bv.edges[0]
    let e = efirst
    do {
        const coV = nv3()
        slideDist(e, bv.v, e.offsetL, coV)
        if (construct) {
            const v = addNewBoundVert(vm, coV)
            v.efirst = v.elast = e
            e.leftv = e.rightv = v
        } else {
            adjustBoundVert(e.leftv!, coV)
        }
        e = e.next
    } while (e !== efirst)

    if (construct) {
        setBoundVertSeams(bv, bp.markSeam, bp.markSharp)
        // Also check for seams at the vertex itself.
        if (bp.affectVerticesOdd) {
            if (!bv.anySeam && !contigLdataAroundVert(bm, bv.v)) {
                bv.anySeam = true
            }
        }
        if (vm.count === 2) {
            vm.meshKind = MeshKind.NONE
        } else if (bp.seg === 1) {
            vm.meshKind = MeshKind.POLY
        } else {
            vm.meshKind = MeshKind.ADJ
        }
    }
}

/**
 * `build_boundary_terminal_edge` (`:3291`) - one beveled edge arriving at this vertex.
 *
 * With exactly two edges in, the bevel is terminated with an artificial third point slid along the
 * unbeveled edge, making a triangle. With more edges in, every other edge gets an on-edge vertex.
 * The `sqrt(2)` on `d` is Blender's: a concave profile needs more room along the edge than its
 * nominal offset or the profile area does not fit.
 */
function buildBoundaryTerminalEdge(
    bp: BevelParams, bv: BevVert, efirst: EdgeHalf, construct: boolean,
): void {
    const vm = bv.vmesh

    let e = efirst
    const coV = nv3()
    if (bv.edgecount === 2) {
        /* Only 2 edges in, so terminate the edge with an artificial vertex on the unbeveled edge.
         * For PERCENT / ABSOLUTE there are not two legs so the result is a bit undefined; Blender
         * just lets the code do what it does. */
        let no = e.fprev ? fno(e.fprev) : (e.fnext ? fno(e.fnext) : null)
        offsetInPlane(e, no, true, coV)
        if (construct) {
            const bndv = addNewBoundVert(vm, coV)
            bndv.efirst = bndv.elast = bndv.ebev = e
            e.leftv = bndv
        } else {
            adjustBoundVert(e.leftv!, coV)
        }
        no = e.fnext ? fno(e.fnext) : (e.fprev ? fno(e.fprev) : null)
        offsetInPlane(e, no, false, coV)
        if (construct) {
            const bndv = addNewBoundVert(vm, coV)
            bndv.efirst = bndv.elast = e
            e.rightv = bndv
        } else {
            adjustBoundVert(e.rightv!, coV)
        }
        // An artificial extra point along the unbeveled edge, forming a triangle.
        slideDist(e.next, bv.v, e.offsetL, coV)
        if (construct) {
            const bndv = addNewBoundVert(vm, coV)
            bndv.efirst = bndv.elast = e.next
            e.next.leftv = e.next.rightv = bndv
            setBoundVertSeams(bv, bp.markSeam, bp.markSharp)
        } else {
            adjustBoundVert(e.next.leftv!, coV)
        }
    } else {
        /* More than 2 edges in. Put on-edge verts on all the other edges and join with the beveled
         * edge to make a poly or adj mesh. Because `e->prev` has offset 0, `offsetMeet` puts the
         * point on that edge. */
        const legSlide = bp.offsetType === BEVEL_AMT.PERCENT || bp.offsetType === BEVEL_AMT.ABSOLUTE
        if (legSlide) {
            slideDist(e.prev, bv.v, e.offsetL, coV)
        } else {
            offsetMeet(bp, e.prev, e, bv.v, e.fprev, false, coV, null)
        }
        if (construct) {
            const bndv = addNewBoundVert(vm, coV)
            bndv.efirst = e.prev
            bndv.elast = bndv.ebev = e
            e.leftv = bndv
            e.prev.leftv = e.prev.rightv = bndv
        } else {
            adjustBoundVert(e.leftv!, coV)
        }
        e = e.next
        if (legSlide) {
            slideDist(e, bv.v, e.prev.offsetR, coV)
        } else {
            offsetMeet(bp, e.prev, e, bv.v, e.fprev, false, coV, null)
        }
        if (construct) {
            const bndv = addNewBoundVert(vm, coV)
            bndv.efirst = e.prev
            bndv.elast = e
            e.leftv = e.rightv = bndv
            e.prev.rightv = bndv
        } else {
            adjustBoundVert(e.leftv!, coV)
        }
        // For the edges not adjacent to the beveled edge, slide the bevel amount along.
        let d = efirst.offsetLSpec
        if (bp.profileType === BEVEL_PROFILE.CUSTOM || bp.profile < 0.25) {
            d *= Math.sqrt(2.0) // Go further along the edge to make room for the full profile area.
        }
        for (e = e.next; e.next !== efirst; e = e.next) {
            slideDist(e, bv.v, d, coV)
            if (construct) {
                const bndv = addNewBoundVert(vm, coV)
                bndv.efirst = bndv.elast = e
                e.leftv = e.rightv = bndv
            } else {
                adjustBoundVert(e.leftv!, coV)
            }
        }
    }

    if (bv.edgecount >= 3) {
        // Special case: snap the profile to the plane of the two adjacent edges.
        const bndv = vm.boundstart!
        setProfileParams(bp, bv, bndv)
        moveProfilePlane(bndv, bv.v)
    }

    if (construct) {
        setBoundVertSeams(bv, bp.markSeam, bp.markSharp)

        if (vm.count === 2 && bv.edgecount === 3) {
            vm.meshKind = MeshKind.NONE
        } else if (vm.count === 3) {
            let useTriFan = true
            if (bp.profileType === BEVEL_PROFILE.CUSTOM) {
                // Prevent overhanging edges: use POLY when the extra point is planar with the profile.
                let bndv = efirst.leftv!
                const profilePlane: V4 = [0, 0, 0, 0]
                planeFromPointNormalV3(profilePlane, bndv.profile.planeCo, bndv.profile.planeNo)
                bndv = efirst.rightv!.next // The bound vert added along the non-adjacent edge.
                if (distSquaredToPlaneV3(bndv.nv.co, profilePlane) < BEVEL_EPSILON_BIG) {
                    useTriFan = false
                }
            }
            vm.meshKind = useTriFan ? MeshKind.TRI_FAN : MeshKind.POLY
        } else {
            vm.meshKind = MeshKind.POLY
        }
    }
}

/**
 * `adjust_miter_coords` (`:3429`) - pull the two (or three) coincident miter bound verts apart.
 *
 * The outer miter bound verts are all created at the same coordinate in {@link buildBoundary}; this
 * moves the first and last of them out along the miter edge until they hit the plane through their
 * neighbour, which is what makes a patch or arc miter instead of a sharp point.
 */
export function adjustMiterCoords(bp: BevelParams, bv: BevVert, emiter: EdgeHalf): void {
    const miterOuter = bp.miterOuter

    const v1 = emiter.rightv!
    let v3: BoundVert
    if (miterOuter === BEVEL_MITER.PATCH) {
        const v2 = v1.next
        v3 = v2.next
    } else {
        v3 = v1.next
    }
    const v1prev = v1.prev
    const v3next = v3.next
    const co2 = nv3()
    copyV3V3(co2, v1.nv.co)
    if (v1.isArcStart) {
        copyV3V3(v1.profile.middle, co2)
    }

    /* co1 is the intersection of the line through co2 along emiter's direction with the plane whose
     * normal is that direction and which passes through v1prev. */
    const co1 = nv3()
    const edgeDir = nv3()
    const lineP = nv3()
    let vother = edgeOtherVert(emiter.e, bv.v)
    subV3V3V3(edgeDir, co(bv.v), co(vother))
    normalizeV3(edgeDir)
    const d = bp.offset / (bp.seg / 2.0) // A fallback amount to move.
    maddV3V3V3Fl(lineP, co2, edgeDir, d)
    if (!isectLinePlaneV3(co1, co2, lineP, v1prev.nv.co, edgeDir)) {
        copyV3V3(co1, lineP)
    }
    adjustBoundVert(v1, co1)

    // co3 is the same, with the plane through v3next and the line on the other side of the miter edge.
    const co3 = nv3()
    const emiterOther = v3.elast!
    vother = edgeOtherVert(emiterOther.e, bv.v)
    subV3V3V3(edgeDir, co(bv.v), co(vother))
    normalizeV3(edgeDir)
    maddV3V3V3Fl(lineP, co2, edgeDir, d)
    if (!isectLinePlaneV3(co3, co2, lineP, v3next.nv.co, edgeDir)) {
        // Blender writes `co1` here, not `co3`. Kept: changing it would change the fallback result
        // on the degenerate parallel case, and this is the shipped behaviour.
        copyV3V3(co1, lineP)
    }
    adjustBoundVert(v3, co3)
}

/** `adjust_miter_inner_coords` (`:3478`) - spread the inner miter arcs apart by `bp.spread`. */
export function adjustMiterInnerCoords(bp: BevelParams, bv: BevVert, emiter: EdgeHalf | null): void {
    const vstart = bv.vmesh.boundstart!
    let v = vstart
    do {
        if (v.isArcStart) {
            const v3 = v.next
            let e = v.efirst!
            if (e !== emiter) {
                const edgeDir = nv3()
                const coV = nv3()
                copyV3V3(coV, v.nv.co)
                let vother = edgeOtherVert(e.e, bv.v)
                subV3V3V3(edgeDir, co(vother), co(bv.v))
                normalizeV3(edgeDir)
                maddV3V3V3Fl(v.nv.co, coV, edgeDir, bp.spread)
                e = v3.elast!
                vother = edgeOtherVert(e.e, bv.v)
                subV3V3V3(edgeDir, co(vother), co(bv.v))
                normalizeV3(edgeDir)
                maddV3V3V3Fl(v3.nv.co, coV, edgeDir, bp.spread)
            }
            v = v3.next
        } else {
            v = v.next
        }
    } while (v !== vstart)
}

/**
 * `build_boundary` (`:3521`) - the cyclic list of BoundVerts for `bv`.
 *
 * Walks from one beveled edge to the next. Between them the edges are classified as "in plane" (the
 * faces either side are coplanar, so they do not affect the silhouette) or not; with `loopSlide` on
 * and exactly one of either kind, the boundary point is placed *on* that edge rather than where the
 * two offset lines meet, which is what keeps a bevel following an existing edge loop.
 *
 * @param construct first pass: make the BoundVerts, wire the pointers, and choose the mesh kind.
 *   Later passes only move the coordinates.
 */
export function buildBoundary(bp: BevelParams, bv: BevVert, construct: boolean, bm: BMesh): void {
    // The current bevel does nothing when only one edge arrives at a vertex.
    if (bv.edgecount <= 1) {
        return
    }

    if (bp.affectType === BEVEL_AFFECT.VERTICES) {
        buildBoundaryVertexOnly(bp, bv, construct, bm)
        return
    }

    const vm = bv.vmesh

    const efirst = nextBev(bv, null)!

    if (bv.selcount === 1) {
        // Special case: only one beveled edge in.
        buildBoundaryTerminalEdge(bp, bv, efirst, construct)
        return
    }

    // Special outer miters only for three or more beveled edges.
    const miterOuter = bv.selcount >= 3 ? bp.miterOuter : BEVEL_MITER.SHARP
    const miterInner = bp.miterInner

    // The first beveled edge of an outside miter; there can be at most one per BevVert.
    let emiter: EdgeHalf | null = null

    let e = efirst
    do {
        let eon: EdgeHalf | null = null
        /* Make the BoundVert for the right side of e; the other side is made when the beveled edge
         * to the left of e is handled. Analyse the edges up to the next beveled edge: they are
         * either "in plane" or not, and we prefer to slide along a not-in-plane one. */
        let inPlane = 0
        let notInPlane = 0
        let enip: EdgeHalf | null = null
        let eip: EdgeHalf | null = null
        let e2: EdgeHalf
        for (e2 = e.next; !e2.isBev; e2 = e2.next) {
            if (ehOnPlane(e2)) {
                inPlane++
                eip = e2
            } else {
                notInPlane++
                enip = e2
            }
        }

        const coV = nv3()
        const rRef = {value: 1.0}
        if (inPlane === 0 && notInPlane === 0) {
            offsetMeet(bp, e, e2, bv.v, e.fnext, false, coV, null)
        } else if (notInPlane > 0) {
            if (bp.loopSlide && notInPlane === 1 && goodOffsetOnEdgeBetween(e, e2, enip!, bv.v)) {
                if (offsetOnEdgeBetween(bp, e, e2, enip!, bv.v, coV, rRef)) {
                    eon = enip
                }
            } else {
                offsetMeet(bp, e, e2, bv.v, null, true, coV, eip)
            }
        } else {
            // inPlane > 0 and notInPlane == 0.
            if (bp.loopSlide && inPlane === 1 && goodOffsetOnEdgeBetween(e, e2, eip!, bv.v)) {
                if (offsetOnEdgeBetween(bp, e, e2, eip!, bv.v, coV, rRef)) {
                    eon = eip
                }
            } else {
                /* All the edges between e and e2 are in the same plane, so this can be treated like
                 * the case where there are none. */
                offsetMeet(bp, e, e2, bv.v, e.fnext, false, coV, null)
            }
        }

        if (construct) {
            const v = addNewBoundVert(vm, coV)
            v.efirst = e
            v.elast = e2
            v.ebev = e2
            v.eon = eon
            if (eon) {
                v.sinratio = rRef.value
            }
            e.rightv = v
            e2.leftv = v
            for (let e3 = e.next; e3 !== e2; e3 = e3.next) {
                e3.leftv = e3.rightv = v
            }
            const angKind = edgesAngleKind(e, e2, bv.v)

            /* Special mitering. There can only be one outer reflex angle, so only one outer miter,
             * and `emiter` is set to the first edge of it. `BEVEL_MITER.SHARP` means no special
             * miter at all. */
            if ((miterOuter !== BEVEL_MITER.SHARP && !emiter && angKind === AngleKind.LARGER) ||
                (miterInner !== BEVEL_MITER.SHARP && angKind === AngleKind.SMALLER)) {
                if (angKind === AngleKind.LARGER) {
                    emiter = e
                }
                // One or two more bound verts; for now they all share the same coordinate.
                const v1 = v
                v1.ebev = null
                let v2: BoundVert | null
                if (angKind === AngleKind.LARGER && miterOuter === BEVEL_MITER.PATCH) {
                    v2 = addNewBoundVert(vm, coV)
                } else {
                    v2 = null
                }
                const v3 = addNewBoundVert(vm, coV)
                v3.ebev = e2
                v3.efirst = e2
                v3.elast = e2
                v3.eon = null
                e2.leftv = v3
                if (angKind === AngleKind.LARGER && miterOuter === BEVEL_MITER.PATCH) {
                    v1.isPatchStart = true
                    v2!.eon = v1.eon
                    v2!.sinratio = v1.sinratio
                    v2!.ebev = null
                    v1.eon = null
                    v1.sinratio = 1.0
                    v1.elast = e
                    if (e.next === e2) {
                        v2!.efirst = null
                        v2!.elast = null
                    } else {
                        v2!.efirst = e.next
                        for (let e3 = e.next; e3 !== e2; e3 = e3.next) {
                            e3.leftv = e3.rightv = v2
                            v2!.elast = e3
                        }
                    }
                } else {
                    v1.isArcStart = true
                    copyV3V3(v1.profile.middle, coV)
                    if (e.next === e2) {
                        v1.elast = v1.efirst
                    } else {
                        const between = inPlane + notInPlane
                        const bet2 = Math.floor(between / 2)
                        const betodd = between % 2 === 1
                        let i = 0
                        /* First half of the in-between edges attach at profile index 0, second half
                         * at index `seg`; an odd one out attaches at the middle. */
                        for (let e3 = e.next; e3 !== e2; e3 = e3.next) {
                            v1.elast = e3
                            if (i < bet2) {
                                e3.profileIndex = 0
                            } else if (betodd && i === bet2) {
                                e3.profileIndex = Math.floor(bp.seg / 2)
                            } else {
                                e3.profileIndex = bp.seg
                            }
                            i++
                        }
                    }
                }
            }
        } else {
            const angKind = edgesAngleKind(e, e2, bv.v)
            if ((miterOuter !== BEVEL_MITER.SHARP && !emiter && angKind === AngleKind.LARGER) ||
                (miterInner !== BEVEL_MITER.SHARP && angKind === AngleKind.SMALLER)) {
                if (angKind === AngleKind.LARGER) {
                    emiter = e
                }
                const v1 = e.rightv!
                let v2: BoundVert | null
                let v3: BoundVert
                if (angKind === AngleKind.LARGER && miterOuter === BEVEL_MITER.PATCH) {
                    v2 = v1.next
                    v3 = v2.next
                } else {
                    v2 = null
                    v3 = v1.next
                }
                adjustBoundVert(v1, coV)
                if (v2) {
                    adjustBoundVert(v2, coV)
                }
                adjustBoundVert(v3, coV)
            } else {
                adjustBoundVert(e.rightv!, coV)
            }
        }
        e = e2
    } while (e !== efirst)

    if (miterInner !== BEVEL_MITER.SHARP) {
        adjustMiterInnerCoords(bp, bv, emiter)
    }
    if (emiter) {
        adjustMiterCoords(bp, bv, emiter)
    }

    if (construct) {
        setBoundVertSeams(bv, bp.markSeam, bp.markSharp)

        if (vm.count === 2) {
            vm.meshKind = MeshKind.NONE
        } else if (efirst.seg === 1) {
            vm.meshKind = MeshKind.POLY
        } else {
            switch (bp.vmeshMethod) {
            case BEVEL_VMESH.ADJ:
                vm.meshKind = MeshKind.ADJ
                break
            case BEVEL_VMESH.CUTOFF:
                vm.meshKind = MeshKind.CUTOFF
                break
            }
        }
    }
}

// endregion

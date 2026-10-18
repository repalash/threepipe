/**
 * The vertex mesh: the patch of geometry that replaces one beveled vertex, bounded by the profiles.
 *
 * Ported from `bmesh_bevel.cc:4347-6580`.
 *
 * The general construction (`M_ADJ`, {@link adjVmesh}) is a Catmull-Clark surface. It starts from a
 * two-segment control mesh whose boundary is the bound verts with one profile sample between each
 * pair, and whose single interior point is placed a "fullness" fraction of the way from the bound
 * verts' centroid towards the original vertex. {@link cubicSubdiv} then doubles the segment count
 * until it reaches or passes the requested one, with the boundary re-sampled from the true profile
 * at every step, and {@link interpVmesh} resamples down when the target is not a power of two. The
 * centre vertex gets the Sabin modification of Catmull-Clark for an n-sided hole, which is what
 * `sabinGamma` is.
 *
 * Four special cases short-circuit all of that because the general surface gets them visibly wrong:
 * a cube corner with a square profile ({@link makeCubeCornerSquare}), an inward square profile
 * ({@link makeCubeCornerSquareIn}), a three-edge corner at right angles ({@link triCornerAdjVmesh},
 * which builds the sphere octant and maps it through a unit-cube map), and a "pipe" - three or four
 * beveled edges with two of them collinear ({@link pipeAdjVmesh}), where the interior is snapped
 * onto the profile of the pipe rather than left as a subdivision surface.
 *
 * Indexing throughout is `(i, j, k)`: `i` the bound vert, `j` the ring (0 at the boundary, `ns2` at
 * the centre) and `k` the segment along the profile. Many slots are shared between neighbouring `i`,
 * and {@link meshVertCanon} maps any triple to the one slot that owns it.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {splitFaceMakeEdge} from '../bmesh/euler'
import {
    M4, V4, addV3V3, addV3V3V3, angleNormalizedV3V3, angleV3V3V3, closestToLineSegmentV3,
    closestToPlaneV3, compareFf, compareV3V3, copyV3Fl, copyV3V3, crossV3V3V3, dotV3V3,
    interpBilinearQuadV3, interpV3V3V3, invertM4M4, isectLineLineV3, lenSquaredV3, lenSquaredV3V3,
    lenV3V3, maddV3V3Fl, maddV3V3V3Fl, maxIi, midV3V3V3, minFf, mulM4V4, mulV3Fl, mulV3M4V3,
    negateV3, normalizeV3, nv3, planeFromPointNormalV3, subV3V3V3, unitM4, zeroV3,
} from './bevel-math'
import {
    AngleKind, BEVEL_AFFECT, BEVEL_EPSILON, BEVEL_EPSILON_ANG, BEVEL_EPSILON_BIG,
    BEVEL_EPSILON_D, BEVEL_EPSILON_SQ, BEVEL_PROFILE, BEVEL_SMALL_ANG, BevVert, BevelParams,
    BoundVert, EdgeHalf, FKind, MeshKind, NewVert, PRO_SQUARE_IN_R, PRO_SQUARE_R, VMesh,
    addNewBoundVert, copyMeshVert, meshVert, newVMesh, newVert, recordFaceKind,
} from './bevel-types'
import {co, edgeCalcFaceAngleSignedEx, edgeOtherVert, vertFaceCheck} from './bevel-bmquery'
import {edgesAngleKind} from './bevel-offset'
import {
    calculateProfile, getProfilePoint, makeUnitCubeMap, makeUnitSquareMap, setProfileParams,
    snapToSuperellipsoid,
} from './bevel-profile'
import {calculateVmProfiles} from './bevel-boundary'
import {
    bevCreateNgon, boundvertRepFace, buildCenterNgon, createMeshBmvert, edgeCreateFrom,
    findCloserEdge, flagOutEdge, frepForCenterPoly, getIncidentEdges, findFaceInternalBoundverts,
} from './bevel-create'
import {chooseRepFace} from './bevel-boundary'
import {moveWeldProfilePlanes} from './bevel-profile'
import {PRO_LINE_R} from './bevel-types'

/**
 * `pipe_test` (`:4347`) - is this corner a "pipe"?
 *
 * Blender's definition: three or four beveled edges with two of them collinear, the other edges on
 * opposite sides if there are four, a boundary of three or four verts, and every face involved
 * parallel to the pipe edges. Returns the bound vert whose `ebev` is one of the pipe edges.
 */
export function pipeTest(bv: BevVert): BoundVert | null {
    const vm = bv.vmesh
    if (vm.count < 3 || vm.count > 4 || bv.selcount < 3 || bv.selcount > 4) {
        return null
    }

    let epipe: EdgeHalf | null = null
    let v1 = vm.boundstart!
    const dir1 = nv3()
    const dir3 = nv3()
    do {
        const v2 = v1.next
        const v3 = v2.next
        if (v1.ebev && v2.ebev && v3.ebev) {
            subV3V3V3(dir1, co(bv.v), co(edgeOtherVert(v1.ebev.e, bv.v)))
            subV3V3V3(dir3, co(edgeOtherVert(v3.ebev.e, bv.v)), co(bv.v))
            normalizeV3(dir1)
            normalizeV3(dir3)
            if (angleNormalizedV3V3(dir1, dir3) < BEVEL_EPSILON_ANG) {
                epipe = v1.ebev
                break
            }
        }
        v1 = v1.next
    } while (v1 !== vm.boundstart)

    if (!epipe) {
        return null
    }

    // Check the face planes: every normal should be perpendicular to the pipe direction.
    for (let i = 0; i < bv.edgecount; i++) {
        const e = bv.edges[i]
        if (e.fnext) {
            if (Math.abs(dotV3V3(dir1, [e.fnext.nx, e.fnext.ny, e.fnext.nz])) > BEVEL_EPSILON_BIG) {
                return null
            }
        }
    }
    return v1
}

/** `new_adj_vmesh` (`:4388`). */
export function newAdjVmesh(count: number, seg: number, bounds: BoundVert | null): VMesh {
    const vm = newVMesh()
    vm.count = count
    vm.seg = seg
    vm.boundstart = bounds
    const n = count * (1 + Math.floor(seg / 2)) * (1 + seg)
    const mesh: NewVert[] = new Array(n)
    for (let i = 0; i < n; i++) mesh[i] = newVert()
    vm.mesh = mesh
    vm.meshKind = MeshKind.ADJ
    return vm
}

/**
 * `mesh_vert_canon` (`:4410`) - the one slot that owns the data for any `(i, j, k)`.
 *
 * VMesh slots for bound vert `i` cover `0 <= j <= ns2` and `0 <= k <= ns`, but those overlap the
 * slots of `i - 1` and `i + 1`. The canonical range is `j <= ns2 - 1 + odd`, `k <= ns2`, plus the
 * single centre slot at `i = 0` for even `ns`.
 */
export function meshVertCanon(vm: VMesh, i: number, j: number, k: number): NewVert {
    const n = vm.count
    const ns = vm.seg
    const ns2 = Math.floor(ns / 2)
    const odd = ns % 2

    if (!odd && j === ns2 && k === ns2) {
        return meshVert(vm, 0, j, k)
    }
    if (j <= ns2 - 1 + odd && k <= ns2) {
        return meshVert(vm, i, j, k)
    }
    if (k <= ns2) {
        return meshVert(vm, (i + n - 1) % n, k, ns - j)
    }
    return meshVert(vm, (i + 1) % n, ns - k, j)
}

/** `is_canon` (`:4430`). */
export function isCanon(vm: VMesh, i: number, j: number, k: number): boolean {
    const ns2 = Math.floor(vm.seg / 2)
    if (vm.seg % 2 === 1) {
        return j <= ns2 && k <= ns2
    }
    return (j < ns2 && k <= ns2) || (j === ns2 && k === ns2 && i === 0)
}

/** `vmesh_copy_equiv_verts` (`:4441`) - push every canonical slot's data out to its aliases. */
export function vmeshCopyEquivVerts(vm: VMesh): void {
    const n = vm.count
    const ns = vm.seg
    const ns2 = Math.floor(ns / 2)
    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= ns2; j++) {
            for (let k = 0; k <= ns; k++) {
                if (isCanon(vm, i, j, k)) continue
                const v1 = meshVert(vm, i, j, k)
                const v0 = meshVertCanon(vm, i, j, k)
                copyV3V3(v1.co, v0.co)
                v1.v = v0.v
            }
        }
    }
}

/** `vmesh_center` (`:4462`). */
export function vmeshCenter(vm: VMesh, rCent: number[]): void {
    const n = vm.count
    const ns2 = Math.floor(vm.seg / 2)
    if (vm.seg % 2) {
        zeroV3(rCent)
        for (let i = 0; i < n; i++) {
            addV3V3(rCent, meshVert(vm, i, ns2, ns2).co)
        }
        mulV3Fl(rCent, 1.0 / n)
    } else {
        copyV3V3(rCent, meshVert(vm, 0, ns2, ns2).co)
    }
}

/** `avg4` (`:4478`). */
function avg4(out: number[], v0: NewVert, v1: NewVert, v2: NewVert, v3: NewVert): void {
    addV3V3V3(out, v0.co, v1.co)
    addV3V3(out, v2.co)
    addV3V3(out, v3.co)
    mulV3Fl(out, 0.25)
}

/**
 * `sabin_gamma` (`:4488`) - the Catmull-Clark centre weight for an n-sided hole, from Sabin's
 * modification. Blender precomputes `n` up to 6 and otherwise solves the cubic
 * `x^3 + (4k^2 - 3)x - 2k = 0` for `k = cos(pi / n)`; the closed form is transcribed as-is.
 */
export function sabinGamma(n: number): number {
    if (n < 3) return 0.0
    if (n === 3) return 0.065247584
    if (n === 4) return 0.25
    if (n === 5) return 0.401983447
    if (n === 6) return 0.523423277
    const k = Math.cos(Math.PI / n)
    const k2 = k * k
    const k4 = k2 * k2
    const k6 = k4 * k2
    const y = Math.pow(Math.sqrt(3) * Math.sqrt(64.0 * k6 - 144.0 * k4 + 135.0 * k2 - 27.0) + 9.0 * k, 1.0 / 3.0)
    const x = 0.480749856769136 * y - (0.231120424783545 * (12.0 * k2 - 9.0)) / y
    return (k * x + 2.0 * k2 - 1.0) / (x * x * (k * x + 1.0))
}

/** `fill_vmesh_fracs` (`:4519`) - cumulative arc-length fractions along ring 0 for bound vert `i`. */
function fillVmeshFracs(vm: VMesh, frac: number[], i: number): void {
    let total = 0.0
    const ns = vm.seg
    frac[0] = 0.0
    for (let k = 0; k < ns; k++) {
        total += lenV3V3(meshVert(vm, i, 0, k).co, meshVert(vm, i, 0, k + 1).co)
        frac[k + 1] = total
    }
    if (total > 0.0) {
        for (let k = 1; k <= ns; k++) frac[k] /= total
    } else {
        frac[ns] = 1.0
    }
}

/** `fill_profile_fracs` (`:4540`) - the same for the true profile points of `bndv`. */
function fillProfileFracs(bp: BevelParams, bndv: BoundVert, frac: number[], ns: number): void {
    const point = nv3()
    const nextco = nv3()
    let total = 0.0

    frac[0] = 0.0
    copyV3V3(point, bndv.nv.co)
    for (let k = 0; k < ns; k++) {
        getProfilePoint(bp, bndv.profile, k + 1, ns, nextco)
        total += lenV3V3(point, nextco)
        frac[k + 1] = total
        copyV3V3(point, nextco)
    }
    if (total > 0.0) {
        for (let k = 1; k <= ns; k++) frac[k] /= total
    } else {
        frac[ns] = 1.0
    }
}

/** `interp_range` (`:4565`) - the `i` with `frac[i] <= f <= frac[i + 1]`, and the rest in `rRest`. */
function interpRange(frac: number[], n: number, f: number, rRest: {v: number}): number {
    for (let i = 0; i < n; i++) {
        if (f <= frac[i + 1]) {
            const rest = f - frac[i]
            if (rest === 0) {
                rRest.v = 0.0
            } else {
                rRest.v = rest / (frac[i + 1] - frac[i])
            }
            if (i === n - 1 && rRest.v === 1.0) {
                rRest.v = 0.0
                return n
            }
            return i
        }
    }
    rRest.v = 0.0
    return n
}

/**
 * `interp_vmesh` (`:4592`) - resample a VMesh to `nseg` border vertices.
 *
 * Blender carries a TODO here: the centre vertex sometimes ends up slightly off. Ported as-is.
 */
export function interpVmesh(bp: BevelParams, vmIn: VMesh, nseg: number): VMesh {
    const nBndv = vmIn.count
    const nsIn = vmIn.seg
    const nseg2 = Math.floor(nseg / 2)
    const odd = nseg % 2
    const vmOut = newAdjVmesh(nBndv, nseg, vmIn.boundstart)

    let prevFrac: number[] = new Array(nsIn + 1).fill(0)
    let frac: number[] = new Array(nsIn + 1).fill(0)
    let newFrac: number[] = new Array(nseg + 1).fill(0)
    let prevNewFrac: number[] = new Array(nseg + 1).fill(0)

    fillVmeshFracs(vmIn, prevFrac, nBndv - 1)
    let bndv = vmIn.boundstart!
    fillProfileFracs(bp, bndv.prev, prevNewFrac, nseg)
    for (let i = 0; i < nBndv; i++) {
        fillVmeshFracs(vmIn, frac, i)
        fillProfileFracs(bp, bndv, newFrac, nseg)
        for (let j = 0; j <= nseg2 - 1 + odd; j++) {
            for (let k = 0; k <= nseg2; k++) {
                // Find where each "fraction" fits into the previous and current "frac".
                const restk = {v: 0}
                const restkprev = {v: 0}
                const kIn = interpRange(frac, nsIn, newFrac[k], restk)
                const kInPrev = interpRange(prevFrac, nsIn, prevNewFrac[nseg - j], restkprev)
                let jIn = nsIn - kInPrev
                let restj = -restkprev.v
                if (restj > -BEVEL_EPSILON) {
                    restj = 0.0
                } else {
                    jIn = jIn - 1
                    restj = 1.0 + restj
                }
                // Bilinear interpolation within the source quad.
                const point = nv3()
                if (restj < BEVEL_EPSILON && restk.v < BEVEL_EPSILON) {
                    copyV3V3(point, meshVertCanon(vmIn, i, jIn, kIn).co)
                } else {
                    const j0inc = (restj < BEVEL_EPSILON || jIn === nsIn) ? 0 : 1
                    const k0inc = (restk.v < BEVEL_EPSILON || kIn === nsIn) ? 0 : 1
                    const quad = [
                        meshVertCanon(vmIn, i, jIn, kIn).co,
                        meshVertCanon(vmIn, i, jIn, kIn + k0inc).co,
                        meshVertCanon(vmIn, i, jIn + j0inc, kIn + k0inc).co,
                        meshVertCanon(vmIn, i, jIn + j0inc, kIn).co,
                    ]
                    interpBilinearQuadV3(quad, restk.v, restj, point)
                }
                copyV3V3(meshVert(vmOut, i, j, k).co, point)
            }
        }
        bndv = bndv.next
        const t1 = prevFrac; prevFrac = frac; frac = t1
        const t2 = prevNewFrac; prevNewFrac = newFrac; newFrac = t2
    }
    if (!odd) {
        const center = nv3()
        vmeshCenter(vmIn, center)
        copyV3V3(meshVert(vmOut, 0, nseg2, nseg2).co, center)
    }
    vmeshCopyEquivVerts(vmOut)
    return vmOut
}

/**
 * `cubic_subdiv` (`:4664`) - one step of Catmull-Clark with special boundary rules, doubling the
 * segment count. Follows Levin 1999, "Filling an N-sided hole using combined subdivision schemes".
 *
 * `vmIn` is modified; Blender notes it is not used again after this call.
 */
export function cubicSubdiv(bp: BevelParams, vmIn: VMesh): VMesh {
    const point = nv3()

    const nBoundary = vmIn.count
    const nsIn = vmIn.seg
    const nsIn2 = Math.floor(nsIn / 2)
    const nsOut = 2 * nsIn
    const vmOut = newAdjVmesh(nBoundary, nsOut, vmIn.boundstart)

    // First adjust the input mesh's boundary vertices, storing them in the output mesh.
    for (let i = 0; i < nBoundary; i++) {
        copyV3V3(meshVert(vmOut, i, 0, 0).co, meshVert(vmIn, i, 0, 0).co)
        for (let k = 1; k < nsIn; k++) {
            copyV3V3(point, meshVert(vmIn, i, 0, k).co)

            // The smooth boundary rule. Custom profiles must not be smoothed.
            if (bp.profileType !== BEVEL_PROFILE.CUSTOM) {
                const acc = nv3()
                addV3V3V3(acc, meshVert(vmIn, i, 0, k - 1).co, meshVert(vmIn, i, 0, k + 1).co)
                maddV3V3Fl(acc, point, -2.0)
                maddV3V3Fl(point, acc, -1.0 / 6.0)
            }

            copyV3V3(meshVertCanon(vmOut, i, 0, 2 * k).co, point)
        }
    }
    // Now adjust the odd boundary vertices of the output mesh, based on the even ones.
    let bndv = vmOut.boundstart!
    for (let i = 0; i < nBoundary; i++) {
        for (let k = 1; k < nsOut; k += 2) {
            getProfilePoint(bp, bndv.profile, k, nsOut, point)

            if (bp.profileType !== BEVEL_PROFILE.CUSTOM) {
                const acc = nv3()
                addV3V3V3(acc, meshVertCanon(vmOut, i, 0, k - 1).co, meshVertCanon(vmOut, i, 0, k + 1).co)
                maddV3V3Fl(acc, point, -2.0)
                maddV3V3Fl(point, acc, -1.0 / 6.0)
            }

            copyV3V3(meshVertCanon(vmOut, i, 0, k).co, point)
        }
        bndv = bndv.next
    }
    vmeshCopyEquivVerts(vmOut)

    // Copy the adjusted verts back into vmIn.
    for (let i = 0; i < nBoundary; i++) {
        for (let k = 0; k < nsIn; k++) {
            copyV3V3(meshVert(vmIn, i, 0, k).co, meshVert(vmOut, i, 0, 2 * k).co)
        }
    }

    vmeshCopyEquivVerts(vmIn)

    /* Now the internal vertices, with standard Catmull-Clark, assuming every boundary vertex has
     * valence 4. */

    // The new face vertices.
    for (let i = 0; i < nBoundary; i++) {
        for (let j = 0; j < nsIn2; j++) {
            for (let k = 0; k < nsIn2; k++) {
                // The face up and right from (j, k).
                avg4(point,
                    meshVert(vmIn, i, j, k),
                    meshVert(vmIn, i, j, k + 1),
                    meshVert(vmIn, i, j + 1, k),
                    meshVert(vmIn, i, j + 1, k + 1))
                copyV3V3(meshVert(vmOut, i, 2 * j + 1, 2 * k + 1).co, point)
            }
        }
    }

    // The new vertical edge vertices.
    for (let i = 0; i < nBoundary; i++) {
        for (let j = 0; j < nsIn2; j++) {
            for (let k = 1; k <= nsIn2; k++) {
                avg4(point,
                    meshVert(vmIn, i, j, k),
                    meshVert(vmIn, i, j + 1, k),
                    meshVertCanon(vmOut, i, 2 * j + 1, 2 * k - 1),
                    meshVertCanon(vmOut, i, 2 * j + 1, 2 * k + 1))
                copyV3V3(meshVert(vmOut, i, 2 * j + 1, 2 * k).co, point)
            }
        }
    }

    // The new horizontal edge vertices.
    for (let i = 0; i < nBoundary; i++) {
        for (let j = 1; j < nsIn2; j++) {
            for (let k = 0; k < nsIn2; k++) {
                avg4(point,
                    meshVert(vmIn, i, j, k),
                    meshVert(vmIn, i, j, k + 1),
                    meshVertCanon(vmOut, i, 2 * j - 1, 2 * k + 1),
                    meshVertCanon(vmOut, i, 2 * j + 1, 2 * k + 1))
                copyV3V3(meshVert(vmOut, i, 2 * j, 2 * k + 1).co, point)
            }
        }
    }

    // The new vertices not on the border.
    let gamma = 0.25
    let beta = -gamma
    for (let i = 0; i < nBoundary; i++) {
        for (let j = 1; j < nsIn2; j++) {
            for (let k = 1; k <= nsIn2; k++) {
                const co1 = nv3()
                const co2 = nv3()
                // co1 = centroid of the adjacent new edge verts.
                avg4(co1,
                    meshVertCanon(vmOut, i, 2 * j, 2 * k - 1),
                    meshVertCanon(vmOut, i, 2 * j, 2 * k + 1),
                    meshVertCanon(vmOut, i, 2 * j - 1, 2 * k),
                    meshVertCanon(vmOut, i, 2 * j + 1, 2 * k))
                // co2 = centroid of the adjacent new face verts.
                avg4(co2,
                    meshVertCanon(vmOut, i, 2 * j - 1, 2 * k - 1),
                    meshVertCanon(vmOut, i, 2 * j + 1, 2 * k - 1),
                    meshVertCanon(vmOut, i, 2 * j - 1, 2 * k + 1),
                    meshVertCanon(vmOut, i, 2 * j + 1, 2 * k + 1))
                // Combine with the original vertex using the alpha, beta, gamma factors (alpha = 1).
                copyV3V3(point, co1)
                maddV3V3Fl(point, co2, beta)
                maddV3V3Fl(point, meshVert(vmIn, i, j, k).co, gamma)
                copyV3V3(meshVert(vmOut, i, 2 * j, 2 * k).co, point)
            }
        }
    }

    vmeshCopyEquivVerts(vmOut)

    // The centre vertex is special.
    gamma = sabinGamma(nBoundary)
    beta = -gamma
    const co1 = nv3()
    const co2 = nv3()
    zeroV3(co1)
    zeroV3(co2)
    for (let i = 0; i < nBoundary; i++) {
        addV3V3(co1, meshVert(vmOut, i, nsIn, nsIn - 1).co)
        addV3V3(co2, meshVert(vmOut, i, nsIn - 1, nsIn - 1).co)
        addV3V3(co2, meshVert(vmOut, i, nsIn - 1, nsIn + 1).co)
    }
    copyV3V3(point, co1)
    mulV3Fl(point, 1.0 / nBoundary)
    maddV3V3Fl(point, co2, beta / (2.0 * nBoundary))
    maddV3V3Fl(point, meshVert(vmIn, 0, nsIn2, nsIn2).co, gamma)
    for (let i = 0; i < nBoundary; i++) {
        copyV3V3(meshVert(vmOut, i, nsIn, nsIn).co, point)
    }

    // Final step: copy the profile vertices to the VMesh's boundary.
    bndv = vmOut.boundstart!
    for (let i = 0; i < nBoundary; i++) {
        const inext = (i + 1) % nBoundary
        for (let k = 0; k <= nsOut; k++) {
            getProfilePoint(bp, bndv.profile, k, nsOut, point)
            copyV3V3(meshVert(vmOut, i, 0, k).co, point)
            if (k >= nsIn && k < nsOut) {
                copyV3V3(meshVert(vmOut, inext, nsOut - k, 0).co, point)
            }
        }
        bndv = bndv.next
    }

    return vmOut
}

/** `make_cube_corner_square` (`:4843`) - the straight-sided cube corner, `r == PRO_SQUARE_R`. */
function makeCubeCornerSquare(nseg: number): VMesh {
    const ns2 = Math.floor(nseg / 2)
    const vm = newAdjVmesh(3, nseg, null)
    vm.count = 0 // Reset, so the loop below ends with the right count.
    for (let i = 0; i < 3; i++) {
        const point = nv3(0, 0, 0)
        point[i] = 1.0
        addNewBoundVert(vm, point)
    }
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j <= ns2; j++) {
            for (let k = 0; k <= ns2; k++) {
                if (!isCanon(vm, i, j, k)) continue
                const point = nv3()
                point[i] = 1.0
                point[(i + 1) % 3] = k * 2.0 / nseg
                point[(i + 2) % 3] = j * 2.0 / nseg
                copyV3V3(meshVert(vm, i, j, k).co, point)
            }
        }
    }
    vmeshCopyEquivVerts(vm)
    return vm
}

/**
 * `make_cube_corner_square_in` (`:4877`) - the inward square profile, `r == PRO_SQUARE_IN_R`.
 * Blender's note: this mostly wants no VMesh at all, just a three-way weld with a triangle in the
 * middle for odd `nseg`, which is what {@link buildSquareInVmesh} then does with it.
 */
function makeCubeCornerSquareIn(nseg: number): VMesh {
    const ns2 = Math.floor(nseg / 2)
    const odd = nseg % 2
    const vm = newAdjVmesh(3, nseg, null)
    vm.count = 0
    for (let i = 0; i < 3; i++) {
        const point = nv3(0, 0, 0)
        point[i] = 1.0
        addNewBoundVert(vm, point)
    }

    let b: number
    if (odd) {
        b = 2.0 / (2.0 * ns2 + Math.SQRT2)
    } else {
        b = 2.0 / nseg
    }
    for (let i = 0; i < 3; i++) {
        for (let k = 0; k <= ns2; k++) {
            const point = nv3()
            point[i] = 1.0 - k * b
            point[(i + 1) % 3] = 0.0
            point[(i + 2) % 3] = 0.0
            copyV3V3(meshVert(vm, i, 0, k).co, point)
            point[(i + 1) % 3] = 1.0 - k * b
            point[(i + 2) % 3] = 0.0
            point[i] = 0.0
            copyV3V3(meshVert(vm, i, 0, nseg - k).co, point)
        }
    }
    return vm
}

/**
 * `make_cube_corner_adj_vmesh` (`:4918`) - a VMesh covering the unit sphere octant centred at the
 * origin, with bound verts at the three axis points and quarter-circle arcs between them.
 */
export function makeCubeCornerAdjVmesh(bp: BevelParams): VMesh {
    const nseg = bp.seg
    const r = bp.proSuperR

    if (bp.profileType !== BEVEL_PROFILE.CUSTOM) {
        if (r === PRO_SQUARE_R) {
            return makeCubeCornerSquare(nseg)
        }
        if (r === PRO_SQUARE_IN_R) {
            return makeCubeCornerSquareIn(nseg)
        }
    }

    // The initial mesh has 3 sides and 2 segments on each.
    const vm0 = newAdjVmesh(3, 2, null)
    vm0.count = 0
    for (let i = 0; i < 3; i++) {
        const point = nv3(0, 0, 0)
        point[i] = 1.0
        addNewBoundVert(vm0, point)
    }
    let bndv = vm0.boundstart!
    for (let i = 0; i < 3; i++) {
        // The point halfway around the profile, on the arc between this bound vert and the next.
        const coc = nv3()
        coc[i] = 1.0
        coc[(i + 1) % 3] = 1.0
        coc[(i + 2) % 3] = 0.0
        bndv.profile.superR = r
        copyV3V3(bndv.profile.start, bndv.nv.co)
        copyV3V3(bndv.profile.end, bndv.next.nv.co)
        copyV3V3(bndv.profile.middle, coc)
        copyV3V3(meshVert(vm0, i, 0, 0).co, bndv.profile.start)
        copyV3V3(bndv.profile.planeCo, bndv.profile.start)
        crossV3V3V3(bndv.profile.planeNo, bndv.profile.start, bndv.profile.end)
        copyV3V3(bndv.profile.projDir, bndv.profile.planeNo)
        // Recalculate the profiles because we started over with new bound verts.
        calculateProfile(bp, bndv, false, false)

        // Only the boundaries are being built here, so sample the profile halfway through.
        getProfilePoint(bp, bndv.profile, 1, 2, meshVert(vm0, i, 0, 1).co)

        bndv = bndv.next
    }
    // The centre vertex.
    const center = nv3()
    copyV3Fl(center, 1 / Math.sqrt(3))

    if (nseg > 2) {
        if (r > 1.5) {
            mulV3Fl(center, 1.4)
        } else if (r < 0.75) {
            mulV3Fl(center, 0.6)
        }
    }
    copyV3V3(meshVert(vm0, 0, 1, 1).co, center)

    vmeshCopyEquivVerts(vm0)

    let vm1 = vm0
    while (vm1.seg < nseg) {
        vm1 = cubicSubdiv(bp, vm1)
    }
    if (vm1.seg !== nseg) {
        vm1 = interpVmesh(bp, vm1, nseg)
    }

    // Snap every vertex to the superellipsoid.
    const ns2 = Math.floor(nseg / 2)
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j <= ns2; j++) {
            for (let k = 0; k <= nseg; k++) {
                snapToSuperellipsoid(meshVert(vm1, i, j, k).co, r, false)
            }
        }
    }

    return vm1
}

/**
 * `tri_corner_test` (`:5002`) - is this a corner that the sphere-octant special case handles well?
 * Returns 1 for yes, 0 for "not this shape but do not rule it out", -1 for definitely not.
 */
export function triCornerTest(bp: BevelParams, bv: BevVert): number {
    let inPlaneE = 0

    // The superellipse snapping here is not helpful with custom profiles.
    if (bp.affectType === BEVEL_AFFECT.VERTICES || bp.profileType === BEVEL_PROFILE.CUSTOM) {
        return -1
    }
    if (bv.vmesh.count !== 3) {
        return 0
    }

    // Only use the tri-corner special case if the offset is the same for every edge.
    const offset = bv.edges[0].offsetL

    let totang = 0.0
    for (let i = 0; i < bv.edgecount; i++) {
        const e = bv.edges[i]
        const ang = edgeCalcFaceAngleSignedEx(e.e, 0.0)
        const absang = Math.abs(ang)
        if (absang <= Math.PI / 4) {
            inPlaneE++
        } else if (absang >= 3.0 * (Math.PI / 4)) {
            return -1
        }

        if (e.isBev && !compareFf(e.offsetL, offset, BEVEL_EPSILON)) {
            return -1
        }

        totang += ang
    }
    if (inPlaneE !== bv.edgecount - 3) {
        return -1
    }
    const angdiff = Math.abs(Math.abs(totang) - 3.0 * (Math.PI / 2))
    if ((bp.proSuperR === PRO_SQUARE_R && angdiff > Math.PI / 16.0) || (angdiff > Math.PI / 4)) {
        return -1
    }
    if (bv.edgecount !== 3 || bv.selcount !== 3) {
        return 0
    }
    return 1
}

/** `tri_corner_adj_vmesh` (`:5050`) - the sphere octant mapped onto this corner's three bound verts. */
export function triCornerAdjVmesh(bp: BevelParams, bv: BevVert): VMesh {
    let bndv = bv.vmesh.boundstart!

    const co0 = nv3()
    const co1 = nv3()
    const co2 = nv3()
    copyV3V3(co0, bndv.nv.co)
    bndv = bndv.next
    copyV3V3(co1, bndv.nv.co)
    bndv = bndv.next
    copyV3V3(co2, bndv.nv.co)

    const mat: M4 = unitM4()
    makeUnitCubeMap(co0, co1, co2, co(bv.v), mat)
    const ns = bp.seg
    const ns2 = Math.floor(ns / 2)
    const vm = makeCubeCornerAdjVmesh(bp)
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j <= ns2; j++) {
            for (let k = 0; k <= ns; k++) {
                const nvc = meshVert(vm, i, j, k).co
                const v: V4 = [nvc[0], nvc[1], nvc[2], 1.0]
                mulM4V4(mat, v)
                nvc[0] = v[0]
                nvc[1] = v[1]
                nvc[2] = v[2]
            }
        }
    }

    return vm
}

/** `adj_vmesh` (`:5082`) - the general corner surface. */
export function adjVmesh(bp: BevelParams, bv: BevVert): VMesh {
    const nBndv = bv.vmesh.count

    // The same bevel as three edges of a vertex in a cube.
    if (nBndv === 3 && triCornerTest(bp, bv) !== -1 && bp.proSuperR !== PRO_SQUARE_IN_R) {
        return triCornerAdjVmesh(bp, bv)
    }

    // First construct an initial control mesh with nseg == 2.
    const nseg = bv.vmesh.seg
    const vm0 = newAdjVmesh(nBndv, 2, bv.vmesh.boundstart)

    // Find the centre of the bound verts that make up the vmesh.
    let bndv = vm0.boundstart!
    const boundvertsCenter = nv3(0, 0, 0)
    for (let i = 0; i < nBndv; i++) {
        // The boundaries just divide the input polygon edges into two even segments.
        copyV3V3(meshVert(vm0, i, 0, 0).co, bndv.nv.co)
        getProfilePoint(bp, bndv.profile, 1, 2, meshVert(vm0, i, 0, 1).co)
        addV3V3(boundvertsCenter, bndv.nv.co)
        bndv = bndv.next
    }
    mulV3Fl(boundvertsCenter, 1.0 / nBndv)

    /* Placing the centre vertex: `negativeFullest` is the reflection of the original vertex across
     * the bound verts' centre, and `fullness` is the fraction of the way from that centre to the
     * original vertex (positive) or to `negativeFullest` (negative). */
    const originalVertex = nv3()
    const negativeFullest = nv3()
    copyV3V3(originalVertex, co(bv.v))
    subV3V3V3(negativeFullest, boundvertsCenter, originalVertex)
    addV3V3(negativeFullest, boundvertsCenter)

    let fullness = bp.proSpacing.fullness
    const centerDirection = nv3()
    subV3V3V3(centerDirection, originalVertex, boundvertsCenter)
    if (lenSquaredV3(centerDirection) > BEVEL_EPSILON_SQ) {
        if (bp.profileType === BEVEL_PROFILE.CUSTOM) {
            fullness *= 2.0
            maddV3V3V3Fl(meshVert(vm0, 0, 1, 1).co, negativeFullest, centerDirection, fullness)
        } else {
            maddV3V3V3Fl(meshVert(vm0, 0, 1, 1).co, boundvertsCenter, centerDirection, fullness)
        }
    } else {
        copyV3V3(meshVert(vm0, 0, 1, 1).co, boundvertsCenter)
    }
    vmeshCopyEquivVerts(vm0)

    // Subdivide from the two-segment start mesh up to the final vertex mesh.
    let vm1 = vm0
    do {
        vm1 = cubicSubdiv(bp, vm1)
    } while (vm1.seg < nseg)
    if (vm1.seg !== nseg) {
        vm1 = interpVmesh(bp, vm1, nseg)
    }
    return vm1
}

/**
 * `snap_to_pipe_profile` (`:5153`) - snap a point onto the pipe's profile, projected into the plane
 * through the point with normal along the pipe edge.
 */
function snapToPipeProfile(vpipe: BoundVert, midline: boolean, point: number[]): void {
    const pro = vpipe.profile
    const e = vpipe.ebev!

    if (compareV3V3(pro.start, pro.end, BEVEL_EPSILON_D)) {
        copyV3V3(point, pro.start)
        return
    }

    // A plane whose normal points along the beveled edge.
    const edir = nv3()
    const plane: V4 = [0, 0, 0, 0]
    subV3V3V3(edir, co(e.e.v1), co(e.e.v2))
    planeFromPointNormalV3(plane, point, edir)

    const startPlane = nv3()
    const endPlane = nv3()
    const middlePlane = nv3()
    closestToPlaneV3(startPlane, plane, pro.start)
    closestToPlaneV3(endPlane, plane, pro.end)
    closestToPlaneV3(middlePlane, plane, pro.middle)

    const m: M4 = unitM4()
    const minv: M4 = unitM4()
    if (makeUnitSquareMap(startPlane, middlePlane, endPlane, m) && invertM4M4(minv, m)) {
        // Transform the point into profile space and project it onto the superellipse.
        const p = nv3()
        mulV3M4V3(p, minv, point)
        snapToSuperellipsoid(p, pro.superR, midline)

        const snap = nv3()
        mulV3M4V3(snap, m, p)
        copyV3V3(point, snap)
    } else {
        // Planar case: snap to the line from startPlane to endPlane.
        const p = nv3()
        closestToLineSegmentV3(p, point, startPlane, endPlane)
        copyV3V3(point, p)
    }
}

/**
 * `pipe_adj_vmesh` (`:5197`) - the general surface, then every interior vertex snapped onto the
 * pipe's profile.
 */
export function pipeAdjVmesh(bp: BevelParams, bv: BevVert, vpipe: BoundVert): VMesh {
    const vm = adjVmesh(bp, bv)

    const nBndv = bv.vmesh.count
    const ns = bv.vmesh.seg
    const halfNs = Math.floor(ns / 2)
    const ipipe1 = vpipe.index
    const ipipe2 = vpipe.next.next.index

    for (let i = 0; i < nBndv; i++) {
        for (let j = 1; j <= halfNs; j++) {
            for (let k = 0; k <= halfNs; k++) {
                if (!isCanon(vm, i, j, k)) continue
                if (bp.profileType === BEVEL_PROFILE.CUSTOM) {
                    // Find both profile vertices corresponding to this point.
                    let profilePointPipe1: number[]
                    let profilePointPipe2: number[]
                    let f: number
                    if (i === ipipe1 || i === ipipe2) {
                        if (nBndv === 3 && i === ipipe1) {
                            // The triangular corner between the two pipe profiles.
                            const ring = maxIi(j, k)
                            profilePointPipe2 = meshVert(vm, i, 0, ring).co
                            profilePointPipe1 = meshVert(vm, i, ring, 0).co
                            f = ((k < j) ? minFf(j, k) : ((2.0 * ring) - j)) / (2.0 * ring)
                        } else {
                            // Part of either pipe profile's area in the 4-way intersection.
                            profilePointPipe1 = meshVert(vm, i, 0, k).co
                            profilePointPipe2 = meshVert(vm, i === ipipe1 ? ipipe2 : ipipe1, 0, ns - k).co
                            f = j / ns
                        }
                    } else {
                        // The profile vertices are at both ends of each side profile's rings.
                        profilePointPipe1 = meshVert(vm, i, j, 0).co
                        profilePointPipe2 = meshVert(vm, i, j, ns).co
                        f = k / ns
                    }
                    interpV3V3V3(meshVert(vm, i, j, k).co, profilePointPipe1, profilePointPipe2, f)
                } else {
                    /* Tricky case: for the square profiles with an even nseg, certain vertices
                     * should snap to the midline on the pipe rather than to one plane or the other. */
                    const even = ns % 2 === 0
                    const midline = even && k === halfNs &&
                        ((i === 0 && j === halfNs) || i === ipipe1 || i === ipipe2)
                    snapToPipeProfile(vpipe, midline, meshVert(vm, i, j, k).co)
                }
            }
        }
    }
    return vm
}

/**
 * `build_square_in_vmesh` (`:5499`) - the special case where the profile is fully inward and the
 * corner collapses to a three-way weld with, for odd `ns`, a triangle in the middle.
 */
function buildSquareInVmesh(bp: BevelParams, bm: BMesh, bv: BevVert, vm1: VMesh): void {
    const vm = bv.vmesh
    const n = vm.count
    const ns = vm.seg
    const ns2 = Math.floor(ns / 2)
    const odd = ns % 2

    for (let i = 0; i < n; i++) {
        for (let k = 1; k < ns; k++) {
            copyV3V3(meshVert(vm, i, 0, k).co, meshVert(vm1, i, 0, k).co)
            if (i > 0 && k <= ns2) {
                meshVert(vm, i, 0, k).v = meshVert(vm, i - 1, 0, ns - k).v
            } else if (i === n - 1 && k > ns2) {
                meshVert(vm, i, 0, k).v = meshVert(vm, 0, 0, ns - k).v
            } else {
                createMeshBmvert(bm, bp, vm, i, 0, k, bv.v)
            }
        }
    }
    if (odd) {
        for (let i = 0; i < n; i++) {
            meshVert(vm, i, ns2, ns2).v = meshVert(vm, i, 0, ns2).v
        }
        buildCenterNgon(bp, bm, bv, bp.matNr)
    }
}

/** `closer_v3_v3v3v3` (`:5532`) - whichever of `a` and `b` is closer to `v`, into `r`. */
function closerV3V3V3V3(r: number[], a: readonly number[], b: readonly number[], v: readonly number[]): void {
    if (lenSquaredV3V3(a, v) <= lenSquaredV3V3(b, v)) {
        copyV3V3(r, a)
    } else {
        copyV3V3(r, b)
    }
}

/**
 * `square_out_adj_vmesh` (`:5554`) - the square (`profile == 1`) case with three or more beveled
 * edges and an even segment count.
 *
 * What is wanted is `ns2` parallel offset lines on each side of the centre; wherever two of them
 * intersect between successive beveled edges, that intersection is a vmesh vertex. The boundary
 * edges have to move too, because here there are two profile planes per pair of bound verts rather
 * than one.
 *
 * Blender's signature takes `bp` as well, but only for its memory arena, so it is absent here.
 */
export function squareOutAdjVmesh(bv: BevVert): VMesh {
    const nBndv = bv.vmesh.count
    const ns = bv.vmesh.seg
    const ns2 = Math.floor(ns / 2)
    const odd = ns % 2
    let ns2inv = 1.0 / ns2
    const vm = newAdjVmesh(nBndv, ns, bv.vmesh.boundstart)
    // Blender's `centerline` is a flat `float[3 * (ns2 + 1)]` per bound vert; here it is an array of
    // points per bound vert, indexed `[i][step]`, which is the same thing addressed by name.
    const centerline: number[][][] = []
    for (let i = 0; i < nBndv; i++) {
        const col: number[][] = []
        for (let s = 0; s <= ns2; s++) col.push(nv3())
        centerline.push(col)
    }
    const cset: boolean[] = new Array(nBndv).fill(false)

    /* Find `on_edge`: place on bndv[i]'s elast where the offset line would meet, taking whichever of
     * that and where the next sector's offset line would meet is closer to bv->v. */
    let bndv = vm.boundstart!
    for (let i = 0; i < nBndv; i++) {
        const bndco = nv3()
        copyV3V3(bndco, bndv.nv.co)
        let e1 = bndv.efirst
        const e2 = bndv.elast
        let angKind: AngleKind = AngleKind.STRAIGHT
        if (e1 && e2) {
            angKind = edgesAngleKind(e1, e2, bv.v)
        }
        if (bndv.isPatchStart) {
            midV3V3V3(centerline[i][0], bndv.nv.co, bndv.next.nv.co)
            cset[i] = true
            bndv = bndv.next
            i++
            midV3V3V3(centerline[i][0], bndv.nv.co, bndv.next.nv.co)
            cset[i] = true
            bndv = bndv.next
            i++
            // Leave cset[i] as it was - probably false, unless i == n - 1.
        } else if (bndv.isArcStart) {
            copyV3V3(centerline[i][0], bndv.profile.middle)
            bndv = bndv.next
            cset[i] = true
            i++
        } else if (angKind === AngleKind.SMALLER) {
            e1 = bndv.efirst!
            const eL = bndv.elast!
            const dir1 = nv3()
            const dir2 = nv3()
            const c1 = nv3()
            const c2 = nv3()
            subV3V3V3(dir1, co(e1.e.v1), co(e1.e.v2))
            subV3V3V3(dir2, co(eL.e.v1), co(eL.e.v2))
            addV3V3V3(c1, bndco, dir1)
            addV3V3V3(c2, bndco, dir2)
            // Intersect e1 with the line through bndv parallel to e2 to get v1co.
            const meet1 = nv3()
            const meet2 = nv3()
            let ikind = isectLineLineV3(co(e1.e.v1), co(e1.e.v2), bndco, c2, meet1, meet2)
            const v1co = nv3()
            let v1set: boolean
            if (ikind === 0) {
                v1set = false
            } else {
                // If the lines are skew (ikind == 2) we want meet1, which is on e1.
                copyV3V3(v1co, meet1)
                v1set = true
            }
            // Intersect e2 with the line through bndv parallel to e1 to get v2co.
            ikind = isectLineLineV3(co(eL.e.v1), co(eL.e.v2), bndco, c1, meet1, meet2)
            const v2co = nv3()
            let v2set: boolean
            if (ikind === 0) {
                v2set = false
            } else {
                v2set = true
                copyV3V3(v2co, meet1)
            }

            const iprev = i === 0 ? nBndv - 1 : i - 1
            if (v2set) {
                if (cset[i]) {
                    closerV3V3V3V3(centerline[i][0], centerline[i][0], v2co, co(bv.v))
                } else {
                    copyV3V3(centerline[i][0], v2co)
                    cset[i] = true
                }
            }
            if (v1set) {
                if (cset[iprev]) {
                    closerV3V3V3V3(centerline[iprev][0], centerline[iprev][0], v1co, co(bv.v))
                } else {
                    copyV3V3(centerline[iprev][0], v1co)
                    cset[iprev] = true
                }
            }
        }
        bndv = bndv.next
    }
    // Not everything was necessarily set by the previous loop.
    bndv = vm.boundstart!
    for (let i = 0; i < nBndv; i++) {
        if (!cset[i]) {
            const e1 = bndv.next.efirst
            const c1 = nv3()
            const c2 = nv3()
            copyV3V3(c1, bndv.nv.co)
            copyV3V3(c2, bndv.next.nv.co)
            if (e1) {
                if (bndv.prev.isArcStart && bndv.next.isArcStart) {
                    const meet1 = nv3()
                    const meet2 = nv3()
                    const ikind = isectLineLineV3(co(e1.e.v1), co(e1.e.v2), c1, c2, meet1, meet2)
                    if (ikind !== 0) {
                        copyV3V3(centerline[i][0], meet1)
                        cset[i] = true
                    }
                } else {
                    if (bndv.prev.isArcStart) {
                        closestToLineSegmentV3(centerline[i][0], c1, co(e1.e.v1), co(e1.e.v2))
                    } else {
                        closestToLineSegmentV3(centerline[i][0], c2, co(e1.e.v1), co(e1.e.v2))
                    }
                    cset[i] = true
                }
            }
            if (!cset[i]) {
                midV3V3V3(centerline[i][0], c1, c2)
                cset[i] = true
            }
        }
        bndv = bndv.next
    }

    // Fill in the rest of the centre lines by interpolation.
    const co1 = nv3()
    const co2 = nv3()
    copyV3V3(co2, co(bv.v))
    bndv = vm.boundstart!
    for (let i = 0; i < nBndv; i++) {
        if (odd) {
            const ang = 0.5 * angleV3V3V3(bndv.nv.co, co1, bndv.next.nv.co)
            let finalfrac: number
            if (ang > BEVEL_SMALL_ANG) {
                /* `finalfrac` is the arm length of an isosceles triangle with apex angle `2 * ang`
                 * and base 1. Capped at 0.8 so the centre does not drop too far from bv. */
                finalfrac = 0.5 / Math.sin(ang)
                finalfrac = Math.min(finalfrac, 0.8)
            } else {
                finalfrac = 0.8
            }
            ns2inv = 1.0 / (ns2 + finalfrac)
        }

        copyV3V3(co1, centerline[i][0])
        for (let j = 1; j <= ns2; j++) {
            interpV3V3V3(centerline[i][j], co1, co2, j * ns2inv)
        }
        bndv = bndv.next
    }

    // Coordinates of the edges and the mid (or near-mid) line.
    bndv = vm.boundstart!
    for (let i = 0; i < nBndv; i++) {
        copyV3V3(co1, bndv.nv.co)
        copyV3V3(co2, centerline[i === 0 ? nBndv - 1 : i - 1][0])
        for (let j = 0; j < ns2 + odd; j++) {
            interpV3V3V3(meshVert(vm, i, j, 0).co, co1, co2, j * ns2inv)
        }
        copyV3V3(co2, centerline[i][0])
        for (let k = 1; k <= ns2; k++) {
            interpV3V3V3(meshVert(vm, i, 0, k).co, co1, co2, k * ns2inv)
        }
        bndv = bndv.next
    }
    if (!odd) {
        copyV3V3(meshVert(vm, 0, ns2, ns2).co, co(bv.v))
    }
    vmeshCopyEquivVerts(vm)

    // Fill in the interior points by interpolating from the edges to the centre lines.
    bndv = vm.boundstart!
    for (let i = 0; i < nBndv; i++) {
        const im1 = i === 0 ? nBndv - 1 : i - 1
        for (let j = 1; j < ns2 + odd; j++) {
            for (let k = 1; k <= ns2; k++) {
                const meet1 = nv3()
                const meet2 = nv3()
                const ikind = isectLineLineV3(
                    meshVert(vm, i, 0, k).co, centerline[im1][k],
                    meshVert(vm, i, j, 0).co, centerline[i][j],
                    meet1, meet2)
                if (ikind === 0) {
                    // Blender: "How can this happen?" - fall back to one-directional interpolation.
                    interpV3V3V3(meshVert(vm, i, j, k).co,
                        meshVert(vm, i, 0, k).co, centerline[im1][k], j * ns2inv)
                } else if (ikind === 1) {
                    copyV3V3(meshVert(vm, i, j, k).co, meet1)
                } else {
                    midV3V3V3(meshVert(vm, i, j, k).co, meet1, meet2)
                }
            }
        }
        bndv = bndv.next
    }

    vmeshCopyEquivVerts(vm)
    return vm
}

/** `snap_edge_for_center_vmesh_vert` (`:5779`). */
function snapEdgeForCenterVmeshVert(
    i: number, nBndv: number, eprev: BMEdge | null, enext: BMEdge | null,
    bndvRepFaces: (BMFace | null)[], centerFrep: BMFace | null, frepBeatsNext: boolean[],
): BMEdge | null {
    const previ = (i + nBndv - 1) % nBndv
    const nexti = (i + 1) % nBndv

    if (frepBeatsNext[previ] && bndvRepFaces[previ] === centerFrep) {
        return eprev
    }
    if (!frepBeatsNext[i] && bndvRepFaces[nexti] === centerFrep) {
        return enext
    }
    /* With more than three bound verts we do not snap in the regions not directly adjacent to the
     * centre-winning bound vert. Blender's comment: "This is probably wrong ... but the alternative
     * may be even worse." */
    return null
}

/**
 * `snap_edges_for_vmesh_vert` (`:5824`) - which original edge, if any, each of the four corners of
 * the adj-mesh quad at `(i, j, k)` should be snapped onto before its corner data is interpolated.
 *
 * Only matters for an odd segment count, where the centre row and column are ambiguous as to which
 * bound vert's representative face they belong to; `frepBeatsNext` breaks the tie consistently.
 * Edge bevels only.
 */
function snapEdgesForVmeshVert(
    i: number, j: number, k: number, ns: number, ns2: number, nBndv: number,
    eprev: BMEdge | null, enext: BMEdge | null, enextnext: BMEdge | null,
    bndvRepFaces: (BMFace | null)[], centerFrep: BMFace | null, frepBeatsNext: boolean[],
    rSnapEdges: (BMEdge | null)[],
): void {
    for (let corner = 0; corner < 4; corner++) {
        rSnapEdges[corner] = null
        if (ns % 2 === 0) {
            continue
        }
        const previ = (i + nBndv - 1) % nBndv
        // jj and kk are the j and k indices of this corner.
        const jj = corner < 2 ? j : j + 1
        const kk = (corner === 0 || corner === 3) ? k : k + 1
        if (jj < ns2 && kk < ns2) {
            // No snap.
        } else if (jj < ns2 && kk === ns2) {
            // On the left side of the centre strip quads, but not on the centre polygon.
            if (!frepBeatsNext[i]) {
                rSnapEdges[corner] = enext
            }
        } else if (jj < ns2 && kk === ns2 + 1) {
            // On the right side of the centre strip quads, but not on the centre polygon.
            if (frepBeatsNext[i]) {
                rSnapEdges[corner] = enext
            }
        } else if (jj === ns2 && kk < ns2) {
            // On the top of the top strip quads, but not on the centre polygon.
            if (frepBeatsNext[previ]) {
                rSnapEdges[corner] = eprev
            }
        } else if (jj === ns2 && kk === ns2) {
            // Centre polygon vertex for bound vert i.
            rSnapEdges[corner] = snapEdgeForCenterVmeshVert(
                i, nBndv, eprev, enext, bndvRepFaces, centerFrep, frepBeatsNext)
        } else if (jj === ns2 && kk === ns2 + 1) {
            // Centre polygon vertex for bound vert i + 1.
            const nexti = (i + 1) % nBndv
            rSnapEdges[corner] = snapEdgeForCenterVmeshVert(
                nexti, nBndv, enext, enextnext, bndvRepFaces, centerFrep, frepBeatsNext)
        }
    }
}

/**
 * `bevel_build_rings` (`:5888`) - with the boundary built and its BMVerts made, compute the interior
 * positions for the `M_ADJ` pattern, make the BMVerts and make the faces.
 */
export function bevelBuildRings(bp: BevelParams, bm: BMesh, bv: BevVert, vpipe: BoundVert | null): void {
    const matNr = bp.matNr

    const nBndv = bv.vmesh.count
    const ns = bv.vmesh.seg
    const ns2 = Math.floor(ns / 2)
    const odd = ns % 2

    let vm1: VMesh
    if (bp.proSuperR === PRO_SQUARE_R && bv.selcount >= 3 && !odd &&
        bp.profileType !== BEVEL_PROFILE.CUSTOM) {
        vm1 = squareOutAdjVmesh(bv)
    } else if (vpipe) {
        vm1 = pipeAdjVmesh(bp, bv, vpipe)
    } else if (triCornerTest(bp, bv) === 1) {
        vm1 = triCornerAdjVmesh(bp, bv)
        /* The PRO_SQUARE_IN_R profile has boundary edges that merge and no internal ring polygons
         * except possibly the centre ngon. */
        if (bp.proSuperR === PRO_SQUARE_IN_R && bp.profileType !== BEVEL_PROFILE.CUSTOM) {
            buildSquareInVmesh(bp, bm, bv, vm1)
            return
        }
    } else {
        vm1 = adjVmesh(bp, bv)
    }

    // Copy the final vmesh into bv.vmesh, then make the BMVerts and BMFaces.
    const vm = bv.vmesh
    for (let i = 0; i < nBndv; i++) {
        for (let j = 0; j <= ns2; j++) {
            for (let k = 0; k <= ns; k++) {
                if (j === 0 && (k === 0 || k === ns)) {
                    continue // The boundary corners are already made.
                }
                if (!isCanon(vm, i, j, k)) continue
                copyV3V3(meshVert(vm, i, j, k).co, meshVert(vm1, i, j, k).co)
                createMeshBmvert(bm, bp, vm, i, j, k, bv.v)
            }
        }
    }
    vmeshCopyEquivVerts(vm)

    // Find and store the interpolation face for each bound vert.
    const bndvRepFaces: (BMFace | null)[] = new Array(nBndv).fill(null)
    let bndv = vm.boundstart!
    do {
        bndvRepFaces[bndv.index] = boundvertRepFace(bndv)
        bndv = bndv.next
    } while (bndv !== vm.boundstart)

    // With an odd number of segments we need data to break the interpolation ties.
    let centerVerts: BMVert[] = []
    let centerEdgeSnaps: (BMEdge | null)[] = []
    let centerFaceInterps: (BMFace | null)[] = []
    let frepBeatsNext: boolean[] = []
    let centerFrep: BMFace | null = null
    if (odd && bp.affectType === BEVEL_AFFECT.EDGES) {
        centerVerts = new Array(nBndv)
        centerEdgeSnaps = new Array(nBndv).fill(null)
        centerFaceInterps = new Array(nBndv).fill(null)
        frepBeatsNext = new Array(nBndv).fill(false)
        centerFrep = frepForCenterPoly(bp, bv)
        for (let i = 0; i < nBndv; i++) {
            // frepBeatsNext[i] is true when the frep for i is chosen over that for i + 1.
            const inext = (i + 1) % nBndv
            const fchoices: (BMFace | null)[] = [bndvRepFaces[i], bndvRepFaces[inext]]
            const fwinner = chooseRepFace(bp, fchoices, 2)
            frepBeatsNext[i] = fwinner === bndvRepFaces[i]
        }
    }

    // Make the polygons.
    bndv = vm.boundstart!
    do {
        const i = bndv.index
        const inext = bndv.next.index
        const f = bndvRepFaces[i]
        const f2 = bndvRepFaces[inext]
        let fc: BMFace | null = null
        if (odd && bp.affectType === BEVEL_AFFECT.EDGES) {
            fc = frepBeatsNext[i] ? f : f2
        }

        let e: EdgeHalf | null
        let eprev: EdgeHalf | null
        let enext: EdgeHalf | null
        if (bp.affectType === BEVEL_AFFECT.VERTICES) {
            e = bndv.efirst
            eprev = bndv.prev.efirst
            enext = bndv.next.efirst
        } else {
            e = bndv.ebev
            eprev = bndv.prev.ebev
            enext = bndv.next.ebev
        }
        const bme = e ? e.e : null
        const bmeprev = eprev ? eprev.e : null
        const bmenext = enext ? enext.e : null
        /* For odd ns, make polygons with lower left corner at (i, j, k) for j in [0, ns2 - 1] and
         * k in [0, ns2], and then the centre ngon. For even ns, k in [0, ns2 - 1].
         * j is the ring index, k the segment index. */
        for (let j = 0; j < ns2; j++) {
            for (let k = 0; k < ns2 + odd; k++) {
                const bmv1 = meshVert(vm, i, j, k).v!
                const bmv2 = meshVert(vm, i, j, k + 1).v!
                const bmv3 = meshVert(vm, i, j + 1, k + 1).v!
                const bmv4 = meshVert(vm, i, j + 1, k).v!
                const bmvs = [bmv1, bmv2, bmv3, bmv4]
                /* Each corner may interpolate in a different face and may need to snap to a
                 * particular edge first; `fr` and `se` hold those, in the order of `bmvs`. */
                const fr: (BMFace | null)[] = [f, f, f, f]
                const se: (BMEdge | null)[] = [null, null, null, null]
                if (bp.affectType === BEVEL_AFFECT.VERTICES) {
                    fr[0] = fr[1] = fr[2] = fr[3] = f2
                    if (j < k) {
                        if (k === ns2 && j === ns2 - 1) {
                            se[2] = bndv.next.efirst!.e
                            se[3] = bme
                        }
                    } else if (j === k) {
                        // Only one edge is attached to v, since this is a vertex bevel.
                        se[0] = se[2] = bme
                        if (e && !e.isSeam) {
                            fr[3] = f
                        }
                    }
                } else {
                    fr[0] = fr[1] = fr[2] = fr[3] = f
                    if (odd) {
                        const b1 = (eprev && eprev.isSeam) ? bmeprev : null
                        const b2 = (e && e.isSeam) ? bme : null
                        const b3 = (enext && enext.isSeam) ? bmenext : null
                        snapEdgesForVmeshVert(i, j, k, ns, ns2, nBndv, b1, b2, b3,
                            bndvRepFaces, centerFrep, frepBeatsNext, se)
                        if (k === ns2) {
                            if (!e || e.isSeam) {
                                fr[0] = fr[1] = fr[2] = fr[3] = fc
                            } else {
                                fr[0] = fr[3] = f
                                fr[1] = fr[2] = f2
                            }
                            if (j === ns2 - 1) {
                                // The 4th vertex of these faces is the one used for the centre polygon.
                                centerVerts[i] = bmvs[3]
                                centerEdgeSnaps[i] = se[3]
                                centerFaceInterps[i] = bv.anySeam ? centerFrep : f
                            }
                        }
                    } else {
                        if (k === ns2 - 1) {
                            se[1] = bme
                        }
                        if (j === ns2 - 1 && bndv.prev.ebev) {
                            se[3] = bmeprev
                        }
                        se[2] = se[1] !== null ? se[1] : se[3]
                    }
                }
                const rF = bevCreateNgon(bp, bm, bmvs, 4, fr, null, se, bv.v, null, matNr, true)
                recordFaceKind(bp, rF, FKind.VERT)
            }
        }
        bndv = bndv.next
    } while (bndv !== vm.boundstart)

    // The centre ngon.
    if (odd) {
        if (bp.affectType === BEVEL_AFFECT.EDGES) {
            let frep: BMFace | null = null
            if (bv.anySeam) {
                frep = frepForCenterPoly(bp, bv)
            }
            const cenF = bevCreateNgon(bp, bm, centerVerts, nBndv, centerFaceInterps, frep,
                centerEdgeSnaps, bv.v, null, matNr, true)
            recordFaceKind(bp, cenF, FKind.VERT)
        } else {
            buildCenterNgon(bp, bm, bv, matNr)
        }
    }
}

/**
 * `bevel_build_cutoff` (`:6123`) - the "cutoff" vertex mesh, a flat face closing off each incoming
 * edge's profile plus, usually, one face across the bottom.
 *
 * Blender's TODOs are unresolved upstream and are reproduced here rather than worked around: the
 * combination with a non-sharp outer miter does not work, because miter profiles have no `planeNo`
 * filled in and indexing their profile points by `(i, 0, k)` returns zeros except at the ends.
 * `BM_mesh_bevel` therefore forces both miters to sharp whenever the cutoff method is selected.
 */
export function bevelBuildCutoff(bp: BevelParams, bm: BMesh, bv: BevVert): void {
    const nBndv = bv.vmesh.count

    // Find the locations of the corner vertices at the bottom of the cutoff faces.
    let bndv = bv.vmesh.boundstart!
    do {
        const i = bndv.index

        /* The "down" direction for this side of the cutoff face: along the intersection of the two
         * adjacent profile normals. */
        const downDirection = nv3()
        crossV3V3V3(downDirection, bndv.profile.planeNo, bndv.prev.profile.planeNo)
        if (dotV3V3(downDirection, [bv.v.nx, bv.v.ny, bv.v.nz]) > 0.0) {
            negateV3(downDirection)
        }

        // Move down from the bound vert by the average profile height of the two adjacent profiles.
        const length = (bndv.profile.height / Math.sqrt(2.0) +
            bndv.prev.profile.height / Math.sqrt(2.0)) / 2
        const newVertCo = nv3()
        maddV3V3V3Fl(newVertCo, bndv.nv.co, downDirection, length)

        // This location is this profile's first corner vert and the previous profile's second.
        copyV3V3(meshVert(bv.vmesh, i, 1, 0).co, newVertCo)
        copyV3V3(meshVert(bv.vmesh, bndv.prev.index, 1, 1).co, newVertCo)

        bndv = bndv.next
    } while (bndv !== bv.vmesh.boundstart)

    // Disable the centre face when the corner vertices share the same location.
    let buildCenterFace = true
    if (nBndv === 3) { // Vertices only collapse with a 3-way VMesh.
        buildCenterFace = buildCenterFace &&
            lenSquaredV3V3(meshVert(bv.vmesh, 0, 1, 0).co, meshVert(bv.vmesh, 1, 1, 0).co) > BEVEL_EPSILON
        buildCenterFace = buildCenterFace &&
            lenSquaredV3V3(meshVert(bv.vmesh, 0, 1, 0).co, meshVert(bv.vmesh, 2, 1, 0).co) > BEVEL_EPSILON
        buildCenterFace = buildCenterFace &&
            lenSquaredV3V3(meshVert(bv.vmesh, 1, 1, 0).co, meshVert(bv.vmesh, 2, 1, 0).co) > BEVEL_EPSILON
    }

    // Create the corner vertex BMVerts.
    if (buildCenterFace) {
        do {
            const i = bndv.index
            createMeshBmvert(bm, bp, bv.vmesh, i, 1, 0, bv.v)
            // The second corner vertex of the previous profile shares this BMVert.
            meshVert(bv.vmesh, bndv.prev.index, 1, 1).v = meshVert(bv.vmesh, i, 1, 0).v
            bndv = bndv.next
        } while (bndv !== bv.vmesh.boundstart)
    } else {
        // Use the same BMVert for all the corner vertices.
        createMeshBmvert(bm, bp, bv.vmesh, 0, 1, 0, bv.v)
        for (let i = 1; i < nBndv; i++) {
            meshVert(bv.vmesh, i, 1, 0).v = meshVert(bv.vmesh, 0, 1, 0).v
        }
    }

    // Build the profile cutoff faces.
    const faceBmverts: BMVert[] = []
    bndv = bv.vmesh.boundstart!
    do {
        const i = bndv.index
        faceBmverts.length = 0

        // The first corner vertex under this bound vert.
        faceBmverts.push(meshVert(bv.vmesh, i, 1, 0).v!)

        // The profile point vertices, including the last one.
        for (let k = 0; k < bp.seg + 1; k++) {
            faceBmverts.push(meshVert(bv.vmesh, i, 0, k).v!)
        }

        // The second corner vertex completes the bottom of the face.
        if (buildCenterFace) {
            faceBmverts.push(meshVert(bv.vmesh, i, 1, 1).v!)
        }

        bevCreateNgon(bp, bm, faceBmverts, faceBmverts.length, null, null, null, bv.v, null,
            bp.matNr, true)
        bndv = bndv.next
    } while (bndv !== bv.vmesh.boundstart)

    // The bottom face, if it should be built.
    if (buildCenterFace) {
        const bottom: BMVert[] = []
        for (let i = 0; i < nBndv; i++) {
            bottom.push(meshVert(bv.vmesh, i, 1, 0).v!)
        }
        bevCreateNgon(bp, bm, bottom, nBndv, null, null, null, bv.v, null, bp.matNr, true)
    }
}

/** `bevel_build_poly` (`:6263`) - the corner as one flat n-gon through every boundary vertex. */
export function bevelBuildPoly(bp: BevelParams, bm: BMesh, bv: BevVert): BMFace | null {
    const vm = bv.vmesh
    const bmverts: BMVert[] = []
    const bmedges: (BMEdge | null)[] = []
    const bmfaces: (BMFace | null)[] = []

    let repface: BMFace | null
    let repfaceE1: BMEdge | null
    let repfaceE2: BMEdge | null
    let unsnapped: (BoundVert | null)[] = [null, null, null]
    if (bv.anySeam) {
        repface = frepForCenterPoly(bp, bv)
        const inc = getIncidentEdges(repface, bv.v)
        repfaceE1 = inc[0]
        repfaceE2 = inc[1]
        unsnapped = findFaceInternalBoundverts(bv, repface)
    } else {
        repface = null
        repfaceE1 = repfaceE2 = null
    }
    let bndv = vm.boundstart!
    let n = 0
    do {
        // Accumulate the vertices, and the face each corner's data is interpolated in.
        bmverts.push(bndv.nv.v!)
        if (repface) {
            bmfaces.push(repface)
            if (bndv === unsnapped[0] || bndv === unsnapped[1] || bndv === unsnapped[2]) {
                bmedges.push(null)
            } else if (repfaceE1 && repfaceE2) {
                bmedges.push(findCloserEdge(co(bndv.nv.v!), repfaceE1, repfaceE2))
            } else {
                bmedges.push(null)
            }
        } else {
            bmfaces.push(boundvertRepFace(bndv))
            bmedges.push(null)
        }
        n++
        if (bndv.ebev && bndv.ebev.seg > 1) {
            for (let k = 1; k < bndv.ebev.seg; k++) {
                bmverts.push(meshVert(vm, bndv.index, 0, k).v!)
                if (repface) {
                    bmfaces.push(repface)
                    if (repfaceE1 && repfaceE2) {
                        const frepE = findCloserEdge(co(meshVert(vm, bndv.index, 0, k).v!), repfaceE1, repfaceE2)
                        bmedges.push(k < bndv.ebev.seg / 2 ? null : frepE)
                    } else {
                        bmedges.push(null)
                    }
                } else {
                    bmfaces.push(boundvertRepFace(bndv))
                    bmedges.push(null)
                }
                n++
            }
        }
        bndv = bndv.next
    } while (bndv !== vm.boundstart)

    let f: BMFace | null
    if (n > 2) {
        f = bevCreateNgon(bp, bm, bmverts, n, bmfaces, repface, bmedges, bv.v, null, bp.matNr, true)
        recordFaceKind(bp, f, FKind.VERT)
    } else {
        f = null
    }
    return f
}

/** `bevel_build_trifan` (`:6342`) - the poly, then fanned into triangles from one vertex. */
export function bevelBuildTrifan(bp: BevelParams, bm: BMesh, bv: BevVert): void {
    let f = bevelBuildPoly(bp, bm, bv)

    if (f === null) {
        return
    }

    // We have a polygon which we know starts at the previous vertex; make it into a fan.
    let lFan: BMLoop = f.lFirst.prev
    const vFan = lFan.v

    while (f.len > 3) {
        const {fNew, eNew} = splitFaceMakeEdge(bm, f, lFan, lFan.next.next)
        /* Blender's `BM_face_split` hands back `l_new`, which is `l_f2`: the loop of the new edge
         * that belongs to the *new* face. The kernel returns the edge instead, so recover the loop
         * from its radial cycle. */
        let lNew: BMLoop = eNew.l!
        while (lNew.f !== fNew) lNew = lNew.radialNext!
        flagOutEdge(bp, eNew)

        if (fNew.len > f.len) {
            f = fNew
            if (lNew.v === vFan) {
                lFan = lNew
            } else if (lNew.next.v === vFan) {
                lFan = lNew.next
            } else if (lNew.prev.v === vFan) {
                lFan = lNew.prev
            }
        } else {
            if (lFan.v === vFan) {
                // lFan = lFan.
            } else if (lFan.next.v === vFan) {
                lFan = lFan.next
            } else if (lFan.prev.v === vFan) {
                lFan = lFan.prev
            }
        }
        recordFaceKind(bp, fNew, FKind.VERT)
    }
}

/**
 * `bevel_vert_two_edges` (`:6400`) - vertex bevel with only two boundary verts, which wants a curved
 * edge rather than a face.
 *
 * When there are no faces at the original vertex there is no rebuilt face to carry the edge between
 * the two boundary verts, so the edges are created here.
 */
export function bevelVertTwoEdges(bp: BevelParams, bm: BMesh, bv: BevVert): void {
    const vm = bv.vmesh

    let v1 = meshVert(vm, 0, 0, 0).v!
    let v2 = meshVert(vm, 1, 0, 0).v!

    const ns = vm.seg
    if (ns > 1) {
        const bndv = vm.boundstart!
        const pro = bndv.profile
        pro.superR = bp.proSuperR
        copyV3V3(pro.start, co(v1))
        copyV3V3(pro.end, co(v2))
        copyV3V3(pro.middle, co(bv.v))
        // No projection.
        zeroV3(pro.planeCo)
        zeroV3(pro.planeNo)
        zeroV3(pro.projDir)

        for (let k = 1; k < ns; k++) {
            const point = nv3()
            getProfilePoint(bp, pro, k, ns, point)
            copyV3V3(meshVert(vm, 0, 0, k).co, point)
            createMeshBmvert(bm, bp, vm, 0, 0, k, bv.v)
        }
        copyV3V3(meshVert(vm, 0, 0, ns).co, co(v2))
        for (let k = 1; k < ns; k++) {
            copyMeshVert(vm, 1, 0, ns - k, 0, 0, k)
        }
    }

    if (vertFaceCheck(bv.v) === false) {
        const eEg = bv.edges[0].e
        for (let k = 0; k < ns; k++) {
            v1 = meshVert(vm, 0, 0, k).v!
            v2 = meshVert(vm, 0, 0, k + 1).v!
            const bme = edgeCreateFrom(bm, v1, v2, eEg, true)
            flagOutEdge(bp, bme)
        }
    }
}

/**
 * `build_vmesh` (`:6452`) - with the boundary built, make the actual BMVerts for the boundary and
 * the interior, then dispatch on {@link MeshKind}.
 *
 * The "weld" case - exactly two beveled edges meeting at a vertex with a two-vertex boundary - is
 * where a bevel just runs along a chain of edges; there is no corner to fill, only a profile
 * connecting the two sides, and the two profiles must agree, which is what the `PRO_LINE_R` checks
 * below arbitrate.
 */
export function buildVmesh(bp: BevelParams, bm: BMesh, bv: BevVert): void {
    const vm = bv.vmesh
    const point = nv3()

    const n = vm.count
    const ns = vm.seg
    const ns2 = Math.floor(ns / 2)

    const total = n * (ns2 + 1) * (ns + 1)
    const mesh: NewVert[] = new Array(total)
    for (let i = 0; i < total; i++) mesh[i] = newVert()
    vm.mesh = mesh

    // Special case: just two beveled edges welded together.
    const weld = bv.selcount === 2 && vm.count === 2
    let weld1: BoundVert | null = null
    let weld2: BoundVert | null = null

    // Make the (i, 0, 0) mesh verts for every bound vert.
    let bndv = vm.boundstart!
    do {
        const i = bndv.index
        copyV3V3(meshVert(vm, i, 0, 0).co, bndv.nv.co)
        createMeshBmvert(bm, bp, vm, i, 0, 0, bv.v)
        bndv.nv.v = meshVert(vm, i, 0, 0).v

        // Find the bound verts and move the profile planes when this is a weld.
        if (weld && bndv.ebev) {
            if (!weld1) {
                weld1 = bndv
            } else {
                weld2 = bndv
                setProfileParams(bp, bv, weld1)
                setProfileParams(bp, bv, weld2)
                moveWeldProfilePlanes(bv, weld1, weld2)
            }
        }
        bndv = bndv.next
    } while (bndv !== vm.boundstart)

    /* It is simpler to calculate all the profiles at one moment, so this is the single profile
     * calculation, the last point before the actual mesh verts are created. */
    calculateVmProfiles(bp, bv, vm)

    // Copy the other ends to (i, 0, ns) for every i, and fill in the profiles for the edges.
    bndv = vm.boundstart!
    do {
        const i = bndv.index
        // This bound vert's last vertex along the boundary arc is the first of the next one's arc.
        copyMeshVert(vm, i, 0, ns, bndv.next.index, 0, 0)

        if (vm.meshKind !== MeshKind.ADJ) {
            for (let k = 1; k < ns; k++) {
                if (bndv.ebev) {
                    getProfilePoint(bp, bndv.profile, k, ns, point)
                    copyV3V3(meshVert(vm, i, 0, k).co, point)
                    if (!weld) {
                        // For a weld this happens later with better positions.
                        createMeshBmvert(bm, bp, vm, i, 0, k, bv.v)
                    }
                } else if (n === 2 && !bndv.ebev) {
                    // One edge beveled and this is the bound vert without `ebev`: copy in reverse.
                    copyMeshVert(bv.vmesh, i, 0, k, 1 - i, 0, ns - k)
                }
            }
        }
        bndv = bndv.next
    } while (bndv !== vm.boundstart)

    // Build the profile for the weld case - just a connection between the two bound verts.
    if (weld && weld1 && weld2) {
        bv.vmesh.meshKind = MeshKind.NONE
        for (let k = 1; k < ns; k++) {
            const vWeld1 = meshVert(bv.vmesh, weld1.index, 0, k).co
            const vWeld2 = meshVert(bv.vmesh, weld2.index, 0, ns - k).co
            if (bp.profileType === BEVEL_PROFILE.CUSTOM) {
                midV3V3V3(point, vWeld1, vWeld2)
            } else if (weld1.profile.superR === PRO_LINE_R && weld2.profile.superR !== PRO_LINE_R) {
                // Use the point from the other profile when one is in a special case.
                copyV3V3(point, vWeld2)
            } else if (weld2.profile.superR === PRO_LINE_R && weld1.profile.superR !== PRO_LINE_R) {
                copyV3V3(point, vWeld1)
            } else {
                // In case the profiles are not snapped to the same plane, use their midpoint.
                midV3V3V3(point, vWeld1, vWeld2)
            }
            copyV3V3(meshVert(bv.vmesh, weld1.index, 0, k).co, point)
            createMeshBmvert(bm, bp, bv.vmesh, weld1.index, 0, k, bv.v)
        }
        for (let k = 1; k < ns; k++) {
            copyMeshVert(bv.vmesh, weld2.index, 0, ns - k, weld1.index, 0, k)
        }
    }

    // Make sure the pipe case uses the ADJ mesh for both the grid-fill and cutoff options.
    let vpipe: BoundVert | null = null
    if ((vm.count === 3 || vm.count === 4) && bp.seg > 1) {
        vpipe = pipeTest(bv)
        if (vpipe) {
            vm.meshKind = MeshKind.ADJ
        }
    }

    switch (vm.meshKind) {
    case MeshKind.NONE:
        if (n === 2 && bp.affectType === BEVEL_AFFECT.VERTICES) {
            bevelVertTwoEdges(bp, bm, bv)
        }
        break
    case MeshKind.POLY:
        bevelBuildPoly(bp, bm, bv)
        break
    case MeshKind.ADJ:
        bevelBuildRings(bp, bm, bv, vpipe)
        break
    case MeshKind.TRI_FAN:
        bevelBuildTrifan(bp, bm, bv)
        break
    case MeshKind.CUTOFF:
        bevelBuildCutoff(bp, bm, bv)
        break
    }
}

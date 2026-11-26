/**
 * The width-evening pass.
 *
 * Ported from `bmesh_bevel.cc:3942-4346`.
 *
 * With loop slide on, the meeting point between two beveled edges is chosen to sit on an existing
 * edge rather than to give both sides their requested width, so the two ends of one beveled edge can
 * come out different widths. The dependent offsets turn out to form chains and cycles - each bound
 * vert with `eon` set links the left side of one edge to the right side of the next - so
 * {@link adjustOffsets} walks those and hands each one to {@link adjustTheCycleOrChain}, which
 * solves a small least-squares problem balancing "both ends of every edge should be equal" against
 * "every offset should match its spec", the second weighted down by `BEVEL_MATCH_SPEC_WEIGHT`.
 *
 * ### The one substitution in this port
 *
 * Blender builds that problem with `EIG_linear_least_squares_solver_new` and solves it with Eigen
 * (`intern/eigen/intern/linear_solver.cc`, which forms the normal equations `AᵀA x = Aᵀb` and
 * factorises them). Eigen is a general numerical library, not a Blender algorithm, and there is
 * nothing in it specific to bevel to port. {@link solveLeastSquares} below therefore implements the
 * same documented contract - the minimiser of `||Ax - b||₂` - by forming the same normal equations
 * and solving them with Gaussian elimination with partial pivoting. The systems here are tiny (one
 * unknown per bound vert in a chain), so a dense solve is both fast enough and better conditioned
 * than it would be at scale. This is the only place in the bevel port where the implementation is
 * not a line-for-line transcription, and it is flagged in the report.
 */

import {BMEdge} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {ElemFlag} from '../constants'
import {compareFf, dotV3V3, normalizeV3, nv3, subV3V3V3} from './bevel-math'
import {
    BEVEL_MATCH_SPEC_WEIGHT, BEVEL_SMALL_ANG_DOT, BevVert, BevelParams, BoundVert, EdgeHalf,
    findBevVert, findEdgeHalf, findOtherEndEdgeHalf,
} from './bevel-types'
import {co} from './bevel-bmquery'
import {buildBoundary} from './bevel-boundary'

/**
 * Minimise `||A x - b||₂` for an `nrows x ncols` matrix with `nrows >= ncols`.
 *
 * Normal equations plus Gaussian elimination with partial pivoting. Returns null when the system is
 * singular, which the caller treats as "leave the offsets alone" - the same outcome as Blender
 * getting a failed factorisation.
 */
export function solveLeastSquares(a: number[][], b: number[], nrows: number, ncols: number): number[] | null {
    // Normal equations: (AᵀA) x = Aᵀb.
    const ata: number[][] = []
    for (let i = 0; i < ncols; i++) {
        ata.push(new Array(ncols + 1).fill(0))
    }
    for (let i = 0; i < ncols; i++) {
        for (let j = 0; j < ncols; j++) {
            let s = 0
            for (let r = 0; r < nrows; r++) s += a[r][i] * a[r][j]
            ata[i][j] = s
        }
        let s = 0
        for (let r = 0; r < nrows; r++) s += a[r][i] * b[r]
        ata[i][ncols] = s
    }

    // Gaussian elimination with partial pivoting.
    for (let k = 0; k < ncols; k++) {
        let piv = k
        let best = Math.abs(ata[k][k])
        for (let r = k + 1; r < ncols; r++) {
            const v = Math.abs(ata[r][k])
            if (v > best) {
                best = v
                piv = r
            }
        }
        if (best < 1e-20) {
            return null
        }
        if (piv !== k) {
            const t = ata[k]
            ata[k] = ata[piv]
            ata[piv] = t
        }
        const pivval = ata[k][k]
        for (let r = k + 1; r < ncols; r++) {
            const f = ata[r][k] / pivval
            if (f === 0) continue
            for (let c = k; c <= ncols; c++) {
                ata[r][c] -= f * ata[k][c]
            }
        }
    }

    const x = new Array(ncols).fill(0)
    for (let k = ncols - 1; k >= 0; k--) {
        let s = ata[k][ncols]
        for (let c = k + 1; c < ncols; c++) s -= ata[k][c] * x[c]
        x[k] = s / ata[k][k]
    }
    return x
}

/**
 * `next_edgehalf_bev` (`:3942`) - the next beveled EdgeHalf along a path.
 *
 * Blender's note is the important part: the most-parallel candidate is only accepted when it beats
 * the runner-up by at least ten degrees, so a consistent-orientation path only continues in ways
 * that are obvious. A near-tie ends the path instead of guessing.
 *
 * @param towardBv travel across the BevVert rather than to the other end of the same edge.
 */
export function nextEdgehalfBev(
    bp: BevelParams, startEdge: EdgeHalf, towardBv: boolean, rBv: {bv: BevVert | null},
): EdgeHalf | null {
    /* Case 1: the next EdgeHalf is the other side of the same BMEdge, so it is known to be beveled
     * too. */
    if (!towardBv) {
        return findOtherEndEdgeHalf(bp, startEdge, rBv)
    }

    // Case 2: the next EdgeHalf is across a BevVert from the current one.
    if (rBv.bv!.selcount === 1) {
        return null // No other edges to go to; this is an end.
    }

    if (rBv.bv!.selcount === 2) {
        // Just find the next beveled edge, which is the only other option.
        let newEdge = startEdge
        do {
            newEdge = newEdge.next
        } while (!newEdge.isBev)
        return newEdge
    }

    /* The direction of the current edge, pointing INTO the BevVert. `v1` and `v2` have no fixed
     * order, so check which is the BevVert's. */
    const dirStartEdge = nv3()
    if (startEdge.e.v1 === rBv.bv!.v) {
        subV3V3V3(dirStartEdge, co(startEdge.e.v1), co(startEdge.e.v2))
    } else {
        subV3V3V3(dirStartEdge, co(startEdge.e.v2), co(startEdge.e.v1))
    }
    normalizeV3(dirStartEdge)

    // The beveled edge out of the BevVert that is most parallel to the current one.
    let newEdge = startEdge.next
    let secondBestDot = 0.0
    let bestDot = 0.0
    let nextEdge: EdgeHalf | null = null
    while (newEdge !== startEdge) {
        if (!newEdge.isBev) {
            newEdge = newEdge.next
            continue
        }
        // The direction of the candidate, pointing OUT of the BevVert.
        const dirNewEdge = nv3()
        if (newEdge.e.v2 === rBv.bv!.v) {
            subV3V3V3(dirNewEdge, co(newEdge.e.v1), co(newEdge.e.v2))
        } else {
            subV3V3V3(dirNewEdge, co(newEdge.e.v2), co(newEdge.e.v1))
        }
        normalizeV3(dirNewEdge)

        const newDot = dotV3V3(dirNewEdge, dirStartEdge)
        if (newDot > bestDot) {
            secondBestDot = bestDot
            bestDot = newDot
            nextEdge = newEdge
        } else if (newDot > secondBestDot) {
            secondBestDot = newDot
        }

        newEdge = newEdge.next
    }

    // Only accept the candidate when the choice was not too close.
    if (nextEdge !== null && compareFf(bestDot, secondBestDot, BEVEL_SMALL_ANG_DOT)) {
        return null
    }
    return nextEdge
}

/**
 * `regularize_profile_orientation` (`:4027`) - walk the chain or cycle of beveled edges through
 * `bme` and mark a consistent side of each profile as its start.
 *
 * Only matters for an asymmetric (custom) profile, which is why `BM_mesh_bevel` only calls this when
 * `profileType` is custom. Ported anyway because it is small and because `isProfileStart` is read by
 * `calculateVmProfiles` regardless.
 */
export function regularizeProfileOrientation(bp: BevelParams, bme: BMEdge): void {
    const startBv = findBevVert(bp, bme.v1)
    if (!startBv) return
    const startEdgehalf = findEdgeHalf(startBv, bme)
    if (!startEdgehalf || !startEdgehalf.isBev || startEdgehalf.visitedRpo) {
        return
    }

    /* Pick a bound vert on one side of the profile to be the start. Blender uses whichever is
     * highest on Z, on the grounds that any rule beats an arbitrary decision. */
    const rightHighest = startEdgehalf.leftv!.nv.co[2] < startEdgehalf.rightv!.nv.co[2]
    startEdgehalf.leftv!.isProfileStart = rightHighest
    startEdgehalf.visitedRpo = true

    // The first loop starts away from the BevVert and the second towards it.
    for (let i = 0; i < 2; i++) {
        const bvRef: {bv: BevVert | null} = {bv: startBv}
        let towardBv = i === 0
        let edgehalf = nextEdgehalfBev(bp, startEdgehalf, towardBv, bvRef)

        while (edgehalf && !edgehalf.visitedRpo) {
            /* Mark the correct bound vert as the start of the newly visited profile. The direction
             * relative to the BevVert flips every step, so the orientation flips with it. */
            if (i === 0) {
                edgehalf.leftv!.isProfileStart = towardBv !== rightHighest
            } else {
                edgehalf.leftv!.isProfileStart = (!towardBv) !== rightHighest
            }

            towardBv = !towardBv

            edgehalf.visitedRpo = true
            edgehalf = nextEdgehalfBev(bp, edgehalf, towardBv, bvRef)
        }
    }
}

/**
 * `adjust_the_cycle_or_chain` (`:4078`) - solve one chain or cycle.
 *
 * One unknown per bound vert: the right offset of its first edge. The left offset of its last edge
 * is `sinratio` times that, which is what makes the problem one-dimensional per link. Three residues
 * per unknown: the width difference across a link, and the two spec matches weighted by
 * `BEVEL_MATCH_SPEC_WEIGHT` so the even-width constraint dominates.
 *
 * Blender's `adjust_the_cycle_or_chain_fast` (`:3859`) is not ported. It is inside `#ifdef
 * FAST_ADJUST_CODE`, which is never defined, and its own comment says its results are in some cases
 * worse than the least-squares solution and that it is kept only in case of future performance
 * problems.
 */
export function adjustTheCycleOrChain(vstart: BoundVert, iscycle: boolean): void {
    let np = 0
    let v: BoundVert | null = vstart
    do {
        np++
        v = v.adjchain
    } while (v && v !== vstart)

    const nrows = iscycle ? 3 * np : 3 * np - 3

    const a: number[][] = []
    for (let r = 0; r < nrows; r++) a.push(new Array(np).fill(0))
    const b: number[] = new Array(nrows).fill(0)

    // The square root of the factor weighting down the importance of matching the spec.
    const weight = BEVEL_MATCH_SPEC_WEIGHT

    v = vstart
    let i = 0
    do {
        // Except at the end of a chain, v's independent variable is `offsetR` of `v.efirst`.
        if (iscycle || i < np - 1) {
            const eright = v!.efirst!
            const enextleft = v!.adjchain!.elast!

            // Residue i: the width difference between eright and the next one's eleft.
            a[i][i] += 1.0
            b[i] += 0.0
            if (iscycle) {
                a[i > 0 ? i - 1 : np - 1][i] += -v!.sinratio
            } else if (i > 0) {
                a[i - 1][i] += -v!.sinratio
            }

            // The right offset for parameter i matches its spec, weighted.
            let row = iscycle ? np + 2 * i : np - 1 + 2 * i
            a[row][i] += weight
            b[row] += weight * eright.offsetR

            // The left offset for parameter i matches its spec, weighted.
            row = row + 1
            a[row][i === np - 1 ? 0 : i + 1] += weight * v!.adjchain!.sinratio
            b[row] += weight * enextleft.offsetL
        } else {
            // Not a cycle, and the last of the chain: the second part of residue i - 1.
            a[i - 1][i] += -1.0
        }
        i++
        v = v!.adjchain
    } while (v && v !== vstart)

    const x = solveLeastSquares(a, b, nrows, np)
    if (!x) {
        return
    }

    // Use the solution to set the new widths.
    v = vstart
    i = 0
    do {
        const val = x[i]
        if (iscycle || i < np - 1) {
            const eright = v!.efirst!
            const eleft = v!.elast!
            eright.offsetR = val
            if (iscycle || v !== vstart) {
                eleft.offsetL = v!.sinratio * val
            }
        } else {
            const eleft = v!.elast!
            eleft.offsetL = val
        }
        i++
        v = v!.adjchain
    } while (v && v !== vstart)
}

/**
 * `adjust_offsets` (`:4240`) - find every chain and cycle of dependent offsets, solve each, then
 * rebuild all the boundaries with the new widths.
 *
 * Blender's note about iterating the mesh's vertices rather than the hash is about repeatability;
 * the same applies here, since a `Map`'s order is insertion order and that depends on which vertex
 * was constructed first.
 */
export function adjustOffsets(bp: BevelParams, bm: BMesh): void {
    for (const bmv of bm.verts) {
        if (!bmv.testFlag(ElemFlag.Tag)) {
            continue
        }
        const bv = findBevVert(bp, bmv)
        if (!bv) {
            continue
        }
        const bvcur: {bv: BevVert | null} = {bv}
        let vanchor = bv.vmesh.boundstart!
        do {
            if (vanchor.visited || !vanchor.eon) {
                vanchor = vanchor.next
                continue
            }

            /* Find either (1) a cycle that starts and ends at v where every v has `eon` set and had
             * not been visited before, or (2) a chain of v's where the start and end do not have
             * `eon` set but everything in between does. The first and last may have been visited
             * before, but none of the inner ones. The v's are chained through `adjchain` and
             * followed left to right, so the left side of one edge pairs with the right side of the
             * next. */
            let v: BoundVert = vanchor
            let vchainstart: BoundVert = vanchor
            let vchainend: BoundVert = vanchor

            let iscycle = false
            let chainlen = 1
            while (v.eon && !v.visited && !iscycle) {
                v.visited = true
                if (!v.efirst) break
                const enext = findOtherEndEdgeHalf(bp, v.efirst, bvcur)
                if (!enext) break
                const vnext = enext.leftv!
                v.adjchain = vnext
                vchainend = vnext
                chainlen++
                if (vnext.visited) {
                    if (vnext !== vchainstart) break
                    adjustTheCycleOrChain(vchainstart, true)
                    iscycle = true
                }
                v = vnext
            }
            if (!iscycle) {
                // Right to left, moving vchainstart at each step.
                v.adjchain = null
                v = vchainstart
                bvcur.bv = bv
                do {
                    v.visited = true
                    if (!v.elast) break
                    const enext = findOtherEndEdgeHalf(bp, v.elast, bvcur)
                    if (!enext) break
                    const vnext = enext.rightv!
                    vnext.adjchain = v
                    chainlen++
                    vchainstart = vnext
                    v = vnext
                } while (!v.visited && v.eon)
                if (chainlen >= 3 && !vchainstart.eon && !vchainend.eon) {
                    adjustTheCycleOrChain(vchainstart, false)
                }
            }
            vanchor = vanchor.next
        } while (vanchor !== bv.vmesh.boundstart)
    }

    // Rebuild the boundaries with the new width specs.
    for (const bmv of bm.verts) {
        if (bmv.testFlag(ElemFlag.Tag)) {
            const bv = findBevVert(bp, bmv)
            if (bv) {
                buildBoundary(bp, bv, false, bm)
            }
        }
    }
}

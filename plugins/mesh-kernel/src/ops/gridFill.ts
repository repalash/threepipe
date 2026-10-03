/**
 * Grid Fill: fill two opposite edge chains - or one closed loop of an even number of edges, cut into
 * two - with a grid of quads. Blender's `Face > Grid Fill` (`MESH_OT_fill_grid`).
 *
 * Ported from `source/blender/bmesh/operators/bmo_fill_grid.cc` (`bmo_grid_fill_exec` and everything
 * it calls) and `source/blender/editors/mesh/editmesh_tools.cc` (`edbm_fill_grid_vert_tag_angle`
 * :4771, `edbm_fill_grid_prepare` :4790, `edbm_fill_grid_split_join_init` :4956,
 * `edbm_fill_grid_split_join_finish` :5030, `edbm_fill_grid_exec` :5067, `MESH_OT_fill_grid` :5162).
 *
 * Blender's operator flags become sets beside the mesh: `EDGE_MARK` (the input edges) and `FACE_OUT`
 * (the grid) in {@link gridFill}, and `BM_ELEM_TAG` (the two chains `edbm_fill_grid_prepare` hands to
 * the bmesh operator) in {@link gridFillSelection}. `bmo_grid_fill_exec` temporarily *hides* the two
 * chains (`bm_edgeloop_flag_set(.., BM_ELEM_HIDDEN, true)`, :644) so the rail search cannot walk
 * along them, "putting the mesh in an invalid state for a short time"; here the chains go in a set
 * that the rail test reads alongside the real hidden flag, which is the same test without touching
 * the elements.
 *
 * The bmesh operator's `BMO_OPTYPE_FLAG_SELECT_FLUSH` (`bmesh_opdefines.cc:904`) is honoured (see
 * {@link bmoEditEnd}); `BMO_OPTYPE_FLAG_NORMALS_CALC` is not, because the kernel has no
 * `BM_mesh_normals_update` - normals are recomputed when the BMesh is converted back.
 *
 * Not ported, because the kernel has no such data: the multires (`CD_MDISPS`) flip of
 * `reverse_faces flip_multires=true` and `flip_custom_normals` in the split-join path (no custom
 * split normals on BMesh loops).
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdgeExists, diskEdges, edgeIsBoundary, edgeIsWire, radialLoops} from '../bmesh/structure'
import {
    BMEdgeLoopStore,
    edgeloopEdgesGet,
    edgeloopExpand,
    edgeloopFlip,
    edgeloopOverlapCheck,
    edgeloopsFind,
    edgeloopsFindPath,
} from '../bmesh/edgeloop'
import {copyElemAttrs, copyElemHeader, interpElemAttrs} from '../bmesh/customdata'
import {edgeCollapse} from '../bmesh/collapse'
import {faceNormalFlip} from '../bmesh/flip'
import {selectCountsRecalc, selectModeFlush} from '../bmesh/marking'
import {elemsHflagEnable} from '../bmesh/hflag'
import {ElemFlag, ElemType} from '../constants'
import {Vec3} from '../math'
import {angleV3V3V3, barycentricWeightsV2Quad, lenV3V3, modI, normalizeV3Len, transformPointByTriV3} from '../math/geom'
import {weldVerts} from './weld'

const co = (v: BMVert): Vec3 => [v.x, v.y, v.z]

/** `interp_v3_v3v3` (`math_vector_inline.cc`): `s * a + t * b` with `s = 1 - t`, in that form. */
function interpV3V3V3(a: Vec3, b: Vec3, t: number): Vec3 {
    const s = 1 - t
    return [s * a[0] + t * b[0], s * a[1] + t * b[1], s * a[2] + t * b[2]]
}

// region bmo_fill_grid.cc

/** Options of the `grid_fill` bmesh operator (`bmesh_opdefines.cc:878`). */
export interface GridFillOptions {
    /** `mat_nr`: "Material to use." Default 0. */
    matNr?: number
    /** `use_smooth`: "Smooth state to use." Default false. */
    useSmooth?: boolean
    /** `use_interp_simple`: "Use simple interpolation." Default false. */
    useInterpSimple?: boolean
}

export type GridFillResult =
    | {ok: true, /** `faces.out`: the new faces, in mesh order. */ faces: BMFace[]}
    | {ok: false, /** The `BMO_error_raise` message. */ error: string}

/** `quad_edges_to_normal` (`bmo_fill_grid.cc:36`): 2 edge vectors to normal. */
function quadEdgesToNormal(coA1: Vec3, coA2: Vec3, coB1: Vec3, coB2: Vec3): Vec3 {
    const diffA: Vec3 = [coA2[0] - coA1[0], coA2[1] - coA1[1], coA2[2] - coA1[2]]
    const diffB: Vec3 = [coB2[0] - coB1[0], coB2[1] - coB1[1], coB2[2] - coB1[2]]
    normalizeV3Len(diffA)
    normalizeV3Len(diffB)
    const no: Vec3 = [diffA[0] + diffB[0], diffA[1] + diffB[1], diffA[2] + diffB[2]]
    normalizeV3Len(no)
    return no
}

/**
 * `quad_verts_to_barycentric_tri` (`bmo_fill_grid.cc:53`): a triangle on the row `coA`-`coB`, its
 * apex lifted off the row's midpoint along the averaged direction to the next (and previous) row,
 * by the row's length. Rows are carried into each other with `transform_point_by_tri_v3` through
 * these triangles.
 */
function quadVertsToBarycentricTri(
    coA: Vec3, coB: Vec3, coANext: Vec3, coBNext: Vec3, coAPrev: Vec3 | null, coBPrev: Vec3 | null, isFlip: boolean,
): [Vec3, Vec3, Vec3] {
    const tri0: Vec3 = [coA[0], coA[1], coA[2]]
    const tri1: Vec3 = [coB[0], coB[1], coB[2]]

    const no = quadEdgesToNormal(coA, coANext, coB, coBNext)

    if (coAPrev) {
        const noT = quadEdgesToNormal(coAPrev, coA, coBPrev!, coB)
        no[0] += noT[0]
        no[1] += noT[1]
        no[2] += noT[2]
        normalizeV3Len(no)
    }

    if (isFlip) {
        no[0] = -no[0]
        no[1] = -no[1]
        no[2] = -no[2]
    }
    const len = lenV3V3(tri0, tri1)
    no[0] *= len
    no[1] *= len
    no[2] *= len

    const tri2: Vec3 = [
        (tri0[0] + tri1[0]) * 0.5 + no[0],
        (tri0[1] + tri1[1]) * 0.5 + no[1],
        (tri0[2] + tri1[2]) * 0.5 + no[2],
    ]
    return [tri0, tri1, tri2]
}

type LoopPair = [BMLoop | null, BMLoop | null]

/**
 * `bm_loop_pair_from_verts` (`bmo_fill_grid.cc:96`): the corners of `e.l`'s face at `vA` and `vB`
 * (which must share an edge), or nulls for a wire edge.
 */
function loopPairFromVerts(vA: BMVert, vB: BMVert): LoopPair {
    const e = diskEdgeExists(vA, vB)!
    if (e.l) {
        if (e.l.v === vA) return [e.l, e.l.next]
        return [e.l.next, e.l]
    }
    return [null, null]
}

/**
 * `bm_loop_pair_test_copy` (`bmo_fill_grid.cc:120`): copy a loop pair from one side to the other if
 * either is missing, "this simplifies interpolation code so we only need to check if x/y are
 * missing, rather than checking each loop".
 */
function loopPairTestCopy(lPairA: LoopPair, lPairB: LoopPair): void {
    // if the first one is set, we know the second is too
    if (lPairA[0] && lPairB[0] === null) {
        lPairB[0] = lPairA[1]
        lPairB[1] = lPairA[0]
    } else if (lPairB[0] && lPairA[0] === null) {
        lPairA[0] = lPairB[1]
        lPairA[1] = lPairB[0]
    }
}

/** `bm_loop_interp_from_grid_boundary_4` (`bmo_fill_grid.cc:138`). */
function loopInterpFromGridBoundary4(bm: BMesh, l: BMLoop, lBound: BMLoop[], w: readonly number[]): void {
    interpElemAttrs(l, lBound, w, bm.ldata)
}

/** `bm_loop_interp_from_grid_boundary_2` (`bmo_fill_grid.cc:149`). */
function loopInterpFromGridBoundary2(bm: BMesh, l: BMLoop, lBound: BMLoop[], t: number): void {
    interpElemAttrs(l, lBound, [1 - t, t], bm.ldata)
}

/**
 * `barycentric_weights_v2_grid_cache` (`bmo_fill_grid.cc:166`): `barycentric_weights_v2_quad` of
 * every grid point against the four boundary points on its row and column (bottom, left, top,
 * right), cached so it runs once per point.
 */
function barycentricWeightsV2GridCache(xtot: number, ytot: number): number[][] {
    const xStep = 1 / (xtot - 1)
    const yStep = 1 / (ytot - 1)
    const table: number[][] = []
    for (let y = 0; y < ytot; y++) {
        const yFl = yStep * y
        for (let x = 0; x < xtot; x++) {
            const xFl = xStep * x
            table.push(barycentricWeightsV2Quad([xFl, 0], [0, yFl], [xFl, 1], [1, yFl], [xFl, yFl]))
        }
    }
    return table
}

/**
 * `BM_elem_attrs_copy` for faces (`bmesh_construct.cc:380`): custom data, header flags except the
 * selection, the cached normal and the material.
 */
export function faceAttrsCopy(bm: BMesh, src: BMFace, dst: BMFace): void {
    copyElemAttrs(src, dst, bm.pdata)
    copyElemHeader(src, dst, 'face')
    dst.matNr = src.matNr
}

/** `CustomData_has_interp` (`customdata.cc`): does any layer of the domain interpolate? */
function customDataHasInterp(layout: BMesh['vdata']): boolean {
    return layout.layers.some(l => l.interpolates)
}

/**
 * `bm_grid_fill_array` (`bmo_fill_grid.cc:194`). `vGrid` is the `xtot * ytot` grid with every
 * boundary vertex set; the inside is created here, then the faces. Returns the faces (`FACE_OUT`).
 */
function gridFillArray(
    bm: BMesh, vGrid: (BMVert | null)[], xtot: number, ytot: number,
    matNr: number, useSmooth: boolean, useFlip: boolean, useInterpSimple: boolean,
): BMFace[] {
    const useVertInterp = customDataHasInterp(bm.vdata)
    const useLoopInterp = customDataHasInterp(bm.ldata)
    const XY = (x: number, y: number) => x + y * xtot
    const g = (i: number) => vGrid[i]!

    // BARYCENTRIC_INTERP
    const triA = quadVertsToBarycentricTri(
        co(g(XY(0, 0))), co(g(XY(xtot - 1, 0))), co(g(XY(0, 1))), co(g(XY(xtot - 1, 1))), null, null, false)
    const triB = quadVertsToBarycentricTri(
        co(g(XY(0, ytot - 1))), co(g(XY(xtot - 1, ytot - 1))),
        co(g(XY(0, ytot - 2))), co(g(XY(xtot - 1, ytot - 2))), null, null, true)

    const weightTable = (useInterpSimple || useVertInterp || useLoopInterp)
        ? barycentricWeightsV2GridCache(xtot, ytot) : null

    // Store loops ("x2 because each edge connects 2 loops").
    let larrXA: LoopPair[] = []
    let larrXB: LoopPair[] = []
    let larrYA: LoopPair[] = []
    let larrYB: LoopPair[] = []
    if (useLoopInterp) {
        larrXA = new Array(xtot - 1)
        larrXB = new Array(xtot - 1)
        larrYA = new Array(ytot - 1)
        larrYB = new Array(ytot - 1)
        for (let x = 0; x < xtot - 1; x++) {
            larrXA[x] = loopPairFromVerts(g(XY(x, 0)), g(XY(x + 1, 0)))
            larrXB[x] = loopPairFromVerts(g(XY(x, ytot - 1)), g(XY(x + 1, ytot - 1)))
            loopPairTestCopy(larrXA[x], larrXB[x])
        }
        for (let y = 0; y < ytot - 1; y++) {
            larrYA[y] = loopPairFromVerts(g(XY(0, y)), g(XY(0, y + 1)))
            larrYB[y] = loopPairFromVerts(g(XY(xtot - 1, y)), g(XY(xtot - 1, y + 1)))
            loopPairTestCopy(larrYA[y], larrYB[y])
        }
    }

    // Build Verts
    for (let y = 1; y < ytot - 1; y++) {
        const triT = quadVertsToBarycentricTri(
            co(g(XY(0, y))), co(g(XY(xtot - 1, y))),
            co(g(XY(0, y + 1))), co(g(XY(xtot - 1, y + 1))),
            co(g(XY(0, y - 1))), co(g(XY(xtot - 1, y - 1))), false)
        for (let x = 1; x < xtot - 1; x++) {
            // we may want to allow sparse filled arrays, but for now, ensure its empty
            if (vGrid[y * xtot + x] !== null) throw new Error('mesh-kernel: grid fill interior is not empty')

            let c: Vec3
            // place the vertex
            if (!useInterpSimple) {
                const coA = transformPointByTriV3(co(g(x)), triT, triA)
                // `v_grid[(xtot * ytot) + (x - xtot)]` is `XY(x, ytot - 1)`.
                const coB = transformPointByTriV3(co(g(XY(x, ytot - 1))), triT, triB)
                c = interpV3V3V3(coA, coB, y / (ytot - 1))
            } else {
                const w = weightTable![XY(x, y)]
                const p0 = g(XY(x, 0)), p1 = g(XY(0, y)), p2 = g(XY(x, ytot - 1)), p3 = g(XY(xtot - 1, y))
                c = [
                    p0.x * w[0] + p1.x * w[1] + p2.x * w[2] + p3.x * w[3],
                    p0.y * w[0] + p1.y * w[1] + p2.y * w[2] + p3.y * w[3],
                    p0.z * w[0] + p1.z * w[1] + p2.z * w[2] + p3.z * w[3],
                ]
            }

            const v = bm.vertCreate(c[0], c[1], c[2])
            vGrid[y * xtot + x] = v

            // "Interpolate only along one axis, this could be changed but from user POV gives
            // predictable results since these are selected loop."
            if (useVertInterp) {
                const w = weightTable![XY(x, y)]
                interpElemAttrs(v, [g(XY(x, 0)), g(XY(0, y)), g(XY(x, ytot - 1)), g(XY(xtot - 1, y))], w, bm.vdata)
            }
        }
    }

    // Build Faces
    const out: BMFace[] = []
    for (let x = 0; x < xtot - 1; x++) {
        for (let y = 0; y < ytot - 1; y++) {
            // `BM_face_create_quad_tri(.., BM_CREATE_NOP)` -> `BM_face_create_verts(.., create_edges=true)`.
            const f = useFlip
                ? bm.faceCreate([g(XY(x, y)), g(XY(x, y + 1)), g(XY(x + 1, y + 1)), g(XY(x + 1, y))]) // BL TL TR BR
                : bm.faceCreate([g(XY(x + 1, y)), g(XY(x + 1, y + 1)), g(XY(x, y + 1)), g(XY(x, y))]) // BR TR TL BL

            if (useLoopInterp && (larrXA[x][0] || larrYA[y][0])) {
                // bottom/left/top/right
                let interpFrom: 'B' | 'X' | 'Y'
                let lTmp: BMLoop
                if (larrXA[x][0] && larrYA[y][0]) {
                    interpFrom = 'B' // B == both
                    lTmp = larrXA[x][0]!
                } else if (larrXA[x][0]) {
                    interpFrom = 'X'
                    lTmp = larrXA[x][0]!
                } else {
                    interpFrom = 'Y'
                    lTmp = larrYA[y][0]!
                }

                faceAttrsCopy(bm, lTmp.f, f)

                // `l_quad[x_side * 2 + y_side]`: BL, TL, BR, TR whichever way the face was wound.
                const lQuad: BMLoop[] = new Array(4)
                lTmp = f.lFirst
                if (useFlip) {
                    lQuad[0] = lTmp
                    lTmp = lTmp.next
                    lQuad[1] = lTmp
                    lTmp = lTmp.next
                    lQuad[3] = lTmp
                    lTmp = lTmp.next
                    lQuad[2] = lTmp
                } else {
                    lQuad[2] = lTmp
                    lTmp = lTmp.next
                    lQuad[3] = lTmp
                    lTmp = lTmp.next
                    lQuad[1] = lTmp
                    lTmp = lTmp.next
                    lQuad[0] = lTmp
                }

                let i = 0
                for (let xSide = 0; xSide < 2; xSide++) {
                    for (let ySide = 0; ySide < 2; ySide++) {
                        if (interpFrom === 'B') {
                            const w = weightTable![XY(x + xSide, y + ySide)]
                            const lBound = [
                                larrXA[x][xSide]!, // B
                                larrYA[y][ySide]!, // L
                                larrXB[x][xSide]!, // T
                                larrYB[y][ySide]!, // R
                            ]
                            loopInterpFromGridBoundary4(bm, lQuad[i++], lBound, w)
                        } else if (interpFrom === 'X') {
                            const t = (y + ySide) / (ytot - 1)
                            loopInterpFromGridBoundary2(bm, lQuad[i++], [larrXA[x][xSide]!, larrXB[x][xSide]!], t) // B, T
                        } else {
                            const t = (x + xSide) / (xtot - 1)
                            loopInterpFromGridBoundary2(bm, lQuad[i++], [larrYA[y][ySide]!, larrYB[y][ySide]!], t) // L, R
                        }
                    }
                }
            }
            // end interp

            out.push(f)
            f.matNr = matNr
            if (useSmooth) f.hflag |= ElemFlag.Smooth
        }
    }
    return out
}

/**
 * `bm_grid_fill` (`bmo_fill_grid.cc:464`): lay the four chains into the grid and decide the winding.
 *
 * <pre>
 *           estore_b
 *          +------------------+
 *       ^  |                  |
 *   end |  |                  |
 *       |  |estore_rail_a     |estore_rail_b
 * start |  |                  |
 *          |estore_a          |
 *          +------------------+
 *                --->
 *             start -> end
 * </pre>
 */
function gridFillLoops(
    bm: BMesh, storeA: BMEdgeLoopStore, storeB: BMEdgeLoopStore, storeRailA: BMEdgeLoopStore,
    storeRailB: BMEdgeLoopStore, matNr: number, useSmooth: boolean, useInterpSimple: boolean,
): BMFace[] {
    const xtot = storeA.len
    const ytot = storeRailA.len
    const lbA = storeA.verts
    const lbB = storeB.verts
    const lbRailA = storeRailA.verts
    const lbRailB = storeRailB.verts

    if (lbA[0] !== lbRailA[0] || lbB[0] !== lbRailA[lbRailA.length - 1]
        || lbB[lbB.length - 1] !== lbRailB[lbRailB.length - 1] || lbA[lbA.length - 1] !== lbRailB[0]) {
        throw new Error('mesh-kernel: grid fill chains do not meet at the corners') // the BLI_asserts (:509-512)
    }

    const vGrid: (BMVert | null)[] = new Array(xtot * ytot).fill(null)
    for (let i = 0; i < lbA.length; i++) vGrid[i] = lbA[i]
    for (let i = 0; i < lbB.length; i++) vGrid[ytot * xtot + (i - xtot)] = lbB[i]
    for (let i = 0; i < lbRailA.length; i++) vGrid[xtot * i] = lbRailA[i]
    for (let i = 0; i < lbRailB.length; i++) vGrid[xtot * i + (xtot - 1)] = lbRailB[i]

    // USE_FLIP_DETECT (:534): every boundary edge of the four chains votes for the winding that
    // runs against its face.
    let useFlip: boolean
    {
        const lbIter = [lbA, lbB, lbRailA, lbRailB]
        const lbIterDir = [-1, 1, 1, -1]
        let windingVotes = 0
        for (let i = 0; i < 4; i++) {
            const lb = lbIter[i]
            for (let j = 0; j + 1 < lb.length; j++) {
                const e = diskEdgeExists(lb[j], lb[j + 1])!
                if (edgeIsBoundary(e)) {
                    windingVotes += e.l!.v === lb[j] ? lbIterDir[i] : -lbIterDir[i]
                }
            }
        }
        useFlip = windingVotes < 0
    }

    return gridFillArray(bm, vGrid, xtot, ytot, matNr, useSmooth, useFlip, useInterpSimple)
}

/**
 * `bm_edgeloop_flag_set` (`bmo_fill_grid.cc:562`), for `BM_ELEM_HIDDEN`: the edges between
 * consecutive vertices of the chain (not a closing edge - "only handle closed loops in this case").
 */
function edgeloopEdgesBetween(store: BMEdgeLoopStore, out: Set<BMEdge>): void {
    for (let i = 1; i < store.verts.length; i++) {
        const e = diskEdgeExists(store.verts[i], store.verts[i - 1])
        if (e) out.add(e)
    }
}

/**
 * Fill between two open edge chains with a grid of quads. Port of `bmo_grid_fill_exec`
 * (`bmo_fill_grid.cc:592`), Blender's `bmesh.ops.grid_fill`.
 *
 * `edges` must form exactly two open chains. Their ends are joined by "rails": the shortest paths of
 * wire or boundary edges (not hidden, not on the chains) from end to end, first-to-first and
 * last-to-last or, failing that, crossed (`estore_b` is then flipped, :664). Chains or rails of
 * unequal length are evened out by splitting edges of the shorter one (`BM_edgeloop_expand`), and the
 * split edges are collapsed again once the grid is built, so the grid ends in triangles there.
 *
 * On failure nothing is changed and the error is Blender's `BMO_error_raise` message.
 */
export function gridFill(bm: BMesh, edges: Iterable<BMEdge>, options: GridFillOptions = {}): GridFillResult {
    const matNr = options.matNr ?? 0
    const useSmooth = options.useSmooth === true
    const useInterpSimple = options.useInterpSimple === true

    // EDGE_MARK
    const edgeMark = new Set(edges)
    const eloops = edgeloopsFind(bm, e => edgeMark.has(e))

    if (eloops.length !== 2) {
        // "Note that this error message has been adjusted to make sense when called from the operator
        // `MESH_OT_fill_grid` which has a 'prepare' pass which can extract two 'rail' loops from a
        // single edge loop, see #72075."
        return {ok: false, error: 'Select two edge loops or a single closed edge loop from which two edge loops can be calculated'}
    }

    const storeA = eloops[0]
    const storeB = eloops[eloops.length - 1]
    const vAFirst = storeA.first
    const vALast = storeA.last
    const vBFirst = storeB.first
    const vBLast = storeB.last

    if (storeA.closed || storeB.closed) return {ok: false, error: 'Closed loops unsupported'}

    // "cheat here, temp hide all edges so they won't be included in rails" (:644).
    const tempHidden = new Set<BMEdge>()
    edgeloopEdgesBetween(storeA, tempHidden)
    edgeloopEdgesBetween(storeB, tempHidden)

    /** `bm_edge_test_rail_cb` (`bmo_fill_grid.cc:582`). */
    const railTest = (e: BMEdge): boolean => {
        // "Normally operators don't check for hidden state but alternative would be to pass slot of
        // rail edges."
        if ((e.hflag & ElemFlag.Hidden) || tempHidden.has(e)) return false
        return edgeIsWire(e) || edgeIsBoundary(e)
    }

    let storeRailA: BMEdgeLoopStore | null = null
    let storeRailB: BMEdgeLoopStore | null = null
    {
        const r1 = edgeloopsFindPath(bm, railTest, vAFirst, vBFirst)
        const r2 = r1 ? edgeloopsFindPath(bm, railTest, vALast, vBLast) : null
        if (r1 && r2) {
            storeRailA = r1
            storeRailB = r2
        } else {
            const r3 = edgeloopsFindPath(bm, railTest, vAFirst, vBLast)
            const r4 = r3 ? edgeloopsFindPath(bm, railTest, vALast, vBFirst) : null
            if (r3 && r4) {
                storeRailA = r3
                storeRailB = r4
                edgeloopFlip(storeB)
            }
        }
    }
    tempHidden.clear()

    if (!storeRailA || !storeRailB) return {ok: false, error: 'Loops are not connected by wire/boundary edges'}

    if (edgeloopOverlapCheck(storeRailA, storeRailB)) return {ok: false, error: 'Connecting edge loops overlap'}

    // add vertices if needed
    let splitEdges: Set<BMEdge> | null = null
    {
        const storePairs: [BMEdgeLoopStore, BMEdgeLoopStore][] = [[storeA, storeB], [storeRailA, storeRailB]]
        for (const [s0, s1] of storePairs) {
            const lenA = s0.len
            const lenB = s1.len
            if (lenA !== lenB) {
                if (!splitEdges) splitEdges = new Set()
                if (lenA < lenB) edgeloopExpand(bm, s0, lenB, true, splitEdges)
                else edgeloopExpand(bm, s1, lenA, true, splitEdges)
            }
        }
    }

    // finally we have all edge loops needed
    const faceOut = new Set(gridFillLoops(bm, storeA, storeB, storeRailA, storeRailB, matNr, useSmooth, useInterpSimple))

    if (splitEdges) {
        // Blender walks a `Set<BMEdge *>` (hash order); the collapses are independent of order. A
        // split edge spliced away by an earlier collapse would be a freed pointer in Blender; it is
        // skipped here.
        for (const e of splitEdges) {
            if (!bm.edges.has(e)) continue
            edgeCollapse(bm, e, e.v2, true, true)
        }
    }

    // `BMO_slot_buffer_from_enabled_flag(.., "faces.out", BM_FACE, FACE_OUT)`: mesh order.
    return {ok: true, faces: [...bm.faces].filter(f => faceOut.has(f))}
}

// endregion

// region helpers - bmo_dupe.cc / bmesh_delete.cc / bmesh_operators.cc pieces the kernel lacks

/**
 * The end of `BMO_op_exec` (`bmesh_operators.cc:181`, `bmesh_edit_end`, `bmesh_mesh.cc:300`) for an
 * operator with `BMO_OPTYPE_FLAG_SELECT_FLUSH`: flush the selection by the select mode. Without
 * `BMO_OPTYPE_FLAG_SELECT_VALIDATE` the select history is saved before and restored after, so the
 * flush cannot prune it. (`NORMALS_CALC` is not ported, see the module comment.)
 */
export function bmoEditEnd(bm: BMesh, selectValidate: boolean): void {
    const history = selectValidate ? null : [...bm.selectHistory]
    // `selectModeFlush` recounts the totals at the end, as `BM_mesh_select_mode_flush_ex` does
    // (`bmesh_marking.cc:529-538`), so kills and raw flag edits before this leave no stale counters.
    selectModeFlush(bm)
    if (history) bm.selectHistory = history
}

/** Elements by type, a `BMO` element buffer split in three. */
export interface BMOGeom {
    verts: BMVert[]
    edges: BMEdge[]
    faces: BMFace[]
}

export interface BMODuplicateResult {
    /** `geom.out`: the new elements, in mesh order (verts, edges, faces). */
    geomOut: BMOGeom
    /** `boundary_map.out`: source edge -> new edge, for every copied edge with fewer than two input faces. */
    boundaryMap: Map<BMEdge, BMEdge>
    /** `vert_map.out` / `edge_map.out` / `face_map.out` in the source -> copy direction. */
    vertMap: Map<BMVert, BMVert>
    edgeMap: Map<BMEdge, BMEdge>
    faceMap: Map<BMFace, BMFace>
}

/**
 * `bmo_duplicate_exec` (`bmo_dupe.cc:370`) with `bmo_mesh_copy` (`:209`) and its element copies
 * (`bmo_vert_copy` :35, `bmo_edge_copy` :71, `bmo_face_copy` :147), within one mesh, with
 * `use_select_history` and `use_edge_flip_from_face` off (the defaults) and without `isovert_map.out`.
 *
 * Unlike `duplicateGeometry` in `duplicate.ts` this keeps Blender's order (input vertices, then input
 * edges, then input faces with whatever they still need), creates edges without the no-double
 * check, and records `boundary_map.out`, which the split-join of Grid Fill needs.
 */
export function bmoDuplicate(bm: BMesh, geom: BMOGeom): BMODuplicateResult {
    // DUPE_INPUT / DUPE_DONE / DUPE_NEW
    const inV = new Set(geom.verts), inE = new Set(geom.edges), inF = new Set(geom.faces)
    const doneV = new Set<BMVert>(), doneE = new Set<BMEdge>()
    const newElems = new Set<BMVert | BMEdge | BMFace>()
    const vhash = new Map<BMVert, BMVert>()
    const ehash = new Map<BMEdge, BMEdge>()
    const faceMap = new Map<BMFace, BMFace>()
    const boundaryMap = new Map<BMEdge, BMEdge>()

    /** `bmo_vert_copy`: `BM_vert_create(.., BM_CREATE_SKIP_CD)` + `BM_elem_attrs_copy`. */
    const vertCopy = (vSrc: BMVert): BMVert => {
        const vDst = bm.vertCreate(vSrc.x, vSrc.y, vSrc.z, vSrc)
        vhash.set(vSrc, vDst)
        newElems.add(vDst)
        return vDst
    }

    /** `bmo_edge_copy`. */
    const edgeCopy = (eSrc: BMEdge): BMEdge => {
        // "see if any of the neighboring faces are not being duplicated. in that case, add it to the
        // new/old map."
        let rlen = 0
        for (const l of radialLoops(eSrc)) if (inF.has(l.f)) rlen++
        const eDst = bm.edgeCreate(vhash.get(eSrc.v1)!, vhash.get(eSrc.v2)!, eSrc)
        if (rlen < 2) boundaryMap.set(eSrc, eDst)
        ehash.set(eSrc, eDst)
        newElems.add(eDst)
        return eDst
    }

    /** `bmo_face_copy`. */
    const faceCopy = (fSrc: BMFace): BMFace => {
        const lSrc = fSrc.loops()
        const fDst = bm.faceCreateWithEdges(lSrc.map(l => vhash.get(l.v)!), lSrc.map(l => ehash.get(l.e!)!), fSrc)
        faceMap.set(fSrc, fDst)
        // copy per-loop custom data
        const lDst = fDst.loops()
        for (let i = 0; i < lSrc.length; i++) {
            copyElemAttrs(lSrc[i], lDst[i], bm.ldata)
            copyElemHeader(lSrc[i], lDst[i], 'loop')
        }
        newElems.add(fDst)
        return fDst
    }

    // duplicate flagged vertices
    for (const v of [...bm.verts]) {
        if (inV.has(v) && !doneV.has(v)) {
            vertCopy(v)
            doneV.add(v)
        }
    }
    // now we dupe all the edges
    for (const e of [...bm.edges]) {
        if (inE.has(e) && !doneE.has(e)) {
            // make sure that verts are copied
            if (!doneV.has(e.v1)) {
                vertCopy(e.v1)
                doneV.add(e.v1)
            }
            if (!doneV.has(e.v2)) {
                vertCopy(e.v2)
                doneV.add(e.v2)
            }
            edgeCopy(e)
            doneE.add(e)
        }
    }
    // first we dupe all flagged faces and their elements from source
    for (const f of [...bm.faces]) {
        if (!inF.has(f)) continue
        for (const l of f.loops()) {
            if (!doneV.has(l.v)) {
                vertCopy(l.v)
                doneV.add(l.v)
            }
        }
        for (const l of f.loops()) {
            if (!doneE.has(l.e!)) {
                edgeCopy(l.e!)
                doneE.add(l.e!)
            }
        }
        faceCopy(f)
    }

    const result: BMODuplicateResult = {
        geomOut: {
            verts: [...bm.verts].filter(v => newElems.has(v)),
            edges: [...bm.edges].filter(e => newElems.has(e)),
            faces: [...bm.faces].filter(f => newElems.has(f)),
        },
        boundaryMap, vertMap: vhash, edgeMap: ehash, faceMap,
    }
    // `bmo_duplicate_def`: NORMALS_CALC | SELECT_FLUSH.
    bmoEditEnd(bm, false)
    return result
}

/**
 * `BMO_mesh_delete_oflag_context` (`bmesh_delete.cc:86`) for `DEL_FACES`: the flagged faces go,
 * with every edge and vertex of theirs that no unflagged face (or, for vertices, unflagged edge)
 * still uses. The sets are the operator flag and are updated in place, as Blender's flags are;
 * `prepareFn` runs after the marking and before the removal, as Blender's does.
 */
export function bmoDeleteFacesContext(
    bm: BMesh, flagV: Set<BMVert>, flagE: Set<BMEdge>, flagF: Set<BMFace>, prepareFn?: () => void,
): void {
    // go through and mark all edges and all verts of all faces for delete
    for (const f of bm.faces) {
        if (!flagF.has(f)) continue
        for (const l of f.eachLoop()) {
            flagV.add(l.v)
            flagE.add(l.e!)
        }
    }
    // now go through and mark all remaining faces all edges for keeping
    for (const f of bm.faces) {
        if (flagF.has(f)) continue
        for (const l of f.eachLoop()) {
            flagV.delete(l.v)
            flagE.delete(l.e!)
        }
    }
    // also mark all the vertices of remaining edges for keeping
    for (const e of bm.edges) {
        if (!flagE.has(e)) {
            flagV.delete(e.v1)
            flagV.delete(e.v2)
        }
    }
    if (prepareFn) prepareFn()

    // `bmo_remove_tagged_faces` / `_edges` / `_verts` (`bmesh_delete.cc:19-53`)
    for (const f of [...bm.faces]) if (flagF.has(f)) bm.faceKill(f)
    for (const e of [...bm.edges]) if (flagE.has(e)) bm.edgeKill(e)
    for (const v of [...bm.verts]) if (flagV.has(v)) bm.vertKill(v)
}

/**
 * `bmo_split_exec` (`bmo_dupe.cc:433`): duplicate `geom`, then delete the originals in the
 * `DEL_FACES` context (keeping whatever unselected faces still use). Returns the duplicate's
 * `geom.out` and the split's `boundary_map.out`, whose key is the destination itself when the source
 * edge was deleted ("Use the 'destination' as the key and the value since it avoids adding freed
 * geometry into the map", #142633).
 */
export function bmoSplit(bm: BMesh, geom: BMOGeom, useOnlyFaces = false): {geomOut: BMOGeom, boundaryMap: Map<BMEdge, BMEdge>} {
    const dupe = bmoDuplicate(bm, geom)

    const newActFace = bm.actFace ? dupe.faceMap.get(bm.actFace) : undefined
    if (newActFace) bm.actFace = newActFace

    // SPLIT_INPUT
    const flagV = new Set(geom.verts), flagE = new Set(geom.edges), flagF = new Set(geom.faces)

    if (useOnlyFaces) {
        // make sure to remove edges and verts we don't need
        for (const e of bm.edges) {
            let found = false
            for (const l of radialLoops(e)) {
                if (!flagF.has(l.f)) {
                    found = true
                    break
                }
            }
            if (!found) flagE.add(e)
        }
        for (const v of bm.verts) {
            let found = false
            for (const e of diskEdges(v)) {
                if (!flagE.has(e)) {
                    found = true
                    break
                }
            }
            if (!found) flagV.add(v)
        }
    }

    const boundaryMap = new Map<BMEdge, BMEdge>()
    bmoDeleteFacesContext(bm, flagV, flagE, flagF, () => {
        // "Call before deletion so deleted geometry isn't copied."
        for (const [key, val] of dupe.boundaryMap) {
            boundaryMap.set(flagE.has(key) ? val : key, val)
        }
    })

    // `bmo_split_def`: NORMALS_CALC | SELECT_FLUSH.
    bmoEditEnd(bm, false)
    return {geomOut: dupe.geomOut, boundaryMap}
}

// endregion

// region editmesh_tools.cc - MESH_OT_fill_grid

/**
 * The edit-mode operator's properties (`MESH_OT_fill_grid`, `editmesh_tools.cc:5162`), plus the
 * edit-mesh's active material.
 */
export interface GridFillSelectionOptions {
    /**
     * `span`: "Number of grid columns" (1-1000, default 1). Leave undefined to have it calculated
     * from the selected loop, which is what Blender does when the property is not set (and on every
     * fresh invoke): the result reports the value it settled on.
     */
    span?: number
    /** `offset`: "Vertex that is the corner of the grid" (-1000-1000, default 0). */
    offset?: number
    /** `use_interp_simple`: "Simple Blending" - "Use simple interpolation of grid vertices". Default false. */
    useInterpSimple?: boolean
    /** `em->mat_nr`: the object's active material slot, given to the new faces. Default 0. */
    matNr?: number
}

export type GridFillSelectionResult =
    | {ok: true, faces: BMFace[], /** The `span` property after the run, as the redo panel shows it. */ span: number}
    | {ok: false, error: string, span: number}

const clampSpan = (span: number) => Math.min(1000, Math.max(1, span))

/**
 * `edbm_add_edge_face__smooth_get` (`editmesh_tools.cc:741`): new faces are smooth when most of the
 * selected edges' first faces are.
 */
export function edbmAddEdgeFaceSmoothGet(bm: BMesh): boolean {
    const voteOnSmooth = [0, 0]
    for (const e of bm.edges) {
        if ((e.hflag & ElemFlag.Select) && e.l) {
            voteOnSmooth[(e.l.f.hflag & ElemFlag.Smooth) ? 1 : 0]++
        }
    }
    return voteOnSmooth[0] < voteOnSmooth[1]
}

/**
 * `edbm_fill_grid_vert_tag_angle` (`editmesh_tools.cc:4771`): how far from straight the two tagged
 * edges at `v` are.
 */
function fillGridVertTagAngle(v: BMVert, tagged: Set<BMEdge>): number {
    const vPair: BMVert[] = []
    for (const e of diskEdges(v)) {
        if (tagged.has(e)) vPair.push(e.otherVert(v))
    }
    if (vPair.length !== 2) throw new Error('mesh-kernel: grid fill corner vertex does not have two loop edges')
    return Math.abs(Math.PI - angleV3V3V3(co(vPair[0]), co(v), co(vPair[1])))
}

/**
 * `edbm_fill_grid_prepare` (`editmesh_tools.cc:4790`): "non-essential utility function to select 2
 * open edge loops from a closed loop". Tags (in `tagged`, Blender's `BM_ELEM_TAG`) the selected loop
 * minus two opposite runs of `span` edges - the rails. Returns false (nothing tagged) unless exactly
 * one loop is selected; `span` is what the operator writes back into its property.
 */
function fillGridPrepare(
    bm: BMesh, offset: number, span: number, spanCalc: boolean, tagged: Set<BMEdge>,
): {ok: boolean, span: number} {
    // angle differences below this value are considered 'even' in that they shouldn't be used to
    // calculate corners used for the 'span'
    const epsEven = 1e-3

    // `bm_edge_test_fill_grid_cb` (:4766)
    const eloops = edgeloopsFind(bm, e => (e.hflag & ElemFlag.Select) !== 0)
    if (eloops.length !== 1) {
        // "Let the operator use the selection flags, most likely failing with an error in this case."
        return {ok: false, span}
    }
    const elStore = eloops[0]

    // Only tag edges that are part of a loop.
    tagged.clear()
    const vertsLen = elStore.len
    const edgesLen = vertsLen - (elStore.closed ? 0 : 1)
    let edges = edgeloopEdgesGet(elStore)
    for (const e of edges) tagged.add(e)

    if (spanCalc) span = Math.trunc(vertsLen / 4)
    else span = Math.min(span, Math.trunc(vertsLen / 2) - 1)
    offset = modI(offset, vertsLen)

    if (((vertsLen & 1) === 0) && (vertsLen === edgesLen)) {
        // be clever! detect 2 edge loops from one closed edge loop
        const verts = elStore.verts
        // `BM_mesh_active_vert_get` (`bmesh_marking.cc:1018`): the last selection-history entry, if a vertex.
        const last = bm.selectHistory.length ? bm.selectHistory[bm.selectHistory.length - 1].elem : null
        let vAct: BMVert | null = last instanceof BMVert ? last : null
        let vActLink = vAct ? verts.indexOf(vAct) : -1

        if (vActLink < 0) {
            // find the vertex with the best angle (a corner vertex)
            let vLinkBest = -1
            let angleBest = -1
            for (let i = 0; i < verts.length; i++) {
                const angle = fillGridVertTagAngle(verts[i], tagged)
                if (angle > angleBest || vLinkBest === -1) {
                    angleBest = angle
                    vLinkBest = i
                }
            }
            vActLink = vLinkBest
            vAct = verts[vActLink]
        }

        // set this vertex first (`BLI_listbase_rotate_first`)
        const rotateFirst = (i: number) => {
            const head = verts.splice(0, i)
            verts.push(...head)
        }
        rotateFirst(vActLink)

        if (offset !== 0) {
            vActLink = offset
            vAct = verts[vActLink]
            rotateFirst(vActLink)
        }

        // Run again to update the edge order from the rotated vertex list.
        edges = edgeloopEdgesGet(elStore)

        if (spanCalc) {
            // "calculate the span by finding the next corner in 'verts' we don't know what defines a
            // corner exactly so find the 4 verts in the loop with the greatest angle."
            const eleSort: {sortValue: number, data: number}[] = []
            for (let i = 0; i < vertsLen; i++) {
                const angle = fillGridVertTagAngle(verts[i], tagged)
                eleSort.push({sortValue: angle, data: i})
                // Do not allow the best corner or the diagonally opposite corner to be detected.
                if (i === 0 || i === Math.trunc(vertsLen / 2)) eleSort[i].sortValue = 0
            }

            // `qsort(.., BLI_sortutil_cmp_float_reverse)`. The C sort's order among equal values is
            // the C library's; glibc's merge sort is stable, as `Array.prototype.sort` is.
            eleSort.sort((a, b) => a.sortValue < b.sortValue ? 1 : a.sortValue > b.sortValue ? -1 : 0)

            // "Check that we have at least 3 corners. The excluded corners are the last and second
            // from last elements (both reset to 0). The best remaining corner is `ele_sort[0]` if
            // the angle on the best remaining corner is roughly the same as the third-last, then we
            // can't calculate 3+ corners - fallback to the even span."
            if ((eleSort[0].sortValue - eleSort[vertsLen - 3].sortValue) > epsEven) {
                span = eleSort[0].data
            }
        }
        // end span calc
        let start = 0

        // "The algorithm needs to iterate the shorter distance, between the best and second best
        // vert." (:4914)
        if (span > Math.trunc(vertsLen / 2)) {
            span = vertsLen - span
            start = Math.trunc(vertsLen / 2) - span
        }

        // un-flag 'rails'
        for (let i = start; i < start + span; i++) {
            tagged.delete(edges[i])
            tagged.delete(edges[Math.trunc(vertsLen / 2) + i])
        }
    }
    // else let the bmesh-operator handle it

    return {ok: true, span}
}

interface FillGridSplitJoin {
    /** `weld_op`'s `targetmap`: hole-side vertex -> island vertex. */
    weldTargetmap: Map<BMVert, BMVert>
    /** `delete_op`'s `geom`: the island's faces. */
    deleteFaces: BMFace[]
}

/**
 * `edbm_fill_grid_split_join_init` (`editmesh_tools.cc:4956`): "Split the current selection into a
 * separate island and prepare to rejoin it. [...] Once split this way, fill_grid will interpolate
 * using only the data from the selected faces, not the data from the surrounding faces."
 */
function fillGridSplitJoinInit(bm: BMesh): FillGridSplitJoin {
    // Split the selection into an island (`split` with no operator flags: hidden elements count).
    const sel = (x: {hflag: number}) => (x.hflag & ElemFlag.Select) !== 0
    const {geomOut, boundaryMap} = bmoSplit(bm, {
        verts: [...bm.verts].filter(sel),
        edges: [...bm.edges].filter(sel),
        faces: [...bm.faces].filter(sel),
    })

    // "Switch the selection to the corresponding edges on the island instead of the edges around the
    // hole, so fill_grid will interpolate using the face and loop data from the island."
    const weldTargetmap = new Map<BMVert, BMVert>()
    for (const [e, eDst] of boundaryMap) {
        // For edges, flip the selection from the edge of the hole to the edge of the island.
        eDst.hflag |= ElemFlag.Select

        // When these match, the source edge has been deleted.
        if (e !== eDst) {
            e.hflag &= ~ElemFlag.Select
            // "Don't try to add the same vert to the map more than once. If the selection was changed
            // false, it's already been processed."
            if (e.v1.hflag & ElemFlag.Select) {
                e.v1.hflag &= ~ElemFlag.Select
                eDst.v1.hflag |= ElemFlag.Select
                weldTargetmap.set(e.v1, eDst.v1)
            }
            if (e.v2.hflag & ElemFlag.Select) {
                e.v2.hflag &= ~ElemFlag.Select
                eDst.v2.hflag |= ElemFlag.Select
                weldTargetmap.set(e.v2, eDst.v2)
            }
        }
    }

    // Store the island for removal once it has been replaced by new fill_grid geometry.
    elemsHflagEnable(bm, geomOut.faces, ElemType.Face, ElemFlag.Select, false)
    const deleteFaces = [...bm.faces].filter(sel)

    // Blender sets these flags directly and leaves its counters stale until the next flush recounts.
    selectCountsRecalc(bm)
    return {weldTargetmap, deleteFaces}
}

/**
 * `edbm_fill_grid_split_join_finish` (`editmesh_tools.cc:5030`): "Restore the mesh after split and
 * fill_grid." On success the island is deleted and the grid (built on the island's boundary, so
 * "inside out") is reversed; either way the island is welded back onto the hole.
 */
function fillGridSplitJoinFinish(bm: BMesh, splitJoin: FillGridSplitJoin, changed: boolean): void {
    // If fill_grid worked, delete the replaced faces. Otherwise, restore original selection.
    if (changed) {
        // `delete context=DEL_FACES` (`bmo_delete_exec`, `bmo_dupe.cc:527`); `bmo_delete_def` is
        // NORMALS_CALC | SELECT_FLUSH | SELECT_VALIDATE.
        bmoDeleteFacesContext(bm, new Set(), new Set(), new Set(splitJoin.deleteFaces))
        bmoEditEnd(bm, true)
    } else {
        elemsHflagEnable(bm, splitJoin.deleteFaces, ElemType.Vert | ElemType.Edge | ElemType.Face, ElemFlag.Select, true)
    }

    // "If fill_grid created geometry from faces after those faces had been split from the rest of the
    // mesh, the geometry it generated will be inward-facing. [...] Fix it."
    if (changed) {
        // `reverse_faces faces=%hf flip_multires=true` (`bmo_reverse_faces_exec`, `bmo_utils.cc:156`),
        // hidden faces excluded (`BMO_FLAG_RESPECT_HIDE`). `flip_custom_normals` has nothing to flip.
        for (const f of [...bm.faces]) {
            if ((f.hflag & ElemFlag.Select) && !(f.hflag & ElemFlag.Hidden)) faceNormalFlip(f)
        }
    }

    // Put the mesh back together (`weld_verts`: NORMALS_CALC | SELECT_FLUSH | SELECT_VALIDATE).
    weldVerts(bm, splitJoin.weldTargetmap)
    bmoEditEnd(bm, true)
}

/**
 * Grid Fill on the edit-mode selection: Blender's `MESH_OT_fill_grid` (`edbm_fill_grid_exec`,
 * `editmesh_tools.cc:5067`).
 *
 * - Nothing happens without a selected edge (Blender skips the object silently).
 * - With faces selected, the selection is first split off as an island and the grid is built on the
 *   island's boundary, so UVs and other corner data come from the faces being replaced; the island
 *   is then deleted and the grid welded into the hole (`edbm_fill_grid_split_join_*`). Blender then
 *   welds the island back even when the fill fails - the geometry is unchanged, the elements are not.
 * - A single closed loop of an even number of edges is cut into two chains by
 *   `edbm_fill_grid_prepare`: `span` edges at each end become the rails, starting at the active
 *   vertex (or the sharpest corner), moved round by `offset`.
 * - Then `grid_fill` runs on those chains (or on the selected edges as they are), its new faces are
 *   added to the selection (`EDBM_op_call_and_selectf(.., select_extend=true)`).
 */
export function gridFillSelection(bm: BMesh, options: GridFillSelectionOptions = {}): GridFillSelectionResult {
    const useInterpSimple = options.useInterpSimple === true
    const matNr = options.matNr ?? 0
    // RNA hard ranges (`RNA_def_int`, :5179/:5181).
    const offsetProp = Math.min(1000, Math.max(-1000, Math.trunc(options.offset ?? 0)))
    const spanSet = options.span !== undefined

    if (bm.totedgesel === 0) {
        return {ok: false, error: 'Select two edge loops or a single closed edge loop from which two edge loops can be calculated',
            span: spanSet ? clampSpan(Math.trunc(options.span!)) : 1}
    }

    let usePrepare = true
    const useSmooth = edbmAddEdgeFaceSmoothGet(bm)

    const splitJoin = bm.totfacesel !== 0 ? fillGridSplitJoinInit(bm) : null

    const tagged = new Set<BMEdge>()
    let span: number
    {
        // use when we have a single loop selected
        let calcSpan: boolean
        // "Only reuse on redo because these settings need to match the current selection."
        if (spanSet) {
            span = clampSpan(Math.trunc(options.span!))
            calcSpan = false
        } else {
            // Will be overwritten if possible.
            span = 0
            calcSpan = true
        }

        // in simple cases, move selection for tags, but also support more advanced cases
        const prep = fillGridPrepare(bm, offsetProp, span, calcSpan, tagged)
        usePrepare = prep.ok
        // `RNA_property_int_set` clamps to the hard range.
        span = clampSpan(prep.span)
    }
    // end tricky prepare code

    // `grid_fill edges=%he` with `BMO_FLAG_DEFAULTS` (`BMO_FLAG_RESPECT_HIDE`): mesh order, not hidden.
    const edges = [...bm.edges].filter(e => !(e.hflag & ElemFlag.Hidden)
        && (usePrepare ? tagged.has(e) : (e.hflag & ElemFlag.Select) !== 0))
    const r = gridFill(bm, edges, {matNr, useSmooth, useInterpSimple})
    // `bmo_grid_fill_def`: NORMALS_CALC | SELECT_FLUSH (runs whether or not the operator failed).
    bmoEditEnd(bm, false)
    // `EDBM_op_call_and_selectf(em, op, "faces.out", true, ..)`: add the new faces, flushing.
    if (r.ok) elemsHflagEnable(bm, r.faces, ElemType.Face, ElemFlag.Select, true)
    const changed = r.ok

    // If a split/join in progress, finish it.
    if (splitJoin) fillGridSplitJoinFinish(bm, splitJoin, changed)

    if (!r.ok) return {ok: false, error: r.error, span}
    return {ok: true, faces: r.faces.filter(f => bm.faces.has(f)), span}
}

// endregion
